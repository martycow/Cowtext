use super::*;
use std::process::Command as StdCommand;

// ── Helpers ───────────────────────────────────────────────────────────

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-worktree-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn git(dir: &Path, args: &[&str]) -> std::process::Output {
    StdCommand::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git must be on PATH for these tests")
}

fn init_repo_with_commit(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    assert!(git(dir, &["init", "-q"]).status.success());
    assert!(git(dir, &["config", "user.email", "test@example.com"]).status.success());
    assert!(git(dir, &["config", "user.name", "Test"]).status.success());
    fs::write(dir.join("f.txt"), "hi\n").unwrap();
    assert!(git(dir, &["add", "f.txt"]).status.success());
    assert!(git(dir, &["commit", "-q", "-m", "init"]).status.success());
}

// ── worktree_check ───────────────────────────────────────────────────

#[test]
fn worktree_check_non_repo() {
    let dir = temp_dir("nonrepo");
    let info = worktree_check(dir.to_string_lossy().into_owned()).expect("git on PATH");
    assert!(!info.is_repo);
    assert!(!info.is_worktree);
    assert_eq!(info.branch, None);
}

#[test]
fn worktree_check_main_working_copy() {
    let root = temp_dir("main");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);

    let info = worktree_check(repo.to_string_lossy().into_owned()).unwrap();
    assert!(info.is_repo);
    assert!(!info.is_worktree);
    assert!(info.branch.is_some(), "expected a branch name on the main working copy");
}

/// D8: a repository with zero commits has an unborn HEAD. The old composite
/// `rev-parse ... --abbrev-ref HEAD` call misreported this as "not a git
/// repository" — exactly the state Cowtext's own `git_init` leaves behind
/// (it deliberately makes no first commit).
#[test]
fn worktree_check_bare_init_no_commits_reports_repo_with_branch_and_no_worktree() {
    let root = temp_dir("bareinit");
    let repo = root.join("repo");
    fs::create_dir_all(&repo).unwrap();
    assert!(git(&repo, &["init", "-q"]).status.success());

    let info = worktree_check(repo.to_string_lossy().into_owned()).unwrap();
    assert!(
        info.is_repo,
        "a freshly `git init`ed repo with no commits must still read as a repo (D8)"
    );
    assert!(!info.is_worktree);
    assert!(
        matches!(info.branch.as_deref(), Some("master") | Some("main")),
        "expected an unborn-HEAD branch name, got {:?}",
        info.branch
    );
}

