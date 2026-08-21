// The edge-legality matrix (WO13_CONTRACT.md §7.3, lane T1; Amendment 3
// (2026-08-21) granted `src/config/edgeRules.ts` to R2 for one change — see
// below) — the ONE definition the graph store's `addEdge`/`updateEdge`
// actions enforce (registered via `registerEdgeLegality`,
// `src/store/graph.ts`'s CLOSED-after-Stage-0 registration slot — see that
// file's doc comment above the slot for why a static import can't reach
// it), and U2's canvas reads the same `legalityFor` for draw-time feedback
// (the drop target dims and the `reason` appears near the cursor BEFORE the
// drop, per E4).
//
// `deny` blocks edge creation outright at `addEdge`/`updateEdge` — the one
// chokepoint every UI code path (paste, undo/redo restoring a fresh add,
// the right-click kind switcher) goes through. It does NOT prevent a
// denied edge from existing in a LOADED graph: `preset_apply` and
// `import_apply` are Rust commands that write `graph.json` directly and
// re-enter the store only through `loadGraph` → `migrateGraph`, which
// applies no legality check, and undo/redo can restore a whole snapshot
// containing an edge that became denied after its target was deprecated
// (Amendment 3 corrects §7.3's earlier, false claim that those three paths
// were also covered by `addEdge`). Those paths are covered by DETECTION
// instead: `src-tauri/src/lint.rs`'s `edge-legality-warning` fires at
// `Severity::Error` for a `deny` result (lane R2), carrying this rule's
// `reason` VERBATIM. `warn` creates the edge and files the same lint check
// at `Severity::Warning` — never a blocking dialog either way.
//
// AMENDMENT 3 (WO13_AUDIT.md D15): the deprecated-target `deny` is a
// PRECONDITION evaluated before any scoring, not a scored table row. As
// originally frozen, `{ source: "*", kind: "*", target: "@deprecated" }`
// scored 1 — the LOWEST score in the table — so every other rule (all
// scoring 2+) outranked it: five role-pair rows silently `allow`ed an edge
// into a deprecated node, two `warn`ed, and four denied but with the WRONG
// verbatim reason (e.g. "Commands run when you call them..." on an edge
// whose actual problem was the target being out of date). Deprecation is a
// property of the target's STATE, orthogonal to both role and kind —
// scoring it against role-pair specificity was a category error, and the
// old `target: NodeRole | "*" | "@deprecated"` union (mixing a role axis
// with a state axis in one field) was the tell. Hoisting it out REMOVES a
// special case from the table rather than adding one: `target` is now
// cleanly `NodeRole | "*"`. See `legalityFor` below for the precondition
// itself, and `tests/fixtures/edge_legality_cases.json` (tech-lead-owned,
// asserted from both this file's test suite and `lint.rs`'s) for the
// corpus pinning it.

import { NODE_TYPE_BY_ROLE } from "./nodeTypes";
import { registerEdgeLegality, type EdgeKind, type NodeRole } from "../store/graph";

export type Legality = "allow" | "warn" | "deny";

/** The verbatim reason shown for every deprecated-target deny (Amendment 3
 *  precondition) — named so `legalityFor` and any caller that needs to
 *  recognize this specific outcome share one string, never a second copy. */
export const DEPRECATED_TARGET_REASON =
  "That node is marked out of date and won't reach the agent.";

export interface EdgeRule {
  source: NodeRole | "*";
  kind: EdgeKind | "*";
  /** Roles only — deprecation is a PRECONDITION evaluated before this table
   *  is even consulted (Amendment 3), never a row here. */
  target: NodeRole | "*";
  legality: Legality;
  /** Shown to the user VERBATIM — write it for a person, not a log: no
   *  jargon, no internal field names. Empty string only for `allow` rules,
   *  which never surface a reason. */
  reason: string;
  /** Extra static predicate, evaluated only when every other dimension of
   *  the rule already matches. Used by exactly one rule (the cross-group
   *  `overrides` warning) — `resolveLoad`-dependent checks (budget,
   *  co-residency) are NOT expressible here and live in the linter instead
   *  (§7.3's own note). */
  when?: (source: NodeRole, target: NodeRole) => boolean;
}

function group(role: NodeRole): string {
  return NODE_TYPE_BY_ROLE[role].group;
}

/** Required rules (contract §7.3's table, spec Block B minus the two rows
 *  that reference removed roles; Amendment 3 additionally hoists the
 *  `@deprecated` row out into `legalityFor`'s precondition — see the module
 *  doc comment). Order matters ONLY as a tie-break: on an equal specificity
 *  score the LATER entry wins (frozen, tested by `edgeRules.test.ts`), so
 *  within one score bucket, put the more deliberately-chosen answer last.
 *  None of the entries below actually tie today, but the order is kept
 *  exactly as the contract lists it so a future addition's tie behaviour
 *  stays predictable by inspection. */
