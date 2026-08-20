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

// ── Data model (plan §4) ──────────────────────────────────────────────

// v2: the former "persona" role IS the agent (Marty, 2026-08-18) — an
// agent-role node may be backed by a real .claude/agents/*.md file.
// v3 (WO03): six more roles — 13 total (WO03_CONTRACT.md §"Graph v3
// schema"). Mirrors src-tauri/src/project.rs's NodeRole.
export type NodeRole =
  | "agent"
  | "rules"
  | "architecture"
  | "workflow"
  | "task"
  | "reference"
  | "glossary"
  | "command"
  | "invariant"
  | "trap"
  | "skill"
  | "snippet"
  | "style";

export const NODE_ROLES: readonly NodeRole[] = [
  "agent",
  "rules",
  "architecture",
  "workflow",
  "task",
  "reference",
  "glossary",
  "command",
  "invariant",
  "trap",
  "skill",
  "snippet",
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
  /** Always-in-context vs on-demand. */
  pinned: boolean;
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
  /** v3 (WO03): optional owner/assignee. */
  owner?: string;
  /**
   * v3 (WO03): reserved extension map, scalars only for now — never forces
   * a v4 bump. Keys serialize sorted (see {@link serializeGraph}) so output
   * stays deterministic regardless of insertion order.
   */
  meta?: Record<string, unknown>;
}

// v3 (WO03): `overrides` is STRUCTURAL (participates in Kahn's algorithm /
// cycle validation / topological ordering exactly like `imports` —
// compile.rs's `EdgeKind::is_structural`); `supersedes` and `conflicts-with`
// are NON-structural (linter-only).
export type EdgeKind =
  | "imports"
  | "references"
  | "conditional"
  | "sequence"
  | "overrides"
  | "supersedes"
  | "conflicts-with";

export const EDGE_KINDS: readonly EdgeKind[] = [
  "imports",
  "references",
  "conditional",
  "sequence",
  "overrides",
  "supersedes",
  "conflicts-with",
];

export interface MemoryEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** For conditional: glob ("src/net/**") OR natural language. */
  condition?: string;
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

export const GRAPH_VERSION = 4;

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

