// Roster bar — bottom strip of live agent-session cards (WO01 Block F §8.1).
// One card per session: avatar seeded on session.name (same seed the barn
// calf uses, so the two always match), name, status dot, current tool while
// working. A distinct lifecycle from EventLog's hook/telemetry feed — never
// merged into it.

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { AgentAvatar } from "../agents/AgentAvatar";
import { selectReducedMotion, useSettingsStore } from "../store/settings";
import { MAX_SESSIONS, useSessionsStore, type Session, type SessionStatus } from "../store/sessions";
import { ctxPercent } from "../store/tokens";
import { AddAgentDialog } from "./AddAgentDialog";

/** N5: amber at/above 80% of the 200k window — static amber = warning,
 *  never mixed with the accent fill below it. */
const CTX_WARN_PCT = 80;

// "Blue is you, amber is the cow": waiting wants the human back (accent
// blue), working is the agent doing live work (amber), idle is neutral.
const STATUS_DOT: Record<SessionStatus, string> = {
  idle: "bg-content-muted",
  working: "bg-amber",
  waiting: "bg-accent",
};

function StatusDot({ status, reducedMotion }: { status: SessionStatus; reducedMotion: boolean }) {
  const pulse = status === "working" && !reducedMotion;
  return (
    <span
      className={`h-1.5 w-1.5 flex-none rounded-pill ${STATUS_DOT[status]} ${pulse ? "animate-blink" : ""}`}
      style={pulse ? { animationTimingFunction: "steps(2)" } : undefined}
      title={status}
    />
  );
}

/** Same clickable-div + nested-button idiom as FileRow/RecentProjectRow —
 *  the card is a plain click target, the dismiss X is the only real button. */
function RosterCard({
  session,
  selected,
  reducedMotion,
}: {
  session: Session;
  selected: boolean;
  reducedMotion: boolean;
}) {
  const selectSession = useSessionsStore((s) => s.selectSession);
  const dismiss = useSessionsStore((s) => s.dismiss);
  const pct = ctxPercent(session.usage.totalTokens);
  return (
    <div
      onClick={() => selectSession(session.id)}
      title={`${session.name} — ${session.status}${
        session.currentTool !== null ? `: ${session.currentTool}` : ""
      }${session.usage.turns > 0 ? ` · ${pct}% of ctx` : ""}`}
      className={`relative flex h-[30px] w-[172px] flex-none cursor-default items-center gap-1.5 overflow-hidden rounded border px-1.5 transition-colors duration-fast ${
        selected ? "border-accent-border bg-accent-surface" : "border-border bg-surface-2 hover:border-border-strong"
      } ${!session.alive ? "opacity-60" : ""}`}
    >
      <AgentAvatar seed={session.name} size={11} />
      <span className="min-w-0 flex-1 truncate text-xs text-content">{session.name}</span>
      {session.alive ? (
        <>
          {session.status === "working" && session.currentTool !== null && (
            <span className="min-w-0 max-w-[56px] flex-none truncate font-mono text-micro text-content-muted">
              {session.currentTool}
            </span>
          )}
          <StatusDot status={session.status} reducedMotion={reducedMotion} />
        </>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            dismiss(session.id);
          }}
          title="Dismiss"
          className="grid h-4 w-4 flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <X size={11} strokeWidth={1.5} />
        </button>
      )}
      {/* N5 ctx bar — thin strip under the status dot, accent fill, amber
          once the session is heavy in its context window. */}
      {session.alive && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-surface-1">
          <div
            className={`h-full ${pct >= CTX_WARN_PCT ? "bg-amber" : "bg-accent"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function RosterBar({ root }: { root: string }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const reducedMotion = useSettingsStore(selectReducedMotion);
  const [addOpen, setAddOpen] = useState(false);
  const aliveCount = sessions.filter((s) => s.alive).length;
  const atCap = aliveCount >= MAX_SESSIONS;

  return (
    <div className="flex h-[38px] flex-none items-center gap-2 border-t border-border-subtle bg-surface-1 px-3">
      <button
        onClick={() => setAddOpen(true)}
        disabled={atCap}
        title={atCap ? `agent limit reached (${MAX_SESSIONS})` : "Add agent"}
        className="flex h-control-sm flex-none items-center gap-1 rounded border border-border bg-surface-2 px-2 font-mono text-2xs text-content-secondary transition-colors duration-fast hover:border-accent-border hover:text-accent-text disabled:text-content-disabled disabled:hover:border-border disabled:hover:text-content-secondary"
      >
        <Plus size={12} strokeWidth={1.5} />
        Add agent
      </button>
      {sessions.length === 0 ? (
        <span className="font-mono text-2xs text-content-disabled">no agents running</span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {sessions.map((s) => (
            <RosterCard key={s.id} session={s} selected={s.id === selectedId} reducedMotion={reducedMotion} />
          ))}
        </div>
      )}
      {addOpen && <AddAgentDialog root={root} onClose={() => setAddOpen(false)} />}
    </div>
  );
}
