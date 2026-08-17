// BarnEvent → animation mapper (plan §8 event table). Takes the layout +
// cow, mutates nothing else; reads the graph/events stores only to resolve
// file paths to node ids (contract §3.2). SOUND: sfx.* calls sit at their
// semantic moments (PHASE56_CONTRACT §1-S10); all gating lives inside sfx.ts,
// so the call sites stay dumb. Lane C must preserve every sfx call in place.

import type { BarnEvent } from "./types";
import type { BarnLayout, PropEntry } from "./sceneGraph";
import { DEV_DESK_TILE, SIDE_DESK_TILE } from "./sceneGraph";
import { clampTile, type Tile } from "./iso";
import { truncateLabel } from "./props";
import type { Cow } from "./cow";
import * as sfx from "./sfx";
import { resolveNodeId } from "../store/events";
import { useGraphStore } from "../store/graph";

/** Normalize a hook path: backslashes → slashes, lowercase for comparison. */
function norm(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * filePath → node prop. Delegates to the store's resolveNodeId (root-prefix
 * strip + exact relative match, contract §3.2) so the scene and the EventLog
 * always agree about which node an event belongs to. Suffix matching survives
 * only as the DEMO_NODES fallback (empty graph — those props are not in the
 * store). null = unknown (event still logged elsewhere; no walk).
 */
export function resolveProp(
  filePath: string,
  props: ReadonlyMap<string, PropEntry>,
): PropEntry | null {
  const nodeId = resolveNodeId(filePath);
  if (nodeId !== null) return props.get(nodeId) ?? null;
  if (useGraphStore.getState().nodes.length > 0) return null; // store is authoritative
  const p = norm(filePath);
  for (const entry of props.values()) {
    const fp = norm(entry.filePath);
    if (p === fp || p.endsWith(`/${fp}`)) return entry;
  }
  return null;
}

/** Tile the cow stands on when visiting a prop: diagonally in front. */
function approachTile(t: Tile): Tile {
  return clampTile({ tx: t.tx + 1, ty: t.ty + 1 });
}

function fileLabel(filePath: string): string {
  return truncateLabel(filePath.replace(/\\/g, "/"));
}

export interface MapperCtx {
  cow: Cow;
  layout: BarnLayout;
}

/** Drive the scene from one normalized BarnEvent. */
export function handleEvent(e: BarnEvent, ctx: MapperCtx): void {
  const { cow, layout } = ctx;
  switch (e.kind) {
    case "prompt": {
      sfx.play("kb_clack");
      // Dev lean-in comes with the sprite pass. In-place task: target omitted
      // so it resolves where the cow IS at start, not a stale enqueue tile.
      cow.enqueue({ bubbleOnStart: "!" });
      return;
    }
    case "read": {
      const prop = e.filePath !== undefined ? resolveProp(e.filePath, layout.props) : null;
      if (prop === null) return; // unknown path: log-feed only, no walk
      // Read cue claimed at event receipt (burst throttle); by role on arrival:
      // drawer_slide (cabinet) / page_flip (bookshelf) / paper_shuffle (crate).
      const sound = sfx.claimReadCue();
      // J5: ajar at EVENT RECEIPT (drawer stays ajar all session) — the mount
      // replay derives from the ring, which has no completion data, so the
      // live path must accumulate at receipt too or remounts change the scene.
      layout.setPropOpened(prop.nodeId);
      cow.enqueue({
        target: approachTile(prop.tile),
        bubbleOnArrive: fileLabel(e.filePath ?? ""),
        onArrive: () => {
          layout.flashProp(prop.nodeId);
          if (sound) sfx.play(sfx.readCueForRole(prop.role));
        },
      });
      return;
    }
    case "edit":
    case "write": {
      // Typewriter loop while busy, ding on natural completion only.
      // J5: stack grows at EVENT RECEIPT so it always matches the ring-derived
      // remount replay (an interrupted/queue-dropped task must not under-count).
      layout.addPaper();
      cow.enqueue({
        target: SIDE_DESK_TILE,
        bubbleOnArrive: e.filePath !== undefined ? fileLabel(e.filePath) : undefined,
        busyMs: 900,
        onArrive: () => {
          sfx.startTypewriter();
        },
        onBusyEnd: () => {
          sfx.stopTypewriter();
          sfx.play("ding");
        },
        onBusyCancel: () => {
          sfx.stopTypewriter();
        },
      });
      return;
    }
    case "grep":
    case "glob": {
      // Sniff once per volley (cooldown lives inside sfx.play).
      const entries = [...layout.props.values()];
      if (entries.length === 0) {
        sfx.play("sniff");
        cow.enqueue({ bubbleOnStart: "?" }); // in-place: target resolved at start
        return;
      }
      const a = entries[Math.abs(e.ts) % entries.length];
      const b = entries[(Math.abs(e.ts) + 1) % entries.length];
      cow.enqueue({
        target: approachTile(a.tile),
        bubbleOnStart: "?",
        onStart: () => sfx.play("sniff"),
      });
      if (b !== a) cow.enqueue({ target: approachTile(b.tile), bubbleOnStart: "?" });
      return;
    }
    case "stop": {
      // moo_happy (the hero cue) fires with the "✓" bubble; it never fires
      // if a later event discards the task — exactly the spec's drop rule.
      cow.interrupt({
        target: clampTile({ tx: DEV_DESK_TILE.tx - 1, ty: DEV_DESK_TILE.ty }),
        bubbleOnArrive: "✓",
        bouncy: true, // J6/E6: the payoff trot is the bounciest in the set
        onArrive: () => sfx.play("moo_happy"),
      });
      return;
    }
    case "subagent_stop":
    case "other":
      // Calf spawn/despawn is a Phase-5 sprite concern; ignored in the prototype.
      return;
  }
}
