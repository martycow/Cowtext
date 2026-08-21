// Preset wire types — a SECOND SCHEMA mirroring the graph shape
// (WO13_CONTRACT.md §5.7), in lockstep with the Rust structs in
// src-tauri/src/preset.rs. Do not change shapes without a contract
// revision. buildPreset() owns the serialization (Rust stores the bytes
// verbatim); parsePreset() is the tolerant reader for Apply/Import, and
// runs the SAME §5.1 migration pass list (role rename table, `pinned` ->
// `rootLoad`, edge-kind conversions) over the raw record before
// `asRole`/`asKind` ever run — left alone, a v4 preset carrying
// `role: "rules"` would silently fall back to `architecture` instead of
// renaming to `rule`, and `kind: "conditional"` would flatten to
// `references`, dropping the guard.

import {
  EDGE_KINDS,
  NODE_ROLES,
  isGlobCondition,
  useGraphStore,
  type CompileTarget,
  type Deprecated,
  type EdgeGuard,
  type EdgeKind,
  type NodeRole,
} from "../store/graph";

export interface PresetInfo {
  name: string;
  path: string;
  savedAt: string;
  nodeCount: number;
}

export interface StubFile {
  relPath: string;
  content: string;
}

// ── Preset file shape (§5.7, frozen field order matches MemoryNode/MemoryEdge) ─

export interface PresetNode {
  id: string;
  title: string;
  role: NodeRole;
  brief: string;
  filePath: string;
  readOrder: number;
  /** v5: replaces `pinned: boolean` — same single-variant-optional shape as
   *  `MemoryNode.rootLoad`. */
  rootLoad?: "always";
  position: { x: number; y: number };
  scenePos?: { tx: number; ty: number };
  /** v3 (WO03) — carried through so a saved preset round-trips a v3 graph's
   *  metadata; absent on presets saved before this landed. */
  tags?: string[];
  owner?: string;
  /** v5 (WO13 §4.1) — set by a `supersedes` edge during migration (of the
   *  SOURCE graph a preset was built from), or by an explicit user
   *  deprecation before saving. */
  deprecated?: Deprecated;
  /** v5 (WO13 §4.1) */
  needsReview?: boolean;
  /** WO12 F5 — SHIPPED presets only (e.g. src/preset/starter.ts). A
   *  pre-filled file body for the node's stub. `buildPreset` never writes
   *  this (user-saved presets carry structure + briefs, never content, by
   *  design — see the doc comment above buildPreset); it exists purely so a
   *  built-in preset can deliver real skeleton bodies instead of the bare
   *  `# Title\n\n` stub. Absent on every preset that round-trips through
   *  Save/Export/Import. */
  content?: string;
}

export interface PresetEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** v5: replaces `condition?: string` — same typed shape as
   *  `MemoryEdge.guard`. */
  guard?: EdgeGuard;
  note?: string;
  /** v3 (WO03) — edge colour override, see MemoryEdge.color. */
  color?: string;
  /** v4 (WO10) — hand-edited route, see MemoryEdge.waypoints. Layout, like
   *  the node `position` a preset already carries. */
  waypoints?: { x: number; y: number }[];
}

/** Preset format version. v5 (WO13 §5.7) moves in LOCKSTEP with graph v5:
 *  `pinned` -> `rootLoad`, `condition` -> typed `guard`, `deprecated`/
 *  `needsReview` added — the Rust side (preset.rs) accepts and
 *  auto-upgrades presets saved at 1..5. `buildPreset` always writes the
 *  CURRENT version; `parsePreset` accepts any version in range and runs the
 *  full §5.1 pass list first. */
export type PresetVersion = 1 | 2 | 3 | 4 | 5;
export const PRESET_VERSION: PresetVersion = 5;

export interface CowtextPreset {
  version: PresetVersion;
  kind: "cowtext-preset";
  name: string;
  savedAt: string;
  nodes: PresetNode[];
  edges: PresetEdge[];
  compileTargets: CompileTarget[];
}

// ── Build (structure + briefs ONLY — never content, never lastVerified) ─

/** Serialize the current graph store as a preset. Same stable-serialization
 *  style as serializeGraph: fixed field order, sorted by id, LF, trailing
 *  newline. Node file CONTENT and lastVerified are deliberately excluded. */
