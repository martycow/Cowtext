# INPUT PROMPT FOR COWTEXT

Here lives a dynamic prompt for using inside Claude Code.
Consider everything below as a new prompt every time. It may or may not change. You can't tell before you read.
Don't make changes here. Just read it and follow the rules.

=== Everything below considered as a prompt ===

## What I don't like

1. Git initialization should be in project's context menu AND in inspector AND in top bar
2. I initialized Git, selected branch's name but I don't see it in git. It must be default branch after init
3. In Agent Wizard avatar is clickable but nothing happens
4. In Agent Wizard avatar is changing on Name field changes
5. When I pressed "Assemble" on agent, progress bar on the node started blinking. It should display progress, not just blink
6. After agent's node was assembled it doesn't update Markdown preview. I still see the old data even though the file itself changed
7. After I changed connection's line color the label went below it and is barely visible

# TASKS — Node Taxonomy Refactor + Two-Pane Node Editor

**Repo:** Cowtext
**Scope:** node type system, node creation/edit modal, compile mapping table
**Execution mode:** block by block. **Stop after each block and wait for review.** Do not start the next block on your own.

---

## 0. Context you need before writing code

Cowtext is a local-first desktop app (Tauri 2 + React 18 + TypeScript + React Flow + Zustand + Tailwind) that manages AI agent context files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `.claude/commands/`, `.claude/skills/`) as a visual graph and compiles that graph into per-agent formats.

The current node creation modal (step 1 "Identity") presents 12 flat type tiles grouped under CONSTRAINTS / PROCESS / KNOWLEDGE. It has three structural problems:

1. **Two orthogonal concepts are collapsed into one field.** `REFERENCE` ("lookup material, read on demand") describes *when a node is loaded into context*, not *what the node is*. The target formats already separate these: `.cursor/rules` has `alwaysApply` + `globs`, `CLAUDE.md` has inline vs `@path` references, skills load by `description` match, commands load on explicit invocation. Type and load policy must become independent fields.
2. **`TASK` does not belong in a persistent context graph.** A task has a lifecycle (todo → doing → done); context nodes do not. A task *consumes* a subgraph, it is not a member of one. The app already has this precedent — the modal says "Agents are created in the Agents rail."
3. **`ARCHITECTURE` is filed under PROCESS.** It describes structure, not process.

Additionally, several types are indistinguishable to a user at creation time (`RULE` vs `INVARIANT` vs `STYLE`), and there is no feedback about what a node will actually produce until after it is created.

**The governing test for whether a type earns its existence:** if two types compile to the same artifact, with the same load policy, and the agent reads them identically, they are one type with a tag — not two types. Apply this test if you are tempted to add anything not listed below.

---

## Block A — Data model

### A1. Replace the type enum

```ts
// src/types/node.ts

export type NodeGroup = 'constraints' | 'structure' | 'process' | 'knowledge';

export type NodeType =
  // constraints
  | 'rule'          // a directive to the agent: "never commit directly to main"
  | 'invariant'     // a checkable property of the system: "all timestamps are UTC"
  | 'trap'          // a known gotcha: "vitest picks up .test.ts only, not .spec.ts"
  // structure
  | 'architecture'  // how the system fits together
  | 'decision'      // ADR: we chose X over Y because Z — do not silently undo it
  // process
  | 'workflow'      // an ordered process with steps
  | 'command'       // an invocable prompt template (.claude/commands/*.md)
  | 'skill'         // a reusable capability (.claude/skills/*/SKILL.md)
  | 'env'           // build/test/lint commands, ports, env vars, prerequisites
  | 'tool'          // MCP servers and external tools: which exist, when to reach for them
  // knowledge
  | 'glossary'      // the exact words of the domain
  | 'example'       // good/bad pairs and reusable code fragments
  | 'style';        // voice and formatting conventions
```

13 types, 4 groups. Removed: `task`, `reference`, `snippet`, `rules` (renamed). Added: `decision`, `tool`, `env`, `example`.

### A2. Add load policy as an independent field

```ts
export type LoadPolicy =
  | 'always'      // inlined into the always-resident file (CLAUDE.md / AGENTS.md)
  | 'on-demand'   // written to a separate file, referenced by @path — agent reads it when relevant
  | 'on-glob'     // applies when matching files are touched (.cursor/rules globs)
  | 'on-invoke';  // only when explicitly called (slash command)

export interface ContextNode {
  id: string;
  type: NodeType;
  name: string;
  body: string;
  load: LoadPolicy;
  globs?: string[];          // required iff load === 'on-glob'
  targets: AgentTarget[];    // which agents this compiles for
  needsReview?: boolean;     // set by migration when a field could not be inferred
  createdAt: string;
  updatedAt: string;
}
```

Each type has a **default** load policy, but the user can override it. Defaults:

| Type | Default load | Override allowed |
|---|---|---|
| `rule` | `always` | yes |
| `invariant` | `always` | yes |
| `trap` | `always` | yes |
| `architecture` | `on-demand` | yes |
| `decision` | `on-demand` | yes |
| `workflow` | `on-demand` | yes |
| `command` | `on-invoke` | **no** — locked |
| `skill` | `on-demand` | **no** — locked |
| `env` | `always` | yes |
| `tool` | `always` | yes |
| `glossary` | `on-demand` | yes |
| `example` | `on-glob` | yes |
| `style` | `on-glob` | yes |

Where override is locked, the UI shows the policy as a read-only badge with a one-line reason ("Commands only run when you call them").

### A3. Single source of truth for type metadata

Create `src/config/nodeTypes.ts` exporting one array that drives the tiles, the icons, the colors, the preview, and the compiler. No type metadata duplicated anywhere else.

```ts
export interface NodeTypeMeta {
  type: NodeType;
  group: NodeGroup;
  label: string;            // "Invariant"
  hint: string;             // ≤ 60 chars, plain language
  microExample: string;     // a real one-liner, e.g. "All timestamps are UTC"
  icon: LucideIcon;
  accent: string;           // token name, not a hex literal
  defaultLoad: LoadPolicy;
  loadLocked: boolean;
  compile: CompileMapping[];
}
```

