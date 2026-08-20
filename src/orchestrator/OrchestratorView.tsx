// Agent Orchestrator — the fleet view (INPUT_PROMPT 08/19 item 11).
//
// Scope is deliberately NOT "another agent editor". Three surfaces already
// own agent state and this one takes only what none of them had:
//   AgentEditor (rail)  — the DEFINITION: name, model, tools, skills, body,
//                         plus nickname/priority/influence. Unchanged.
//   RosterBar (bottom)  — live sessions as a strip, one line each.
//   AddAgentDialog      — a one-off spawn; every field re-picked each time.
// The orchestrator is the FLEET: every defined agent side by side, the two
// per-agent orchestration settings that previously existed nowhere (default
// workspace, default token ceiling), and spawn/kill against them. Definition
// fields render read-only here and stay editable in the rail — one writer per
// field, so the two views can never disagree.
//
// This is app chrome, not canvas: it uses the --surface-* ramp and the normal
// radius scale. The Barn plate language is scoped to src/canvas/** by the
// carve-out in DESIGN_SPEC.md and deliberately does not leak here.

import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FolderOpen, Play, RotateCw, Square, X } from "lucide-react";
import { AgentAvatar } from "../agents/AgentAvatar";
import { agentMemoryStatus, type AgentMemoryStatus } from "../agents/api";
import { metaOrDefault, seedFor, useAgentsStore, PRODUCER_FILE } from "../store/agents";
import { useSessionsStore, type Session, type SessionStatus } from "../store/sessions";
import { budgetPct } from "../sessions/budget";
import { agentContextTokens, ctxPercent } from "../store/tokens";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import type { AgentDoc } from "../agents/types";

const STATUS_DOT: Record<SessionStatus, string> = {
  idle: "bg-content-muted",
  working: "bg-amber",
  waiting: "bg-accent",
};

function agentLabel(doc: AgentDoc, nickname: string): string {
  if (nickname.trim() !== "") return nickname;
  const named = doc.fields.name?.trim();
  if (named !== undefined && named !== "") return named;
  return doc.fileName.replace(/\.md$/i, "");
}

function formatCeiling(v: number | null): string {
  if (v === null) return "inherit";
  if (v === 0) return "unbounded";
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
}

/** Rows are keyed by agent FILE, not by session: an agent with no live
 *  session still has settings worth editing, which is the whole gap this
 *  view closes. */
function FleetRow({
  doc,
  selected,
  onSelect,
  sessions,
}: {
  doc: AgentDoc;
  selected: boolean;
  onSelect: () => void;
  sessions: Session[];
}) {
  const meta = useAgentsStore((s) => metaOrDefault(s.meta, doc.fileName));
  const seed = useAgentsStore((s) => seedFor(s.meta, doc.fileName));
  const avatarSrc = useAgentsStore((s) => s.avatars[doc.fileName] ?? null);
  const loadAvatar = useAgentsStore((s) => s.loadAvatar);
  useEffect(() => {
    void loadAvatar(doc.fileName);
  }, [doc.fileName, loadAvatar]);
  const live = sessions.filter((s) => s.alive);
  const busiest = live.find((s) => s.status === "working") ?? live[0];
  return (
    <div
      onClick={onSelect}
      title={doc.fileName}
      className={`flex h-row-comfy cursor-default items-center gap-2 border-l-2 px-3 transition-colors duration-fast ${
        selected
          ? "border-l-accent bg-accent-surface"
          : "border-l-transparent hover:bg-[var(--surface-hover)]"
      }`}
    >
      <AgentAvatar seed={seed} size={22} src={avatarSrc} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-content">{agentLabel(doc, meta.nickname)}</span>
        <span className="truncate font-mono text-micro text-content-muted">
          {doc.fields.model ?? "inherit"}
        </span>
      </div>
      <span
        className="flex-none rounded-sm border border-border px-1 py-px font-mono text-micro text-content-muted"
        title={`priority ${meta.priority}`}
      >
        P{meta.priority}
      </span>
      {busiest !== undefined ? (
        <span className={`h-1.5 w-1.5 flex-none rounded-pill ${STATUS_DOT[busiest.status]}`} title={busiest.status} />
      ) : (
        <span className="h-1.5 w-1.5 flex-none rounded-pill bg-surface-3" title="no live session" />
      )}
      <span className="w-4 flex-none text-right font-mono text-micro text-content-muted">
        {live.length > 0 ? live.length : ""}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border-subtle px-4 py-3">
      <h3 className="mb-2 font-mono text-2xs uppercase tracking-wider text-content-muted">{title}</h3>
      {children}
    </section>
  );
}

