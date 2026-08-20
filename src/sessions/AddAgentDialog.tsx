// Add-agent dialog (WO01 Block F §8.3) — picks an optional agent file, a
// name, and a working folder; nudges toward a worktree but only truly blocks
// on "not a git repository" or "an agent already holds this folder" (the
// guardrail Rust re-enforces regardless). Same modal chrome, focus trap and
// Esc-to-close discipline as HooksModal/ReviewModal — no new UI primitive.

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { useAgentsStore } from "../store/agents";
import { useSessionsStore } from "../store/sessions";
import { worktreeAdd, worktreeCheck, type WorktreeInfo } from "./api";

function agentStem(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

function slugify(s: string): string {
  const slug = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug === "" ? "agent" : slug;
}

/** WO06 §4.3 — when `taskId`/`taskContext` are supplied (from
 *  `TaskContextModal`'s Launch button), the dialog spawns THROUGH
 *  `spawnForTask` instead of `spawn`, so the session boots with the
 *  pre-compiled subgraph body and the effective ceiling already resolved by
 *  the caller. All four are optional and default to the pre-WO06 shape, so
 *  every existing call site (RosterBar's plain "Spawn agent") is unaffected. */
export function AddAgentDialog({
  root,
  onClose,
  taskId = null,
  taskContext = null,
  tokenCeiling = null,
  onSpawned,
}: {
  root: string;
  onClose: () => void;
  taskId?: string | null;
  taskContext?: string | null;
  tokenCeiling?: number | null;
  /** Fires after a successful spawn, Cowtext-side session id — only ever
   *  used by the task-launch flow. */
  onSpawned?: (sessionId: string) => void;
}) {
  const agents = useAgentsStore((s) => s.agents);
  const sessions = useSessionsStore((s) => s.sessions);
  const forTask = taskId !== null && taskContext !== null;

  const [agentFileName, setAgentFileName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  const [cwd, setCwd] = useState<string | null>(null);
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const [creatingPath, setCreatingPath] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [worktreeAddBusy, setWorktreeAddBusy] = useState(false);
  const [worktreeAddError, setWorktreeAddError] = useState<string | null>(null);

  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Trust-adjacent dialog: focus starts on Cancel so Enter never silently
  // spawns an agent before the folder is even checked.
  useEffect(() => {
    (cancelRef.current ?? panelRef.current)?.focus();
  }, []);

  const canClose = !spawning;
  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  // Agent selection drives the Name default until the user edits it by hand.
  useEffect(() => {
    if (nameTouched) return;
    setName(agentFileName === null ? "" : agentStem(agentFileName));
  }, [agentFileName, nameTouched]);

  const checkFolder = (path: string) => {
    setCwd(path);
    setWorktreeInfo(null);
    setWorktreeError(null);
    setCreatingPath(null);
    setWorktreeAddError(null);
    setWorktreeBusy(true);
    void worktreeCheck(path)
      .then((info) => {
        setWorktreeInfo(info);
        setWorktreeBusy(false);
      })
      .catch((e: unknown) => {
        setWorktreeError(String(e));
        setWorktreeBusy(false);
      });
  };

  const pickFolder = () => {
    void open({ directory: true, title: "Agent working folder" }).then((picked) => {
      if (typeof picked !== "string") return;
      checkFolder(picked);
    });
  };

  const pickWorktreeFolder = () => {
    void open({ directory: true, title: "New worktree folder" }).then((picked) => {
      if (typeof picked !== "string") return;
      setCreatingPath(picked);
      setWorktreeAddError(null);
      setBranch((b) => (b === "" ? `agent/${slugify(name)}` : b));
    });
  };

  const createWorktree = () => {
    if (cwd === null || creatingPath === null || branch.trim() === "") return;
    setWorktreeAddBusy(true);
    setWorktreeAddError(null);
    void worktreeAdd(cwd, creatingPath, branch.trim())
      .then((info) => {
        setWorktreeAddBusy(false);
        setCreatingPath(null);
        setCwd(info.path);
        setWorktreeInfo(info);
      })
      .catch((e: unknown) => {
        setWorktreeAddBusy(false);
        setWorktreeAddError(String(e));
      });
  };

  const dupCwd =
    worktreeInfo !== null && sessions.some((s) => s.alive && s.cwd === worktreeInfo.path);
  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 40;
  const canAdd =
    nameValid &&
    cwd !== null &&
    worktreeInfo !== null &&
    worktreeInfo.isRepo &&
    !dupCwd &&
    !worktreeBusy &&
    !spawning;

  const doAdd = () => {
    if (!canAdd || cwd === null) return;
    setSpawning(true);
    setSpawnError(null);
    if (forTask && taskId !== null && taskContext !== null) {
      void useSessionsStore
        .getState()
        .spawnForTask(root, agentFileName, trimmedName, cwd, taskId, taskContext, tokenCeiling)
        .then((result) => {
          setSpawning(false);
          if ("error" in result) {
            setSpawnError(result.error);
            return;
          }
          onSpawned?.(result.id);
          onClose();
        });
      return;
    }
    void useSessionsStore
      .getState()
      .spawn(root, agentFileName, trimmedName, cwd)
      .then((err) => {
        setSpawning(false);
        if (err !== null) {
          setSpawnError(err);
          return;
        }
        onClose();
      });
  };

  const inputCls =
    "h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Spawn agent"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[480px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">{forTask ? "Launch for task" : "Spawn agent"}</span>
          <div className="min-w-0 flex-1" />
          <button
            onClick={onClose}
            disabled={!canClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <div>
            <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
              Agent file
            </label>
            <select
              value={agentFileName ?? ""}
              onChange={(e) => setAgentFileName(e.target.value === "" ? null : e.target.value)}
              className={inputCls}
            >
              <option value="">(none)</option>
              {agents.map((a) => (
                <option key={a.fileName} value={a.fileName}>
                  {a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              maxLength={40}
              placeholder="agent name"
              className={inputCls}
            />
            {!nameValid && trimmedName.length === 0 && (
              <p className="mt-1 text-xs text-content-muted">Required, 1–40 characters.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
              Folder
            </label>
            <div className="flex gap-2">
              <input
                value={cwd ?? ""}
                readOnly
                placeholder="pick a working folder…"
                title={cwd ?? undefined}
                className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content-secondary placeholder:text-content-disabled [direction:rtl] [text-align:left]"
              />
              <button
                onClick={pickFolder}
                className="h-control flex-none rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
              >
                Browse…
              </button>
            </div>

            {worktreeBusy && (
              <p className="mt-1.5 text-xs text-content-muted">checking…</p>
            )}
            {worktreeError !== null && (
              <p className="mt-1.5 break-words font-mono text-xs text-danger-text">{worktreeError}</p>
            )}
            {!worktreeBusy && worktreeInfo !== null && (
              <>
                {worktreeInfo.isRepo && worktreeInfo.isWorktree && (
                  <p className="mt-1.5 font-mono text-xs text-success-text">
                    worktree · {worktreeInfo.branch ?? "detached HEAD"}
                  </p>
                )}
                {worktreeInfo.isRepo && !worktreeInfo.isWorktree && (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <p className="font-mono text-xs text-amber-text">
                      repo main working copy — a separate worktree is recommended
                    </p>
                    {creatingPath === null ? (
                      <button
                        onClick={pickWorktreeFolder}
                        className="h-control-sm w-fit rounded border border-amber-border bg-amber-surface px-2 font-mono text-2xs text-amber-text transition-colors duration-fast hover:bg-amber-surface"
                      >
                        Create worktree…
                      </button>
                    ) : (
                      <div className="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-inset p-2">
                        <p
                          className="truncate font-mono text-2xs text-content-secondary [direction:rtl] [text-align:left]"
                          title={creatingPath}
                        >
                          {creatingPath}
                        </p>
                        <div className="flex gap-2">
                          <input
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            placeholder="branch name"
                            className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 font-mono text-2xs text-content focus:border-accent"
                          />
                          <button
                            onClick={createWorktree}
                            disabled={branch.trim() === "" || worktreeAddBusy}
                            className="h-control-sm flex-none rounded bg-accent px-2 font-mono text-2xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled"
                          >
                            {worktreeAddBusy ? "· · ·" : "Create"}
                          </button>
                        </div>
                        {worktreeAddError !== null && (
                          <p className="break-words font-mono text-2xs text-danger-text">
                            {worktreeAddError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {!worktreeInfo.isRepo && (
                  <p className="mt-1.5 font-mono text-xs text-danger-text">not a git repository</p>
                )}
                {worktreeInfo.isRepo && dupCwd && (
                  <p className="mt-1.5 font-mono text-xs text-danger-text">
                    an agent is already running there
                  </p>
                )}
              </>
            )}
          </div>

          {spawnError !== null && (
            <p className="break-words font-mono text-xs text-danger-text">{spawnError}</p>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {forTask
              ? "spawns a real Claude Code session with the task's context injected"
              : "spawns a real Claude Code session in that folder"}
          </span>
          <button
            ref={cancelRef}
            onClick={onClose}
            disabled={!canClose}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={doAdd}
            disabled={!canAdd}
            className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {spawning ? "· · ·" : forTask ? "Launch" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
