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
