// Barn hover bubbles (Task-Board Batch contract §9). Pointer-move hit test
// over interactive scene objects (cow, calves, node props, the dev desk,
// the barn door); after >=150 ms of continuous hover, shows ONE description
// bubble near the object, reusing the established speech-bubble visual style
// (props.ts's makeBubble — paper plate + warm outline + tiny monospace
// text), sized for longer sentences instead of filenames. Purely visual —
// this module never imports sfx.ts and never plays a sound (hover is
// routine UI feedback, not a barn event; SOUND_DESIGN's never-on-routine-UI
// rule).
//
// Hit-testing is cheap AABB-only, done once per ticker frame in WORLD space
// (the same coordinate system as tileToScreen()/view.position) — never per
// raw pointermove DOM event and never per-pixel. BarnScene.tsx feeds the
// current pointer position (already camera-inverse-transformed) via
// setPointer(), and calls sync()+tick() from inside its existing app.ticker
// callback, so pause-when-hidden and the idle FPS throttle apply for free.
//
// Calf labels: CalfHerd (calf.ts) is out of this lane's file zone and does
// not expose per-calf seed/identity to callers (onSpawn/onDespawn fire with
// no arguments). Calves are therefore discovered as the "leftover" children
// of layout.objects — everything that is not the cow, a node prop, or
// static furniture — and labeled by first-seen discovery order, not their
// true spawn seed. Flagged as a known limitation in the dispatch report.

import { Container, Graphics, Text } from "pixi.js";
import { PALETTE } from "./palette";
import type { BarnLayout } from "./sceneGraph";
import { BARN_DOOR_TILE, DEV_DESK_TILE } from "./sceneGraph";
import { tileToScreen } from "./iso";
import type { Cow } from "./cow";
import { reducedMotion } from "./motion";

const OUT = { width: 1, color: PALETTE.outline } as const;

/** Contract §9: bubble appears after >=150 ms of continuous hover. */
const HOVER_DELAY_MS = 150;
/** Hover sentences run longer than the 24-char filename bubble; give them
 *  more room before truncating (keeps the front — title/role — intact,
 *  trims the tail, same idiom as truncateLabel in props.ts). */
const LABEL_MAX = 56;

function truncateHoverLabel(s: string): string {
  return s.length <= LABEL_MAX ? s : `${s.slice(0, LABEL_MAX - 1)}…`;
}

/** Dynamic speech-bubble view: same paper-plate look as props.ts's
 *  makeBubble (roundRect + outline + tail), but text/size update in place
 *  so only one Graphics/Text pair ever exists for the whole scene. */
function makeHoverBubble(): { view: Container; setText: (s: string) => void } {
  const view = new Container();
  const g = new Graphics();
  const label = new Text({
    text: "",
    style: {
      fontFamily: "Silkscreen, monospace",
      fontSize: 8,
      fill: PALETTE.patchDark,
    },
    resolution: 3,
  });
  view.addChild(g, label);
  const setText = (textRaw: string): void => {
    label.text = truncateHoverLabel(textRaw);
    const w = Math.max(14, label.width + 8);
    const h = label.height + 6;
    g.clear();
    g.roundRect(-w / 2, -h, w, h, 3).fill(PALETTE.paper).stroke(OUT);
    g.poly([-3, 0, 3, 0, 0, 4]).fill(PALETTE.paper).stroke(OUT);
    g.rect(-3, -1, 6, 2).fill(PALETTE.paper); // hide tail seam
    label.position.set(-label.width / 2, -h + 3);
  };
  return { view, setText };
}

type HoverKind = "cow" | "calf" | "prop" | "desk" | "door" | "decoTall" | "decoLow";

