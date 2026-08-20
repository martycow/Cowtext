use super::*;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-agents-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

// ---- 1. validate_component -------------------------------------------------

#[test]
fn validate_component_rejects_bad_names() {
    let long_name = "a".repeat(101);
    for bad in ["..", "a/b", "a\\b", "", &long_name, "CON:"] {
        assert!(validate_component(bad).is_err(), "should have rejected {bad:?}");
    }
    assert!(validate_component("tech-lead").is_ok());
    assert!(validate_component(&"a".repeat(100)).is_ok());
}

// ---- 2. agents_scan on a project with no .claude/ --------------------------

#[test]
fn scan_on_project_with_no_claude_dir_is_empty() {
    let dir = temp_project("no-claude");
    let scan = agents_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert!(scan.agents.is_empty());
    assert!(scan.skills.is_empty());
    assert!(scan.skipped.is_empty());
    assert!(scan.meta_json.is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn scan_rejects_bad_root_only() {
    assert!(agents_scan("Z:/definitely/not/a/dir".into()).is_err());
}

// ---- 3. agents_scan tolerates a bad-frontmatter file -----------------------

#[test]
fn scan_returns_bad_frontmatter_as_raw_never_an_err() {
    let dir = temp_project("bad-fm");
    let agents = agents_dir(&dir);
    fs::create_dir_all(&agents).unwrap();
    fs::write(agents.join("broken.md"), "---\nname: x\n").unwrap(); // unterminated
    let scan = agents_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(scan.agents.len(), 1);
    assert!(scan.agents[0].raw);
    assert!(scan.agents[0].parse_error.is_some());
    let _ = fs::remove_dir_all(&dir);
}

// ---- 4. agents_scan fills SkillDoc.extraFiles/extraFileCount --------------

#[test]
fn scan_fills_extra_files_for_skill_dir_with_side_files() {
    let dir = temp_project("skill-extras");
    let skill = skills_dir(&dir).join("demo-skill");
    fs::create_dir_all(skill.join("assets")).unwrap();
    fs::write(skill.join("SKILL.md"), skill_template("demo-skill")).unwrap();
    fs::write(skill.join("notes.txt"), "hi").unwrap();
    fs::write(skill.join("assets/icon.svg"), "<svg/>").unwrap();

    let scan = agents_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(scan.skills.len(), 1);
    let s = &scan.skills[0];
    assert_eq!(s.extra_file_count, 2);
    assert_eq!(s.extra_files, vec!["assets/icon.svg".to_string(), "notes.txt".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn scan_skips_skill_dir_without_skill_md() {
    let dir = temp_project("skill-no-md");
    let skill = skills_dir(&dir).join("incomplete");
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("readme.txt"), "hi").unwrap();

    let scan = agents_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert!(scan.skills.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

// ---- 5. agent_create twice with the same name ------------------------------

#[test]
fn agent_create_twice_second_is_err_first_unchanged() {
    let dir = temp_project("create-twice");
    let root = dir.to_string_lossy().into_owned();
    let first = agent_create(root.clone(), "My Agent".to_string(), None).unwrap();
    assert_eq!(first.file_name, "my-agent.md");

    let err = agent_create(root, "My Agent".to_string(), None).unwrap_err();
    assert!(err.contains("already exists"));

    let on_disk = fs::read_to_string(agents_dir(&dir).join("my-agent.md")).unwrap();
    assert_eq!(on_disk, first.content);
    let _ = fs::remove_dir_all(&dir);
}

// ---- 6. agent_rename onto an existing name ---------------------------------

#[test]
fn agent_rename_onto_existing_name_errs_both_files_present() {
    let dir = temp_project("rename-collide");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Alpha".to_string(), None).unwrap();
    agent_create(root.clone(), "Beta".to_string(), None).unwrap();

    let err = agent_rename(root, "alpha.md".to_string(), "Beta".to_string()).unwrap_err();
    assert!(err.contains("already exists"));
    assert!(agents_dir(&dir).join("alpha.md").is_file());
    assert!(agents_dir(&dir).join("beta.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

// ---- 7. agent_rename patches the name: line --------------------------------

#[test]
fn agent_rename_patches_name_line_of_moved_file() {
    let dir = temp_project("rename-patch");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Old Name".to_string(), None).unwrap();

    let new_name = agent_rename(root, "old-name.md".to_string(), "New Name".to_string()).unwrap();
    assert_eq!(new_name, "new-name.md");
    assert!(!agents_dir(&dir).join("old-name.md").exists());

    let content = fs::read_to_string(agents_dir(&dir).join("new-name.md")).unwrap();
    let doc = frontmatter::parse(&content);
    assert_eq!(doc.fields().name.as_deref(), Some("new-name"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_rename_skips_patch_silently_on_raw_doc() {
    let dir = temp_project("rename-raw");
    let root = dir.to_string_lossy().into_owned();
    let agents = agents_dir(&dir);
    fs::create_dir_all(&agents).unwrap();
    fs::write(agents.join("weird.md"), "---\nname: weird\n").unwrap(); // unterminated -> raw

    let new_name = agent_rename(root, "weird.md".to_string(), "Still Weird".to_string()).unwrap();
    assert_eq!(new_name, "still-weird.md");
    // Rename succeeded even though the frontmatter patch was skipped.
    assert!(agents.join("still-weird.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

// ---- 8. agent_save: both fields+raw_content -> Err; neither -> no-op ------

#[test]
fn agent_save_ambiguous_and_noop() {
    let dir = temp_project("save-ambiguous");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Save Me".to_string(), None).unwrap();

    let err = agent_save(
        root.clone(),
        created.file_name.clone(),
        Some(FmFields::default()),
        None,
        Some("raw".to_string()),
    )
    .unwrap_err();
    assert_eq!(err, "Ambiguous save: raw content and fields");

    agent_save(root, created.file_name.clone(), None, None, None).unwrap();
    let on_disk = fs::read_to_string(agents_dir(&dir).join(&created.file_name)).unwrap();
    assert_eq!(on_disk, created.content, "no-op save leaves the file byte-identical");
    let _ = fs::remove_dir_all(&dir);
}

// ---- 9. agent_save on a missing file ---------------------------------------

#[test]
fn agent_save_on_missing_file_errs_nothing_created() {
    let dir = temp_project("save-missing");
    let root = dir.to_string_lossy().into_owned();
    let err = agent_save(
        root,
        "nope.md".to_string(),
        Some(FmFields::default()),
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(err, "No such agent: nope.md");
    assert!(!agents_dir(&dir).join("nope.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

// ---- 10. skill_delete removes the dir; agent_delete missing -> Err --------

#[test]
fn skill_delete_removes_directory_agent_delete_missing_errs() {
    let dir = temp_project("delete");
    let root = dir.to_string_lossy().into_owned();
    let skill = skill_create(root.clone(), "Doomed".to_string()).unwrap();
    fs::write(skills_dir(&dir).join(&skill.dir_name).join("extra.txt"), "x").unwrap();

    skill_delete(root.clone(), skill.dir_name.clone()).unwrap();
    assert!(!skills_dir(&dir).join(&skill.dir_name).exists());

    let err = agent_delete(root, "missing.md".to_string()).unwrap_err();
    assert_eq!(err, "No such agent: missing.md");
    let _ = fs::remove_dir_all(&dir);
}

// ---- 11. agents_meta_write validation --------------------------------------

#[test]
fn agents_meta_write_validates_json_shape() {
    let dir = temp_project("meta");
    let root = dir.to_string_lossy().into_owned();
    for bad in ["[]", "\"x\"", "{}", "{\"version\":\"1\"}"] {
        let err = agents_meta_write(root.clone(), bad.to_string()).unwrap_err();
        assert_eq!(err, "Refusing to write invalid agents.json");
    }
    assert!(!dir.join(".cowtext/agents.json").exists());

    agents_meta_write(root.clone(), "{\"version\":1,\"agents\":{}}".to_string()).unwrap();
    let on_disk = fs::read_to_string(dir.join(".cowtext/agents.json")).unwrap();
    assert_eq!(on_disk, "{\"version\":1,\"agents\":{}}");
    let _ = fs::remove_dir_all(&dir);
}

// ---- 12. write_md_file rejects .claude/settings.json -----------------------
// (the same guard is exercised directly in project::tests; repeated here
// because the contract lists it under the agents-module test set too.)

#[test]
fn write_md_file_rejects_settings_json_variants() {
    let dir = temp_project("settings-guard");
    let root = dir.to_string_lossy().into_owned();
    for bad in [".claude/settings.json", ".CLAUDE/Settings.JSON", ".claude\\settings.json"] {
        let err =
            crate::project::write_md_file(root.clone(), bad.to_string(), "{}".to_string())
                .unwrap_err();
        assert_eq!(err, "Use Install hooks to edit .claude/settings.json");
    }
    let _ = fs::remove_dir_all(&dir);
}

// WO11 §12.3 item 4 (Amendment 3): agent_save's save queue is the only
// sanctioned writer for `.claude/agents/*.md` — `write_md_file` (the
// Markdown tab's old, uncoordinated path) must reject it, from the agents
// module's own vantage point too (the settings-json variant test above has
// covered `write_md_file` from here since WO02; this is its WO11 sibling).
#[test]
fn write_md_file_rejects_agent_paths_variants() {
    let dir = temp_project("agent-path-guard");
    let root = dir.to_string_lossy().into_owned();
    for bad in [".claude/agents/x.md", ".claude\\agents\\x.md", ".CLAUDE/AGENTS/X.MD"] {
        let err =
            crate::project::write_md_file(root.clone(), bad.to_string(), "# hi".to_string())
                .unwrap_err();
        assert_eq!(err, "Use agent_save to write an agent file");
    }
    let _ = fs::remove_dir_all(&dir);
}

// ---- Additional coverage ----------------------------------------------------

#[test]
fn skill_rename_patches_name_and_refuses_collision() {
    let dir = temp_project("skill-rename");
    let root = dir.to_string_lossy().into_owned();
    skill_create(root.clone(), "Alpha Skill".to_string()).unwrap();
    skill_create(root.clone(), "Beta Skill".to_string()).unwrap();

    let err = skill_rename(root.clone(), "alpha-skill".to_string(), "Beta Skill".to_string())
        .unwrap_err();
    assert!(err.contains("already exists"));

    let new_name =
        skill_rename(root, "alpha-skill".to_string(), "Gamma Skill".to_string()).unwrap();
    assert_eq!(new_name, "gamma-skill");
    let content = fs::read_to_string(skills_dir(&dir).join("gamma-skill/SKILL.md")).unwrap();
    assert_eq!(frontmatter::parse(&content).fields().name.as_deref(), Some("gamma-skill"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_save_fields_and_body_round_trip() {
    let dir = temp_project("save-fields");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Field Test".to_string(), None).unwrap();

    let mut fields = created.fields.clone();
    fields.description = Some("A new description.".to_string());
    agent_save(
        root.clone(),
        created.file_name.clone(),
        Some(fields),
        Some("# Field Test\n\nRewritten body.\n".to_string()),
        None,
    )
    .unwrap();

    let content = fs::read_to_string(agents_dir(&dir).join(&created.file_name)).unwrap();
    let doc = frontmatter::parse(&content);
    assert_eq!(doc.fields().description.as_deref(), Some("A new description."));
    assert_eq!(doc.body, "# Field Test\n\nRewritten body.\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_rename_to_identical_name_is_a_harmless_noop() {
    let dir = temp_project("rename-same-name");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Same".to_string(), None).unwrap();

    let new_name = agent_rename(root, "same.md".to_string(), "Same".to_string()).unwrap();
    assert_eq!(new_name, "same.md");
    assert!(agents_dir(&dir).join("same.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

// Windows' NTFS is case-insensitive but case-preserving: `dest.exists()`
// alone can't distinguish "this is the file being renamed, only its casing
// changed" from "a different file already sits there". `slugify` always
// lowercases, so this is the *only* way to fix an externally created
// mixed-case agent/skill file's casing from inside the app.
#[cfg(windows)]
#[test]
fn agent_rename_case_only_fixes_casing_without_self_collision() {
    let dir = temp_project("rename-case-only");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Foo".to_string(), None).unwrap();
    let agents = agents_dir(&dir);
    // Simulate an externally created mixed-case file (agent_create's own
    // slug is always lowercase, so we force the casing directly on disk).
    fs::rename(agents.join("foo.md"), agents.join("Foo.md")).unwrap();

    let new_name = agent_rename(root, "Foo.md".to_string(), "Foo".to_string()).unwrap();
    assert_eq!(new_name, "foo.md");
    let on_disk_name = fs::read_dir(&agents)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .find(|n| n.eq_ignore_ascii_case("foo.md"))
        .unwrap();
    assert_eq!(on_disk_name, "foo.md", "casing must actually be fixed on disk");
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(windows)]
#[test]
fn skill_rename_case_only_fixes_casing_without_self_collision() {
    let dir = temp_project("skill-rename-case-only");
    let root = dir.to_string_lossy().into_owned();
    skill_create(root.clone(), "Bar".to_string()).unwrap();
    let skills = skills_dir(&dir);
    fs::rename(skills.join("bar"), skills.join("Bar")).unwrap();

    let new_name = skill_rename(root, "Bar".to_string(), "Bar".to_string()).unwrap();
    assert_eq!(new_name, "bar");
    let on_disk_name = fs::read_dir(&skills)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .find(|n| n.eq_ignore_ascii_case("bar"))
        .unwrap();
    assert_eq!(on_disk_name, "bar", "casing must actually be fixed on disk");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn validate_md_component_requires_md_suffix_and_stem() {
    assert!(validate_md_component("agent.md").is_ok());
    assert!(validate_md_component("agent").is_err());
    assert!(validate_md_component(".md").is_err());
}

// ---- agent_convert -----------------------------------------------------

#[test]
fn agent_convert_without_frontmatter_prepends_template() {
    let dir = temp_project("convert-plain");
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join("context")).unwrap();
    fs::write(dir.join("context/notes.md"), "# Notes\n\nSome body text.\n").unwrap();

    let doc = agent_convert(root.clone(), "context/notes.md".to_string(), "My Notes".to_string())
        .unwrap();
    assert_eq!(doc.file_name, "my-notes.md");
    assert_eq!(
        doc.content,
        "---\nname: My Notes\ndescription: \n---\n\n# Notes\n\nSome body text.\n"
    );
    assert_eq!(doc.fields.name.as_deref(), Some("My Notes"));
    assert!(!dir.join("context/notes.md").exists(), "source must be removed");
    assert!(agents_dir(&dir).join("my-notes.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_convert_with_frontmatter_preserves_other_keys() {
    let dir = temp_project("convert-fm");
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join("context")).unwrap();
    fs::write(
        dir.join("context/rules.md"),
        "---\nname: old-name\ndescription: existing description\nmodel: opus\n---\n\nBody.\n",
    )
    .unwrap();

    let doc =
        agent_convert(root, "context/rules.md".to_string(), "New Rules".to_string()).unwrap();
    assert_eq!(doc.file_name, "new-rules.md");
    assert_eq!(doc.fields.name.as_deref(), Some("New Rules"));
    // Everything else on the frontmatter survives untouched.
    assert_eq!(doc.fields.description.as_deref(), Some("existing description"));
    assert_eq!(doc.fields.model.as_deref(), Some("opus"));
    assert_eq!(doc.body, "\nBody.\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_convert_refuses_destination_collision_source_untouched() {
    let dir = temp_project("convert-collide");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Existing".to_string(), None).unwrap();
    fs::create_dir_all(dir.join("context")).unwrap();
    fs::write(dir.join("context/dup.md"), "dup body\n").unwrap();

    let err =
        agent_convert(root, "context/dup.md".to_string(), "Existing".to_string()).unwrap_err();
    assert!(err.contains("already exists"));
    assert!(dir.join("context/dup.md").is_file(), "source must survive a refused convert");
    assert_eq!(
        fs::read_to_string(dir.join("context/dup.md")).unwrap(),
        "dup body\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_convert_refuses_a_source_already_under_claude() {
    let dir = temp_project("convert-claude-source");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Already Agent".to_string(), None).unwrap();

    let err = agent_convert(
        root,
        ".claude/agents/already-agent.md".to_string(),
        "Renamed".to_string(),
    )
    .unwrap_err();
    assert!(err.contains(".claude/"));
    assert!(agents_dir(&dir).join("already-agent.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_convert_rejects_non_markdown_and_missing_source() {
    let dir = temp_project("convert-bad-source");
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("notes.txt"), "not markdown").unwrap();

    assert!(agent_convert(root.clone(), "notes.txt".to_string(), "X".to_string()).is_err());
    assert!(agent_convert(root, "missing.md".to_string(), "X".to_string()).is_err());
    let _ = fs::remove_dir_all(&dir);
}

// ---- Producer guards (TASKBOARD_BATCH_CONTRACT.md §4) ----------------------

#[test]
fn agent_create_producer_is_still_allowed() {
    let dir = temp_project("producer-create");
    let root = dir.to_string_lossy().into_owned();
    let doc = agent_create(root, "Producer".to_string(), None).unwrap();
    assert_eq!(doc.file_name, "producer.md");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_rename_rejects_producer_as_source() {
    let dir = temp_project("producer-rename-src");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Producer".to_string(), None).unwrap();

    let err = agent_rename(root, "producer.md".to_string(), "Renamed".to_string()).unwrap_err();
    assert_eq!(err, "Reserved agent: producer");
    assert!(agents_dir(&dir).join("producer.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_rename_rejects_producer_as_destination() {
    let dir = temp_project("producer-rename-dest");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Some Other Agent".to_string(), None).unwrap();

    let err = agent_rename(root, "some-other-agent.md".to_string(), "Producer".to_string())
        .unwrap_err();
    assert_eq!(err, "Reserved agent: producer");
    assert!(agents_dir(&dir).join("some-other-agent.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_delete_rejects_producer() {
    let dir = temp_project("producer-delete");
    let root = dir.to_string_lossy().into_owned();
    agent_create(root.clone(), "Producer".to_string(), None).unwrap();

    let err = agent_delete(root, "producer.md".to_string()).unwrap_err();
    assert_eq!(err, "Reserved agent: producer");
    assert!(agents_dir(&dir).join("producer.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_convert_rejects_producer_destination() {
    let dir = temp_project("producer-convert");
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("legacy.md"), "Some legacy persona notes").unwrap();

    let err = agent_convert(root, "legacy.md".to_string(), "Producer".to_string()).unwrap_err();
    assert_eq!(err, "Reserved agent: producer");
    assert!(dir.join("legacy.md").is_file());
    assert!(!agents_dir(&dir).join("producer.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

// ---- agent_create with explicit file_name (WO02 §2.2) ----------------------

#[test]
fn agent_create_with_explicit_file_name_uses_it_verbatim() {
    let dir = temp_project("create-explicit-name");
    let root = dir.to_string_lossy().into_owned();

    let doc = agent_create(
        root,
        "Display Name".to_string(),
        Some("custom-file.md".to_string()),
    )
    .unwrap();

    assert_eq!(doc.file_name, "custom-file.md");
    assert!(agents_dir(&dir).join("custom-file.md").is_file());
    // Frontmatter `name:` is always slugify(name), independent of the file name.
    assert_eq!(doc.fields.name.as_deref(), Some("display-name"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_create_none_file_name_is_byte_identical_to_today() {
    let dir = temp_project("create-none-name");
    let root = dir.to_string_lossy().into_owned();

    let doc = agent_create(root, "Plain Agent".to_string(), None).unwrap();

    assert_eq!(doc.file_name, "plain-agent.md");
    assert_eq!(doc.fields.name.as_deref(), Some("plain-agent"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_create_rejects_invalid_explicit_file_name() {
    let dir = temp_project("create-bad-explicit-name");
    let root = dir.to_string_lossy().into_owned();

    let err = agent_create(root, "Bad".to_string(), Some("no-extension".to_string()))
        .unwrap_err();
    assert!(err.contains(".md"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_create_trims_explicit_file_name_to_match_memory_stem() {
    // Regression: an untrimmed explicit fileName (valid per
    // validate_md_component, which validates s.trim()) must not produce a
    // file whose stem disagrees with what agent_memory_ensure would later
    // derive from the same string.
    let dir = temp_project("create-untrimmed-name");
    let root = dir.to_string_lossy().into_owned();

    let doc = agent_create(
        root.clone(),
        "Spacey".to_string(),
        Some(" spacey.md ".to_string()),
    )
    .unwrap();

    assert_eq!(doc.file_name, "spacey.md");
    assert!(agents_dir(&dir).join("spacey.md").is_file());
    assert!(!agents_dir(&dir).join(" spacey.md ").exists());

    let mem = agent_memory_ensure(root, doc.file_name.clone()).unwrap();
    assert_eq!(mem.dir_rel_path, ".claude/agent-memory/spacey");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_create_explicit_producer_file_name_still_materializes_producer() {
    let dir = temp_project("create-explicit-producer");
    let root = dir.to_string_lossy().into_owned();

    let doc = agent_create(root, "Producer".to_string(), Some("producer.md".to_string()))
        .unwrap();
    assert_eq!(doc.file_name, "producer.md");
    let _ = fs::remove_dir_all(&dir);
}

// ---- agent_memory_ensure (WO02 §2.1) ---------------------------------------

#[test]
fn agent_memory_ensure_fresh_create_seeds_index() {
    let dir = temp_project("memory-fresh");
    let root = dir.to_string_lossy().into_owned();

    let mem = agent_memory_ensure(root, "tech-lead.md".to_string()).unwrap();

    assert_eq!(mem.dir_rel_path, ".claude/agent-memory/tech-lead");
    assert_eq!(mem.index_rel_path, ".claude/agent-memory/tech-lead/MEMORY.md");
    assert!(mem.created);

    let index_path = dir
        .join(".claude")
        .join("agent-memory")
        .join("tech-lead")
        .join("MEMORY.md");
    assert!(index_path.is_file());
    let content = fs::read_to_string(&index_path).unwrap();
    assert_eq!(
        content,
        "# tech-lead memory index\n\n<!-- One line per memory file: - [Title](file.md) — one-line hook -->\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_memory_ensure_idempotent_second_call_reports_created_false() {
    let dir = temp_project("memory-idempotent");
    let root = dir.to_string_lossy().into_owned();

    let first = agent_memory_ensure(root.clone(), "tech-ui.md".to_string()).unwrap();
    assert!(first.created);

    let second = agent_memory_ensure(root, "tech-ui.md".to_string()).unwrap();
    assert!(!second.created);
    assert_eq!(second.dir_rel_path, first.dir_rel_path);
    assert_eq!(second.index_rel_path, first.index_rel_path);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_memory_ensure_never_rewrites_existing_memory_md() {
    let dir = temp_project("memory-never-clobber");
    let root = dir.to_string_lossy().into_owned();

    agent_memory_ensure(root.clone(), "tester.md".to_string()).unwrap();
    let index_path = dir
        .join(".claude")
        .join("agent-memory")
        .join("tester")
        .join("MEMORY.md");
    fs::write(&index_path, "custom content, hand-edited\n").unwrap();

    let again = agent_memory_ensure(root, "tester.md".to_string()).unwrap();
    assert!(!again.created);
    let content = fs::read_to_string(&index_path).unwrap();
    assert_eq!(content, "custom content, hand-edited\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_memory_ensure_rejects_path_traversal_file_name() {
    let dir = temp_project("memory-traversal");
    let root = dir.to_string_lossy().into_owned();

    for bad in ["../evil.md", "..\\evil.md", "a/b.md"] {
        let err = agent_memory_ensure(root.clone(), bad.to_string()).unwrap_err();
        assert!(!err.is_empty(), "should have rejected {bad:?}");
    }
    assert!(!dir.join(".claude").join("agent-memory").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_memory_ensure_directory_only_pre_created_still_reports_created_true() {
    // Directory exists (e.g. created by an out-of-band tool) but MEMORY.md
    // does not yet — `created` must still be true because the index file
    // itself is created by this call (contract §2.1 step 5, "or" clause).
    let dir = temp_project("memory-dir-precreated");
    let root = dir.to_string_lossy().into_owned();
    let mem_dir = dir.join(".claude").join("agent-memory").join("producer");
    fs::create_dir_all(&mem_dir).unwrap();

    let mem = agent_memory_ensure(root, "producer.md".to_string()).unwrap();
    assert!(mem.created);
    assert!(mem_dir.join("MEMORY.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

// ═══════════════════════════════════════════════════════════════════════
// WO11 R2 — agent_memory_status, avatars, agent_save -> AgentDoc
// ═══════════════════════════════════════════════════════════════════════

fn png_bytes(total_len: usize) -> Vec<u8> {
    let mut v = vec![0x89, 0x50, 0x4E, 0x47];
    v.resize(total_len.max(v.len()), 0);
    v
}

fn jpeg_bytes(total_len: usize) -> Vec<u8> {
    let mut v = vec![0xFF, 0xD8, 0xFF];
    v.resize(total_len.max(v.len()), 0);
    v
}

fn webp_bytes() -> Vec<u8> {
    let mut v = b"RIFF".to_vec();
    v.extend_from_slice(&[0, 0, 0, 0]); // size field, unchecked by detect_image_ext
    v.extend_from_slice(b"WEBP");
    v
}

fn gif_bytes() -> Vec<u8> {
    b"GIF89a".to_vec()
}

fn temp_source_file(tag: &str, bytes: &[u8]) -> PathBuf {
    let path =
        std::env::temp_dir().join(format!("cowtext-avatar-src-{tag}-{}.bin", std::process::id()));
    fs::write(&path, bytes).unwrap();
    path
}

// ---- agent_memory_status ---------------------------------------------------

#[test]
fn memory_status_missing_dir_is_unhealthy() {
    let dir = temp_project("mstatus-missing-dir");
    let root = dir.to_string_lossy().into_owned();
    let status = agent_memory_status(root, "tech-ui.md".to_string()).unwrap();
    assert_eq!(status.dir_rel_path, ".claude/agent-memory/tech-ui");
    assert_eq!(status.index_rel_path, ".claude/agent-memory/tech-ui/MEMORY.md");
    assert!(!status.dir_exists);
    assert!(!status.index_exists);
    assert_eq!(status.index_bytes, 0);
    assert!(!status.healthy);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn memory_status_dir_without_index_is_unhealthy() {
    let dir = temp_project("mstatus-no-index");
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join(".claude/agent-memory/tech-ui")).unwrap();

    let status = agent_memory_status(root, "tech-ui.md".to_string()).unwrap();
    assert!(status.dir_exists);
    assert!(!status.index_exists);
    assert!(!status.healthy);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn memory_status_zero_byte_index_is_unhealthy() {
    let dir = temp_project("mstatus-zero-byte");
    let root = dir.to_string_lossy().into_owned();
    let mem_dir = dir.join(".claude/agent-memory/tech-ui");
    fs::create_dir_all(&mem_dir).unwrap();
    fs::write(mem_dir.join("MEMORY.md"), "").unwrap();

    let status = agent_memory_status(root, "tech-ui.md".to_string()).unwrap();
    assert!(status.dir_exists);
    assert!(status.index_exists);
    assert_eq!(status.index_bytes, 0);
    assert!(!status.healthy);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn memory_status_non_utf8_index_is_unhealthy() {
    let dir = temp_project("mstatus-non-utf8");
    let root = dir.to_string_lossy().into_owned();
    let mem_dir = dir.join(".claude/agent-memory/tech-ui");
    fs::create_dir_all(&mem_dir).unwrap();
    fs::write(mem_dir.join("MEMORY.md"), [0xFF, 0xFE, 0x00, 0xFF]).unwrap();

    let status = agent_memory_status(root, "tech-ui.md".to_string()).unwrap();
    assert!(status.index_exists);
    assert!(status.index_bytes > 0);
    assert!(!status.healthy);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn memory_status_real_index_is_healthy() {
    let dir = temp_project("mstatus-healthy");
    let root = dir.to_string_lossy().into_owned();
    agent_memory_ensure(root.clone(), "tech-ui.md".to_string()).unwrap();

    let status = agent_memory_status(root, "tech-ui.md".to_string()).unwrap();
    assert!(status.dir_exists);
    assert!(status.index_exists);
    assert!(status.index_bytes > 0);
    assert!(status.healthy);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn memory_status_rejects_path_traversal_file_name() {
    let dir = temp_project("mstatus-traversal");
    let root = dir.to_string_lossy().into_owned();
    for bad in ["../evil.md", "..\\evil.md", "a/b.md"] {
        let err = agent_memory_status(root.clone(), bad.to_string()).unwrap_err();
        assert!(!err.is_empty(), "should have rejected {bad:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

// ---- agent_avatar_set: format + size validation ----------------------------

#[test]
fn avatar_set_accepts_minimal_4_byte_png_header() {
    let dir = temp_project("avatar-png-minimal");
    let root = dir.to_string_lossy().into_owned();
    let src = temp_source_file("png-4b", &[0x89, 0x50, 0x4E, 0x47]);

    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let avatar =
        agent_avatar_set(root.clone(), created.file_name.clone(), src.to_string_lossy().into_owned())
            .unwrap();

    assert_eq!(avatar.rel_path, ".cowtext/avatars/tech-ui.png");
    assert_eq!(avatar.bytes, 4);
    assert!(avatar.data_url.starts_with("data:image/png;base64,"));
    assert!(dir.join(".cowtext/avatars/tech-ui.png").is_file());

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_set_rejects_txt_content_renamed_to_png_extension() {
    let dir = temp_project("avatar-bad-magic");
    let root = dir.to_string_lossy().into_owned();
    // The SOURCE file's own name ends in .png but its bytes are plain text —
    // detect_image_ext must go by magic bytes, never by extension.
    let src_path =
        std::env::temp_dir().join(format!("cowtext-avatar-src-badmagic-{}.png", std::process::id()));
    fs::write(&src_path, b"just some text, not an image").unwrap();

    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let err = agent_avatar_set(root, created.file_name, src_path.to_string_lossy().into_owned())
        .unwrap_err();
    assert!(err.contains("unsupported image format"), "got: {err}");
    assert!(!dir.join(".cowtext/avatars").exists());

    let _ = fs::remove_file(&src_path);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_set_rejects_oversize_image() {
    let dir = temp_project("avatar-oversize");
    let root = dir.to_string_lossy().into_owned();
    let bytes = png_bytes(600 * 1024); // 600 KB, valid magic bytes
    let src = temp_source_file("oversize", &bytes);

    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let err = agent_avatar_set(root, created.file_name, src.to_string_lossy().into_owned())
        .unwrap_err();
    assert_eq!(err, "image too large (max 512 KB)");
    assert!(!dir.join(".cowtext/avatars").exists());

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_set_rejects_oversize_image_via_stat_before_reading_bytes() {
    // A sparse file: logical length far over the cap, but only a few real
    // bytes actually written. If `agent_avatar_set` read the whole file
    // before checking the cap (tester audit #4), this would try to
    // allocate ~2 GB; stat-first rejects it near-instantly regardless of
    // how large the file claims to be.
    use std::io::{Seek, SeekFrom, Write};
    let dir = temp_project("avatar-oversize-sparse");
    let root = dir.to_string_lossy().into_owned();
    let src = std::env::temp_dir()
        .join(format!("cowtext-avatar-src-sparse-{}.bin", std::process::id()));
    {
        let mut f = fs::File::create(&src).unwrap();
        f.write_all(&[0x89, 0x50, 0x4E, 0x47]).unwrap(); // valid PNG magic at start
        f.seek(SeekFrom::Start(2 * 1024 * 1024 * 1024)).unwrap(); // 2 GB
        f.write_all(&[0]).unwrap();
    }

    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let started = std::time::Instant::now();
    let err = agent_avatar_set(root, created.file_name, src.to_string_lossy().into_owned())
        .unwrap_err();
    assert_eq!(err, "image too large (max 512 KB)");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "stat-first rejection should be near-instant, never reading the whole file"
    );

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_set_accepts_jpeg_webp_gif() {
    let dir = temp_project("avatar-formats");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Multi".to_string(), None).unwrap();

    let jpeg_src = temp_source_file("jpeg", &jpeg_bytes(16));
    let avatar = agent_avatar_set(
        root.clone(),
        created.file_name.clone(),
        jpeg_src.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(avatar.rel_path, ".cowtext/avatars/multi.jpg");
    let _ = fs::remove_file(&jpeg_src);

    agent_avatar_clear(root.clone(), created.file_name.clone()).unwrap();

    let webp_src = temp_source_file("webp", &webp_bytes());
    let avatar = agent_avatar_set(
        root.clone(),
        created.file_name.clone(),
        webp_src.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(avatar.rel_path, ".cowtext/avatars/multi.webp");
    let _ = fs::remove_file(&webp_src);

    agent_avatar_clear(root.clone(), created.file_name.clone()).unwrap();

    let gif_src = temp_source_file("gif", &gif_bytes());
    let avatar =
        agent_avatar_set(root.clone(), created.file_name, gif_src.to_string_lossy().into_owned())
            .unwrap();
    assert_eq!(avatar.rel_path, ".cowtext/avatars/multi.gif");
    let _ = fs::remove_file(&gif_src);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_set_missing_source_path_errs() {
    let dir = temp_project("avatar-missing-source");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let missing = std::env::temp_dir().join("cowtext-avatar-does-not-exist.png");

    let err = agent_avatar_set(root, created.file_name, missing.to_string_lossy().into_owned())
        .unwrap_err();
    assert!(!err.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_set_rejects_path_traversal_file_name() {
    let dir = temp_project("avatar-traversal");
    let root = dir.to_string_lossy().into_owned();
    let src = temp_source_file("traversal", &png_bytes(8));

    for bad in ["../evil.md", "..\\evil.md", "a/b.md"] {
        let err =
            agent_avatar_set(root.clone(), bad.to_string(), src.to_string_lossy().into_owned())
                .unwrap_err();
        assert!(!err.is_empty(), "should have rejected {bad:?}");
    }
    assert!(!dir.join(".cowtext").exists());

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

// ---- setting a new format over an existing one replaces, never doubles ----

#[test]
fn avatar_set_jpeg_over_existing_png_leaves_exactly_one_file() {
    let dir = temp_project("avatar-replace");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();

    let png_src = temp_source_file("replace-png", &png_bytes(8));
    agent_avatar_set(root.clone(), created.file_name.clone(), png_src.to_string_lossy().into_owned())
        .unwrap();
    assert!(dir.join(".cowtext/avatars/tech-ui.png").is_file());

    let jpeg_src = temp_source_file("replace-jpeg", &jpeg_bytes(8));
    agent_avatar_set(root, created.file_name, jpeg_src.to_string_lossy().into_owned()).unwrap();

    assert!(!dir.join(".cowtext/avatars/tech-ui.png").exists());
    assert!(dir.join(".cowtext/avatars/tech-ui.jpg").is_file());
    let entries: Vec<_> = fs::read_dir(dir.join(".cowtext/avatars")).unwrap().flatten().collect();
    assert_eq!(entries.len(), 1, "exactly one avatar file must remain");

    let _ = fs::remove_file(&png_src);
    let _ = fs::remove_file(&jpeg_src);
    let _ = fs::remove_dir_all(&dir);
}

// ---- agent_avatar_read ------------------------------------------------------

#[test]
fn avatar_read_returns_none_when_absent() {
    let dir = temp_project("avatar-read-none");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();

    let result = agent_avatar_read(root, created.file_name).unwrap();
    assert!(result.is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_read_returns_data_url_after_set() {
    let dir = temp_project("avatar-read-some");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let src = temp_source_file("read-some", &png_bytes(8));
    agent_avatar_set(root.clone(), created.file_name.clone(), src.to_string_lossy().into_owned())
        .unwrap();

    let result = agent_avatar_read(root, created.file_name).unwrap();
    assert!(result.unwrap().starts_with("data:image/png;base64,"));

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_read_returns_none_for_broken_directory_entry_never_errs() {
    // A directory sitting where an avatar file would be (e.g. from external
    // tampering) must never surface as an Err — the rail must still render.
    let dir = temp_project("avatar-read-broken");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    fs::create_dir_all(dir.join(".cowtext/avatars/tech-ui.png")).unwrap();

    let result = agent_avatar_read(root, created.file_name).unwrap();
    assert!(result.is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_read_rejects_path_traversal_file_name() {
    let dir = temp_project("avatar-read-traversal");
    let root = dir.to_string_lossy().into_owned();
    for bad in ["../evil.md", "..\\evil.md", "a/b.md"] {
        let err = agent_avatar_read(root.clone(), bad.to_string()).unwrap_err();
        assert!(!err.is_empty(), "should have rejected {bad:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

// ---- agent_avatar_clear -----------------------------------------------------

#[test]
fn avatar_clear_removes_file_and_is_idempotent() {
    let dir = temp_project("avatar-clear");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let src = temp_source_file("clear", &png_bytes(8));
    agent_avatar_set(root.clone(), created.file_name.clone(), src.to_string_lossy().into_owned())
        .unwrap();
    assert!(dir.join(".cowtext/avatars/tech-ui.png").is_file());

    agent_avatar_clear(root.clone(), created.file_name.clone()).unwrap();
    assert!(!dir.join(".cowtext/avatars/tech-ui.png").exists());

    // Clearing again (nothing left to clear) is still Ok.
    agent_avatar_clear(root, created.file_name).unwrap();

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn avatar_clear_on_agent_with_no_avatar_is_ok() {
    let dir = temp_project("avatar-clear-noop");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    agent_avatar_clear(root, created.file_name).unwrap();
    let _ = fs::remove_dir_all(&dir);
}

// ---- avatar follows agent_rename / agent_delete ----------------------------

#[test]
fn agent_rename_moves_avatar_to_new_stem() {
    let dir = temp_project("avatar-rename");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Old Name".to_string(), None).unwrap();
    let src = temp_source_file("rename", &png_bytes(8));
    agent_avatar_set(root.clone(), created.file_name.clone(), src.to_string_lossy().into_owned())
        .unwrap();
    assert!(dir.join(".cowtext/avatars/old-name.png").is_file());

    let new_file_name =
        agent_rename(root.clone(), created.file_name, "New Name".to_string()).unwrap();
    assert_eq!(new_file_name, "new-name.md");

    assert!(!dir.join(".cowtext/avatars/old-name.png").exists());
    assert!(dir.join(".cowtext/avatars/new-name.png").is_file());

    let moved = agent_avatar_read(root, new_file_name).unwrap();
    assert!(moved.unwrap().starts_with("data:image/png;base64,"));

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_rename_with_no_avatar_still_succeeds() {
    let dir = temp_project("avatar-rename-none");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Old Name".to_string(), None).unwrap();

    let new_file_name = agent_rename(root, created.file_name, "New Name".to_string()).unwrap();
    assert_eq!(new_file_name, "new-name.md");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_rename_to_same_stem_case_change_keeps_avatar_intact() {
    let dir = temp_project("avatar-rename-case");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Same".to_string(), None).unwrap();
    let src = temp_source_file("rename-case", &png_bytes(8));
    agent_avatar_set(root.clone(), created.file_name.clone(), src.to_string_lossy().into_owned())
        .unwrap();

    // Renaming to the exact same slug is a documented harmless no-op
    // (agent_rename_to_identical_name_is_a_harmless_noop) — the avatar must
    // survive it untouched, not get deleted by its own sibling-clear step.
    agent_rename(root.clone(), created.file_name.clone(), "Same".to_string()).unwrap();
    assert!(dir.join(".cowtext/avatars/same.png").is_file());

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_delete_removes_avatar() {
    let dir = temp_project("avatar-delete");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    let src = temp_source_file("delete", &png_bytes(8));
    agent_avatar_set(root.clone(), created.file_name.clone(), src.to_string_lossy().into_owned())
        .unwrap();
    assert!(dir.join(".cowtext/avatars/tech-ui.png").is_file());

    agent_delete(root, created.file_name).unwrap();
    assert!(!dir.join(".cowtext/avatars/tech-ui.png").exists());

    let _ = fs::remove_file(&src);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_delete_with_no_avatar_still_succeeds() {
    let dir = temp_project("avatar-delete-none");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Tech Ui".to_string(), None).unwrap();
    agent_delete(root, created.file_name).unwrap();
    let _ = fs::remove_dir_all(&dir);
}

// ---- agent_save -> AgentDoc --------------------------------------------------

#[test]
fn agent_save_returns_doc_matching_bytes_on_disk() {
    let dir = temp_project("save-returns-doc");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Save Returns".to_string(), None).unwrap();

    let mut fields = created.fields.clone();
    fields.description = Some("Returned doc test.".to_string());
    let returned = agent_save(
        root.clone(),
        created.file_name.clone(),
        Some(fields),
        Some("# Save Returns\n\nBody after save.\n".to_string()),
        None,
    )
    .unwrap();

    let on_disk = fs::read_to_string(agents_dir(&dir).join(&created.file_name)).unwrap();
    assert_eq!(returned.content, on_disk, "returned AgentDoc.content must equal the bytes on disk");
    assert_eq!(returned.fields.description.as_deref(), Some("Returned doc test."));
    assert_eq!(returned.body, "# Save Returns\n\nBody after save.\n");
    assert_eq!(returned.file_name, created.file_name);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_save_raw_content_returns_doc_matching_disk() {
    let dir = temp_project("save-raw-returns-doc");
    let root = dir.to_string_lossy().into_owned();
    let created = agent_create(root.clone(), "Raw Save".to_string(), None).unwrap();

    let raw = "not frontmatter at all, just text\n".to_string();
    let returned =
        agent_save(root, created.file_name, None, None, Some(raw.clone())).unwrap();

    // `raw_content` is a whole-file overwrite regardless of what it contains
    // — round-trip byte-identity is the contract here, not `raw`'s value
    // (frontmatter.rs only sets `raw: true` on an *attempted-but-broken*
    // fence; plain unfenced text parses as a normal, non-raw doc).
    assert_eq!(returned.content, raw);
    let _ = fs::remove_dir_all(&dir);
}

// ---- save/rename race: AGENT_FS lock (WO11_CONTRACT.md §11, Amendment 2) ---

#[test]
fn agent_rename_during_save_never_resurrects_the_old_file() {
    // Inverts the pre-fix repro (previously
    // `agent_rename_landing_mid_save_can_resurrect_the_old_file_as_an_orphan`)
    // into proof of the fix. Real concurrent threads calling `agent_save`
    // and `agent_rename` on the same agent can no longer interleave at
    // all: both take `AGENT_FS` for their entire body, so whichever call
    // wins the race runs to completion before the other's critical section
    // even starts. That makes exactly two orderings possible, and both are
    // safe:
    //   - save wins: it patches the file in place, THEN rename moves the
    //     patched file to the new name — the edit survives under the new
    //     filename.
    //   - rename wins: the file is gone by the time save's own
    //     `path.is_file()` check runs, so save fails cleanly with
    //     "No such agent" — exactly the job that check was always meant to
    //     do, now that the lock actually defends its result.
    // Neither ordering ever resurrects the old filename as an orphan. Runs
    // many trials since real thread scheduling picks the winner
    // nondeterministically — the invariant must hold on every interleaving,
    // not just a lucky one.
    for trial in 0..25 {
        let dir = temp_project(&format!("save-rename-fixed-{trial}"));
        let root = dir.to_string_lossy().into_owned();
        let created = agent_create(root.clone(), "Old Name".to_string(), None).unwrap();
        let old_file_name = created.file_name.clone();
        let old_path = agents_dir(&dir).join(&old_file_name);

        let root_save = root.clone();
        let root_rename = root.clone();
        let save_file_name = old_file_name.clone();
        let rename_file_name = old_file_name.clone();

        let save_thread = std::thread::spawn(move || {
            let fields = FmFields {
                description: Some("Edit racing a rename.".to_string()),
                ..Default::default()
            };
            agent_save(root_save, save_file_name, Some(fields), None, None)
        });
        let rename_thread = std::thread::spawn(move || {
            agent_rename(root_rename, rename_file_name, "New Name".to_string())
        });

        let save_result = save_thread.join().unwrap();
        let rename_result = rename_thread.join().unwrap();

        // Renaming an agent must always succeed — a racing save's own guard
        // is released before rename's critical section can even start, so
        // rename is never blocked mid-way or left half-done.
        let new_file_name = rename_result.unwrap();
        assert_eq!(new_file_name, "new-name.md");

        // The critical invariant: the pre-rename filename is never
        // resurrected as an orphan.
        assert!(
            !old_path.exists(),
            "trial {trial}: old path must never be resurrected as an orphan"
        );
        if let Err(e) = &save_result {
            assert!(
                e.contains("No such agent"),
                "trial {trial}: a losing save must fail cleanly, not some other error: {e}"
            );
        }

        // Exactly one agent file exists in the directory — never a stray
        // duplicate left behind by a resurrected orphan.
        let remaining: Vec<_> = fs::read_dir(agents_dir(&dir)).unwrap().flatten().collect();
        assert_eq!(remaining.len(), 1, "trial {trial}: exactly one agent file must remain");

        let _ = fs::remove_dir_all(&dir);
    }
}

#[test]
fn skill_rename_during_save_never_resurrects_the_old_skill_dir() {
    // Twin of `agent_rename_during_save_never_resurrects_the_old_file` —
    // `save_doc` is shared between `agent_save` and `skill_save`, and
    // `AGENT_FS` guards `skill_rename`/`skill_save` too (WO11_CONTRACT.md
    // §11.2 names both surfaces), so the same race and the same fix apply
    // to skills.
    for trial in 0..25 {
        let dir = temp_project(&format!("skill-save-rename-fixed-{trial}"));
        let root = dir.to_string_lossy().into_owned();
        let created = skill_create(root.clone(), "Old Skill".to_string()).unwrap();
        let old_dir_name = created.dir_name.clone();
        let old_path = skills_dir(&dir).join(&old_dir_name);

        let root_save = root.clone();
        let root_rename = root.clone();
        let save_dir_name = old_dir_name.clone();
        let rename_dir_name = old_dir_name.clone();

        let save_thread = std::thread::spawn(move || {
            let fields = FmFields {
                description: Some("Edit racing a rename.".to_string()),
                ..Default::default()
            };
            skill_save(root_save, save_dir_name, Some(fields), None, None)
        });
        let rename_thread = std::thread::spawn(move || {
            skill_rename(root_rename, rename_dir_name, "New Skill".to_string())
        });

        let save_result = save_thread.join().unwrap();
        let rename_result = rename_thread.join().unwrap();

        let new_dir_name = rename_result.unwrap();
        assert_eq!(new_dir_name, "new-skill");

        assert!(
            !old_path.exists(),
            "trial {trial}: old skill dir must never be resurrected as an orphan"
        );
        if let Err(e) = &save_result {
            assert!(
                e.contains("No such skill"),
                "trial {trial}: a losing save must fail cleanly, not some other error: {e}"
            );
        }

        let remaining: Vec<_> = fs::read_dir(skills_dir(&dir)).unwrap().flatten().collect();
        assert_eq!(remaining.len(), 1, "trial {trial}: exactly one skill dir must remain");

        let _ = fs::remove_dir_all(&dir);
    }
}
