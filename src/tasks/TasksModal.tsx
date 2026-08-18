// Tasks modal (contract §7) — PresetsModal shell idiom, hosting the reusable
// <TasksBoard/> unfiltered (agentFilter left undefined so the board drives
// its own store-backed filter + picker).

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTasksStore } from "../store/tasks";
import { TasksBoard } from "./TasksBoard";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent disabled:hover:text-content-disabled";

export function TasksModal({ root, onClose }: { root: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const load = useTasksStore((s) => s.load);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    void load(root);
  }, [root, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tasks"
        tabIndex={-1}
        className="flex h-[80vh] w-[1040px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Tasks</span>
          <div className="min-w-0 flex-1" />
          <span className="min-w-0 max-w-[300px] truncate font-mono text-2xs text-content-muted" title={root}>
            {root}
          </span>
          <button onClick={onClose} title="Close" className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <TasksBoard />
      </div>
    </div>
  );
}
