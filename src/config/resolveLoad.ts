// `resolveLoad` — the TS mirror of the one decider of "what load policy does
// this node get" (WO13_CONTRACT.md §8, lane T1's half of §8.3). Needed in TS
// for edge-hover feedback, the Inspector's E3 sentence and the wizard's
// 150ms live preview — an IPC round-trip per keystroke is not acceptable.
// "One decider" is honoured by one DEFINITION, pinned by the shared fixture
// corpus `tests/fixtures/resolve_load_cases.json`, asserted from both this
// module (`resolveLoad.test.ts`) and Rust (`src-tauri/src/resolve_load.rs`,
// lane R1's implementation of the SAME algorithm over projected facts).
//
// Deliberately takes `BarnGraph` directly (unlike the Rust side, which
// operates on projected `NodeFacts`/`EdgeFacts` to avoid coupling to the
// full `project::MemoryNode`/`compile::GraphIn` — there is no such second
// consumer on the TS side to decouple from).

import type { BarnGraph, EdgeGuard, MemoryEdge, MemoryNode, NodeRole } from "../store/graph";

/** Just the two `BarnGraph` fields the always-closure computation needs —
 *  lets a caller that doesn't have a full `BarnGraph` handy (e.g.
 *  `store/tokens.ts`, reading `nodes` and `edges` off two different
 *  Zustand slices/params) build one without fabricating
 *  `version`/`projectName`/`compileTargets`. `readonly` arrays (rather than
 *  `Pick<BarnGraph, ...>`) so a caller holding a `readonly MemoryNode[]`
 *  parameter (as most do) doesn't need an unsound cast; any real
 *  `BarnGraph` still satisfies this shape. */
export interface LoadGraph {
  nodes: readonly MemoryNode[];
  edges: readonly MemoryEdge[];
}

/** §8.1 — declaration order matches the contract's table. */
export type ResolvedLoad = "always" | "on-glob" | "on-demand" | "on-invoke" | "excluded";

/** §8.1 — the reason -> policy map is TOTAL, FROZEN and single-valued; see
 *  the contract's table. Do not invent a second pairing. */
export type LoadReason =
  | "unknown-node" // defensive: id names no node
  | "deprecated" // rule 2
  | "role-command" // rule 3 — Amendment 1
  | "role-skill" // rule 4 — Amendment 1
  | "root-always" // rule 5
  | "imported" // rule 6
  | "guarded-import-glob" // rule 7
  | "guarded-import-description" // rule 8
  | "referenced" // rule 9
  | "unreachable-import" // rule 10
  | "orphan"; // rule 11

export interface LoadResult {
  policy: ResolvedLoad;
  reason: LoadReason;
  decidingEdgeId?: string;
}

type RoleLock = "apply" | "ignore";

/** The two roles Amendment 1's rule 1 governs (`nodeTypes.ts`'s
 *  `LOAD_LOCKED_ROLES` names the same pair — kept as plain literals here
 *  rather than an import so this module stays decoupled from the UI-facing
 *  `NodeTypeMeta` shape, matching the Rust mirror's own three-valued
 *  `LoadRole` decoupling rationale, §8.3). */
function isCommand(role: NodeRole): boolean {
  return role === "command";
}
function isSkill(role: NodeRole): boolean {
  return role === "skill";
}

function isDangling(edge: MemoryEdge, nodeById: ReadonlyMap<string, MemoryNode>): boolean {
  return !nodeById.has(edge.source) || !nodeById.has(edge.target);
}

/** Lowest edge id in BYTE order among the given edges — `undefined` for an
 *  empty list. Deliberately `<`/`>` (byte order), not `localeCompare`, for
 *  the same reason `src/store/graph.ts`'s `compareIds` is (WO03 audit D5). */
function lowestEdgeId(edges: readonly MemoryEdge[]): string | undefined {
  let best: string | undefined;
  for (const e of edges) {
    if (best === undefined || e.id < best) best = e.id;
  }
  return best;
}