function stableNode(n: MemoryNode): MemoryNode {
  return {
    id: n.id,
    title: n.title,
    role: n.role,
    brief: n.brief,
    filePath: n.filePath,
    readOrder: n.readOrder,
    pinned: n.pinned,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    ...(n.scenePos !== undefined ? { scenePos: { tx: n.scenePos.tx, ty: n.scenePos.ty } } : {}),
    ...(n.lastVerified !== undefined ? { lastVerified: n.lastVerified } : {}),
    ...(n.tags !== undefined && n.tags.length > 0 ? { tags: [...n.tags] } : {}),
    ...(n.owner !== undefined && n.owner !== "" ? { owner: n.owner } : {}),
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
    ...(e.condition !== undefined && e.condition !== "" ? { condition: e.condition } : {}),
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

/** Migration harness (backlog 9.2; v3 bump WO03 §"Graph v3 schema"; v4 bump
 *  WO10 §"Lane 1"): version 4 is current. v1 → v2: the "persona" role was renamed to
 *  "agent" (same semantics, now unified with Claude Code agent files).
 *  v2 → v3: pure default-filling — the new node fields (`tags`/`owner`/
 *  `meta`), new edge field (`color`), widened role/edge-kind vocabularies,
 *  and two new compile targets are all optional on the TS types above, so
 *  a v2 graph is already a structurally valid v3 graph; nothing here needs
 *  to touch node/edge contents. v3 → v4: pure default-filling again — the
 *  only new field is the edge's optional `waypoints`, absent ⇒ the
 *  automatic route. A v1 graph migrates v1→v2→v3→v4 in one call (the
 *  persona→agent rewrite below, then the version stamp at the
 *  bottom). Anything else must come through here with an explicit
 *  migration step. Mirrors `migrate_graph` in `src-tauri/src/project.rs`. */
export function migrateGraph(data: unknown): BarnGraph {
  if (typeof data !== "object" || data === null) {
    throw new Error("graph.json is not an object");
  }
  const g = data as { version?: unknown; projectName?: unknown; nodes?: unknown; edges?: unknown; compileTargets?: unknown };
  if (typeof g.version !== "number" || g.version < 1 || g.version > GRAPH_VERSION) {
    throw new Error(`Unsupported graph.json version: ${String(g.version)}`);
  }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error("graph.json is missing nodes/edges arrays");
  }
  const nodes = (g.nodes as MemoryNode[]).map((n) =>
    (n.role as string) === "persona" ? { ...n, role: "agent" as NodeRole } : n,
  );
  return {
    version: GRAPH_VERSION,
    projectName: typeof g.projectName === "string" ? g.projectName : "",
    nodes,
    edges: g.edges as MemoryEdge[],
    compileTargets: Array.isArray(g.compileTargets) ? (g.compileTargets as CompileTarget[]) : ["claude"],
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

  loadGraph: (root: string) => Promise<void>;
  flushSave: () => Promise<void>;

  createNode: (position: { x: number; y: number }) => Promise<void>;
  /** New Node wizard's entry point (WO01 Block D §T5) — same plumbing as
   *  createNode (stub write, history push, selection, review snapshot seed)
   *  but with caller-supplied role/content/pinned instead of the quick-node
   *  defaults. Resolves to the new node's id, or null when no project is
   *  open. Never throws: a failed disk write still lands the node (missing
   *  -file badge), matching createNode's existing contract. */
  createNodeFrom: (params: {
    title: string;
    role: NodeRole;
    filePath: string;
    brief: string;
    pinned: boolean;
    content: string;
    position?: { x: number; y: number };
  }) => Promise<string | null>;
  adoptFile: (relPath: string, title?: string) => void;
  updateNode: (id: string, patch: Partial<Omit<MemoryNode, "id">>) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  deleteNodes: (ids: string[]) => void;

  beginConnection: (conn: PendingConnection) => void;
  confirmConnection: (kind: EdgeKind, condition?: string) => void;
  cancelConnection: () => void;
  updateEdge: (id: string, patch: Partial<Omit<MemoryEdge, "id">>) => void;
  deleteEdges: (ids: string[]) => void;

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
    pinned: opts.pinned,
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
      role: "reference",
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

  adoptFile: (relPath, title) => {
    const s = get();
    if (s.nodes.some((n) => sameRelPath(n.filePath, relPath))) return;
    pushHistory("adopt");
    const fileName = relPath.split("/").pop() ?? relPath;
    const derived = fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
    const i = s.nodes.length;
    // WO10 item 7: land where the user is looking. `viewportCenter()` is null
    // only when no canvas is mounted, in which case the old fixed cascade
    // from (80, 80) is still the best available answer. Either way the
    // cascade offset stays, so adopting six files in a row fans them out
    // instead of stacking six cards on one pixel.
    const centre = viewportCenter();
    const spread = { x: (i % 4) * 28, y: Math.floor(i / 4) * 24 };
    const position =
      centre !== null
        ? { x: centre.x + spread.x, y: centre.y + spread.y }
        : { x: 80 + (i % 4) * 280, y: 80 + Math.floor(i / 4) * 140 };
    const node: MemoryNode = {
      id: makeId(),
      title: title !== undefined && title !== "" ? title : derived,
      // An adopted .claude/agents file IS an agent — the unified role.
      role: isAgentFile(relPath) ? "agent" : "reference",
      brief: "",
      filePath: relPath,
      readOrder: s.nodes.reduce((m, n) => Math.max(m, n.readOrder), 0) + 1,
      pinned: false,
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
      for (const id of ids) {
        delete nextStatus[id];
        delete nextErrors[id];
      }
      return {
        nodes: st.nodes.filter((n) => !gone.has(n.id)),
        edges: st.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        selectedNodeIds: st.selectedNodeIds.filter((i) => !gone.has(i)),
        assembleStatus: nextStatus,
        assembleErrors: nextErrors,
      };
    });
    scheduleSave();
  },

  beginConnection: (conn) => {
    if (conn.source === conn.target) return;
    set({ pending: conn });
  },

  confirmConnection: (kind, condition) => {
    pushHistory("edge-add");
    const { pending, edges } = get();
    if (pending === null) return;
    const duplicate = edges.some(
      (e) => e.source === pending.source && e.target === pending.target && e.kind === kind,
    );
    if (!duplicate) {
      const edge: MemoryEdge = {
        id: makeId(),
        source: pending.source,
        target: pending.target,
        kind,
        ...(kind === "conditional" && condition !== undefined && condition !== ""
          ? { condition }
          : {}),
      };
      set((st) => ({ edges: [...st.edges, edge], pending: null }));
      scheduleSave();
    } else {
      set({ pending: null });
    }
  },

  cancelConnection: () => set({ pending: null }),

  updateEdge: (id, patch) => {
    pushHistory(`edge:${id}`);
    set((st) => ({
      edges: st.edges.map((e) => (e.id === id ? { ...e, ...patch, id } : e)),
    }));
    scheduleSave();
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
