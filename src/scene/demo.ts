// Demo-mode player: replays a scripted BarnEvent sequence on a timer so the
// barn is demonstrable before the hooks server (Phase 4) is live. Feeds the
// exact same push-callback the live event source uses — one entry point.
// When src/store/events.ts lands, its pushEvent/setDemoMode become that
// entry point and this file needs no changes (BarnScene owns the wiring).

import type { MemoryNode } from "../store/graph";
import type { BarnEvent, BarnEventKind } from "./types";

/** Stand-in nodes rendered when the loaded graph has none — the demo must
 *  run without a backend or an open project. */
export const DEMO_NODES: MemoryNode[] = [
  { id: "demo-a", title: "Rules", role: "rules", brief: "", filePath: "context/rules.md", readOrder: 1, pinned: true, position: { x: 0, y: 0 } },
  { id: "demo-b", title: "Persona", role: "persona", brief: "", filePath: "context/persona.md", readOrder: 2, pinned: false, position: { x: 0, y: 0 } },
  { id: "demo-c", title: "Architecture", role: "architecture", brief: "", filePath: "context/architecture.md", readOrder: 3, pinned: false, position: { x: 0, y: 0 } },
  { id: "demo-d", title: "API reference", role: "reference", brief: "", filePath: "context/api-reference.md", readOrder: 4, pinned: false, position: { x: 0, y: 0 } },
  { id: "demo-e", title: "Current task", role: "task", brief: "", filePath: "context/current-task.md", readOrder: 5, pinned: false, position: { x: 0, y: 0 } },
  { id: "demo-f", title: "Release workflow", role: "workflow", brief: "", filePath: "context/release-workflow.md", readOrder: 6, pinned: false, position: { x: 0, y: 0 } },
];

interface DemoStep {
  /** Delay after the previous step, ms. */
  delay: number;
  kind: BarnEventKind;
  /** Index into the available filePath list; undefined = no path. */
  file?: number;
}

// A believable little agent turn: prompt → reads → search → edit → stop.
const SCRIPT: DemoStep[] = [
  { delay: 400, kind: "prompt" },
  { delay: 900, kind: "read", file: 0 },
  { delay: 1800, kind: "read", file: 2 },
  { delay: 1800, kind: "grep" },
  { delay: 1600, kind: "read", file: 3 },
  { delay: 1800, kind: "glob" },
  { delay: 1600, kind: "read", file: 4 },
  { delay: 1800, kind: "edit", file: 4 },
  { delay: 2400, kind: "write", file: 1 },
  { delay: 2400, kind: "read", file: 5 },
  { delay: 1800, kind: "stop" },
  { delay: 2600, kind: "prompt" }, // loop breath, then the next turn begins
];

export class DemoPlayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private index = 0;
  private _running = false;

  constructor(
    private readonly push: (e: BarnEvent) => void,
    private readonly getFilePaths: () => string[],
    private readonly onStateChange?: (running: boolean) => void,
  ) {}

  get running(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.index = 0;
    this.onStateChange?.(true);
    this.scheduleNext();
  }

  stop(): void {
    this._running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.onStateChange?.(false);
  }

  private scheduleNext(): void {
    const step = SCRIPT[this.index % SCRIPT.length];
    this.timer = setTimeout(() => {
      if (!this._running) return;
      const paths = this.getFilePaths();
      const filePath =
        step.file !== undefined && paths.length > 0
          ? paths[step.file % paths.length]
          : undefined;
      this.push({
        kind: step.kind,
        ...(filePath !== undefined ? { filePath } : {}),
        sessionId: "demo",
        ts: Date.now(),
      });
      this.index += 1;
      this.scheduleNext();
    }, step.delay);
  }
}
