/**
 * truth.lib.mjs — the pure half of the repo drift gate (WO15 §6 D1.1).
 *
 * Everything here is a string-in / value-out function: no `fs`, no `process`,
 * no `child_process`. That is what makes `src/truth/truth.test.ts` able to
 * cover it with inline fixtures, and it is why `scripts/truth.mjs` keeps all
 * of its I/O (file reads, `npx vitest`, `cargo test … --list`, writes) on its
 * own side of the fence.
 *
 * Node >= 18, zero dependencies, ESM.
 *
 * A `Finding` is one drift hit:
 *   { line: 1-based line number, text: the matched substring, message: why }
 * The caller adds the file name.
 *
 * @typedef {{ line: number, text: string, message: string }} Finding
 * @typedef {{ total: number, lib: number, cli: number, mcp: number }} RustCounts
 * @typedef {{ tests: number, files: number }} VitestCounts
 * @typedef {{ invoke: number | null, rust: RustCounts | null,
 *             vitest: VitestCounts | null, graphVersion: number | null,
 *             compileTargets?: readonly string[] }} TruthCounts
 */

// ── AGENTS.md generation ────────────────────────────────────────────────

/** Line 1 of the generated AGENTS.md — half of the two-line allowlist. */
export const AGENTS_MD_TITLE = "# AGENTS.md";

/**
 * Line 3 of the generated AGENTS.md — the other half. Everything else is
 * byte-identical to CLAUDE.md on purpose: a Codex reader needs the same
 * facts, not a search-and-replaced version naming tools that do not exist
 * (`docs/design/PROVIDER_SUPPORT_MATRIX.md` §4).
 */
export const AGENTS_MD_READER_LINE =
  "This file provides guidance to Codex and any AGENTS.md-reading agent when working with code in this repository. " +
  "It is generated from CLAUDE.md by `scripts/truth.mjs` — edit CLAUDE.md, then run `npm run truth:write`.";

/**
 * CLAUDE.md → AGENTS.md. Line 1 and line 3 are replaced; every other line
 * (including the blank line 2) is copied byte for byte. The dominant line
 * ending of the input is preserved.
 *
 * @param {string} claudeMd
 * @returns {string}
 */
export function renderAgentsMd(claudeMd) {
  const eol = claudeMd.includes("\r\n") ? "\r\n" : "\n";
  const lines = claudeMd.replace(/\r\n/g, "\n").split("\n");
  if (lines.length >= 1) lines[0] = AGENTS_MD_TITLE;
  if (lines.length >= 3) lines[2] = AGENTS_MD_READER_LINE;
  return lines.join(eol);
}

// ── Rust ↔ TS extraction ────────────────────────────────────────────────

/**
 * The command names inside `tauri::generate_handler![ … ]`, in source order.
 * Tolerates a trailing entry with no comma, `//` comments and any module
 * path depth (`agents::skills_materialize` → `skills_materialize`).
 *
 * @param {string} libRs contents of `src-tauri/src/lib.rs`
 * @returns {string[]}
 */
export function parseHandlerList(libRs) {
  const marker = "generate_handler![";
  const start = libRs.indexOf(marker);
  if (start === -1) return [];
  const open = start + marker.length;
  let depth = 1;
  let i = open;
  for (; i < libRs.length; i++) {
    const c = libRs[i];
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return [];
  return libRs
    .slice(open, i)
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
    .split(",")
    .map((entry) => {
      const parts = entry.trim().split("::");
      return parts[parts.length - 1].trim();
    })
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

/**
 * Every `invoke("name")` / `invoke<T>("name")` command name in a TS/TSX
 * source, deduplicated, in first-appearance order.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function extractTsInvokeNames(src) {
  const re = /invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/g;
  /** @type {string[]} */
  const out = [];
  for (const m of src.matchAll(re)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * `pub const GRAPH_VERSION: u32 = N;` from `src-tauri/src/project.rs`.
 * `NaN` when absent — the caller reports that as a FAIL, never as 0.
 *
 * @param {string} projectRs
 * @returns {number}
 */
export function extractGraphVersionRs(projectRs) {
  const m = /\bGRAPH_VERSION\s*:\s*u32\s*=\s*(\d+)/.exec(projectRs);
  return m ? Number(m[1]) : NaN;
}

/**
 * `export const GRAPH_VERSION = N;` from `src/store/graph.ts`. `NaN` when
 * absent.
 *
 * @param {string} graphTs
 * @returns {number}
 */
export function extractGraphVersionTs(graphTs) {
  const m = /\bGRAPH_VERSION\s*=\s*(\d+)/.exec(graphTs);
  return m ? Number(m[1]) : NaN;
}

/**
 * Variants of `pub enum CompileTarget` (`src-tauri/src/project.rs`),
 * lower-cased — the enum is `#[serde(rename_all = "lowercase")]`, so the
 * lower-cased variant IS the wire value.
 *
 * @param {string} projectRs
 * @returns {string[]}
 */
export function extractCompileTargetsRs(projectRs) {
  const m = /pub enum CompileTarget\s*\{([^}]*)\}/.exec(projectRs);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))
    .map((v) => v.toLowerCase());
}

