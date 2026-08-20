// One verb per wire (WO10 item 5).
//
// Before this, an edge could paint up to three chips at once — a condition
// chip, a numbered step square and a note chip — all anchored at the same
// point, and nothing stopped two edges' chips from landing on top of each
// other. The rule now is one chip, always: an icon plus a single short word
// saying what the edge DOES, so the canvas reads as a sentence
// ("rules → Reads → agent") instead of a pile of metadata.
//
// The verbs are operations, not type names. `kind` is still readable from
// the line style and marker (DESIGN_SPEC.md: solid = structural, dashed =
// advisory) — the label is there to say the thing out loud, and a label that
// just repeated the kind slug would earn none of the space it costs.

import {
  BookOpen,
  ChevronsRight,
  GitBranch,
  Layers,
  Link2,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { EdgeKind } from "../store/graph";

/** Longest label we will paint. Past this the text is clipped with an
 *  ellipsis and the full string moves to the `title` — a chip wide enough to
 *  hold a natural-language condition would cover the node it points at. */
export const LABEL_MAX = 18;

interface VerbSpec {
  verb: string;
  icon: LucideIcon;
}

const VERBS: Record<EdgeKind, VerbSpec> = {
  imports: { verb: "Reads", icon: BookOpen },
  references: { verb: "Refers", icon: Link2 },
  sequence: { verb: "Then", icon: ChevronsRight },
  overrides: { verb: "Controls", icon: ShieldCheck },
  supersedes: { verb: "Replaces", icon: Layers },
  "conflicts-with": { verb: "Conflicts", icon: Zap },
  // Placeholder only — a conditional edge labels itself with its condition
  // (see `edgeLabel`), and falls back to this bare word when it has none.
  conditional: { verb: "If", icon: GitBranch },
};

export function verbIcon(kind: EdgeKind): LucideIcon {
  return VERBS[kind].icon;
}

/** Collapse a condition to something that fits on a wire. Globs keep their
 *  shape (`src/net/**` is already compact and is the common case); prose is
 *  squeezed to one line and clipped. The `if` reads as part of the sentence,
 *  so it is never repeated inside the text. */
function compactCondition(condition: string): string {
  const one = condition.trim().replace(/\s+/g, " ");
  if (one === "") return VERBS.conditional.verb;
  const body = one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
  return `if ${body}`;
}

export interface EdgeLabel {
  /** What the chip paints. Never empty. */
  text: string;
  /** Full, uncut text for the `title` — differs from `text` only when the
   *  label had to be clipped. */
  title: string;
  icon: LucideIcon;
  /** Sequence edges only: the step number, painted as a superscript inside
   *  the same chip rather than as a second chip. */
  step?: number;
}

/**
 * The one label an edge paints, in priority order:
 *   1. an author's `note` — they wrote it, it wins;
 *   2. a `conditional` edge's condition, compacted;
 *   3. the kind's verb.
 * Never returns null: every wire says what it does. A canvas where only
 * *some* edges are labelled reads as broken, not as decluttered.
 */
export function edgeLabel(
  kind: EdgeKind,
  opts: { condition?: string; note?: string; step?: number } = {},
): EdgeLabel {
  const spec = VERBS[kind];
  const step = kind === "sequence" ? opts.step : undefined;

  const note = opts.note?.trim() ?? "";
  if (note !== "") {
    return {
      text: note.length > LABEL_MAX ? `${note.slice(0, LABEL_MAX - 1)}…` : note,
      title: note,
      icon: spec.icon,
      step,
    };
  }

  if (kind === "conditional") {
    const raw = opts.condition?.trim() ?? "";
    const text = compactCondition(raw);
    return { text, title: raw === "" ? spec.verb : `if ${raw}`, icon: spec.icon, step };
  }

  return { text: spec.verb, title: spec.verb, icon: spec.icon, step };
}
