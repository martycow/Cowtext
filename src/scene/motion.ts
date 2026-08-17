// Reduced-motion accessor for the scene (PHASE56_CONTRACT §7.1). The one
// place the scene reads calm mode / OS prefers-reduced-motion; everything
// juice-related gates on reducedMotion(). Cached via a store subscription so
// per-frame callers never touch Zustand's getState in the hot path.

import { useSettingsStore, selectReducedMotion } from "../store/settings";

let reduced = selectReducedMotion(useSettingsStore.getState());
useSettingsStore.subscribe((s) => {
  reduced = selectReducedMotion(s);
});

/** True when calm mode is on OR the OS requests reduced motion. */
export function reducedMotion(): boolean {
  return reduced;
}
