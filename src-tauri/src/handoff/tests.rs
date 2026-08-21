use super::*;
use serde_json::json;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-handoff-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Fake runner returning a fixed body (assemble's EchoRunner idiom).
struct FixedRunner(&'static str);

impl Runner for FixedRunner {
    fn run(
        &self,
        _prompt: String,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        Box::pin(async move { Ok(self.0.to_string()) })
    }
}

fn graph_json() -> String {
    json!({
        "version": 1,
        "projectName": "barnyard",
        "nodes": [
            { "id": "b", "title": "Coding rules", "role": "rules", "brief": "how we code",
              "filePath": "context/rules.md", "readOrder": 2, "rootLoad": "always" },
            { "id": "a", "title": "Architecture", "role": "architecture", "brief": "",
              "filePath": "context/arch.md", "readOrder": 1 }
        ],
        "edges": [
            { "id": "e1", "source": "b", "target": "a", "kind": "references" }
        ],
        "compileTargets": ["claude"]
    })
    .to_string()
}

fn events_json() -> String {
    json!([
        { "kind": "prompt", "ts": 1_755_000_000_000u64, "sessionId": "s" },
        { "kind": "read", "filePath": "context/rules.md", "ts": 1_755_000_001_000u64 },
        { "kind": "stop", "ts": 1_755_000_002_000u64 }
    ])
    .to_string()
}

// ── Prompt ────────────────────────────────────────────────────────────

#[test]
fn prompt_contains_nodes_edges_and_event_kinds() {
    let graph: GraphIn = serde_json::from_str(&graph_json()).unwrap();
    let events: Vec<EventIn> = serde_json::from_str(&events_json()).unwrap();
    let prompt = build_handoff_prompt(&graph, &events, 1_755_000_100_000);

    assert!(prompt.starts_with("You are writing a project handoff document."));
    assert!(prompt.contains("\"barnyard\""));
    // Nodes in readOrder: Architecture (1) before Coding rules (2).
    let arch = prompt.find("Architecture (role: architecture").unwrap();
    let rules = prompt.find("Coding rules (role: rules, pinned").unwrap();
    assert!(arch < rules);
    assert!(prompt.contains("how we code"));
    // Edge rendered with titles, not ids.
    assert!(prompt.contains("Coding rules —references→ Architecture"));
    // Event kinds + file path + humanized age.
    assert!(prompt.contains("- prompt ("));
    assert!(prompt.contains("- read context/rules.md ("));
    assert!(prompt.contains("- stop ("));
    assert!(prompt.contains("1m ago"));
}

/// WO13 D11b regression: the wire field is `rootLoad?: "always"`, not the
/// v4 `pinned: bool` this module used to read. A node carrying the OLD key
/// name (as a stale hand-edited file, an unmigrated preset, or simply a
/// caller that still sends it) must NOT be annotated "pinned" — only
/// `rootLoad: "always"` does that. This is the one guard against silently
/// regressing back to reading a wire field that no longer exists.
#[test]
fn prompt_pinned_annotation_reads_root_load_not_the_stale_pinned_key() {
    let graph_json = json!({
        "version": 5,
        "projectName": "p",
        "nodes": [
            { "id": "a", "title": "Old Field", "role": "rule", "brief": "",
              "filePath": "context/a.md", "readOrder": 0, "pinned": true },
            { "id": "b", "title": "New Field", "role": "rule", "brief": "",
              "filePath": "context/b.md", "readOrder": 1, "rootLoad": "always" }
        ],
        "edges": [],
        "compileTargets": ["claude"]
    })
    .to_string();
    let graph: GraphIn = serde_json::from_str(&graph_json).unwrap();
    let prompt = build_handoff_prompt(&graph, &[], 0);
    assert!(
        prompt.contains("Old Field (role: rule, file:"),
        "the legacy `pinned` key must be ignored, not resurrected: {prompt:?}"
    );
    assert!(prompt.contains("New Field (role: rule, pinned, file:"));
}

#[test]
fn prompt_freezes_the_four_section_names() {
    let graph: GraphIn = serde_json::from_str(&graph_json()).unwrap();
    let prompt = build_handoff_prompt(&graph, &[], 0);
    for section in [
        "## Current state",
        "## Decisions made",
        "## Open threads",
        "## Next actions",
    ] {
        assert!(prompt.contains(section), "missing section {section}");
    }
}

#[test]
fn humanize_age_buckets() {
    assert_eq!(humanize_age(59_000), "just now");
    assert_eq!(humanize_age(60_000), "1m ago");
    assert_eq!(humanize_age(3_599_000), "59m ago");
    assert_eq!(humanize_age(7_200_000), "2h ago");
    assert_eq!(humanize_age(172_800_000), "2d ago");
}

// ── Generate ──────────────────────────────────────────────────────────

#[tokio::test]
async fn generate_starts_with_generated_header() {
    let dir = temp_project("gen");
    let runner = FixedRunner("## Current state\nAll good.");
    let res = generate_inner(
        &runner,
        &dir.to_string_lossy(),
        &graph_json(),
        &events_json(),
    )
    .await
    .unwrap();
    assert!(res.content.starts_with(GENERATED_HEADER));
    assert!(res.content.contains("# HANDOFF"));
    assert!(res.content.contains("All good."));
    assert!(res.content.ends_with('\n'));
    assert!(res.old_content.is_none());
}

#[tokio::test]
async fn generate_reports_existing_handoff_as_old_content() {
    let dir = temp_project("old");
    std::fs::write(dir.join("HANDOFF.md"), "previous handoff\n").unwrap();
    let runner = FixedRunner("body");
    let res = generate_inner(&runner, &dir.to_string_lossy(), &graph_json(), "[]")
        .await
        .unwrap();
    assert_eq!(res.old_content.as_deref(), Some("previous handoff\n"));
}

// ── Write ─────────────────────────────────────────────────────────────

fn headed(body: &str) -> String {
    format!("{GENERATED_HEADER}\n\n# HANDOFF\n\n{body}\n")
}

#[test]
fn write_round_trip() {
    let dir = temp_project("write");
    let content = headed("## Current state\nfine");
    let rel = handoff_write(dir.to_string_lossy().into_owned(), content.clone()).unwrap();
    assert_eq!(rel, "HANDOFF.md");
    assert_eq!(
        std::fs::read_to_string(dir.join("HANDOFF.md")).unwrap(),
        content
    );
}

#[test]
fn write_rejects_wrong_rel_path() {
    let dir = temp_project("badpath");
    let err = write_inner(&dir.to_string_lossy(), "notes/HANDOFF.md", &headed("x")).unwrap_err();
    assert!(err.contains("Refusing to write outside"));
    assert!(!dir.join("notes/HANDOFF.md").exists());
}

#[test]
fn write_rejects_missing_header() {
    let dir = temp_project("noheader");
    let err = handoff_write(
        dir.to_string_lossy().into_owned(),
        "# HANDOFF\n\nno header here\n".to_string(),
    )
    .unwrap_err();
    assert!(err.contains("GENERATED header"));
    assert!(!dir.join("HANDOFF.md").exists());
}

#[test]
fn write_rejects_bad_root() {
    let err = handoff_write("Z:/no/such/dir".to_string(), headed("x")).unwrap_err();
    assert!(err.starts_with("Not a directory: "));
}

// ── Handoff → node (§6, D2/F3 regression) ───────────────────────────────

fn session_input() -> HandoffSessionInput {
    HandoffSessionInput {
        id: "as1".to_string(),
        name: "Cedar".to_string(),
        agent_file_name: Some("cedar-default.md".to_string()),
        cwd: "/repo/worktrees/cedar".to_string(),
        claude_session_id: Some("9f3c1234-uuid".to_string()),
        tokens_used: 42_000,
    }
}

/// D2/F3: `handoff_node_propose` (command 63/63) was still the literal
/// Stage-0 stub, unconditionally returning
/// `Err("handoff_node_propose: not implemented (WO06 Stage-0 stub)")`. This
/// is the regression test the audit prescribed: a normal call must succeed,
/// and — belt and braces — the stub's exact wording must never again appear
/// anywhere a caller could observe.
#[test]
fn handoff_node_propose_is_no_longer_the_stage0_stub() {
    let dir = temp_project("propose-not-stub");
    let result = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        Some("t-abc123".to_string()),
        "Did the thing.".to_string(),
    );
    let proposal = result.expect("handoff_node_propose must succeed for valid input");
    assert!(!proposal.title.contains("Stage-0 stub"));
    assert!(!proposal.content.contains("Stage-0 stub"));
}

#[test]
fn handoff_node_propose_fills_every_frozen_field() {
    let dir = temp_project("propose-fields");
    let proposal = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        Some("t-abc123".to_string()),
        "Finished the migration.\nSecond line ignored for the brief.".to_string(),
    )
    .unwrap();

    assert_eq!(proposal.title, "Handoff — Cedar — t-abc123");
    // WO13 D11b: `reference` was deleted in the v5 role taxonomy;
    // `architecture` is the frozen replacement (same fallback every other
    // v5 migration path uses).
    assert_eq!(proposal.role, "architecture");
    assert!(proposal.rel_path.starts_with("context/handoff/"));
    assert!(proposal.rel_path.ends_with(".md"));
    assert_eq!(proposal.brief, "Finished the migration.");
    assert!(proposal.brief.chars().count() <= 120);

    // meta (§6): exactly these six keys, frozen values.
    assert_eq!(proposal.meta.get("source").map(String::as_str), Some("handoff"));
    assert_eq!(
        proposal.meta.get("session").map(String::as_str),
        Some("9f3c1234-uuid"),
        "claudeSessionId must win over the as<N> id"
    );
    assert_eq!(proposal.meta.get("agent").map(String::as_str), Some("cedar-default"));
    assert_eq!(proposal.meta.get("task").map(String::as_str), Some("t-abc123"));
    assert_eq!(proposal.meta.get("tokens").map(String::as_str), Some("42000"));
    assert!(proposal.meta.contains_key("producedAt"));
    assert_eq!(proposal.meta.len(), 6);

    // content: provenance block + summary, LF, trailing newline.
    assert!(proposal.content.starts_with("# Handoff — Cedar — t-abc123"));
    assert!(proposal.content.contains("Finished the migration."));
    assert!(proposal.content.ends_with('\n'));
    assert!(!proposal.content.contains('\r'));

    assert_eq!(proposal.anchor_node_id, None, "no tasklinks.json on disk yet");
}

