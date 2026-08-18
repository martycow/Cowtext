//! Git worktree helpers (WO01 Block F contract §4.1). Two thin commands over
//! `git`: `worktree_check` answers "is this a repo, and if so is it a linked
//! worktree", `worktree_add` creates one. Neither talks to Tauri state — both
//! are plain functions the `sessions` module also calls directly (the
//! `agent_session_spawn` guardrail, contract §3).
//!
//! "Not a git repository" is an *answer*, not a failure: `worktree_check`
//! only returns `Err` when `git` itself is missing from PATH.

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Wire shape, mirrored 1:1 in `src/sessions/api.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    /// Canonicalized, forward slashes.
    pub path: String,
    pub is_repo: bool,
    /// true iff git-dir !== git-common-dir (a linked worktree).
    pub is_worktree: bool,
    /// null when detached HEAD or not a repo.
    pub branch: Option<String>,
}

/// Characters `worktree_add` refuses in a branch name (contract §4.1),
/// alongside empty and whitespace-containing names.
const INVALID_BRANCH_CHARS: &[char] = &['~', '^', ':', '?', '*', '[', '\\'];

#[cfg(windows)]
fn no_console(cmd: &mut Command) {
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn no_console(_cmd: &mut Command) {}

/// Canonicalized, forward-slash form of `path`, with the `\\?\` extended-path
/// prefix Windows' `fs::canonicalize` adds stripped back off (this is a
/// display/compare form, not something passed back into another Windows API
/// that would need it). Falls back to a purely lexical forward-slash form
/// when the path doesn't exist yet (e.g. `worktree_add`'s not-yet-created
/// `new_path` before the git call runs).
pub(crate) fn display_path(path: &Path) -> String {
    match fs::canonicalize(path) {
        Ok(canon) => {
            let s = canon.to_string_lossy().replace('\\', "/");
            s.strip_prefix("//?/").map(str::to_string).unwrap_or(s)
        }
        Err(_) => path.to_string_lossy().replace('\\', "/"),
    }
}

/// Lexical (no filesystem access) `.`/`..`-resolved form, forward slashes.
fn lexical_normalize(path: &Path) -> String {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out.to_string_lossy().replace('\\', "/")
}

/// True when `candidate` is `ancestor` itself or lexically nested under it.
/// Purely lexical — `new_path` in `worktree_add` need not exist yet.
fn is_within(candidate: &Path, ancestor: &Path) -> bool {
    let c = lexical_normalize(candidate);
    let a = lexical_normalize(ancestor);
    #[cfg(windows)]
    let (c, a) = (c.to_lowercase(), a.to_lowercase());
    let a_trimmed = a.trim_end_matches('/');
    c == a_trimmed || c.starts_with(&format!("{a_trimmed}/"))
}

/// Normalizes a `git rev-parse` path line for the `is_worktree` compare:
/// resolved against `base` (`--git-common-dir` is sometimes printed relative
/// to the `-C <path>` target — e.g. a bare `.git` for the main working copy
/// — while `--absolute-git-dir` never is; comparing an absolute path against
/// an unresolved relative one always reads as "different", which would
/// misreport every main working copy as a linked worktree), then forward
/// slashes, case-insensitive on Windows.
fn normalize_git_path(base: &Path, s: &str) -> String {
    let raw = s.trim();
    let candidate = Path::new(raw);
    let abs = if candidate.is_absolute() { candidate.to_path_buf() } else { base.join(candidate) };
    let n = lexical_normalize(&abs);
    #[cfg(windows)]
    {
        n.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        n
    }
}

/// Last <= 200 chars of stderr, flattened to one line. Duplicated from
/// `assemble.rs`'s idiom rather than exported (contract §4.1's explicit
/// instruction) — the two copies are trivial and independent.
fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = one_line.chars().collect();
    let start = chars.len().saturating_sub(200);
    chars[start..].iter().collect()
}

/// One `git -C <path> rev-parse --is-inside-work-tree --absolute-git-dir
/// --git-common-dir --abbrev-ref HEAD` invocation (contract §4.1, byte-exact
/// flag set). Non-zero exit (which includes "not a git repository", and also
/// covers a repo with no commits yet, where `--abbrev-ref HEAD` itself fails
/// — an accepted simplification per the frozen contract) -> `Ok` with
/// `isRepo: false`, never `Err`. `git` missing entirely -> `Err`.
#[tauri::command]
pub fn worktree_check(path: String) -> Result<WorktreeInfo, String> {
    let p = PathBuf::from(&path);
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&p)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .arg("--absolute-git-dir")
        .arg("--git-common-dir")
        .arg("--abbrev-ref")
        .arg("HEAD");
    no_console(&mut cmd);
    let output = cmd.output().map_err(|_| "git not found on PATH".to_string())?;
    let display = display_path(&p);

    let not_repo = || WorktreeInfo {
        path: display.clone(),
        is_repo: false,
        is_worktree: false,
        branch: None,
    };

    if !output.status.success() {
        return Ok(not_repo());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    if lines.next().map(str::trim) != Some("true") {
        return Ok(not_repo());
    }
    let git_dir = lines.next().unwrap_or("");
    let common_dir = lines.next().unwrap_or("");
    let branch_raw = lines.next().unwrap_or("").trim();

    let is_worktree = normalize_git_path(&p, git_dir) != normalize_git_path(&p, common_dir);
    let branch = if branch_raw.is_empty() || branch_raw == "HEAD" {
        None
    } else {
        Some(branch_raw.to_string())
    };

    Ok(WorktreeInfo {
        path: display,
        is_repo: true,
        is_worktree,
        branch,
    })
}

