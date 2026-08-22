// Graph store — the single source of truth both views read (CLAUDE.md rule).
// Domain model per plan §4; React Flow maps FROM this state, never owns it.
// Persistence: debounced atomic save to <project>/.cowtext/graph.json via Rust.

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { renameNodeFile as fsRenameNodeFile } from "../fs/api";
import { useProjectStore } from "./project";
import { useSettingsStore } from "./settings";
import { agentDeleteListeners, agentRenameListeners, useAgentsStore } from "./agents";
import { useReviewStore } from "./review";
import { useTasksStore } from "./tasks";
import { useProjectSelectionStore } from "./projectSelection";
// Pure geometry helper + a module-scope probe the canvas registers; no React
// Flow context and no component tree reach in here.
import { viewportCenter } from "../canvas/viewport";

/** Drop the task-board selection. Split out only so `setSelection` reads as
 *  a list of things it clears rather than a wall of store plumbing. */
function clearTaskSelection(): void {
  if (useTasksStore.getState().selected !== null) useTasksStore.getState().select(null);
}

// ── Data model (plan §4; v5 taxonomy overhaul WO13_CONTRACT.md §4/§6) ──

// v2: the former "persona" role IS the agent (Marty, 2026-08-18) — an
// agent-role node may be backed by a real .claude/agents/*.md file.
// v3 (WO03): six more roles — 13 total. v5 (WO13): full taxonomy re-cut —
// 14 roles, 5 groups (1 identity + 3 constraints + 2 structure + 5 process
// + 3 knowledge, §6.1). `agent` sits outside the four pickable groups
// (dropping it would orphan every `.claude/agents/*.md` node — see
// src/wizard/roles.ts's WIZARD_BLOCKED_ROLES). Declaration order here IS
// the contract's enumeration order and mirrors
// src-tauri/src/project.rs's NodeRole exactly.
export type NodeRole =
  | "agent"
  | "rule"
  | "invariant"
  | "trap"
  | "architecture"
  | "decision"
  | "workflow"
  | "command"
  | "skill"
  | "env"
  | "tool"
  | "glossary"
  | "example"
  | "style";

export const NODE_ROLES: readonly NodeRole[] = [
  "agent",
  "rule",
  "invariant",
  "trap",
  "architecture",
  "decision",
  "workflow",
  "command",
  "skill",
  "env",
  "tool",
  "glossary",
  "example",
  "style",
];

/**
 * Canonical form of a project-relative path, for COMPARISON only — never
 * for storage or display (the stored path keeps whatever shape the scan
 * produced, and the Inspector shows it verbatim).
 *
 * WO10 item 10: this exists because the app had two different notions of
 * path equality. `isAgentFile` normalized separators and case; every other
 * comparison — the agents rail's `nodeFor`, `adoptFile`'s duplicate guard,
 * the file rail's node lookup — used a bare `===`. A node stored as
 * `.claude\agents\x.md` therefore rendered as an agent plate on the canvas
 * (normalized test) while simultaneously reporting "off the graph" in the
 * rail (exact test), and clicking Adopt sailed past the duplicate guard and
 * minted a SECOND node for the same file. Windows makes that shape easy to
 * produce, so one helper, used by every comparison, is the fix.
 */
export function canonPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** Do these two project-relative paths name the same file? */
export function sameRelPath(a: string, b: string): boolean {
  return canonPath(a) === canonPath(b);
}

/** Is this node backed by a real Claude Code agent definition file? */
export function isAgentFile(relPath: string): boolean {
  return canonPath(relPath).startsWith(".claude/agents/");
}

/** v5 (WO13 §4.1): `{ replacedBy, since?, reason? }`. Field order here IS
 *  the wire order — frozen. `since` is `YYYY-MM-DD`; migration NEVER
 *  stamps it (only a user-initiated deprecation in the UI does, and only
 *  this side computes the date — `project.rs`'s Rust mirror never calls
 *  `now()` for it, or the two serializers would disagree on bytes for the
 *  same graph). */
export interface Deprecated {
  replacedBy: string;
  since?: string;
  reason?: string;
}

export interface MemoryNode {
  id: string;
  title: string;
  role: NodeRole;
  /** One-liner used by Assemble (phase 3). */
  brief: string;
  /** Relative .md path; the file is the content source of truth. */
  filePath: string;
  /** Position in compiled output. */
  readOrder: number;
  /** v5 (WO13 §4.1): replaces `pinned: boolean`. The only legal value is
   *  `"always"`; on-demand is expressed by absence — a single-variant
   *  optional field, so the "was it false or was it just added" parity
   *  landmine between the two serializers is unrepresentable. */
  rootLoad?: "always";
  position: { x: number; y: number };
  /** Isometric tile coords for the barn scene (phase 5); auto if absent. */
  scenePos?: { tx: number; ty: number };
  /**
   * ISO date (YYYY-MM-DD) a human last confirmed the file is still accurate.
   * Absent = never verified. No UI reads it yet; consumed by usage-driven
   * pruning (FEATURES 6.9, phase 6). Approved by Marty 2026-08-16 (R11).
   */
  lastVerified?: string;
  /** v3 (WO03): free-form labels. Absent/empty are both "no tags". */
  tags?: string[];
  /** v3 (WO03): optional owner/assignee. Absent/empty are both "no owner". */
  owner?: string;
  /** v5 (WO13 §4.1, §5.5): set by a `supersedes` edge during migration, or
   *  by a user-initiated deprecation in the UI. */
  deprecated?: Deprecated;
  /** v5 (WO13 §4.1, §5.2): `true` ⇒ present on the wire; `false`/absent ⇒
   *  omitted. Set only where a migration pass actually rewrote a value, or
   *  by explicit user action — never re-fires on an unchanged value. */
  needsReview?: boolean;
  /**
   * v3 (WO03): reserved extension map, scalars only for now — never forces
   * a v4 bump. Keys serialize sorted (see {@link serializeGraph}) so output
   * stays deterministic regardless of insertion order.
   */
  meta?: Record<string, unknown>;
}

// v5 (WO13 §7.1): 5 edge kinds. `conditional` is gone (now `imports` + a
// typed EdgeGuard); `supersedes` is gone (now deprecates its target and is
// deleted by migration); `conflicts-with` is renamed `contradicts`.
// `overrides` is STRUCTURAL (participates in Kahn's algorithm / cycle
// validation / topological ordering exactly like `imports` — see
// `isStructuralEdgeKind`); `references` and `contradicts` are NON-structural
// (linter-only). Mirrors src-tauri/src/project.rs's EdgeKind exactly.
export type EdgeKind = "imports" | "references" | "overrides" | "sequence" | "contradicts";

export const EDGE_KINDS: readonly EdgeKind[] = [
  "imports",
  "references",
  "overrides",
  "sequence",
  "contradicts",
];

/** v5 (WO13 §4.2, §7): the typed replacement for the old free-text
 *  `condition` string on a `conditional` edge. Inner key order, frozen:
 *  `type` first, then `globs` (glob) or `text` (description) — matches
 *  Rust's `#[serde(tag = "type")]`, which emits the tag first. A glob
 *  guard with an empty `globs` array is invalid and normalized away by
 *  migration; the UI must never construct one. */
export type EdgeGuard = { type: "glob"; globs: string[] } | { type: "description"; text: string };