#[test]
fn handoff_node_propose_falls_back_to_session_id_without_claude_session_id() {
    let dir = temp_project("propose-fallback-session");
    let mut session = session_input();
    session.claude_session_id = None;
    let proposal = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session,
        None,
        String::new(),
    )
    .unwrap();
    assert_eq!(proposal.meta.get("session").map(String::as_str), Some("as1"));
    assert_eq!(proposal.meta.get("task").map(String::as_str), Some(""));
    // No taskId ⇒ the title's ident falls back to the same session label.
    assert_eq!(proposal.title, "Handoff — Cedar — as1");
}

#[test]
fn handoff_node_propose_blank_summary_gets_a_fallback_brief_and_note() {
    let dir = temp_project("propose-blank-summary");
    let proposal = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        None,
        "   \n  ".to_string(),
    )
    .unwrap();
    assert!(!proposal.brief.is_empty());
    assert!(proposal.content.contains("(no summary provided)"));
}

#[test]
fn handoff_node_propose_no_agent_file_yields_empty_meta_agent() {
    let dir = temp_project("propose-no-agent");
    let mut session = session_input();
    session.agent_file_name = None;
    let proposal = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session,
        None,
        "summary".to_string(),
    )
    .unwrap();
    assert_eq!(proposal.meta.get("agent").map(String::as_str), Some(""));
    assert!(proposal.content.contains("**Agent:** (none)"));
}

