// Agent panel — Inspector's first branch when a roster card is selected
// (WO01 Block F §8.2). Read-only transcript stream, real token usage, a
// Queue prompt box, Restart/Kill. Closing (X → selectSession(null)) restores
// whatever the Inspector showed before, byte-for-byte — this component owns
// no other panel's state.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AgentAvatar } from "../agents/AgentAvatar";
import { selectReducedMotion, useSettingsStore } from "../store/settings";
import { useSessionsStore, type SessionStatus } from "../store/sessions";
import { CONTEXT_WINDOW_TOKENS, ctxPercent } from "../store/tokens";
import { BudgetBar } from "./BudgetGauge";

const STATUS_BADGE: Record<SessionStatus, string> = {
  idle: "border-border bg-surface-2 text-content-secondary",
  working: "border-amber-border bg-amber-surface text-amber-text",
  waiting: "border-accent-border bg-accent-surface text-accent-text",
};

/** N5: "$Y.YYYY" — 4 decimals (per-turn spend is small; 2 decimals would
 *  round most turns to $0.00). null (no CLI cost report yet) reads as
 *  "cost n/a", never a misleading "$0.0000". */
function formatCost(usd: number | null): string {
  return usd === null ? "cost n/a" : `$${usd.toFixed(4)}`;
}

const TRANSCRIPT_CLS: Record<string, string> = {
  tool: "text-amber-text",
  error: "text-danger-text",
  status: "text-content-muted",
  exit: "text-content-muted",
  text: "text-content-secondary",
  // Blue is you (DESIGN_SPEC): the only line in the stream the user wrote.
  user: "text-accent-text",
};

