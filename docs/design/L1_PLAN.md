# L1 development plan — finishing the context graph

**Opened 2026-08-24.** A plan, not a frozen contract. It supersedes the baseline of
`docs/_archive/contracts/WO04_CONTRACT.md` while keeping most of its design; §0 says exactly what
of that contract survives.

Grounded in a code read on 2026-08-24, not in the contract's own prose or the backlog.

## 0. Verdict on WO04_CONTRACT.md

**The design is good. The baseline underneath it is dead. Do not dispatch it — rebase it.**

The contract was frozen 2026-08-19 against the WO03 state. Four work orders have landed
since (WO06, WO09–WO13, WO15, WO16) and moved the ground it stands on:

| The contract assumes | Reality on 2026-08-24 |
|---|---|
| invoke **54 → 62** | **81**. All eight commands it proposes (`hierarchy_resolve`, `context_resolve`, `link_status`, `link_apply`, `link_remove`, `loadout_read`, `loadout_write`, `git_head_watch`) are **absent** — its backend was never built |
| must-not-break #11: "`GRAPH_VERSION` **stays 3**" | Schema is **v5** (v3→v4 WO10 waypoints, v4→v5 WO13) |
| 13 node roles, 7 edge kinds | **14 roles, 5 edge kinds** |
| §4.1 role table names `rules`, `task`, `reference`, `snippet`, `persona` | All renamed or gone: `rule`, `workflow`, `architecture`, `example`, `agent`. **Three roles have no emission policy at all** — `decision`, `env`, `tool` are new in v5 |
| D5: applying a loadout "writes `pinned` / `readOrder` into `graph.json`" | **`pinned: bool` no longer exists** — v5 replaced it with `rootLoad?: "always"`. D5 is invalid as written |
| must-not-break #16 names `effective_pinned` as unchanged | That function is gone; `src-tauri/src/resolve_load.rs` and its TS mirror `src/config/resolveLoad.ts` replaced it |
| Amendment A1: "of the 13 roles, **only `agent`** has compile semantics" | No longer true. WO13's Amendment 1 rule 1 already locks `command` → on-invoke and `skill` → on-demand regardless of edges and `rootLoad` (`resolve_load.rs:133-161`, `RoleLock::{Apply,Ignore}`) |
| D17: consolidate `classify_output` | **Already landed** — `src-tauri/src/import.rs:767-769` delegates to `compile::classify_output` |
| §4.7 token-cost counts | **Already shipped** — `src/compile/CompileModal.tsx:137-151`, `src/assemble/AssembleConfirmModal.tsx:147` |
| D18: `Other(String)` enum preservation → "WO06, trigger: a second Rust writer" | WO06 came and went without it. The row is now homeless (BACKLOG §Re-homing needed) |
| §4.10 GitHub Action | **No `.github/` directory exists in the repo.** Its CLI prerequisite is already done (`cowtext_cli.rs:161-188` — `--root`, `--json`, `compile --check`) |
| §4.4 skill artifact target | **Premise reversed.** `compile.rs:869`: `.claude/skills/` "is CRUD-managed by `agents.rs` and compile must never write there". §4.4 is **invalid**, and D16 retires with it |
| §4.1's `command → Inline { "Commands" }` | **Contradicts shipped code.** `command` nodes already compile to their own `.claude/commands/<stem>.md` (`compile.rs:1112-1146`) |
| R1's new module `src-tauri/src/resolve.rs` | **Name collision** with WO13's unrelated `resolve_load.rs` |
| R4's zone: "`git.rs` — new file, exclusive" | `src-tauri/src/git.rs` is **636 lines with three landed commands**; the zone claim is false |
| P1's zone: `CLAUDE.md`, `README.md`, skill mirrors | `CLAUDE.md`→`AGENTS.md` and `.agents/skills/*` are **generated** by `scripts/truth.mjs`, and docs-guard denies hand edits. The zone description is invalid |
| §3.1's frozen `mod` list | Omits six modules that now exist: `fsbatch`, `project_meta`, `resolve_load`, `taskctx`, `tasklinks`, `toolchain`. The trailing-comma append protocol is stale too |
| must-not-break #15's "seven pre-WO03 roles" | Names four roles that no longer exist, against a byte-identity baseline (`605760e`) nine work orders behind; the goldens in `compile/tests.rs` have been rewritten since |

What survives unchanged and is worth keeping verbatim: the **must-not-break list**
(1–14, with #11 and #16 restated in v5 terms), **D1** (junctions are not in the file
ladder), **D2** (the simulator models `CLAUDE.md` only), **D3** (frontmatter has one
writer), **D8** (no resolved preview for `cursor`/`skill`), **D10** (global scope is
read-only), **D13**'s *principle* (an exhaustive match, not a map, so a new role cannot
compile until it declares a policy), **D15** (inlining applies to the pinned position of
the four root targets only), **D16** (skill nodes leave root files only when the `skill`
target is on), **D19** (`warnings` coexists with `files`, outside errors-XOR-files).

