//! Fixture-driven parity tests (WO13_CONTRACT.md §18.4): every case in
//! `tests/fixtures/resolve_load_cases.json` is asserted here (Rust side)
//! with the SAME expectations Vitest asserts against `resolveLoad.ts`
//! (`src/config/resolveLoad.test.ts`, T1's file). The fixture is a complete,
//! valid v5 graph per case — this file parses it directly from
//! `serde_json::Value` into `NodeFacts`/`EdgeFacts` rather than going
//! through `project::BarnGraph`, matching `resolve_load`'s own decoupling
//! from the full node/edge model (module doc).

use super::*;
use serde_json::Value;

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/resolve_load_cases.json"
));

fn parse_role(role: &str) -> LoadRole {
    match role {
        "command" => LoadRole::Command,
        "skill" => LoadRole::Skill,
        _ => LoadRole::Other,
    }
}

fn parse_nodes(graph: &Value) -> Vec<NodeFacts> {
    graph["nodes"]
        .as_array()
        .expect("nodes array")
        .iter()
        .map(|n| NodeFacts {
            id: n["id"].as_str().unwrap().to_string(),
            role: parse_role(n["role"].as_str().unwrap_or("")),
            root_always: n["rootLoad"].as_str() == Some("always"),
            deprecated: n.get("deprecated").is_some(),
        })
        .collect()
}

fn parse_guard(edge: &Value) -> GuardKind {
    match edge.get("guard").and_then(|g| g["type"].as_str()) {
        Some("glob") => GuardKind::Glob,
        Some("description") => GuardKind::Description,
        _ => GuardKind::None,
    }
}

fn parse_edge_kind(kind: &str) -> LoadEdgeKind {
    match kind {
        "imports" => LoadEdgeKind::Imports,
        "references" => LoadEdgeKind::References,
        _ => LoadEdgeKind::Other,
    }
}

fn parse_edges(graph: &Value) -> Vec<EdgeFacts> {
    graph["edges"]
        .as_array()
        .expect("edges array")
        .iter()
        .map(|e| EdgeFacts {
            id: e["id"].as_str().unwrap().to_string(),
            source: e["source"].as_str().unwrap().to_string(),
            target: e["target"].as_str().unwrap().to_string(),
            kind: parse_edge_kind(e["kind"].as_str().unwrap()),
            guard: parse_guard(e),
        })
        .collect()
}

#[test]
fn fixture_corpus_matches_both_entry_points() {
    let doc: Value = serde_json::from_str(FIXTURE).expect("valid fixture JSON");
    let cases = doc["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty(), "fixture must not be empty");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let mode = case["mode"].as_str().unwrap_or("apply");
        let nodes = parse_nodes(&case["graph"]);
        let edges = parse_edges(&case["graph"]);
        let expected = case["expected"].as_object().expect("expected object");

        assert_eq!(
            expected.len(),
            nodes.len(),
            "case '{name}': expected must name every node in the graph"
        );

        for (node_id, exp) in expected {
            let got = match mode {
                "apply" => resolve_load(node_id, &nodes, &edges),
                "ignore" => resolve_load_ignoring_role_lock(node_id, &nodes, &edges),
                other => panic!("case '{name}': unknown mode '{other}'"),
            };

            let exp_policy = exp["policy"].as_str().unwrap();
            let exp_reason = exp["reason"].as_str().unwrap();
            let exp_edge = exp.get("decidingEdgeId").and_then(Value::as_str);

            let got_policy = serde_json::to_value(got.policy).unwrap();
            let got_reason = serde_json::to_value(got.reason).unwrap();

            assert_eq!(
                got_policy.as_str().unwrap(),
                exp_policy,
                "case '{name}', node '{node_id}': policy mismatch (reason was {got_reason:?})"
            );
            assert_eq!(
                got_reason.as_str().unwrap(),
                exp_reason,
                "case '{name}', node '{node_id}': reason mismatch"
            );
            assert_eq!(
                got.deciding_edge_id.as_deref(),
                exp_edge,
                "case '{name}', node '{node_id}': decidingEdgeId mismatch"
            );
        }
    }
}

