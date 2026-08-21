// WO13_CONTRACT.md §18.5 (owner: T1).

import { describe, expect, it } from "vitest";
import { NODE_ROLES } from "../store/graph";
import { NODE_TYPES, NODE_TYPE_BY_ROLE, LOAD_LOCKED_ROLES, type NodeGroup } from "./nodeTypes";

describe("NODE_TYPES (§18.5, §6.1, §6.3)", () => {
  it("has exactly 14 entries, one per NodeRole", () => {
    expect(NODE_TYPES.length).toBe(14);
    expect(NODE_TYPES.length).toBe(NODE_ROLES.length);
    expect(new Set(NODE_TYPES.map((t) => t.role)).size).toBe(14);
    for (const role of NODE_ROLES) {
      expect(NODE_TYPES.some((t) => t.role === role)).toBe(true);
    }
  });

  it("group counts are 1 identity + 3 constraints + 2 structure + 5 process + 3 knowledge", () => {
    const counts: Record<NodeGroup, number> = {
      identity: 0,
      constraints: 0,
      structure: 0,
      process: 0,
      knowledge: 0,
    };
    for (const t of NODE_TYPES) counts[t.group] += 1;
    expect(counts).toEqual({ identity: 1, constraints: 3, structure: 2, process: 5, knowledge: 3 });
  });

  it("every microExample is non-empty", () => {
    for (const t of NODE_TYPES) {
      expect(t.microExample.trim().length, `${t.role}'s microExample`).toBeGreaterThan(0);
    }
  });

  it("every hint is <= 60 chars", () => {
    for (const t of NODE_TYPES) {
      expect(t.hint.length, `${t.role}'s hint`).toBeLessThanOrEqual(60);
    }
  });

  it("accent is always a CSS custom-property name, never a hex literal", () => {
    for (const t of NODE_TYPES) {
      expect(t.accent, `${t.role}'s accent`).toMatch(/^--role-[a-z]+$/);
      expect(t.accent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("loadLocked is true for exactly command and skill, each carrying a lockedReason", () => {
    const locked = NODE_TYPES.filter((t) => t.loadLocked).map((t) => t.role).sort();
    expect(locked).toEqual(["command", "skill"]);
    for (const t of NODE_TYPES) {
      if (t.loadLocked) {
        expect(t.lockedReason, `${t.role}'s lockedReason`).toBeTruthy();
      } else {
        expect(t.lockedReason, `${t.role} should not carry a lockedReason`).toBeUndefined();
      }
    }
    expect(LOAD_LOCKED_ROLES.slice().sort()).toEqual(["command", "skill"]);
  });

  it("lockedReason copy is frozen verbatim", () => {
    expect(NODE_TYPE_BY_ROLE.command.lockedReason).toBe("Commands only run when you call them.");
    expect(NODE_TYPE_BY_ROLE.skill.lockedReason).toBe("Skills load themselves when they're relevant.");
  });

  it("agent sits outside the four wizard-pickable groups (identity)", () => {
    expect(NODE_TYPE_BY_ROLE.agent.group).toBe("identity");
  });

  it("defaultLoad matches the frozen table (§6.3)", () => {
    const expected: Record<string, string> = {
      rule: "always",
      invariant: "always",
      trap: "always",
      architecture: "on-demand",
      decision: "on-demand",
      workflow: "on-demand",
      command: "on-invoke",
      skill: "on-demand",
      env: "always",
      tool: "always",
      glossary: "on-demand",
      example: "on-glob",
      style: "on-glob",
      agent: "on-demand",
    };
    for (const [role, defaultLoad] of Object.entries(expected)) {
      expect(NODE_TYPE_BY_ROLE[role as keyof typeof NODE_TYPE_BY_ROLE].defaultLoad, role).toBe(
        defaultLoad,
      );
    }
  });

  it("NODE_TYPE_BY_ROLE is a complete, consistent index", () => {
    for (const t of NODE_TYPES) {
      expect(NODE_TYPE_BY_ROLE[t.role]).toBe(t);
    }
  });
});