/**
 * The `COMPILE_TARGETS` string literal array from `src/store/graph.ts`.
 *
 * @param {string} graphTs
 * @returns {string[]}
 */
export function extractCompileTargetsTs(graphTs) {
  const m = /COMPILE_TARGETS\s*:[^=]*=\s*\[([^\]]*)\]/.exec(graphTs);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).filter((s) => s.length > 0);
}

// ── Drift detection ─────────────────────────────────────────────────────

/**
 * A bare `N handlers` / `N commands` is only about the invoke list when one
 * of these words sits within 40 characters in front of it. Without the
 * window, "3 event handlers" in any UI note becomes a drift finding — and a
 * gate that cries wolf gets switched off.
 *
 * The window is expressed inside the pattern (a non-capturing prefix) rather
 * than as a separate field, so a pattern stays exactly what it says it is:
 * one regex whose group 1 is the number.
 */
const INVOKE_NEAR = String.raw`\b(?:generate_handler|invoke|handler)[^\n]{0,40}?`;

/**
 * Count patterns that appear in prose across the repo, and which live number
 * each one must equal. Keys index the `live` object passed to
 * {@link findStaleNumbers}; a key whose live value is unknown is skipped
 * (an unverifiable number is not a finding).
 *
 * Every source is compiled case-INsensitively, because the two phrasings that
 * matter most are headings: `## Invoke commands (76)` (`docs/TERMINOLOGY.md`)
 * and its mirror in `.claude/skills/cowtext-terminology/SKILL.md`. Under `g`
 * alone the capital I made both invisible (WO15 audit F5).
 *
 * Group 1 is always the number. Anything else a pattern needs to match — the
 * backticks around `generate_handler!`, the invoke-context window — is a
 * non-capturing group.
 *
 * @type {readonly { key: "invoke" | "rustTests" | "vitestTests" | "graphVersion",
 *                   label: string, source: string }[]}
 */
export const STALE_PATTERNS = [
  { key: "invoke", label: "invoke commands", source: String.raw`(\d+)\s+invoke commands` },
  { key: "invoke", label: "invoke commands (n)", source: String.raw`invoke commands \((\d+)\)` },
  { key: "invoke", label: "command list (n)", source: String.raw`command list \((\d+)\)` },
  // `` `generate_handler!` list (75) `` and `` `generate_handler!` command
  // list (76) ``. `\W{0,2}` is the closing backtick plus the space after it —
  // a literal backtick cannot be written inside String.raw.
  {
    key: "invoke",
    label: "generate_handler! list (n)",
    source: String.raw`generate_handler!\W{0,2}(?:command\s+)?(?:list|entries)?\s*\((\d+)\)`,
  },
  { key: "invoke", label: "handler list (n)", source: String.raw`handler list(?:\s+has)?\s*\(?(\d+)\)?` },
  { key: "invoke", label: "handlers (n)", source: `${INVOKE_NEAR}${String.raw`(\d+)\s+handlers?\b`}` },
  { key: "invoke", label: "commands (n)", source: `${INVOKE_NEAR}${String.raw`(\d+)\s+(?:registered\s+)?commands\b`}` },
  { key: "invoke", label: "Tauri invokes", source: String.raw`(\d+)\s+Tauri invokes?` },
  { key: "rustTests", label: "Rust tests", source: String.raw`(\d+) Rust tests` },
  { key: "vitestTests", label: "Vitest tests", source: String.raw`(\d+)\s+(?:frontend\s+)?Vitest tests` },
  { key: "vitestTests", label: "frontend tests", source: String.raw`(\d+) frontend tests` },
  { key: "graphVersion", label: "graph schema", source: String.raw`schema\s+\*{0,2}v(\d+)` },
];

