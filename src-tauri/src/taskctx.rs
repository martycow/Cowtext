//! Per-task subgraph injection (`WO06_CONTRACT.md` §4) — the differentiator
//! of this work order. Given a `taskId`, computes the closure of its
//! `tasklinks` seeds, its parent-task ancestry, and every globally pinned
//! node over `imports` edges only (§4.1), then reuses the existing headless
//! `compile::compile_preview` entry point to turn that subgraph into a
//! byte-exact `CLAUDE.md`-shaped body (§4.2). Delivery is boot-prompt
//! injection over stdin (§4.3) — this module never writes into a user's
//! worktree; the one optional durable artifact
//! (`.cowtext/context/task-<taskId>.md`) lives behind its own allowlist,
//! disjoint from `compile_write`'s (§4.5, Gate 9).
//!
//! `compile.rs` is FROZEN this work order (§4.4) — this module only calls
//! its existing `pub fn compile_preview` and reads `pub const
//! GENERATED_HEADER`; it makes zero edits there.
//!
//! Calls `crate::tasklinks::tasklinks_read` for the sidecar and
//! `crate::tasklinks::ancestor_chain` for parent-goal ancestry, rather than
//! reimplementing either. Both were originally private/inline re-
//! implementations, justified at the time by the contract's lane grid
//! building `tasklinks.rs`/`taskctx.rs` as independent zones (no hard call
//! dependency on a sibling lane's *command body*). WO06 audit O2/O3 found
//! the two copies had drifted: this module hard-`Err`ed on unparseable
//! `tasklinks.json` where `tasklinks::tasklinks_read` degrades it to
//! `{version:1, links:[]}`, and this module silently truncated ancestry
//! past depth 8 where `tasklinks::ancestor_chain` — exposed `pub(crate)`
//! by T2 specifically for this module to reuse — reports it as `Err`,
//! matching §4.1 ("depth cap 8; a cycle is a `ParentCycle` error, not a
//! silent truncation"). Once both lanes had landed, the original
//! landing-order rationale for a private copy no longer applied, so both
//! calls were switched to the shared implementation instead of reconciled
//! by hand.

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};

use crate::project::{checked_root, resolve_within_root, write_atomic};

/// Directory the one optional durable artifact lands in, relative to the
/// project root (§4.5).
pub const TASK_CONTEXT_DIR: &str = ".cowtext/context";

/// Boot-prompt injection cap (§4.3): the compiled body is truncated at this
/// many bytes (via the existing `truncate_at_char_boundary`) before it is
/// inserted into the session's boot prompt.
///
/// Unused until Lane G2's `task_context_preview` body / Lane G3's
/// `agent_session_spawn` enforce it — Stage 0 only declares the constant.
#[allow(dead_code)]
pub const TASK_CONTEXT_MAX_BYTES: usize = 32 * 1024;

/// Result of compiling one task's subgraph (§4). **Errors XOR body**
/// (contract §1.7): `errors` non-empty ⇒ `body == ""` and `node_ids == []`,
/// exactly as `compile_preview`'s `CompilePreview` holds for the project
/// graph.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub task_id: String,
    /// The effective closure (§4.1), sorted byte-order — the seeds actually
    /// used to compile `body`.
    pub node_ids: Vec<String>,
    /// The compiled `CLAUDE.md`-shaped body, GENERATED header on line 1,
    /// taken verbatim from `compile_preview`'s matching `PreviewFile`.
    pub body: String,
    /// `body.len()` in bytes, before any boot-prompt truncation is applied
    /// at spawn time.
    pub bytes: usize,
    pub errors: Vec<TaskContextError>,
}

/// One reason `task_context_preview` could not produce a body (§4.1, §4.2).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TaskContextError {
    /// The effective closure (§4.1) was empty — never compile an empty
    /// graph.
    EmptySubgraph,
    /// `taskId` resolves to no entry Lane G2 can find (no `tasklinks` entry
    /// and no task carrying that id).
    #[serde(rename_all = "camelCase")]
    UnknownTask { task_id: String },
    /// `parentTaskId` ancestry exceeded depth 8 or cycled back on itself
    /// (§4.1).
    #[serde(rename_all = "camelCase")]
    ParentCycle { path: Vec<String> },
    /// A seed or ancestry/pinned node's backing `.md` file could not be
    /// read.
    #[serde(rename_all = "camelCase")]
    MissingFile { node_id: String, file_path: String },
    /// `compile_preview` itself returned a validation error for the
    /// synthesized subgraph.
    #[serde(rename_all = "camelCase")]
    Compile { message: String },
}

// ── Commands (contract §7, commands 61-62) ─────────────────────────────

