// Token ESTIMATES (TASKBOARD_BATCH_CONTRACT.md §8). Everything here is the
// chars/4 heuristic over on-disk sizes — labeled "≈" in the UI. Real
// tokens-left / per-agent spend needs the Claude runtime telemetry
// (--output-format stream-json, Work Order 01 Block F) and does not exist yet.

import type { MemoryEdge, MemoryNode } from "./graph";
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

/** Pinned-set estimate: pinned nodes' file sizes. The effective-pinned
 *  closure (transitive imports) arrives with Work Order Block B. */
export function pinnedContextTokens(
  nodes: readonly MemoryNode[],
  files: readonly MdFile[],
): number {
  const sizeByPath = new Map(files.map((f) => [f.relPath, f.sizeBytes] as const));
  let bytes = 0;
  for (const n of nodes) {
    if (n.pinned) bytes += sizeByPath.get(n.filePath) ?? 0;
  }
  return tokensForBytes(bytes);
}

/** One agent's context estimate: its duties body plus the files of every
 *  node its graph node points at via direct imports/references edges. */
export function agentContextTokens(
  doc: AgentDoc,
  nodes: readonly MemoryNode[],
  edges: readonly MemoryEdge[],
  files: readonly MdFile[],
): number {
  let bytes = doc.body.length;
  const agentPath = `.claude/agents/${doc.fileName}`;
  const agentNode = nodes.find((n) => n.filePath === agentPath);
  if (agentNode !== undefined) {
    const sizeByPath = new Map(files.map((f) => [f.relPath, f.sizeBytes] as const));
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.source !== agentNode.id) continue;
      if (e.kind !== "imports" && e.kind !== "references") continue;
      const target = nodeById.get(e.target);
      if (target === undefined || seen.has(target.id)) continue;
      seen.add(target.id);
      bytes += sizeByPath.get(target.filePath) ?? 0;
    }
  }
  return tokensForBytes(bytes);
}
