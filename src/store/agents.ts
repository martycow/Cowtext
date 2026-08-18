// Agents & Sub-Agents store — AGENTS_SUITE_CONTRACT.md §7.2 (frozen interface,
// lanes C and D code against this). graph.ts is the template. No React
// imports. Owns all ten src/agents/api.ts calls; nobody else invokes them.
//
// Two persistence layers:
//  - Documents (.claude/agents/*.md, .claude/skills/*/SKILL.md) — explicit
//    Save only (these are user-project files, the MarkdownTab rule).
//  - Sidecar (.cowtext/agents.json v1) — updateMeta autosaves, debounced
//    700 ms, per §5.

import { create } from "zustand";
import {
  agentConvert,
  agentCreate,
  agentDelete,
  agentRename,
  agentSave,
  agentsMetaWrite,
  agentsScan,
  skillCreate,
  skillDelete,
  skillRename,
  skillSave,
} from "../agents/api";
import type { AgentDoc, AgentsScan, FmFields, SkillDoc } from "../agents/types";

// ── Types (contract §7.2) ───────────────────────────────────────────────

export type EntityKind = "agent" | "skill";

export interface Selection {
  kind: EntityKind;
  key: string; // fileName | dirName
}

export interface AgentMeta {
  nickname: string;
  priority: number;
  influence: number;
  avatarSeed: string;
}

export const DEFAULT_META: AgentMeta = { nickname: "", priority: 3, influence: 50, avatarSeed: "" };

/** Reserved default agent (TASKBOARD_BATCH §4): always shown first in the
 *  rail (virtual until materialized via createAgent("Producer")); Rust
 *  rejects rename/delete/convert on this file. Tasks with agent === null
 *  belong to Producer. */
export const PRODUCER_FILE = "producer.md";
export const PRODUCER_DUTIES = "Coordinates the project; owns unassigned tasks.";

/** Draft = the editable mirror of one doc. `rawContent` is used iff `raw`. */
export interface DocDraft {
  fields: FmFields;
  body: string;
  rawContent: string;
  raw: boolean;
}

export interface AgentsState {
  root: string | null;
  loading: boolean;
  loadError: string | null;

  agents: AgentDoc[]; // last saved state, sorted by fileName
  skills: SkillDoc[]; // sorted by dirName
  skipped: string[];

  meta: Record<string, AgentMeta>; // key = agent fileName
  metaError: string | null; // non-null => meta writes blocked
  orphanKeys: string[];

  selection: Selection | null;
  drafts: Record<string, DocDraft>; // keyed by draftKey(selection)
  busy: boolean; // a command is in flight
  opError: string | null; // last operation error, cleared on next op

  loadAgents(root: string): Promise<void>;
  select(sel: Selection | null): void;
  updateDraft(sel: Selection, patch: Partial<DocDraft>): void;
  revertDraft(sel: Selection): void;
  saveDoc(sel: Selection): Promise<string | null>; // null = success, else message
  createAgent(name: string): Promise<string | null>;
  createSkill(name: string): Promise<string | null>;
  renameSelected(newName: string): Promise<string | null>;
  /** Selection-independent agent rename (graph-store rename routing).
   *  Resolves to the new fileName; throws the Rust error string. */
  renameAgentByFile(fileName: string, newName: string): Promise<string>;
  /** Convert a legacy context .md into a real agent file (moves it into
   *  .claude/agents/). Resolves to the new AgentDoc; throws on failure. */
  convertToAgent(relPath: string, newName: string): Promise<AgentDoc>;
  deleteSelected(): Promise<string | null>;
  attachSkill(fileName: string, skillName: string): void; // draft-only
  detachSkill(fileName: string, skillName: string): void; // draft-only
  updateMeta(fileName: string, patch: Partial<AgentMeta>): void; // 700 ms debounce
  cleanupOrphans(): Promise<string | null>;
}

