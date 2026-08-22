// Run-session dialog (F3 — WO12 acceptance round 2). The single launch
// surface in the app: picks an optional agent file, a name, and a working
// folder, prefilled from whatever the user was just looking at, then
// launches a real Claude Code session. Nudges toward a worktree but only
// truly blocks on "not a git repository" or "an agent already holds this
// folder" (the guardrail Rust re-enforces regardless). Same modal chrome,
// focus trap and Esc-to-close discipline as HooksModal/ReviewModal — no new
// UI primitive.
//
// Frozen export (WO12 contract): `RunSessionDialog({ root, onClose })`. This
// used to be three surfaces — RosterBar's bare launch button, the
// Orchestrator's per-agent launch action, TaskContextModal's Launch button —
// each with its own prefill path. All three prefill paths are preserved
// HERE, derived from context at mount, not as props: per-agent
// workspace/ceiling defaults (`meta.defaultCwd`/`meta.defaultTokenCeiling`,
// previously reached only from the Orchestrator), task-context injection +
// tasklinks provenance (previously reached only from TaskContextModal's
// Launch button), and free agent choice including "(none)".

import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { metaOrDefault, useAgentsStore } from "../store/agents";
import { useSettingsStore } from "../store/settings";
import { LocalOnlyBadge } from "../ui/LocalOnlyBadge";
import { MAX_SESSIONS, useSessionsStore } from "../store/sessions";
import { useTasksStore } from "../store/tasks";
import { useTaskLinksStore } from "../store/tasklinks";
import { GRAPH_VERSION, serializeGraph, useGraphStore } from "../store/graph";
import { formatTokenCount, tokensForBytes } from "../store/tokens";
import { taskContextPreview } from "../taskctx/api";
import type { AgentDoc } from "../agents/types";
import { worktreeAdd, worktreeCheck, type WorktreeInfo } from "./api";

