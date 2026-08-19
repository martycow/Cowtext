// The cow — walk/path logic and the interruptible task queue.
// Rules from plan §8: tile-to-tile movement, every reaction ≤ 1.5 s,
// animations interruptible (events queue, paths recompute — a new task always
// starts from the tile the cow is currently on/stepping into).
// Phase 5 juice (PHASE56_CONTRACT §7.2/§7.3): anticipation crouch, scarf
// flutter with 1-frame-late settle, eye glance, landing squash, bouncy stop
// trot, waiting choreography. All juice gates on reducedMotion(); functional
// movement (walks, arrivals, busy timing) never does — the mapper stays
// truthful in calm mode. NO sound in this file (sfx fires from task
// callbacks owned by the mapper).

import { Container } from "pixi.js";
import {
  depthOf,
  manhattanPath,
  sameTile,
  tileToScreen,
  type Tile,
} from "./iso";
import { makeBubble, makeCow, type CowPose, type CowSprite } from "./props";
import { reducedMotion } from "./motion";

export interface CowTask {
  /** Walk destination. Omitted = wherever the cow is when the task STARTS —
   *  in-place reactions must not snapshot `cow.tile` at enqueue (it goes
   *  stale if the cow is mid-walk and would walk her back). */
  target?: Tile;
  /** Bubble shown the moment the task starts ("!", "?"). */
  bubbleOnStart?: string;
  /** Bubble shown on arrival (filename, "✓"). */
  bubbleOnArrive?: string;
  /** Fires when the task is picked up (Stage 0). */
  onStart?: () => void;
  /** Fired on arrival (e.g. layout.flashProp). */
  onArrive?: () => void;
  /** Post-arrival busy loop (typewriter bob) in ms, capped at 1500. */
  busyMs?: number;
  /** Busy loop ran to completion (natural end only). */
  onBusyEnd?: () => void;
  /** Busy loop cut short by interrupt(). */
  onBusyCancel?: () => void;
  /** J6 — the stop trot: +1 px hop per stride (set only by the stop arm). */
  bouncy?: boolean;
}

const STEP_MS_MAX = 150; // per-tile step; whole walk clamped to ≤ 1.5 s
const WALK_TOTAL_MS = 1500;
const BUBBLE_MS = 1400;
const QUEUE_CAP = 3; // old unstarted tasks drop so the cow never lags the log

// juice timings — frame holds within the 90–180 ms grammar
const ANTICIPATION_MS = 80; // J2 crouch before the first step
const SQUASH_MS = 90; // J7 landing squash frame
const FLUTTER_SETTLE_MS = 90; // J1 scarf settles one frame late
const WAKE_HOP_MS = 100; // E5 wake: 2 px hop (the one allowed exaggeration)
const CHEW_FRAME_MS = 600; // E5 2-frame chew, 1.2 s period
const MICRO_GAP_MS = 8000; // E5 idle micro-behaviours ≥ 8 s apart
const MICRO_ACT_MS = 150; // blink / weight-shift hold

// T6 flavor bubbles (WO01 Block E): idle > 30 s (idleStage >= 2, the same
// threshold BarnScene uses for the lying pose) pulls a random line from this
// pool. Silent by design — bubbles are on SOUND_DESIGN's deliberately-silent
// list; a real event's showBubble() call always preempts one immediately
// since it overwrites `this.bubble` unconditionally, same as any other task.
const FLAVOR_LINES: readonly string[] = [
  "chewing grass",
  "mooing thoughtfully",
  "swishing tail",
  "watching dust motes",
  "counting hay bales",
  "dreaming of clover",
  "humming a tune",
  "practicing patience",
  "polishing a hoof",
  "waiting for a commit",
];
const FLAVOR_GAP_MS = 8000; // same cadence as the E5 micro-behaviour gap

/** E5 idle escalation stage: 0 active · 1 ≥5 s · 2 ≥30 s · 3 ≥5 min. */
export type IdleStage = 0 | 1 | 2 | 3;

export class Cow {
  readonly view: Container;
  tile: Tile;
  /** J7 — fired once per completed tile step (BarnScene wires dust puffs). */
  onStep?: (tile: Tile) => void;

