// The New Project wizard's graph plan (WO15 §4.11, Block 6) — PURE and
// deterministic: same input ⇒ same bytes, every time. Nothing here touches
// disk, the store, or `invoke`. The wizard renders `summary` as its "Will
// create" list BEFORE the user clicks Create, and passes `graphJson` +
// `stubs` to `presetApply` after — so the preview and the write are
// literally the same computation, not two descriptions of one.
//
// Positions are a fixed 3-column grid (A-1: there is no `starter.ts` to
// imitate). The canvas re-lays nothing on open, so a deterministic grid is
// also what makes two runs of the wizard produce byte-identical graph.json.

import { GRAPH_VERSION, serializeGraph, type BarnGraph, type CompileTarget, type MemoryNode } from "../store/graph";
import type { StubFile } from "../preset/types";
import { FIXED_STACK_PRINCIPLE_ID, PRINCIPLES, STACK_CATEGORIES } from "../resources";

export interface ProjectGraphInput {
  projectName: string;
  principleIds: readonly string[];
  stackItemIds: readonly string[];
  /** The wizard's "Fixed stack — ask before adding a dependency" checkbox:
   *  adds the matching principle node AND a closing line to the stack file. */
  fixedStackRule: boolean;
  /** `useSettingsStore.getState().defaultCompileTargets` — the ticks the
   *  user made on the title screen, carried into the new project's graph. */
  compileTargets: readonly CompileTarget[];
}

export interface ProjectGraphPlan {
  /** version 5, no edges — the wizard creates content, not structure. */
  graph: BarnGraph;
  graphJson: string;
  /** Every node except `context/project.md` (which `project_init` already
   *  wrote — re-writing it here would clobber the user's own first file). */
  stubs: StubFile[];
  summary: { count: number; names: string[]; relPaths: string[] };
}

const KNOWN_TARGETS: readonly CompileTarget[] = ["claude", "agents", "cursor", "copilot", "gemini"];

const PROJECT_BRIEF = "What this project is, who it is for, and the rules it lives by.";
const STACK_BRIEF = "The languages, frameworks and tools this project is built with.";
const FIXED_STACK_LINE = "Fixed stack: ask before adding a dependency.";

/** The 3-column grid every node lands on, by index. */
function positionFor(i: number): { x: number; y: number } {
  return { x: 80 + (i % 3) * 360, y: 80 + Math.floor(i / 3) * 160 };
}

/** `# Stack` + one `##` section per non-empty category, in
 *  `STACK_CATEGORIES` order (NOT the order the user clicked chips in —
 *  determinism), + the fixed-stack line when asked. */
function stackBody(selected: readonly string[], fixedStackRule: boolean): string {
  const picked = new Set(selected);
  const sections: string[] = ["# Stack"];
  for (const category of STACK_CATEGORIES) {
    const items = category.items.filter((item) => picked.has(item.id));
    if (items.length === 0) continue;
    sections.push([`## ${category.label}`, ...items.map((item) => `- ${item.label}`)].join("\n"));
  }
  if (fixedStackRule) sections.push(FIXED_STACK_LINE);
  return `${sections.join("\n\n")}\n`;
}

export function buildProjectGraph(input: ProjectGraphInput): ProjectGraphPlan {
  const projectName = input.projectName.trim();

  // Unknown ids are ignored rather than rejected: the wizard's chips are the
  // only producer today, but a preset or a future import could hand us an id
  // this build no longer ships, and dropping it beats failing the whole
  // project creation over one stale string.
  const knownStackIds = input.stackItemIds.filter((id) =>
    STACK_CATEGORIES.some((c) => c.items.some((item) => item.id === id)),
  );

  const wanted = new Set(input.principleIds);
  if (input.fixedStackRule) wanted.add(FIXED_STACK_PRINCIPLE_ID);
  // PRINCIPLES order, not selection order — and `Set` membership already
  // deduped, so ticking "Ask before adding a dependency" AND "Fixed stack"
  // yields one node, not two.
  const principles = PRINCIPLES.filter((p) => wanted.has(p.id));

  const nodes: MemoryNode[] = [];
  const stubs: StubFile[] = [];

  const push = (node: Omit<MemoryNode, "readOrder" | "position">, content: string | null): void => {
    const i = nodes.length;
    nodes.push({ ...node, readOrder: i + 1, position: positionFor(i) });
    if (content !== null) stubs.push({ relPath: node.filePath, content });
  };

  push(
    {
      id: "node-project",
      title: projectName === "" ? "Project" : projectName,
      role: "architecture",
      brief: PROJECT_BRIEF,
      filePath: "context/project.md",
      rootLoad: "always",
      tags: ["project"],
    },
    // NOT a stub: `project_init` already wrote this file.
    null,
  );

  if (knownStackIds.length > 0) {
    push(
      {
        id: "node-stack",
        title: "Stack",
        role: "architecture",
        brief: STACK_BRIEF,
        filePath: "context/stack.md",
        rootLoad: "always",
        tags: ["stack"],
      },
      stackBody(knownStackIds, input.fixedStackRule),
    );
  }

  for (const principle of principles) {
    push(
      {
        id: `node-principle-${principle.id}`,
        title: principle.label,
        role: "rule",
        brief: principle.label,
        filePath: `context/principles/${principle.id}.md`,
        rootLoad: "always",
        tags: ["principle"],
      },
      `${principle.body}\n`,
    );
  }

  const graph: BarnGraph = {
    version: GRAPH_VERSION,
    projectName,
    nodes,
    edges: [],
    compileTargets: input.compileTargets.filter((t) => KNOWN_TARGETS.includes(t)),
  };

  return {
    graph,
    graphJson: serializeGraph(graph),
    stubs,
    summary: {
      count: nodes.length,
      names: nodes.map((n) => n.title),
      relPaths: nodes.map((n) => n.filePath),
    },
  };
}
