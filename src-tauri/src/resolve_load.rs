//! `resolveLoad` — the one decider of "what load policy does this node get"
//! (WO13_CONTRACT.md §8). ONE definition, pinned by a shared fixture corpus
//! (`tests/fixtures/resolve_load_cases.json`) asserted from both Rust
//! (`resolve_load/tests.rs`) and TypeScript (`src/config/resolveLoad.ts` +
//! `resolveLoad.test.ts`) — the same mechanism `project.rs`'s
//! `serialize_graph` uses to stay honest against `graph.ts`.
//!
//! STAGE 0 SKELETON ONLY. This file lays down the frozen types and function
//! signatures (§8.1, §8.3) so lane R1 (`compile.rs`) and lane R3
//! (`taskctx.rs`) can code against a stable shape without waiting for the
//! real algorithm. Lane R1 owns this file and `resolve_load/tests.rs`
//! going forward and implements the §8.2 resolution order; every `pub fn`
//! body below is `unimplemented!()` until then.
//!
//! Operates on PROJECTED FACTS (`NodeFacts`/`EdgeFacts`), not
//! `project::MemoryNode`/`MemoryEdge` or `compile::GraphIn` directly — this
//! is deliberate decoupling (§8.3): `resolve_load` must not couple to the
//! full 14-member `NodeRole` vocabulary, only to whether a role is
//! `command`/`skill` (the two roles Amendment 1's rule 1 locks) or `Other`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// The resolved load policy for one node (§8.1). Wire values are
/// kebab-case, declaration order matches the contract's table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolvedLoad {
    Always,
    OnGlob,
    OnDemand,
    OnInvoke,
    Excluded,
}

/// Why [`resolve_load`] returned the policy it did (§8.1). The
/// reason→policy mapping is total, frozen and single-valued — see the
/// contract's table; do not invent a second pairing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoadReason {
    /// Defensive: the id names no node.
    UnknownNode,
    /// Rule 2.
    Deprecated,
    /// Rule 3 — Amendment 1.
    RoleCommand,
    /// Rule 4 — Amendment 1.
    RoleSkill,
    /// Rule 5.
    RootAlways,
    /// Rule 6.
    Imported,
    /// Rule 7.
    GuardedImportGlob,
    /// Rule 8.
    GuardedImportDescription,
    /// Rule 9.
    Referenced,
    /// Rule 10.
    UnreachableImport,
    /// Rule 11.
    Orphan,
}

/// `{ policy, reason, decidingEdgeId? }` on the wire (camelCase), exactly
/// as the Inspector's E3 sentence renders it (§8.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub policy: ResolvedLoad,
    pub reason: LoadReason,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deciding_edge_id: Option<String>,
}

/// Deliberately three-valued, NOT the full 14-member `NodeRole` (§8.3):
/// only `command` and `skill` have a fixed destination under Amendment 1's
/// rule 1; every other role behaves identically here, so `resolve_load`
/// must not be able to distinguish them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadRole {
    Command,
    Skill,
    Other,
}

/// Only `imports` and `references` are distinguished (§8.2 rules 6-9); every
/// other kind (`overrides`, `sequence`, `contradicts`) is irrelevant to load
/// resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadEdgeKind {
    Imports,
    References,
    Other,
}

/// Projected form of `project::EdgeGuard` — `resolve_load` only needs to
/// know WHICH kind of guard is present, not its contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardKind {
    None,
    Glob,
    Description,
}

/// One node's facts, projected for `resolve_load` (§8.3).
#[derive(Debug, Clone)]
pub struct NodeFacts {
    pub id: String,
    pub role: LoadRole,
    pub root_always: bool,
    pub deprecated: bool,
}

/// One edge's facts, projected for `resolve_load` (§8.3).
#[derive(Debug, Clone)]
pub struct EdgeFacts {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: LoadEdgeKind,
    pub guard: GuardKind,
}

/// Whether Amendment 1's rule 1 (command → on-invoke, skill → on-demand,
/// regardless of edges and `rootLoad`) applies. `Apply` is the answer for
/// every Claude-family output and for `taskctx.rs`'s subgraph injection;
/// `Ignore` exists ONLY for `compile.rs::emit_cursor` (§8.3, §10.5, F11) —
/// Cursor has no invoke mechanism, so the destination lock has nothing to
/// lock to there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleLock {
    Apply,
    Ignore,
}

/// The one decider (§8.2, first-match-wins resolution order).
///
/// Equivalent to `resolve_load_ignoring_role_lock` with
/// `RoleLock::Apply` — the two entry points share ONE implementation
/// (`resolve_load_impl`), never two copies (§8.3).
pub fn resolve_load(node_id: &str, nodes: &[NodeFacts], edges: &[EdgeFacts]) -> LoadResult {
    resolve_load_impl(node_id, nodes, edges, RoleLock::Apply)
}

