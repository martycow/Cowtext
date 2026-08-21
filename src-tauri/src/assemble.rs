//! Assemble: expand node briefs into full files via headless `claude -p`
//! (plan §6). A FIFO queue drives at most two concurrent child processes.
//!
//! Invariants this module owns:
//! - **Err only at enqueue time**: commands return `Err` for the four
//!   enqueue-time failures (bad root, bad graph JSON, unknown node,
//!   duplicate). Everything after enqueue travels as `assemble://status`
//!   events — a job never produces a command error.
//! - **One write target**: a job writes ONLY to its node's `filePath`,
//!   resolved through `resolve_within_root`, and only when that path ends
//!   in `.md` (case-insensitive). No other write exists in this module.
//! - **Testable spawn**: the `claude -p` child sits behind the [`Runner`]
//!   trait so the queue logic runs under unit tests with a fake runner.

#[cfg(test)]
mod tests;

use crate::frontmatter;
use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, State};

/// Settings-provided absolute path to the claude binary (contract §1-S4).
static CLAUDE_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Settings-provided absolute path to the claude binary. None = auto-resolve.
pub fn set_claude_override(p: Option<PathBuf>) {
    *CLAUDE_OVERRIDE.lock().unwrap() = p;
}

pub(crate) fn claude_override() -> Option<PathBuf> {
    CLAUDE_OVERRIDE.lock().unwrap().clone()
}

/// Hard cap on concurrent `claude -p` children (plan §6).
const MAX_CONCURRENT: usize = 2;

/// Tauri event channel for job progress.
const STATUS_EVENT: &str = "assemble://status";

// ── Wire types (camelCase, mirrored in src/assemble/types.ts) ─────────

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AssembleMode {
    Assemble,
    Refine,
    Summarize,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssembleJobInfo {
    pub node_id: String,
    pub mode: AssembleMode,
    pub status: JobStatus,
}

/// Emitted on every job transition: queued → running → assembled | error.
///
/// WO13_CONTRACT.md §3.3 (defect 5): `status` stays UNCHANGED and
/// authoritative for `setAssembleStatus` — `phase` and `started_at` are
/// additive telemetry so `MemoryNodeCard` can render a real 3-step stepper
/// (`starting → running → writing`) with a live elapsed readout instead of
/// an indeterminate blink over a non-streaming, one-shot runner. No
/// percentage is invented — there is still no denominator.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssembleProgress {
    pub node_id: String,
    /// "queued" | "running" | "assembled" | "error"
    pub status: String,
    /// "queued" | "starting" | "running" | "writing" | "done" | "error"
    pub phase: String,
    /// Epoch ms the job entered "starting"; `None` only for the initial
    /// "queued" event, `Some` from "starting" onward and left unchanged by
    /// every later phase of the same job (so the card can compute elapsed
    /// time without re-basing it on each event).
    pub started_at: Option<u64>,
    /// Set only when `status == "error"`; serialized as `null` otherwise
    /// (the TS mirror declares `error: string | null` — contract §1.1).
    pub error: Option<String>,
}

/// Epoch milliseconds "now", clamped to 0 on a clock that predates the Unix
/// epoch (never happens in practice; avoids an `unwrap` panic over a
/// display-only timestamp).
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The exact prompt `assemble_node`/`refine_node`/`summarize_node` would
/// pipe to `claude -p` stdin, plus enough to render the confirmation gate
/// (F7): target path, current content (`None` = will create), and neighbor
/// titles for context.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssemblePreview {
    pub prompt: String,
    pub rel_path: String,
    pub old_content: Option<String>,
    pub neighbors: Vec<String>,
    pub mode: AssembleMode,
}

