// WO11 G3 — a fourth panel-owning selection, alongside the graph's own
// node/edge selection and the agents/tasks stores' selections. The project
// row in the Hierarchy (UI-B, App.tsx) has no id of its own — there is only
// ever one project open at a time — so this is a bare boolean, not a
// selected-id set.
//
// Frozen cross-lane seam (WO11_CONTRACT.md §5.4/§6): byte-exact shape,
// produced here, consumed by UI-B's rail. `useGraphStore.setSelection`
// clears this alongside the agents/tasks selections so the Inspector's
// branch ladder never shows two panels' worth of stale state at once.
import { create } from "zustand";

interface ProjectSelectionState {
  selected: boolean;
  select: (v: boolean) => void;
}

export const useProjectSelectionStore = create<ProjectSelectionState>((set) => ({
  selected: false,
  select: (v) => set({ selected: v }),
}));
