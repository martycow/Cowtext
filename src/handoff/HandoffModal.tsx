// Handoff modal (contract §8.5) — generate a HANDOFF.md via headless
// `claude -p` (graph + recent live activity), preview old vs new, and only
// write after explicit approval. Trust boundary: no write without the
// "Write HANDOFF.md" click, ever. Copy buttons hand the content to another
// Claude surface with a per-surface preamble.

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { GRAPH_VERSION, serializeGraph, useGraphStore } from "../store/graph";
import { useEventsStore } from "../store/events";
import { handoffGenerate, handoffWrite } from "./api";
import { HandoffNodeProposalModal } from "./HandoffNodeProposalModal";
import type { HandoffResult } from "./types";

type Phase = "idle" | "generating" | "diff" | "writing" | "written" | "failed";

const COPY_VARIANTS = [
  {
    id: "chat",
    label: "Copy for Claude Chat",
    prefix:
      "Here is the current project handoff. Read it, then continue from “Next actions”.\n\n",
  },
  {
    id: "code",
    label: "Copy for Claude Code",
    prefix:
      "Read this handoff, then explore the repo before acting. The graph-compiled CLAUDE.md is the standing context; this handoff is the session state.\n\n",
  },
  {
    id: "design",
    label: "Copy for Claude Design",
    prefix:
      "Here is the project handoff. Focus on the design-relevant threads under “Open threads” and “Next actions”.\n\n",
  },
] as const;

type CopyId = (typeof COPY_VARIANTS)[number]["id"];

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

/** 4-step amber pixel march — never a spinner (DESIGN_SPEC.md). Local copy
 *  of the CompileModal idiom; modals never import across feature dirs. */
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

function ContentWell({ label, text }: { label: string; text: string }) {
  return (
    <section className="border-b border-border-subtle">
      <div className="flex h-[26px] items-center px-4">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
          {label}
        </span>
      </div>
      <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap bg-surface-inset px-4 py-2 font-mono text-xs leading-relaxed text-content-secondary">
        {text}
      </pre>
    </section>
  );
}

