// Problems panel — collapsible bottom bar, same idiom as EventLog.tsx
// (header row always visible, body expands on click). Runs `lint_run`
// (WO03 Lane E, now wired into lib.rs's invoke_handler) on open, on every
// settled save, and on manual refresh; clicking a row selects the
// offending node/edge and asks the caller to switch to the canvas view.
//
// WO03 audit D7: the original catch mapped EVERY rejection — including a
// genuinely corrupt graph.json, the one situation this panel exists to
// surface — to a blanket "Lint isn't available in this build yet." That
// degrade was written before lint_run was wired; now that it is, the only
// legitimate "unavailable" case left is a real "command not found"
// rejection (still worth handling defensively — a future build could ship
// without the Rust binary rebuilt). Tauri's own wording for that, straight
// from tauri-2.11.5/src/webview/mod.rs's `run_invoke_handler` fallback, is
// exactly `Command {name} not found` — matched narrowly below. Everything
// else renders as a real error row.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ListChecks, RefreshCw } from "lucide-react";
import { useGraphStore } from "../store/graph";
import { useFocusStore } from "../canvas/types";
import { lintRun } from "../lint/api";
import { LINT_CODE_LABELS, type LintItem, type Severity } from "../lint/types";

// WO13 §11.2 — `Severity` gains a third member, `"info"`, once R2 lands the
// extended lint set. Ranked rather than hardcoded to exactly the two values
// this file could see before that lands: an unranked severity (a future
// fourth member) still sorts, just last, instead of a compile error.
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

function severityClasses(sev: Severity): string {
  return sev === "error"
    ? "border-danger bg-danger-surface text-danger-text"
    : String(sev) === "info"
      ? "border-accent-border bg-accent-surface text-accent-text"
      : "border-amber-border bg-amber-surface text-amber-text";
}

/** Narrow match on Tauri's own "unregistered command" wording — anything
 *  else (a bad graph.json, an unreadable root, ...) is a real error. */
function isCommandNotFound(e: unknown): boolean {
  return /^Command \S+ not found$/.test(String(e));
}

