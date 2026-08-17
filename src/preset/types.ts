// Preset wire types — mirrors the Rust structs in src-tauri/src/preset.rs
// exactly (PHASE56_CONTRACT §3 / §8.1). Do not change shapes without a
// contract revision. buildPreset() owns the serialization (Rust stores the
// bytes verbatim); parsePreset() is the tolerant reader for Apply/Import.

import {
  EDGE_KINDS,
  NODE_ROLES,
  useGraphStore,
  type CompileTarget,
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

// ── Preset file shape (contract §8.1, frozen) ─────────────────────────

export interface PresetNode {
  id: string;
  title: string;
  role: NodeRole;
  brief: string;
  filePath: string;
  readOrder: number;
  pinned: boolean;
  position: { x: number; y: number };
  scenePos?: { tx: number; ty: number };
}

export interface PresetEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  condition?: string;
  note?: string;
}

export interface CowtextPreset {
  version: 1;
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
    version: 1,
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
        pinned: n.pinned,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        ...(n.scenePos !== undefined
          ? { scenePos: { tx: n.scenePos.tx, ty: n.scenePos.ty } }
          : {}),
      })),
    edges: [...s.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        ...(e.condition !== undefined && e.condition !== "" ? { condition: e.condition } : {}),
        ...(e.note !== undefined && e.note !== "" ? { note: e.note } : {}),
      })),
    compileTargets: s.compileTargets,
  };
  return `${JSON.stringify(preset, null, 2)}\n`;
}

// ── Parse (tolerant — Rust already validated kind/version/nodes) ──────

function asRole(v: unknown): NodeRole {
  return NODE_ROLES.find((r) => r === v) ?? "reference";
}

function asKind(v: unknown): EdgeKind {
  return EDGE_KINDS.find((k) => k === v) ?? "references";
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
  if (p.kind !== "cowtext-preset" || p.version !== 1) {
    throw new Error("Not a version-1 Cowtext preset");
  }
  if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) {
    throw new Error("Preset is missing nodes/edges arrays");
  }
  const nodes: PresetNode[] = (p.nodes as unknown[]).map((rn, i) => {
    const n = (typeof rn === "object" && rn !== null ? rn : {}) as Record<string, unknown>;
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
    return {
      id: str(n.id, `preset-node-${i}`),
      title,
      role: asRole(n.role),
      brief: str(n.brief),
      filePath,
      readOrder: typeof n.readOrder === "number" ? n.readOrder : i + 1,
      pinned: n.pinned === true,
      position: {
        x: typeof pos.x === "number" ? pos.x : 0,
        y: typeof pos.y === "number" ? pos.y : 0,
      },
      ...(scene !== null && typeof scene.tx === "number" && typeof scene.ty === "number"
        ? { scenePos: { tx: scene.tx, ty: scene.ty } }
        : {}),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: PresetEdge[] = (p.edges as unknown[])
    .map((re, i) => {
      const e = (typeof re === "object" && re !== null ? re : {}) as Record<string, unknown>;
      return {
        id: str(e.id, `preset-edge-${i}`),
        source: str(e.source),
        target: str(e.target),
        kind: asKind(e.kind),
        ...(typeof e.condition === "string" && e.condition !== ""
          ? { condition: e.condition }
          : {}),
        ...(typeof e.note === "string" && e.note !== "" ? { note: e.note } : {}),
      };
    })
    // Dangling edges would fail compile validation later — drop them here.
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  const targets: CompileTarget[] = Array.isArray(p.compileTargets)
    ? (["claude", "agents", "cursor"] as const).filter((t) =>
        (p.compileTargets as unknown[]).includes(t),
      )
    : ["claude"];
  return {
    version: 1,
    kind: "cowtext-preset",
    name: str(p.name),
    savedAt: str(p.savedAt),
    nodes,
    edges,
    compileTargets: targets.length > 0 ? targets : ["claude"],
  };
}
