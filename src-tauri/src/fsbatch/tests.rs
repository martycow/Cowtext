use super::*;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-fsbatch-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Every regular file under `root`, relative path → content, sorted. Used to
/// assert "tree is byte-identical" without hand-listing every path.
fn snapshot_tree(root: &Path) -> Vec<(String, String)> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, String)>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, out);
            } else if let Ok(content) = fs::read_to_string(&path) {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, content));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

// ── Acceptance (§12.1 rule 3) ──────────────────────────────────────────

#[test]
fn accepts_plain_md_and_cursor_mdc() {
    assert!(is_batch_acceptable("context/a.md"));
    assert!(is_batch_acceptable("CLAUDE.md"));
    assert!(is_batch_acceptable(".claude/commands/deploy.md"));
    assert!(is_batch_acceptable(".cursor/rules/foo.mdc"));
}

#[test]
fn rejects_non_md_non_mdc() {
    assert!(!is_batch_acceptable("notes.txt"));
    assert!(!is_batch_acceptable(".cursor/rules/foo.txt"));
    assert!(!is_batch_acceptable(".cursor/rules/sub/foo.mdc"));
}

#[test]
fn fs_apply_batch_rejects_non_md_entry() {
    let root = temp_project("reject-non-md");
    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry { rel_path: "notes.txt".into(), content: Some("x".into()) }],
    )
    .unwrap_err();
    assert!(err.contains("notes.txt"), "{err}");
    assert!(!root.join("notes.txt").exists());
}

// ── One-writer guard (§12.1 rule 2, F12) ───────────────────────────────

#[test]
fn rejects_claude_settings_json() {
    let root = temp_project("guard-settings");
    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry {
            rel_path: ".claude/settings.json".into(),
            content: Some("{}".into()),
        }],
    )
    .unwrap_err();
    assert!(err.contains(".claude/settings.json"), "{err}");
}

#[test]
fn rejects_claude_agents_md() {
    let root = temp_project("guard-agents");
    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry {
            rel_path: ".claude/agents/foo.md".into(),
            content: Some("---\nname: foo\n---\nbody".into()),
        }],
    )
    .unwrap_err();
    assert!(err.contains(".claude/agents/foo.md"), "{err}");
}

/// F12: `.claude/skills/foo/SKILL.md` ends in `.md`, so the plain suffix
/// test in rule 3 would otherwise admit it — this is the named test the
/// contract's §18.7 gate requires.
#[test]
fn rejects_claude_skills_skill_md() {
    let root = temp_project("guard-skills");
    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry {
            rel_path: ".claude/skills/foo/SKILL.md".into(),
            content: Some("# Foo".into()),
        }],
    )
    .unwrap_err();
    assert!(err.contains(".claude/skills/foo/SKILL.md"), "{err}");
    assert!(!root.join(".claude/skills/foo/SKILL.md").exists());
}

#[test]
fn accepts_claude_commands_md() {
    let root = temp_project("accept-commands");
    let inverse = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry {
            rel_path: ".claude/commands/deploy.md".into(),
            content: Some("---\ndescription: Deploy\n---\nbody\n".into()),
        }],
    )
    .unwrap();
    assert_eq!(inverse.len(), 1);
    assert_eq!(inverse[0].content, None); // didn't exist before
    assert!(root.join(".claude/commands/deploy.md").is_file());
}

// ── Duplicates ──────────────────────────────────────────────────────────

#[test]
fn rejects_duplicate_rel_path() {
    let root = temp_project("dup");
    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![
            BatchEntry { rel_path: "a.md".into(), content: Some("1".into()) },
            BatchEntry { rel_path: "a.md".into(), content: Some("2".into()) },
        ],
    )
    .unwrap_err();
    assert!(err.contains("a.md"), "{err}");
    assert!(!root.join("a.md").exists());
}

#[test]
fn rejects_duplicate_via_different_spelling() {
    let root = temp_project("dup-spelling");
    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![
            BatchEntry { rel_path: "./a.md".into(), content: Some("1".into()) },
            BatchEntry { rel_path: "a.md".into(), content: Some("2".into()) },
        ],
    )
    .unwrap_err();
    assert!(err.contains("a.md"), "{err}");
}

// ── Basic success + inverse batch ──────────────────────────────────────

