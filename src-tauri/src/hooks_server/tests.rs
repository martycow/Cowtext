use super::*;
use serde_json::json;

fn norm(body: serde_json::Value) -> BarnEvent {
    normalize(body.to_string().as_bytes(), 42).expect("expected an event")
}

#[test]
fn lifecycle_events_map_by_hook_event_name() {
    let e = norm(json!({ "hook_event_name": "UserPromptSubmit", "session_id": "s1" }));
    assert_eq!(e.kind, BarnKind::Prompt);
    assert_eq!(e.session_id, "s1");
    assert_eq!(e.ts, 42);
    assert!(e.file_path.is_none());
    assert!(e.tool_name.is_none());

    assert_eq!(norm(json!({ "hook_event_name": "Stop" })).kind, BarnKind::Stop);
    assert_eq!(
        norm(json!({ "hook_event_name": "SubagentStop" })).kind,
        BarnKind::SubagentStop
    );
}

#[test]
fn post_tool_use_maps_by_tool_name() {
    let cases = [
        ("Read", BarnKind::Read),
        ("Edit", BarnKind::Edit),
        ("MultiEdit", BarnKind::Edit),
        ("Write", BarnKind::Write),
        ("Grep", BarnKind::Grep),
        ("Glob", BarnKind::Glob),
    ];
    for (tool, kind) in cases {
        let e = norm(json!({ "hook_event_name": "PostToolUse", "tool_name": tool }));
        assert_eq!(e.kind, kind, "tool {tool}");
        assert!(e.tool_name.is_none(), "tool {tool} must not carry toolName");
    }
}

#[test]
fn unknown_tool_becomes_other_with_raw_tool_name() {
    let e = norm(json!({ "hook_event_name": "PostToolUse", "tool_name": "Bash" }));
    assert_eq!(e.kind, BarnKind::Other);
    assert_eq!(e.tool_name.as_deref(), Some("Bash"));
}

#[test]
fn unknown_event_name_becomes_other() {
    let e = norm(json!({ "hook_event_name": "PreToolUse", "tool_name": "Read" }));
    assert_eq!(e.kind, BarnKind::Other);
    assert_eq!(e.tool_name.as_deref(), Some("Read"));

    // No event name at all still produces an event — the log shows everything.
    let e = norm(json!({}));
    assert_eq!(e.kind, BarnKind::Other);
    assert_eq!(e.session_id, "");
    assert!(e.tool_name.is_none());
}

#[test]
fn file_path_comes_from_tool_input_with_path_fallback() {
    let e = norm(json!({
        "hook_event_name": "PostToolUse", "tool_name": "Read",
        "tool_input": { "file_path": "C:\\proj\\context\\rules.md" }
    }));
    assert_eq!(e.file_path.as_deref(), Some("C:\\proj\\context\\rules.md"));

    // Grep/Glob send `path` instead of `file_path`.
    let e = norm(json!({
        "hook_event_name": "PostToolUse", "tool_name": "Grep",
        "tool_input": { "path": "src/canvas", "pattern": "moo" }
    }));
    assert_eq!(e.file_path.as_deref(), Some("src/canvas"));

    // file_path wins over path when both exist.
    let e = norm(json!({
        "hook_event_name": "PostToolUse", "tool_name": "Read",
        "tool_input": { "file_path": "a.md", "path": "b.md" }
    }));
    assert_eq!(e.file_path.as_deref(), Some("a.md"));

    // Missing path is fine — the event still exists.
    let e = norm(json!({ "hook_event_name": "PostToolUse", "tool_name": "Edit" }));
    assert!(e.file_path.is_none());
}

#[test]
fn garbage_bodies_produce_no_event() {
    assert!(normalize(b"", 1).is_none());
    assert!(normalize(b"not json", 1).is_none());
    assert!(normalize(b"[1, 2, 3]", 1).is_none());
    assert!(normalize(b"\"just a string\"", 1).is_none());
}

#[test]
fn wire_shape_is_camel_case_with_optionals_omitted() {
    let full = norm(json!({
        "hook_event_name": "PostToolUse", "tool_name": "Bash",
        "tool_input": { "file_path": "x.md" }, "session_id": "abc"
    }));
    let v: serde_json::Value = serde_json::from_str(&serde_json::to_string(&full).unwrap()).unwrap();
    assert_eq!(v["kind"], "other");
    assert_eq!(v["filePath"], "x.md");
    assert_eq!(v["toolName"], "Bash");
    assert_eq!(v["sessionId"], "abc");
    assert_eq!(v["ts"], 42);

    let bare = norm(json!({ "hook_event_name": "SubagentStop" }));
    let v: serde_json::Value = serde_json::from_str(&serde_json::to_string(&bare).unwrap()).unwrap();
    assert_eq!(v["kind"], "subagent_stop");
    assert!(v.get("filePath").is_none());
    assert!(v.get("toolName").is_none());
    assert_eq!(v["sessionId"], "");
}
