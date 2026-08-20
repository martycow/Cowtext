use super::*;
use std::process::Command as StdCommand;

// ── Helpers ───────────────────────────────────────────────────────────

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-git-{tag}-{}", std::process::id()));
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

// ── git_status ───────────────────────────────────────────────────────

#[test]
fn git_status_on_non_repo_reports_not_a_repo_not_an_error() {
    let dir = temp_dir("nonrepo");
    let status = git_status(dir.to_string_lossy().into_owned()).expect("must not Err");
    assert!(status.git_available, "git must be on PATH for this dev/test environment");
    assert!(!status.is_repo);
    assert!(!status.has_commits);
    assert_eq!(status.branch, None);
    assert!(!status.gitignore_exists);
    assert_eq!(status.gitignore_content, None);
}

#[test]
fn git_status_on_repo_with_commits_reports_branch_and_has_commits() {
    let root = temp_dir("withcommits");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);

    let status = git_status(repo.to_string_lossy().into_owned()).unwrap();
    assert!(status.is_repo);
    assert!(status.has_commits);
    assert!(status.branch.is_some(), "expected a branch name after a commit");
}

#[test]
fn git_status_on_bare_init_with_no_commits_reports_no_commits() {
    let root = temp_dir("bareinit");
    let repo = root.join("repo");
    fs::create_dir_all(&repo).unwrap();
    assert!(git(&repo, &["init", "-q"]).status.success());

    let status = git_status(repo.to_string_lossy().into_owned()).unwrap();
    assert!(status.is_repo);
    assert!(!status.has_commits, "a freshly-initialized repo has no HEAD yet");
}

#[test]
fn git_status_rejects_a_non_directory_root() {
    let root = temp_dir("badroot");
    let missing = root.join("does-not-exist");
    let err = git_status(missing.to_string_lossy().into_owned()).unwrap_err();
    assert!(err.contains("Not a directory"), "{err}");
}

#[test]
fn git_status_reports_gitignore_presence_and_content_verbatim() {
    let root = temp_dir("giignore");
    fs::write(root.join(".gitignore"), "node_modules/\ntarget/\n").unwrap();

    let status = git_status(root.to_string_lossy().into_owned()).unwrap();
    assert!(status.gitignore_exists);
    assert_eq!(status.gitignore_content.as_deref(), Some("node_modules/\ntarget/\n"));
}

/// Contract §7 R1: with `git` absent from PATH, `git_status` must return
/// `gitAvailable: false`, never `Err`, never a panic. `worktree.rs` has no
/// PATH-scrubbing test of its own to mirror byte-for-byte, so this uses the
/// mocked seam described at [`set_git_bin_override`] instead of mutating
/// the real process-wide `PATH` (shared, unsafely, by every test in this
/// binary if touched directly).
#[test]
fn git_status_with_git_missing_from_path_reports_unavailable_not_err() {
    let dir = temp_dir("gitmissing");
    let bogus = format!("cowtext-no-such-git-{}", std::process::id());
    set_git_bin_override(Some(&bogus));

    let result = git_status(dir.to_string_lossy().into_owned());

    set_git_bin_override(None);

    let status = result.expect("git_status must return Ok even when git is missing");
    assert!(!status.git_available);
    assert_eq!(status.git_version, None);
    assert!(!status.is_repo);
    assert!(!status.has_commits);
    assert_eq!(status.branch, None);
}

/// Same seam, targeted at `git_init`: unlike `git_status`, `git_init` DOES
/// need a real git to do its job, so "missing" is allowed to surface as a
/// genuine `Err` here (contract §4.1 only promises `git_status` never
/// errors on this).
#[test]
fn git_init_with_git_missing_from_path_errors_cleanly() {
    let dir = temp_dir("gitinitmissing");
    let bogus = format!("cowtext-no-such-git-{}", std::process::id());
    set_git_bin_override(Some(&bogus));

    let result = git_init(dir.to_string_lossy().into_owned());

    set_git_bin_override(None);

    let err = result.unwrap_err();
    assert!(err.contains("not found on PATH"), "{err}");
}

// ── git_init ─────────────────────────────────────────────────────────

#[test]
fn git_init_on_a_clean_directory_creates_a_repo() {
    let dir = temp_dir("initclean");
    let before = git_status(dir.to_string_lossy().into_owned()).unwrap();
    assert!(!before.is_repo);

    let status = git_init(dir.to_string_lossy().into_owned()).unwrap();
    assert!(status.is_repo);
    assert!(!status.has_commits, "init alone must not create a commit");
    assert!(dir.join(".git").is_dir());
}

#[test]
fn git_init_on_an_already_initialized_repo_is_a_no_op() {
    let root = temp_dir("initexisting");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);

    let status = git_init(repo.to_string_lossy().into_owned()).unwrap();
    assert!(status.is_repo);
    assert!(status.has_commits, "re-running init must not touch existing history");
}

#[test]
fn git_init_rejects_a_non_directory_root() {
    let root = temp_dir("initbadroot");
    let missing = root.join("does-not-exist");
    let err = git_init(missing.to_string_lossy().into_owned()).unwrap_err();
    assert!(err.contains("Not a directory"), "{err}");
}

