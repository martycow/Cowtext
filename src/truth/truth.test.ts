// The drift gate's own gate (WO15 §6 D1.3).
//
// `scripts/truth.mjs` is the one script allowed to rewrite CLAUDE.md's truth
// block, AGENTS.md and `.agents/skills/**`. A bug in its regexes does not
// throw — it silently reports PASS on a stale repo, or silently rewrites a
// file it should not have touched. So every pure function in
// `scripts/truth.lib.mjs` is pinned here against inline fixtures: the shapes
// the real files actually have (trailing handler entry with no comma, CRLF,
// `**bold**` counts) plus the negative case for each detector, because a
// detector that never passes is as useless as one that never fires.
//
// The lib is `.mjs` on purpose: `truth.mjs` must run under bare `node` with
// no build step and no dependencies, long after any bundler is in the way.

import { describe, expect, it } from "vitest";
import {
  AGENTS_MD_READER_LINE,
  AGENTS_MD_TITLE,
  extractCompileTargetsRs,
  extractCompileTargetsTs,
  extractGraphVersionRs,
  extractGraphVersionTs,
  extractTsInvokeNames,
  findForbidden,
  findStaleNumbers,
  findStatusProseCounts,
  parseHandlerList,
  parseTruthBlock,
  renderAgentsMd,
  renderTruthBlock,
  replaceTruthBlock,
  TRUTH_ANCHOR_LINE,
  TRUTH_BEGIN,
  TRUTH_END,
} from "../../scripts/truth.lib.mjs";

const lines = (...xs: string[]): string => xs.join("\n");

// ── parseHandlerList ────────────────────────────────────────────────────

describe("parseHandlerList", () => {
  // The real `lib.rs` ends its list without a trailing comma, so a naive
  // `split(",")` that trusts separators drops the LAST command — which is
  // always the newest one, i.e. exactly the entry a drift gate exists to
  // catch.
  const libRs = lines(
    "        .invoke_handler(tauri::generate_handler![",
    "            project::scan_project,",
    "            project::read_graph,",
    "            // a comment that names project::not_a_command",
    "            agents::skills_materialize",
    "        ])",
    "        .build(tauri::generate_context!())",
  );

  it("reads every entry including a trailing one with no comma", () => {
    expect(parseHandlerList(libRs)).toEqual(["scan_project", "read_graph", "skills_materialize"]);
  });

  it("stops at the closing bracket, not at the first one it sees", () => {
    expect(parseHandlerList(libRs)).not.toContain("generate_context");
  });

  it("returns [] when there is no handler list at all", () => {
    expect(parseHandlerList("fn main() {}")).toEqual([]);
  });
});

// ── extractTsInvokeNames ────────────────────────────────────────────────

describe("extractTsInvokeNames", () => {
  it("reads plain and generic invokes, including a union type argument", () => {
    const src = lines(
      'export function scanProject(root: string) { return invoke<ProjectScan>("scan_project", { root }); }',
      'const raw = await invoke<string | null>("read_graph", { root });',
      'await invoke("write_graph", { root, json });',
    );
    expect(extractTsInvokeNames(src)).toEqual(["scan_project", "read_graph", "write_graph"]);
  });

  it("deduplicates repeated call sites, keeping first-appearance order", () => {
    const src = lines('invoke("read_md_file", a);', 'invoke("write_md_file", b);', 'invoke("read_md_file", c);');
    expect(extractTsInvokeNames(src)).toEqual(["read_md_file", "write_md_file"]);
  });

  it("ignores a name that is not a snake_case command", () => {
    expect(extractTsInvokeNames('invoke("NotACommand")')).toEqual([]);
  });
});

// ── version + compile targets ───────────────────────────────────────────

