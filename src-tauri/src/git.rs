//! Git backend (WO11 contract §4.1): `git init` + a `.gitignore` composer,
//! nothing more (ratified scope, ASK #5 — no staging, commits, branches or
//! remotes in WO11). Shells out to the system `git` exactly as
//! `worktree.rs` already does: `Command::new("git")`, `no_console`
//! (`CREATE_NO_WINDOW` on Windows), `stderr_tail`. No new dependency —
//! `git2`/`gix` are not approved (CLAUDE.md: stack is fixed).
//!
//! `git` missing from PATH is an *answer*, not an error: `git_status`
//! returns `gitAvailable: false`, mirroring `worktree_check`'s doctrine
//! (`worktree.rs:121-126`). Only `git_init` and `gitignore_write` can
//! surface a real `Err` — `git_status` itself never does.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, write_atomic};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
fn no_console(cmd: &mut Command) {
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn no_console(_cmd: &mut Command) {}

/// Last <= 200 chars of stderr, flattened to one line. A third independent
/// copy of `assemble.rs`'s idiom (after `worktree.rs`'s own), per contract
/// §4.1's explicit instruction that this module shells out "exactly as
/// `worktree.rs` already does" — trivial and independent, not worth a
/// shared export across three modules.
fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = one_line.chars().collect();
    let start = chars.len().saturating_sub(200);
    chars[start..].iter().collect()
}

// Test-only seam: overrides the binary name `run_git` invokes, so a test
// can simulate "git missing from PATH" by pointing at a name that can
// never resolve. Deliberately `thread_local!`, not a process-wide static
// like `assemble.rs`'s `CLAUDE_OVERRIDE` — `cargo test` runs `#[test]`
// functions on separate threads concurrently, and a process-wide override
// would race every other test in this file that expects the real `git`.
// Each test thread gets its own copy, so setting it here can never leak
// into a sibling test running at the same time.
thread_local! {
    static GIT_BIN_OVERRIDE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_git_bin_override(bin: Option<&str>) {
    GIT_BIN_OVERRIDE.with(|cell| *cell.borrow_mut() = bin.map(str::to_string));
}

fn git_bin() -> String {
    GIT_BIN_OVERRIDE.with(|cell| cell.borrow().clone().unwrap_or_else(|| "git".to_string()))
}

/// One `git -C <root> <args>` invocation. `Err` only when the binary itself
/// cannot be spawned (not found on PATH) — a non-zero exit is still `Ok`
/// with a failing `ExitStatus`, for the caller to inspect.
fn run_git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(git_bin());
    cmd.arg("-C").arg(root);
    for a in args {
        cmd.arg(a);
    }
    no_console(&mut cmd);
    cmd.output().map_err(|_| "git not found on PATH".to_string())
}

/// Wire shape, mirrored 1:1 in `src/git/types.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// `git --version` succeeded (the binary was found and ran).
    pub git_available: bool,
    pub git_version: Option<String>,
    pub is_repo: bool,
    /// `git rev-parse HEAD` succeeded.
    pub has_commits: bool,
    /// None on detached HEAD / no commits / not a repo / git unavailable.
    pub branch: Option<String>,
    pub gitignore_exists: bool,
    /// Verbatim file content; `None` when the file is absent.
    pub gitignore_content: Option<String>,
}

fn not_available() -> GitStatus {
    GitStatus {
        git_available: false,
        git_version: None,
        is_repo: false,
        has_commits: false,
        branch: None,
        gitignore_exists: false,
        gitignore_content: None,
    }
}

fn read_gitignore(root: &Path) -> (bool, Option<String>) {
    let path = root.join(".gitignore");
    let exists = path.is_file();
    let content = if exists { fs::read_to_string(&path).ok() } else { None };
    (exists, content)
}

/// Probes `root` for git availability, repo state and `.gitignore`. Never
/// fails on its own — every git invocation inside is treated as an answer,
/// not an error; only `checked_root` (bad/missing directory) can make the
/// wrapping command `Err`.
fn probe_status(root: &Path) -> GitStatus {
    let version = match run_git(root, &["--version"]) {
        Ok(out) if out.status.success() => {
            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        }
        Ok(_) => None,
        Err(_) => {
            let mut status = not_available();
            let (exists, content) = read_gitignore(root);
            status.gitignore_exists = exists;
            status.gitignore_content = content;
            return status;
        }
    };

    let is_repo = run_git(root, &["rev-parse", "--is-inside-work-tree"])
        .map(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "true")
        .unwrap_or(false);

    let has_commits = is_repo
        && run_git(root, &["rev-parse", "HEAD"])
            .map(|out| out.status.success())
            .unwrap_or(false);

    let branch = if is_repo {
        run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|b| !b.is_empty() && b != "HEAD")
    } else {
        None
    };

    let (gitignore_exists, gitignore_content) = read_gitignore(root);

    GitStatus {
        git_available: true,
        git_version: version,
        is_repo,
        has_commits,
        branch,
        gitignore_exists,
        gitignore_content,
    }
}

/// Read-only probe (WO11 §4.1). Never returns `Err` for anything git-shaped
/// — a non-repo, a bare repo, or `git` missing entirely are all valid
/// `GitStatus` answers. Only a bad `root` (not a directory) errors.
#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    let root_path = checked_root(&root)?;
    Ok(probe_status(&root_path))
}

/// `git -C <root> init` and nothing else — no commit, no remote, no config,
/// no first `add` (contract §4.1, frozen). Idempotent: calling it on an
/// already-initialized repo is a no-op that still returns fresh status,
/// because `git init` itself is idempotent.
#[tauri::command]
pub fn git_init(root: String) -> Result<GitStatus, String> {
    let root_path = checked_root(&root)?;
    let out = run_git(&root_path, &["init"])?;
    if !out.status.success() {
        return Err(stderr_tail(&out.stderr));
    }
    Ok(probe_status(&root_path))
}

/// Normalizes to LF line endings with exactly one trailing newline (empty
/// input stays empty). Writing the same logical content twice is therefore
/// always byte-identical, regardless of the caller's line-ending mix.
fn normalize_gitignore(content: &str) -> String {
    let lf = content.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = lf.trim_end_matches('\n');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\n")
    }
}

/// Writes `<root>/.gitignore` through [`write_atomic`]. Not a general write
/// primitive: the destination is fixed server-side — `content` is the only
/// variable, so no argument can redirect the write outside `root`. This is
/// a write into the user's project (CLAUDE.md's trust boundary); the UI
/// gates the call behind an explicit diff-preview approval before ever
/// invoking this command (contract §4.1) — this command trusts that gate
/// and writes unconditionally once called.
#[tauri::command]
pub fn gitignore_write(root: String, content: String) -> Result<(), String> {
    let root_path = checked_root(&root)?;
    let path: PathBuf = root_path.join(".gitignore");
    write_atomic(&path, &normalize_gitignore(&content))
}
