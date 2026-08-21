// Token ESTIMATES (TASKBOARD_BATCH_CONTRACT.md §8). Everything here is the
// chars/4 heuristic over on-disk sizes — labeled "≈" in the UI. Real
// tokens-left / per-agent spend needs the Claude runtime telemetry
// (--output-format stream-json, Work Order 01 Block F) and does not exist yet.

import { canonPath, useGraphStore, type MemoryEdge, type MemoryNode } from "./graph";
import { alwaysLoadedNodeIds } from "../config/resolveLoad";
import type { MdFile } from "./project";
import type { AgentDoc } from "../agents/types";

/** The assumed context window for the "of ~200k" framing. */
export const CONTEXT_WINDOW_TOKENS = 200_000;

export function tokensForBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

/** Whole-percent of the 200k context window (WO01 N5) — shared by
 *  AgentPanel's usage line and RosterBar's ctx bar so the two never drift
 *  on rounding. Not clamped: a session that overruns the window reads
 *  >100%, which the amber-at-80% treatment already flags as a problem. */
export function ctxPercent(totalTokens: number): number {
  return Math.round((totalTokens / CONTEXT_WINDOW_TOKENS) * 100);
}

// Compile-modal budget thresholds (Work Order 01 Block B / T3). A target's
// root file (CLAUDE.md / AGENTS.md) tripping either one flips its total bar
// to the warning treatment — static amber, per the token law (amber = the
// agent/warning channel, never mixed with the user-initiated accent blue).
export const COMPILE_WARN_LINES = 150;
export const COMPILE_WARN_TOKENS = 2000;

/** Same chars/4-via-bytes heuristic as `tokensForBytes`, applied to a string
 *  already in memory (a compile preview's `newContent`) rather than an
 *  on-disk size. UTF-8 byte length, not UTF-16 code units, so it agrees with
 *  the Rust-side byte counts used elsewhere. */
export function compiledTokens(content: string): number {
  return tokensForBytes(new TextEncoder().encode(content).length);
}

/** Text line count (à la `wc -l`): counts newlines, plus one more if the
 *  content doesn't end with a trailing newline. Empty string is 0 lines. */
export function lineCount(content: string): number {
  if (content === "") return 0;
  const newlines = (content.match(/\n/g) ?? []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/** Always-loaded-set estimate: the file sizes of every node
 *  `resolveLoad` currently answers `"always"` for.
 *
 *  WO13 fix round D6: this used to test `n.rootLoad === "always"` LOCALLY,
 *  per node — a second, disagreeing notion of "in context" from the one
 *  `resolveLoad`/`lint.rs`'s `always-budget-exceeded` check use. That local
 *  test both undercounted (a node reached only TRANSITIVELY through an
 *  unguarded `imports` edge, with no `rootLoad` of its own, was skipped)
 *  and overcounted (a `command`/`skill` node's `rootLoad: "always"`
 *  survives migration on the wire even though Amendment 1's rule 1 locks
 *  its OWN resolved policy away from `"always"` — this local test would
 *  have counted its bytes anyway). Routed through
 *  `resolveLoad.ts`'s `alwaysLoadedNodeIds` — the SAME closure the
 *  resolver and the linter's own `resolve_load::always_closure` call
 *  build — so this gauge and `always-budget-exceeded` can no longer show
 *  two different totals for the same graph.
 *
 *  `edges` is read from the graph store rather than taken as a parameter:
 *  every existing call site already sources `nodes` from
 *  `useGraphStore`'s own `nodes` slice, so reading `edges` off the SAME
 *  store keeps this call-compatible with that one external call site
 *  (`App.tsx`'s `PinnedTokenChip`, a different lane's file) while still
 *  computing over the true whole-graph closure — a filtered/partial
 *  `nodes` list would otherwise produce a closure answer that disagrees
 *  with what `resolveLoad` says about the SAME node ids. */
export function pinnedContextTokens(
  nodes: readonly MemoryNode[],
  files: readonly MdFile[],
): number {
  // WO11 tester sweep (MEDIUM #3): keyed lookups over a path-keyed Map are
  // an exact-key-match, same failure class as a bare `===`/`.split("/")` on
  // a `.md` path (canonPath/sameRelPath standing rule) — a node stored with
  // backslashes (or different case) silently misses its file's size here
  // and is undercounted, with no error. Build AND query the Map through
  // canonPath so both sides agree regardless of separator/case.
  const sizeByPath = new Map(files.map((f) => [canonPath(f.relPath), f.sizeBytes] as const));
  const edges = useGraphStore.getState().edges;
  const always = alwaysLoadedNodeIds({ nodes, edges });
  let bytes = 0;
  for (const n of nodes) {
    if (always.has(n.id)) bytes += sizeByPath.get(canonPath(n.filePath)) ?? 0;
  }
  return tokensForBytes(bytes);
}

/** One agent's context estimate: the agent's OWN file size (frontmatter
 *  included, matching what the card's `≈N tok file` counts) plus the files
 *  of every node its graph node points at via direct imports/references
 *  edges. Invariant (WO12 D7): for any agent-backed node, `card <= inspector`
 *  always holds — this number can only grow past the card's by the size of
 *  the 1-hop closure, never shrink below it by excluding frontmatter the
 *  card includes. Before WO12 this summed `doc.body.length` (frontmatter
 *  excluded, UTF-16 code units) with UTF-8 byte counts from `sizeByPath` —
 *  a unit mismatch that also made the estimate strictly SMALLER than the
 *  card's for any agent with no outgoing structural edges, which read as a
 *  bug because it was one.
 *  Known minor issue (not fixed here): `doc` is always the SAVED AgentDoc,
 *  never the live editor draft, so this lags the editor by one autosave. */
export function agentContextTokens(
  doc: AgentDoc,
  nodes: readonly MemoryNode[],
  edges: readonly MemoryEdge[],
  files: readonly MdFile[],
): number {
  const agentPath = `.claude/agents/${doc.fileName}`;
  const sizeByPath = new Map(files.map((f) => [canonPath(f.relPath), f.sizeBytes] as const));
  // Own file size first, from the scan (matches the card's `file.sizeBytes`
  // exactly); fall back to a UTF-8 byte count of the body when the scan has
  // no entry yet (e.g. a brand-new agent not yet rescanned).
  let bytes = sizeByPath.get(canonPath(agentPath)) ?? new TextEncoder().encode(doc.body).length;
  // Same fix as `pinnedContextTokens` above — canonPath on both sides of the
  // comparison, not a bare `===`. Reachable through WO11's G5 context
  // estimate: without this, an agent-backed node stored with backslashes
  // silently reported ONLY its own duties-body size, skipping every
  // imported/referenced node's contribution below.
  const agentNode = nodes.find((n) => canonPath(n.filePath) === canonPath(agentPath));
  if (agentNode !== undefined) {
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.source !== agentNode.id) continue;
      if (e.kind !== "imports" && e.kind !== "references") continue;
      const target = nodeById.get(e.target);
      if (target === undefined || seen.has(target.id)) continue;
      seen.add(target.id);
      bytes += sizeByPath.get(canonPath(target.filePath)) ?? 0;
    }
  }
  return tokensForBytes(bytes);
}
