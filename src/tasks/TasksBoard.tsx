// Tasks tab body (TASKBOARD_BATCH_CONTRACT.md Rev 2, R1/R2; restructured per
// WO02_CONTRACT.md §7.11 item #14) — mounted by App.tsx's Workspace when
// `view === "tasks"`, filling the center area beside the rail and Inspector
// (no modal shell anymore). Reads/writes exclusively through `useTasksStore`
// (lane L2's frozen interface) — this file owns no invoke calls.
//
// A segmented control (TASKS · BACKLOG · ROADMAP · BUGS) picks which single
// convention file fills the full-width board area below it — there is no
// more fixed always-visible side panel. TASKS renders the swimlane board,
// grouped by `section` (null → "No sprint") and broken into the four STATUS
// columns (New · In production · In testing · Done) via `statusOf`; the
// other three render as a flat list, `showWhen` on for ROADMAP only.
// Selecting a card/row drives both the tasks store's `selected` (Inspector →
// TaskPanel) and clears the graph selection so the panel is immediately
// visible. Segment choice is local state, deliberately not persisted.

import { useEffect, useState } from "react";
import { Layers, Loader2, MoreVertical, Plus } from "lucide-react";
import {
  normalizePriority,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
  statusOf,
  useTasksStore,
  type TaskDag,
  type TaskStatus,
} from "../store/tasks";
import type { TaskFileInfo, TaskItem } from "../tasks/api";
import { seedFor, type AgentMeta, useAgentsStore } from "../store/agents";
import type { AgentDoc } from "../agents/types";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useGraphStore } from "../store/graph";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { NewTaskDialog } from "./NewTaskDialog";
import { DependsPicker } from "./DependsPicker";
// WO06 audit D1/F1 fix: the differentiator (§2.1/§4) had no reachable UI
// entry point. TaskContextModal's call-site signature is frozen by
// WO06_CONTRACT.md §10.3 — U1 mounts it from the board card, unchanged.
import { TaskContextModal } from "../taskctx/TaskContextModal";

/** Bound store actions threaded down to every card (WO06 §11 U1 — deps
 *  editing lives on the board, not the Inspector, which is out of this
 *  lane's zone). Both reload the scan on success since `blocked`/`dag` are
 *  cross-file derivations a single-file return can't carry. */
type DepsActions = {
  allTasks: TaskItem[];
  onAddDependency: (item: TaskItem, target: TaskItem) => Promise<string | null>;
  onRemoveDependency: (item: TaskItem, dependsOnId: string) => Promise<string | null>;
};

const STATUS_ORDER = TASK_STATUSES;

/** The tasks store's own agentFilter sentinel for tasks with no agent
 *  (`null` = all agents; `"<unassigned>"` matches `agent === null`). */
const UNASSIGNED_FILTER = "<unassigned>";

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

function fileFor(files: TaskFileInfo[], name: string): TaskFileInfo | undefined {
  return files.find((f) => (f.relPath.split("/").pop() ?? "").toLowerCase() === name.toLowerCase());
}

function columnLabel(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/i, "").toUpperCase();
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (priority === null || priority.trim() === "") return null;
  const bucket = normalizePriority(priority);
  if (bucket === null) {
    return (
      <span className="flex-none rounded-sm border border-border bg-surface-2 px-1 font-mono text-micro text-content-secondary">
        {priority.trim()}
      </span>
    );
  }
  const cls =
    bucket === "critical"
      ? "border-danger bg-danger-surface text-danger-text"
      : bucket === "high"
        ? "border-amber-border bg-amber-surface text-amber-text"
        : bucket === "medium"
          ? "border-border bg-surface-2 text-content-secondary"
          : "border-border-subtle text-content-muted";
  return (
    <span className={`flex-none rounded-sm border px-1 font-mono text-micro ${cls}`}>
      {PRIORITY_LABELS[bucket]}
    </span>
  );
}