  private readonly sprite: CowSprite;
  private readonly homeTile: Tile;
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
  // juice state
  private anticipationLeft = 0;
  private squashLeft = 0;
  private flutterSettleLeft = 0;
  private wakeHopLeft = 0;
  // E5 waiting choreography (never enqueues tasks — cannot delay real events)
  private idleStage: IdleStage = 0;
  private pose: CowPose = "stand";
  private chewMs = 0;
  private microWaitMs = MICRO_GAP_MS;
  private microActiveMs = 0;
  private microKind: "blink" | "shift" = "blink";
  // T6 flavor bubble rotation (idle > 30 s)
  private flavorWaitMs = FLAVOR_GAP_MS;
  private lastFlavorIndex = -1; // anti-repeat: never show the same line twice in a row

  constructor(start: Tile) {
    this.tile = { ...start };
    this.stepFrom = { ...start };
    this.homeTile = { ...start };
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
    // J3: eyes toward the newest queued target (in-place tasks: no glance)
    if (task.target !== undefined) this.glanceAt(task.target);
  }

  /** Drop everything queued and any in-progress busy loop; the current tile
   *  step finishes (≤150 ms), then `task` starts from wherever the cow is. */
  interrupt(task: CowTask): void {
    if (this.busyLeft > 0) this.current?.onBusyCancel?.();
    this.queue.length = 0;
    this.path = [];
    this.busyLeft = 0;
    this.current = null;
    this.queue.push(task);
    if (task.target !== undefined) this.glanceAt(task.target);
  }

  /** Demo-stop reset: drop the queue, the current task and any busy loop
   *  WITHOUT starting a new task (unlike interrupt()), so callbacks from
   *  purged demo events can never re-pollute re-derived scene state. */
  cancelAll(): void {
    if (this.busyLeft > 0) this.current?.onBusyCancel?.();
    this.queue.length = 0;
    this.path = [];
    this.busyLeft = 0;
    this.current = null;
    this.sprite.setBob(0);
    this.sprite.setGlance(0);
  }

  /** E5 — BarnScene sets this from the idle clock every ticker frame. */
  setIdleStage(stage: IdleStage): void {
    this.idleStage = stage;
  }

  private glanceAt(target: Tile): void {
    const dx = tileToScreen(target.tx, target.ty).x - this.view.position.x;
    this.sprite.setGlance(dx > 0 ? 1 : dx < 0 ? -1 : 0);
  }

  private startTask(task: CowTask): void {
    this.current = task;
    const target = task.target ?? this.tile; // in-place: resolved at start
    this.path = sameTile(this.tile, target) ? [] : manhattanPath(this.tile, target);
    // J2 anticipation crouch before the FIRST step; its 80 ms counts against
    // the 1.5 s walk clamp. Skipped when waking (the hop covers it) and in
    // reduced motion.
    this.anticipationLeft =
      this.path.length > 0 && this.wakeHopLeft <= 0 && !reducedMotion()
        ? ANTICIPATION_MS
        : 0;
    this.stepDur = Math.min(
      STEP_MS_MAX,
      (WALK_TOTAL_MS - this.anticipationLeft) / Math.max(1, this.path.length),
    );
    if (task.bubbleOnStart !== undefined) this.showBubble(task.bubbleOnStart);
    task.onStart?.();
    if (this.path.length === 0) this.arrive();
  }

  private arrive(): void {
    const task = this.current;
    // Interrupted-step landing (current nulled by interrupt()): keep the
    // glance interrupt() just aimed at the new target — no J3 reset here.
    if (task === null) return;
    this.sprite.setGlance(0); // J3 reset
    if (task.bubbleOnArrive !== undefined) this.showBubble(task.bubbleOnArrive);
    task.onArrive?.();
    this.busyLeft = Math.min(task.busyMs ?? 0, WALK_TOTAL_MS);
    if (this.busyLeft <= 0) this.current = null;
  }

  /** Wake from lying/asleep: head-pop frame + 2 px hop, scarf settles. */
  private wake(): void {
    if (this.pose === "stand") return;
    this.pose = "stand";
    this.sprite.setPose("stand");
    this.sprite.setChew(0);
    this.sprite.setBlink(false);
    this.sprite.setFlutter(0);
    if (!reducedMotion()) this.wakeHopLeft = WAKE_HOP_MS;
  }

