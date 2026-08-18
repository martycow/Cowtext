// Events store — the live BarnEvent feed from the axum hooks server
// (Phase 3+4 contract §2/§3.2). Ring buffer, newest last, MAX 200. Both the
// event-log panel and the barn scene read this store; the ONLY entry point is
// pushEvent (real hooks and the demo player alike). No React imports here.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useGraphStore, type AssembleStatus } from "./graph";
import { useProjectStore, type FsChange } from "./project";

// ── Wire shape — mirrors src-tauri BarnEvent 1:1 (contract §2) ────────

export type BarnEventKind =
  | "prompt"
  | "read"
  | "edit"
  | "write"
  | "grep"
  | "glob"
  | "stop"
  | "subagent_stop"
  | "other";

export interface BarnEvent {
  kind: BarnEventKind;
  /** Verbatim from the hook (may be absolute); omitted if absent. */
  filePath?: string;
  /** Set when kind === "other" (raw tool_name), else omitted. */
  toolName?: string;
  /** Hook session_id, "" if absent. */
  sessionId: string;
  /** Unix millis, assigned by Rust at receipt. */
  ts: number;
}

const MAX_EVENTS = 200;

/** Store-local event shape (contract §1-S12): the BarnEvent wire shape is
 *  frozen; `demo` exists only in the ring buffer. */
export interface LogEvent extends BarnEvent {
  /** Present and true only for demo-player events. Absent on live events. */
  demo?: true;
}

export interface EventsState {
  /** Ring buffer, newest last, MAX = 200. */
  events: LogEvent[];
  /** True while the barn demo player feeds events. */
  demoMode: boolean;
  /** Trims to MAX; single entry point (hooks AND demo). */
  pushEvent: (e: BarnEvent, opts?: { demo?: boolean }) => void;
  clear: () => void;
  setDemoMode: (on: boolean) => void;
}

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  demoMode: false,

  pushEvent: (e, opts) =>
    set((st) => {
      const entry: LogEvent = opts?.demo === true ? { ...e, demo: true } : e;
      return {
        events:
          st.events.length >= MAX_EVENTS
            ? [...st.events.slice(st.events.length - MAX_EVENTS + 1), entry]
            : [...st.events, entry],
      };
    }),

  clear: () => set({ events: [] }),

  // Stopping the demo purges its tagged rows from the ring (contract §7.5)
  // so handoff/session counters never see rehearsal data.
  setDemoMode: (on) =>
    set((st) =>
      on
        ? { demoMode: true }
        : { demoMode: false, events: st.events.filter((e) => e.demo !== true) },
    ),
}));

// ── File path → node id (contract §3.2) ───────────────────────────────

/** Normalizes \ → /, strips the project root prefix if present, then matches
 *  case-insensitively against graph nodes' filePath. null = unknown path
 *  (the event is still logged; only node mapping is skipped). */
export function resolveNodeId(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");
  const { root, nodes } = useGraphStore.getState();
  let rel = norm;
  if (root !== null) {
    const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (
      norm.length > rootNorm.length + 1 &&
      norm.slice(0, rootNorm.length).toLowerCase() === rootNorm.toLowerCase() &&
      norm[rootNorm.length] === "/"
    ) {
      rel = norm.slice(rootNorm.length + 1);
    }
  }
  const relLower = rel.toLowerCase();
  const hit = nodes.find(
    (n) => n.filePath.replace(/\\/g, "/").toLowerCase() === relLower,
  );
  return hit?.id ?? null;
}

/** Kinds that mean "the agent touched this file" — drive the canvas pulse. */
const LIVE_KINDS: readonly BarnEventKind[] = ["read", "edit", "write"];

/** How long a node stays "live" after its file was touched. */
export const LIVE_PULSE_MS = 3200;

/** Most recent ts at which nodeId's file was read/edited/written, or null.
 *  Scans newest-first and stops once events fall outside the pulse window,
 *  so cards never walk the whole ring buffer. */
export function lastLiveTs(nodeId: string, events: BarnEvent[]): number | null {
  const cutoff = Date.now() - LIVE_PULSE_MS;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.ts < cutoff) break;
    if (!LIVE_KINDS.includes(e.kind)) continue;
    if (e.filePath === undefined) continue;
    if (resolveNodeId(e.filePath) === nodeId) return e.ts;
  }
  return null;
}

/** One-minute memory window for the Live lens (distinct from the 3.2s card pulse). */
export const LENS_LIVE_WINDOW_MS = 60_000;

/** Same scan as lastLiveTs, one-minute memory — for the Live lens only. */
export function lensLiveTs(nodeId: string, events: BarnEvent[]): number | null {
  const cutoff = Date.now() - LENS_LIVE_WINDOW_MS;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.ts < cutoff) break;
    if (!LIVE_KINDS.includes(e.kind)) continue;
    if (e.filePath === undefined) continue;
    if (resolveNodeId(e.filePath) === nodeId) return e.ts;
  }
  return null;
}

// ── Tauri wiring — idempotent (StrictMode double-mounts effects) ──────

const ASSEMBLE_STATUSES: readonly AssembleStatus[] = [
  "idle",
  "queued",
  "running",
  "assembled",
  "error",
];

interface AssembleStatusPayload {
  nodeId: string;
  status: string;
  error: string | null;
}

let wiring: Promise<() => void> | null = null;

/** Wires listen("barn://event") → pushEvent and listen("assemble://status")
 *  → graph store. Called once from App.tsx; safe to call again (idempotent).
 *  The returned cleanup unlistens and resets, allowing a future re-init. */
export function initEventListener(): Promise<() => void> {
  if (wiring !== null) return wiring;
  wiring = (async () => {
    const unlistens: UnlistenFn[] = [];
    unlistens.push(
      await listen<BarnEvent>("barn://event", (ev) => {
        useEventsStore.getState().pushEvent(ev.payload);
      }),
    );
    unlistens.push(
      await listen<AssembleStatusPayload>("assemble://status", (ev) => {
        const { nodeId, status, error } = ev.payload;
        const known = ASSEMBLE_STATUSES.find((s) => s === status);
        if (known === undefined) return; // unknown status — ignore, never crash
        useGraphStore
          .getState()
          .setAssembleStatus(nodeId, known, error ?? undefined);
      }),
    );
    unlistens.push(
      await listen<FsChange>("fs://change", (ev) => {
        useProjectStore.getState().applyFsChange(ev.payload);
      }),
    );
    return () => {
      for (const un of unlistens) un();
      wiring = null;
    };
  })();
  return wiring;
}
