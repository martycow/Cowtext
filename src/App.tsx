import { useEffect, useRef, useState, Suspense, lazy } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  FileOutput,
  FolderOpen,
  Gem,
  GitBranch,
  Home,
  Import as ImportIcon,
  Info,
  MousePointer2,
  Package,
  Play,
  Redo2,
  Send,
  Settings,
  Sparkles,
  Undo2,
  Users,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useProjectStore } from "./store/project";
import {
  sameRelPath,
  useGraphStore,
  type CompileTarget,
  type SaveState,
} from "./store/graph";
import { ProjectWizard, type ProjectWizardMode } from "./project/ProjectWizard";
import { initEventListener } from "./store/events";
import { initSessionsListener, MAX_SESSIONS, useSessionsStore } from "./store/sessions";
import { useReviewStore } from "./store/review";
import { pinnedContextTokens } from "./store/tokens";
import { GraphCanvas } from "./canvas/GraphCanvas";
import { EventLog } from "./inspector/EventLog";
import { ProblemsPanel } from "./inspector/ProblemsPanel";
import { RosterBar } from "./sessions/RosterBar";
import { FileRail } from "./rail/Hierarchy";
// Lazy-loaded for code splitting
const Inspector = lazy(() => import("./inspector/Inspector").then(m => ({ default: m.Inspector })));
const CompileModal = lazy(() => import("./compile/CompileModal").then(m => ({ default: m.CompileModal })));
const BarnScene = lazy(() => import("./scene/BarnScene").then(m => ({ default: m.BarnScene })));
const SettingsModal = lazy(() => import("./settings/SettingsModal").then(m => ({ default: m.SettingsModal })));
const PresetsModal = lazy(() => import("./preset/PresetsModal").then(m => ({ default: m.PresetsModal })));
const HandoffModal = lazy(() => import("./handoff/HandoffModal").then(m => ({ default: m.HandoffModal })));
const TasksBoard = lazy(() => import("./tasks/TasksBoard").then(m => ({ default: m.TasksBoard })));
const OrchestratorView = lazy(() =>
  import("./orchestrator/OrchestratorView").then((m) => ({ default: m.OrchestratorView })),
);
const ReviewModal = lazy(() => import("./review/ReviewModal").then(m => ({ default: m.ReviewModal })));
const ImportReviewModal = lazy(() =>
  import("./import/ImportReviewModal").then((m) => ({ default: m.ImportReviewModal })),
);
// WO11 G2 — git init + .gitignore composer (UI-A's frozen seam, §5.10),
// mounted from the project row's context menu and the topbar's Git button.
const GitWizard = lazy(() => import("./git/GitWizard").then((m) => ({ default: m.GitWizard })));
// WO12 F3 — the Run button's context-prefilled launch dialog. File kept as
// AddAgentDialog.tsx (avoids git churn) but the export is RunSessionDialog.
const RunSessionDialog = lazy(() =>
  import("./sessions/AddAgentDialog").then((m) => ({ default: m.RunSessionDialog })),
);
// WO12 F7 — the always-on assemble/refine/summarize trust-boundary gate.
const AssembleConfirmModal = lazy(() =>
  import("./assemble/AssembleConfirmModal").then((m) => ({ default: m.AssembleConfirmModal })),
);
// WO12 F2 — surfaces a session's COWTEXT_ASK question and replies inline.
const AgentQuestionModal = lazy(() =>
  import("./sessions/AgentQuestionModal").then((m) => ({ default: m.AgentQuestionModal })),
);
import { flushSettings, PANEL_LIMITS, useSettingsStore, type RecentProject } from "./store/settings";
import { flushAgentSave, flushMetaSave, useAgentsStore } from "./store/agents";
import { initSfx } from "./scene/sfx";
import { probeProjectDirs, revealPath } from "./fs/api";
import { ResizeHandle } from "./ui/ResizeHandle";
import { ContextMenu } from "./ui/ContextMenu";
import { useContextMenu } from "./ui/useContextMenu";
import type { MenuItem } from "./ui/menuTypes";
// WO12 F1 — the toast channel. NOT lazy: it must already be present before
// the first failure that would want to raise a toast can occur, and it is
// small (~2 KB) — no code-splitting benefit worth the mount-order risk.
import { ToastHost } from "./ui/ToastHost";

/** The three faces of an open project: the graph editor, the barn monitor,
 *  and the tasks board. */
type View = "canvas" | "barn" | "tasks" | "orchestrator";

/** Minimal loading fallback for lazy-loaded components (dark-themed, pixel-based). */
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center gap-2 p-4">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-blink bg-amber"
            style={{ animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }}
          />
        ))}
        <span className="h-2 w-2 bg-border" />
      </div>
    </div>
  );
}

/** Canvas ⇄ Barn segmented control (DESIGN_SPEC: 2px padding frame on
 *  surface-2, active segment surface-3, compact 24px segments). One click,
 *  always visible while a project is open — no shortcut needed. */
const VIEW_TITLES: Record<View, string> = {
  canvas: "Edit the context graph",
  barn: "Watch the agent in the barn",
  tasks: "Browse TASKS / BACKLOG / ROADMAP / BUGS",
  orchestrator: "The fleet — per-agent workspace, budget and live sessions",
};

