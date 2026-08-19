// Edge-kind picker — appears after a connection is drawn; the edge is only
// created once a kind is chosen (conditional additionally wants a condition).
// v3 (WO03): 7 kinds, grouped into STRUCTURAL (imports/sequence/overrides —
// affects compile order, can form cycles) vs advisory/lint-only
// (references/conditional/supersedes/conflicts-with) — contract §"F —
// frontend": "a user must be able to tell at a glance which edges change
// their compiled output." The group headers carry that distinction; the
// samples mirror MemoryEdge.tsx's actual stroke/marker per kind exactly.

import { useState, type JSX } from "react";
import { useGraphStore, type EdgeKind } from "../store/graph";

interface KindMeta {
  kind: EdgeKind;
  label: string;
  hint: string;
  sample: JSX.Element;
}

const STRUCTURAL_KINDS: KindMeta[] = [
  {
    kind: "imports",
    label: "imports",
    hint: "hard include — compiled into the source, always in context",
    sample: <line x1="0" y1="4" x2="34" y2="4" stroke="var(--edge-imports)" strokeWidth="1.75" />,
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
  {
    kind: "overrides",
    label: "overrides",
    hint: "wins on conflict, doesn't pull the target into context — only imports does that",
    sample: (
      <>
        <line x1="0" y1="4" x2="29" y2="4" stroke="var(--edge-overrides)" strokeWidth="2" />
        <path d="M29 1 L34 4 L29 7 z" fill="var(--edge-overrides)" />
        <rect x="33" y="1.5" width="1.5" height="5" fill="var(--edge-overrides)" />
      </>
    ),
  },
];

const ADVISORY_KINDS: KindMeta[] = [
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
    kind: "supersedes",
    label: "supersedes",
    hint: "the target is out of date — this replaced it",
    sample: (
      <>
        <line
          x1="0"
          y1="4"
          x2="28"
          y2="4"
          stroke="var(--edge-supersedes)"
          strokeWidth="1.5"
          strokeDasharray="8 3"
        />
        <rect
          x="29.5"
          y="1.5"
          width="4"
          height="4"
          fill="var(--surface-canvas)"
          stroke="var(--edge-supersedes)"
          strokeWidth="1.5"
        />
      </>
    ),
  },
  {
    kind: "conflicts-with",
    label: "conflicts-with",
    hint: "the two disagree — flagged by the linter, never auto-resolved",
    sample: (
      <>
        <line
          x1="0"
          y1="4"
          x2="28"
          y2="4"
          stroke="var(--edge-conflicts-with)"
          strokeWidth="1.5"
          strokeDasharray="1.5 1.5"
        />
        <path
          d="M30.5 2 L33.5 6 M33.5 2 L30.5 6"
          stroke="var(--edge-conflicts-with)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
];

function GroupHeader({ label, structural }: { label: string; structural: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
      <span
        className={`h-1.5 w-1.5 flex-none rounded-pill ${structural ? "bg-content-secondary" : "bg-content-disabled"}`}
        aria-hidden
      />
      <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
        {label}
      </span>
      <span className="text-2xs text-content-disabled">
        {structural ? "changes compiled output" : "advisory only"}
      </span>
    </div>
  );
}

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

  const row = ({ kind, label, hint, sample }: KindMeta) => (
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
  );

  return (
    <div
      className="absolute inset-0 z-canvas-ui grid place-items-center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[320px] rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown">
        <div className="px-2 py-1.5 font-mono text-2xs uppercase tracking-wider text-content-muted">
          Edge kind
        </div>
        <GroupHeader label="Structural" structural />
        {STRUCTURAL_KINDS.map(row)}
        <GroupHeader label="Advisory" structural={false} />
        {ADVISORY_KINDS.map(row)}
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