// Rename fan-out: the GRAPH store keeps agent-backed nodes' filePath/title in
// sync by registering here (graph → agents import is one-directional; this
// callback list avoids the reverse import). Called after every successful
// agent rename with (oldFileName, newFileName, newName).
export type AgentRenameListener = (oldFileName: string, newFileName: string, newName: string) => void;
export const agentRenameListeners: AgentRenameListener[] = [];

function notifyAgentRenamed(oldFileName: string, newFileName: string, newName: string): void {
  for (const l of agentRenameListeners) l(oldFileName, newFileName, newName);
}

// ── Small pure helpers used both internally and exported (§7.2 / B6) ────

export function draftKey(sel: Selection): string {
  return `${sel.kind}:${sel.key}`;
}

function findDoc(st: Pick<AgentsState, "agents" | "skills">, sel: Selection): AgentDoc | SkillDoc | null {
  if (sel.kind === "agent") return st.agents.find((a) => a.fileName === sel.key) ?? null;
  return st.skills.find((s) => s.dirName === sel.key) ?? null;
}

function draftFromDoc(doc: AgentDoc | SkillDoc | null): DocDraft | null {
  if (doc === null) return null;
  return { fields: doc.fields, body: doc.body, rawContent: doc.content, raw: doc.raw };
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameFields(a: FmFields, b: FmFields): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.model === b.model &&
    sameStringArray(a.tools, b.tools) &&
    sameStringArray(a.skills, b.skills)
  );
}

export function isDirty(s: AgentsState, sel: Selection): boolean {
  const draft = s.drafts[draftKey(sel)];
  if (draft === undefined) return false;
  const doc = findDoc(s, sel);
  if (doc === null) return false;
  if (draft.raw) return draft.rawContent !== doc.content;
  return draft.body !== doc.body || !sameFields(draft.fields, doc.fields);
}

export function metaOrDefault(meta: Record<string, AgentMeta>, fileName: string): AgentMeta {
  return meta[fileName] ?? DEFAULT_META;
}

/** Effective identity seed: the stored avatarSeed, or the fileName stem when
 *  unset — "the only user-facing identity lever" (contract §5). */
export function seedFor(meta: Record<string, AgentMeta>, fileName: string): string {
  const m = meta[fileName];
  if (m !== undefined && m.avatarSeed !== "") return m.avatarSeed;
  return fileName.replace(/\.md$/i, "");
}

export function usedBy(agents: AgentDoc[], skillName: string): string[] {
  return agents.filter((a) => a.fields.skills.includes(skillName)).map((a) => a.fileName);
}

function byFileName(a: AgentDoc, b: AgentDoc): number {
  return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
}

function byDirName(a: SkillDoc, b: SkillDoc): number {
  return a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0;
}

// ── Sidecar parsing / serialization (§5) ────────────────────────────────

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : def;
  return Math.min(max, Math.max(min, n));
}

function clampNickname(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.slice(0, 40);
}

function defaultMetaFor(fileName: string): AgentMeta {
  return { nickname: "", priority: 3, influence: 50, avatarSeed: fileName.replace(/\.md$/i, "") };
}

function parseAgentMeta(raw: unknown, fileName: string): AgentMeta {
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const avatarSeedRaw = obj.avatarSeed;
  return {
    nickname: clampNickname(obj.nickname),
    priority: clampInt(obj.priority, 3, 1, 5),
    influence: clampInt(obj.influence, 50, 0, 100),
    avatarSeed: typeof avatarSeedRaw === "string" ? avatarSeedRaw : fileName.replace(/\.md$/i, ""),
  };
}

interface ParsedMeta {
  meta: Record<string, AgentMeta>;
  metaError: string | null;
  orphanKeys: string[];
  orphan: Record<string, unknown>;
}

