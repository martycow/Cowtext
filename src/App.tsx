import { useEffect, useState } from "react";
import {
  FileOutput,
  FileText,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useProjectStore } from "./store/project";
import type { MdFile } from "./store/project";
import { useGraphStore, type SaveState } from "./store/graph";
import { initEventListener } from "./store/events";
import { GraphCanvas } from "./canvas/GraphCanvas";
import { Inspector } from "./inspector/Inspector";
import { EventLog } from "./inspector/EventLog";
import { CompileModal } from "./compile/CompileModal";
import { BarnScene } from "./scene/BarnScene";

/** The two faces of an open project: the graph editor and the barn monitor. */
type View = "canvas" | "barn";

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
  view,
  onViewChange,
}: {
  onCompile: () => void;
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

function EmptyState() {
  const { openProject } = useProjectStore();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
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

function FileRow({ file }: { file: MdFile }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.filePath === file.relPath));
  const adoptFile = useGraphStore((s) => s.adoptFile);
  const setSelection = useGraphStore((s) => s.setSelection);

  return (
    <li
      className="group flex h-row cursor-default items-center gap-2 px-3 hover:bg-[var(--surface-hover)]"
      title={file.relPath}
      onClick={() => {
        if (node !== undefined) setSelection([node.id], []);
      }}
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
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary [direction:rtl] [text-align:left]">
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
    </li>
  );
}

/** Phase-0 file list, kept reachable as a collapsible left rail. */
function FileRail() {
  const { files, rescan, scanning } = useProjectStore();
  const [collapsed, setCollapsed] = useState(false);

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
    <div className="flex w-[248px] flex-none flex-col border-r border-border-subtle bg-surface-1">
      <div className="flex h-[31px] flex-none items-center gap-1.5 border-b border-border-subtle px-3">
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
      </div>
      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3">
          <span className="text-center text-sm text-content-muted">No markdown files here.</span>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {files.map((f) => (
            <FileRow key={f.relPath} file={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Workspace({ root, view }: { root: string; view: View }) {
  const loaded = useGraphStore((s) => s.loaded);
  const loadError = useGraphStore((s) => s.loadError);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <FileRail />
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
            {view === "barn" && <BarnScene />}
          </>
        ) : (
          <div className="flex h-full">
            <Scanning caption="the cow is reading" />
          </div>
        )}
      </main>
      {loaded && loadError === null && view === "canvas" && <Inspector root={root} />}
    </div>
  );
}

export default function App() {
  const { root, scanning, error } = useProjectStore();
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const [compileOpen, setCompileOpen] = useState(false);
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

  // Best-effort flush of a pending debounced save when the window goes away.
  useEffect(() => {
    const flush = () => {
      void useGraphStore.getState().flushSave();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      <TopBar onCompile={() => setCompileOpen(true)} view={view} onViewChange={setView} />
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
        <CompileModal root={root} onClose={() => setCompileOpen(false)} />
      )}
    </div>
  );
}