function WhenChip({ when }: { when: string | null }) {
  if (when === null || when.trim() === "") return null;
  return (
    <span className="flex-none rounded-sm border border-amber-border bg-amber-surface px-1 font-mono text-micro text-amber-text">
      {when}
    </span>
  );
}

/** Every dependency this task names that resolves to a scanned task whose
 *  status isn't "done" yet — i.e. what's actually holding it up. An
 *  unresolved dependency (typo) never blocks (WO06 §3.3 D1), so it's
 *  excluded here on purpose. */
function blockingDeps(task: TaskItem, allTasks: TaskItem[]): TaskItem[] {
  return task.dependsOn
    .map((id) => allTasks.find((t) => t.taskId === id))
    .filter((t): t is TaskItem => t !== undefined && statusOf(t) !== "done");
}

/** Static (non-pulsing) warning-amber — "blocked" is a system state, not a
 *  live agent action, so it must never read as the moving amber that means
 *  "the cow is doing something" (design-tokens skill: static amber = warning). */
function BlockedBadge({ task, allTasks }: { task: TaskItem; allTasks: TaskItem[] }) {
  const blockers = blockingDeps(task, allTasks);
  const title = blockers.length > 0 ? `Blocked by: ${blockers.map((b) => b.name).join(", ")}` : "Blocked";
  return (
    <span
      title={title}
      className="flex-none rounded-sm border border-amber-border bg-warning-surface px-1 font-mono text-micro text-warning-text"
    >
      Blocked
    </span>
  );
}

function formatCyclePath(path: string[]): string {
  return path.join(" → ");
}

/** Board-level summary of the cross-file DAG derivation (WO06 §3.3) — one
 *  compact banner instead of per-card noise, since cycles/duplicates are
 *  rare and span files the current segment may not even show. Cycles and
 *  duplicate ids are reported, never fatal (tasks_scan always succeeds). */
function DagWarnings({ dag }: { dag: TaskDag }) {
  if (dag.cycles.length === 0 && dag.duplicateIds.length === 0 && dag.unresolved.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-border-subtle border-l-[3px] border-l-warning bg-warning-surface px-3 py-2 font-mono text-2xs leading-relaxed text-warning-text">
      {dag.cycles.map((cycle, i) => (
        <p key={`cycle-${i}`}>Dependency cycle: {formatCyclePath(cycle)}</p>
      ))}
      {dag.duplicateIds.length > 0 && (
        <p>
          Duplicate task id{dag.duplicateIds.length > 1 ? "s" : ""}: {dag.duplicateIds.join(", ")} — links to these
          ids are refused until the duplicate is resolved.
        </p>
      )}
      {dag.unresolved.length > 0 && (
        <p>
          {dag.unresolved.length} unresolved dependenc{dag.unresolved.length === 1 ? "y" : "ies"}:{" "}
          {dag.unresolved.map((u) => `${u.taskId} needs ${u.dependsOn}`).join(", ")}
        </p>
      )}
    </div>
  );
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
    return <span className={CHIP}>Unassigned</span>;
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

function CardMenuButton({ items }: { items: MenuItem[] }) {
  const menu = useContextMenu();
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          menu.openAt(e, items);
        }}
        title="Set status / move"
        className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
      >
        <MoreVertical size={12} strokeWidth={1.5} />
      </button>
      {menu.menu !== null && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} items={menu.menu.items} onClose={menu.close} />
      )}
    </>
  );
}

/** Board-card launch point for the WO06 differentiator (§4/§10.3, audit
 *  D1/F1) — every card, in every one of the four convention-file segments,
 *  carries this next to the deps chip so the feature is reachable from the
 *  "commodity" board surface, not only from the Inspector. `busy` covers the
 *  on-demand `task_id_ensure` mint (§3.1: ids appear only on first link). */
function ContextButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={busy}
      title="Task context — preview the Memory Node subgraph this task's session would receive"
      className="flex h-control-sm flex-none items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 font-mono text-micro text-content-disabled transition-colors duration-fast hover:text-content disabled:cursor-wait"
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <Layers size={10} strokeWidth={1.5} />}
    </button>
  );
}

function StatusCard({
  task,
  status,
  selected,
  agents,
  meta,
  otherFiles,
  deps,
  contextBusy,
  onSelect,
  onSetStatus,
  onMove,
  onOpenContext,
}: {
  task: TaskItem;
  status: TaskStatus;
  selected: boolean;
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
  otherFiles: { relPath: string; label: string }[];
  deps: DepsActions;
  contextBusy: boolean;
  onSelect: () => void;
  onSetStatus: (status: TaskStatus) => void;
  onMove: (toRelPath: string) => void;
  onOpenContext: () => void;
}) {
  const menuItems: MenuItem[] = [
    ...STATUS_ORDER.filter((s) => s !== status).map(
      (s): MenuItem => ({
        kind: "item",
        id: `status-${s}`,
        label: `Move to ${STATUS_LABELS[s]}`,
        onSelect: () => onSetStatus(s),
      }),
    ),
    { kind: "separator", id: "sep-1" },
    ...otherFiles.map(
      (f): MenuItem => ({
        kind: "item",
        id: `move-${f.relPath}`,
        label: `Move to ${f.label}`,
        onSelect: () => onMove(f.relPath),
      }),
    ),
  ];

  return (
    <div
      onClick={onSelect}
      className={`flex cursor-default flex-col gap-1 rounded border p-1.5 transition-colors duration-fast ${
        selected
          ? "border-accent-border bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
          : "border-border bg-surface-2 hover:border-border-strong"
      }`}
    >
      <div className="flex items-start gap-1">
        <span
          title={task.name}
          className={`min-w-0 flex-1 truncate text-xs ${selected ? "text-accent-text" : "text-content"}`}
        >
          {task.name}
        </span>
        <CardMenuButton items={menuItems} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <PriorityBadge priority={task.priority} />
        {task.phase !== null && task.phase !== "" && <span className={CHIP}>{task.phase}</span>}
        {/* F6: metadata, not a state — same muted chip idiom as phase, never
            a status/priority color. Hidden when the row's table has no
            Task Type column (or the cell is blank). */}
        {task.taskType !== null && task.taskType !== "" && <span className={CHIP}>{task.taskType}</span>}
        {task.tags.map((t) => (
          <span key={t} className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted">
            #{t}
          </span>
        ))}
        {task.blocked && <BlockedBadge task={task} allTasks={deps.allTasks} />}
        <div className="min-w-[6px] flex-1" />
        <DependsPicker
          item={task}
          allTasks={deps.allTasks}
          disabled={false}
          onAdd={(target) => deps.onAddDependency(task, target)}
          onRemove={(depId) => deps.onRemoveDependency(task, depId)}
        />
        <ContextButton busy={contextBusy} onClick={onOpenContext} />
        <AgentChip agentRaw={task.agent} agents={agents} meta={meta} />
      </div>
    </div>
  );
}

// #14 — the always-visible right panel (BACKLOG/ROADMAP) is gone; this
// segmented control picks which single file fills the full-width board
// area. Same idiom as App.tsx's ViewToggle (2px padding frame on surface-2,
// active segment surface-3, 24px segments).
const BOARD_SEGMENTS = ["TASKS", "BACKLOG", "ROADMAP", "BUGS"] as const;
type BoardSegment = (typeof BOARD_SEGMENTS)[number];

function BoardSegmentToggle({ value, onChange }: { value: BoardSegment; onChange: (v: BoardSegment) => void }) {
  return (
    <div className="flex flex-none items-center gap-0.5 rounded border border-border bg-surface-2 p-[2px]">
      {BOARD_SEGMENTS.map((seg) => (
        <button
          key={seg}
          type="button"
          onClick={() => onChange(seg)}
          aria-pressed={value === seg}
          className={`flex h-control-sm items-center rounded-sm px-3 font-mono text-2xs tracking-wider transition-colors duration-fast ${
            value === seg ? "bg-surface-3 font-medium text-content" : "text-content-muted hover:text-content-secondary"
          }`}
        >
          {seg}
        </button>
      ))}
    </div>
  );
}

