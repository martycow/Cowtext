// Live agent sessions in the barn — WO01 Block F §9.1 (docs/design/
// WO01_BLOCK_F_CONTRACT.md). One existing calf sprite per live agent
// session, placed/despawned with the session; no new animation, no new
// sprite work, no new asset. Reuses makeCalf(calfLook(session.name)) from
// calf.ts/identity.ts verbatim — same seed as the roster's AgentAvatar (both
// seed on session.name), so an animal's look always matches its card.
//
// Pure Pixi + calf.ts/identity.ts/iso.ts/props.ts primitives only. No React,
// no howler, no React Flow, no src/canvas/, no src/inspector/. `sync()`
// takes a plain AgentSpriteInput[] (this module's own shape, not the store's
// Session type) so agentHerd.ts stays independently compilable regardless
// of when the sessions store lands; BarnScene.tsx (which does read
// useSessionsStore) is the one place that maps Session -> AgentSpriteInput.
// AgentStatus below is structurally identical to the store's SessionStatus
// ("idle" | "working" | "waiting"), so a real Session slots in with no cast.
//
// No sfx call anywhere in this module (contract §9.1): agent-session
// lifecycle is not yet in SOUND_DESIGN's cue table, and inventing a cue here
// would break "all gating lives inside sfx.ts". Status visuals are bubble-
// only (props.ts's makeBubble, same paper-plate look as calves/hover) with
// no new tweens, so reducedMotion() needs no call here — there is nothing to
// gate; bubbles simply appear/disappear/re-text on the next sync(), the same
// frame regardless of motion setting.
//
// Tiles: four fixed spots, arranged in a ring around DEV_DESK_TILE (9,9) —
// agent sessions are coding companions working alongside the developer, the
// same way CALF_SPOTS reads as "where visitors wait". Chosen provably
// disjoint from every reserved tile in scene/sceneGraph.ts and scene/calf.ts:
//   CALF_SPOTS   (2,2) (9,3) (3,9) (10,8) (5,10) (8,10)
//   COW_HOME_TILE (8,8)   DEV_DESK_TILE (9,9)   SIDE_DESK_TILE (6,9)
//   BARN_DOOR_TILE (0,10)
//   AUTO_SLOTS   (1,1) (3,1) (5,1) (7,1) (9,1) (1,3) (1,5) (1,7) (1,9) (4,4)
//                (6,3) (3,6) (8,4) (5,6) (10,3) (10,6)
//   DECOR_ITEMS  (11,1) (11,4) (2,11) (0,4) (3,10) (0,9) (0,11) (11,11) (0,0)
// AGENT_SPOTS (8,9) (10,9) (9,10) (10,10) appears in none of the lists above.
// Same "fixed list, not a live free-tile query" reasoning as calf.ts's
// header; "not another agent's tile" is checked live against the herd's own
// entries, mirroring CalfHerd.spawn's taken-set logic.

import { Container } from "pixi.js";
import { makeCalf, type CalfSprite } from "./calf";
import { calfLook, fnv1a32 } from "../identity/identity";
import { depthOf, tileToScreen, type Tile } from "./iso";
import { makeBubble } from "./props";

/** Structurally identical to the sessions store's SessionStatus. Declared
 *  locally so this module has zero import-time dependency on src/store/
 *  sessions.ts (see header). */
export type AgentStatus = "idle" | "working" | "waiting";

export interface AgentSpriteInput {
  id: string;
  name: string;
  status: AgentStatus;
  currentTool: string | null;
}

/** Cap = MAX_SESSIONS (WO01 Block F §3) = CalfHerd.CAP, so the barn can
 *  always show every live session. Over-cap sessions are simply not drawn —
 *  never evict (eviction flickers, same call as calf.ts). */
const CAP = 4;

/** Reserved agent-visit tiles — see the module header for the disjointness
 *  proof. */
const AGENT_SPOTS: Tile[] = [
  { tx: 8, ty: 9 },
  { tx: 10, ty: 9 },
  { tx: 9, ty: 10 },
  { tx: 10, ty: 10 },
];

