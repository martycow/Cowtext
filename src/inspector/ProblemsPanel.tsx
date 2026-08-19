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
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ListChecks, RefreshCw } from "lucide-react";
import { useGraphStore } from "../store/graph";
import { lintRun } from "../lint/api";
import { LINT_CODE_LABELS, type LintItem, type Severity } from "../lint/types";

function severityClasses(sev: Severity): string {
  return sev === "error"
    ? "border-danger bg-danger-surface text-danger-text"
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
  const saveState = useGraphStore((s) => s.saveState);
  const setSelection = useGraphStore((s) => s.setSelection);

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

  const errorCount = items.filter((i) => i.severity === "error").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;

  const navigate = (item: LintItem) => {
    setSelection(item.nodeIds ?? [], item.edgeIds ?? []);
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
            {errorCount > 0 && (
              <span className="inline-flex h-[17px] items-center rounded-sm border border-danger bg-danger-surface px-1 font-mono text-micro text-danger-text">
                {errorCount}
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex h-[17px] items-center rounded-sm border border-amber-border bg-amber-surface px-1 font-mono text-micro text-amber-text">
                {warningCount}
              </span>
            )}
            {status === "ready" && errorCount === 0 && warningCount === 0 && (
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
          {items.map((item, i) => (
            <ProblemRow key={i} item={item} onNavigate={navigate} />
          ))}
        </ul>
      )}
    </div>
  );
}
