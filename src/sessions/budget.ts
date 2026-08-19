// Pure budget-percent math, split out of BudgetGauge.tsx so that file stays
// components-only (react-refresh/only-export-components).

export function budgetPct(tokensUsed: number, ceiling: number | null): number | null {
  if (ceiling === null || ceiling <= 0) return null;
  return Math.round((tokensUsed / ceiling) * 100);
}
