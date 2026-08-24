# WO15 — Adversarial audit

Status: **2026-08-22, tech-lead**, against `docs/design/WO15_CONTRACT.md` (frozen 2026-08-21) §9 and `docs/design/PROVIDER_SUPPORT_MATRIX.md`. Tree read after all nine lanes landed (S0, R1, R2, U1, U2, U3, U4a, U4b, B1, D1); the tester's pass and the golden-path manual were still in flight.

Method: every claim below was read from the file:line cited. This session had no shell, so `git status --short` (§9.2) is replaced by a proxy — `rg -l WO15` over the tree plus Glob — and the dispatcher must confirm the grid check with the real command (§5 below). Greps were run with the ripgrep tool; counts were made by hand from the listings.

Verdict in one line: **0 CRITICAL · 2 MAJOR · 8 MINOR · 10 NIT.** Both MAJORs are seam defects my own contract prescribed (D-13 vs §3.8; §6 U3.6's `loadAgents`) — memory class 10, again. All nine lanes implemented the contract faithfully; the fix round is small (§12).

---

## 1. Findings

Severity scale: CRITICAL = data loss on disk or a trust-boundary breach · MAJOR = a user-visible lie or lost user input with no file damage · MINOR = wrong in an edge case or a gate gap · NIT = cosmetic / contract bookkeeping.

### MAJOR

**F1 — A non-Anthropic model choice is dropped at Create, while the badge says it is "kept locally".** CONFIRMED. Lanes: **S0** (sidecar) + **U3** (call sites).
- `src/store/agents.ts:62-67` — `AgentMeta` has `provider?` and no `model`; `parseAgentMeta` (`:384-397`) and `serializeMeta` (`:459-508`) implement §3.8 exactly, and §3.8 has no `model` key.
- `src/tasks/NewAgentDialog.tsx:416-424` — `updateMeta(createdFileName, { nickname, priority, influence, avatarSeed, provider })`; `:321` `frontmatterModel = provider === "anthropic" ? model : null`, so for OpenAI/Google the picked id reaches neither the file nor the sidecar.
- `src/agents/AgentEditor.tsx:657-659` — `localModel` is `useState(null)`; `:1005` feeds it to the picker for non-Anthropic providers; `:1012-1014` persists `provider` only.
- `src/agents/ModelPicker.tsx:150-158` — the badge hint reads `Model for OpenAI is kept locally until its agent format supports it`.
- Failure scenario: New agent → provider OpenAI → `GPT-5.2` → Create. Reopen the agent: the picker shows **Inherit from the session**. The choice is gone and the control promised the opposite — a §7.5 copy-truth violation on a control that exists only to record that choice.
- Root cause: the contract contradicts itself. D-13 says "`{provider, model}` persisted in the sidecar"; §3.8 and §4.6 list `provider` alone. U3 reported the gap ((c)) and shipped the mechanism half; the decision table (D-13, spec 3a.4) states the intent and wins. Amendment A-20 in §13.

**F2 — `loadAgents` after Compile / Reset-to-built-in wipes unsaved skill drafts and the rail selection.** CONFIRMED. Lanes: **S0** (store action) + **U3** (two call sites).
- `src/store/agents.ts:831-856` — `loadAgents` does `clearTimeout(metaSaveTimer)`, clears every agent autosave timer (`:834-835`) and sets `drafts: {}`, `selection: null`, `meta: {}`, `builtinInclude: {}` before re-scanning. It is a project-open reset, not a refresh.
- New same-project callers this round: `src/compile/CompileModal.tsx:574` (after `skillsMaterialize`) and `src/agents/RailSections.tsx:382` (after Reset). Both were prescribed by §6 U3.5/U3.6 ("→ `loadAgents(root)`").
- Skills keep the explicit-Save discipline (`agents.ts:111-112`), so a skill draft can be minutes old.
- Failure scenario: select a project skill in the rail, edit its body in `SkillEditor` without saving, open Compile with `task-format` included for the first time (row `virtual`, approved by default), Write. `loadAgents` runs → the draft is discarded, the selection is cleared, the Inspector goes blank. No warning, no banner — the WO11 class-9 shape (a second path clobbering an explicit-save surface), now via store state instead of disk.
- Agent autosave (500 ms) is practically unreachable from these paths (seconds elapse), but the timer clearing is still a latent loss.
- Fix shape (§12): a narrow `reloadSkills(root)` store action that re-scans and sets only `skills`/`skipped`; both call sites use it. `Inspector.tsx:1536` ("Rescan agents", pre-existing recovery button) stays on `loadAgents`.

### MINOR

**F3 — `git_init(commit=true)` dies at `git add` when `context/` exists but is empty, leaving the folder half-initialised.** CONFIRMED (by reading; tester to reproduce). Lane **R1**.
- `src-tauri/src/git.rs:515-526` filters `[".gitignore", ".cowtext", "context"]` by `exists()`, not by "contains a file". `git add -- context` on an empty directory is `fatal: pathspec 'context' did not match any files` (exit 128) → `Err` **after** `init` and the `.gitignore` write. Same outcome for a `.cowtext/` holding only ignored content.
- Scenario: GitWizard → Make the first commit on an existing non-repo project whose `context/` is an empty folder. Result: `.git` + `.gitignore` created, no commit, error shown; the retry takes the D-15 skip path (`skippedExistingRepo`) so the user can never get the first commit from Cowtext. Unreachable from the New Project wizard (`project_init` always writes `context/project.md`, `preset_apply` writes `.cowtext/graph.json`).
- Fix: filter candidates by "contains ≥ 1 regular file" (a tiny recursive probe), plus a test `init_with_commit_tolerates_an_empty_context_dir`.

**F4 — `ProjectWizard.tsx:1099` hard-codes `127.0.0.1:4923` in the hooks-step copy.** CONFIRMED. Lane **U2**. D-2 makes `hooks_addr` the single source; `useHooksAddr()` is one import away. Contract gap: §4.15 never listed `ProjectWizard.tsx` as a `useHooksAddr` consumer (another incomplete enumeration — class 10).

**F5 — T9's pattern set misses two phrasings the scanned files actually use.** CONFIRMED. Lane **D1**.
- `scripts/truth.lib.mjs:206` compiles `STALE_PATTERNS` with flag `"g"` only → `## Invoke commands (76)` (`docs/TERMINOLOGY.md:37`) and `## Invoke commands (75)` (`.claude/skills/cowtext-terminology/SKILL.md:32`, mirrored in `.agents/`) are invisible to T9 because of the capital I.
- `` `generate_handler!` list (75) `` (`.claude/skills/cowtext-terminology/SKILL.md:16` + mirror) matches none of the eight patterns (`command list \((\d+)\)` needs the word "command").
- Consequence: after PM writes 78 everywhere this round, the next bump to 79 leaves both headings stale with T9 green — exactly what P0.9 exists to prevent. `truth.test.ts:195-206` "covers every count phrasing the repo actually uses" is therefore not yet true.
- Fix: `new RegExp(p.source, "gi")` and a ninth pattern `` generate_handler!` list \((\d+)\) ``; two negative+positive test rows.

**F6 — At 130 % UI scale every `max-h-[80vh]`/`[85vh]` panel is 104–110 vh tall.** CONFIRMED (U4a self-reported). Lane **U4a**.
- `src/styles/index.css:85-95` mitigates with `align-items: safe center; overflow-y: auto` on the scrim — header/footer become reachable by scrolling the **scrim**, which a wheel over the panel's own scroller never does. Affects CompileModal (`:613`), HooksModal (`:148`), SettingsModal (`:256`), ProjectWizard (`:682`, 85vh), GitWizard, NewTaskDialog, NewSkillDialog, and ten more.
- Scenario: 1080p, scale 130 %, Compile: the Write button sits below the fold until the user finds the scrim scrollbar.
- Fix in U4a's own file, no modal touched: two rules after the Tailwind utilities — `.z-modal.inset-0 > .max-h-\[80vh\] { max-height: calc(80vh / var(--ui-scale)); }` and the `85vh` twin.

**F7 — `ResizeHandle` reports viewport-px deltas into a zoomed panel width.** CONFIRMED (U4a self-reported). File **frozen** this WO (`src/ui/ResizeHandle.tsx:39-41`): `dx = e.clientX - start.x` → `onChange(start.value + delta)`. At 130 % the panel edge outruns the pointer by 30 %. Dispatcher decision: unfreeze the file for U4a (`delta / (uiScale / 100)`) or log to BACKLOG. Cosmetic.

**F8 — Bare `.split("/")` on a `.md` path inside the WO15-touched `adoptFile`.** CONFIRMED, pre-existing line in a touched function. Lane **S0**. `src/store/graph.ts:1114` `relPath.split("/").pop()` derives the node title; a backslash relPath titles the node with the whole path. The duplicate guard one line above correctly uses `sameRelPath` (`:1111`). Fix: `relPath.replace(/\\/g, "/").split("/")` (the `:1384` idiom; not `canonPath`, which lower-cases the title).

**F9 — Bare `===` on `node.filePath` in the Inspector's rename guard.** CONFIRMED, pre-existing, U1 zone this round. `src/inspector/Inspector.tsx:1231` `next === node.filePath` → a backslash-stored path typed back with forward slashes is treated as a rename. Fix: `sameRelPath(next, node.filePath)`.

**F10 — Title doors: "Open folder" is the primary door and "New project" wears the Recommended chip — two "do this first" signals on one screen.** CONFIRMED as contract-faithful (§6 U4a.1 added the chip and never moved the primary). `src/project/TitleScreen.tsx:143-185`. **Not** a two-accent-law violation: both signals are blue (accent-surface; the only filled accent is Open folder's icon chip) and no amber is involved. It is a hierarchy contradiction for the first-run (no recents) composition, where "Open folder" has nothing to open. Interface verdict belongs to **tech-ui**; recommendation: primary follows composition — no recents ⇒ New project primary (chip dropped), with recents ⇒ Open folder primary (chip stays).

### NIT

- **N1** `AiTool.elapsedMs` (`src/project/toolchain.ts:25`) has no reader — only the five placeholder literals mention it. §3.5 added the field "so a slow machine is visible" but no §6 bullet renders it. Contract gap; optional: `· 812 ms` per row in `AiToolchainModal`. Lane U4a if taken.
- **N2** `stackItemById` (`src/resources/index.ts:135`) is imported only by `resources.test.ts`. Contract-mandated export; dead in production.
- **N3** `src/truth/truth.lib.d.ts` is outside the §5 grid (the ambient module `tsc` needs for the `.mjs` import). Ratified — add to D1's row.
- **N4** §4.15 lists `EventLog.tsx` as a `useHooksAddr` consumer; no §6 bullet asks EventLog to render the address and it does not import the hook. Map error, not a defect.
- **N5** `src/canvas/MemoryEdge.tsx:540-542` — the edge-drag catcher (`fixed inset-0 z-modal`, portaled to body) matches both `index.css:81` (`zoom`) and `:117` (`transform: scale`) → 1.69× on an invisible, child-less pointer catcher. Harmless today; exclude it (`:not([data-portal="catcher"])`) if the catcher ever gains content. U4a/U4b.
- **N6** `flushMetaSave()` before `skillsMaterialize` (`CompileModal.tsx:549`, `RailSections.tsx:380`) is fire-and-forget; `agents_meta_write` and the following `agents_scan` are separate IPCs with no ordering guarantee — a microsecond window where the rescan reads the pre-toggle file. F2's `reloadSkills` makes the flush unnecessary; drop both calls with it.
- **N7** Reset-to-built-in lives only in the right-click menu (`RailSections.tsx:407`) + confirm strip; §6 U3.5 said "action". Discoverability is a tech-ui call; ratified.
- **N8** `mergeSettings` floors a fractional `launchCount` (`settings.ts:317-323`) where §4.1 says "finite integer ≥ 0 else default". Tolerant choice, tested; ratified.
- **N9** Contract §3.6 / D-6 say `task_update` writes `in testing`; it has always written the bucket id `in-testing` (`tasks/tests.rs:716`). R2's note is correct; the contract text is wrong. Doc-only.
- **N10** `COWTEXT_GITIGNORE_LINES` (`git.rs:323-324`) and `gitignorePresets.ts:67-69` are a Rust↔TS mirror pair pinned by a comment only ("kept identical on purpose"). Drift costs a duplicate `.gitignore` line, nothing worse. Accepted; noted for the next contract.

---

## 2. Mirrors vs §3 text (never vs twins)

| Pair | Rust | TS | Verdict |
|---|---|---|---|
| `GitStatus` +2 fields | `git.rs:127-159` — order, names, doc rules as §3.1; `not_available()` sets both `None` (`:170-171`); read after the version probe, before repo checks (`:267`) | `git/types.ts:5-25` | MATCH |
| `GitInitResult` + `git_init(commit)` | `git.rs:338-349`; steps 1–6 in the contract's order (`:471-555`): skip-existing before identity, identity before any mutation, `.gitignore` via `write_atomic`, `add` on the existing subset, `-c commit.gpgsign=false` + `GIT_TERMINAL_PROMPT=0`; consts `:323-335` byte-exact | `git/types.ts:29-38`, `git/api.ts:30-36` (`commit = false`) | MATCH (edge case F3) |
| `AiTool.elapsed_ms` / 3 s | `toolchain.rs:32,51-52,206-249` — last field, `absent()` = 0, measured on every return path, doc updated | `project/toolchain.ts:25`; `TitleScreen.tsx:575-579` placeholders | MATCH (N1) |
| `SkillInput` / `SkillsMaterialized` / `skills_materialize` | `agents.rs:876-965` — all-entries-validated-first, `validate_component` → slug identity → duplicate → frontmatter; `agent_fs_guard()`; `resolve_within_root` + `create_dir_all` + `write_atomic`; forward-slash paths; empty → `Ok` | `agents/api.ts:126-150` | MATCH |
| Sidecar §3.8 | n/a (Rust opaque; `agents_meta_write` validates `version` only) | `parseMetaJson` `:415-457` (provider ∈ `PROVIDER_IDS`, `builtinSkills` include-true only, unknown ids dropped), `serializeMeta` `:459-508` (provider only when set; `builtinSkills` only when ≥1 true, sorted; version 1) | MATCH §3.8 — but §3.8 ≠ D-13 → **F1** |
| `hooks_addr` / `BIND_ADDR` | `hooks_server.rs:26-40`; `hooks.rs:27-37` functions; `eprintln!` renders `bind_addr_string()` (`:80-83`) | `fs/api.ts:44`, `store/project.ts:149,226-242`, `useHooksAddr` `:410` | MATCH |
| `tasks_*` alias | `tasks.rs:227` `"testing" \| "in testing" \| "in review" \| "review"`; tests `tasks/tests.rs:692-720` | `store/tasks.ts:47-59` labels/type options | MATCH (N9) |

---

## 3. Exception-list checks (the WO13 lesson)

- **§3.7 handler list vs every `invoke(`**: `lib.rs:65-142` = **78** entries, the three new ones last in the contract's order. Every `invoke("…")` name in `src/**` (94 call sites, 78 distinct) is in the list; no handler lacks a TS caller; `Stage-0 stub` appears only in `handoff/tests.rs` (asserting its absence). §7.4 holds: no new `invoke(` outside the api files (the pre-existing Inspector/MemoryNodeCard/review/HooksModal sites are unchanged; `truth.test.ts:74-82` are string fixtures).
- **§4.1 six fields**: present in `AppSettings` (`settings.ts:122-141`, after `defaultCompileTargets`), `DEFAULT_SETTINGS` (`:164-169`), `mergeSettings` (`:312-327`), `persistNow` (`:358-363`, same order), actions (`:201-205`, `:533-552`), `selectNodeTypeHelpOpen` (`:222-226`), `load()` increments then persists (`:431-433`). Appearance UI (`SettingsModal.tsx:326-376`) binds `uiScale`/`uiFont`/`codeFont` and moves Calm mode + FPS; `launchCount`/`nodeTypeHelpCollapsed`/`lastRunAgentFile` are read where §4.15 says. Complete.
- **§4.15 consumer map vs imports**: every row verified by grep (listing in the audit log, §14). Deviations: N4 (EventLog over-listed); `ProjectWizard.tsx` under-listed for `useHooksAddr` (F4).
- **§5 grid vs touched files** (proxy — see method note): every `WO15`-marked file sits in its lane's row; no file in an **untouched** row carries the marker (`src/config/**`, `rail/Hierarchy.tsx`, `src-tauri/src/{compile,preset,project,…}.rs`, `bin/*.rs`, `handoff.rs` clean). One unlisted new file: `src/truth/truth.lib.d.ts` (N3). **Dispatcher: confirm with `git status --short`** and diff `src/store/graph.ts` to `adoptFile` only.
- **T9 patterns vs the scanned files**: the scanned set today carries `invoke commands (76)` (CLAUDE.md, TERMINOLOGY.md:11 `command list (76)`), `74 invoke commands` (skill:3), `770/785 Rust tests`, `163 frontend (Vitest) tests` — all caught; `## Invoke commands (N)` ×3 and `` `generate_handler!` list (75) `` ×2 are **not** (F5). The truth block (`CLAUDE.md:71-73`, generated 2026-08-22) reads invoke **78** · Rust **816** (782/18/16) · Vitest **276** / **17** · v5 — D1 ran the full cargo path.

---

## 4. Writers audit (§7.6)

| New writer | Path | Other writers of the same path | Lock / guard | Verdict |
|---|---|---|---|---|
| `skills_materialize` | `.claude/skills/<id>/SKILL.md` | `skill_save`, `skill_create`, `skill_rename`, `skill_delete` | all under `agent_fs_guard()` (`agents.rs:841,851,868,952`); `agents_scan` too (`:484`) | Serialized. Compile never writes `modified` skills (A-14, `CompileModal.tsx:430`). The in-memory clobber is F2, not a disk race. |
| `git_init` step 5a | `.gitignore` | `gitignore_write` (composer, replace-whole-file) | none needed: both are user-gated clicks in the same wizard; the composer re-derives from the `GitInitResult.status` it stores (`GitWizard.tsx:328`) so an init-then-compose never writes a stale base; compose-then-init finds all three lines and no-ops | Sound. N10 pins the shared lines by comment only. |
| `presetApply` (wizard Create) | `.cowtext/graph.json` + stubs | the graph store's `flushSave`/`scheduleSave` | `preset.rs:225` existence guard; stubs `create_new` (never-clobber); the wizard writes to a root that is not yet open, then `onDone` → `openProjectAt` → `loadGraph` reads the file back; `closeProject` flushes the previous project first (`project.ts:368-374`); starter adoption skipped on `graphApplied` (`App.tsx:1250`) and idempotent anyway (`adoptFile` returns the existing id) | Sound (memory class 1 closed). |
| `setBuiltinInclude` (700 ms debounce) | `.cowtext/agents.json` | `loadAgents` clears the timer (`agents.ts:832`) | both WO15 call sites `flushMetaSave()` first (`CompileModal.tsx:549`, `RailSections.tsx:380`) — correct but fire-and-forget (N6) | Sound for the sidecar; the draft/selection reset is F2. |
| `agents_meta_write` ← `flushMetaSave` | `.cowtext/agents.json` | — | `write_atomic` registers the self-write, so no `fs://change` echo | Sound. |

---

## 5. Mounts and dead exports (§4.15 greps)

`<NewAgentDialog` → `App.tsx:1212` only ✓ · `<HooksModal` → `App.tsx:1222` + `ProjectWizard.tsx:1203` only ✓ · `useToolchainStore` in `TitleScreen.tsx` (+ `AiToolchainModal`, `ModelPicker`) ✓ · `loadHooksAddr` in `App.tsx:1031` ✓ · `EmptyCanvasGuide` imported + mounted by `GraphCanvas.tsx:28,565` ✓ · `BranchPicker` in both wizards ✓ · `ModelPicker` in `NewAgentDialog` + `AgentEditor` ✓ · `openAgentWizard` from `GraphCanvas`, `MemoryNodeCard`, `RailSections` ×2, `OrchestratorView` ✓ · `setHooksModalOpen` from `EventLog`, `BarnScene` ✓ · `pushLocal` from `store/toolchain.ts`, rendered by `EventLog.tsx:138-143` ✓ · `BuiltinSkillReadOnly` mounted from the rail (`RailSections.tsx:484`; U3 (b)). Dead: `stackItemById` (N2), `elapsedMs` (N1). Nothing else exported without an importer.

---

## 6. Copy truth (matrix §5)

`PROVIDER_SUPPORT_SENTENCE` imported and rendered in `TitleScreen.tsx:115`, `SettingsModal.tsx:391`, `ProjectWizard.tsx:1143`, `OrchestratorView.tsx:402` ✓; literal in `README.md:5` ✓ (+ the five compile targets `:7`) and `src/resources/index.ts:28-29` ✓; **missing from `CLAUDE.md`, `docs/TERMINOLOGY.md`, the terminology skill — PM's rows, so T12 FAILs until close-out** (expected). Run tooltip `App.tsx:526` ✓; Assemble tooltips via `CLAUDE_RUNTIME_TIP` (`Inspector.tsx:221`) ✓; EventLog empty copy names Claude Code ✓; Convert door copy ✓. No "multi-provider" claim on any surface (the three hits are comments saying never to). `rg "Codex -p|\.Codex/|AGENTS\.md / AGENTS\.md"` outside `docs/_archive` + `docs/INPUT_PROMPT.md`: hits only in the definitions (`truth.lib.mjs:225`, `truth.test.ts` fixtures, this contract, the matrix) — **0 in `AGENTS.md`, `.agents/`, `.codex/`, `.claude/`**. `AGENTS.md:1-3` is the generated render. `.codex/config.toml:1-3` carries the dev-only comment. `docs-guard.ps1:75-80` denies both generated targets with the script named; `:64` allows `src/resources/skills/*/SKILL.md`.

---

## 7. Path comparisons (§7.8)

No **new** bare `.split("/")` or `===` on a `.md` path in WO15 code (`projectGraph.ts`, `builtinSkills.ts`, `NewAgentDialog.tsx`, `ModelPicker.tsx`, `BranchPicker.tsx`, `EmptyCanvasGuide.tsx`, `CompileModal` skill rows keyed on literal relPaths). Pre-existing in touched zones: F8 (`graph.ts:1114`), F9 (`Inspector.tsx:1231`). Pre-existing, same-source comparisons accepted as-is: `CompileModal.tsx:507` (Rust relPath vs `ROOT_FILE` constant), `NewTaskDialog.tsx:158`, `TasksBoard.tsx:77,81,723-726,740`, `DependsPicker.tsx:224`, `Hierarchy.tsx:248,413,435` (all Rust-scanned `relPath`s, forward-slash by construction), `graph.ts:558`. `projectGraph.test.ts:11` uses `sameRelPath` even in a test — good.

---

## 8. Gates read sentence by sentence — what is NOT asserted

| Lane | Asserted | Not asserted (and why it is acceptable or not) |
|---|---|---|
| S0 | every `resources.test.ts` / `projectGraph.test.ts` / `roles.test.ts` / `settings.test.ts` / `agents.test.ts` case in §4.9/§4.11/§4.14/§4.1/§4.6, byte-exact stack body | `persistNow` field order (needs `invoke`); `store/toolchain.ts` / `store/ui.ts` (no test; 90 lines, read clean). Block 1's popover: `roles.test.ts:34-41` pins the table; `Inspector.tsx:918-941` is a direct map over `WIZARD_ROLE_GROUPS` rendering `meta.microExample` — covered **by construction**, no render test (Vitest runs in `node`). |
| R1 | all seven §3.2 tests + identity ×2 + half-identity + `commit=false` needs no identity (`git/tests.rs:486-866`); Block 0 acceptance in the criterion's own commands (`:582-590`) | `.gitignore` idempotency at helper level only — ratified (a second `git_init` takes the D-15 path, so it is unobservable through the command). The empty-`context/` case (F3). |
| R2 | port pinned in two test files; `hook_command()` contains the marker; materialize ×9; `elapsed_ms ≤ 3500`; timeout pinned; camelCase wire; five rows in order | that `write_atomic`'s self-write registration suppresses the `fs://change` echo for a materialised skill — **dispatcher live check**: Include + Compile must not raise an external-change banner. |
| U1 | build + lint | "Influence visible without scrolling at 1080p" — screenshot; `rg '\bRole\b' src --glob '*.tsx'` → only three comment lines ✓ (empty after the acceptance filter). |
| U2 | build + lint; `projectGraph.test.ts` for the plan | "nothing on disk before Create" — folder watch; Block 0 end-to-end — live. |
| U3 | build + lint; `validateDescription` rules are exactly the three + the tip (`AgentEditor.tsx:262-293`) ✓; defaults `DEFAULT_PRIORITY`/`DEFAULT_AGENT_MODEL` ✓; presets round-trip ✓ (`NewAgentDialog.tsx:288-310`) | Block 4's virtual→materialized→modified walk — live; F1 (the picker's round-trip is what was never asserted). |
| U4a | build + lint; mount greps ✓; Inspector condition `App.tsx:887-889` ✓ | 130 % alignment of a rail menu and the `?` popover — screenshot; F6 at 130 %. |
| U4b | build + lint | "`npm run lint` ≤ 14 warnings" — tester; the `cwd` effect now mount-only (`AddAgentDialog.tsx:233`) — tester confirms the two warnings are gone. |
| B1 | build + lint | wide/narrow fit — screenshots at 2560×1440 and 1280×720; ticker tooltips present (`BarnScene.tsx:97-106`) ✓. |
| D1 | `truth.test.ts` covers every lib function incl. trailing-entry, CRLF, `(76)`/`(78)`, forbidden strings, Status prose | F5; T4's WARN branch never exercised against a real uncalled handler (fine); T11 WARN confirmed by reading only. |

---

## 9. Deviations — ratified (R) / rejected (X), one line each

- S0 model-id regex `[a-z0-9.-]` — R (identical semantics, lint-clean).
- S0 stack body pinned byte-exactly (blank line between categories, none after `##`) — R (matches the contract's ¶ placement).
- S0 principle bodies without trailing `\n`; the stub adds one — R.
- R1 `run_git_env` + thread-local `GIT_ENV_OVERRIDE` — R (exactly "threaded like `GIT_BIN_OVERRIDE`").
- R1 `.gitignore` idempotency tested via `ensure_gitignore_lines` — R (see §8).
- R1 identity tests need git ≥ 2.32 (`GIT_CONFIG_GLOBAL`) — R; note for the golden-path manual's prerequisites.
- R2 `hooks_server.rs` doc avoids the literal — R.
- R2 `task_update` writes `in-testing` — R; contract §3.6/D-6 corrected (N9).
- U1 `RolePopup` labels; capture-phase scroll fix in both popovers; status badge moved; `title` on the disabled Influence row — R ×4.
- U2 Will-create superset (`.cowtext/graph.json`, `.claude/agents/`) — R (both are written by Create; honest).
- U2 principle hint = first non-heading line; subscribed `defaultCompileTargets`; scaffold-once ref; decorated "already a Cowtext project" error — R ×4.
- U3 (a) `Inherit from the session` option — R (the only way to express `model: null`; the default stays `claude-fable-5`).
- U3 (b) `BuiltinSkillReadOnly` mounted from the rail — R (Inspector is U1's; `Inspector.tsx:1708-1709` does return `null` for a skill with no on-disk doc).
- U3 (c) non-Anthropic model session-local — **X** → F1, fixed this round.
- U3 (d) prefill row for position-only; (e) Reset as context-menu item + confirm strip; (f) `identityWarning` dropped; (g) `flushMetaSave()` before materialise — R ×4 ((e) discoverability is tech-ui's, N7; (g) superseded by F2's fix).
- U4a portal roots via `transform: scale` + origin 0 0, chrome via `.ct-zoom`, scrims via `.z-modal.inset-0:not(.ct-zoom *)` — R; the reasoning in `index.css:97-116` is correct (`zoom` would re-multiply client-coordinate offsets). N5 is the one sloppy match.
- U4a `Open folder` primary + `Recommended` on New project — R as contract-faithful; hierarchy verdict to tech-ui (F10).
- U4a `max-h-[80vh]` at 130 % — logged as F6, fix in U4a's own file.
- U4a `ResizeHandle` delta — F7, frozen file, dispatcher's call.
- U4b inherit chain task link → agent default → global — R; verified against `sessions.rs:993-995` (`resolve_ceiling` = explicit else global), so the displayed `Effective: … (from …)` is what Rust applies.
- U4b global default displayed, `null` on the wire — R (one resolver, not two).
- U4b `data-portal="menu"` on the ContextMenu root — R.
- B1 legend collapse hides the line only; FPS overlay token swap; `fitBounds` 384×264 — R ×3 (`fitCamera` `BarnScene.tsx:270-276,487-489` is D-21 exactly).
- D1 T5 reads `testResults.length` for files — R (`numTotalTestSuites` counts `describe` blocks; 79 ≠ 17).
- D1 `parseTruthBlock` for `--no-cargo` carry-over — R (additive, tested).
- Dispatcher's `docs-guard.ps1` allowance for `src/resources/skills/*/SKILL.md` — R.

---

## 10. P0 acceptance — actual proof state

| # | Criterion | State | What the dispatcher's live run must still confirm |
|---|---|---|---|
| 1 | Title → Node → Edge → Compile preview without instruction | PARTIAL — `EmptyCanvasGuide` CTA (`GraphCanvas.tsx:565`), door copy, Run/Assemble tooltips all in code | walk it once with no doc open; the golden-path manual (T) is not yet in the tree |
| 2 | No UI/context file promises an unsupported Codex runtime | PARTIAL — T10 clean on the scanned set; no UI claim; **T12 FAILs until PM adds the sentence to `CLAUDE.md` + `docs/TERMINOLOGY.md`** | `npm run truth` after PM |
| 3 | `AGENTS.md / AGENTS.md` and duplicates gone | PROVEN — `AGENTS.md` regenerated (line 3 = reader line); forbidden strings 0 | T1 + T10 PASS rows |
| 4 | Compile multi-target vs Claude runtime separated in plain language | PARTIAL — five UI/README surfaces verbatim; three markdown surfaces pending PM | — |
| 5 | `.codex` honest | PROVEN by reading — comment header, nothing deleted, T11 WARN logic | the T11 WARN row (exe absent) |
| 6 | Canvas / Tasks / Agents empty states have direct next actions | PROVEN in code — `Create first node`, `Create task` (`TasksBoard.tsx:802-817`), `Create agent` ×2 | screenshots ×3 |
| 7 | Inspector not irrelevantly open in Tasks | PROVEN in code — `App.tsx:887-889`, `surface=` `:903`, copy `Inspector.tsx:3278-3279` | screenshot, no selection |
| 8 | Golden-path manual, 25–40 risk-based scenarios | **PENDING** — `docs/testing/GOLDEN_PATH_MANUAL.md` absent at audit time (T runs in parallel) | T lands it; add F3's prerequisite (git identity) and F2/F1 scenarios |
| 9 | Invoke/test counts match live gates | PARTIAL — truth block written 2026-08-22 (78 / 816 / 276·17 / v5); **T9 + T13 FAIL until PM rewrites the Status prose and the (76)/(75)/(74) headings**; F5 leaves two phrasings unguarded | `npm run truth` PASS incl. T6 at close-out, after F5 |
| 10 | No user file written without preview/approval | PROVEN by reading — §4 table: `git_init(commit)` behind Create / the GitWizard toggle; `skills_materialize` behind Write / the Reset confirm; `presetApply` behind Create | folder watch during wizard, compile, reset |
| 11 | No new TS errors / Rust warnings / ESLint errors | PENDING — lanes report green; this session could not run gates | tester: `tsc`, clippy `-D warnings`, ESLint 0 errors / ≤ 14 warnings, **after the fix round** |
| 12 | All mandatory gates pass | PENDING | tester's five + `npm run truth` + live run |

---

## 11. Open risks

1. F2 is the WO11 pattern re-entering through store state: any contract line of the form "→ `loadAgents(root)`" on an open project is a concurrency instruction, not a refresh. Grep future contracts for it.
2. The UI-scale rule set is sound but structural (`body > *:not(#root)`); a future non-portal body child (an overlay library, a dev tool) will be scaled silently. Document the selector's assumption in `tokens.css` beside `--ui-scale`.
3. `elapsedMs` on the wire with no reader is the kind of field that gets "cleaned up" later and breaks the Rust test pinning it. Either render it (N1) or note it as telemetry in `toolchain.ts`.
4. T9's file set does not include `docs/tasks/ROADMAP.md`, where PM is about to move the count history. That is the intent (history may carry old numbers) — say so in ROADMAP's sprint-log header so nobody "fixes" it.

---

## 12. Fix round (owning lanes only; no new files)

| # | Lane | File | Change |
|---|---|---|---|
| F1 | S0 | `src/store/agents.ts` | `AgentMeta.model: string \| null` (required, `DEFAULT_META.model = null`, the `defaultTokenCeiling` convention); `parseAgentMeta`: non-empty string else `null`; `serializeMeta`: emit `model` only when non-null **and** `provider` is set and `!== "anthropic"`; `updateMeta`: merge like `provider` (`patch.model !== undefined ? patch.model : base.model`). |
| F1 | S0 | `src/store/agents.test.ts` | round-trip: `{provider:"openai", model:"gpt-5.2"}` survives parse→serialize; an anthropic entry never emits `model`; a bare `model` with no provider reads as `null`. |
| F1 | U3 | `src/tasks/NewAgentDialog.tsx:416-424` | `updateMeta(createdFileName, { …, provider, model: provider === "anthropic" ? null : model })`. |
| F1 | U3 | `src/agents/AgentEditor.tsx:657-659, 1005, 1012-1014` | delete `localModel`; `model={provider === "anthropic" ? draft.fields.model : m.model}`; `onChange`: `updateMeta(doc.fileName, { provider: v.provider, model: v.provider === "anthropic" ? null : v.model })` + the existing `patchFields`. |
| F2 | S0 | `src/store/agents.ts` | add `reloadSkills(root: string): Promise<void>` — `agentsScan(root)` under the `root === get().root` guard, then `set({ skills, skipped })` only; no timers cleared, no drafts/selection/meta/builtinInclude touched. |
| F2 | U3 | `src/compile/CompileModal.tsx:549,574` · `src/agents/RailSections.tsx:380-382` | replace `loadAgents(root)` with `reloadSkills(root)`; drop the now-unneeded `flushMetaSave()` calls (N6). |
| F3 | R1 | `src-tauri/src/git.rs:515-518` · `git/tests.rs` | stage only candidates containing ≥ 1 regular file; test `init_with_commit_tolerates_an_empty_context_dir` (empty `context/` ⇒ one commit containing `.gitignore` only). |
| F4 | U2 | `src/project/ProjectWizard.tsx:1099` | render `useHooksAddr()`. |
| F5 | D1 | `scripts/truth.lib.mjs:179-188,206` · `src/truth/truth.test.ts:195-219` | `"gi"` flag; add `` generate_handler!` list \((\d+)\) ``; test rows for `## Invoke commands (76)` and `` `generate_handler!` list (75) ``. |
| F6 | U4a | `src/styles/index.css` (after `:95`) | `.z-modal.inset-0 > .max-h-\[80vh\] { max-height: calc(80vh / var(--ui-scale)); }` + the `85vh` twin; drop the "UX debt" comment. |
| F7 | dispatcher → U4a | `src/ui/ResizeHandle.tsx:39-41` (frozen) | unfreeze for one line: `const delta = (side === "left" ? dx : -dx) / (useSettingsStore.getState().uiScale / 100)`; or BACKLOG it. |
| F8 | S0 | `src/store/graph.ts:1114` | `relPath.replace(/\\/g, "/").split("/")`. |
| F9 | U1 | `src/inspector/Inspector.tsx:1231` | `sameRelPath(next, node.filePath)`. |
| F10 | tech-ui verdict | `src/project/TitleScreen.tsx:143-185` | if accepted: primary follows composition (see F10). |
| N3 | TL | this contract §5 | add `src/truth/truth.lib.d.ts` to D1's row. |
| N9 | TL | contract §3.6 / D-6 | "file text written by `task_update` is the bucket id `in-testing`". |

Gates after the fix round: S0 `npm run test` (new cases), R1 `cargo test --all-targets` + clippy, U-lanes build + lint, then the tester's full pass including `npm run truth`.

---

## 13. Contract amendments (frozen text, recorded here)

- **A-20** (F1): §3.8 sidecar gains `"model": "<id>"` per agent — emitted only for a non-Anthropic `provider`; Anthropic agents keep `model:` in frontmatter and never in the sidecar; absent = `null`. Still v1, still additive. §4.6 `AgentMeta` gains `model: string | null`.
- **A-21** (F2): §6 U3.5/U3.6 "→ `loadAgents(root)`" becomes "→ `reloadSkills(root)`"; `loadAgents` is reserved for project open and the explicit "Rescan agents" recovery.
- **A-22** (F4): §4.15 `useHooksAddr` consumers = `SettingsModal.tsx`, `HooksModal.tsx`, `ProjectWizard.tsx`; `EventLog.tsx` removed.
- **A-23** (N3): §5 D1 row gains `src/truth/truth.lib.d.ts`.
- **A-24** (N9): §3.6 / D-6 wording as above.

---

## 14. Audit log — consumer-map verification

| Seam | Found in |
|---|---|
| `useToolchainStore` / `isToolFound` / `PROVIDER_COMPILE_TARGET` | `TitleScreen.tsx`, `AiToolchainModal.tsx`, `ModelPicker.tsx` (+ `store/toolchain.ts`, `resources/index.ts`) |
| `useUiStore.agentWizard` | read `NewAgentDialog.tsx:163`; mount `App.tsx:1210-1212`; open `GraphCanvas.tsx:281`, `MemoryNodeCard.tsx:349`, `RailSections.tsx:261,269`, `OrchestratorView.tsx:405` |
| `hooksModalOpen` | set `BarnScene.tsx:159`, `EventLog.tsx:181`; mount `App.tsx:1220-1222` |
| `useHooksAddr` | `SettingsModal.tsx:209`, `HooksModal.tsx:77` |
| `pushLocal` | `store/toolchain.ts:49,59`; rendered `EventLog.tsx:75-78,138-143` |
| `PROVIDER_SUPPORT_SENTENCE` | `TitleScreen.tsx:115`, `SettingsModal.tsx:391`, `ProjectWizard.tsx:1143`, `OrchestratorView.tsx:402` |
| `BUILTIN_SKILLS` / `useBuiltinSkillStates` / `setBuiltinInclude` / `skillsMaterialize` | `RailSections.tsx`, `NewAgentDialog.tsx`, `CompileModal.tsx`, `store/agents.ts`, `builtinSkills.ts` |
| `PROVIDERS` / `defaultModelFor` / `providerForModel` / `AGENT_PRESETS` | `ModelPicker.tsx`, `NewAgentDialog.tsx`, `AgentEditor.tsx` |
| `PRINCIPLES` / `STACK_CATEGORIES` / `buildProjectGraph` / `gitInit(…, true)` / `identity*` | `ProjectWizard.tsx` (the only `gitInit(…, true)`), `GitWizard.tsx` (`makeCommit` toggle), `BranchPicker.tsx` |
| `STATUS_LABELS` / `TASK_TYPE_OPTIONS` / `DEFAULT_PRIORITY` / `setLastRunAgentFile` | `NewTaskDialog.tsx`, `TasksBoard.tsx`, `MemoryNodeCard.tsx:522`, `AddAgentDialog.tsx:75,333` |
| `selectNodeTypeHelpOpen` / `LocalOnlyBadge` / `Inspector.surface` | `Inspector.tsx:961,271,1574,2141,3153,3278` |
| `UI_*_STACKS` / `loadHooksAddr` / `ProjectWizardOutcome` | `App.tsx:1031,1042-1044,1250`, `SettingsModal.tsx` |
