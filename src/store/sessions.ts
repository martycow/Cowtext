// Agent-session store — WO01 Block F contract §7 (frozen interface, lanes U
// and B code against it, never stub/redeclare/extend these names). Mirrors
// the `agent://event` wire shape 1:1 with sessions.rs. No React imports here;
// imports allowed: ./sessions -> ../sessions/api + @tauri-apps/api/event only.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  agentSessionKill,
  agentSessionList,
  agentSessionRestart,
  agentSessionSend,
  agentSessionSpawn,
  type SessionInfo,
} from "../sessions/api";

// ── Wire shape — mirrors src-tauri AgentEvent 1:1 (contract §5) ───────

export type SessionStatus = "idle" | "working" | "waiting";
// WO06 §5.4 — "budget" is the one new kind; no field added/removed on
// AgentEvent itself, `usage`/`text` already exist and carry it.
export type AgentEventKind = "status" | "tool" | "text" | "usage" | "exit" | "error" | "budget";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow?: number;
  /** `total_cost_usd` from the CLI's terminal `result` line (N5) — the
   *  conversation's running total as reported by claude, not a per-turn
   *  delta. `number | null` on the wire, never omitted: `null` means this
   *  CLI build didn't report a cost, not "unknown". */
  costUsd: number | null;
}

export interface AgentEvent {
  id: string;
  kind: AgentEventKind;
  status?: SessionStatus;
  tool?: string;
  text?: string;
  usage?: Usage;
  ts: number;
}

// ── Store-owned shapes (contract §7) ───────────────────────────────────

export const TRANSCRIPT_CAP = 500; // ring buffer, newest last
export const MAX_SESSIONS = 4; // mirrors the Rust cap and CalfHerd's CAP

export interface TranscriptLine {
  kind: "text" | "tool" | "status" | "error" | "exit";
  text: string;
  ts: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
  /** Cumulative session cost (N5). `total_cost_usd` is already a running
   *  total as reported by the CLI (not a per-turn delta), so this field
   *  takes the latest reported value rather than summing turn-over-turn —
   *  summing an already-cumulative number would double count. `null` until
   *  the first turn that reports a cost; stays at its last known value
   *  after that (a later turn with no cost does not erase it). */
  costUsd: number | null;
}

export interface Session {
  id: string;
  name: string;
  agentFileName: string | null;
  cwd: string;
  root: string;
  status: SessionStatus;
  currentTool: string | null;
  alive: boolean;
  transcript: TranscriptLine[]; // cap TRANSCRIPT_CAP
  usage: UsageTotals; // accumulated across turns
  queue: string[]; // prompts typed while busy, drained on idle
  lastError: string | null;
  startedMs: number;
  /** Captured from the stream's `system/init` line — the durable id
   *  `tasklinks.json`'s `sessionIds` key on (WO06 §3.2 L3). Was silently
   *  dropped by `sessionFromInfo` pre-WO06 even though `SessionInfo` already
   *  carried it; restored here as part of the WO06 budget/linkage work. */
  claudeSessionId: string | null;
  /** WO06 §4.3 — set only for sessions spawned via `spawnForTask`; null for
   *  every session spawned the pre-WO06 way through `spawn`. */
  taskId: string | null;
  /** Effective ceiling this session was spawned with, `null` = unlimited
   *  (WO06 §5.1/§8). */
  tokenCeiling: number | null;
  /** WO06 §8 `SessionInfo.tokensUsed` mirror — Rust's own authoritative
   *  cumulative accumulator (`SessionEntry.tokens_used`, folded once per
   *  turn by `end_turn`), the correct denominator for the budget gauge.
   *  Deliberately a SEPARATE field from `usage.totalTokens` even though the
   *  two normally track together turn-for-turn: `usage.totalTokens` is a
   *  pure per-`usage`-event sum with no other meaning, while a `budget`
   *  event's `usage.totalTokens` is `spent` — an already-cumulative
   *  snapshot, not a delta (`sessions.rs` `budget_event` doc comment). Fold
   *  that into `usage.totalTokens` (which only ever knows how to add) and
   *  the ceiling stop double-counts every token accrued before it (D4).
   *  `tokensUsed` therefore adds per `usage` event, same as `usage
   *  .totalTokens`, but is ASSIGNED (never added) on a `budget` event. */
  tokensUsed: number;
  /** `"budget"` once a `budget`-kind event has been observed for this
   *  session — the signal that distinguishes a budget hard-stop from an
   *  ordinary exit/crash in the UI (WO06 §5.5). Reset to `null` on restart:
   *  "a restart is a new budget" (contract §5.5). */
  stopReason: "budget" | null;
}

