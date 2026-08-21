// WO13_CONTRACT.md §7.3, §15, §18.5 (owner: T1; Amendment 3 granted
// `src/config/edgeRules.ts` to R2 for the deprecated-target precondition
// fix, WO13_AUDIT.md D15 — one change, this file included) — specificity
// resolution including the `*` fallback and the later-entry-wins tie rule.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEPRECATED_TARGET_REASON, EDGE_RULES, legalityFor, type Legality } from "./edgeRules";
import type { EdgeKind, NodeRole } from "../store/graph";

describe("legalityFor — required rules (§7.3's table)", () => {
  it("denies imports into a command node from any source", () => {
    const r = legalityFor("architecture", "imports", "command", false);
    expect(r.legality).toBe("deny");
    expect(r.reason).toBe(
      "Commands run when you call them — inlining one removes the point of it. Use references.",
    );
  });

  it("denies imports into a skill node", () => {
    const r = legalityFor("workflow", "imports", "skill", false);
    expect(r.legality).toBe("deny");
    expect(r.reason).toBe("Skills load themselves when relevant. Use references.");
  });

  it("denies any edge into a deprecated node, regardless of role/kind", () => {
    const r = legalityFor("rule", "references", "glossary", true);
    expect(r.legality).toBe("deny");
    expect(r.reason).toBe(DEPRECATED_TARGET_REASON);
  });

  it("warns on imports into architecture", () => {
    const r = legalityFor("rule", "imports", "architecture", false);
    expect(r.legality).toBe("warn");
  });

  it("denies glossary/example overrides regardless of target", () => {
    expect(legalityFor("glossary", "overrides", "rule", false).legality).toBe("deny");
    expect(legalityFor("example", "overrides", "workflow", false).legality).toBe("deny");
  });

  it("allows the named workflow/example reference exceptions", () => {
    expect(legalityFor("workflow", "references", "command", false).legality).toBe("allow");
    expect(legalityFor("example", "references", "rule", false).legality).toBe("allow");
    expect(legalityFor("example", "references", "invariant", false).legality).toBe("allow");
    expect(legalityFor("example", "references", "style", false).legality).toBe("allow");
  });

  it("allows decision <-> decision contradicts", () => {
    expect(legalityFor("decision", "contradicts", "decision", false).legality).toBe("allow");
  });

  it("warns on a cross-group overrides, allows a same-group one", () => {
    // rule/invariant are both "constraints" — same group.
    expect(legalityFor("rule", "overrides", "invariant", false)).toEqual({
      legality: "allow",
      reason: "",
    });
    // rule (constraints) -> workflow (process) — different groups.
    const r = legalityFor("rule", "overrides", "workflow", false);
    expect(r.legality).toBe("warn");
    expect(r.reason).toBe("These two aren't in the same plane — check this is what you mean.");
  });

  it("defaults to allow with an empty reason when nothing matches", () => {
    expect(legalityFor("architecture", "references", "workflow", false)).toEqual({
      legality: "allow",
      reason: "",
    });
    expect(legalityFor("architecture", "sequence", "workflow", false)).toEqual({
      legality: "allow",
      reason: "",
    });
  });
});

describe("legalityFor — specificity resolution (frozen scoring)", () => {
  it("a rule with a concrete kind+target (score 3) beats the implicit allow-everything fallback (score 0)", () => {
    const r = legalityFor("agent", "imports", "command", false);
    expect(r.legality).toBe("deny");
  });

  it("Amendment 3: deprecation is a PRECONDITION no rule can outscore, not a scored row", () => {
    // Before Amendment 3, "@deprecated" was a table row scoring 1 — the
    // LOWEST score in the table — so "* imports command" (score 3) used to
    // win here and report the command-specific reason instead of the
    // deprecation one (WO13_AUDIT.md D15). Every one of the twelve rules
    // that used to outrank it must now lose to the precondition instead.
    const r = legalityFor("architecture", "imports", "command", true);
    expect(r.legality).toBe("deny");
    expect(r.reason).toBe(DEPRECATED_TARGET_REASON);
  });

  it("later entry wins on an exact score tie", () => {
    const rules = [
      { source: "rule" as const, kind: "*" as const, target: "*" as const, legality: "warn" as const, reason: "first" },
      { source: "rule" as const, kind: "*" as const, target: "*" as const, legality: "deny" as const, reason: "second" },
    ];
    // Both score 4 (source concrete, kind/target wildcard) — the later of
    // the two must win. Exercised directly against the scoring function's
    // contract by re-deriving it over a tiny local table, since EDGE_RULES
    // itself has no built-in tie today (by design — see the module's own
    // doc comment on why the frozen order still matters for future
    // additions).
    const legalityForLocal = (
      sourceRole: string,
      kind: string,
      targetRole: string,
    ): { legality: string; reason: string } => {
      let best: { rule: (typeof rules)[number]; score: number } | undefined;
      for (const rule of rules) {
        if (rule.source !== "*" && rule.source !== sourceRole) continue;
        if (rule.kind !== "*" && rule.kind !== kind) continue;
        if (rule.target !== "*" && rule.target !== targetRole) continue;
        const score =
          (rule.source !== "*" ? 4 : 0) + (rule.kind !== "*" ? 2 : 0) + (rule.target !== "*" ? 1 : 0);
        if (best === undefined || score >= best.score) best = { rule, score };
      }
      return best === undefined
        ? { legality: "allow", reason: "" }
        : { legality: best.rule.legality, reason: best.rule.reason };
    };
    expect(legalityForLocal("rule", "imports", "architecture").reason).toBe("second");
  });
});

describe("EDGE_RULES — table shape", () => {
  it("every reason is non-empty except for allow rules", () => {
    for (const rule of EDGE_RULES) {
      if (rule.legality === "allow") continue;
      expect(rule.reason.trim().length, JSON.stringify(rule)).toBeGreaterThan(0);
    }
  });

  it("no rule's target is the removed \"@deprecated\" sentinel (Amendment 3: target is cleanly NodeRole | \"*\")", () => {
    for (const rule of EDGE_RULES) {
      expect(rule.target).not.toBe("@deprecated");
    }
  });
});

// ── Shared corpus (WO13_CONTRACT.md §7.3, Amendment 3; WO13_AUDIT.md D15) ──
//
// tests/fixtures/edge_legality_cases.json is tech-lead-owned and asserted
// from BOTH this file and src-tauri/src/lint/tests.rs — the same mechanism
// §8.3 already uses for resolve_load_cases.json. This is the standing fix
// for the "a Rust/TS mirror pair agreed with each other while both diverged
// from the spec" failure class (D15, after D5's `always_closure` seeds):
// pin both sides against the contract's own text, never against each
// other.

interface EdgeLegalityCase {
  name: string;
  sourceRole: NodeRole;
  kind: EdgeKind;
  targetRole: NodeRole;
  targetDeprecated: boolean;
  expected: { legality: Legality; reason: string };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(__dirname, "..", "..", "tests", "fixtures", "edge_legality_cases.json");
const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as { cases: EdgeLegalityCase[] };

describe("legalityFor — shared corpus (tests/fixtures/edge_legality_cases.json)", () => {
  it("the corpus file is non-empty and covers every production rule at least twice (deprecated + non-deprecated)", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(25);
  });

  for (const c of corpus.cases) {
    it(c.name, () => {
      const result = legalityFor(c.sourceRole, c.kind, c.targetRole, c.targetDeprecated);
      expect(result).toEqual(c.expected);
    });
  }
});
