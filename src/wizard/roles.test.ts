// Block 1 acceptance test (WO15 §4.14): "13 types" is a number the UI says
// out loud — the `?` popover lists them — so it must be a number the code
// can prove, not a comment. The wizard's picker is `WIZARD_ROLE_GROUPS`;
// `agent` is deliberately absent (agents are created in the Agents rail),
// which is exactly why the count is 13 and not the taxonomy's 14.

import { describe, expect, it } from "vitest";
import { WIZARD_BLOCKED_HINT, WIZARD_BLOCKED_ROLES, WIZARD_ROLE_GROUPS } from "./roles";
import { NODE_TYPES, NODE_TYPE_BY_ROLE } from "../config/nodeTypes";

const WIZARD_ROLES = WIZARD_ROLE_GROUPS.flatMap((g) => g.roles);

describe("WIZARD_ROLE_GROUPS", () => {
  it("flattens to exactly 13 roles", () => {
    expect(WIZARD_ROLES.length).toBe(13);
  });

  it("excludes agent — and nothing else the taxonomy ships", () => {
    expect(WIZARD_ROLES).not.toContain("agent");
    expect(WIZARD_BLOCKED_ROLES).toEqual(["agent"]);
    const missing = NODE_TYPES.map((t) => t.role).filter((r) => !WIZARD_ROLES.includes(r));
    expect(missing).toEqual(["agent"]);
  });

  it("lists every role exactly once", () => {
    expect(new Set(WIZARD_ROLES).size).toBe(WIZARD_ROLES.length);
  });

  it("has no empty group — a header with nothing under it is a rendering bug", () => {
    expect(WIZARD_ROLE_GROUPS.length).toBeGreaterThan(0);
    for (const group of WIZARD_ROLE_GROUPS) expect(group.roles.length).toBeGreaterThan(0);
  });

  it("gives every wizard role a label, a hint and a concrete microExample", () => {
    for (const role of WIZARD_ROLES) {
      const meta = NODE_TYPE_BY_ROLE[role];
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.hint.trim().length).toBeGreaterThan(0);
      expect(meta.microExample.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the popover footer honest about where agents come from", () => {
    expect(WIZARD_BLOCKED_HINT).toBe("Agents are created in the Agents rail.");
  });
});
