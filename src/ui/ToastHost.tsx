// Toast host (WO12 F1) — the notification channel the app has never had.
// Mounted exactly once by the app-shell lane in wave 3. Zero props: reads
// src/store/toasts.ts directly. Renders inline (NOT a portal) so it stays on
// the same z-scale every modal and ContextMenu already relies on —
// `--z-toast` (300) sits above modal (200) and below palette (400), which is
// the intended ordering.

import { useEffect, useRef, useState, type JSX } from "react";
import { X } from "lucide-react";
import { useToastsStore, type Toast, type ToastSeverity } from "../store/toasts";

const SEVERITY_BAR: Record<ToastSeverity, string> = {
  info: "bg-accent",
  success: "bg-success",
  warning: "bg-amber",
  danger: "bg-danger",
};

/** Danger and warning both interrupt (assertive) — info/success are ambient
 *  confirmations (polite). Danger is additionally sticky (timeoutMs === 0). */
function isUrgent(severity: ToastSeverity): boolean {
  return severity === "danger" || severity === "warning";
}

/** Arms (or re-arms) the auto-dismiss timer from whatever time remains.
 *  No-op for a sticky toast (remaining <= 0, i.e. timeoutMs === 0). Module-
 *  level and ref-parameterized on purpose: it closes over nothing from
 *  render scope, so it never needs to appear in an effect's dep array. */
function armTimer(
  toastId: string,
  remainingRef: React.MutableRefObject<number>,
  startRef: React.MutableRefObject<number | null>,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  dismiss: (id: string) => void,
): void {
  if (remainingRef.current <= 0) return;
  startRef.current = Date.now();
  timerRef.current = setTimeout(() => dismiss(toastId), remainingRef.current);
}

/** Disarms the timer, banking whatever time was left into remainingRef so a
 *  later re-arm (mouseleave) resumes instead of restarting the full window. */
function disarmTimer(
  startRef: React.MutableRefObject<number | null>,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  remainingRef: React.MutableRefObject<number>,
): void {
  if (timerRef.current === null) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
  if (startRef.current !== null) {
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startRef.current));
    startRef.current = null;
  }
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastsStore((s) => s.dismiss);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<number | null>(null);
  const remainingRef = useRef(toast.timeoutMs);
  const [entered, setEntered] = useState(false);

  // Enter transition: translateY(4px) -> 0 + opacity, over --dur-base
  // --ease-out. Reduced motion needs no extra work here — tokens.css clamps
  // every transition globally under prefers-reduced-motion.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    armTimer(toast.id, remainingRef, startRef, timerRef, dismiss);
    return () => disarmTimer(startRef, timerRef, remainingRef);
  }, [toast.id, dismiss]);

  const urgent = isUrgent(toast.severity);

  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      onMouseEnter={() => disarmTimer(startRef, timerRef, remainingRef)}
      onMouseLeave={() => armTimer(toast.id, remainingRef, startRef, timerRef, dismiss)}
      className="pointer-events-auto flex w-[340px] items-start gap-0 overflow-hidden rounded-lg border border-border bg-surface-3 shadow-[var(--elev-3)] transition-[transform,opacity] duration-base ease-out"
      style={{ transform: entered ? "translateY(0)" : "translateY(4px)", opacity: entered ? 1 : 0 }}
    >
      <span className={`h-full w-[2px] flex-none self-stretch ${SEVERITY_BAR[toast.severity]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pl-2.5 pr-1">
        <span className="text-base leading-snug text-content">{toast.title}</span>
        {toast.detail !== undefined && (
          <span className="break-words font-mono text-xs leading-relaxed text-content-secondary">
            {toast.detail}
          </span>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        title="Dismiss"
        className="grid h-control-sm w-control-sm flex-none place-items-center self-start text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function ToastHost(): JSX.Element {
  const toasts = useToastsStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-toast flex flex-col-reverse gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