/// The SAME resolver with rules 3 and 4 skipped and `command`/`skill` nodes
/// NOT excluded from `AlwaysClosure` — i.e. the answer as it would have
/// been before Amendment 1's destination lock.
///
/// EXACTLY ONE CALL SITE outside this module and its tests:
/// `compile.rs::emit_cursor` (§8.3, §18.4 gate — `rg
/// "resolve_load_ignoring_role_lock" src-tauri/src/` must return exactly
/// one hit elsewhere). Adding a second call site requires a contract
/// amendment.
pub fn resolve_load_ignoring_role_lock(
    node_id: &str,
    nodes: &[NodeFacts],
    edges: &[EdgeFacts],
) -> LoadResult {
    resolve_load_impl(node_id, nodes, edges, RoleLock::Ignore)
}

/// Shared implementation for both entry points (§8.2, first-match-wins).
fn resolve_load_impl(
    node_id: &str,
    nodes: &[NodeFacts],
    edges: &[EdgeFacts],
    role_lock: RoleLock,
) -> LoadResult {
    let done = |policy: ResolvedLoad, reason: LoadReason| LoadResult {
        policy,
        reason,
        deciding_edge_id: None,
    };
    let with_edge = |policy: ResolvedLoad, reason: LoadReason, edge_id: &str| LoadResult {
        policy,
        reason,
        deciding_edge_id: Some(edge_id.to_string()),
    };

    // Rule 1: unknown node.
    let Some(node) = nodes.iter().find(|n| n.id == node_id) else {
        return done(ResolvedLoad::Excluded, LoadReason::UnknownNode);
    };

    // Rule 2: deprecated outranks every other rule, including the role
    // rules (§8.2: "a deprecated command must not be emitted to
    // .claude/commands/, and a deprecated skill must not report on-demand").
    if node.deprecated {
        return done(ResolvedLoad::Excluded, LoadReason::Deprecated);
    }

    // Rules 3-4 (Amendment 1): the destination lock. Skipped entirely in
    // `RoleLock::Ignore` mode (§8.3 — the emit_cursor-only variant).
    if role_lock == RoleLock::Apply {
        match node.role {
            LoadRole::Command => return done(ResolvedLoad::OnInvoke, LoadReason::RoleCommand),
            LoadRole::Skill => return done(ResolvedLoad::OnDemand, LoadReason::RoleSkill),
            LoadRole::Other => {}
        }
    }

    // §8.2: "Dangling edges (an endpoint naming no node) are excluded
    // before resolution, the same way compile_preview / lint_graph already
    // exclude them." Audit D10(a): the TS mirror filters this
    // (`resolveLoad.ts:127`); this Rust side used to trust its callers,
    // which is a real divergence at THIS function's own boundary (every
    // current Rust caller happens to pre-filter, but the module's public
    // contract must not rely on that). Filtered ONCE, here, and used by
    // every rule below AND passed into `always_closure` — never the raw
    // `edges` slice again in this function.
    let valid_ids: std::collections::HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let live_edges: Vec<&EdgeFacts> = edges
        .iter()
        .filter(|e| valid_ids.contains(e.source.as_str()) && valid_ids.contains(e.target.as_str()))
        .collect();

    // Rules 5-6: AlwaysClosure membership, seeded from every non-deprecated
    // root-always node. Audit D5: the command/skill seed exclusion under
    // `Apply` (§8.2's boxed warning) used to be done HERE, which hid a bug
    // in `always_closure` itself from every OTHER caller (`taskctx.rs`,
    // `lint.rs`) that builds its own seed list and calls `always_closure`
    // directly without this pre-filter. Fixed at the source instead:
    // `always_closure` now applies `role_lock` to seeds itself (below), so
    // this function seeds with EVERY root-always id and relies on the
    // shared closure builder to be the single place that rule is enforced
    // — which also makes the rule testable through this function's own
    // public entry point (see `resolve_load_cases.json`'s
    // `role-lock-apply-excludes-command-seed-...` case).
    let seeds: Vec<&str> = nodes
        .iter()
        .filter(|n| n.root_always && !n.deprecated)
        .map(|n| n.id.as_str())
        .collect();
    let closure = always_closure(nodes, edges, &seeds, role_lock);
    if closure.contains(node_id) {
        if node.root_always {
            return done(ResolvedLoad::Always, LoadReason::RootAlways);
        }
        // Rule 6: lowest-byte-order id among unguarded `imports` edges
        // targeting this node whose source is itself in the closure.
        let best = live_edges
            .iter()
            .filter(|e| {
                e.target == node_id
                    && e.kind == LoadEdgeKind::Imports
                    && e.guard == GuardKind::None
                    && closure.contains(e.source.as_str())
            })
            .map(|e| e.id.as_str())
            .min();
        if let Some(id) = best {
            return with_edge(ResolvedLoad::Always, LoadReason::Imported, id);
        }
        // Defensive: closure membership without a qualifying edge and
        // without root_always cannot happen by construction of
        // `always_closure`, but fall through to the local rules rather
        // than panic if it ever does.
    }

    // Rules 7-10 are LOCAL — no source-reachability test (§8.2: this
    // preserves the asymmetry `emit_cursor`/`on_demand_bullets` already had
    // with the old `effective_pinned`). Still edge-VALIDITY tested: a
    // dangling-sourced edge was already excluded from `live_edges` above.
    let lowest = |pred: &dyn Fn(&EdgeFacts) -> bool| -> Option<&str> {
        live_edges
            .iter()
            .filter(|e| e.target == node_id && pred(e))
            .map(|e| e.id.as_str())
            .min()
    };

    if let Some(id) = lowest(&|e| e.kind == LoadEdgeKind::Imports && e.guard == GuardKind::Glob) {
        return with_edge(ResolvedLoad::OnGlob, LoadReason::GuardedImportGlob, id);
    }
    if let Some(id) =
        lowest(&|e| e.kind == LoadEdgeKind::Imports && e.guard == GuardKind::Description)
    {
        return with_edge(ResolvedLoad::OnDemand, LoadReason::GuardedImportDescription, id);
    }
    if let Some(id) = lowest(&|e| e.kind == LoadEdgeKind::References) {
        return with_edge(ResolvedLoad::OnDemand, LoadReason::Referenced, id);
    }
    if live_edges
        .iter()
        .any(|e| e.target == node_id && e.kind == LoadEdgeKind::Imports)
    {
        return done(ResolvedLoad::Excluded, LoadReason::UnreachableImport);
    }
    done(ResolvedLoad::Excluded, LoadReason::Orphan)
}

