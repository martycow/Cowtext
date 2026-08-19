// Tag dropdown (WO02 #12, contract §7.9) — replaces ChipEditor for tags in
// both NewTaskDialog and the Inspector's TaskPanel. ChipEditor itself
// (AgentEditor.tsx) is untouched — U3's zone.
//
// Trigger renders the selected tags as chips; clicking it (not a chip's own
// remove button) opens a popup listing every known tag (`allTags(tasks)`)
// with a check state, plus a bottom row to create a new one. Positioning
// follows the RoleField / CompileSplitButton idiom — button rect -> x /
// bottom+4 — not a right-click menu. The popup isn't the shared ContextMenu
// primitive: that has no slot for a trailing text-input row, so this owns a
// small parallel implementation of the same viewport-flip / outside-close /
// Escape behaviour.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import { allTags, useTasksStore } from "../store/tasks";

function normalizeTagInput(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function hasTag(items: string[], tag: string): boolean {
  return items.some((t) => t.toLowerCase() === tag.toLowerCase());
}

function TagPopup({
  anchor,
  selected,
  onToggle,
  onAdd,
  onClose,
}: {
  anchor: { x: number; y: number };
  selected: string[];
  onToggle: (tag: string) => void;
  onAdd: (tag: string) => void;
  onClose: () => void;
}) {
  const tasks = useTasksStore((s) => s.tasks);
  const options = allTags(tasks);
  const popRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: anchor.x,
    top: anchor.y,
    ready: false,
  });

  // Measure once mounted, then flip onto-screen on both axes — same idiom
  // as ContextMenu.tsx.
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
    const onScroll = () => onClose();
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
    const v = normalizeTagInput(draft);
    setDraft("");
    if (v === "") return;
    onAdd(v);
  };

  return createPortal(
    <div
      ref={popRef}
      role="menu"
      style={{ position: "fixed", left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      className="z-dropdown flex max-h-[280px] w-[220px] flex-col rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {options.length === 0 && (
          <p className="px-2 py-1.5 text-2xs text-content-disabled">No tags yet.</p>
        )}
        {options.map((tag) => {
          const checked = hasTag(selected, tag);
          return (
            <button
              key={tag}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => onToggle(tag)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-content">#{tag}</span>
              {checked && <Check size={13} strokeWidth={2} className="flex-none text-accent-text" />}
            </button>
          );
        })}
      </div>
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
          placeholder="new tag…"
          className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent"
        />
        <button
          type="button"
          onClick={submitDraft}
          title="Add tag"
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
export function TagPicker({
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

  const toggle = (tag: string) => {
    onChange(hasTag(items, tag) ? items.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...items, tag]);
  };

  const add = (tag: string) => {
    if (hasTag(items, tag)) return;
    onChange([...items, tag]);
  };

  const remove = (tag: string) => onChange(items.filter((t) => t !== tag));

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
        {items.length === 0 && <span className="px-0.5 text-sm text-content-disabled">Add tags…</span>}
        {items.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-sm border border-border-strong bg-surface-3 px-1.5 py-0.5 font-mono text-2xs text-content"
          >
            #{tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(tag);
                }}
                className="text-content-muted transition-colors duration-fast hover:text-content"
              >
                <X size={9} strokeWidth={1.5} />
              </button>
            )}
          </span>
        ))}
      </div>
      {open !== null && (
        <TagPopup
          anchor={open}
          selected={items}
          onToggle={toggle}
          onAdd={add}
          onClose={() => {
            setOpen(null);
            btnRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
