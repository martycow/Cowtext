// Disk-change review queue (WO01 Block C §T4). The watcher tags every
// `fs://change` for a path Cowtext itself just wrote as `selfWrite: true`
// (see watcher.rs note_self_write/take_self_write); everything else that
// touches a MANAGED file — a path some graph node points at — lands here so
// the user can Accept (adopt the external edit) or Revert (write the last
// known-good snapshot back to disk) before it silently becomes "the" content.
//
// Snapshots are the review baseline, NOT the same thing as the node's live
// file content: they only move on initSnapshots (graph load / adopt),
// noteSelfSave (an explicit in-app save) and acceptCurrent (the user signed
// off on the external edit). `queue` holds every entry still pending;
// `reviewing` is a pointer at one of them (or null) — reviewNext/skipCurrent
// only move the pointer, Accept/Revert/dismissAll are what actually shrink
// `queue`. That split is what lets ReviewModal's Close button just drop the
// pointer without losing the entry.

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "./graph";
import type { FsChange } from "./project";

export type ReviewKind = "modify" | "create" | "remove";

export interface ReviewEntry {
  relPath: string;
  kind: ReviewKind;
  ts: number;
}

interface ReviewState {
  /** Review baseline per managed path — "what the file looked like before
   *  the pending external change" (or before any change, once accepted). */
  snapshots: Map<string, string>;
  /** Pending review entries, oldest first. */
  queue: ReviewEntry[];
  /** Which queue entry the modal is currently showing, or null. Still
   *  present in `queue` until Accept/Revert/dismissAll removes it. */
  reviewing: ReviewEntry | null;
  /** N4 status-bar "K changed on disk": a session counter of every external
   *  (non-selfWrite) `fs://change` on a managed file — every EVENT, not the
   *  distinct-file count, and never decremented by Accept/Revert/dismiss
   *  (that's `queue.length`, "J to review"). Only a project switch resets
   *  it — tracked via `currentRoot` below, set from `initSnapshots`, the one
   *  call every project open makes exactly once (adoptFile's later calls
   *  reuse the same root and don't reset). */
  externalChangeCount: number;
  /** Root the counters/snapshots above belong to; internal bookkeeping for
   *  the project-switch reset, not meant to be read by callers. */
  currentRoot: string | null;

  /** Seeds snapshots for `relPaths` from disk (parallel, missing tolerated —
   *  a file that can't be read just never gets a snapshot). */
  initSnapshots: (root: string, relPaths: string[]) => Promise<void>;
  /** Inspector's own Save path: the content just written IS now the
   *  baseline, no disk round-trip needed. */
  noteSelfSave: (relPath: string, content: string) => void;
  /** Single entry point for `fs://change` (contract: managed && !selfWrite
   *  → dedup-enqueue; everything else is a no-op here). */
  onFsChange: (change: FsChange) => void;
  /** Advance the review pointer to the front of the queue. No-op if the
   *  queue is empty. */
  reviewNext: () => void;
  /** Move the currently-reviewed entry to the back of the queue and advance
   *  the pointer to the new front — "come back to this one later". */
  skipCurrent: () => void;
  /** Drops the review pointer only — the entry stays in `queue` so
   *  "Review next" picks it right back up. The modal's Close button. */
  closeReview: () => void;
  /** Disk content becomes the new snapshot; the entry leaves the queue. */
  acceptCurrent: (root: string) => Promise<void>;
  /** Writes the last snapshot back to disk (self-write-suppressed — this
   *  does not re-enqueue itself) and dequeues. */
  revertCurrent: (root: string) => Promise<void>;
  /** Drops the whole queue and the review pointer without touching disk. */
  dismissAll: () => void;
}

/** Is `relPath` some node's file? Read live at call time — never cached —
 *  so a node adopted/removed between events is always current. */
