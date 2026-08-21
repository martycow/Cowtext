// Edge-kind picker — appears after a connection is drawn; the edge is
// created once a kind is chosen. v5 (WO13_CONTRACT.md §7, §21): 5 kinds,
// grouped by what a user actually cares about — does this change what lands
// in the compiled file, or is it linter-only. Every hint below is written
// from the FILE's point of view ("what ends up in the file"), one frame for
// all five, with a concrete micro-example rather than a definition
// (WO13 dispatch, "Edge UI (E-E)"). The old `overrides` caveat ("doesn't
// pull the target into context — only imports does that") is dropped: once
// `imports`/`references` carry their own honest description, the caveat
// added nothing a reader couldn't already tell from imports' own line.
//
// A guard (glob or plain-language condition) is legal on every kind except
// `contradicts` (§7.1) — the "+ guard" affordance on each row opens the same
// inline form the old `conditional` kind used to gate its whole existence
// behind; now it is an option on any row instead of a sixth kind.
//
// Draw-time legality (§7.3, E4): a row whose (source role, kind, target
// role) triple resolves to `deny` is disabled and shows the matching
// `EdgeRule.reason` in place of the hint — "do not let the user complete a
// deny edge and explain the mistake afterwards" reaches all the way into
// the picker, not just GraphCanvas's isValidConnection. `warn` rows stay
// clickable; the reason renders as a small amber note instead of blocking.

import { useState, type JSX } from "react";
import { isGlobCondition, useGraphStore, type EdgeKind } from "../store/graph";
import { affectsOutput } from "./edgeKind";
import { legalityFor } from "../config/edgeRules";
import { useGlobMatchCount } from "./globMatch";
import { GitBranch } from "lucide-react";

interface KindMeta {
  kind: EdgeKind;
  label: string;
  /** One sentence, file's-point-of-view: what ends up in the compiled
   *  output when this kind is used. */
  hint: string;
  /** A concrete instance — not a restatement of the definition. */
  example: string;
  sample: JSX.Element;
}

// Exhaustive by construction (Record<EdgeKind, ...>) — adding a sixth kind
// to the store is a compile error here until it gets a row.
const KIND_META: Record<EdgeKind, KindMeta> = {
  imports: {
    kind: "imports",
    label: "imports",
    hint: "Copies the target file's whole body into this one, every time.",
    example: 'e.g. "style.md" imports "base-rules.md" → base-rules.md\'s text is inlined into style.md\'s block.',
    sample: (
      <>
        <line x1="0" y1="4" x2="29" y2="4" stroke="var(--edge-imports)" strokeWidth="1.75" />
        <path d="M29 1 L34 4 L29 7 z" fill="var(--edge-imports)" />
      </>
    ),
  },
  references: {
    kind: "references",
    label: "references",
    hint: "Adds a “read when relevant” pointer — the target's own text stays out.",
    example: 'e.g. "deploy.md" references "rollback.md" → CLAUDE.md gets a bullet at rollback.md; nothing is copied in.',
    sample: (
      <>
        <line
          x1="0"
          y1="4"
          x2="27"
          y2="4"
          stroke="var(--edge-references)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <circle
          cx="31"
          cy="4"
          r="2.25"
          fill="var(--surface-canvas)"
          stroke="var(--edge-references)"
          strokeWidth="1.25"
        />
      </>
    ),
  },
  overrides: {
    kind: "overrides",
    label: "overrides",
    hint: "Both files stay inlined; this one's block leads with a generated precedence line.",
    example: 'e.g. "no-console-log.md" overrides "logging-style.md" → both compile in, and no-console-log.md starts with "Takes precedence over \\"Logging style\\" below."',
    sample: (
      <>
        <line x1="0" y1="4" x2="29" y2="4" stroke="var(--edge-overrides)" strokeWidth="2" />
        <path d="M29 1 L34 4 L29 7 z" fill="var(--edge-overrides)" />
        <rect x="33" y="1.5" width="1.5" height="5" fill="var(--edge-overrides)" />
      </>
    ),
  },
  sequence: {
    kind: "sequence",
    label: "sequence",
    hint: "Changes nothing but order — this file's block lands right after the target's.",
    example: 'e.g. "setup.md" sequence "verify.md" → verify.md\'s block follows setup.md\'s in the compiled file.',
    sample: (
      <>
        <line x1="0" y1="4" x2="28" y2="4" stroke="var(--edge-sequence)" strokeWidth="1.5" />
        <path d="M29 1 L34 4 L29 7" fill="none" stroke="var(--edge-sequence)" strokeWidth="1.5" />
      </>
    ),
  },
  contradicts: {
    kind: "contradicts",
    label: "contradicts",
    hint: "Writes nothing — the linter flags the pair, symmetric, never auto-resolved.",
    example: 'e.g. "use-rest.md" contradicts "use-graphql.md" → Problems lists it; the compiled file is unaffected either way.',
    sample: (
      <>
        <line
          x1="0"
          y1="4"
          x2="28"
          y2="4"
          stroke="var(--edge-contradicts)"
          strokeWidth="1.5"
          strokeDasharray="1.5 1.5"
        />
        <path
          d="M30.5 2 L33.5 6 M33.5 2 L30.5 6"
          stroke="var(--edge-contradicts)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
};

const ALL_KINDS: readonly EdgeKind[] = ["imports", "references", "overrides", "sequence", "contradicts"];
const STRUCTURAL_KINDS: KindMeta[] = ALL_KINDS.filter(affectsOutput).map((k) => KIND_META[k]);
const ADVISORY_KINDS: KindMeta[] = ALL_KINDS.filter((k) => !affectsOutput(k)).map((k) => KIND_META[k]);

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
        {structural ? "changes what lands in the file" : "linter only, never compiled"}
      </span>
    </div>
  );
}

