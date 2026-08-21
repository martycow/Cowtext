// Events store — the live BarnEvent feed from the axum hooks server
// (Phase 3+4 contract §2/§3.2). Ring buffer, newest last, MAX 200. Both the
// event-log panel and the barn scene read this store; the ONLY entry point is
// pushEvent (real hooks and the demo player alike). No React imports here.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useGraphStore, type AssembleStatus, type AssemblePhase } from "./graph";
import { useProjectStore, type FsChange } from "./project";
import { useReviewStore } from "./review";
import { onTaskFileChange } from "./tasks";

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

/** Mirrors `graph.ts`'s `AssemblePhase` (WO13_CONTRACT.md §3.3). Validated
 *  the same way `status` is, just below: an unknown phase from a future
 *  backend is silently ignored — never thrown, never left to corrupt the
 *  store. */
const ASSEMBLE_PHASES: readonly AssemblePhase[] = [
  "queued",
  "starting",
  "running",
  "writing",
  "done",
  "error",
];

/** Mirrors src-tauri `AssembleProgress` 1:1 (WO13_CONTRACT.md §3.3):
 *  `status` stays authoritative for `setAssembleStatus`; `phase`/`startedAt`
 *  are additive telemetry, forwarded to `setAssemblePhase` so the canvas
 *  card's 3-step stepper has live data instead of blinking over nothing.
 *  `startedAt` is `null` on the wire (not omitted) for the initial "queued"
 *  event only — every later event of the same job carries a value. */
interface AssembleStatusPayload {
  nodeId: string;
  status: string;
  phase: string;
  startedAt: number | null;
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
        const { nodeId, status, phase, startedAt, error } = ev.payload;
        // `status` and `phase` are validated and applied independently — an
        // unrecognized value in one must not suppress a valid update to the
        // other (each is its own optional-store-action guard, same idiom).
        const knownStatus = ASSEMBLE_STATUSES.find((s) => s === status);
        if (knownStatus !== undefined) {
          useGraphStore
            .getState()
            .setAssembleStatus(nodeId, knownStatus, error ?? undefined);
        }
        const knownPhase = ASSEMBLE_PHASES.find((p) => p === phase);
        if (knownPhase !== undefined) {
          useGraphStore
            .getState()
            .setAssemblePhase(nodeId, knownPhase, startedAt ?? undefined);
        }
      }),
    );
    unlistens.push(
      await listen<FsChange>("fs://change", (ev) => {
        useProjectStore.getState().applyFsChange(ev.payload);
        // Task board auto-refresh (TASKBOARD_BATCH §7): convention task
        // files reload debounced; every other path is a no-op inside.
        onTaskFileChange(ev.payload.relPath);
        // Disk-change review queue (WO01 Block C §T4): a managed file
        // Cowtext didn't just write itself gets enqueued for review.
        useReviewStore.getState().onFsChange(ev.payload);
      }),
    );
    return () => {
      for (const un of unlistens) un();
      wiring = null;
    };
  })();
  return wiring;
}
