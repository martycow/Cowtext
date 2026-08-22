//! Git backend (WO11 contract §4.1, extended by WO15 §3.1/§3.2): `git init`,
//! a `.gitignore` composer, and — only when the caller explicitly asks with
//! `commit: true` — one first commit. Still no remotes, no fetch/push, no
//! branch switching on an existing repo. Shells out to the system `git`
//! exactly as `worktree.rs` already does: `Command::new("git")`, `no_console`
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

// Second test-only seam, threaded exactly like [`GIT_BIN_OVERRIDE`] above
// (same `thread_local!` reasoning — a process-wide static would race every
// concurrently running sibling test): environment variables applied to
// every `git` child process this module spawns. Its only purpose is to let
// a test neutralize the developer's real global/system git config
// (`GIT_CONFIG_GLOBAL` at an empty temp file + `GIT_CONFIG_NOSYSTEM=1`), so
// the identity probes in [`probe_status`] and [`git_init`] can be exercised
// both ways on a machine that has a global `user.name`/`user.email` set.
// Always empty in non-test builds.
thread_local! {
    static GIT_ENV_OVERRIDE: std::cell::RefCell<Vec<(String, String)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) fn set_git_env_override(vars: &[(&str, &str)]) {
    GIT_ENV_OVERRIDE.with(|cell| {
        *cell.borrow_mut() = vars
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
    });
}

/// One `git -C <root> <args>` invocation with extra environment variables.
/// `Err` only when the binary itself cannot be spawned (not found on PATH) —
/// a non-zero exit is still `Ok` with a failing `ExitStatus`, for the caller
/// to inspect. `extra_env` is applied AFTER the test-only override, so a
/// call site's own hardening (`GIT_TERMINAL_PROMPT=0` on the commit) can
/// never be weakened by a test.
fn run_git_env(
    root: &Path,
    args: &[&str],
    extra_env: &[(&str, &str)],
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(git_bin());
    cmd.arg("-C").arg(root);
    for a in args {
        cmd.arg(a);
    }
    GIT_ENV_OVERRIDE.with(|cell| {
        for (k, v) in cell.borrow().iter() {
            cmd.env(k, v);
        }
    });
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    no_console(&mut cmd);
    cmd.output().map_err(|_| "git not found on PATH".to_string())
}

/// One `git -C <root> <args>` invocation. See [`run_git_env`].
fn run_git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    run_git_env(root, args, &[])
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
    /// `git -C <root> config --get user.name`, trimmed. `None` when unset,
    /// empty, or git is unavailable. Read in [`probe_status`]; never cached
    /// — the user may fix their identity in another window and retry
    /// (WO15 §3.1).
    pub identity_name: Option<String>,
    /// `git -C <root> config --get user.email`, same rules.
    pub identity_email: Option<String>,
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
        identity_name: None,
        identity_email: None,
    }
}

/// One `git config --get <key>` read, trimmed. `None` on a non-zero exit
/// (key unset), an unspawnable binary, or an empty value. Deliberately
/// `--get` on a single key rather than parsing `config --list`: it is the
/// same question `git commit` itself asks, and an empty-but-present value
/// (`user.name = ""`) is as unusable as an absent one, so both collapse to
/// `None`.
fn config_get(root: &Path, key: &str) -> Option<String> {
    run_git(root, &["config", "--get", key])
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|v| !v.is_empty())
}

/// `(user.name, user.email)`. Works in a non-repo too — `git -C <dir>
/// config --get` still resolves the global/system config from there.
fn read_identity(root: &Path) -> (Option<String>, Option<String>) {
    (
        config_get(root, "user.name"),
        config_get(root, "user.email"),
    )
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

    // After the version probe, before anything repo-shaped: a non-repo
    // still has an identity to report (it comes from the global config),
    // and the wizard's Git step shows the warning before Create — i.e.
    // exactly when `root` is not yet a repo (WO15 §3.1).
    let (identity_name, identity_email) = read_identity(root);

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
        identity_name,
        identity_email,
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

/// Lines Cowtext guarantees in `.gitignore` before the first commit
/// (WO15 Block 0, §3.2). Deliberately short: machine-local Claude Code
/// state, the personal-notes file Cowtext never compiles, and Cowtext's own
/// cache. Everything else about a project's `.gitignore` is the user's
/// business — `git_init` only ever ADDS these three.
pub(crate) const COWTEXT_GITIGNORE_LINES: [&str; 3] =
    [".claude/settings.local.json", "CLAUDE.local.md", ".cowtext/cache/"];
/// Header written above the appended block, so a later reader can see which
/// lines Cowtext added. Matches the marker the `.gitignore` composer in the
/// Git wizard already uses.
pub(crate) const COWTEXT_GITIGNORE_MARKER: &str = "# --- added by Cowtext ---";
/// Subject of the first commit `git_init(commit = true)` creates.
pub(crate) const INIT_COMMIT_MESSAGE: &str = "chore: init cowtext project";
/// Returned verbatim (A-4) when `commit` is requested and `user.name` or
/// `user.email` is unset — before any mutation, so the folder is left
/// exactly as it was found.
pub(crate) const GIT_IDENTITY_ERR: &str =
    "Git identity is not configured. Run: git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\" — then try again.";

/// Wire shape of `git_init`, mirrored 1:1 in `src/git/types.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitInitResult {
    pub status: GitStatus,
    /// This call created the initial commit.
    pub committed: bool,
    /// `git rev-list --count HEAD` after the call; 0 when unborn or not a repo.
    pub commit_count: u32,
    /// `root` was already a repo toplevel: nothing was initialised, written
    /// or committed, whatever `commit` said (D-15).
    pub skipped_existing_repo: bool,
}

