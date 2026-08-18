import { useEffect, useRef, useState, Suspense, lazy } from "react";
import {
  Copy,
  FileOutput,
  FileText,
  FolderOpen,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings,
  X,
} from "lucide-react";
import { useProjectStore } from "./store/project";
import type { MdFile } from "./store/project";
import { isRenameProtected, useGraphStore, type SaveState } from "./store/graph";
import { useHighlightStore, useInspectorTabStore } from "./canvas/types";
import { initEventListener } from "./store/events";
import { GraphCanvas } from "./canvas/GraphCanvas";
import { EventLog } from "./inspector/EventLog";
// Lazy-loaded for code splitting
const Inspector = lazy(() => import("./inspector/Inspector").then(m => ({ default: m.Inspector })));
const CompileModal = lazy(() => import("./compile/CompileModal").then(m => ({ default: m.CompileModal })));
const BarnScene = lazy(() => import("./scene/BarnScene").then(m => ({ default: m.BarnScene })));
const SettingsModal = lazy(() => import("./settings/SettingsModal").then(m => ({ default: m.SettingsModal })));
const PresetsModal = lazy(() => import("./preset/PresetsModal").then(m => ({ default: m.PresetsModal })));
const HandoffModal = lazy(() => import("./handoff/HandoffModal").then(m => ({ default: m.HandoffModal })));
import { flushSettings, PANEL_LIMITS, useSettingsStore, type RecentProject } from "./store/settings";
import { initSfx } from "./scene/sfx";
import { probeProjectDirs, revealPath } from "./fs/api";
import { ResizeHandle } from "./ui/ResizeHandle";
import { ScanOverlay } from "./ui/ScanOverlay";
import { ContextMenu } from "./ui/ContextMenu";
import { useContextMenu } from "./ui/useContextMenu";
import type { MenuItem } from "./ui/menuTypes";

/** The two faces of an open project: the graph editor and the barn monitor. */
type View = "canvas" | "barn";

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
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const seg = (v: View, label: string) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      title={v === "canvas" ? "Edit the context graph" : "Watch the agent in the barn"}
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
      {seg("barn", "Barn")}
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
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