**`microExample` is mandatory for every type and must be a concrete instance, never a definition.** This is the single highest-leverage fix for type confusion — abstract descriptions like "a fact that must always hold" do not let a user distinguish `invariant` from `rule`, but "All timestamps are UTC" next to "Never commit directly to main" does it instantly.

### A4. Migration

Migrate existing nodes on load, with a schema version bump. Deterministic cases migrate silently; ambiguous cases migrate to a best guess **and set `needsReview: true`**.

| Old | New | Review flag |
|---|---|---|
| `rules` | `rule` | no |
| `invariant`, `trap`, `architecture`, `workflow`, `skill`, `glossary`, `style` | unchanged | no |
| `snippet` | `example` | no |
| `reference` | `architecture`, `load: 'on-demand'` | **yes** — the real type is unknowable |
| `command` | `command` if body contains `$ARGUMENTS` or is prose; else `env` | **yes** |
| `task` | `workflow`, `load: 'on-demand'` | **yes** |

Never drop a node during migration. Never lose `body`.

**Acceptance criteria — Block A**
- [ ] `NodeType` has exactly 13 members; `task`, `reference`, `snippet`, `rules` do not appear anywhere in the codebase
- [ ] `nodeTypes.ts` is the only place type labels, hints, icons, and colors are defined
- [ ] Every type has a non-empty `microExample` that is an instance, not a definition
- [ ] Migration is idempotent — running it twice produces the same result
- [ ] Round-trip test: a graph saved before migration and loaded after has the same node count and identical `body` strings
- [ ] `on-glob` without `globs` fails validation with a readable message

**Stop here. Wait for review.**

---

## Block B — Two-pane modal shell

Widen the modal to a two-pane layout. Left pane is where the user works; right pane shows what the node will actually produce. The right pane is not decoration — it is the mechanism that removes uncertainty about what a type *means*, by showing the output instead of describing it.

```
┌──────────────────────────────────────────────────────────────────────┐
│  New node        ① Identity ② Target ③ Brief ④ Assemble      ⤢ ⤓ ✕  │
├───────────────────────────────────┬──────────────────────────────────┤
│                                   │  HOW THIS IS USED                │
│  LEFT PANE — configuration        │                                  │
│  ~58% width, scrolls              │  [Claude Code] [Cursor] [Codex]  │
│                                   │  ────────────────────────────    │
│  step content                     │  → .claude/rules/api-conv.md     │
│                                   │  ┌────────────────────────────┐  │
│                                   │  │ ---                        │  │
│                                   │  │ description: API conventi… │  │
│                                   │  │ globs: src/api/**          │  │
│                                   │  │ ---                        │  │
│                                   │  │ Never return raw errors…   │  │
│                                   │  └────────────────────────────┘  │
│                                   │                                  │
│                                   │  ◷ Loads when files in src/api/  │
│                                   │    are touched                   │
│                                   │  ≈ 84 tokens                     │
├───────────────────────────────────┴──────────────────────────────────┤
│  Nothing is written until you confirm on step 4.        [Back] [Next]│
└──────────────────────────────────────────────────────────────────────┘
```

### B1. Layout
- Modal grows to `min(1180px, 92vw)` × `min(760px, 88vh)`
- Left pane `58%`, right pane `42%`, divider is a 1px hairline in a border token
- Right pane has its own scroll; the two panes scroll independently
- Below `1024px` viewport width: panes stack, right pane collapses into a "Preview" disclosure directly above the footer, closed by default
- Preserve the existing header (step rail, expand, download, close) and the existing footer line verbatim — `Nothing is written until you confirm on step 4.` That sentence is the app's core promise about control; it stays exactly as written.

### B2. Right pane behavior
- Updates live, debounced 150ms, on every change to type, name, body, load policy, globs, or targets
- One tab per selected target agent. If no target is selected yet (step 1), default to Claude Code and label the tab area with a quiet note that targets are chosen on step 2
- Shows, in this order: **destination file path** → **rendered output** (frontmatter + body, syntax-highlighted, read-only) → **load explanation in one plain sentence** → **token estimate**
- The load explanation is written from the user's side of the screen: "Loads when files in `src/api/` are touched", not "alwaysApply: false, glob-scoped"
- **Empty state, before the user types anything:** render a complete worked example for the currently selected type using its `microExample`. The user sees a real node of that type before committing to it. This is the primary anti-confusion device — do not replace it with placeholder text or a "preview will appear here" message.
- Never fabricate a path. If a target's mapping for a type is not implemented, say which target and that the mapping is missing.

### B3. Empty and error states
An empty right pane is a wasted teaching surface, and a preview error must say what to fix. If globs are required but absent, the right pane shows the destination file and a one-line prompt to add a glob, not a stack trace or a blank panel.

**Acceptance criteria — Block B**
- [ ] Preview reflects a keystroke within 200ms
- [ ] Switching type on step 1 immediately changes the preview file path and frontmatter
- [ ] Below 1024px the layout stacks and remains usable with no horizontal scroll
- [ ] Selecting a type with an empty form shows a full worked example, not a placeholder
- [ ] No hardcoded hex colors — all tokens
- [ ] Right pane is `aria-live="polite"` and never steals focus from the left pane

**Stop here. Wait for review.**

---

## Block C — Step 1 (Identity): type selection without confusion

### C1. Tile grid
Four labeled groups in this order: Constraints, Structure, Process, Knowledge. All 13 tiles visible — do not collapse groups behind disclosure. Discovery matters more than density here; a user who cannot see a type will not know it exists.

Each tile shows: icon + label, the hint, and the `microExample` rendered in a distinct treatment (mono, dimmed) so it reads as an instance rather than more description.

### C2. Default selection
Default to **Rule**, not the first tile in DOM order. It is the type most users start with.

### C3. Filter
Type-ahead filter above the grid. Matches label, hint, and `microExample`. Filtering dims non-matching tiles rather than removing them, so the grid does not reflow and spatial memory survives.

