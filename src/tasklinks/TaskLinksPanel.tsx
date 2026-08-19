// Task-to-node linkage panel (WO06_CONTRACT.md §3.2, §4.1 duty #1) — attach
// or detach Memory Nodes on a task, set/see its goal-ancestry parent, and
// configure a per-task token ceiling. Self-contained: a caller mounts it
// with `{ root, taskId, taskName }` (`taskId` null before the caller has
// minted a stable id — U1's `task_id_ensure` affordance) and everything
// else — loading tasklinks, resolving node titles, the subgraph-preview
// launch — lives in here.
//
// Read-only imports of `useGraphStore` (node titles/roles) and
// `useTasksStore` (the parent-task picker's candidate list) — this module
// never writes either store; it writes only through `useTaskLinksStore`.

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { useGraphStore } from "../store/graph";
import { useTasksStore, type TaskItem } from "../store/tasks";
import { useTaskLinksStore } from "../store/tasklinks";
import { TaskContextModal } from "../taskctx/TaskContextModal";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

function AttachPopup({
  excludeIds,
  onPick,
  onClose,
}: {
  excludeIds: Set<string>;
  onPick: (nodeId: string) => void;
  onClose: () => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const [query, setQuery] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popRef.current !== null && !popRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const candidates = nodes
    .filter((n) => !excludeIds.has(n.id))
    .filter((n) => q === "" || n.title.toLowerCase().includes(q) || n.filePath.toLowerCase().includes(q))
    .slice(0, 40);

  return (
    <div
      ref={popRef}
      role="menu"
      className="absolute left-0 top-full z-dropdown mt-1 flex max-h-[280px] w-[280px] flex-col rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="filter nodes…"
        className="mb-1 h-control-sm flex-none rounded border border-border bg-surface-2 px-1.5 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {candidates.length === 0 && (
          <p className="px-2 py-1.5 text-2xs text-content-disabled">No matching nodes.</p>
        )}
        {candidates.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onPick(n.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
          >
            <span style={{ color: roleVar(n.role) }}>
              <RoleGlyph role={n.role} size={11} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-content">{n.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TaskLinksPanel({
  root,
  taskId,
  taskName,
}: {
  root: string;
  taskId: string | null;
  taskName: string;
}) {
  const linksRoot = useTaskLinksStore((s) => s.root);
  const loadLinks = useTaskLinksStore((s) => s.load);
  const link = useTaskLinksStore((s) => (taskId === null ? null : s.linkFor(taskId)));
  const ancestryChain = useTaskLinksStore((s) => s.ancestryChain);
  const attachNode = useTaskLinksStore((s) => s.attachNode);
  const detachNode = useTaskLinksStore((s) => s.detachNode);
  const setParent = useTaskLinksStore((s) => s.setParent);
  const setCeiling = useTaskLinksStore((s) => s.setCeiling);

  const nodes = useGraphStore((s) => s.nodes);
  const tasks = useTasksStore((s) => s.tasks);

  const [attachOpen, setAttachOpen] = useState(false);
  const [busyOp, setBusyOp] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [ceilingDraft, setCeilingDraft] = useState("");
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    if (root !== "" && linksRoot !== root) void loadLinks(root);
  }, [root, linksRoot, loadLinks]);

  useEffect(() => {
    setCeilingDraft(link?.tokenCeiling !== undefined ? String(link.tokenCeiling) : "");
  }, [link?.tokenCeiling, taskId]);

  if (taskId === null) {
    return (
      <div className="border-t border-border-subtle p-3">
        <FieldLabel>Context</FieldLabel>
        <p className="text-xs leading-snug text-content-muted">
          Mint a stable id for this task first — then you can link Memory Nodes, set a parent
          goal, and launch a session with exactly that subgraph.
        </p>
      </div>
    );
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const linkedIds = link?.nodeIds ?? [];
  const chain = ancestryChain(taskId);
  const otherTasksWithId = new Map<string, TaskItem>();
  for (const t of tasks) {
    if (t.taskId !== null && t.taskId !== taskId && !otherTasksWithId.has(t.taskId)) {
      otherTasksWithId.set(t.taskId, t);
    }
  }

  const run = (label: string, p: Promise<string | null>) => {
    setBusyOp(label);
    setOpError(null);
    void p.then((err) => {
      setBusyOp(null);
      if (err !== null) setOpError(err);
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle p-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <FieldLabel>Linked nodes</FieldLabel>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="grid h-5 w-5 place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
              title="Attach a node"
            >
              <Plus size={13} strokeWidth={1.5} />
            </button>
            {attachOpen && (
              <AttachPopup
                excludeIds={new Set(linkedIds)}
                onPick={(nodeId) => {
                  setAttachOpen(false);
                  run("attach", attachNode(root, taskId, nodeId));
                }}
                onClose={() => setAttachOpen(false)}
              />
            )}
          </div>
        </div>
        {linkedIds.length === 0 ? (
          <p className="text-xs text-content-disabled">No nodes linked yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {linkedIds.map((id) => {
              const n = nodeById.get(id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded border border-border bg-surface-2 px-2 py-1"
                >
                  {n !== undefined ? (
                    <>
                      <span style={{ color: roleVar(n.role) }}>
                        <RoleGlyph role={n.role} size={11} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-content">{n.title}</span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-content-disabled">
                      {id}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => run("detach", detachNode(root, taskId, id))}
                    className="text-content-muted transition-colors duration-fast hover:text-danger-text"
                    title="Detach"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <FieldLabel>Parent goal</FieldLabel>
        <select
          value={link?.parentTaskId ?? ""}
          onChange={(e) => run("parent", setParent(root, taskId, e.target.value === "" ? null : e.target.value))}
          className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
        >
          <option value="">(none)</option>
          {[...otherTasksWithId.entries()].map(([id, t]) => (
            <option key={id} value={id}>
              {t.name}
            </option>
          ))}
        </select>
        {chain.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1 font-mono text-2xs text-content-muted">
            {chain.map((l, i) => (
              <span key={l.taskId} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={10} strokeWidth={1.5} />}
                {l.taskId}
              </span>
            ))}
          </p>
        )}
      </div>

      <div>
        <FieldLabel>Token ceiling</FieldLabel>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={ceilingDraft}
            onChange={(e) => setCeilingDraft(e.target.value)}
            onBlur={() => {
              const n = ceilingDraft.trim() === "" ? null : Number.parseInt(ceilingDraft, 10);
              run("ceiling", setCeiling(root, taskId, n !== null && Number.isFinite(n) ? n : null));
            }}
            placeholder="0 = unlimited"
            className="h-control w-[140px] rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content focus:border-accent"
          />
          <span className="text-2xs text-content-muted">tokens, per session launched for this task</span>
        </div>
      </div>

      {opError !== null && (
        <p className="break-words font-mono text-xs text-danger-text">
          {busyOp}: {opError}
        </p>
      )}

      <button
        type="button"
        onClick={() => setContextOpen(true)}
        className="h-control flex-none self-start rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
      >
        Preview context…
      </button>

      {contextOpen && (
        <TaskContextModal
          root={root}
          taskId={taskId}
          taskName={taskName}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  );
}