function TopBar({
  onCompile,
  onSettings,
  onPresets,
  onHandoff,
  view,
  onViewChange,
}: {
  onCompile: () => void;
  onSettings: () => void;
  onPresets: () => void;
  onHandoff: () => void;
  view: View;
  onViewChange: (v: View) => void;
}) {
  const { root, openProject } = useProjectStore();
  const nodeCount = useGraphStore((s) => s.nodes.length);
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
      {root !== null && <ViewToggle view={view} onChange={onViewChange} />}
      <div className="flex-1" />
      {root !== null && <SaveIndicator />}
      {root !== null && (
        <button
          onClick={onCompile}
          disabled={nodeCount === 0}
          title={nodeCount === 0 ? "The graph is empty" : "Preview and write generated files"}
          className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
        >
          <FileOutput size={14} strokeWidth={1.5} />
          Compile
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

function EmptyState() {
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
      <button
        onClick={() => void openProject()}
        className="mt-2 flex h-control-lg items-center gap-2 rounded bg-accent px-4 text-base font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
      >
        <FolderOpen size={15} strokeWidth={1.8} />
        Open folder
      </button>
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

function FileRow({ file, root }: { file: MdFile; root: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.filePath === file.relPath));
  const adoptFile = useGraphStore((s) => s.adoptFile);
  const setSelection = useGraphStore((s) => s.setSelection);
  const rescan = useProjectStore((s) => s.rescan);
  const contextMenu = useContextMenu();
  // Selection sync: the rail row, the canvas card and the Inspector always
  // point at the same node — the row of the selected node is tinted and
  // kept in view.
  const isSelected = useGraphStore(
    (s) => node !== undefined && s.selectedNodeIds.includes(node.id),
  );
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  // Hovering a mapped row lights up the node AND its whole neighbourhood
  // (touching edges + the nodes on their far ends) on the canvas. Computed
  // at hover time from a snapshot — no extra store subscription per row.
  const hoverHighlight = () => {
    if (node === undefined) return;
    const touching = useGraphStore
      .getState()
      .edges.filter((e) => e.source === node.id || e.target === node.id);
    useHighlightStore
      .getState()
      .setHighlight(
        [node.id, ...touching.map((e) => (e.source === node.id ? e.target : e.source))],
        touching.map((e) => e.id),
      );
  };
  const clearHighlight = () => useHighlightStore.getState().clearHighlight();
  // Rows unmount wholesale on rescan/file removal — drop any highlight left
  // behind (mouseleave never fires on a removed element).
  useEffect(() => clearHighlight, []);
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op."
  const [revealError, setRevealError] = useState<string | null>(null);

  const openMenu = (e: React.MouseEvent) => {
    const protectedFile = isRenameProtected(file.relPath);
    const items: MenuItem[] = [
      node !== undefined
        ? {
            kind: "item",
            id: "select",
            label: "Select node",
            icon: FileText,
            onSelect: () => setSelection([node.id], []),
          }
        : {
            kind: "item",
            id: "adopt",
            label: "Adopt as memory node",
            icon: Plus,
            onSelect: () => adoptFile(file.relPath),
          },
      ...(node !== undefined
        ? ([
            {
              kind: "item",
              id: "rename",
              label: "Rename file…",
              icon: Pencil,
              disabled: protectedFile,
              hint: protectedFile ? "generated file — not renameable" : undefined,
              onSelect: () => {
                setSelection([node.id], []);
                useInspectorTabStore.getState().requestRename();
              },
            },
          ] satisfies MenuItem[])
        : []),
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () => {
          setRevealError(null);
          void revealPath(root, file.relPath).catch((err: unknown) => setRevealError(String(err)));
        },
      },
      {
        kind: "item",
        id: "copy",
        label: "Copy relative path",
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(file.relPath),
      },
      { kind: "separator", id: "sep-1" },
      {
        kind: "item",
        id: "rescan",
        label: "Rescan",
        icon: RefreshCw,
        onSelect: () => void rescan(),
      },
    ];
    contextMenu.openAt(e, items);
  };

  return (
    <li className="group flex flex-col" onContextMenu={openMenu}>
      <div
        ref={rowRef}
        className={`flex h-row cursor-default items-center gap-2 px-3 ${
          isSelected
            ? "bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
            : "hover:bg-[var(--surface-hover)]"
        }`}
        title={file.relPath}
        onClick={() => {
          if (node !== undefined) setSelection([node.id], []);
        }}
        onMouseEnter={hoverHighlight}
        onMouseLeave={clearHighlight}
      >
        {node !== undefined ? (
          <span
            className="h-2 w-2 flex-none rounded-sm"
            style={{ background: `var(--role-${node.role})` }}
            title={`On canvas — ${node.role}`}
          />
        ) : (
          <FileText size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
        )}
        <span
          className={`min-w-0 flex-1 truncate font-mono text-xs [direction:rtl] [text-align:left] ${
            isSelected ? "text-accent-text" : "text-content-secondary"
          }`}
        >
          {file.relPath}
        </span>
        <span className="flex-none font-mono text-2xs text-content-disabled group-hover:hidden">
          {formatSize(file.sizeBytes)}
        </span>
        {node === undefined && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              adoptFile(file.relPath);
            }}
            title="Adopt as memory node"
            className="hidden h-control-sm flex-none items-center gap-1 rounded border border-border bg-surface-2 px-1.5 font-mono text-micro text-content-secondary transition-colors duration-fast hover:border-accent-border hover:text-accent-text group-hover:flex"
          >
            <Plus size={11} strokeWidth={1.5} />
            adopt
          </button>
        )}
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

/** Left rail — width and collapsed flag both come from the settings store
 *  (contract §7.3) so they survive a restart; the drag handle lives beside
 *  this component in Workspace. */
function FileRail({ root }: { root: string }) {
  const { files, rescan, scanning } = useProjectStore();
  const leftPanelWidth = useSettingsStore((s) => s.leftPanelWidth);
  const collapsed = useSettingsStore((s) => s.leftPanelCollapsed);
  const setCollapsed = useSettingsStore((s) => s.setLeftPanelCollapsed);
  const headerMenu = useContextMenu();
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op."
  const [revealError, setRevealError] = useState<string | null>(null);

  const openHeaderMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = [
      { kind: "item", id: "rescan", label: "Rescan", icon: RefreshCw, onSelect: () => void rescan() },
      {
        kind: "item",
        id: "reveal-root",
        label: "Reveal project in File Explorer",
        icon: FolderOpen,
        onSelect: () => {
          setRevealError(null);
          void revealPath(root, null).catch((err: unknown) => setRevealError(String(err)));
        },
      },
      {
        kind: "item",
        id: "collapse",
        label: "Collapse panel",
        icon: PanelLeftClose,
        onSelect: () => setCollapsed(true),
      },
    ];
    headerMenu.openAt(e, items);
  };

  if (collapsed) {
    return (
      <div className="flex w-[34px] flex-none flex-col items-center border-r border-border-subtle bg-surface-1 py-2">
        <button
          onClick={() => setCollapsed(false)}
          title="Show files"
          className="grid h-control-sm w-control-sm place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <PanelLeftOpen size={14} strokeWidth={1.5} />
        </button>
        <span className="mt-3 font-mono text-2xs uppercase tracking-wider text-content-muted [writing-mode:vertical-rl]">
          {files.length} files
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-none flex-col border-r border-border-subtle bg-surface-1"
      style={{ width: leftPanelWidth }}
    >
      <div
        onContextMenu={openHeaderMenu}
        className="flex h-[31px] flex-none items-center gap-1.5 border-b border-border-subtle px-3"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-2xs uppercase tracking-wider text-content-muted">
          {files.length} markdown {files.length === 1 ? "file" : "files"}
        </span>
        <button
          onClick={() => void rescan()}
          disabled={scanning}
          title="Rescan"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled"
        >
          <RefreshCw size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="Hide files"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <PanelLeftClose size={13} strokeWidth={1.5} />
        </button>
        {headerMenu.menu !== null && (
          <ContextMenu
            x={headerMenu.menu.x}
            y={headerMenu.menu.y}
            items={headerMenu.menu.items}
            onClose={headerMenu.close}
          />
        )}
      </div>
      {revealError !== null && (
        <div className="flex flex-none items-center gap-2 border-b border-border-subtle bg-danger-surface px-3 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-danger-text">
            {revealError}
          </span>
          <button
            onClick={() => setRevealError(null)}
            title="Dismiss"
            className="grid h-3.5 w-3.5 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
          >
            <X size={10} strokeWidth={1.5} />
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <ScanOverlay caption="rescanning" />
        {files.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3">
            <span className="text-center text-sm text-content-muted">No markdown files here.</span>
          </div>
        ) : (
          <ul className="h-full overflow-y-auto py-1">
            {files.map((f) => (
              <FileRow key={f.relPath} file={f} root={root} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Workspace({ root, view }: { root: string; view: View }) {
  const loaded = useGraphStore((s) => s.loaded);
  const loadError = useGraphStore((s) => s.loadError);
  const leftPanelCollapsed = useSettingsStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useSettingsStore((s) => s.leftPanelWidth);
  const setLeftPanelWidth = useSettingsStore((s) => s.setLeftPanelWidth);
  const rightPanelWidth = useSettingsStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useSettingsStore((s) => s.setRightPanelWidth);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <FileRail root={root} />
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
            {/* The canvas stays mounted (hidden) in Barn view so the React
                Flow viewport survives toggling; the Pixi scene mounts on
                demand and destroys itself cleanly on the way out. */}
            <div className={view === "canvas" ? "h-full" : "hidden"}>
              <GraphCanvas />
            </div>
            {view === "barn" && (
              <Suspense fallback={<LoadingFallback />}>
                <BarnScene />
              </Suspense>
            )}
          </>
        ) : (
          <div className="flex h-full">
            <Scanning caption="the cow is reading" />
          </div>
        )}
      </main>
      {loaded && loadError === null && view === "canvas" && (
        <>
          <ResizeHandle
            value={rightPanelWidth}
            defaultValue={PANEL_LIMITS.rightDefault}
            side="right"
            onChange={setRightPanelWidth}
            label="Resize inspector panel"
          />
          <Suspense fallback={<div style={{ width: rightPanelWidth }} className="flex-none bg-surface-1" />}>
            <Inspector root={root} />
          </Suspense>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { root, scanning, error } = useProjectStore();
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const [compileOpen, setCompileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [view, setView] = useState<View>("canvas");

  // A new project always opens on the canvas.
  useEffect(() => {
    setView("canvas");
  }, [root]);

  // Project opened → load (or start) its graph.
  useEffect(() => {
    if (root !== null) void loadGraph(root);
  }, [root, loadGraph]);

  // Wire barn://event + assemble://status once (idempotent — StrictMode-safe).
  // The listeners live for the app's lifetime; no teardown on re-render.
  useEffect(() => {
    void initEventListener();
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
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      <TopBar
        onCompile={() => setCompileOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onPresets={() => setPresetsOpen(true)}
        onHandoff={() => setHandoffOpen(true)}
        view={view}
        onViewChange={setView}
      />
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
          <EmptyState />
        )
      ) : (
        <>
          <Workspace root={root} view={view} />
          <EventLog root={root} />
        </>
      )}
      {compileOpen && root !== null && (
        <Suspense fallback={null}>
          <CompileModal root={root} onClose={() => setCompileOpen(false)} />
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
    </div>
  );
}
