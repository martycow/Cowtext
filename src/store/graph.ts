// Graph store — the single source of truth both views read (CLAUDE.md rule).
// Domain model per plan §4; React Flow maps FROM this state, never owns it.
// Persistence: debounced atomic save to <project>/.cowtext/graph.json via Rust.

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "./project";

// ── Data model (plan §4) ──────────────────────────────────────────────

export type NodeRole =
  | "persona"
  | "rules"
  | "architecture"
  | "workflow"
  | "task"
  | "reference"
  | "glossary";

export const NODE_ROLES: readonly NodeRole[] = [
  "persona",
  "rules",
  "architecture",
  "workflow",
  "task",
  "reference",
  "glossary",
];

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
}

export type EdgeKind = "imports" | "references" | "conditional" | "sequence";

export const EDGE_KINDS: readonly EdgeKind[] = [
  "imports",
  "references",
  "conditional",
  "sequence",
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
}

export type CompileTarget = "claude" | "agents" | "cursor";

export interface BarnGraph {
  version: 1;
  projectName: string;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  compileTargets: CompileTarget[];
}

// ── Serialization — stable field order + LF so git diffs stay small ───

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
  };
}

export function serializeGraph(g: BarnGraph): string {
  const stable: BarnGraph = {
    version: 1,
    projectName: g.projectName,
    nodes: [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(stableNode),
    edges: [...g.edges].sort((a, b) => a.id.localeCompare(b.id)).map(stableEdge),
    compileTargets: g.compileTargets,
  };
  // JSON.stringify emits LF; trailing newline keeps POSIX tools quiet.
  return `${JSON.stringify(stable, null, 2)}\n`;
}

/** Migration harness (backlog 9.2): version 1 is current; anything else
 *  must come through here with an explicit migration step. */
export function migrateGraph(data: unknown): BarnGraph {
  if (typeof data !== "object" || data === null) {
    throw new Error("graph.json is not an object");
  }
  const g = data as Partial<BarnGraph>;
  if (g.version !== 1) {
    throw new Error(`Unsupported graph.json version: ${String(g.version)}`);
  }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error("graph.json is missing nodes/edges arrays");
  }
  return {
    version: 1,
    projectName: typeof g.projectName === "string" ? g.projectName : "",
    nodes: g.nodes,
    edges: g.edges,
    compileTargets: Array.isArray(g.compileTargets) ? g.compileTargets : ["claude"],
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

export interface PendingConnection {
  source: string;
  target: string;
}

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

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

  loadGraph: (root: string) => Promise<void>;
  flushSave: () => Promise<void>;

  createNode: (position: { x: number; y: number }) => Promise<void>;
  adoptFile: (relPath: string) => void;
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

  /** Compile-target picker (Compile modal); persisted like any graph edit. */
  setCompileTargets: (targets: CompileTarget[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

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

  loadGraph: async (root) => {
    clearTimeout(saveTimer);
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
      version: 1,
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
    const node: MemoryNode = {
      id: makeId(),
      title,
      role: "reference",
      brief: "",
      filePath,
      readOrder: s.nodes.reduce((m, n) => Math.max(m, n.readOrder), 0) + 1,
      pinned: false,
      position,
    };
    try {
      // Stub the file so the node is real on disk from the first second.
      await invoke("write_md_file", {
        root: s.root,
        relPath: filePath,
        content: `# ${title}\n\n`,
      });
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
  },

  adoptFile: (relPath) => {
    const s = get();
    if (s.nodes.some((n) => n.filePath === relPath)) return;
    const fileName = relPath.split("/").pop() ?? relPath;
    const title = fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
    const i = s.nodes.length;
    const node: MemoryNode = {
      id: makeId(),
      title,
      role: "reference",
      brief: "",
      filePath: relPath,
      readOrder: s.nodes.reduce((m, n) => Math.max(m, n.readOrder), 0) + 1,
      pinned: false,
      // Cascade fresh nodes so adopt-many doesn't stack them.
      position: { x: 80 + (i % 4) * 280, y: 80 + Math.floor(i / 4) * 140 },
    };
    set((st) => ({
      nodes: [...st.nodes, node],
      selectedNodeIds: [node.id],
      selectedEdgeIds: [],
    }));
    scheduleSave();
  },

  updateNode: (id, patch) => {
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, ...patch, id } : n)),
    }));
    scheduleSave();
  },

  moveNode: (id, position) => {
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }));
    scheduleSave();
  },

  deleteNodes: (ids) => {
    const gone = new Set(ids);
    set((st) => ({
      nodes: st.nodes.filter((n) => !gone.has(n.id)),
      edges: st.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
      selectedNodeIds: st.selectedNodeIds.filter((i) => !gone.has(i)),
    }));
    scheduleSave();
  },

  beginConnection: (conn) => {
    if (conn.source === conn.target) return;
    set({ pending: conn });
  },

  confirmConnection: (kind, condition) => {
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
    set((st) => ({
      edges: st.edges.map((e) => (e.id === id ? { ...e, ...patch, id } : e)),
    }));
    scheduleSave();
  },

  deleteEdges: (ids) => {
    const gone = new Set(ids);
    set((st) => ({
      edges: st.edges.filter((e) => !gone.has(e.id)),
      selectedEdgeIds: st.selectedEdgeIds.filter((i) => !gone.has(i)),
    }));
    scheduleSave();
  },

  setSelection: (nodeIds, edgeIds) => {
    const s = get();
    const same = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    if (same(s.selectedNodeIds, nodeIds) && same(s.selectedEdgeIds, edgeIds)) return;
    set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
  },

  setCompileTargets: (targets) => {
    set({ compileTargets: targets });
    scheduleSave();
  },
}));
