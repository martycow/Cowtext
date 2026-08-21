// WO13_CONTRACT.md §9 — not in §15's named coverage table, but cheap and
// load-bearing: getting `affectsOutput`/`edgeParticipatesInOrder` wrong
// would silently change Kahn ordering or the solid/dashed stroke split.

import { describe, expect, it } from "vitest";
import type { EdgeKind } from "../store/graph";
import { affectsOutput, edgeParticipatesInOrder, isStructuralEdgeKind } from "./edgeKind";

const ALL_KINDS: readonly EdgeKind[] = ["imports", "references", "overrides", "sequence", "contradicts"];

describe("isStructuralEdgeKind — unchanged meaning (WO03)", () => {
  it("is true for exactly imports, sequence, overrides", () => {
    const structural = ALL_KINDS.filter(isStructuralEdgeKind).sort();
    expect(structural).toEqual(["imports", "overrides", "sequence"]);
  });
});

describe("affectsOutput — everything except contradicts", () => {
  it("is true for every kind but contradicts", () => {
    for (const k of ALL_KINDS) {
      expect(affectsOutput(k), k).toBe(k !== "contradicts");
    }
  });
});

describe("edgeParticipatesInOrder — structural AND unguarded", () => {
  it("a guarded imports edge does not participate, even though imports is structural", () => {
    expect(edgeParticipatesInOrder("imports", true)).toBe(false);
    expect(edgeParticipatesInOrder("imports", false)).toBe(true);
  });

  it("an advisory kind never participates, guarded or not", () => {
    expect(edgeParticipatesInOrder("references", false)).toBe(false);
    expect(edgeParticipatesInOrder("contradicts", false)).toBe(false);
  });

  it("sequence/overrides participate only when unguarded", () => {
    expect(edgeParticipatesInOrder("sequence", false)).toBe(true);
    expect(edgeParticipatesInOrder("sequence", true)).toBe(false);
    expect(edgeParticipatesInOrder("overrides", false)).toBe(true);
    expect(edgeParticipatesInOrder("overrides", true)).toBe(false);
  });
});