### C4. Disambiguator
The three confusable types (`rule`, `invariant`, `style`) get an inline "What's the difference?" affordance that expands a three-row comparison in place — one row per type, each row being its `microExample` plus a five-word distinction. Do not open a second modal or a tooltip that disappears on mouse-out; the user needs to read this while looking at the tiles.

### C5. Changing type late must never destroy work
If the user has already entered a name or body and then changes the type on step 1, keep both. If the new type has a locked load policy that conflicts with a previously chosen one, apply the new policy and show a single quiet inline notice explaining the change. Never silently discard user input, and never show a confirmation dialog for a reversible change.

**Acceptance criteria — Block C**
- [ ] All 13 tiles reachable by keyboard; arrow keys move within the grid, Enter selects
- [ ] Every tile renders its `microExample`
- [ ] Filter dims rather than removes
- [ ] Changing type after entering a body preserves the body — covered by a test
- [ ] Rule is preselected on open

**Stop here. Wait for review.**

---

## Block D — Steps 2–3 (Target, Brief): load policy and body

### D1. Step 2 — Target
Agent target checkboxes, plus the load policy control:
- Four options as a segmented control, each with a one-line plain-language consequence: `Always` → "In context for every request", `On demand` → "Agent reads it when relevant", `When files match` → "Applies to files you name below", `Only when called` → "Runs when you invoke it"
- When the type locks the policy, render it as a read-only badge with its reason instead of the segmented control
- Glob input appears only for `When files match`, with live match count against the project ("matches 23 files") so the user can tell a typo from a working pattern

### D2. Weight guard
Nodes set to `always` are the ones that cost tokens on every single request. When a node is `always` and its body exceeds **400 tokens**, show a non-blocking inline suggestion in the right pane: state the size, state that on-demand would keep it out of every request, and offer a one-click switch. Suggest, do not block — the user may have a reason.

### D3. Step 3 — Brief
- Markdown body editor with a type-specific placeholder derived from `microExample`
- Live token count in the footer of the editor
- For `command`, a note that `$ARGUMENTS` is substituted at invocation
- For `example`, a two-field good/bad layout that compiles into a single body — this is the shape that makes the type worth having

**Acceptance criteria — Block D**
- [ ] Glob field appears only for `on-glob` and shows a live match count
- [ ] Locked types show a badge and no segmented control
- [ ] Weight guard fires above 400 tokens on `always` and its one-click switch works
- [ ] `example` two-field editor round-trips: split → compile → reopen → split again with no drift

**Stop here. Wait for review.**

---

## Block E — Step 4 (Assemble): the control step

This step is the payoff of the promise in the footer. Nothing has been written yet; this is where the user sees exactly what will be.

- **File diff list**: every file that will be created or modified, grouped by agent, each with a create/modify badge and an expandable unified diff
- Modified files show real before/after, not just the added block
- **Confirm** writes; **Back** returns with everything intact
- After writing: a toast naming the count and offering **Undo**, which reverts every file touched by this action. The button says "Create node", the toast says "Node created" — same verb through the whole flow.
- If any write fails, roll back all of them and report which file failed and why. Partial writes are the one outcome this step exists to prevent.

**Acceptance criteria — Block E**
- [ ] No file is touched before Confirm — verified by a test that walks the whole flow and asserts a clean filesystem
- [ ] Diff shows every affected file including modifications to existing ones
- [ ] Undo restores exact prior file contents
- [ ] A simulated mid-write failure leaves the filesystem unchanged

**Stop here. Wait for review.**

---

## Block F — Migration surface

- On first load of a pre-migration graph, show a dismissible banner: how many nodes were migrated and how many need review
- Nodes with `needsReview: true` get a visible marker on the canvas and a filter to isolate them
- Opening one prefills the guessed values and shows a single line explaining what was guessed and why
- Clearing the flag is one click once the user confirms or corrects the type

**Acceptance criteria — Block F**
- [ ] Review-needed nodes are findable in one action from the canvas
- [ ] Dismissing the banner persists
- [ ] Clearing the flag persists across restart

**Stop here. Wait for review.**

---

## Scope guards — do not do these

- Do not add dependencies. The stack is fixed: Tauri 2, React 18, TypeScript, React Flow, PixiJS 8, Zustand, Tailwind, Howler.js, Rust (axum, notify), SQLite. Additions require explicit approval.
- Do not build the Agents rail or anything task/orchestrator related. `task` is being *removed*; do not relocate it into a new feature.
- Do not implement invariant drift detection. The type exists to make it possible later.
- Do not restructure the compiler beyond adding load-policy awareness and the new type mappings.
- Do not touch the barn scene, the hooks/event pipeline, or licensing.
- Do not change the step count or the header/footer copy.
- Do not write migration logic that deletes nodes under any condition.

## Backlog — blocked until explicitly approved

- N1: invariant validation against the codebase (drift detection)
- N2: node templates / starter packs per project archetype
- N3: bulk retype of multiple selected nodes
- N4: per-node token budget visualization across the whole graph
- N5: import of existing `CLAUDE.md` / `.cursor/rules` into typed nodes

---

## Definition of done for the whole spec

1. `npm run lint` and `npm run test` pass
2. No `any` introduced in touched files
3. A user can create one node of each of the 13 types end to end without reading documentation
4. The preview pane is never blank while a type is selected
5. The filesystem is provably untouched until Confirm on step 4

# TASKS — Edge Model Refactor

**Repo:** BARN (Cowtext)
**Scope:** edge kinds, load-policy resolution, legality matrix, graph linter, edge UI
**Execution mode:** block by block. **Stop after each block and wait for review.** Do not start the next block on your own.

---

## 0. Relationship to `TASKS_NODE_TAXONOMY_UI.md`

That spec put a `load: LoadPolicy` field on `ContextNode`. **This spec removes it.** Load policy is a property of the relationship between two nodes, not of a node's content — the same node can be hard-included in one agent profile and pulled in by reference in another.

