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

/// Writes a standalone git config file and points every `git` child this
/// thread spawns at it (WO15 §3.2): `GIT_CONFIG_GLOBAL` replaces BOTH
/// `~/.gitconfig` and the XDG file, `GIT_CONFIG_NOSYSTEM=1` drops the
/// system one. Without this the identity tests would pass or fail
/// depending on whether the machine running them happens to have a global
/// `user.name` — on the dev box it does, in a clean container it does not.
/// Thread-local (see [`set_git_env_override`]), so it cannot leak into a
/// sibling test running at the same time.
fn use_isolated_git_config(dir: &Path, body: &str) {
    let cfg = dir.join("isolated.gitconfig");
    fs::write(&cfg, body).unwrap();
    set_git_env_override(&[
        ("GIT_CONFIG_GLOBAL", &cfg.to_string_lossy()),
        ("GIT_CONFIG_NOSYSTEM", "1"),
    ]);
}

/// The identity-carrying counterpart of [`use_isolated_git_config`]: a
/// hermetic config that DOES set a name and email, so `git_init(commit)`
/// can be exercised end-to-end without borrowing the developer's identity.
fn use_isolated_git_config_with_identity(dir: &Path) {
    use_isolated_git_config(
        dir,
        "[user]\n\tname = Cowtext Test\n\temail = test@cowtext.invalid\n",
    );
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

/// WO13 fix (a): `probe_status`'s `is_repo` used to walk upward via a plain
/// `--is-inside-work-tree` check, so a project folder nested under an
/// unrelated outer repo misreported as "already a repo" — even though it
/// has no `.git` of its own. `is_repo_at`'s `--show-toplevel` comparison
/// must tell the two apart.
#[test]
fn git_status_reports_not_a_repo_for_a_dir_merely_nested_inside_an_outer_repo() {
    let root = temp_dir("statusnestedouter");
    let outer = root.join("outer");
    init_repo_with_commit(&outer);
    let nested = outer.join("nested-project");
    fs::create_dir_all(&nested).unwrap();

    let status = git_status(nested.to_string_lossy().into_owned()).unwrap();
    assert!(
        !status.is_repo,
        "a folder nested inside an outer repo is not itself a repo until it gets its own .git"
    );
    assert!(!nested.join(".git").exists());
}

/// WO13 fix (b): a freshly-initialized, commitless repo has an unborn
/// HEAD — `probe_status`'s branch lookup must still name it, not report
/// `None` until the first commit.
#[test]
fn git_status_on_commitless_repo_still_reports_the_unborn_branch_name() {
    let root = temp_dir("statuscommitless");
    let repo = root.join("repo");
    fs::create_dir_all(&repo).unwrap();
    assert!(git(&repo, &["init", "-q"]).status.success());
    assert!(git(&repo, &["symbolic-ref", "HEAD", "refs/heads/trunk"]).status.success());

    let status = git_status(repo.to_string_lossy().into_owned()).unwrap();
    assert!(status.is_repo);
    assert!(!status.has_commits);
    assert_eq!(status.branch.as_deref(), Some("trunk"));
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
    // WO15 §3.1: `not_available()` reports no identity either — the probe
    // that would have read it is the very binary that could not be spawned.
    assert_eq!(status.identity_name, None);
    assert_eq!(status.identity_email, None);
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

    let result = git_init(dir.to_string_lossy().into_owned(), None, false);

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

    let result = git_init(dir.to_string_lossy().into_owned(), None, false).unwrap();
    assert!(result.status.is_repo);
    assert!(
        !result.status.has_commits,
        "init alone must not create a commit"
    );
    assert!(!result.committed);
    assert_eq!(result.commit_count, 0);
    assert!(!result.skipped_existing_repo);
    assert!(dir.join(".git").is_dir());
    assert!(
        !dir.join(".gitignore").exists(),
        "commit=false must not write .gitignore"
    );
}

#[test]
fn git_init_on_an_already_initialized_repo_is_a_no_op() {
    let root = temp_dir("initexisting");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);

    let result = git_init(repo.to_string_lossy().into_owned(), None, false).unwrap();
    assert!(result.status.is_repo);
    assert!(
        result.status.has_commits,
        "re-running init must not touch existing history"
    );
    assert!(result.skipped_existing_repo);
    assert_eq!(result.commit_count, 1);
}