// ── Input model (tolerant subset of graph.json, plan §4) ──────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphIn {
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    nodes: Vec<NodeIn>,
    #[serde(default)]
    edges: Vec<EdgeIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeIn {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    brief: String,
    file_path: String,
    // ── D5: the rest of the wire shape, previously silently dropped by
    // serde (every one of these is already sent by both TS callers'
    // `stableNode`/`serializeGraph`, src/store/graph.ts) ────────────────
    /// v5: replaces `pinned: bool` on the wire (WO13_CONTRACT.md §4.1). The
    /// only legal value is `Some("always")`; a `pinned` bool read here
    /// forever would silently deserialize `false` since that key no longer
    /// exists (D11a) — this field, not `pinned`, is what
    /// [`resolve_load::NodeFacts::root_always`] is built from.
    #[serde(default)]
    root_load: Option<String>,
    #[serde(default)]
    read_order: i64,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    owner: String,
    /// v5: presence (regardless of contents) is all `resolve_load` needs
    /// (WO13_CONTRACT.md §8.1 rule 2 — deprecated outranks everything else).
    #[serde(default)]
    deprecated: Option<serde_json::Value>,
    #[serde(default)]
    meta: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EdgeIn {
    #[serde(default)]
    id: String,
    source: String,
    target: String,
    #[serde(default)]
    kind: String,
    /// v5: presence + `type` discriminant is all `resolve_load` needs
    /// (`resolve_load::GuardKind`) — the `globs`/`text` payload itself is
    /// irrelevant to load-policy resolution.
    #[serde(default)]
    guard: Option<GuardIn>,
}

/// Just enough of the v5 `guard` shape (`{ type: "glob" | "description",
/// ... }`) for [`resolve_load::GuardKind`] — extra keys (`globs`/`text`)
/// are ignored by serde's default (non-`deny_unknown_fields`) behavior.
#[derive(Deserialize)]
struct GuardIn {
    #[serde(rename = "type")]
    kind: String,
}

// ── Queue core ────────────────────────────────────────────────────────

/// One 1-hop neighbor of the job's node: title/brief/role plus the
/// connecting edge's kind and its direction relative to this node. Deduped
/// by neighbor node — first connecting edge wins — in graph node order
/// (deterministic prompts, kept from the pre-D5 behavior).
#[derive(Debug, Clone, PartialEq)]
struct NeighborInfo {
    title: String,
    brief: String,
    role: String,
    edge_kind: String,
    /// true when this job's node is the edge's `source` (this -> neighbor).
    outgoing: bool,
}

/// Facts pulled from a `.claude/agents/*.md` node's frontmatter + body, and
/// its `.cowtext/agents.json` sidecar entry (D5). Populated only when the
/// job's `file_path` canonicalises under `.claude/agents/`; every read
/// failure along the way degrades this whole struct to `None` on the `Job`
/// — never an enqueue `Err` (module invariant, top of file).
#[derive(Debug, Clone)]
struct AgentFacts {
    name: Option<String>,
    description: Option<String>,
    model: Option<String>,
    tools: Vec<String>,
    skills: Vec<String>,
    duties: String,
    nickname: Option<String>,
    priority: Option<i64>,
}

/// Everything a job needs after enqueue; the graph snapshot is not kept.
#[derive(Debug)]
struct Job {
    node_id: String,
    mode: AssembleMode,
    root: PathBuf,
    file_path: String,
    project_name: String,
    title: String,
    role: String,
    brief: String,
    /// D11a: `resolve_load(node_id, ...).policy == Always` — the SAME
    /// decider `compile.rs`/`lint.rs`/`taskctx.rs` use, not the removed
    /// `pinned` wire field. Computed once in [`build_job`].
    always_in_context: bool,
    read_order: i64,
    tags: Vec<String>,
    owner: String,
    meta: serde_json::Map<String, serde_json::Value>,
    /// `Some` only for a `.claude/agents/*.md` node (D5).
    agent_facts: Option<AgentFacts>,
    /// 1-hop neighbors, in graph node order.
    neighbors: Vec<NeighborInfo>,
    /// Refine only.
    instruction: Option<String>,
}

#[derive(Default)]
struct Inner {
    queued: VecDeque<Job>,
    running: Vec<(String, AssembleMode)>,
}

/// Progress consumer. Commands wrap `app.emit`; tests capture into a channel.
pub type Sink = Arc<dyn Fn(AssembleProgress) + Send + Sync>;

/// The `claude -p` seam. Production uses [`ClaudeRunner`]; tests inject fakes.
pub trait Runner: Send + Sync {
    fn run(&self, prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>>;
}

/// Managed Tauri state: FIFO queue + the runner behind it.
pub struct AssembleQueue {
    inner: Arc<Mutex<Inner>>,
    runner: Arc<dyn Runner>,
}

impl AssembleQueue {
    pub fn new(runner: Arc<dyn Runner>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            runner,
        }
    }

    /// Validate, build the job, queue it, emit "queued", pump.
    /// The four `Err` cases here are the ONLY command errors in this module.
    fn enqueue(
        &self,
        sink: Sink,
        root: String,
        graph_json: String,
        node_id: String,
        mode: AssembleMode,
        instruction: Option<String>,
    ) -> Result<(), String> {
        let job = build_job(root, graph_json, node_id, mode, instruction)?;
        let job_node_id = job.node_id.clone();

        {
            let mut inner = self.inner.lock().expect("assemble queue mutex");
            let dup = inner.queued.iter().any(|j| j.node_id == job_node_id)
                || inner.running.iter().any(|(id, _)| *id == job_node_id);
            if dup {
                return Err(format!("Node already queued: {job_node_id}"));
            }
            inner.queued.push_back(job);
        }
        sink(AssembleProgress {
            node_id: job_node_id,
            status: "queued".to_string(),
            phase: "queued".to_string(),
            started_at: None,
            error: None,
        });
        pump(self.inner.clone(), self.runner.clone(), sink);
        Ok(())
    }

    /// Running jobs (start order) then queued jobs (FIFO order).
    fn status(&self) -> Vec<AssembleJobInfo> {
        let inner = self.inner.lock().expect("assemble queue mutex");
        let mut out = Vec::with_capacity(inner.running.len() + inner.queued.len());
        for (id, mode) in &inner.running {
            out.push(AssembleJobInfo {
                node_id: id.clone(),
                mode: *mode,
                status: JobStatus::Running,
            });
        }
        for j in &inner.queued {
            out.push(AssembleJobInfo {
                node_id: j.node_id.clone(),
                mode: j.mode,
                status: JobStatus::Queued,
            });
        }
        out
    }

    /// Remove a queued (not yet running) job. Running jobs are not killed.
    fn cancel(&self, node_id: &str) -> bool {
        let mut inner = self.inner.lock().expect("assemble queue mutex");
        let before = inner.queued.len();
        inner.queued.retain(|j| j.node_id != node_id);
        inner.queued.len() != before
    }
}

/// Validate `root`/`graph_json`/`node_id`, look up the node and its 1-hop
/// neighbors, and build the `Job`. Lifted out of `AssembleQueue::enqueue`
/// (F7) so `assemble_preview` can reach the same pure construction without
/// touching the queue or spawning anything. These three `Err`s (bad root,
/// bad graph JSON, unknown node) plus `enqueue`'s own duplicate check are
/// the four enqueue-time failures the module invariant refers to.
fn build_job(
    root: String,
    graph_json: String,
    node_id: String,
    mode: AssembleMode,
    instruction: Option<String>,
) -> Result<Job, String> {
    let root_path = checked_root(&root)?;
    let graph: GraphIn =
        serde_json::from_str(&graph_json).map_err(|e| format!("graph.json: {e}"))?;
    let node = graph
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or_else(|| format!("Unknown node: {node_id}"))?;

    let project_name = if graph.project_name.is_empty() {
        root_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone())
    } else {
        graph.project_name.clone()
    };
    let agent_facts = agent_facts_for(&root_path, &node.file_path);
    // D11a: "is this node always in context" now comes from the SAME
    // decider compile/lint/taskctx use, not a node field. Facts are
    // projected over the whole graph (resolve_load needs the edges to
    // decide, not just the one node) before `node`'s own borrow is
    // consumed below.
    let (rl_nodes, rl_edges) = resolve_load_facts(&graph);
    let always_in_context = crate::resolve_load::resolve_load(&node_id, &rl_nodes, &rl_edges).policy
        == crate::resolve_load::ResolvedLoad::Always;
    Ok(Job {
        node_id: node_id.clone(),
        mode,
        root: root_path,
        file_path: node.file_path.clone(),
        project_name,
        title: node.title.clone(),
        role: node.role.clone(),
        brief: node.brief.clone(),
        always_in_context,
        read_order: node.read_order,
        tags: node.tags.clone(),
        owner: node.owner.clone(),
        meta: node.meta.clone(),
        agent_facts,
        neighbors: neighbors_of(&graph, &node_id),
        instruction,
    })
}

