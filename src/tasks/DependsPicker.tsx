// Dependency picker (WO06 U1-board) — same trigger+portal-popup idiom as
// TagPicker.tsx (viewport-flip positioning, outside-pointerdown / Escape /
// scroll close, refocus the trigger on close). Distinct from TagPicker
// because linking is async (task_id_ensure + task_depends_add/remove round
// trip through Rust) and can be rejected (cycle / self / unknown / duplicate
// id) — the popup owns its own busy/error state and surfaces the rejection
// message verbatim, since it's Rust's own ordered-path text.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GitBranch, Loader2, X } from "lucide-react";
import type { TaskItem } from "../tasks/api";
import { statusOf } from "../store/tasks";

const TRIGGER_CHIP =
  "flex h-control-sm flex-none items-center gap-1 rounded-sm border px-1.5 font-mono text-micro transition-colors duration-fast";

/** Resolve a `needs:` token to the task that minted it, if any is currently
 *  scanned. Absent = TaskDag.unresolved territory — reported, not fatal. */
function resolveDep(depId: string, allTasks: TaskItem[]): TaskItem | undefined {
  return allTasks.find((t) => t.taskId === depId);
}

const ROW_LABEL = "min-w-0 flex-1 truncate text-xs";
const ROW_SUB = "flex-none truncate font-mono text-micro text-content-disabled";

/** A currently-linked dependency — not itself clickable, its own remove
 *  button (or busy spinner) is the only affordance. */
function LinkedRow({ label, sub, dim, trailing }: { label: string; sub: string; dim: boolean; trailing: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left">
      <span className={`${ROW_LABEL} ${dim ? "text-content-muted italic" : "text-content"}`}>{label}</span>
      <span className={ROW_SUB}>{sub}</span>
      {trailing}
    </div>
  );
}

/** A linkable candidate — a real `<button>` so it's keyboard-operable
 *  (Enter/Space) without any extra wiring. */
function CandidateRow({
  label,
  sub,
  onClick,
  trailing,
}: {
  label: string;
  sub: string;
  onClick: (() => void) | undefined;
  trailing: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={onClick === undefined}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)] disabled:cursor-wait"
    >
      <span className={`${ROW_LABEL} text-content`}>{label}</span>
      <span className={ROW_SUB}>{sub}</span>
      {trailing}
    </button>
  );
}

