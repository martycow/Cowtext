// The "local only" badge (WO15 §4.12, §7.5) — the visible half of the rule
// that every control in a modal or panel either shows up in the compiled
// preview or says out loud that it does not. Marking one field and leaving
// its neighbour unmarked is worse than no badge at all, so this component
// (and nowhere else) owns both the text and the styling.
//
// Markup and classes are `AgentEditor.tsx`'s original badge, lifted so
// non-agent surfaces (Position, Influence, the token-ceiling input, a
// non-Anthropic provider's model field) can carry the same mark. Callers
// with a more specific truth pass their own `hint`.

export const LOCAL_ONLY_DEFAULT_HINT = "Stays on this machine — never compiled into agent files.";

export function LocalOnlyBadge({ hint = LOCAL_ONLY_DEFAULT_HINT }: { hint?: string }) {
  return (
    <span
      title={hint}
      className="flex-none rounded-sm border border-border-strong bg-surface-2 px-1 font-mono text-micro uppercase tracking-wider text-content-muted"
    >
      local only
    </span>
  );
}