/// D8's second bug: `symbolic-ref --short HEAD` also fails on a genuine
/// detached HEAD on the main working copy (not just a linked worktree) —
/// that must clear `branch` without clearing `is_repo`.
#[test]
fn worktree_check_detached_head_on_main_working_copy_reports_no_branch() {
    let root = temp_dir("detachedmain");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let out = git(&repo, &["checkout", "--detach", "HEAD", "-q"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

    let info = worktree_check(repo.to_string_lossy().into_owned()).unwrap();
    assert!(info.is_repo);
    assert!(!info.is_worktree);
    assert_eq!(info.branch, None);
}

/// A genuine non-repo (never `git init`ed at all) must still read as
/// `is_repo: false` — the D8 fix must not turn every folder into a repo.
#[test]
fn worktree_check_genuine_non_repo_reports_not_a_repo() {
    let dir = temp_dir("genuinenonrepo");
    let info = worktree_check(dir.to_string_lossy().into_owned()).unwrap();
    assert!(!info.is_repo);
    assert!(!info.is_worktree);
    assert_eq!(info.branch, None);
}

#[test]
fn worktree_check_linked_worktree_and_detached() {
    let root = temp_dir("linked");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let linked = root.join("linked");
    let out = git(&repo, &["worktree", "add", &linked.to_string_lossy(), "-b", "feature-x"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

    let info = worktree_check(linked.to_string_lossy().into_owned()).unwrap();
    assert!(info.is_repo);
    assert!(info.is_worktree, "linked worktree must report is_worktree=true");
    assert_eq!(info.branch.as_deref(), Some("feature-x"));

    let out = git(&linked, &["checkout", "--detach", "HEAD", "-q"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

    let info2 = worktree_check(linked.to_string_lossy().into_owned()).unwrap();
    assert!(info2.is_repo);
    assert!(info2.is_worktree);
    assert_eq!(info2.branch, None, "detached HEAD must report branch=None");
}

// ── worktree_add validation (contract §4.1) ─────────────────────────

#[test]
fn validate_branch_rejects_empty_whitespace_and_bad_chars() {
    assert!(validate_branch("").is_err());
    assert!(validate_branch("   ").is_err());
    assert!(validate_branch("has space").is_err());
    assert!(validate_branch("weird~name").is_err());
    assert!(validate_branch("weird^name").is_err());
    assert!(validate_branch("weird:name").is_err());
    assert!(validate_branch("weird?name").is_err());
    assert!(validate_branch("weird*name").is_err());
    assert!(validate_branch("weird[name").is_err());
    assert!(validate_branch("weird\\name").is_err());
    assert!(validate_branch("ok-name").is_ok());
}

/// D1b: three checks `worktree_add`'s original rule set didn't cover, added
/// to `validate_branch` so `git_init`'s branch argument shares the exact
/// same rule set `worktree_add` already covers.
#[test]
fn validate_branch_rejects_leading_dash_dotdot_and_lock_suffix() {
    assert!(validate_branch("-weird").is_err());
    assert!(validate_branch("weird..name").is_err());
    assert!(validate_branch("weird.lock").is_err());
    assert!(validate_branch("weird.lock.txt").is_ok(), "only a *trailing* .lock is rejected");
    assert!(validate_branch("ok-name").is_ok());
}

#[test]
fn worktree_add_rejects_non_repo() {
    let dir = temp_dir("addnonrepo");
    let new_path = dir.join("new");
    let err = worktree_add(
        dir.to_string_lossy().into_owned(),
        new_path.to_string_lossy().into_owned(),
        "feature".to_string(),
    )
    .unwrap_err();
    assert!(err.contains("not a git repository"), "{err}");
}

#[test]
fn worktree_add_rejects_nonempty_existing_dir() {
    let root = temp_dir("addexisting");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let new_path = root.join("occupied");
    fs::create_dir_all(&new_path).unwrap();
    fs::write(new_path.join("x.txt"), "x").unwrap();

    let err = worktree_add(
        repo.to_string_lossy().into_owned(),
        new_path.to_string_lossy().into_owned(),
        "feature".to_string(),
    )
    .unwrap_err();
    assert!(err.contains("not empty"), "{err}");
}

#[test]
fn worktree_add_rejects_path_inside_git_dir() {
    let root = temp_dir("addinsidegit");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let inside = repo.join(".git").join("nested");

    let err = worktree_add(
        repo.to_string_lossy().into_owned(),
        inside.to_string_lossy().into_owned(),
        "feature".to_string(),
    )
    .unwrap_err();
    assert!(err.contains(".git directory"), "{err}");
}

#[test]
fn worktree_add_rejects_bad_branch_before_touching_disk() {
    let root = temp_dir("addbadbranch");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let new_path = root.join("wt");

    let err = worktree_add(
        repo.to_string_lossy().into_owned(),
        new_path.to_string_lossy().into_owned(),
        "bad branch".to_string(),
    )
    .unwrap_err();
    assert!(err.contains("whitespace"), "{err}");
    assert!(!new_path.exists());
}

#[test]
fn worktree_add_happy_path_and_retry_without_b() {
    let root = temp_dir("addretry");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    // Branch already exists (not yet checked out anywhere): the first
    // `-b existing-branch` attempt must fail with "already exists" and the
    // retry without `-b` must succeed.
    assert!(git(&repo, &["branch", "existing-branch"]).status.success());

    let new_path = root.join("wt");
    let info = worktree_add(
        repo.to_string_lossy().into_owned(),
        new_path.to_string_lossy().into_owned(),
        "existing-branch".to_string(),
    )
    .expect("worktree_add should succeed via the bare-branch retry");

    assert!(info.is_repo);
    assert!(info.is_worktree);
    assert_eq!(info.branch.as_deref(), Some("existing-branch"));
}

// ── Small pure helpers ───────────────────────────────────────────────

#[test]
fn is_within_covers_nested_and_sibling_paths() {
    let ancestor = Path::new("/repo/.git");
    assert!(is_within(Path::new("/repo/.git"), ancestor));
    assert!(is_within(Path::new("/repo/.git/worktrees/x"), ancestor));
    assert!(!is_within(Path::new("/repo/.gitignore"), ancestor));
    assert!(!is_within(Path::new("/repo/other"), ancestor));
}

#[test]
fn normalize_git_path_ignores_slash_style() {
    let base = Path::new("C:/repo");
    let a = normalize_git_path(base, "C:/repo/.git");
    let b = normalize_git_path(base, "C:\\repo\\.git");
    assert_eq!(a, b);
}

#[test]
fn normalize_git_path_resolves_a_relative_common_dir_against_base() {
    // `--git-common-dir` prints a bare relative `.git` for the main working
    // copy while `--absolute-git-dir` is always absolute — the exact
    // mismatch that made every main working copy misreport as a worktree.
    let base = Path::new("C:/repo");
    let absolute = normalize_git_path(base, "C:/repo/.git");
    let relative = normalize_git_path(base, ".git");
    assert_eq!(absolute, relative);
}
