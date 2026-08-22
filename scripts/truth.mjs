#!/usr/bin/env node
/**
 * truth.mjs — the repo drift gate (WO15 §6 D1.2).
 *
 *   npm run truth                 # --check (default)
 *   npm run truth -- --no-cargo   # skip the three cargo probes (T6 → SKIP)
 *   npm run truth:write           # regenerate, then check
 *
 * `--no-cargo` is also honoured when npm swallows it as a config flag
 * (`npm run truth --no-cargo` sets `npm_config_cargo=false` and never
 * forwards the argument), so both spellings work.
 *
 * `--check` prints one table row per check (T1…T14) and exits 1 if any row
 * is FAIL. WARN and SKIP never fail the gate.
 *
 * `--write` does exactly three things, in this order, and nothing else:
 *   1. rewrite (or insert) the truth block in CLAUDE.md — the ONLY part of
 *      CLAUDE.md this script may touch; the prose around it belongs to the
 *      project-manager;
 *   2. write AGENTS.md from the updated CLAUDE.md (line 1 + line 3 are the
 *      whole allowlist — `docs/design/PROVIDER_SUPPORT_MATRIX.md` §3/§4);
 *   3. copy `.claude/skills/<x>/SKILL.md` → `.agents/skills/<x>/SKILL.md`.
 * Extra `.agents/skills/` directories are reported, never deleted.
 *
 * Node >= 18, zero dependencies. Windows: every child process is spawned
 * through the shell (`cmd /d /s /c`) so `npx`/`cargo` shims resolve; every
 * text comparison normalises CRLF first.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
  TRUTH_BEGIN,
  TRUTH_END,
} from "./truth.lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The one sentence every provider-facing surface carries verbatim. */
const PROVIDER_SUPPORT_SENTENCE =
  "Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.";

/** Markdown surfaces that must carry the literal (matrix §5). */
const SENTENCE_LITERAL_FILES = ["README.md", "CLAUDE.md", "docs/TERMINOLOGY.md", "src/resources/index.ts"];

/** UI surfaces that must import the constant (matrix §5). */
const SENTENCE_IMPORT_FILES = [
  "src/project/TitleScreen.tsx",
  "src/settings/SettingsModal.tsx",
  "src/orchestrator/OrchestratorView.tsx",
  "src/project/ProjectWizard.tsx",
];

// ── args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const NO_CARGO =
  argv.includes("--no-cargo") ||
  process.env.npm_config_cargo === "false" ||
  process.env.npm_config_cargo === "";

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write("usage: node scripts/truth.mjs [--check | --write] [--no-cargo]\n");
  process.exit(0);
}

// ── tiny fs helpers ─────────────────────────────────────────────────────

const readText = (/** @type {string} */ rel) => {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
};
const readBytes = (/** @type {string} */ rel) => {
  try {
    return readFileSync(join(ROOT, rel));
  } catch {
    return null;
  }
};
const lf = (/** @type {string} */ s) => s.replace(/\r\n/g, "\n");

