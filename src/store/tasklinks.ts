// Tasklinks store — task ↔ Memory Node linkage, goal ancestry and per-task
// token ceilings (WO06_CONTRACT.md §3.2). Mirrors `.cowtext/tasklinks.json`
// 1:1; every mutation re-adopts the WHOLE `TaskLinks` document the command
// returns (never a local patch) because the sidecar lives in a dot-directory
// the watcher ignores — the command's return value is the only way a
// mutation reaches this store (contract §8).
//
// Written only by Rust (contract §3.2 L1) — this store never constructs
// `.cowtext/tasklinks.json` bytes itself, it only calls the three commands
// and stores their replies.

import { create } from "zustand";
import { tasklinkDelete, tasklinkSet, tasklinksRead, type TaskLink, type TaskLinks } from "../tasklinks/api";
import { agentSessionList } from "../sessions/api";

export type { TaskLink, TaskLinks } from "../tasklinks/api";

// `linkFor` is used directly as a zustand selector (TaskLinksPanel,
// TaskContextModal). Zustand v5 has no result cache, so a selector that mints
// a fresh object on every call gives useSyncExternalStore a new snapshot each
// render — React then re-renders forever and throws "Maximum update depth
// exceeded". The empty shape is therefore interned per taskId so an unlinked
// task returns the SAME reference every time.
const emptyLinks = new Map<string, TaskLink>();

const EMPTY_LINK = (taskId: string): TaskLink => {
  const cached = emptyLinks.get(taskId);
  if (cached !== undefined) return cached;
  const fresh: TaskLink = { taskId, nodeIds: [], sessionIds: [] };
  emptyLinks.set(taskId, fresh);
  return fresh;
};

interface TaskLinksState {
  root: string | null;
  loading: boolean;
  error: string | null;
  version: number;
  links: TaskLink[];

  load(root: string): Promise<void>;
  /** The stored link for `taskId`, or an empty (unsaved) shape if none
   *  exists yet — callers never need to null-check before reading fields. */
  linkFor(taskId: string): TaskLink;
  /** Walks `parentTaskId` up to depth 8 (mirrors the server's cap, contract
   *  §3.2 L4) for DISPLAY only — the authoritative cycle/depth check happens
   *  in `tasklink_set`. Stops early (rather than looping) if a cycle is
   *  found client-side, so a stale/foreign file can never hang the UI. */
  ancestryChain(taskId: string): TaskLink[];

  setNodeIds(root: string, taskId: string, nodeIds: string[]): Promise<string | null>;
  attachNode(root: string, taskId: string, nodeId: string): Promise<string | null>;
  detachNode(root: string, taskId: string, nodeId: string): Promise<string | null>;
  setParent(root: string, taskId: string, parentTaskId: string | null): Promise<string | null>;
  setCeiling(root: string, taskId: string, ceiling: number | null): Promise<string | null>;
  /** Records a launched session against its task — best-effort provenance,
   *  never blocks the launch flow on failure. */
  recordSession(root: string, taskId: string, sessionId: string): Promise<void>;
  remove(root: string, taskId: string): Promise<string | null>;
}

function adopt(set: (partial: Partial<TaskLinksState>) => void, doc: TaskLinks): void {
  set({ version: doc.version, links: doc.links, error: null });
}

/** D6 fix — contract §3.2 L3, verbatim: "`sessionIds` holds `claudeSessionId`
 *  values … never Cowtext's in-memory `as<N>` ids, which are reassigned from
 *  zero on every app start." `agent_session_spawn` resolves before the
 *  child's first stdout line (the stream's `system/init` line, which is
 *  where the durable id is captured) has necessarily been read, so the
 *  durable id is usually not yet on the registry entry the instant
 *  `spawnForTask` returns. Poll `agent_session_list` a few times for it
 *  (init is always the first line, so this normally resolves in well under
 *  a second); if the session already disappeared from the list, or the CLI
 *  never emits an `init` line before exiting, resolve `null` — the caller's
 *  job is then to skip the write entirely, never fall back to the volatile
 *  `as<N>` id. */
