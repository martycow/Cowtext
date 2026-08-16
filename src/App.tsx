import { FileText, FolderOpen, RefreshCw } from "lucide-react";
import { useProjectStore } from "./store/project";
import type { MdFile } from "./store/project";

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

function TopBar() {
  const { root, openProject } = useProjectStore();
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
        Pick a folder and Cowtext will find every markdown file in it. The graph
        comes later — first, the herd needs a barn.
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
function Scanning() {
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
      <span className="font-pixel text-micro tracking-wide text-amber-text">
        the cow is reading
      </span>
    </div>
  );
}

function FileRow({ file }: { file: MdFile }) {
  return (
    <li
      className="flex h-row items-center gap-2 border-l-2 border-transparent px-4 hover:bg-[var(--surface-hover)]"
      title={file.relPath}
    >
      <FileText size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary [direction:rtl] [text-align:left]">
        {file.relPath}
      </span>
      <span className="flex-none font-mono text-2xs text-content-disabled">
        {formatSize(file.sizeBytes)}
      </span>
    </li>
  );
}

function FileList() {
  const { files, rescan, scanning } = useProjectStore();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-surface-1 px-4">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
          {files.length} markdown {files.length === 1 ? "file" : "files"}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => void rescan()}
          disabled={scanning}
          title="Rescan"
          className="grid h-control-sm w-control-sm place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled"
        >
          <RefreshCw size={13} strokeWidth={1.5} />
        </button>
      </div>
      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-content-muted">No markdown files here.</span>
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

export default function App() {
  const { root, scanning, error } = useProjectStore();
  return (
    <div className="flex h-screen flex-col bg-surface-0">
      <TopBar />
      {error !== null && (
        <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle bg-danger-surface px-4">
          <span className="h-1.5 w-1.5 flex-none bg-danger" />
          <span className="truncate font-mono text-xs text-danger-text">{error}</span>
        </div>
      )}
      {scanning ? <Scanning /> : root === null ? <EmptyState /> : <FileList />}
    </div>
  );
}