#[test]
fn applies_and_returns_inverse_for_new_and_modified_files() {
    let root = temp_project("inverse-basic");
    fs::write(root.join("existing.md"), "old content\n").unwrap();

    let inverse = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![
            BatchEntry { rel_path: "new.md".into(), content: Some("new content\n".into()) },
            BatchEntry {
                rel_path: "existing.md".into(),
                content: Some("changed content\n".into()),
            },
        ],
    )
    .unwrap();

    assert!(root.join("new.md").exists());
    assert_eq!(fs::read_to_string(root.join("new.md")).unwrap(), "new content\n");
    assert_eq!(fs::read_to_string(root.join("existing.md")).unwrap(), "changed content\n");

    // Inverse: new.md's prior state is "absent" (None), existing.md's is the
    // old content, in the SAME order as the entries.
    assert_eq!(inverse.len(), 2);
    assert_eq!(inverse[0].rel_path, "new.md");
    assert_eq!(inverse[0].content, None);
    assert_eq!(inverse[1].rel_path, "existing.md");
    assert_eq!(inverse[1].content.as_deref(), Some("old content\n"));

    // Applying the inverse restores the tree byte-identically.
    let before = vec![("existing.md".to_string(), "old content\n".to_string())];
    fs_apply_batch(root.to_string_lossy().into_owned(), inverse).unwrap();
    assert!(!root.join("new.md").exists());
    assert_eq!(snapshot_tree(&root), before);
}

#[test]
fn delete_of_nonexistent_file_is_a_noop_not_an_error() {
    let root = temp_project("delete-noop");
    let inverse = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry { rel_path: "ghost.md".into(), content: None }],
    )
    .unwrap();
    assert_eq!(inverse.len(), 1);
    assert_eq!(inverse[0].content, None);
    assert!(!root.join("ghost.md").exists());
}

#[test]
fn delete_of_existing_file_returns_its_prior_content_as_inverse() {
    let root = temp_project("delete-existing");
    fs::write(root.join("gone.md"), "will be deleted\n").unwrap();
    let inverse = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![BatchEntry { rel_path: "gone.md".into(), content: None }],
    )
    .unwrap();
    assert!(!root.join("gone.md").exists());
    assert_eq!(inverse[0].content.as_deref(), Some("will be deleted\n"));

    // Undo: applying the inverse recreates it.
    fs_apply_batch(root.to_string_lossy().into_owned(), inverse).unwrap();
    assert_eq!(fs::read_to_string(root.join("gone.md")).unwrap(), "will be deleted\n");
}

// ── Mid-batch failure: all-or-nothing (§12.1 rules 5-6, §18.7) ─────────

/// The second entry's parent path component already exists as a plain FILE
/// (not a directory), so `write_atomic`'s `create_dir_all` fails
/// deterministically on every OS — no reliance on permission bits, which
/// behave differently on Windows vs. Unix. Mirrors the contract's own
/// "second entry's parent made read-only" scenario without the
/// platform-specific mechanism.
#[test]
fn mid_batch_failure_leaves_tree_byte_unchanged_and_names_the_failing_path() {
    let root = temp_project("mid-batch-fail");
    fs::write(root.join("blocker"), "original blocker content").unwrap();
    let before = snapshot_tree(&root);

    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![
            BatchEntry { rel_path: "a.md".into(), content: Some("new-a".into()) },
            BatchEntry { rel_path: "blocker/x.md".into(), content: Some("new-x".into()) },
        ],
    )
    .unwrap_err();

    assert!(err.contains("blocker/x.md"), "{err}");
    assert!(!root.join("a.md").exists(), "a.md must be rolled back");
    assert_eq!(snapshot_tree(&root), before, "tree must be byte-unchanged after rollback");
}

#[test]
fn mid_batch_failure_restores_a_modified_file_to_its_prior_content() {
    let root = temp_project("mid-batch-restore-modified");
    fs::write(root.join("keep.md"), "original\n").unwrap();
    fs::write(root.join("blocker"), "x").unwrap();
    let before = snapshot_tree(&root);

    let err = fs_apply_batch(
        root.to_string_lossy().into_owned(),
        vec![
            BatchEntry { rel_path: "keep.md".into(), content: Some("modified\n".into()) },
            BatchEntry { rel_path: "blocker/x.md".into(), content: Some("new-x".into()) },
        ],
    )
    .unwrap_err();

    assert!(err.contains("blocker/x.md"), "{err}");
    assert_eq!(fs::read_to_string(root.join("keep.md")).unwrap(), "original\n");
    assert_eq!(snapshot_tree(&root), before);
}
