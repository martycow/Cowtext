// Reusable SCRUM-ish board over the four convention task files (contract
// §7). Reads/writes exclusively through `useTasksStore` (lane L2's frozen
// interface) — this file owns no invoke calls. `agentFilter` prop locks the
// view for a future per-agent embed: when supplied, the agent picker in the
// filter bar is hidden and the prop wins over the store's own filter.

import { useState } from "react";
import { MoveRight, Plus } from "lucide-react";
import { useTasksStore } from "../store/tasks";
import type { TaskFileInfo, TaskItem } from "../tasks/api";
import { PRODUCER_FILE, seedFor, type AgentMeta, useAgentsStore } from "../store/agents";
import type { AgentDoc } from "../agents/types";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";

/** The tasks store's own agentFilter sentinel for "Producer" (its comment:
 *  `null` = all agents; `"producer"` additionally matches `agent === null`)
 *  — distinct from PRODUCER_FILE ("producer.md"), which identifies the real
 *  agent file when one exists. */
const PRODUCER_FILTER = "producer";

const CHIP =
  "flex-none rounded-sm border border-border bg-surface-2 px-1 font-mono text-micro text-content-secondary";

/** Loose match between a task's raw `agent` text (checklist `@name` or a
 *  table `agent|assignee|owner` cell) and a real agent file — by fileName
 *  stem or display name, case-insensitive. Not exact-schema; the task file
 *  is free text written by humans. */
function agentKeyMatches(taskAgent: string | null, fileName: string, displayName: string | null): boolean {
  if (taskAgent === null) return false;
  const norm = taskAgent.trim().replace(/^@/, "").toLowerCase();
  if (norm === "") return false;
  const stem = fileName.replace(/\.md$/i, "").toLowerCase();
  const name = (displayName ?? "").toLowerCase();
  return norm === stem || (name !== "" && norm === name);
}

function columnLabel(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/i, "").toUpperCase();
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (priority === null || priority.trim() === "") return null;
  const norm = priority.trim().toUpperCase();
  const cls =
    norm === "P0"
      ? "border-danger bg-danger-surface text-danger-text"
      : norm === "P1"
        ? "border-amber-border bg-amber-surface text-amber-text"
        : "border-border bg-surface-2 text-content-secondary";
  return <span className={`flex-none rounded-sm border px-1 font-mono text-micro ${cls}`}>{norm}</span>;
}

function AgentChip({
  agentRaw,
  agents,
  meta,
}: {
  agentRaw: string | null;
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
}) {
  if (agentRaw === null) {
    return <span className={CHIP}>Producer</span>;
  }
  const doc = agents.find((a) => agentKeyMatches(agentRaw, a.fileName, a.fields.name));
  if (doc === undefined) {
    return (
      <span className={CHIP} title={agentRaw}>
        {agentRaw}
      </span>
    );
  }
  const label = doc.fields.name !== null && doc.fields.name !== "" ? doc.fields.name : doc.fileName;
  return (
    <span className={`${CHIP} flex items-center gap-1`}>
      <AgentAvatar seed={seedFor(meta, doc.fileName)} size={11} />
      {label}
    </span>
  );
}

