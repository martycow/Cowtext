// WO13_CONTRACT.md §18.2/§5.7/F1 (owner: T1) — a v4 preset carrying
// `role: "rules"` / `kind: "conditional"` must parse to `rule` /
// `imports`+guard, not silently fall back to `architecture` / `references`
// and drop the guard.

import { describe, expect, it } from "vitest";
import { parsePreset, PRESET_VERSION } from "./types";

function v4Preset(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 4,
    kind: "cowtext-preset",
    name: "Legacy",
    savedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        id: "a",
        title: "A",
        role: "rules",
        brief: "",
        filePath: "context/a.md",
        readOrder: 1,
        pinned: true,
        position: { x: 0, y: 0 },
      },
      {
        id: "b",
        title: "B",
        role: "style",
        brief: "",
        filePath: "context/b.md",
        readOrder: 2,
        pinned: false,
        position: { x: 0, y: 0 },
      },
    ],
    edges: [
      { id: "e1", source: "a", target: "b", kind: "conditional", condition: "src/api/**" },
    ],
    compileTargets: ["claude"],
    ...overrides,
  });
}

describe("parsePreset — v4 -> v5 migration in lockstep (§5.7, F1)", () => {
  it("renames role 'rules' to 'rule', not the architecture fallback", () => {
    const p = parsePreset(v4Preset());
    expect(p.version).toBe(PRESET_VERSION);
    const a = p.nodes.find((n) => n.id === "a");
    expect(a?.role).toBe("rule");
    expect(a?.rootLoad).toBe("always");
  });

  it("converts a glob 'conditional' edge to imports + a glob guard, not references", () => {
    const p = parsePreset(v4Preset());
    const e = p.edges.find((e) => e.id === "e1");
    expect(e?.kind).toBe("imports");
    expect(e?.guard).toEqual({ type: "glob", globs: ["src/api/**"] });
  });

  it("converts a natural-language 'conditional' edge to a description guard", () => {
    const json = v4Preset({
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          kind: "conditional",
          condition: "you are refactoring the router",
        },
      ],
    });
    const p = parsePreset(json);
    const e = p.edges.find((e) => e.id === "e1");
    expect(e?.kind).toBe("imports");
    expect(e?.guard).toEqual({ type: "description", text: "you are refactoring the router" });
  });

  it("renames role 'task' to 'workflow' and 'reference' to 'architecture'", () => {
    const json = JSON.stringify({
      version: 3,
      kind: "cowtext-preset",
      name: "V3",
      savedAt: "",
      nodes: [
        {
          id: "a",
          title: "A",
          role: "task",
          brief: "",
          filePath: "context/a.md",
          readOrder: 1,
          pinned: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "b",
          title: "B",
          role: "reference",
          brief: "",
          filePath: "context/b.md",
          readOrder: 2,
          pinned: false,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      compileTargets: ["claude"],
    });
    const p = parsePreset(json);
    expect(p.nodes.find((n) => n.id === "a")?.role).toBe("workflow");
    expect(p.nodes.find((n) => n.id === "b")?.role).toBe("architecture");
  });

  it("falls an unrecognized role back to architecture (not 'reference')", () => {
    const json = v4Preset({
      nodes: [
        {
          id: "a",
          title: "A",
          role: "widget",
          brief: "",
          filePath: "context/a.md",
          readOrder: 1,
          pinned: false,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });
    const p = parsePreset(json);
    expect(p.nodes[0].role).toBe("architecture");
  });

  it("converts a 'supersedes' edge into target deprecation and deletes the edge", () => {
    const json = v4Preset({
      nodes: [
        {
          id: "a",
          title: "A",
          role: "architecture",
          brief: "",
          filePath: "context/a.md",
          readOrder: 1,
          pinned: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "b",
          title: "B",
          role: "example",
          brief: "",
          filePath: "context/b.md",
          readOrder: 2,
          pinned: false,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "a", target: "b", kind: "supersedes" }],
    });
    const p = parsePreset(json);
    expect(p.edges.length).toBe(0);
    const b = p.nodes.find((n) => n.id === "b");
    expect(b?.deprecated).toEqual({ replacedBy: "a" });
    expect(b?.needsReview).toBe(true);
  });

  it("renames 'conflicts-with' to 'contradicts' and strips any guard", () => {
    const json = v4Preset({
      nodes: [
        {
          id: "a",
          title: "A",
          role: "glossary",
          brief: "",
          filePath: "context/a.md",
          readOrder: 1,
          pinned: false,
          position: { x: 0, y: 0 },
        },
        {
          id: "b",
          title: "B",
          role: "skill",
          brief: "",
          filePath: "context/b.md",
          readOrder: 2,
          pinned: false,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "a", target: "b", kind: "conflicts-with" }],
    });
    const p = parsePreset(json);
    expect(p.edges[0].kind).toBe("contradicts");
    expect(p.edges[0].guard).toBeUndefined();
  });

  it("a v5 preset already carrying rootLoad/guard/deprecated/needsReview round-trips those fields", () => {
    const json = JSON.stringify({
      version: 5,
      kind: "cowtext-preset",
      name: "V5",
      savedAt: "",
      nodes: [
        {
          id: "a",
          title: "A",
          role: "rule",
          brief: "",
          filePath: "context/a.md",
          readOrder: 1,
          rootLoad: "always",
          position: { x: 0, y: 0 },
          needsReview: true,
        },
        {
          id: "b",
          title: "B",
          role: "example",
          brief: "",
          filePath: "context/b.md",
          readOrder: 2,
          position: { x: 0, y: 0 },
          deprecated: { replacedBy: "a", since: "2026-01-01", reason: "folded in" },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          kind: "imports",
          guard: { type: "description", text: "debugging" },
        },
      ],
      compileTargets: ["claude"],
    });
    const p = parsePreset(json);
    expect(p.nodes.find((n) => n.id === "a")?.rootLoad).toBe("always");
    expect(p.nodes.find((n) => n.id === "a")?.needsReview).toBe(true);
    expect(p.nodes.find((n) => n.id === "b")?.deprecated).toEqual({
      replacedBy: "a",
      since: "2026-01-01",
      reason: "folded in",
    });
    expect(p.edges[0].guard).toEqual({ type: "description", text: "debugging" });
  });
});
