// WO13_CONTRACT.md §15/§18.5 (owner: T1) — `example` good/bad round-trip
// (split → compile → reopen → split, no drift) plus a general sanity check
// over the 14-role SECTIONS table via buildRoleSkeleton.

import { describe, expect, it } from "vitest";
import { NODE_ROLES } from "../store/graph";
import { buildExampleBody, buildRoleSkeleton, splitExampleBody } from "./roleSkeleton";

describe("buildRoleSkeleton — every role produces a non-empty skeleton", () => {
  it("has a heading and at least one section for all 14 roles", () => {
    for (const role of NODE_ROLES) {
      const body = buildRoleSkeleton("Title", role, "A brief.");
      expect(body, role).toContain("# Title");
      expect(body, role).toContain("A brief.");
      expect(body, role).toMatch(/^## /m);
    }
  });

  it("falls back to placeholder title/brief text when empty", () => {
    const body = buildRoleSkeleton("  ", "rule", "  ");
    expect(body).toContain("# Untitled node");
    expect(body).toContain("_One-line summary — replace this._");
  });

  it("the example role's skeleton uses the frozen Good/Bad headings", () => {
    const body = buildRoleSkeleton("X", "example", "brief");
    expect(body).toContain("## Good");
    expect(body).toContain("## Bad");
  });
});

describe("example good/bad round-trip (§14.2, node spec D3)", () => {
  it("split(buildExampleBody(...)) recovers the original good/bad text", () => {
    const good = "Catch a specific error type.";
    const bad = "catch (e) { /* ignore */ }";
    const body = buildExampleBody("Error handling", "How to handle errors", good, bad);
    const split = splitExampleBody(body);
    expect(split.good).toBe(good);
    expect(split.bad).toBe(bad);
  });

  it("compile -> split -> compile is idempotent (no drift on reopen)", () => {
    const body1 = buildExampleBody("T", "B", "good text", "bad text");
    const { good, bad } = splitExampleBody(body1);
    const body2 = buildExampleBody("T", "B", good, bad);
    expect(body2).toBe(body1);
  });

  it("handles multi-line good/bad text without bleeding into the next section", () => {
    const good = "Line one.\nLine two.";
    const bad = "Only one line.";
    const body = buildExampleBody("T", "", good, bad);
    const split = splitExampleBody(body);
    expect(split.good).toBe(good);
    expect(split.bad).toBe(bad);
  });

  it("a body missing a section returns an empty string for it, not a throw", () => {
    const split = splitExampleBody("# T\n\nbrief\n\n## Good\n\nonly good here\n");
    expect(split.good).toBe("only good here");
    expect(split.bad).toBe("");
  });
});
