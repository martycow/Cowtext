// Assemble confirmation gate (WO12 F7) — the always-on trust boundary in
// front of assemble/refine/summarize. House style: no React imports here
// (see store/toasts.ts), single entry point. `requestAssemble` only sets
// `pending`; it never calls `assemblePreview` or the underlying invoke
// itself — `AssembleConfirmModal` (mounted once by app-shell, wave 3) reads
// `pending`, previews, and on Approve calls `pending.onApprove()` then
// `clear()`.
//
// Seam contract for later lanes: call sites across the app (inspector,
// canvas node cards, the node wizard, etc.) call `requestAssemble` instead
// of `assembleNode`/`refineNode`/`summarizeNode` directly. The signature is
// FROZEN:
//   export interface AssembleGateRequest { root: string; graphJson: string;
//     nodeId: string; mode: AssembleMode; instruction: string | null;
//     onApprove: () => void | Promise<void>; }
//   export function requestAssemble(req: AssembleGateRequest): void;
// There is NO opt-out setting — the gate is always on (contract decision).

import { create } from "zustand";
import type { AssembleMode } from "./types";

export interface AssembleGateRequest {
  root: string;
  graphJson: string;
  nodeId: string;
  mode: AssembleMode;
  instruction: string | null;
  onApprove: () => void | Promise<void>;
}

interface GateState {
  pending: AssembleGateRequest | null;
  request: (req: AssembleGateRequest) => void;
  clear: () => void;
}

export const useAssembleGateStore = create<GateState>((set) => ({
  pending: null,
  request: (req) => set({ pending: req }),
  clear: () => set({ pending: null }),
}));

/** The byte-exact entry point every call site imports. Delegates straight
 *  to the store's own `request` — never invokes anything itself. */
export function requestAssemble(req: AssembleGateRequest): void {
  useAssembleGateStore.getState().request(req);
}