export interface SessionsState {
  sessions: Session[];
  selectedId: string | null;
  busy: boolean; // a command is in flight
  opError: string | null; // last operation error, cleared on the next op

  spawn(root: string, agentFileName: string | null, name: string, cwd: string): Promise<string | null>;
  /** WO06 §4.3 — spawns WITH a pre-compiled task context and an effective
   *  ceiling. Kept as a sibling of `spawn` (not an overload) so the pre-WO06
   *  4-arg call site above is untouched and its behaviour stays byte-for-byte
   *  identical (contract §1.14). Resolves the new session's Cowtext-side id
   *  on success, so the caller can record it against the task's tasklinks
   *  entry. */
  spawnForTask(
    root: string,
    agentFileName: string | null,
    name: string,
    cwd: string,
    taskId: string,
    taskContext: string,
    tokenCeiling: number | null,
  ): Promise<{ id: string } | { error: string }>;
  send(id: string, prompt: string): Promise<string | null>;
  kill(id: string): Promise<string | null>;
  restart(id: string): Promise<string | null>;
  dismiss(id: string): void; // removes an exited session; no-op while alive
  selectSession(id: string | null): void;
  applyEvent(e: AgentEvent): void; // THE single entry point for agent://event
  hydrate(): Promise<void>; // agent_session_list -> adopt live sessions after a reload
}

// ── Small pure helpers ──────────────────────────────────────────────────

function pushTranscript(list: TranscriptLine[], line: TranscriptLine): TranscriptLine[] {
  const next = [...list, line];
  return next.length > TRANSCRIPT_CAP ? next.slice(next.length - TRANSCRIPT_CAP) : next;
}

function sessionFromInfo(info: SessionInfo): Session {
  return {
    id: info.id,
    name: info.name,
    agentFileName: info.agentFileName,
    cwd: info.cwd,
    root: info.root,
    status: "idle",
    currentTool: null,
    alive: info.alive,
    transcript: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, turns: 0, costUsd: null },
    queue: [],
    lastError: null,
    startedMs: Date.now(),
    claudeSessionId: info.claudeSessionId,
    taskId: null,
    tokenCeiling: info.tokenCeiling,
    tokensUsed: info.tokensUsed,
    stopReason: null,
  };
}

