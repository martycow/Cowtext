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
export type AgentEventKind = "status" | "tool" | "text" | "usage" | "exit" | "error";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow?: number;
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
}

export interface SessionsState {
  sessions: Session[];
  selectedId: string | null;
  busy: boolean; // a command is in flight
  opError: string | null; // last operation error, cleared on the next op

  spawn(root: string, agentFileName: string | null, name: string, cwd: string): Promise<string | null>;
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
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, turns: 0 },
    queue: [],
    lastError: null,
    startedMs: Date.now(),
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
            },
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