/// WO13 fix (a): a project folder nested under an unrelated outer repo must
/// get its OWN `.git` and the branch the user actually chose — not be
/// silently swallowed into a no-op because the outer repo's toplevel was
/// mistaken for `root`'s own. The outer repo's HEAD must stay untouched.
#[test]
fn git_init_inside_an_outer_repo_creates_its_own_nested_repo_with_the_chosen_branch() {
    let root = temp_dir("initnestedouter");
    let outer = root.join("outer");
    init_repo_with_commit(&outer);
    let outer_branch_before = {
        let out = git(&outer, &["symbolic-ref", "--short", "HEAD"]);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };

    let nested = outer.join("nested-project");
    fs::create_dir_all(&nested).unwrap();

    let result = git_init(
        nested.to_string_lossy().into_owned(),
        Some("feature-x".to_string()),
        false,
    )
    .unwrap();
    assert!(
        result.status.is_repo,
        "the nested dir must get its own repo, not report the outer one"
    );
    assert!(!result.skipped_existing_repo);
    assert!(nested.join(".git").is_dir(), "git init must actually run at the nested path");
    assert_eq!(result.status.branch.as_deref(), Some("feature-x"));

    let out = git(&outer, &["symbolic-ref", "--short", "HEAD"]);
    let outer_branch_after = String::from_utf8_lossy(&out.stdout).trim().to_string();
    assert_eq!(outer_branch_after, outer_branch_before, "the outer repo's own HEAD must be untouched");
}

#[test]
fn git_init_rejects_a_non_directory_root() {
    let root = temp_dir("initbadroot");
    let missing = root.join("does-not-exist");
    let err = git_init(missing.to_string_lossy().into_owned(), None, false).unwrap_err();
    assert!(err.contains("Not a directory"), "{err}");
}

/// D1b: an explicit branch choice is honoured on a fresh directory — the
/// two-step `init` + `symbolic-ref HEAD refs/heads/<name>` must actually
/// move HEAD before the first commit exists. Verified via a direct
/// `git symbolic-ref --short HEAD` call (the acceptance criterion's own
/// wording: "`git branch --show-current` after init matches the choice"),
/// AND via `status.branch` — WO13 fixed `probe_status` to use
/// `symbolic-ref --short HEAD` itself (the same unborn-HEAD failure mode
/// D8 fixed in `worktree.rs`), so the two must now agree.
#[test]
fn git_init_with_explicit_branch_name_sets_head_to_that_branch() {
    let dir = temp_dir("initbranchmain");
    let status = git_init(dir.to_string_lossy().into_owned(), Some("main".to_string()), false)
        .unwrap()
        .status;
    assert!(status.is_repo);
    assert_eq!(status.branch.as_deref(), Some("main"), "WO13: unborn branch must be visible in GitStatus too");

    let out = git(&dir, &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "main");
}

#[test]
fn git_init_with_explicit_master_branch_name_sets_head_to_that_branch() {
    let dir = temp_dir("initbranchmaster");
    let status = git_init(
        dir.to_string_lossy().into_owned(),
        Some("master".to_string()),
        false,
    )
    .unwrap()
    .status;
    assert!(status.is_repo);

    let out = git(&dir, &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "master");
}

/// D1b: `branch: None` must reproduce the pre-amendment behaviour
/// byte-for-byte — bare `git init`, no `symbolic-ref` call at all, whatever
/// name git itself would have chosen.
#[test]
fn git_init_with_none_branch_reproduces_todays_behaviour() {
    let dir = temp_dir("initnobranch");
    let status = git_init(dir.to_string_lossy().into_owned(), None, false)
        .unwrap()
        .status;
    assert!(status.is_repo);
    assert!(dir.join(".git").is_dir());
}

/// D1b: the name is validated BEFORE any filesystem mutation — an invalid
/// branch name must never leave a `.git` directory behind.
#[test]
fn git_init_rejects_invalid_branch_name_before_any_fs_mutation() {
    let dir = temp_dir("initbadbranch");
    let err = git_init(
        dir.to_string_lossy().into_owned(),
        Some("bad branch".to_string()),
        false,
    )
    .unwrap_err();
    assert!(err.contains("whitespace"), "{err}");
    assert!(!dir.join(".git").exists(), "no repo should have been created");
}

#[test]
fn git_init_rejects_invalid_branch_name_with_leading_dash_before_any_fs_mutation() {
    let dir = temp_dir("initbadbranchdash");
    let err = git_init(
        dir.to_string_lossy().into_owned(),
        Some("-weird".to_string()),
        false,
    )
    .unwrap_err();
    assert!(!dir.join(".git").exists(), "no repo should have been created");
    assert!(err.contains('-'), "{err}");
}