- If `TASKS_NODE_TAXONOMY_UI.md` Block A is already implemented: migrate `node.load` into edges per Block F below.
- If it is not yet implemented: implement its A2 with `defaultLoad` only (a UI hint for proposing an edge kind) and no stored `load` on the node.

Everything else in that spec stands unchanged.

---

## 1. Context you need before writing code

The current edge menu offers seven kinds under two groups, `STRUCTURAL` ("changes compiled output") and `ADVISORY` ("advisory only"): `imports`, `sequence`, `overrides`, `references`, `conditional`, `supersedes`, `conflicts-with`.

The grouping does not hold up against its own criterion:

- **`references` changes compiled output.** It emits a literal `@docs/architecture.md` line into `CLAUDE.md`. Its softness is about *when the agent reads the target*, not about whether anything is written. Structural.
- **`conditional` changes compiled output.** It writes `globs:` into `.cursor/rules` frontmatter. Structural.
- **`supersedes` is not a relationship.** "The target is out of date" is a state of the target node, and it must change compilation — a node marked out of date should not reach the agent at all.
- That leaves `conflicts-with` as the only genuinely advisory kind. A group of one is a boolean, not a group.

Three further problems:

- **`conditional` is a modifier, not a kind.** It is `imports` plus a guard. Forcing a choice between them is forcing a choice between a verb and an adverb.
- **`overrides` is not materialized.** Markdown has no conflict resolver; the agent reads text. An override that only exists in the graph does nothing to the output.
- **`conflicts-with` is drawn directional.** If A contradicts B, B contradicts A. The arrowhead promises an asymmetry that does not exist.

---

## Block A — Edge data model

### A1. Replace the edge enum

```ts
// src/types/edge.ts

export type EdgeKind =
  | 'imports'      // structural: pulls target's content into source's compiled output
  | 'references'   // structural: emits an @path pointer; target compiles to its own file
  | 'overrides'    // structural: emits an explicit precedence block (see Block C)
  | 'sequence'     // structural: constrains ordering of co-resident nodes
  | 'contradicts'; // advisory: linter only, never affects output

export type EdgeGuard =
  | { type: 'glob'; globs: string[] }
  | { type: 'description'; text: string };

export interface Edge {
  id: string;
  source: NodeId;
  target: NodeId;
  kind: EdgeKind;
  guard?: EdgeGuard;   // absorbs the old `conditional` kind
  order?: number;      // local ordering among siblings sharing a source
  note?: string;
}
```

Five kinds, down from seven. `conditional` becomes `guard` on any structural edge. `supersedes` becomes node state (A3).

### A2. `contradicts` is symmetric

Store as an unordered pair. Normalize on write so `(A,B)` and `(B,A)` are the same edge and cannot both exist. Render without arrowheads — a plain marker at both ends or none. `guard` and `order` are invalid on `contradicts`; reject at validation.

### A3. `supersedes` becomes node state

```ts
// on ContextNode
deprecated?: {
  replacedBy: NodeId;
  since: string;       // ISO date
  reason?: string;
};
```

A deprecated node is **excluded from all compiled output**. The graph keeps it for provenance; the agent never sees it. Any structural edge pointing at a deprecated node is a lint error (Block D).

### A4. Load policy becomes derived, not stored

Delete `node.load`. Effective policy is computed:

```ts
type ResolvedLoad = 'always' | 'on-demand' | 'on-glob' | 'on-invoke';
```

Resolution order, first match wins:

1. Node type has a fixed destination (`command` → `.claude/commands/`, `skill` → `.claude/skills/`) → `on-invoke` / `on-demand` respectively, regardless of edges. These types cannot be inlined.
2. Node has at least one incoming `imports` edge with a `guard` → `on-glob`.
3. Node has at least one incoming `imports` edge without a guard → `always`.
4. Node has at least one incoming `references` edge → `on-demand`.
5. No incoming structural edges → node is orphaned; excluded from output, surfaced by the linter.

**Strength order is `imports` > `references`.** If a node is imported by A and referenced by B, it is inlined once and B's `@path` pointer is omitted — pointing at content already in context wastes tokens. The resolver must return not just the policy but the reason, so the UI can explain it.

`ContextNode.defaultLoad` survives as a UI hint only: it decides which edge kind is preselected when the user draws an edge into that node. It never affects compilation.

**Acceptance criteria — Block A**
- [ ] `EdgeKind` has exactly 5 members; `conditional` and `supersedes` appear nowhere in the codebase
- [ ] `node.load` is gone; no compile path reads it
- [ ] `contradicts` normalizes endpoints — creating `(B,A)` when `(A,B)` exists is a no-op, not a duplicate
- [ ] `resolveLoad(nodeId)` returns `{ policy, reason, decidingEdgeId? }` and is pure
- [ ] Deprecated nodes are excluded from output — covered by a test
- [ ] Round-trip: save graph → load → identical edge set

**Stop here. Wait for review.**

---

## Block B — Legality matrix

Today any edge can be drawn between any two nodes, and roughly half of the combinations are meaningless. The user finds out only when the compiled output looks wrong. Validate at draw time instead.

Create `src/config/edgeRules.ts` as the single source of truth:

```ts
export type Legality = 'allow' | 'warn' | 'deny';

export interface EdgeRule {
  source: NodeType | '*';
  kind: EdgeKind;
  target: NodeType | '*';
  legality: Legality;
  reason: string;   // shown verbatim in the UI — write it for the user, not the log
}
```

Most specific rule wins; `*` is the fallback. Required rules, at minimum:

| Source | Kind | Target | Legality | Reason (user-facing) |
|---|---|---|---|---|
| `*` | `imports` | `command` | deny | "Commands run when you call them — inlining one removes the point of it. Use references." |
| `*` | `imports` | `skill` | deny | "Skills load themselves when relevant. Use references." |
| `*` | `*` | deprecated node | deny | "That node is marked out of date and won't reach the agent." |
| `*` | `imports` | `architecture` | warn | "Architecture notes are usually long. Inlining puts this in every request." |
| `*` | `imports` | `reference-weight > 400 tokens` | warn | "This adds ~N tokens to every request." |
| `glossary` | `overrides` | `*` | deny | "A glossary defines words; it doesn't outrank rules." |
| `example` | `overrides` | `*` | deny | "An example illustrates a rule; it doesn't outrank one." |
| `*` | `overrides` | `*` (different group) | warn | "These two aren't in the same plane — check this is what you mean." |
| `workflow` | `references` | `command` | allow | — |
| `example` | `references` | `rule` \| `invariant` \| `style` | allow | — |
| `decision` | `contradicts` | `decision` | allow | — |
| `*` | `sequence` | `*` (not co-resident) | warn | "These never end up in the same file, so ordering does nothing." |