interface HoverBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Fixed AABBs (world px, relative to the target's anchor point) per kind —
 *  cheap-and-generous, no per-pixel testing (contract §9). */
const BOX: Record<HoverKind, HoverBox> = {
  cow: { left: -14, right: 14, top: -34, bottom: 4 },
  calf: { left: -9, right: 9, top: -22, bottom: 4 },
  prop: { left: -16, right: 16, top: -32, bottom: 4 },
  desk: { left: -18, right: 18, top: -34, bottom: 4 },
  door: { left: -16, right: 16, top: -24, bottom: 8 },
  // R10 static set-dressing — cheap-and-generous, same idiom as the rest.
  decoTall: { left: -14, right: 14, top: -30, bottom: 4 },
  decoLow: { left: -12, right: 12, top: -14, bottom: 4 },
};

interface HoverTarget {
  id: string;
  kind: HoverKind;
  x: number;
  y: number;
  label: string;
}

export interface HoverSyncCtx {
  cow: Cow;
  layout: BarnLayout;
}

const DOOR_LABEL = "Barn door — agents come and go";
const DESK_LABEL = "The developer — that's you";
const COW_LABEL = "The cow — your Claude agent at work";

/** Controls the single hover bubble for the whole scene. Owns no store
 *  reads besides reducedMotion() (same pattern as cow.ts). */
export class HoverController {
  /** Mount this under the camera, added AFTER layout.world, so the bubble
   *  always renders above every ground/prop/particle layer — "depth-sorted
   *  above the object" without needing per-object zIndex coordination. */
  readonly view: Container;

  private readonly bubble = makeHoverBubble();
  private targets: HoverTarget[] = [];
  private pointer: { x: number; y: number } | null = null;
  private hoverId: string | null = null;
  private hoverMs = 0;
  private shownId: string | null = null;
  /** Discovery-order calf ids/labels — see module header. */
  private readonly calfIds = new WeakMap<Container, number>();
  private calfOrdinal = 0;

  constructor() {
    this.view = new Container();
    this.view.addChild(this.bubble.view);
    this.bubble.view.visible = false;
  }

  /** World-space pointer position (already camera-inverse-transformed), or
   *  null on pointer-out / while dragging the camera. */
  setPointer(p: { x: number; y: number } | null): void {
    this.pointer = p;
  }

  /** Rebuild the candidate list from live scene state — cheap (object
   *  counts are small; no allocation beyond one short-lived array). Call
   *  once per ticker frame, before tick(). */
  sync(ctx: HoverSyncCtx): void {
    const { cow, layout } = ctx;
    const targets: HoverTarget[] = [];

    targets.push({
      id: "cow",
      kind: "cow",
      x: cow.view.position.x,
      y: cow.view.position.y,
      label: COW_LABEL,
    });

    const known = new Set<Container>([cow.view, layout.devDeskView, layout.sideDeskView]);
    for (const entry of layout.props.values()) {
      known.add(entry.view);
      targets.push({
        id: `prop:${entry.nodeId}`,
        kind: "prop",
        x: entry.view.position.x,
        y: entry.view.position.y,
        label: `${entry.title} — ${entry.role} node (${entry.filePath})`,
      });
    }

    // R10 static set-dressing — own targets, excluded from the calf scan.
    for (const d of layout.decos) {
      known.add(d.view);
      targets.push({
        id: `deco:${d.id}`,
        kind: d.tall ? "decoTall" : "decoLow",
        x: d.view.position.x,
        y: d.view.position.y,
        label: d.label,
      });
    }

    // Leftover children of the object layer are live calves (see header).
    for (const child of layout.objects.children) {
      if (known.has(child)) continue;
      let n = this.calfIds.get(child);
      if (n === undefined) {
        this.calfOrdinal += 1;
        n = this.calfOrdinal;
        this.calfIds.set(child, n);
      }
      targets.push({
        id: `calf:${n}`,
        kind: "calf",
        x: child.position.x,
        y: child.position.y,
        label: `Calf — subagent #${n}`,
      });
    }

    const deskP = tileToScreen(DEV_DESK_TILE.tx, DEV_DESK_TILE.ty);
    targets.push({ id: "desk", kind: "desk", x: deskP.x, y: deskP.y, label: DESK_LABEL });

    const doorP = tileToScreen(BARN_DOOR_TILE.tx, BARN_DOOR_TILE.ty);
    targets.push({ id: "door", kind: "door", x: doorP.x, y: doorP.y, label: DOOR_LABEL });

    this.targets = targets;
  }

  /** Advance the hover timer and show/hide state. Call once per ticker
   *  frame, after sync(). Hiding on pointer-out or object despawn is
   *  automatic: both simply stop producing a hit on the next frame (a
   *  despawned object is no longer in `targets`). */
  tick(dtMs: number): void {
    const hit = this.hitTest();
    const hitId = hit?.id ?? null;
    if (hitId !== this.hoverId) {
      this.hoverId = hitId;
      this.hoverMs = 0;
    }
    if (hitId !== null) this.hoverMs += dtMs;

    // Calm mode: instant show/hide, no debounce and no fade (contract §9 /
    // motion.ts reducedMotion — mute + reduced motion together).
    const calm = reducedMotion();
    const shouldShow = hit !== null && (calm || this.hoverMs >= HOVER_DELAY_MS);

    if (!shouldShow) {
      if (this.shownId !== null) {
        this.shownId = null;
        this.bubble.view.visible = false;
      }
      return;
    }
    if (hit === null) return; // unreachable (shouldShow implies hit !== null); keeps TS narrow
    if (hit.id !== this.shownId) {
      this.shownId = hit.id;
      this.bubble.setText(hit.label);
      this.bubble.view.visible = true;
    }
    const box = BOX[hit.kind];
    this.bubble.view.position.set(Math.round(hit.x), Math.round(hit.y + box.top - 4));
  }

  private hitTest(): HoverTarget | null {
    const p = this.pointer;
    if (p === null) return null;
    for (const t of this.targets) {
      const box = BOX[t.kind];
      if (p.x >= t.x + box.left && p.x <= t.x + box.right && p.y >= t.y + box.top && p.y <= t.y + box.bottom) {
        return t;
      }
    }
    return null;
  }

  destroy(): void {
    this.bubble.view.destroy({ children: true });
    this.view.destroy({ children: true });
  }
}