/** Immediate subdirectory names of `rel`, sorted; `[]` when it does not exist. */
function subdirs(/** @type {string} */ rel) {
  try {
    return readdirSync(join(ROOT, rel), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Files directly inside `rel` matching `suffix`, sorted; `[]` when absent. */
function filesIn(/** @type {string} */ rel, /** @type {string} */ suffix) {
  try {
    return readdirSync(join(ROOT, rel), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(suffix))
      .map((e) => `${rel}/${e.name}`)
      .sort();
  } catch {
    return [];
  }
}

/** Recursively collect files under `rel` whose name ends with one of `exts`. */
function walk(/** @type {string} */ rel, /** @type {readonly string[]} */ exts, /** @type {string[]} */ acc = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, rel), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "target") continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(child, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(child);
  }
  return acc;
}

/** Run a command line through the platform shell; never throws. */
function sh(/** @type {string} */ command, /** @type {string} */ cwd) {
  const res = spawnSync(command, {
    cwd: join(ROOT, cwd),
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: typeof res.status === "number" ? res.status : -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

const tail = (/** @type {string} */ s, /** @type {number} */ n = 200) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? `…${t.slice(-n)}` : t;
};

// ── result table ────────────────────────────────────────────────────────

/**
 * `detail` is the one-line table summary (capped, so the table stays a table).
 * `details` is the uncapped list printed under the table for FAIL rows — the
 * list someone actually fixes from, because fixing three of twenty hits per
 * run turns one pass into seven.
 *
 * @type {{ id: string, status: "PASS" | "FAIL" | "WARN" | "SKIP", name: string,
 *          detail: string, details?: string[] }[]}
 */
const rows = [];
const check = (
  /** @type {string} */ id,
  /** @type {"PASS" | "FAIL" | "WARN" | "SKIP"} */ status,
  /** @type {string} */ name,
  /** @type {string} */ detail,
  /** @type {string[] | undefined} */ details,
) => rows.push({ id, status, name, detail, details });

const pad = (/** @type {string} */ s, /** @type {number} */ n) => s + " ".repeat(Math.max(0, n - s.length));

/** First `n` findings rendered as `file:line text` plus an overflow tag. */
function summarize(/** @type {{file: string, f: import("./truth.lib.mjs").Finding}[]} */ hits, n = 3) {
  const shown = hits.slice(0, n).map((h) => `${h.file}:${h.f.line} ${h.f.message}`);
  if (hits.length > n) shown.push(`(+${hits.length - n} more)`);
  return shown.join(" | ");
}

/**
 * Every finding, one per line, `file:line  <pattern key>  says N, live M`.
 * A `Finding.message` is `<key>: <what>`; the colon becomes the column gap so
 * the keys line up. Messages without one (T10's forbidden strings) pass
 * through unchanged.
 *
 * @param {{file: string, f: import("./truth.lib.mjs").Finding}[]} hits
 * @returns {string[]}
 */
function detailLines(hits) {
  const where = hits.map((h) => `${h.file}:${h.f.line}`);
  const w = Math.max(0, ...where.map((s) => s.length));
  return hits.map((h, i) => `  ${pad(where[i], w)}  ${h.f.message.replace(/^([^:]+): /, "$1  ")}`);
}

/**
 * The same two-column shape for checks whose findings are file paths rather
 * than line hits (T12).
 *
 * @param {readonly [string, string][]} pairs
 * @returns {string[]}
 */
function detailPairs(pairs) {
  const w = Math.max(0, ...pairs.map(([left]) => left.length));
  return pairs.map(([left, right]) => `  ${pad(left, w)}  ${right}`);
}

// ── live values ─────────────────────────────────────────────────────────

const libRs = readText("src-tauri/src/lib.rs") ?? "";
const projectRs = readText("src-tauri/src/project.rs") ?? "";
const graphTs = readText("src/store/graph.ts") ?? "";

const handlerNames = parseHandlerList(libRs);
const graphVersionRs = extractGraphVersionRs(projectRs);
const graphVersionTs = extractGraphVersionTs(graphTs);
const targetsRs = extractCompileTargetsRs(projectRs);
const targetsTs = extractCompileTargetsTs(graphTs);

const claudeMdBefore = readText("CLAUDE.md") ?? "";
const previousBlock = parseTruthBlock(claudeMdBefore);

/**
 * `npx vitest run --reporter=json` → `{ tests, files, suites, failed }`, or null.
 *
 * DEVIATION from WO15 §6 D1.2, which names `numTotalTestSuites` as the second
 * number. In Vitest's Jest-shaped report that field counts `describe` blocks
 * (79 today), not files (17) — but the truth block labels the number `files`,
 * and the contract's own baseline reads "163/163 (12 files)". Printing 79
 * under a "files" label would put a false number into the generated truth,
 * which is the one thing this script exists to prevent. `testResults` is one
 * entry per file in that schema, so that is what "files" reads. The suite
 * count is kept and printed beside it so the divergence stays visible.
 */
function runVitest() {
  const out = join(tmpdir(), `cowtext-truth-vitest-${process.pid}.json`);
  const res = sh(`npx vitest run --reporter=json --outputFile="${out}"`, ".");
  let raw = null;
  try {
    raw = readFileSync(out, "utf8");
  } catch {
    raw = null;
  }
  try {
    if (existsSync(out)) unlinkSync(out);
  } catch {
    /* a leftover temp file is not a gate failure */
  }
  if (raw === null) return { counts: null, error: tail(res.stderr || res.stdout) || `exit ${res.code}` };
  try {
    const j = JSON.parse(raw);
    return {
      counts: {
        tests: Number(j.numTotalTests ?? 0),
        files: Array.isArray(j.testResults) ? j.testResults.length : 0,
        suites: Number(j.numTotalTestSuites ?? 0),
        failed: Number(j.numFailedTests ?? 0),
      },
      error: null,
    };
  } catch (e) {
    return { counts: null, error: `unparseable JSON report (${String(e)})` };
  }
}

/** One `cargo test <sel> -- --list` run → number of `…: test` lines. */
function cargoListCount(/** @type {string} */ selector) {
  const res = sh(`cargo test ${selector} -- --list`, "src-tauri");
  if (res.code !== 0) return { count: null, error: tail(res.stderr || res.stdout) || `exit ${res.code}` };
  const count = lf(res.stdout)
    .split("\n")
    .filter((l) => /: test$/.test(l.trim())).length;
  return { count, error: null };
}

const vitestRun = runVitest();
const vitestCounts = vitestRun.counts;

/** @type {{ total: number, lib: number, cli: number, mcp: number } | null} */
let rustCounts = null;
/** @type {string | null} */
let rustError = null;
if (!NO_CARGO) {
  const l = cargoListCount("--lib");
  const c = cargoListCount("--bin cowtext-cli");
  const m = cargoListCount("--bin cowtext-mcp");
  if (l.count === null || c.count === null || m.count === null) {
    rustError = l.error ?? c.error ?? m.error;
  } else {
    rustCounts = { total: l.count + c.count + m.count, lib: l.count, cli: c.count, mcp: m.count };
  }
}

/** T6 numbers when we have them, else the committed block's (T9's rule). */
const rustForTruth = rustCounts ?? previousBlock?.rust ?? null;
const vitestForTruth = vitestCounts ? { tests: vitestCounts.tests, files: vitestCounts.files } : (previousBlock?.vitest ?? null);

// ── --write ─────────────────────────────────────────────────────────────

/** @type {string[]} */
const written = [];

if (WRITE) {
  const isoDate = new Date().toISOString().slice(0, 10);
  const block = renderTruthBlock(
    {
      invoke: handlerNames.length > 0 ? handlerNames.length : null,
      rust: rustForTruth,
      vitest: vitestForTruth,
      graphVersion: Number.isFinite(graphVersionRs) ? graphVersionRs : null,
      compileTargets: targetsRs,
    },
    isoDate,
  );
  const updated = replaceTruthBlock(claudeMdBefore, block);
  if (updated !== claudeMdBefore) {
    writeFileSync(join(ROOT, "CLAUDE.md"), updated, "utf8");
    written.push("CLAUDE.md");
  }

  const agents = renderAgentsMd(readText("CLAUDE.md") ?? updated);
  if (readText("AGENTS.md") !== agents) {
    writeFileSync(join(ROOT, "AGENTS.md"), agents, "utf8");
    written.push("AGENTS.md");
  }

  for (const dir of subdirs(".claude/skills")) {
    const src = readBytes(`.claude/skills/${dir}/SKILL.md`);
    if (src === null) continue;
    const destRel = `.agents/skills/${dir}/SKILL.md`;
    const dest = readBytes(destRel);
    if (dest !== null && dest.equals(src)) continue;
    mkdirSync(join(ROOT, ".agents", "skills", dir), { recursive: true });
    writeFileSync(join(ROOT, destRel), src);
    written.push(destRel);
  }
}

// ── the file set T9 / T10 scan ──────────────────────────────────────────

const truthFiles = [
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "docs/TERMINOLOGY.md",
  "docs/TERMINOLOGY_REFERENCE.md",
  ...subdirs(".claude/skills").map((d) => `.claude/skills/${d}/SKILL.md`),
  ...subdirs(".agents/skills").map((d) => `.agents/skills/${d}/SKILL.md`),
  ...filesIn(".claude/agents", ".md"),
].filter((rel) => existsSync(join(ROOT, rel)));

// ── T1 — AGENTS.md is the render of CLAUDE.md ───────────────────────────

{
  const claudeMd = readText("CLAUDE.md");
  const agentsMd = readText("AGENTS.md");
  if (claudeMd === null) check("T1", "FAIL", "AGENTS.md == render(CLAUDE.md)", "CLAUDE.md is missing");
  else if (agentsMd === null)
    check("T1", "FAIL", "AGENTS.md == render(CLAUDE.md)", "AGENTS.md is missing — run `npm run truth:write`");
  else {
    const want = lf(renderAgentsMd(claudeMd)).split("\n");
    const got = lf(agentsMd).split("\n");
    let diff = -1;
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      if (want[i] !== got[i]) {
        diff = i + 1;
        break;
      }
    }
    if (diff === -1) check("T1", "PASS", "AGENTS.md == render(CLAUDE.md)", `${got.length} lines identical`);
    else
      check(
        "T1",
        "FAIL",
        "AGENTS.md == render(CLAUDE.md)",
        `first difference at line ${diff}: want ${JSON.stringify((want[diff - 1] ?? "").slice(0, 60))}, got ${JSON.stringify((got[diff - 1] ?? "").slice(0, 60))}`,
      );
  }
}

// ── T2 — .agents/skills mirrors .claude/skills byte for byte ────────────

{
  const source = subdirs(".claude/skills");
  const mirror = subdirs(".agents/skills");
  /** @type {string[]} */
  const bad = [];
  for (const dir of source) {
    const a = readBytes(`.claude/skills/${dir}/SKILL.md`);
    if (a === null) continue;
    const b = readBytes(`.agents/skills/${dir}/SKILL.md`);
    if (b === null) bad.push(`${dir} (missing)`);
    else if (!b.equals(a)) bad.push(`${dir} (differs)`);
  }
  const extra = mirror.filter((d) => !source.includes(d));
  if (bad.length > 0)
    check("T2", "FAIL", ".agents/skills byte mirrors", `${bad.join(", ")} — run \`npm run truth:write\``);
  else if (extra.length > 0)
    check("T2", "WARN", ".agents/skills byte mirrors", `${source.length} mirrored; orphan dirs: ${extra.join(", ")}`);
  else check("T2", "PASS", ".agents/skills byte mirrors", `${source.length} skills identical`);
}

// ── T3 — invoke count from generate_handler! ────────────────────────────

{
  const dupes = handlerNames.filter((n, i) => handlerNames.indexOf(n) !== i);
  if (handlerNames.length === 0) check("T3", "FAIL", "generate_handler! invoke count", "could not parse lib.rs");
  else if (dupes.length > 0)
    check("T3", "FAIL", "generate_handler! invoke count", `duplicate entries: ${[...new Set(dupes)].join(", ")}`);
  else check("T3", "PASS", "generate_handler! invoke count", `${handlerNames.length} commands`);
}

// ── T4 — every TS invoke name is a registered handler ───────────────────

{
  /** @type {Map<string, string>} */
  const callers = new Map();
  for (const rel of walk("src", [".ts", ".tsx"])) {
    const src = readText(rel);
    if (src === null) continue;
    for (const name of extractTsInvokeNames(src)) if (!callers.has(name)) callers.set(name, rel);
  }
  const unknown = [...callers.keys()].filter((n) => !handlerNames.includes(n)).sort();
  const uncalled = handlerNames.filter((n) => !callers.has(n)).sort();
  if (unknown.length > 0)
    check(
      "T4",
      "FAIL",
      "TS invoke names ⊂ handler list",
      `${unknown.length} unregistered: ${unknown.map((n) => `${n} (${callers.get(n)})`).join(", ")}`,
    );
  else if (uncalled.length > 0)
    check("T4", "WARN", "TS invoke names ⊂ handler list", `${callers.size} called; no TS caller: ${uncalled.join(", ")}`);
  else check("T4", "PASS", "TS invoke names ⊂ handler list", `${callers.size} call sites, all registered`);
}

// ── T5 — Vitest counts ──────────────────────────────────────────────────

if (vitestCounts === null) check("T5", "FAIL", "Vitest run", `no JSON report — ${vitestRun.error}`);
else if (vitestCounts.failed > 0)
  check("T5", "FAIL", "Vitest run", `${vitestCounts.failed} failing of ${vitestCounts.tests} tests in ${vitestCounts.files} files`);
else
  check(
    "T5",
    "PASS",
    "Vitest run",
    `${vitestCounts.tests} tests / ${vitestCounts.files} files (${vitestCounts.suites} suites)`,
  );

// ── T6 — Rust test counts ───────────────────────────────────────────────

if (NO_CARGO)
  check(
    "T6",
    "SKIP",
    "cargo test --list counts",
    previousBlock?.rust ? `--no-cargo; carrying ${previousBlock.rust.total} from the truth block` : "--no-cargo",
  );
else if (rustCounts === null) check("T6", "FAIL", "cargo test --list counts", rustError ?? "cargo failed");
else
  check(
    "T6",
    "PASS",
    "cargo test --list counts",
    `${rustCounts.total} (lib ${rustCounts.lib} · cli ${rustCounts.cli} · mcp ${rustCounts.mcp})`,
  );

// ── T7 — GRAPH_VERSION Rust == TS ───────────────────────────────────────

if (!Number.isFinite(graphVersionRs) || !Number.isFinite(graphVersionTs))
  check("T7", "FAIL", "GRAPH_VERSION Rust == TS", `rust=${graphVersionRs}, ts=${graphVersionTs}`);
else if (graphVersionRs !== graphVersionTs)
  check("T7", "FAIL", "GRAPH_VERSION Rust == TS", `rust=${graphVersionRs}, ts=${graphVersionTs}`);
else check("T7", "PASS", "GRAPH_VERSION Rust == TS", `v${graphVersionRs}`);

// ── T8 — compile targets Rust == TS ─────────────────────────────────────

{
  const a = [...targetsRs].sort();
  const b = [...targetsTs].sort();
  if (a.length === 0 || b.length === 0)
    check("T8", "FAIL", "compile targets Rust == TS", `rust=[${a.join(",")}], ts=[${b.join(",")}]`);
  else if (a.join(",") !== b.join(","))
    check("T8", "FAIL", "compile targets Rust == TS", `rust=[${a.join(",")}] ts=[${b.join(",")}]`);
  else check("T8", "PASS", "compile targets Rust == TS", targetsRs.join(", "));
}

// ── T9 — stale numbers in prose ─────────────────────────────────────────

{
  const live = {
    invoke: handlerNames.length > 0 ? handlerNames.length : null,
    rustTests: rustForTruth ? rustForTruth.total : null,
    vitestTests: vitestForTruth ? vitestForTruth.tests : null,
    graphVersion: Number.isFinite(graphVersionRs) ? graphVersionRs : null,
  };
  /** @type {{file: string, f: import("./truth.lib.mjs").Finding}[]} */
  const hits = [];
  for (const rel of truthFiles) {
    const text = readText(rel);
    if (text === null) continue;
    for (const f of findStaleNumbers(text, live)) hits.push({ file: rel, f });
  }
  const known = Object.entries(live)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (hits.length > 0) check("T9", "FAIL", "stale counts in prose", summarize(hits), detailLines(hits));
  else check("T9", "PASS", "stale counts in prose", `${truthFiles.length} files clean (${known})`);
}

// ── T10 — forbidden strings ─────────────────────────────────────────────

{
  /** @type {{file: string, f: import("./truth.lib.mjs").Finding}[]} */
  const hits = [];
  for (const rel of truthFiles) {
    const text = readText(rel);
    if (text === null) continue;
    for (const f of findForbidden(text)) hits.push({ file: rel, f });
  }
  if (hits.length > 0) check("T10", "FAIL", "forbidden mirror strings", summarize(hits), detailLines(hits));
  else check("T10", "PASS", "forbidden mirror strings", `${truthFiles.length} files clean`);
}

// ── T11 — MCP server binaries the configs point at ──────────────────────

{
  /** @type {{ where: string, path: string }[]} */
  const commands = [];
  const mcpJson = readText(".mcp.json");
  if (mcpJson !== null) {
    try {
      const j = JSON.parse(mcpJson);
      for (const [name, server] of Object.entries(j.mcpServers ?? {})) {
        const cmd = /** @type {{ command?: unknown }} */ (server).command;
        if (typeof cmd === "string") commands.push({ where: `.mcp.json:${name}`, path: cmd });
      }
    } catch {
      commands.push({ where: ".mcp.json", path: "" });
    }
  }
  const codexToml = readText(".codex/config.toml");
  if (codexToml !== null) {
    for (const m of lf(codexToml).matchAll(/^\s*command\s*=\s*['"]([^'"]+)['"]/gm)) {
      commands.push({ where: ".codex/config.toml", path: m[1] });
    }
  }
  const missing = commands.filter((c) => c.path === "" || !existsSync(c.path));
  if (commands.length === 0) check("T11", "WARN", "MCP command paths exist", "no `command` entry found");
  else if (missing.length > 0)
    check(
      "T11",
      "WARN",
      "MCP command paths exist",
      `${missing.map((c) => c.where).join(", ")} absent — build with \`cargo build --release --bin cowtext-mcp\` (from src-tauri/)`,
    );
  else check("T11", "PASS", "MCP command paths exist", `${commands.length} present (dev-only, D-8)`);
}

// ── T12 — the provider support sentence ─────────────────────────────────

{
  const missingLiteral = SENTENCE_LITERAL_FILES.filter((rel) => !(readText(rel) ?? "").includes(PROVIDER_SUPPORT_SENTENCE));
  const missingImport = SENTENCE_IMPORT_FILES.filter((rel) => !(readText(rel) ?? "").includes("PROVIDER_SUPPORT_SENTENCE"));
  if (missingLiteral.length > 0 || missingImport.length > 0) {
    const parts = [];
    if (missingLiteral.length > 0) parts.push(`literal missing: ${missingLiteral.join(", ")}`);
    if (missingImport.length > 0) parts.push(`constant not used: ${missingImport.join(", ")}`);
    check(
      "T12",
      "FAIL",
      "PROVIDER_SUPPORT_SENTENCE",
      parts.join(" | "),
      detailPairs([
        ...missingLiteral.map((rel) => /** @type {[string, string]} */ ([rel, "sentence literal missing"])),
        ...missingImport.map(
          (rel) => /** @type {[string, string]} */ ([rel, "PROVIDER_SUPPORT_SENTENCE not imported"]),
        ),
      ]),
    );
  } else
    check(
      "T12",
      "PASS",
      "PROVIDER_SUPPORT_SENTENCE",
      `${SENTENCE_LITERAL_FILES.length} literals + ${SENTENCE_IMPORT_FILES.length} importers`,
    );
}

// ── T13 — counts in CLAUDE.md Status prose ──────────────────────────────

{
  const claudeMd = readText("CLAUDE.md") ?? "";
  const hits = findStatusProseCounts(claudeMd).map((f) => ({ file: "CLAUDE.md", f }));
  if (hits.length > 0)
    check("T13", "FAIL", "no counts in Status prose", `${hits.length} hit(s): ${summarize(hits)}`, detailLines(hits));
  else check("T13", "PASS", "no counts in Status prose", "the truth block is the only source");
}

// ── T14 — truth markers ─────────────────────────────────────────────────

{
  const claudeMd = readText("CLAUDE.md") ?? "";
  const has = claudeMd.includes(TRUTH_BEGIN) && claudeMd.includes(TRUTH_END);
  if (has) check("T14", "PASS", "truth markers in CLAUDE.md", `${TRUTH_BEGIN} / ${TRUTH_END}`);
  else check("T14", "FAIL", "truth markers in CLAUDE.md", "absent — run `npm run truth:write`");
}

// ── report ──────────────────────────────────────────────────────────────

const width = (/** @type {(r: (typeof rows)[number]) => string} */ get, /** @type {number} */ min) =>
  Math.max(min, ...rows.map((r) => get(r).length));
const wId = width((r) => r.id, 2);
const wStatus = width((r) => r.status, 6);
const wName = width((r) => r.name, 5);

const out = [];
out.push(`cowtext truth — ${WRITE ? "write" : "check"}${NO_CARGO ? " --no-cargo" : ""}`);
if (WRITE) out.push(written.length > 0 ? `wrote: ${written.join(", ")}` : "wrote: nothing (already current)");
out.push("");
out.push(`${pad("ID", wId)}  ${pad("STATUS", wStatus)}  ${pad("CHECK", wName)}  DETAIL`);
out.push(`${"-".repeat(wId)}  ${"-".repeat(wStatus)}  ${"-".repeat(wName)}  ${"-".repeat(6)}`);
for (const r of rows) out.push(`${pad(r.id, wId)}  ${pad(r.status, wStatus)}  ${pad(r.name, wName)}  ${r.detail}`);

const tally = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
for (const r of rows) tally[r.status] += 1;
out.push("");
out.push(`${tally.PASS} pass · ${tally.FAIL} fail · ${tally.WARN} warn · ${tally.SKIP} skip`);

// Every hit behind every FAIL, uncapped, appended after the table so the
// table itself is unchanged. One pass over this list clears the row.
const detailed = rows.filter((r) => r.status === "FAIL" && (r.details?.length ?? 0) > 0);
if (detailed.length > 0) {
  out.push("");
  out.push("FAIL details — every hit, no cap:");
  for (const r of detailed) {
    out.push("");
    out.push(`${r.id}  ${r.name}  (${(r.details ?? []).length})`);
    for (const line of r.details ?? []) out.push(line);
  }
}

process.stdout.write(`${out.join("\n")}\n`);

process.exit(tally.FAIL > 0 ? 1 : 0);