function isUnguardedImport(e: MemoryEdge): boolean {
  return e.kind === "imports" && e.guard === undefined;
}

function guardKind(guard: EdgeGuard | undefined): "glob" | "description" | undefined {
  return guard?.type;
}

/** The AlwaysClosure builder (§8.2): seeded from every non-deprecated node
 *  whose `rootLoad === "always"` — EXCLUDING `command`/`skill` nodes as
 *  seeds when `roleLock === "apply"` (Amendment 1: they cannot be inlined,
 *  so they must not become closure members) — then repeatedly follows
 *  UNGUARDED `imports` edges only, skipping any deprecated target and, in
 *  `"apply"` mode, never entering (or therefore propagating through) a
 *  `command`/`skill` node.
 *
 *  THE single most dangerous invariant in this work order: the closure
 *  must NOT follow guarded `imports` edges, or every migrated `conditional`
 *  edge would newly pin its whole subtree into every existing user's
 *  `CLAUDE.md` on first load (fixture case "a glob guard stops the always
 *  closure dead" exists solely to pin this). */
function alwaysClosure(
  nodeById: ReadonlyMap<string, MemoryNode>,
  edges: readonly MemoryEdge[],
  roleLock: RoleLock,
): ReadonlySet<string> {
  const closure = new Set<string>();
  for (const n of nodeById.values()) {
    if (n.deprecated !== undefined) continue;
    if (n.rootLoad !== "always") continue;
    if (roleLock === "apply" && (isCommand(n.role) || isSkill(n.role))) continue;
    closure.add(n.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!isUnguardedImport(e)) continue;
      if (!closure.has(e.source) || closure.has(e.target)) continue;
      const target = nodeById.get(e.target);
      if (target === undefined) continue; // dangling — already excluded upstream, defensive
      if (target.deprecated !== undefined) continue;
      if (roleLock === "apply" && (isCommand(target.role) || isSkill(target.role))) continue;
      closure.add(e.target);
      changed = true;
    }
  }
  return closure;
}

function resolveCore(nodeId: string, graph: BarnGraph, roleLock: RoleLock): LoadResult {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const node = nodeById.get(nodeId);
  if (node === undefined) return { policy: "excluded", reason: "unknown-node" };

  // Dangling edges (an endpoint naming no node) are excluded before
  // resolution, matching compile_preview/lint_graph on the Rust side.
  const edges = graph.edges.filter((e) => !isDangling(e, nodeById));

  // Rule 2: deprecated outranks the role rules (3/4) — a deprecated command
  // must not be emitted to .claude/commands/, a deprecated skill must not
  // report on-demand.
  if (node.deprecated !== undefined) return { policy: "excluded", reason: "deprecated" };

  // Rules 3-4 (Amendment 1) — fixed destination by role alone, regardless
  // of edges or rootLoad. `roleLock === "ignore"` is the emit_cursor-only
  // variant that skips these two rules entirely.
  if (roleLock === "apply") {
    if (isCommand(node.role)) return { policy: "on-invoke", reason: "role-command" };
    if (isSkill(node.role)) return { policy: "on-demand", reason: "role-skill" };
  }

  const closure = alwaysClosure(nodeById, edges, roleLock);

  // Rule 5: a root-always node that is (trivially) in its own seed set.
  if (closure.has(nodeId) && node.rootLoad === "always") {
    return { policy: "always", reason: "root-always" };
  }
  // Rule 6: reached via the closure through an unguarded imports edge.
  if (closure.has(nodeId)) {
    const deciding = lowestEdgeId(
      edges.filter((e) => isUnguardedImport(e) && e.target === nodeId && closure.has(e.source)),
    );
    return { policy: "always", reason: "imported", decidingEdgeId: deciding };
  }

  // Rules 7-10 are LOCAL (no source-reachability test) — emit_cursor and
  // on_demand_bullets emit for these edges today regardless of whether the
  // source is pinned; only rules 5/6 are closure-based, because only
  // effective_pinned was.
  const globEdges = edges.filter(
    (e) => e.kind === "imports" && guardKind(e.guard) === "glob" && e.target === nodeId,
  );
  const globDeciding = lowestEdgeId(globEdges);
  if (globDeciding !== undefined) {
    return { policy: "on-glob", reason: "guarded-import-glob", decidingEdgeId: globDeciding };
  }

  const descEdges = edges.filter(
    (e) => e.kind === "imports" && guardKind(e.guard) === "description" && e.target === nodeId,
  );
  const descDeciding = lowestEdgeId(descEdges);
  if (descDeciding !== undefined) {
    return { policy: "on-demand", reason: "guarded-import-description", decidingEdgeId: descDeciding };
  }

  const refEdges = edges.filter((e) => e.kind === "references" && e.target === nodeId);
  const refDeciding = lowestEdgeId(refEdges);
  if (refDeciding !== undefined) {
    return { policy: "on-demand", reason: "referenced", decidingEdgeId: refDeciding };
  }

  // Rule 10: an imports edge exists into this node, but its source never
  // reached the always closure — the target is unreachable, not orphaned.
  const anyImport = edges.some((e) => e.kind === "imports" && e.target === nodeId);
  if (anyImport) return { policy: "excluded", reason: "unreachable-import" };

  // Rule 11: nothing imports or references this node at all.
  return { policy: "excluded", reason: "orphan" };
}

