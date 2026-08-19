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
// ── WO06 B1 — mission control (docs/design/WO06_CONTRACT.md §10 lane B1) ──
// "Give each concurrent agent session its own presence in the barn" — up to
// MAX_SESSIONS=4 sessions already got a stable seed-derived calf look and a
// fixed tile; what was missing at that scale was READABILITY: a "this tile
// is a live session's own space" cue that doesn't depend on hovering, plus
// an ambient read-out of §5's token ceilings. Added, both as CHILDREN of the
// existing per-entry sprite.view (props.ts's makeStallMarker/makeStallPlacard)
// so no new top-level container or zIndex bookkeeping is needed:
//   - a floor "stall" marker (dashed diamond + corner posts) behind the calf
//   - an always-visible nameplate below the sprite's feet (distinct from the
//     tool/status bubble above its head, which still only shows on demand)
//   - a budget strip on the nameplate's bottom edge: hidden when the
//     effective ceiling is 0/absent (§5.5.1), draining amber as spend
//     approaches the ceiling, red at ≥90%, and rendering hollow/dark the
//     instant spent >= ceiling — the same threshold `RegistryCore::charge`
//     uses to fire `Stop` (§5.3), so "dark" needs no separate stopped flag.
//
// Forward-compat seam, not a stub: WO06 lane B1 was dispatched before lane
// U3 (which owns src/store/sessions.ts) landed the `tokensUsed`/
// `tokenCeiling` fields §8 puts on `Session`. AgentSpriteInput below declares
// them OPTIONAL rather than inventing a duplicate store type (the anti-
// pattern flagged in tech-barn agent-memory `wo01-block-f-sequencing`) — see
// BarnScene.tsx's `SessionWithBudget` adapter for how real values will start
// flowing the moment those fields land, with zero further edits to this
// file. Until then both are `undefined` on every input, `budgetStateFor`
// returns `null`, and the strip stays hidden — which is also the
// contractually-correct default (§1.14 "budget off ⇒ byte-identical
// behaviour"). No blocked-task visual was added: tasks are markdown-only
// (never a MemoryNode/prop in this frozen-v3 graph), so there is no existing
// barn object to darken for "blocked" — flagged in the dispatch report
// rather than invented here.
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
import {
  makeBubble,
  makeStallMarker,
  makeStallPlacard,
  type BudgetStripState,
  type StallPlacard,
} from "./props";

/** Structurally identical to the sessions store's SessionStatus. Declared
 *  locally so this module has zero import-time dependency on src/store/
 *  sessions.ts (see header). */
export type AgentStatus = "idle" | "working" | "waiting";

export interface AgentSpriteInput {
  id: string;
  name: string;
  status: AgentStatus;
  currentTool: string | null;
  /** Cumulative tokens spent this session (WO06_CONTRACT §5.2/§8: `Session`
   *  gains `tokensUsed: number`). Optional — see the module header's
   *  forward-compat note; `undefined` renders identically to `0`. */
  tokensUsed?: number;
  /** Effective ceiling for this session — per-task if set, else the global
   *  default, else `null`/absent = unlimited (§5.1/§8: `Session` gains
   *  `tokenCeiling: number | null`). `null`/absent/`<= 0` hides the budget
   *  strip entirely (§5.5.1). */
  tokenCeiling?: number | null;
}

/** WO06 §5.3: `RegistryCore::charge` fires `Stop` exactly when
 *  `spent >= ceiling`. Mirroring that threshold here means the barn's
 *  "dark" state needs no separate stopped flag — see the module header. */
function budgetStateFor(input: AgentSpriteInput): BudgetStripState | null {
  const ceiling = input.tokenCeiling ?? null;
  if (ceiling === null || ceiling <= 0) return null; // §5.5.1 — hidden when off
  const spent = input.tokensUsed ?? 0;
  return {
    fraction: Math.max(0, Math.min(1, 1 - spent / ceiling)), // remaining budget, empties toward 0
    danger: spent / ceiling >= 0.9, // §5.5.1 "turning danger at ≥ 90%"
    dark: spent >= ceiling, // the exact Stop instant (§5.3)
  };
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
  placard: StallPlacard;
  tile: Tile;
  name: string;
  status: AgentStatus;
  tool: string | null;
  bubble: Container | null;
  /** Text currently shown in `bubble` (or null = no bubble); avoids
   *  rebuilding the bubble Container on a sync() that doesn't change it. */
  bubbleText: string | null;
  /** Cached for labelFor()'s hover-bubble budget suffix — see applyStatus. */
  tokensUsed: number;
  tokenCeiling: number | null;
}

function labelFor(entry: AgentEntry): string {
  const base =
    entry.status === "working"
      ? `${entry.name} — working: ${entry.tool ?? "…"}`
      : entry.status === "waiting"
        ? `${entry.name} — waiting`
        : `${entry.name} — idle`;
  if (entry.tokenCeiling === null || entry.tokenCeiling <= 0) return base;
  return `${base} · ${entry.tokensUsed.toLocaleString()}/${entry.tokenCeiling.toLocaleString()} tok`;
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
    // Floor marker behind everything (index 0, ahead of makeCalf's own
    // shadow+body children) — "this tile is a live session's own space".
    sprite.view.addChildAt(makeStallMarker(), 0);
    this.layer.addChild(sprite.view);

    // Always-visible nameplate below the feet — distinct from the tool/
    // status bubble above the head, which stays on-demand only.
    const placard = makeStallPlacard(input.name);
    placard.view.position.set(0, 5);
    sprite.view.addChild(placard.view);

    return {
      sprite,
      placard,
      tile,
      name: input.name,
      status: input.status,
      tool: input.currentTool,
      bubble: null,
      bubbleText: null,
      tokensUsed: 0,
      tokenCeiling: null,
    };
  }

  private applyStatus(entry: AgentEntry, input: AgentSpriteInput): void {
    entry.name = input.name;
    entry.status = input.status;
    entry.tool = input.currentTool;
    entry.tokensUsed = input.tokensUsed ?? 0;
    entry.tokenCeiling = input.tokenCeiling ?? null;

    const text = bubbleTextFor(input);
    if (text !== entry.bubbleText) {
      entry.bubbleText = text;
      if (entry.bubble !== null) {
        entry.bubble.destroy({ children: true });
        entry.bubble = null;
      }
      if (text !== null) {
        const bubble = makeBubble(text);
        bubble.position.set(0, -20);
        entry.sprite.view.addChild(bubble);
        entry.bubble = bubble;
      }
    }

    // Both no-op internally when unchanged (props.ts's makeStallPlacard) —
    // safe to call on every sync(), never a per-frame call (gate 17).
    entry.placard.setName(input.name);
    entry.placard.setBudget(budgetStateFor(input));
  }
}
