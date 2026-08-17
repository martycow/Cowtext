// The cow — walk/path logic and the interruptible task queue.
// Rules from plan §8: tile-to-tile movement, every reaction ≤ 1.5 s,
// animations interruptible (events queue, paths recompute — a new task always
// starts from the tile the cow is currently on/stepping into).

import { Container } from "pixi.js";
import {
  depthOf,
  manhattanPath,
  sameTile,
  tileToScreen,
  type Tile,
} from "./iso";
import { makeBubble, makeCow, type CowSprite } from "./props";

export interface CowTask {
  target: Tile;
  /** Bubble shown the moment the task starts ("!", "?"). */
  bubbleOnStart?: string;
  /** Bubble shown on arrival (filename, "✓"). */
  bubbleOnArrive?: string;
  /** Fired on arrival (e.g. layout.flashProp). */
  onArrive?: () => void;
  /** Post-arrival busy loop (typewriter bob) in ms, capped at 1500. */
  busyMs?: number;
}

const STEP_MS_MAX = 150; // per-tile step; whole walk clamped to ≤ 1.5 s
const WALK_TOTAL_MS = 1500;
const BUBBLE_MS = 1400;
const QUEUE_CAP = 3; // old unstarted tasks drop so the cow never lags the log

export class Cow {
  readonly view: Container;
  tile: Tile;

  private readonly sprite: CowSprite;
  private readonly queue: CowTask[] = [];
  private current: CowTask | null = null;
  private path: Tile[] = [];
  private stepFrom: Tile;
  private stepTo: Tile | null = null;
  private stepT = 0;
  private stepDur = STEP_MS_MAX;
  private busyLeft = 0;
  private bubble: Container | null = null;
  private bubbleLeft = 0;
  private walkPhase = 0;

  constructor(start: Tile) {
    this.tile = { ...start };
    this.stepFrom = { ...start };
    this.sprite = makeCow();
    this.view = new Container();
    this.view.addChild(this.sprite.view);
    const p = tileToScreen(start.tx, start.ty);
    this.view.position.set(p.x, p.y);
    this.view.zIndex = depthOf(start, true);
  }

  /** Queue a task; oldest unstarted tasks drop beyond the cap. */
  enqueue(task: CowTask): void {
    this.queue.push(task);
    while (this.queue.length > QUEUE_CAP) this.queue.shift();
  }

  /** Drop everything queued and any in-progress busy loop; the current tile
   *  step finishes (≤150 ms), then `task` starts from wherever the cow is. */
  interrupt(task: CowTask): void {
    this.queue.length = 0;
    this.path = [];
    this.busyLeft = 0;
    this.current = null;
    this.queue.push(task);
  }

  private startTask(task: CowTask): void {
    this.current = task;
    this.path = sameTile(this.tile, task.target)
      ? []
      : manhattanPath(this.tile, task.target);
    this.stepDur = Math.min(STEP_MS_MAX, WALK_TOTAL_MS / Math.max(1, this.path.length));
    if (task.bubbleOnStart !== undefined) this.showBubble(task.bubbleOnStart);
    if (this.path.length === 0) this.arrive();
  }

  private arrive(): void {
    const task = this.current;
    if (task === null) return;
    if (task.bubbleOnArrive !== undefined) this.showBubble(task.bubbleOnArrive);
    task.onArrive?.();
    this.busyLeft = Math.min(task.busyMs ?? 0, WALK_TOTAL_MS);
    if (this.busyLeft <= 0) this.current = null;
  }

  private showBubble(text: string): void {
    if (this.bubble !== null) this.bubble.destroy({ children: true });
    this.bubble = makeBubble(text);
    this.bubble.position.set(0, -34);
    this.view.addChild(this.bubble);
    this.bubbleLeft = BUBBLE_MS;
  }

  update(dtMs: number): void {
    // bubble lifetime
    if (this.bubble !== null) {
      this.bubbleLeft -= dtMs;
      if (this.bubbleLeft <= 0) {
        this.bubble.destroy({ children: true });
        this.bubble = null;
      }
    }
    // busy loop (typewriter at the side desk): 2-frame bob, 180 ms hold
    if (this.current !== null && this.stepTo === null && this.path.length === 0 && this.busyLeft > 0) {
      this.busyLeft -= dtMs;
      this.sprite.setBob(Math.floor(this.busyLeft / 180) % 2);
      if (this.busyLeft <= 0) {
        this.sprite.setBob(0);
        this.current = null;
      }
      return;
    }
    // pick up next task — never mid-step: interrupt() nulls `current` while
    // a tile step is still in flight, and the new path must start from the
    // tile that step lands on, not the one being left (header rule).
    if (this.current === null && this.stepTo === null && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next !== undefined) this.startTask(next);
    }
    // stepping
    if (this.stepTo === null && this.path.length > 0) {
      this.stepFrom = { ...this.tile };
      const next = this.path.shift();
      if (next !== undefined) {
        this.stepTo = next;
        this.stepT = 0;
        const a = tileToScreen(this.stepFrom.tx, this.stepFrom.ty);
        const b = tileToScreen(next.tx, next.ty);
        if (b.x !== a.x) this.sprite.setFacing(b.x > a.x ? 1 : -1);
      }
    }
    if (this.stepTo !== null) {
      this.stepT += dtMs;
      const t = Math.min(1, this.stepT / this.stepDur);
      const a = tileToScreen(this.stepFrom.tx, this.stepFrom.ty);
      const b = tileToScreen(this.stepTo.tx, this.stepTo.ty);
      this.view.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      this.walkPhase += dtMs;
      this.sprite.setBob(Math.floor(this.walkPhase / 90) % 2); // 2-frame trot
      this.view.zIndex = depthOf(this.stepTo, true);
      if (t >= 1) {
        this.tile = { ...this.stepTo };
        this.stepTo = null;
        if (this.path.length === 0) {
          this.sprite.setBob(0);
          this.arrive();
        }
      }
    }
  }
}