/**
 * Numbers written in prose that disagree with the live gates.
 *
 * Patterns overlap on purpose (`` `generate_handler!` command list (76) ``
 * answers to two of them), so one stale number is reported once per line:
 * the same `key` and the same wrong value on the same line is one drift, not
 * two, however many phrasings caught it. Different wrong values on one line
 * stay separate findings.
 *
 * @param {string} text
 * @param {{ invoke?: number | null, rustTests?: number | null,
 *           vitestTests?: number | null, graphVersion?: number | null }} live
 * @returns {Finding[]}
 */
export function findStaleNumbers(text, live) {
  /** @type {Finding[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((lineText, idx) => {
    for (const p of STALE_PATTERNS) {
      const expected = live[p.key];
      if (typeof expected !== "number" || !Number.isFinite(expected)) continue;
      for (const m of lineText.matchAll(new RegExp(p.source, "gi"))) {
        const found = Number(m[1]);
        if (found === expected) continue;
        const once = `${idx}|${p.key}|${found}`;
        if (seen.has(once)) continue;
        seen.add(once);
        out.push({
          line: idx + 1,
          text: m[0],
          message: `${p.label}: says ${found}, live ${expected}`,
        });
      }
    }
  });
  return out;
}

/**
 * Strings that only ever appear as blind-replacement damage in a mirrored
 * file (`docs/design/PROVIDER_SUPPORT_MATRIX.md` §3).
 */
export const FORBIDDEN_STRINGS = ["AGENTS.md / AGENTS.md", "Codex -p", ".Codex/", "Codex.ai/code"];

/**
 * @param {string} text
 * @returns {Finding[]}
 */
export function findForbidden(text) {
  /** @type {Finding[]} */
  const out = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((lineText, idx) => {
    for (const needle of FORBIDDEN_STRINGS) {
      let at = lineText.indexOf(needle);
      while (at !== -1) {
        out.push({ line: idx + 1, text: needle, message: `forbidden string ${JSON.stringify(needle)}` });
        at = lineText.indexOf(needle, at + needle.length);
      }
    }
  });
  return out;
}

// ── The CLAUDE.md truth block ───────────────────────────────────────────

export const TRUTH_BEGIN = "<!-- truth:begin -->";
export const TRUTH_END = "<!-- truth:end -->";

/**
 * Where the block is inserted when the markers are absent: immediately
 * before this line of CLAUDE.md.
 */
export const TRUTH_ANCHOR_LINE = "Update this line at the end of every session.";

const NA = "n/a";

/**
 * The three-line truth block. Unknown numbers render as `n/a` (that is the
 * `--no-cargo`-with-no-previous-block case), never as 0 or a guess.
 *
 * @param {TruthCounts} counts
 * @param {string} isoDate `YYYY-MM-DD`
 * @returns {string}
 */
export function renderTruthBlock(counts, isoDate) {
  const n = (/** @type {number | null | undefined} */ v) =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : NA;
  const rust = counts.rust ?? null;
  const vitest = counts.vitest ?? null;
  const targets = (counts.compileTargets ?? []).join(", ") || NA;
  const body =
    `Live counts (generated ${isoDate} by \`scripts/truth.mjs\` — do not edit by hand; ` +
    "run `npm run truth:write`): " +
    `invoke **${n(counts.invoke)}** · ` +
    `Rust tests **${rust ? n(rust.total) : NA}** ` +
    `(lib ${rust ? n(rust.lib) : NA} · cli ${rust ? n(rust.cli) : NA} · mcp ${rust ? n(rust.mcp) : NA}) · ` +
    `Vitest **${vitest ? n(vitest.tests) : NA}** tests / **${vitest ? n(vitest.files) : NA}** files · ` +
    `graph schema **v${n(counts.graphVersion)}** · ` +
    `compile targets ${targets} · ` +
    "release gate: `docs/tasks/ROADMAP.md` §Release gate + `docs/testing/GOLDEN_PATH_MANUAL.md`.";
  return [TRUTH_BEGIN, body, TRUTH_END].join("\n");
}

/**
 * Reads the numbers back out of an existing block — the carry-over source
 * for `--no-cargo` runs. `null` when there is no block.
 *
 * @param {string} claudeMd
 * @returns {TruthCounts | null}
 */
export function parseTruthBlock(claudeMd) {
  const norm = claudeMd.replace(/\r\n/g, "\n");
  const begin = norm.indexOf(TRUTH_BEGIN);
  const end = norm.indexOf(TRUTH_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const body = norm.slice(begin + TRUTH_BEGIN.length, end);
  const one = (/** @type {RegExp} */ re) => {
    const m = re.exec(body);
    return m ? Number(m[1]) : null;
  };
  const rustM = /Rust tests \*\*(\d+)\*\* \(lib (\d+) · cli (\d+) · mcp (\d+)\)/.exec(body);
  const vitestM = /Vitest \*\*(\d+)\*\* tests \/ \*\*(\d+)\*\* files/.exec(body);
  return {
    invoke: one(/invoke \*\*(\d+)\*\*/),
    rust: rustM
      ? { total: Number(rustM[1]), lib: Number(rustM[2]), cli: Number(rustM[3]), mcp: Number(rustM[4]) }
      : null,
    vitest: vitestM ? { tests: Number(vitestM[1]), files: Number(vitestM[2]) } : null,
    graphVersion: one(/graph schema \*\*v(\d+)\*\*/),
  };
}

/**
 * Replaces the marked block, or inserts it immediately before
 * {@link TRUTH_ANCHOR_LINE} (plus one blank separator line) when the markers
 * are absent. Falls back to appending at the end of the file when the anchor
 * is gone too. The input's dominant line ending is preserved.
 *
 * @param {string} claudeMd
 * @param {string} block
 * @returns {string}
 */
export function replaceTruthBlock(claudeMd, block) {
  const eol = claudeMd.includes("\r\n") ? "\r\n" : "\n";
  const lines = claudeMd.replace(/\r\n/g, "\n").split("\n");
  const blockLines = block.replace(/\r\n/g, "\n").split("\n");
  const begin = lines.findIndex((l) => l.trim() === TRUTH_BEGIN);
  const end = lines.findIndex((l) => l.trim() === TRUTH_END);
  if (begin !== -1 && end !== -1 && end >= begin) {
    return [...lines.slice(0, begin), ...blockLines, ...lines.slice(end + 1)].join(eol);
  }
  const anchor = lines.findIndex((l) => l.trim() === TRUTH_ANCHOR_LINE);
  if (anchor !== -1) {
    return [...lines.slice(0, anchor), ...blockLines, "", ...lines.slice(anchor)].join(eol);
  }
  const head = [...lines];
  while (head.length > 0 && head[head.length - 1].trim() === "") head.pop();
  return [...head, "", ...blockLines, ""].join(eol);
}

/**
 * Count-shaped prose in CLAUDE.md's `## Status` section. The truth block is
 * the ONE place counts are allowed to live; anything matching these in the
 * surrounding prose goes stale the moment a gate moves.
 *
 * @type {readonly { label: string, source: string }[]}
 */
export const STATUS_PROSE_PATTERNS = [
  {
    label: "test count",
    source: String.raw`\b\d+\s*(?:→\s*\d+\s*)?(?:Rust|Vitest|frontend)\s+(?:Vitest\s+)?tests?\b`,
  },
  { label: "invoke count", source: String.raw`\binvoke\b[^.\n]{0,12}\d+` },
  { label: "invoke count", source: String.raw`\b\d+\s+invokes?\b` },
  { label: "schema version", source: String.raw`\bschema\s+v\d+` },
];

/**
 * @param {string} claudeMd
 * @returns {Finding[]}
 */
export function findStatusProseCounts(claudeMd) {
  const lines = claudeMd.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+Status\b/.test(l));
  if (start === -1) return [];
  let stop = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      stop = i;
      break;
    }
  }
  /** @type {Finding[]} */
  const out = [];
  let inBlock = false;
  for (let i = start + 1; i < stop; i++) {
    const lineText = lines[i];
    if (lineText.trim() === TRUTH_BEGIN) {
      inBlock = true;
      continue;
    }
    if (lineText.trim() === TRUTH_END) {
      inBlock = false;
      continue;
    }
    if (inBlock) continue;
    for (const p of STATUS_PROSE_PATTERNS) {
      for (const m of lineText.matchAll(new RegExp(p.source, "gi"))) {
        out.push({ line: i + 1, text: m[0], message: `${p.label}: ${m[0].trim()}` });
      }
    }
  }
  return out;
}