/// True when `file_path` canonicalises under `.claude/agents/` — same
/// forward-slash/lowercase/prefix idiom as `project.rs::is_rename_protected`
/// and `write_md_file`'s agent guard (this codebase's standing rule for
/// this check, after prior defects from bare `==`/`split` comparisons).
fn is_agent_target(file_path: &str) -> bool {
    let normalized = file_path.replace('\\', "/").to_ascii_lowercase();
    normalized.starts_with(".claude/agents/") && normalized.ends_with(".md")
}

/// Populate `AgentFacts` for a `.claude/agents/*.md` node: frontmatter
/// fields + body from the file, nickname/priority from the
/// `.cowtext/agents.json` sidecar (same path `agents.rs` reads, `agents.rs`
/// :523; `influence` lives in that same sidecar but is deliberately not
/// read here — §3.2/D8). Every failure along the way — path escape,
/// missing file, missing or corrupt sidecar — degrades to `None`/absent
/// fields, never an `Err` (module invariant: only `build_job`'s four checks
/// may fail enqueue).
fn agent_facts_for(root: &Path, file_path: &str) -> Option<AgentFacts> {
    if !is_agent_target(file_path) {
        return None;
    }
    let target = resolve_within_root(root, file_path).ok()?;
    let content = fs::read_to_string(&target).ok()?;
    let doc = frontmatter::parse(&content);
    let fields = doc.fields();
    let file_name = file_path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(file_path)
        .to_string();
    let (nickname, priority) = agent_meta_facts(root, &file_name);
    Some(AgentFacts {
        name: fields.name,
        description: fields.description,
        model: fields.model,
        tools: fields.tools,
        skills: fields.skills,
        duties: doc.body.trim().to_string(),
        nickname,
        priority,
    })
}

