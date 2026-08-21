// Dock — unified bottom panel (WO14 declutter). Replaces four stacked
// strips (RosterBar, ProblemsPanel, EventLog, StatusBar) with one dock: a
// single always-visible header (tabs with badge counts, agent presence
// chips, the old status-bar node/edge/review counts, and a collapse
// chevron) plus one body area that shows whichever tab is active.
//
// All three tab contents stay mounted at all times — hidden via CSS, same
// idiom App.tsx already uses to keep GraphCanvas/BarnScene alive under a
// view toggle — so polling/effects (lint refresh, the event feed, hooks
// status) never reset just because the dock is collapsed or another tab is
// showing, and the Problems/Agents badge counts stay accurate even hidden.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useGraphStore } from "../store/graph";
import { useReviewStore } from "../store/review";
import { useSessionsStore } from "../store/sessions";
import { AgentAvatar } from "../agents/AgentAvatar";
import { RosterBar } from "../sessions/RosterBar";
import { ProblemsPanel } from "../inspector/ProblemsPanel";
import { EventLog } from "../inspector/EventLog";

type DockTab = "agents" | "problems" | "activity";

const TAB_LABEL: Record<DockTab, string> = {
  agents: "Agents",
  problems: "Problems",
  activity: "Activity",
};

function Badge({ n, danger }: { n: number; danger: boolean }) {
  return (
    <span
      className={`inline-flex h-[15px] min-w-[15px] flex-none items-center justify-center rounded-pill px-1 font-mono text-[9.5px] ${
        danger ? "bg-danger-surface text-danger-text" : "bg-surface-2 text-content-muted"
      }`}
    >
      {n}
    </span>
  );
}

/** Up to 4 avatar chips for live sessions, glanceable even while the dock
 *  is collapsed — the compensation for Agents cards no longer being always
 *  on screen the way RosterBar used to render them. */
function Presence() {
  const sessions = useSessionsStore((s) => s.sessions);
  const alive = sessions.filter((x) => x.alive);
  if (alive.length === 0) return null;
  const shown = alive.slice(0, 4);
  const overflow = alive.length - shown.length;
  return (
    <div className="flex flex-none items-center pl-1">
      {shown.map((s) => (
        <span
          key={s.id}
          title={s.name}
          className="-ml-1 grid h-[18px] w-[18px] flex-none place-items-center rounded-pill border-2 border-surface-1 bg-surface-2"
        >
          <AgentAvatar seed={s.name} size={12} />
        </span>
      ))}
      {overflow > 0 && (
        <span className="-ml-1 grid h-[18px] w-[18px] flex-none place-items-center rounded-pill border-2 border-surface-1 bg-surface-3 font-mono text-[8px] text-content-muted">
          +{overflow}
        </span>
      )}
    </div>
  );
}

export function Dock({ root, onNavigate }: { root: string; onNavigate: () => void }) {
  const [tab, setTab] = useState<DockTab>("agents");
  const [expanded, setExpanded] = useState(false);
  const [problems, setProblems] = useState<{ n: number; hasError: boolean }>({
    n: 0,
    hasError: false,
  });

  const sessionCount = useSessionsStore((s) => s.sessions.length);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const edgeCount = useGraphStore((s) => s.edges.length);
  const changedCount = useReviewStore((s) => s.externalChangeCount);
  const toReviewCount = useReviewStore((s) => s.queue.length);

  // A click on the already-active tab just toggles the dock; a click on a
  // different tab always expands to it — never a silent tab switch behind
  // a collapsed dock.
  const pick = (t: DockTab) => {
    if (t === tab) {
      setExpanded((e) => !e);
      return;
    }
    setTab(t);
    setExpanded(true);
  };

  return (
    <div className="flex flex-none flex-col border-t border-border-subtle bg-surface-1">
      <div className="flex h-control flex-none items-center gap-1 px-3">
        {(["agents", "problems", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => pick(t)}
            aria-pressed={tab === t && expanded}
            className={`flex h-control-sm flex-none items-center gap-1.5 rounded px-2 text-sm transition-colors duration-fast ${
              tab === t && expanded
                ? "bg-surface-3 text-content"
                : "text-content-muted hover:text-content-secondary"
            }`}
          >
            {TAB_LABEL[t]}
            {t === "agents" && sessionCount > 0 && <Badge n={sessionCount} danger={false} />}
            {t === "problems" && problems.n > 0 && (
              <Badge n={problems.n} danger={problems.hasError} />
            )}
          </button>
        ))}
        <Presence />
        <div className="flex-1" />
        <span className="hidden font-mono text-micro text-content-muted md:inline">
          {nodeCount} node{nodeCount === 1 ? "" : "s"} · {edgeCount} edge{edgeCount === 1 ? "" : "s"} ·{" "}
          {changedCount} changed on disk · {toReviewCount} to review
        </span>
        <button
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse" : "Expand"}
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          {expanded ? (
            <ChevronDown size={13} strokeWidth={1.5} />
          ) : (
            <ChevronUp size={13} strokeWidth={1.5} />
          )}
        </button>
      </div>

      <div
        className={
          expanded ? "flex h-[220px] flex-none flex-col border-t border-border-subtle" : "hidden"
        }
      >
        <div className={tab === "agents" ? "flex-none overflow-x-auto" : "hidden"}>
          <RosterBar />
        </div>
        <div className={tab === "problems" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <ProblemsPanel
            root={root}
            onNavigate={onNavigate}
            onCountChange={(n, hasError) => setProblems({ n, hasError })}
          />
        </div>
        <div className={tab === "activity" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <EventLog root={root} />
        </div>
      </div>
    </div>
  );
}
