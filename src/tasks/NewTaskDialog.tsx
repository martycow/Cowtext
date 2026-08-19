// New Task dialog (contract Rev 2, R5) — PresetsModal shell idiom, sized
// ~560px. Composes a checklist line (`Name — description #tag… @agent P1`)
// and appends it via the tasks store; when the target is TASKS.md and a
// non-default status was picked, the freshly appended item is looked up by
// name and moved there with one `update()` call (task_append always writes
// the `[ ]`/New marker — there is no append-with-status primitive).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_FILE_NAMES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  useTasksStore,
  type TaskPriority,
  type TaskStatus,
} from "../store/tasks";
import type { TaskFileInfo } from "../tasks/api";
import { PRODUCER_FILE } from "../store/agents";
import type { AgentDoc } from "../agents/types";
import { FieldLabel } from "../agents/AgentEditor";
import { TagPicker } from "./TagPicker";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content";

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

const PRIMARY_BTN =
  "flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled";

type FileChoice = (typeof TASK_FILE_NAMES)[number];
const PRIORITIES = ["none", ...TASK_PRIORITIES] as const;
const STATUS_ORDER = TASK_STATUSES;

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded border border-border bg-surface-2 p-[2px]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`h-control-sm rounded-sm px-2 font-mono text-2xs transition-colors duration-fast ${
            value === opt ? "bg-surface-3 font-medium text-content" : "text-content-muted hover:text-content-secondary"
          }`}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}

function composeLine(
  name: string,
  description: string,
  tags: string[],
  agent: string,
  priority: TaskPriority | null,
): string {
  let line = name.trim();
  if (description.trim() !== "") line += ` — ${description.trim()}`;
  for (const tag of tags) line += ` #${tag}`;
  if (agent.trim() !== "") line += ` @${agent.trim()}`;
  if (priority !== null) line += ` !${priority}`;
  return line;
}

export function NewTaskDialog({
  root,
  files,
  agents,
  onClose,
}: {
  root: string;
  files: TaskFileInfo[];
  agents: AgentDoc[];
  onClose: () => void;
}) {
  const append = useTasksStore((s) => s.append);
  const update = useTasksStore((s) => s.update);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [file, setFile] = useState<FileChoice>("TASKS.md");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<TaskStatus>("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const relPathFor = (choice: FileChoice): string | null => {
    const idx = TASK_FILE_NAMES.indexOf(choice);
    return files[idx]?.relPath ?? null;
  };

  const canSubmit = name.trim() !== "" && !busy;

  const submit = () => {
    const relPath = relPathFor(file);
    if (relPath === null) {
      setError(`No convention slot for ${file}`);
      return;
    }
    setBusy(true);
    setError(null);
    const text = composeLine(name, description, tags, agent, priority);
    void (async () => {
      const err = await append(relPath, text);
      if (err !== null) throw new Error(err);
      if (file === "TASKS.md" && status !== "new") {
        const fresh = useTasksStore
          .getState()
          .tasks.find((t) => t.relPath === relPath && t.name === name.trim());
        if (fresh !== undefined) {
          const err2 = await update(fresh, { status });
          if (err2 !== null) throw new Error(err2);
        }
      }
    })()
      .then(onClose)
      .catch((e: unknown) => {
        setBusy(false);
        setError(String(e));
      });
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        tabIndex={-1}
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">New task</span>
          <div className="min-w-0 flex-1" />
          <span className="min-w-0 max-w-[240px] truncate font-mono text-2xs text-content-muted" title={root}>
            {root}
          </span>
          <button onClick={onClose} title="Close" className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {error !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {error}
            </div>
          )}
          <div>
            <FieldLabel>File</FieldLabel>
            <Segmented value={file} options={TASK_FILE_NAMES} onChange={setFile} />
          </div>
          <div>
            <FieldLabel>Name</FieldLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) submit();
              }}
              className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
            />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="min-h-[40px] max-h-[30vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content focus:border-accent"
            />
          </div>
          <div>
            <FieldLabel>Tags</FieldLabel>
            <TagPicker items={tags} disabled={false} onChange={setTags} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Priority</FieldLabel>
              <Segmented
                value={priority ?? "none"}
                options={PRIORITIES}
                labels={PRIORITY_LABELS}
                onChange={(v) => setPriority(v === "none" ? null : v)}
              />
            </div>
            <div>
              <FieldLabel>Agent</FieldLabel>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
              >
                <option value="">Producer</option>
                {agents
                  .filter((a) => a.fileName !== PRODUCER_FILE)
                  .map((a) => {
                    const label = a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName;
                    return (
                      <option key={a.fileName} value={label}>
                        {label}
                      </option>
                    );
                  })}
              </select>
            </div>
          </div>
          {file === "TASKS.md" && (
            <div>
              <FieldLabel>Status</FieldLabel>
              <Segmented value={status} options={STATUS_ORDER} labels={STATUS_LABELS} onChange={setStatus} />
            </div>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            Appends a checklist line to {file}.
          </span>
          <button ref={cancelRef} onClick={onClose} disabled={busy} className={SECONDARY_BTN}>
            Cancel
          </button>
          <button onClick={submit} disabled={!canSubmit} className={PRIMARY_BTN}>
            {busy ? "· · ·" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