export function AgentPanel() {
  const selectedId = useSessionsStore((s) => s.selectedId);
  const session = useSessionsStore((s) => s.sessions.find((x) => x.id === selectedId));
  const reducedMotion = useSettingsStore(selectReducedMotion);

  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [killArmed, setKillArmed] = useState(false);
  const [killBusy, setKillBusy] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement>(null);

  // A selected session that no longer exists (e.g. dismissed elsewhere) —
  // fall back to whatever the Inspector showed before, rather than an
  // orphaned panel.
  useEffect(() => {
    if (selectedId !== null && session === undefined) {
      useSessionsStore.getState().selectSession(null);
    }
  }, [selectedId, session]);

  // Switching sessions resets per-session UI state — none of it should leak
  // from one agent's panel to another's.
  useEffect(() => {
    setDraft("");
    setKillArmed(false);
    setKillError(null);
    setRestartError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!killArmed) return undefined;
    const t = setTimeout(() => setKillArmed(false), 4000);
    return () => clearTimeout(t);
  }, [killArmed]);

  // Newest last — keep the transcript pinned to the bottom (EventLog idiom).
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [session?.transcript.length]);

  // WO16 Stage A — a question arriving for the agent on screen puts the
  // cursor where the answer goes. `ts` (not the text) is the dependency:
  // a second question with the same wording must still re-focus.
  const questionTs = session?.pendingQuestion?.ts ?? null;
  useEffect(() => {
    if (questionTs !== null) composerRef.current?.focus();
  }, [questionTs]);

  if (session === undefined) return null;

  const budgetStopped = session.stopReason === "budget";
  const question = session.pendingQuestion;

  const onSend = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    // Answering routes through `answerQuestion` so the question is cleared by
    // the same action that sends the reply (store/sessions.ts).
    const store = useSessionsStore.getState();
    if (question !== null) void store.answerQuestion(session.id, text);
    else void store.send(session.id, text);
  };

  const doRestart = () => {
    setRestartBusy(true);
    setRestartError(null);
    void useSessionsStore
      .getState()
      .restart(session.id)
      .then((err) => {
        setRestartBusy(false);
        if (err !== null) setRestartError(err);
      });
  };

  const doKill = () => {
    if (!killArmed) {
      setKillArmed(true);
      return;
    }
    setKillArmed(false);
    setKillBusy(true);
    setKillError(null);
    void useSessionsStore
      .getState()
      .kill(session.id)
      .then((err) => {
        setKillBusy(false);
        if (err !== null) setKillError(err);
      });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border-subtle bg-surface-inset px-3 py-2">
        <AgentAvatar seed={session.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content">{session.name}</p>
          <span
            className={`mt-0.5 inline-flex h-[17px] items-center gap-1 rounded-sm border px-1 font-mono text-micro ${
              budgetStopped ? "border-danger bg-danger-surface text-danger-text" : STATUS_BADGE[session.status]
            }`}
          >
            {session.status === "working" && !budgetStopped && !reducedMotion && (
              <span className="h-[5px] w-[5px] animate-blink bg-amber" />
            )}
            {/* A budget stop is a distinct terminal state from a plain exit
                or crash (WO06 §5.5) — never just "idle" once it fires. */}
            {budgetStopped ? "stopped: token ceiling reached" : session.status}
          </span>
        </div>
        <button
          onClick={() => useSessionsStore.getState().selectSession(null)}
          title="Close"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-none border-b border-border-subtle px-3 py-1.5">
        <p
          className="truncate font-mono text-2xs text-content-muted [direction:rtl] [text-align:left]"
          title={session.cwd}
        >
          {session.cwd}
        </p>
        {session.agentFileName !== null && (
          <p className="truncate font-mono text-2xs text-content-disabled">{session.agentFileName}</p>
        )}
      </div>

      <div className="flex-none border-b border-border-subtle px-3 py-1.5">
        <p
          className="font-mono text-2xs text-content-muted"
          title={`reported by claude, not an estimate · ↑${session.usage.inputTokens} ↓${session.usage.outputTokens} · ${session.usage.turns} turn${session.usage.turns === 1 ? "" : "s"}${
            session.usage.cacheReadTokens > 0
              ? ` · ${session.usage.cacheReadTokens} cached prompt tokens re-read (not charged to the budget — each context token counts once, when it is first sent)`
              : ""
          }`}
        >
          {session.usage.turns === 0
            ? "no usage yet"
            : `≈${session.usage.totalTokens} tok · ${ctxPercent(session.usage.totalTokens)}% of ${CONTEXT_WINDOW_TOKENS / 1000}k · ${formatCost(session.usage.costUsd)}`}
        </p>
        {session.tokenCeiling !== null && (
          <div className="mt-1.5">
            {/* D4: `tokensUsed`, not `usage.totalTokens` — see store/sessions.ts */}
            <BudgetBar tokensUsed={session.tokensUsed} ceiling={session.tokenCeiling} stopped={budgetStopped} />
          </div>
        )}
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5 font-mono text-2xs">
        {session.transcript.length === 0 ? (
          <li className="py-2 text-center text-content-muted">no activity yet</li>
        ) : (
          session.transcript.map((line, i) => (
            <li
              key={i}
              className={`whitespace-pre-wrap break-words py-0.5 ${TRANSCRIPT_CLS[line.kind] ?? "text-content-secondary"}`}
            >
              {line.text}
            </li>
          ))
        )}
      </ul>

      <div className="flex-none border-t border-border-subtle p-2">
        {question !== null && (
          <div className="mb-2 rounded border border-accent-border bg-accent-surface px-2 py-1.5">
            <p className="font-pixel text-[8px] uppercase text-accent-text">asking you</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-content">{question.text}</p>
            <button
              onClick={() => useSessionsStore.getState().clearPendingQuestion(session.id)}
              className="mt-1 text-2xs text-content-muted underline-offset-2 transition-colors duration-fast hover:text-content hover:underline"
            >
              Dismiss without answering
            </button>
          </div>
        )}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={!session.alive}
          placeholder={
            !session.alive
              ? "session has exited"
              : question !== null
                ? "Answer… (Enter to send, Shift+Enter for a newline)"
                : "Send a prompt… (Enter to send, Shift+Enter for a newline)"
          }
          rows={2}
          className="min-h-[44px] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-content placeholder:text-content-disabled focus:border-accent disabled:text-content-disabled"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={onSend}
            disabled={!session.alive || draft.trim() === ""}
            className="h-control-sm flex-none rounded bg-accent px-2.5 text-xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {question !== null ? "Answer" : "Send"}
          </button>
          {session.queue.length > 0 && (
            <span className="font-mono text-2xs text-content-muted">queued: {session.queue.length}</span>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-border-subtle p-2">
        <button
          onClick={doRestart}
          disabled={restartBusy}
          className="h-control-sm flex-none rounded border border-border bg-surface-2 px-2.5 text-xs text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled"
        >
          {restartBusy ? "· · ·" : "Restart"}
        </button>
        {killArmed ? (
          <button
            onClick={doKill}
            disabled={killBusy}
            className="h-control-sm flex-none rounded border border-danger bg-danger-surface px-2.5 text-xs font-medium text-danger-text transition-colors duration-fast hover:bg-danger hover:text-content-inverse"
          >
            Confirm kill?
          </button>
        ) : (
          <button
            onClick={doKill}
            disabled={killBusy || !session.alive}
            className="h-control-sm flex-none rounded border border-border bg-surface-2 px-2.5 text-xs text-content-secondary transition-colors duration-fast hover:border-danger hover:text-danger-text disabled:text-content-disabled"
          >
            Kill
          </button>
        )}
        {budgetStopped && restartError === null && killError === null && (
          <p className="min-w-0 flex-1 truncate font-mono text-2xs text-content-muted">
            restart resets the token budget
          </p>
        )}
        {(restartError !== null || killError !== null) && (
          <p className="min-w-0 flex-1 truncate font-mono text-2xs text-danger-text">
            {restartError ?? killError}
          </p>
        )}
      </div>
    </div>
  );
}
