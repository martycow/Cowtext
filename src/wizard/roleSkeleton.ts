// Role-skeleton template (WO01 Block D §T5 step 4) — a plain, deterministic
// markdown scaffold per role, prefilled with the brief. This is NOT the
// Assemble pipeline (no claude -p call): it is what a brand-new node looks
// like before the user optionally hands it to Assemble. Headings echo the
// voice of ROLE_DESCRIPTIONS (canvas/roleMeta.ts) without duplicating it.

import type { NodeRole } from "../store/graph";

interface Section {
  heading: string;
  hint: string;
}

const SECTIONS: Record<NodeRole, Section[]> = {
  agent: [
    { heading: "Role", hint: "Who this agent is and what it owns." },
    { heading: "Duties", hint: "What it does, in the order it matters." },
    { heading: "Boundaries", hint: "What it must never touch or decide." },
  ],
  rules: [{ heading: "Rules", hint: "Hard constraints — one per line, never break these." }],
  architecture: [
    { heading: "Overview", hint: "How the system fits together, in a paragraph." },
    { heading: "Components", hint: "The modules and their boundaries." },
    { heading: "Data flow", hint: "How state moves between the pieces above." },
  ],
  workflow: [{ heading: "Steps", hint: "The ordered steps for this recurring job." }],
  task: [
    { heading: "Goal", hint: "The finish line — what \"done\" looks like." },
    { heading: "Acceptance", hint: "How to check it's actually done." },
  ],
  reference: [
    { heading: "Summary", hint: "The one thing to remember if nothing else." },
    { heading: "Details", hint: "The lookup material itself." },
  ],
  glossary: [{ heading: "Terms", hint: "**Term** — what this project means by it." }],
  // v3 (WO03) — six more roles, same terse skeleton style.
  command: [
    { heading: "Command", hint: "The exact command or invocation to run." },
    { heading: "When to run it", hint: "The situation that calls for this." },
  ],
  invariant: [
    { heading: "Invariant", hint: "The fact that must always hold, stated as one sentence." },
    { heading: "Why it matters", hint: "What breaks if this stops being true." },
  ],
  trap: [
    { heading: "The trap", hint: "What looks right but isn't." },
    { heading: "What to do instead", hint: "The correct approach." },
  ],
  skill: [
    { heading: "Skill", hint: "The capability, summarized in one line." },
    { heading: "How to use it", hint: "Steps or technique." },
  ],
  snippet: [{ heading: "Snippet", hint: "The reusable fragment itself." }],
  style: [{ heading: "Style rules", hint: "Formatting and voice conventions — one per line." }],
};

/** Pure — same inputs always produce the same markdown. Used for both the
 *  step-4 initial preview and the exported node-preset's `content` field. */
export function buildRoleSkeleton(title: string, role: NodeRole, brief: string): string {
  const heading = title.trim() === "" ? "Untitled node" : title.trim();
  const lines: string[] = [`# ${heading}`, ""];
  lines.push(brief.trim() === "" ? "_One-line summary — replace this._" : brief.trim());
  for (const s of SECTIONS[role]) {
    lines.push("", `## ${s.heading}`, "", `_${s.hint}_`);
  }
  lines.push("");
  return lines.join("\n");
}