describe("graph version extraction", () => {
  it("reads the Rust const", () => {
    expect(extractGraphVersionRs("    pub const GRAPH_VERSION: u32 = 5;")).toBe(5);
  });

  it("reads the TS const and not the `typeof` reference below it", () => {
    const graphTs = lines("export const GRAPH_VERSION = 5;", "", "export interface BarnGraph {", "  version: typeof GRAPH_VERSION;");
    expect(extractGraphVersionTs(graphTs)).toBe(5);
  });

  it("is NaN — never 0 — when the const is gone", () => {
    expect(extractGraphVersionRs("// nothing here")).toBeNaN();
    expect(extractGraphVersionTs("// nothing here")).toBeNaN();
  });
});

describe("compile target extraction", () => {
  const projectRs = lines(
    '    #[serde(rename_all = "lowercase")]',
    "    pub enum CompileTarget {",
    "        Claude,",
    "        Agents, // off by default",
    "        Cursor,",
    "        Copilot,",
    "        Gemini,",
    "    }",
  );
  const graphTs = 'const COMPILE_TARGETS: readonly CompileTarget[] = ["claude", "agents", "cursor", "copilot", "gemini"];';

  it("lower-cases the Rust variants (serde rename_all = lowercase)", () => {
    expect(extractCompileTargetsRs(projectRs)).toEqual(["claude", "agents", "cursor", "copilot", "gemini"]);
  });

  it("reads the TS literal array through the type annotation's brackets", () => {
    expect(extractCompileTargetsTs(graphTs)).toEqual(["claude", "agents", "cursor", "copilot", "gemini"]);
  });

  it("agrees with itself — the whole point of T8", () => {
    expect(extractCompileTargetsRs(projectRs)).toEqual(extractCompileTargetsTs(graphTs));
  });
});

// ── renderAgentsMd ──────────────────────────────────────────────────────

describe("renderAgentsMd", () => {
  const claudeMd = lines(
    "# CLAUDE.md",
    "",
    "This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.",
    "",
    "# COWTEXT — desktop context-graph editor",
    "",
    "- Assemble expands a brief via headless `claude -p`.",
    "",
  );

  it("replaces exactly line 1 and line 3", () => {
    const out = renderAgentsMd(claudeMd).split("\n");
    expect(out[0]).toBe(AGENTS_MD_TITLE);
    expect(out[2]).toBe(AGENTS_MD_READER_LINE);
  });

  it("keeps line 2 blank and every line from 4 on byte-identical", () => {
    const before = claudeMd.split("\n");
    const after = renderAgentsMd(claudeMd).split("\n");
    expect(after[1]).toBe("");
    expect(after.length).toBe(before.length);
    expect(after.slice(3)).toEqual(before.slice(3));
  });

  it("never search-and-replaces `claude -p` into a tool that does not exist", () => {
    // Matrix §4: the allowlist is two lines. Blind substitution is the bug
    // this whole lane exists to delete.
    expect(renderAgentsMd(claudeMd)).toContain("headless `claude -p`");
    expect(findForbidden(renderAgentsMd(claudeMd))).toEqual([]);
  });

  it("preserves CRLF input as CRLF", () => {
    const crlf = claudeMd.replace(/\n/g, "\r\n");
    const out = renderAgentsMd(crlf);
    expect(out.startsWith(`${AGENTS_MD_TITLE}\r\n`)).toBe(true);
    expect(out).not.toContain("\n\n");
  });
});

// ── findStaleNumbers ────────────────────────────────────────────────────