export function buildPreset(name: string): string {
  const s = useGraphStore.getState();
  const preset: CowtextPreset = {
    version: PRESET_VERSION,
    kind: "cowtext-preset",
    name,
    savedAt: new Date().toISOString(),
    nodes: [...s.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => ({
        id: n.id,
        title: n.title,
        role: n.role,
        brief: n.brief,
        filePath: n.filePath,
        readOrder: n.readOrder,
        ...(n.rootLoad === "always" ? { rootLoad: "always" as const } : {}),
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        ...(n.scenePos !== undefined
          ? { scenePos: { tx: n.scenePos.tx, ty: n.scenePos.ty } }
          : {}),
        ...(n.tags !== undefined && n.tags.length > 0 ? { tags: [...n.tags] } : {}),
        ...(n.owner !== undefined && n.owner !== "" ? { owner: n.owner } : {}),
        ...(n.deprecated !== undefined ? { deprecated: n.deprecated } : {}),
        ...(n.needsReview === true ? { needsReview: true as const } : {}),
      })),
    edges: [...s.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        ...(e.guard !== undefined ? { guard: e.guard } : {}),
        ...(e.note !== undefined && e.note !== "" ? { note: e.note } : {}),
        ...(e.color !== undefined && e.color !== "" ? { color: e.color } : {}),
        ...(e.waypoints !== undefined && e.waypoints.length > 0
          ? { waypoints: e.waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }
          : {}),
      })),
    compileTargets: s.compileTargets,
  };
  return `${JSON.stringify(preset, null, 2)}\n`;
}

// ── Parse (tolerant — Rust already validated kind/version/nodes) ──────

type RawRecord = Record<string, unknown>;

/** Mirrors `src/store/graph.ts`'s `migrateNodeRole` (§5.1 passes 3-5) over a
 *  preset's raw node record — a SEPARATE implementation (not an import: the
 *  graph store's migration passes are module-private) that reads the SAME
 *  source-of-truth constants (`NODE_ROLES`) and applies the SAME rename
 *  table, so a v4 preset's `role: "rules"` becomes `rule` here exactly as
 *  it would inside a v4 graph.json. */
const ROLE_RENAME_TABLE: Readonly<Record<string, string>> = {
  persona: "agent",
  rules: "rule",
  task: "workflow",
  reference: "architecture",
  snippet: "example",
};

function migratePresetNodeRole(node: RawRecord): void {
  const roleStr = typeof node.role === "string" ? node.role : undefined;
  const renamed = roleStr !== undefined ? ROLE_RENAME_TABLE[roleStr] : undefined;
  if (renamed !== undefined) node.role = renamed;
}

function migratePresetNodeRootLoad(node: RawRecord): void {
  if (node.pinned === true) node.rootLoad = "always";
  delete node.pinned;
  if (node.rootLoad !== undefined && node.rootLoad !== "always") delete node.rootLoad;
}

/** Mirrors `migrateEdgeConditional` (§5.1 pass 8, §5.4) — same
 *  `isGlobCondition` predicate the graph migration and the compiler both
 *  use, imported (not re-derived: §5.4's own rule — "the predicate must
 *  exist exactly once per language"). */
function migratePresetEdgeConditional(edge: RawRecord): void {
  if (edge.kind === "conditional") {
    const condition =
      typeof edge.condition === "string" && edge.condition !== "" ? edge.condition : undefined;
    edge.kind = "imports";
    if (condition !== undefined) {
      edge.guard = isGlobCondition(condition)
        ? { type: "glob", globs: [condition] }
        : { type: "description", text: condition };
    }
  }
  delete edge.condition;
}

/** Mirrors `migrateSupersedes` (§5.1 pass 9, §5.5) exactly, including the
 *  byte-order-of-id tie-break for a node superseded twice — same algorithm
 *  as the graph mirror, just over a preset's raw records. */
function migratePresetSupersedes(nodes: RawRecord[], edges: RawRecord[]): RawRecord[] {
  const supersedes: { id: string; source: string; target: string }[] = [];
  for (const e of edges) {
    if (
      e.kind === "supersedes" &&
      typeof e.id === "string" &&
      typeof e.source === "string" &&
      typeof e.target === "string"
    ) {
      supersedes.push({ id: e.id, source: e.source, target: e.target });
    }
  }
  supersedes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const { source, target } of supersedes) {
    for (const node of nodes) {
      if (node.id === target) {
        if (node.deprecated === undefined) node.deprecated = { replacedBy: source };
        node.needsReview = true;
      }
    }
  }
  return edges.filter((e) => e.kind !== "supersedes");
}