export interface MemoryEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** v5 (WO13 §4.2): replaces `condition?: string`. Legal on every kind
   *  except `contradicts` (migration strips it there). */
  guard?: EdgeGuard;
  /** Human hint rendered on the edge label. */
  note?: string;
  /** v3 (WO03): edge colour override (backlog "edge colour persistence"). */
  color?: string;
  /** v4 (WO10): hand-edited route. Flow-space points the router must pass
   *  through, in order, between source and target. Empty/absent ⇒ the
   *  automatic orthogonal route (canvas/edgePath.ts). Rounded to whole
   *  pixels on write so the file stays diff-stable. */
  waypoints?: { x: number; y: number }[];
}

// v3 (WO03): "copilot" (.github/copilot-instructions.md) and "gemini"
// (GEMINI.md) are new and OFF by default — see the `useGraphStore` initial
// `compileTargets` below, unchanged at `["claude"]`.
export type CompileTarget = "claude" | "agents" | "cursor" | "copilot" | "gemini";

/** Every {@link CompileTarget} value, used only by {@link migrateGraph}'s
 *  tolerance pass (mirrors `project.rs`'s `KNOWN_COMPILE_TARGET_STRS`). */
const COMPILE_TARGETS: readonly CompileTarget[] = ["claude", "agents", "cursor", "copilot", "gemini"];

export const GRAPH_VERSION = 5;

export interface BarnGraph {
  version: typeof GRAPH_VERSION;
  projectName: string;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  compileTargets: CompileTarget[];
}

// ── Serialization — stable field order + LF so git diffs stay small ───

/** Sorted-key copy of a `meta` map — deterministic output regardless of
 *  insertion order (mirrors project.rs's `BTreeMap`-backed `meta`). */
function sortedMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(meta).sort()) out[k] = meta[k];
  return out;
}

/** Sorted-key copy of a `Deprecated`, in the frozen field order
 *  (`replacedBy`, `since?`, `reason?`), `since`/`reason` omitted at
 *  absent/empty exactly like every other optional string field here. */
function stableDeprecated(d: Deprecated): Deprecated {
  return {
    replacedBy: d.replacedBy,
    ...(d.since !== undefined && d.since !== "" ? { since: d.since } : {}),
    ...(d.reason !== undefined && d.reason !== "" ? { reason: d.reason } : {}),
  };
}

/** Sorted-key copy of an `EdgeGuard`, `type` first (frozen — matches
 *  Rust's `#[serde(tag = "type")]`). */
function stableGuard(g: EdgeGuard): EdgeGuard {
  return g.type === "glob"
    ? { type: "glob", globs: [...g.globs] }
    : { type: "description", text: g.text };
}

function stableNode(n: MemoryNode): MemoryNode {
  return {
    id: n.id,
    title: n.title,
    role: n.role,
    brief: n.brief,
    filePath: n.filePath,
    readOrder: n.readOrder,
    ...(n.rootLoad === "always" ? { rootLoad: "always" as const } : {}),
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    ...(n.scenePos !== undefined ? { scenePos: { tx: n.scenePos.tx, ty: n.scenePos.ty } } : {}),
    ...(n.lastVerified !== undefined ? { lastVerified: n.lastVerified } : {}),
    ...(n.tags !== undefined && n.tags.length > 0 ? { tags: [...n.tags] } : {}),
    ...(n.owner !== undefined && n.owner !== "" ? { owner: n.owner } : {}),
    ...(n.deprecated !== undefined ? { deprecated: stableDeprecated(n.deprecated) } : {}),
    ...(n.needsReview === true ? { needsReview: true as const } : {}),
    ...(n.meta !== undefined && Object.keys(n.meta).length > 0
      ? { meta: sortedMeta(n.meta) }
      : {}),
  };
}

function stableEdge(e: MemoryEdge): MemoryEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    ...(e.guard !== undefined ? { guard: stableGuard(e.guard) } : {}),
    ...(e.note !== undefined && e.note !== "" ? { note: e.note } : {}),
    ...(e.color !== undefined && e.color !== "" ? { color: e.color } : {}),
    ...(e.waypoints !== undefined && e.waypoints.length > 0
      ? { waypoints: e.waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }
      : {}),
  };
}

/** Byte-order id comparator — deliberately NOT `localeCompare` (WO03 audit
 *  D5). `localeCompare`'s ICU collation weakens punctuation and is
 *  case-insensitive at the primary level; node/edge ids are
 *  `` `${base36}-${rand}` `` (every id contains a `-`), which is exactly
 *  where ICU and byte order disagree (`"m1abc-x9"` vs `"m1abcd-y9"`: byte
 *  order keeps `-` before `d`, ICU ignores it and compares `x` vs `d` —
 *  opposite results). Two serializers disagreeing on sort order churns the
 *  whole `nodes`/`edges` array in the git diff every time a Rust write and
 *  a TS write alternate, on a file where nothing changed. This must stay
 *  byte-identical to `project.rs`'s `serialize_graph`, which sorts with
 *  `String::cmp` (Rust's `Ord for str` — byte order); `<`/`>` on JS strings
 *  compares UTF-16 code units, which equals byte order for the ASCII-only
 *  alphanumeric-plus-hyphen alphabet `makeId()` produces. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function serializeGraph(g: BarnGraph): string {
  const stable: BarnGraph = {
    version: GRAPH_VERSION,
    projectName: g.projectName,
    nodes: [...g.nodes].sort((a, b) => compareIds(a.id, b.id)).map(stableNode),
    edges: [...g.edges].sort((a, b) => compareIds(a.id, b.id)).map(stableEdge),
    compileTargets: g.compileTargets,
  };
  // JSON.stringify emits LF; trailing newline keeps POSIX tools quiet.
  return `${JSON.stringify(stable, null, 2)}\n`;
}

/** A condition is a glob iff it has no whitespace and at least one of `*`,
 *  `?`, `[`, `/`; otherwise it is natural language (WO13_CONTRACT.md §5.4).
 *  The SAME predicate `compile.rs`'s `emit_cursor`/`on_demand_bullets` use
 *  (via `project.rs`'s `is_glob_condition`) — this is the one definition on
 *  the TS side; `src/config/*` imports it, no lane may re-derive it. */
export function isGlobCondition(condition: string): boolean {
  if (/\s/.test(condition)) return false;
  return (
    condition.includes("*") ||
    condition.includes("?") ||
    condition.includes("[") ||
    condition.includes("/")
  );
}

/** Loosely-typed working copy of a node/edge mid-migration — before the
 *  final typed cast, every migration pass below reads/writes through this
 *  shape rather than `MemoryNode`/`MemoryEdge` directly, mirroring
 *  `project.rs`'s `serde_json::Value` pre-pass approach so neither side can
 *  quietly rely on a field the other hasn't written yet. */
type RawRecord = Record<string, unknown>;

/** Passes 3+4+5 (§5.1): node role rewrite, in place. Order matters —
 *  `persona` → `agent` (pass 3) before the v4→v5 rename table (pass 4)
 *  before the unknown-role catch-all (pass 5), or a renamed v4 role would
 *  first be seen as unknown. */
const ROLE_RENAME_TABLE: Readonly<Record<string, readonly [string, boolean]>> = {
  rules: ["rule", false],
  task: ["workflow", true],
  reference: ["architecture", true],
  snippet: ["example", false],
};

