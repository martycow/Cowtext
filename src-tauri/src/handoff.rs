//! Handoff: generate + write root-level `HANDOFF.md` via headless `claude -p`
//! (contract §8.3). Generation reuses the assemble [`Runner`] seam — the
//! Windows-safe spawn rules (stdin prompt, CREATE_NO_WINDOW, concurrent
//! writer) live in `assemble::ClaudeRunner`, never re-implemented here.
//!
//! Trust boundary: `handoff_generate` only *reads*; the write happens
//! exclusively through `handoff_write` after the modal's diff approval,
//! with an allowlist of exactly root-level `HANDOFF.md` and a mandatory
//! GENERATED header.

#[cfg(test)]
mod tests;

use crate::assemble::Runner;
use crate::compile::GENERATED_HEADER;
use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Arc;
use tauri::State;

/// The one path this module may write.
const HANDOFF_REL_PATH: &str = "HANDOFF.md";

/// Newest events kept in the prompt (frontend already caps at 100 and
/// filters demo rows; this is a defensive mirror).
const MAX_EVENTS: usize = 100;

/// Handoff's own runner seam — same ClaudeRunner instance class as assemble,
/// injected in lib.rs setup; tests inject fakes.
pub struct HandoffRunner(pub Arc<dyn Runner>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffResult {
    pub content: String,
    pub old_content: Option<String>,
}

// ── Input model (tolerant subsets, per-module serde — recon convention) ─

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct GraphIn {
    project_name: String,
    nodes: Vec<NodeIn>,
    edges: Vec<EdgeIn>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct NodeIn {
    id: String,
    title: String,
    role: String,
    brief: String,
    file_path: String,
    read_order: i64,
    pinned: bool,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct EdgeIn {
    source: String,
    target: String,
    kind: String,
}

/// One row of the frontend event ring (`{ kind, filePath?, ts }`).
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct EventIn {
    kind: String,
    file_path: Option<String>,
    /// Unix millis.
    ts: u64,
}

// ── Prompt ────────────────────────────────────────────────────────────

fn title_of<'a>(graph: &'a GraphIn, id: &'a str) -> &'a str {
    graph
        .nodes
        .iter()
        .find(|n| n.id == id)
        .map_or(id, |n| n.title.as_str())
}

/// "3m ago"-style age from milliseconds.
fn humanize_age(ms: u64) -> String {
    let s = ms / 1000;
    if s < 60 {
        "just now".to_string()
    } else if s < 3600 {
        format!("{}m ago", s / 60)
    } else if s < 86_400 {
        format!("{}h ago", s / 3600)
    } else {
        format!("{}d ago", s / 86_400)
    }
}

/// Section names are frozen by the contract (§8.3); wording is ours.
fn build_handoff_prompt(graph: &GraphIn, events: &[EventIn], now_ms: u64) -> String {
    let mut lines: Vec<String> = vec![
        "You are writing a project handoff document.".to_string(),
        format!("Project: \"{}\".", graph.project_name),
        String::new(),
        "Context graph nodes (in read order):".to_string(),
    ];
    let mut nodes: Vec<&NodeIn> = graph.nodes.iter().collect();
    nodes.sort_by(|a, b| (a.read_order, &a.id).cmp(&(b.read_order, &b.id)));
    for n in &nodes {
        let pinned = if n.pinned { ", pinned" } else { "" };
        let brief = if n.brief.is_empty() {
            String::new()
        } else {
            format!(" — {}", n.brief)
        };
        lines.push(format!(
            "- {} (role: {}{pinned}, file: {}){brief}",
            n.title, n.role, n.file_path
        ));
    }
    if !graph.edges.is_empty() {
        lines.push(String::new());
        lines.push("Edges between nodes:".to_string());
        for e in &graph.edges {
            lines.push(format!(
                "- {} —{}→ {}",
                title_of(graph, &e.source),
                e.kind,
                title_of(graph, &e.target)
            ));
        }
    }
    let recent = &events[events.len().saturating_sub(MAX_EVENTS)..];
    if !recent.is_empty() {
        lines.push(String::new());
        lines.push("Recent agent activity (oldest first):".to_string());
        for ev in recent {
            let path = ev
                .file_path
                .as_deref()
                .map(|p| format!(" {p}"))
                .unwrap_or_default();
            lines.push(format!(
                "- {}{path} ({})",
                ev.kind,
                humanize_age(now_ms.saturating_sub(ev.ts))
            ));
        }
    }
    lines.push(String::new());
    lines.push(
        "From this graph and activity, write a concise handoff for the next \
         session. Output ONLY markdown, with exactly these four `##` sections \
         and nothing before or after them:"
            .to_string(),
    );
    lines.push("## Current state".to_string());
    lines.push("## Decisions made".to_string());
    lines.push("## Open threads".to_string());
    lines.push("## Next actions".to_string());
    lines.join("\n")
}

// ── Generate ──────────────────────────────────────────────────────────

/// Body of `handoff_generate`, seam-injected for tests.
async fn generate_inner(
    runner: &dyn Runner,
    root: &str,
    graph_json: &str,
    events_json: &str,
) -> Result<HandoffResult, String> {
    let root_path = checked_root(root)?;
    let graph: GraphIn =
        serde_json::from_str(graph_json).map_err(|e| format!("graph.json: {e}"))?;
    let events: Vec<EventIn> =
        serde_json::from_str(events_json).map_err(|e| format!("events: {e}"))?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let prompt = build_handoff_prompt(&graph, &events, now_ms);
    let body = runner.run(prompt).await?;
    let mut content = format!("{GENERATED_HEADER}\n\n# HANDOFF\n\n{}", body.trim_start());
    if !content.ends_with('\n') {
        content.push('\n');
    }
    let old_path = root_path.join(HANDOFF_REL_PATH);
    let old_content = if old_path.is_file() {
        Some(fs::read_to_string(&old_path).map_err(|e| format!("{HANDOFF_REL_PATH}: {e}"))?)
    } else {
        None
    };
    Ok(HandoffResult {
        content,
        old_content,
    })
}

#[tauri::command]
pub async fn handoff_generate(
    state: State<'_, HandoffRunner>,
    root: String,
    graph_json: String,
    events_json: String,
) -> Result<HandoffResult, String> {
    generate_inner(state.0.as_ref(), &root, &graph_json, &events_json).await
}

// ── Write ─────────────────────────────────────────────────────────────

/// Own header check (contract §8.3: don't reach into compile.rs private
/// fns). First 10 trimmed lines, same tolerance as compile's.
fn has_generated_header(content: &str) -> bool {
    content.lines().take(10).any(|l| l.trim() == GENERATED_HEADER)
}

/// Body of `handoff_write` with the rel path explicit, so the allowlist is
/// unit-testable. The command only ever passes `HANDOFF_REL_PATH`.
fn write_inner(root: &str, rel_path: &str, content: &str) -> Result<String, String> {
    if rel_path != HANDOFF_REL_PATH {
        return Err(format!(
            "Refusing to write outside root-level HANDOFF.md: {rel_path}"
        ));
    }
    if !has_generated_header(content) {
        return Err("Refusing to write HANDOFF.md without the GENERATED header".to_string());
    }
    let path = resolve_within_root(&checked_root(root)?, rel_path)?;
    write_atomic(&path, content)?;
    Ok(HANDOFF_REL_PATH.to_string())
}

#[tauri::command]
pub fn handoff_write(root: String, content: String) -> Result<String, String> {
    write_inner(&root, HANDOFF_REL_PATH, &content)
}