/** Mirrors `migrateEdgeKindRename` + `stripIllegalGuard` (§5.1 passes
 *  10-12). Unlike the graph mirror, an unrecognized kind here does NOT fall
 *  back through `asKind`'s own separate fallback below — that stays as the
 *  final defensive net for anything this pre-pass didn't already convert. */
function migratePresetEdgeKindRename(edge: RawRecord): void {
  if (edge.kind === "conflicts-with") edge.kind = "contradicts";
  if (edge.kind === "contradicts") delete edge.guard;
}

/** Runs the full §5.1 role/edge-kind pass list over a preset's raw
 *  nodes/edges arrays, in place, BEFORE `asRole`/`asKind` ever see them —
 *  §5.7's own frozen instruction. Pass ordering mirrors `migrateGraph`'s:
 *  role rename before `pinned`->`rootLoad` (independent, but kept in the
 *  same order for readability); `conditional`->guard before the
 *  `conflicts-with` rename and before `supersedes` removal, so nothing is
 *  flattened before its condition/deprecation is captured. */
function migratePresetPasses(nodes: RawRecord[], edges: RawRecord[]): RawRecord[] {
  for (const node of nodes) {
    migratePresetNodeRole(node);
    migratePresetNodeRootLoad(node);
  }
  for (const edge of edges) {
    migratePresetEdgeConditional(edge);
  }
  const withoutSupersedes = migratePresetSupersedes(nodes, edges);
  for (const edge of withoutSupersedes) {
    migratePresetEdgeKindRename(edge);
  }
  return withoutSupersedes;
}

function asRole(v: unknown): NodeRole {
  // v5 fallback: "reference" (removed) -> "architecture" (WO13_CONTRACT.md
  // §5.1 pass 5 / §5.7).
  return NODE_ROLES.find((r) => r === v) ?? "architecture";
}

function asKind(v: unknown): EdgeKind {
  return EDGE_KINDS.find((k) => k === v) ?? "references";
}

function asGuard(v: unknown): EdgeGuard | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const g = v as Record<string, unknown>;
  if (g.type === "glob" && Array.isArray(g.globs)) {
    const globs = g.globs.filter((x): x is string => typeof x === "string");
    return globs.length > 0 ? { type: "glob", globs } : undefined;
  }
  if (g.type === "description" && typeof g.text === "string" && g.text !== "") {
    return { type: "description", text: g.text };
  }
  return undefined;
}

function asDeprecated(v: unknown): Deprecated | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const d = v as Record<string, unknown>;
  if (typeof d.replacedBy !== "string" || d.replacedBy === "") return undefined;
  return {
    replacedBy: d.replacedBy,
    ...(typeof d.since === "string" && d.since !== "" ? { since: d.since } : {}),
    ...(typeof d.reason === "string" && d.reason !== "" ? { reason: d.reason } : {}),
  };
}

/** v4 waypoints, tolerantly. A preset is user-editable JSON, so a malformed
 *  point drops the whole route rather than half of it — a partially applied
 *  bend is worse than none (the router just draws its own). */
function asWaypoints(v: unknown): { x: number; y: number }[] {
  if (!Array.isArray(v)) return [];
  const out: { x: number; y: number }[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) return [];
    const p = raw as { x?: unknown; y?: unknown };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
    out.push({ x: Math.round(p.x as number), y: Math.round(p.y as number) });
  }
  return out;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Parse validated preset JSON into a typed shape, coercing unknown roles/
 *  kinds to safe defaults. Throws on structural breakage (not-an-object,
 *  missing arrays, node without a usable .md filePath) — callers surface
 *  the message, so broken presets fail at import AND at apply. */
