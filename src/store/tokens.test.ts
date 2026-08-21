// WO13 fix round D6 — `pinnedContextTokens` must sum over the SAME set
// `resolveLoad`/`lint.rs`'s `always-budget-exceeded` check use (the
// `alwaysLoadedNodeIds` closure), never a local `rootLoad === "always"`
// test. Pins both the undercount case (a node reached only transitively
// via an unguarded `imports` edge, with no `rootLoad` of its own) and the
// overcount case (a `command` node whose `rootLoad` survives migration on
// the wire even though its OWN resolved policy is locked away from
// `"always"`).

import { beforeEach, describe, expect, it } from "vitest";
import { useGraphStore, type BarnGraph, type MemoryEdge, type MemoryNode } from "./graph";
import type { MdFile } from "./project";
import { pinnedContextTokens, tokensForBytes } from "./tokens";

function node(partial: Partial<MemoryNode> & Pick<MemoryNode, "id" | "role">): MemoryNode {
  return {
    title: partial.id,
    brief: "",
    filePath: `context/${partial.id}.md`,
    readOrder: 1,
    position: { x: 0, y: 0 },
    ...partial,
  };
}

function file(relPath: string, sizeBytes: number): MdFile {
  return { relPath, sizeBytes, modifiedMs: 0 };
}

function seedGraph(nodes: MemoryNode[], edges: MemoryEdge[]): void {
  useGraphStore.setState({ nodes, edges } as Partial<BarnGraph> as never);
}

describe("pinnedContextTokens — routed through resolveLoad's closure (D6)", () => {
  beforeEach(() => {
    useGraphStore.setState({ nodes: [], edges: [] });
  });

  it("counts a node reached only transitively via an unguarded imports edge (the undercount D6 found)", () => {
    const a = node({ id: "a", role: "rule", rootLoad: "always" });
    const b = node({ id: "b", role: "architecture" }); // no rootLoad of its own
    const edges: MemoryEdge[] = [{ id: "e1", source: "a", target: "b", kind: "imports" }];
    seedGraph([a, b], edges);
    const files = [file("context/a.md", 40), file("context/b.md", 400)];
    // Old local test (`n.rootLoad === "always"`) would have counted only
    // `a`'s 40 bytes; the closure includes `b` too via the unguarded
    // imports edge.
    expect(pinnedContextTokens([a, b], files)).toBe(tokensForBytes(40 + 400));
  });

  it("excludes a command node's bytes even though rootLoad survives migration on the wire (the overcount D6 found)", () => {
    const cmd = node({ id: "c", role: "command", rootLoad: "always" });
    seedGraph([cmd], []);
    const files = [file("context/c.md", 4000)];
    // Amendment 1 rule 1: a command node's resolved policy is on-invoke,
    // never "always" — the old local test would have counted it anyway.
    expect(pinnedContextTokens([cmd], files)).toBe(0);
  });

  it("a guarded (conditional) import does not pull its target into the always count", () => {
    const a = node({ id: "a", role: "rule", rootLoad: "always" });
    const b = node({ id: "b", role: "architecture" });
    const edges: MemoryEdge[] = [
      { id: "e1", source: "a", target: "b", kind: "imports", guard: { type: "glob", globs: ["src/**"] } },
    ];
    seedGraph([a, b], edges);
    const files = [file("context/a.md", 40), file("context/b.md", 999)];
    expect(pinnedContextTokens([a, b], files)).toBe(tokensForBytes(40));
  });

  it("a deprecated root-always node contributes nothing", () => {
    const a = node({ id: "a", role: "rule", rootLoad: "always", deprecated: { replacedBy: "z" } });
    seedGraph([a], []);
    const files = [file("context/a.md", 4000)];
    expect(pinnedContextTokens([a], files)).toBe(0);
  });
});