function migrateNodeRole(node: RawRecord): void {
  if (node.role === "persona") node.role = "agent";
  const roleStr = typeof node.role === "string" ? node.role : undefined;
  const renamed = roleStr !== undefined ? ROLE_RENAME_TABLE[roleStr] : undefined;
  if (renamed !== undefined) {
    const [nextRole, flagReview] = renamed;
    node.role = nextRole;
    if (flagReview) node.needsReview = true;
  }
  const known = typeof node.role === "string" && (NODE_ROLES as readonly string[]).includes(node.role);
  if (!known) {
    node.role = "architecture";
    node.needsReview = true;
  }
}

/** Passes 6+7 (§5.1): `pinned: boolean` → `rootLoad?: "always"`. `pinned`
 *  is deleted unconditionally (idempotence law (a)). Pass 7 then discards
 *  any `rootLoad` value other than `"always"` — defensive tolerance,
 *  mirrors `project.rs`. */
function migrateNodeRootLoad(node: RawRecord): void {
  if (node.pinned === true) node.rootLoad = "always";
  delete node.pinned;
  if (node.rootLoad !== undefined && node.rootLoad !== "always") {
    delete node.rootLoad;
  }
}

/** Pass 8 (§5.1, §5.4): `conditional` edges become `imports` + a typed
 *  guard, classified by {@link isGlobCondition}. `condition` is deleted
 *  unconditionally, on every edge (idempotence law (a) + defensive
 *  clean-up of a stray key on any other kind). An absent/empty condition
 *  produces a bare, unguarded `imports` edge. */
function migrateEdgeConditional(edge: RawRecord): void {
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

/** Pass 9 (§5.1, §5.5): `supersedes` edges deprecate their target and are
 *  deleted, processed in BYTE ORDER of edge id (not array order) so "the
 *  lowest-id edge wins when a node is superseded twice" is deterministic.
 *  `since`/`reason` are never set — migration never stamps a date. Returns
 *  the edges array with every `supersedes` edge removed. */
function migrateSupersedes(nodes: RawRecord[], edges: RawRecord[]): RawRecord[] {
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
        if (node.deprecated === undefined) {
          node.deprecated = { replacedBy: source };
        }
        node.needsReview = true;
      }
    }
  }
  return edges.filter((e) => e.kind !== "supersedes");
}

/** Passes 10+11 (§5.1): `conflicts-with` → `contradicts`, then any edge
 *  kind still not one of the 5 v5 values falls back to `references`. */
function migrateEdgeKindRename(edge: RawRecord): void {
  if (edge.kind === "conflicts-with") edge.kind = "contradicts";
  const known = typeof edge.kind === "string" && (EDGE_KINDS as readonly string[]).includes(edge.kind);
  if (!known) edge.kind = "references";
}

/** Pass 12 (§5.1): `guard` is illegal on `contradicts` — strip it. */
function stripIllegalGuard(edge: RawRecord): void {
  if (edge.kind === "contradicts") delete edge.guard;
}

/** Pass 13 (§5.1, §5.6): `contradicts` normalization + dedupe. Step 1:
 *  canonicalize every `contradicts` edge to `source < target` byte-wise.
 *  Step 2: group by the canonical pair; keep only the lowest-id edge in
 *  byte order, dropping every other edge in the group OUTRIGHT (including
 *  its `note`/`color`/`waypoints` — the frozen, lossy behaviour §5.6 calls
 *  out). Both steps are fixed points, so a second pass is a no-op. */
function migrateContradicts(edges: RawRecord[]): RawRecord[] {
  for (const e of edges) {
    if (e.kind !== "contradicts") continue;
    const source = typeof e.source === "string" ? e.source : "";
    const target = typeof e.target === "string" ? e.target : "";
    if (source > target) {
      e.source = target;
      e.target = source;
    }
  }

  const winner = new Map<string, string>();
  const keyOf = (e: RawRecord): string =>
    `${typeof e.source === "string" ? e.source : ""} ${typeof e.target === "string" ? e.target : ""}`;
  for (const e of edges) {
    if (e.kind !== "contradicts") continue;
    const key = keyOf(e);
    const id = typeof e.id === "string" ? e.id : "";
    const cur = winner.get(key);
    if (cur === undefined || id < cur) winner.set(key, id);
  }
  return edges.filter((e) => {
    if (e.kind !== "contradicts") return true;
    const id = typeof e.id === "string" ? e.id : "";
    return winner.get(keyOf(e)) === id;
  });
}

/** Migration harness. NOT a version chain (WO13_CONTRACT.md §5): a set of
 *  passes over loosely-typed node/edge records, run unconditionally on
 *  every load regardless of the input's `version`, in the exact order of
 *  §5.1's table — v1's `persona`→`agent` rename included, so a v1 graph
 *  migrates to v5 in one call. Idempotence law: every pass is either (a)
 *  keyed on a value/key that no longer exists after it runs, or (b) a
 *  projection onto a canonical form (a fixed point by construction) — see
 *  each pass's own doc comment. `Err` for unparseable input, an
 *  out-of-range version, or a missing/non-array `nodes`/`edges`. Mirrors
 *  `migrate_graph` in `src-tauri/src/project.rs` pass-for-pass. */
export function migrateGraph(data: unknown): BarnGraph {
  if (typeof data !== "object" || data === null) {
    throw new Error("graph.json is not an object");
  }
  const g = data as {
    version?: unknown;
    projectName?: unknown;
    nodes?: unknown;
    edges?: unknown;
    compileTargets?: unknown;
  };
  // Pass 1: version range check.
  if (typeof g.version !== "number" || g.version < 1 || g.version > GRAPH_VERSION) {
    throw new Error(`Unsupported graph.json version: ${String(g.version)}`);
  }
  // Pass 2: nodes/edges present and arrays.
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error("graph.json is missing nodes/edges arrays");
  }

  const nodes: RawRecord[] = (g.nodes as RawRecord[]).map((n) => ({ ...n }));
  let edges: RawRecord[] = (g.edges as RawRecord[]).map((e) => ({ ...e }));

  // Passes 3-5 (role), then 6-7 (pinned → rootLoad).
  for (const node of nodes) {
    migrateNodeRole(node);
    migrateNodeRootLoad(node);
  }
  // Pass 8 (conditional → imports+guard) must run before 9's removal or
  // well before 10/11, or a `conditional` edge would lose its condition.
  for (const edge of edges) {
    migrateEdgeConditional(edge);
  }
  // Pass 9 (supersedes → deprecate + delete) must run before 10/11, or an
  // unconverted `supersedes` falls into 11's `references` catch-all.
  edges = migrateSupersedes(nodes, edges);
  // Passes 10-11 (conflicts-with → contradicts; unknown → references), then
  // 12 (strip illegal guard on contradicts).
  for (const edge of edges) {
    migrateEdgeKindRename(edge);
    stripIllegalGuard(edge);
  }
  // Pass 13: contradicts normalization + dedupe.
  edges = migrateContradicts(edges);

  // Pass 14: unrecognized compile target dropped from the array.
  const compileTargets = Array.isArray(g.compileTargets)
    ? (g.compileTargets as unknown[]).filter(
        (t): t is CompileTarget => typeof t === "string" && (COMPILE_TARGETS as readonly string[]).includes(t),
      )
    : (["claude"] as CompileTarget[]);

  // Pass 15: "typed" cast; stamp version = 5.
  return {
    version: GRAPH_VERSION,
    projectName: typeof g.projectName === "string" ? g.projectName : "",
    nodes: nodes as unknown as MemoryNode[],
    edges: edges as unknown as MemoryEdge[],
    compileTargets,
  };
}