export function parsePreset(json: string): CowtextPreset {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Preset is not an object");
  }
  const p = raw as Record<string, unknown>;
  if (
    p.kind !== "cowtext-preset" ||
    typeof p.version !== "number" ||
    p.version < 1 ||
    p.version > PRESET_VERSION
  ) {
    throw new Error("Not a Cowtext preset in a supported version");
  }
  if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) {
    throw new Error("Preset is missing nodes/edges arrays");
  }

  const rawNodes: RawRecord[] = (p.nodes as unknown[]).map((n) =>
    typeof n === "object" && n !== null ? { ...(n as RawRecord) } : {},
  );
  const rawEdgesBeforePasses: RawRecord[] = (p.edges as unknown[]).map((e) =>
    typeof e === "object" && e !== null ? { ...(e as RawRecord) } : {},
  );
  // §5.7: the full §5.1 pass list runs BEFORE asRole/asKind — a v4 preset's
  // `role: "rules"` / `kind: "conditional"` must reach the rename table and
  // the guard-builder before either fallback ever sees them.
  const rawEdges = migratePresetPasses(rawNodes, rawEdgesBeforePasses);

  const nodes: PresetNode[] = rawNodes.map((n, i) => {
    const pos = (typeof n.position === "object" && n.position !== null
      ? n.position
      : { x: 0, y: 0 }) as Record<string, unknown>;
    const scene = (typeof n.scenePos === "object" && n.scenePos !== null
      ? n.scenePos
      : null) as Record<string, unknown> | null;
    const title = str(n.title, `Node ${i + 1}`);
    // A node without a usable .md filePath can never be applied —
    // preset_apply refuses non-markdown stubs, so reject it HERE (import
    // and apply both parse) with a message that names the node.
    const filePath = str(n.filePath);
    if (filePath === "" || !filePath.toLowerCase().endsWith(".md")) {
      throw new Error(`Preset node ${i + 1} ("${title}") has no valid .md filePath`);
    }
    const deprecated = asDeprecated(n.deprecated);
    return {
      id: str(n.id, `preset-node-${i}`),
      title,
      role: asRole(n.role),
      brief: str(n.brief),
      filePath,
      readOrder: typeof n.readOrder === "number" ? n.readOrder : i + 1,
      ...(n.rootLoad === "always" ? { rootLoad: "always" as const } : {}),
      position: {
        x: typeof pos.x === "number" ? pos.x : 0,
        y: typeof pos.y === "number" ? pos.y : 0,
      },
      ...(scene !== null && typeof scene.tx === "number" && typeof scene.ty === "number"
        ? { scenePos: { tx: scene.tx, ty: scene.ty } }
        : {}),
      // v3 (WO03) — absent on v1/v2 presets, which is exactly "no tags"/
      // "no owner" (same optional-field convention as the graph store).
      ...(Array.isArray(n.tags) && n.tags.length > 0
        ? { tags: n.tags.filter((t): t is string => typeof t === "string") }
        : {}),
      ...(typeof n.owner === "string" && n.owner !== "" ? { owner: n.owner } : {}),
      ...(deprecated !== undefined ? { deprecated } : {}),
      ...(n.needsReview === true ? { needsReview: true as const } : {}),
      // WO12 F5 — shipped-preset body, forward-compatible even though
      // buildPreset never writes it (see PresetNode.content).
      ...(typeof n.content === "string" ? { content: n.content } : {}),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: PresetEdge[] = rawEdges
    .map((e, i) => {
      const guard = asGuard(e.guard);
      return {
        id: str(e.id, `preset-edge-${i}`),
        source: str(e.source),
        target: str(e.target),
        kind: asKind(e.kind),
        ...(guard !== undefined && e.kind !== "contradicts" ? { guard } : {}),
        ...(typeof e.note === "string" && e.note !== "" ? { note: e.note } : {}),
        ...(typeof e.color === "string" && e.color !== "" ? { color: e.color } : {}),
        ...(asWaypoints(e.waypoints).length > 0 ? { waypoints: asWaypoints(e.waypoints) } : {}),
      };
    })
    // Dangling edges would fail compile validation later — drop them here.
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  const targets: CompileTarget[] = Array.isArray(p.compileTargets)
    ? (["claude", "agents", "cursor", "copilot", "gemini"] as const).filter((t) =>
        (p.compileTargets as unknown[]).includes(t),
      )
    : ["claude"];
  return {
    // Auto-upgrade on read: a v1..v4 preset parses straight into the
    // current shape after the §5.1 passes above — every new field is
    // optional, so there is no separate migration step beyond stamping the
    // version.
    version: PRESET_VERSION,
    kind: "cowtext-preset",
    name: str(p.name),
    savedAt: str(p.savedAt),
    nodes,
    edges,
    compileTargets: targets.length > 0 ? targets : ["claude"],
  };
}