function isManaged(relPath: string): boolean {
  return useGraphStore.getState().nodes.some((n) => n.filePath === relPath);
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  snapshots: new Map(),
  queue: [],
  reviewing: null,
  externalChangeCount: 0,
  currentRoot: null,

  initSnapshots: async (root, relPaths) => {
    // A different root than last time this store saw = a project switch —
    // the whole review session (baselines, queue, the K counter) belongs to
    // the previous project and must not bleed into the new one.
    if (get().currentRoot !== root) {
      set({
        currentRoot: root,
        snapshots: new Map(),
        queue: [],
        reviewing: null,
        externalChangeCount: 0,
      });
    }
    const reads = await Promise.all(
      relPaths.map(async (relPath) => {
        try {
          const content = await invoke<string>("read_md_file", { root, relPath });
          return { relPath, content };
        } catch {
          return null; // missing file tolerated — no snapshot yet
        }
      }),
    );
    set((st) => {
      const snapshots = new Map(st.snapshots);
      for (const r of reads) {
        if (r !== null) snapshots.set(r.relPath, r.content);
      }
      return { snapshots };
    });
  },

  noteSelfSave: (relPath, content) => {
    set((st) => {
      const snapshots = new Map(st.snapshots);
      snapshots.set(relPath, content);
      return { snapshots };
    });
  },

  onFsChange: (change) => {
    if (change.selfWrite) return;
    if (!isManaged(change.relPath)) return;
    set((st) => ({ externalChangeCount: st.externalChangeCount + 1 }));
    const entry: ReviewEntry = { relPath: change.relPath, kind: change.kind, ts: Date.now() };
    set((st) => {
      if (st.reviewing !== null && st.reviewing.relPath === change.relPath) {
        return { reviewing: entry, queue: st.queue.map((e) => (e.relPath === change.relPath ? entry : e)) };
      }
      const idx = st.queue.findIndex((e) => e.relPath === change.relPath);
      if (idx !== -1) {
        const next = st.queue.slice();
        next[idx] = entry;
        return { queue: next };
      }
      return { queue: [...st.queue, entry] };
    });
  },

  reviewNext: () => {
    set((st) => (st.queue.length > 0 ? { reviewing: st.queue[0] } : st));
  },

  skipCurrent: () => {
    set((st) => {
      if (st.reviewing === null) return st;
      // `reviewing` is a pointer INTO `queue` (same reference), so find its
      // actual slot rather than assuming it's still at index 0 — dedup
      // updates in onFsChange can replace queue entries out from under it.
      const idx = st.queue.findIndex((e) => e === st.reviewing);
      if (idx === -1) return st; // pointer stale/dangling — nothing to rotate
      const without = [...st.queue.slice(0, idx), ...st.queue.slice(idx + 1)];
      const rotated = [...without, st.queue[idx]];
      return { queue: rotated, reviewing: rotated[0] };
    });
  },

  acceptCurrent: async (root) => {
    const entry = get().reviewing;
    if (entry === null) return;
    if (entry.kind === "remove") {
      set((st) => {
        const snapshots = new Map(st.snapshots);
        snapshots.delete(entry.relPath);
        return {
          snapshots,
          queue: st.queue.filter((e) => e.relPath !== entry.relPath),
          reviewing: null,
        };
      });
      return;
    }
    try {
      const content = await invoke<string>("read_md_file", { root, relPath: entry.relPath });
      set((st) => {
        const snapshots = new Map(st.snapshots);
        snapshots.set(entry.relPath, content);
        return {
          snapshots,
          queue: st.queue.filter((e) => e.relPath !== entry.relPath),
          reviewing: null,
        };
      });
    } catch {
      // File vanished between the event and Accept — nothing to snapshot,
      // still leave the review queue in a consistent (dequeued) state.
      set((st) => ({
        queue: st.queue.filter((e) => e.relPath !== entry.relPath),
        reviewing: null,
      }));
    }
  },

  revertCurrent: async (root) => {
    const entry = get().reviewing;
    if (entry === null) return;
    const snapshot = get().snapshots.get(entry.relPath);
    if (snapshot !== undefined) {
      try {
        await invoke("write_md_file", { root, relPath: entry.relPath, content: snapshot });
      } catch {
        // Best-effort: still dequeue so the banner never wedges on a
        // write failure the user has no way to retry from this dialog.
      }
    }
    set((st) => ({
      queue: st.queue.filter((e) => e.relPath !== entry.relPath),
      reviewing: null,
    }));
  },

  closeReview: () => set({ reviewing: null }),

  dismissAll: () => set({ queue: [], reviewing: null }),
}));