`deny` blocks the edge at draw time with the reason inline. `warn` creates the edge and files a lint entry — never a blocking dialog.

**Acceptance criteria — Block B**
- [ ] `edgeRules.ts` is the only place legality is expressed
- [ ] Specificity resolution is tested including `*` fallback
- [ ] Every rule has a reason written in plain language, no jargon, no internal field names
- [ ] Denied edges cannot be created through any code path, including paste and undo/redo

**Stop here. Wait for review.**

---

## Block C — Materializing `overrides`

An override that exists only in the graph does nothing. Markdown has no resolver, so the precedence has to become text the agent reads.

**Implement explicit precedence blocks. Do not attempt line excision from the target** — identifying "the conflicting lines" requires structure the content does not have, and getting it wrong silently deletes user content.

When `A --overrides--> B` and both are co-resident in the same compiled file:

1. `A` is emitted after `B` in that file
2. `A`'s block is prefixed with a generated line naming what it supersedes, e.g. `Takes precedence over "Legacy error handling" below.` — derived from `B.name`, not free text
3. The generated line is marked in the output so recompilation replaces rather than accumulates it

If `A` and `B` are **not** co-resident, the override cannot be expressed. This is a lint error, not a silent no-op: "Override has no effect — these two never appear in the same file." Offer the fix (import both from a common parent) rather than only reporting the problem.

**Acceptance criteria — Block C**
- [ ] Override emits a precedence line and orders A after B
- [ ] Recompiling twice produces byte-identical output — no accumulated precedence lines
- [ ] Non-co-resident override produces a lint error with a suggested fix
- [ ] No code path removes lines from a target node's body

**Stop here. Wait for review.**

---

## Block D — Graph linter

One module, `src/lib/lint.ts`, returning structured diagnostics. Every diagnostic carries `severity`, a user-facing `message`, the offending node/edge ids, and — where one exists — a `fix` the UI can apply in one click.

Required checks:

| Check | Severity | Message shape |
|---|---|---|
| `imports` cycle | error | names the cycle path |
| `sequence` with non-co-resident endpoints | warn | "ordering does nothing" + fix |
| `overrides` with non-co-resident endpoints | error | per Block C |
| Structural edge into a deprecated node | error | names the replacement |
| Orphaned node (no incoming structural edge) | warn | "won't reach any agent" |
| Unresolved `contradicts` | warn | never auto-resolve — see below |
| `always` budget exceeded per agent | warn | total tokens vs threshold, top contributors named |
| Duplicate `imports` of the same target | info | "already in context" + fix to drop the redundant edge |

**`contradicts` is never auto-resolved.** The linter reports it and stops. Two nodes disagreeing is information the user needs; picking a winner on their behalf is exactly the kind of silent decision this app exists to prevent.

Surface diagnostics in a panel with filter-by-severity, click-to-focus on canvas, and a badge on affected nodes and edges.

**Acceptance criteria — Block D**
- [ ] All eight checks implemented with tests, including a cycle fixture
- [ ] Lint runs on graph change without blocking the UI thread on graphs up to 500 nodes
- [ ] Clicking a diagnostic focuses and highlights the endpoints
- [ ] Every `fix` is reversible via existing undo
- [ ] No check mutates the graph on its own

**Stop here. Wait for review.**

---

## Block E — Edge UI

### E1. Kind picker
Reuse the shape of the node type modal: label, one-line hint, and a **concrete micro-example per kind** — an instance, not a definition. Two groups now honest:

```
STRUCTURAL — changes what lands in the file
  ──────▶  imports      target's text is written into this file
  ──────▷  references   an @path line is written; target keeps its own file
  ━━━━━▶  overrides     placed after the target, with a precedence line
  ┄┄┄┄▸   sequence      target is read after source

ADVISORY — linter only
  ╌╌╌╌╌   contradicts   flagged for you, never resolved automatically
```

Describe every kind **in terms of what ends up in the file**. The current copy mixes frames — `imports` is described as compilation, `references` as agent behavior. Pick the file's point of view for all five.

Drop the existing caveat on `overrides` ("doesn't pull the target into context — only imports does that"). Once `imports` and `references` are properly separated it is unnecessary, and needing it was the signal the taxonomy was leaking.

### E2. Guard control
A "Only when…" toggle available on any structural edge, expanding to glob input (with live match count against the project) or plain-language condition. Guarded edges render dashed on canvas — the visual distinction the old `conditional` kind provided, without the menu choice.

### E3. Edge inspector
Selecting an edge shows: kind, guard, order, resolved effect on the target's load policy **with the reason from `resolveLoad`**, and any lint diagnostics touching it. The user should be able to answer "why is this node always in context?" by clicking one edge.

### E4. Draw-time feedback
While dragging, invalid targets dim and the denial reason appears near the cursor. Do not let the user complete a `deny` edge and then explain the mistake afterwards.

**Acceptance criteria — Block E**
- [ ] Every kind shows a micro-example that is an instance
- [ ] All five kinds' hints are written from the file's point of view
- [ ] `contradicts` renders symmetric — no arrowhead
- [ ] Guarded edges render dashed
- [ ] Denial reason appears during drag, before the drop
- [ ] Inspector explains resolved load policy in one sentence naming the deciding edge

**Stop here. Wait for review.**

---

## Block F — Migration

Schema version bump. Never delete an edge; ambiguous conversions set `needsReview: true` on the edge.

