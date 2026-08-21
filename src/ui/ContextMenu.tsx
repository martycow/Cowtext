// The dynamic context menu (contract §7.9). One primitive shared by all
// eight surfaces. Items are supplied per-open by the caller — this component
// only renders them and owns positioning, viewport-flip, keyboard nav and
// close-on-* behaviour.

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { MenuItem } from "./menuTypes";

function isSelectable(item: MenuItem): item is Extract<MenuItem, { kind: "item" }> {
  return item.kind === "item" && item.disabled !== true;
}

/** WO13_CONTRACT.md §2.3 (defect 3), Stage 0: which surface this menu is
 *  opened above. Determines the z-index class so the menu paints in front
 *  of its host rather than behind it — `ContextMenu` is a `position: fixed`
 *  portal to `document.body`, so its stacking order is decided by z-index
 *  alone, not DOM nesting. Default `"dropdown"` keeps every pre-WO13 call
 *  site's exact prior behaviour (`z-dropdown`, unchanged). `"modal"` is for
 *  a menu opened from inside a `z-modal` dialog (e.g. the New Agent
 *  modal's avatar menu, a `ToolPicker` inside any modal) — it needs a
 *  z-index ABOVE `z-modal` (200), so it uses `z-toast` (300). `"toast"` is
 *  for a menu opened from inside a toast action — needs to sit above THAT,
 *  so it uses `z-palette` (400). This is a z-index selection, not a
 *  semantic claim that the menu IS a toast. */
export type ContextMenuLayer = "dropdown" | "modal" | "toast";

const LAYER_CLASS: Record<ContextMenuLayer, string> = {
  dropdown: "z-dropdown",
  modal: "z-toast",
  toast: "z-palette",
};

export function ContextMenu(props: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** @default "dropdown" */
  layer?: ContextMenuLayer;
}): JSX.Element | null {
  const { x, y, items, onClose, layer = "dropdown" } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: x,
    top: y,
    ready: false,
  });
  const [activeIndex, setActiveIndex] = useState<number>(() => items.findIndex(isSelectable));

  // Measure once mounted, then flip onto-screen on both axes.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 4) left = Math.max(4, vw - rect.width - 4);
    if (top + rect.height > vh - 4) top = Math.max(4, vh - rect.height - 4);
    setPos({ left, top, ready: true });
  }, [x, y]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onScroll = () => onClose();
    const onBlur = () => onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  const move = (dir: 1 | -1) => {
    setActiveIndex((cur) => {
      const n = items.length;
      if (n === 0) return cur;
      let i = cur;
      for (let step = 0; step < n; step += 1) {
        i = (i + dir + n) % n;
        if (isSelectable(items[i])) return i;
      }
      return cur;
    });
  };

  const selectActive = () => {
    const item = items[activeIndex];
    if (item !== undefined && isSelectable(item)) {
      item.onSelect();
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const i = items.findIndex(isSelectable);
      if (i >= 0) setActiveIndex(i);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (isSelectable(items[i])) {
          setActiveIndex(i);
          break;
        }
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectActive();
    }
  };

  const activeId = items[activeIndex]?.id;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-activedescendant={activeId !== undefined ? `ct-menu-item-${activeId}` : undefined}
      onKeyDown={onKeyDown}
      style={{ position: "fixed", left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      className={`${LAYER_CLASS[layer]} min-w-[190px] max-w-[320px] rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none`}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") {
          return <div key={item.id} role="separator" className="my-1 h-px bg-border-subtle" />;
        }
        const Icon = item.icon;
        const active = i === activeIndex && item.disabled !== true;
        return (
          <button
            key={item.id}
            id={`ct-menu-item-${item.id}`}
            role="menuitem"
            aria-disabled={item.disabled === true}
            disabled={item.disabled === true}
            onMouseEnter={() => {
              if (item.disabled !== true) setActiveIndex(i);
            }}
            onClick={() => {
              if (item.disabled === true) return;
              item.onSelect();
              onClose();
            }}
            className={`flex w-full flex-col items-stretch gap-0.5 rounded px-2 py-1.5 text-left transition-colors duration-instant disabled:cursor-not-allowed disabled:text-content-disabled ${
              item.danger ? "text-danger-text" : "text-content"
            } ${active ? "bg-[var(--surface-hover)]" : ""}`}
          >
            <span className="flex items-center gap-2">
              {Icon !== undefined && <Icon size={13} strokeWidth={1.5} className="flex-none" />}
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              {item.checked === true && (
                <Check size={13} strokeWidth={2} className="flex-none text-accent-text" />
              )}
            </span>
            {/* Explains a disabled row (contract §7.9); the role popup also
                reuses this line for its description text on enabled rows. */}
            {item.hint !== undefined && (
              <span className="text-2xs leading-snug text-content-disabled">{item.hint}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