/// Best-effort read of `<root>/.cowtext/agents.json`'s `agents[file_name]`
/// entry. No typed mirror of the TS `AgentMeta` exists in Rust today (D5) —
/// probed as `serde_json::Value` rather than adding one, since this is the
/// only Rust reader. A missing file, unparsable JSON, or absent/malformed
/// entry all quietly yield `(None, None)`.
///
/// WO13_CONTRACT.md §3.2 (D8): `influence` is deliberately NOT read here.
/// It is not local-only — this was the last reader that fed it into the
/// agent boot prompt, and Marty ruled the `local only` badge on it must be
/// true, not aspirational. The field survives in `.cowtext/agents.json` and
/// in the slider; it simply has no Rust consumer left.
fn agent_meta_facts(root: &Path, file_name: &str) -> (Option<String>, Option<i64>) {
    let meta_path = root.join(".cowtext").join("agents.json");
    let Ok(content) = fs::read_to_string(&meta_path) else {
        return (None, None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return (None, None);
    };
    let entry = value.get("agents").and_then(|a| a.get(file_name));
    let nickname = entry
        .and_then(|e| e.get("nickname"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let priority = entry.and_then(|e| e.get("priority")).and_then(|v| v.as_i64());
    (nickname, priority)
}

/// Project this module's own tolerant `GraphIn` onto `resolve_load`'s facts
/// (WO13_CONTRACT.md §8.3). D11a: the boot prompt's "always in context"
/// fact must come from the SAME decider `compile.rs`/`lint.rs`/`taskctx.rs`
/// use, not from a node field read under its old, removed name — see
/// [`build_job`]'s call site.
fn resolve_load_facts(graph: &GraphIn) -> (Vec<crate::resolve_load::NodeFacts>, Vec<crate::resolve_load::EdgeFacts>) {
    let nodes = graph
        .nodes
        .iter()
        .map(|n| crate::resolve_load::NodeFacts {
            id: n.id.clone(),
            role: match n.role.as_str() {
                "command" => crate::resolve_load::LoadRole::Command,
                "skill" => crate::resolve_load::LoadRole::Skill,
                _ => crate::resolve_load::LoadRole::Other,
            },
            root_always: n.root_load.as_deref() == Some("always"),
            deprecated: n.deprecated.is_some(),
        })
        .collect();
    let edges = graph
        .edges
        .iter()
        .map(|e| crate::resolve_load::EdgeFacts {
            id: e.id.clone(),
            source: e.source.clone(),
            target: e.target.clone(),
            kind: match e.kind.as_str() {
                "imports" => crate::resolve_load::LoadEdgeKind::Imports,
                "references" => crate::resolve_load::LoadEdgeKind::References,
                _ => crate::resolve_load::LoadEdgeKind::Other,
            },
            guard: match e.guard.as_ref().map(|g| g.kind.as_str()) {
                None => crate::resolve_load::GuardKind::None,
                Some("glob") => crate::resolve_load::GuardKind::Glob,
                Some(_) => crate::resolve_load::GuardKind::Description,
            },
        })
        .collect();
    (nodes, edges)
}

/// 1-hop neighbors of `node_id` over edges of any kind, either direction,
/// deduped by neighbor node (first connecting edge wins), in graph node
/// order (deterministic prompts).
fn neighbors_of(graph: &GraphIn, node_id: &str) -> Vec<NeighborInfo> {
    graph
        .nodes
        .iter()
        .filter(|n| n.id != node_id)
        .filter_map(|n| {
            let edge = graph.edges.iter().find(|e| {
                (e.source == node_id && e.target == n.id)
                    || (e.target == node_id && e.source == n.id)
            })?;
            Some(NeighborInfo {
                title: n.title.clone(),
                brief: n.brief.clone(),
                role: n.role.clone(),
                edge_kind: edge.kind.clone(),
                outgoing: edge.source == node_id,
            })
        })
        .collect()
}

/// Start queued jobs while a concurrency slot is free. Each finished job
/// re-pumps, so the queue drains without a scheduler task.
fn pump(inner: Arc<Mutex<Inner>>, runner: Arc<dyn Runner>, sink: Sink) {
    loop {
        let job = {
            let mut guard = inner.lock().expect("assemble queue mutex");
            if guard.running.len() >= MAX_CONCURRENT {
                return;
            }
            let Some(job) = guard.queued.pop_front() else {
                return;
            };
            guard.running.push((job.node_id.clone(), job.mode));
            job
        };
        let inner2 = inner.clone();
        let runner2 = runner.clone();
        let sink2 = sink.clone();
        tauri::async_runtime::spawn(async move {
            // §3.3: "starting" fires before `run_job` runs at all; the
            // timestamp taken here is threaded through every later event of
            // this same job (`run_job`'s "running"/"writing", and this
            // closure's own terminal event) so the card's elapsed readout
            // has one stable origin.
            let started_at = now_ms();
            sink2(AssembleProgress {
                node_id: job.node_id.clone(),
                status: "running".to_string(),
                phase: "starting".to_string(),
                started_at: Some(started_at),
                error: None,
            });
            let outcome = run_job(&job, runner2.as_ref(), &sink2, started_at).await;
            // Free the slot before the terminal event so `assemble_status`
            // never reports a finished job as running.
            inner2
                .lock()
                .expect("assemble queue mutex")
                .running
                .retain(|(id, _)| *id != job.node_id);
            sink2(match outcome {
                Ok(()) => AssembleProgress {
                    node_id: job.node_id.clone(),
                    status: "assembled".to_string(),
                    phase: "done".to_string(),
                    started_at: Some(started_at),
                    error: None,
                },
                Err(e) => AssembleProgress {
                    node_id: job.node_id.clone(),
                    status: "error".to_string(),
                    phase: "error".to_string(),
                    started_at: Some(started_at),
                    error: Some(e),
                },
            });
            pump(inner2, runner2, sink2);
        });
    }
}

/// Guard the path, build the prompt, run claude, write the result.
///
/// WO13_CONTRACT.md §3.3: takes the `Sink` and the job's `started_at` so it
/// can emit the "running" phase right before the child spawns (inside
/// `runner.run`) and "writing" once that call returns, before the on-disk
/// write — the two real, non-fabricated transitions between "starting" and
/// the terminal event `pump` emits.
async fn run_job(job: &Job, runner: &dyn Runner, sink: &Sink, started_at: u64) -> Result<(), String> {
    if !job.file_path.to_lowercase().ends_with(".md") {
        return Err(format!(
            "Refusing to write non-markdown file: {}",
            job.file_path
        ));
    }
    let target = resolve_within_root(&job.root, &job.file_path)?;
    let current = if job.mode == AssembleMode::Summarize {
        Some(fs::read_to_string(&target).map_err(|e| format!("{}: {e}", job.file_path))?)
    } else {
        None
    };
    let prompt = build_prompt(job, current.as_deref());
    sink(AssembleProgress {
        node_id: job.node_id.clone(),
        status: "running".to_string(),
        phase: "running".to_string(),
        started_at: Some(started_at),
        error: None,
    });
    let mut content = runner.run(prompt).await?;
    if !content.ends_with('\n') {
        content.push('\n');
    }
    sink(AssembleProgress {
        node_id: job.node_id.clone(),
        status: "running".to_string(),
        phase: "writing".to_string(),
        started_at: Some(started_at),
        error: None,
    });
    if is_agent_target(&job.file_path) {
        // `.claude/agents/*.md` is owned by `agent_save`'s frontmatter
        // read-patch-write emitter (ONE_WRITER doctrine, agents.rs :112-121)
        // — a whole-file write here would destroy that file's frontmatter.
        // Patch only the body; a missing/empty file has no frontmatter to
        // preserve, and `frontmatter::patch` degrades to a body-only write
        // in that case (matches `write_atomic`'s own create-or-replace).
        let current_full = fs::read_to_string(&target).unwrap_or_default();
        let patched = frontmatter::patch(&current_full, None, Some(&content))?;
        write_atomic(&target, &patched)
    } else {
        write_atomic(&target, &content)
    }
}

/// `serde_json::Value::to_string` quotes strings; unwrap that one case so
/// `Meta:` reads as plain text instead of embedded JSON.
fn meta_value_str(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Prompt per plan §6: project name, node role + title, brief (or, for
/// Summarize, the current file content with a compress instruction),
/// titles+briefs of 1-hop neighbors, target ≤ 60 lines. Refine appends
/// the user instruction.
///
/// D5: after the `Node:` line, every other graph-carried field the model
/// might need is emitted too — SKIPPING empties, so an ordinary node with
/// no tags/owner/always-in-context/readOrder/meta produces a byte-identical
/// prompt to before D5. A `.claude/agents/*.md` node additionally gets an
/// `Agent:` block (name/description/model/priority/tools/skills/duties —
/// `influence` deliberately excluded, WO13_CONTRACT.md §3.2/D8: it is not
/// local-only, so it does not belong in a prompt that leaves the machine).
///
/// D11a: `job.always_in_context` is `resolve_load`'s answer, not the
/// removed `pinned` field — see [`build_job`]/[`resolve_load_facts`]. A
/// stale `pinned` read here always deserialized `false`, so this line had
/// silently never fired for any node since the v5 migration.
fn build_prompt(job: &Job, current_content: Option<&str>) -> String {
    let mut lines: Vec<String> = vec![
        format!(
            "You are writing `{}`, one context file of the project \"{}\".",
            job.file_path, job.project_name
        ),
        format!("Node: {} (role: {}).", job.title, job.role),
    ];
    if job.always_in_context {
        lines.push("Always in context: this file is included in every request.".to_string());
    }
    if job.read_order != 0 {
        lines.push(format!(
            "Read order: position {} in the compiled read order.",
            job.read_order
        ));
    }
    if !job.tags.is_empty() {
        lines.push(format!("Tags: {}.", job.tags.join(", ")));
    }
    if !job.owner.is_empty() {
        lines.push(format!("Owner: {}.", job.owner));
    }
    if !job.meta.is_empty() {
        let mut keys: Vec<&String> = job.meta.keys().collect();
        keys.sort();
        let rendered: Vec<String> = keys
            .into_iter()
            .map(|k| format!("{k}: {}", meta_value_str(&job.meta[k])))
            .collect();
        lines.push(format!("Meta: {}.", rendered.join("; ")));
    }
    if let Some(af) = &job.agent_facts {
        lines.push(String::new());
        lines.push("Agent:".to_string());
        if let Some(name) = &af.name {
            lines.push(format!("- Name: {name}"));
        }
        if let Some(nickname) = &af.nickname {
            lines.push(format!("- Nickname: {nickname}"));
        }
        if let Some(description) = &af.description {
            lines.push(format!("- Description: {description}"));
        }
        if let Some(model) = &af.model {
            lines.push(format!("- Model: {model}"));
        }
        if let Some(priority) = af.priority {
            lines.push(format!("- Priority: {priority}"));
        }
        if !af.tools.is_empty() {
            lines.push(format!("- Tools: {}", af.tools.join(", ")));
        }
        if !af.skills.is_empty() {
            lines.push(format!("- Skills: {}", af.skills.join(", ")));
        }
        if !af.duties.is_empty() {
            lines.push("- Duties:".to_string());
            lines.push(af.duties.clone());
        }
    }
    // A blank separator only when something was actually added above (facts
    // and/or an Agent block) — an ordinary node with none of those still
    // goes straight from `Node:` to `Brief:`/`Compress…`, byte-identical to
    // the pre-D5 prompt.
    if lines.len() > 2 {
        lines.push(String::new());
    }
    if job.mode == AssembleMode::Summarize {
        lines.push(
            "Compress the current file content below: keep every rule and fact that matters, \
             drop filler and redundancy."
                .to_string(),
        );
        lines.push(String::new());
        lines.push("Current file content:".to_string());
        lines.push(current_content.unwrap_or("").trim_end().to_string());
    } else {
        lines.push(format!("Brief: {}", job.brief));
    }
    if !job.neighbors.is_empty() {
        lines.push(String::new());
        lines.push("Neighboring nodes in the context graph (1 hop):".to_string());
        for nb in &job.neighbors {
            let dir_word = if nb.outgoing { "->" } else { "<-" };
            let kind = if nb.edge_kind.is_empty() {
                "related"
            } else {
                nb.edge_kind.as_str()
            };
            let mut line = if nb.brief.is_empty() {
                format!("- {}", nb.title)
            } else {
                format!("- {}: {}", nb.title, nb.brief)
            };
            line.push_str(&format!(" [{dir_word} {kind}"));
            if !nb.role.is_empty() {
                line.push_str(&format!(", role: {}", nb.role));
            }
            line.push(']');
            lines.push(line);
        }
    }
    if let Some(instruction) = &job.instruction {
        lines.push(String::new());
        lines.push(format!("Additional instruction: {instruction}"));
    }
    lines.push(String::new());
    lines.push(
        "Write the complete markdown file content, at most 60 lines. \
         Output only the file content — no preamble, no code fences."
            .to_string(),
    );
    lines.join("\n")
}

// ── Production runner: headless `claude -p` ───────────────────────────

/// Spawns `claude -p --output-format json` with the prompt piped over
/// stdin. Windows-safe: resolves the claude binary via `where claude` at
/// first use (cached, `.exe` preferred over `.cmd`); falls back to
/// `cmd /C claude ...`. Never spawns bare `"claude"` on Windows
/// (CreateProcess will not find a `.cmd`). The prompt must NOT travel as
/// an argv argument: Rust rejects `.cmd`/`.bat` arguments containing
/// newlines (CVE-2024-24576 hardening) and every prompt is multi-line.
#[derive(Default)]
pub struct ClaudeRunner {
    resolved: OnceLock<Option<PathBuf>>,
}

impl ClaudeRunner {
    fn claude_path(&self) -> Option<PathBuf> {
        self.resolved.get_or_init(resolve_claude).clone()
    }
}

#[cfg(windows)]
pub(crate) fn resolve_claude() -> Option<PathBuf> {
    where_probe("claude")
}

/// `where <name>` probe, `.exe` preferred over `.cmd`. Shared with
/// settings.rs, which resolves a bare-name override the same way (a bare
/// name in `claudeBinaryPath` would otherwise never find an npm `.cmd`
/// shim — CreateProcess only appends `.exe`).
#[cfg(windows)]
pub(crate) fn where_probe(name: &str) -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("where")
        .arg(name)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — no console flash in release
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    // Prefer a native .exe over the npm .cmd shim: batch files carry the
    // CVE-2024-24576 argument restrictions and an extra cmd.exe hop.
    lines
        .iter()
        .find(|l| l.to_lowercase().ends_with(".exe"))
        .or_else(|| lines.iter().find(|l| l.to_lowercase().ends_with(".cmd")))
        .or_else(|| lines.first())
        .map(PathBuf::from)
}

#[cfg(not(windows))]
pub(crate) fn resolve_claude() -> Option<PathBuf> {
    let out = std::process::Command::new("which")
        .arg("claude")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(PathBuf::from)
}

impl Runner for ClaudeRunner {
    fn run(&self, prompt: String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        // Settings override wins outright: no `where` probe, no OnceLock
        // cache — a bad path surfaces as the normal spawn error.
        let program = claude_override().or_else(|| self.claude_path());
        Box::pin(async move {
            let mut cmd = match &program {
                Some(path) => tokio::process::Command::new(path),
                None => {
                    #[cfg(windows)]
                    {
                        let mut c = tokio::process::Command::new("cmd");
                        c.arg("/C").arg("claude");
                        c
                    }
                    #[cfg(not(windows))]
                    {
                        tokio::process::Command::new("claude")
                    }
                }
            };
            // No positional prompt: `claude -p` reads it from stdin. See the
            // ClaudeRunner doc comment for why argv is not an option here.
            cmd.arg("-p")
                .arg("--output-format")
                .arg("json")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            #[cfg(windows)]
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            let mut child = cmd.spawn().map_err(|e| match &program {
                Some(p) => format!("failed to spawn claude ({}): {e}", p.display()),
                None => format!("failed to spawn claude: {e}"),
            })?;
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| "failed to open claude stdin".to_string())?;
            // Write concurrently with output collection so a prompt larger
            // than the pipe buffer cannot deadlock against a full stdout
            // pipe. Write errors (child exited early) are deliberately
            // ignored — exit status and stderr carry the real diagnosis.
            let writer = tauri::async_runtime::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(prompt.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
            let output = child
                .wait_with_output()
                .await
                .map_err(|e| format!("failed to run claude: {e}"))?;
            let _ = writer.await;
            parse_claude_output(&output.stdout, &output.stderr, output.status.success())
        })
    }
}

/// Parse the `--output-format json` stdout: take the `result` string field.
/// Non-zero exit, unparseable JSON, or missing `result` → one-line error
/// with a stderr tail of at most 200 chars.
fn parse_claude_output(stdout: &[u8], stderr: &[u8], success: bool) -> Result<String, String> {
    let tail = stderr_tail(stderr);
    let with_tail = |msg: &str| -> String {
        if tail.is_empty() {
            msg.to_string()
        } else {
            format!("{msg}: {tail}")
        }
    };
    if !success {
        return Err(with_tail("claude exited with an error"));
    }
    let value: serde_json::Value = serde_json::from_slice(stdout)
        .map_err(|_| with_tail("claude output was not valid JSON"))?;
    match value.get("result").and_then(|r| r.as_str()) {
        Some(s) => Ok(s.to_string()),
        None => Err(with_tail("claude output had no \"result\" field")),
    }
}

/// Last ≤ 200 chars of stderr, flattened to one line.
fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let one_line = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let chars: Vec<char> = one_line.chars().collect();
    let start = chars.len().saturating_sub(200);
    chars[start..].iter().collect()
}

// ── Commands ──────────────────────────────────────────────────────────

fn emit_sink(app: AppHandle) -> Sink {
    Arc::new(move |p: AssembleProgress| {
        let _ = app.emit(STATUS_EVENT, &p);
    })
}

#[tauri::command]
pub async fn assemble_node(
    app: AppHandle,
    state: State<'_, AssembleQueue>,
    root: String,
    graph_json: String,
    node_id: String,
) -> Result<(), String> {
    state.enqueue(
        emit_sink(app),
        root,
        graph_json,
        node_id,
        AssembleMode::Assemble,
        None,
    )
}

/// F7: preview only — builds the same `Job` as `assemble_node` would, then
/// applies `run_job`'s two pre-spend guards (non-`.md` rejection, path
/// resolution) without spawning `claude` or writing anything. Deliberately
/// diverges from `run_job` on a missing target: a missing file is `Ok` with
/// `oldContent: None` (Assemble legitimately creates files, and the modal
/// must be able to say "will create"), where `run_job` hard-errors for
/// Summarize. Never mutates queue state, so it needs no `AssembleQueue`.
#[tauri::command]
pub fn assemble_preview(
    root: String,
    graph_json: String,
    node_id: String,
    mode: AssembleMode,
    instruction: Option<String>,
) -> Result<AssemblePreview, String> {
    let job = build_job(root, graph_json, node_id, mode, instruction)?;
    if !job.file_path.to_lowercase().ends_with(".md") {
        return Err(format!(
            "Refusing to write non-markdown file: {}",
            job.file_path
        ));
    }
    let target = resolve_within_root(&job.root, &job.file_path)?;
    let old_content = fs::read_to_string(&target).ok();
    let prompt = build_prompt(
        &job,
        if job.mode == AssembleMode::Summarize {
            old_content.as_deref()
        } else {
            None
        },
    );
    Ok(AssemblePreview {
        prompt,
        rel_path: job.file_path.clone(),
        old_content,
        neighbors: job.neighbors.iter().map(|n| n.title.clone()).collect(),
        mode: job.mode,
    })
}

#[tauri::command]
pub async fn refine_node(
    app: AppHandle,
    state: State<'_, AssembleQueue>,
    root: String,
    graph_json: String,
    node_id: String,
    instruction: String,
) -> Result<(), String> {
    state.enqueue(
        emit_sink(app),
        root,
        graph_json,
        node_id,
        AssembleMode::Refine,
        Some(instruction),
    )
}

#[tauri::command]
pub async fn summarize_node(
    app: AppHandle,
    state: State<'_, AssembleQueue>,
    root: String,
    graph_json: String,
    node_id: String,
) -> Result<(), String> {
    state.enqueue(
        emit_sink(app),
        root,
        graph_json,
        node_id,
        AssembleMode::Summarize,
        None,
    )
}

#[tauri::command]
pub fn assemble_status(state: State<'_, AssembleQueue>) -> Result<Vec<AssembleJobInfo>, String> {
    Ok(state.status())
}

#[tauri::command]
pub fn assemble_cancel(state: State<'_, AssembleQueue>, node_id: String) -> Result<bool, String> {
    Ok(state.cancel(&node_id))
}