| Old | New | Review |
|---|---|---|
| `imports` | `imports` | no |
| `references` | `references` | no |
| `sequence` | `sequence` | no |
| `overrides` | `overrides` | **yes** — co-residency must be verified per Block C |
| `conditional` | `imports` + `guard` (globs if parseable, else `description`) | **yes** if the condition was free text |
| `supersedes` | delete edge; set `target.deprecated = { replacedBy: source, since: now }` | **yes** |
| `conflicts-with` | `contradicts`, endpoints normalized; collapse reciprocal pairs | no |

Migrate `node.load` (if present from the earlier spec) into edges: `always` → ensure an unguarded `imports` edge from the node's agent profile; `on-demand` → `references`; `on-glob` → `imports` + glob guard; `on-invoke` → drop, it is derived from node type. Where no parent exists to attach to, leave the node orphaned and let the linter surface it — do not invent a parent.

Show a post-migration summary: counts by conversion, and a one-click filter to the edges needing review.

**Acceptance criteria — Block F**
- [ ] Migration is idempotent
- [ ] Edge count before ≥ edge count after only where reciprocal `conflicts-with` pairs collapsed or `supersedes` converted; every other edge survives
- [ ] No node loses `body` or `name`
- [ ] Review-needed edges are findable in one action
- [ ] A pre-migration graph compiles to equivalent output post-migration, except where `deprecated` correctly removes a node — assert this with a fixture

**Stop here. Wait for review.**

---

## Scope guards — do not do these

- Do not add dependencies. Stack is fixed: Tauri 2, React 18, TypeScript, React Flow, PixiJS 8, Zustand, Tailwind, Howler.js, Rust (axum, notify), SQLite.
- Do not implement automatic conflict resolution for `contradicts` under any framing.
- Do not implement line excision for `overrides`.
- Do not add new edge kinds beyond the five listed. If something seems to need one, stop and ask — the same test applies as for nodes: if two kinds produce the same output through the same mechanism, they are one kind with an attribute.
- Do not touch the barn scene, hooks/event pipeline, licensing, or the Agents rail.
- Do not change node types — that is `TASKS_NODE_TAXONOMY_UI.md`.

## Backlog — blocked until explicitly approved

- N1: auto-suggest edges from existing file structure on import
- N2: graph-wide token budget visualization per agent profile
- N3: edge templates / common subgraph patterns
- N4: diff view for compiled output between two graph revisions
- N5: `contradicts` resolution assistant that proposes merges (proposes only — still never applies)

---

## Definition of done

1. `npm run lint` and `npm run test` pass
2. No `any` introduced in touched files
3. Every edge kind's effect on compiled output is observable in the preview before confirming
4. `resolveLoad` is the only function deciding load policy — no second implementation anywhere
5. A user can answer "why is this node in context?" by selecting one edge

# TASKS — Agent Modal Refactor

**Repo:** BARN (Cowtext)
**Scope:** the New agent / Edit agent modal, agent data model, frontmatter compilation for `.claude/agents/*.md`
**Execution mode:** block by block. **Stop after each block and wait for review.** Do not start the next block on your own.

---

## 0. Before you write code

This modal writes Claude Code subagent files. Unlike the node and edge specs in this series, the problems here are **factual, not structural** — several controls do not correspond to anything in the target format, and one field that decides whether the agent ever runs is marked optional.

**First task, before any implementation:** fetch the current subagent documentation at `https://code.claude.com/docs/en/sub-agents` and reconcile it against the field table in Block A. This format gains fields over time. If the docs and this spec disagree, **the docs win** — report the difference and wait for review rather than implementing the stale version.

Established facts as of writing:

- A subagent is a Markdown file with YAML frontmatter; the body is the agent's **system prompt**, written in second person (`You are a senior code reviewer.`)
- `description` is what the lead agent reads to decide when to delegate. An agent with a weak or absent description is a valid file that never gets invoked.
- `model` accepts `sonnet` / `opus` / `haiku` / a full model ID / `inherit`, and **defaults to `inherit`**
- Omitting `tools` entirely means the subagent inherits the thread's tools, including MCP servers. An explicit list freezes the set.
- Additional frontmatter fields exist beyond what this modal exposes: `disallowedTools`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `initialPrompt`, `memory`, `effort`, `background`, `isolation`

Related specs in this series: `TASKS_NODE_TAXONOMY_UI.md` (two-pane modal pattern, live preview, confirm-before-write) and `TASKS_EDGE_MODEL.md`. Reuse their patterns; do not invent a second preview implementation.

---

## Block A — Field audit and data model

### A1. Remove fields that compile to nothing and claim otherwise

`INFLUENCE` (a percentage slider) has no unit, no documented consequence, and no frontmatter counterpart. **Delete it.** If it was intended to drive canvas or barn-scene rendering, that is a separate feature and should be reintroduced with a stated effect — a control whose consequence cannot be named is the fastest way to make every other control in the window look untrustworthy.

`PRIORITY` stays. It is honest about itself (see A3) and serves the fleet rail.

### A2. Add real fields the modal is missing

```ts
export interface Agent {
  // identity
  id: string;
  name: string;            // display name, Cowtext-local: "Tech Lead"
  slug: string;            // frontmatter `name`, kebab-case: "tech-lead"
  nickname?: string;       // Cowtext-local only, compiles to nothing
  fileName: string;        // derived from slug, editable

  // dispatch
  description: string;     // REQUIRED — see Block C
  systemPrompt: string;    // the body

  // runtime
  model: 'inherit' | 'haiku' | 'sonnet' | 'opus' | string;  // default 'inherit'
  toolMode: 'inherit' | 'restrict';
  tools?: string[];              // only when toolMode === 'restrict'
  disallowedTools?: string[];    // valid in either mode
  permissionMode?: PermissionMode;
  maxTurns?: number;
  memory?: MemoryConfig;         // what the MEMORY FOLDER toggle should map to
  skills?: string[];

  // cowtext-local
  priority: number;
  avatarPath?: string;
}
```

