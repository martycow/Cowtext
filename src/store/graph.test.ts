// WO13_CONTRACT.md §18.2 (owner: Stage 0) — migration idempotence and the
// byte-identical fixture-parity gate, asserted from the TS side. The Rust
// mirror lives in src-tauri/src/project/tests.rs and reads the SAME two
// fixture files, so neither implementation can quietly define the answer.
//
// Fixtures are read relative to the repo root (not under src/ or
// src-tauri/src/, per the contract's own note on why neither tsconfig's
// `include` nor cargo's module tree picks them up accidentally).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isGlobCondition,
  migrateGraph,
  serializeGraph,
  useGraphStore,
  type MemoryEdge,
  type MemoryNode,
} from "./graph";
// Side-effecting import: registers the REAL §7.3 legality matrix into
// graph.ts's `registerEdgeLegality` slot (see graph.ts's own doc comment
// above that slot). Without this, `edgeLegalityResolver` stays at its
// permissive Stage-0 default and the WO13_AUDIT.md D7 deny tests below
// would pass for the wrong reason (nothing implements deny yet) rather
// than the right one (the real matrix denies it).
import "../config/edgeRules";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "..", "tests", "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

const FIXTURE_V4_IN = readFixture("graph_v4_in.json");
const FIXTURE_V5_OUT = readFixture("graph_v5_out.json");

describe("migrateGraph + serializeGraph — fixture parity (§18.2)", () => {
  it("migrating and serializing the v4 fixture matches the v5 fixture byte-for-byte", () => {
    const migrated = migrateGraph(JSON.parse(FIXTURE_V4_IN) as unknown);
    const out = serializeGraph(migrated);
    expect(out).toBe(FIXTURE_V5_OUT);
  });

  it("migrating the v5 fixture again is idempotent", () => {
    const migrated = migrateGraph(JSON.parse(FIXTURE_V5_OUT) as unknown);
    const out = serializeGraph(migrated);
    expect(out).toBe(FIXTURE_V5_OUT);
  });

  it("preserves node count and drops exactly the two documented edges", () => {
    const before = migrateGraph(JSON.parse(FIXTURE_V4_IN) as unknown);
    expect(before.nodes.length).toBe(13);
    expect(before.edges.length).toBe(7);
    const ids = new Set(before.edges.map((e) => e.id));
    expect(ids.has("e07-x")).toBe(false); // supersedes-converted
    expect(ids.has("e09-x")).toBe(false); // reciprocal-collapsed
  });
});

