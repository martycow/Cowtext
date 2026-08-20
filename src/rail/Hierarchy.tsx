// Left-rail Hierarchy — project row, file tree, AGENTS, SKILLS (WO10
// contract §6, extracted from App.tsx during WO11 B1/G4/rail-project-row).
//
// WO11 B1 fix (three causes, all previously in App.tsx):
//   1. File rows now render the leaf name, not the full relPath — the
//      relPath still lives in `title` so the full path is one hover away.
//   2. One shared row primitive (`RowShell`) gives every row — project,
//      directory, file — the same 16px chevron gutter (empty on rows with
//      nothing to disclose) so icons land in one column at every depth.
//      Indentation is a per-row left-pad computed from `depth`, not nested
//      <ul> padding, so the same primitive works at any nesting level.
//   3. `sortEntries` puts directories before files (VS Code order), both
//      groups alphabetical.
//
// WO11 rail-project-row: the project row is now selectable
// (`useProjectSelectionStore`, UI-C's frozen seam) and carries its own
// context menu (Reveal / Edit properties / Git / Rescan — contract §5.2).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useProjectStore, type MdFile } from "../store/project";
import { isRenameProtected, sameRelPath, useGraphStore } from "../store/graph";
import { useProjectSelectionStore } from "../store/projectSelection";
import { useFocusStore, useHighlightStore, useInspectorTabStore } from "../canvas/types";
import { useSettingsStore } from "../store/settings";
import { AgentsRailSection, SkillsRailSection } from "../agents/RailSections";
import { revealPath } from "../fs/api";
import { ScanOverlay } from "../ui/ScanOverlay";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

/** Duplicated from App.tsx deliberately (3 lines, pure) rather than an
 *  App.tsx ⇄ rail/Hierarchy.tsx import cycle for one helper. */
function projectName(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
}

const ROW_BASE_PAD = 12; // px-3 equivalent — matches the original top-level rows
const ROW_INDENT = 12; // matches the original nested <ul style={{paddingLeft:12}}>
const ROW_GUTTER = 16; // one fixed chevron column, empty on rows with no children

/** Shared row geometry for every Hierarchy row (project / directory / file) —
 *  contract WO11 B1's frozen fix. */
function RowShell({
  depth,
  chevron,
  selected,
  title,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  innerRef,
  children,
}: {
  depth: number;
  chevron: "expanded" | "collapsed" | "none";
  selected: boolean;
  title?: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  innerRef?: React.Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={title}
      style={{ paddingLeft: ROW_BASE_PAD + depth * ROW_INDENT }}
      className={`flex h-row cursor-default items-center gap-1.5 pr-3 ${
        selected
          ? "bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
          : "hover:bg-[var(--surface-hover)]"
      }`}
    >
      <span className="grid flex-none place-items-center" style={{ width: ROW_GUTTER }}>
        {chevron === "expanded" && (
          <ChevronDown size={12} strokeWidth={1.5} className="text-content-muted" />
        )}
        {chevron === "collapsed" && (
          <ChevronRight size={12} strokeWidth={1.5} className="text-content-muted" />
        )}
      </span>
      {children}
    </div>
  );
}

/** WO11 rail-project-row — the project itself is selectable (Inspector shows
 *  its properties, UI-C's G3) and carries its own context menu (§5.2):
 *  Reveal, Edit properties, Git, Rescan. Selecting the project clears the
 *  graph/agent/task selection first (same "ours second" idiom RailSections
 *  already uses for its own rows) — the reverse direction (selecting a node
 *  clears the project selection) is `setSelection`'s own job (UI-C, §5.4). */