/// Compute the task's subgraph closure (§4.1) and compile it through the
/// existing headless `compile_preview` (§4.2). `errors` XOR `body` holds
/// exactly as it does for `compile_preview` itself (§1.7) — every early
/// return below carries `errors` non-empty with `body == ""` and
/// `nodeIds == []`, and the sole success return carries `errors == []`.
///
/// `Err` is reserved for infrastructure failure (bad root, unparseable
/// `graph_json`, a `tasklinks.json` whose `version` is newer than this
/// binary understands) — never for a graph/task-data problem, which is
/// always data (`Ok` with `errors`). A corrupt-but-not-JSON or
/// parses-but-wrong-shape `tasklinks.json` degrades to `{version:1,
/// links:[]}` instead (delegated to `tasklinks::tasklinks_read`), same as
/// every other reader of that file.
#[tauri::command]
pub fn task_context_preview(
    root: String,
    task_id: String,
    graph_json: String,
) -> Result<TaskContext, String> {
    let root_path = checked_root(&root)?;

    if !is_valid_task_id(&task_id) {
        return Ok(empty_context(
            task_id.clone(),
            vec![TaskContextError::UnknownTask { task_id }],
        ));
    }

    let graph = crate::project::migrate_graph(&graph_json)?;
    let links = crate::tasklinks::tasklinks_read(root.clone())?;

    let entry = links.links.iter().find(|l| l.task_id == task_id);
    let seeds: Vec<String> = entry.map(|l| l.node_ids.clone()).unwrap_or_default();

    // Parent ancestry (§4.1): delegate to `tasklinks::ancestor_chain`,
    // which returns the ancestor task-id chain (nearest first) and treats
    // BOTH a genuinely repeated id AND exceeding the depth-8 cap as `Err`
    // — exactly §4.1's "depth cap 8; a cycle is a `ParentCycle` error, not
    // a silent truncation", and the same semantics `tasklink_set` already
    // enforces at write time. `ancestor_chain` returns task ids only, so
    // each ancestor's own `nodeIds` is joined here from `links`.
    let ancestor_task_ids = match crate::tasklinks::ancestor_chain(&links, &task_id) {
        Ok(ids) => ids,
        Err(path) => {
            return Ok(empty_context(
                task_id,
                vec![TaskContextError::ParentCycle { path }],
            ));
        }
    };
    let mut ancestry_ids: Vec<String> = Vec::new();
    for parent_id in &ancestor_task_ids {
        if let Some(pe) = links.links.iter().find(|l| l.task_id == *parent_id) {
            ancestry_ids.extend(pe.node_ids.iter().cloned());
        }
    }

    // base = seeds ∪ ancestry ∪ { every pinned node } (§4.1).
    let mut base: BTreeSet<String> = BTreeSet::new();
    for id in seeds.iter().chain(ancestry_ids.iter()) {
        base.insert(id.clone());
    }
    for n in &graph.nodes {
        if n.pinned {
            base.insert(n.id.clone());
        }
    }

    // effective = transitive closure of base over `imports` edges only,
    // forward direction (source imports target) — mirrors `compile.rs`'s
    // own `effective_pinned` walk, just seeded from `base` instead of the
    // pinned-only set. A seed/ancestor/pinned id that no longer names a
    // live node (stale sidecar entry, deleted node) contributes nothing —
    // silently dropped, not an error (WO03-D6 "report, don't refuse"
    // posture generalized here).
    let node_index: HashSet<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
    let mut imports_adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &graph.edges {
        if e.kind == crate::project::EdgeKind::Imports {
            imports_adj
                .entry(e.source.as_str())
                .or_default()
                .push(e.target.as_str());
        }
    }

    let mut effective: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<String> = Vec::new();
    for id in base {
        if node_index.contains(id.as_str()) && effective.insert(id.clone()) {
            queue.push(id);
        }
    }
    let mut i = 0;
    while i < queue.len() {
        let cur = queue[i].clone();
        i += 1;
        if let Some(targets) = imports_adj.get(cur.as_str()) {
            for &t in targets {
                if effective.insert(t.to_string()) {
                    queue.push(t.to_string());
                }
            }
        }
    }

    if effective.is_empty() {
        return Ok(empty_context(task_id, vec![TaskContextError::EmptySubgraph]));
    }

    let sub_nodes: Vec<crate::project::MemoryNode> = graph
        .nodes
        .iter()
        .filter(|n| effective.contains(&n.id))
        .cloned()
        .collect();
    // Induced-edge rule (§4.1): both endpoints already in `effective` ⇒
    // kept regardless of kind (including `overrides`, for ordering) — never
    // used to pull in a new node.
    let sub_edges: Vec<crate::project::MemoryEdge> = graph
        .edges
        .iter()
        .filter(|e| effective.contains(&e.source) && effective.contains(&e.target))
        .cloned()
        .collect();

    // §4.2's one transform: "<real projectName or root dir name> · task
    // <taskId>" — mirrors `compile_preview`'s own empty-name fallback
    // exactly (`compile.rs:347-354`) so the two never disagree on what
    // "real projectName" means.
    let project_name = if graph.project_name.is_empty() {
        root_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone())
    } else {
        graph.project_name.clone()
    };

    let sub_graph = crate::project::BarnGraph {
        version: crate::project::GRAPH_VERSION,
        project_name: format!("{project_name} · task {task_id}"),
        nodes: sub_nodes,
        edges: sub_edges,
        // Forced regardless of the project's real `compileTargets` (§4.2).
        compile_targets: vec![crate::project::CompileTarget::Claude],
    };
    let sub_json = crate::project::serialize_graph(&sub_graph);
    let node_ids: Vec<String> = effective.into_iter().collect();

    let preview = crate::compile::compile_preview(root, sub_json)?;
    if !preview.errors.is_empty() {
        let errors = preview.errors.into_iter().map(map_validation_error).collect();
        return Ok(empty_context(task_id, errors));
    }

    // Exactly one file survives (§4.2): the `claude`/`CLAUDE.md` one. Every
    // other preview file — including any `agent`-context-block file for an
    // agent-role node in the subgraph — is discarded.
    match preview
        .files
        .into_iter()
        .find(|f| f.target == "claude" && f.rel_path == "CLAUDE.md")
    {
        Some(f) => {
            let bytes = f.new_content.len();
            Ok(TaskContext {
                task_id,
                node_ids,
                body: f.new_content,
                bytes,
                errors: Vec::new(),
            })
        }
        None => Ok(empty_context(task_id, vec![TaskContextError::EmptySubgraph])),
    }
}