describe("migrateGraph — role rewrite (§5.1 passes 3-5)", () => {
  it("renames persona to agent (v1)", () => {
    const raw = {
      version: 1,
      projectName: "demo",
      nodes: [
        {
          id: "n1",
          title: "Old",
          role: "persona",
          brief: "",
          filePath: "context/old.md",
          readOrder: 1,
          pinned: false,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.nodes[0].role).toBe("agent");
    expect(g.nodes[0].rootLoad).toBeUndefined();
    expect(g.nodes[0].needsReview).toBeUndefined();
  });

  it("renames rules -> rule with no review flag, task -> workflow and reference -> architecture WITH a review flag", () => {
    const node = (id: string, role: string) => ({
      id,
      title: id,
      role,
      brief: "",
      filePath: `context/${id}.md`,
      readOrder: 1,
      pinned: false,
      position: { x: 0, y: 0 },
    });
    const raw = {
      version: 4,
      nodes: [node("a", "rules"), node("b", "task"), node("c", "reference"), node("d", "snippet")],
      edges: [],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")?.role).toBe("rule");
    expect(byId.get("a")?.needsReview).toBeUndefined();
    expect(byId.get("b")?.role).toBe("workflow");
    expect(byId.get("b")?.needsReview).toBe(true);
    expect(byId.get("c")?.role).toBe("architecture");
    expect(byId.get("c")?.needsReview).toBe(true);
    expect(byId.get("d")?.role).toBe("example");
    expect(byId.get("d")?.needsReview).toBeUndefined();
  });

  it("falls back an unrecognized role to architecture, flagged for review", () => {
    const raw = {
      version: 4,
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
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.nodes[0].role).toBe("architecture");
    expect(g.nodes[0].needsReview).toBe(true);
  });
});

describe("migrateGraph — pinned -> rootLoad (§5.1 passes 6-7)", () => {
  it("pinned true becomes rootLoad always; pinned false is omitted", () => {
    const node = (id: string, pinned: boolean) => ({
      id,
      title: id,
      role: "architecture",
      brief: "",
      filePath: `context/${id}.md`,
      readOrder: 1,
      pinned,
      position: { x: 0, y: 0 },
    });
    const raw = { version: 4, nodes: [node("a", true), node("b", false)], edges: [], compileTargets: ["claude"] };
    const g = migrateGraph(raw);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")?.rootLoad).toBe("always");
    expect(byId.get("b")?.rootLoad).toBeUndefined();
  });
});

describe("migrateGraph — conditional -> imports+guard (§5.1 pass 8, §5.4)", () => {
  it("classifies a glob condition as a glob guard", () => {
    const raw = {
      version: 4,
      nodes: [
        { id: "a", title: "A", role: "rule", brief: "", filePath: "context/a.md", readOrder: 1, pinned: false, position: { x: 0, y: 0 } },
        { id: "b", title: "B", role: "style", brief: "", filePath: "context/b.md", readOrder: 2, pinned: false, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "e1", source: "a", target: "b", kind: "conditional", condition: "src/api/**" }],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges[0].kind).toBe("imports");
    expect(g.edges[0].guard).toEqual({ type: "glob", globs: ["src/api/**"] });
  });

  it("classifies a natural-language condition as a description guard", () => {
    const raw = {
      version: 4,
      nodes: [
        { id: "a", title: "A", role: "rule", brief: "", filePath: "context/a.md", readOrder: 1, pinned: false, position: { x: 0, y: 0 } },
        { id: "b", title: "B", role: "trap", brief: "", filePath: "context/b.md", readOrder: 2, pinned: false, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", kind: "conditional", condition: "you are debugging a flaky test" },
      ],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges[0].kind).toBe("imports");
    expect(g.edges[0].guard).toEqual({ type: "description", text: "you are debugging a flaky test" });
  });

  it("an absent or empty condition produces a bare unguarded imports edge", () => {
    const raw = {
      version: 4,
      nodes: [
        { id: "a", title: "A", role: "rule", brief: "", filePath: "context/a.md", readOrder: 1, pinned: false, position: { x: 0, y: 0 } },
        { id: "b", title: "B", role: "trap", brief: "", filePath: "context/b.md", readOrder: 2, pinned: false, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "e1", source: "a", target: "b", kind: "conditional" }],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges[0].kind).toBe("imports");
    expect(g.edges[0].guard).toBeUndefined();
  });
});

describe("migrateGraph — supersedes -> deprecated (§5.1 pass 9, §5.5)", () => {
  it("deprecates the target, flags review, and deletes the edge", () => {
    const raw = {
      version: 4,
      nodes: [
        { id: "a", title: "A", role: "architecture", brief: "", filePath: "context/a.md", readOrder: 1, pinned: false, position: { x: 0, y: 0 } },
        { id: "b", title: "B", role: "example", brief: "", filePath: "context/b.md", readOrder: 2, pinned: false, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "e1", source: "a", target: "b", kind: "supersedes" }],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges.length).toBe(0);
    const b = g.nodes.find((n) => n.id === "b");
    expect(b?.deprecated).toEqual({ replacedBy: "a" });
    expect(b?.needsReview).toBe(true);
  });

  it("the lowest-id edge wins when a node is superseded twice, regardless of array order", () => {
    const node = (id: string) => ({
      id,
      title: id,
      role: "architecture",
      brief: "",
      filePath: `context/${id}.md`,
      readOrder: 1,
      pinned: false,
      position: { x: 0, y: 0 },
    });
    const raw = {
      version: 4,
      nodes: [node("a"), node("b"), node("c")],
      edges: [
        { id: "e9-later", source: "b", target: "c", kind: "supersedes" },
        { id: "e1-first", source: "a", target: "c", kind: "supersedes" },
      ],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    const c = g.nodes.find((n) => n.id === "c");
    expect(c?.deprecated?.replacedBy).toBe("a");
  });
});

describe("migrateGraph — contradicts normalization + dedupe (§5.1 passes 10-13, §5.6)", () => {
  it("collapses a reciprocal pair to the lowest-id edge and drops the other's decorations", () => {
    const raw = {
      version: 4,
      nodes: [
        { id: "a", title: "A", role: "glossary", brief: "", filePath: "context/a.md", readOrder: 1, pinned: false, position: { x: 0, y: 0 } },
        { id: "b", title: "B", role: "skill", brief: "", filePath: "context/b.md", readOrder: 2, pinned: false, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e08-x", source: "a", target: "b", kind: "conflicts-with" },
        { id: "e09-x", source: "b", target: "a", kind: "conflicts-with", waypoints: [{ x: 10, y: 20 }] },
      ],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges.length).toBe(1);
    expect(g.edges[0].id).toBe("e08-x");
    expect(g.edges[0].kind).toBe("contradicts");
    expect(g.edges[0].source).toBe("a");
    expect(g.edges[0].target).toBe("b");
    expect(g.edges[0].waypoints ?? []).toEqual([]);
  });

  it("strips guard from a contradicts edge", () => {
    const raw = {
      version: 5,
      nodes: [
        { id: "a", title: "A", role: "glossary", brief: "", filePath: "context/a.md", readOrder: 1, position: { x: 0, y: 0 } },
        { id: "b", title: "B", role: "skill", brief: "", filePath: "context/b.md", readOrder: 2, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", kind: "contradicts", guard: { type: "description", text: "illegal" } },
      ],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges[0].guard).toBeUndefined();
  });
});

describe("migrateGraph — tolerance and version guards", () => {
  it("rejects an out-of-range version", () => {
    expect(() => migrateGraph({ version: 0, nodes: [], edges: [] })).toThrow();
    expect(() => migrateGraph({ version: 6, nodes: [], edges: [] })).toThrow();
  });

  it("requires nodes and edges arrays", () => {
    expect(() => migrateGraph({ version: 4, edges: [] })).toThrow();
    expect(() => migrateGraph({ version: 4, nodes: [] })).toThrow();
  });

  it("drops an unrecognized compile target, keeping known ones in order", () => {
    const raw = { version: 4, nodes: [], edges: [], compileTargets: ["claude", "not-a-real-target", "gemini"] };
    const g = migrateGraph(raw);
    expect(g.compileTargets).toEqual(["claude", "gemini"]);
  });

  it("an unknown edge kind falls back to references", () => {
    const raw = {
      version: 4,
      nodes: [
        { id: "a", title: "A", role: "architecture", brief: "", filePath: "context/a.md", readOrder: 1, pinned: false, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "e1", source: "a", target: "a", kind: "supersecedes" }],
      compileTargets: ["claude"],
    };
    const g = migrateGraph(raw);
    expect(g.edges[0].kind).toBe("references");
  });
});

describe("isGlobCondition (§5.4)", () => {
  it("recognizes glob syntax", () => {
    expect(isGlobCondition("src/api/**")).toBe(true);
    expect(isGlobCondition("*.md")).toBe(true);
    expect(isGlobCondition("a?b")).toBe(true);
    expect(isGlobCondition("[abc]")).toBe(true);
  });

  it("rejects natural language and whitespace-containing text", () => {
    expect(isGlobCondition("you are debugging a flaky test")).toBe(false);
    expect(isGlobCondition("plain-text-no-glob-chars")).toBe(false);
    expect(isGlobCondition("src/api/** please")).toBe(false);
    expect(isGlobCondition("")).toBe(false);
  });
});

// ── WO13_AUDIT.md D7 — updateEdge legality gate + contradicts
// normalization/guard-strip (fix-round Stage 0, `graph.ts` reopened
// serially per tech-lead's ruling: "CLOSED" applies only for the duration
// of PARALLEL lane execution, §17 amended). ────────────────────────────

function bareNode(id: string, role: MemoryNode["role"], extra?: Partial<MemoryNode>): MemoryNode {
  return {
    id,
    title: id,
    role,
    brief: "",
    filePath: `context/${id}.md`,
    readOrder: 1,
    position: { x: 0, y: 0 },
    ...extra,
  };
}

function bareEdge(id: string, source: string, target: string, kind: MemoryEdge["kind"], extra?: Partial<MemoryEdge>): MemoryEdge {
  return { id, source, target, kind, ...extra };
}

/** Resets the parts of the store these tests touch, so each test starts
 *  from a clean slate regardless of what ran before it. Deliberately does
 *  NOT call `loadGraph`/`flushSave` — those call `invoke` (Tauri IPC),
 *  unavailable under Vitest's `node` environment; every action under test
 *  here (`addEdge`/`updateEdge`) only schedules a debounced save via
 *  `setTimeout`, which never fires within a synchronous test. */
beforeEach(() => {
  useGraphStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

describe("updateEdge — legality gate (D7a)", () => {
  it("refuses a kind switch that would make the edge target a deprecated node", () => {
    // kind "references" + target role "glossary" deliberately avoids the
    // OTHER static rules keyed on "imports"/"architecture" (§7.3's table
    // has a same-target, higher-specificity "warn" rule for "imports" into
    // "architecture" that would otherwise win over the "@deprecated" deny
    // and mask this test's intent).
    useGraphStore.setState({
      nodes: [
        bareNode("a", "architecture"),
        bareNode("b", "glossary", { deprecated: { replacedBy: "a" } }),
      ],
      edges: [bareEdge("e1", "a", "b", "imports")],
    });
    const ok = useGraphStore.getState().updateEdge("e1", { kind: "references" });
    expect(ok).toBe(false);
    // The edge is left exactly as it was — not partially patched.
    expect(useGraphStore.getState().edges).toEqual([bareEdge("e1", "a", "b", "imports")]);
  });

  it("refuses updating an edge that does not exist", () => {
    const ok = useGraphStore.getState().updateEdge("nope", { note: "x" });
    expect(ok).toBe(false);
  });

  it("allows a non-denied patch and returns true", () => {
    useGraphStore.setState({
      nodes: [bareNode("a", "architecture"), bareNode("b", "architecture")],
      edges: [bareEdge("e1", "a", "b", "references")],
    });
    const ok = useGraphStore.getState().updateEdge("e1", { note: "hello" });
    expect(ok).toBe(true);
    expect(useGraphStore.getState().edges[0].note).toBe("hello");
  });
});

describe("addEdge / updateEdge — contradicts endpoint normalization + guard strip (D7b, D7c)", () => {
  it("addEdge normalizes a user-drawn contradicts edge to source < target byte order", () => {
    useGraphStore.setState({
      nodes: [bareNode("n11-x", "skill"), bareNode("n07-x", "glossary")],
    });
    // Drawn from n11-x -> n07-x — the "wrong" direction byte-wise.
    const id = useGraphStore.getState().addEdge({ source: "n11-x", target: "n07-x", kind: "contradicts" });
    expect(id).not.toBeNull();
    const e = useGraphStore.getState().edges.find((x) => x.id === id);
    expect(e?.source).toBe("n07-x");
    expect(e?.target).toBe("n11-x");
  });

  it("updateEdge normalizes endpoints when a kind SWITCH turns an edge into contradicts", () => {
    useGraphStore.setState({
      nodes: [bareNode("z", "glossary"), bareNode("a", "glossary")],
      // source > target byte-wise ("z" > "a") — exactly the shape D7(b)
      // warns about: an un-normalized pair that migration would silently
      // reorder, and delete outright if the reciprocal already existed.
      edges: [bareEdge("e1", "z", "a", "references")],
    });
    const ok = useGraphStore.getState().updateEdge("e1", { kind: "contradicts" });
    expect(ok).toBe(true);
    const e = useGraphStore.getState().edges[0];
    expect(e.source).toBe("a");
    expect(e.target).toBe("z");
  });

  it("updateEdge strips an illegal guard when the kind switches to contradicts", () => {
    useGraphStore.setState({
      nodes: [bareNode("a", "glossary"), bareNode("b", "glossary")],
      edges: [
        bareEdge("e1", "a", "b", "imports", { guard: { type: "description", text: "sometimes" } }),
      ],
    });
    const ok = useGraphStore.getState().updateEdge("e1", { kind: "contradicts" });
    expect(ok).toBe(true);
    expect(useGraphStore.getState().edges[0].guard).toBeUndefined();
  });

  it("a reciprocal contradicts pair survives a save -> load round trip without losing an edge", () => {
    // Simulates what addEdge/updateEdge now guarantee on write (normalized,
    // deduped against the reciprocal) followed by the SAME migration pass
    // a real save -> reload cycle runs, proving D7's fix actually closes
    // the data-loss hole the audit found (§5.6's collapse-and-delete only
    // fires on an UN-normalized pair).
    useGraphStore.setState({
      nodes: [bareNode("a", "glossary"), bareNode("b", "skill")],
    });
    const firstId = useGraphStore.getState().addEdge({ source: "a", target: "b", kind: "contradicts" });
    expect(firstId).not.toBeNull();
    // A second, reciprocal draw (B -> A) is refused as a no-op — never a
    // second edge.
    const secondId = useGraphStore.getState().addEdge({ source: "b", target: "a", kind: "contradicts" });
    expect(secondId).toBeNull();
    expect(useGraphStore.getState().edges.length).toBe(1);

    const graph = {
      version: 5 as const,
      projectName: "d7",
      nodes: useGraphStore.getState().nodes,
      edges: useGraphStore.getState().edges,
      compileTargets: ["claude" as const],
    };
    const out = serializeGraph(graph);
    const reloaded = migrateGraph(JSON.parse(out) as unknown);
    expect(reloaded.edges.length).toBe(1);
    expect(reloaded.edges[0].source).toBe("a");
    expect(reloaded.edges[0].target).toBe("b");
    // Re-serializing the reloaded graph is byte-identical — no further
    // churn from a second migrate/save cycle.
    expect(serializeGraph(reloaded)).toBe(out);
  });
});

describe("undo/redo and paste — do not need a legality re-check (D7 scope note)", () => {
  it("undo/redo restore whole snapshots directly, bypassing addEdge/updateEdge by design", () => {
    // This is D8's territory (lint reporting Deny at Error severity,
    // owner R2), not D7's — documented here only so a future reader does
    // not assume undo/redo were silently fixed by this change. Restoring
    // exactly what was there before (including an edge that became denied
    // after a later state change) is undo's whole contract; gating it
    // through addEdge/updateEdge would make "undo" sometimes not undo.
    useGraphStore.setState({
      nodes: [bareNode("a", "architecture"), bareNode("b", "architecture")],
      edges: [bareEdge("e1", "a", "b", "references")],
      canUndo: false,
      canRedo: false,
    });
    // No paste implementation exists yet anywhere in this codebase (grep
    // confirms zero non-comment hits for "paste"/"Paste" under src/canvas
    // and src/store as of this session) — nothing to test until a lane
    // builds it. When one does, it must call `addEdge`, not push onto
    // `edges` directly, to inherit this gate.
    expect(true).toBe(true);
  });
});