fn validate_branch(branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("branch name cannot be empty".to_string());
    }
    if branch.chars().any(char::is_whitespace) {
        return Err(format!("branch name cannot contain whitespace: {branch}"));
    }
    if branch.chars().any(|c| INVALID_BRANCH_CHARS.contains(&c)) {
        return Err(format!("branch name contains invalid characters: {branch}"));
    }
    Ok(())
}

fn run_git_worktree_add(repo: &Path, new_path: &Path, tail: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).arg("worktree").arg("add").arg(new_path);
    for a in tail {
        cmd.arg(a);
    }
    no_console(&mut cmd);
    cmd.output().map_err(|e| format!("failed to run git: {e}"))
}

/// Refuses when: `repo_path` is not a repo, `new_path` exists and is a
/// non-empty directory, `new_path` is inside `repo_path/.git`, or `branch` is
/// empty / whitespace / contains any of `~^:?*[\`. Runs `git worktree add
/// <new_path> -b <branch>`; on a stderr `already exists` (branch already
/// present) retries once without `-b`. Returns `worktree_check(new_path)`.
#[tauri::command]
pub fn worktree_add(repo_path: String, new_path: String, branch: String) -> Result<WorktreeInfo, String> {
    validate_branch(&branch)?;

    let repo = PathBuf::from(&repo_path);
    let check = worktree_check(repo_path.clone())?;
    if !check.is_repo {
        return Err(format!("{repo_path} is not a git repository"));
    }

    let new_p = PathBuf::from(&new_path);
    if new_p.is_dir() {
        let non_empty = fs::read_dir(&new_p)
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);
        if non_empty {
            return Err(format!("{new_path} already exists and is not empty"));
        }
    }

    let git_dir = repo.join(".git");
    if is_within(&new_p, &git_dir) {
        return Err(format!("{new_path} is inside the repository's .git directory"));
    }

    let first = run_git_worktree_add(&repo, &new_p, &["-b", branch.as_str()])?;
    if !first.status.success() {
        let tail = stderr_tail(&first.stderr);
        if tail.to_lowercase().contains("already exists") {
            let second = run_git_worktree_add(&repo, &new_p, &[branch.as_str()])?;
            if !second.status.success() {
                return Err(stderr_tail(&second.stderr));
            }
        } else {
            return Err(tail);
        }
    }

    worktree_check(new_path)
}
