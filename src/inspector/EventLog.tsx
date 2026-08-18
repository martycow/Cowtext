// Event log — collapsible bottom panel showing the live BarnEvent feed
// (Phase 4). Every event is shown, including unknown paths (faint accent
// tint per DESIGN_SPEC); node mapping is cosmetic here, never a filter.
// Also hosts the hooks-install entry point (trust-boundary modal).

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, FolderOpen, Plug, Trash2, X } from "lucide-react";
import { useEventsStore, resolveNodeId, type BarnEvent, type LogEvent } from "../store/events";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import { revealPath } from "../fs/api";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { HooksModal } from "./HooksModal";

/** Kind tag colours per DESIGN_SPEC: read = amber (agent acts), write/edit =
 *  success, everything else neutral. */
function tagClasses(kind: BarnEvent["kind"]): string {
  if (kind === "read") return "bg-amber-surface text-amber-text";
  if (kind === "edit" || kind === "write") return "bg-success-surface text-success-text";
  return "bg-surface-3 text-content-secondary";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** True when `filePath` (absolute or relative) resolves inside `root`
 *  (contract §7.9 event-log row: the reveal entry only appears then). */
function resolvesInsideRoot(filePath: string, root: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  const isAbsolute = /^[a-zA-Z]:\//.test(norm) || norm.startsWith("/");
  if (!isAbsolute) return true;
  const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const lower = norm.toLowerCase();
  return lower === rootNorm || lower.startsWith(`${rootNorm}/`);
}

function toRelPath(filePath: string, root: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (norm.toLowerCase().startsWith(`${rootNorm.toLowerCase()}/`)) {
    return norm.slice(rootNorm.length + 1);
  }
  return norm;
}

function EventRow({
  event,
  root,
  onRevealError,
}: {
  event: LogEvent;
  root: string;
  onRevealError: (msg: string) => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const nodeId = event.filePath !== undefined ? resolveNodeId(event.filePath) : null;
  const node = nodeId !== null ? nodes.find((n) => n.id === nodeId) : undefined;
  const unknownPath = event.filePath !== undefined && nodeId === null;
  const contextMenu = useContextMenu();

  const canReveal = event.filePath !== undefined && resolvesInsideRoot(event.filePath, root);

  const openMenu = (e: React.MouseEvent) => {
    if (event.filePath === undefined) return;
    const filePath = event.filePath;
    const items: MenuItem[] = [
      ...(canReveal
        ? ([
            {
              kind: "item",
              id: "reveal",
              label: "Reveal in File Explorer",
              icon: FolderOpen,
              onSelect: () => {
                void revealPath(root, toRelPath(filePath, root)).catch((err: unknown) =>
                  onRevealError(String(err)),
                );
              },
            },
          ] satisfies MenuItem[])
        : []),
      {
        kind: "item",
        id: "copy",
        label: "Copy path",
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(filePath),
      },
    ];
    contextMenu.openAt(e, items);
  };

  return (
    <li
      onContextMenu={event.filePath !== undefined ? openMenu : undefined}
      className={`flex h-row flex-none items-center gap-2 px-3 ${
        unknownPath ? "bg-accent-surface" : ""
      }`}
    >
      <span
        className={`inline-flex h-4 w-[58px] flex-none items-center justify-center rounded-sm font-mono text-[9px] uppercase tracking-wider ${tagClasses(event.kind)}`}
      >
        {event.kind === "subagent_stop" ? "substop" : event.kind}
      </span>
      {event.demo === true && (
        <span className="inline-flex h-4 flex-none items-center rounded-sm border border-amber-border px-1 font-mono text-[9px] uppercase tracking-wider text-amber-text">
          demo
        </span>
      )}
      {node !== undefined && (
        <span
          className="h-2 w-2 flex-none rounded-sm"
          style={{ background: `var(--role-${node.role})` }}
          title={node.title}
        />
      )}
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary [direction:rtl] [text-align:left]"
        title={event.filePath ?? event.toolName ?? ""}
      >
        {event.filePath ??
          (event.kind === "other" ? (event.toolName ?? "unknown tool") : "—")}
      </span>
      {unknownPath && (
        <span className="flex-none font-mono text-2xs text-accent-text">not on graph</span>
      )}
      <span className="flex-none font-mono text-2xs text-content-disabled">
        {formatTime(event.ts)}
      </span>
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

export function EventLog({ root }: { root: string }) {
  const events = useEventsStore((s) => s.events);
  const demoMode = useEventsStore((s) => s.demoMode);
  const clear = useEventsStore((s) => s.clear);
  const hooksInstalled = useProjectStore((s) => s.hooksInstalled);
  const hooksReadable = useProjectStore((s) => s.hooksReadable);
  const [collapsed, setCollapsed] = useState(true);
  const [hooksOpen, setHooksOpen] = useState(false);
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op."
  const [revealError, setRevealError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Newest last — keep the list pinned to the bottom as events arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [events.length, collapsed]);

  return (
    <div className="flex flex-none flex-col border-t border-border-subtle bg-surface-1">
      {/* The whole header is the collapse toggle; inner buttons stop the click. */}
      <div
        className="flex h-[31px] flex-none cursor-default items-center gap-2 px-3 hover:bg-[var(--surface-hover)]"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Show event feed" : "Hide event feed"}
      >
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
          event feed
        </span>
        {events.length > 0 && (
          <span className="font-mono text-2xs text-content-disabled">{events.length}</span>
        )}
        {demoMode && (
          <span className="inline-flex h-[17px] items-center rounded-sm border border-amber-border bg-amber-surface px-1 font-mono text-micro uppercase tracking-wider text-amber-text">
            demo
          </span>
        )}
        <div className="flex-1" />
        {/* Four-state hooks indicator (contract §7.2) — installed is a
            static badge with no button; unreadable is a clickable amber
            badge that opens the same modal; unknown (null) renders nothing,
            never a guess. */}
        {hooksInstalled === true ? (
          <span
            title={`${root}\\.claude\\settings.json`}
            className="flex h-control-sm flex-none items-center gap-1 rounded border border-transparent bg-success-surface px-1.5 font-mono text-micro text-success-text"
          >
            <Plug size={11} strokeWidth={1.5} />
            hooks installed
          </span>
        ) : hooksInstalled === false && hooksReadable ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setHooksOpen(true);
            }}
            title="Preview and install Claude Code hooks into this project's .claude/settings.json"
            className="flex h-control-sm flex-none items-center gap-1 rounded border border-border bg-surface-2 px-1.5 font-mono text-micro text-content-secondary transition-colors duration-fast hover:border-accent-border hover:text-accent-text"
          >
            <Plug size={11} strokeWidth={1.5} />
            install hooks
          </button>
        ) : hooksInstalled === false && !hooksReadable ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setHooksOpen(true);
            }}
            title="settings.json could not be parsed — open to see details"
            className="flex h-control-sm flex-none items-center gap-1 rounded border border-amber-border bg-amber-surface px-1.5 font-mono text-micro text-amber-text transition-colors duration-fast hover:bg-amber-surface"
          >
            <Plug size={11} strokeWidth={1.5} />
            hooks: settings.json unreadable
          </button>
        ) : null}
        <button
          onClick={(e) => {
            e.stopPropagation();
            clear();
          }}
          disabled={events.length === 0}
          title="Clear feed"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled"
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
        <span className="grid h-control-sm w-control-sm flex-none place-items-center text-content-muted">
          {collapsed ? (
            <ChevronUp size={13} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={13} strokeWidth={1.5} />
          )}
        </span>
      </div>
      {!collapsed && revealError !== null && (
        <div className="flex flex-none items-center gap-2 border-t border-border-subtle bg-danger-surface px-3 py-1">
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
      {!collapsed &&
        (events.length === 0 ? (
          <p className="border-t border-border-subtle px-3 py-4 text-center text-sm text-content-muted">
            No events yet. Install hooks, then run Claude Code in this project — or start
            barn demo mode.
          </p>
        ) : (
          <ul
            ref={listRef}
            className={`max-h-[168px] flex-none overflow-y-auto py-0.5 ${
              revealError === null ? "border-t border-border-subtle" : ""
            }`}
          >
            {events.map((e, i) => (
              <EventRow key={`${e.ts}-${i}`} event={e} root={root} onRevealError={setRevealError} />
            ))}
          </ul>
        ))}
      {hooksOpen && <HooksModal root={root} onClose={() => setHooksOpen(false)} />}
    </div>
  );
}