function ViewToggle({
  view,
  onChange,
  managerMode,
}: {
  view: View;
  onChange: (v: View) => void;
  /** N3: manager mode hides Barn entirely — pure context-graph/agents UI. */
  managerMode: boolean;
}) {
  const seg = (v: View, label: string) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      title={VIEW_TITLES[v]}
      className={`flex h-control-sm items-center rounded-sm px-3 text-sm transition-colors duration-fast ${
        view === v
          ? "bg-surface-3 font-medium text-content"
          : "text-content-muted hover:text-content-secondary"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-none items-center gap-0.5 rounded border border-border bg-surface-2 p-[2px]">
      {seg("canvas", "Canvas")}
      {!managerMode && seg("barn", "Barn")}
      {seg("tasks", "Tasks")}
      {seg("orchestrator", "Agents")}
    </div>
  );
}

/** 4×4 amber pixel mark with knocked-out cow spots — the only mascot moment in the chrome. */
function PixelLogo() {
  const spots = new Set([0, 3, 9, 10]);
  return (
    <div className="grid h-4 w-4 flex-none grid-cols-4 grid-rows-4">
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} className={spots.has(i) ? "bg-surface-1" : "bg-amber"} />
      ))}
    </div>
  );
}

function projectName(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
}

const SAVE_LABEL: Record<SaveState, string | null> = {
  idle: null,
  dirty: "unsaved",
  saving: "saving…",
  saved: "saved",
  error: "save failed",
};

function SaveIndicator() {
  const saveState = useGraphStore((s) => s.saveState);
  const label = SAVE_LABEL[saveState];
  if (label === null) return null;
  return (
    <span
      className={`flex items-center gap-1.5 font-mono text-2xs ${
        saveState === "error" ? "text-danger-text" : "text-content-muted"
      }`}
      title=".cowtext/graph.json"
    >
      <span
        className={`h-1.5 w-1.5 rounded-pill ${
          saveState === "error"
            ? "bg-danger"
            : saveState === "saved"
              ? "bg-success"
              : "bg-content-muted"
        }`}
      />
      {label}
    </span>
  );
}

/** ≈N tok pinned (contract §8) — chars/4 estimate over pinned nodes, labeled
 *  as an estimate since real token accounting needs Work Order Block F. */
function PinnedTokenChip() {
  const nodes = useGraphStore((s) => s.nodes);
  const files = useProjectStore((s) => s.files);
  const tokens = pinnedContextTokens(nodes, files);
  return (
    <span
      title="estimate, chars/4 · window ~200k"
      className="flex-none rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-content-muted"
    >
      ≈{tokens.toLocaleString()} tok pinned
    </span>
  );
}

/** Undo/redo icon buttons (contract §5) — disabled state mirrors the graph
 *  store's canUndo/canRedo; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z are wired at the
 *  Workspace level so they work regardless of which panel has focus. */
function UndoRedoButtons() {
  const canUndo = useGraphStore((s) => s.canUndo);
  const canRedo = useGraphStore((s) => s.canRedo);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  return (
    <div className="flex flex-none items-center gap-1">
      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="grid h-control w-control place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
      >
        <Undo2 size={14} strokeWidth={1.5} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        className="grid h-control w-control place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
      >
        <Redo2 size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** N2: Compile split-button — the main face keeps today's behaviour
 *  (compile whatever the graph's compileTargets currently are); the chevron
 *  opens a dropdown of the three targets, each icon-labelled, and picking
 *  one opens the Compile modal locked to just that target with the preview
 *  auto-run (CompileModal's `lockedTarget` prop). Positioned like RoleField's
 *  popup (button rect → x/y), not a right-click menu, so it opens on a plain
 *  click of the chevron. */
const COMPILE_TARGET_META: Record<CompileTarget, { label: string; icon: LucideIcon }> = {
  claude: { label: "CLAUDE.md", icon: Bot },
  agents: { label: "AGENTS.md", icon: Users },
  cursor: { label: ".cursor/rules", icon: MousePointer2 },
  copilot: { label: ".github/copilot-instructions.md", icon: Wand2 },
  gemini: { label: "GEMINI.md", icon: Gem },
};
const COMPILE_TARGET_ORDER: readonly CompileTarget[] = [
  "claude",
  "agents",
  "cursor",
  "copilot",
  "gemini",
];

function CompileSplitButton({
  onCompile,
  disabled,
}: {
  onCompile: (lockedTarget?: CompileTarget) => void;
  disabled: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  // Anchored on the whole split-button's left edge (not just the chevron)
  // so the dropdown reads as belonging to "Compile", not floating off a
  // 20px sliver — same left/bottom+4 anchor idiom as RoleField's popup.
  const openMenu = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setOpen({ x: rect.left, y: rect.bottom + 4 });
  };

  const items: MenuItem[] = COMPILE_TARGET_ORDER.map((t) => ({
    kind: "item",
    id: t,
    label: COMPILE_TARGET_META[t].label,
    icon: COMPILE_TARGET_META[t].icon,
    onSelect: () => onCompile(t),
  }));

  return (
    <div ref={wrapRef} className="flex flex-none">
      <button
        onClick={() => onCompile()}
        disabled={disabled}
        title={disabled ? "The graph is empty" : "Preview and write generated files"}
        className="flex h-control items-center gap-1.5 rounded-l border border-r-0 border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
      >
        <FileOutput size={14} strokeWidth={1.5} />
        Compile
      </button>
      <button
        ref={chevronRef}
        onClick={openMenu}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        title="Compile a single target"
        className="grid h-control w-[20px] flex-none place-items-center rounded-r border border-border bg-surface-2 text-content-muted transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 hover:text-content disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
      >
        <ChevronDown size={11} strokeWidth={1.5} />
      </button>
      {open !== null && (
        <ContextMenu
          x={open.x}
          y={open.y}
          items={items}
          onClose={() => {
            setOpen(null);
            chevronRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function TopBar({
  onCompile,
  onRun,
  onSettings,
  onPresets,
  onHandoff,
  onImport,
  onProjectProps,
  onGit,
  onHome,
  view,
  onViewChange,
}: {
  onCompile: (lockedTarget?: CompileTarget) => void;
  onRun: () => void;
  onSettings: () => void;
  onPresets: () => void;
  onHandoff: () => void;
  onImport: () => void;
  onProjectProps: () => void;
  onGit: () => void;
  onHome: () => void;
  view: View;
  onViewChange: (v: View) => void;
}) {
  const { root, openProject } = useProjectStore();
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const managerMode = useSettingsStore((s) => s.managerMode);
  // F3 — same MAX_SESSIONS/atCap idiom as RosterBar's now-removed launch
  // button and RunSessionDialog's own gate; kept in sync deliberately.
  const aliveSessionCount = useSessionsStore((s) => s.sessions.filter((x) => x.alive).length);
  const atCap = aliveSessionCount >= MAX_SESSIONS;
  return (
    <header className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle bg-surface-1 px-4">
      <PixelLogo />
      <span className="font-pixel text-xs tracking-wide">cowtext</span>
      {root !== null && (
        <>
          <span className="text-content-disabled">/</span>
          <span className="text-base font-medium">{projectName(root)}</span>
          <span
            className="hidden truncate font-mono text-2xs text-content-muted md:block"
            title={root}
          >
            {root}
          </span>
        </>
      )}
      <div className="flex-1" />
      {/* WO11 G1 — house icon, left of the view segments. Closes the project
          and returns to the title screen; live agent sessions keep running
          (App.tsx's confirm strip handles the warning, not this button). */}
      {root !== null && (
        <button
          onClick={onHome}
          title="Close project and return to the title screen"
          className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <Home size={14} strokeWidth={1.5} />
        </button>
      )}
      {root !== null && (
        <ViewToggle view={view} onChange={onViewChange} managerMode={managerMode} />
      )}
      <div className="flex-1" />
      {root !== null && <PinnedTokenChip />}
      {root !== null && <SaveIndicator />}
      {root !== null && <UndoRedoButtons />}
      {root !== null && <CompileSplitButton onCompile={onCompile} disabled={nodeCount === 0} />}
      {/* WO12 F3 — Run. The pipeline reads Compile -> Run left to right; Run
          is the bar's only accent-filled control (blue = user-initiated,
          per the two-accent law). Opens RunSessionDialog prefilled from
          current context (selected agent, task, cwd, ceiling). */}
      {root !== null && (
        <button
          onClick={onRun}
          disabled={atCap}
          title={atCap ? `agent limit reached (${MAX_SESSIONS})` : "Run — launch a Claude session"}
          className="flex h-control flex-none items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
        >
          <Play size={14} strokeWidth={1.5} />
          Run
        </button>
      )}
      {/* WO10 (INPUT_PROMPT 08/19 item 10) — the project's own properties.
          Written by the title-screen wizard, edited here; they compile into
          the pinned context/project.md Memory Node. */}
      {root !== null && (
        <button
          onClick={onProjectProps}
          title="Project properties — name, brief, requirements, hard rules"
          className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <Gem size={14} strokeWidth={1.5} />
        </button>
      )}
      {/* WO11 G2 — reaches GitWizard (git init + .gitignore composer). The
          contract names a "topbar overflow menu"; with exactly one item to
          hold, a single icon button matches this bar's existing idiom
          (Project properties, Import, Presets, Handoff are all standalone
          buttons too) instead of standing up generic overflow-menu chrome
          for one entry — see the final report for this deviation. */}
      {root !== null && (
        <button
          onClick={onGit}
          title="Git — initialize a repository or edit .gitignore"
          className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <GitBranch size={14} strokeWidth={1.5} />
        </button>
      )}
      {root !== null && (
        <button
          onClick={onImport}
          title="Scan CLAUDE.md / AGENTS.md / .cursor/rules for un-managed context to adopt"
          className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <ImportIcon size={14} strokeWidth={1.5} />
        </button>
      )}
      {root !== null && (
        <button
          onClick={onPresets}
          title="Save or apply graph presets"
          className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <Package size={14} strokeWidth={1.5} />
          Presets
        </button>
      )}
      {root !== null && (
        <button
          onClick={onHandoff}
          disabled={nodeCount === 0}
          title={nodeCount === 0 ? "The graph is empty" : "Generate a session handoff document"}
          className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
        >
          <Send size={14} strokeWidth={1.5} />
          Handoff
        </button>
      )}
      <button
        onClick={onSettings}
        aria-label="Settings"
        title="Settings"
        className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
      >
        <Settings size={14} strokeWidth={1.5} />
      </button>
      <button
        onClick={() => void openProject()}
        className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
      >
        <FolderOpen size={14} strokeWidth={1.5} />
        Open folder
      </button>
    </header>
  );
}

/** Relative last-opened, coarse — "today", "3 days ago", falling back to a
 *  date once it's old enough that a relative phrase stops being useful. */
function relativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const day = 86_400_000;
  if (diffMs < day) return "today";
  const days = Math.floor(diffMs / day);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
}

function RecentProjectRow({ project, missing }: { project: RecentProject; missing: boolean }) {
  const openProjectAt = useProjectStore((s) => s.openProjectAt);
  const removeRecentProject = useSettingsStore((s) => s.removeRecentProject);
  const contextMenu = useContextMenu();
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op."
  const [revealError, setRevealError] = useState<string | null>(null);

  const open = () => {
    if (missing) return;
    void openProjectAt(project.root);
  };

  const openMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = [
      { kind: "item", id: "open", label: "Open", icon: FolderOpen, disabled: missing, hint: missing ? "folder not found" : undefined, onSelect: open },
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        disabled: missing,
        hint: missing ? "folder not found" : undefined,
        onSelect: () => {
          setRevealError(null);
          void revealPath(project.root, null).catch((err: unknown) => setRevealError(String(err)));
        },
      },
      { kind: "separator", id: "sep-1" },
      {
        kind: "item",
        id: "remove",
        label: "Remove from list",
        icon: X,
        danger: true,
        onSelect: () => removeRecentProject(project.root),
      },
    ];
    contextMenu.openAt(e, items);
  };

  return (
    <li onContextMenu={openMenu} className="group flex flex-col">
      <div
        onClick={open}
        className={`flex h-row items-center gap-2 px-3 ${
          missing ? "cursor-default opacity-60" : "cursor-default hover:bg-[var(--surface-hover)]"
        }`}
      >
        <FolderOpen size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
        <span className="min-w-0 flex-1 truncate text-sm text-content">{project.name}</span>
        <span
          dir="rtl"
          title={project.root}
          className="hidden min-w-0 max-w-[220px] truncate font-mono text-2xs text-content-muted md:block"
        >
          {project.root}
        </span>
        {missing && (
          <span className="flex-none rounded-sm bg-danger-surface px-1 py-px font-mono text-micro text-danger-text">
            missing
          </span>
        )}
        <span className="flex-none font-mono text-2xs text-content-disabled">
          {relativeTime(project.lastOpenedMs)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeRecentProject(project.root);
          }}
          title="Remove from list"
          className="hidden h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content group-hover:grid"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      {revealError !== null && (
        <div className="flex items-center gap-2 border-t border-border-subtle bg-danger-surface px-3 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-danger-text">
            {revealError}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevealError(null);
            }}
            title="Dismiss"
            className="grid h-3.5 w-3.5 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
          >
            <X size={10} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {contextMenu.menu !== null && (
        <ContextMenu
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          items={contextMenu.menu.items}
          onClose={contextMenu.close}
        />
      )}
    </li>
  );
}

/** Up to 8 rows, newest first (contract §7.7). Absent entirely when the
 *  list is empty — the first-run empty state is unchanged. */
function RecentProjects() {
  const recentProjects = useSettingsStore((s) => s.recentProjects);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (recentProjects.length === 0) return;
    let live = true;
    void probeProjectDirs(recentProjects.map((p) => p.root)).then((exists) => {
      if (!live) return;
      const next = new Set<string>();
      recentProjects.forEach((p, i) => {
        if (exists[i] === false) next.add(p.root);
      });
      setMissing(next);
    });
    return () => {
      live = false;
    };
    // Re-probe only when the list identity (roots) changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentProjects.map((p) => p.root).join("|")]);

  if (recentProjects.length === 0) return null;

  return (
    <div className="w-full max-w-[520px]">
      <div className="mb-1 px-1 font-mono text-2xs uppercase tracking-wider text-content-muted">
        Recent
      </div>
      <ul className="rounded-lg border border-border-subtle bg-surface-1">
        {recentProjects.map((p) => (
          <RecentProjectRow key={p.root} project={p} missing={missing.has(p.root)} />
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ onWizard }: { onWizard: (mode: ProjectWizardMode) => void }) {
  const { openProject } = useProjectStore();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto py-8">
      <div
        className="grid h-[58px] w-[88px] place-items-center border border-dashed border-border-strong"
        style={{
          background:
            "repeating-linear-gradient(135deg, rgba(232,163,61,.05) 0 6px, transparent 6px 12px)",
        }}
      >
        <span className="font-mono text-micro text-content-muted">cow art</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Open a project</h1>
      <p className="max-w-[360px] text-center text-base leading-relaxed text-content-secondary">
        Pick a folder and Cowtext will find every markdown file in it. Adopt them as memory
        nodes, wire the graph, and the herd has a barn.
      </p>
      {/* WO10 (INPUT_PROMPT 08/19 items 7-8) — three doors, not one. "Open
          folder" only helps with a project Cowtext already knows; the other
          two are the states a new user is actually in. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => void openProject()}
          className="flex h-control-lg items-center gap-2 rounded bg-accent px-4 text-base font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
        >
          <FolderOpen size={15} strokeWidth={1.8} />
          Open folder
        </button>
        <button
          onClick={() => onWizard("new")}
          className="flex h-control-lg items-center gap-2 rounded border border-border bg-surface-2 px-4 text-base text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <Sparkles size={15} strokeWidth={1.8} />
          New project
        </button>
        <button
          onClick={() => onWizard("convert")}
          title="Scaffold Cowtext's files alongside an existing project, then import its context"
          className="flex h-control-lg items-center gap-2 rounded border border-border bg-surface-2 px-4 text-base text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <Workflow size={15} strokeWidth={1.8} />
          Convert existing
        </button>
      </div>
      <RecentProjects />
    </div>
  );
}

/** 4-step amber pixel march — never a spinner (DESIGN_SPEC.md). */
function Scanning({ caption }: { caption: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-blink bg-amber"
            style={{ animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }}
          />
        ))}
        <span className="h-2 w-2 bg-border" />
      </div>
      <span className="font-pixel text-micro tracking-wide text-amber-text">{caption}</span>
    </div>
  );
}

/** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (contract §5) — skipped while focus is in
 *  an input/textarea/contenteditable/CodeMirror so typing "z" never fights
 *  a text field. */
function isEditableTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.hasAttribute("contenteditable")) return true;
  return el.closest(".cm-editor") !== null;
}

/** WO13 N-F/E-F — one-time strip shown the first time a project's
 *  `graph.json` is loaded on an older schema version. Accent (blue), not
 *  amber: this is Cowtext's own one-shot upgrade, not a live agent action or
 *  a warning — "blue is you" per the design idiom, and the migration was the
 *  app acting on the user's behalf, not something to be wary of. Dismissal
 *  persists per-project ({@link useProjectStore}'s `dismissMigrationBanner`
 *  keys off `root`, so it stays dismissed across restarts).
 *
 *  `nodesNeedingReview` beyond zero also renders a `Review` button —
 *  clicking it is the "one action" §N-F/E-F acceptance requires; the
 *  file-rail chip below is the SECOND entry point that survives dismissal. */
function MigrationBanner({ onNavigate }: { onNavigate: () => void }) {
  const migration = useProjectStore((s) => s.migration);
  const dismissed = useProjectStore((s) => s.migrationBannerDismissed);
  const dismiss = useProjectStore((s) => s.dismissMigrationBanner);
  const focusNeedsReview = useProjectStore((s) => s.focusNeedsReview);
  const [expanded, setExpanded] = useState(false);

  if (migration === null || migration === undefined || dismissed) return null;

  const breakdown = [
    ...Object.entries(migration.byRoleChange).map(([k, n]) => `${n}× ${k}`),
    ...Object.entries(migration.byEdgeChange).map(([k, n]) => `${n}× ${k}`),
  ];

  return (
    <div className="flex flex-col flex-none border-b border-border-subtle bg-accent-surface">
      <div className="flex h-[31px] flex-none items-center gap-2 px-4">
        <Info size={13} strokeWidth={1.5} className="flex-none text-accent-text" />
        <span className="truncate font-mono text-xs text-accent-text">
          {migration.totalNodes} node{migration.totalNodes === 1 ? "" : "s"} migrated to the new
          format
          {migration.nodesNeedingReview > 0 &&
            ` · ${migration.nodesNeedingReview} need${migration.nodesNeedingReview === 1 ? "s" : ""} review`}
        </span>
        <div className="flex-1" />
        {breakdown.length > 0 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex h-control-sm items-center gap-1 rounded border border-accent-border bg-surface-1 px-2 text-xs text-accent-text transition-colors duration-fast hover:bg-surface-2"
          >
            Details
            {expanded ? (
              <ChevronUp size={11} strokeWidth={1.5} />
            ) : (
              <ChevronDown size={11} strokeWidth={1.5} />
            )}
          </button>
        )}
        {migration.nodesNeedingReview > 0 && (
          <button
            onClick={() => {
              focusNeedsReview();
              onNavigate();
            }}
            className="flex h-control-sm items-center rounded border border-accent-border bg-surface-1 px-2 text-xs font-medium text-accent-text transition-colors duration-fast hover:bg-surface-2"
          >
            Review {migration.nodesNeedingReview}
          </button>
        )}
        <button
          onClick={dismiss}
          title="Dismiss"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-accent-text transition-colors duration-fast hover:bg-surface-2"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-accent-border px-4 py-1.5 font-mono text-2xs text-accent-text">
          {breakdown.join(" · ")}
          {migration.edgesDropped > 0 &&
            ` · ${migration.edgesDropped} edge${migration.edgesDropped === 1 ? "" : "s"} collapsed`}
        </div>
      )}
    </div>
  );
}

/** Disk-change review strip (WO01 Block C §T4) — amber-surface because this
 *  is the agent/warning channel (something outside Cowtext touched a
 *  managed file), never the blue user-action accent. Dismiss all is armed
 *  in two clicks: nothing destructive happens from a single misclick. */
function ReviewBanner() {
  const queueLen = useReviewStore((s) => s.queue.length);
  const reviewNext = useReviewStore((s) => s.reviewNext);
  const dismissAll = useReviewStore((s) => s.dismissAll);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (queueLen === 0) setArmed(false);
  }, [queueLen]);

  if (queueLen === 0) return null;

  return (
    <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-amber-surface px-4">
      <span className="h-1.5 w-1.5 flex-none rounded-pill bg-amber" />
      <span className="truncate font-mono text-xs text-amber-text">
        {queueLen} file{queueLen === 1 ? "" : "s"} changed on disk
      </span>
      <div className="flex-1" />
      <button
        onClick={() => reviewNext()}
        className="flex h-control-sm items-center rounded border border-amber-border bg-surface-1 px-2 text-xs font-medium text-amber-text transition-colors duration-fast hover:bg-surface-2"
      >
        Review next
      </button>
      {armed ? (
        <button
          onClick={() => {
            dismissAll();
            setArmed(false);
          }}
          className="flex h-control-sm items-center rounded border border-danger bg-danger-surface px-2 text-xs font-medium text-danger-text transition-colors duration-fast hover:bg-danger hover:text-content-inverse"
        >
          Confirm dismiss all?
        </button>
      ) : (
        <button
          onClick={() => setArmed(true)}
          className="flex h-control-sm items-center rounded border border-border bg-surface-1 px-2 text-xs text-content-secondary transition-colors duration-fast hover:border-border-strong"
        >
          Dismiss all
        </button>
      )}
    </div>
  );
}

/** WO11 G1 — Home's confirm strip. Marty's ratified decision (contract §5.9,
 *  ASK #3): warn, naming the live session count, then go Home with those
 *  sessions still running — Home never kills them. Amber because this is the
 *  agent-liveness channel ("N sessions keep running"), same idiom as
 *  ReviewBanner's amber-surface strip for "something outside Cowtext". */
function HomeConfirmBanner({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-amber-surface px-4">
      <span className="h-1.5 w-1.5 flex-none rounded-pill bg-amber" />
      <span className="truncate font-mono text-xs text-amber-text">
        {count} agent session{count === 1 ? "" : "s"} keep running in the background
      </span>
      <div className="flex-1" />
      <button
        onClick={onConfirm}
        className="flex h-control-sm items-center rounded border border-amber-border bg-surface-1 px-2 text-xs font-medium text-amber-text transition-colors duration-fast hover:bg-surface-2"
      >
        Go home
      </button>
      <button
        onClick={onCancel}
        className="flex h-control-sm items-center rounded border border-border bg-surface-1 px-2 text-xs text-content-secondary transition-colors duration-fast hover:border-border-strong"
      >
        Cancel
      </button>
    </div>
  );
}

/** N4: slim status strip, the very bottom of the window — N/M straight from
 *  the graph store, J the review queue length (shrinks on Accept/Revert/
 *  dismiss), K the session's running external-change counter (only resets
 *  on a project switch, see review.ts). Mono micro, muted — a status line,
 *  never a call to action. */
function StatusBar() {
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const edgeCount = useGraphStore((s) => s.edges.length);
  const changedCount = useReviewStore((s) => s.externalChangeCount);
  const toReviewCount = useReviewStore((s) => s.queue.length);
  return (
    <div className="flex h-control-sm flex-none items-center border-t border-border-subtle bg-surface-1 px-3">
      <span className="font-mono text-micro text-content-muted">
        {nodeCount} node{nodeCount === 1 ? "" : "s"} · {edgeCount} edge{edgeCount === 1 ? "" : "s"} ·{" "}
        {changedCount} changed on disk · {toReviewCount} to review
      </span>
    </div>
  );
}

function Workspace({
  root,
  view,
  onEditProject,
  onOpenGit,
  onNeedsReview,
}: {
  root: string;
  view: View;
  onEditProject: () => void;
  onOpenGit: () => void;
  onNeedsReview: () => void;
}) {
  const loaded = useGraphStore((s) => s.loaded);
  const loadError = useGraphStore((s) => s.loadError);
  // The agent panel is reachable from any view, including the barn — without
  // this, selecting a roster card while watching the barn has no visible effect.
  const sessionSelected = useSessionsStore((s) => s.selectedId !== null);
  // N3: defense-in-depth — even if `view` somehow still says "barn" (e.g. a
  // settings load racing a restored view), manager mode must never mount
  // BarnScene/Pixi.
  const managerMode = useSettingsStore((s) => s.managerMode);
  const barnView = view === "barn" && !managerMode;
  const leftPanelCollapsed = useSettingsStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useSettingsStore((s) => s.leftPanelWidth);
  const setLeftPanelWidth = useSettingsStore((s) => s.setLeftPanelWidth);
  const rightPanelWidth = useSettingsStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useSettingsStore((s) => s.setRightPanelWidth);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (!isUndo && !isRedo) return;
      if (isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      if (isUndo) useGraphStore.getState().undo();
      else useGraphStore.getState().redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <FileRail
        root={root}
        onEditProject={onEditProject}
        onOpenGit={onOpenGit}
        onNeedsReview={onNeedsReview}
      />
      {!leftPanelCollapsed && (
        <ResizeHandle
          value={leftPanelWidth}
          defaultValue={PANEL_LIMITS.leftDefault}
          side="left"
          onChange={setLeftPanelWidth}
          label="Resize file panel"
        />
      )}
      <main className="relative min-w-0 flex-1 bg-surface-canvas">
        {loadError !== null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <p className="text-sm text-danger-text">Could not read .cowtext/graph.json</p>
            <p className="max-w-[420px] text-center font-mono text-xs text-content-muted">
              {loadError}
            </p>
            <p className="text-xs text-content-muted">
              Fix or delete the file, then reopen the folder. Nothing is overwritten while
              this error stands.
            </p>
          </div>
        ) : loaded ? (
          <>
            {/* The canvas stays mounted (hidden) in Barn/Tasks view so the
                React Flow viewport survives toggling; the Pixi scene and the
                tasks board mount on demand and unmount cleanly on the way
                out. */}
            <div className={view === "canvas" ? "h-full" : "hidden"}>
              <GraphCanvas />
            </div>
            {barnView && (
              <Suspense fallback={<LoadingFallback />}>
                <BarnScene />
              </Suspense>
            )}
            {view === "tasks" && (
              <Suspense fallback={<LoadingFallback />}>
                <div className="flex h-full flex-col">
                  <TasksBoard root={root} />
                </div>
              </Suspense>
            )}
            {view === "orchestrator" && (
              <Suspense fallback={<LoadingFallback />}>
                <div className="flex h-full flex-col">
                  <OrchestratorView root={root} />
                </div>
              </Suspense>
            )}
          </>
        ) : (
          <div className="flex h-full">
            <Scanning caption="the cow is reading" />
          </div>
        )}
      </main>
      {loaded &&
        loadError === null &&
        (view === "canvas" || view === "tasks" || (barnView && sessionSelected)) && (
        <>
          <ResizeHandle
            value={rightPanelWidth}
            defaultValue={PANEL_LIMITS.rightDefault}
            side="right"
            onChange={setRightPanelWidth}
            label="Resize inspector panel"
          />
          <Suspense fallback={<div style={{ width: rightPanelWidth }} className="flex-none bg-surface-1" />}>
            <Inspector root={root} onOpenGit={onOpenGit} />
          </Suspense>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { root, scanning, error } = useProjectStore();
  const loadGraph = useGraphStore((s) => s.loadGraph);
  // WO12 F5 tail gate — see pendingStarterAdoptRoot below.
  const graphLoaded = useGraphStore((s) => s.loaded);
  const reviewing = useReviewStore((s) => s.reviewing !== null);
  const [compileOpen, setCompileOpen] = useState(false);
  // N2 split-button: which single target (if any) the modal is locked to.
  const [compileLockedTarget, setCompileLockedTarget] = useState<CompileTarget | undefined>(
    undefined,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // WO10 (INPUT_PROMPT 08/19 items 7-8) — the title-screen wizards. `null`
  // = closed. `pendingImportRoot` carries the "convert" flow's second half:
  // the importer can only run once the project is actually open, so the
  // wizard records the intent and the effect below acts on it when the
  // scan lands.
  const [wizardMode, setWizardMode] = useState<ProjectWizardMode | null>(null);
  const [pendingImportRoot, setPendingImportRoot] = useState<string | null>(null);
  // WO12 F5 tail — starter-node adoption. Same "record intent, act once the
  // graph load lands" pattern as `pendingImportRoot` just above: checking
  // node count right after `openProjectAt` resolves would race the loadGraph
  // effect below (which resets nodes to [] and reloads asynchronously), so
  // this is compared against `loaded` too, not just `root`.
  const [pendingStarterAdoptRoot, setPendingStarterAdoptRoot] = useState<string | null>(null);
  const [view, setView] = useState<View>("canvas");
  // WO11 G2 — GitWizard (init + .gitignore composer).
  const [gitWizardOpen, setGitWizardOpen] = useState(false);
  // WO12 F3 — Run button's launch dialog.
  const [runOpen, setRunOpen] = useState(false);
  // WO11 G1 — Home's confirm strip. `null` = not showing; a number = the
  // live-session count named in the strip at the moment Home was clicked.
  const [homeConfirmCount, setHomeConfirmCount] = useState<number | null>(null);

  // A new project always opens on the canvas.
  useEffect(() => {
    setView("canvas");
  }, [root]);

  // N3: turning manager mode on while watching the barn falls back to the
  // canvas — Barn is never a reachable view once the toggle is on.
  const managerMode = useSettingsStore((s) => s.managerMode);
  useEffect(() => {
    if (managerMode) setView((v) => (v === "barn" ? "canvas" : v));
  }, [managerMode]);

  // Project opened → load (or start) its graph, and scan .claude/ agents.
  useEffect(() => {
    if (root !== null) {
      void loadGraph(root);
      void useAgentsStore.getState().loadAgents(root);
    }
  }, [root, loadGraph]);

  // Second half of the "convert existing project" flow (WO10). The importer
  // needs an OPEN project — it scans the root and proposes nodes against the
  // live graph — so the wizard can only record the intent and this effect
  // acts on it once the open actually lands. Compared against the root the
  // wizard picked, not merely "root became non-null", so an unrelated
  // project opened in between can't inherit somebody else's import.
  useEffect(() => {
    if (pendingImportRoot === null || root === null) return;
    if (root !== pendingImportRoot) return;
    setPendingImportRoot(null);
    setImportOpen(true);
  }, [root, pendingImportRoot]);

  // WO12 F5 tail — starter-node adoption. A brand-new project has zero
  // graph nodes and an un-adopted context/project.md sitting on disk
  // (project_init deliberately doesn't write the graph — preset_apply owns
  // that). Gated on `graphLoaded` as well as `root` so this only fires once
  // loadGraph's own reset-then-load cycle has actually finished for the
  // matching root; checking node count any earlier would read stale data
  // left over from whatever project (if any) was open before. Never fires
  // for "convert" (openImport case) or "edit" — see onDone below.
  useEffect(() => {
    if (pendingStarterAdoptRoot === null || root === null) return;
    if (root !== pendingStarterAdoptRoot) return;
    if (!graphLoaded) return;
    setPendingStarterAdoptRoot(null);
    if (useGraphStore.getState().nodes.length > 0) return;
    const hasProjectMd = useProjectStore
      .getState()
      .files.some((f) => sameRelPath(f.relPath, "context/project.md"));
    if (hasProjectMd) useGraphStore.getState().adoptFile("context/project.md");
  }, [root, pendingStarterAdoptRoot, graphLoaded]);

  // Wire barn://event + assemble://status once (idempotent — StrictMode-safe).
  // The listeners live for the app's lifetime; no teardown on re-render.
  useEffect(() => {
    void initEventListener();
  }, []);

  // Wire agent://event once — same idempotent, StrictMode-safe idiom, its
  // own listener (store/sessions.ts owns it; store/events.ts is untouched).
  useEffect(() => {
    void initSessionsListener();
  }, []);

  // Settings load then sfx init — both idempotent, StrictMode-safe.
  useEffect(() => {
    void useSettingsStore.getState().load().then(() => initSfx());
  }, []);

  // Best-effort flush of pending debounced saves when the window goes away.
  useEffect(() => {
    const flush = () => {
      void useGraphStore.getState().flushSave();
      flushSettings();
      flushMetaSave();
      // WO11 D4/§5.9 — agent-properties autosave (UI-D's frozen seam) is
      // debounced 500 ms same as the others; a keystroke inside that window
      // must not be lost on close either.
      flushAgentSave();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  // WO11 G1 — Home. Marty's ratified order (§5.9): flush everything, THEN
  // clear every store (useProjectStore.closeProject() owns steps 1-3), THEN
  // reset this component's own view/modal state (step 4 — component state,
  // not covered by any store). Live sessions are never touched; when any are
  // alive the confirm strip gates the whole flow (ASK #3).
  const goHome = () => {
    setHomeConfirmCount(null);
    void useProjectStore.getState().closeProject().then(() => {
      setView("canvas");
      setCompileOpen(false);
      setCompileLockedTarget(undefined);
      setSettingsOpen(false);
      setPresetsOpen(false);
      setHandoffOpen(false);
      setImportOpen(false);
      setGitWizardOpen(false);
      setRunOpen(false);
      setWizardMode(null);
      setPendingImportRoot(null);
      setPendingStarterAdoptRoot(null);
    });
  };

  const requestHome = () => {
    const aliveCount = useSessionsStore.getState().sessions.filter((s) => s.alive).length;
    if (aliveCount > 0) {
      setHomeConfirmCount(aliveCount);
      return;
    }
    goHome();
  };

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      <TopBar
        onCompile={(lockedTarget) => {
          setCompileLockedTarget(lockedTarget);
          setCompileOpen(true);
        }}
        onRun={() => setRunOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onPresets={() => setPresetsOpen(true)}
        onHandoff={() => setHandoffOpen(true)}
        onImport={() => setImportOpen(true)}
        onProjectProps={() => setWizardMode("edit")}
        onGit={() => setGitWizardOpen(true)}
        onHome={requestHome}
        view={view}
        onViewChange={setView}
      />
      {homeConfirmCount !== null && (
        <HomeConfirmBanner
          count={homeConfirmCount}
          onConfirm={goHome}
          onCancel={() => setHomeConfirmCount(null)}
        />
      )}
      {error !== null && (
        <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-danger-surface px-4">
          <span className="h-1.5 w-1.5 flex-none bg-danger" />
          <span className="truncate font-mono text-xs text-danger-text">{error}</span>
        </div>
      )}
      {/* Full-screen scanner only before a project is open; once the workspace
          is mounted, rescans (file-rail refresh, post-compile) must not unmount
          the canvas — that would reset the React Flow viewport mid-session. */}
      {root === null ? (
        scanning ? (
          <Scanning caption="the cow is reading" />
        ) : (
          <EmptyState onWizard={setWizardMode} />
        )
      ) : (
        <>
          <MigrationBanner onNavigate={() => setView("canvas")} />
          <ReviewBanner />
          <Workspace
            root={root}
            view={view}
            onEditProject={() => setWizardMode("edit")}
            onOpenGit={() => setGitWizardOpen(true)}
            onNeedsReview={() => {
              setView("canvas");
              useProjectStore.getState().focusNeedsReview();
            }}
          />
          <RosterBar />
          <ProblemsPanel root={root} onNavigate={() => setView("canvas")} />
          <EventLog root={root} />
          <StatusBar />
        </>
      )}
      {reviewing && root !== null && (
        <Suspense fallback={null}>
          <ReviewModal root={root} onClose={() => useReviewStore.getState().closeReview()} />
        </Suspense>
      )}
      {compileOpen && root !== null && (
        <Suspense fallback={null}>
          <CompileModal
            root={root}
            lockedTarget={compileLockedTarget}
            onClose={() => {
              setCompileOpen(false);
              setCompileLockedTarget(undefined);
            }}
          />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      {presetsOpen && root !== null && (
        <Suspense fallback={null}>
          <PresetsModal root={root} onClose={() => setPresetsOpen(false)} />
        </Suspense>
      )}
      {handoffOpen && root !== null && (
        <Suspense fallback={null}>
          <HandoffModal root={root} onClose={() => setHandoffOpen(false)} />
        </Suspense>
      )}
      {importOpen && root !== null && (
        <Suspense fallback={null}>
          <ImportReviewModal root={root} onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
      {gitWizardOpen && root !== null && (
        <Suspense fallback={null}>
          <GitWizard root={root} onClose={() => setGitWizardOpen(false)} />
        </Suspense>
      )}
      {runOpen && root !== null && (
        <Suspense fallback={null}>
          <RunSessionDialog root={root} onClose={() => setRunOpen(false)} />
        </Suspense>
      )}
      {/* WO12 F7/F2 — zero-prop, self-hiding: both read their own pending
          state and render null when there's nothing to show. */}
      <Suspense fallback={null}>
        <AssembleConfirmModal />
      </Suspense>
      <Suspense fallback={null}>
        <AgentQuestionModal />
      </Suspense>
      {wizardMode !== null && (
        <ProjectWizard
          mode={wizardMode}
          root={root ?? undefined}
          onClose={() => setWizardMode(null)}
          onDone={(picked, openImport) => {
            const wasEdit = wizardMode === "edit";
            setWizardMode(null);
            if (openImport) setPendingImportRoot(picked);
            // Editing an already-open project must not re-OPEN it: that
            // remounts the workspace and throws away the canvas viewport
            // mid-session. A rescan is enough to pick up a refreshed
            // context/project.md.
            if (wasEdit) void useProjectStore.getState().rescan();
            else {
              void useProjectStore.getState().openProjectAt(picked);
              // WO12 F5 tail — only "new" mode (never "convert", which
              // already opens ImportReviewModal for the user to choose what
              // to adopt; firing both would be two modals at once).
              if (!openImport) setPendingStarterAdoptRoot(picked);
            }
          }}
        />
      )}
      <ToastHost />
    </div>
  );
}