/// `git rev-list --count HEAD`, or 0 when HEAD is unborn, `root` is not a
/// repo, or `git` cannot be spawned. Every failure is an answer ("no
/// commits"), never an error — the caller is on its way to an `Ok`.
fn count_commits(root: &Path) -> u32 {
    run_git(root, &["rev-list", "--count", "HEAD"])
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| {
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .parse::<u32>()
                .ok()
        })
        .unwrap_or(0)
}

/// Create-or-append the three [`COWTEXT_GITIGNORE_LINES`] under
/// [`COWTEXT_GITIGNORE_MARKER`] (WO15 §3.2 step 5a). Purely additive:
/// existing bytes are never modified or removed, so a project's own
/// `.gitignore` survives verbatim and a line the user later deletes on
/// purpose is only re-added if `git_init` runs again on a folder that is
/// still not a repo.
///
/// Line-ending policy is the FILE's, not ours: `\r\n` when the file already
/// contains one anywhere, `\n` otherwise — appending LF into a CRLF file
/// would leave a mixed-ending file that every diff tool flags. Membership is
/// a whole-line compare after trimming `\r` (a `\r`-terminated
/// `CLAUDE.local.md` counts as present), so the append is idempotent: the
/// second call finds all three and writes nothing.
///
/// The appended block starts with `<eol>` — that single character both
/// separates the block from whatever came before and satisfies "a file
/// lacking a trailing newline gets one before the marker".
fn ensure_gitignore_lines(root: &Path) -> Result<(), String> {
    let path = root.join(".gitignore");
    if !path.is_file() {
        let mut out = String::from(COWTEXT_GITIGNORE_MARKER);
        out.push('\n');
        for line in COWTEXT_GITIGNORE_LINES {
            out.push_str(line);
            out.push('\n');
        }
        return write_atomic(&path, &out);
    }

    let existing = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let present: Vec<&str> = existing.lines().map(|l| l.trim_end_matches('\r')).collect();
    let missing: Vec<&str> = COWTEXT_GITIGNORE_LINES
        .into_iter()
        .filter(|want| !present.iter().any(|line| line == want))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }

    let eol = if existing.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = existing;
    out.push_str(eol);
    out.push_str(COWTEXT_GITIGNORE_MARKER);
    out.push_str(eol);
    for line in missing {
        out.push_str(line);
        out.push_str(eol);
    }
    write_atomic(&path, &out)
}

/// True when `path` is something `git add` can actually record: a file (or a
/// symlink) in its own right, or a directory holding at least one
/// non-directory entry anywhere beneath it. An absent path — and an existing
/// but empty directory tree — is `false`.
///
/// This is the staging filter for [`git_init`]'s first commit (WO15 audit
/// F3). The plain `exists()` test it replaces handed `git add` pathspecs it
/// could not always match: `project_init` creates `context/` and `.cowtext/`
/// before anything lands in them, so a project whose `context/` is still an
/// empty folder used to pass that folder straight through to `git add`, one
/// `pathspec 'context' did not match any files` away from failing the whole
/// call *after* `init` and the `.gitignore` write had already run — leaving a
/// half-initialised folder whose retry then takes the D-15 skip path, so the
/// user could never get a first commit out of Cowtext at all.
///
/// Dropping such a path cannot change what the commit contains: git has no
/// representation for an empty directory, so a candidate with no file under
/// it would have contributed nothing to the tree either way. Everything under
/// a candidate that *does* hold a file is still staged by the directory
/// pathspec exactly as before — the recursion only answers yes/no, it never
/// enumerates what to stage.
///
/// Symlinks count as content (git records them as entries) and are never
/// followed — [`std::fs::DirEntry::file_type`] reports the link itself — so
/// the walk cannot loop, and it is iterative rather than recursive so a
/// pathological depth cannot blow the stack. Unreadable directories are
/// skipped rather than failing the probe: this is a "should we bother asking
/// git" question, and git remains the authority on the answer.
fn holds_stageable_content(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_dir() => return true,
        Ok(_) => {}
        Err(_) => return false,
    }
    let mut pending = vec![path.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => pending.push(entry.path()),
                Ok(_) => return true,
                Err(_) => {}
            }
        }
    }
    false
}

