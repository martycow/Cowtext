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
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
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

// ── Handoff → node (§6) ──────────────────────────────────────────────────
//
// `handoff_node_propose` is deterministic and does not call an LLM
// (contract §6): it is a sibling entry point to `handoff_generate` above,
// not a variant of it, so it takes a frontend-supplied session summary
// rather than a registry lookup — `handoff.rs` needs nothing from
// `sessions.rs`.

/// Frontend-supplied session summary (§6) — deliberately not a registry
/// lookup, so this module has zero dependency on `sessions.rs`. Every field
/// is read by `handoff_node_propose` below (title, `meta`, and the
/// provenance block of `content`).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HandoffSessionInput {
    pub id: String,
    pub name: String,
    pub agent_file_name: Option<String>,
    pub cwd: String,
    pub claude_session_id: Option<String>,
    pub tokens_used: u64,
}

/// A **proposal** — Rust writes nothing (contract §1.12, §6). The frontend
/// commits it via `createNodeFrom` + `updateNode` + `beginConnection` /
/// `confirmConnection`, using only existing `src/store/graph.ts` actions;
/// that file is edited by no WO06 lane.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HandoffNodeProposal {
    /// "Handoff — <session name> — <taskId or session id>".
    pub title: String,
    /// "context/handoff/<slug>.md", collision-free (…-2, …-3, …).
    pub rel_path: String,
    /// ALWAYS "reference".
    pub role: String,
    /// One line, ≤ 120 chars.
    pub brief: String,
    /// Provenance block + summary, LF, trailing newline.
    pub content: String,
    /// The WO03-reserved extension map (scalars only, sorted keys, no v4):
    /// `source`, `session`, `agent`, `task`, `producedAt`, `tokens`.
    pub meta: BTreeMap<String, String>,
    /// First entry of `tasklinks[taskId].nodeIds` (byte-order sorted), or
    /// `None`.
    pub anchor_node_id: Option<String>,
}

/// Directory every proposed handoff node lands under, relative to the
/// project root (§6). The proposal never writes here itself — this is only
/// used to pick a collision-free `rel_path` a caller's later `createNodeFrom`
/// won't stomp on.
const HANDOFF_NODE_DIR: &str = "context/handoff";

#[tauri::command]
pub fn handoff_node_propose(
    root: String,
    session: HandoffSessionInput,
    task_id: Option<String>,
    summary: String,
) -> Result<HandoffNodeProposal, String> {
    let root_path = checked_root(&root)?;

    let task_id = task_id.filter(|t| !t.trim().is_empty());
    // `session` id: `claudeSessionId` (durable) if present, else the in-memory
    // `as<N>` id — same fallback rule as `TaskLink.sessionIds` (§3.2 L3),
    // reused here for both `meta.session` and the title/content fallback.
    let session_label = session
        .claude_session_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(session.id.as_str())
        .to_string();
    let ident = task_id.clone().unwrap_or_else(|| session_label.clone());
    let title = format!("Handoff — {} — {ident}", session.name);
    let rel_path = unique_handoff_rel_path(&root_path, &title);

    let agent = session
        .agent_file_name
        .as_deref()
        .and_then(|f| Path::new(f).file_stem())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let produced_at = iso8601_utc_now();

    let mut meta: BTreeMap<String, String> = BTreeMap::new();
    meta.insert("source".to_string(), "handoff".to_string());
    meta.insert("session".to_string(), session_label.clone());
    meta.insert("agent".to_string(), agent.clone());
    meta.insert("task".to_string(), task_id.clone().unwrap_or_default());
    meta.insert("producedAt".to_string(), produced_at.clone());
    meta.insert("tokens".to_string(), session.tokens_used.to_string());

    let brief = brief_line(&summary, &session.name);
    let content = build_handoff_node_content(
        &title,
        &session,
        &session_label,
        &agent,
        task_id.as_deref(),
        &produced_at,
        &summary,
    );
    let anchor_node_id = task_id
        .as_deref()
        .and_then(|tid| anchor_for_task(&root_path, tid));

    Ok(HandoffNodeProposal {
        title,
        rel_path,
        role: "reference".to_string(),
        brief,
        content,
        meta,
        anchor_node_id,
    })
}

/// First non-empty line of `summary`, trimmed and capped at 120 chars (§6);
/// falls back to a name derived from the session when `summary` is blank —
/// a proposal always carries a usable one-liner, never an empty brief.
fn brief_line(summary: &str, session_name: &str) -> String {
    let first = summary.lines().map(str::trim).find(|l| !l.is_empty());
    let line = first.map(str::to_string).unwrap_or_else(|| {
        format!("Handoff proposal from session \"{session_name}\"")
    });
    truncate_chars(&line, 120)
}