## 1. The one architectural change

**Do not add `Emission` as a sixth role table.**

A node role is already keyed by five separate tables:

| Table | Facet it owns |
|---|---|
| `src/config/nodeTypes.ts` — `NodeTypeMeta` | group, label, hint, micro-example, accent, `defaultLoad`, `loadLocked`, `lockedReason` |
| `src/config/resolveLoad.ts` + `src-tauri/src/resolve_load.rs` | when a node loads (`LoadRole` = `Command \| Skill \| Other`) |
| `src/canvas/roleMeta.ts` | canvas card presentation |
| `src/canvas/RoleGlyphs.tsx` | the 8×8 pixel glyph |
| `src/styles/tokens.css` | `--role-*` colours |

`WO04_CONTRACT.md` §4.1 proposes a sixth in `src-tauri/src/compile/roles.rs`. Two tables
keyed on the same enum, maintained apart, is precisely the failure this repo has already
recorded twice as a standing lesson — *"audit mirrors against the contract text, never
against their twin."*

**Instead:** `resolve_load` answers *when* a node loads; emission answers *how it
renders*. They are genuinely orthogonal facets, but both are functions of role, so they
get **one declaration site**. Extend `NodeTypeMeta` (and its byte-mirrored Rust
counterpart) with an `emission` field, so adding a role forces both answers at once and
the exhaustive match still refuses to compile until it is declared. D13's property is
preserved; the drift risk is not created.

## 2. Emission policy, rebased to v5

**The contract's own `Artifact` arm is already built, by a different and better route —
so what remains to build is only the `Inline` arm.** This is the single biggest scope
reduction in this plan, and getting it wrong would send a lane to fight shipped code:

- **`command` is already an artifact.** `compile.rs:1112-1146` emits `command` nodes to
  their own `.claude/commands/<stem>.md`, gated on `resolve_load` returning `OnInvoke`.
  The contract's `command → Inline { "Commands" }` **contradicts what ships**. Keep the
  destination lock; drop the inline section.
- **`skill` must never be an artifact of compile.** `compile.rs:869` states the reverse
  of §4.4 outright: `.claude/skills/` "is CRUD-managed by `agents.rs` and compile must
  never write there." Skill nodes resolve to `OnDemand`. §4.4 is **invalid**, not merely
  unbuilt, and dropping it also retires D16.

What is left is audit O2's original complaint, still true for **12 of 14 roles**:
`invariant`, `trap`, `example`, `env`, `decision`, `tool`, `rule`, `architecture`,
`workflow`, `glossary`, `style`, `agent` change **zero bytes** of any target.

Rebased table — two strategies, not three:

| Roles | Emission | Note |
|---|---|---|
| `agent`, `rule`, `architecture`, `decision`, `workflow`, `glossary`, `style`, `tool`, and any unrecognised string | `Link` | Long-form context; a link is the right cost |
| `invariant` | `Inline { "Invariants" }` | A rule the agent must never break is worthless behind a link it may not follow |
| `trap` | `Inline { "Traps" }` | Same argument: a trap unread is a trap fallen into |
| `example` | `Inline { "Examples" }` | Was `snippet` → `"Snippets"` in the contract; renamed in v5 |
| `env` | `Inline { "Environment" }` | **New.** Ports, paths, versions: short and load-bearing — the same test `invariant` passed |
| `command`, `skill` | *(neither — already governed by `resolve_load`'s destination lock)* | Declared in the registry as `Locked`, so the exhaustive match still forces an answer |

`INLINE_SECTIONS` becomes `["Environment", "Invariants", "Traps", "Examples"]` — four,
frozen in that order.

`decision` and `tool` deliberately get **nothing**, on D14's reasoning: a decision record
is long-form reasoning and a tool doc is reference material. Fourteen roles do not each
need a behaviour. **Both calls are Marty's** (see §5).

Two pieces of §4.1 machinery are still needed and still unbuilt: the `read_file` seam on
`emit_root` (`compile.rs:1034` still takes `(&self, style: LinkStyle)`), and the
`warnings: Vec<String>` field on `CompilePreview` (`compile.rs:215-219` has `errors` and
`files` only), which D19 requires so an oversize inline can degrade to a link loudly
instead of silently.

## 3. Stages

Order is load-bearing. Sizes are for the pace WO13 and WO15 actually ran at.

### L1-0 — Rebase the contract (3–5 days, blocks everything below)

1. Supersede `WO04_CONTRACT.md` — a new frozen contract against v5, not an amendment
   chain. Its §0 table above is the changelog.
2. Restate must-not-break #11 (`GRAPH_VERSION` is **5**; the *standing rule* — sidecar
   over bump — survives untouched and is what §L1-5 relies on) and #16 (`resolveLoad`,
   not `effective_pinned`).
