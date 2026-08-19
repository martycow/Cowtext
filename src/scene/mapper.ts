// BarnEvent → animation mapper (plan §8 event table). Takes the layout +
// cow, mutates nothing else; reads the graph/events stores only to resolve
// file paths to node ids (contract §3.2). SOUND: sfx.* calls sit at their
// semantic moments (PHASE56_CONTRACT §1-S10); all gating lives inside sfx.ts,
// so the call sites stay dumb. Lane C must preserve every sfx call in place.
//
// Named Calves (AGENTS_SUITE_CONTRACT §7.5): live hook payloads carry no
// agent name, so live seeds are `${sessionId}#${ordinal}` — a module-level
// per-sessionId counter starting at 1, deterministic given the same
// (sessionId, ordinal) pair but only meaningful within the session that
// produced it (a different real Claude Code session never reproduces the
// same ordinal sequence). Cross-session, restart-stable identity is what
// calfLook() delivers from a seed and what demo mode (demo.ts) demonstrates
// with its two fixed sessionIds. calf_spawn/calf_despawn sound is NOT fired
// from here — see calf.ts's header for why (onSpawn/onDespawn callbacks
// wired by BarnScene.tsx instead, so a cap-dropped spawn stays silent).

import type { BarnEvent } from "./types";
import type { BarnLayout, PropEntry } from "./sceneGraph";
import { DEV_DESK_TILE, SIDE_DESK_TILE } from "./sceneGraph";
import { clampTile, type Tile } from "./iso";
import { truncateLabel, BUBBLE_MAX } from "./props";
import type { Cow } from "./cow";
import type { CalfHerd } from "./calf";
import * as sfx from "./sfx";
import { resolveNodeId } from "../store/events";
import { useGraphStore } from "../store/graph";

/** Per-sessionId subagent_stop counter, module-level so it survives across
 *  events but resets on a fresh module load (app restart). */
const subagentOrdinals = new Map<string, number>();

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

/** T6 — "reading CLAUDE.md" / "editing rules.md": verb derived from the
 *  BarnEvent kind. Fix (Block E defect #1): truncating `${verb} ${filePath}`
 *  as one string let the tail-keep ellipsis eat the verb whenever filePath
 *  was more than one directory deep — both bubbles rendered identical
 *  '…context/architecture.md' text with no verb at all. The verb prefix is
 *  now reserved first; only the remaining budget is spent on a truncated
 *  (tail-keep) filename, so the verb always survives. */
function verbLabel(verb: string, filePath: string): string {
  const path = filePath.replace(/\\/g, "/");
  const prefix = `${verb} `;
  const budget = BUBBLE_MAX - prefix.length;
  if (budget < 1) return truncateLabel(verb); // pathological: verb alone overflows
  return prefix + truncateLabel(path, budget);
}

export interface MapperCtx {
  cow: Cow;
  layout: BarnLayout;
  herd: CalfHerd;
}

/** Drive the scene from one normalized BarnEvent. */
export function handleEvent(e: BarnEvent, ctx: MapperCtx): void {
  const { cow, layout, herd } = ctx;
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
      // Fix (Block E defect #2): bubbleOnStart mirrors bubbleOnArrive so a
      // real read event preempts an active flavor bubble the moment the task
      // is picked up (startTask), not after the ~1.5s walk to the prop. The
      // arrival call re-shows the same text, refreshing its on-screen timer
      // to line up with flashProp/the read cue.
      const label = verbLabel("reading", e.filePath ?? "");
      cow.enqueue({
        target: approachTile(prop.tile),
        bubbleOnStart: label,
        bubbleOnArrive: label,
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
      // Fix (Block E defect #2): same bubbleOnStart/bubbleOnArrive mirroring
      // as the read arm — an edit/write must preempt a flavor bubble the
      // instant the task starts, not after the walk to the side desk.
      const label =
        e.filePath !== undefined
          ? verbLabel(e.kind === "write" ? "writing" : "editing", e.filePath)
          : undefined;
      cow.enqueue({
        target: SIDE_DESK_TILE,
        bubbleOnStart: label,
        bubbleOnArrive: label,
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
    case "subagent_stop": {
      const sid = e.sessionId;
      const ordinal = (subagentOrdinals.get(sid) ?? 0) + 1;
      subagentOrdinals.set(sid, ordinal);
      herd.spawn(`${sid}#${ordinal}`);
      return;
    }
    case "other":
      // Future hook kinds must opt in — this stays a no-op (SOUND_DESIGN).
      return;
  }
}
