// Toast/notification store (WO12 F1) — the channel the app has never had.
// House style: no React imports here (see events.ts), single entry point,
// ring-cap idiom borrowed from events.ts's MAX_EVENTS. Usable from non-React
// code (store/settings.ts, handoff/*.tsx catch blocks) via the plain
// `pushToast` function below — that is deliberate, not an oversight.
//
// Seam contract for later lanes: other lanes (canvas/MemoryNodeCard.tsx,
// inspector/Inspector.tsx, etc.) call `pushToast` in wave 2. The signature is
// FROZEN:
//   export function pushToast(t: { severity: ToastSeverity; title: string;
//     detail?: string; timeoutMs?: number }): string
// Do not rename it, do not change its argument shape, do not make it async.
//
// WO13_CONTRACT.md §3.4 (Stage 0): `pushToast` stays byte-identical — every
// existing call site is untouched. A sibling, `pushToastWithAction`, is
// added for the Undo affordance the node wizard's step-4 Confirm and the
// agent modal's Create both need (§12.2). `pushToast` internally delegates
// to the same store `push` this sibling uses.

import { create } from "zustand";

export type ToastSeverity = "info" | "success" | "warning" | "danger";

/** WO13 §3.4: a toast's optional action button. `run` may be async (e.g.
 *  `fsApplyBatch` for Undo); the host renders a loading state around it but
 *  that is the toast HOST's concern, not this store's. */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  severity: ToastSeverity;
  title: string;
  detail?: string;
  /** ms until auto-dismiss; 0 = sticky, never auto-dismisses. */
  timeoutMs: number;
  ts: number;
  /** WO13 §3.4: present ⇒ the toast renders an action button (e.g. "Undo").
   *  A toast carrying one is NEVER deduped — see `push`'s dedupe skip
   *  below, and the doc comment on `dedupeKey`. */
  action?: ToastAction;
}

/** Default auto-dismiss windows by severity. Danger is sticky (0) —
 *  an error the user never saw is the exact bug this store exists to fix. */
const DEFAULT_TIMEOUT_MS: Record<ToastSeverity, number> = {
  info: 4000,
  success: 4000,
  warning: 7000,
  danger: 0,
};

/** Hard cap on simultaneously-visible toasts. Eviction always takes the
 *  oldest NON-danger toast first, so a burst of successes can never push an
 *  error off screen (an all-danger burst still evicts oldest-first). */
export const MAX_TOASTS = 4;

/** Same title+detail+severity within this window is treated as a repeat and
 *  dropped rather than stacked — the fs://change watcher can otherwise fire
 *  the same failure repeatedly. */
const DEDUPE_WINDOW_MS = 2000;

let nextId = 1;

interface PushInput {
  severity: ToastSeverity;
  title: string;
  detail?: string;
  timeoutMs?: number;
  action?: ToastAction;
}

interface ToastsState {
  toasts: Toast[];
  push: (t: PushInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

// WO13 §3.4: hashes severity/title/detail only, deliberately blind to
// `action`. Two toasts with the same text inside DEDUPE_WINDOW_MS collapse
// into one; if the second carried an Undo closure, that closure would be
// discarded and a later click on the surviving toast's Undo would revert
// the wrong write. `push` below skips the dedupe lookup entirely whenever
// `t.action !== undefined`, rather than widening this key, so every other
// call site (never carrying an action) keeps its exact prior behaviour.
function dedupeKey(t: { severity: ToastSeverity; title: string; detail?: string }): string {
  return `${t.severity} ${t.title} ${t.detail ?? ""}`;
}

export const useToastsStore = create<ToastsState>((set, get) => ({
  toasts: [],

  push: (t) => {
    const now = Date.now();
    if (t.action === undefined) {
      const key = dedupeKey(t);
      const dup = get().toasts.find(
        (x) => x.action === undefined && dedupeKey(x) === key && now - x.ts < DEDUPE_WINDOW_MS,
      );
      if (dup !== undefined) return dup.id;
    }

    const id = String(nextId);
    nextId += 1;
    const entry: Toast = {
      id,
      severity: t.severity,
      title: t.title,
      detail: t.detail,
      timeoutMs: t.timeoutMs ?? DEFAULT_TIMEOUT_MS[t.severity],
      ts: now,
      action: t.action,
    };

    set((st) => {
      const toasts = [...st.toasts, entry];
      while (toasts.length > MAX_TOASTS) {
        const victimIdx = toasts.findIndex((x) => x.severity !== "danger");
        toasts.splice(victimIdx === -1 ? 0 : victimIdx, 1);
      }
      return { toasts };
    });
    return id;
  },

  dismiss: (id) => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

/** The byte-exact entry point every non-React (and React) call site imports.
 *  Delegates straight to the store's own push. FROZEN — every existing call
 *  site stays byte-identical (WO13_CONTRACT.md §3.4). */
export function pushToast(t: {
  severity: ToastSeverity;
  title: string;
  detail?: string;
  timeoutMs?: number;
}): string {
  return useToastsStore.getState().push(t);
}

/** WO13 §3.4: the sibling `pushToast` gains for the Undo affordance (node
 *  wizard step-4 Confirm, agent modal Create — §12.2). A toast pushed
 *  through here is never deduped — see `dedupeKey`'s doc comment above. */
export function pushToastWithAction(t: {
  severity: ToastSeverity;
  title: string;
  detail?: string;
  timeoutMs?: number;
  action: ToastAction;
}): string {
  return useToastsStore.getState().push(t);
}