// ── Store ─────────────────────────────────────────────────────────────

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  selectedId: null,
  busy: false,
  opError: null,

  spawn: async (root, agentFileName, name, cwd) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.sessions.filter((x) => x.alive).length >= MAX_SESSIONS) {
      return `agent limit reached (${MAX_SESSIONS})`;
    }
    set({ busy: true, opError: null });
    try {
      const info = await agentSessionSpawn(root, agentFileName, name, cwd);
      set((st) => ({
        sessions: [...st.sessions, { ...sessionFromInfo(info), status: "working" }],
        selectedId: info.id,
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

  spawnForTask: async (root, agentFileName, name, cwd, taskId, taskContext, tokenCeiling) => {
    const s = get();
    if (s.busy) return { error: "Busy" };
    if (s.sessions.filter((x) => x.alive).length >= MAX_SESSIONS) {
      return { error: `agent limit reached (${MAX_SESSIONS})` };
    }
    set({ busy: true, opError: null });
    try {
      const info = await agentSessionSpawn(root, agentFileName, name, cwd, taskId, taskContext, tokenCeiling);
      set((st) => ({
        sessions: [
          ...st.sessions,
          { ...sessionFromInfo(info), status: "working", taskId, tokenCeiling },
        ],
        selectedId: info.id,
      }));
      return { id: info.id };
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return { error: msg };
    } finally {
      set({ busy: false });
    }
  },

  send: async (id, prompt) => {
    const trimmed = prompt.trim();
    if (trimmed === "") return null;
    const s = get();
    const session = s.sessions.find((x) => x.id === id);
    if (session === undefined) return null;
    if (session.status !== "idle" || session.queue.length > 0) {
      set((st) => ({
        sessions: st.sessions.map((x) => (x.id === id ? { ...x, queue: [...x.queue, trimmed] } : x)),
      }));
      return null;
    }
    // Optimistic freeze BEFORE the invoke: a real event can arrive and move
    // status on before the invoke promise settles — it must always win over
    // this optimistic mark, never be overwritten by a rollback.
    set((st) => ({
      sessions: st.sessions.map((x) => (x.id === id ? { ...x, status: "working" } : x)),
    }));
    try {
      await agentSessionSend(id, trimmed);
      return null;
    } catch (e) {
      set((st) => ({
        sessions: st.sessions.map((x) =>
          x.id === id && x.status === "working" ? { ...x, status: "idle" } : x,
        ),
      }));
      return String(e);
    }
  },

  kill: async (id) => {
    const s = get();
    if (s.busy) return "Busy";
    set({ busy: true, opError: null });
    try {
      await agentSessionKill(id);
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  restart: async (id) => {
    const s = get();
    if (s.busy) return "Busy";
    set({ busy: true, opError: null });
    try {
      await agentSessionRestart(id);
      set((st) => ({
        sessions: st.sessions.map((x) =>
          x.id === id
            ? {
                ...x,
                alive: true,
                status: "working",
                currentTool: null,
                queue: [],
                lastError: null,
                // "a restart is a new budget" (contract §5.5) — usage totals
                // are NOT reset here (the registry's `tokens_used` reset and
                // this store's usage total are two separate accumulators;
                // resetting usage client-side would desync from the next
                // real `usage` event's deltas), only the stop signal is.
                stopReason: null,
                transcript: pushTranscript(x.transcript, {
                  kind: "status",
                  text: "— restarted —",
                  ts: Date.now(),
                }),
              }
            : x,
        ),
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

  dismiss: (id) => {
    set((st) => {
      const session = st.sessions.find((x) => x.id === id);
      if (session === undefined || session.alive) return {};
      return {
        sessions: st.sessions.filter((x) => x.id !== id),
        selectedId: st.selectedId === id ? null : st.selectedId,
      };
    });
  },

  selectSession: (id) => set({ selectedId: id }),

  applyEvent: (e) => {
    set((st) => {
      const idx = st.sessions.findIndex((x) => x.id === e.id);
      if (idx === -1) return {};
      const session = st.sessions[idx];
      let next: Session;
      switch (e.kind) {
        case "status": {
          const status = e.status ?? session.status;
          next = { ...session, status, currentTool: status === "idle" ? null : session.currentTool };
          break;
        }
        case "tool": {
          const tool = e.tool ?? null;
          next = {
            ...session,
            currentTool: tool,
            transcript: pushTranscript(session.transcript, {
              kind: "tool",
              text: `⚙ ${tool ?? ""}`,
              ts: e.ts,
            }),
          };
          break;
        }
        case "text": {
          next = {
            ...session,
            transcript: pushTranscript(session.transcript, { kind: "text", text: e.text ?? "", ts: e.ts }),
          };
          break;
        }
        case "usage": {
          const u = e.usage;
          if (u === undefined) {
            next = session;
            break;
          }
          next = {
            ...session,
            usage: {
              inputTokens: session.usage.inputTokens + u.inputTokens,
              outputTokens: session.usage.outputTokens + u.outputTokens,
              totalTokens: session.usage.totalTokens + u.totalTokens,
              turns: session.usage.turns + 1,
              // Take-latest, not sum: costUsd is already a running total
              // (see UsageTotals doc comment). A turn with no cost leaves
              // the last known value in place rather than clearing it.
              costUsd: u.costUsd ?? session.usage.costUsd,
            },
            // A normal `usage` event's `totalTokens` is that turn's own
            // delta (sessions.rs: "the result line's usage is the turn's
            // authoritative total") — same accumulation as `usage
            // .totalTokens` above, kept in lockstep with Rust's own
            // per-turn fold (`end_turn`: `tokens_used += turn_tokens`) so
            // the budget gauge climbs live, not just at the stop (D4/D5).
            tokensUsed: session.tokensUsed + u.totalTokens,
          };
          break;
        }
        case "error": {
          next = {
            ...session,
            lastError: e.text ?? null,
            transcript: pushTranscript(session.transcript, { kind: "error", text: e.text ?? "", ts: e.ts }),
          };
          break;
        }
        case "budget": {
          // WO06 §5.3/§5.4 — backend emits `budget` then `exit`, in that
          // order, from inside the same generation-fenced Stop path; `exit`
          // (below) is what actually flips `alive`. This case only records
          // the stop reason (so the UI can tell budget apart from a crash)
          // and folds in the usage this event carries — the same shape as
          // the "usage" case, not summed twice: it IS this turn's usage
          // event, budget just piggy-backs on it.
          const u = e.usage;
          next = {
            ...session,
            stopReason: "budget",
            usage:
              u === undefined
                ? session.usage
                : {
                    inputTokens: session.usage.inputTokens + u.inputTokens,
                    outputTokens: session.usage.outputTokens + u.outputTokens,
                    totalTokens: session.usage.totalTokens + u.totalTokens,
                    turns: session.usage.turns + 1,
                    costUsd: u.costUsd ?? session.usage.costUsd,
                  },
            // D4 fix: a `budget` event's `usage.totalTokens` is `spent` —
            // Rust's already-cumulative total at the moment it crossed the
            // ceiling (`sessions.rs` `budget_event`), NOT a per-line delta.
            // ASSIGN it to `tokensUsed`, never add — adding double-counts
            // every token this session had already accrued before the stop
            // (verified failure: ceiling 200000, turn 1 leaves tokensUsed
            // at 150000 via the `usage` case above, turn 2's stop carries
            // totalTokens=210000; assigning yields 210000, adding would
            // have yielded 360000 / 180%).
            tokensUsed: u === undefined ? session.tokensUsed : u.totalTokens,
            transcript: pushTranscript(session.transcript, {
              kind: "error",
              text: e.text ?? "token ceiling reached — session stopped",
              ts: e.ts,
            }),
          };
          break;
        }
        case "exit": {
          next = {
            ...session,
            alive: false,
            status: "idle",
            currentTool: null,
            queue: [],
            transcript: pushTranscript(session.transcript, { kind: "exit", text: e.text ?? "", ts: e.ts }),
          };
          break;
        }
      }
      const sessions = [...st.sessions];
      sessions[idx] = next;
      return { sessions };
    });
    // The queue drain is the ONLY place the queue moves, and it must run
    // after the set() above has committed the new "idle" status — a lost
    // event can only ever delay a queued prompt, never duplicate one.
    if (e.kind === "status" && e.status === "idle") {
      const session = get().sessions.find((x) => x.id === e.id);
      if (session !== undefined && session.queue.length > 0) {
        const head = session.queue[0];
        set((st) => ({
          sessions: st.sessions.map((x) => (x.id === e.id ? { ...x, queue: x.queue.slice(1) } : x)),
        }));
        void get().send(e.id, head);
      }
    }
  },

  hydrate: async () => {
    try {
      const list = await agentSessionList();
      set({ sessions: list.map(sessionFromInfo) });
    } catch {
      // best-effort — leave existing state on failure
    }
  },
}));

// ── Tauri wiring — idempotent (StrictMode double-mounts effects) ──────

let wiring: Promise<() => void> | null = null;

/** Wires listen("agent://event") -> applyEvent. Idempotent (StrictMode-safe),
 *  same shape as initEventListener in store/events.ts. Called once from
 *  App.tsx; the returned cleanup unlistens and resets, allowing a future
 *  re-init. */
export function initSessionsListener(): Promise<() => void> {
  if (wiring !== null) return wiring;
  wiring = (async () => {
    const unlistens: UnlistenFn[] = [];
    unlistens.push(
      await listen<AgentEvent>("agent://event", (ev) => {
        useSessionsStore.getState().applyEvent(ev.payload);
      }),
    );
    return () => {
      for (const un of unlistens) un();
      wiring = null;
    };
  })();
  return wiring;
}