function DependsPopup({
  anchor,
  item,
  allTasks,
  onAdd,
  onRemove,
  onClose,
}: {
  anchor: { x: number; y: number };
  item: TaskItem;
  allTasks: TaskItem[];
  onAdd: (target: TaskItem) => Promise<string | null>;
  onRemove: (dependsOnId: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // id-ish key of the in-flight row
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: anchor.x,
    top: anchor.y,
    ready: false,
  });

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

  const runAdd = (target: TaskItem) => {
    setError(null);
    setBusy(target.id);
    void onAdd(target).then((err) => {
      setBusy(null);
      if (err !== null) setError(err);
    });
  };

  const runRemove = (depId: string) => {
    setError(null);
    setBusy(depId);
    void onRemove(depId).then((err) => {
      setBusy(null);
      if (err !== null) setError(err);
    });
  };

  const q = query.trim().toLowerCase();
  const candidates = allTasks
    .filter((t) => t.id !== item.id)
    .filter((t) => !(t.taskId !== null && item.dependsOn.includes(t.taskId)))
    .filter((t) => q === "" || t.name.toLowerCase().includes(q))
    .slice(0, 40);

  return createPortal(
    <div
      ref={popRef}
      // O4 fix (WO06 audit): this popup owns a text <input> and plain
      // <button>s, neither of which is a valid role="menu" child (ARIA 1.2
      // required-owned-elements) — a screen reader announced "menu" with
      // zero items. `dialog`/`aria-modal="false"` matches the actual content
      // (a non-modal panel of mixed controls), same fix shape the audit
      // prescribed. onBlur below is the focusout-close: Tab out of the last
      // candidate now closes the popup instead of leaving it open detached
      // from focus. Gated on a non-null relatedTarget on purpose — runAdd's
      // own setBusy(...) disables the just-clicked candidate button, which
      // blurs it with relatedTarget === null (disabling a focused element
      // has no "next" focus target); closing on THAT blur would drop the
      // popup the instant a link click lands, before the confirmed-linked
      // row ever renders. A real Tab out of the popup always carries a
      // concrete relatedTarget, so this still catches the keyboard case the
      // audit flagged without regressing the mouse-click case.
      role="dialog"
      aria-modal="false"
      aria-label={`Dependencies for ${item.name}`}
      onBlur={(e) => {
        if (e.relatedTarget !== null && !e.currentTarget.contains(e.relatedTarget as Node)) onClose();
      }}
      style={{ position: "fixed", left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      className="z-dropdown flex max-h-[340px] w-[260px] flex-col rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none"
    >
      {item.dependsOn.length > 0 && (
        <>
          <div className="flex min-h-0 max-h-[128px] flex-col overflow-y-auto">
            {item.dependsOn.map((depId) => {
              const dep = resolveDep(depId, allTasks);
              const doneDep = dep !== undefined && statusOf(dep) === "done";
              return (
                <LinkedRow
                  key={depId}
                  label={dep?.name ?? depId}
                  sub={dep === undefined ? "unresolved" : doneDep ? "done" : STATUS_SHORT[statusOf(dep)]}
                  dim={dep === undefined}
                  trailing={
                    busy === depId ? (
                      <Loader2 size={11} className="flex-none animate-spin text-content-muted" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => runRemove(depId)}
                        title="Remove dependency"
                        className="flex-none text-content-muted transition-colors duration-fast hover:text-danger-text"
                      >
                        <X size={11} strokeWidth={1.5} />
                      </button>
                    )
                  }
                />
              );
            })}
          </div>
          <div className="my-1 border-t border-border-subtle" />
        </>
      )}
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Link a task…"
        className="h-control-sm min-w-0 flex-none rounded border border-border bg-surface-2 px-1.5 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent"
      />
      <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {candidates.length === 0 && (
          <p className="px-2 py-1.5 text-2xs text-content-disabled">
            {q === "" ? "No other tasks to link." : "No match."}
          </p>
        )}
        {candidates.map((t) => (
          <CandidateRow
            key={t.id}
            label={t.name}
            sub={t.relPath.split("/").pop()?.replace(/\.md$/i, "") ?? ""}
            onClick={busy === null ? () => runAdd(t) : undefined}
            trailing={
              busy === t.id ? (
                <Loader2 size={11} className="flex-none animate-spin text-content-muted" />
              ) : undefined
            }
          />
        ))}
      </div>
      {error !== null && (
        <p className="mt-1 max-h-[72px] overflow-y-auto border-t border-border-subtle px-1 pt-1 font-mono text-2xs leading-relaxed text-danger-text">
          {error}
        </p>
      )}
    </div>,
    document.body,
  );
}

const STATUS_SHORT: Record<string, string> = {
  new: "new",
  "in-production": "in prod",
  "in-testing": "testing",
  done: "done",
};

/** Trigger chip (task-graph icon + count) + popup. `allTasks` is every
 *  scanned task across all five files — a dependency can name a task in any
 *  of them. `onAdd`/`onRemove` are store actions bound by the caller. */
export function DependsPicker({
  item,
  allTasks,
  disabled,
  onAdd,
  onRemove,
}: {
  item: TaskItem;
  allTasks: TaskItem[];
  disabled: boolean;
  onAdd: (target: TaskItem) => Promise<string | null>;
  onRemove: (dependsOnId: string) => Promise<string | null>;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const openPopup = () => {
    if (disabled) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setOpen({ x: rect.left, y: rect.bottom + 4 });
  };

  const count = item.dependsOn.length;
  const label = count > 0 ? `Depends on ${count} task${count === 1 ? "" : "s"}` : "Link a dependency";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={label}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          openPopup();
        }}
        title={label}
        className={`${TRIGGER_CHIP} ${
          count > 0
            ? "border-border-strong bg-surface-3 text-content-secondary"
            : "border-border bg-surface-2 text-content-disabled"
        } ${disabled ? "cursor-not-allowed" : "cursor-default hover:text-content"}`}
      >
        <GitBranch size={10} strokeWidth={1.5} />
        {count > 0 && count}
      </button>
      {open !== null && (
        <DependsPopup
          anchor={open}
          item={item}
          allTasks={allTasks}
          onAdd={onAdd}
          onRemove={onRemove}
          onClose={() => {
            setOpen(null);
            btnRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