function ProjectRow({
  root,
  onEditProject,
  onOpenGit,
}: {
  root: string;
  onEditProject: () => void;
  onOpenGit: () => void;
}) {
  const rescan = useProjectStore((s) => s.rescan);
  const selected = useProjectSelectionStore((s) => s.selected);
  const selectProject = useProjectSelectionStore((s) => s.select);
  const setSelection = useGraphStore((s) => s.setSelection);
  const menu = useContextMenu();
  const [revealError, setRevealError] = useState<string | null>(null);

  const pick = () => {
    setSelection([], []);
    selectProject(true);
  };

  const openMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = [
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () => {
          setRevealError(null);
          void revealPath(root, null).catch((err: unknown) => setRevealError(String(err)));
        },
      },
      {
        kind: "item",
        id: "edit",
        label: "Edit project properties…",
        icon: Pencil,
        onSelect: onEditProject,
      },
      { kind: "item", id: "git", label: "Git…", icon: GitBranch, onSelect: onOpenGit },
      { kind: "separator", id: "sep" },
      { kind: "item", id: "rescan", label: "Rescan", icon: RefreshCw, onSelect: () => void rescan() },
    ];
    menu.openAt(e, items);
  };

  return (
    <div className="flex flex-none flex-col">
      <RowShell
        depth={0}
        chevron="none"
        selected={selected}
        title={root}
        onClick={pick}
        onContextMenu={openMenu}
      >
        <Folder size={12} strokeWidth={1.5} className="flex-none text-content-muted" />
        <span
          className={`min-w-0 flex-1 truncate font-mono text-xs font-medium ${
            selected ? "text-accent-text" : "text-content"
          }`}
        >
          {projectName(root)}
        </span>
      </RowShell>
      {revealError !== null && (
        <div className="flex items-center gap-2 border-t border-border-subtle bg-danger-surface px-3 py-1">
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
      {menu.menu !== null && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} items={menu.menu.items} onClose={menu.close} />
      )}
    </div>
  );
}