  private showBubble(text: string): void {
    if (this.bubble !== null) this.bubble.destroy({ children: true });
    this.bubble = makeBubble(text);
    this.bubble.position.set(0, -34);
    this.view.addChild(this.bubble);
    this.bubbleLeft = BUBBLE_MS;
  }

  update(dtMs: number): void {
    const reduced = reducedMotion();
    // bubble lifetime
    if (this.bubble !== null) {
      this.bubbleLeft -= dtMs;
      if (this.bubbleLeft <= 0) {
        this.bubble.destroy({ children: true });
        this.bubble = null;
      }
    }
    // J7 landing squash — 1 pre-authored frame, never blocks anything
    if (this.squashLeft > 0) {
      this.squashLeft -= dtMs;
      this.sprite.setSquash(this.squashLeft > 0);
    }
    // J1 scarf settles one frame after the walk stops
    if (this.flutterSettleLeft > 0 && this.stepTo === null) {
      this.flutterSettleLeft -= dtMs;
      if (this.flutterSettleLeft <= 0) this.sprite.setFlutter(0);
    }
    // busy loop (typewriter at the side desk): 2-frame bob, 180 ms hold
    if (this.current !== null && this.stepTo === null && this.path.length === 0 && this.busyLeft > 0) {
      this.busyLeft -= dtMs;
      this.sprite.setBob(reduced ? 0 : Math.floor(this.busyLeft / 180) % 2);
      if (this.busyLeft <= 0) {
        this.sprite.setBob(0);
        this.current.onBusyEnd?.();
        this.current = null;
      }
      return;
    }
    // E5 wake hop — brief 2 px pop before the task's own animation
    if (this.wakeHopLeft > 0) {
      this.wakeHopLeft -= dtMs;
      this.sprite.setBob(this.wakeHopLeft > 0 ? 2 : 0);
      if (this.wakeHopLeft > 0) return;
    }
    // pick up next task — never mid-step: interrupt() nulls `current` while
    // a tile step is still in flight, and the new path must start from the
    // tile that step lands on, not the one being left (header rule).
    if (this.current === null && this.stepTo === null && this.queue.length > 0) {
      this.wake();
      this.sprite.setChew(0); // never carry a chew frame into a task
      this.chewMs = 0;
      const next = this.queue.shift();
      if (next !== undefined) this.startTask(next);
      if (this.wakeHopLeft > 0) return; // hop first, walk next frame
    }
    // J2 anticipation crouch — 1 px down for 80 ms before the first step
    if (this.current !== null && this.anticipationLeft > 0) {
      this.anticipationLeft -= dtMs;
      this.sprite.setBob(this.anticipationLeft > 0 ? -1 : 0);
      if (this.anticipationLeft > 0) return;
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
      const raw = Math.min(1, this.stepT / this.stepDur);
      const t = 1 - (1 - raw) * (1 - raw); // positional tweens ease out
      const a = tileToScreen(this.stepFrom.tx, this.stepFrom.ty);
      const b = tileToScreen(this.stepTo.tx, this.stepTo.ty);
      // integer pixel snapping — sub-pixel positions break the 16-bit spell
      this.view.position.set(
        Math.round(a.x + (b.x - a.x) * t),
        Math.round(a.y + (b.y - a.y) * t),
      );
      this.walkPhase += dtMs;
      if (reduced) {
        // calm fade-walk: cow keeps walking (mapper stays truthful), no juice
        this.sprite.setBob(0);
        this.view.alpha = 0.7;
      } else {
        const frame = Math.floor(this.walkPhase / 90) % 2; // 2-frame trot
        // J6: the stop trot is the bounciest — +1 px hop per stride
        this.sprite.setBob(this.current?.bouncy === true ? frame * 2 : frame);
        this.sprite.setFlutter(frame === 1 ? 1 : 0); // J1 flutter with the trot
      }
      this.view.zIndex = depthOf(this.stepTo, true);
      if (raw >= 1) {
        this.tile = { ...this.stepTo };
        this.stepTo = null;
        this.onStep?.(this.tile);
        if (this.path.length === 0) {
          this.sprite.setBob(0);
          this.view.alpha = 1;
          if (!reduced) {
            this.squashLeft = SQUASH_MS; // J7 landing squash frame
            this.flutterSettleLeft = FLUTTER_SETTLE_MS; // J1 late settle
          } else {
            this.sprite.setFlutter(0);
          }
          this.arrive();
        }
      }
      return;
    }
    // ── E5 waiting choreography — pure idle, any task pickup above wins ──
    if (this.current !== null || this.queue.length > 0 || this.busyLeft > 0) return;
    const stage = this.idleStage;
    if (stage >= 1 && !sameTile(this.tile, this.homeTile)) {
      // drift home (bare path, no task — a real event's startTask overrides)
      this.path = manhattanPath(this.tile, this.homeTile);
      this.stepDur = STEP_MS_MAX;
      return;
    }
    // pose escalation: 30 s lie down, 5 min asleep; back to stand quietly
    // when the stage drops without a task (e.g. an unresolved-read event).
    const targetPose: CowPose = stage >= 3 ? "asleep" : stage >= 2 ? "lying" : "stand";
    if (targetPose !== this.pose) {
      this.pose = targetPose;
      this.sprite.setPose(targetPose);
      this.sprite.setChew(0);
      this.sprite.setBlink(false);
      this.sprite.setBob(0);
      this.chewMs = 0;
      this.microWaitMs = MICRO_GAP_MS;
    }
    if (stage === 0 && this.chewMs > 0) {
      // stage dropped without a task (e.g. unresolved read) — close the jaw
      this.sprite.setChew(0);
      this.chewMs = 0;
    }
    // T6 flavor bubbles — idle > 30 s (stage 2 lying / stage 3 asleep both
    // qualify). Runs ahead of the `reduced` gate: calm mode still swaps the
    // text (no animation exists to suppress — showBubble() is a plain swap),
    // matching the "bubbles swap instantly" calm-mode rule. A real event
    // preempts on its own next enqueue()/interrupt() via showBubble().
    if (stage >= 2 && this.bubble === null) {
      this.flavorWaitMs -= dtMs;
      if (this.flavorWaitMs <= 0) {
        this.flavorWaitMs = FLAVOR_GAP_MS + Math.random() * 4000;
        // anti-repeat: re-roll once if the pick matches the previous line
        // (dispatching audit checklist — "flavor never repeats back-to-back")
        let idx = Math.floor(Math.random() * FLAVOR_LINES.length);
        if (FLAVOR_LINES.length > 1 && idx === this.lastFlavorIndex) {
          idx = (idx + 1) % FLAVOR_LINES.length;
        }
        this.lastFlavorIndex = idx;
        this.showBubble(FLAVOR_LINES[idx]);
      }
    } else if (stage < 2) {
      this.flavorWaitMs = FLAVOR_GAP_MS; // fresh countdown next time idle deepens
    }
    if (reduced) return; // static resting pose only — no loops, no fidgets
    if (stage === 1 && this.pose === "stand") {
      // hay chew: 2 frames, 1.2 s period
      this.chewMs += dtMs;
      this.sprite.setChew(Math.floor(this.chewMs / CHEW_FRAME_MS) % 2 === 0 ? 0 : 1);
    } else if (stage === 2) {
      // idle micro-behaviours, ≥ 8 s apart: slow blink / weight shift
      if (this.microActiveMs > 0) {
        this.microActiveMs -= dtMs;
        if (this.microActiveMs <= 0) {
          this.sprite.setBlink(false);
          this.sprite.setBob(0);
        }
      } else {
        this.microWaitMs -= dtMs;
        if (this.microWaitMs <= 0) {
          this.microWaitMs = MICRO_GAP_MS + Math.random() * 4000;
          this.microActiveMs = MICRO_ACT_MS;
          this.microKind = this.microKind === "blink" ? "shift" : "blink";
          if (this.microKind === "blink") this.sprite.setBlink(true);
          else this.sprite.setBob(1);
        }
      }
    }
    // stage 3 (asleep): eyes-closed frame is the pose; Z-motes spawn from
    // BarnScene via the particle pool.
  }
}