function TaskCard({
  task,
  agents,
  meta,
  otherFiles,
  onToggle,
  onMove,
}: {
  task: TaskItem;
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
  otherFiles: { relPath: string; label: string }[];
  onToggle: (done: boolean) => void;
  onMove: (toRelPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const menu = useContextMenu();

  const openMoveMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = otherFiles.map((f) => ({
      kind: "item",
      id: f.relPath,
      label: `Move to ${f.label}`,
      onSelect: () => onMove(f.relPath),
    }));
    menu.openAt(e, items);
  };

  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-surface-2 p-2">
      <div className="flex items-start gap-1.5">
        {task.source === "checklist" && (
          <input
            type="checkbox"
            checked={task.done}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-0.5 h-3 w-3 flex-none accent-[var(--accent)]"
          />
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={task.name}
          className={`min-w-0 flex-1 truncate text-left text-xs ${task.done ? "text-content-disabled line-through" : "text-content"}`}
        >
          {task.name}
        </button>
        <button
          type="button"
          onClick={openMoveMenu}
          title="Move to…"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <MoveRight size={12} strokeWidth={1.5} />
        </button>
      </div>
      {expanded && task.description !== "" && (
        <p className="pl-[18px] text-2xs leading-snug text-content-secondary">{task.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-1 pl-[18px]">
        <PriorityBadge priority={task.priority} />
        {task.phase !== null && task.phase !== "" && <span className={CHIP}>{task.phase}</span>}
        {task.tags.map((t) => (
          <span key={t} className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted">
            #{t}
          </span>
        ))}
        <div className="min-w-[8px] flex-1" />
        <AgentChip agentRaw={task.agent} agents={agents} meta={meta} />
      </div>
      {menu.menu !== null && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} items={menu.menu.items} onClose={menu.close} />
      )}
    </div>
  );
}

function Column({
  file,
  label,
  tasks,
  otherFiles,
  agents,
  meta,
}: {
  file: TaskFileInfo;
  label: string;
  tasks: TaskItem[];
  otherFiles: { relPath: string; label: string }[];
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
}) {
  const toggle = useTasksStore((s) => s.toggle);
  const append = useTasksStore((s) => s.append);
  const move = useTasksStore((s) => s.move);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const v = draft.trim();
    if (v === "") return;
    setDraft("");
    void append(file.relPath, v);
  };

  return (
    <div className="flex w-[250px] flex-none flex-col rounded-lg border border-border-subtle bg-surface-1">
      <div className="flex h-row flex-none items-center gap-1.5 border-b border-border-subtle px-2.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">{label}</span>
        <span className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-disabled">
          {tasks.length}
        </span>
      </div>
      {!file.exists && (
        <p className="border-b border-border-subtle px-2.5 py-1.5 text-2xs leading-snug text-content-muted">
          create on first task
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {tasks.length === 0 && file.exists && (
          <p className="px-1 py-2 text-center text-2xs text-content-disabled">No tasks here.</p>
        )}
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            agents={agents}
            meta={meta}
            otherFiles={otherFiles}
            onToggle={(done) => void toggle(t, done)}
            onMove={(to) => void move(t, to)}
          />
        ))}
      </div>
      <div className="flex flex-none items-center gap-1 border-t border-border-subtle px-1.5 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Add task…"
          className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 text-2xs text-content placeholder:text-content-disabled focus:border-accent"
        />
        <button
          type="button"
          onClick={submit}
          title="Add"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <Plus size={12} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

function FilterBar({
  agents,
  value,
  onChange,
  textFilter,
  onTextFilterChange,
}: {
  agents: AgentDoc[];
  value: string | null;
  onChange: (v: string | null) => void;
  textFilter: string;
  onTextFilterChange: (v: string) => void;
}) {
  return (
    <div className="flex h-[38px] flex-none items-center gap-2 border-b border-border-subtle px-3">
      <select
        value={value ?? "<all>"}
        onChange={(e) => onChange(e.target.value === "<all>" ? null : e.target.value)}
        className="h-control-sm rounded border border-border bg-surface-2 px-2 text-xs text-content focus:border-accent"
      >
        <option value="<all>">All agents</option>
        <option value={PRODUCER_FILTER}>Producer</option>
        {agents
          .filter((a) => a.fileName !== PRODUCER_FILE)
          .map((a) => (
            <option key={a.fileName} value={a.fileName}>
              {a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName}
            </option>
          ))}
      </select>
      <input
        value={textFilter}
        onChange={(e) => onTextFilterChange(e.target.value)}
        placeholder="Filter tasks…"
        className="h-control-sm min-w-0 max-w-[240px] flex-1 rounded border border-border bg-surface-2 px-2 text-xs text-content placeholder:text-content-disabled focus:border-accent"
      />
    </div>
  );
}

/** Reusable four-column task board (contract §7). With `agentFilter`
 *  supplied, the picker is hidden and the prop is the sole filter — the
 *  shape a future per-agent embed will use; without it, the board drives
 *  the store's own `agentFilter`/`setAgentFilter`. */
export function TasksBoard({ agentFilter: agentFilterProp }: { agentFilter?: string | null }) {
  const files = useTasksStore((s) => s.files);
  const allTasks = useTasksStore((s) => s.tasks);
  const loading = useTasksStore((s) => s.loading);
  const error = useTasksStore((s) => s.error);
  const storeFilter = useTasksStore((s) => s.agentFilter);
  const setStoreFilter = useTasksStore((s) => s.setAgentFilter);
  const agents = useAgentsStore((s) => s.agents);
  const meta = useAgentsStore((s) => s.meta);
  const [textFilter, setTextFilter] = useState("");

  const locked = agentFilterProp !== undefined;
  const effectiveFilter = locked ? agentFilterProp : storeFilter;

  const filtered = allTasks.filter((t: TaskItem) => {
    if (effectiveFilter !== null && effectiveFilter !== undefined) {
      if (effectiveFilter === PRODUCER_FILTER) {
        const isProducer = t.agent === null || agentKeyMatches(t.agent, PRODUCER_FILE, "Producer");
        if (!isProducer) return false;
      } else {
        const doc = agents.find((a) => a.fileName === effectiveFilter);
        if (!agentKeyMatches(t.agent, effectiveFilter, doc?.fields.name ?? null)) return false;
      }
    }
    if (textFilter.trim() !== "") {
      const q = textFilter.trim().toLowerCase();
      const hay = `${t.name} ${t.description} ${t.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!locked && (
        <FilterBar
          agents={agents}
          value={storeFilter}
          onChange={setStoreFilter}
          textFilter={textFilter}
          onTextFilterChange={setTextFilter}
        />
      )}
      {error !== null && (
        <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
          {error}
        </div>
      )}
      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-content-muted">loading…</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {files.map((f, i) => {
            const colTasks = filtered.filter((t) => t.relPath === f.relPath);
            const others = files
              .filter((_, j) => j !== i)
              .map((o) => ({ relPath: o.relPath, label: columnLabel(o.relPath) }));
            return (
              <Column
                key={f.relPath}
                file={f}
                label={columnLabel(f.relPath)}
                tasks={colTasks}
                otherFiles={others}
                agents={agents}
                meta={meta}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
