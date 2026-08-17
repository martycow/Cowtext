// BarnEvent → animation mapper (plan §8 event table). Takes the layout +
// cow, mutates nothing else; reads the graph/events stores only to resolve
// file paths to node ids (contract §3.2). SOUND: none yet — the cue
// names from docs/design/SOUND_DESIGN.md are noted inline as comments so the
// Phase-5 audio pass can hook in at exactly these points.

import type { BarnEvent } from "./types";
import type { BarnLayout, PropEntry } from "./sceneGraph";
import { DEV_DESK_TILE, SIDE_DESK_TILE } from "./sceneGraph";
import { clampTile, type Tile } from "./iso";
import { truncateLabel } from "./props";
import type { Cow } from "./cow";
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
      // SFX cue: kb_clack. Dev lean-in comes with the sprite pass.
      cow.enqueue({ target: cow.tile, bubbleOnStart: "!" });
      return;
    }
    case "read": {
      const prop = e.filePath !== undefined ? resolveProp(e.filePath, layout.props) : null;
      if (prop === null) return; // unknown path: log-feed only, no walk
      // SFX cue by role: drawer_slide (cabinet) / page_flip (bookshelf) /
      // paper_shuffle (corkboard-crate).
      cow.enqueue({
        target: approachTile(prop.tile),
        bubbleOnArrive: fileLabel(e.filePath ?? ""),
        onArrive: () => layout.flashProp(prop.nodeId),
      });
      return;
    }
    case "edit":
    case "write": {
      // SFX cues: typewriter loop while busy, ding on completion.
      cow.enqueue({
        target: SIDE_DESK_TILE,
        bubbleOnArrive: e.filePath !== undefined ? fileLabel(e.filePath) : undefined,
        busyMs: 900,
      });
      return;
    }
    case "grep":
    case "glob": {
      // SFX cue: sniff (throttled in the sound spec — volleys).
      const entries = [...layout.props.values()];
      if (entries.length === 0) {
        cow.enqueue({ target: cow.tile, bubbleOnStart: "?" });
        return;
      }
      const a = entries[Math.abs(e.ts) % entries.length];
      const b = entries[(Math.abs(e.ts) + 1) % entries.length];
      cow.enqueue({ target: approachTile(a.tile), bubbleOnStart: "?" });
      if (b !== a) cow.enqueue({ target: approachTile(b.tile), bubbleOnStart: "?" });
      return;
    }
    case "stop": {
      // SFX cue: moo_happy (the hero cue). Interrupt: turn is over.
      cow.interrupt({
        target: clampTile({ tx: DEV_DESK_TILE.tx - 1, ty: DEV_DESK_TILE.ty }),
        bubbleOnArrive: "✓",
      });
      return;
    }
    case "subagent_stop":
    case "other":
      // Calf spawn/despawn is a Phase-5 sprite concern; ignored in the prototype.
      return;
  }
}