// ── Store ─────────────────────────────────────────────────────────────

function makeId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "node" : slug;
}

/** Slug portion of a relative .md path (basename, extension stripped). */
function pathSlug(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/i, "");
}

/** Paths the app must never rename — mirrors the Rust guard in rename_node_file
 *  (src-tauri/src/project.rs). Normalized to forward slashes, lowercased. */
export function isRenameProtected(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase();
  if (normalized === "claude.md" || normalized === "agents.md") return true;
  if (
    normalized.startsWith(".claude/") ||
    normalized.startsWith(".cursor/") ||
    normalized.startsWith(".cowtext/")
  ) {
    return true;
  }
  return false;
}

/** Suggested .md path for a title: same directory as `currentPath`, slugified
 *  title, `.md`; de-duped with `-2`, `-3`… against `taken`. Pure. */
export function suggestFilePath(
  currentPath: string,
  title: string,
  taken: ReadonlySet<string>,
): string {
  const idx = currentPath.lastIndexOf("/");
  const dir = idx >= 0 ? currentPath.slice(0, idx) : "";
  const slug = slugify(title);
  const build = (suffix: string): string => (dir ? `${dir}/${slug}${suffix}.md` : `${slug}${suffix}.md`);
  let candidate = build("");
  for (let i = 2; taken.has(candidate); i += 1) {
    candidate = build(`-${i}`);
  }
  return candidate;
}

export interface PendingConnection {
  source: string;
  target: string;
}

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** Assemble job lifecycle for one node (Phase 3 contract §3.1).
 *  TRANSIENT — never serialized into graph.json, no version bump. */
export type AssembleStatus = "idle" | "queued" | "running" | "assembled" | "error";

/** WO13_CONTRACT.md §3.3: additive telemetry alongside `AssembleStatus`.
 *  `status` stays authoritative for `setAssembleStatus`; `phase` is a finer
 *  3-step readout (`starting → running → writing`) the card renders as a
 *  stepper with a live `mm:ss` elapsed time from `startedAt`. TRANSIENT —
 *  never serialized into graph.json. */
export type AssemblePhase = "queued" | "starting" | "running" | "writing" | "done" | "error";

