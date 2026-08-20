// Tools field (WO10 item 11) — a tag-shaped trigger whose selection comes
// from a DROPDOWN, replacing the free-text ChipEditor that AgentEditor used
// for `tools:`.
//
// Free text was the wrong control for a closed-ish vocabulary that is
// case-sensitive and silently ignored when misspelled: "bash" costs an agent
// its shell and reports nothing. The catalog (agents/toolCatalog.ts) is now
// the same one NewAgentDialog uses, so creating and editing agree.
//
// Same trigger + portal-popup idiom as tasks/TagPicker.tsx — viewport-flip
// positioning, outside-pointerdown / Escape / scroll close — deliberately a
// parallel implementation rather than a shared one, for the reason TagPicker
// already documents: the shared ContextMenu primitive has no slot for the
// trailing text-input row, and here also none for grouped headers.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import {
  TOOL_GROUPS,
  TOOL_WILDCARD,
  isKnownTool,
  isMcpTool,
  normalizeToolInput,
} from "./toolCatalog";

function ToolPopup({
  anchor,
  selected,
  onToggle,
  onAdd,
  onClose,
}: {
  anchor: { x: number; y: number };
  selected: string[];
  onToggle: (tool: string) => void;
  onAdd: (tool: string) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: anchor.x,
    top: anchor.y,
    ready: false,
  });

  // Measure once mounted, then flip onto-screen on both axes.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > vw - 4) left = Math.max(4, vw - rect.width - 4);
    if (top + rect.height > vh - 4) top = Math.max(4, vh - rect.height - 4);
    setPos({ left, top, ready: true });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popRef.current !== null && !popRef.current.contains(e.target as Node)) onClose();
    };
    // C3 fix (WO11_CONTRACT.md §2.1): the popup's own list is
    // overflow-y-auto, so scrolling it bubbles a capture-phase `scroll`
    // event to this window listener too — ignore anything that originates
    // inside the popup itself; only a scroll of whatever is BEHIND it
    // should close it (repositioning the popup to follow would be wrong).
    const onScroll = (e: Event) => {
      if (popRef.current !== null && e.target instanceof Node && popRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const submitDraft = () => {
    const v = normalizeToolInput(draft);
    setDraft("");
    if (v === "") return;
    onAdd(v);
  };

  const has = (t: string) => selected.includes(t);
  const wildcard = has(TOOL_WILDCARD);

  const row = (tool: string, label?: string) => (
    <button
      key={tool}
      type="button"
      role="menuitemcheckbox"
      aria-checked={has(tool)}
      onClick={() => onToggle(tool)}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
    >
      <span
        className={`min-w-0 flex-1 truncate font-mono text-xs ${
          // Under the wildcard, a specific tick still records intent but
          // changes nothing — say so by dimming rather than by disabling,
          // which would hide what is already selected.
          wildcard && tool !== TOOL_WILDCARD ? "text-content-muted" : "text-content"
        }`}
      >
        {label ?? tool}
      </span>
      {has(tool) && <Check size={13} strokeWidth={2} className="flex-none text-accent-text" />}
    </button>
  );

  return createPortal(
    <div
      ref={popRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        visibility: pos.ready ? "visible" : "hidden",
      }}
      className="z-dropdown flex max-h-[340px] w-[240px] flex-col rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {row(TOOL_WILDCARD, "*  (every tool)")}
        {wildcard && (
          <p className="px-2 pb-1 text-micro leading-snug text-content-muted">
            The wildcard already grants everything below.
          </p>
        )}
        {TOOL_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="px-2 pb-0.5 pt-1.5 font-mono text-micro uppercase tracking-wider text-content-disabled">
              {g.label}
            </div>
            {g.tools.map((t) => row(t))}
          </div>
        ))}
      </div>
      {/* MCP tool names are per-installation and cannot be enumerated, so the
          escape hatch is not optional. */}
      <div className="mt-1 flex items-center gap-1 border-t border-border-subtle pt-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDraft();
            }
          }}
          placeholder="mcp__server__tool…"
          className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent"
        />
        <button
          type="button"
          onClick={submitDraft}
          title="Add tool"
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          <Plus size={13} strokeWidth={1.5} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Trigger + popup. `items` is the caller-owned selection; `onChange`
 *  receives the full next selection (never a partial patch). */
export function ToolPicker({
  items,
  disabled,
  onChange,
}: {
  items: string[];
  disabled: boolean;
  onChange: (items: string[]) => void;
}) {
  const btnRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const openPopup = () => {
    if (disabled) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setOpen({ x: rect.left, y: rect.bottom + 4 });
  };

  const toggle = (tool: string) => {
    onChange(items.includes(tool) ? items.filter((t) => t !== tool) : [...items, tool]);
  };

  const add = (tool: string) => {
    if (items.includes(tool)) return;
    onChange([...items, tool]);
  };

  const remove = (tool: string) => onChange(items.filter((t) => t !== tool));

  return (
    <div>
      <div
        ref={btnRef}
        role="button"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        tabIndex={disabled ? -1 : 0}
        onClick={openPopup}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPopup();
          }
        }}
        className={`flex flex-wrap items-center gap-1.5 rounded border border-border bg-surface-2 p-1.5 outline-none transition-colors duration-fast ${
          disabled ? "cursor-not-allowed" : "cursor-default focus:border-accent"
        }`}
      >
        {items.length === 0 && (
          <span className="px-0.5 text-sm text-content-disabled">
            Inherits every tool — pick to restrict…
          </span>
        )}
        {items.map((tool) => {
          const known = isKnownTool(tool);
          const mcp = isMcpTool(tool);
          return (
            <span
              key={tool}
              // An unrecognized, non-MCP name is almost always a typo, and a
              // typo'd tool is dropped silently by Claude Code. Amber, not
              // red: it may also be a tool newer than this catalog.
              title={
                known
                  ? undefined
                  : mcp
                    ? "MCP tool — not in the catalog, and can't be"
                    : "Not a known tool name. Tool names are case-sensitive."
              }
              className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-2xs ${
                known || mcp
                  ? "border-border-strong bg-surface-3 text-content"
                  : "border-amber-border bg-amber-surface text-amber-text"
              }`}
            >
              {tool}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(tool);
                  }}
                  className="text-content-muted transition-colors duration-fast hover:text-content"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {open !== null && (
        <ToolPopup
          anchor={open}
          selected={items}
          onToggle={toggle}
          onAdd={add}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
