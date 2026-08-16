// Edge-kind picker — appears after a connection is drawn; the edge is only
// created once a kind is chosen (conditional additionally wants a condition).

import { useState, type JSX } from "react";
import { useGraphStore, type EdgeKind } from "../store/graph";

const KINDS: { kind: EdgeKind; label: string; hint: string; sample: JSX.Element }[] = [
  {
    kind: "imports",
    label: "imports",
    hint: "hard include — compiled into the source, always in context",
    sample: <line x1="0" y1="4" x2="34" y2="4" stroke="var(--edge-imports)" strokeWidth="1.75" />,
  },
  {
    kind: "references",
    label: "references",
    hint: "soft — “see this when relevant”, read on demand",
    sample: (
      <line
        x1="0"
        y1="4"
        x2="34"
        y2="4"
        stroke="var(--edge-references)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
    ),
  },
  {
    kind: "conditional",
    label: "conditional",
    hint: "only when the condition matches (glob or plain language)",
    sample: (
      <line
        x1="0"
        y1="4"
        x2="34"
        y2="4"
        stroke="var(--edge-conditional)"
        strokeWidth="1.5"
        strokeDasharray="1.5 3.5"
      />
    ),
  },
  {
    kind: "sequence",
    label: "sequence",
    hint: "pure ordering — target is read after source",
    sample: (
      <>
        <line x1="0" y1="4" x2="28" y2="4" stroke="var(--edge-sequence)" strokeWidth="1.5" />
        <path d="M29 1 L34 4 L29 7" fill="none" stroke="var(--edge-sequence)" strokeWidth="1.5" />
      </>
    ),
  },
];

export function KindPicker() {
  const pending = useGraphStore((s) => s.pending);
  const confirmConnection = useGraphStore((s) => s.confirmConnection);
  const cancelConnection = useGraphStore((s) => s.cancelConnection);
  const [condition, setCondition] = useState("");
  const [askCondition, setAskCondition] = useState(false);

  if (pending === null) return null;

  const close = () => {
    setCondition("");
    setAskCondition(false);
    cancelConnection();
  };
  const pick = (kind: EdgeKind) => {
    if (kind === "conditional" && !askCondition) {
      setAskCondition(true);
      return;
    }
    confirmConnection(kind, condition.trim() === "" ? undefined : condition.trim());
    setCondition("");
    setAskCondition(false);
  };

  return (
    <div
      className="absolute inset-0 z-canvas-ui grid place-items-center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[300px] rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown">
        <div className="px-2 py-1.5 font-mono text-2xs uppercase tracking-wider text-content-muted">
          Edge kind
        </div>
        {KINDS.map(({ kind, label, hint, sample }) => (
          <button
            key={kind}
            onClick={() => pick(kind)}
            className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
          >
            <svg width="34" height="8" className="mt-1 flex-none" aria-hidden="true">
              {sample}
            </svg>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-content">{label}</span>
              <span className="block text-xs leading-snug text-content-muted">{hint}</span>
            </span>
          </button>
        ))}
        {askCondition && (
          <form
            className="flex items-center gap-1 px-2 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              pick("conditional");
            }}
          >
            <input
              autoFocus
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="src/net/** or plain language"
              className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent"
            />
            <button
              type="submit"
              className="h-control-sm flex-none rounded bg-accent px-2 text-xs font-semibold text-content-inverse hover:bg-accent-hover"
            >
              Add
            </button>
          </form>
        )}
        <div className="flex justify-end border-t border-border-subtle px-2 py-1">
          <button
            onClick={close}
            className="rounded px-2 py-0.5 text-xs text-content-muted hover:bg-[var(--surface-hover)] hover:text-content"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
