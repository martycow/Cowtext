// Built-in skills — the three-state model (WO15 Block 4, D-5) and its React
// hook. This file, not `store/agents.ts`, is where the hook lives: store
// files carry no React imports (see the header of `store/events.ts`), and
// the pure function below is what the Compile modal, the Skills rail and
// the agent wizard all actually reason about.
//
//   virtual      — bundled, nothing on disk. Costs the project nothing.
//   materialized — on disk and byte-equal (modulo CRLF/trailing space) to
//                  the bundled text. Stays in the Built-in group.
//   modified     — on disk and different. Moves to the Project group with a
//                  "modified from built-in" badge; Compile NEVER writes it
//                  (A-14), because that would silently clobber a user edit.

import { useMemo } from "react";
import { BUILTIN_SKILLS } from "../resources";
import { normalizeSkillContent, useAgentsStore } from "../store/agents";
import type { SkillDoc } from "./types";

export interface BuiltinSkillState {
  id: string;
  name: string;
  description: string;
  /** The BUNDLED text — always, even for `modified`. What
   *  `skills_materialize` would write, i.e. what "Reset to built-in" means. */
  content: string;
  state: "virtual" | "materialized" | "modified";
  /** From the sidecar's `builtinSkills` map; absent id = false. */
  include: boolean;
  /** The on-disk document, when there is one. `null` ⇔ `virtual`. */
  onDisk: SkillDoc | null;
}

/** Pure. Walks `BUILTIN_SKILLS` order (not the on-disk order) so the rail's
 *  Built-in group is stable regardless of what the project happens to have
 *  materialized. */
export function builtinSkillStates(
  skills: readonly SkillDoc[],
  builtinInclude: Record<string, boolean>,
): BuiltinSkillState[] {
  return BUILTIN_SKILLS.map((builtin) => {
    const onDisk = skills.find((s) => s.dirName === builtin.id) ?? null;
    const state: BuiltinSkillState["state"] =
      onDisk === null
        ? "virtual"
        : normalizeSkillContent(onDisk.content) === normalizeSkillContent(builtin.content)
          ? "materialized"
          : "modified";
    return {
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      content: builtin.content,
      state,
      include: builtinInclude[builtin.id] === true,
      onDisk,
    };
  });
}

export function useBuiltinSkillStates(): BuiltinSkillState[] {
  const skills = useAgentsStore((s) => s.skills);
  const builtinInclude = useAgentsStore((s) => s.builtinInclude);
  return useMemo(() => builtinSkillStates(skills, builtinInclude), [skills, builtinInclude]);
}

/** The Project group: every on-disk skill that is not a built-in sitting in
 *  its `materialized` state. A `modified` built-in IS a project skill — the
 *  user's edit is what makes it theirs — and shows up here with its own
 *  badge; only the untouched copy is filtered out, because it is already
 *  listed (once) under Built-in. */
export function projectSkills(skills: readonly SkillDoc[]): SkillDoc[] {
  return skills.filter((doc) => {
    const builtin = BUILTIN_SKILLS.find((b) => b.id === doc.dirName);
    if (builtin === undefined) return true;
    return normalizeSkillContent(doc.content) !== normalizeSkillContent(builtin.content);
  });
}