interface AgentEntry {
  sprite: CalfSprite;
  tile: Tile;
  name: string;
  status: AgentStatus;
  tool: string | null;
  bubble: Container | null;
  /** Text currently shown in `bubble` (or null = no bubble); avoids
   *  rebuilding the bubble Container on a sync() that doesn't change it. */
  bubbleText: string | null;
}

function labelFor(entry: AgentEntry): string {
  if (entry.status === "working") return `${entry.name} — working: ${entry.tool ?? "…"}`;
  if (entry.status === "waiting") return `${entry.name} — waiting`;
  return `${entry.name} — idle`;
}

function bubbleTextFor(input: AgentSpriteInput): string | null {
  if (input.status === "working") return input.currentTool ?? "…";
  if (input.status === "waiting") return "?";
  return null;
}

export class AgentHerd {
  private readonly layer: Container;
  private readonly entries = new Map<string, AgentEntry>();

  constructor(layer: Container) {
    this.layer = layer;
  }

  /** Diff against the live set: add sprites for new ids, remove for gone
   *  ids, update status/tool for the rest. Idempotent; safe to call every
   *  time the sessions list identity changes. */
  sync(list: AgentSpriteInput[]): void {
    const seen = new Set<string>();
    for (const input of list) {
      let entry = this.entries.get(input.id);
      if (entry === undefined) {
        if (this.entries.size >= CAP) continue; // over-cap: drop silently, never evict
        entry = this.spawn(input);
        this.entries.set(input.id, entry);
      }
      seen.add(input.id);
      this.applyStatus(entry, input);
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      entry.sprite.view.destroy({ children: true });
      this.entries.delete(id);
    }
  }

  tick(dtMs: number, reduced: boolean): void {
    // No per-frame animation in Block F — status/tool changes redraw the
    // bubble immediately in sync(), so there is nothing to advance here.
    // Kept for parity with CalfHerd's tick shape and future juice.
    void dtMs;
    void reduced;
  }

  /** Hover label for one of this herd's containers, or null if not ours. */
  labelFor(view: Container): string | null {
    for (const entry of this.entries.values()) {
      if (entry.sprite.view === view) return labelFor(entry);
    }
    return null;
  }

  destroy(): void {
    for (const entry of this.entries.values()) entry.sprite.view.destroy({ children: true });
    this.entries.clear();
  }

  private spawn(input: AgentSpriteInput): AgentEntry {
    const look = calfLook(input.name);
    const sprite = makeCalf(look);

    const taken = new Set(
      Array.from(this.entries.values(), (e) => `${e.tile.tx},${e.tile.ty}`),
    );
    const free = AGENT_SPOTS.filter((t) => !taken.has(`${t.tx},${t.ty}`));
    const pool = free.length > 0 ? free : AGENT_SPOTS;
    const tile = pool[fnv1a32(input.id) % pool.length];

    const p = tileToScreen(tile.tx, tile.ty);
    sprite.view.position.set(Math.round(p.x), Math.round(p.y));
    sprite.view.zIndex = depthOf(tile, true);
    this.layer.addChild(sprite.view);

    return {
      sprite,
      tile,
      name: input.name,
      status: input.status,
      tool: input.currentTool,
      bubble: null,
      bubbleText: null,
    };
  }

  private applyStatus(entry: AgentEntry, input: AgentSpriteInput): void {
    entry.name = input.name;
    entry.status = input.status;
    entry.tool = input.currentTool;

    const text = bubbleTextFor(input);
    if (text === entry.bubbleText) return;
    entry.bubbleText = text;
    if (entry.bubble !== null) {
      entry.bubble.destroy({ children: true });
      entry.bubble = null;
    }
    if (text === null) return;
    const bubble = makeBubble(text);
    bubble.position.set(0, -20);
    entry.sprite.view.addChild(bubble);
    entry.bubble = bubble;
  }
}
