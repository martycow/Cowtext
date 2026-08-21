// Assemble confirmation modal (WO12 F7) — the always-on trust boundary in
// front of assemble/refine/summarize (CLAUDE.md: compile never writes
// without diff-preview approval; assemble is the stronger case — it
// overwrites the target `.md` *and* spends a `claude -p` call). Zero props,
// mounted once by app-shell (wave 3); reads directly from `useAssembleGateStore`
// (`src/assemble/gate.ts`). Same modal chrome (scrim, `--r-xl`, `z-modal`) as
// AgentQuestionModal/AddAgentDialog/HooksModal — no new UI primitive. Modeled
// on CompileModal.tsx's phase machine, reusing its "never a spinner"
// PixelMarch idiom while loading (duplicated locally — CompileModal's copy
// is a private, unexported function, and this lane does not touch
// compile.rs/compile/*). Initial focus is on Cancel, never Assemble, so a
// stray Enter can never spend money.

import { useEffect, useRef, useState, type JSX } from "react";
import { assemblePreview } from "./api";
import { useAssembleGateStore } from "./gate";
import type { AssembleMode, AssemblePreview } from "./types";
import { lineCount } from "../store/tokens";

type Phase = "loading" | "preview" | "failed";

const MODE_LABEL: Record<AssembleMode, string> = {
  assemble: "Assemble",
  refine: "Refine",
  summarize: "Summarize",
};

/** 4-step amber pixel march — never a spinner (DESIGN_SPEC.md). Local copy
 *  of CompileModal.tsx's private `PixelMarch`; that one is not exported. */
function PixelMarch({ caption }: { caption: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-blink bg-amber"
            style={{ animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }}
          />
        ))}
        <span className="h-2 w-2 bg-border" />
      </div>
      <span className="font-pixel text-micro tracking-wide text-amber-text">{caption}</span>
    </div>
  );
}

export function AssembleConfirmModal(): JSX.Element | null {
  const pending = useAssembleGateStore((s) => s.pending);
  const clear = useAssembleGateStore((s) => s.clear);

  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<AssemblePreview | null>(null);
  const [errText, setErrText] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Every hook must run unconditionally (rules-of-hooks) — the `pending ===
  // null` early return happens after all of these, matching
  // AgentQuestionModal's shape.
  useEffect(() => {
    if (pending === null) return;
    let live = true;
    setPhase("loading");
    setPreview(null);
    setErrText(null);
    setApproving(false);
    assemblePreview(pending.root, pending.graphJson, pending.nodeId, pending.mode, pending.instruction)
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setPhase("preview");
      })
      .catch((e: unknown) => {
        if (!live) return;
        setErrText(String(e));
        setPhase("failed");
      });
    return () => {
      live = false;
    };
  }, [pending]);

  // Pull focus onto Cancel, never Assemble — the trust-boundary rule (F7).
  useEffect(() => {
    if (pending !== null) cancelRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (pending === null || approving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, approving, clear]);

  if (pending === null) return null;

  const doApprove = () => {
    if (phase !== "preview" || approving) return;
    setApproving(true);
    void Promise.resolve(pending.onApprove()).finally(() => {
      clear();
    });
  };

  const lines = preview !== null && preview.oldContent !== null ? lineCount(preview.oldContent) : 0;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !approving) clear();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={MODE_LABEL[pending.mode]}
        className="flex max-h-[80vh] w-[720px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">{MODE_LABEL[pending.mode]}</span>
          <div className="min-w-0 flex-1" />
          {preview !== null && (
            <span
              className="min-w-0 max-w-[380px] truncate font-mono text-2xs text-content-muted"
              title={preview.relPath}
            >
              {`→ ${preview.relPath}`}
            </span>
          )}
        </div>

        <div className="min-h-[30vh] flex-1 overflow-y-auto p-4">
          {phase === "loading" && <PixelMarch caption="the cow is thinking" />}
          {phase === "failed" && errText !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}
          {phase === "preview" && preview !== null && (
            <div className="flex flex-col gap-3">
              {preview.oldContent !== null ? (
                <p className="font-mono text-xs text-danger-text">
                  {`will overwrite ${lines} existing line${lines === 1 ? "" : "s"}`}
                </p>
              ) : (
                <p className="font-mono text-xs text-accent-text">{`will create ${preview.relPath}`}</p>
              )}
              {preview.neighbors.length > 0 && (
                <p className="min-w-0 truncate font-mono text-2xs text-content-muted">
                  {`neighbors: ${preview.neighbors.join(", ")}`}
                </p>
              )}
              <pre className="max-h-[42vh] select-text overflow-auto whitespace-pre-wrap break-words rounded bg-surface-inset p-3 font-mono text-xs leading-relaxed text-content-secondary">
                {preview.prompt}
              </pre>
            </div>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {phase === "preview"
              ? "review the prompt before spending a claude call"
              : phase === "failed"
                ? "preview failed — nothing was spent"
                : null}
          </span>
          <button
            ref={cancelRef}
            onClick={clear}
            disabled={approving}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={doApprove}
            disabled={phase !== "preview" || approving}
            className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {approving ? "· · ·" : MODE_LABEL[pending.mode]}
          </button>
        </div>
      </div>
    </div>
  );
}
