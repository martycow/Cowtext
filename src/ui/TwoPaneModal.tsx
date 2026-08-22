// Shared two-pane modal shell (WO13_CONTRACT.md §14.1) — U1's FIRST
// deliverable. There is no shared modal shell in the repo today (21 files
// render `z-modal` independently); this is the one, and the agent modal
// (U3, `src/tasks/NewAgentDialog.tsx` / `src/agents/AgentEditor.tsx`) is the
// frozen consumer. Props here are FROZEN — do not add/remove/rename without
// a contract amendment, both lanes build against this signature in parallel.
//
// Left pane = where the user works. Right pane = what it will actually
// produce (owned by `PreviewPane.tsx`, mounted by the caller into `right`).
// Below 1024px the two stack and the right pane collapses into a closed-by
// -default "Preview" disclosure directly above the footer — no duplicate
// mount, one `right` node, CSS/JS decide where it lands (see `useIsNarrow`).

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

/** Below this viewport width the two panes stack (WO13_CONTRACT.md §14.1).
 *  Matches Tailwind's `lg` breakpoint used nowhere else in this file —
 *  kept as a plain number so the behavior doesn't depend on Tailwind's
 *  config being read at runtime. */
const STACK_BELOW_PX = 1024;

function useIsNarrow(breakpointPx: number): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpointPx,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpointPx]);
  return narrow;
}

function StepRail({
  steps,
  currentStep,
  onStep,
}: {
  steps: { n: number; label: string }[];
  currentStep: number;
  onStep: (n: number) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-1.5 overflow-hidden">
      {steps.map((s, i) => (
        <div key={s.n} className="flex flex-none items-center gap-1.5">
          {i > 0 && <span className="h-px w-4 flex-none bg-border" aria-hidden="true" />}
          <button
            type="button"
            onClick={() => onStep(s.n)}
            title={s.label}
            aria-current={s.n === currentStep ? "step" : undefined}
            className="flex items-center gap-1.5"
          >
            <span
              className={`grid h-4 w-4 flex-none place-items-center rounded-pill border font-mono text-micro ${
                s.n === currentStep
                  ? "border-accent bg-accent text-content-inverse"
                  : s.n < currentStep
                    ? "border-accent-border bg-accent-surface text-accent-text"
                    : "border-border bg-surface-2 text-content-disabled"
              }`}
            >
              {s.n}
            </span>
            <span
              className={`hidden font-mono text-2xs sm:inline ${
                s.n === currentStep ? "text-content" : "text-content-muted"
              }`}
            >
              {s.label}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

export interface TwoPaneModalProps {
  title: string;
  /** Absent ⇒ no step rail (the agent modal has none). */
  steps?: { n: number; label: string }[];
  currentStep?: number;
  onStep?: (n: number) => void;
  /** Expand / download buttons — anything besides the step rail and the
   *  shell's own close (✕), which this component renders itself. */
  headerExtras?: React.ReactNode;
  onClose: () => void;
  left: React.ReactNode;
  right: React.ReactNode;
  /** The promise line, rendered verbatim — never reworded by a consumer. */
  footerNote: string;
  /** Back / Next / Confirm, supplied by the caller. */
  footer: React.ReactNode;
  previewLabel?: string;
}

export function TwoPaneModal({
  title,
  steps,
  currentStep,
  onStep,
  headerExtras,
  onClose,
  left,
  right,
  footerNote,
  footer,
  previewLabel = "Preview",
}: TwoPaneModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(STACK_BELOW_PX);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewId = useId();

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasSteps = steps !== undefined && steps.length > 0 && currentStep !== undefined;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          // The vw/vh halves are divided by `--ui-scale` in place, following
          // the convention `tokens.css` documents (rule 4) and `index.css`
          // applies to every `max-h-[Nvh]` utility: inside a `zoom`ed chrome
          // container a viewport unit still resolves against the UNSCALED
          // viewport and is then multiplied by the zoom, so at 130 % a plain
          // `88vh` panel is ~114 vh tall and its footer sits below the fold.
          // A stylesheet rule cannot reach an inline style, so this
          // declaration has to carry the correction itself.
          width: "min(1180px, calc(92vw / var(--ui-scale)))",
          height: "min(760px, calc(88vh / var(--ui-scale)))",
        }}
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="flex-none text-[15px] font-semibold">{title}</span>
          {hasSteps && (
            <StepRail
              steps={steps}
              currentStep={currentStep}
              onStep={(n) => onStep?.(n)}
            />
          )}
          {!hasSteps && <span className="flex-1" />}
          {headerExtras}
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body — two panes, hairline divider, independent scroll */}
        {narrow ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="min-h-0 flex-1 p-4">{left}</div>
            <div className="flex-none border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                aria-expanded={previewOpen}
                aria-controls={previewId}
                className="flex h-row w-full flex-none items-center gap-1.5 px-4 font-mono text-2xs uppercase tracking-wider text-content-muted"
              >
                {previewOpen ? (
                  <ChevronDown size={13} strokeWidth={1.5} />
                ) : (
                  <ChevronRight size={13} strokeWidth={1.5} />
                )}
                {previewLabel}
              </button>
              {previewOpen && (
                <div id={previewId} aria-live="polite" className="max-h-[40vh] overflow-y-auto px-4 pb-3">
                  {right}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 w-[58%] overflow-y-auto p-4">{left}</div>
            <div
              aria-live="polite"
              className="min-h-0 w-[42%] overflow-y-auto border-l border-border-subtle p-4"
            >
              {right}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">{footerNote}</span>
          {footer}
        </div>
      </div>
    </div>
  );
}