function parseMetaJson(raw: string | null, agents: AgentDoc[]): ParsedMeta {
  if (raw === null) return { meta: {}, metaError: null, orphanKeys: [], orphan: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { meta: {}, metaError: "Could not parse .cowtext/agents.json", orphanKeys: [], orphan: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { meta: {}, metaError: "agents.json is not an object", orphanKeys: [], orphan: {} };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version !== 1) {
    return {
      meta: {},
      metaError: `Unsupported agents.json version: ${JSON.stringify(obj.version)}`,
      orphanKeys: [],
      orphan: {},
    };
  }
  const agentsRaw =
    typeof obj.agents === "object" && obj.agents !== null && !Array.isArray(obj.agents)
      ? (obj.agents as Record<string, unknown>)
      : {};
  const known = new Set(agents.map((a) => a.fileName));
  const meta: Record<string, AgentMeta> = {};
  const orphan: Record<string, unknown> = {};
  const orphanKeys: string[] = [];
  for (const [key, value] of Object.entries(agentsRaw)) {
    if (known.has(key)) {
      meta[key] = parseAgentMeta(value, key);
    } else {
      orphan[key] = value;
      orphanKeys.push(key);
    }
  }
  orphanKeys.sort();
  return { meta, metaError: null, orphanKeys, orphan };
}

function serializeMeta(meta: Record<string, AgentMeta>, orphan: Record<string, unknown>): string {
  const agentsOut: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(meta), ...Object.keys(orphan)])].sort();
  for (const k of keys) {
    // Live meta always wins over stale orphan data for a shared key: a key
    // only stays orphaned while no agent file claims it. If both are
    // present (e.g. reconciliation hasn't run yet), the freshly-entered
    // live entry must never be shadowed by a stale sidecar payload.
    if (k in meta) {
      const m = meta[k];
      agentsOut[k] = { nickname: m.nickname, priority: m.priority, influence: m.influence, avatarSeed: m.avatarSeed };
    } else {
      agentsOut[k] = orphan[k];
    }
  }
  const stable = { version: 1, agents: agentsOut };
  return `${JSON.stringify(stable, null, 2)}\n`;
}

// Raw orphan entries, retained verbatim for re-emission. Not part of public
// state (the contract exposes only `orphanKeys: string[]`); module-level like
// graph.ts's `saveTimer`, scoped to this store's lifetime.
let orphanRaw: Record<string, unknown> = {};
let metaSaveTimer: ReturnType<typeof setTimeout> | undefined;

/** Removes `key` from the module-level orphan bookkeeping if present, and
 *  returns the reconciled AgentMeta parsed from the stale orphan payload
 *  (so a recreated/renamed-into agent inherits its old metadata) — or
 *  `undefined` if `key` was not orphaned. Callers still own updating
 *  `orphanKeys` in state and, when this returns non-undefined, `meta`. */
function reconcileOrphan(key: string): AgentMeta | undefined {
  if (!(key in orphanRaw)) return undefined;
  const reconciled = parseAgentMeta(orphanRaw[key], key);
  delete orphanRaw[key];
  return reconciled;
}

async function flushMetaSaveInternal(): Promise<void> {
  const s = useAgentsStore.getState();
  if (s.root === null || s.metaError !== null) return;
  const content = serializeMeta(s.meta, orphanRaw);
  try {
    await agentsMetaWrite(s.root, content);
  } catch {
    // Best-effort autosave; the next edit reschedules a retry.
  }
}

function scheduleMetaSave(): void {
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => {
    void flushMetaSaveInternal();
  }, 700);
}

/** Forces an immediate sidecar write, bypassing the debounce. Wired into
 *  App.tsx's beforeunload flush (lane C). */
export function flushMetaSave(): void {
  clearTimeout(metaSaveTimer);
  void flushMetaSaveInternal();
}

// ── Store ─────────────────────────────────────────────────────────────