/// Char-count (not byte-count) truncation — `summary` is user/LLM prose, so
/// counting bytes could split a multi-byte character; `chars().take(n)`
/// never does.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Provenance block + summary (§6), LF, trailing newline. Freeform beyond
/// the frozen `meta` keys — this is markdown body text, not a wire shape.
fn build_handoff_node_content(
    title: &str,
    session: &HandoffSessionInput,
    session_label: &str,
    agent: &str,
    task_id: Option<&str>,
    produced_at: &str,
    summary: &str,
) -> String {
    let agent_label = if agent.is_empty() { "(none)" } else { agent };
    let task_label = task_id.unwrap_or("(none)");
    let mut lines: Vec<String> = vec![
        format!("# {title}"),
        String::new(),
        "**Source:** handoff".to_string(),
        format!("**Session:** {session_label}"),
        format!("**Agent:** {agent_label}"),
        format!("**Task:** {task_label}"),
        format!("**Working directory:** {}", session.cwd),
        format!("**Produced:** {produced_at}"),
        format!("**Tokens used:** {}", session.tokens_used),
        String::new(),
        "---".to_string(),
        String::new(),
    ];
    let trimmed = summary.trim();
    lines.push(if trimmed.is_empty() {
        "(no summary provided)".to_string()
    } else {
        trimmed.to_string()
    });
    let mut content = lines.join("\n");
    if !content.ends_with('\n') {
        content.push('\n');
    }
    content
}

/// Picks `context/handoff/<slug(title)>.md`, or `-2`/`-3`/… the moment a
/// candidate already exists on disk (§6: "collision-free"). Read-only —
/// this command writes nothing; the peek only keeps the proposal from
/// naming a file the caller's next `createNodeFrom` would collide with.
/// `slugify` never fails to produce *something* usable here because `title`
/// always contains at least the session name or a fallback ident; the
/// defensive `unwrap_or_else` mirrors how other lanes treat a slug that
/// somehow comes back empty.
fn unique_handoff_rel_path(root: &Path, title: &str) -> String {
    let slug = crate::preset::slugify(title).unwrap_or_else(|_| "handoff".to_string());
    for n in 0..1000u32 {
        let candidate = if n == 0 {
            format!("{HANDOFF_NODE_DIR}/{slug}.md")
        } else {
            format!("{HANDOFF_NODE_DIR}/{slug}-{}.md", n + 1)
        };
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    // Exhausted 1000 collision-free attempts (should never happen in
    // practice) — fall back to a path keyed on the current instant, which
    // cannot collide with anything minted before it.
    format!(
        "{HANDOFF_NODE_DIR}/{slug}-{}.md",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

/// Best-effort anchor lookup (§6): `tasklinks[taskId].nodeIds`, byte-order
/// smallest, or `None`. Unlike `task_context_preview`'s tolerant reader, a
/// corrupt or unreadable sidecar here degrades to `None` rather than an
/// `Err` — the anchor is optional decoration on a **proposal** (Rust writes
/// nothing regardless, §1.12), not a value the caller depends on to
/// succeed. Reads `.cowtext/tasklinks.json` directly rather than calling
/// `tasklinks::tasklinks_read` — same independent-lane rationale
/// `taskctx.rs` documents for its own private reader.
fn anchor_for_task(root: &Path, task_id: &str) -> Option<String> {
    let raw = fs::read_to_string(root.join(crate::tasklinks::TASKLINKS_REL_PATH)).ok()?;
    let doc: crate::tasklinks::TaskLinks = serde_json::from_str(&raw).ok()?;
    if doc.version > crate::tasklinks::TASKLINKS_VERSION {
        return None;
    }
    doc.links
        .iter()
        .find(|l| l.task_id == task_id)
        .and_then(|l| l.node_ids.iter().min().cloned())
}

/// Current instant as `YYYY-MM-DDTHH:MM:SSZ` (§6 `meta.producedAt`). Howard
/// Hinnant's `civil_from_days` (public domain,
/// http://howardhinnant.github.io/date_algorithms.html), the inverse of
/// `lint.rs`'s `days_from_civil` — used in place of a date/time crate since
/// this repo adds no new dependencies (contract §1.16) and this is the only
/// calculation that would need one.
fn iso8601_utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let time_of_day = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    let hh = time_of_day / 3600;
    let mm = (time_of_day % 3600) / 60;
    let ss = time_of_day % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Days since 1970-01-01 back to a proleptic-Gregorian `(y, m, d)`. See
/// [`iso8601_utc_now`] for provenance; a straight algorithmic inverse of
/// `lint.rs::days_from_civil`.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