`disallowedTools` and `maxTurns` are the two highest-value additions: a denylist is safer and more durable than a whitelist that freezes, and a turn cap is the only bound on a runaway agent.

If the `MEMORY FOLDER` toggle is meant to map to the `memory` frontmatter field, name it accordingly and show the resulting frontmatter. If it is a Cowtext-local convention with no frontmatter effect, mark it per A3.

### A3. The local-only convention, applied without exception

The current modal already does this well once: `PRIORITY` carries the note *"does not affect the dispatch order or compiled context."* That honesty is one of the better things in the product, and right now it is applied to exactly one of four non-compiling controls.

**Inconsistency here is worse than absence** — marking one field teaches the user that unmarked fields do compile.

Rule: every field that does not appear in the written file carries the same visual marker — a single quiet `local only` badge beside the label, plus one line naming what it does affect. Applies to `nickname`, `priority`, `avatarPath`, and anything added later. Implement the badge as one shared component driven by a single `compiles: boolean` flag on the field config, so a new field cannot be added without answering the question.

### A4. Identity: three fields, one truth

`NAME` / `NICKNAME` / `FILE` currently leave it ambiguous what lands in frontmatter `name`. Resolve it visibly:

- `name` (display) is free text
- `slug` is auto-derived kebab-case, shown read-only beneath the name field as `name: tech-lead`, with an edit affordance
- `fileName` derives from `slug`; if the user edits one, keep them in sync and say so
- `nickname` gets the `local only` badge

**Acceptance criteria — Block A**
- [ ] `influence` appears nowhere in the codebase
- [ ] Field config carries `compiles: boolean`; the badge renders from it, never hand-placed
- [ ] Frontmatter `name` value is visible in the UI before writing
- [ ] Slug generation handles spaces, case, diacritics, and collisions with existing agent files
- [ ] `disallowedTools`, `maxTurns`, `permissionMode` are in the model and round-trip through save/load

**Stop here. Wait for review.**

---

## Block B — Description as a dispatch contract

This is the most consequential change in the spec.

### B1. Required, renamed, reframed
- `description` becomes **required**. Create is disabled without it.
- Label changes from `DESCRIPTION` to **"When to use this agent"**
- The current hint — *"optional — one line, shown in the frontmatter"* — describes the mechanism instead of the consequence. Replace with one line naming what it does: this is what Claude reads to decide whether to hand work to this agent.
- Placeholder is a worked example, not a description of one:
  `Use this agent when reviewing architecture decisions or evaluating infrastructure changes.`

### B2. Second field for the negative boundary
Add an optional **"When not to use it"** input that compiles into the same `description` string, appended. Users already write this — the example agent's `Duties` contains "He doesn't write code himself", which is delegation-boundary information sitting in a field that has no effect on delegation. Give it a home where it works.

### B3. Blocking validation: "this agent will never be invoked"
Run a check on Create and surface failures inline. Block on:
- empty description
- description under ~15 words, or containing no trigger-shaped language

Warn (do not block) on:
- description that describes the agent's identity rather than the situation ("A senior tech lead who…") instead of the trigger ("Use this agent when…")
- two agents whose descriptions overlap heavily — name the other agent

The failure message must state the consequence in plain terms: the file will be created and valid, and the agent will never run. Silent creation of an uninvokable agent is the single worst outcome this modal can produce, because everything looks correct afterwards.

### B4. `DUTIES` → `SYSTEM PROMPT`
The body is the agent's system prompt. The label `Duties` induces a job-description register, and the current example proves it: *"He's responsible for code base… He doesn't write code himself"* — third person, about the agent, in the text the agent reads as instructions to itself.

- Rename the field to **System prompt**
- Hint: write to the agent — "You are…"
- Placeholder: `You are responsible for the codebase, infrastructure, and code design. You do not write code yourself; you delegate implementation and review the result.`
- Detect third-person phrasing ("He/She/They is/are…", "The agent…") and offer a one-click rewrite to second person, showing the result in the preview pane. **Offer, never auto-apply** — the user may have a reason, and silently rewriting their prompt is exactly the class of decision this app exists to avoid.

**Acceptance criteria — Block B**
- [ ] Create is disabled with an empty description, with the reason stated inline
- [ ] "When not to use it" compiles into the same `description` string and round-trips on edit
- [ ] Third-person detection offers a rewrite and never applies it unprompted
- [ ] Overlap warning names the conflicting agent and is dismissible
- [ ] Validation messages name consequences, not field states

**Stop here. Wait for review.**

---

## Block C — Tools and permissions

### C1. Fix the inverted default
The current control has all seven boxes ticked with the note *"Leave all unticked to inherit every tool."* Two states that read as identical in intent behave differently:

| Checkbox state | Frontmatter | Behavior |
|---|---|---|
| none ticked | `tools` omitted | inherits everything, **including tools and MCP servers added later** |
| all ticked | `tools: Read, Write, Bash, …` | frozen at today's set |

A user who ticks everything gets an agent that will not see an MCP server they connect next month, and no way to discover why.

Replace with an explicit mode selector:

```
◉ Inherit every tool          Picks up new tools and MCP servers automatically
○ Restrict to selected        Frozen at what you choose here
```

Default is **Inherit**. The checkbox grid appears only under `Restrict`.

### C2. Risk tiers
`Read files` and `Run commands — Shell access — build, test, git, anything` are currently the same visual weight. They are not the same decision. Introduce three tiers with distinct treatment (not color alone — pair it with an icon or a rule, for accessibility):

| Tier | Capabilities |
|---|---|
| Read-only | Read files, Search the web |
| Mutating | Write to files, Use skills, Plan and ask |
| Elevated | Run commands (arbitrary shell), Use subagents (spawns agents, nests up to 5 deep) |

Elevated capabilities get a one-line consequence beside them, always visible, not a tooltip.

### C3. Show the real tool names
The grouped labels are lossy — "Write to files" grants Write *and* Edit. The current escape hatch ("Exact tool names are editable in the Inspector afterwards") comes too late for a permissions decision. Each group expands in place to show the exact tool names it maps to. Keep the Inspector path as well.

