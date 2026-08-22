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
  Undo2,
  Users,
  Wand2,
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
import { TitleScreen } from "./project/TitleScreen";
import { initEventListener } from "./store/events";
import { initSessionsListener, MAX_SESSIONS, useSessionsStore } from "./store/sessions";
import { useReviewStore } from "./store/review";
import { pinnedContextTokens } from "./store/tokens";
import { GraphCanvas } from "./canvas/GraphCanvas";
import { FileRail } from "./rail/Hierarchy";
import { Dock } from "./ui/Dock";
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
// WO15 Block 5b / U1 — the agent wizard and the hooks modal are opened from
// four different trees (canvas menus, node cards, the rail, the Barn legend,
// the event log) and mounted exactly once, here. `useUiStore` is the seam.
const NewAgentDialog = lazy(() =>
  import("./tasks/NewAgentDialog").then((m) => ({ default: m.NewAgentDialog })),
);
const HooksModal = lazy(() =>
  import("./inspector/HooksModal").then((m) => ({ default: m.HooksModal })),
);
import {
  CODE_FONT_STACKS,
  flushSettings,
  PANEL_LIMITS,
  UI_FONT_STACKS,
  useSettingsStore,
} from "./store/settings";
import { useUiStore } from "./store/ui";
import { useTasksStore } from "./store/tasks";
import { flushAgentSave, flushMetaSave, useAgentsStore } from "./store/agents";
import { initSfx } from "./scene/sfx";
import { ResizeHandle } from "./ui/ResizeHandle";
import { ContextMenu } from "./ui/ContextMenu";
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

/** Top-bar status cluster (WO14 redesign) — merges the old separate save
 *  indicator and pinned-token chip into one compact pill, one fewer distinct
 *  control in an already-crowded bar. Absent state (idle, no label) still
 *  shows the token count alone rather than disappearing entirely. */