/// The AlwaysClosure builder (§8.2): seeded from `seeds` (every
/// non-deprecated node whose `rootLoad === "always"`, or — for `taskctx.rs`
/// — the task's own seed set), then repeatedly follows UNGUARDED `imports`
/// edges only, skipping any deprecated target, and — when `role_lock ==
/// Apply` — never entering or propagating through a `command`/`skill` node
/// (Amendment 1). THE single most dangerous invariant in this work order:
/// the closure must NOT follow guarded `imports` edges, or every migrated
/// `conditional` edge would newly pin its whole subtree (§8.2's boxed
/// warning; fixture case `"a glob guard stops the always closure dead"`
/// exists solely to pin this).
///
/// **The `role_lock` command/skill exclusion applies to `seeds` too, not
/// only to traversal targets** (audit D5). A caller — `taskctx.rs` seeds
/// `base` directly from `rootLoad == Always` node ids, which may itself
/// name a `command`/`skill` node; `lint.rs` does the same — and neither
/// pre-filters by role before calling this function. If only the traversal
/// half excluded command/skill, a root-always command node would still
/// enter the closure AS A SEED and propagate always-ness to whatever it
/// unguarded-imports, silently reintroducing the exact bug Amendment 1's
/// destination lock exists to prevent, for every caller except
/// `resolve_load_impl` (which used to work around the hole by pre-filtering
/// its OWN seed list — masking it rather than fixing it). Filtering here,
/// once, fixes every caller at the source.
///
/// `compile.rs`'s `effective_pinned` and `taskctx.rs`'s hand-rolled
/// `imports` walk are both DELETED once their lanes land and replaced by
/// calls to this one function (§8.4, §18.4 gate: `rg "effective_pinned"
/// src-tauri/src/` must return zero hits outside this module).
pub fn always_closure(
    nodes: &[NodeFacts],
    edges: &[EdgeFacts],
    seeds: &[&str],
    role_lock: RoleLock,
) -> BTreeSet<String> {
    let by_id: HashMap<&str, &NodeFacts> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut set: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<String> = Vec::new();
    for &s in seeds {
        let Some(n) = by_id.get(s) else { continue };
        if n.deprecated {
            continue;
        }
        if role_lock == RoleLock::Apply && matches!(n.role, LoadRole::Command | LoadRole::Skill) {
            continue;
        }
        if set.insert(s.to_string()) {
            queue.push(s.to_string());
        }
    }
    while let Some(cur) = queue.pop() {
        for e in edges {
            if e.source != cur || e.kind != LoadEdgeKind::Imports || e.guard != GuardKind::None {
                continue;
            }
            let Some(target) = by_id.get(e.target.as_str()) else {
                continue;
            };
            if target.deprecated {
                continue;
            }
            if role_lock == RoleLock::Apply
                && matches!(target.role, LoadRole::Command | LoadRole::Skill)
            {
                continue;
            }
            if set.insert(e.target.clone()) {
                queue.push(e.target.clone());
            }
        }
    }
    set
}

#[cfg(test)]
mod tests;