### C4. Denylist
Add a `disallowedTools` input, available in both modes. This is the field that lets a user say "inherit everything except Bash" — durable and precise, which a whitelist is not. Validate that a tool is not in both lists.

**Acceptance criteria — Block C**
- [ ] Default is Inherit; frontmatter omits `tools` in that mode
- [ ] The checkbox grid is unreachable in Inherit mode
- [ ] Every group expands to its exact tool names
- [ ] Elevated tier is distinguishable without relying on color
- [ ] A tool in both `tools` and `disallowedTools` fails validation with a readable message
- [ ] Preview shows the exact `tools:` / `disallowedTools:` lines that will be written

**Stop here. Wait for review.**

---

## Block D — Model and runtime limits

### D1. Remove the provider dropdown
The footer says the modal creates `.claude/agents/<name>.md`. That is Claude Code; the provider is not selectable there. An `Anthropic` dropdown promises multi-provider support the format does not have. Remove it.

### D2. Add `inherit` — it is the format's default and the UI currently omits it

```
Model
◉ Inherit from the main session  (default)
○ Haiku    — fast and cheap
○ Sonnet   — balanced
○ Opus     — deepest reasoning
○ Pin a specific model ID  [____________]
```

Every agent created through the current modal is hard-pinned to one model, which is neither the format default nor usually what the user wants.

### D3. Runtime limits
Add `maxTurns` (optional, numeric) and `permissionMode` (select, options from the docs). Both need a one-line plain consequence. `maxTurns` is the only bound on an agent that loops; surface it near the Elevated tools rather than buried at the bottom.

**Acceptance criteria — Block D**
- [ ] No provider selector anywhere
- [ ] `inherit` is preselected on a new agent
- [ ] `model: inherit` is written explicitly, or omitted — pick one, document it in a code comment, and be consistent
- [ ] `maxTurns` and `permissionMode` round-trip

**Stop here. Wait for review.**

---

## Block E — Layout, preview, confirmation

### E1. Two-pane layout
Adopt the pattern from `TASKS_NODE_TAXONOMY_UI.md` Block B. Reuse the component; do not build a second one.

Left pane: identity → dispatch (description + when-not-to-use) → system prompt → runtime (model, tools, limits) → local-only (priority, nickname, avatar) grouped last and visually quieter.

Right pane: the exact `.claude/agents/tech-lead.md` content — full frontmatter plus body, syntax-highlighted, updating live at 150ms debounce.

The subagent frontmatter is subtle in a way node output is not: whether the agent will ever be invoked is legible only from the rendered `description`. **This modal needs the preview more than the node modal does.**

### E2. Ordering follows consequence
Reorder so that visual weight tracks impact. Dispatch fields come before the system prompt; local-only fields sit at the bottom in a visually distinct group. The current layout puts a required dispatch field in a thin optional-looking row and two cosmetic controls in the middle of real configuration.

### E3. Honest confirmation
- Footer currently reads `Creates .claude/agents/<name>.md`, which under-reports — with the memory toggle on, a directory is created too. List every path.
- Add the series' promise line, matching the node modal's wording exactly: **`Nothing is written until you confirm.`**
- After writing: a toast naming what was created with **Undo**. Button says "Create agent", toast says "Agent created" — same verb throughout.
- On partial failure, roll back everything and name the failing path.

### E4. Empty state teaches
Before the user types, the preview shows a complete worked example agent — a real `description`, a real second-person system prompt. Same principle as the node modal: show the artifact rather than describe it.

**Acceptance criteria — Block E**
- [ ] Preview component is shared with the node modal, not duplicated
- [ ] Preview reflects a keystroke within 200ms
- [ ] Footer lists every path that will be created
- [ ] No file or directory is written before confirm — verified by a test walking the full flow against a clean filesystem
- [ ] Undo removes every created path
- [ ] Local-only fields are visually grouped and quieter than compiling fields

**Stop here. Wait for review.**

---

## Block F — Migration and existing agents

- Existing Cowtext agents: drop `influence`; map `memory folder` to `memory` if it corresponds, otherwise mark it local-only
- Existing agents with an empty or weak `description` get flagged on the fleet rail with the same treatment as review-needed nodes, and open with the validation from B3 visible. Do not auto-generate descriptions.
- Import path: reading an existing `.claude/agents/*.md` written outside Cowtext must preserve unknown frontmatter fields verbatim on rewrite. Cowtext not knowing a field is not grounds for deleting it.

**Acceptance criteria — Block F**
- [ ] Unknown frontmatter fields survive a load → edit → save round-trip byte-identically
- [ ] Weak-description agents are findable in one action from the fleet rail
- [ ] No description is ever generated without the user asking

**Stop here. Wait for review.**

---

## Scope guards — do not do these

- Do not add dependencies. Stack is fixed: Tauri 2, React 18, TypeScript, React Flow, PixiJS 8, Zustand, Tailwind, Howler.js, Rust (axum, notify), SQLite.
- Do not auto-generate or auto-rewrite user prose — descriptions or system prompts. Detect and offer; never apply.
- Do not add multi-provider model support. This modal writes one format.
- Do not implement agent spawning, session management, or the fleet runtime. That is Phase 7 and is not approved here.
- Do not build a second preview component.
- Do not reintroduce `influence` under a different name.
- Do not delete frontmatter fields Cowtext does not recognize.

## Backlog — blocked until explicitly approved

- N1: agent templates / starter roster (code-reviewer, explorer, test-writer)
- N2: description quality scoring against invocation telemetry once the hooks feed exists
- N3: `hooks`, `mcpServers`, `isolation`, `background` frontmatter support
- N4: per-agent context subgraph binding (connects to the node graph — significant, spec separately)
- N5: detecting agents that exist on disk but were never invoked

---

## Definition of done

1. `npm run lint` and `npm run test` pass
2. No `any` introduced in touched files
3. It is not possible to create an agent that will never be invoked without an explicit, dismissed warning
4. Every field visible in the modal either appears in the preview or carries a `local only` badge — no third category
5. The filesystem is provably untouched until confirm