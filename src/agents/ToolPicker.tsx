// Tools field — a tag-shaped trigger whose selection comes from a DROPDOWN,
// replacing the free-text ChipEditor that AgentEditor used for `tools:`.
//
// Free text was the wrong control for a closed-ish vocabulary that is
// case-sensitive and silently ignored when misspelled: "bash" costs an agent
// its shell and reports nothing. The catalog (agents/toolCatalog.ts) is now
// the same one NewAgentDialog uses, so creating and editing agree.
//
// WO12 — the popup leads with CAPABILITIES ("Read files", "Run commands"),
// not tool names. A user ticking boxes is answering "what may this agent
// do?", and capability labels stay true while tool names churn. Exact names
// remain reachable under Advanced, because that is how you debug an agent
// that lost its shell, and because a capability row cannot express every
// selection (MCP tools belong to no capability).
//
// The tri-state is load-bearing, not polish: an agent holding `Read, Glob`
// has SOME of "Read files", and a two-state checkbox would silently rewrite
// its frontmatter on save — the same lossy-round-trip bug WO11 A3 fixed in
// the project wizard. Only an explicit toggle writes; see applyCapability.
//
// Same trigger + portal-popup idiom as tasks/TagPicker.tsx — viewport-flip
// positioning, outside-pointerdown / Escape / scroll close — deliberately a
// parallel implementation rather than a shared one, for the reason TagPicker
// already documents: the shared ContextMenu primitive has no slot for the
// trailing text-input row, and here also none for grouped headers.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Minus, Plus, X } from "lucide-react";
import {
  CAPABILITIES,
  TOOL_GROUPS,
  TOOL_WILDCARD,
  applyCapability,
  capabilityState,
  isKnownTool,
  isMcpTool,
  normalizeToolInput,
  uncategorizedTools,
  type Capability,
} from "./toolCatalog";

function ToolPopup({
  anchor,
  selected,
  onChange,
  onClose,
}: {
  anchor: { x: number; y: number };
  selected: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: anchor.x,
    top: anchor.y,
    ready: false,
  });

  // Measure once mounted, then flip onto-screen on both axes. Re-runs when
  // Advanced expands, since that changes the popup's height.
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
  }, [anchor.x, anchor.y, advanced]);

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
    if (selected.includes(v)) return;
    onChange([...selected, v]);
  };

  const has = (t: string) => selected.includes(t);
  const wildcard = has(TOOL_WILDCARD);

  const toggleTool = (tool: string) => {
    onChange(has(tool) ? selected.filter((t) => t !== tool) : [...selected, tool]);
  };

  const toggleCapability = (cap: Capability) => {
    // "some" resolves toward granting the rest — the user clicked a
    // half-filled box, and completing it is the reading that never removes
    // something they already had.
    const next = capabilityState(selected, cap) !== "all";
    onChange(applyCapability(selected, cap, next));
  };

  const capRow = (cap: Capability) => {
    const state = capabilityState(selected, cap);
    const dim = wildcard && state !== "all";
    return (
      <button
        key={cap.key}
        type="button"
        role="menuitemcheckbox"
        aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
        onClick={() => toggleCapability(cap)}
        className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
      >
        <span
          aria-hidden
          className={`mt-[2px] grid h-[13px] w-[13px] flex-none place-items-center rounded-sm border ${
            state === "none"
              ? "border-border-strong bg-surface-2"
              : "border-accent bg-accent text-content-inverse"
          }`}
        >
          {state === "all" && <Check size={9} strokeWidth={3} />}
          {state === "some" && <Minus size={9} strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs ${dim ? "text-content-muted" : "text-content"}`}
          >
            {cap.label}
          </span>
          <span className="block truncate text-micro leading-snug text-content-disabled">
            {state === "some" ? `${partialLabel(selected, cap)} — click to grant all` : cap.hint}
          </span>
        </span>
      </button>
    );
  };

  const rawRow = (tool: string) => (
    <button
      key={tool}
      type="button"
      role="menuitemcheckbox"
      aria-checked={has(tool)}
      onClick={() => toggleTool(tool)}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
    >
      <span
        className={`min-w-0 flex-1 truncate font-mono text-2xs ${
          // Under the wildcard, a specific tick still records intent but
          // changes nothing — say so by dimming rather than by disabling,
          // which would hide what is already selected.
          wildcard ? "text-content-muted" : "text-content"
        }`}
      >
        {tool}
      </span>
      {has(tool) && <Check size={12} strokeWidth={2} className="flex-none text-accent-text" />}
    </button>
  );

  const extras = uncategorizedTools(selected);

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
      className="z-dropdown flex max-h-[420px] w-[288px] flex-col rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={wildcard}
          onClick={() => toggleTool(TOOL_WILDCARD)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-content">Everything</span>
          <span className="flex-none font-mono text-micro text-content-disabled">*</span>
          {wildcard && <Check size={13} strokeWidth={2} className="flex-none text-accent-text" />}
        </button>
        {wildcard && (
          <p className="px-2 pb-1 text-micro leading-snug text-content-muted">
            The wildcard already grants everything below.
          </p>
        )}

        <div className="my-1 border-t border-border-subtle" />
        {CAPABILITIES.map(capRow)}

        {extras.length > 0 && (
          <>
            <div className="px-2 pb-0.5 pt-2 font-mono text-micro uppercase tracking-wider text-content-disabled">
              Also selected
            </div>
            {extras.map(rawRow)}
          </>
        )}

        {/* Exact names stay reachable: a capability row cannot express every
            selection, and this is how you diagnose an agent that silently
            lost a tool. */}
        <div className="my-1 border-t border-border-subtle" />
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-micro uppercase tracking-wider text-content-disabled transition-colors duration-instant hover:bg-[var(--surface-hover)] hover:text-content-muted"
        >
          <ChevronRight
            size={11}
            strokeWidth={2}
            className={`flex-none transition-transform duration-fast ${advanced ? "rotate-90" : ""}`}
          />
          Advanced — exact tool names
        </button>
        {advanced &&
          TOOL_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-0.5 pt-1.5 font-mono text-micro uppercase tracking-wider text-content-disabled">
                {g.label}
              </div>
              {g.tools.map(rawRow)}
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

/** "2 of 4" — tells the user what "some" actually means without making them
 *  open Advanced to count. */
function partialLabel(selected: readonly string[], cap: Capability): string {
  const owned = cap.tools.filter((t) => selected.includes(t)).length;
  return `${owned} of ${cap.tools.length}`;
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
        <ToolPopup anchor={open} selected={items} onChange={onChange} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