/// D1b: re-initializing an existing repo with a branch argument must NOT
/// move HEAD — the wizard re-running `git init` on a project you already
/// initialized (and possibly already committed to and switched branches on)
/// must never silently relocate it.
#[test]
fn git_init_on_existing_repo_does_not_move_head_even_with_a_branch_argument() {
    let root = temp_dir("initexistingbranch");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let out = git(&repo, &["symbolic-ref", "--short", "HEAD"]);
    let original_branch = String::from_utf8_lossy(&out.stdout).trim().to_string();

    let result = git_init(
        repo.to_string_lossy().into_owned(),
        Some("some-other-branch".to_string()),
        false,
    )
    .unwrap();
    assert_eq!(
        result.status.branch.as_deref(),
        Some(original_branch.as_str())
    );
    assert!(
        result.status.has_commits,
        "existing history must be untouched"
    );
    assert!(result.skipped_existing_repo);
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

// ── WO15 §3.1: identity fields ──────────────────────────────────────

/// Contract §3.2: these tests need a real `git`. On a box without one they
/// print a line and return — `cargo test` has no native "skipped" state for
/// a `#[test]` that has already begun running.
fn require_git() -> bool {
    match StdCommand::new("git").arg("--version").output() {
        Ok(out) if out.status.success() => true,
        _ => {
            eprintln!("SKIP: git is not on PATH");
            false
        }
    }
}

#[test]
fn git_status_reports_the_configured_identity() {
    if !require_git() {
        return;
    }
    let root = temp_dir("identityset");
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    use_isolated_git_config_with_identity(&root);

    let status = git_status(proj.to_string_lossy().into_owned()).unwrap();
    set_git_env_override(&[]);

    assert_eq!(status.identity_name.as_deref(), Some("Cowtext Test"));
    assert_eq!(status.identity_email.as_deref(), Some("test@cowtext.invalid"));
    assert!(
        !status.is_repo,
        "identity is readable from a plain folder too — the wizard shows the \
         warning BEFORE the repo exists"
    );
}

#[test]
fn git_status_reports_no_identity_under_an_empty_config() {
    if !require_git() {
        return;
    }
    let root = temp_dir("identityunset");
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    use_isolated_git_config(&root, "");

    let status = git_status(proj.to_string_lossy().into_owned()).unwrap();
    set_git_env_override(&[]);

    assert!(status.git_available, "git itself is still perfectly available");
    assert_eq!(status.identity_name, None);
    assert_eq!(status.identity_email, None);
}

// ── WO15 §3.2: git_init(commit) ─────────────────────────────────────

#[test]
fn init_with_commit_creates_exactly_one_commit_containing_gitignore_and_graph() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initcommitone");
    let proj = root.join("proj");
    fs::create_dir_all(proj.join(".cowtext")).unwrap();
    fs::create_dir_all(proj.join("context")).unwrap();
    fs::write(
        proj.join(".cowtext").join("graph.json"),
        "{\"version\":5,\"nodes\":[],\"edges\":[]}\n",
    )
    .unwrap();
    fs::write(proj.join("context").join("project.md"), "# Project\n").unwrap();
    use_isolated_git_config_with_identity(&root);

    let result = git_init(
        proj.to_string_lossy().into_owned(),
        Some("main".to_string()),
        true,
    )
    .unwrap();
    set_git_env_override(&[]);

    assert!(result.committed);
    assert_eq!(result.commit_count, 1);
    assert!(!result.skipped_existing_repo);
    assert!(result.status.has_commits);
    assert_eq!(result.status.branch.as_deref(), Some("main"));

    let shown =
        String::from_utf8_lossy(&git(&proj, &["show", "--name-only", "--format=", "HEAD"]).stdout)
            .into_owned();
    for expected in [".gitignore", ".cowtext/graph.json", "context/project.md"] {
        assert!(shown.contains(expected), "{expected} missing from: {shown}");
    }

    // Block 0 acceptance, in the criterion's own commands.
    let branch = git(&proj, &["branch", "--show-current"]);
    assert_eq!(String::from_utf8_lossy(&branch.stdout).trim(), "main");
    let log = git(&proj, &["log", "--oneline"]);
    assert_eq!(String::from_utf8_lossy(&log.stdout).lines().count(), 1);
    let subject = git(&proj, &["log", "-1", "--format=%s"]);
    assert_eq!(
        String::from_utf8_lossy(&subject.stdout).trim(),
        INIT_COMMIT_MESSAGE
    );
}