export const EDGE_RULES: readonly EdgeRule[] = [
  {
    source: "*",
    kind: "imports",
    target: "command",
    legality: "deny",
    reason:
      "Commands run when you call them — inlining one removes the point of it. Use references.",
  },
  {
    source: "*",
    kind: "imports",
    target: "skill",
    legality: "deny",
    reason: "Skills load themselves when relevant. Use references.",
  },
  {
    source: "*",
    kind: "imports",
    target: "architecture",
    legality: "warn",
    reason: "Architecture notes are usually long. Inlining puts this in every request.",
  },
  {
    source: "glossary",
    kind: "overrides",
    target: "*",
    legality: "deny",
    reason: "A glossary defines words; it doesn't outrank rules.",
  },
  {
    source: "example",
    kind: "overrides",
    target: "*",
    legality: "deny",
    reason: "An example illustrates a rule; it doesn't outrank one.",
  },
  {
    source: "workflow",
    kind: "references",
    target: "command",
    legality: "allow",
    reason: "",
  },
  {
    source: "example",
    kind: "references",
    target: "rule",
    legality: "allow",
    reason: "",
  },
  {
    source: "example",
    kind: "references",
    target: "invariant",
    legality: "allow",
    reason: "",
  },
  {
    source: "example",
    kind: "references",
    target: "style",
    legality: "allow",
    reason: "",
  },
  {
    source: "decision",
    kind: "contradicts",
    target: "decision",
    legality: "allow",
    reason: "",
  },
  // Edge spec's "overrides across different groups → warn": not a
  // resolveLoad-dependent check (unlike the sequence-co-residency row,
  // which needs the resolver and lives in lint instead as
  // `sequence-not-co-resident`), so it IS expressible here via `when`.
  {
    source: "*",
    kind: "overrides",
    target: "*",
    legality: "warn",
    reason: "These two aren't in the same plane — check this is what you mean.",
    when: (source, target) => group(source) !== group(target),
  },
];

/** Specificity score for one MATCHED rule, among rules matching a
 *  NON-deprecated target (§7.3, frozen, Amendment 3): `source`/`kind`
 *  concrete beat wildcard, and a concrete `target` beats `"*"`. */
function specificity(rule: EdgeRule): number {
  return (rule.source !== "*" ? 4 : 0) + (rule.kind !== "*" ? 2 : 0) + (rule.target !== "*" ? 1 : 0);
}

function targetMatches(rule: EdgeRule, targetRole: NodeRole): boolean {
  return rule.target === "*" || rule.target === targetRole;
}

/** The one decider (§7.3, Amendment 3). Deprecation is checked FIRST, as a
 *  precondition no rule can override — exactly as `resolveLoad`'s rule 2
 *  outranks its role rules (§8.2) and `compile.rs` excludes deprecated
 *  nodes from all output unconditionally (§10.3); §7.3 was the only place
 *  deprecation was still negotiable, and Amendment 3 closes that gap. Only
 *  once the target is confirmed non-deprecated does specificity scoring
 *  run: highest score wins; on a tie the LATER entry in `EDGE_RULES` wins
 *  (`score >= best` below, walking forward, achieves exactly that). No
 *  match ⇒ `{ legality: "allow", reason: "" }` — the frozen default. */
export function legalityFor(
  sourceRole: NodeRole,
  kind: EdgeKind,
  targetRole: NodeRole,
  targetDeprecated: boolean,
): { legality: Legality; reason: string } {
  if (targetDeprecated) {
    return { legality: "deny", reason: DEPRECATED_TARGET_REASON };
  }
  let best: { rule: EdgeRule; score: number } | undefined;
  for (const rule of EDGE_RULES) {
    if (rule.source !== "*" && rule.source !== sourceRole) continue;
    if (rule.kind !== "*" && rule.kind !== kind) continue;
    if (!targetMatches(rule, targetRole)) continue;
    if (rule.when !== undefined && !rule.when(sourceRole, targetRole)) continue;
    const score = specificity(rule);
    if (best === undefined || score >= best.score) best = { rule, score };
  }
  if (best === undefined) return { legality: "allow", reason: "" };
  return { legality: best.rule.legality, reason: best.rule.reason };
}

// Wire into the store's registration slot (`src/store/graph.ts`'s
// `registerEdgeLegality`) as a module-level side effect — this module is
// imported by exactly one real call site today
// (`src/wizard/roles.ts`, transitively via `roleMeta.ts`... no: see below)
// plus its own test file; the actual wiring-in point is `App.tsx`'s (or an
// equivalent top-level module's) import graph reaching this file at least
// once before the first `addEdge` call. Registering here, at module
// evaluation time, means ANY import of `edgeRules.ts` — direct or
// transitive — is sufficient; no separate "call this once at startup" step
// is needed.
registerEdgeLegality(legalityFor);