3. Redesign D5: loadouts write `rootLoad` / `readOrder`, never `pinned`.
4. Delete what shipped: §4.7, D17.
5. Re-home D18 (unknown-enum preservation). It was deferred to WO06 by name; WO06 closed
   without it and nothing has owned it since.
6. Settle the three new roles' emission (§5 decisions 1–2).
7. Drop §4.4 (invalid) and D16 with it; drop §4.1's `command → Inline` arm.
8. Recompute the §5 lane grid rather than patching it — its "nobody touches" list never
   mentions `fsbatch`, `project_meta`, `resolve_load`, `taskctx`, `tasklinks`,
   `toolchain`, `src/config/`, `src/orchestrator/`, `src/rail/` or `src/truth/`. The
   standing lesson applies: *the gate is the authority, not the enumeration.*
9. Rename R1's proposed `resolve.rs` — it collides with `resolve_load.rs`.
10. Rewrite P1's docs zone: `AGENTS.md` and `.agents/skills/*` are generated, and
    docs-guard denies hand edits.

### L1-1 — Authoring speed (2–3 weeks)

WO17 P1 in full: inline node creation, edge without a modal, drag-to-empty-canvas,
copy/paste, Ctrl+K palette and keyboard shortcuts, `/` search, auto-layout, and Run back
on the task card.

**Why before the moat:** every lane below needs test graphs, and a 10-node/12-edge graph
costs ~22 dialogs today. This lane pays for itself inside L1 alone, before counting the
product value. It is also the lowest-risk work in the plan — no compiled bytes move.

### L1-2 — Roles change the artifact (2 weeks) — **the moat**

The A1 headline, rebased per §1 and §2. **Smaller than the contract asked for**: the
`Artifact` arm already ships via the destination lock, and §4.4's skill target is
invalid, so the buildable work is the four `Inline` roles plus two pieces of machinery —
the `read_file` seam on `emit_root` and `warnings` on `CompilePreview`.

**Blast radius, measured:** `src-tauri/src/compile/tests.rs` holds **54 tests with 87
exact-string assertions**. Every inlined role moves bytes. Budget for rewriting those
assertions as part of the lane, not as a surprise at the gate.

**Timing warning.** This is the last cheap moment to change compiled output. After
v0.1.0 ships to anyone but Marty, changing what `CLAUDE.md` looks like is a breaking
change for their repos. If v0.1.0 is a public release rather than a personal milestone,
**this stage belongs before the cut, not after** (§5 decision 4).

### L1-3 — Prove what the agent actually sees (2 weeks)

1. **Resolved-context preview** (§4.6) — the exact bytes, imports expanded inline, with a
   token count. The one item on the whole L1 list that no competitor has, and what earns
   the word *compiler*.
2. **Hierarchy simulator** (§4.2) — `<home>/.claude/CLAUDE.md` → root → each ancestor,
   nearest-file-wins, per path. Read-only (D10).

Both are read-only and write nothing, so the risk is low and the proof value is high.
They also make L1-2 reviewable: you can see what the role policy did.

### L1-4 — Round-trip and CI (1–2 weeks)

1. Full import round-trip including copilot/gemini parse-back (§4.5). `scan_inner`
   (`import.rs:230-340`) still scans only `CLAUDE.md`, `AGENTS.md` and `.cursor/rules/*.mdc`
   — there is no `.github/copilot-instructions.md` or `GEMINI.md` discovery at all.
2. Finish CF1: `classify_output` is already `pub(crate)` (`compile.rs:878`), but
   `import.rs:767` still defines `is_compile_output_path` as a one-line delegate, so the
   contract's own gate-14 grep still hits. Delete the delegate.
3. `duplicate-id` lint (WO03 audit O3) and the two missing `import_apply` guards (O4: no
   `.md`-extension refusal, no `is_rename_protected` call).
3. GitHub Action wrapping `cowtext-cli compile --check` (§4.10). **There is no `.github/`
   directory yet** — this creates it.
4. Unknown-enum preservation, re-homed from D18.

### L1-5 — Maps (2–3 weeks)

WO17 P2: `.cowtext/maps.json` sidecar, five map kinds over the existing 14 roles, sketch
elements, map switcher.

**This is not a new idea — it is WO04's own must-not-break #11 applied**: *"per-project
state that does not change compile output goes into a `.cowtext/<name>.json` sidecar with
its own version, never into `graph.json`."* Map layout changes no compiled byte. The
standing rule already blesses the design; L1-5 just spends it.