interface GraphState {
  root: string | null;
  projectName: string;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  compileTargets: CompileTarget[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  pending: PendingConnection | null;
  loaded: boolean;
  saveState: SaveState;
  loadError: string | null;

  /** nodeId → status; absent = "idle". Transient, not persisted. */
  assembleStatus: Record<string, AssembleStatus>;
  /** nodeId → last error line. Transient, not persisted. */
  assembleErrors: Record<string, string>;
  setAssembleStatus: (nodeId: string, status: AssembleStatus, error?: string) => void;
  /** nodeId → phase; absent = no job in flight. Transient, not persisted. */
  assemblePhase: Record<string, AssemblePhase>;
  /** nodeId → epoch ms the job entered "starting". Transient, not persisted. */
  assembleStartedAt: Record<string, number>;
  /** WO13 §3.3: `run_job` (assemble.rs) emits one of these per phase
   *  transition; `startedAt` arrives once, from "starting" onward, and is
   *  left untouched by later phases of the same job. */
  setAssemblePhase: (nodeId: string, phase: AssemblePhase, startedAt?: number) => void;

  loadGraph: (root: string) => Promise<void>;
  flushSave: () => Promise<void>;

  createNode: (position: { x: number; y: number }) => Promise<void>;
  /** New Node wizard's entry point (WO01 Block D §T5) — same plumbing as
   *  createNode (stub write, history push, selection, review snapshot seed)
   *  but with caller-supplied role/content/pinned instead of the quick-node
   *  defaults. Resolves to the new node's id, or null when no project is
   *  open. Never throws: a failed disk write still lands the node (missing
   *  -file badge), matching createNode's existing contract.
   *
   *  `pinned` is a caller-facing "always load this" toggle, not the wire
   *  field name — WO13 renamed the node's own field to `rootLoad`
   *  internally; this boolean is translated to `rootLoad` when the node is
   *  built, so wizard call sites (`src/wizard/NodeWizard.tsx`) don't need
   *  to know the wire shape. */
  createNodeFrom: (params: {
    title: string;
    role: NodeRole;
    filePath: string;
    brief: string;
    pinned: boolean;
    content: string;
    position?: { x: number; y: number };
  }) => Promise<string | null>;
  /** Adds a node for an existing `.md` file. Returns the node id — the new
   *  node's, or the ALREADY-ADOPTED node's when `relPath` is on the graph
   *  (WO15 D-17), so a caller that needs to draw an edge to it never has to
   *  re-scan `nodes` to find out what it just did. `position` (flow-space,
   *  rounded on save) replaces the viewport-centre cascade when given. */
  adoptFile: (relPath: string, title?: string, position?: { x: number; y: number }) => string;
  updateNode: (id: string, patch: Partial<Omit<MemoryNode, "id">>) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  deleteNodes: (ids: string[]) => void;

  /** v5 convenience wrappers over `updateNode`/`updateEdge` (WO13_CONTRACT.md
   *  §17's frozen Stage-0 action list) — every lane touching root-load,
   *  deprecation, review flags or edge guards goes through these rather
   *  than hand-rolling a `updateNode(id, { rootLoad: ... })` patch at each
   *  call site. */
  setRootLoad: (id: string, rootLoad: "always" | undefined) => void;
  setDeprecated: (id: string, deprecated: Deprecated | undefined) => void;
  setNeedsReview: (id: string, needsReview: boolean) => void;
  setEdgeGuard: (edgeId: string, guard: EdgeGuard | undefined) => void;

  beginConnection: (conn: PendingConnection) => void;
  confirmConnection: (kind: EdgeKind, condition?: string) => void;
  cancelConnection: () => void;
  /** WO13_AUDIT.md D7 (fix-round Stage 0): applies the same §7.3 legality
   *  gate and §7.2/§7.1 `contradicts` normalization/guard-strip `addEdge`
   *  does, to the PATCHED edge. Returns `false` (and leaves the edge
   *  unchanged) on an unknown id or a denied result; `true` on success. */
  updateEdge: (id: string, patch: Partial<Omit<MemoryEdge, "id">>) => boolean;
  deleteEdges: (ids: string[]) => void;
  /** The one chokepoint every edge-creation code path goes through
   *  (WO13_CONTRACT.md §7.3, §17): applies the legality matrix (`deny`
   *  blocks creation outright, `warn` creates it — lint flags it later) and
   *  the §7.2 `contradicts` symmetric no-op rule (creating (B,A) when (A,B)
   *  already exists is a no-op, not a duplicate), plus the pre-existing
   *  exact-duplicate guard `confirmConnection` used to do inline. Returns
   *  the new edge's id (the caller-supplied `id`, if given, is preserved —
   *  paste/undo/redo/preset-apply need that), or `null` if the edge was
   *  denied, an exact duplicate, or a no-op reciprocal pair. */
  addEdge: (edge: Omit<MemoryEdge, "id"> & { id?: string }) => string | null;

  /** Wholesale selection sync — React Flow reports the full selection. */
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;

  /** Undo/redo over graph structure (contract TASKBOARD_BATCH §5).
   *  File operations are never undone. */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  /** Compile-target picker (Compile modal); persisted like any graph edit. */
  setCompileTargets: (targets: CompileTarget[]) => void;

  /** Rename the node's file on disk, then adopt the returned path.
   *  Rejects with a plain string; on failure `filePath` is unchanged. */
  renameNodeFile: (id: string, nextRelPath: string) => Promise<void>;
  /** Commit a title edit. Always sets the title. When settings.syncFileName is
   *  on and the file is not protected and the slug changed, also renames the
   *  file. Resolves to an error message when the rename failed (title is still
   *  applied), or null on success/no-op. Never throws. */
  commitTitle: (id: string, title: string) => Promise<string | null>;
}

/** WO13 §7.3: the §7.3 legality matrix (`legalityFor`, lane T1's
 *  `src/config/edgeRules.ts`) is not created until T1 lands, in PARALLEL
 *  with this file — but `src/store/graph.ts` is CLOSED to every lane after
 *  Stage 0 (§17), so T1 can never come back and wire a static `import`
 *  into this file themselves. A forward `import` of a file that does not
 *  exist yet on disk would also make this whole module fail to LOAD at
 *  runtime (Vitest/Vite resolve imports eagerly, unlike `tsc`'s type-only
 *  forward-reference tolerance) — a hard failure for every test in this
 *  file, not just an accepted type error. Resolved instead with the SAME
 *  registration idiom this file already uses for cross-module wiring
 *  (`agentRenameListeners`/`agentDeleteListeners` at the bottom of this
 *  file): a settable resolver slot, defaulting to "allow everything" —
 *  literally the contract's own "nothing matches" default (§7.3) — until
 *  `registerEdgeLegality` is called once, from wherever lane T1's
 *  `edgeRules.ts` (or its own consumer) chooses to wire it in. */
type EdgeLegalityResolver = (
  sourceRole: NodeRole,
  kind: EdgeKind,
  targetRole: NodeRole,
  targetDeprecated: boolean,
) => { legality: "allow" | "warn" | "deny"; reason: string };

let edgeLegalityResolver: EdgeLegalityResolver = () => ({ legality: "allow", reason: "" });

/** Wired in once by lane T1 (WO13_CONTRACT.md §7.3) to make `addEdge`'s
 *  deny/warn checks real. Before that call, `addEdge` allows every edge —
 *  see `edgeLegalityResolver`'s doc comment above. */
export function registerEdgeLegality(resolver: EdgeLegalityResolver): void {
  edgeLegalityResolver = resolver;
}

/** WO13_AUDIT.md D7: `contradicts` is a symmetric, unordered edge kind
 *  (§7.2) — its wire normal form is `source < target` byte order, the same
 *  canonicalization `migrateGraph`'s `migrateContradicts` pass applies on
 *  load. A `contradicts` edge that reaches `graph.json` un-normalized is
 *  silently reordered on the NEXT load, and if its (now-matching)
 *  reciprocal already exists, migration's dedupe collapses the pair and
 *  DELETES one edge outright — data loss discovered a reload after the
 *  edit that caused it. `guard` is separately illegal on `contradicts`
 *  (§7.1); a guard left on a `contradicts` edge (e.g. from switching a
 *  guarded `imports` edge's kind) must not survive even transiently.
 *  Applied on every write path that can produce a `contradicts` edge —
 *  `addEdge` and `updateEdge` both call this on the edge they are about to
 *  store, so this is enforced at creation time, not just at the next load. */
function normalizeContradicts<T extends { source: string; target: string; kind: EdgeKind; guard?: EdgeGuard }>(
  edge: T,
): T {
  if (edge.kind !== "contradicts") return edge;
  const { source, target } = edge;
  return {
    ...edge,
    source: source > target ? target : source,
    target: source > target ? source : target,
    guard: undefined,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

// ── Undo/redo (contract TASKBOARD_BATCH §5) ───────────────────────────
// Bounded snapshot history of the durable graph shape. FILE operations
// (rename/convert/stub creation) are NOT undone — graph structure only; a
// restored node whose file moved simply shows the missing-file badge.
// updateNode coalesces per-keystroke bursts into one snapshot per key.

interface HistorySnapshot {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  compileTargets: CompileTarget[];
}

const HISTORY_CAP = 100;
let undoStack: HistorySnapshot[] = [];
let redoStack: HistorySnapshot[] = [];
let lastPushKey = "";
let lastPushTs = 0;

function pushHistory(key: string): void {
  const now = Date.now();
  if (key === lastPushKey && now - lastPushTs < 800) {
    lastPushTs = now;
    return;
  }
  lastPushKey = key;
  lastPushTs = now;
  const s = useGraphStore.getState();
  undoStack.push({ nodes: s.nodes, edges: s.edges, compileTargets: s.compileTargets });
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
  useGraphStore.setState({ canUndo: true, canRedo: false });
}

function resetHistory(): void {
  undoStack = [];
  redoStack = [];
  lastPushKey = "";
  useGraphStore.setState({ canUndo: false, canRedo: false });
}

function scheduleSave(): void {
  useGraphStore.setState({ saveState: "dirty" });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void useGraphStore.getState().flushSave();
  }, 700);
}

function projectNameFromRoot(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
}

type SetFn = (
  partial:
    | Partial<GraphState>
    | ((state: GraphState) => Partial<GraphState>),
) => void;
type GetFn = () => GraphState;

/** Shared tail of createNode/createNodeFrom: write the stub file, seed the
 *  review baseline, add the node, select it, schedule the debounced save.
 *  A write failure is swallowed — the node still lands, with the missing
 *  -file badge doing the talking (createNode's original contract). */
async function commitNewNode(
  set: SetFn,
  get: GetFn,
  opts: {
    title: string;
    role: NodeRole;
    filePath: string;
    brief: string;
    pinned: boolean;
    content: string;
    position: { x: number; y: number };
  },
): Promise<string | null> {
  const s = get();
  if (s.root === null) return null;
  // Defense-in-depth: the wizard already blocks Confirm on a protected
  // path (isRenameProtected), but this is the trust boundary CLAUDE.md's
  // hard rules call out for generated/tool-owned files — a brand-new node
  // must never land on one no matter which caller reaches this tail
  // (WO01 Block D defect: StepDots/Import could otherwise bypass the
  // wizard's own check). Existing nodes adopting an already-protected file
  // go through a different path (adoptFile), not this one, so this can't
  // regress that flow.
  if (isRenameProtected(opts.filePath)) return null;
  const node: MemoryNode = {
    id: makeId(),
    title: opts.title,
    role: opts.role,
    brief: opts.brief,
    filePath: opts.filePath,
    readOrder: s.nodes.reduce((m, n) => Math.max(m, n.readOrder), 0) + 1,
    ...(opts.pinned ? { rootLoad: "always" as const } : {}),
    position: opts.position,
  };
  pushHistory("create");
  try {
    await invoke("write_md_file", {
      root: s.root,
      relPath: opts.filePath,
      content: opts.content,
    });
    useReviewStore.getState().noteSelfSave(opts.filePath, opts.content);
    void useProjectStore.getState().rescan();
  } catch {
    // Node still enters the graph; the missing-file badge will say so.
  }
  set((st) => ({
    nodes: [...st.nodes, node],
    selectedNodeIds: [node.id],
    selectedEdgeIds: [],
  }));
  scheduleSave();
  return node.id;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  root: null,
  projectName: "",
  nodes: [],
  edges: [],
  compileTargets: ["claude"],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  pending: null,
  loaded: false,
  saveState: "idle",
  loadError: null,
  assembleStatus: {},
  assembleErrors: {},
  assemblePhase: {},
  assembleStartedAt: {},
  canUndo: false,
  canRedo: false,

  setAssembleStatus: (nodeId, status, error) => {
    set((st) => {
      const nextStatus = { ...st.assembleStatus };
      if (status === "idle") delete nextStatus[nodeId];
      else nextStatus[nodeId] = status;
      const nextErrors = { ...st.assembleErrors };
      if (status === "error" && error !== undefined) nextErrors[nodeId] = error;
      else delete nextErrors[nodeId];
      return { assembleStatus: nextStatus, assembleErrors: nextErrors };
    });
  },

  setAssemblePhase: (nodeId, phase, startedAt) => {
    set((st) => {
      const nextPhase = { ...st.assemblePhase };
      nextPhase[nodeId] = phase;
      const nextStarted = { ...st.assembleStartedAt };
      if (startedAt !== undefined) nextStarted[nodeId] = startedAt;
      // A fresh "queued" with no startedAt means a brand-new job — clear
      // any stale elapsed-time reading from a previous run on this node.
      else if (phase === "queued") delete nextStarted[nodeId];
      return { assemblePhase: nextPhase, assembleStartedAt: nextStarted };
    });
  },

  setRootLoad: (id, rootLoad) => get().updateNode(id, { rootLoad }),
  setDeprecated: (id, deprecated) => get().updateNode(id, { deprecated }),
  setNeedsReview: (id, needsReview) => get().updateNode(id, { needsReview }),
  setEdgeGuard: (edgeId, guard) => get().updateEdge(edgeId, { guard }),

  addEdge: (edge) => {
    const s = get();
    // D7: canonicalize BEFORE resolving nodes/checking legality/duplicates,
    // so every check below sees the same normal form that will actually be
    // stored (a user can draw a `contradicts` edge in either direction).
    const normalized = normalizeContradicts(edge);
    const sourceNode = s.nodes.find((n) => n.id === normalized.source);
    const targetNode = s.nodes.find((n) => n.id === normalized.target);
    if (sourceNode === undefined || targetNode === undefined) return null;

    const { legality } = edgeLegalityResolver(
      sourceNode.role,
      normalized.kind,
      targetNode.role,
      targetNode.deprecated !== undefined,
    );
    if (legality === "deny") return null;

    // Exact-duplicate guard (source+target+kind) — the check
    // `confirmConnection` used to do inline before this action existed.
    const exactDup = s.edges.some(
      (e) => e.source === normalized.source && e.target === normalized.target && e.kind === normalized.kind,
    );
    if (exactDup) return null;

    // §7.2: `contradicts` is a symmetric, unordered pair. Creating (B, A)
    // when (A, B) already exists is a no-op, not a duplicate. Redundant
    // with the exact-duplicate check above once every write path
    // normalizes (this one does), but kept as a defensive belt-and-braces
    // check against any edge that reached the store un-normalized (e.g. a
    // hand-edited preset, or a future write path not yet covered).
    if (normalized.kind === "contradicts") {
      const reciprocal = s.edges.some(
        (e) => e.kind === "contradicts" && e.source === normalized.target && e.target === normalized.source,
      );
      if (reciprocal) return null;
    }

    pushHistory("edge-add");
    const id = edge.id ?? makeId();
    const full: MemoryEdge = { ...normalized, id };
    set((st) => ({ edges: [...st.edges, full] }));
    scheduleSave();
    return id;
  },

  loadGraph: async (root) => {
    clearTimeout(saveTimer);
    resetHistory();
    set({
      root,
      loaded: false,
      loadError: null,
      saveState: "idle",
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
      pending: null,
      assembleStatus: {},
      assembleErrors: {},
      assemblePhase: {},
      assembleStartedAt: {},
      projectName: projectNameFromRoot(root),
    });
    try {
      const raw = await invoke<string | null>("read_graph", { root });
      if (raw !== null) {
        const graph = migrateGraph(JSON.parse(raw));
        set({
          projectName: graph.projectName || projectNameFromRoot(root),
          nodes: graph.nodes,
          edges: graph.edges,
          compileTargets: graph.compileTargets,
        });
        // Review baseline (Block C §T4): every managed file's current disk
        // content becomes "what a future external edit diffs against".
        void useReviewStore.getState().initSnapshots(root, graph.nodes.map((n) => n.filePath));
      } else {
        // No graph.json yet — a brand-new project. Seed its compile targets
        // from the app-level default (the ticks in the title screen's
        // AI-toolchain details), narrowed here rather than in settings.ts so
        // COMPILE_TARGETS stays the single runtime source of truth and an
        // unknown target left by a newer build is dropped at the point of
        // use. Canonical order, not the user's tick order. This also RESETS
        // the targets on a project switch, which the old code left carrying
        // the previous project's value into the new one.
        const stored = useSettingsStore.getState().defaultCompileTargets as readonly string[];
        const wanted = COMPILE_TARGETS.filter((t) => stored.includes(t));
        set({ compileTargets: wanted.length > 0 ? wanted : ["claude"] });
      }
      set({ loaded: true, saveState: raw === null ? "idle" : "saved" });
    } catch (e) {
      set({ loaded: true, loadError: String(e) });
    }
  },

  flushSave: async () => {
    const s = get();
    if (s.root === null || !s.loaded || s.loadError !== null) return;
    const content = serializeGraph({
      version: GRAPH_VERSION,
      projectName: s.projectName,
      nodes: s.nodes,
      edges: s.edges,
      compileTargets: s.compileTargets,
    });
    set({ saveState: "saving" });
    try {
      await invoke("write_graph", { root: s.root, content });
      // Only report "saved" if nothing changed while the write was in flight.
      if (get().saveState === "saving") set({ saveState: "saved" });
    } catch {
      set({ saveState: "error" });
    }
  },

  createNode: async (position) => {
    const s = get();
    if (s.root === null) return;
    const title = "New node";
    const taken = new Set([
      ...s.nodes.map((n) => n.filePath),
      ...useProjectStore.getState().files.map((f) => f.relPath),
    ]);
    let filePath = `context/${slugify(title)}.md`;
    for (let i = 2; taken.has(filePath); i += 1) {
      filePath = `context/${slugify(title)}-${i}.md`;
    }
    await commitNewNode(set, get, {
      title,
      role: "architecture",
      filePath,
      brief: "",
      pinned: false,
      // Stub the file so the node is real on disk from the first second.
      content: `# ${title}\n\n`,
      position,
    });
  },

  createNodeFrom: async (params) => {
    return commitNewNode(set, get, {
      title: params.title,
      role: params.role,
      filePath: params.filePath,
      brief: params.brief,
      pinned: params.pinned,
      content: params.content,
      position: params.position ?? { x: 80, y: 80 },
    });
  },

  adoptFile: (relPath, title, at) => {
    const s = get();
    // Already adopted: hand back the existing id rather than nothing, so
    // "adopt then link" is safe to call twice (WO15 D-17).
    const existing = s.nodes.find((n) => sameRelPath(n.filePath, relPath));
    if (existing !== undefined) return existing.id;
    pushHistory("adopt");
    // Separator-normalized basename (WO15 audit F8, §7.8): a `.md` path
    // stored with backslashes — easy to produce on Windows — used to fail
    // the bare "/" split and title the node with the WHOLE path, one line
    // below a duplicate guard that already normalizes via `sameRelPath`.
    // `canonPath` is deliberately not used here: it lower-cases, and this
    // basename becomes the node's visible title.
    const fileName = relPath.replace(/\\/g, "/").split("/").pop() ?? relPath;
    const derived = fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
    const i = s.nodes.length;
    // WO10 item 7: land where the user is looking. `viewportCenter()` is null
    // only when no canvas is mounted, in which case the old fixed cascade
    // from (80, 80) is still the best available answer. Either way the
    // cascade offset stays, so adopting six files in a row fans them out
    // instead of stacking six cards on one pixel. An explicit `at` (the
    // canvas menu's flow position, WO15 Block 5b) skips the whole cascade:
    // the caller already knows exactly where the user pointed.
    const centre = viewportCenter();
    const spread = { x: (i % 4) * 28, y: Math.floor(i / 4) * 24 };
    const position =
      at !== undefined
        ? { x: at.x, y: at.y }
        : centre !== null
          ? { x: centre.x + spread.x, y: centre.y + spread.y }
          : { x: 80 + (i % 4) * 280, y: 80 + Math.floor(i / 4) * 140 };
    const node: MemoryNode = {
      id: makeId(),
      title: title !== undefined && title !== "" ? title : derived,
      // An adopted .claude/agents file IS an agent — the unified role.
      // v5: "reference" no longer exists; "architecture" is the WO13
      // fallback role (WIZARD_FALLBACK_ROLE, WO13_CONTRACT.md §6.1).
      role: isAgentFile(relPath) ? "agent" : "architecture",
      brief: "",
      filePath: relPath,
      readOrder: s.nodes.reduce((m, n) => Math.max(m, n.readOrder), 0) + 1,
      position,
    };
    set((st) => ({
      nodes: [...st.nodes, node],
    }));
    scheduleSave();
    // WO11 C1 fix: this used to set selectedNodeIds directly, bypassing
    // setSelection's clear-other-selections logic — the agents-store
    // selection (whatever adopted this file in the first place, via the
    // rail) was left stale. Harmless today only because the Inspector's
    // branch ladder checks node !== undefined before agentsSel !== null;
    // routing through setSelection here makes "exactly one thing selected"
    // true structurally instead of by branch-order accident.
    get().setSelection([node.id], []);
    // Existing file, unknown content — read it for the review baseline
    // (Block C §T4). Best-effort: initSnapshots tolerates a missing file.
    if (s.root !== null) void useReviewStore.getState().initSnapshots(s.root, [relPath]);
    return node.id;
  },

  updateNode: (id, patch) => {
    pushHistory(`upd:${id}`);
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, ...patch, id } : n)),
    }));
    scheduleSave();
  },

  moveNode: (id, position) => {
    pushHistory(`move:${id}`);
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }));
    scheduleSave();
  },

  deleteNodes: (ids) => {
    pushHistory("del-nodes");
    const gone = new Set(ids);
    set((st) => {
      const nextStatus = { ...st.assembleStatus };
      const nextErrors = { ...st.assembleErrors };
      const nextPhase = { ...st.assemblePhase };
      const nextStarted = { ...st.assembleStartedAt };
      for (const id of ids) {
        delete nextStatus[id];
        delete nextErrors[id];
        delete nextPhase[id];
        delete nextStarted[id];
      }
      return {
        nodes: st.nodes.filter((n) => !gone.has(n.id)),
        edges: st.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        selectedNodeIds: st.selectedNodeIds.filter((i) => !gone.has(i)),
        assembleStatus: nextStatus,
        assembleErrors: nextErrors,
        assemblePhase: nextPhase,
        assembleStartedAt: nextStarted,
      };
    });
    scheduleSave();
  },

  beginConnection: (conn) => {
    if (conn.source === conn.target) return;
    set({ pending: conn });
  },

  /** v5: `condition` is classified into a typed `guard` via
   *  `isGlobCondition`, the same predicate migration uses (§5.4) —
   *  `kind === "conditional"` no longer exists, so any structural kind can
   *  carry a guard now (§7.1). Delegates to `addEdge` for the legality
   *  check, the exact-duplicate guard and the `contradicts` no-op rule. */
  confirmConnection: (kind, condition) => {
    const { pending } = get();
    if (pending === null) return;
    const guard: EdgeGuard | undefined =
      condition !== undefined && condition !== ""
        ? isGlobCondition(condition)
          ? { type: "glob", globs: [condition] }
          : { type: "description", text: condition }
        : undefined;
    get().addEdge({
      source: pending.source,
      target: pending.target,
      kind,
      ...(guard !== undefined ? { guard } : {}),
    });
    set({ pending: null });
  },

  cancelConnection: () => set({ pending: null }),

  /** WO13_AUDIT.md D7 (fix-round Stage 0 — `graph.ts` reopened serially,
   *  per tech-lead's ruling that "CLOSED" applies only for the duration of
   *  PARALLEL lane execution, §17 amended). Runs the same checks `addEdge`
   *  does, against the PATCHED result: the §7.3 legality gate (deny
   *  refuses the whole update — the only call site today,
   *  `MemoryEdge.tsx`'s kind-switcher, already has its own courtesy check,
   *  but this is the real chokepoint every other path goes through too),
   *  and `normalizeContradicts` (§7.2 endpoint order, §7.1 guard strip) so
   *  a kind-switch onto `contradicts` — or any patch that happens to leave
   *  one un-normalized — can never reach `graph.json` in a shape migration
   *  would silently reorder or (if the reciprocal already exists) collapse
   *  and delete outright. Returns `false` on refusal (unknown edge id, or
   *  denied) so a caller can react; `true` on success. */
  updateEdge: (id, patch) => {
    const s = get();
    const existing = s.edges.find((e) => e.id === id);
    if (existing === undefined) return false;
    const merged = normalizeContradicts<MemoryEdge>({ ...existing, ...patch, id });

    const sourceNode = s.nodes.find((n) => n.id === merged.source);
    const targetNode = s.nodes.find((n) => n.id === merged.target);
    if (sourceNode === undefined || targetNode === undefined) return false;
    const { legality } = edgeLegalityResolver(
      sourceNode.role,
      merged.kind,
      targetNode.role,
      targetNode.deprecated !== undefined,
    );
    if (legality === "deny") return false;

    pushHistory(`edge:${id}`);
    set((st) => ({
      edges: st.edges.map((e) => (e.id === id ? merged : e)),
    }));
    scheduleSave();
    return true;
  },

  deleteEdges: (ids) => {
    pushHistory("del-edges");
    const gone = new Set(ids);
    set((st) => ({
      edges: st.edges.filter((e) => !gone.has(e.id)),
      selectedEdgeIds: st.selectedEdgeIds.filter((i) => !gone.has(i)),
    }));
    scheduleSave();
  },

  // WO10 item 10 — this is now the ARBITER of what the Inspector shows, not
  // just the holder of the graph selection.
  //
  // Four stores carry a "selection" (graph, agents, tasks, sessions) and the
  // Inspector picks a panel with a branch ladder over all four. Nothing ever
  // cleared the agents one — `select(null)` existed nowhere in the codebase —
  // so it survived every subsequent selection change and the ladder fell
  // through to it whenever the graph selection went empty. Concretely: click
  // an ADOPTED agent in the rail, then click empty canvas, and the Inspector
  // offered "Off the graph — adopt it to wire context edges" for a node that
  // was plainly sitting on the graph.
  //
  // Changing the graph selection now clears the other three panel-owning
  // selections (agents, tasks, project — WO11 adds the third). Callers that
  // want both — the agents rail picking a row — set the graph selection
  // FIRST and their own second; see RailSections.pick.
  //
  // WO11 G3 fix: the unchanged-selection early return used to run BEFORE
  // these clears, so it doubled as an accidental guard against them too.
  // Concretely: select a task (graph selection stays [],[] — tasks are a
  // separate store), then click an off-graph agent in the rail. The rail
  // calls setSelection([], []) first (per the convention above) — same as
  // the current (already-empty) graph selection — so the old early return
  // fired and clearTaskSelection() never ran; the Inspector kept showing
  // the task instead of the agent. The clears must run unconditionally;
  // only the actual `set` of nodeIds/edgeIds is worth skipping when nothing
  // changed.
  setSelection: (nodeIds, edgeIds) => {
    const s = get();
    const same = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    if (useProjectSelectionStore.getState().selected) {
      useProjectSelectionStore.getState().select(false);
    }
    if (useAgentsStore.getState().selection !== null) {
      useAgentsStore.getState().select(null);
    }
    clearTaskSelection();
    if (same(s.selectedNodeIds, nodeIds) && same(s.selectedEdgeIds, edgeIds)) return;
    set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
  },

  setCompileTargets: (targets) => {
    pushHistory("targets");
    set({ compileTargets: targets });
    scheduleSave();
  },

  undo: () => {
    const snap = undoStack.pop();
    if (snap === undefined) return;
    const s = get();
    redoStack.push({ nodes: s.nodes, edges: s.edges, compileTargets: s.compileTargets });
    lastPushKey = ""; // break coalescing across an undo boundary
    const nodeIds = new Set(snap.nodes.map((n) => n.id));
    const edgeIds = new Set(snap.edges.map((e) => e.id));
    set({
      nodes: snap.nodes,
      edges: snap.edges,
      compileTargets: snap.compileTargets,
      selectedNodeIds: s.selectedNodeIds.filter((i) => nodeIds.has(i)),
      selectedEdgeIds: s.selectedEdgeIds.filter((i) => edgeIds.has(i)),
      canUndo: undoStack.length > 0,
      canRedo: true,
    });
    scheduleSave();
  },

  redo: () => {
    const snap = redoStack.pop();
    if (snap === undefined) return;
    const s = get();
    undoStack.push({ nodes: s.nodes, edges: s.edges, compileTargets: s.compileTargets });
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    lastPushKey = "";
    const nodeIds = new Set(snap.nodes.map((n) => n.id));
    const edgeIds = new Set(snap.edges.map((e) => e.id));
    set({
      nodes: snap.nodes,
      edges: snap.edges,
      compileTargets: snap.compileTargets,
      selectedNodeIds: s.selectedNodeIds.filter((i) => nodeIds.has(i)),
      selectedEdgeIds: s.selectedEdgeIds.filter((i) => edgeIds.has(i)),
      canUndo: true,
      canRedo: redoStack.length > 0,
    });
    scheduleSave();
  },

  renameNodeFile: async (id, nextRelPath) => {
    const s = get();
    if (s.root === null) throw new Error("No project open");
    const node = s.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    let returned: string;
    if (isAgentFile(node.filePath)) {
      // Agent-backed node: route through the agents layer (rename_node_file
      // refuses .claude/*). The new name is the requested basename sans .md.
      // WO11 tech-lead finding, same pattern as Inspector.tsx's AgentNodePanel:
      // a bare "/" split leaves the whole path as `fileName` on a node stored
      // with backslashes (easy on Windows), matching no agent's fileName.
      const fileName = node.filePath.replace(/\\/g, "/").split("/").pop() ?? node.filePath;
      const base = (nextRelPath.split("/").pop() ?? nextRelPath).replace(/\.md$/i, "");
      const nextFileName = await useAgentsStore.getState().renameAgentByFile(fileName, base);
      returned = `.claude/agents/${nextFileName}`;
    } else {
      returned = await fsRenameNodeFile(s.root, node.filePath, nextRelPath);
    }
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, filePath: returned } : n)),
    }));
    scheduleSave();
    void useProjectStore.getState().rescan();
  },

  commitTitle: async (id, title) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return null;
    get().updateNode(id, { title });
    if (!useSettingsStore.getState().syncFileName) return null;
    // Agent-backed files are renameable (via the agents layer) even though
    // the generic .claude/ guard would refuse them.
    if (isRenameProtected(node.filePath) && !isAgentFile(node.filePath)) return null;
    if (pathSlug(node.filePath) === slugify(title)) return null;
    const taken = new Set([
      ...get().nodes.map((n) => n.filePath),
      ...useProjectStore.getState().files.map((f) => f.relPath),
    ]);
    const nextRelPath = suggestFilePath(node.filePath, title, taken);
    try {
      await get().renameNodeFile(id, nextRelPath);
      return null;
    } catch (e) {
      return String(e);
    }
  },
}));