/// A-3: `preset_apply` is the single writer of `.cowtext/graph.json`.
/// `git_init` stages whatever of the three paths happens to exist and
/// creates none of them beyond `.gitignore` itself.
#[test]
fn init_with_commit_never_creates_graph_json_and_stages_only_what_exists() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initnograph");
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    use_isolated_git_config_with_identity(&root);

    let result = git_init(proj.to_string_lossy().into_owned(), None, true).unwrap();
    set_git_env_override(&[]);

    assert!(result.committed);
    assert_eq!(result.commit_count, 1);
    assert!(
        !proj.join(".cowtext").exists(),
        "A-3: git_init must never create .cowtext/graph.json"
    );

    let shown =
        String::from_utf8_lossy(&git(&proj, &["show", "--name-only", "--format=", "HEAD"]).stdout)
            .into_owned();
    let files: Vec<&str> = shown.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(files, vec![".gitignore"]);
}

/// WO15 audit F3: `project_init` creates `context/` and `.cowtext/` before
/// anything lands in them, so the first commit has to survive a project whose
/// `context/` is still an empty folder. The old `exists()` staging filter
/// handed that folder to `git add` as a pathspec; the commit must succeed
/// either way, with `.gitignore` as its only content.
#[test]
fn init_with_commit_tolerates_an_empty_context_dir() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initcommitemptyctx");
    let proj = root.join("proj");
    fs::create_dir_all(proj.join("context")).unwrap();
    fs::create_dir_all(proj.join(".cowtext")).unwrap();
    use_isolated_git_config_with_identity(&root);

    let result = git_init(
        proj.to_string_lossy().into_owned(),
        Some("main".to_string()),
        true,
    )
    .unwrap();
    set_git_env_override(&[]);

    assert!(result.committed, "an empty context/ must not block the commit");
    assert_eq!(result.commit_count, 1);
    assert!(result.status.has_commits);
    assert_eq!(result.status.branch.as_deref(), Some("main"));

    let log = git(&proj, &["log", "--oneline"]);
    assert_eq!(String::from_utf8_lossy(&log.stdout).lines().count(), 1);
    let shown =
        String::from_utf8_lossy(&git(&proj, &["show", "--name-only", "--format=", "HEAD"]).stdout)
            .into_owned();
    let files: Vec<&str> = shown.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(
        files,
        vec![".gitignore"],
        "git records no empty directory, so the commit holds .gitignore alone"
    );
    // The empty folders are still on disk — the staging filter reads, never
    // writes.
    assert!(proj.join("context").is_dir());
    assert!(proj.join(".cowtext").is_dir());
}

/// The mixed case is unchanged: a populated candidate is staged in full
/// (including files nested below it), an empty one is simply skipped. Nested
/// empty directories inside a populated tree change nothing either — the
/// probe answers yes/no, it never enumerates what to stage.
#[test]
fn init_with_commit_stages_populated_candidates_and_skips_empty_ones() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initcommitmixed");
    let proj = root.join("proj");
    fs::create_dir_all(proj.join("context").join("nested")).unwrap();
    fs::create_dir_all(proj.join("context").join("hollow")).unwrap();
    fs::create_dir_all(proj.join(".cowtext")).unwrap(); // stays empty
    fs::write(proj.join("context").join("project.md"), "# Project\n").unwrap();
    fs::write(
        proj.join("context").join("nested").join("deep.md"),
        "# Deep\n",
    )
    .unwrap();
    use_isolated_git_config_with_identity(&root);

    let result = git_init(proj.to_string_lossy().into_owned(), None, true).unwrap();
    set_git_env_override(&[]);

    assert!(result.committed);
    assert_eq!(result.commit_count, 1);

    let shown =
        String::from_utf8_lossy(&git(&proj, &["show", "--name-only", "--format=", "HEAD"]).stdout)
            .into_owned();
    let mut files: Vec<&str> = shown.lines().filter(|l| !l.trim().is_empty()).collect();
    files.sort_unstable();
    assert_eq!(
        files,
        vec![".gitignore", "context/nested/deep.md", "context/project.md"]
    );
}