Sketch elements need §5 decision 3.

### L1-6 — Convenience (1 week, the cut-line)

Everything here is real but droppable if L1 overruns:

1. **Context loadouts** (§4.8) — needs the D5 redesign from L1-0 first.
2. **Windows-safe link manager** (§4.3) — the symlink → hardlink → copy ladder, never
   leaving a broken link (must-not-break #10).
3. **Preset starter packs per stack** (§4.9) — one generic `STARTER_PRESET` exists
   (`src/preset/starter.ts:65`); Rust / Tauri / Next.js / Python packs do not.
4. **Branch-aware graph** (§4.11) — watch `.git/HEAD`, reload on checkout.

## 4. Sequencing

| Stage | Stands on | Why here | Size |
|---|---|---|---|
| L1-0 | — | Dispatching a contract whose preconditions are four work orders stale is how a lane improvises across a seam | 3–5 d |
| L1-1 | L1-0 | Test graphs for every lane below; lowest risk; no compiled bytes move | 2–3 wk |
| L1-2 | L1-1 | The moat, and the last cheap moment to change compiled output. Smaller than the contract asked — the `Artifact` arm already ships | 2 wk |
| L1-3 | L1-2 | Read-only proof that L1-2 did what it claims | 2 wk |
| L1-4 | L1-2 | Round-trip must round-trip the *new* output shape, so it follows the shape change | 1–2 wk |
| L1-5 | L1-1 | Needs fast authoring to be worth having; independent of L1-2/3/4 and can run parallel | 2–3 wk |
| L1-6 | L1-0 | Cut-line — drop first if L1 overruns | 1 wk |

L1-5 is the only stage that can run in parallel with another (L1-3 or L1-4), because it
touches the sidecar and the canvas rather than the compiler.

## 5. Decisions — Marty only

1. **Emission for `decision` and `tool`.** Recommendation: both `Link`. A decision record
   is long-form reasoning; a tool doc is reference. D14's restraint argument applies.
2. **Does `env` earn an inline section?** Recommendation: yes — `Inline { "Environment" }`.
   Ports, paths and versions are short and load-bearing, the same test `invariant` passed.
   Saying no keeps `INLINE_SECTIONS` at four and costs little.
3. **Sketch elements on the canvas** (carried from WO17 decision 4) — the first softening
   of "a node is a real `.md` file". Blocks L1-5's sketch half only; maps themselves do
   not need it.
4. **Does L1-2 come before the v0.1.0 cut?** If v0.1.0 goes to anyone but you, changing
   compiled output afterwards breaks their repos. If it is a personal milestone, the
   order in §4 stands.
5. **Supersede or amend `WO04_CONTRACT.md`?** Recommendation: supersede. Its §0 defects
   are baseline defects, and an amendment chain over a dead baseline is how a contract
   ends up contradicting itself — a failure this project has already recorded once.
6. **dagre or elk** (carried from WO17 decision 3) — blocks L1-1's auto-layout item only.
7. **Confirm `command` keeps its destination lock.** It ships today as its own
   `.claude/commands/<stem>.md` file. The contract wanted it inlined under `## Commands`
   instead. Recommendation: keep what ships — a slash-command *is* a separate artifact in
   Claude Code, and inlining it would be fighting the host tool's own shape.
8. **Is the `skill` compile target dead for good?** `compile.rs:869` says compile must
   never write `.claude/skills/`, and WO15's `skills_materialize` covers the need by
   another route. Recommendation: yes — retire §4.4 and D16 rather than reopening the
   question.

## 6. What L1 does *not* include

Unchanged from `WO04_CONTRACT.md` §8, and still right: usage heatmap, event persistence,
drift lint, dead-node report, sprites/GIF (all **WO05**) · task DAG and orchestration
(**WO06**, shipped) · heartbeats, approval gates, permission grids (**WO07**) · MCP
resources, plugin, context packages (**WO08**) · writing into `~/.claude/CLAUDE.md`
(unscheduled — L1 is read-only global) · unifying the two cycle detectors (**never** —
permanently ratified duplication, and re-verified 2026-08-24: there are two, not the
three the backlog claimed).

## Sources

Code read 2026-08-24: `src-tauri/src/{lib,project,compile,resolve_load,import}.rs`,
`src-tauri/src/compile/tests.rs`, `src/config/{nodeTypes,resolveLoad,edgeRules}.ts`,
`src/canvas/`, `src/preset/starter.ts`, `package.json`, `.github/` (absent).
Docs: `docs/_archive/contracts/WO04_CONTRACT.md`, `docs/design/WO17_PLAN.md`, `docs/tasks/*`,
`docs/TERMINOLOGY.md`.