export const useAgentsStore = create<AgentsState>((set, get) => ({
  root: null,
  loading: false,
  loadError: null,

  agents: [],
  skills: [],
  skipped: [],

  meta: {},
  metaError: null,
  orphanKeys: [],

  selection: null,
  drafts: {},
  busy: false,
  opError: null,

  loadAgents: async (root) => {
    clearTimeout(metaSaveTimer);
    orphanRaw = {};
    set({
      root,
      loading: true,
      loadError: null,
      agents: [],
      skills: [],
      skipped: [],
      meta: {},
      metaError: null,
      orphanKeys: [],
      selection: null,
      drafts: {},
      busy: false,
      opError: null,
    });
    try {
      const scan: AgentsScan = await agentsScan(root);
      const parsed = parseMetaJson(scan.metaJson, scan.agents);
      orphanRaw = parsed.orphan;
      set({
        agents: scan.agents,
        skills: scan.skills,
        skipped: scan.skipped,
        meta: parsed.meta,
        metaError: parsed.metaError,
        orphanKeys: parsed.orphanKeys,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, loadError: String(e) });
    }
  },

  select: (sel) => set({ selection: sel, opError: null }),

  updateDraft: (sel, patch) => {
    const key = draftKey(sel);
    set((st) => {
      const existing = st.drafts[key] ?? draftFromDoc(findDoc(st, sel));
      if (existing === null) return {};
      return { drafts: { ...st.drafts, [key]: { ...existing, ...patch } } };
    });
  },

  revertDraft: (sel) => {
    const key = draftKey(sel);
    set((st) => {
      if (st.drafts[key] === undefined) return {};
      const drafts = { ...st.drafts };
      delete drafts[key];
      return { drafts };
    });
  },

  saveDoc: async (sel) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    const key = draftKey(sel);
    const draft = s.drafts[key];
    if (draft === undefined) return null;
    set({ busy: true, opError: null });
    try {
      const patch = draft.raw ? { rawContent: draft.rawContent } : { fields: draft.fields, body: draft.body };
      if (sel.kind === "agent") {
        await agentSave(s.root, sel.key, patch);
      } else {
        await skillSave(s.root, sel.key, patch);
      }
      // Simplest correct choice (§7.2): refresh from a full agentsScan.
      const scan = await agentsScan(s.root);
      set((st) => {
        const drafts = { ...st.drafts };
        delete drafts[key];
        return { agents: scan.agents, skills: scan.skills, skipped: scan.skipped, drafts };
      });
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  createAgent: async (name) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    set({ busy: true, opError: null });
    try {
      const doc = await agentCreate(s.root, name);
      // The reclaimed fileName may still be sitting in the orphan bucket
      // (external delete + in-app recreate under the same name): drop it
      // from orphan bookkeeping and, if it carried metadata, promote it
      // into `meta` so serializeMeta never has the two disagree.
      const reconciled = reconcileOrphan(doc.fileName);
      set((st) => ({
        agents: [...st.agents, doc].sort(byFileName),
        selection: { kind: "agent", key: doc.fileName },
        orphanKeys: st.orphanKeys.includes(doc.fileName)
          ? st.orphanKeys.filter((k) => k !== doc.fileName)
          : st.orphanKeys,
        meta: reconciled !== undefined ? { ...st.meta, [doc.fileName]: reconciled } : st.meta,
      }));
      if (reconciled !== undefined) scheduleMetaSave();
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  createSkill: async (name) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    set({ busy: true, opError: null });
    try {
      const doc = await skillCreate(s.root, name);
      set((st) => ({
        skills: [...st.skills, doc].sort(byDirName),
        selection: { kind: "skill", key: doc.dirName },
      }));
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  renameSelected: async (newName) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    if (s.selection === null) return "Nothing selected";
    const sel = s.selection;
    set({ busy: true, opError: null });
    try {
      if (sel.kind === "agent") {
        const nextName = await agentRename(s.root, sel.key, newName);
        // As in createAgent: the destination name may already be sitting
        // in the orphan bucket. Reconcile it so serializeMeta never has to
        // choose between live and orphan data for the same key.
        const reconciled = reconcileOrphan(nextName);
        set((st) => {
          const drafts = { ...st.drafts };
          const oldKey = draftKey(sel);
          const newSel: Selection = { kind: "agent", key: nextName };
          if (drafts[oldKey] !== undefined) {
            drafts[draftKey(newSel)] = drafts[oldKey];
            delete drafts[oldKey];
          }
          const meta = { ...st.meta };
          if (meta[sel.key] !== undefined) {
            meta[nextName] = meta[sel.key];
            delete meta[sel.key];
          } else if (reconciled !== undefined) {
            meta[nextName] = reconciled;
          }
          const agents = st.agents
            .map((a) => (a.fileName === sel.key ? { ...a, fileName: nextName } : a))
            .sort(byFileName);
          const orphanKeys = st.orphanKeys.includes(nextName)
            ? st.orphanKeys.filter((k) => k !== nextName)
            : st.orphanKeys;
          return { agents, drafts, meta, selection: newSel, orphanKeys };
        });
        scheduleMetaSave();
        notifyAgentRenamed(sel.key, nextName, newName);
      } else {
        const nextName = await skillRename(s.root, sel.key, newName);
        set((st) => {
          const drafts = { ...st.drafts };
          const oldKey = draftKey(sel);
          const newSel: Selection = { kind: "skill", key: nextName };
          if (drafts[oldKey] !== undefined) {
            drafts[draftKey(newSel)] = drafts[oldKey];
            delete drafts[oldKey];
          }
          const skills = st.skills
            .map((sk) => (sk.dirName === sel.key ? { ...sk, dirName: nextName } : sk))
            .sort(byDirName);
          return { skills, drafts, selection: newSel };
        });
      }
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  renameAgentByFile: async (fileName, newName) => {
    // Selection-independent rename used by the GRAPH store when a title-sync
    // or File-field rename targets an agent-backed node. Same bookkeeping as
    // renameSelected's agent branch; selection is only rewritten when it was
    // pointing at the renamed agent. Resolves to the new fileName; throws
    // with the Rust error string on failure.
    const s = get();
    if (s.busy) throw new Error("Busy");
    if (s.root === null) throw new Error("No project open");
    set({ busy: true, opError: null });
    try {
      const sel: Selection = { kind: "agent", key: fileName };
      const nextName = await agentRename(s.root, fileName, newName);
      const reconciled = reconcileOrphan(nextName);
      set((st) => {
        const drafts = { ...st.drafts };
        const oldKey = draftKey(sel);
        const newSel: Selection = { kind: "agent", key: nextName };
        if (drafts[oldKey] !== undefined) {
          drafts[draftKey(newSel)] = drafts[oldKey];
          delete drafts[oldKey];
        }
        const meta = { ...st.meta };
        if (meta[fileName] !== undefined) {
          meta[nextName] = meta[fileName];
          delete meta[fileName];
        } else if (reconciled !== undefined) {
          meta[nextName] = reconciled;
        }
        const agents = st.agents
          .map((a) => (a.fileName === fileName ? { ...a, fileName: nextName } : a))
          .sort(byFileName);
        const orphanKeys = st.orphanKeys.includes(nextName)
          ? st.orphanKeys.filter((k) => k !== nextName)
          : st.orphanKeys;
        const selection =
          st.selection !== null && st.selection.kind === "agent" && st.selection.key === fileName
            ? newSel
            : st.selection;
        return { agents, drafts, meta, selection, orphanKeys };
      });
      scheduleMetaSave();
      notifyAgentRenamed(fileName, nextName, newName);
      return nextName;
    } catch (e) {
      // Rethrow the original (a plain Rust error string over IPC) so callers
      // see the exact message; opError mirrors it for the panel.
      set({ opError: String(e) });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  convertToAgent: async (relPath, newName) => {
    const s = get();
    if (s.busy) throw new Error("Busy");
    if (s.root === null) throw new Error("No project open");
    set({ busy: true, opError: null });
    try {
      const doc = await agentConvert(s.root, relPath, newName);
      const reconciled = reconcileOrphan(doc.fileName);
      set((st) => {
        const agents = [...st.agents.filter((a) => a.fileName !== doc.fileName), doc].sort(byFileName);
        const meta = reconciled !== undefined ? { ...st.meta, [doc.fileName]: reconciled } : st.meta;
        const orphanKeys = st.orphanKeys.filter((k) => k !== doc.fileName);
        return { agents, meta, orphanKeys };
      });
      if (reconciled !== undefined) scheduleMetaSave();
      return doc;
    } catch (e) {
      // Rethrow the original (a plain Rust error string over IPC) so callers
      // see the exact message; opError mirrors it for the panel.
      set({ opError: String(e) });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  deleteSelected: async () => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    if (s.selection === null) return "Nothing selected";
    const sel = s.selection;
    set({ busy: true, opError: null });
    try {
      if (sel.kind === "agent") {
        await agentDelete(s.root, sel.key);
        set((st) => {
          const idx = st.agents.findIndex((a) => a.fileName === sel.key);
          const agents = st.agents.filter((a) => a.fileName !== sel.key);
          const drafts = { ...st.drafts };
          delete drafts[draftKey(sel)];
          const meta = { ...st.meta };
          delete meta[sel.key];
          const neighbor = agents[idx] ?? agents[idx - 1];
          const selection: Selection | null = neighbor ? { kind: "agent", key: neighbor.fileName } : null;
          return { agents, drafts, meta, selection };
        });
        scheduleMetaSave();
      } else {
        await skillDelete(s.root, sel.key);
        set((st) => {
          const idx = st.skills.findIndex((sk) => sk.dirName === sel.key);
          const skills = st.skills.filter((sk) => sk.dirName !== sel.key);
          const drafts = { ...st.drafts };
          delete drafts[draftKey(sel)];
          const neighbor = skills[idx] ?? skills[idx - 1];
          const selection: Selection | null = neighbor ? { kind: "skill", key: neighbor.dirName } : null;
          return { skills, drafts, selection };
        });
      }
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  attachSkill: (fileName, skillName) => {
    const sel: Selection = { kind: "agent", key: fileName };
    const key = draftKey(sel);
    set((st) => {
      const existing = st.drafts[key] ?? draftFromDoc(findDoc(st, sel));
      if (existing === null) return {};
      if (existing.fields.skills.includes(skillName)) return { drafts: { ...st.drafts, [key]: existing } };
      const skills = [...existing.fields.skills, skillName];
      return { drafts: { ...st.drafts, [key]: { ...existing, fields: { ...existing.fields, skills } } } };
    });
  },

  detachSkill: (fileName, skillName) => {
    const sel: Selection = { kind: "agent", key: fileName };
    const key = draftKey(sel);
    set((st) => {
      const existing = st.drafts[key] ?? draftFromDoc(findDoc(st, sel));
      if (existing === null) return {};
      const skills = existing.fields.skills.filter((s) => s !== skillName);
      return { drafts: { ...st.drafts, [key]: { ...existing, fields: { ...existing.fields, skills } } } };
    });
  },

  updateMeta: (fileName, patch) => {
    if (get().metaError !== null) return;
    set((st) => {
      const base = st.meta[fileName] ?? defaultMetaFor(fileName);
      const merged: AgentMeta = {
        nickname: patch.nickname !== undefined ? clampNickname(patch.nickname) : base.nickname,
        priority: patch.priority !== undefined ? clampInt(patch.priority, 3, 1, 5) : base.priority,
        influence: patch.influence !== undefined ? clampInt(patch.influence, 50, 0, 100) : base.influence,
        avatarSeed: patch.avatarSeed !== undefined ? patch.avatarSeed : base.avatarSeed,
      };
      return { meta: { ...st.meta, [fileName]: merged } };
    });
    scheduleMetaSave();
  },

  cleanupOrphans: async () => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    if (s.orphanKeys.length === 0) return null;
    set({ busy: true, opError: null });
    try {
      orphanRaw = {};
      clearTimeout(metaSaveTimer);
      const content = serializeMeta(get().meta, orphanRaw);
      await agentsMetaWrite(s.root, content);
      set({ orphanKeys: [] });
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },
}));