async function waitForClaudeSessionId(
  cowtextSessionId: string,
  attempts = 10,
  delayMs = 300,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    let list: Awaited<ReturnType<typeof agentSessionList>>;
    try {
      list = await agentSessionList();
    } catch {
      return null;
    }
    const info = list.find((s) => s.id === cowtextSessionId);
    if (info === undefined) return null; // session already gone
    if (info.claudeSessionId !== null) return info.claudeSessionId;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export const useTaskLinksStore = create<TaskLinksState>((set, get) => ({
  root: null,
  loading: false,
  error: null,
  version: 1,
  links: [],

  load: async (root) => {
    set({ root, loading: true, error: null });
    try {
      const doc = await tasklinksRead(root);
      if (get().root !== root) return; // a different project opened meanwhile
      set({ loading: false });
      adopt(set, doc);
    } catch (e) {
      if (get().root !== root) return;
      set({ loading: false, error: String(e) });
    }
  },

  linkFor: (taskId) => get().links.find((l) => l.taskId === taskId) ?? EMPTY_LINK(taskId),

  ancestryChain: (taskId) => {
    const chain: TaskLink[] = [];
    const seen = new Set<string>();
    let current = get().links.find((l) => l.taskId === taskId)?.parentTaskId;
    while (current !== undefined && !seen.has(current) && chain.length < 8) {
      seen.add(current);
      const parent = get().links.find((l) => l.taskId === current);
      if (parent === undefined) break;
      chain.push(parent);
      current = parent.parentTaskId;
    }
    return chain;
  },

  setNodeIds: async (root, taskId, nodeIds) => {
    const existing = get().linkFor(taskId);
    try {
      const doc = await tasklinkSet(root, { ...existing, taskId, nodeIds });
      adopt(set, doc);
      return null;
    } catch (e) {
      return String(e);
    }
  },

  attachNode: async (root, taskId, nodeId) => {
    const existing = get().linkFor(taskId);
    if (existing.nodeIds.includes(nodeId)) return null;
    return get().setNodeIds(root, taskId, [...existing.nodeIds, nodeId]);
  },

  detachNode: async (root, taskId, nodeId) => {
    const existing = get().linkFor(taskId);
    return get().setNodeIds(
      root,
      taskId,
      existing.nodeIds.filter((id) => id !== nodeId),
    );
  },

  setParent: async (root, taskId, parentTaskId) => {
    const existing = get().linkFor(taskId);
    const next: TaskLink = { ...existing, taskId };
    if (parentTaskId === null) delete next.parentTaskId;
    else next.parentTaskId = parentTaskId;
    try {
      const doc = await tasklinkSet(root, next);
      adopt(set, doc);
      return null;
    } catch (e) {
      return String(e);
    }
  },

  setCeiling: async (root, taskId, ceiling) => {
    const existing = get().linkFor(taskId);
    const next: TaskLink = { ...existing, taskId };
    if (ceiling === null || ceiling <= 0) delete next.tokenCeiling;
    else next.tokenCeiling = ceiling;
    try {
      const doc = await tasklinkSet(root, next);
      adopt(set, doc);
      return null;
    } catch (e) {
      return String(e);
    }
  },

  recordSession: async (root, taskId, sessionId) => {
    // D6 fix — `sessionId` here is the Cowtext-side `as<N>` id (the only id
    // known synchronously at spawn); resolve it to the durable
    // `claudeSessionId` before it ever reaches the sidecar (contract §3.2
    // L3). Never persist `as<N>` — it is reassigned from zero on every app
    // start and would silently alias two unrelated tasks' sessions.
    const claudeSessionId = await waitForClaudeSessionId(sessionId);
    if (claudeSessionId === null) return; // never arrived — skip the write
    const existing = get().linkFor(taskId);
    if (existing.sessionIds.includes(claudeSessionId)) return;
    try {
      const doc = await tasklinkSet(root, {
        ...existing,
        taskId,
        sessionIds: [...existing.sessionIds, claudeSessionId],
      });
      adopt(set, doc);
    } catch {
      // Provenance only — a session that failed to record here is still
      // alive and usable; never surface this as a launch failure.
    }
  },

  remove: async (root, taskId) => {
    try {
      const doc = await tasklinkDelete(root, taskId);
      adopt(set, doc);
      return null;
    } catch (e) {
      return String(e);
    }
  },
}));