/// A-4: the identity check runs before ANY mutation — the folder is left
/// exactly as it was found, so the user can fix `git config` and retry into
/// a clean directory rather than a half-initialised one.
#[test]
fn init_with_commit_and_missing_identity_errs_before_init() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initcommitnoident");
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    use_isolated_git_config(&root, "");

    let err = git_init(
        proj.to_string_lossy().into_owned(),
        Some("main".to_string()),
        true,
    )
    .unwrap_err();
    set_git_env_override(&[]);

    assert_eq!(err, GIT_IDENTITY_ERR);
    assert!(!proj.join(".git").exists(), "no repo may be created");
    assert!(!proj.join(".gitignore").exists(), "no file may be written");
}

/// Both halves are required: a name without an email fails just as hard,
/// because `git commit` would refuse it just as hard.
#[test]
fn init_with_commit_errs_when_only_the_email_is_missing() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initcommithalfident");
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    use_isolated_git_config(&root, "[user]\n\tname = Only A Name\n");

    let err = git_init(proj.to_string_lossy().into_owned(), None, true).unwrap_err();
    set_git_env_override(&[]);

    assert_eq!(err, GIT_IDENTITY_ERR);
    assert!(!proj.join(".git").exists());
}

/// The identity requirement is gated on `commit`: plain init never needed
/// one and still does not.
#[test]
fn init_without_commit_needs_no_identity() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initnocommitnoident");
    let proj = root.join("proj");
    fs::create_dir_all(&proj).unwrap();
    use_isolated_git_config(&root, "");

    let result = git_init(
        proj.to_string_lossy().into_owned(),
        Some("main".to_string()),
        false,
    )
    .unwrap();
    set_git_env_override(&[]);

    assert!(result.status.is_repo);
    assert!(!result.committed);
    assert_eq!(result.commit_count, 0);
}

/// D-15: an existing repo is never re-initialised, never committed into,
/// and its `.gitignore` is never rewritten — whatever `commit` said.
#[test]
fn init_on_existing_repo_skips_everything() {
    if !require_git() {
        return;
    }
    let root = temp_dir("initskipexisting");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);
    let gitignore = repo.join(".gitignore");
    fs::write(&gitignore, "handwritten\r\n").unwrap();
    let before = fs::read(&gitignore).unwrap();
    use_isolated_git_config_with_identity(&root);

    let result = git_init(
        repo.to_string_lossy().into_owned(),
        Some("some-other-branch".to_string()),
        true,
    )
    .unwrap();
    set_git_env_override(&[]);

    assert!(result.skipped_existing_repo);
    assert!(!result.committed);
    assert_eq!(
        result.commit_count, 1,
        "the repo's own commit, not one this call made"
    );
    assert_eq!(
        fs::read(&gitignore).unwrap(),
        before,
        ".gitignore must be untouched byte-for-byte"
    );
    let log = git(&repo, &["log", "--oneline"]);
    assert_eq!(String::from_utf8_lossy(&log.stdout).lines().count(), 1);
}

#[test]
fn branch_master_and_custom_names_survive_init() {
    if !require_git() {
        return;
    }
    let root = temp_dir("branchnames");
    use_isolated_git_config_with_identity(&root);

    for name in ["master", "feat/x"] {
        let proj = root.join(name.replace('/', "-"));
        fs::create_dir_all(&proj).unwrap();

        let result = git_init(
            proj.to_string_lossy().into_owned(),
            Some(name.to_string()),
            true,
        )
        .unwrap();

        assert!(result.committed, "{name}");
        assert_eq!(result.commit_count, 1, "{name}");
        assert_eq!(
            result.status.branch.as_deref(),
            Some(name),
            "{name} must survive the first commit"
        );
        let out = git(&proj, &["symbolic-ref", "--short", "HEAD"]);
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), name);
    }
    set_git_env_override(&[]);
}

/// A-7 regression (BUGS.md line 35): `probe_status` must name the unborn
/// branch `git_init` just chose, before any commit exists.
#[test]
fn probe_status_reports_unborn_branch_after_init() {
    if !require_git() {
        return;
    }
    let dir = temp_dir("unbornafterinit");
    let result = git_init(
        dir.to_string_lossy().into_owned(),
        Some("main".to_string()),
        false,
    )
    .unwrap();
    assert_eq!(result.status.branch.as_deref(), Some("main"));
    assert!(!result.status.has_commits);

    // ...and a fresh, independent probe agrees.
    let status = git_status(dir.to_string_lossy().into_owned()).unwrap();
    assert!(status.is_repo);
    assert!(!status.has_commits);
    assert_eq!(status.branch.as_deref(), Some("main"));
}

