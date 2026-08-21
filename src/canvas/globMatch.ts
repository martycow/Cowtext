// Live glob-match count for guard inputs (fix-round, tester finding #5;
// edge spec Block E2: "so the user can tell a typo from a working
// pattern"). Shared between `KindPicker.tsx`'s draw-time guard field (this
// lane) and the Inspector's `GuardEditor` (U4, `src/inspector/Inspector.tsx`
// — imports this module rather than writing a second matcher, per the
// fix-round instruction: two glob matchers that can disagree is worse than
// none).
//
// ── Two honesty notes, both load-bearing, neither hidden in a footnote ──
//
// 1. THERE IS NO RUST GLOB MATCHER TO MIRROR. `is_glob_condition`
//    (project.rs) only classifies a condition string AS a glob (no
//    whitespace + at least one of `* ? [ /`) — it never matches it against a
//    file. `clean_glob_dir` (compile.rs) only strips a `/**` suffix to name
//    a directory for nested-AGENTS.md grouping — also not a matcher.
//    `emit_cursor` writes the glob string VERBATIM into `.cursor/rules`
//    frontmatter (`globs: "src/net/**"`) for Cursor's own engine to
//    interpret; Cowtext's compiler never evaluates it. So "match compile.rs's
//    semantics" has no target to hit — this is a best-effort STANDARD glob
//    interpretation (the `*`/`?`-within-a-segment, `**`-across-segments,
//    `[...]`-class convention most glob-consuming tools share), not a
//    verified mirror of anything. `GlobMatchResult` and every UI that reads
//    it must present the count as approximate, not authoritative.
//
// 2. THE CANDIDATE FILE LIST IS .md-ONLY. `useProjectStore.files` comes from
//    `scan_project` (project.rs), which only walks `.md` files — that is
//    the only thing Cowtext tracks. A guard glob like `src/net/**` (the
//    canvas's own placeholder text, KindPicker.tsx) is written for SOURCE
//    files, which this scan cannot see at all. The count below is honestly
//    "N of the M .md files Cowtext tracks", which will read near-zero for
//    the common source-glob case — not because the pattern is wrong, but
//    because the scan it's checked against is the wrong population for that
//    case. `scanned` is returned alongside `count` for exactly this reason:
//    render "N of M tracked files", never a bare "N files", so the number
//    cannot be read as project-wide. Flagged to tech-lead/coordinator as a
//    real product gap (the fix is a broader scan or a new Rust command,
//    both out of this fix round's "no new invoke" bound) rather than
//    silently worked around.

import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../store/project";

export interface GlobMatchResult {
  /** Distinct files matched by at least one pattern, deduped across
   *  patterns (a file matching two of the supplied globs still counts once). */
  count: number;
  /** How many files this was computed against — always the `.md` scan's
   *  size (see note 2 above). Render as "N of `scanned`", never bare `N`. */
  scanned: number;
  /** True when no usable pattern was supplied (empty input, or every line
   *  blank) — `count` is 0 but MEANS NOTHING; render a neutral "type a
   *  pattern" state instead of "matches 0 files". */
  invalid: boolean;
}

const EMPTY_RESULT: GlobMatchResult = { count: 0, scanned: 0, invalid: true };

/** Regex metacharacters that are NOT also glob syntax — escaped literally.
 *  `*`, `?`, `[`, `]` are handled by the compiler below and never reach
 *  this table. */
const RESERVED = /[.+^${}()|\\]/g;

/**
 * Compile one glob pattern to a fully-anchored `RegExp` (matches the WHOLE
 * candidate path, not a substring). Supported subset — the common one
 * every glob-consuming tool agrees on, nothing exotic:
 *   `*`   — zero or more characters, never crossing `/`
 *   `**`  — zero or more characters, INCLUDING `/` (any depth);
 *           a `**` immediately followed by a path separator specifically
 *           collapses to "zero or more whole segments" so a leading
 *           double-star segment matches a root-level `x.md` too, not just
 *           a nested one (NOTE: avoid writing double-star-slash literally
 *           inside this block comment — it prematurely closes it, which is
 *           exactly the bug this note replaced)
 *   `?`   — exactly one character, never `/`
 *   `[..]`— a character class, `[!..]`/`[^..]` negated, passed through
 *           mostly verbatim (no brace expansion, no extglob — out of scope
 *           for an approximate, best-effort matcher)
 * Not memoized across calls — `countGlobMatches` compiles each pattern once
 * per invocation and reuses it across every candidate file, which is the
 * only reuse that matters (typing is the slow part, not this).
 */
function compileGlob(pattern: string): RegExp {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      let cls = "[";
      if (pattern[j] === "!" || pattern[j] === "^") {
        cls += "^";
        j += 1;
      }
      while (j < pattern.length && pattern[j] !== "]") {
        cls += pattern[j] === "\\" ? "\\\\" : pattern[j];
        j += 1;
      }
      cls += "]";
      out += cls;
      i = j + 1; // skip the closing ']' (or run past the end if unterminated)
      continue;
    }
    out += c.replace(RESERVED, "\\$&");
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/** Does one glob pattern match one project-relative path? Case-sensitive
 *  (matches typical glob-tool defaults, and git/Cursor globs are
 *  case-sensitive) — no normalization beyond what's already in `relPath`. */
export function matchesGlob(pattern: string, relPath: string): boolean {
  if (pattern.trim() === "") return false;
  return compileGlob(pattern).test(relPath);
}

/** Splits a textarea/single-line guard input into individual patterns —
 *  one per line (Inspector's `GuardEditor` convention, `Inspector.tsx`'s
 *  `globsText.split("\n")`), trimmed, blanks dropped. A single-line input
 *  with no newlines is just a one-element list, so this also serves
 *  KindPicker's free-text field unchanged. */
export function splitGlobPatterns(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The pure computation — no React, no store — so it is trivially unit
 *  testable and so the Inspector can call it directly if a debounced hook
 *  doesn't fit its render shape. */
export function countGlobMatches(
  patterns: string | readonly string[],
  files: readonly { relPath: string }[],
): GlobMatchResult {
  const list = typeof patterns === "string" ? splitGlobPatterns(patterns) : patterns.filter((p) => p.trim() !== "");
  if (list.length === 0) return { count: 0, scanned: files.length, invalid: true };
  const compiled = list.map(compileGlob);
  let count = 0;
  for (const f of files) {
    if (compiled.some((re) => re.test(f.relPath))) count += 1;
  }
  return { count, scanned: files.length, invalid: false };
}

/**
 * Live match count against the project's tracked `.md` files, debounced so
 * a fast typist doesn't recompile a regex set on every keystroke. Debounces
 * the PATTERN TEXT (a primitive, stable across renders when unchanged) —
 * callers pass their own draft string (KindPicker's free-text `condition`,
 * or the Inspector's `globsText`), not a fresh array literal, so the
 * `useEffect` below only ever re-fires on a real content change.
 */
export function useGlobMatchCount(patternsText: string, debounceMs = 150): GlobMatchResult {
  const files = useProjectStore((s) => s.files);
  const [debounced, setDebounced] = useState(patternsText);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(patternsText), debounceMs);
    return () => clearTimeout(t);
  }, [patternsText, debounceMs]);
  return useMemo(() => countGlobMatches(debounced, files), [debounced, files]);
}

// Re-exported only so a caller that truly has nothing typed yet can render
// the SAME neutral shape `useGlobMatchCount` returns before its debounce
// timer ever fires, instead of hand-rolling `{ count: 0, scanned: 0,
// invalid: true }` at each call site.
export { EMPTY_RESULT as EMPTY_GLOB_MATCH_RESULT };
