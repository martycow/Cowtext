// Shared drag handle for the two side panels (contract §7.3/§7.4). 4px
// visible line inside a 10px hit strip, pointer capture, double-click reset,
// arrow-key nudge. Clamping is the caller's setter's job (PANEL_LIMITS in
// store/settings.ts) — this component only reports a raw next-width.

import { useCallback, useRef } from "react";

import { useSettingsStore } from "../store/settings";

interface ResizeHandleProps {
  /** Current panel width in px. */
  value: number;
  /** Default width, restored on double-click. */
  defaultValue: number;
  /** "left" = the panel being resized sits to the LEFT of this handle
   *  (dragging right grows it); "right" = the panel sits to the right
   *  (dragging right shrinks it). Purely a drag-direction mapping — the
   *  store setter still owns min/max clamping. */
  side: "left" | "right";
  onChange: (px: number) => void;
  label: string;
}

const ARROW_STEP = 16;

export function ResizeHandle({ value, defaultValue, side, onChange, label }: ResizeHandleProps) {
  const dragRef = useRef<{ x: number; value: number; scale: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      // WO15 fix round (F7). `value` is a width applied INSIDE the `ct-zoom`
      // wrapper (App.tsx), i.e. in the panel's own scaled coordinate space,
      // while `clientX` is always real viewport px — at 130 % the edge
      // outran the cursor by 30 %. The scale is read once per drag rather
      // than per move, so a single drag uses a single factor.
      dragRef.current = { x: e.clientX, value, scale: useSettingsStore.getState().uiScale / 100 };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragRef.current;
      if (start === null) return;
      const dx = (e.clientX - start.x) / start.scale;
      const delta = side === "left" ? dx : -dx;
      // Whole px only: the division is the one place a fractional width can
      // enter, and it would otherwise be persisted into settings.json.
      onChange(Math.round(start.value + delta));
    },
    [onChange, side],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onChange(value - ARROW_STEP);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onChange(value + ARROW_STEP);
      }
    },
    [onChange, value],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
      className="group relative z-sticky w-[10px] flex-none cursor-col-resize touch-none select-none"
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[4px] -translate-x-1/2 bg-transparent transition-colors duration-fast group-hover:bg-accent-border" />
    </div>
  );
}
