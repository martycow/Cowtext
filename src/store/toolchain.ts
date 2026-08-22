// AI-toolchain scan store (WO15 §4.2, Block 5a) — the ONE place a
// `detect_ai_tools` result lives. The title screen used to own this as
// component state (`useToolScan`), which meant the scan restarted on every
// mount and no other surface could read it; the agent modal's provider chips
// need the same answer, so it moved into a store. No React imports here.

import { create } from "zustand";
import { detectAiTools, type AiTool } from "../project/toolchain";
import { useEventsStore } from "./events";
import type { CompileTarget } from "./graph";

export type ToolchainPhase = "idle" | "scanning" | "done" | "failed";

export interface ToolchainState {
  phase: ToolchainPhase;
  /** Empty until the first scan completes; the title screen keeps its own
   *  placeholder rows so the panel is never a short list. */
  tools: AiTool[];
  error: string | null;
  /** `Date.now()` at completion; null until the first scan finishes. */
  scannedAt: number | null;
  /** Wall time of the last completed scan, ms (rounded). */
  totalMs: number | null;
  /** Idempotent while scanning; resolves when done or failed; never throws. */
  scan(): Promise<void>;
}

// In-flight guard — module-level, like every other "called from an effect
// that StrictMode double-invokes" loader in this codebase.
let scanning: Promise<void> | null = null;

export const useToolchainStore = create<ToolchainState>((set) => ({
  phase: "idle",
  tools: [],
  error: null,
  scannedAt: null,
  totalMs: null,

  scan: () => {
    if (scanning !== null) return scanning;
    set({ phase: "scanning", error: null });
    const startedAt = performance.now();
    scanning = detectAiTools().then(
      (tools) => {
        const totalMs = Math.round(performance.now() - startedAt);
        set({ phase: "done", tools, error: null, scannedAt: Date.now(), totalMs });
        useEventsStore
          .getState()
          .pushLocal(toolchainSummary(tools, totalMs), { toolName: "toolchain" });
        scanning = null;
      },
      (e: unknown) => {
        const error = String(e);
        // `tools` is deliberately left as it was: a failed rescan must not
        // blank out the rows a previous successful scan produced.
        set({ phase: "failed", error, totalMs: Math.round(performance.now() - startedAt) });
        useEventsStore
          .getState()
          .pushLocal(`Toolchain scan failed: ${error}`, { toolName: "toolchain" });
        scanning = null;
      },
    );
    return scanning;
  },
}));

/** Is this compile target's tool installed? `null` = not scanned yet (the
 *  chip renders neutral, not "missing" — an unscanned machine has not been
 *  asked, and telling a user their tool is absent before looking is worse
 *  than saying nothing). */
export function isToolFound(tools: readonly AiTool[], id: CompileTarget): boolean | null {
  if (tools.length === 0) return null;
  return tools.find((t) => t.id === id)?.found ?? false;
}

/** The Activity-tab row a completed scan writes (`pushLocal`):
 *  `Toolchain scan: 2 of 5 found in 812 ms (claude ✓ 2.1.37 · codex ✗ · …)`.
 *  Rows are listed in the order Rust returned them (`PROBES` order), by
 *  `cmd` — the string a user would type — with the version when one was
 *  read and a bare ✓ when the tool answered but gave no version. */
export function toolchainSummary(tools: readonly AiTool[], totalMs: number): string {
  const found = tools.filter((t) => t.found).length;
  const detail = tools
    .map((t) => {
      if (!t.found) return `${t.cmd} ✗`;
      return t.version === null ? `${t.cmd} ✓` : `${t.cmd} ✓ ${t.version}`;
    })
    .join(" · ");
  return `Toolchain scan: ${found} of ${tools.length} found in ${Math.round(totalMs)} ms (${detail})`;
}