export function KindPicker() {
  const pending = useGraphStore((s) => s.pending);
  const nodes = useGraphStore((s) => s.nodes);
  const confirmConnection = useGraphStore((s) => s.confirmConnection);
  const cancelConnection = useGraphStore((s) => s.cancelConnection);
  const [condition, setCondition] = useState("");
  const [guardKind, setGuardKind] = useState<EdgeKind | null>(null);
  // Fix-round (tester finding #5, edge spec E2): live match count against
  // the project's tracked files — see canvas/globMatch.ts for exactly what
  // this number does and does not mean. Called unconditionally (rules of
  // hooks); rendered only while a guard is actually being typed.
  const globMatch = useGlobMatchCount(condition);

  if (pending === null) return null;

  const sourceNode = nodes.find((n) => n.id === pending.source);
  const targetNode = nodes.find((n) => n.id === pending.target);

  const close = () => {
    setCondition("");
    setGuardKind(null);
    cancelConnection();
  };
  const pick = (kind: EdgeKind, guardText?: string) => {
    confirmConnection(kind, guardText !== undefined && guardText.trim() !== "" ? guardText.trim() : undefined);
    setCondition("");
    setGuardKind(null);
  };

  const row = (meta: KindMeta) => {
    const check =
      sourceNode !== undefined && targetNode !== undefined
        ? legalityFor(sourceNode.role, meta.kind, targetNode.role, targetNode.deprecated !== undefined)
        : { legality: "allow" as const, reason: "" };
    const denied = check.legality === "deny";
    return (
      <div key={meta.kind} className="flex items-start gap-1 px-1">
        <button
          onClick={() => {
            if (!denied) pick(meta.kind);
          }}
          disabled={denied}
          className={`flex w-full min-w-0 flex-1 items-start gap-2 rounded px-1 py-1.5 text-left transition-colors duration-instant ${
            denied ? "cursor-not-allowed opacity-40" : "hover:bg-[var(--surface-hover)]"
          }`}
        >
          <svg width="34" height="8" className="mt-1 flex-none" aria-hidden="true">
            {meta.sample}
          </svg>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-content">{meta.label}</span>
            <span className={`block text-xs leading-snug ${denied ? "text-danger-text" : "text-content-muted"}`}>
              {denied ? check.reason : meta.hint}
            </span>
            {!denied && (
              <span className="block text-2xs italic leading-snug text-content-disabled">{meta.example}</span>
            )}
            {!denied && check.legality === "warn" && (
              <span className="block text-2xs leading-snug text-amber-text">{check.reason}</span>
            )}
          </span>
        </button>
        {!denied && meta.kind !== "contradicts" && (
          <button
            type="button"
            onClick={() => setGuardKind(meta.kind)}
            title="Add a guard — only when a glob or plain-language condition matches"
            className="mt-1.5 flex-none text-content-disabled transition-colors duration-instant hover:text-content"
          >
            <GitBranch size={11} strokeWidth={1.5} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="absolute inset-0 z-canvas-ui grid place-items-center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[340px] rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown">
        <div className="px-2 py-1.5 font-mono text-2xs uppercase tracking-wider text-content-muted">
          Edge kind
        </div>
        <GroupHeader label="Structural" structural />
        {STRUCTURAL_KINDS.map(row)}
        <GroupHeader label="Advisory" structural={false} />
        {ADVISORY_KINDS.map(row)}
        {guardKind !== null && (
          <div className="px-2 py-1.5">
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                pick(guardKind, condition);
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
                {`Add ${guardKind} + guard`}
              </button>
            </form>
            {/* Live match count (edge spec E2, "so the user can tell a typo
                from a working pattern") — only for glob-shaped input; a
                plain-language description guard has no file count to show.
                "of `scanned`" is load-bearing, not decoration: it is the
                honest label that stops "0" from reading as "this project
                has no matches" when it may just mean "this glob describes
                source files, and the scan behind this count only tracks
                .md" — see globMatch.ts's own note before trusting this
                number for anything but typo-catching. */}
            {isGlobCondition(condition) && (
              <p className="mt-1 font-mono text-2xs leading-snug text-content-muted">
                {globMatch.invalid
                  ? " "
                  : `~matches ${globMatch.count} of ${globMatch.scanned} tracked files`}
              </p>
            )}
          </div>
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