#[test]
fn resolve_load_ignoring_role_lock_has_exactly_one_call_site_outside_this_module() {
    // §18.4 gate, enforced mechanically rather than left to `rg` in CI:
    // walk src-tauri/src for the identifier, excluding this module's own
    // definition/tests and `compile.rs`'s one sanctioned call.
    let src_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    let mut hits: Vec<String> = Vec::new();
    fn walk(dir: &std::path::Path, hits: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, hits);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            if path.ends_with("resolve_load.rs") || path.to_string_lossy().contains("resolve_load") {
                continue;
            }
            // The guarantee this gate enforces (§8.3, F11) is about
            // PRODUCTION call sites only: a second one there would silently
            // delete a Cursor-only user's `.mdc` files. Every `#[cfg(test)]
            // mod tests;` file in this crate is named exactly `tests.rs`
            // (the codebase-wide convention) — a test calling the bypass to
            // assert both modes behave correctly (e.g. pushing the shared
            // `resolve_load_cases.json` corpus through the REAL
            // `compile.rs` projection, ignore-mode cases included — audit
            // D10) is legitimate verification work, not a second production
            // route, and must not trip this gate. Production files are
            // never named `tests.rs`, so this exclusion cannot hide a real
            // second call site.
            if path.file_name().and_then(|n| n.to_str()) == Some("tests.rs") {
                continue;
            }
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            for (i, line) in content.lines().enumerate() {
                // A real call/definition site has the identifier immediately
                // followed by `(`; a rustdoc intra-doc link
                // (`` [`...resolve_load_ignoring_role_lock`] ``) or prose
                // mention does not, and must not count against the gate.
                if line.contains("resolve_load_ignoring_role_lock(") {
                    hits.push(format!("{}:{}", path.display(), i + 1));
                }
            }
        }
    }
    walk(std::path::Path::new(src_dir), &mut hits);
    assert_eq!(
        hits.len(),
        1,
        "expected exactly one PRODUCTION call site outside resolve_load.rs, found: {hits:?}"
    );
    assert!(
        hits[0].replace('\\', "/").contains("/compile.rs:"),
        "the one production call site must be in compile.rs itself (not compile/tests.rs), found: {hits:?}"
    );
}

// ── D5 (audit) — `always_closure` must apply `role_lock` to SEEDS, not ──
// ── only to traversal targets ────────────────────────────────────────

/// Direct regression test for the specific line the audit named
/// (`resolve_load.rs`'s `always_closure` seed loop). This is deliberately
/// independent of `resolve_load_impl`/the JSON corpus: it proves the bug
/// fix at the exact function boundary that hid the bug from every OTHER
/// caller (`taskctx.rs`, `lint.rs`), neither of which pre-filters its own
/// seed list by role before calling `always_closure` — so this is the
/// function whose OWN behaviour must be correct, independent of any
/// caller's discipline.
#[test]
fn always_closure_excludes_a_command_seed_under_role_lock_apply() {
    let nodes = vec![
        NodeFacts {
            id: "cmd".to_string(),
            role: LoadRole::Command,
            root_always: true,
            deprecated: false,
        },
        NodeFacts {
            id: "d".to_string(),
            role: LoadRole::Other,
            root_always: false,
            deprecated: false,
        },
    ];
    let edges = vec![EdgeFacts {
        id: "e1-i".to_string(),
        source: "cmd".to_string(),
        target: "d".to_string(),
        kind: LoadEdgeKind::Imports,
        guard: GuardKind::None,
    }];

    // Apply: "cmd" must never enter the closure as a seed, so "d" (reached
    // only via "cmd") must not enter it either.
    let apply = always_closure(&nodes, &edges, &["cmd"], RoleLock::Apply);
    assert!(!apply.contains("cmd"), "a command node must never be a closure seed under Apply");
    assert!(!apply.contains("d"), "closure must not propagate through an excluded seed");

    // Ignore: the role lock does not apply (§8.3 — the emit_cursor-only
    // variant), so "cmd" IS a valid seed and "d" is reached transitively.
    let ignore = always_closure(&nodes, &edges, &["cmd"], RoleLock::Ignore);
    assert!(ignore.contains("cmd"));
    assert!(ignore.contains("d"));
}

// ── D10 (audit) — corpus gaps closed by fixture cases; this is the ──────
// ── production-projection half, which a JSON case cannot cover ─────────
//
// D10 also asks for a test that pushes a real `project::BarnGraph` /
// `compile::GraphIn` through each PRODUCTION projection rather than this
// file's own `parse_nodes`/`parse_edges` — that half lives in
// `src-tauri/src/compile/tests.rs` (this module's test parser is
// necessarily a second implementation of the same mapping; `compile.rs`'s
// own projection is what actually ships, so it needs its own corpus-driven
// test against the real `NodeIn`/`EdgeIn` deserializer, not a duplicate
// here). See `compile::tests::production_projection_matches_resolve_load_corpus`.