export function HandoffModal({ root, onClose }: { root: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<HandoffResult | null>(null);
  const [errText, setErrText] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyId | null>(null);
  const [clipFallback, setClipFallback] = useState<string | null>(null);
  // §6 sub-flow (handoff_node_propose) — a separate modal, swapped in for
  // this one rather than stacked on top of it (one scrim visible at a
  // time). This component's own state (phase/result/…) stays alive
  // underneath, so "Cancel" from the proposal modal returns here exactly
  // as it was.
  const [proposeOpen, setProposeOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    // Re-arm on every mount — StrictMode runs the cleanup once eagerly.
    liveRef.current = true;
    panelRef.current?.focus();
    return () => {
      liveRef.current = false;
    };
  }, []);

  // Closing during "generating" simply abandons the wait: there is no cancel
  // command — the claude child finishes on its own and the result is
  // discarded (liveRef guards the state updates). Closing during "writing"
  // is blocked on every path (Esc/scrim/X/footer, HooksModal idiom): the
  // write's outcome must be seen, never silently discarded.
  const canClose = phase !== "writing";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const doGenerate = () => {
    setPhase("generating");
    setErrText(null);
    (async () => {
      await useGraphStore.getState().flushSave();
      const s = useGraphStore.getState();
      const graphJson = serializeGraph({
        version: GRAPH_VERSION,
        projectName: s.projectName,
        nodes: s.nodes,
        edges: s.edges,
        compileTargets: s.compileTargets,
      });
      // Live activity only: demo rows are excluded (contract D12), newest
      // 100 kept, newest last.
      const events = useEventsStore
        .getState()
        .events.filter((e) => e.demo !== true)
        .slice(-100)
        .map((e) => ({
          kind: e.kind,
          ...(e.filePath !== undefined ? { filePath: e.filePath } : {}),
          ts: e.ts,
        }));
      const res = await handoffGenerate(root, graphJson, JSON.stringify(events));
      if (!liveRef.current) return;
      setResult(res);
      setPhase("diff");
    })().catch((e: unknown) => {
      if (!liveRef.current) {
        // Abandoned wait (contract-sanctioned) — still leave a trace.
        console.error("handoff generate failed after close:", e);
        return;
      }
      setErrText(String(e));
      setPhase("failed");
    });
  };

  const doWrite = () => {
    if (result === null) return;
    setPhase("writing");
    setErrText(null);
    handoffWrite(root, result.content)
      .then(() => {
        if (liveRef.current) setPhase("written");
      })
      .catch((e: unknown) => {
        if (!liveRef.current) {
          // Unreachable via UI now (close is blocked while writing), but a
          // write failure must never vanish without a trace.
          console.error("handoff write failed after close:", e);
          return;
        }
        setErrText(String(e));
        setPhase("failed");
      });
  };

  const doCopy = (variant: (typeof COPY_VARIANTS)[number]) => {
    if (result === null) return;
    const text = variant.prefix + result.content;
    navigator.clipboard.writeText(text).then(
      () => {
        setClipFallback(null);
        setCopied(variant.id);
        window.setTimeout(() => setCopied((c) => (c === variant.id ? null : c)), 1200);
      },
      // WebView2 supports the async clipboard API, but permission failures
      // exist — fall back to a selectable textarea, never a plugin.
      () => setClipFallback(text),
    );
  };

  const showCopyRow =
    (phase === "diff" || phase === "writing" || phase === "written") && result !== null;
  const unchanged = result !== null && result.oldContent === result.content;

  if (proposeOpen) {
    return <HandoffNodeProposalModal root={root} onClose={() => setProposeOpen(false)} />;
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Handoff"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Handoff</span>
          <div className="min-w-0 flex-1" />
          <span
            className="min-w-0 max-w-[300px] truncate font-mono text-2xs text-content-muted"
            title={root}
          >
            {root}
          </span>
          <button
            onClick={onClose}
            disabled={!canClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent disabled:hover:text-content-disabled"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errText !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}

          {phase === "idle" || phase === "failed" ? (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-sm leading-relaxed text-content">
                Generate a <span className="font-mono text-xs">HANDOFF.md</span> for the next
                session: current state, decisions made, open threads and next actions — distilled
                from your context graph and recent agent activity.
              </p>
              <div className="border-t border-border-subtle pt-3">
                <p className="text-sm leading-relaxed text-content-secondary">
                  Or capture a single agent session&rsquo;s outcome as its own reviewable Memory
                  Node — deterministic, no <span className="font-mono text-xs">claude -p</span>{" "}
                  call.
                </p>
                <button
                  onClick={() => setProposeOpen(true)}
                  className={`${SECONDARY_BTN} mt-2`}
                >
                  Propose node from session…
                </button>
              </div>
            </div>
          ) : phase === "generating" ? (
            <PixelMarch caption="the cow is writing the handoff" />
          ) : result !== null ? (
            <>
              {result.oldContent === null ? (
                <ContentWell label="HANDOFF.md — new file" text={result.content} />
              ) : unchanged ? (
                <ContentWell label="HANDOFF.md — unchanged" text={result.content} />
              ) : (
                <>
                  <ContentWell label="current HANDOFF.md" text={result.oldContent} />
                  <ContentWell label="new HANDOFF.md" text={result.content} />
                </>
              )}
              {showCopyRow && (
                <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2">
                  {COPY_VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => doCopy(v)}
                      className={SECONDARY_BTN.replace("h-control ", "h-control-sm ")}
                    >
                      {copied === v.id ? (
                        <>
                          <Check size={13} strokeWidth={1.5} />
                          Copied
                        </>
                      ) : (
                        v.label
                      )}
                    </button>
                  ))}
                </div>
              )}
              {clipFallback !== null && (
                <div className="flex flex-col gap-1 border-b border-border-subtle px-4 py-2">
                  <span className="text-2xs text-content-muted">
                    Copy failed — select and copy manually
                  </span>
                  <textarea
                    readOnly
                    value={clipFallback}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-[120px] w-full resize-none rounded border border-border bg-surface-inset p-2 font-mono text-xs text-content-secondary outline-none"
                  />
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer — 50px */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          {phase === "idle" || phase === "failed" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Runs <span className="font-mono text-xs">claude -p</span> with your graph and
                recent activity.
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Cancel
              </button>
              <button
                onClick={doGenerate}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
              >
                {phase === "failed" ? "Retry" : "Generate handoff"}
              </button>
            </>
          ) : phase === "generating" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Generating… closing abandons the wait.
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Close
              </button>
            </>
          ) : phase === "written" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                wrote HANDOFF.md
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Close
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Writes <span className="font-mono text-xs">HANDOFF.md</span> at the project root.
              </span>
              <button onClick={onClose} disabled={phase === "writing"} className={SECONDARY_BTN}>
                Cancel
              </button>
              <button
                onClick={doWrite}
                disabled={phase === "writing"}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {phase === "writing" ? "· · ·" : "Write HANDOFF.md"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