// ── gitignore_write ──────────────────────────────────────────────────

#[test]
fn gitignore_write_creates_when_absent() {
    let dir = temp_dir("giwritecreate");
    gitignore_write(dir.to_string_lossy().into_owned(), "node_modules/\n".to_string()).unwrap();

    let on_disk = fs::read_to_string(dir.join(".gitignore")).unwrap();
    assert_eq!(on_disk, "node_modules/\n");
}

#[test]
fn gitignore_write_overwrites_existing_content_with_exactly_what_it_is_given() {
    // The Rust command is not a merge primitive — the UI composes the
    // merged text (existing content + preset blocks) client-side and
    // passes the full result; `gitignore_write` just writes it verbatim.
    let dir = temp_dir("giwriteoverwrite");
    fs::write(dir.join(".gitignore"), "old-line\n").unwrap();

    let merged = "old-line\n\n# --- added by Cowtext ---\nnode_modules/\n";
    gitignore_write(dir.to_string_lossy().into_owned(), merged.to_string()).unwrap();

    let on_disk = fs::read_to_string(dir.join(".gitignore")).unwrap();
    assert_eq!(on_disk, merged);
}

#[test]
fn gitignore_write_is_atomic_and_byte_identical_on_repeat() {
    let dir = temp_dir("giwriteidempotent");
    let content = "*.log\ndist/\n";
    gitignore_write(dir.to_string_lossy().into_owned(), content.to_string()).unwrap();
    let first = fs::read(dir.join(".gitignore")).unwrap();
    gitignore_write(dir.to_string_lossy().into_owned(), content.to_string()).unwrap();
    let second = fs::read(dir.join(".gitignore")).unwrap();
    assert_eq!(first, second);
}

#[test]
fn gitignore_write_normalizes_crlf_to_lf_with_one_trailing_newline() {
    let dir = temp_dir("giwritecrlf");
    gitignore_write(
        dir.to_string_lossy().into_owned(),
        "node_modules/\r\ntarget/\r\n\r\n".to_string(),
    )
    .unwrap();

    let on_disk = fs::read_to_string(dir.join(".gitignore")).unwrap();
    assert_eq!(on_disk, "node_modules/\ntarget/\n");
    assert!(!on_disk.contains('\r'));
}

#[test]
fn gitignore_write_normalizes_bare_cr_and_collapses_trailing_blank_lines() {
    let dir = temp_dir("giwritebarecr");
    gitignore_write(dir.to_string_lossy().into_owned(), "a\rb\n\n\n".to_string()).unwrap();

    let on_disk = fs::read_to_string(dir.join(".gitignore")).unwrap();
    assert_eq!(on_disk, "a\nb\n");
}

#[test]
fn gitignore_write_on_empty_content_writes_an_empty_file() {
    let dir = temp_dir("giwriteempty");
    gitignore_write(dir.to_string_lossy().into_owned(), String::new()).unwrap();
    let on_disk = fs::read_to_string(dir.join(".gitignore")).unwrap();
    assert_eq!(on_disk, "");
}

#[test]
fn gitignore_write_path_is_server_derived_only_root_gitignore_is_ever_touched() {
    // No `path` argument exists on this command at all — `content` is the
    // only variable, so nothing the caller sends can redirect the write.
    // This test asserts the destination stays exactly `<root>/.gitignore`
    // even when the content itself looks path-like.
    let dir = temp_dir("giwritetraversal");
    let sneaky_looking_content = "../../etc/passwd\n..\\..\\Windows\\System32\n";
    gitignore_write(dir.to_string_lossy().into_owned(), sneaky_looking_content.to_string())
        .unwrap();

    assert!(dir.join(".gitignore").is_file());
    // Nothing was created outside the temp dir as a side effect of the
    // path-like *content* — the only file written is the literal
    // `<root>/.gitignore`.
    let entries: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
    assert_eq!(entries.len(), 1, "exactly one file should exist under root");
    assert_eq!(entries[0].file_name().to_string_lossy(), ".gitignore");
}

#[test]
fn gitignore_write_rejects_a_non_directory_root() {
    let root = temp_dir("giwritebadroot");
    let missing = root.join("does-not-exist");
    let err = gitignore_write(missing.to_string_lossy().into_owned(), "x\n".to_string()).unwrap_err();
    assert!(err.contains("Not a directory"), "{err}");
}

// ── normalize_gitignore (pure helper) ───────────────────────────────

#[test]
fn normalize_gitignore_covers_edge_cases() {
    assert_eq!(normalize_gitignore(""), "");
    assert_eq!(normalize_gitignore("\n\n\n"), "");
    assert_eq!(normalize_gitignore("a"), "a\n");
    assert_eq!(normalize_gitignore("a\n"), "a\n");
    assert_eq!(normalize_gitignore("a\n\n\n"), "a\n");
    assert_eq!(normalize_gitignore("a\r\nb\r\n"), "a\nb\n");
    assert_eq!(normalize_gitignore("a\rb"), "a\nb\n");
}