/// `git -C <root> init` plus, when `commit` is set, the first commit
/// (WO15 §3.2). `commit == false` reproduces the pre-WO15 behaviour
/// byte-for-byte — init and an optional default-branch choice, nothing else
/// — wrapped in the new [`GitInitResult`] envelope.
///
/// The steps run in exactly this order and nothing may be reordered:
/// validate → existing-repo skip (D-15) → identity check (A-4) → `init` +
/// `symbolic-ref` (D-12) → `.gitignore` → `add` → `commit`. The two guards
/// come first precisely so that a refusal leaves the folder untouched: a
/// half-initialised project plus an error message is worse than an
/// unchanged one.
///
/// `git_init` never creates `.cowtext/graph.json` (A-3) — the wizard always
/// runs `preset_apply` before calling this, and `preset_apply` is the single
/// writer of that file. Whatever of `[.gitignore, .cowtext, context]` holds
/// stageable content at call time is what gets staged — see
/// [`holds_stageable_content`].
///
/// Idempotent, and D1b-safe: calling it on an already-initialized
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
pub fn git_init(
    root: String,
    branch: Option<String>,
    commit: bool,
) -> Result<GitInitResult, String> {
    // 1. Validation, before anything can touch the filesystem.
    let root_path = checked_root(&root)?;
    if let Some(name) = branch.as_deref() {
        validate_branch(name)?;
    }

    // 2. Already a repo ⇒ nothing at all, whatever `commit` said (D-15).
    if is_repo_at(&root_path) {
        return Ok(GitInitResult {
            status: probe_status(&root_path),
            committed: false,
            commit_count: count_commits(&root_path),
            skipped_existing_repo: true,
        });
    }

    // 3. Identity, still before any mutation (A-4): a commit git would
    //    refuse must not leave a `.git` behind.
    if commit {
        let (name, email) = read_identity(&root_path);
        if name.is_none() || email.is_none() {
            return Err(GIT_IDENTITY_ERR.to_string());
        }
    }

    // 4. init + the branch choice (D-12: never `init -b`).
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

    // 5. The first commit.
    if commit {
        ensure_gitignore_lines(&root_path)?;

        // Only candidates that actually hold a file — `git add` can fail the
        // whole call on a pathspec that matches nothing, and an empty
        // directory contributes nothing to a commit anyway (F3; see
        // [`holds_stageable_content`]).
        let staged: Vec<&str> = [".gitignore", ".cowtext", "context"]
            .into_iter()
            .filter(|rel| holds_stageable_content(&root_path.join(rel)))
            .collect();
        if !staged.is_empty() {
            let mut args: Vec<&str> = vec!["add", "--"];
            args.extend_from_slice(&staged);
            let add = run_git(&root_path, &args)?;
            if !add.status.success() {
                return Err(stderr_tail(&add.stderr));
            }
        }

        // `-c commit.gpgsign=false`: a user with `commit.gpgsign = true`
        // globally would otherwise get a signing prompt (or a hard failure
        // on a headless box) from a commit they did not ask to sign.
        // `GIT_TERMINAL_PROMPT=0` guarantees the child can never block the
        // app waiting for terminal input there is no terminal to give.
        let committed = run_git_env(
            &root_path,
            &[
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                INIT_COMMIT_MESSAGE,
            ],
            &[("GIT_TERMINAL_PROMPT", "0")],
        )?;
        if !committed.status.success() {
            return Err(stderr_tail(&committed.stderr));
        }
    }

    Ok(GitInitResult {
        status: probe_status(&root_path),
        // Step 5 either ran to completion or returned `Err` above.
        committed: commit,
        commit_count: count_commits(&root_path),
        skipped_existing_repo: false,
    })
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