/** The one decider (§8.2, first-match-wins resolution order), `RoleLock::Apply`
 *  — the answer for every Claude-family compiled output and for
 *  `taskctx.rs`'s subgraph injection. */
export function resolveLoad(nodeId: string, graph: BarnGraph): LoadResult {
  return resolveCore(nodeId, graph, "apply");
}

/** The SAME resolver with rules 3 and 4 skipped and `command`/`skill` nodes
 *  NOT excluded from the always closure — i.e. the answer as it would have
 *  been before Amendment 1's destination lock. On the TS side this exists
 *  ONLY so the shared fixture corpus can assert both modes from both
 *  languages — there is no TS UI call site (the Rust mirror's one call site
 *  is `compile.rs::emit_cursor`; Cursor output has no TS-side consumer). */
export function resolveLoadIgnoringRoleLock(nodeId: string, graph: BarnGraph): LoadResult {
  return resolveCore(nodeId, graph, "ignore");
}

/** Every node id `resolveLoad` currently resolves to `"always"`, computed
 *  ONCE over the whole graph rather than per node (WO13 fix round D6). This
 *  is the SAME `alwaysClosure` computation rules 5/6 test membership
 *  against internally — reused, not re-derived — and it IS the "always"
 *  set by construction: rules 1-4 either exclude a node before the closure
 *  test ever runs (`unknown-node`/`deprecated`) or, for `command`/`skill`,
 *  return a non-"always" policy without consulting the closure at all;
 *  rules 7-11 never return `"always"` either. So `alwaysLoadedNodeIds(g)
 *  .has(id) === (resolveLoad(id, g).policy === "always")` for every node
 *  in `g`, without calling `resolveLoad` once per node.
 *
 *  D6's finding: `store/tokens.ts`'s `pinnedContextTokens` used to test
 *  `node.rootLoad === "always"` LOCALLY, per node — a second, disagreeing
 *  notion of "in context" from the one `resolveLoad`/the linter's own
 *  `resolve_load::always_closure` call use (a node reached only
 *  TRANSITIVELY via an unguarded `imports` edge was silently undercounted;
 *  a `command`/`skill` node carrying `rootLoad: "always"` on the wire — its
 *  value survives migration even though rule 1 locks its OWN policy away
 *  from "always" — would have been silently OVERcounted). Any consumer
 *  needing "every currently-always-loaded node" for a whole graph — the
 *  always-budget estimate, a future graph-wide "what's pinned" summary —
 *  must read this set rather than re-deriving the walk locally. */
export function alwaysLoadedNodeIds(graph: LoadGraph): ReadonlySet<string> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const edges = graph.edges.filter((e) => !isDangling(e, nodeById));
  return alwaysClosure(nodeById, edges, "apply");
}
