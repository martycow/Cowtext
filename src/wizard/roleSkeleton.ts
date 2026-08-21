// Role-skeleton template (WO01 Block D §T5 step 4; re-cut for the v5, 14-role
// taxonomy, WO13_CONTRACT.md §6.1/§14.2) — a plain, deterministic markdown
// scaffold per role, prefilled with the brief. This is NOT the Assemble
// pipeline (no claude -p call): it is what a brand-new node looks like
// before the user optionally hands it to Assemble. Headings echo the voice
// of `ROLE_DESCRIPTIONS`/`nodeTypes.ts` without duplicating it.

import type { NodeRole } from "../store/graph";

interface Section {
  heading: string;
  hint: string;
}

/** `SECTIONS.example`'s two headings ("Good"/"Bad") are the FROZEN
 *  separator the two-field good/bad editor (node spec D3, §14.2) round-trips
 *  through — `buildExampleBody`/`splitExampleBody` below are the two
 *  directions; both must agree with these exact strings or a round trip
 *  drifts. */
export const EXAMPLE_HEADINGS = { good: "Good", bad: "Bad" } as const;

const SECTIONS: Record<NodeRole, Section[]> = {
  agent: [
    { heading: "Role", hint: "Who this agent is and what it owns." },
    { heading: "Duties", hint: "What it does, in the order it matters." },
    { heading: "Boundaries", hint: "What it must never touch or decide." },
  ],
  rule: [{ heading: "Rules", hint: "Hard constraints — one per line, never break these." }],
  invariant: [
    { heading: "Invariant", hint: "The fact that must always hold, stated as one sentence." },
    { heading: "Why it matters", hint: "What breaks if this stops being true." },
  ],
  trap: [
    { heading: "The trap", hint: "What looks right but isn't." },
    { heading: "What to do instead", hint: "The correct approach." },
  ],
  architecture: [
    { heading: "Overview", hint: "How the system fits together, in a paragraph." },
    { heading: "Components", hint: "The modules and their boundaries." },
    { heading: "Data flow", hint: "How state moves between the pieces above." },
  ],
  decision: [
    { heading: "Decision", hint: "The choice, stated as one sentence." },
    { heading: "Why", hint: "The tradeoff that made this the right call." },
  ],
  workflow: [{ heading: "Steps", hint: "The ordered steps for this recurring job." }],
  command: [
    { heading: "Command", hint: "The exact command or invocation to run." },
    { heading: "When to run it", hint: "The situation that calls for this." },
  ],
  skill: [
    { heading: "Skill", hint: "The capability, summarized in one line." },
    { heading: "How to use it", hint: "Steps or technique." },
  ],
  env: [{ heading: "Commands", hint: "The exact commands to build, run and test this project." }],
  tool: [
    { heading: "Tool", hint: "What it does and when to reach for it." },
    { heading: "How to use it", hint: "The exact invocation or interface." },
  ],
  glossary: [{ heading: "Terms", hint: "**Term** — what this project means by it." }],
  example: [
    { heading: EXAMPLE_HEADINGS.good, hint: "What to do — a concrete instance." },
    { heading: EXAMPLE_HEADINGS.bad, hint: "What not to do — a concrete instance." },
  ],
  style: [{ heading: "Style rules", hint: "Formatting and voice conventions — one per line." }],
};

function titleLine(title: string): string {
  return title.trim() === "" ? "Untitled node" : title.trim();
}

function briefLine(brief: string): string {
  return brief.trim() === "" ? "_One-line summary — replace this._" : brief.trim();
}

/** Pure — same inputs always produce the same markdown. Used for both the
 *  step-4 initial preview and the exported node-preset's `content` field. */
export function buildRoleSkeleton(title: string, role: NodeRole, brief: string): string {
  const lines: string[] = [`# ${titleLine(title)}`, "", briefLine(brief)];
  for (const s of SECTIONS[role]) {
    lines.push("", `## ${s.heading}`, "", `_${s.hint}_`);
  }
  lines.push("");
  return lines.join("\n");
}

/** The `example` role's two-field good/bad editor — COMPILE direction
 *  (node spec D3, §14.2): builds one body from separate good/bad fields,
 *  using the exact same `## Good` / `## Bad` H2 headings
 *  `buildRoleSkeleton("example", ...)` would print, so a plain preview and
 *  this editor never disagree about the separator. Pure. */
export function buildExampleBody(title: string, brief: string, good: string, bad: string): string {
  const goodLine = good.trim() === "" ? "_What to do — a concrete instance._" : good.trim();
  const badLine = bad.trim() === "" ? "_What not to do — a concrete instance._" : bad.trim();
  return [
    `# ${titleLine(title)}`,
    "",
    briefLine(brief),
    "",
    `## ${EXAMPLE_HEADINGS.good}`,
    "",
    goodLine,
    "",
    `## ${EXAMPLE_HEADINGS.bad}`,
    "",
    badLine,
    "",
  ].join("\n");
}

/** The REOPEN direction: pure inverse of `buildExampleBody` for any body
 *  that has the two headings — round-trips (split → compile → reopen →
 *  split, no drift) by construction, since both directions key off the same
 *  frozen `EXAMPLE_HEADINGS`. A body missing one or both sections (e.g. a
 *  hand-edited file that never went through the editor) returns `""` for
 *  the missing field rather than throwing. */
export function splitExampleBody(body: string): { good: string; bad: string } {
  const extract = (heading: string): string => {
    const start = new RegExp(`^## ${heading}\\s*$`, "m").exec(body);
    if (start === null) return "";
    const rest = body.slice(start.index + start[0].length);
    const next = /^## /m.exec(rest);
    return (next === null ? rest : rest.slice(0, next.index)).trim();
  };
  return { good: extract(EXAMPLE_HEADINGS.good), bad: extract(EXAMPLE_HEADINGS.bad) };
}