function FileRow({ file, root, depth }: { file: MdFile; root: string; depth: number }) {
  const node = useGraphStore((s) => s.nodes.find((n) => sameRelPath(n.filePath, file.relPath)));
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

  const baseName = file.relPath.split("/").pop() ?? file.relPath;

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
      <RowShell
        depth={depth}
        chevron="none"
        selected={isSelected}
        title={file.relPath}
        innerRef={rowRef}
        onClick={() => {
          if (node === undefined) return;
          setSelection([node.id], []);
          // WO10 item 8 — selecting a row that maps to a card off the edge of
          // the canvas used to look like nothing happened. GraphCanvas only
          // acts on this when the card really is out of view.
          useFocusStore.getState().requestFocus(node.id);
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
          className={`min-w-0 flex-1 truncate font-mono text-xs ${
            isSelected ? "text-accent-text" : "text-content-secondary"
          }`}
        >
          {baseName}
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
      </RowShell>
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

// ── File-rail directory tree (contract §6, WO11 B1) ────────────────────
// Pure presentation over the flat `contextFiles` list: directories first,
// then files, both alphabetical, recursively at every level. `depth` is
// threaded through the recursion and drives each row's own left-pad —
// FileRow is never touched, it still only ever receives a flat MdFile.

interface DirEntry {
  kind: "dir";
  name: string;
  path: string;
  children: TreeEntry[];
}
interface FileEntry {
  kind: "file";
  file: MdFile;
}
type TreeEntry = DirEntry | FileEntry;

function entrySortName(e: TreeEntry): string {
  return e.kind === "file" ? (e.file.relPath.split("/").pop() ?? e.file.relPath) : e.name;
}

/** Directories before files (VS Code order), each group alphabetical —
 *  WO11 B1's third cause (`a.kind === "file" ? -1 : 1` used to sort files
 *  first). */
function sortEntries(children: TreeEntry[]): void {
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return entrySortName(a).localeCompare(entrySortName(b));
  });
  for (const c of children) {
    if (c.kind === "dir") sortEntries(c.children);
  }
}

/** Directories first, then files — recursively, at every level (contract §6,
 *  amended B1). */
function buildFileTree(files: MdFile[]): TreeEntry[] {
  const root: DirEntry = { kind: "dir", name: "", path: "", children: [] };
  const dirIndex = new Map<string, DirEntry>([["", root]]);
  for (const f of files) {
    const parts = f.relPath.split("/");
    parts.pop(); // basename — stays on f.relPath, only the directory chain matters here
    let cur = root;
    let curPath = "";
    for (const part of parts) {
      curPath = curPath === "" ? part : `${curPath}/${part}`;
      let next = dirIndex.get(curPath);
      if (next === undefined) {
        next = { kind: "dir", name: part, path: curPath, children: [] };
        dirIndex.set(curPath, next);
        cur.children.push(next);
      }
      cur = next;
    }
    cur.children.push({ kind: "file", file: f });
  }
  sortEntries(root.children);
  return root.children;
}

function DirRow({
  entry,
  root,
  depth,
  collapsedDirs,
  onToggle,
}: {
  entry: DirEntry;
  root: string;
  depth: number;
  collapsedDirs: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isCollapsed = collapsedDirs.has(entry.path);
  return (
    <li className="flex flex-col">
      <RowShell
        depth={depth}
        chevron={isCollapsed ? "collapsed" : "expanded"}
        selected={false}
        title={entry.path}
        onClick={() => onToggle(entry.path)}
      >
        <Folder size={12} strokeWidth={1.5} className="flex-none text-content-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary">
          {entry.name}
        </span>
      </RowShell>
      {!isCollapsed && (
        <ul>
          {entry.children.map((c) =>
            c.kind === "file" ? (
              <FileRow key={c.file.relPath} file={c.file} root={root} depth={depth + 1} />
            ) : (
              <DirRow
                key={c.path}
                entry={c}
                root={root}
                depth={depth + 1}
                collapsedDirs={collapsedDirs}
                onToggle={onToggle}
              />
            ),
          )}
        </ul>
      )}
    </li>
  );
}

/** Left rail — width and collapsed flag both come from the settings store
 *  (contract §7.3) so they survive a restart; the drag handle lives beside
 *  this component in Workspace (App.tsx). */
export function FileRail({
  root,
  onEditProject,
  onOpenGit,
}: {
  root: string;
  onEditProject: () => void;
  onOpenGit: () => void;
}) {
  const { files, rescan, scanning } = useProjectStore();
  // Agent files scan too (project.rs opts into .claude/agents/) but they
  // render in the AGENTS section below, not among context files.
  const contextFiles = files.filter((f) => !f.relPath.startsWith(".claude/"));
  const tree = useMemo(() => buildFileTree(contextFiles), [contextFiles]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const toggleDir = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
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
          {contextFiles.length} files
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
        <span className="flex-none font-mono text-2xs uppercase tracking-wider text-content">
          Hierarchy
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-content-muted">
          {contextFiles.length} {contextFiles.length === 1 ? "file" : "files"}
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
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <ScanOverlay caption="rescanning" />
        <div className="flex flex-col">
          {/* WO11: the project row is now selectable and carries its own
              context menu (Reveal / Edit properties / Git / Rescan). It is
              the panel's anchor, not a tree node: it has no chevron and
              never collapses. */}
          <ProjectRow root={root} onEditProject={onEditProject} onOpenGit={onOpenGit} />
          <div>
            {contextFiles.length === 0 ? (
              <div className="flex items-center justify-center px-3 py-6">
                <span className="text-center text-sm text-content-muted">No markdown files here.</span>
              </div>
            ) : (
              <ul className="py-1">
                {tree.map((e) =>
                  e.kind === "file" ? (
                    <FileRow key={e.file.relPath} file={e.file} root={root} depth={0} />
                  ) : (
                    <DirRow
                      key={e.path}
                      entry={e}
                      root={root}
                      depth={0}
                      collapsedDirs={collapsedDirs}
                      onToggle={toggleDir}
                    />
                  ),
                )}
              </ul>
            )}
            <AgentsRailSection root={root} />
            <SkillsRailSection root={root} />
          </div>
        </div>
      </div>
    </div>
  );
}