// ── WO15 §3.2 step 5a: ensure_gitignore_lines ───────────────────────
//
// Exercised at the helper level, not through `git_init`: the second
// `git_init` call on the same folder takes the D-15 skip path, so
// idempotency is not observable from outside. No `git` needed either.

#[test]
fn gitignore_is_created_with_the_marker_and_all_three_lines_when_absent() {
    let dir = temp_dir("gicreatelines");
    ensure_gitignore_lines(&dir).unwrap();

    assert_eq!(
        fs::read_to_string(dir.join(".gitignore")).unwrap(),
        "# --- added by Cowtext ---\n.claude/settings.local.json\nCLAUDE.local.md\n.cowtext/cache/\n"
    );
}

#[test]
fn gitignore_append_is_crlf_safe_and_idempotent() {
    let dir = temp_dir("giappendcrlf");
    let path = dir.join(".gitignore");
    // A CRLF file that already carries one of the three lines.
    fs::write(&path, "node_modules/\r\nCLAUDE.local.md\r\n").unwrap();

    ensure_gitignore_lines(&dir).unwrap();
    let first = fs::read_to_string(&path).unwrap();

    assert_eq!(
        first,
        "node_modules/\r\nCLAUDE.local.md\r\n\r\n# --- added by Cowtext ---\r\n\
         .claude/settings.local.json\r\n.cowtext/cache/\r\n"
    );
    assert!(
        first.starts_with("node_modules/\r\nCLAUDE.local.md\r\n"),
        "existing bytes are never modified or removed"
    );
    assert_eq!(
        first.matches('\n').count(),
        first.matches("\r\n").count(),
        "no bare LF may be introduced into a CRLF file"
    );
    assert_eq!(
        first.matches(COWTEXT_GITIGNORE_MARKER).count(),
        1,
        "the marker is appended once"
    );

    // Second call: all three lines are present, so nothing is written.
    ensure_gitignore_lines(&dir).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), first);
}

#[test]
fn gitignore_append_keeps_lf_and_adds_the_missing_trailing_newline() {
    let dir = temp_dir("giappendlf");
    let path = dir.join(".gitignore");
    fs::write(&path, "dist/").unwrap(); // no trailing newline at all

    ensure_gitignore_lines(&dir).unwrap();

    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "dist/\n# --- added by Cowtext ---\n.claude/settings.local.json\nCLAUDE.local.md\n.cowtext/cache/\n"
    );
}

#[test]
fn gitignore_append_is_a_no_op_when_all_three_lines_are_present() {
    let dir = temp_dir("giappendpresent");
    let path = dir.join(".gitignore");
    // Order is irrelevant, and a `\r`-terminated line still counts.
    let original = "# mine\n.cowtext/cache/\r\nCLAUDE.local.md\n.claude/settings.local.json\n";
    fs::write(&path, original).unwrap();

    ensure_gitignore_lines(&dir).unwrap();

    let after = fs::read_to_string(&path).unwrap();
    assert_eq!(after, original, "not one byte may change");
    assert!(!after.contains(COWTEXT_GITIGNORE_MARKER));
}

// ── holds_stageable_content (pure helper, no git needed) ────────────

#[test]
fn holds_stageable_content_answers_by_content_not_by_existence() {
    let dir = temp_dir("stageablecontent");

    // Absent: nothing to stage.
    assert!(!holds_stageable_content(&dir.join("does-not-exist")));

    // A file is stageable in its own right.
    let file = dir.join(".gitignore");
    fs::write(&file, "x\n").unwrap();
    assert!(holds_stageable_content(&file));

    // An existing but empty directory is not — this is F3's case, the one
    // `exists()` used to wave through to `git add`.
    let empty = dir.join("context");
    fs::create_dir_all(&empty).unwrap();
    assert!(!holds_stageable_content(&empty));

    // ...and neither is a tree of nothing but empty directories, however deep
    // (the probe is recursive, not one level).
    fs::create_dir_all(empty.join("a").join("b").join("c")).unwrap();
    assert!(!holds_stageable_content(&empty));

    // One file anywhere beneath it flips the answer.
    fs::write(empty.join("a").join("b").join("c").join("deep.md"), "# d\n").unwrap();
    assert!(holds_stageable_content(&empty));

    // An empty file still counts: git records it as an entry.
    let hollow = dir.join(".cowtext");
    fs::create_dir_all(&hollow).unwrap();
    fs::write(hollow.join("empty.json"), "").unwrap();
    assert!(holds_stageable_content(&hollow));
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
