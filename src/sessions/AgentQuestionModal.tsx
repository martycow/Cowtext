// Agent question popup (F2 — WO12 contract) — surfaces the `"question"`-kind
// `agent://event` (the `COWTEXT_ASK: <question>` marker convention baked
// into `BOOT_PROMPT_TAIL`/`find_cowtext_ask` in sessions.rs). Zero props,
// mounted once by app-shell (wave 3); reads directly from
// `useSessionsStore`. This is a reply surface, not a spend gate — initial
// focus goes on the answer textarea, Ctrl+Enter sends, plain Enter is a
// newline, and Esc/Dismiss clears the pending question WITHOUT sending.
// Same modal chrome (scrim, `--r-xl`, `z-modal`) as AddAgentDialog/HooksModal
// — no new UI primitive.

import { useEffect, useRef, useState, type JSX } from "react";
import { X } from "lucide-react";
import { useSessionsStore } from "../store/sessions";
import { agentSessionSend } from "./api";

export function AgentQuestionModal(): JSX.Element | null {
  const sessions = useSessionsStore((s) => s.sessions);
  const clearPendingQuestion = useSessionsStore((s) => s.clearPendingQuestion);

  // First session with a pending question wins; the rest just contribute to
  // the "+N more" count (contract: "do not build a queue UI").
  const pending = sessions.filter((s) => s.pendingQuestion !== null);
  const active = pending[0] ?? null;
  const extraCount = Math.max(0, pending.length - 1);
  const activeId = active?.id ?? null;

  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A new (or different) active question always starts from a clean slate.
  useEffect(() => {
    setAnswer("");
    setSendError(null);
    setSending(false);
  }, [activeId]);

  useEffect(() => {
    if (activeId !== null) textareaRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    if (activeId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) {
        clearPendingQuestion(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, sending, clearPendingQuestion]);

  if (active === null || active.pendingQuestion === null) return null;
  const question = active.pendingQuestion;

  const dismiss = () => {
    if (sending) return;
    clearPendingQuestion(active.id);
  };

  const send = () => {
    const trimmed = answer.trim();
    if (trimmed === "" || sending) return;
    setSending(true);
    setSendError(null);
    // Deliberately the raw invoke wrapper, not the store's `send()` action:
    // the reply is just the next turn's prompt on the same
    // `--resume <claudeSessionId>` conversation, and `send()`'s busy/queue
    // machinery has nothing to add here (contract).
    void agentSessionSend(active.id, trimmed)
      .then(() => {
        clearPendingQuestion(active.id);
      })
      .catch((e: unknown) => {
        setSending(false);
        setSendError(String(e));
      });
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agent question"
        className="flex max-h-[80vh] w-[480px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="truncate text-[15px] font-semibold">{active.name} is asking</span>
          <div className="min-w-0 flex-1" />
          {extraCount > 0 && (
            <span className="font-mono text-2xs text-content-muted">+{extraCount} more</span>
          )}
          <button
            onClick={dismiss}
            disabled={sending}
            title="Dismiss"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <p className="whitespace-pre-wrap break-words rounded border border-border-subtle bg-surface-inset p-3 text-sm text-content">
            {question.text}
          </p>

          <div>
            <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
              Your answer
            </label>
            <textarea
              ref={textareaRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={4}
              disabled={sending}
              placeholder="Reply to the agent… (Ctrl+Enter to send)"
              className="w-full resize-none rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-content focus:border-accent disabled:text-content-disabled"
            />
          </div>

          {sendError !== null && (
            <p className="break-words font-mono text-xs text-danger-text">{sendError}</p>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            Ctrl+Enter to send · Esc to dismiss
          </span>
          <button
            onClick={dismiss}
            disabled={sending}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            Dismiss
          </button>
          <button
            onClick={send}
            disabled={answer.trim() === "" || sending}
            className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {sending ? "· · ·" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
