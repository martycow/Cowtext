# WO13 — Taxonomy Overhaul (nodes, edges, agent modal) + 7 acceptance defects

Status: **FROZEN 2026-08-21**, **AMENDED 2026-08-21 (Amendment 1, §21)**.
Source: `docs/INPUT_PROMPT.md` lines 9–961 (three refactor specs, 18 blocks, plus
Marty's 7 WO12 acceptance defects) and the approved plan
`read-input-prompt-md-and-do-warm-brook.md` including its post-approval
AMENDMENT.

> **Amendment 1 is normative and supersedes the text it names.** Marty overruled
> ASK 1 + ASK 5: the `.claude/commands/` emitter is **built this round** and
> `resolveLoad` rule 1 is **in force**. §3.1 and §3.5 are struck and replaced by
> §21. Every other section below already incorporates the amendment inline.

Where a spec and this codebase disagree, this contract wins and says why.
Where the plan and this contract disagree, this contract wins and says why (§3.6).

| | |
|---|---|
| Invoke commands | **74 → 75** (one new: `fs_apply_batch`) |
| Wire changes to existing commands | `compile_preview` gains `overlay`; `write_graph` gains a backup side-effect |
| `graph.json` schema | **v4 → v5**, one bump, two mirrored migrators |
| Preset format | **v4 → v5**, in lockstep (§5.7) |
| New dependency | **Vitest only** (approved exception) |
| Lanes | Stage 0 (serial) + 9 parallel |

**Fixtures** — hand-authored by tech-lead, owned by no lane, edited by no lane.
A lane that believes a fixture is wrong **stops and reports**; that is the only
thing keeping the two mirrors honest.

| File | Read by |
|---|---|
| `tests/fixtures/graph_v4_in.json` | Stage 0 (both migrators), R1 (§18.1 Part A) |
| `tests/fixtures/graph_v5_out.json` | Stage 0 (byte-equality golden, both languages) |
| `tests/fixtures/graph_v4_rule1_in.json` | R1 (§18.1 Part B, the enumerated rule-1 exception) |
| `tests/fixtures/resolve_load_cases.json` | R1 (`cargo test`), T1 (Vitest) |

Rust reaches them with
`concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/<name>.json")`; Vitest
reads them relative to the repo root. Neither path is under `src/` or
`src-tauri/src/`, so neither `tsconfig`'s `include` nor `cargo`'s module tree
picks them up accidentally.

---

## 1. Scope and coverage matrix

Every block and every defect maps to **exactly one** lane. Lane ids are defined
in §17.

### 1.1 Node Taxonomy Refactor (`INPUT_PROMPT.md` 19–344)

| Block | What lands | Lane |
|---|---|---|
| **N-A** Data model: role enum, load policy, `nodeTypes.ts`, migration | 14 roles / 5 groups (§6), `src/config/nodeTypes.ts`, TS migrator | **S0** (schema + migrators) + **T1** (`nodeTypes.ts`) |
| **N-B** Two-pane modal shell | `src/ui/TwoPaneModal.tsx` + `src/ui/PreviewPane.tsx` (§14.1) | **U1** |
| **N-C** Step 1 identity: tile grid, default Rule, filter, disambiguator | `NodeWizard.tsx` step 1 | **U1** |
| **N-D** Steps 2–3: load control, glob input, weight guard, `example` editor | `NodeWizard.tsx` steps 2–3 | **U1** |
| **N-E** Step 4: diff list, confirm, undo toast, rollback | `NodeWizard.tsx` step 4 + `fs_apply_batch` | **U1** (UI) / **R3** (command) |
| **N-F** Migration surface: banner, `needsReview` marker, filter | banner in `App.tsx`, filter in Inspector | **U4** (banner/filter) + **U2** (canvas marker) |
| **N-map** Compile mapping table (node spec scope line 22) — the `.claude/commands/` emitter + `classify_output` arm, per Amendment 1 §21 | `compile.rs::emit_commands` (§10.5) | **R1** |

### 1.2 Edge Model Refactor (`INPUT_PROMPT.md` 345–661)

| Block | What lands | Lane |
|---|---|---|
| **E-A** Edge data model: 5 kinds, `guard`, `deprecated`, derived load | §7, §8 | **S0** (schema) + **R1** (`resolve_load.rs`) + **T1** (`resolveLoad.ts`) |
| **E-B** Legality matrix | `src/config/edgeRules.ts` | **T1** |
| **E-C** Materializing `overrides` | precedence block in `compile.rs` (§10.4) | **R1** |
| **E-D** Graph linter | `src-tauri/src/lint.rs` (§11) | **R2** |
| **E-E** Edge UI: kind picker, guard control, edge inspector, draw feedback | `KindPicker.tsx`, `MemoryEdge.tsx`, `GraphCanvas.tsx` / Inspector EdgePanel | **U2** (canvas) + **U4** (Inspector E3) |
| **E-F** Migration + post-migration summary | §5 | **S0** (migrators) + **U4** (summary UI) |

### 1.3 Agent Modal Refactor (`INPUT_PROMPT.md` 663–961)

| Block | What lands | Lane |
|---|---|---|
| **A-A** Field audit + data model (`influence`, `local only`, identity) | `store/agents.ts`, `AgentEditor.tsx`, `assemble.rs` (§3.2) | **U3** + **R3** (the one `assemble.rs` line) |
| **A-B** Description as dispatch contract | `NewAgentDialog.tsx`, `AgentEditor.tsx` | **U3** |
| **A-C** Tools and permissions | `toolCatalog.ts`, `ToolPicker.tsx`, `frontmatter.rs` | **U3** + **R2** (frontmatter keys) |
| **A-D** Model + runtime limits | `modelCatalog.ts`, `AgentEditor.tsx` | **U3** |
| **A-E** Layout, preview, confirmation | agent modal on the shared shells | **U3** (consumes U1's shells) |
| **A-F** Migration and existing agents | weak-description flag on the rail; unknown-key preservation | **U3** + **R2** |

### 1.4 The 7 acceptance defects

| # | Defect | Lane |
|---|---|---|
| 1 | Git init missing from the Inspector | **U4** |
| 2 | Chosen branch is not the default branch after init | **already landed** — see §2.1; **R2** verifies only |
| 3 | Avatar click does nothing | **S0** (ContextMenu z-layer) + **U3** (call site) |
| 4 | Avatar churns while typing Name | **U3** |
| 5 | Assemble bar blinks instead of showing progress | **R3** (backend phases) + **U2** (stepper render) |
| 6 | Stale markdown after assemble | **U4** (Inspector) + **U3** (`bumpAgentReloadNonce` call) |
| 7 | Edge label below the line, washed out | **U2** |

---

## 2. Root causes — read from the code

### 2.1 Defect 2 is ALREADY LANDED — by lane R-GIT, this session

**Provenance, corrected (Amendment 1):** the `WO13 fix` comments in
`src-tauri/src/git.rs` are **lane R-GIT's work, landed in parallel with this
contract during the same session** — they are *not* pre-existing tree state and
must not be recorded as such in `docs/fleet/ACTIVITY_LOG.md`. The conclusion is
unchanged: `git.rs` is write-forbidden (§16) and defect 2 is out of every build
lane's scope, verification only.

`src-tauri/src/git.rs` carries three `WO13 fix` comments (`:91-93`, `:98-102`,
`:128-140`) and both root causes are repaired:

- `is_repo_at` (`git.rs:141-154`) now compares `rev-parse --show-toplevel`
  against `root` instead of trusting `--is-inside-work-tree`, so a project
  nested under an outer repo no longer short-circuits.
- `probe_status` (`git.rs:193-208`) uses `symbolic-ref --short HEAD`, which
  reports an unborn branch.
- `git_init` (`git.rs:266-289`) already takes `branch: Option<String>`,
  validates it through `worktree::validate_branch`, and applies it with
  `symbolic-ref HEAD refs/heads/<name>` immediately after `git init`, only when
  the repo did not already exist (WO11 D1b preserved).
- `src/git/api.ts:24-26` already sends `{ root, branch }`.

**Therefore defect 2 is out of every build lane's scope.** R2 owns one
verification gate only (§18.9). No lane may re-edit `git.rs`. If Marty's walk
still fails, that is a new finding against R-GIT, not this contract's item.

### 2.2 Defect 1 — CONFIRMED

`src/inspector/ProjectPanel.tsx:283` renders the literal sentence
*"Manage git from the project row's context menu."* and the panel takes no
`onOpenGit` prop. The prop already exists and is threaded through
`App.tsx:844,849,885,1163` → `rail/Hierarchy.tsx:124,128,161,511,515,640`.
**Fix:** thread `onOpenGit` one level further into `ProjectPanel`; replace the
sentence with a real `Git…` button in the `project.git` section
(`sectionOrder.tsx`, WO11 §5.3).

### 2.3 Defect 3 — CONFIRMED

`src/ui/ContextMenu.tsx:126` hard-codes `z-dropdown` (100,
`tailwind.config.js:137`) on a `position: fixed` portal;
`src/tasks/NewAgentDialog.tsx` renders at `z-modal` (200). The menu mounts and
paints behind the modal. `ToolPicker.tsx` has the same latent bug in any modal.
**Fix:** `ContextMenu` gains `layer?: "dropdown" | "modal" | "toast"`
(default `"dropdown"`), landed in **Stage 0** so both consumers can build.

### 2.4 Defect 4 — CONFIRMED

`NewAgentDialog.tsx:113-116` re-slugs `fileName` from `name` on every keystroke
unless `fileNameTouched`; `:119` derives `memoryStem` from it; `:269` passes
`seed={avatarSeed ?? memoryStem}`. Every keystroke reseeds the identicon.
**Fix:** freeze the seed in state on first open (`useState(() => memoryStem)`),
re-derive **only** on an explicit `Reset seed` menu action or a direct
`fileName` edit (`fileNameTouched === true`).

### 2.5 Defect 5 — CONFIRMED, and the backend genuinely has no progress data

`AssembleProgress` (`assemble.rs:75-82`) is exactly
`{ node_id, status: String, error: Option<String> }` — **there is no `mode`
field**, contrary to the `cowtext-terminology` skill's claim. The runner is
one-shot and non-streaming: `claude -p --output-format json` +
`child.wait_with_output()` (`assemble.rs:751-781`), so a job emits exactly three
events (`pump`, `assemble.rs:454-478`). `MemoryNodeCard.tsx:408-416` therefore
renders a fixed-width `animate-hard-blink` bar with nothing behind it.
**Fix:** ruling §3.3.

### 2.6 Defect 6 — CONFIRMED

`Inspector.tsx:1728` mounts `FileMarkdownTab` for plain files and `:1725`
`AgentMarkdownTab` for agent files. Neither reacts to a terminal assemble
event: the `"assembled"` status reaches only `setAssembleStatus`, and
`useProjectStore.applyFsChange` updates `modifiedMs`/`sizeBytes` only.
`bumpAgentReloadNonce` exists as a declared seam and its own doc comment says
*"Not called anywhere yet"* (`store/agents.ts:144-147`).
**Fix:** on a terminal `assembled` event — re-issue `read_md_file` in
`FileMarkdownTab` (U4); call `bumpAgentReloadNonce(fileName)` for agent files
(U3). The subscription lives in the component, never in the store.

### 2.7 Defect 7 — CONFIRMED, two independent causes

**(a) The chip never reads the wire's colour.** `MemoryEdge.tsx:469-474` derives
`borderColor` from `isSelected`/`related` only, falling back to
`var(--plate-edge)`, and `color` from `isSelected` only. `edgeStroke(kind, color)`
(`edgeColor.ts:56-61`) already exists and is what the wire and the markers use.

**(b) The first displaced chip always goes down, by ~20px.**
`labelSlots.ts:66-68` builds `candidates = step === 0 ? [y] : [y + step*LABEL_STEP, y - step*LABEL_STEP]` and takes `.find()`, so `+step` always wins.
`LABEL_STEP = 4` (`:28`) but `overlaps` (`:40-44`) requires
`dy >= (h_a + h_b)/2 + 2` — for a ~14px chip that is ~16px, so the first free
slot is step 5, i.e. **+20px**. The file's own doc comment at `:53-55` claims
the search alternates sides; the implementation does not.

**On the trigger.** Marty reports this *after* a colour change. Cause (a) is
fully explained by static reading; cause (b) is a pre-existing displacement that
becomes glaring once the wire is bright and the chip stays grey 20px below it.
I could not prove statically that a colour change *causes* a new displacement —
`reportBox`'s deps (`MemoryEdge.tsx:342`) are `[id, labelX, labelY, label.text, reportBox]`,
none of which a colour change moves. **Do not write a fix that assumes it does.**
Fix (a) and (b); add `props.data?.color` and `kind` to the `reportBox` deps as a
correctness guard only.

### 2.8 `influence` is not local-only — CONFIRMED

`assemble.rs:587-589` writes `- Influence: {influence}` into the agent boot
prompt. The value is read from the `.cowtext/agents.json` sidecar via
`agent_meta_facts` (`assemble.rs:373, 407-408`) into `AgentFacts.influence`
(`assemble.rs:176`). See ruling §3.2.

---

## 3. Rulings

### 3.0 D9 — the subagent docs verdict (RECORDED VERBATIM, binding)

The agent spec's line 675 required fetching `https://code.claude.com/docs/en/sub-agents`
before any Block A code, and said **the docs win**. The fetch was performed by
tech-lead on 2026-08-21. Verdict:

**The spec was RIGHT about:** `description` is required — a file whose YAML
parses but carries no `description` is **skipped and logged to the debug log**.
That is worse than the spec's B3 claims: the agent does not merely go
un-delegated, **it does not load at all**. `model` defaults to `inherit`.
Omitting `tools` inherits every tool, including MCP servers.

**The spec was WRONG or incomplete about:**

- **`memory` is a string enum `user | project | local`, NOT an object.** The
  spec's `memory?: MemoryConfig` (A2) is wrong. Docs win.
- **`color` exists** (`red|blue|green|yellow|purple|orange|pink|cyan`) and the
  spec omits it entirely. **Ruling: ADOPT** — it is a one-line scalar, it
  round-trips through `frontmatter.rs` today as `FmLine::Extra`, and promoting
  it to a known key costs one enum arm.
- **`model` also accepts `fable`.** `modelCatalog.ts` already lists
  `claude-fable-5` (WO11 §5.6); the alias `fable` joins `ALIAS_MODELS`.
- **`disallowedTools` is applied FIRST, before `tools` is resolved.** C4's
  validation message must therefore say *"`Bash` is in both lists — the denial
  wins, so this agent will not have `Bash`. Remove it from one list."* — not
  "these contradict".
- Both `tools` and `disallowedTools` accept MCP patterns `mcp__<server>` and
  `mcp__<server>__*`. `toolCatalog.ts:129-131 isMcpTool` currently matches only
  the `mcp__` prefix; it must accept the `__*` suffix form as valid too, and
  must be applied to `disallowedTools` entries as well.
- **`permissionMode` values are `default | acceptEdits | auto | dontAsk |
  bypassPermissions | plan`**, with precedence: a parent on `bypassPermissions`
  or `acceptEdits` cannot be overridden by the child, and a parent in `auto`
  mode makes the frontmatter field **ignored**. The one-line consequence copy
  (D3) must say that, not describe the enum.
- The full field set also includes `mcpServers`, `hooks`, `background`,
  `effort`, `isolation`, `initialPrompt`. **These stay backlogged (agent spec
  N3).** They already round-trip today as `FmLine::Extra`
  (`frontmatter.rs:103-106, 348, 375`) and **that must not regress** — see the
  §18 R2 gate.

### 3.1 D6 — **STRUCK by Amendment 1. See §21.**

The original ruling deferred the `.claude/commands/` emitter and required the
preview to show only destinations the compiler already produced. **Marty
overruled it: the emitter is built this round.** §21.1–§21.5 replace this
section in full.

The one part of the original ruling that **survives** and is still binding:
`.claude/rules/api-conv.md` (the other path in the node spec's mockup) does not
exist in Claude Code or in this repo and is **not** created. When a selected
target has no mapping for the current role, the preview pane says so in the
spec's own words (B2, line 207) — name the target, say the mapping is missing.
**Never fabricate a path.**

### 3.2 D8 — delete the boot-prompt line so the `local only` badge is true

**RULING — CONFIRMED by Marty 2026-08-21.**

Marty ruled *"keep `influence`, badge it `local only`"*. It is not local-only
(§2.8). A `local only` badge on the first field the agent spec's A3 rule touches
would be a lie, and A3's entire point is that inconsistency is worse than
absence.

**Frozen (lane R3):** delete `assemble.rs:587-589`, delete the `influence` field
from `AgentFacts` (`assemble.rs:176`) and from `agent_meta_facts`'s return tuple
(`:373, :407-408`), and update `assemble/tests.rs:821-854`. The field survives in
`.cowtext/agents.json` and in the slider, and carries the `local only` badge.

Deleting the last reader is required, not optional: leaving `AgentFacts.influence`
constructed-but-unread makes `cargo clippy -- -D warnings` fail on
`field is never read`.

**Consequence of the alternative:** keep the line, drop the badge for this one
field — which is exactly the "one of four non-compiling controls is marked"
state A3 identifies as the defect.

### 3.3 Defect 5 — phases + elapsed, not a runner rewrite

**RULING — CONFIRMED by Marty 2026-08-21.**

`AssembleProgress` gains `phase` and `started_at`; the runner stays one-shot.

```rust
pub struct AssembleProgress {
    pub node_id: String,
    pub status: String,   // unchanged: "queued" | "running" | "assembled" | "error"
    pub phase: String,    // "queued" | "starting" | "running" | "writing" | "done" | "error"
    pub started_at: Option<u64>,  // epoch ms; Some from "starting" onward
    pub error: Option<String>,
}
```

`status` is **unchanged and still authoritative** for `setAssembleStatus`
(`store/graph.ts`) — `phase` is additive telemetry. Emission points:
`enqueue` → `queued`; `pump` (`assemble.rs:454-458`) → `starting` before
`run_job`, then `running` once the child is spawned; inside `run_job`
(`assemble.rs:499-515`) → `writing` after `runner.run(...)` returns and before
`write_atomic`; then `done`/`error`. `run_job` takes the `Sink` as a new
parameter.

The card renders a **3-step stepper** (`starting → running → writing`) with a
live `mm:ss` elapsed readout from `startedAt`. No percentage is invented.

**Consequence of the alternative** (rewriting the runner onto
`--output-format stream-json`): a full rewrite of `assemble.rs:728-807` plus its
Runner fakes, in a lane unrelated to taxonomy, and it still yields no percentage
because there is no denominator. Backlogged as its own work order naming
`sessions.rs` as the reference implementation (§19).

### 3.4 `pushToast` stays frozen; a sibling is added

**RULING — CONFIRMED by Marty 2026-08-21.** This is the one frozen seam WO13
touches.

`src/store/toasts.ts:7-12` declares `pushToast`'s signature FROZEN. All three
specs want a toast with **Undo**.

**Frozen (Stage 0):**

```ts
export interface ToastAction { label: string; run: () => void | Promise<void> }
export interface Toast { /* …unchanged… */ action?: ToastAction }
export function pushToast(t: {severity; title; detail?; timeoutMs?}): string;          // BYTE-IDENTICAL
export function pushToastWithAction(t: {severity; title; detail?; timeoutMs?; action: ToastAction}): string;
```

`pushToast` delegates to the store exactly as today. Every existing call site
stays byte-identical.

**One consequence to handle, or Undo breaks:** `dedupeKey`
(`toasts.ts:56-58`) hashes `severity|title|detail` only. Two "Node created"
toasts within `DEDUPE_WINDOW_MS` (2000ms) collapse into one — and the second
one's Undo closure is discarded, so the user's Undo reverts the *wrong* write.
**Frozen: a toast carrying an `action` is never deduped.** `push` skips the
dedupe lookup when `t.action !== undefined`.

**Consequence of the alternative** (widening `pushToast` itself): every one of
its existing call sites becomes a site the audit must re-read, for zero gain.

### 3.5 `resolveLoad` rule 1 — **STRUCK by Amendment 1. Rule 1 is IN FORCE. See §21.**

The original ruling deferred rule 1 because applying it removes a pinned
`command`/`skill` node from `## Always read` and from `.cursor/rules`, breaking
the unqualified byte-identical gate. **Marty overruled it.** That output change
is now *intended*; §21 replaces this section and §18.1 is amended to an
**enumerated** exception rather than an unqualified one.

`ResolvedLoad` regains `on-invoke` (§8.1). `NodeTypeMeta` regains `loadLocked`
(§6.3). The two `edgeRules.ts` deny rules **stay** — they are now belt *and*
braces: the resolver makes the policy real, the deny rules stop the user drawing
an edge whose intent the resolver will silently ignore.

### 3.6 Three further deviations from the approved plan — ALL RATIFIED 2026-08-21

**(a) `needsReview` is a NODE field only — edges never carry it.** Walking the
migration table (§5.3) under amendment 4's rule, no edge conversion is a guess:
`conditional`→`imports`+`guard` preserves the condition text verbatim in either
guard form, and `conflicts-with`→`contradicts` is a canonical-form projection.
The two cases the edge spec flags (`overrides` co-residency, free-text
conditions) are "verify this is still right", which amendment 4 sends to lint.
Adding a wire field that nothing ever sets is dead schema. **Consequence:** the
edge spec's Block F acceptance *"Review-needed edges are findable in one action"*
is satisfied by the review filter over **nodes** plus the Problems panel.

**(b) The `always` rule is a CLOSURE FROM ROOTS, not a local edge test.** The
brief (and edge spec A4 rule 3) states it locally: *"has at least one incoming
`imports` edge without a guard → `always`"*. That is wrong for this codebase.
`effective_pinned` (`compile.rs:670-692`) seeds from `pinned` nodes and walks
outward; a node imported by an *unpinned, orphaned* node is **not** in the set
today. The local rule would newly pin it, changing output. Frozen resolution in
§8.2 rule 4. Fixture case `unreachable-import` pins it.

**(c) The "omit the `@path` pointer when the target is already inlined"
optimization is OUT.** Edge spec A4 asks for it. `on_demand_bullets`
(`compile.rs:858-884`) emits a `references` bullet today regardless of whether
the target is pinned; suppressing it changes existing output. Backlogged (§19).
`resolveLoad` still answers `always` for such a node, so E3's one-sentence
explanation is correct.

---

## 4. The v5 wire shape

**Field declaration order IS the wire order.** It must be identical in
`stableNode`/`stableEdge` (`src/store/graph.ts:189-222`) and the Rust structs
(`src-tauri/src/project.rs:474-533`). `guard` is nested; its inner key order is
frozen too.

### 4.1 `MemoryNode` (v5)

| # | Key | Type | Omit at default? |
|---|---|---|---|
| 1 | `id` | `string` | no |
| 2 | `title` | `string` | no |
| 3 | `role` | `NodeRole` (14, §6.1) | no |
| 4 | `brief` | `string` | no |
| 5 | `filePath` | `string` | no |
| 6 | `readOrder` | `number` | no |
| 7 | **`rootLoad`** | `"always"` \| absent | **yes** — absent ⇒ on-demand |
| 8 | `position` | `{x,y}` ints | no |
| 9 | `scenePos` | `{tx,ty}` | yes |
| 10 | `lastVerified` | `string` | yes |
| 11 | `tags` | `string[]` | yes (empty ⇒ absent) |
| 12 | `owner` | `string` | yes (`""` ⇒ absent) |
| 13 | **`deprecated`** | `{replacedBy, since?, reason?}` | yes |
| 14 | **`needsReview`** | `true` \| absent | **yes** (`false` ⇒ absent) |
| 15 | `meta` | `Record<string, unknown>` | yes (empty ⇒ absent) |

`rootLoad` takes slot 7 — exactly where `pinned` was — and is a **single-variant
optional enum**: the only legal value is `"always"`; "on-demand" is expressed by
absence. This makes the two-serializer parity landmine unrepresentable. Rust:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RootLoad { Always }
...
#[serde(default, skip_serializing_if = "Option::is_none")]
pub root_load: Option<RootLoad>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub deprecated: Option<Deprecated>,
#[serde(default, skip_serializing_if = "std::ops::Not::not")]
pub needs_review: bool,
```

TS `stableNode` mirror:
`...(n.rootLoad === "always" ? { rootLoad: "always" as const } : {})`,
`...(n.deprecated !== undefined ? { deprecated: stableDeprecated(n.deprecated) } : {})`,
`...(n.needsReview === true ? { needsReview: true } : {})`.

`Deprecated` inner order, frozen: **`replacedBy`, `since?`, `reason?`**.
`since` is `YYYY-MM-DD`. `since` and `reason` are omitted when absent/empty.
**Migration never stamps `since`** (§5.5). Only a user-initiated deprecation in
the UI does, and only the TS side computes the date — Rust never calls `now()`
for it.

The UI presents a two-option `Root load` control (`Always` / `On demand`);
`On demand` writes `undefined`.

### 4.2 `MemoryEdge` (v5)

| # | Key | Type | Omit at default? |
|---|---|---|---|
| 1 | `id` | `string` | no |
| 2 | `source` | `string` | no |
| 3 | `target` | `string` | no |
| 4 | `kind` | `EdgeKind` (5, §7.1) | no |
| 5 | **`guard`** | `EdgeGuard` | yes |
| 6 | `note` | `string` | yes (`""` ⇒ absent) |
| 7 | `color` | `string` | yes (`""` ⇒ absent) |
| 8 | `waypoints` | `{x,y}[]` | yes (empty ⇒ absent) |

`guard` takes slot 5 — exactly where `condition` was.

```ts
export type EdgeGuard =
  | { type: "glob"; globs: string[] }
  | { type: "description"; text: string };
```

Inner key order, frozen: **`type` first**, then `globs` (glob) or `text`
(description). Rust: `#[serde(tag = "type", rename_all = "lowercase")]` on an
enum `EdgeGuard { Glob { globs: Vec<String> }, Description { text: String } }`.
serde emits the tag first, matching TS object-literal order. A glob guard with
an empty `globs` array is invalid and is normalized away by migration; the UI
must not be able to create one.

**No `edge.order` field.** `MemoryNode.readOrder` exists and `total_order`
already tie-breaks on `(readOrder, id)` (`compile.rs:605-619`). A second
ordering axis with no compiler support is exactly the control the agent spec's
A3 condemns. (Amendment 5, ratified.)

### 4.3 `BarnGraph` (v5)

Unchanged shape: `version`, `projectName`, `nodes`, `edges`, `compileTargets`.
`GRAPH_VERSION = 5` in both `project.rs:296` and `graph.ts:169`.

---

## 5. The migration algorithm

`migrate_graph` (`project.rs:606-657`) is **not a version chain** — it is a set
of `serde_json::Value` pre-passes keyed on string values, running
unconditionally on every load regardless of the input's `version`. Its TS mirror
`migrateGraph` (`graph.ts:266-287`) has the same character.

**Idempotence law.** Every pass must be either
**(a)** keyed on a value or key that no longer exists after it runs, or
**(b)** a projection onto a canonical form (a fixed point by construction).
A pass that is neither is a defect.

### 5.1 The ordered pass list — identical in both languages

Run in exactly this order, over the parsed `Value`, before typed
deserialization.

| # | Pass | Law |
|---|---|---|
| 1 | Version range check: reject `< 1` or `> 5` | — |
| 2 | `nodes`/`edges` present and arrays, else reject | — |
| 3 | **node.role:** `"persona"` → `"agent"` | (a) |
| 4 | **node.role:** apply the v4→v5 rename table (§6.2) | (a) |
| 5 | **node.role:** any value not in the 14 v5 roles → `"architecture"`, set `needsReview: true` | (a) |
| 6 | **node.pinned → node.rootLoad:** `pinned === true` ⇒ set `rootLoad: "always"`; delete the `pinned` key in every case | (a) |
| 7 | **node.rootLoad:** any value other than `"always"` ⇒ delete the key | (b) |
| 8 | **edge.kind:** `"conditional"` → `"imports"` + build `guard` from `condition` (§5.4); delete the `condition` key in every case | (a) |
| 9 | **edge.kind:** `"supersedes"` → delete the edge; set `target.deprecated` + `target.needsReview` (§5.5) | (a) |
| 10 | **edge.kind:** `"conflicts-with"` → `"contradicts"` | (a) |
| 11 | **edge.kind:** any value not in the 5 v5 kinds → `"references"` | (a) |
| 12 | **edge:** delete `guard` on any `contradicts` edge; delete `waypoints`/`note`? **no** — only `guard` is illegal on `contradicts` | (b) |
| 13 | **contradicts normalization + dedupe** (§5.6) | (b) |
| 14 | **compileTargets:** drop unrecognized entries (unchanged from v4) | (b) |
| 15 | Typed deserialization; stamp `version = 5` | — |

Pass 5's fallback changes from `"reference"` (v4, `project.rs:630`) to
`"architecture"` because `reference` no longer exists. `preset/types.ts:139`'s
`asRole` fallback changes identically (§5.7).

Pass ordering is load-bearing: pass 4 must run before pass 5 or every renamed
role would first be seen as unknown; pass 8 must run before pass 11 or every
`conditional` would be flattened to `references` and its condition lost; pass 10
before 11 for the same reason.

### 5.2 `needsReview` is set ONLY where a value was actually rewritten

A review flag on an *unchanged* value re-fires on every load and breaks the
idempotence criterion both specs require. Exactly four rules set it, all on
nodes:

1. role `reference` → `architecture`
2. role `task` → `workflow`
3. role unrecognized → `architecture`
4. the node became `deprecated` via a `supersedes` edge

Everything else the specs asked to flag becomes a **lint check** (§11):

| Spec's flag | Becomes |
|---|---|
| `command` → `command` vs `env` (node A4) | lint `command-may-be-env` — the migrator has no filesystem access (`migrate_graph(raw: &str)`, `migrateGraph(data: unknown)`), so it **cannot** sniff the body for `$ARGUMENTS`. The spec's rule is not implementable in a migrator. |
| `overrides` co-residency (edge F) | lint `override-not-co-resident` |
| free-text `conditional` (edge F) | nothing — the text is preserved verbatim as a `description` guard |

### 5.3 Edge conversion table

| v4 kind | v5 result | `needsReview` |
|---|---|---|
| `imports` | `imports` | no |
| `references` | `references` | no |
| `sequence` | `sequence` | no |
| `overrides` | `overrides` | no — lint instead |
| `conditional` | `imports` + `guard` (§5.4) | no |
| `supersedes` | edge deleted, target node deprecated (§5.5) | **yes, on the node** |
| `conflicts-with` | `contradicts`, normalized + deduped (§5.6) | no |

### 5.4 `conditional` → `imports` + `guard`

`condition` is classified by the **same predicate the compiler already uses**:
`is_glob(c)` — *no whitespace AND at least one of `*`, `?`, `[`, `/`*
(`compile.rs:696-699`).

- glob ⇒ `guard: { type: "glob", globs: [condition] }`
- otherwise ⇒ `guard: { type: "description", text: condition }`
- absent or empty `condition` ⇒ **no guard at all** (a bare unguarded `imports`)

**The predicate must exist exactly once per language.** Frozen:

- Rust: moved to `project.rs` as `pub fn is_glob_condition(&str) -> bool`
  (Stage 0). `compile.rs`'s private `is_glob` is deleted and re-pointed (R1).
- TS: `export function isGlobCondition(c: string): boolean` in
  `src/store/graph.ts` (Stage 0). `src/config/*` imports it; no lane may
  re-derive it.

### 5.5 `supersedes` → `deprecated`

For each `supersedes` edge `S → T`, in **byte order of edge id**:

- if `T` has no `deprecated` yet, set
  `T.deprecated = { replacedBy: S }` — **`since` and `reason` omitted**
- set `T.needsReview = true`
- delete the edge

`since` is omitted because Rust and TS would each stamp their own `now()`,
producing different bytes for the same graph and breaking the byte-identical
serializer pair (amendment 3, ratified). If `T` is superseded twice, the
lowest-id edge wins and the second is still deleted.

### 5.6 `contradicts` normalization

1. For every `contradicts` edge, if `source > target` byte-wise, swap them.
2. Group by `(source, target)`; keep the edge with the **lowest id in byte
   order** and **delete every other edge in the group outright** — including its
   `note`, `color` and `waypoints`. A collapsed reciprocal pair loses the
   discarded edge's decorations; that is the frozen behaviour, exercised by
   `graph_v4_in.json`'s `e09-x`.
3. Delete `guard` from every `contradicts` edge (illegal per edge spec A2).

Both steps are fixed points, so re-running is a no-op (law (b)).

### 5.7 Preset format v4 → v5, in lockstep

`src/preset/types.ts` is a **second schema with its own version**
(`PRESET_VERSION = 4`, `:76`) that mirrors the graph shape. Neither spec nor the
plan named it. Left alone it is a **silent data-corruption path**: `asRole`
(`:138-140`) falls back to `"reference"` when the value is not in `NODE_ROLES`,
so a v4 preset carrying `role: "rules"` would load as `architecture`-fallback
instead of `rule`, and `asKind` (`:142-144`) would flatten `conditional` to
`references`, dropping the guard.

**Frozen (lane T1):**

- `PresetVersion` becomes `1 | 2 | 3 | 4 | 5`; `PRESET_VERSION = 5`.
- `PresetNode.pinned` → `rootLoad?`; `PresetEdge.condition` → `guard?`; both
  nodes gain `deprecated?` / `needsReview?`.
- `parsePreset` applies **the same §5.1 pass list** to node roles and edge kinds
  before `asRole`/`asKind` run. `asRole`'s fallback becomes `"architecture"`;
  `asKind`'s stays `"references"`.
- `src-tauri/src/preset.rs:70-72` accepts version `1..=5`.
- `src/preset/starter.ts` currently ships `role: "task"` (`:74`) and
  `role: "reference"` (`:83, :91`) — **all three roles are removed in v5.**
  Frozen replacements: Task Board → `workflow`; Backlog → `architecture`;
  Changelog → `architecture`. `pinned: false` (`:55`) → omit `rootLoad`.

### 5.8 `.cowtext/graph.v4.bak.json`

Migration is irreversible and `migrate_graph` hard-rejects `version > GRAPH_VERSION`
(`project.rs:613-615`), so an older build opening a v5 graph errors rather than
downgrading. One backup, written by Rust, once.

**Frozen: the backup is taken inside `write_graph` (`project.rs:705-709`)**, not
`read_graph`. `write_graph` is the only place that holds the pre-migration bytes
on disk immediately before overwriting them, and it is already the sole writer.

```
write_graph(root, content):
  path = root/.cowtext/graph.json
  bak  = root/.cowtext/graph.v4.bak.json
  if path.is_file() and not bak.is_file():
      old = read(path)
      if serde_json::from_str(old)["version"].as_u64() <= 4:
          write_atomic(bak, old)          # Err here aborts the whole command
  write_atomic(path, content)
```

Never overwrite an existing backup. A failed backup is a hard `Err` — the
irreversible write does not proceed.

---

## 6. The 14 roles and 5 groups

### 6.1 The role set

```ts
export type NodeGroup = "identity" | "constraints" | "structure" | "process" | "knowledge";

export type NodeRole =
  | "agent"                                          // identity  (1)
  | "rule" | "invariant" | "trap"                    // constraints (3)
  | "architecture" | "decision"                      // structure (2)
  | "workflow" | "command" | "skill" | "env" | "tool"// process (5)
  | "glossary" | "example" | "style";                // knowledge (3)
```

14 roles, 5 groups (1+3+2+5+3). `NODE_ROLES` declares them in exactly this
order; `project.rs`'s `NodeRole` enum and `NODE_ROLES: [NodeRole; 14]` mirror it
in the same order.

`agent` is the 14th role, kept **outside the four pickable groups**. Rationale
read from the code: `compile.rs:110-114` branches on `RoleIn::is_agent()`, and
`src/wizard/roles.ts:21` already blocks it in the wizard. Dropping it would
orphan every `.claude/agents/*.md` node. `WIZARD_BLOCKED_ROLES` stays `["agent"]`
and `WIZARD_ROLE_GROUPS` (`roles.ts:44-47`) drops the now-empty `identity`
group exactly as it drops `Identity` today. **Result: 14 roles, 13 pickable.**

`WIZARD_FALLBACK_ROLE` changes from `"reference"` to `"architecture"`.

### 6.2 v4 → v5 role migration table

| v4 role | v5 role | `needsReview` | Note |
|---|---|---|---|
| `agent` | `agent` | no | |
| `rules` | `rule` | no | pure rename |
| `architecture` | `architecture` | no | |
| `workflow` | `workflow` | no | |
| `task` | `workflow` | **yes** | tasks have a lifecycle; context nodes do not |
| `reference` | `architecture` | **yes** | the real type is unknowable |
| `glossary` | `glossary` | no | |
| `command` | `command` | no | the `env` question moves to lint (§5.2) |
| `invariant` | `invariant` | no | |
| `trap` | `trap` | no | |
| `skill` | `skill` | no | |
| `snippet` | `example` | no | rename |
| `style` | `style` | no | |
| *anything else* | `architecture` | **yes** | |

New roles with no v4 predecessor: `decision`, `env`, `tool`. They are reachable
only by user choice.

### 6.3 `nodeTypes.ts` — the single source of truth

`src/config/nodeTypes.ts` exports one array driving the tiles, glyphs, colours,
preview and defaults. No role metadata may be duplicated anywhere else;
`src/canvas/roleMeta.ts` becomes a thin re-export of `ROLE_DESCRIPTIONS`-shaped
views derived from it (its consumers — `NodeWizard.tsx:21,177`, the Inspector's
RolePopup — keep working unchanged).

```ts
export type NodeDefaultLoad = "always" | "on-demand" | "on-glob" | "on-invoke";

export interface NodeTypeMeta {
  role: NodeRole;              // NOT `type` — this repo's field is `role`
  group: NodeGroup;
  label: string;
  hint: string;                // <= 60 chars, plain language
  microExample: string;        // MANDATORY, a concrete instance, never a definition
  accent: string;              // token NAME, e.g. "--role-rule". Never a hex literal.
  defaultLoad: NodeDefaultLoad;
  loadLocked: boolean;         // true ⇔ resolveLoad rule 1 governs this role (§8.2)
  lockedReason?: string;       // required iff loadLocked; shown as the read-only badge
}
```

`defaultLoad` is a **UI hint only** for the 12 roles where `loadLocked === false`
(edge spec A4's own words). For those it never affects compilation; it decides
which edge kind is preselected when the user draws an edge into a node of that
role:

| `defaultLoad` | preselected edge |
|---|---|
| `always` | `imports`, no guard |
| `on-glob` | `imports` + empty glob guard (glob field focused) |
| `on-demand` | `references` |
| `on-invoke` | `references`, plus the inline note "Commands run when you call them" |

Defaults, frozen: `rule` `always` · `invariant` `always` · `trap` `always` ·
`architecture` `on-demand` · `decision` `on-demand` · `workflow` `on-demand` ·
`command` `on-invoke` · `skill` `on-demand` · `env` `always` · `tool` `always` ·
`glossary` `on-demand` · `example` `on-glob` · `style` `on-glob` ·
`agent` `on-demand`.

**`loadLocked` is `true` for exactly two roles — `command` and `skill`** — and
`false` for the other twelve. Amendment 1 makes the lock real: `resolveLoad`
rule 1 (§8.2) returns `on-invoke` for `command` and `on-demand` for `skill`
*regardless of edges and regardless of `rootLoad`*, and the compiler honours it
(§10.5). The badge is therefore a true statement, not a claim the compiler
ignores.

`lockedReason`, frozen copy:
`command` → **"Commands only run when you call them."**
`skill` → **"Skills load themselves when they're relevant."**

Where `loadLocked === true`, step 2 renders a read-only badge with that reason
instead of the segmented control (node spec D1), and the root-load control is
absent — not disabled, absent. `rootLoad` may still be *stored* on such a node
(a migrated `pinned: true` command keeps `rootLoad: "always"` on the wire).

**One honest caveat the UI must carry, or the badge over-claims.** `rootLoad` is
never consulted for a locked role in the Claude-family outputs, but it **is**
still consulted for `.cursor/rules` (§10.5, F11: Cursor has no invoke mechanism,
so rule 1 does not reach `emit_cursor`). So when a `command`- or `skill`-role
node has `rootLoad: "always"` **and** `cursor` is a compile target, the badge's
reason line gains one sentence:
**"Cursor has no equivalent, so this still applies to every Cursor request."**
Rendered only in that exact combination. The Inspector's E3 sentence shows the
resolved policy and its reason regardless, so the split is visible rather than
silent — which is the whole point of A3.

The `imports → command` / `imports → skill` **deny** rules in `edgeRules.ts`
stay. They are the draw-time half: they stop the user creating an edge whose
intent the resolver will then ignore.

`microExample` is mandatory and non-empty for all 14 — enforced by a Vitest
assertion (§18.5), not by review.

---

## 7. Edges: kinds, guards, legality

### 7.1 The kind set

```ts
export type EdgeKind = "imports" | "references" | "overrides" | "sequence" | "contradicts";
export const EDGE_KINDS = ["imports", "references", "overrides", "sequence", "contradicts"] as const;
```

Rust `EdgeKind` mirrors this order. Wire spelling stays kebab-case-compatible;
all five are single words so `rename_all = "kebab-case"` is unchanged.

`guard` is legal on `imports`, `references`, `overrides`, `sequence`
(any structural kind, per edge spec E2) and **illegal on `contradicts`**.
Practically, only `imports` guards affect compiled output today; a guard on
`sequence`/`overrides` is accepted, stored, rendered dashed, and reported by
lint as having no effect (`edge-legality-warning`).

### 7.2 `contradicts` is symmetric

Stored as an ordered pair with `source < target` byte-wise. Creating `(B,A)`
when `(A,B)` exists is a **no-op**, not a duplicate — enforced in the store's
`addEdge` action (Stage 0), so paste, undo/redo and preset-apply all go through
it. Rendered with **no arrowhead** (a plain marker at both ends).

### 7.3 `src/config/edgeRules.ts` — the legality matrix

> **AMENDMENT 3 (2026-08-21) — the deprecated-target deny is a PRECONDITION,
> not a table row.** Found by R2 while writing a D12 regression test, confirmed
> by tech-lead. As originally frozen, `@deprecated` scored **1** — the lowest
> score in the table — so **all twelve** other rules outranked it and the guard
> survived only when nothing else matched: five role-pair rows silently
> `allow`ed an edge into a deprecated node, two `warn`ed, and four denied with
> the *wrong* verbatim reason. The text below is the amended, normative form.
> Rationale and the full outcome table: `WO13_AUDIT.md` D15.

```ts
export type Legality = "allow" | "warn" | "deny";
export interface EdgeRule {
  source: NodeRole | "*";
  kind: EdgeKind | "*";
  target: NodeRole | "*";     // roles only — deprecation is a PRECONDITION (below)
  legality: Legality;
  reason: string;      // shown verbatim to the user
}
export function legalityFor(sourceRole, kind, targetRole, targetDeprecated): { legality, reason };
```

**Precondition, evaluated BEFORE any scoring (Amendment 3).** If
`targetDeprecated` is true, `legalityFor` returns immediately:

```ts
{ legality: "deny", reason: "That node is marked out of date and won't reach the agent." }
```

No rule can override it, exactly as `resolveLoad`'s rule 2 outranks its role
rules (§8.2) and `compile.rs` excludes deprecated nodes unconditionally
(§10.3). Deprecation is a property of the target's **state**, orthogonal to
role and kind; ranking it against role-pair heuristics compares incomparable
things, and the `NodeRole | "*" | "@deprecated"` union was the tell.

**Specificity, frozen and testable:** among the rules matching a
**non-deprecated** target, score each
`(source !== "*" ? 4 : 0) + (kind !== "*" ? 2 : 0) + (target !== "*" ? 1 : 0)`;
highest score wins; on a tie the **later** entry in the array wins. The default
when nothing matches is `{ legality: "allow", reason: "" }`.

Required rules (spec Block B, minus the two that reference removed roles).
The `@deprecated` row is **hoisted out of this table** by Amendment 3 and is
the precondition above:

| source | kind | target | legality | reason |
|---|---|---|---|---|
| `*` | `imports` | `command` | deny | "Commands run when you call them — inlining one removes the point of it. Use references." |
| `*` | `imports` | `skill` | deny | "Skills load themselves when relevant. Use references." |
| `*` | `imports` | `architecture` | warn | "Architecture notes are usually long. Inlining puts this in every request." |
| `glossary` | `overrides` | `*` | deny | "A glossary defines words; it doesn't outrank rules." |
| `example` | `overrides` | `*` | deny | "An example illustrates a rule; it doesn't outrank one." |
| `workflow` | `references` | `command` | allow | — |
| `example` | `references` | `rule` | allow | — |
| `example` | `references` | `invariant` | allow | — |
| `example` | `references` | `style` | allow | — |
| `decision` | `contradicts` | `decision` | allow | — |

The two remaining spec rows are **not** static rules and do not live in
`edgeRules.ts`:

- *"`imports` a target over 400 tokens → warn"* needs a file size. It is a
  **lint** check (`always-budget-exceeded` names the top contributors) plus the
  wizard's own D2 weight guard.
- *"`overrides` across different groups → warn"* and *"`sequence` between
  non-co-resident nodes → warn"* need `resolveLoad`. The `sequence` one is a
  lint check (`sequence-not-co-resident`); the cross-group one is a static rule
  and **is** expressible — add it as
  `{ source: "*", kind: "overrides", target: "*", legality: "warn", reason: "These two aren't in the same plane — check this is what you mean." }`
  evaluated only when `group(source) !== group(target)`, via a `when?` predicate
  field on `EdgeRule`. Frozen: `when?: (s: NodeRole, t: NodeRole) => boolean`,
  used by exactly this one rule.

`deny` blocks creation at draw time with the reason inline (E4: the drop target
dims and the reason appears near the cursor **before** the drop). `warn` creates
the edge and files an `edge-legality-warning` lint entry — never a blocking
dialog.

**Denied edges cannot be created through any code path.** The check lives in the
graph store's `addEdge` **and `updateEdge`** actions, so paste and the
right-click kind switcher both pass through it.

> **AMENDMENT 3 corrects a false claim here.** The struck sentence read *"…so
> paste, undo/redo, preset-apply and `import_apply`'s store commit all pass
> through it."* That is **wrong** about the last three: `preset_apply` and
> `import_apply` are Rust commands that write `graph.json` and re-enter the
> store through `loadGraph` → `migrateGraph`, which applies no legality check,
> and undo/redo restore whole snapshots. Those three paths are covered by
> **detection**, not prevention: `lint.rs`'s `edge-legality-warning` fires at
> `Severity::Error` for a `deny` result (§11.2, D8). Prevention at
> `addEdge`/`updateEdge`, detection everywhere else — do not claim otherwise.

**One report per edge, not two (Amendment 3).** A *structural* edge into a
deprecated target is already owned by `structural-edge-into-deprecated`, which
carries a `DropEdge` fix; `check_edge_legality_warning` **skips** the
deprecation deny for `imports`/`sequence`/`overrides` so the Problems panel
shows one item, not two contradictory ones. For the advisory kinds
(`references`, `contradicts`) into a deprecated target,
`edge-legality-warning` at `Severity::Error` is the only report and **is**
emitted.

**Both halves land together, in one lane (Amendment 3).** `src/config/edgeRules.ts`
(T1's zone) and `src-tauri/src/lint.rs`'s matcher (R2's) are a mirror pair, and
§17's own rule is that splitting a mirror pair across lanes is WO03-D5's defect
class. **Owner: R2**, granted `src/config/edgeRules.ts` for this one change, in
the serial fix-round Stage 0 slot beside D7 and D9 — serial, so the closed-file
doctrine's concurrency premise does not apply (§17, as amended).

**Gated by a shared corpus, mandatory (Amendment 3).**
`tests/fixtures/edge_legality_cases.json`, tech-lead-authored and
lane-uneditable, asserted from **both** `src-tauri/src/lint.rs`'s tests and
`src/config/edgeRules.test.ts` — the mechanism §8.3 already uses for
`resolveLoad`. This is the **second** time a Rust/TS pair agreed with each
other while both diverged from the spec (after the `always_closure` seed
handling, D5); consistency between mirrors is not evidence of correctness, and
an unpinned mirror pair is now treated as an incomplete deliverable. Required
cases, minimum: a deprecated target under each of the twelve rules that used to
outrank it (all must return the deprecation reason verbatim); a deprecated
target matching no rule; the non-deprecated behaviour of all twelve rules
unchanged; the tie rule; the `*`-fallback default; and the cross-group
`overrides` `when` predicate in both directions.

---

## 8. `resolveLoad`

### 8.1 Signature and types

**This is the shape Stage 0 is blocked on. It is final.**

```ts
export type ResolvedLoad = "always" | "on-glob" | "on-demand" | "on-invoke" | "excluded";

export type LoadReason =
  | "unknown-node"                  // defensive: id names no node
  | "deprecated"                    // rule 2
  | "role-command"                  // rule 3  — Amendment 1
  | "role-skill"                    // rule 4  — Amendment 1
  | "root-always"                   // rule 5
  | "imported"                      // rule 6
  | "guarded-import-glob"           // rule 7
  | "guarded-import-description"    // rule 8
  | "referenced"                    // rule 9
  | "unreachable-import"            // rule 10
  | "orphan";                       // rule 11

export interface LoadResult { policy: ResolvedLoad; reason: LoadReason; decidingEdgeId?: string }

export function resolveLoad(nodeId: string, graph: BarnGraph): LoadResult;   // pure
```

Reason → policy is a **total, frozen, single-valued** map — a lane must not
invent a second pairing:

| reason | policy |
|---|---|
| `unknown-node`, `deprecated`, `unreachable-import`, `orphan` | `excluded` |
| `role-command` | `on-invoke` |
| `role-skill`, `guarded-import-description`, `referenced` | `on-demand` |
| `root-always`, `imported` | `always` |
| `guarded-import-glob` | `on-glob` |

Rust mirror: `enum ResolvedLoad { Always, OnGlob, OnDemand, OnInvoke, Excluded }`
and `enum LoadReason { ... }`, both `#[serde(rename_all = "kebab-case")]`, both
declared in the order above. `LoadResult` serializes as
`{ policy, reason, decidingEdgeId? }` (camelCase, `skip_serializing_if` on the
edge id) — the Inspector's E3 sentence renders from it directly.

### 8.2 Resolution order — first match wins

Let **AlwaysClosure** = the set produced by seeding with every non-deprecated
node whose `rootLoad === "always"`, then repeatedly following edges `e` where
`e.kind === "imports"` **and `e.guard === undefined`** from a member `e.source`
to `e.target`, **skipping any deprecated target** (deprecated nodes are never
added and never propagate).

> ### THE SINGLE MOST DANGEROUS INVARIANT IN THIS WORK ORDER
>
> **The `always` closure follows UNGUARDED `imports` edges only.**
>
> Old `effective_pinned()` (`compile.rs:670-692`) closes over *all* `imports`
> edges. Migration turns every old `conditional` edge into `imports` + `guard`
> (§5.4). If the new closure follows all `imports`, **every migrated conditional
> newly pins a whole subtree into every existing user's `CLAUDE.md`** — silently,
> on first load, with no user action. Fixture case
> `"a glob guard stops the always closure dead"` in
> `tests/fixtures/resolve_load_cases.json` exists solely to pin this.

**AlwaysClosure additionally excludes every `command`- and `skill`-role node**,
both as a seed and as a traversal target — rule 1 says they cannot be inlined,
so they must not become closure members and must not propagate always-ness to
anything they import.

Order (rules 3 and 4 are Amendment 1; the rest renumber):

| # | Condition | Result |
|---|---|---|
| 1 | node id not found | `excluded` / `unknown-node` |
| 2 | `node.deprecated !== undefined` | `excluded` / `deprecated` |
| 3 | `node.role === "command"` | `on-invoke` / `role-command`, **no** `decidingEdgeId` |
| 4 | `node.role === "skill"` | `on-demand` / `role-skill`, **no** `decidingEdgeId` |
| 5 | node ∈ AlwaysClosure **and** `node.rootLoad === "always"` | `always` / `root-always`, no `decidingEdgeId` |
| 6 | node ∈ AlwaysClosure | `always` / `imported`, `decidingEdgeId` = lowest-byte-order id among unguarded `imports` edges whose `target` is this node **and whose `source` ∈ AlwaysClosure** |
| 7 | ∃ `imports` edge into node with a **glob** guard | `on-glob` / `guarded-import-glob`, `decidingEdgeId` = lowest such id |
| 8 | ∃ `imports` edge into node with a **description** guard | `on-demand` / `guarded-import-description`, lowest such id |
| 9 | ∃ `references` edge into node | `on-demand` / `referenced`, lowest such id |
| 10 | ∃ any `imports` edge into node (source not reachable) | `excluded` / `unreachable-import` |
| 11 | otherwise | `excluded` / `orphan` |

**`deprecated` outranks the role rules** (2 before 3/4): a deprecated command
must not be emitted to `.claude/commands/`, and a deprecated skill must not
report `on-demand`. Getting this order wrong ships a generated file for a node
the user marked out of date.

Rules 7–10 are **local** (no source-reachability test) because
`emit_cursor` (`compile.rs:962-975`) and `on_demand_bullets`
(`compile.rs:858-884`) emit for those edges today regardless of whether the
source is pinned. Only rules 5/6 are closure-based, because only
`effective_pinned` was. Preserving that asymmetry is what keeps §18.1's
exception list short and enumerable.

Dangling edges (an endpoint naming no node) are excluded before resolution, the
same way `compile_preview` (`compile.rs:288-304`) and `lint_graph`
(`lint.rs:140`) already exclude them.

### 8.3 Where it lives — one definition, two mirrors, one fixture

Rust needs it for compile; TS needs it for edge hover, the Inspector's E3
sentence and the 150 ms wizard preview — an IPC round-trip per keystroke is not
acceptable. "One decider" is honoured by one **definition**, pinned by a shared
fixture corpus asserted from both sides — the same mechanism `project.rs:659-670`
already uses for the serializer pair.

- **Rust:** new `src-tauri/src/resolve_load.rs`, operating on projected facts so
  it couples to neither `project::BarnGraph` nor `compile::GraphIn`:

```rust
pub enum LoadEdgeKind { Imports, References, Other }
/// `LoadRole` is deliberately three-valued, not the full 14-member NodeRole:
/// resolve_load must not couple to the role vocabulary, and only these two
/// roles have a fixed destination (Amendment 1, rule 1).
pub enum LoadRole { Command, Skill, Other }
pub struct NodeFacts { pub id: String, pub role: LoadRole,
                       pub root_always: bool, pub deprecated: bool }
pub struct EdgeFacts { pub id: String, pub source: String, pub target: String,
                       pub kind: LoadEdgeKind, pub guard: GuardKind }  // GuardKind: None|Glob|Description
pub struct LoadResult { pub policy: ResolvedLoad, pub reason: LoadReason,
                        pub deciding_edge_id: Option<String> }

pub fn resolve_load(node_id: &str, nodes: &[NodeFacts], edges: &[EdgeFacts]) -> LoadResult;

/// The SAME resolver with rules 3 and 4 skipped and command/skill nodes NOT
/// excluded from AlwaysClosure — i.e. the answer as it would have been before
/// Amendment 1's destination lock.
///
/// EXACTLY ONE CALL SITE: `compile.rs::emit_cursor`. Cursor has no invoke
/// mechanism, so rule 1's lock has no meaning there and applying it would drop
/// a Cursor-only user's content with nothing offered in return (§10.5).
/// Adding a second call site requires a contract amendment.
pub fn resolve_load_ignoring_role_lock(node_id: &str, nodes: &[NodeFacts], edges: &[EdgeFacts]) -> LoadResult;

pub fn always_closure(nodes: &[NodeFacts], edges: &[EdgeFacts], seeds: &[&str],
                      role_lock: RoleLock) -> BTreeSet<String>;
pub enum RoleLock { Apply, Ignore }
```

Both entry points are one implementation with a `RoleLock` parameter — never two
copies. `taskctx.rs` (§8.4) passes `RoleLock::Apply`: a task's injected subgraph
is Claude Code context, so a command node must not be inlined into it either.

TS mirrors both: `resolveLoad(nodeId, graph)` and
`resolveLoadIgnoringRoleLock(nodeId, graph)`. The TS side has no `emit_cursor`,
so the second export exists **only** so the fixture corpus can assert both modes
from both languages. It has no UI call site and lint (`npm run lint`,
`noUnusedLocals`) will not flag it because it is exported.

- **TS:** `src/config/resolveLoad.ts`, taking `BarnGraph` directly.
- **Fixture:** `tests/fixtures/resolve_load_cases.json`, asserted by
  `src-tauri/src/resolve_load/tests.rs` and `src/config/resolveLoad.test.ts`.
  Rust reads it via
  `include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/resolve_load_cases.json"))`.

### 8.4 There is already a second implementation to collapse

`src-tauri/src/taskctx.rs:163-167` seeds its subgraph base from `n.pinned` and
`:177-205` runs its **own** `imports` closure with no guard awareness. Both must
call the shared resolver, or the edge spec's DoD clause *"`resolveLoad` is the
only function deciding load policy"* is false on day one.

Frozen: `taskctx.rs` seeds `base` with every node whose `rootLoad == Always`
(replacing the `pinned` test) and replaces its hand-rolled walk with
`resolve_load::always_closure(nodes, edges, &base_ids)`. `compile.rs`'s
`effective_pinned` is **deleted** and replaced by the same call seeded with the
root-always ids.

---

## 9. `is_structural()` vs `affects_output()`

The edge spec calls four of five kinds "structural", meaning *changes compiled
output*. This repo's `is_structural()` means *participates in topological
ordering* (`project.rs:373-375`, consumed by `compile.rs:587` and `lint.rs:244`).
If `references` inherits the spec's sense it enters Kahn's algorithm and every
`@path` pointer becomes an ordering constraint — phantom cycles on graphs that
have none.

**Frozen — two separate, differently-named predicates:**

```rust
impl EdgeKind {
    /// Participates in Kahn's algorithm / cycle validation / topological order.
    /// UNCHANGED MEANING. imports | sequence | overrides.
    pub fn is_structural(self) -> bool { ... }

    /// The spec's taxonomy: this kind changes what lands in a compiled file.
    /// Everything except `contradicts`.
    pub fn affects_output(self) -> bool { ... }
}

/// Ordering participation for a CONCRETE edge. A guarded `imports` edge is
/// conditional content, exactly as the old `conditional` kind was, and must NOT
/// enter the ordering — doing so changes `total_order` and therefore the order
/// of `## Always read` and of `.cursor/rules/*.mdc`.
pub fn edge_participates_in_order(kind: EdgeKind, guarded: bool) -> bool {
    kind.is_structural() && !guarded
}
```

TS mirrors in `src/canvas/edgeKind.ts`: `isStructuralEdgeKind` (unchanged
meaning, now `imports | sequence | overrides`), new `affectsOutput`, new
`edgeParticipatesInOrder`. `KindPicker`'s two group headers read
`affectsOutput`; the canvas's solid-vs-dashed stroke reads `affectsOutput`;
Kahn/cycle reads `edgeParticipatesInOrder`.

Both `compile.rs:586-603 total_order` and `lint.rs:243-257 check_cycle` switch to
`edge_participates_in_order`.

---

## 10. Compile

### 10.1 `compile_preview` gains `overlay` — same command name, invoke count unchanged

```rust
#[tauri::command]
pub fn compile_preview(root: String, graph_json: String, overlay: Vec<ApprovedFile>)
    -> Result<CompilePreview, String>
```

`ApprovedFile { rel_path, content }` already exists (`compile.rs:260-264`).

```ts
export function compilePreview(root: string, graphJson: string,
                               overlay: ApprovedFile[] = []): Promise<CompilePreview>;
```

**Every TS call site sends the key explicitly**, including `overlay: []`. Do not
rely on Tauri's optional-argument behaviour.

Overlay semantics, frozen:

- **Missing-file pass** (`compile.rs:309-321`): a node whose `file_path` resolves
  to the same path as an overlay entry counts as **present**. This is what lets a
  draft node that is not yet on disk be previewed.
- **`emit_cursor`'s `read_file`** (`compile.rs:390-393`): consult the overlay
  first, fall back to disk.
- **`old_content`** (`compile.rs:416-422`): the overlay **never** affects it.
  `old_content` is on-disk truth, and the whole point of step 4's diff.
- **Path equality** is decided by `resolve_within_root(root, rel)` returning
  equal `PathBuf`s — reusing the existing, tested normalizer rather than a new
  string comparison.

This is what makes the wizard's live preview and its step-4 diff list one
mechanism instead of a second compiler.

### 10.2 Byte-identity edits — `conditional` becomes guarded `imports`

Three call sites currently key on `EdgeKindIn::Conditional`. All three must key
on `Imports` **with a guard** and produce byte-identical output for a
single-glob / single-description guard, which is exactly what migration
produces:

| Site | Change |
|---|---|
| `on_demand_bullets` (`compile.rs:870-877`) | glob guard ⇒ ``"- When touching `{globs.join(\",\")}`, read {link}."``; description guard ⇒ `"- When {text}, read {link}."` |
| `emit_nested_agents` (`compile.rs:918-951`) | one nested `{dir}/AGENTS.md` per **clean folder glob**, iterating each entry of a glob guard's `globs` |
| `emit_cursor` (`compile.rs:962-975`) | collect `(edge_id, glob)` pairs flattened over each glob guard's `globs`, sort by `(edge_id, index)`, join with `","` |

A one-element `join(",")` is the element itself, so every migrated graph
produces the same bytes.

`EdgeKindIn` (`compile.rs:127-149`) loses `Conditional`, `Supersedes` and
`ConflictsWith`, gains `Contradicts`, and `EdgeIn` (`:116-125`) swaps
`condition: Option<String>` for `guard: Option<GuardIn>`. `#[serde(other)] Unknown`
stays.

### 10.3 Deprecated nodes are excluded from all compiled output

A node with `deprecated` is removed from `ctx.nodes`' effective set before any
adapter runs: it never appears in `## Always read`, never produces a `.mdc`,
never appears in an on-demand bullet, and never receives an agent context block.
It stays in the graph for provenance. Any structural edge pointing at it is a
lint **error** (§11).

Implementation note: it must **not** be removed from `total_order`'s input, or a
`sequence` edge through it would silently reorder the rest. Filter at emission,
not at ordering.

### 10.4 Materializing `overrides` (edge spec Block C)

When `A --overrides--> B` and `resolveLoad(A).policy === resolveLoad(B).policy === "always"`
(the repo's definition of co-resident, §11.1):

1. `A` is emitted after `B` in the root file. This already holds:
   `total_order` puts the override target before the source
   (`compile.rs:595-599`).
2. `A`'s entry is preceded by a generated line naming what it supersedes,
   derived from `B.title`, never free text:
   `<!-- cowtext:precedence -->Takes precedence over "{B.title}" below.`
3. Recompilation **replaces** rather than accumulates: the marker comment is the
   handle, and the line is regenerated from scratch on every compile because the
   whole root file is regenerated from scratch (`emit_root`,
   `compile.rs:889-913`). Byte-identical on a second run by construction.

**No code path removes lines from a target node's body.** Line excision is
explicitly out of scope (§19).

If `A` and `B` are not co-resident the override cannot be expressed — that is a
lint **error** with an `AddImports` fix, not a silent no-op.

### 10.5 The `.claude/commands/` emitter (Amendment 1)

`resolveLoad` is now the **only** source of "is this node always in context".
`Ctx.pinned` / `Ctx.pinned_set` (`compile.rs:844-846`) are rebuilt from
`resolve_load` rather than from `effective_pinned`, and every consumer keys off
the resolved policy:

| Emitter | Keys on |
|---|---|
| `emit_root`'s `## Always read` (`compile.rs:895-902`) | `resolve_load(...).policy == Always` |
| `emit_root`'s `## Read when relevant` (`compile.rs:903-909`) | **unchanged — still edge-driven.** Rule 1 never suppresses an edge-driven bullet. |
| `emit_cursor` `alwaysApply: true` (`compile.rs:1002-1003`) | `resolve_load_ignoring_role_lock(...).policy == Always` — see below |
| `emit_cursor` `globs:` (`compile.rs:1004-1011`) | `resolve_load_ignoring_role_lock(...).policy == OnGlob` |
| **`emit_commands` (new)** | `resolve_load(...).policy == OnInvoke` |
| agent context blocks (`compile.rs:442-459`) | unchanged — edge-driven |

> **Rule 1's destination lock governs the Claude-family outputs only.
> `.cursor/rules` is UNCHANGED by it.**
>
> Cursor has neither slash commands nor skills, so `on-invoke` has no
> realization there and there is no destination to lock to. If rule 1 applied to
> `emit_cursor`, a Cursor-only project with a pinned `command` node would lose
> its `.mdc` and receive **nothing** in return — silent content loss on
> migration, for a user who never asked for Claude Code output at all.
>
> Cursor does have a manual-invocation rule form (a `.mdc` with a `description`
> and neither `alwaysApply` nor `globs`), which is arguably the right mapping —
> but that is unverified third-party behaviour, and inventing it is exactly what
> D9 exists to prevent. Backlogged (§19) for a round where it can be walked.
>
> This is **not** two notions of "always". It is one resolver with two named
> entry points (§8.3), each with exactly one call site, both pinned by the same
> fixture corpus.

**`emit_commands`, frozen.** One file per node whose resolved policy is
`OnInvoke`, in `ctx.order`, emitted **only when `claude` is in
`compile_targets`** (`wants(TargetIn::Claude)`, `compile.rs:368-376`).

That gate is deliberate and is *not* the agent-context-block precedent. Agent
blocks are surgical edits into `.claude/agents/*.md` files **the user already
created**, so running them unconditionally invents nothing. `.claude/commands/`
would be new scaffolding, and creating a `.claude/` tree inside a Cursor-only or
Copilot-only project is exactly the kind of unasked-for write this app exists not
to do. Both §18.1 fixtures include `claude`, so the gate does not weaken them.

```
.claude/commands/<stem>.md
---
description: {yaml_scalar(node.title)}
---
<GENERATED_HEADER>

{body}
```

- `<stem>` is derived **exactly** as `emit_cursor` derives its `.mdc` name
  (`compile.rs:989-1001`): `Path::file_stem()` lowercased, falling back to the
  node id, with a `-{count}` suffix on collision.
- **The two collision counters are separate `HashMap`s.** A command node leaving
  `emit_cursor`'s loop must not renumber anyone's `.mdc`, and a command file must
  not be numbered by a `.mdc` stem it never collided with. This is a silent
  output change if a lane shares one counter.
- `body` is read through the same `read_file` closure `emit_cursor` uses, so
  `overlay` (§10.1) works for a draft command node. Line endings normalized to
  LF and trailing newlines trimmed, identical to `compile.rs:1013-1015`.
- `$ARGUMENTS` in the body passes through **verbatim**. Nothing substitutes it.
- Output is sorted by `rel_path` before being appended to `produced`, matching
  `emit_cursor`'s and `emit_nested_agents`'s existing `sort_by`.

**`description` frontmatter — the one uncertainty, named rather than hidden.**
Claude Code slash-command files accept frontmatter; `description` is the key that
appears in the command list. If Marty's acceptance walk shows the generated file
is not listed or not invocable, the fallback is **body + GENERATED header, no
YAML fence** — a content change only, no schema change, no lane re-scope. The
test manual carries an explicit step for this (§18.10). Do not guess at
`argument-hint` or `allowed-tools`; they are not emitted.

**`classify_output` gains exactly one arm**, mirroring the existing
`.claude/agents` arm (`compile.rs:792-796`) in shape but returning
`Some(false)` — fully generated, not surgical:

```rust
[".claude", "commands", name] => name
    .to_ascii_lowercase()
    .strip_suffix(".md")
    .is_some_and(|stem| !stem.is_empty())
    .then_some(false),
```

**One component only.** `.claude/commands/sub/x.md` is refused, exactly as
`.claude/agents/sub/x.md` is. This is an exact-shape match, not a prefix rule.

**Why fully generated, not surgical.** The surgical mode (`Some(true)`) exists
because an agent file's frontmatter and system prompt are hand-authored and owned
by `agent_save`'s queue. A command file has no such owner and no Cowtext-managed
region to preserve. Fully-generated means it inherits the existing trust boundary
for free: `PreviewFile.handwritten` (`compile.rs:423-426`) already flags an
existing, non-empty file lacking the GENERATED header, and `CompileModal` already
makes overwriting one loud and opt-in. **A hand-authored `.claude/commands/deploy.md`
that a user already owns is therefore surfaced as `handwritten: true` in the diff
and is never written without an explicit tick.** No new collision rule is needed;
that is the whole argument for this shape.

### 10.6 `skill` gets NO emitter — the destination it already has

`.claude/skills/<name>/SKILL.md` is CRUD-managed by `agents.rs`
(`skill_create` / `skill_save` / `skill_rename` / `skill_delete`, four of the 74
invokes). If compile also emitted there, two subsystems would write one path,
separated by human time — **exactly WO11's one-writer defect class**, which a
lock cannot fix because the two writes are minutes apart, not microseconds.

**Frozen: `skill`'s "fixed destination" is the file `agents.rs` already manages.**
Rule 1's entire effect on a `skill`-role node is that it can never resolve to
`always` **in the Claude-family outputs**, so it leaves `## Always read`. It is
not added anywhere new, `classify_output` gains **no** `.claude/skills/` arm, and
its `.cursor/rules/*.mdc` is **unchanged** — `emit_cursor` does not apply rule 1
(§10.5, F11).

Two enforcement points, both required, because refusing it in one place is not
enough: `classify_output` (so `compile_write` refuses it) **and** the explicit
`.claude/skills/` clause in `fs_apply_batch`'s one-writer guard (§12.1 rule 2),
because `SKILL.md` ends in `.md` and would otherwise pass that command's
suffix test.

Content is not lost: a skill node reached by a `references` (or guarded
`imports`) edge keeps its `## Read when relevant` bullet, because §10.5 leaves
the bullets edge-driven. A skill node that was *only* pinned loses its pointer —
that is the intended semantic ("skills load themselves when relevant") and it is
item 3 of the §18.1 enumeration.

---

## 11. Lint (`src-tauri/src/lint.rs`, extended)

Do **not** create `src/lib/lint.ts`. The linter is Rust, already wired to
`lint_run`, `cowtext-cli lint` (exit 2) and `cowtext-mcp`. A TS linter would be
the second linter the spec's own reasoning forbids.

### 11.1 Co-residency, defined

This compiler never puts two node bodies in one file — the root file lists
`@path` lines. The honest definition of "co-resident" here:

```
co_resident(a, b)  ⇔  resolveLoad(a).policy == "always" && resolveLoad(b).policy == "always"
```

Frozen. Every check below that says "co-resident" means exactly this.

### 11.2 `LintCode` — retired, kept, added

**Retired:** `superseded-but-pinned` (its edge kind no longer exists — delete
`check_superseded_but_pinned`, `lint.rs:556-589`, and the enum variant at `:80`),
`conflicts-with` (renamed).

**Kept:** `cycle`, `missing-file`, `dangling-edge`, `duplicate-title`,
`near-duplicate-content`, `readme-duplication`, `stale-last-verified`.

**Added (wire values are kebab-case):**

| Code | Severity | Fix | Message shape |
|---|---|---|---|
| `contradicts` | warning | none — **never auto-resolved** | `"{A}" contradicts "{B}"` (replaces `conflicts-with`) |
| `sequence-not-co-resident` | warning | `AddImports` | "These never end up in the same file, so ordering does nothing." |
| `override-not-co-resident` | **error** | `AddImports` | "Override has no effect — these two never appear in the same file." |
| `structural-edge-into-deprecated` | **error** | `DropEdge` | names the replacement from `deprecated.replacedBy` |
| `orphan-node` | warning | `AddImports` | "Nothing imports or references this, so it won't reach any agent." |
| `unreachable-import` | warning | `AddImports` | "Only \"{source}\" imports this, and that node doesn't reach any agent either." |
| `always-budget-exceeded` | warning | none | total vs threshold, top 3 contributors named |
| `duplicate-imports` | **info** | `DropEdge` | "\"{T}\" is already in context — this second import adds nothing." |
| `command-may-be-env` | warning | `RetypeNode` | "This looks like build/test commands rather than an invocable prompt. Retype as Env?" — fires when `role == command` and the body contains no `$ARGUMENTS` |
| `edge-legality-warning` | warning | none | carries the matching `EdgeRule.reason` **verbatim** |

`Severity` gains a third member `Info` (`#[serde(rename_all = "lowercase")]` ⇒
`"info"`). `src/lint/types.ts` mirrors it and `ProblemsPanel`'s severity filter
gains the third option.

`ALWAYS_BUDGET_TOKENS: usize = 10_000` — a named constant beside the existing
thresholds (`lint.rs:36-57`), documented as ~5% of the 200k window, the point at
which always-context starts crowding the task itself.

### 11.3 `LintFix` — a small closed enum, applied through existing store actions

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LintFix {
    DropEdge   { edge_id: String },
    RetypeNode { node_id: String, role: NodeRole },
    AddImports { source: String, target: String },
}
```

`LintItem` gains `#[serde(default, skip_serializing_if = "Option::is_none")] pub fix: Option<LintFix>`.

The frontend applies a fix by calling the **existing** graph-store actions
(`deleteEdges`, `updateNode`, `addEdge`) — which is why "every fix is reversible
via existing undo" is free, and why **lint still never mutates anything**
(`lint.rs`'s module doc invariant is preserved verbatim).

### 11.4 Performance

Lint runs on graph change and must not block the UI thread on graphs up to 500
nodes. It already runs in Rust over IPC and is invoked from `ProblemsPanel`;
frozen: keep it debounced at the existing call site and do not add a
per-keystroke trigger.

---

## 12. Write atomicity, undo, and what must NOT become undoable

### 12.1 The one new command — `fs_apply_batch`

```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchEntry {
    pub rel_path: String,
    /// `None` = delete this path.
    pub content: Option<String>,
}

#[tauri::command]
pub fn fs_apply_batch(root: String, entries: Vec<BatchEntry>) -> Result<Vec<BatchEntry>, String>
```

New module `src-tauri/src/fsbatch.rs`. **Returns the exact inverse batch** —
applying the returned value undoes the call. That is the undo token the specs
ask for (`{relPath, prior: string|null}`, `null` ⇒ the path did not exist ⇒ undo
deletes it), and it is why WO13 needs **one** new command, not two.

Semantics, frozen:

1. Resolve every `rel_path` through `resolve_within_root`. Reject the whole
   batch on any failure, before touching anything.
2. **One-writer guard.** Reject the whole batch if any entry is
   `.claude/settings.json` (`hooks_write` owns it), matches `.claude/agents/*.md`
   (`agent_save` owns it), **or lies anywhere under `.claude/skills/`**
   (`skill_create`/`skill_save`/`skill_rename`/`skill_delete` own it, §10.6).
   The first two are the guards `write_md_file` already enforces
   (`project.rs:730-740`); the third is new and **is required** — see the note
   under rule 3.
3. Accept an entry only if `compile::classify_output(rel).is_some()` **or** the
   path ends in `.md`. Nothing else. This is not a general write primitive.
   Amendment 1 notes:
   - `.claude/commands/<stem>.md` is acceptable through **both** halves of this
     test, which is correct — the node wizard's step-4 Confirm writes a new
     `command` node's own source file *and* its generated command file in one
     all-or-nothing batch.
   - `.claude/skills/<name>/SKILL.md` **also ends in `.md`**, so rule 3 alone
     would let it through. That is precisely why guard 2 gained its third clause.
     Do not rely on `classify_output` to refuse it — `classify_output` is
     consulted only by the first half of an `or`.
4. Snapshot every target's prior state (content, or "absent") in list order.
5. Apply in list order: `Some(c)` ⇒ `write_atomic`; `None` ⇒ remove the file
   (a missing file is a no-op, not an error).
6. On **any** failure, restore every already-applied entry from its snapshot in
   reverse order, then `Err("<relPath>: <reason>")` naming the failing path. If a
   restore also fails, the error names both.
7. Return the inverse batch in the **same order as `entries`**, so the caller
   can apply it directly.

Duplicate `rel_path` entries in one batch are rejected (the inverse would be
ambiguous).

### 12.2 Undo in the UI

Node wizard step 4 (**N-E**): Confirm calls `fs_apply_batch` once with the node's
own `.md` plus every approved compile output. The returned inverse batch is held
in the toast's closure; `pushToastWithAction({ severity: "success", title:
"Node created", action: { label: "Undo", run: () => fsApplyBatch(root, inverse) } })`.
The toast is not deduped (§3.4).

Agent modal (**A-E**): create uses the existing `agent_create` (+
`agent_memory_ensure`); Undo calls the existing `agent_delete`. **The memory
folder is not removed** — deleting a directory the user may have written into is
worse than leaving it, and the toast detail says so. Zero new commands.
On a partial failure (`agent_create` succeeded, `agent_memory_ensure` failed),
the frontend rolls back with `agent_delete` and names the failing path.

### 12.3 What must NOT change

**The graph undo stack must not learn about files.** `store/graph.ts:428-432`
excludes file operations deliberately — *"a restored node whose file moved simply
shows the missing-file badge"*. Extending it is forbidden. File undo lives in the
toast action and nowhere else.

---

## 13. Command contract

### 13.1 New (74 → 75)

```rust
fsbatch::fs_apply_batch
```

One `generate_handler!` entry, added by **Stage 0** as a compiling stub that
returns `Err("WO13 Stage-0 stub: fs_apply_batch")`; **lane R3 replaces the body**.
`src-tauri/src/lib.rs` is closed to every other lane.

**Gate:** the invoke-count check must also assert that no handler body still
returns the Stage-0 stub string (WO06-D2's failure mode).

TS wrapper: `src/fs/api.ts` gains
`export function fsApplyBatch(root: string, entries: BatchEntry[]): Promise<BatchEntry[]>`.

### 13.2 Wire changes to existing commands

| Command | Change | Ratification |
|---|---|---|
| `compile_preview` | new third arg `overlay: Vec<ApprovedFile>` | §10.1 |
| `write_graph` | writes `.cowtext/graph.v4.bak.json` once as a precondition | §5.8 |
| `git_init` | already takes `branch: Option<String>` (landed, §2.1) | — |

`docs/TERMINOLOGY.md`'s invoke table and its "(74)" headings become **(75)**;
`fs_apply_batch` joins the `project` group row. Docs close-out is
`project-manager`'s, after the lanes.

---

## 14. Frozen UI seams

### 14.1 The shared two-pane shell and preview pane — U1's FIRST deliverable

The agent spec forbids a second preview component (lines 888, 941). There is no
shared modal shell in the repo today: 21 files render `z-modal` independently.
Lane **U1** builds both shells **before** anything else, and U3 consumes them.
Props are frozen here so U1 and U3 build in parallel against a signature neither
can renegotiate.

```ts
// src/ui/TwoPaneModal.tsx   (owner: U1)
export function TwoPaneModal(props: {
  title: string;
  steps?: { n: number; label: string }[];   // absent ⇒ no step rail (agent modal)
  currentStep?: number;
  onStep?: (n: number) => void;
  headerExtras?: React.ReactNode;           // expand / download buttons
  onClose: () => void;
  left: React.ReactNode;
  right: React.ReactNode;
  footerNote: string;                       // the promise line, verbatim
  footer: React.ReactNode;                  // Back / Next / Confirm
  previewLabel?: string;                    // default "Preview"
}): JSX.Element
```

- `min(1180px, 92vw)` × `min(760px, 88vh)`; left `58%`, right `42%`; 1px hairline
  divider in `border-border-subtle`; the two panes scroll independently.
- Below `1024px` the panes stack and the right pane collapses into a `Preview`
  disclosure directly above the footer, closed by default.
- The right pane is `aria-live="polite"` and **never steals focus** from the left.
- `footerNote` is rendered verbatim. Node wizard passes
  `Nothing is written until you confirm on step 4.`; the agent modal passes
  `Nothing is written until you confirm.` Neither string may be reworded.

```ts
// src/ui/PreviewPane.tsx    (owner: U1)
export interface PreviewTab { key: string; label: string; files: PreviewFile[]; note?: string }
export function PreviewPane(props: {
  tabs: PreviewTab[];
  activeKey: string;
  onTab: (key: string) => void;
  emptyExample?: { relPath: string; content: string };  // the worked example
  loadSentence: string;    // "Loads when files in `src/api/` are touched"
  tokenEstimate: number;
  missingMapping?: { target: string };   // renders "no mapping for <target>" — NEVER a fabricated path
}): JSX.Element
```

Rendering order inside the pane is frozen: **destination path → rendered output
→ load sentence → token estimate.** Output is shown read-only through the
existing `CodeMirrorEditor` (`src/inspector/CodeMirrorEditor.tsx`) in a
read-only variant — **no markdown renderer, no new dependency.** Keep it lazily
imported; `vite.config.ts` isolates CodeMirror into the `inspector` chunk and
must not gain it in the startup path.

Debounce is **150 ms**; the acceptance bar is a keystroke reflected within
200 ms.

**Mount gate (WO06-D1's failure mode):** both shells must be imported by a real
call site inside this work order. `rg "TwoPaneModal" src/` and
`rg "PreviewPane" src/` must each return **at least two** importers (U1's wizard
and U3's agent modal) before the work order is called done.

### 14.2 Node wizard specifics

- Step count and header/footer copy are **unchanged** (spec scope guard).
- Step 1: all 13 pickable tiles visible, no disclosure; default selection is
  **Rule**; the type-ahead filter **dims** non-matching tiles rather than
  removing them; the `rule`/`invariant`/`style` disambiguator expands in place
  (never a second modal, never a mouse-out tooltip).
- Changing role late preserves `name` and `body`. No confirmation dialog.
- Step 2: root-load segmented control (§4.1), glob input only for `on-glob`
  with a live match count from `useProjectStore.files`.
- Step 2 weight guard: `always` + body over **400 tokens** ⇒ non-blocking inline
  suggestion in the right pane with a one-click switch. Suggest, never block.
- Step 3: `example` role gets a two-field good/bad editor that compiles into one
  body and **round-trips** (split → compile → reopen → split, no drift). Freeze
  the separator so both directions agree: `## Good` / `## Bad` H2 headings,
  produced by `buildRoleSkeleton` for the `example` role.
- Step 4: grouped create/modify diff list with expandable unified diffs from the
  existing LCS differ (`src/compile/diff.ts`), then §12.2.

### 14.3 Agent modal specifics

- `description` required; Create disabled without it, with the reason inline.
  Blocking validation (B3) also fires under ~15 words or with no trigger-shaped
  language; the message names the consequence — **the file will be created and
  valid, and the agent will never run** (and per §3.0 it will not even load).
- "When not to use it" is a second input appended into the same `description`
  string; it must round-trip on edit. Freeze the join so parsing is total:
  the two halves are joined with `" Do not use it when "` and split on the
  first occurrence of that exact phrase.
- `DUTIES` → **System prompt**; third-person detection **offers** a rewrite and
  never applies it.
- Tools: mode selector `Inherit every tool` (default) / `Restrict to selected`.
  The checkbox grid is unreachable in Inherit mode. Three risk tiers
  (Read-only / Mutating / Elevated) distinguished by icon **and** rule, never by
  colour alone. Every group expands to its exact tool names in place.
- `disallowedTools` input in both modes; validation message per §3.0.
- Provider dropdown removed. Model radio list: `Inherit from the main session`
  (default), Haiku, Sonnet, Opus, `Pin a specific model ID`.
  **Frozen: `model: inherit` is OMITTED from frontmatter**, because `inherit` is
  the format default and writing it adds a line that means nothing. Document it
  in a code comment at the emitter, per D2's acceptance criterion.
- `maxTurns` (numeric, optional) and `permissionMode` (select) sit **beside the
  Elevated tools tier**, not at the bottom.
- Left-pane order: identity → dispatch → system prompt → runtime → local-only.
  Local-only fields (`nickname`, `priority`, `avatarPath`, `influence`) are
  grouped last, visually quieter, each carrying the shared `local only` badge
  driven by one `compiles: boolean` flag on the field config.
- Footer lists **every** path that will be created (the agent file, and the
  memory directory when the toggle is on).

### 14.4 `frontmatter.rs` — five new known keys

`FmFields` / `KnownKey` / `KnownKey::ORDER` / `as_str` / `from_str`
(`frontmatter.rs:20-68`) gain, in this canonical append order after `skills`:

`disallowedTools` (list) · `permissionMode` (scalar) · `maxTurns` (numeric
scalar) · `memory` (scalar, enum `user|project|local`) · `color` (scalar).

`maxTurns` renders unquoted. The existing list-form and quote-preservation
machinery (`find_list_form`, `existing_value_is_quoted`,
`rendered_new_value`, `should_touch_key`) must be extended, not bypassed.

**The `emit(parse(c)) == c` invariant is the gate**, and one case is new and
dangerous: a hand-written file that *already* carries these keys round-trips
today as `FmLine::Extra` (verbatim). Once they become `Known`, a careless
`should_touch_key` will rewrite them. §18.3 gates it.

Unknown keys must still survive as `FmLine::Extra` — that is the mechanism
keeping `mcpServers`, `hooks`, `background`, `effort`, `isolation`,
`initialPrompt` (agent spec N3, still backlogged) byte-identical on rewrite.

### 14.5 Design tokens (Stage 0)

`src/styles/tokens.css:71-84` — the role ramp becomes 14 entries:
rename `--role-rules` → `--role-rule`; add `--role-decision`, `--role-env`,
`--role-tool`, `--role-example`; keep everything else.

> **`--role-rules`, `--role-task` and `--role-reference` must NOT be deleted.**
> `src/identity/identity.ts:38-46, 117` carries a frozen 7-member accent ramp
> (`accentIdx = h2 % 7`) whose members are `agent, rules, architecture,
> workflow, task, reference, glossary`, and `accentVar` resolves them as
> `var(--role-<name>)`. That file is write-forbidden (§16). Deleting those three
> tokens would blank the accent on **every existing user's avatars and calves**.
> They stay, retitled in a comment as *legacy identity-ramp aliases, not node
> roles*, with their current values unchanged.

Also in `tokens.css`: `--edge-c-slate` (`:139`) currently aliases
`var(--role-snippet)`. `snippet` is removed. **Frozen: inline the literal
`#8CA0B8`** — the edge-colour palette is a closed set and should never have
depended on a role token (the file's own comment at `:128-133` says hue on the
canvas belongs to roles). `--edge-c-violet: var(--role-invariant)` survives
unchanged.

Edge tokens (`:114-120`): keep `--edge-imports`, `--edge-references`,
`--edge-sequence`, `--edge-overrides`; **add** `--edge-contradicts: #A08A6A`
(the value `--edge-conflicts-with` holds today); **remove** `--edge-conditional`,
`--edge-supersedes`, `--edge-conflicts-with`. `edgeStroke` (`edgeColor.ts:57`)
returns `var(--edge-${kind})`, so a missing token silently blanks a wire —
the five names must be exact.

A guarded edge renders **dashed in its own kind's colour**, not in a separate
token. That is E2's "the visual distinction the old `conditional` kind provided,
without the menu choice".

### 14.6 The barn

`propForRole` (`src/scene/sceneGraph.ts:104-123`) is an exhaustive `switch` with
no `default` under `noFallthroughCasesInSwitch`. Frozen 14-role mapping:

- **cabinet** (governance / caution notices): `rule`, `invariant`, `trap`, `agent`
- **bookshelf** (browsable knowledge): `architecture`, `decision`, `glossary`,
  `skill`, `style`, `example`, `tool`
- **crate** (active work): `workflow`, `command`, `env`

No new sprites. `src/scene/demo.ts` (6 `pinned` references, role literals) moves
to `rootLoad` and the new role names.

---

## 15. Vitest

Approved dependency exception. `environment: 'node'` — **no jsdom, no
testing-library.** Pure-module tests only.

**Three config edits, or the release build breaks.** `tauri.conf.json:9` runs
`npm run build` = `tsc && vite build`, and `tsconfig.json:23` has
`include: ["src"]`, so colocated `*.test.ts` would be typechecked by the release
build and would pull `vitest` types into it.

1. `package.json`: devDependency `vitest` (3.x, matching Vite 7); script
   `"test": "vitest run"`.
2. `tsconfig.json`: add `"exclude": ["src/**/*.test.ts"]`.
3. New `tsconfig.test.json` extending the base without that exclude, and a new
   `vitest.config.ts` (separate from `vite.config.ts`, which stays clean for the
   Tauri build) with `include: ['src/**/*.test.ts']`.
4. `eslint.config.js`: one block for `src/**/*.test.ts` adding the vitest
   globals. `no-explicit-any` stays **on**.

`src-tauri/` is untouched by any of this.

Coverage, frozen (each is a pure module, no DOM):

| Test file | Asserts |
|---|---|
| `src/store/graph.test.ts` | migration idempotence on `graph_v4_in.json`; `migrateGraph` output serializes byte-identically to `graph_v5_out.json`; `serializeGraph(migrate(v5_out)) === v5_out` |
| `src/config/resolveLoad.test.ts` | every case in `resolve_load_cases.json`, honouring each case's `mode` |
| `src/config/edgeRules.test.ts` | specificity resolution including `*` fallback and the tie rule |
| `src/config/nodeTypes.test.ts` | 14 entries, one per `NodeRole`; every `microExample` non-empty; group counts 1+3+2+5+3 |
| `src/wizard/paths.test.ts` | slug generation: spaces, case, diacritics, collisions |
| `src/wizard/roleSkeleton.test.ts` | `example` good/bad split → compile → split round-trip |
| `src/canvas/labelSlots.test.ts` | offset symmetry: two colliding chips split up and down, never both down |
| `src/preset/types.test.ts` | a v4 preset with `role: "rules"` / `kind: "conditional"` parses to `rule` / `imports`+guard |

---

## 16. Write-forbidden files

Forbidden to **every** lane, including Stage 0.

| File | Why |
|---|---|
| `src/identity/identity.ts` | A deliberately un-imported 7-member `Role` list (`:14-21, :38-46`) and `accentIdx = h2 % 7` (`:95, :110`). A conscientious sweep will "sync it to the new 14" and silently rotate **every existing user's avatars and calves**. Its header says so; obey it. See §14.5 for the token consequence. |
| `src-tauri/src/git.rs`, `src-tauri/src/git/tests.rs` | Defect 2 already landed there (§2.1). Re-editing risks regressing a working fix. |
| `src-tauri/src/hooks.rs`, `hooks_server.rs` | Out of scope (§19). |
| `src/scene/sfx.ts`, `src/scene/calf.ts`, `src/scene/cow.ts` | Barn art/audio; role-set fallout does not reach them. |
| `docs/INPUT_PROMPT.md` | *"Don't make changes here"* (`:5`). |

---

## 17. Lanes and the file-zone grid

Zones are **exclusive**. A lane may read anything and may write **only** the
paths in its row. A lane needing a foreign file **stops and reports upward** —
it does not edit it, and it does not work around it.

### Stage 0 — serial, blocking, one `tech-general`. Nothing parallelises until it lands.

#### Stage 0's mechanical-sweep licence — the ONLY sanctioned cross-zone write in WO13

Confirmed by Marty (ASK 7). It is bounded on all three axes and the bounds are
binding; anything outside them is a stop-and-report.

**Which files** — exactly the 19 non-Stage-0 files that read `node.pinned` today:
`src/wizard/preset.ts` · `src/wizard/NodeWizard.tsx` · `src/lint/types.ts` ·
`src/taskctx/TaskContextModal.tsx` · `src/import/types.ts` ·
`src/import/ImportReviewModal.tsx` · `src/preset/PresetsModal.tsx` ·
`src/preset/types.ts` · `src/preset/starter.ts` ·
`src/inspector/sectionOrder.tsx` · `src/inspector/Inspector.tsx` ·
`src/inspector/EventLog.tsx` · `src/sessions/AgentPanel.tsx` · `src/App.tsx` ·
`src/canvas/MemoryNodeCard.tsx` · `src/scene/demo.ts` ·
`src/handoff/HandoffNodeProposalModal.tsx` · `src/store/tokens.ts` ·
`src/canvas/roleMeta.ts`.
`src/project/ProjectWizard.tsx`'s two `pinned` hits are **prose**
(`:426`, `:634`) and are **not** in the licence.

**Which transformation** — exactly two, and nothing else:
1. `n.pinned` (read) → `n.rootLoad === "always"`; `pinned: X` (written into a
   node literal) → `...(X ? { rootLoad: "always" as const } : {})`.
2. The role string literals `"rules"` → `"rule"`, `"snippet"` → `"example"`,
   `"task"` → `"workflow"`, `"reference"` → `"architecture"`, where they appear
   **as a `NodeRole` value**. Prose, CSS token names and identity-ramp aliases
   (§14.5) are excluded.

**What it may not do** — no restructuring, no refactoring, no bug fixes, no copy
changes, no new imports beyond what the two transformations require, no touching
a file's behaviour. A file whose only change is these two substitutions.

**Why it exists:** the rename is compiler-enforced, so every site is found — but
without the sweep the tree stays red for the whole work order and no lane can run
`npm run build` to validate its own work. The sweep buys every lane a green
baseline. It runs **before** the lanes, serially, so no lane is ever editing a
file Stage 0 is editing.

Lane owners re-take their files immediately afterwards; the sweep grants Stage 0
no continuing claim on any of them.

| Deliverable | Files |
|---|---|
| `GRAPH_VERSION = 5`; v5 node/edge shapes (§4); the §5.1 pass list; `isGlobCondition`; `is_glob_condition`; serializer parity | `src/store/graph.ts`, `src-tauri/src/project.rs` (+ `project/tests.rs`) |
| New graph-store actions the lanes need (see below) | `src/store/graph.ts` |
| `ContextMenu` `layer` prop | `src/ui/ContextMenu.tsx` |
| `Toast.action` + `pushToastWithAction` + the no-dedupe-with-action rule | `src/store/toasts.ts` |
| Role/edge design tokens, legacy identity aliases (§14.5) | `src/styles/tokens.css` |
| `fs_apply_batch` stub + its `generate_handler!` entry; `resolve_load` module skeleton | `src-tauri/src/lib.rs`, `src-tauri/src/fsbatch.rs`, `src-tauri/src/resolve_load.rs` |
| Vitest wiring (§15) | `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `eslint.config.js` |

**Graph-store actions frozen in Stage 0** (because `src/store/graph.ts` is CLOSED
afterwards, and a lane discovering it needs an action is a stop-and-report):
`setRootLoad(id, "always" | undefined)` · `setDeprecated(id, Deprecated | undefined)` ·
`setNeedsReview(id, boolean)` · `setEdgeGuard(edgeId, EdgeGuard | undefined)` ·
`addEdge` gains the §7.3 legality check and the §7.2 `contradicts` no-op rule ·
`setAssemblePhase(nodeId, phase, startedAt)` beside the existing
`setAssembleStatus`.

### The 9 parallel lanes

| Lane | Agent | Owns (write) | Carries |
|---|---|---|---|
| **R1 — compile, resolver & commands emitter** | tech-general | `src-tauri/src/compile.rs` + `compile/tests.rs`, `src-tauri/src/resolve_load.rs` + `resolve_load/tests.rs`, `src/compile/api.ts`, `src/compile/types.ts` | E-A (Rust), E-C, §8, §9 (Rust), §10 **including §10.5 the `.claude/commands/` emitter and §18.1's three-part gate** |
| **R2 — lint, import, frontmatter, agents backend** | tech-general | `src-tauri/src/lint.rs` + tests, `import.rs` + tests, `frontmatter.rs` + tests, `agents.rs` + tests, `src/lint/types.ts`, `src/lint/api.ts`, `src/import/types.ts`, `src/import/api.ts`, `src/import/ImportReviewModal.tsx`, `src/agents/api.ts`, `src/agents/types.ts` | E-D, A-C (frontmatter), A-F (round-trip), defect 2 gate |
| **R3 — assemble, batch fs & taskctx** | tech-general | `src-tauri/src/assemble.rs` + tests, `src-tauri/src/fsbatch.rs` + tests, `src-tauri/src/taskctx.rs` + `taskctx/tests.rs`, `src/assemble/*`, `src/fs/api.ts`, `src/taskctx/TaskContextModal.tsx` | defect 5 backend, §3.2, §12.1, N-E command, **§8.4 (taskctx, moved from R1 by Amendment 1)** |
| **T1 — TS config layer** | tech-general | new `src/config/nodeTypes.ts`, `src/config/edgeRules.ts`, `src/config/resolveLoad.ts` (+ their `.test.ts`), `src/canvas/roleMeta.ts`, `src/canvas/edgeKind.ts`, `src/canvas/edgeVerb.ts`, `src/wizard/roleSkeleton.ts`, `src/wizard/roles.ts`, `src/preset/types.ts`, `src/preset/starter.ts`, `src/preset/PresetsModal.tsx`, `src-tauri/src/preset.rs`, `src/store/tokens.ts` | N-A (config), E-B, §5.7, §6.3, §8.3 (TS), §9 (TS) |
| **U1 — shared shells & node wizard** | tech-ui | new `src/ui/TwoPaneModal.tsx`, new `src/ui/PreviewPane.tsx`, `src/wizard/NodeWizard.tsx`, `src/wizard/paths.ts`, `src/wizard/preset.ts` | N-B, N-C, N-D, N-E (UI) |
| **U2 — canvas & edges** | tech-ui | `src/canvas/MemoryEdge.tsx`, `labelSlots.ts`, `KindPicker.tsx`, `GraphCanvas.tsx`, `MemoryNodeCard.tsx`, `RoleGlyphs.tsx`, `edgeColor.ts`, `edgeEdit.ts`, `lens.ts`, `portSlots.ts`, `edgePath.ts`, `types.ts`, `LensControl.tsx` | E-E (canvas), N-F (marker), defects 5 (render) and 7 |
| **U3 — agent modal & agents store** | tech-ui | `src/tasks/NewAgentDialog.tsx`, `src/agents/AgentEditor.tsx`, `ToolPicker.tsx`, `toolCatalog.ts`, `modelCatalog.ts`, `RailSections.tsx`, `AgentAvatar.tsx`, `SkillEditor.tsx`, `avatarApi.ts`, `src/store/agents.ts`, `src/sessions/AgentPanel.tsx`, `src/orchestrator/OrchestratorView.tsx` | A-A, A-B, A-C (UI), A-D, A-E, A-F (UI), defects 3 (call site), 4, 6 (agent half) |
| **U4 — Inspector, shell & rail** | tech-ui | `src/inspector/**` (Inspector.tsx is sole-owned), `src/App.tsx`, `src/rail/Hierarchy.tsx`, `src/handoff/*`, `src/store/project.ts` | N-F (banner + filter), E-E (E3 edge inspector), E-F (summary), defects 1 and 6 (file half) |
| **B1 — barn** | tech-barn | `src/scene/sceneGraph.ts`, `src/scene/palette.ts`, `src/scene/props.ts`, `src/scene/demo.ts`, `src/scene/mapper.ts` | §14.6 |

### Contested files — one owner each, with the reason

| File | Owner | Why not the other claimant |
|---|---|---|
| `src/store/graph.ts` | **Stage 0, then CLOSED** | Three lanes want store actions. Laying them all in Stage 0 is the WO03 lesson that made `lib.rs` closed; the same argument applies verbatim to the store. |
| `src/canvas/roleMeta.ts` | **T1** | It becomes a derived view of `nodeTypes.ts`. Owning the source and the shim in one lane is the only way they cannot drift. U2 imports it. |
| `src/canvas/MemoryNodeCard.tsx` | **U2** | Both of its WO13 edits — the defect-5 stepper and the `needsReview` marker — are canvas rendering. U4 has no claim; it never renders a card. |
| `src/App.tsx` | **U4** | The migration banner is the only WO13 edit, and U4 already sole-owns the Inspector the banner's filter drives. U1 needs nothing here. |
| `src/store/agents.ts` | **U3** | `local only` field config, avatar-seed freeze and the defect-6 nonce call are all agent-domain. R2 owns the Rust side and the wire types only. |
| `src/ui/ContextMenu.tsx` | **Stage 0** | U2 (edge menu) and U3 (avatar menu) both need the `layer` prop. One-line seam, laid before either starts. |
| shared two-pane / preview shells | **U1** | Named producer; **first deliverable**, with U3 as the frozen consumer (§14.1). |
| `src/styles/tokens.css` | **Stage 0** | U1, U2, U3 and B1 would all otherwise add `--role-*` entries. WO03-§4.3's exact failure. |
| `src-tauri/src/lib.rs` | **Stage 0** | Closed to every lane thereafter. |
| `src/lint/types.ts` vs `src/lint/api.ts` | **both R2** | They are a mirror pair of `lint.rs`'s structs. Splitting a mirror pair across lanes is WO03-D5's defect class. |
| `src/preset/*` + `src-tauri/src/preset.rs` | **T1** | The preset format is a second schema of the same shape (§5.7); its two sides must move together. |
| `src/import/*` + `src-tauri/src/import.rs` | **R2** | Same argument, same lane. |

**Every file not named above is CLOSED.** A lane that believes it needs one
stops and reports; tech-lead amends the grid or reassigns.

Known required edits inside already-assigned zones, so no lane is surprised:

- `src-tauri/src/import.rs:866-885 infer_role` — retarget the heading table
  (`"rule"` → `Rule`, `"snippet"|"example"` → `Example`, `"task"` → `Workflow`)
  and change the fallback at `:885` from `Reference` to `Architecture`. **R2.**
- `src-tauri/src/import.rs:1057-1066 edge_kind_slug` — 7 arms → 5. **R2.**
- `src-tauri/src/lint.rs:155-165 edge_kind_name` — 7 arms → 5. **R2.**
- `src/scene/sceneGraph.ts:104-123 propForRole` — 13 → 14. **B1.**
- `src/canvas/RoleGlyphs.tsx:9 PIXELS` and `src/canvas/edgeVerb.ts:37 VERBS` —
  exhaustive `Record`s; add/remove keys. **U2** (glyphs) / **T1** (verbs).
- `src/wizard/roleSkeleton.ts:14 SECTIONS` — exhaustive `Record`. **T1.**
- `src/canvas/roleMeta.ts:8 ROLE_DESCRIPTIONS` — exhaustive `Record`. **T1.**

> **Do NOT add a wildcard arm or an index signature to silence any of these.**
> The exhaustiveness is the safety net. `project.rs:592-605` documents that
> `NodeRole`/`EdgeKind`/`CompileTarget` are **deliberately closed** Rust enums
> with no `#[serde(other)]`, precisely so these matches stay total. Tolerance for
> unknown wire values lives in `migrate_graph`'s pre-pass and nowhere else.

### Ordering

```
Stage 0 ──► R1 ─┐
           R2 ─┤
           R3 ─┤
           T1 ─┼──► integration ──► audit ──► fix round ──► gates ──► docs
           U1 ─┤        (U3 consumes U1's shells; both may write in parallel,
           U2 ─┤         green is only required at integration)
           U3 ─┤
           U4 ─┤
           B1 ─┘
```

R1 needs `resolve_load.rs`'s skeleton from Stage 0; T1 needs `graph.ts`'s v5
types; R3's taskctx hunk codes against `resolve_load::always_closure`'s frozen
signature (§8.3) and does not wait for R1's body. Everything else is mutually
parallel.

**Why R1 was not split when it gained the emitter (Amendment 1, Q5).** The
emitter reads `Ctx`, the `read_file` overlay closure and `resolveLoad`'s answer,
and it shares `classify_output` and the stem-collision idiom with `emit_cursor`.
Splitting it into a tenth lane would put **two lanes inside `compile.rs`** — the
one thing this grid exists to prevent, and the shape that cost WO03 extra rounds.
Rebalanced instead by moving `taskctx.rs` + `TaskContextModal.tsx` **out of R1
into R3**: that work is two mechanical hunks (swap the `n.pinned` seed for
`root_load`, replace the hand-rolled walk with `always_closure`) with no design
left in it, and R3 was the lightest Rust lane. Net: R1 sheds one Rust module and
one modal, gains ~60 lines of emitter plus the three-part §18.1 gate. It fits.

---

## 18. Acceptance gates

### 18.0 Global (every lane)

`npm run build` · `npm run lint` (0 errors) · `npm run test` ·
`cargo clippy --all-targets -- -D warnings` · `cargo test` (658 today; must not
regress) · **75/75 invoke commands** declared, registered and called from TS by
exact name · no handler body returns a Stage-0 stub string · no `any` introduced.

### 18.1 THE NON-NEGOTIABLE GATE — byte-identical compiled output, with an ENUMERATED exception (owner: R1)

Amendment 1 makes two output changes intended. An unbounded *"except where it
differs"* gate is worthless, so the exception is enumerated exhaustively here and
the gate asserts **that list and nothing else**.

**Procedure (AMENDED 4).** The pre-WO13 baseline is **generated once from a real
pre-WO13 compiler and committed**, not re-derived by hand: check out the WO03
commit `605760e` in an **isolated `git worktree` outside the shared tree**, run
the then-current 2-arg `compile_preview` against the current fixtures, and
commit the dumps as `tests/fixtures/compiled_baseline_v4_in.json` and
`compiled_baseline_v4_rule1_in.json`. All three parts then compute a real
`diff_file_sets` against those dumps and assert it **equals the enumerated
exception set exactly** — no substring probes, no spot checks. A hand-traced
expectation is not a baseline (D1).

> **AMENDMENT 4 (2026-08-21) — Exception P, and why the enumeration keeps coming
> up short.** Found by the rebuilt gate on its first real run. Three times now a
> §18.1 exception list has been incomplete, and **every time the missing item was
> an output change I specified elsewhere in this same document** — Amendment 1's
> destination lock (§21), D2's closure row (below), and now §10.4's precedence
> marker. Standing rule: **§18.1's exception list must be derivable from the set
> of sections that change emitter behaviour — §8.2 rules 3/4, §10.2, §10.3, §10.4,
> §10.5.** Walk that list against §18.1 whenever any of them changes.
> Audited against the rebuilt gate's real diff: §10.2 is byte-identical by
> construction (single-element `join(",")`), §9's `edge_participates_in_order` is
> a no-op against pre-WO13 (`conditional` was never structural either), §10.3 is
> Part C, §10.5 + §8.2 are Parts A and B. **The set is now complete**, and from
> here the gate — not this enumeration — is the authority.

**Exception P — §10.4 precedence markers. Applies to ALL THREE parts.**
For every `overrides` edge `A → B` where
`resolveLoad(A).policy == resolveLoad(B).policy == "always"` (§11.1
co-residency), exactly one line

```
<!-- cowtext:precedence -->Takes precedence over "{B.title}" below.
```

is **inserted** immediately before `A`'s pinned line, in each of the four root
files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`.github/copilot-instructions.md`). Nothing else changes: no line is removed,
reordered or reworded. `.cursor/rules/*.mdc` and nested `{dir}/AGENTS.md` are
**unaffected** — `precedence_markers` has exactly one call site, `emit_root`
(`compile.rs`), and that is itself part of the assertion.

This fires in Part A's control fixture: `graph_v4_in.json`'s `e06-x`
(`n09-x --overrides--> n02-x`, both `pinned` in v4 ⇒ both root-always in v5) is
co-resident after migration. That is **intended** — §10.4 is block E-C, a
deliberate change independent of Amendment 1 — and the original Part A prose
simply failed to reconcile with it.

**Part A — the control (`tests/fixtures/graph_v4_in.json`).**
Its `command` node (`n08-x`) and `skill` node (`n11-x`) are both unpinned and
neither is a glob target, so:

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
  every nested `{dir}/AGENTS.md` and every `.cursor/rules/*.mdc` are
  **byte-identical, except for Exception P's single inserted line in each of
  the four root files** — asserted line-for-line, not tolerated.
- Exactly **one new file** appears: `.claude/commands/run-the-suite.md`
  (from `n08-x`, which is orphaned — rule 1 is "regardless of edges").
- Nothing is removed.

**Part A's control fixture is deliberately NOT quietened.** Deleting `e06-x` to
make "control" mean "zero differences" was considered and **rejected**: it is
the only `overrides` edge in the corpus, so removing it would leave §10.4 — one
of the three edge-model deliverables — with **no gate coverage at all**. A
control that asserts one precisely-bounded, known change is strictly more
informative than one that asserts none: it proves the marker fires, fires once,
fires in the right position, and fires in exactly four files. A gate that can
only say "nothing changed" cannot distinguish *correct* from *the emitter never
ran*.

**Part B — the enumerated exception (`tests/fixtures/graph_v4_rule1_in.json`).**
For every node **N** in the v4 graph whose role is `command` or `skill`, and for
nothing else, exactly these **six** differences are permitted (row 6 added by
Amendment 2, D2) — and each must be asserted, not merely tolerated:

| # | Pre-migration state of N | Post-migration difference |
|---|---|---|
| 1 | N was effective-pinned | The line `@{N.filePath}` (or its `- [title](path)` form) is **gone** from `## Always read` in every root file. Every other line in that section is unchanged and in the same order. |
| 2 | N.role == `command`, not deprecated | A **new** file `.claude/commands/{stem}.md` appears, per §10.5 — but only when `claude` is a compile target. |
| 3 | N.role == `skill` | **No new file** anywhere. §10.6. |
| 4 | any | N's `## Read when relevant` bullets are **unchanged** — count, text and order. Rule 1 never suppresses an edge-driven bullet. |
| 5 | any | Other nodes' `.mdc` names are **unchanged** — the commands emitter uses a separate collision counter (§10.5, F9). |
| **6** | N was effective-pinned **and** is the source of an unguarded `imports` edge to some node **D** | **D's** `@{D.filePath}` line is also **gone** from `## Always read` in every root file, transitively for D's own unguarded-`imports` subtree. Rule 1 excludes N from `AlwaysClosure` as a **seed**, so always-ness never propagates through it (§8.2). D's `.cursor/rules/*.mdc` is **unchanged** (ignore mode), and `lint.rs` reports `unreachable-import` for D — the change is surfaced, not silent. |

**Every `.cursor/rules/*.mdc` file is byte-identical in Part B as well**,
including N's own — rule 1 does not reach `emit_cursor` (§10.5). If a `.mdc`
changes or disappears, that is a defect, not an exception.

`graph_v4_rule1_in.json` is built to hit all six plus that Cursor assertion:
`r01` pinned `rules` (control, must not move), `r02` pinned `command`
(rows 1, 2 — and its `.mdc` must survive unchanged), `r03` pinned `skill`
(rows 1, 3 — same), `r04` unpinned `command` that is the target of a
glob-conditional edge from `r01` (rows 2, 4 — and its glob `.mdc` must survive),
`r05` orphan `command` (row 2 alone — the "regardless of edges" half), and
`r06` pinned `command` with an unguarded `imports` edge to `r07`
(`architecture`) — **row 6**, the case the original five-row fixture could not
express, because every edge in it was sourced at the control node `r01`.

**Part C — deprecation.** A lane-authored variant of Part A sets
`n12-x.pinned = true` and asserts the only difference is the removal of that
node's `@path` line and its `.mdc` — the one sanctioned deprecation-driven
output change.

Any difference outside A + B + C is a **defect**, not an acceptable consequence.

### 18.2 Migration (owner: Stage 0)

- `serializeGraph(migrateGraph(read("graph_v4_in.json")))` **byte-equals**
  `read("graph_v5_out.json")`, from **both** TS (Vitest) and Rust
  (`serialize_graph(migrate_graph(...))`).
- Idempotent: migrating `graph_v5_out.json` again reproduces it byte-for-byte,
  in both languages.
- Node count unchanged (13 in, 13 out). No `brief`, `title` or `filePath` lost.
- Edge count 9 → 7 with exactly the two documented deletions (`e07-x`
  supersedes-converted, `e09-x` reciprocal-collapsed) and no others.
- `write_graph` on a project holding a v4 `graph.json` produces
  `.cowtext/graph.v4.bak.json` byte-equal to the pre-migration file, exactly
  once; a second write does not touch it.

### 18.3 `frontmatter.rs` (owner: R2)

- `emit(parse(c)) == c` for a fixture agent file that already carries all five
  new keys **and** `mcpServers`, `hooks`, `background`, `effort`, `isolation`,
  `initialPrompt`.
- A no-op `patch` (no field changed) leaves that file byte-identical — bracket
  vs comma list form, quoting, and CRLF all preserved.
- A file with no frontmatter and a file with an unterminated fence still degrade
  to `Raw` exactly as today.

### 18.4 `resolve_load` (owners: R1 + T1)

- Every case in `tests/fixtures/resolve_load_cases.json` passes from **both**
  `cargo test` and Vitest, with identical `policy`, `reason` and
  `decidingEdgeId`. A case's optional `mode` selects the entry point
  (`"apply"` = `resolve_load`, default; `"ignore"` =
  `resolve_load_ignoring_role_lock`); a reader that ignores `mode` will fail the
  paired `c13`/`c13b` cases, which are the same graph in both modes.
- `resolve_load` and `resolve_load_ignoring_role_lock` are **one implementation**
  with a `RoleLock` parameter, not two copies.
- `rg "resolve_load_ignoring_role_lock" src-tauri/src/` returns exactly **one**
  call site outside `resolve_load.rs` and its tests: `compile.rs::emit_cursor`.
  A second call site is a contract violation, not a judgement call.
- `rg "effective_pinned" src-tauri/src/` returns zero hits outside
  `resolve_load.rs`.
- `taskctx.rs` contains no `n.pinned` test and no hand-rolled `imports` walk,
  and passes `RoleLock::Apply`.

### 18.5 Config layer (owner: T1)

- `nodeTypes.ts` has exactly 14 entries, one per `NodeRole`, group counts
  1+3+2+5+3; every `microExample` non-empty; **no hex literal anywhere in the
  file** (`rg "#[0-9a-fA-F]{3,8}" src/config/` returns zero hits).
- `rg "\"rules\"|\"task\"|\"reference\"|\"snippet\"" src/ --glob '!*.test.ts'`
  returns zero hits as **role values** (prose and the identity-ramp token names
  are exempt and must be checked by eye).
- `rg "conditional|supersedes|conflicts-with" src/ src-tauri/src/` returns hits
  only inside migration code and its tests.

### 18.6 Lint (owner: R2)

All ten checks in §11.2 have tests, including a cycle fixture. Every emitted
`fix` deserializes into `LintFix`. `lint_run` writes nothing (assert a clean
`mtime` on `graph.json` across a run).

### 18.7 Filesystem-untouched (owners: U1, U3)

- Walk the node-creation flow to step 4 without confirming; assert the project
  tree is byte-identical (file list + contents hash).
- Same for the agent modal up to (not including) Confirm.
- `fs_apply_batch` with a mid-batch failure (second entry's parent made
  read-only) leaves the tree byte-identical and returns an `Err` naming that
  path.
- The inverse batch returned by a successful call, when applied, restores the
  tree byte-identically — including deleting files that did not previously
  exist.
- **One-writer guard (Amendment 1):** `fs_apply_batch` rejects a batch
  containing `.claude/settings.json`, `.claude/agents/x.md`, **or**
  `.claude/skills/foo/SKILL.md`, and rejects the *whole* batch — no partial
  application. The `.claude/skills/` case is the one a naive `.md`-suffix check
  lets through (§12.1 rule 3), so it gets its own named test.
- `.claude/commands/x.md` is **accepted**, and a duplicate `rel_path` in one
  batch is rejected.

### 18.8 Shared shells (owner: U1, verified at integration)

`rg "from \"../ui/TwoPaneModal\"|from \"./ui/TwoPaneModal\"" src/` ≥ 2 importers;
same for `PreviewPane`. A preview keystroke is reflected within 200 ms. Below
1024 px the panes stack with no horizontal scroll.

### 18.9 The seven defects

| # | Gate |
|---|---|
| 1 | The Inspector's project panel has a working `Git…` button; `rg "Manage git from" src/` returns zero hits. |
| 2 | `git_init` on a fresh folder with `branch: "trunk"` leaves `.git/HEAD` pointing at `refs/heads/trunk`, and `git_status` reports `branch: "trunk"` **before** any commit. On a folder nested inside an outer repo, `git_status` reports `isRepo: false`. (Verification only — no code change.) |
| 3 | Clicking the avatar in the New Agent modal opens the menu **above** the modal, and every item is clickable. Same for the Tools dropdown inside any modal. |
| 4 | Typing a 20-character name changes the identicon **zero** times; `Reset seed` changes it; editing the filename directly changes it. |
| 5 | Assembling a node shows a 3-step stepper advancing `starting → running → writing` with a live elapsed readout, and never `animate-hard-blink` on a bar with no data behind it. |
| 6 | Assemble a plain node → the Markdown tab shows the new content without reselecting. Assemble an agent node → same, and the caret is not stolen mid-edit. |
| 7 | Recolour a wire → the chip takes the same colour. Two colliding chips split **one up, one down**, asserted by `labelSlots.test.ts`. **Plus the manual step in §18.10 item 2** — the "went below after a colour change" half is not statically provable and must be walked, not assumed. |

### 18.10 Manual-walk steps the automated gates cannot cover

`tester` writes these into `docs/testing/WO13_TEST_MANUAL.md` in the PHASE2
format. Each exists because a lane must not assume the answer.

1. **The generated slash command is real.** Compile a project containing one
   `command`-role node. Open Claude Code in that project, type `/`, and confirm
   the command is listed under its `description` and runs. If it is **not**
   listed, the `description` frontmatter fence is the suspect — apply §10.5's
   named fallback (body + GENERATED header, no fence) and re-walk. Record which
   form worked; `project-manager` puts the answer in `TERMINOLOGY.md`.
2. **Defect 7's actual trigger.** With two edges whose labels collide, recolour
   one wire and record whether the chip *moves* as well as whether it recolours.
   §2.7 proves the recolour half and the always-downward half by reading;
   nothing in `reportBox`'s deps (`MemoryEdge.tsx:342`) explains a colour-change
   re-measure. If the chip does move, that is a **third** cause and a new
   finding — it does not get folded into U2's fix silently.
3. **A hand-authored command file is protected.** Create
   `.claude/commands/deploy.md` by hand with no GENERATED header, then compile a
   `command` node whose file stem is `deploy`. The diff must show it as
   `handwritten` and must not write it without an explicit tick.
4. **`.claude/skills/` is never written by compile.** Compile a project with a
   `skill`-role node and confirm no file under `.claude/skills/` appears in the
   preview at all.

---

## 19. Out of scope for WO13

From the three specs' own scope guards, plus this contract's additions.

| Item | Why |
|---|---|
| ~~A `.claude/commands/` emitter and `resolveLoad` rule 1~~ | **NO LONGER OUT OF SCOPE.** Amendment 1 brings both in — §21, §10.5, §8.2. |
| **A `.claude/skills/` emitter** | §10.6. `agents.rs` owns that path through four invokes; a second writer separated by human time is WO11's one-writer defect class, which no lock fixes. `classify_output` must keep refusing it. |
| `argument-hint` / `allowed-tools` frontmatter on generated command files | §10.5 emits `description` only. Guessing at keys whose behaviour has not been verified is exactly what D9 exists to prevent. |
| **Mapping `on-invoke` onto Cursor's manual-rule form** (a `.mdc` with `description` and neither `alwaysApply` nor `globs`) | §10.5. Probably the right long-term mapping, but it is unverified third-party behaviour and D9's rule applies. Until it can be walked, `.cursor/rules` is left exactly as it is — which is also the non-lossy choice. |
| **Rewriting the assemble runner onto `--output-format stream-json`** | §3.3. Names `sessions.rs` as the reference implementation when it happens. |
| **Omitting a `references` `@path` when the target is already inlined** | §3.6(c). Changes existing output for zero defect. |
| No new dependencies beyond **Vitest** | CLAUDE.md: the stack is fixed. No markdown renderer, no jsdom, no testing-library, no image crate. |
| `contradicts` auto-resolution, under any framing | Edge spec's explicit guard. The linter reports and stops. |
| Line excision for `overrides` | Edge spec Block C: identifying "the conflicting lines" needs structure the content does not have. |
| Barn/hooks/licensing changes beyond the role-set fallout | All three specs' guards. |
| Agent spawning, session management, fleet runtime | Agent spec scope guard; Phase 7, unapproved. |
| Multi-provider model support | Agent spec D1: this modal writes one format. |
| Deleting unrecognized frontmatter keys | Agent spec F; `FmLine::Extra` must keep round-tripping. |
| `mcpServers`, `hooks`, `isolation`, `background`, `effort`, `initialPrompt` as **known** frontmatter keys | Agent spec N3. They survive as `Extra` (§14.4). |
| Invariant drift detection; bulk retype; node templates; graph-wide budget viz | Node spec N1–N4, edge spec N2–N3. |
| Importing `CLAUDE.md` / `.cursor/rules` into typed nodes | Node spec N5. `import.rs` keeps its existing behaviour with retargeted roles only. |
| Drag-to-reorder anything; changing the wizard's step count or header/footer copy | Node spec scope guard. |
| `edge.order` | §4.2. `readOrder` exists. |
| Editing `src/identity/identity.ts` | §16. |

---

## 20. ASK list — CLOSED 2026-08-21

All eight are ruled. Nothing in this contract is waiting on a decision.

| # | Subject | Ruling |
|---|---|---|
| 1 | §3.1 (D6) — `.claude/commands/` emitter | **OVERRULED.** Build it this round. §21. The "never fabricate a path" half survives. |
| 2 | §3.2 (D8) — `influence` boot-prompt line | **CONFIRMED.** Delete `assemble.rs:587-589` **and** `AgentFacts.influence`, together. |
| 3 | §3.3 (defect 5) — assemble progress | **CONFIRMED.** `phase` + `startedAt` + 3-step stepper. Stream-json backlogged, naming `sessions.rs`. |
| 4 | §3.4 — `pushToast` | **CONFIRMED.** Sibling `pushToastWithAction`; action-bearing toasts never deduped. |
| 5 | §3.5 — `resolveLoad` rule 1 | **OVERRULED.** Rule 1 in force; `on-invoke` restored; §18.1 becomes an enumerated exception. §21. |
| 6 | §3.6(a) — edge `needsReview` | **CONFIRMED.** Node field only. |
| 7 | §4.1 — `pinned` → `rootLoad?` | **CONFIRMED**, with the sweep licence bounded in writing (§17, Stage 0). |
| 8 | §14.5 — legacy `--role-*` aliases | **CONFIRMED.** The three aliases survive, annotated. |

My six disagreements with the approved plan are ratified except #1, which ASK 5
overrules: #2 (closure from roots, `unreachable-import`), #3 (`kind.is_structural()
&& guard.is_none()`), #4 (edge `needsReview` is dead schema), #5 (one symmetric
`fs_apply_batch`), #6 (no defect-7 fix may assume a colour change re-triggers
`reportBox` — verified by §18.10 item 2 instead).

No new libraries are requested beyond the already-approved Vitest.

---

## 21. Amendment 1 — the `.claude/commands/` emitter (normative)

Ruled by Marty 2026-08-21, overruling ASK 1 and ASK 5. **Supersedes §3.1 and
§3.5 in full.** Every other section already reads as amended. This is a
deliberate scope addition: the node spec's A2 table locks `command` →
`on-invoke` and `skill` → `on-demand` as un-overridable, and Marty wants that
real rather than approximated by draw-time deny rules.

### 21.1 The gate is amended, not abandoned — Q1

An unbounded "except where it differs" gate is worthless. §18.1 is rewritten as
**three parts with a five-row enumeration**, each row asserted rather than
tolerated, plus a new input fixture `tests/fixtures/graph_v4_rule1_in.json`
built to hit all five. Any difference outside that list is a defect. R1 owns it.

The list came out at five rather than seven because of a hole found while
writing it: **rule 1 must not reach `.cursor/rules`.** Cursor has no invoke
mechanism, so applying the destination lock there would delete a Cursor-only
user's `.mdc` and give nothing back — silent content loss on migration for a
user who never asked for Claude Code output. `emit_cursor` therefore calls
`resolve_load_ignoring_role_lock` (§8.3, one call site, same implementation,
same fixture corpus), and **every `.mdc` stays byte-identical in both parts**.
§10.5 carries the reasoning; the Cursor manual-rule mapping is backlogged (§19).

### 21.2 `skill` gets NO emitter — Q2

**Verdict: the lean is correct.** `.claude/skills/<name>/SKILL.md` is
CRUD-managed by `agents.rs` through four of the 74 invokes. Compile emitting
there makes two subsystems write one path, separated by human time — WO11's
one-writer defect class, which a lock cannot fix because the writes are minutes
apart, not microseconds, and which cost WO11 three of its four highest-severity
defects.

`skill`'s fixed destination is therefore **the file `agents.rs` already
manages**, and rule 1's whole effect on a `skill` node is exclusion: it can never
resolve `always`, so it leaves `## Always read`. No new file, and
`classify_output` gains **no** `.claude/skills/` arm. Content survives wherever
an edge points at it, because §10.5 leaves the on-demand bullets edge-driven,
and its `.cursor/rules/*.mdc` survives untouched (F11). Full detail: §10.6.

Two enforcement points are required, not one: `classify_output` **and** an
explicit `.claude/skills/` clause in `fs_apply_batch`'s one-writer guard —
`SKILL.md` ends in `.md`, so that command's suffix test would otherwise admit it
(F12, §12.1 rule 2).

### 21.3 `classify_output` shape and the collision rule — Q3

**One component, `.md` extension, FULLY GENERATED (`Some(false)`), not
surgical.** The arm mirrors the existing `.claude/agents` arm in shape;
`.claude/commands/sub/x.md` is refused.

Surgical mode exists only because an agent file has a hand-authored region owned
by `agent_save`'s queue. A command file has no such owner and no Cowtext-managed
region. **Choosing "fully generated" is what makes the collision rule free:** a
hand-authored `.claude/commands/deploy.md` is an existing, non-empty file with no
GENERATED header, so `PreviewFile.handwritten` (`compile.rs:423-426`) already
flags it and `CompileModal` already makes overwriting it loud and opt-in. No new
rule is invented; the existing trust boundary covers a path the user may already
own. §18.10 item 3 walks it. Full detail: §10.5.

### 21.4 Existing `command` nodes are NOT moved — Q4

The migrator cannot move files: `migrate_graph(raw: &str)` has no filesystem
access, the same constraint that pushed the `$ARGUMENTS` sniff to lint (§5.2).

**Verdict: compile emits a generated file; the node's `filePath` is untouched.**
`.claude/commands/<stem>.md` stands in exactly the relationship to
`context/<x>.md` that `.cursor/rules/<stem>.mdc` already does — a generated
derivative carrying the GENERATED header, produced from the source file on every
compile, never hand-edited. `emit_cursor` (`compile.rs:1013-1026`) already
inlines a node's whole body into a second path today; this is the same
mechanism, one more destination.

**This is not the duplicate-content failure mode.** That failure mode is *two
writers, two sources of truth*. Here there is one source of truth
(`context/<x>.md`, hand-edited), one writer (`compile_write`, behind the
diff-preview gate), and one derivative that announces itself as generated on
line 1 of its body. Nothing hand-authored is duplicated into a place that will
be silently overwritten, because a file lacking the GENERATED header is flagged
`handwritten` before anything is written (§21.3).

The alternative — requiring a command node's `filePath` to live under
`.claude/commands/` — would break every existing `command`-role node on load,
needs a file move the migrator cannot perform, and would make `context/` and
`.claude/commands/` two writable homes for the same content. Rejected.

### 21.5 R1 is NOT split — Q5

The emitter reads `Ctx`, the `read_file` overlay closure and `resolveLoad`'s
answer, and shares `classify_output` plus the stem-collision idiom with
`emit_cursor`. A tenth lane would put **two lanes inside `compile.rs`**, which is
the single thing this grid exists to prevent.

Rebalanced instead: `src-tauri/src/taskctx.rs` (+ tests) and
`src/taskctx/TaskContextModal.tsx` move **R1 → R3**. That work is two mechanical
hunks with no design left in it (§8.4), and R3 was the lightest Rust lane. R1
sheds one Rust module and one modal and gains ~60 lines of emitter plus §18.1's
three-part gate. §17 is updated.

### 21.6 What Amendment 1 does NOT change

**Invoke count is still 74 → 75.** The emitter adds no command —
`compile_preview` and `compile_write` carry it, `compile_write`'s allowlist gains
one arm. `fs_apply_batch` remains the only new invoke.

Also unchanged: the v5 wire shape (§4 — no new node or edge field), the migration
pass list (§5.1 — role `command` still migrates to `command`, unflagged), the
Stage 0 deliverables, and the other eight lanes' zones.

---

## 22. Numbered requirements — findings neither spec nor plan anticipated

These are requirements, not commentary. Each has an owning lane and a gate.

| # | Requirement | Owner | Gate |
|---|---|---|---|
| **F1** | **Preset format bumps v4 → v5 in lockstep** and `parsePreset` runs the **same §5.1 pass list** before `asRole`/`asKind`. Left alone, a v4 preset carrying `role: "rules"` loads as the `architecture` fallback and `kind: "conditional"` flattens to `references`, silently dropping the guard. `PresetVersion` becomes `1..5`; `preset.rs:70-72` accepts `1..=5`. | T1 | §18.2 + `src/preset/types.test.ts` |
| **F2** | **`src/preset/starter.ts` ships three deleted roles** — `task` (`:74`), `reference` (`:83`, `:91`). Frozen replacements: Task Board → `workflow`, Backlog → `architecture`, Changelog → `architecture`; `pinned: false` (`:55`) → omit `rootLoad`. Without this the shipped starter pack fails to load on first use. | T1 | Applying the starter preset on a fresh project produces 3 nodes with those roles |
| **F3** | **`--edge-c-slate` must stop aliasing `--role-snippet`** (`tokens.css:139`). `snippet` is removed; the alias would resolve to nothing and blank every slate-coloured wire. Inline the literal `#8CA0B8`. `--edge-c-violet: var(--role-invariant)` survives — `invariant` is kept. | Stage 0 | An edge with `color: "slate"` renders a visible stroke |
| **F4** | **The three legacy `--role-*` aliases survive** (`--role-rules`, `--role-task`, `--role-reference`). `identity.ts:38-46,117` resolves its frozen 7-member accent ramp through `var(--role-<name>)` and the file is write-forbidden. Deleting them blanks the accent on every existing user's avatars and calves. §14.5. | Stage 0 | An avatar with each of the 7 `accentIdx` values renders a non-transparent accent |
| **F5** | **An action-bearing toast is never deduped.** `dedupeKey` (`toasts.ts:56-58`) hashes `severity\|title\|detail` only, so two "Node created" toasts inside `DEDUPE_WINDOW_MS` collapse and the second Undo closure is discarded — the user's Undo then reverts the **wrong** write. `push` skips the dedupe lookup when `t.action !== undefined`. §3.4. | Stage 0 | Two node creations within 2 s show two toasts; each Undo reverts its own write |
| **F6** | **`AssembleProgress` has no `mode` field**, contrary to `docs/TERMINOLOGY.md` and the `cowtext-terminology` skill, both of which document `{nodeId, mode, status, error}`. Actual shape at `assemble.rs:75-82` is `{node_id, status, error}`. The docs are wrong and must be corrected at close-out, not the code. | project-manager (close-out) | `docs/TERMINOLOGY.md` and `.claude/skills/cowtext-terminology/SKILL.md` name the real shape incl. `phase`/`startedAt` |
| **F7** | **`migrate_graph` has no filesystem access**, so node-spec A4's `command`-vs-`env` body sniff is not implementable in a migrator. It becomes the lint check `command-may-be-env`. §5.2. | R2 | The check exists and fires on a `command` node whose body has no `$ARGUMENTS` |
| **F8** | **Deleting `assemble.rs:587-589` requires deleting `AgentFacts.influence` too**, or `cargo clippy -- -D warnings` fails on `field is never read`. §3.2. | R3 | `cargo clippy --all-targets -- -D warnings` clean |
| **F9** | **The commands emitter and `emit_cursor` must use SEPARATE stem-collision counters.** Sharing one renumbers `.mdc` files for unrelated nodes — a silent output change that §18.1 row 7 exists to catch. §10.5. | R1 | §18.1 Part B row 7 |
| **F10** | **`defect 2` provenance:** the `WO13 fix` comments in `git.rs` are lane R-GIT's, landed this session in parallel with this contract — not pre-existing tree state. §2.1. | project-manager (close-out) | `docs/fleet/ACTIVITY_LOG.md` attributes it to R-GIT |
| **F11** | **Rule 1 must not reach `.cursor/rules`** (found while writing Amendment 1). Cursor has no invoke mechanism, so applying the destination lock in `emit_cursor` deletes a Cursor-only user's `.mdc` and offers nothing back — silent content loss on migration for a user who never asked for Claude Code output. `emit_cursor` calls `resolve_load_ignoring_role_lock`, one call site, same implementation. §10.5, §8.3. | R1 | §18.1 Part B ("every `.mdc` byte-identical") + fixture cases `c13`/`c13b` |
| **F12** | **`fs_apply_batch`'s `.md`-suffix acceptance would admit `.claude/skills/foo/SKILL.md`** — `classify_output` refusing it is not enough, because it is consulted only by the first half of an `or`. The one-writer guard gains an explicit `.claude/skills/` clause. §12.1 rule 2. | R3 | §18.7's named `.claude/skills/` rejection test |
