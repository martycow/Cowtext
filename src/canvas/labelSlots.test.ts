// WO13_CONTRACT.md §18.9 defect 7 / §15 coverage table: "two colliding chips
// split up and down, never both down". Pure-module test, no DOM (the real
// boxes come from a mounted MemoryEdge's offsetWidth/Height — this exercises
// the solver directly with hand-built LabelBox values instead).

import { describe, expect, it } from "vitest";
import { LABEL_STEP, resolveLabelOffsets, type LabelBox } from "./labelSlots";

function box(id: string, x: number, y: number, w = 60, h = 14): LabelBox {
  return { id, x, y, w, h };
}

describe("resolveLabelOffsets (§18.9 defect 7b)", () => {
  it("returns an empty map for 0 or 1 entries", () => {
    expect(resolveLabelOffsets([]).size).toBe(0);
    expect(resolveLabelOffsets([box("a", 0, 0)]).size).toBe(0);
  });

  it("leaves non-overlapping labels untouched", () => {
    const out = resolveLabelOffsets([box("a", 0, 0), box("b", 0, 200)]);
    expect(out.size).toBe(0);
  });

  it("the first (id-sorted) label of a colliding pair never moves", () => {
    const out = resolveLabelOffsets([box("a", 0, 100), box("b", 0, 100)]);
    expect(out.has("a")).toBe(false);
    expect(out.has("b")).toBe(true);
  });

  it("three same-anchor labels split up and down — never all the same sign", () => {
    // Same x/y, same size: every one after the first collides with
    // everything already placed. Before the fix, `[+step, -step]` always
    // won at the same step magnitude, so both displaced labels landed
    // below. The alternating tie-break must send them to opposite sides.
    const out = resolveLabelOffsets([box("a", 0, 100), box("b", 0, 100), box("c", 0, 100)]);
    expect(out.has("a")).toBe(false); // first stays put

    const dyB = out.get("b");
    const dyC = out.get("c");
    expect(dyB).toBeDefined();
    expect(dyC).toBeDefined();
    // Never both the same sign (the "always downward" bug).
    expect(Math.sign(dyB!)).not.toBe(0);
    expect(Math.sign(dyC!)).not.toBe(0);
    expect(Math.sign(dyB!)).not.toBe(Math.sign(dyC!));
  });

  it("prefers the smallest displacement that clears the collision", () => {
    // b sits far enough in x that it does NOT collide with a — it must not
    // move at all, even though it shares a's y.
    const clear = resolveLabelOffsets([box("a", 0, 100, 20, 14), box("b", 200, 100, 20, 14)]);
    expect(clear.size).toBe(0);

    // c collides with a and must move by exactly one step-multiple, not
    // further than necessary.
    const displaced = resolveLabelOffsets([box("a", 0, 100), box("c", 0, 100)]);
    const dy = displaced.get("c");
    expect(dy).toBeDefined();
    expect(Math.abs(dy!) % LABEL_STEP).toBe(0);
    expect(Math.abs(dy!)).toBeGreaterThan(0);
  });

  it("is deterministic regardless of input array order (sweeps by id)", () => {
    const forward = resolveLabelOffsets([box("a", 0, 100), box("b", 0, 100), box("c", 0, 100)]);
    const shuffled = resolveLabelOffsets([box("c", 0, 100), box("a", 0, 100), box("b", 0, 100)]);
    expect(forward).toEqual(shuffled);
  });
});