function SessionRow({ session }: { session: Session }) {
  const kill = useSessionsStore((s) => s.kill);
  const restart = useSessionsStore((s) => s.restart);
  const dismiss = useSessionsStore((s) => s.dismiss);
  const busy = useSessionsStore((s) => s.busy);
  const bpct = budgetPct(session.tokensUsed, session.tokenCeiling);
  const cpct = ctxPercent(session.usage.totalTokens);
  return (
    <div className="flex h-row items-center gap-2 border-t border-border-subtle first:border-t-0">
      <span className={`h-1.5 w-1.5 flex-none rounded-pill ${STATUS_DOT[session.status]}`} />
      <span className="min-w-0 flex-1 truncate text-sm text-content">{session.name}</span>
      {session.currentTool !== null && (
        <span className="flex-none truncate font-mono text-micro text-content-muted">
          {session.currentTool}
        </span>
      )}
      <span className="flex-none font-mono text-micro text-content-muted">
        {bpct !== null ? `${bpct}% budget` : `${cpct}% ctx`}
      </span>
      {session.alive ? (
        <>
          <button
            onClick={() => void restart(session.id)}
            disabled={busy}
            title="Restart session"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled"
          >
            <RotateCw size={12} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => void kill(session.id)}
            disabled={busy}
            title="Stop session"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-danger-text disabled:text-content-disabled"
          >
            <Square size={11} strokeWidth={1.5} />
          </button>
        </>
      ) : (
        <button
          onClick={() => dismiss(session.id)}
          title="Dismiss exited session"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

function Detail({ doc, root, sessions }: { doc: AgentDoc; root: string; sessions: Session[] }) {
  const meta = useAgentsStore((s) => metaOrDefault(s.meta, doc.fileName));
  const seed = useAgentsStore((s) => seedFor(s.meta, doc.fileName));
  const avatarSrc = useAgentsStore((s) => s.avatars[doc.fileName] ?? null);
  const loadAvatar = useAgentsStore((s) => s.loadAvatar);
  const updateMeta = useAgentsStore((s) => s.updateMeta);
  const selectAgent = useAgentsStore((s) => s.select);
  const spawn = useSessionsStore((s) => s.spawn);
  const busy = useSessionsStore((s) => s.busy);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const files = useProjectStore((s) => s.files);
  const contextTokens = agentContextTokens(doc, nodes, edges, files);
  const [memStatus, setMemStatus] = useState<AgentMemoryStatus | null>(null);

  const label = agentLabel(doc, meta.nickname);
  const cwd = meta.defaultCwd === "" ? root : meta.defaultCwd;

  useEffect(() => {
    void loadAvatar(doc.fileName);
  }, [doc.fileName, loadAvatar]);

  // WO11 G5 — read-only detail column: the memory-health probe, same source
  // of truth as AgentEditor's Reveal/Fix control (never the project scan).
  useEffect(() => {
    setMemStatus(null);
    void agentMemoryStatus(root, doc.fileName)
      .then(setMemStatus)
      .catch(() => setMemStatus(null));
  }, [root, doc.fileName]);

  const pickFolder = () => {
    void open({ directory: true, title: `Default folder for ${label}` }).then((picked) => {
      if (typeof picked === "string") updateMeta(doc.fileName, { defaultCwd: picked });
    });
  };

  const doSpawn = () => {
    setSpawnError(null);
    void spawn(root, doc.fileName, label, cwd, meta.defaultTokenCeiling).then((err) => {
      if (err !== null) setSpawnError(err);
    });
  };

  // WO11 G5 — "one writer per field" (§5.12): this view never edits a
  // definition field itself. Selecting the agent in the agents store is as
  // far as this lane's zone reaches — the rail/Inspector (a different view)
  // is where the edit actually happens; switching to that view is a
  // top-level App.tsx concern outside src/orchestrator/**.
  const editInInspector = () => selectAgent({ kind: "agent", key: doc.fileName });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-none items-center gap-2.5 border-b border-border-subtle px-4 py-3">
        <AgentAvatar seed={seed} size={44} src={avatarSrc} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-lg font-semibold text-content">{label}</span>
          <span className="truncate font-mono text-2xs text-content-muted">{doc.fileName}</span>
        </div>
        <button
          onClick={doSpawn}
          disabled={busy}
          title={`Spawn a session in ${cwd}`}
          className="flex h-control flex-none items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-3 disabled:text-content-disabled"
        >
          <Play size={13} strokeWidth={1.5} />
          Spawn
        </button>
      </div>

      {spawnError !== null && (
        <div className="flex flex-none items-center gap-2 border-b border-border-subtle bg-danger-surface px-4 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-danger-text">{spawnError}</span>
          <button
            onClick={() => setSpawnError(null)}
            title="Dismiss"
            className="grid h-3.5 w-3.5 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
          >
            <X size={10} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* ── The two settings this view exists for ─────────────────────── */}
      <Section title="Workspace">
        <div className="flex items-center gap-1.5">
          {/* flex + items-center, not height + padding: the field has a fixed
              28px control height, so vertical centring has to come from the
              box, and rtl keeps the folder NAME when the path overflows. */}
          <span
            title={cwd}
            className="flex h-control min-w-0 flex-1 items-center rounded border border-border bg-surface-2 px-2"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary [direction:rtl] [text-align:left]">
              {cwd}
            </span>
          </span>
          <button
            onClick={pickFolder}
            title="Pick the default working folder"
            className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            <FolderOpen size={13} strokeWidth={1.5} />
          </button>
          {meta.defaultCwd !== "" && (
            <button
              onClick={() => updateMeta(doc.fileName, { defaultCwd: "" })}
              title="Clear — fall back to the project root"
              className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content-muted transition-colors duration-fast hover:border-border-strong hover:text-content"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-content-muted">
          {meta.defaultCwd === ""
            ? "No default set — spawns land in the project root."
            : "Every session spawned from this view starts here."}
        </p>
      </Section>

      <Section title="Token ceiling">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            step={1000}
            value={meta.defaultTokenCeiling ?? ""}
            placeholder="inherit global default"
            onChange={(e) => {
              const raw = e.target.value.trim();
              updateMeta(doc.fileName, {
                defaultTokenCeiling: raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)),
              });
            }}
            className="h-control w-[180px] flex-none rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content placeholder:text-content-disabled"
          />
          <span className="font-mono text-2xs text-content-muted">{formatCeiling(meta.defaultTokenCeiling)}</span>
        </div>
        <p className="mt-1.5 text-xs text-content-muted">
          Empty inherits the global default. <span className="font-mono">0</span> means no ceiling — the session
          runs until it finishes or you stop it.
        </p>
      </Section>

      {/* ── Definition: read-only on purpose, the rail editor owns it ─── */}
      <Section title="Definition">
        <dl className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <dt className="w-[72px] flex-none font-mono text-2xs text-content-muted">model</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary">
              {doc.fields.model ?? "inherit"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[72px] flex-none font-mono text-2xs text-content-muted">tools</dt>
            <dd className="min-w-0 flex-1 font-mono text-xs text-content-secondary">
              {doc.fields.tools.length > 0 ? doc.fields.tools.join(", ") : "all"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[72px] flex-none font-mono text-2xs text-content-muted">skills</dt>
            <dd className="min-w-0 flex-1 font-mono text-xs text-content-secondary">
              {doc.fields.skills.length > 0 ? doc.fields.skills.join(", ") : "—"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[72px] flex-none font-mono text-2xs text-content-muted">duties</dt>
            <dd className="min-w-0 flex-1 text-xs leading-relaxed text-content-secondary">
              {doc.fields.description ?? "—"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[72px] flex-none font-mono text-2xs text-content-muted">memory</dt>
            <dd
              className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary"
              title={memStatus?.dirRelPath}
            >
              {memStatus === null ? "…" : memStatus.healthy ? "healthy" : "needs attention"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[72px] flex-none font-mono text-2xs text-content-muted">context</dt>
            <dd
              className="min-w-0 flex-1 font-mono text-xs text-content-secondary"
              title="estimate, chars/4 · window ~200k"
            >
              ≈{contextTokens.toLocaleString()} tok
            </dd>
          </div>
        </dl>
        <div className="mt-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-content-muted">
            Edited in the Hierarchy panel under Agents — one writer per field, so this view and the editor can
            never disagree.
          </p>
          <button
            type="button"
            onClick={editInInspector}
            title="Selects this agent — open it from the Canvas or Tasks view to edit"
            className="flex h-control-sm flex-none items-center gap-1 rounded border border-border bg-surface-2 px-2 text-2xs text-content-secondary transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            <ExternalLink size={11} strokeWidth={1.5} />
            Edit in Inspector
          </button>
        </div>
      </Section>

      <Section title={`Sessions (${sessions.length})`}>
        {sessions.length === 0 ? (
          <p className="text-xs text-content-muted">No sessions yet. Spawn starts one with the settings above.</p>
        ) : (
          <div className="flex flex-col">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function OrchestratorView({ root }: { root: string }) {
  const agents = useAgentsStore((s) => s.agents);
  const loading = useAgentsStore((s) => s.loading);
  const sessions = useSessionsStore((s) => s.sessions);
  const [selected, setSelected] = useState<string | null>(null);

  // Producer first (it is the reserved default and owns unassigned work),
  // then everyone else in the store's own fileName order.
  const ordered = useMemo(() => {
    const producer = agents.filter((a) => a.fileName === PRODUCER_FILE);
    const rest = agents.filter((a) => a.fileName !== PRODUCER_FILE);
    return [...producer, ...rest];
  }, [agents]);

  const sessionsFor = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      if (s.agentFileName === null) continue;
      const list = map.get(s.agentFileName);
      if (list === undefined) map.set(s.agentFileName, [s]);
      else list.push(s);
    }
    return map;
  }, [sessions]);

  const activeFile = selected ?? ordered[0]?.fileName ?? null;
  const activeDoc = ordered.find((a) => a.fileName === activeFile);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">loading fleet…</span>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6">
        <span className="text-base text-content-secondary">No agents defined yet.</span>
        <span className="max-w-[380px] text-center text-sm text-content-muted">
          Agents live in <span className="font-mono">.claude/agents/*.md</span>. Add one from the Agents section of
          the Hierarchy panel, and it shows up here with its own workspace and budget.
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[260px] flex-none flex-col border-r border-border-subtle bg-surface-1">
        <div className="flex h-[31px] flex-none items-center gap-1.5 border-b border-border-subtle px-3">
          <span className="flex-none font-mono text-2xs uppercase tracking-wider text-content">Fleet</span>
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-content-muted">
            {ordered.length} {ordered.length === 1 ? "agent" : "agents"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {ordered.map((doc) => (
            <FleetRow
              key={doc.fileName}
              doc={doc}
              selected={doc.fileName === activeFile}
              onSelect={() => setSelected(doc.fileName)}
              sessions={sessionsFor.get(doc.fileName) ?? []}
            />
          ))}
        </div>
      </div>
      {activeDoc !== undefined && (
        <Detail
          key={activeDoc.fileName}
          doc={activeDoc}
          root={root}
          sessions={sessionsFor.get(activeDoc.fileName) ?? []}
        />
      )}
    </div>
  );
}