/// The one optional durable artifact (§4.5). `task_id` is validated and the
/// destination path is derived from it server-side — the caller never
/// supplies a path, so there is no traversal surface and no way to name a
/// file that is not `task-t-xxxxxx.md` under [`TASK_CONTEXT_DIR`]. Disjoint
/// from `compile_write`'s allowlist in both directions (Gate 9): this path
/// shape never matches `compile.rs`'s `classify_output`, and
/// `compile_write` can never be steered at this shape either, since it only
/// ever accepts the six shapes `classify_output` names.
#[tauri::command]
pub fn task_context_write(root: String, task_id: String, content: String) -> Result<String, String> {
    let root_path = checked_root(&root)?;
    let rel_path = task_context_rel_path(&task_id)?;
    if !has_generated_header(&content) {
        return Err(format!("Missing GENERATED header: {rel_path}"));
    }
    let path = resolve_within_root(&root_path, &rel_path)?;
    write_atomic(&path, &content)?;
    Ok(rel_path)
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn empty_context(task_id: String, errors: Vec<TaskContextError>) -> TaskContext {
    TaskContext {
        task_id,
        node_ids: Vec::new(),
        body: String::new(),
        bytes: 0,
        errors,
    }
}

/// Stable task id grammar (contract §3.1 R5): `^t-[0-9a-z]{6}$`, base36,
/// lower-case. Nothing else is an id — used both to reject an obviously
/// bogus `taskId` cheaply (before touching `tasklinks.json` or the graph)
/// and to derive [`task_context_rel_path`] with no caller-supplied path
/// component ever reaching the filesystem.
fn is_valid_task_id(id: &str) -> bool {
    match id.strip_prefix("t-") {
        Some(rest) => {
            rest.len() == 6 && rest.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
        }
        None => false,
    }
}

/// The ONLY path shape [`task_context_write`] will ever produce (§4.5).
/// Derived from `task_id` server-side; the caller does not supply a path.
fn task_context_rel_path(task_id: &str) -> Result<String, String> {
    if !is_valid_task_id(task_id) {
        return Err(format!("Invalid task id: {task_id}"));
    }
    Ok(format!("{TASK_CONTEXT_DIR}/task-{task_id}.md"))
}

/// §4.5: "The content must carry the GENERATED header on line 1" — a
/// stricter check than `compile.rs`'s own `has_header` (which tolerates the
/// header on any of the first 10 lines, for `.mdc` frontmatter), matching
/// the contract's literal wording for this artifact.
fn has_generated_header(content: &str) -> bool {
    content
        .lines()
        .next()
        .map(|l| l.trim() == crate::compile::GENERATED_HEADER)
        .unwrap_or(false)
}

/// Maps a `compile_preview` validation error onto a `TaskContextError`
/// (§4.2). `MissingFile` gets a direct, actionable 1:1 mapping; `Cycle` and
/// `DanglingEdge` fold into the generic `Compile` bucket — a dangling edge
/// should in fact be unreachable here by construction (§4.1's induced-edge
/// rule: both endpoints already in `effective`), so it is handled
/// defensively rather than assumed impossible.
fn map_validation_error(e: crate::compile::ValidationError) -> TaskContextError {
    match e {
        crate::compile::ValidationError::MissingFile {
            node_id, file_path, ..
        } => TaskContextError::MissingFile { node_id, file_path },
        crate::compile::ValidationError::Cycle { nodes } => TaskContextError::Compile {
            message: format!(
                "cycle in task subgraph: {}",
                nodes
                    .iter()
                    .map(|n| n.id.as_str())
                    .collect::<Vec<_>>()
                    .join(" -> ")
            ),
        },
        crate::compile::ValidationError::DanglingEdge {
            edge_id,
            edge_kind,
            missing_end,
        } => TaskContextError::Compile {
            message: format!(
                "dangling {edge_kind} edge {edge_id} in task subgraph (missing endpoint {missing_end})"
            ),
        },
    }
}
