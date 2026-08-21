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
use crate::worktree::{display_path, validate_branch};
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
    /// True only when `root` itself is a git work tree's toplevel — see
    /// [`is_repo_at`]. A project folder merely nested somewhere *inside* an
    /// unrelated outer repo reports `false` here, not the outer repo's
    /// truth (WO13 fix — was previously computed with a plain
    /// `--is-inside-work-tree`, which walks upward and cannot tell the two
    /// apart).
    pub is_repo: bool,
    /// `git rev-parse HEAD` succeeded.
    pub has_commits: bool,
    /// None on detached HEAD / not a repo / git unavailable. Populated even
    /// before the first commit — an unborn branch (fresh `git init`, or
    /// `git_init`'s own `symbolic-ref` choice) still has a name; see
    /// [`probe_status`]'s use of `symbolic-ref --short HEAD` rather than
    /// `rev-parse --abbrev-ref HEAD` (WO13 fix, same root cause `worktree.rs`
    /// D8 already fixed for `worktree_check`/`branch_name`).
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

/// True only when `root` itself is the toplevel of a git work tree — not
/// merely nested somewhere underneath one (WO13 fix, acceptance defect 2
/// root cause (a)). `git rev-parse --is-inside-work-tree` alone answers "is
/// `root` inside *any* work tree", walking upward through parent
/// directories until it finds one; a project folder nested under an
/// unrelated outer repo therefore reads as "already a repo" under that
/// check alone, even though `root` has no `.git` of its own.
/// `--show-toplevel` resolves to the outermost work tree root that
/// *contains* `root`, whichever one that is — so a repo genuinely rooted AT
/// `root` is exactly the case where the two normalized paths coincide.
/// Comparison reuses `worktree::display_path` (canonicalize + forward
/// slashes, the codebase's existing path-normalization idiom), lowercased
/// on Windows where the filesystem is case-insensitive.
fn is_repo_at(root: &Path) -> bool {
    let inside = run_git(root, &["rev-parse", "--is-inside-work-tree"])
        .map(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside {
        return false;
    }
    let toplevel = match run_git(root, &["rev-parse", "--show-toplevel"]) {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => return false,
    };
    if toplevel.is_empty() {
        return false;
    }
    let root_display = display_path(root);
    let top_display = display_path(Path::new(&toplevel));
    #[cfg(windows)]
    let (root_display, top_display) = (root_display.to_lowercase(), top_display.to_lowercase());
    root_display == top_display
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

    let is_repo = is_repo_at(root);

    let has_commits = is_repo
        && run_git(root, &["rev-parse", "HEAD"])
            .map(|out| out.status.success())
            .unwrap_or(false);

    // `symbolic-ref --short HEAD`, not `rev-parse --abbrev-ref HEAD`: the
    // latter fails on an unborn HEAD (a freshly `git init`-ed, commitless
    // repo — exactly what `git_init` itself produces), so `branch` used to
    // come back `None` right after init even though the chosen name really
    // is at `.git/HEAD` (WO13 fix, acceptance defect 2 root cause (b));
    // mirrors `worktree.rs`'s own `branch_name`, added there for the same
    // unborn-HEAD failure mode (D8). Still `None` on detached HEAD, where
    // `symbolic-ref` also fails.
    let branch = if is_repo {
        run_git(root, &["symbolic-ref", "--short", "HEAD"])
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|b| !b.is_empty())
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

/// `git -C <root> init` and nothing else beyond an optional default-branch
/// choice — no commit, no remote, no config, no first `add` (contract
/// §4.1). Idempotent, and D1b-safe: calling it on an already-initialized
/// repo is a genuine no-op — `branch` is validated but then never acted on,
/// because the directory is probed for an existing repo BEFORE `init` or
/// `symbolic-ref` ever run, and both are skipped entirely when it already
/// is one. Re-running the wizard on a project you already initialized must
/// never silently move that repo's HEAD.
///
/// "Already a repo" here means [`is_repo_at`]: `root` itself is a work
/// tree's toplevel, not merely nested somewhere inside one (WO13 fix,
/// acceptance defect 2 root cause (a)). The plain `--is-inside-work-tree`
/// check this used before walks upward through parent directories, so a
/// project folder created under an unrelated outer repo used to read as
/// "already a repo" and silently skip `init` — the user's branch choice was
/// validated and then discarded, no `.git` was ever created at `root`, and
/// the resulting `GitStatus` was the OUTER repo's, not this project's own.
/// `--show-toplevel` distinguishes the two: `git init` now genuinely runs
/// (creating `root`'s own nested `.git`) whenever `root` is not itself that
/// toplevel, even while sitting inside someone else's repo.
///
/// `branch: None` reproduces the pre-D1b behaviour byte-for-byte — bare
/// `git init`, branch name left to `init.defaultBranch` / git's own
/// built-in default. `branch: Some(name)` is validated with
/// [`validate_branch`] (the same rule set `worktree_add` uses, D1b: plus a
/// leading `-`, a `..` anywhere, and a trailing `.lock`) BEFORE any
/// filesystem mutation — an invalid name never creates a `.git` directory.
///
/// Deliberately NOT `git init -b <name>`: that flag needs git >= 2.28 and
/// hard-fails on older installs. The version-safe two-step instead: `init`,
/// then `symbolic-ref HEAD refs/heads/<name>` — a command every git version
/// in practical use supports.
#[tauri::command]
pub fn git_init(root: String, branch: Option<String>) -> Result<GitStatus, String> {
    let root_path = checked_root(&root)?;
    if let Some(name) = branch.as_deref() {
        validate_branch(name)?;
    }

    let already_repo = is_repo_at(&root_path);

    if !already_repo {
        let out = run_git(&root_path, &["init"])?;
        if !out.status.success() {
            return Err(stderr_tail(&out.stderr));
        }
        if let Some(name) = branch.as_deref() {
            let target = format!("refs/heads/{name}");
            let sref = run_git(&root_path, &["symbolic-ref", "HEAD", &target])?;
            if !sref.status.success() {
                return Err(stderr_tail(&sref.stderr));
            }
        }
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