describe("findStaleNumbers", () => {
  const live = { invoke: 78, rustTests: 800, vitestTests: 170, graphVersion: 5 };

  it("hits `invoke commands (76)` when the live list is 78", () => {
    const hits = findStaleNumbers("the invoke commands (76) are canon", live);
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].text).toBe("invoke commands (76)");
    expect(hits[0].message).toContain("says 76, live 78");
  });

  it("passes `invoke commands (78)`", () => {
    expect(findStaleNumbers("the invoke commands (78) are canon", live)).toEqual([]);
  });

  it("covers every count phrasing the repo actually uses", () => {
    // Every line is a real phrasing from a file T9 scans. Lines 3-9 are the
    // WO15 audit F5 set: a "g"-only scan walked past the capital-I headings
    // and all three `generate_handler!` forms while reporting PASS, which is
    // the one failure mode a drift gate cannot have.
    const text = lines(
      "74 invoke commands",
      "command list (75)",
      "## Invoke commands (76)",
      "| `src-tauri/src/lib.rs` | Builder chain, `generate_handler!` list (75) |",
      "`generate_handler!` command list (76)",
      "`generate_handler!` entries (75)",
      "the handler list has 75 entries",
      "the invoke handler now registers 75 handlers",
      "the invoke list: 75 registered commands",
      "3 Tauri invokes",
      "785 Rust tests",
      "163 frontend Vitest tests",
      "163 frontend tests",
      "graph schema **v4**",
    );
    const hits = findStaleNumbers(text, live);
    expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("accepts the same phrasings once the numbers are live", () => {
    const text = lines(
      "78 invoke commands",
      "command list (78)",
      "## Invoke commands (78)",
      "| `src-tauri/src/lib.rs` | Builder chain, `generate_handler!` list (78) |",
      "`generate_handler!` command list (78)",
      "`generate_handler!` entries (78)",
      "the handler list has 78 entries",
      "the invoke handler now registers 78 handlers",
      "the invoke list: 78 registered commands",
      "78 Tauri invokes",
      "800 Rust tests",
      "170 frontend Vitest tests",
      "170 frontend tests",
      "graph schema **v5**",
    );
    expect(findStaleNumbers(text, live)).toEqual([]);
  });

  it("is case-insensitive — the stale headings are `## Invoke commands (76)`", () => {
    // `docs/TERMINOLOGY.md:37` and the cowtext-terminology SKILL.md mirror.
    // Under the old "g" flag the capital I hid both from T9 forever.
    expect(findStaleNumbers("## Invoke commands (76)", live).length).toBe(1);
    expect(findStaleNumbers("## Invoke Commands (76)", live).length).toBe(1);
    expect(findStaleNumbers("## Invoke commands (78)", live)).toEqual([]);
  });

  it("reports one finding when two phrasings catch the same stale number", () => {
    // `` `generate_handler!` command list (76) `` answers to two patterns.
    // One wrong number on one line is one drift, not two.
    const hits = findStaleNumbers("`generate_handler!` command list (76)", live);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("says 76, live 78");
  });

  it("needs an invoke-shaped word within 40 characters of a bare count", () => {
    // Without the window, every "3 event handlers" in any UI note becomes a
    // finding — and a gate that cries wolf gets switched off.
    expect(findStaleNumbers("3 event handlers on the canvas", live)).toEqual([]);
    expect(findStaleNumbers(`invoke${" ".repeat(45)}75 handlers`, live)).toEqual([]);
    expect(findStaleNumbers("the invoke handler now registers 75 handlers", live).length).toBe(1);
  });

  it("never reads a year as a count", () => {
    const text = lines(
      "Live counts (generated 2026-08-22 by `scripts/truth.mjs`)",
      "**WO13 gates green 2026-08-21** — the invoke handler list changed that day",
      "Ports: 1420 Vite dev (strictPort), 4923 hooks server",
    );
    expect(findStaleNumbers(text, live)).toEqual([]);
  });

  it("ignores the truth block's own **bold** counts, live or not", () => {
    // The block is generated from the gates, so its numbers cannot be stale;
    // no pattern may reach inside `**…**`. `Vitest **276** tests` here
    // disagrees with live 170 on purpose, and must still be silent.
    const block = renderTruthBlock(
      {
        invoke: 78,
        rust: { total: 816, lib: 782, cli: 18, mcp: 16 },
        vitest: { tests: 276, files: 17 },
        graphVersion: 5,
        compileTargets: ["claude", "agents", "cursor", "copilot", "gemini"],
      },
      "2026-08-22",
    );
    expect(block).toContain("Vitest **276** tests");
    expect(findStaleNumbers(block, live)).toEqual([]);
  });

  it("skips a pattern whose live value is unknown rather than guessing", () => {
    // `--no-cargo` with no previous block: an unverifiable number must not
    // be reported as wrong.
    expect(findStaleNumbers("770 Rust tests", { ...live, rustTests: null })).toEqual([]);
  });

  it("reports 1-based line numbers", () => {
    const hits = findStaleNumbers(lines("clean", "clean", "command list (1)"), live);
    expect(hits[0].line).toBe(3);
  });
});

