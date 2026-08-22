// Cross-panel UI state (WO15 §4.3) — the small set of "which shell-level
// thing is open, and with what prefill" flags that more than one panel has
// to agree on. Deliberately NOT a dumping ground: component-local state
// stays component-local. A flag earns a place here only when the opener and
// the mount live in different trees (a canvas context menu opening a dialog
// App.tsx mounts; the Barn's legend opening the hooks modal). No React
// imports, no persistence — every field here is session state.

import { create } from "zustand";

/** Prefill for the agent wizard (Block 5b). Both fields are optional: the
 *  rail's plain "Create agent" passes nothing. */
export interface AgentWizardOpts {
  /** Flow-space position for the agent's canvas node; null/absent = the
   *  agent is created in the rail only, with no node placed. */
  position?: { x: number; y: number } | null;
  /** Node the new agent should `imports`; null/absent = no edge. */
  contextNodeId?: string | null;
}

export interface UiState {
  agentWizard: {
    open: boolean;
    position: { x: number; y: number } | null;
    contextNodeId: string | null;
  };
  /** Opens the wizard with (or without) a prefill. Calling it with no opts
   *  RESETS position/contextNodeId — a stale prefill from the last "New
   *  agent from this node…" must never leak into a plain rail create. */
  openAgentWizard: (opts?: AgentWizardOpts) => void;
  closeAgentWizard: () => void;
  /** The hooks/trust-boundary modal. App.tsx owns the single mount; the
   *  event log and the Barn legend both open it. */
  hooksModalOpen: boolean;
  setHooksModalOpen: (open: boolean) => void;
}

const CLOSED_AGENT_WIZARD = { open: false, position: null, contextNodeId: null } as const;

export const useUiStore = create<UiState>((set) => ({
  agentWizard: { ...CLOSED_AGENT_WIZARD },

  openAgentWizard: (opts) =>
    set({
      agentWizard: {
        open: true,
        position: opts?.position ?? null,
        contextNodeId: opts?.contextNodeId ?? null,
      },
    }),

  closeAgentWizard: () => set({ agentWizard: { ...CLOSED_AGENT_WIZARD } }),

  hooksModalOpen: false,
  setHooksModalOpen: (open) => set({ hooksModalOpen: open }),
}));