function ProblemRow({ item, onNavigate }: { item: LintItem; onNavigate: (item: LintItem) => void }) {
  const nodes = useGraphStore((s) => s.nodes);
  const titles = (item.nodeIds ?? [])
    .map((id) => nodes.find((n) => n.id === id)?.title)
    .filter((t): t is string => t !== undefined);
  const navigable = (item.nodeIds !== undefined && item.nodeIds.length > 0)
    || (item.edgeIds !== undefined && item.edgeIds.length > 0);

  return (
    <li
      onClick={navigable ? () => onNavigate(item) : undefined}
      className={`flex items-start gap-2 border-b border-border-subtle px-3 py-1.5 ${
        navigable ? "cursor-default hover:bg-[var(--surface-hover)]" : ""
      }`}
    >
      <span
        className={`mt-px inline-flex h-[17px] flex-none items-center rounded-sm border px-1 font-mono text-micro ${severityClasses(item.severity)}`}
      >
        {LINT_CODE_LABELS[item.code]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs leading-snug text-content-secondary">
          {item.message}
        </span>
        {titles.length > 0 && (
          <span className="block truncate font-mono text-2xs text-content-muted">
            {titles.join(" · ")}
          </span>
        )}
      </span>
    </li>
  );
}

type Status = "idle" | "loading" | "ready" | "unavailable" | "error";

export function ProblemsPanel({ root, onNavigate }: { root: string; onNavigate: () => void }) {
  const [collapsed, setCollapsed] = useState(true);
  const [items, setItems] = useState<LintItem[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errText, setErrText] = useState<string | null>(null);
  // WO13 §11 — filter-by-severity. `null` = show every severity; clicking
  // an active badge again clears the filter rather than requiring a
  // separate "all" control.
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  const saveState = useGraphStore((s) => s.saveState);
  const setSelection = useGraphStore((s) => s.setSelection);
  const edgesList = useGraphStore((s) => s.edges);
  const requestFocus = useFocusStore((s) => s.requestFocus);

  const refresh = () => {
    setStatus("loading");
    setErrText(null);
    lintRun(root)
      .then((p) => {
        setItems(p.items);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        setItems([]);
        if (isCommandNotFound(e)) {
          setStatus("unavailable");
        } else {
          // A real failure (e.g. corrupt graph.json) — surface it, don't
          // hide it behind "not available" (WO03 audit D7).
          setErrText(String(e));
          setStatus("error");
        }
      });
  };

  // Refresh on mount/project switch, and once per settled save (debounced
  // graph edits land in graph.json, which is what lint_run actually reads).
  // refresh isn't stable (closes over nothing that changes per-root, but is
  // redefined every render) — only re-run on the actual triggers, not on
  // every render.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  useEffect(() => {
    if (saveState === "saved") refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  // Every severity actually present, ranked error → warning → info (and
  // anything unranked sorts last rather than erroring — see SEVERITY_RANK).
  const severities = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.severity))).sort(
        (a, b) => (SEVERITY_RANK[a] ?? 99) - (SEVERITY_RANK[b] ?? 99),
      ),
    [items],
  );
  const countBySeverity = useMemo(() => {
    const counts: Partial<Record<Severity, number>> = {};
    for (const i of items) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
    return counts;
  }, [items]);
  const visibleItems =
    severityFilter === null ? items : items.filter((i) => i.severity === severityFilter);

  const navigate = (item: LintItem) => {
    setSelection(item.nodeIds ?? [], item.edgeIds ?? []);
    // Prefer a node id (the common case); fall back to the first flagged
    // edge's source so an edge-only diagnostic (e.g. `contradicts`,
    // `edge-legality-warning`) still pans the canvas somewhere.
    const focusId = item.nodeIds?.[0] ?? edgesList.find((e) => e.id === item.edgeIds?.[0])?.source;
    if (focusId !== undefined) requestFocus(focusId);
    onNavigate();
  };

  return (
    <div className="flex-none border-t border-border-subtle bg-surface-1">
      <div
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-[31px] flex-none cursor-default items-center gap-2 px-3 hover:bg-[var(--surface-hover)]"
        title={collapsed ? "Show problems" : "Hide problems"}
      >
        <ListChecks size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
          Problems
        </span>
        {status === "unavailable" ? (
          <span className="font-mono text-2xs text-content-disabled">unavailable</span>
        ) : status === "error" ? (
          <span className="inline-flex h-[17px] items-center rounded-sm border border-danger bg-danger-surface px-1 font-mono text-micro text-danger-text">
            error
          </span>
        ) : (
          <>
            {severities.map((sev) => (
              <button
                key={sev}
                onClick={(e) => {
                  e.stopPropagation();
                  setSeverityFilter((cur) => (cur === sev ? null : sev));
                }}
                title={`Show only ${sev}`}
                aria-pressed={severityFilter === sev}
                className={`inline-flex h-[17px] items-center rounded-sm border px-1 font-mono text-micro transition-opacity duration-fast ${severityClasses(sev)} ${
                  severityFilter !== null && severityFilter !== sev ? "opacity-40" : ""
                }`}
              >
                {countBySeverity[sev] ?? 0}
              </button>
            ))}
            {status === "ready" && items.length === 0 && (
              <span className="font-mono text-2xs text-content-disabled">none</span>
            )}
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            refresh();
          }}
          title="Re-run lint"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <RefreshCw size={12} strokeWidth={1.5} className={status === "loading" ? "animate-spin" : undefined} />
        </button>
        {collapsed ? (
          <ChevronUp size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
        ) : (
          <ChevronDown size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
        )}
      </div>
      {!collapsed && (
        <ul className="max-h-[168px] flex-none overflow-y-auto">
          {status === "unavailable" && (
            <li className="px-3 py-2 text-xs text-content-muted">
              Lint isn't available in this build yet.
            </li>
          )}
          {status === "error" && errText !== null && (
            <li className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </li>
          )}
          {status === "ready" && items.length === 0 && (
            <li className="px-3 py-2 text-xs text-content-muted">No problems found.</li>
          )}
          {status === "ready" && items.length > 0 && visibleItems.length === 0 && (
            <li className="px-3 py-2 text-xs text-content-muted">
              No {severityFilter} problems — {items.length} hidden by the filter.
            </li>
          )}
          {visibleItems.map((item, i) => (
            <ProblemRow key={i} item={item} onNavigate={navigate} />
          ))}
        </ul>
      )}
    </div>
  );
}