function ColumnHeader({ status, count }: { status: TaskStatus; count: number }) {
  return (
    <div className="flex h-[26px] flex-none items-center gap-1.5 border-r border-border-subtle px-2 last:border-r-0">
      <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
        {STATUS_LABELS[status]}
      </span>
      <span className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-disabled">
        {count}
      </span>
    </div>
  );
}

function Swimlane({
  label,
  tasks,
  statusOf,
  agents,
  meta,
  otherFiles,
  deps,
  contextBusyId,
  selectedId,
  onSelect,
  onSetStatus,
  onMove,
  onOpenContext,
}: {
  label: string;
  tasks: TaskItem[];
  statusOf: (item: TaskItem) => TaskStatus;
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
  otherFiles: { relPath: string; label: string }[];
  deps: DepsActions;
  contextBusyId: string | null;
  selectedId: string | null;
  onSelect: (t: TaskItem) => void;
  onSetStatus: (t: TaskItem, status: TaskStatus) => void;
  onMove: (t: TaskItem, toRelPath: string) => void;
  onOpenContext: (t: TaskItem) => void;
}) {
  return (
    <div className="border-b border-border-subtle">
      <div className="flex h-[22px] flex-none items-center gap-1.5 bg-surface-inset px-2.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-secondary">{label}</span>
        <span className="font-mono text-micro text-content-disabled">({tasks.length})</span>
      </div>
      <div className="grid grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex flex-col gap-1.5 border-r border-border-subtle p-2 last:border-r-0">
            {tasks
              .filter((t) => statusOf(t) === status)
              .map((t) => (
                <StatusCard
                  key={t.id}
                  task={t}
                  status={status}
                  selected={t.id === selectedId}
                  agents={agents}
                  meta={meta}
                  otherFiles={otherFiles}
                  deps={deps}
                  contextBusy={contextBusyId === t.id}
                  onSelect={() => onSelect(t)}
                  onSetStatus={(s) => onSetStatus(t, s)}
                  onMove={(to) => onMove(t, to)}
                  onOpenContext={() => onOpenContext(t)}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlatRow({
  task,
  showWhen,
  selected,
  agents,
  meta,
  deps,
  contextBusy,
  onSelect,
  onToggle,
  onOpenContext,
}: {
  task: TaskItem;
  showWhen: boolean;
  selected: boolean;
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
  deps: DepsActions;
  contextBusy: boolean;
  onSelect: () => void;
  onToggle: (done: boolean) => void;
  onOpenContext: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-default flex-col gap-1 rounded border p-1.5 transition-colors duration-fast ${
        selected
          ? "border-accent-border bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
          : "border-border bg-surface-2 hover:border-border-strong"
      }`}
    >
      <div className="flex items-start gap-1.5">
        {/* O1 fix (WO06 §11): the checkbox used to be gated on
            source === "checklist" — since WO02 made grids canonical, every
            BACKLOG/ROADMAP/BUGS row is a table row, so none of them could be
            completed from the board. onToggle now routes to toggleAny,
            which sends a full-field task_update for table rows because
            task_toggle genuinely refuses them server-side. */}
        <input
          type="checkbox"
          checked={task.done}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-3 w-3 flex-none accent-[var(--accent)]"
        />
        <span
          title={task.name}
          className={`min-w-0 flex-1 truncate text-xs ${
            task.done ? "text-content-disabled line-through" : selected ? "text-accent-text" : "text-content"
          }`}
        >
          {task.name}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-[18px]">
        <PriorityBadge priority={task.priority} />
        {showWhen && <WhenChip when={task.when} />}
        {task.tags.map((t) => (
          <span key={t} className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted">
            #{t}
          </span>
        ))}
        {task.blocked && <BlockedBadge task={task} allTasks={deps.allTasks} />}
        <div className="min-w-[6px] flex-1" />
        <DependsPicker
          item={task}
          allTasks={deps.allTasks}
          disabled={false}
          onAdd={(target) => deps.onAddDependency(task, target)}
          onRemove={(depId) => deps.onRemoveDependency(task, depId)}
        />
        <ContextButton busy={contextBusy} onClick={onOpenContext} />
        <AgentChip agentRaw={task.agent} agents={agents} meta={meta} />
      </div>
    </div>
  );
}

function FlatListPanel({
  label,
  file,
  tasks,
  showWhen,
  agents,
  meta,
  deps,
  contextBusyId,
  selectedId,
  onSelect,
  onToggle,
  onOpenContext,
}: {
  label: string;
  file: TaskFileInfo | undefined;
  tasks: TaskItem[];
  showWhen: boolean;
  agents: AgentDoc[];
  meta: Record<string, AgentMeta>;
  deps: DepsActions;
  contextBusyId: string | null;
  selectedId: string | null;
  onSelect: (t: TaskItem) => void;
  onToggle: (t: TaskItem, done: boolean) => void;
  onOpenContext: (t: TaskItem) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[26px] flex-none items-center gap-1.5 border-b border-border-subtle bg-surface-1 px-2.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">{label}</span>
        <span className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-disabled">
          {tasks.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {file !== undefined && !file.exists && (
          <p className="px-1 py-2 text-center text-2xs text-content-muted">create on first task</p>
        )}
        {tasks.length === 0 && (file === undefined || file.exists) && (
          <p className="px-1 py-2 text-center text-2xs text-content-disabled">Nothing here.</p>
        )}
        {tasks.map((t) => (
          <FlatRow
            key={t.id}
            task={t}
            showWhen={showWhen}
            selected={t.id === selectedId}
            agents={agents}
            meta={meta}
            deps={deps}
            contextBusy={contextBusyId === t.id}
            onSelect={() => onSelect(t)}
            onToggle={(done) => onToggle(t, done)}
            onOpenContext={() => onOpenContext(t)}
          />
        ))}
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
  onNewTask,
}: {
  agents: AgentDoc[];
  value: string | null;
  onChange: (v: string | null) => void;
  textFilter: string;
  onTextFilterChange: (v: string) => void;
  onNewTask: () => void;
}) {
  return (
    <div className="flex h-topbar flex-none items-center gap-2 border-b border-border-subtle px-3">
      <span className="flex-none text-sm font-semibold text-content">Tasks</span>
      <div className="mx-1 h-4 w-px flex-none bg-border-subtle" />
      <select
        value={value ?? "<all>"}
        onChange={(e) => onChange(e.target.value === "<all>" ? null : e.target.value)}
        className="h-control-sm rounded border border-border bg-surface-2 px-2 text-xs text-content focus:border-accent"
      >
        <option value="<all>">All agents</option>
        <option value={UNASSIGNED_FILTER}>Unassigned</option>
        {agents
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
      <div className="min-w-0 flex-1" />
      <button
        onClick={onNewTask}
        className="flex h-control items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
      >
        <Plus size={14} strokeWidth={1.5} />
        New task
      </button>
    </div>
  );
}

/** Tasks tab body (contract Rev 2 R1/R2). Mounted with the project root so
 *  it can load its own state on tab mount, per contract. With `agentFilter`
 *  supplied, the picker is hidden and the prop is the sole filter — kept for
 *  a future per-agent embed. */
export function TasksBoard({ root, agentFilter: agentFilterProp }: { root: string; agentFilter?: string | null }) {
  const load = useTasksStore((s) => s.load);
  const files = useTasksStore((s) => s.files);
  const allTasks = useTasksStore((s) => s.tasks);
  const dag = useTasksStore((s) => s.dag);
  const loading = useTasksStore((s) => s.loading);
  const error = useTasksStore((s) => s.error);
  const storeFilter = useTasksStore((s) => s.agentFilter);
  const setStoreFilter = useTasksStore((s) => s.setAgentFilter);
  const selected = useTasksStore((s) => s.selected);
  const select = useTasksStore((s) => s.select);
  const setStatus = useTasksStore((s) => s.setStatus);
  const toggleAny = useTasksStore((s) => s.toggleAny);
  const move = useTasksStore((s) => s.move);
  const addDependency = useTasksStore((s) => s.addDependency);
  const removeDependency = useTasksStore((s) => s.removeDependency);
  const ensureId = useTasksStore((s) => s.ensureId);
  const setGraphSelection = useGraphStore((s) => s.setSelection);
  const agents = useAgentsStore((s) => s.agents);
  const meta = useAgentsStore((s) => s.meta);
  const [textFilter, setTextFilter] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // #14 — local, deliberately not persisted (WO02_CONTRACT.md §1.3): resets
  // to TASKS on remount.
  const [segment, setSegment] = useState<BoardSegment>("TASKS");
  // WO06 audit D1/F1 — board-card mount of the frozen §10.3 TaskContextModal.
  // `taskId` is null until first minted (§3.1 "no auto-mint"); `openContext`
  // mints on demand, exactly like DependsPicker's onAdd already does.
  const [contextTask, setContextTask] = useState<{ taskId: string; taskName: string } | null>(null);
  const [contextBusyId, setContextBusyId] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const openContext = (t: TaskItem) => {
    setContextError(null);
    if (t.taskId !== null) {
      setContextTask({ taskId: t.taskId, taskName: t.name });
      return;
    }
    setContextBusyId(t.id);
    void ensureId(t).then((result) => {
      setContextBusyId(null);
      if (typeof result === "string") {
        setContextError(result);
        return;
      }
      if (result.taskId !== null) setContextTask({ taskId: result.taskId, taskName: result.name });
    });
  };

  // Board state loads on tab mount (contract R1) — every time this
  // component mounts (view switched to "tasks") and whenever the project
  // root changes underneath it.
  useEffect(() => {
    void load(root);
  }, [root, load]);

  const locked = agentFilterProp !== undefined;
  const effectiveFilter = locked ? agentFilterProp : storeFilter;

  const matches = (t: TaskItem): boolean => {
    if (effectiveFilter !== null && effectiveFilter !== undefined) {
      if (effectiveFilter === UNASSIGNED_FILTER) {
        if (t.agent !== null) return false;
      } else {
        const doc = agents.find((a) => a.fileName === effectiveFilter);
        if (!agentKeyMatches(t.agent, effectiveFilter, doc?.fields.name ?? null)) return false;
      }
    }
    if (textFilter.trim() !== "") {
      const q = textFilter.trim().toLowerCase();
      const hay = `${t.name} ${t.description ?? ""} ${t.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const tasksFile = fileFor(files, "TASKS.md");
  const backlogFile = fileFor(files, "BACKLOG.md");
  const roadmapFile = fileFor(files, "ROADMAP.md");
  const bugsFile = fileFor(files, "BUGS.md");

  const taskItems = allTasks.filter((t) => tasksFile !== undefined && t.relPath === tasksFile.relPath && matches(t));
  const backlogItems = allTasks.filter((t) => backlogFile !== undefined && t.relPath === backlogFile.relPath && matches(t));
  const roadmapItems = allTasks.filter((t) => roadmapFile !== undefined && t.relPath === roadmapFile.relPath && matches(t));
  const bugsItems = allTasks.filter((t) => bugsFile !== undefined && t.relPath === bugsFile.relPath && matches(t));

  const bySection = new Map<string, TaskItem[]>();
  const sectionOrder: string[] = [];
  for (const t of [...taskItems].sort((a, b) => a.line - b.line)) {
    const key = t.section ?? "No sprint";
    if (!bySection.has(key)) {
      bySection.set(key, []);
      sectionOrder.push(key);
    }
    bySection.get(key)?.push(t);
  }

  const otherFilesFor = (relPath: string): { relPath: string; label: string }[] =>
    files.filter((f) => f.relPath !== relPath).map((f) => ({ relPath: f.relPath, label: columnLabel(f.relPath) }));

  // Dependency candidates are every scanned task, not just the current
  // segment's filtered subset — a task in TASKS.md can depend on one in
  // BUGS.md (WO06 §3.3 places no such restriction on `needs:`).
  const deps: DepsActions = { allTasks, onAddDependency: addDependency, onRemoveDependency: removeDependency };

  const pick = (t: TaskItem) => {
    select(t);
    setGraphSelection([], []);
  };

  const selectedId = selected?.id ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!locked && (
        <FilterBar
          agents={agents}
          value={storeFilter}
          onChange={setStoreFilter}
          textFilter={textFilter}
          onTextFilterChange={setTextFilter}
          onNewTask={() => setNewTaskOpen(true)}
        />
      )}
      <div className="flex h-row-comfy flex-none items-center border-b border-border-subtle bg-surface-1 px-3">
        <BoardSegmentToggle value={segment} onChange={setSegment} />
      </div>
      {error !== null && (
        <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
          {error}
        </div>
      )}
      {contextError !== null && (
        <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
          {contextError}
        </div>
      )}
      <DagWarnings dag={dag} />
      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-content-muted">loading…</p>
      ) : segment === "TASKS" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-[1] grid grid-cols-4 border-b border-border-subtle bg-surface-1">
            {STATUS_ORDER.map((status) => (
              <ColumnHeader
                key={status}
                status={status}
                count={taskItems.filter((t) => statusOf(t) === status).length}
              />
            ))}
          </div>
          {tasksFile !== undefined && !tasksFile.exists && (
            <p className="px-3 py-6 text-center text-sm text-content-muted">
              No TASKS.md yet — add a task to create it.
            </p>
          )}
          {tasksFile !== undefined && tasksFile.exists && taskItems.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-content-muted">No tasks match.</p>
          )}
          {sectionOrder.map((sec) => (
            <Swimlane
              key={sec}
              label={sec}
              tasks={bySection.get(sec) ?? []}
              statusOf={statusOf}
              agents={agents}
              meta={meta}
              otherFiles={tasksFile !== undefined ? otherFilesFor(tasksFile.relPath) : []}
              deps={deps}
              contextBusyId={contextBusyId}
              selectedId={selectedId}
              onSelect={pick}
              onSetStatus={(t, s) => void setStatus(t, s)}
              onMove={(t, to) => void move(t, to)}
              onOpenContext={openContext}
            />
          ))}
        </div>
      ) : (
        <FlatListPanel
          label={segment}
          file={segment === "BACKLOG" ? backlogFile : segment === "ROADMAP" ? roadmapFile : bugsFile}
          tasks={segment === "BACKLOG" ? backlogItems : segment === "ROADMAP" ? roadmapItems : bugsItems}
          showWhen={segment === "ROADMAP"}
          agents={agents}
          meta={meta}
          deps={deps}
          contextBusyId={contextBusyId}
          selectedId={selectedId}
          onSelect={pick}
          onToggle={(t, done) => void toggleAny(t, done)}
          onOpenContext={openContext}
        />
      )}
      {newTaskOpen && (
        <NewTaskDialog root={root} files={files} agents={agents} onClose={() => setNewTaskOpen(false)} />
      )}
      {contextTask !== null && (
        <TaskContextModal
          root={root}
          taskId={contextTask.taskId}
          taskName={contextTask.taskName}
          onClose={() => setContextTask(null)}
        />
      )}
    </div>
  );
}