function StatusPill() {
  const saveState = useGraphStore((s) => s.saveState);
  const nodes = useGraphStore((s) => s.nodes);
  const files = useProjectStore((s) => s.files);
  const tokens = pinnedContextTokens(nodes, files);
  const label = SAVE_LABEL[saveState];
  return (
    <span className="flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 font-mono text-2xs text-content-muted">
      {label !== null && (
        <>
          <span
            title=".cowtext/graph.json"
            className={`flex items-center gap-1.5 ${saveState === "error" ? "text-danger-text" : ""}`}
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
          <span className="text-content-disabled">&middot;</span>
        </>
      )}
      <span title="estimate, chars/4 · window ~200k">≈{tokens.toLocaleString()} tok pinned</span>
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

/** WO14 declutter — the five occasional project actions (properties, git,
 *  import, presets, handoff) collapse into one menu instead of five
 *  standing icon buttons. WO11 G2's own comment already named this the
 *  deferred "topbar overflow menu"; this is that menu, now with four more
 *  entries to justify existing. Anchored like CompileSplitButton's dropdown
 *  — button rect → x/y — so it opens on a plain click. */
function ProjectMenuButton({
  onProjectProps,
  onGit,
  onImport,
  onPresets,
  onHandoff,
  handoffDisabled,
}: {
  onProjectProps: () => void;
  onGit: () => void;
  onImport: () => void;
  onPresets: () => void;
  onHandoff: () => void;
  handoffDisabled: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setOpen({ x: rect.left, y: rect.bottom + 4 });
  };

  const items: MenuItem[] = [
    {
      kind: "item",
      id: "props",
      label: "Project properties…",
      icon: Gem,
      onSelect: onProjectProps,
    },
    { kind: "item", id: "git", label: "Git…", icon: GitBranch, onSelect: onGit },
    {
      kind: "item",
      id: "import",
      label: "Import existing context…",
      icon: ImportIcon,
      onSelect: onImport,
    },
    { kind: "item", id: "presets", label: "Presets…", icon: Package, onSelect: onPresets },
    {
      kind: "item",
      id: "handoff",
      label: "Handoff…",
      icon: Send,
      disabled: handoffDisabled,
      hint: handoffDisabled ? "the graph is empty" : undefined,
      onSelect: onHandoff,
    },
  ];

  return (
    <div className="flex flex-none">
      <button
        ref={btnRef}
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        title="Project properties, Git, Import, Presets, Handoff"
        className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
      >
        <Package size={14} strokeWidth={1.5} />
        Project
        <ChevronDown size={11} strokeWidth={1.5} className="text-content-muted" />
      </button>
      {open !== null && (
        <ContextMenu
          x={open.x}
          y={open.y}
          items={items}
          onClose={() => {
            setOpen(null);
            btnRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** WO14 declutter — grid layout (left / center / right) replaces the old
 *  flex+two-spacer trick, so the view toggle is genuinely centered instead
 *  of only appearing centered when the left/right clusters happen to be the
 *  same width. The right cluster groups into status / undo-redo /
 *  compile+run / project menu / settings, each separated by a hairline
 *  divider, instead of fourteen flat siblings. */
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
    // `ct-zoom` (index.css) — chrome follows the UI-scale setting.
    <header className="ct-zoom grid h-topbar flex-none grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border-subtle bg-surface-1 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <PixelLogo />
        <span className="font-pixel text-xs tracking-wide">cowtext</span>
        {root !== null && (
          <>
            <span className="text-content-disabled">/</span>
            <span className="truncate text-base font-medium">{projectName(root)}</span>
            <span
              className="hidden truncate font-mono text-2xs text-content-muted lg:block"
              title={root}
            >
              {root}
            </span>
            {/* WO11 G1 — house icon, next to the project identity it acts
                on. Closes the project and returns to the title screen; live
                agent sessions keep running (App.tsx's confirm strip handles
                the warning, not this button). */}
            <button
              onClick={onHome}
              title="Close project and return to the title screen"
              className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
            >
              <Home size={13} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      <div className="justify-self-center">
        {root !== null && (
          <ViewToggle view={view} onChange={onViewChange} managerMode={managerMode} />
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {root !== null && (
          <>
            <StatusPill />
            <span className="h-[22px] w-px flex-none bg-border-subtle" />
            <UndoRedoButtons />
            <span className="h-[22px] w-px flex-none bg-border-subtle" />
            <div className="flex flex-none items-center gap-1.5 rounded-md bg-surface-2 p-[3px]">
              <CompileSplitButton onCompile={onCompile} disabled={nodeCount === 0} />
              {/* WO12 F3 — Run. The pipeline reads Compile -> Run left to
                  right; Run is the bar's only accent-filled control (blue =
                  user-initiated, per the two-accent law). Opens
                  RunSessionDialog prefilled from current context (selected
                  agent, task, cwd, ceiling). */}
              <button
                onClick={onRun}
                disabled={atCap}
                title={
                  atCap
                    ? `agent limit reached (${MAX_SESSIONS})`
                    : "Run — launches a headless Claude Code session (claude -p)"
                }
                className="flex h-[26px] flex-none items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                <Play size={14} strokeWidth={1.5} />
                Run
              </button>
            </div>
            <span className="h-[22px] w-px flex-none bg-border-subtle" />
            <ProjectMenuButton
              onProjectProps={onProjectProps}
              onGit={onGit}
              onImport={onImport}
              onPresets={onPresets}
              onHandoff={onHandoff}
              handoffDisabled={nodeCount === 0}
            />
          </>
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
          title="Open folder"
          className="grid h-control w-control flex-none place-items-center rounded border border-border bg-surface-2 text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          <FolderOpen size={14} strokeWidth={1.5} />
        </button>
      </div>
    </header>
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
    <div className="ct-zoom flex flex-col flex-none border-b border-border-subtle bg-accent-surface">
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
    <div className="ct-zoom flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-amber-surface px-4">
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
    <div className="ct-zoom flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-amber-surface px-4">
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
  // P0.7 — in Tasks view the Inspector only earns its 392px once a task is
  // selected. It used to mount unconditionally there and show the "select a
  // node" fallback, i.e. a third of the window explaining that it is empty.
  const taskSelected = useTasksStore((s) => s.selected !== null);
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
      {/* The rail and the Inspector are scaled from here rather than from
          inside their own files: `zoom` belongs to whoever owns the layout
          slot, and both components belong to other lanes this round. The wrapper
          is `flex-none` around a `flex-none` child, so the only thing it
          changes at 100 % is one more div. */}
      <div className="ct-zoom flex min-h-0 flex-none">
        <FileRail
          root={root}
          onEditProject={onEditProject}
          onOpenGit={onOpenGit}
          onNeedsReview={onNeedsReview}
        />
      </div>
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
            {/* Tasks and Agents are chrome that happens to occupy `main`,
                not canvas surfaces — they scale with the rest of the app.
                Only `.react-flow` and the Barn host below stay 1:1. */}
            {view === "tasks" && (
              <Suspense fallback={<LoadingFallback />}>
                <div className="ct-zoom flex h-full flex-col">
                  <TasksBoard root={root} />
                </div>
              </Suspense>
            )}
            {view === "orchestrator" && (
              <Suspense fallback={<LoadingFallback />}>
                <div className="ct-zoom flex h-full flex-col">
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
        (view === "canvas" ||
          (view === "tasks" && taskSelected) ||
          (barnView && sessionSelected)) && (
        <>
          <ResizeHandle
            value={rightPanelWidth}
            defaultValue={PANEL_LIMITS.rightDefault}
            side="right"
            onChange={setRightPanelWidth}
            label="Resize inspector panel"
          />
          <div className="ct-zoom flex min-h-0 flex-none">
            <Suspense fallback={<div style={{ width: rightPanelWidth }} className="flex-none bg-surface-1" />}>
              <Inspector
                root={root}
                onOpenGit={onOpenGit}
                surface={view === "barn" ? "barn" : view === "tasks" ? "tasks" : "canvas"}
              />
            </Suspense>
          </div>
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

  // Block 7 — appearance, published to <html> by the effect below.
  const uiScale = useSettingsStore((s) => s.uiScale);
  const uiFont = useSettingsStore((s) => s.uiFont);
  const codeFont = useSettingsStore((s) => s.codeFont);
  // Block 5b / U1 — the two single-mount dialogs, opened from four trees.
  const agentWizard = useUiStore((s) => s.agentWizard);
  const closeAgentWizard = useUiStore((s) => s.closeAgentWizard);
  const hooksModalOpen = useUiStore((s) => s.hooksModalOpen);
  const setHooksModalOpen = useUiStore((s) => s.setHooksModalOpen);

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
  // `loadHooksAddr` rides along: it is the same "ask Rust once for a constant
  // of this machine" shape, it never rejects, and every surface that shows
  // the address (Settings, HooksModal, EventLog) reads the store.
  useEffect(() => {
    void useSettingsStore.getState().load().then(() => initSfx());
    void useProjectStore.getState().loadHooksAddr();
  }, []);

  // WO15 Block 7 — publish the appearance settings as custom properties on
  // <html>. Everything downstream is CSS: `zoom: var(--ui-scale)` on the
  // chrome containers (index.css), `font-sans`/`font-mono` on the two font
  // vars (tailwind.config.js). Runs on every change, and once more after
  // `load()` resolves, so a restart repaints at the persisted scale rather
  // than flashing 100 % first.
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty("--ui-scale", String(uiScale / 100));
    el.style.setProperty("--font-ui", UI_FONT_STACKS[uiFont]);
    el.style.setProperty("--font-mono", CODE_FONT_STACKS[codeFont]);
  }, [uiScale, uiFont, codeFont]);

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
        <div className="ct-zoom flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-danger-surface px-4">
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
          <TitleScreen onWizard={setWizardMode} />
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
          <Dock root={root} onNavigate={() => setView("canvas")} />
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
      {/* WO15 Block 5b — the ONE agent-wizard mount. The prefill (canvas
          position, context node) travels in `useUiStore`, not in props, so a
          card menu three components deep opens it without threading state
          up. Closing goes through the store too, which clears the prefill. */}
      {agentWizard.open && (
        <Suspense fallback={null}>
          <NewAgentDialog onClose={closeAgentWizard} />
        </Suspense>
      )}
      {/* The ONE hooks-modal mount (the event log and the Barn legend both
          open it). `root !== null` because installing hooks writes into a
          project's .claude/settings.json — there is nothing to write without
          one. ProjectWizard keeps its own mount: it runs before a project is
          open, over its own root. */}
      {hooksModalOpen && root !== null && (
        <Suspense fallback={null}>
          <HooksModal root={root} onClose={() => setHooksModalOpen(false)} />
        </Suspense>
      )}
      {wizardMode !== null && (
        <ProjectWizard
          mode={wizardMode}
          root={root ?? undefined}
          onClose={() => setWizardMode(null)}
          onDone={(picked, openImport, outcome) => {
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
              //
              // WO15 D-16: the wizard now always runs `presetApply` itself,
              // so a graph already exists and starter adoption would race
              // it — `graphApplied` says so. The intent-then-act effect is
              // kept for wizards that report no outcome (an older path, or
              // a wizard that bailed before applying).
              if (!openImport && outcome?.graphApplied !== true) {
                setPendingStarterAdoptRoot(picked);
              }
            }
          }}
        />
      )}
      {/* ToastHost renders inline rather than through a portal, so it needs
          the scale applied here — the body-child rule in index.css only
          reaches real portals. The wrapper is a zero-height flex item; the
          host itself is `position: fixed`. */}
      <div className="ct-zoom flex-none">
        <ToastHost />
      </div>
    </div>
  );
}