function agentStem(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

/** Local copy of OrchestratorView's private helper — modals/dialogs don't
 *  import across feature dirs for a three-line pure function (established
 *  idiom, see TaskContextModal's PixelMarch). */
function agentLabel(doc: AgentDoc, nickname: string): string {
  if (nickname.trim() !== "") return nickname;
  const named = doc.fields.name?.trim();
  if (named !== undefined && named !== "") return named;
  return agentStem(doc.fileName);
}

function slugify(s: string): string {
  const slug = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug === "" ? "agent" : slug;
}

/** Local copy of OrchestratorView's private helper — same idiom as
 *  `agentLabel` above. */
function formatCeiling(v: number | null): string {
  if (v === null) return "inherit";
  if (v === 0) return "unbounded";
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
}

/** WO15 §6 U4b.3 — which agent the dialog opens on: the rail's current
 *  selection first (you were just looking at it), else the last agent this
 *  machine actually ran, else "(none)". The remembered file is checked
 *  against the live roster on purpose: an agent that has since been deleted
 *  or renamed must not come back as a phantom selection that then fails at
 *  spawn time. */
function initialAgentFile(): string | null {
  const s = useAgentsStore.getState();
  if (s.selection !== null && s.selection.kind === "agent") return s.selection.key;
  const last = useSettingsStore.getState().lastRunAgentFile;
  if (last === "") return null;
  return s.agents.some((a) => a.fileName === last) ? last : null;
}

export function RunSessionDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const agentMeta = useAgentsStore((s) => s.meta);
  const sessions = useSessionsStore((s) => s.sessions);

  // ── Agent: rail selection → last run → "(none)" (see initialAgentFile) ─
  const [agentFileName, setAgentFileName] = useState<string | null>(initialAgentFile);
  const meta = metaOrDefault(agentMeta, agentFileName ?? "");

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  // ── Folder: agent's own default, else the project root ─────────────────
  // Same `initialAgentFile()` the agent field opened on, so the prefilled
  // folder always belongs to the prefilled agent.
  const [cwd, setCwd] = useState<string | null>(() => {
    const initialMeta = metaOrDefault(useAgentsStore.getState().meta, initialAgentFile() ?? "");
    return initialMeta.defaultCwd !== "" ? initialMeta.defaultCwd : root;
  });
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const [creatingPath, setCreatingPath] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [worktreeAddBusy, setWorktreeAddBusy] = useState(false);
  const [worktreeAddError, setWorktreeAddError] = useState<string | null>(null);

  // ── Task: prefilled from the board's current selection, optional ───────
  const [taskId, setTaskId] = useState<string | null>(() => {
    const sel = useTasksStore.getState().selected;
    return sel !== null && sel.taskId !== null ? sel.taskId : null;
  });
  const [taskName, setTaskName] = useState<string | null>(() => {
    const sel = useTasksStore.getState().selected;
    return sel !== null && sel.taskId !== null ? sel.name : null;
  });
  const [taskCtx, setTaskCtx] = useState<{ body: string; bytes: number } | null>(null);
  const [taskCtxError, setTaskCtxError] = useState<string | null>(null);
  const linksRoot = useTaskLinksStore((s) => s.root);
  const loadLinks = useTaskLinksStore((s) => s.load);
  const link = useTaskLinksStore((s) => (taskId !== null ? s.linkFor(taskId) : null));

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Trust-adjacent dialog: focus starts on Cancel so Enter never silently
  // launches a session before the folder is even checked.
  useEffect(() => {
    (cancelRef.current ?? panelRef.current)?.focus();
  }, []);

  const canClose = !running;
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
    if (agentFileName === null) {
      setName("");
      return;
    }
    const doc = agents.find((a) => a.fileName === agentFileName);
    const m = metaOrDefault(agentMeta, agentFileName);
    setName(doc !== undefined ? agentLabel(doc, m.nickname) : agentStem(agentFileName));
  }, [agentFileName, nameTouched, agents, agentMeta]);

  useEffect(() => {
    if (linksRoot !== root) void loadLinks(root);
  }, [root, linksRoot, loadLinks]);

  // Best-effort task-context preview, mirroring TaskContextModal's own
  // fetch — resolves the compiled body `spawnForTask` needs. A failure here
  // does not block the launch; it just falls back to a plain (task-less)
  // launch and says so.
  useEffect(() => {
    if (taskId === null) {
      setTaskCtx(null);
      setTaskCtxError(null);
      return;
    }
    let live = true;
    const s = useGraphStore.getState();
    const graphJson = serializeGraph({
      version: GRAPH_VERSION,
      projectName: s.projectName,
      nodes: s.nodes,
      edges: s.edges,
      compileTargets: s.compileTargets,
    });
    taskContextPreview(root, taskId, graphJson)
      .then((result) => {
        if (!live) return;
        if (result.errors.length > 0) {
          setTaskCtx(null);
          setTaskCtxError("subgraph unavailable");
        } else {
          setTaskCtx({ body: result.body, bytes: result.bytes });
          setTaskCtxError(null);
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        setTaskCtx(null);
        setTaskCtxError(String(e));
      });
    return () => {
      live = false;
    };
  }, [root, taskId]);

  const clearTask = () => {
    setTaskId(null);
    setTaskName(null);
  };

  // useCallback with an empty dep list is honest here: every closed-over
  // value is a setState function (stable by React's contract) or a module
  // import. That stability is what lets the mount effect below list a real
  // dependency instead of suppressing the rule.
  const checkFolder = useCallback((path: string) => {
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
  }, []);

  // The folder the dialog opened on, frozen at first render. `checkFolder`
  // re-runs on every manual Browse, so re-validating on each `cwd` change
  // would be a redundant round-trip — but reading `cwd` here would make the
  // effect claim a dependency it must not react to. The ref states the
  // intent ("the prefill, not the current value") in code, which is why the
  // eslint-disable this replaced is gone rather than moved.
  const initialCwdRef = useRef(cwd);
  useEffect(() => {
    const initial = initialCwdRef.current;
    if (initial !== null) checkFolder(initial);
  }, [checkFolder]);

  const pickFolder = () => {
    void open({ directory: true, title: "Working folder" }).then((picked) => {
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
  const atCap = sessions.filter((s) => s.alive).length >= MAX_SESSIONS;

  // ── Token ceiling ──────────────────────────────────────────────────────
  // Four sources, most specific first: what you typed for THIS run, the
  // task link's own cap, the agent's default, the app-wide default. The
  // ceiling used to be a read-only readout of the middle two, so a one-off
  // "give this run more room" meant editing the agent — the input is the
  // override, and the line under it always names which source actually won.
  // Empty = inherit, `0` = unbounded (the same wire convention
  // `Session.tokenCeiling` already uses), `n` = n.
  const [ceilingText, setCeilingText] = useState("");
  const globalCeiling = useSettingsStore((s) => s.sessionTokenCeiling);
  const trimmedCeiling = ceilingText.trim();
  const parsedCeiling = trimmedCeiling === "" ? null : Number(trimmedCeiling);
  const ceilingValid =
    parsedCeiling === null || (Number.isFinite(parsedCeiling) && parsedCeiling >= 0);
  const runCeiling = ceilingValid && parsedCeiling !== null ? Math.round(parsedCeiling) : null;

  const linkCeiling = link?.tokenCeiling ?? null;
  const agentCeiling = agentFileName !== null ? meta.defaultTokenCeiling : null;

  // What actually goes on the wire. `null` deliberately hands the last step
  // to Rust (`sessions.rs::resolve_ceiling`), which applies the same global
  // default this dialog displays — one resolver, not two that can drift.
  const wireCeiling: number | null =
    runCeiling !== null
      ? runCeiling
      : taskId !== null && linkCeiling !== null
        ? linkCeiling
        : agentCeiling;
  const ceilingSource =
    runCeiling !== null
      ? "this run"
      : taskId !== null && linkCeiling !== null
        ? "task link"
        : agentCeiling !== null
          ? "agent default"
          : "global default";
  const effectiveCeiling = wireCeiling ?? globalCeiling;

  const canAdd =
    nameValid &&
    ceilingValid &&
    cwd !== null &&
    worktreeInfo !== null &&
    worktreeInfo.isRepo &&
    !dupCwd &&
    !worktreeBusy &&
    !running &&
    !atCap;

  const forTask = taskId !== null && taskCtx !== null;

  // Remembered only after the session really starts — a failed spawn must
  // not teach the dialog to reopen on the agent that just failed.
  const rememberAgent = () => {
    useSettingsStore.getState().setLastRunAgentFile(agentFileName ?? "");
  };

  const doRun = () => {
    if (!canAdd || cwd === null) return;
    setRunning(true);
    setRunError(null);
    if (forTask && taskId !== null && taskCtx !== null) {
      void useSessionsStore
        .getState()
        .spawnForTask(root, agentFileName, trimmedName, cwd, taskId, taskCtx.body, wireCeiling)
        .then((result) => {
          setRunning(false);
          if ("error" in result) {
            setRunError(result.error);
            return;
          }
          rememberAgent();
          void useTaskLinksStore.getState().recordSession(root, taskId, result.id);
          onClose();
        });
      return;
    }
    void useSessionsStore
      .getState()
      .spawn(root, agentFileName, trimmedName, cwd, wireCeiling)
      .then((err) => {
        setRunning(false);
        if (err !== null) {
          setRunError(err);
          return;
        }
        rememberAgent();
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
        aria-label="Run session"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[480px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Run session</span>
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

          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label
                htmlFor="run-token-ceiling"
                className="font-mono text-2xs uppercase tracking-wider text-content-muted"
              >
                Token ceiling
              </label>
              {/* §7.5: a session parameter writes no file, so it says so. */}
              <LocalOnlyBadge hint="Applies to this session only" />
            </div>
            <input
              id="run-token-ceiling"
              type="number"
              min={0}
              value={ceilingText}
              onChange={(e) => setCeilingText(e.target.value)}
              placeholder="inherit"
              className={inputCls}
            />
            <p className="mt-1 font-mono text-2xs text-content-muted">
              {`Effective: ${formatCeiling(effectiveCeiling)} (from ${ceilingSource})`}
            </p>
            {!ceilingValid && (
              <p className="mt-1 text-xs text-danger-text">
                Whole number, 0 or more. Empty inherits; 0 is unbounded.
              </p>
            )}
          </div>

          {taskId !== null && (
            <div>
              <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
                Task
              </label>
              <div className="flex h-control items-center gap-2 rounded border border-border bg-surface-2 px-2">
                <span className="min-w-0 flex-1 truncate text-sm text-content" title={taskName ?? undefined}>
                  {taskName}
                </span>
                {taskCtx !== null && (
                  <span className="flex-none font-mono text-2xs text-content-muted">
                    ≈{formatTokenCount(tokensForBytes(taskCtx.bytes))} tok
                  </span>
                )}
                <button
                  onClick={clearTask}
                  title="Run without this task's context"
                  className="grid h-4 w-4 flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
                >
                  <X size={11} strokeWidth={1.5} />
                </button>
              </div>
              {taskCtxError !== null && (
                <p className="mt-1.5 break-words font-mono text-xs text-amber-text">
                  {taskCtxError} — running without it
                </p>
              )}
            </div>
          )}

          {runError !== null && (
            <p className="break-words font-mono text-xs text-danger-text">{runError}</p>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {atCap
              ? `agent limit reached (${MAX_SESSIONS})`
              : forTask
                ? "runs a real Claude Code session with the task's context injected"
                : "runs a real Claude Code session in that folder"}
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
            onClick={doRun}
            disabled={!canAdd}
            title={atCap ? `agent limit reached (${MAX_SESSIONS})` : undefined}
            className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {running ? "· · ·" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