// ── findForbidden ───────────────────────────────────────────────────────

describe("findForbidden", () => {
  it("catches every blind-replacement string from the matrix", () => {
    const text = lines(
      "generate `AGENTS.md / AGENTS.md` from one source",
      "expand briefs via headless `Codex -p`",
      "writes hooks into .Codex/settings.json",
      "guidance to Codex (Codex.ai/code)",
    );
    expect(findForbidden(text).map((h) => h.text)).toEqual([
      "AGENTS.md / AGENTS.md",
      "Codex -p",
      ".Codex/",
      "Codex.ai/code",
    ]);
  });

  it("passes honest prose that merely mentions Codex", () => {
    expect(findForbidden("AGENTS.md is read by Codex CLI and 30+ other agents.")).toEqual([]);
  });

  it("reports each occurrence on the same line", () => {
    expect(findForbidden("Codex -p and again Codex -p").length).toBe(2);
  });
});

// ── the truth block ─────────────────────────────────────────────────────

describe("renderTruthBlock / parseTruthBlock", () => {
  const counts = {
    invoke: 78,
    rust: { total: 800, lib: 766, cli: 18, mcp: 16 },
    vitest: { tests: 170, files: 13 },
    graphVersion: 5,
    compileTargets: ["claude", "agents", "cursor", "copilot", "gemini"],
  };

  it("renders the markers and every live number", () => {
    const block = renderTruthBlock(counts, "2026-08-22");
    const out = block.split("\n");
    expect(out[0]).toBe(TRUTH_BEGIN);
    expect(out[2]).toBe(TRUTH_END);
    expect(out[1]).toContain("generated 2026-08-22");
    expect(out[1]).toContain("invoke **78**");
    expect(out[1]).toContain("Rust tests **800** (lib 766 · cli 18 · mcp 16)");
    expect(out[1]).toContain("Vitest **170** tests / **13** files");
    expect(out[1]).toContain("graph schema **v5**");
    expect(out[1]).toContain("compile targets claude, agents, cursor, copilot, gemini");
  });

  it("round-trips through parseTruthBlock", () => {
    const parsed = parseTruthBlock(renderTruthBlock(counts, "2026-08-22"));
    expect(parsed).not.toBeNull();
    expect(parsed?.invoke).toBe(78);
    expect(parsed?.rust).toEqual(counts.rust);
    expect(parsed?.vitest).toEqual(counts.vitest);
    expect(parsed?.graphVersion).toBe(5);
  });

  it("prints n/a rather than 0 when --no-cargo has nothing to carry", () => {
    const block = renderTruthBlock({ ...counts, rust: null }, "2026-08-22");
    expect(block).toContain("Rust tests **n/a** (lib n/a · cli n/a · mcp n/a)");
    expect(block).not.toContain("Rust tests **0**");
  });

  it("returns null for a file with no block", () => {
    expect(parseTruthBlock("# CLAUDE.md\n\nno block here")).toBeNull();
  });

  it("never emits a count pattern that T9 or T13 would then flag", () => {
    // The block is the ONE place counts live; if its own wording tripped the
    // detectors, `truth:write` would create the failure it exists to remove.
    const block = renderTruthBlock(counts, "2026-08-22");
    expect(findStaleNumbers(block, { invoke: 78, rustTests: 800, vitestTests: 170, graphVersion: 5 })).toEqual([]);
  });
});