// Agent renamed through the agents layer (rail / agent editor) → keep every
// graph node backed by that file pointing at the new path, and mirror the
// new agent name into the node title (they are one identity, Marty 2026-08-18).
//
// WO11 §10.3/§10.5 standing rule: no bare `===`/`.split("/")` on a `.md`
// path in src/ — this listener was itself one of the four defects that rule
// was written against (a node stored as `.claude\agents\x.md` compared
// false against the forward-slash `oldPath` here, so it silently never
// followed a rename). `sameRelPath` is the only sanctioned comparison.
agentRenameListeners.push((oldFileName, newFileName, newName) => {
  const oldPath = `.claude/agents/${oldFileName}`;
  const newPath = `.claude/agents/${newFileName}`;
  const s = useGraphStore.getState();
  if (!s.nodes.some((n) => sameRelPath(n.filePath, oldPath))) return;
  useGraphStore.setState((st) => ({
    nodes: st.nodes.map((n) =>
      sameRelPath(n.filePath, oldPath)
        ? { ...n, filePath: newPath, title: newName !== "" ? newName : n.title }
        : n,
    ),
  }));
  scheduleSave();
});

// Agent FILE deleted through the agents layer (rail context menu only, per
// WO11_CONTRACT.md §10.1/§10.3) → prune every graph node backed by that
// file. Fired only after `agent_delete` has succeeded and the agents store
// has already applied its own update (agents.ts's notifyAgentDeleted call
// site). Routes through `deleteNodes`, never a raw `setState`, because that
// is the one action that also prunes incident edges, clears the selection
// and assemble state, and pushes an undo entry (below) — a node whose file
// is gone still gets a real undo entry back to "node present, file missing",
// which is the honest state; the file deletion itself is never undoable
// (pre-existing, deliberate asymmetry).
agentDeleteListeners.push((fileName) => {
  const path = `.claude/agents/${fileName}`;
  const ids = useGraphStore.getState().nodes.filter((n) => sameRelPath(n.filePath, path)).map((n) => n.id);
  if (ids.length === 0) return;
  useGraphStore.getState().deleteNodes(ids);
});
