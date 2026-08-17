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
              "filePath": "context/rules.md", "readOrder": 2, "pinned": true },
            { "id": "a", "title": "Architecture", "role": "architecture", "brief": "",
              "filePath": "context/arch.md", "readOrder": 1, "pinned": false }
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