describe("replaceTruthBlock", () => {
  const anchored = lines("# CLAUDE.md", "", "## Status", "", "Prose about the release.", "", TRUTH_ANCHOR_LINE, "");
  const block = lines(TRUTH_BEGIN, "Live counts: invoke **78**", TRUTH_END);

  it("inserts immediately before the anchor line when the markers are absent", () => {
    const out = replaceTruthBlock(anchored, block).split("\n");
    const anchorAt = out.indexOf(TRUTH_ANCHOR_LINE);
    expect(out.indexOf(TRUTH_END)).toBe(anchorAt - 2);
    expect(out[anchorAt - 1]).toBe("");
  });

  it("replaces an existing block in place, touching nothing else", () => {
    const once = replaceTruthBlock(anchored, block);
    const twice = replaceTruthBlock(once, lines(TRUTH_BEGIN, "Live counts: invoke **79**", TRUTH_END));
    expect(twice.split("\n").filter((l) => l === TRUTH_BEGIN).length).toBe(1);
    expect(twice).toContain("invoke **79**");
    expect(twice).not.toContain("invoke **78**");
    expect(twice).toContain("Prose about the release.");
    expect(twice.split("\n").length).toBe(once.split("\n").length);
  });

  it("is idempotent — writing the same block twice changes no byte", () => {
    const once = replaceTruthBlock(anchored, block);
    expect(replaceTruthBlock(once, block)).toBe(once);
  });

  it("appends at the end when even the anchor line is gone", () => {
    const out = replaceTruthBlock(lines("# CLAUDE.md", "", "body", "", ""), block);
    expect(out).toContain(TRUTH_BEGIN);
    expect(out.indexOf("body")).toBeLessThan(out.indexOf(TRUTH_BEGIN));
  });

  it("preserves CRLF input as CRLF", () => {
    const out = replaceTruthBlock(anchored.replace(/\n/g, "\r\n"), block);
    expect(out).toContain(`${TRUTH_BEGIN}\r\n`);
  });
});

// ── findStatusProseCounts ───────────────────────────────────────────────

describe("findStatusProseCounts", () => {
  const status = (...body: string[]): string =>
    lines("# CLAUDE.md", "", "## Docs & fleet", "", "the invoke commands (78) live here", "", "## Status", "", ...body);

  it("hits `Invoke **75→76**`", () => {
    const hits = findStatusProseCounts(status("Title screen redesign. Invoke **75→76**; all gates green."));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.text.toLowerCase().startsWith("invoke"))).toBe(true);
  });

  it("hits `785 Rust tests`", () => {
    const hits = findStatusProseCounts(status("**785 Rust tests** (751 lib + 18 CLI + 16 MCP)."));
    expect(hits.some((h) => h.text.includes("785 Rust tests"))).toBe(true);
  });

  it("hits a schema version and a frontend test count", () => {
    const hits = findStatusProseCounts(status("graph schema v4 to v5 with migration; 163 frontend tests."));
    expect(hits.some((h) => h.message.startsWith("schema version"))).toBe(true);
    expect(hits.some((h) => h.text.includes("163 frontend tests"))).toBe(true);
  });

  it("passes Status prose that carries no counts", () => {
    const clean = status(
      "**WO15 LANDED** — release truth plus the second UI round: generated AGENTS.md,",
      "a drift gate, and a golden-path manual. Gates green; the numbers live in the",
      "truth block below.",
      "",
      TRUTH_ANCHOR_LINE,
    );
    expect(findStatusProseCounts(clean)).toEqual([]);
  });

  it("ignores the truth block's own counts", () => {
    const withBlock = status(
      "Release truth landed; the numbers live below.",
      "",
      TRUTH_BEGIN,
      "Live counts: invoke **78** · Rust tests **800** · graph schema **v5**",
      TRUTH_END,
      "",
      TRUTH_ANCHOR_LINE,
    );
    expect(findStatusProseCounts(withBlock)).toEqual([]);
  });

  it("only reads the Status section, not the sections above it", () => {
    // `## Docs & fleet` says "invoke commands (78)" — true, T9's business,
    // and none of T13's.
    const hits = findStatusProseCounts(status("Clean prose.", "", TRUTH_ANCHOR_LINE));
    expect(hits).toEqual([]);
  });

  it("returns [] when there is no Status section", () => {
    expect(findStatusProseCounts("# CLAUDE.md\n\nno status section")).toEqual([]);
  });
});