#[test]
fn handoff_node_propose_rel_path_is_collision_free() {
    let dir = temp_project("propose-collision");
    let first = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        Some("t-abc123".to_string()),
        "one".to_string(),
    )
    .unwrap();
    let full_path = dir.join(&first.rel_path);
    std::fs::create_dir_all(full_path.parent().unwrap()).unwrap();
    std::fs::write(&full_path, "existing node\n").unwrap();

    let second = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        Some("t-abc123".to_string()),
        "two".to_string(),
    )
    .unwrap();
    assert_ne!(first.rel_path, second.rel_path);
    assert!(second.rel_path.ends_with("-2.md"), "{}", second.rel_path);
}

#[test]
fn handoff_node_propose_resolves_anchor_from_tasklinks() {
    let dir = temp_project("propose-anchor");
    std::fs::create_dir_all(dir.join(".cowtext")).unwrap();
    std::fs::write(
        dir.join(".cowtext/tasklinks.json"),
        serde_json::json!({
            "version": 1,
            "links": [
                { "taskId": "t-abc123", "nodeIds": ["zzz", "aaa", "mmm"], "sessionIds": [] }
            ]
        })
        .to_string(),
    )
    .unwrap();

    let proposal = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        Some("t-abc123".to_string()),
        "summary".to_string(),
    )
    .unwrap();
    // Byte-order smallest of ["zzz", "aaa", "mmm"] is "aaa".
    assert_eq!(proposal.anchor_node_id.as_deref(), Some("aaa"));
}

#[test]
fn handoff_node_propose_anchor_is_none_when_tasklinks_corrupt() {
    let dir = temp_project("propose-anchor-corrupt");
    std::fs::create_dir_all(dir.join(".cowtext")).unwrap();
    std::fs::write(dir.join(".cowtext/tasklinks.json"), "not json").unwrap();

    let proposal = handoff_node_propose(
        dir.to_string_lossy().into_owned(),
        session_input(),
        Some("t-abc123".to_string()),
        "summary".to_string(),
    )
    .unwrap();
    assert_eq!(proposal.anchor_node_id, None);
}

#[test]
fn handoff_node_propose_rejects_bad_root() {
    let err = handoff_node_propose(
        "Z:/no/such/dir".to_string(),
        session_input(),
        None,
        "summary".to_string(),
    )
    .unwrap_err();
    assert!(err.starts_with("Not a directory: "));
}

// ── ISO-8601 timestamp helper ────────────────────────────────────────────

#[test]
fn iso8601_utc_now_matches_the_expected_shape() {
    let ts = iso8601_utc_now();
    assert_eq!(ts.len(), 20, "{ts}");
    assert!(ts.ends_with('Z'), "{ts}");
    let bytes = ts.as_bytes();
    assert_eq!(bytes[4], b'-');
    assert_eq!(bytes[7], b'-');
    assert_eq!(bytes[10], b'T');
    assert_eq!(bytes[13], b':');
    assert_eq!(bytes[16], b':');
}

#[test]
fn civil_from_days_known_anchors() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    assert_eq!(civil_from_days(-1), (1969, 12, 31));
    assert_eq!(civil_from_days(10_957), (2000, 1, 1));
    assert_eq!(civil_from_days(19_723), (2024, 1, 1));
    // Leap day: 2024 is a leap year.
    assert_eq!(civil_from_days(19_782), (2024, 2, 29));
}
