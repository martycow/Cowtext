// WO13_CONTRACT.md §18.4 (owners: R1 + T1) — every case in the shared
// fixture corpus, asserted from the TS side. The Rust mirror
// (`src-tauri/src/resolve_load/tests.rs`) reads the SAME file, so neither
// implementation can quietly define the answer alone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BarnGraph } from "../store/graph";
import {
  alwaysLoadedNodeIds,
  resolveLoad,
  resolveLoadIgnoringRoleLock,
  type LoadResult,
} from "./resolveLoad";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "..", "tests", "fixtures", "resolve_load_cases.json");

interface FixtureCase {
  name: string;
  mode?: "apply" | "ignore";
  graph: BarnGraph;
  expected: Record<string, { policy: string; reason: string; decidingEdgeId?: string }>;
}

interface FixtureFile {
  cases: FixtureCase[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FixtureFile;

describe("resolveLoad — shared fixture corpus (§18.4)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const resolver = c.mode === "ignore" ? resolveLoadIgnoringRoleLock : resolveLoad;
      for (const [nodeId, expected] of Object.entries(c.expected)) {
        const actual: LoadResult = resolver(nodeId, c.graph);
        expect(actual.policy, `${c.name}: node ${nodeId} policy`).toBe(expected.policy);
        expect(actual.reason, `${c.name}: node ${nodeId} reason`).toBe(expected.reason);
        expect(actual.decidingEdgeId, `${c.name}: node ${nodeId} decidingEdgeId`).toBe(
          expected.decidingEdgeId,
        );
      }
      // `expected` is total (fixture's own note): every node in the graph is
      // named, so this also catches a case the corpus wrote but a reader
      // silently skipped.
      expect(Object.keys(c.expected).sort()).toEqual(c.graph.nodes.map((n) => n.id).sort());
    });
  }

  it("D6 fix round: alwaysLoadedNodeIds agrees with resolveLoad, node-by-node, on every apply-mode fixture graph", () => {
    // Pins the whole-graph closure export against the per-node resolver so
    // `store/tokens.ts`'s always-budget estimate (which reads
    // `alwaysLoadedNodeIds` for a whole graph, not `resolveLoad` per node)
    // can never silently drift from what `resolveLoad`/the linter's own
    // `resolve_load::always_closure` call would say about the same node.
    for (const c of fixture.cases) {
      if (c.mode === "ignore") continue; // alwaysLoadedNodeIds is apply-mode only
      const always = alwaysLoadedNodeIds(c.graph);
      for (const node of c.graph.nodes) {
        const expectedAlways = resolveLoad(node.id, c.graph).policy === "always";
        expect(always.has(node.id), `${c.name}: node ${node.id}`).toBe(expectedAlways);
      }
    }
  });

  it("c13/c13b are the same graph asserted in both modes — a reader that ignores `mode` fails one of them", () => {
    const c13 = fixture.cases.find((c) => c.name.startsWith("ignore-role-lock mode"));
    const c13b = fixture.cases.find((c) => c.name.startsWith("the same graph in apply mode"));
    expect(c13).toBeDefined();
    expect(c13b).toBeDefined();
    expect(c13?.mode).toBe("ignore");
    expect(c13b?.mode).toBe("apply");
    // Same command node ("b"): ignore mode resolves it by its edges (always,
    // via root-always); apply mode locks it to on-invoke regardless.
    expect(resolveLoadIgnoringRoleLock("b", (c13 as FixtureCase).graph).policy).toBe("always");
    expect(resolveLoad("b", (c13b as FixtureCase).graph).policy).toBe("on-invoke");
  });
});
