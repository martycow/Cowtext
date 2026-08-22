// `buildProjectGraph` is what the New Project wizard shows as its "Will
// create" list AND what it writes when the user clicks Create (WO15 §4.11,
// D-16). Those two must be the same computation, which makes determinism —
// same input, same bytes — the property worth pinning hardest.

import { describe, expect, it } from "vitest";
import { buildProjectGraph, type ProjectGraphInput } from "./projectGraph";
import { FIXED_STACK_PRINCIPLE_ID, PRINCIPLES } from "../resources";
// §7.8: paths are compared with `sameRelPath`, never a bare `===` — even in
// a test, where a Windows-shaped fixture would otherwise pass by luck.
import { sameRelPath } from "../store/graph";

function input(overrides: Partial<ProjectGraphInput> = {}): ProjectGraphInput {
  return {
    projectName: "Cowtext",
    principleIds: [],
    stackItemIds: [],
    fixedStackRule: false,
    compileTargets: ["claude"],
    ...overrides,
  };
}

describe("buildProjectGraph", () => {
  it("3 principles + 4 stack chips ⇒ 5 nodes, 4 stubs, 3 rule nodes", () => {
    const plan = buildProjectGraph(
      input({
        principleIds: ["tests-before-done", "no-destructive-git", "short-commit-subjects"],
        stackItemIds: ["typescript", "rust", "react", "tauri"],
      }),
    );
    expect(plan.graph.nodes.length).toBe(5);
    expect(plan.stubs.length).toBe(4);
    expect(plan.graph.nodes.filter((n) => n.role === "rule").length).toBe(3);
    for (const stub of plan.stubs) expect(stub.content.trim().length).toBeGreaterThan(0);
  });

  it("never stubs context/project.md — project_init already wrote it", () => {
    const plan = buildProjectGraph(input({ principleIds: ["tests-before-done"] }));
    expect(plan.graph.nodes[0].filePath).toBe("context/project.md");
    expect(plan.stubs.some((s) => sameRelPath(s.relPath, "context/project.md"))).toBe(false);
    expect(plan.summary.relPaths).toContain("context/project.md");
  });

  it("empty selection ⇒ one node, no stubs, no edges", () => {
    const plan = buildProjectGraph(input());
    expect(plan.graph.nodes.length).toBe(1);
    expect(plan.stubs.length).toBe(0);
    expect(plan.graph.edges).toEqual([]);
    expect(plan.summary).toEqual({
      count: 1,
      names: ["Cowtext"],
      relPaths: ["context/project.md"],
    });
  });

  it("falls back to 'Project' for a blank name, and trims the one it keeps", () => {
    expect(buildProjectGraph(input({ projectName: "   " })).graph.nodes[0].title).toBe("Project");
    const trimmed = buildProjectGraph(input({ projectName: "  Barnyard  " }));
    expect(trimmed.graph.nodes[0].title).toBe("Barnyard");
    expect(trimmed.graph.projectName).toBe("Barnyard");
  });

  it("fixedStackRule adds ask-before-dependency when it was not ticked", () => {
    const plan = buildProjectGraph(input({ fixedStackRule: true }));
    expect(plan.graph.nodes.map((n) => n.id)).toContain(
      `node-principle-${FIXED_STACK_PRINCIPLE_ID}`,
    );
  });

  it("fixedStackRule does NOT duplicate a principle the user already ticked", () => {
    const plan = buildProjectGraph(
      input({ principleIds: [FIXED_STACK_PRINCIPLE_ID], fixedStackRule: true }),
    );
    const matching = plan.graph.nodes.filter(
      (n) => n.id === `node-principle-${FIXED_STACK_PRINCIPLE_ID}`,
    );
    expect(matching.length).toBe(1);
    expect(plan.graph.nodes.length).toBe(2); // project + the one principle
  });

  it("orders principles by the PRINCIPLES table, not by click order", () => {
    const clicked = ["prefer-editing-existing", "no-commit-without-asking"];
    const plan = buildProjectGraph(input({ principleIds: clicked }));
    const ids = plan.graph.nodes.slice(1).map((n) => n.id);
    const expected = PRINCIPLES.filter((p) => clicked.includes(p.id)).map(
      (p) => `node-principle-${p.id}`,
    );
    expect(ids).toEqual(expected);
  });

  it("ignores unknown principle and stack ids instead of failing the whole plan", () => {
    const plan = buildProjectGraph(
      input({ principleIds: ["nope"], stackItemIds: ["cobol", "fortran"] }),
    );
    expect(plan.graph.nodes.length).toBe(1);
    expect(plan.stubs.length).toBe(0);
  });

  it("writes the stack file grouped by category, in STACK_CATEGORIES order", () => {
    const plan = buildProjectGraph(
      input({ stackItemIds: ["react", "rust", "typescript"], fixedStackRule: true }),
    );
    const stack = plan.stubs.find((s) => sameRelPath(s.relPath, "context/stack.md"));
    expect(stack?.content).toBe(
      "# Stack\n\n## Languages\n- TypeScript\n- Rust\n\n## Frontend\n- React\n\n" +
        "Fixed stack: ask before adding a dependency.\n",
    );
  });

  it("omits the fixed-stack line from the stack file when the box is off", () => {
    const plan = buildProjectGraph(input({ stackItemIds: ["rust"] }));
    const stack = plan.stubs.find((s) => sameRelPath(s.relPath, "context/stack.md"));
    expect(stack?.content).toBe("# Stack\n\n## Languages\n- Rust\n");
  });

  it("gives every node a unique id, readOrder 1…n, a grid position and rootLoad", () => {
    const plan = buildProjectGraph(
      input({
        principleIds: PRINCIPLES.map((p) => p.id),
        stackItemIds: ["rust"],
      }),
    );
    const ids = plan.graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.graph.nodes.map((n) => n.readOrder)).toEqual(
      plan.graph.nodes.map((_, i) => i + 1),
    );
    for (const [i, node] of plan.graph.nodes.entries()) {
      expect(node.rootLoad).toBe("always");
      expect(node.position).toEqual({ x: 80 + (i % 3) * 360, y: 80 + Math.floor(i / 3) * 160 });
    }
  });

  it("serializes a v5 graph and keeps only known compile targets", () => {
    const plan = buildProjectGraph(
      input({ compileTargets: ["claude", "gemini"] }),
    );
    const parsed = JSON.parse(plan.graphJson) as { version: number; compileTargets: string[] };
    expect(parsed.version).toBe(5);
    expect(parsed.compileTargets).toEqual(["claude", "gemini"]);
  });

  it("is deterministic — two calls with the same input are byte-identical", () => {
    const args = input({
      principleIds: ["no-destructive-git", "tests-before-done"],
      stackItemIds: ["rust", "tauri"],
      fixedStackRule: true,
      compileTargets: ["claude", "agents"],
    });
    const a = buildProjectGraph(args);
    const b = buildProjectGraph(args);
    expect(a.graphJson).toBe(b.graphJson);
    expect(a.stubs).toEqual(b.stubs);
  });
});
