// Token-ceiling gauge (WO06_CONTRACT.md §5.5) — same idiom as RosterBar's
// ctx-window strip and AgentPanel's usage line: accent fill under ceiling,
// amber at >=80%, danger once the ceiling is actually reached/exceeded.
// Hidden entirely when there is no ceiling (0/null) — a hard-stop nobody
// configured must never paint as "0%".

import { formatTokenCount } from "../store/tokens";
import { budgetPct } from "./budget";

const WARN_PCT = 80;

/** Thin strip variant — RosterCard idiom (absolute bottom-of-card bar). */
export function BudgetStrip({
  tokensUsed,
  ceiling,
  stopped,
}: {
  tokensUsed: number;
  ceiling: number | null;
  stopped: boolean;
}) {
  const pct = budgetPct(tokensUsed, ceiling);
  if (pct === null) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-surface-1">
      <div
        className={`h-full ${stopped || pct >= 100 ? "bg-danger" : pct >= WARN_PCT ? "bg-amber" : "bg-accent"}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

/** Labeled bar variant — AgentPanel idiom (own row, used/ceiling text). */
export function BudgetBar({
  tokensUsed,
  ceiling,
  stopped,
}: {
  tokensUsed: number;
  ceiling: number | null;
  stopped: boolean;
}) {
  const pct = budgetPct(tokensUsed, ceiling);
  if (pct === null || ceiling === null) return null;
  const danger = stopped || pct >= 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs text-content-muted">token budget</span>
        <span
          className={`font-mono text-2xs ${danger ? "text-danger-text" : pct >= WARN_PCT ? "text-amber-text" : "text-content-secondary"}`}
        >
          {formatTokenCount(tokensUsed)} / {formatTokenCount(ceiling)}
        </span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-pill bg-surface-2">
        <div
          className={`h-full ${danger ? "bg-danger" : pct >= WARN_PCT ? "bg-amber" : "bg-accent"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
