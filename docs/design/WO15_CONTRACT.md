# WO15 — Release truth + UI round 2

Status: **FROZEN 2026-08-21** (tech-lead). Sources: `docs/INPUT_PROMPT.md` (TASKS_UI_ROUND2 Blocks 0–7 + smaller fixes; Russian P0 plan Stages 0–6 with the 12 acceptance criteria) and the dispatcher's Stage 0 plan (`WO15_PLAN.md`, session scratchpad). Companion: `docs/design/PROVIDER_SUPPORT_MATRIX.md` (P0.1).

Where the plan and this contract disagree, **this contract wins and §0 says why**. Where the spec and the codebase disagree, §2 ratifies the deviation. Every file:line below was read on 2026-08-21 against commit `7646db9` + the dirty worktree.

| | |
|---|---|
| Invoke commands | **76 → 78** (new: `hooks_addr`, `skills_materialize`) |
| Wire changes to existing commands | `git_status` +2 fields · `git_init` +1 arg, new result type · `detect_ai_tools` +1 field |
| `graph.json` schema | **v5, unchanged** — no new node/edge fields |
| `AppSettings` | version 1, six additive tolerant-merge fields |
| `.cowtext/agents.json` | v1, two additive keys |
| New dependencies | **none** |
| Lanes | TL → S0 (alone) → R1 ‖ R2 ‖ U1 ‖ U2 ‖ U3 ‖ U4a ‖ U4b ‖ B1 ‖ D1 → T + TL audit → fix round → dispatcher live run → PM |

Baseline gates (dispatcher, 2026-08-21): build ✓ · lint 0 errors / 16 warnings · Vitest 163/163 (12 files) · cargo test 785 (751 lib + 18 CLI + 16 MCP) · clippy ✓.

---

## 0. Amendments to the plan (read before your lane)

| # | Plan said | Contract says | Why (evidence) |
|---|---|---|---|
| A-1 | `buildProjectGraph` lays positions "like `starter.ts`" | `src/wizard/starter.ts` **does not exist**; positions are a fixed 3-column grid (§4.11) | Glob `src/wizard/starter.ts` → none; starter adoption lives in `App.tsx:939-957` via `adoptFile` |
| A-2 | `launchCount` incremented "in `loadSettings`" | the loader is `useSettingsStore.load()` (`settings.ts:307`) | no `loadSettings` exists |
| A-3 | R1 adds `project.rs::empty_graph_json`; `git_init(commit)` writes an empty graph if absent | **`git_init` never writes `graph.json`**. The wizard always calls `presetApply` (even with zero extra nodes) so `.cowtext/graph.json` exists before `gitInit`. R1's zone shrinks to `git.rs` + `git/tests.rs` | one fewer writer of a store-owned file (memory class 1); `preset_apply` already owns that write with its own guard (`preset.rs:219-227`, `project_meta.rs:232-235`) |
| A-4 | identity check: "init itself may still succeed; return the error" | when `commit === true` and identity is missing, `git_init` returns `Err` **before any mutation** (no `init`, no `.gitignore`) | a half-initialised folder with an error is worse than an untouched one; the wizard's Git step already shows the warning before Create |
| A-5 | truth script reads compile targets from `compile.rs::TargetIn` | there is no `TargetIn`; read `project.rs:421-429` `pub enum CompileTarget` and cross-check `graph.ts:199` | Grep `TargetIn` → 0 hits |
| A-6 | `preset_apply` guard "must treat an empty-nodes graph as empty (verify)" | **already true** (`preset.rs:219-227`, `graph_is_empty`). R1 verifies by reading; no edit | |
| A-7 | R1 "fix BUGS.md latent `probe_status` item if still present" | **already fixed** (`git.rs:193-208` uses `symbolic-ref --short HEAD`). R1 adds one regression test; PM closes the BUGS.md row (line 35) | |
| A-8 | `LogEvent` gains `note?`; `pushLocal(kind:"other", note)` | `pushLocal(note, { toolName? })` — kind is always `"other"`, plus a `local?: true` marker (§4.4) | fewer ways to misuse; demo purge and session counters already ignore `other` |
| A-9 | `hooks_addr` wrapper "in `project.ts`" | invoke wrapper `hooksAddr()` lives in `src/fs/api.ts` beside `hooksStatus` (the file that owns the hooks invokes); `project.ts` consumes it | one invoke-owning file per module (`fs/api.ts:1-3`) |
| A-10 | S0 adds optional props to `NewAgentDialog` | **not needed**: the wizard reads `useUiStore.agentWizard` directly (U3). S0 does not touch `NewAgentDialog.tsx` | avoids a dead prop |
| A-11 | `AiTool.elapsedMs` added to TS | also requires `elapsedMs: 0` on the five placeholder rows in `TitleScreen.tsx:558-565`, else `tsc` fails at Stage 0 exit — S0 patches those literals only | `AiTool` literals there would miss a required field |
| A-12 | `gitInit(root, branch, true)` | TS wrapper `gitInit(root, branch, commit = false)` returns `GitInitResult`; S0 adapts `GitWizard.tsx:267-275` (`.then((r) => …r.status…)`) so the tree stays green | return type change breaks the one existing caller |
| A-13 | `useBuiltinSkillStates` in `store/agents.ts` | the React hook lives in **new** `src/agents/builtinSkills.ts`; the pure `builtinSkillStates()` is there too | store files carry no React imports (`events.ts:4`) |
| A-14 | built-in skill rows in CompileModal for "included built-in skills" | rows only for `virtual` (new file) and `materialized` (unchanged, greyed) built-ins with `include === true`; **`modified` skills never appear in Compile** — reset is an explicit rail action with a confirm strip | compile must not silently clobber a user-edited skill (memory class 9) |
| A-15 | U4b: "Create TASKS.md" secondary button | one primary CTA **Create task** + the line "Saving the first task creates TASKS.md in this project." — there is no create-empty-file primitive (`tasks.rs` creates on first append) | two buttons doing one thing is a smell |
| A-16 | D-7 UI scale: zoom on chrome containers, portals unspecified | zoom applies to the chrome containers **and to every portal root** (context menus, popovers, modals, toasts); never `.react-flow` or the Barn host. WebView2 ≥ 128 (standardised CSS `zoom`) assumed — see D-7 | portal text would otherwise render at 100 % beside 130 % chrome |
| A-17 | D1 test file "`scripts/truth.test.mjs`?" | `src/truth/truth.test.ts` importing `../../scripts/truth.lib.mjs` — the only location Vitest's include (`vitest.config.ts:14`) and ESLint's globals (`eslint.config.js:42`) both cover | |
| A-18 | `taskFormatSkill.ts` becomes a re-export | S0 **deletes** `src/tasks/taskFormatSkill.ts` and removes the "Use the built-in task-format skill" block from `NewSkillDialog.tsx:9,101-114`; the built-in now lives in the Skills rail (Block 4) | a re-export with no importer is dead code; the only importer was that button |
| A-19 | "Rust test count via `cargo test --all-targets -- --list`" | three invocations — `cargo test --lib -- --list`, `--bin cowtext-cli -- --list`, `--bin cowtext-mcp -- --list` — give the exact lib/cli/mcp split; total = sum | `--all-targets --list` prints per-binary summaries in an order the script should not guess |

---

## 1. Scope & sequencing

### 1.1 Block / Stage → lane

| Source | What lands | Lane(s) |
|---|---|---|
| Block 0 — git init creates the branch + first commit | `git_status` identity, `git_init(commit)`, wizard Git step, GitWizard result line | **R1** (Rust) + **U2** (wizard) + S0 (wire types) |
| Block 1 — "Node type" everywhere + microExample | Inspector Role → Node type, `?` popover, NodeWizard label, PreviewPane heading, card label, `roles.test.ts` | **U1** + **U2** + **U4b** + S0 (test) |
| Block 2 — AssembleSection, Influence visible, Advanced | section order, AssembleSection (Brief/Tags/Influence/actions/live preview), Advanced+Position+badge | **U1** |
| Block 3a — provider → model | `models.json`, provider icons, `ModelPicker`, `provider` in sidecar, `local only` for non-Anthropic | **U3** + S0 (resources, sidecar) |
| Block 3b — priority 1, validator, helper | `DEFAULT_PRIORITY`, new `validateDescription` rules | **U3** + S0 (constant) |
| Block 3c — agent presets | `agent-presets.json`, Preset chip row | **U3** + S0 (resource) |
| Block 4 — built-in skills | `skills_materialize`, `BUILTIN_SKILLS`, rail groups, CompileModal rows, badges, reset | **R2** + **U3** + S0 (resource, store) |
| Block 5a — title auto-scan | `useToolchainStore`, `elapsedMs`, 3 s timeout, Activity row | **R2** + **U4a** + S0 (store) |
| Block 5b — "New agent here…" / "…from this node…" | `useUiStore.agentWizard`, menus, wizard prefill, placement + `imports` edge | **U4b** (menus) + **U3** (wizard) + **U4a** (mount) + S0 (store, `adoptFile`) |
| Block 6 — principles + stack steps | `principles.json`, `stacks.json`, `buildProjectGraph`, wizard steps + preview | **U2** + S0 (resources, pure module) |
| Block 7 — Appearance | settings fields, Appearance section, `:root` vars, zoom | **U4a** + S0 (settings) |
| Smaller fixes | Overlay: label, read-order tooltip (already present), Barn ticker, Run dialog defaults + ceiling input, task status labels + type chips, hooks port from one constant | **U4b** + **B1** + **R2** + **U1/U4a** + S0 |
| Stage 1 — support matrix + sentence on every surface | `PROVIDER_SUPPORT_MATRIX.md`, `PROVIDER_SUPPORT_SENTENCE` | **TL** + S0 + U4a/U2/U3/U1 + D1 + PM |
| Stage 2 — generation + drift gate | `scripts/truth.mjs`, AGENTS.md generation, skill mirrors, docs-guard message | **D1** |
| Stage 3 — `.codex` truth | disposition table, `.codex/config.toml` comment, truth WARN | **TL** + **D1** |
| Stage 4 — first-run activation | title copy, canvas guide, tasks/agents empty states, Inspector hidden in Tasks, Barn legend/fit | **U4a** + **U4b** + **U3** + **B1** |
| Stage 5 — golden-path manual | `docs/testing/GOLDEN_PATH_MANUAL.md`, 25–40 scenarios | **T** |
| Stage 6 — generated release truth | truth block in CLAUDE.md, counts from live gates | **D1** + **PM** |

### 1.2 Order

1. **TL** — this contract + the matrix (done).
2. **S0** — tech-general, alone: every seam in §4 and §8, tree green at exit.
3. **R1 ‖ R2 ‖ U1 ‖ U2 ‖ U3 ‖ U4a ‖ U4b ‖ B1 ‖ D1** — zones per §5; own-lane gates only (§6).
4. **T** (all gates + invoke-name contract + `npm run truth --no-cargo` + golden-path manual + adversarial pass) ‖ **TL** (audit → `docs/design/WO15_AUDIT.md`).
5. **Fix round** — owning lanes only; no new files.
6. **Dispatcher** — `npm run tauri dev`, screenshots of every changed state (§6 lists them), `npm run truth:write` then `npm run truth`.
7. **PM** — docs close-out (§6 PM), always last.

---

## 2. Decisions

Ratified (R) / amended (A) from the plan's D-1…D-14; D-15+ are new.

| # | Verdict | Decision | Rationale |
|---|---|---|---|
| D-1 | R | Autonomous run with per-lane gates; review on the checkpoint report | Marty's instruction: plan → /ultracode → implement |
| D-2 | R | Hooks port canon = **4923**, one Rust const (`hooks_server.rs:20`) exposed via `hooks_addr`; 8787 appears nowhere | `hooks.rs:23-27`, `HooksModal.tsx:180,196`, `SettingsModal.tsx:13` all hard-code 4923 today |
| D-3 | R | Influence slider on memory nodes is rendered **disabled** at 50 with tooltip `Not used for <Label>`; helper copy is truthful (§6 U1) — never "see resolveLoad()" | nodes have no influence field; `assemble.rs:456` deliberately excludes it; scope guard forbids new graph.json fields |
| D-4 | R | Materialisation = `skills_materialize` (agents.rs, under `AGENT_FS`), called by CompileModal **after** `compileWrite` succeeds | `compile.rs:869-870` forbids compile writing `.claude/skills/`; SKILL.md cannot carry a line-1 GENERATED header |
| D-5 | R | After materialisation a built-in stays in **Built-in** with badge `materialized`; when on-disk ≠ bundled it moves to **Project** with badge `modified from built-in` + `Reset to built-in` (confirm strip → `skills_materialize([id])`) | spec: pick one and document |
| D-6 | R | Task status: **labels only** — Todo / In progress / In review / Done; stored ids and file text unchanged; `tasks.rs` gains `in review` alias. Task type → chips bug/feature/chore/docs + none; free text on disk still displays | file-format compatibility (`tasks.rs:214-224`); spec says ask before removing |
| D-7 | A | UI scale = CSS `zoom: var(--ui-scale)` on chrome containers **and every portal root** (A-16); never on `.react-flow` or the Barn host. Fonts: UI = System / IBM Plex Sans; Code = JetBrains Mono / System monospace; no Inter (not bundled, `main.tsx:3-9`). **Deviation from spec's "node cards scale too" — flagged for Marty (§10)** | codebase is 100 % px (`tokens.css`, `tailwind.config.js`); root `font-size` would do nothing; WO09 connector geometry is frozen in px |
| D-8 | R | `.codex/config.toml` + `.mcp.json` = development-only (comment + truth WARN); `.codex/hooks.json` = unsupported, not promised; `.codex/agents/*.toml` = unverified, dev-only. **No deletions without Marty** | matrix §3 |
| D-9 | R | AGENTS.md generated from CLAUDE.md by `scripts/truth.mjs`; allowlist = line 1 + line 3 only; `.agents/skills/*` byte-identical mirrors synced by the script; docs-guard keeps blocking hand edits with a message naming the script; CLAUDE.md hard rule amended (PM) | every current mirror difference is a blind-replacement bug (matrix §3); no intentional Codex variant exists |
| D-10 | R | `models.json`: Anthropic list verbatim from the spec; OpenAI/Google short public lists; Cursor/Copilot empty; "Custom model id…" always last. **Marty reviews the file** | "do not invent ids" |
| D-11 | R | "13 types" = the 13 wizard-selectable roles (`WIZARD_ROLE_GROUPS`, `roles.ts:45-48`); the `?` popover lists those 13 + the line `WIZARD_BLOCKED_HINT` ("Agents are created in the Agents rail.") | taxonomy unchanged |
| D-12 | R | Keep `git init` + `symbolic-ref HEAD` (works on every git); no `-b` | `git.rs:261-264` |
| D-13 | R | Default `{ provider: "anthropic", model: "claude-fable-5" }`; `model:` written to frontmatter **iff** provider = anthropic; other providers keep `model:` out and show `LocalOnlyBadge`; `{provider, model}` persisted in the sidecar (`provider` optional, v1 tolerant) | |
| D-14 | A | `LogEvent` gains `note?: string` + `local?: true`; `pushLocal(note, opts?)` (A-8) | `events.ts:40-45` freezes the WIRE shape, not the ring-buffer row |
| D-15 | new | `git_init(commit=true)` on an **existing** repo never commits and never touches `.gitignore`: `skippedExistingRepo: true` | Block 0 acceptance: existing folders are never re-initialised |
| D-16 | new | The New Project wizard **always** runs `presetApply(buildProjectGraph(...))` in `new` mode, even with zero principles/stack (graph = the single `context/project.md` node + the settings' `defaultCompileTargets`). App's starter adoption is skipped when `outcome.graphApplied` | guarantees `.cowtext/graph.json` exists for the first commit (A-3); preserves the user's compile-target ticks (`graph.ts:1031-1037` only seeds them when no graph exists) |
| D-17 | new | `adoptFile` returns the node id (new or already-present) and accepts an optional position | Block 5b needs the id for the `imports` edge; source-compatible with the five existing callers |
| D-18 | new | `defaultCollapsed` sections (Advanced) keep **session-local** collapse state, not `collapsedSections` | the persisted model stores only collapsed exceptions (`settings.ts:79-83`); an "expanded exceptions" list for one section is not worth a second model |
| D-19 | new | `DEFAULT_PRIORITY = 1` also becomes the fallback for a sidecar entry with no `priority` key | one source of truth (spec 3b.1); Cowtext always writes the key (`agents.ts:394-401`), so only hand-edited sidecars shift |
| D-20 | new | Attaching a **virtual** built-in skill to an agent in the wizard also sets `builtinInclude[id] = true` | otherwise the agent's `skills:` names a file that never gets written |
| D-21 | new | Wide-screen Barn fit = largest integer zoom in [1, 4] whose world bounds fit the host, applied on mount/resize while `!userMoved`; no animation | art untouched; integer zoom ladder preserved (`BarnScene.tsx:361-363`) |

---

## 3. Invoke contract (76 → 78)

Every name is byte-exact. Args camelCase in TS, snake_case in Rust. **R2 owns `src-tauri/src/lib.rs`**; R1 changes no `generate_handler!` entry (it changes `git_init`'s signature only).

### 3.1 `git_status` — identity fields (R1)

`src-tauri/src/git.rs:84-107` — append two fields (declaration order matters for nothing on the wire but keep them last):

```rust
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub git_available: bool,
    pub git_version: Option<String>,
    pub is_repo: bool,
    pub has_commits: bool,
    pub branch: Option<String>,
    pub gitignore_exists: bool,
    pub gitignore_content: Option<String>,
    /// `git -C <root> config --get user.name`, trimmed. `None` when unset,
    /// empty, or git is unavailable. Read in `probe_status`; never cached.
    pub identity_name: Option<String>,
    /// `git -C <root> config --get user.email`, same rules.
    pub identity_email: Option<String>,
}

#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String>   // unchanged signature
```

`not_available()` sets both to `None`. `probe_status` reads them after the version probe (a non-repo still reads global config through `git -C`).

TS mirror `src/git/types.ts` (S0):

```ts
export interface GitStatus {
  gitAvailable: boolean;
  gitVersion: string | null;
  isRepo: boolean;
  hasCommits: boolean;
  branch: string | null;
  gitignoreExists: boolean;
  gitignoreContent: string | null;
  /** `git config --get user.name`; null when unset or git unavailable (WO15). */
  identityName: string | null;
  identityEmail: string | null;
}
```

### 3.2 `git_init` — `commit` arg + `GitInitResult` (R1)

```rust
/// Lines Cowtext guarantees in `.gitignore` before the first commit (Block 0).
pub(crate) const COWTEXT_GITIGNORE_LINES: [&str; 3] =
    [".claude/settings.local.json", "CLAUDE.local.md", ".cowtext/cache/"];
pub(crate) const COWTEXT_GITIGNORE_MARKER: &str = "# --- added by Cowtext ---";
pub(crate) const INIT_COMMIT_MESSAGE: &str = "chore: init cowtext project";
pub(crate) const GIT_IDENTITY_ERR: &str =
    "Git identity is not configured. Run: git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\" — then try again.";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitInitResult {
    pub status: GitStatus,
    /// This call created the initial commit.
    pub committed: bool,
    /// `git rev-list --count HEAD` after the call; 0 when unborn or not a repo.
    pub commit_count: u32,
    /// `root` was already a repo toplevel: nothing was initialised, written or committed.
    pub skipped_existing_repo: bool,
}

#[tauri::command]
pub fn git_init(root: String, branch: Option<String>, commit: bool) -> Result<GitInitResult, String>
```

Behaviour, in this order — nothing may be reordered:

1. `checked_root`; `validate_branch` when `branch` is `Some` (unchanged).
2. `already = is_repo_at(&root)`. If `already`: **no** init, **no** `symbolic-ref`, **no** `.gitignore` write, **no** commit, regardless of `commit` → `Ok(GitInitResult { status: probe_status(), committed: false, commit_count: count_commits(), skipped_existing_repo: true })` (D-15).
3. If `commit`: read identity (`config --get user.name` / `user.email`). Either missing → `Err(GIT_IDENTITY_ERR.to_string())` **before any mutation** (A-4).
4. `git init`; `symbolic-ref HEAD refs/heads/<branch>` when given (unchanged, D-12).
5. If `commit`:
   a. `.gitignore`: absent → write `format!("{MARKER}\n{l1}\n{l2}\n{l3}\n")` via `write_atomic`. Present → for each of the three lines not already present as a whole line (compare after trimming `\r`), append — once — `<eol>{MARKER}<eol>` followed by the missing lines, where `<eol>` is `"\r\n"` if the file contains `"\r\n"` else `"\n"`; existing bytes are never modified or removed; a file lacking a trailing newline gets one before the marker. No-op when all three are present.
   b. `git add -- <paths>` where paths = the subset of `[".gitignore", ".cowtext", "context"]` that exist under `root`. **`git_init` never creates `.cowtext/graph.json`** (A-3).
   c. `git -c commit.gpgsign=false commit -m "chore: init cowtext project"` with env `GIT_TERMINAL_PROMPT=0`. Non-zero exit → `Err(stderr_tail(...))` (the repo stays initialised; `committed: false` is not returned because the call errors — the wizard shows the error text).
6. `Ok(GitInitResult { status: probe_status(), committed: <step 5 ran>, commit_count, skipped_existing_repo: false })`.

`commit == false` reproduces today's behaviour byte-for-byte, wrapped in the new result.

TS wrapper `src/git/api.ts` (S0):

```ts
export function gitInit(root: string, branch: string | null, commit = false): Promise<GitInitResult> {
  return invoke<GitInitResult>("git_init", { root, branch, commit });
}
```

`src/git/types.ts`: `export interface GitInitResult { status: GitStatus; committed: boolean; commitCount: number; skippedExistingRepo: boolean }`.

R1 tests (`git/tests.rs`, real `git` on PATH, temp dirs under `std::env::temp_dir()`; skip with a message when `git --version` fails):
- `init_with_commit_creates_exactly_one_commit_containing_gitignore_and_graph` — pre-create `.cowtext/graph.json` + `context/project.md`; assert `commit_count == 1`, `git show --name-only HEAD` lists `.gitignore`, `.cowtext/graph.json`, `context/project.md`; `branch == Some("main")` for `branch: Some("main")`.
- `init_with_commit_and_missing_identity_errs_before_init` — run with `-c`-free env where identity is unset (`GIT_CONFIG_GLOBAL` pointed at an empty temp file + `GIT_CONFIG_NOSYSTEM=1` for the command; R1 threads an env override through `run_git` the same way `GIT_BIN_OVERRIDE` is threaded); assert `Err == GIT_IDENTITY_ERR` and **no `.git` directory** exists.
- `init_on_existing_repo_skips_everything` — `skipped_existing_repo`, `committed == false`, `.gitignore` untouched (byte-compare).
- `gitignore_append_is_crlf_safe_and_idempotent` — CRLF file missing two lines → appended with `\r\n`, marker once; second call → byte-identical.
- `branch_master_and_custom_names_survive_init` — `master`, `feat/x`.
- `probe_status_reports_unborn_branch_after_init` (A-7 regression).
- Identity fields: `identity_name`/`identity_email` are `Some` under a temp global config that sets them, `None` under the empty one.

### 3.3 `hooks_addr` — NEW (R2)

`src-tauri/src/hooks_server.rs`:

```rust
pub(crate) const BIND_ADDR: (&str, u16) = ("127.0.0.1", 4923);

/// "127.0.0.1:4923" — the one string every other module renders from.
pub(crate) fn bind_addr_string() -> String {
    format!("{}:{}", BIND_ADDR.0, BIND_ADDR.1)
}

/// The hooks receiver's bind address, for the Settings/Hooks UI (WO15 D-2).
#[tauri::command]
pub fn hooks_addr() -> String {
    bind_addr_string()
}
```

`eprintln!` at `hooks_server.rs:61` renders `bind_addr_string()` instead of the literal.

`src-tauri/src/hooks.rs:23-27` — the two consts become functions (or `std::sync::LazyLock<String>` statics; either is fine, the test pins the content):

```rust
fn hook_command() -> String {
    format!("curl -s -m 1 -X POST --data-binary @- http://{}/event || true", crate::hooks_server::bind_addr_string())
}
fn hook_marker() -> String {
    format!("{}/event", crate::hooks_server::bind_addr_string())
}
```

Tests: `hooks/tests.rs` — `hook_command().contains(":4923/event")`, `merge_hooks(None)` output contains `hook_marker()`; `hooks_server/tests.rs` — `bind_addr_string() == "127.0.0.1:4923"` (pins D-2 in code).

TS wrapper `src/fs/api.ts` (S0, A-9):

```ts
/** The hooks receiver's bind address ("127.0.0.1:4923"), from the one Rust const (WO15 D-2). */
export function hooksAddr(): Promise<string> {
  return invoke<string>("hooks_addr");
}
```

### 3.4 `skills_materialize` — NEW (R2)

`src-tauri/src/agents.rs`:

```rust
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInput {
    /// Skill directory slug — must already satisfy `preset::slugify(id)? == id`.
    pub id: String,
    /// Full SKILL.md text, frontmatter first.
    pub content: String,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillsMaterialized {
    /// `.claude/skills/<id>/SKILL.md`, forward slashes, in input order.
    pub written: Vec<String>,
}

/// Writes bundled (built-in) skills to disk after the Compile diff was approved
/// (WO15 Block 4, D-4). Create-or-replace on purpose: this is also the
/// "Reset to built-in" path. Under `agent_fs_guard()`, like every other
/// `.claude/skills/` writer.
#[tauri::command]
pub fn skills_materialize(root: String, skills: Vec<SkillInput>) -> Result<SkillsMaterialized, String>
```

Validation of **every** entry before **any** write (all-or-nothing validation):
- `validate_component(&id)?`; `crate::preset::slugify(&id)? == id` else `Err(format!("Skill id is not a slug: {id:?}"))`;
- duplicate id → `Err("Duplicate skill id: …")`;
- `content` must start with `"---\n"` or `"---\r\n"` **and** contain a closing fence line (`"\n---"` after the opener) else `Err("SKILL.md content must begin with a frontmatter block")`.

Then, holding `agent_fs_guard()`: `resolve_within_root(root, ".claude/skills/<id>/SKILL.md")`, `create_dir_all(parent)`, `write_atomic(path, &content)` (registers the self-write for the watcher, `project.rs:253`), push the rel path. An I/O error mid-way returns `Err` (earlier writes stand; the caller reloads). Empty input → `Ok(written: [])`.

Tests (`agents/tests.rs`): writes a new skill · overwrites an edited one (reset) · rejects `"Task Format"`, `"../x"`, `"a/b"` · rejects content without frontmatter · rejects duplicates · a bad **second** entry leaves the first **unwritten** · returned paths use forward slashes.

TS wrapper `src/agents/api.ts` (S0):

```ts
export interface SkillInput { id: string; content: string }
export interface SkillsMaterialized { written: string[] }
export function skillsMaterialize(root: string, skills: SkillInput[]): Promise<SkillsMaterialized> {
  return invoke<SkillsMaterialized>("skills_materialize", { root, skills });
}
```

### 3.5 `detect_ai_tools` — `elapsedMs` + 3 s (R2)

`src-tauri/src/toolchain.rs`: `const VERSION_TIMEOUT: Duration = Duration::from_secs(3);` (Block 5a.2). `AiTool` gains, last:

```rust
    /// Wall time for this row's probe (PATH resolve + `--version`), ms.
    pub elapsed_ms: u64,
```

`absent()` sets `0`; `detect_one` measures with `std::time::Instant` from entry to return and overwrites on both paths. Signature unchanged: `pub async fn detect_ai_tools() -> Vec<AiTool>`. Update the module doc (`toolchain.rs:12-14`): the scan now runs on title-screen mount and on **Rescan** (Block 5a) — it is time-boxed and never blocks the screen. Tests: `elapsed_ms <= 3_500` for an absent binary; `VERSION_TIMEOUT == Duration::from_secs(3)`; existing `ids_match_compile_targets` untouched.

TS `src/project/toolchain.ts` (S0): `elapsedMs: number;` appended to `AiTool`. `TitleScreen.tsx:558-565` placeholder rows gain `elapsedMs: 0` (S0, A-11).

### 3.6 `tasks_*` — status alias (R2)

`src-tauri/src/tasks.rs:220`: `"testing" | "in testing" | "in review" | "review" => "in-testing",` (dash→space normalisation already maps `in-review`). Tests: `bucket_for_status_input("In Review")`, `("in-review")`, `("review")` all → `"in-testing"`; existing cases unchanged. File text written by `task_update` is **unchanged** (`in testing`), D-6.

### 3.7 `generate_handler!` — final list (R2 owns `lib.rs`)

Append exactly, after `toolchain::detect_ai_tools` (`lib.rs:140`):

```rust
            toolchain::detect_ai_tools,
            hooks_server::hooks_addr,
            agents::skills_materialize
```

Final count **78**. No other entry changes. Gate (tester): the list has 78 entries; every `invoke("…")` name in `src/**/*.ts(x)` is in the list; no handler body contains the string `Stage-0 stub`.

### 3.8 Sidecar `.cowtext/agents.json` v1 — additive keys (S0, TS-owned; Rust stays opaque)

```json
{
  "version": 1,
  "agents": {
    "<file>.md": {
      "nickname": "", "priority": 1, "influence": 50, "avatarSeed": "…",
      "defaultCwd": "", "defaultTokenCeiling": null,
      "provider": "anthropic"
    }
  },
  "builtinSkills": { "task-format": { "include": true } }
}
```

- `provider` ∈ `"anthropic" | "openai" | "google" | "cursor" | "github"`; emitted only when set; any other value reads as absent.
- `builtinSkills`: emitted only when at least one id is `include: true`; entries with `include: false` are **omitted** (absence = false). Unknown ids are ignored on read and dropped on the next write. `version` stays `1` (`agents.ts:406-410` rationale holds: additive + tolerant).
- `agents_meta_write` is unchanged (it validates `version` only, `agents.rs:958-967`).

---

## 4. Store & seam contract (what S0 lands; consumers in brackets)

### 4.1 `src/store/settings.ts` [U4a, U1, U4b, U3]

```ts
export type UiScale = 85 | 100 | 115 | 130;
export const UI_SCALES: readonly UiScale[] = [85, 100, 115, 130];
export type UiFont = "system" | "plex";
export type CodeFont = "jetbrains" | "system-mono";
export const UI_FONT_STACKS: Record<UiFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  plex: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
};
export const CODE_FONT_STACKS: Record<CodeFont, string> = {
  jetbrains: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  "system-mono": 'ui-monospace, Consolas, "Courier New", monospace',
};
/** Node-type help stays open for the first N launches (Block 1.3). */
export const NODE_TYPE_HELP_OPEN_LAUNCHES = 3;
```

`AppSettings` — six fields appended **after** `defaultCompileTargets`, in this order, with these defaults and merge rules (unknown/bad values → default):

| Field | Type | Default | Merge rule |
|---|---|---|---|
| `uiScale` | `UiScale` | `100` | must be one of `UI_SCALES` |
| `uiFont` | `UiFont` | `"plex"` | enum |
| `codeFont` | `CodeFont` | `"jetbrains"` | enum |
| `launchCount` | `number` | `0` | finite integer ≥ 0 |
| `nodeTypeHelpCollapsed` | `boolean \| null` | `null` | boolean or null |
| `lastRunAgentFile` | `string` | `""` | string |

`persistNow` serialises them in the same order (the file is written whole, `settings.ts:241-264`). `load()`: after merging, `merged.launchCount += 1`, then `set({ ...merged, loaded: true })` and `schedulePersist()` — the `loading` guard (`settings.ts:299`) keeps StrictMode's double effect to one increment.

Actions on `SettingsState`: `setUiScale(v: UiScale)`, `setUiFont(v: UiFont)`, `setCodeFont(v: CodeFont)`, `setNodeTypeHelpCollapsed(v: boolean | null)`, `setLastRunAgentFile(fileName: string)`.

Selectors: `export function selectNodeTypeHelpOpen(s: SettingsState): boolean` = `s.nodeTypeHelpCollapsed === null ? s.launchCount <= NODE_TYPE_HELP_OPEN_LAUNCHES : !s.nodeTypeHelpCollapsed`.

`mergeSettings` becomes `export`ed (pure) for `src/store/settings.test.ts` (S0): defaults for an old file · each new field merges/rejects per the table · `selectNodeTypeHelpOpen` at launchCount 3 (open), 4 (collapsed), explicit `false` overrides. The test never calls `load()` (no `matchMedia` in node).

### 4.2 `src/store/toolchain.ts` — NEW [U4a, U3]

```ts
import { create } from "zustand";
import { detectAiTools, type AiTool } from "../project/toolchain";
import { useEventsStore } from "./events";
import type { CompileTarget } from "./graph";

export type ToolchainPhase = "idle" | "scanning" | "done" | "failed";

export interface ToolchainState {
  phase: ToolchainPhase;
  /** Empty until the first scan completes; the title screen keeps its own placeholder rows. */
  tools: AiTool[];
  error: string | null;
  scannedAt: number | null;   // Date.now() at completion
  totalMs: number | null;     // wall time of the last completed scan (performance.now delta, rounded)
  /** Idempotent while scanning; resolves when done or failed; never throws. */
  scan(): Promise<void>;
}

export const useToolchainStore = create<ToolchainState>(…);

/** null = not scanned yet (tools empty). */
export function isToolFound(tools: readonly AiTool[], id: CompileTarget): boolean | null;

/** "Toolchain scan: 2 of 5 found in 812 ms (claude ✓ 2.1.37 · codex ✗ · cursor ✗ · gh copilot ✗ · gemini ✓ 0.9.1)" —
 *  `cmd` then ✓ + version (or "✓" alone when versionless) or ✗, in PROBES order. */
export function toolchainSummary(tools: readonly AiTool[], totalMs: number): string;
```

`scan()` on done: `useEventsStore.getState().pushLocal(toolchainSummary(tools, totalMs), { toolName: "toolchain" })`; on failure: `pushLocal(\`Toolchain scan failed: ${error}\`, { toolName: "toolchain" })`. A second `scan()` call while `phase === "scanning"` returns the in-flight promise.

### 4.3 `src/store/ui.ts` — NEW [U3, U4a, U4b, B1, U1]

```ts
import { create } from "zustand";

export interface AgentWizardOpts {
  position?: { x: number; y: number } | null;   // flow-space; null/absent = not placed on canvas
  contextNodeId?: string | null;                // node the new agent imports; null/absent = none
}

export interface UiState {
  agentWizard: { open: boolean; position: { x: number; y: number } | null; contextNodeId: string | null };
  openAgentWizard(opts?: AgentWizardOpts): void;
  closeAgentWizard(): void;
  hooksModalOpen: boolean;
  setHooksModalOpen(open: boolean): void;
}
export const useUiStore = create<UiState>(…);
```

`openAgentWizard()` with no opts resets position/contextNodeId to `null`. `closeAgentWizard()` clears all three.

### 4.4 `src/store/events.ts` [U1, U4a]

```ts
export interface LogEvent extends BarnEvent {
  demo?: true;
  /** WO15 D-14: a locally generated informational row (toolchain scan timing …). TS-only — never on the wire. */
  note?: string;
  local?: true;
}
export interface EventsState {
  …
  /** Pushes `{ kind: "other", toolName: opts?.toolName ?? "cowtext", sessionId: "local", ts: Date.now(), note, local: true }`
   *  through the same ring trim as pushEvent. */
  pushLocal(note: string, opts?: { toolName?: string }): void;
}
```

`setDemoMode(false)` keeps local rows (filters `demo` only). `lastLiveTs`/`lensLiveTs`/`SessionTicker` already ignore `other`.

### 4.5 `src/store/project.ts` + `src/fs/api.ts` [U1, U4a]

```ts
// fs/api.ts — §3.3 wrapper hooksAddr()
// project.ts
export const HOOKS_ADDR_FALLBACK = "127.0.0.1:4923";
interface ProjectState {
  …
  /** From `hooks_addr`; the fallback until `loadHooksAddr` resolves (or if it rejects). */
  hooksAddr: string;
  /** Idempotent (module-level promise guard); never rejects. Called once from App.tsx's startup effect. */
  loadHooksAddr(): Promise<void>;
}
export function useHooksAddr(): string { return useProjectStore((s) => s.hooksAddr); }
```

### 4.6 `src/store/agents.ts` + `src/agents/builtinSkills.ts` (NEW) [U3, U4b]

```ts
// store/agents.ts
export const DEFAULT_PRIORITY = 1;                  // every `3` default at :54, :309, :329, :1248 → DEFAULT_PRIORITY
export interface AgentMeta { …; provider?: ProviderId }   // absent = unknown; UI derives via providerForModel(model) ?? "anthropic"
interface AgentsState {
  …
  /** From sidecar `builtinSkills`; absent id = false. Reset to {} by loadAgents. */
  builtinInclude: Record<string, boolean>;
  /** Persists through the existing 700 ms meta debounce (scheduleMetaSave). */
  setBuiltinInclude(id: string, include: boolean): void;
}
/** `\r\n`→`\n`, then trimEnd. */
export function normalizeSkillContent(s: string): string;
```

`parseMetaJson` reads `provider` (validated against `PROVIDER_IDS`) and `builtinSkills` per §3.8; `serializeMeta` writes them per §3.8; `updateMeta` merges `provider` (`patch.provider !== undefined ? patch.provider : base.provider`).

```ts
// agents/builtinSkills.ts  (React hook lives here, not in the store — A-13)
import { useMemo } from "react";
export interface BuiltinSkillState {
  id: string; name: string; description: string; content: string;
  state: "virtual" | "materialized" | "modified";
  include: boolean;
  onDisk: SkillDoc | null;
}
/** Pure. Over BUILTIN_SKILLS order. state = no SkillDoc with dirName === id → "virtual";
 *  normalizeSkillContent(doc.content) === normalizeSkillContent(builtin.content) → "materialized"; else "modified". */
export function builtinSkillStates(skills: readonly SkillDoc[], builtinInclude: Record<string, boolean>): BuiltinSkillState[];
export function useBuiltinSkillStates(): BuiltinSkillState[];   // useMemo over useAgentsStore slices
/** Project skills = on-disk skills that are not a built-in in "materialized" state. */
export function projectSkills(skills: readonly SkillDoc[]): SkillDoc[];
```

`src/store/agents.test.ts` (exists) gains cases for `normalizeSkillContent` and `builtinSkillStates` (virtual / materialized / modified / include from the map).

### 4.7 `src/store/graph.ts` — `adoptFile` only [U3, U4b]

```ts
/** Returns the node id — the new node's, or the existing node's when `relPath` is already adopted.
 *  `position` (flow-space, rounded) replaces the viewport-centre cascade when given. */
adoptFile: (relPath: string, title?: string, position?: { x: number; y: number }) => string;
```

All five existing callers (`App.tsx:956`, `RailSections.tsx:148`, `Inspector.tsx:1259`, `Hierarchy.tsx:266,355`) keep compiling (return ignored). `addEdge` (`graph.ts:698`) is unchanged and is the call for the agent→node `imports` edge.

### 4.8 `src/store/tasks.ts` [U4b]

```ts
export const STATUS_LABELS: Record<TaskStatus, string> = {
  "new": "Todo", "in-production": "In progress", "in-testing": "In review", "done": "Done",
};
export const TASK_TYPE_OPTIONS = ["bug", "feature", "chore", "docs"] as const;
export type TaskTypeOption = (typeof TASK_TYPE_OPTIONS)[number];
```

Stored ids unchanged (D-6). `TasksBoard.tsx:281,373` and `NewTaskDialog.tsx:282` pick the new labels up automatically.

### 4.9 `src/resources/` — NEW, data only [U2, U3, U4a, S0 tests]

Files: `models.json`, `agent-presets.json`, `stacks.json`, `principles.json`, `skills/task-format/SKILL.md`, `index.ts`, `resources.test.ts`. `tsconfig.json` already has `resolveJsonModule`; `?raw` imports are typed by `vite/client` (`src/vite-env.d.ts`).

**`models.json`** (D-10; Marty reviews the non-Anthropic ids):

```json
{ "providers": [
  { "id": "anthropic", "name": "Anthropic", "icon": "anthropic", "cli": "claude", "models": [
    { "id": "claude-fable-5", "label": "Claude Fable 5", "tier": "flagship" },
    { "id": "claude-opus-4-8", "label": "Claude Opus 4.8", "tier": "flagship" },
    { "id": "claude-sonnet-5", "label": "Claude Sonnet 5", "tier": "balanced" },
    { "id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5", "tier": "fast" } ] },
  { "id": "openai", "name": "OpenAI", "icon": "openai", "cli": "codex", "models": [
    { "id": "gpt-5.2", "label": "GPT-5.2", "tier": "flagship" },
    { "id": "gpt-5.1-codex-max", "label": "GPT-5.1 Codex Max", "tier": "flagship" },
    { "id": "gpt-5.1", "label": "GPT-5.1", "tier": "balanced" },
    { "id": "gpt-5-codex", "label": "GPT-5 Codex", "tier": "balanced" },
    { "id": "gpt-5-mini", "label": "GPT-5 mini", "tier": "fast" } ] },
  { "id": "google", "name": "Google", "icon": "gemini", "cli": "gemini", "models": [
    { "id": "gemini-3-pro-preview", "label": "Gemini 3 Pro (preview)", "tier": "flagship" },
    { "id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "tier": "flagship" },
    { "id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "tier": "balanced" },
    { "id": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash-Lite", "tier": "fast" } ] },
  { "id": "cursor", "name": "Cursor", "icon": "cursor", "cli": "cursor", "models": [] },
  { "id": "github", "name": "GitHub Copilot", "icon": "copilot", "cli": "gh copilot", "models": [] }
] }
```

**`agent-presets.json`** — exactly these six, in this order. `mode: "inherit"` ⇒ `tools: []`; `description` is the system-prompt body; `whenToUse` one sentence starting `Use when`; `priority` = 1; no `model` key (the wizard default applies).

| id | name | description | whenToUse | tools | mode |
|---|---|---|---|---|---|
| `reviewer` | Reviewer | Reads a change set and reports risks with file and line; never edits. | Use when a pull request or diff needs a second pair of eyes for bugs, security issues and missing tests before it merges. | Read, Glob, Grep | restrict |
| `test-writer` | Test writer | Adds focused tests for existing behaviour and for the bug being fixed. | Use when a module or fix has no test covering it and you want tests written before or alongside the change. | Read, Glob, Grep, Edit, Write, Bash | restrict |
| `docs-writer` | Docs writer | Writes and updates documentation from the code as it is, not as it was planned. | Use when a README, manual or design doc must be written or brought back in line with the current code. | Read, Glob, Grep, Edit, Write | restrict |
| `refactorer` | Refactorer | Restructures code without changing behaviour, in small verifiable steps. | Use when a file or module has grown hard to change and needs restructuring with the tests kept green. | — | inherit |
| `planner` | Planner | Turns a goal into an ordered, file-level plan before any code is written. | Use when a task spans several files or is unclear enough that a written plan should be agreed before implementation. | Read, Glob, Grep, TodoWrite, AskUserQuestion, ExitPlanMode | restrict |
| `debugger` | Debugger | Reproduces a failure, finds the root cause and proposes the smallest fix. | Use when a test fails or a bug is reported and the cause is not yet known. | Read, Glob, Grep, Bash, BashOutput | restrict |

(All tool names are members of `ALL_TOOLS`, `toolCatalog.ts:85-135`.)

**`stacks.json`** — `{ "categories": [{ id, label, items: [{ id, label }] }] }`, six categories in this order with these ids/labels:

- `languages` "Languages": `typescript` TypeScript · `python` Python · `rust` Rust · `go` Go · `csharp` C# · `java` Java · `kotlin` Kotlin · `swift` Swift
- `frontend` "Frontend": `react` React · `vue` Vue · `svelte` Svelte · `nextjs` Next.js · `tauri` Tauri · `electron` Electron
- `backend` "Backend": `node-express` Node/Express · `fastapi` FastAPI · `django` Django · `axum` axum · `actix` Actix · `aspnet` ASP.NET · `spring` Spring
- `engines` "Engines/Graphics": `unity` Unity · `unreal` Unreal · `godot` Godot · `pixijs` PixiJS · `threejs` Three.js
- `data` "Data": `postgresql` PostgreSQL · `sqlite` SQLite · `redis` Redis · `prisma` Prisma · `drizzle` Drizzle
- `tooling` "Tooling": `pnpm` pnpm · `vite` Vite · `tailwind` Tailwind · `zustand` Zustand · `vitest` Vitest · `playwright` Playwright

**`principles.json`** — `{ "principles": [{ id, label, body }] }`, six in this order. `body` is the full markdown of a `rule`-role node (`\n`-joined in JSON):

| id | label | body |
|---|---|---|
| `no-commit-without-asking` | Never commit without asking | `# Never commit without asking` ¶ `Do not run \`git commit\` (or anything that creates a commit) unless the user has explicitly asked for a commit in this conversation. Stage and describe the change, then ask.` ¶ `Example: "Changes are ready in 3 files — commit as \`fix: clamp panel width\`? (yes / no / I'll do it)"` |
| `short-commit-subjects` | Short commit messages (≤ 50 chars subject) | `# Short commit messages` ¶ `Commit subject lines are at most 50 characters, imperative mood, no trailing period. Put detail in the body after a blank line.` ¶ `Example: \`feat: add branch picker to project wizard\` — not \`Added a new branch picker component to the project wizard so that users can choose their branch.\`` |
| `ask-before-dependency` | Ask before adding a dependency | `# Ask before adding a dependency` ¶ `The dependency set is fixed. Before adding a package, crate, font or CLI tool, stop and ask — name the dependency, its size, and what it replaces.` ¶ `Example: "This needs a date parser: \`date-fns\` (~20 KB) or a 30-line local helper — which do you prefer?"` |
| `tests-before-done` | Run tests before declaring done | `# Run tests before declaring done` ¶ `A task is not done until the project's test and lint commands have run green in this session. Paste the final gate output, not a summary of it.` ¶ `Example: \`npm run build && npm run lint && npm run test\` — all three exit 0 before you say "done".` |
| `no-destructive-git` | No destructive git operations (force-push, reset --hard) | `# No destructive git operations` ¶ `Never run \`git push --force\`, \`git reset --hard\`, \`git checkout -- <file>\`, \`git clean -f\`, or any command that discards work that is not yours. If history must be rewritten, ask first and say what will be lost.` ¶ `Example: to undo a bad commit, propose \`git revert <sha>\` — not \`git reset --hard HEAD~1\`.` |
| `prefer-editing-existing` | Prefer editing existing files over creating new ones | `# Prefer editing existing files` ¶ `Extend the file that already owns a concern before creating a new one. New files need a reason the existing structure cannot absorb them.` ¶ `Example: a new settings field goes into \`src/store/settings.ts\`, not a new \`src/store/appearance.ts\`.` |

(¶ = blank line.)

**`skills/task-format/SKILL.md`** — frontmatter `name: task-format`, `description:` = today's `DESCRIPTION` string (`taskFormatSkill.ts:14-19`), body = today's `BODY` (`taskFormatSkill.ts:25-113`) with one change: the `in testing` alias line becomes `` `in testing` — from `testing` | `in testing` | `in review` | `review` `` (§3.6).

**`index.ts`** exports:

```ts
import type { ProviderId } from "../agents/types";
import type { CompileTarget } from "../store/graph";

export const PROVIDER_SUPPORT_SENTENCE =
  "Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.";

export type ModelTier = "flagship" | "balanced" | "fast";
export type ProviderIconId = "anthropic" | "openai" | "gemini" | "cursor" | "copilot";
export interface ModelEntry { id: string; label: string; tier: ModelTier }
export interface Provider { id: ProviderId; name: string; icon: ProviderIconId; cli: string; models: ModelEntry[] }
export const PROVIDERS: readonly Provider[];
export function providerById(id: string): Provider | null;
/** First `flagship` entry, else the first model, else null (cursor/github). */
export function defaultModelFor(id: ProviderId): string | null;
export const DEFAULT_PROVIDER: ProviderId = "anthropic";
export const DEFAULT_AGENT_MODEL = "claude-fable-5";
/** Which toolchain row proves a provider is installed (chips dim when not found). */
export const PROVIDER_COMPILE_TARGET: Record<ProviderId, CompileTarget> =
  { anthropic: "claude", openai: "agents", google: "gemini", cursor: "cursor", github: "copilot" };

export interface AgentPreset { id: string; name: string; description: string; whenToUse: string; tools: string[]; mode: "inherit" | "restrict"; priority: number; model?: string }
export const AGENT_PRESETS: readonly AgentPreset[];

export interface StackItem { id: string; label: string }
export interface StackCategory { id: string; label: string; items: StackItem[] }
export const STACK_CATEGORIES: readonly StackCategory[];
export function stackItemById(id: string): { category: StackCategory; item: StackItem } | null;

export interface Principle { id: string; label: string; body: string }
export const PRINCIPLES: readonly Principle[];
export const FIXED_STACK_PRINCIPLE_ID = "ask-before-dependency";

export interface BuiltinSkill { id: string; name: string; description: string; body: string; content: string }
/** Minimal frontmatter reader: `name:`/`description:` scalars between the first two `---` lines; body = after the closing fence, one leading newline stripped. */
export function parseSkillMd(content: string): { name: string; description: string; body: string };
export const BUILTIN_SKILLS: readonly BuiltinSkill[];   // via `import raw from "./skills/task-format/SKILL.md?raw"`
```

**`resources.test.ts`** asserts: the five provider ids in order; `DEFAULT_AGENT_MODEL === defaultModelFor("anthropic")` and its tier is `flagship`; cursor/github have `[]`; model ids unique and match `/^[a-z0-9][a-z0-9.\-]*$/`; `PROVIDER_COMPILE_TARGET` covers every provider · presets: exactly the six ids in order, `whenToUse.length >= 20`, starts with `Use when`, `!== name`, `tools ⊆ ALL_TOOLS`, `mode === "inherit" ⇒ tools.length === 0`, `priority === DEFAULT_PRIORITY`, `model` (if any) ∈ the model ids · stacks: six categories with the exact labels and item labels above, ids unique · principles: six ids in order, labels exactly the spec's strings, `body.trim().split("\n").length >= 2`, `FIXED_STACK_PRINCIPLE_ID` present · built-ins: `task-format` present, `content.startsWith("---\n")`, `name === id`, body and description non-empty, and `parseSkillMd(content).body === body`.

### 4.10 `src/agents/types.ts` + `src/agents/modelCatalog.ts` [U3]

```ts
// types.ts
export type ProviderId = "anthropic" | "openai" | "google" | "cursor" | "github";
export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai", "google", "cursor", "github"];
// modelCatalog.ts (shortModelLabel / MODEL_NOTES unchanged)
/** Exact id in PROVIDERS → its provider; else prefix heuristics: `claude-`|opus|sonnet|haiku|fable → anthropic,
 *  `gpt-`|`o1`|`o3`|`o4`|`codex` → openai, `gemini-` → google; else null. */
export function providerForModel(modelId: string | null): ProviderId | null;
```

### 4.11 `src/wizard/projectGraph.ts` — NEW, pure, tested [U2]

```ts
import type { BarnGraph, CompileTarget, MemoryNode } from "../store/graph";
import type { StubFile } from "../preset/types";

export interface ProjectGraphInput {
  projectName: string;
  principleIds: readonly string[];
  stackItemIds: readonly string[];
  fixedStackRule: boolean;
  compileTargets: readonly CompileTarget[];   // the wizard passes useSettingsStore.getState().defaultCompileTargets
}
export interface ProjectGraphPlan {
  graph: BarnGraph;                           // version 5, no edges
  graphJson: string;                          // serializeGraph(graph)
  stubs: StubFile[];                          // every node except context/project.md
  summary: { count: number; names: string[]; relPaths: string[] };
}
export function buildProjectGraph(input: ProjectGraphInput): ProjectGraphPlan;
```

Rules (deterministic — same input ⇒ same bytes):
1. Node order = `[project, stack?, …principles]`; `readOrder` = 1…n in that order; `position = { x: 80 + (i % 3) * 360, y: 80 + Math.floor(i / 3) * 160 }` (A-1); every node `rootLoad: "always"`; ids are fixed strings (`node-project`, `node-stack`, `node-principle-<id>`).
2. Project node: title = `projectName.trim() || "Project"`, role `architecture`, brief `"What this project is, who it is for, and the rules it lives by."`, filePath `context/project.md`, tags `["project"]`. **Not a stub** — `project_init` already wrote the file (`project_meta.rs:257-272`).
3. Stack node only when ≥ 1 known stack id: title `Stack`, role `architecture`, brief `"The languages, frameworks and tools this project is built with."`, filePath `context/stack.md`, tags `["stack"]`; stub body = `# Stack` ¶ then, per non-empty category in `STACK_CATEGORIES` order, `## <label>` + `- <item label>` lines ¶ and, when `fixedStackRule`, the final line `Fixed stack: ask before adding a dependency.` Unknown ids are ignored.
4. Principle ids = `principleIds` ∪ (`fixedStackRule` ? `[FIXED_STACK_PRINCIPLE_ID]` : `[]`), deduped, **in `PRINCIPLES` order**, unknown ids ignored. Each: title = label, role `rule`, brief = label, filePath `context/principles/<id>.md`, tags `["principle"]`; stub content = `body` + trailing `\n`.
5. `graph.compileTargets` = input filtered to the five known targets; `projectName` = the trimmed name.

`src/wizard/projectGraph.test.ts`: 3 principles + 4 stack chips ⇒ 5 nodes / 4 stubs, every stub non-empty, exactly 3 `rule` nodes; `fixedStackRule` adds `ask-before-dependency` when absent and does not duplicate it when present; empty selection ⇒ 1 node, 0 stubs; `JSON.parse(graphJson).version === 5`; ids unique; readOrder 1…n; determinism (two calls, byte-equal).

### 4.12 `src/ui/LocalOnlyBadge.tsx` — NEW [U1, U3]

```tsx
export const LOCAL_ONLY_DEFAULT_HINT = "Stays on this machine — never compiled into agent files.";
export function LocalOnlyBadge({ hint = LOCAL_ONLY_DEFAULT_HINT }: { hint?: string }) { … }
```

Same markup/classes as `AgentEditor.tsx:48-57`, `title={hint}`, text `local only`. `AgentEditor.tsx` keeps its own copy until U3 switches it to this import (U3 passes the agent-specific hint `"Stored in .cowtext/agents.json — never written to the agent's own file."` explicitly).

### 4.13 Optional prop additions (type-only at S0; no destructuring, so `noUnusedParameters` stays quiet)

| File:line | Addition | Filled by | Read by |
|---|---|---|---|
| `src/inspector/Inspector.tsx:2689` | `export type InspectorSurface = "canvas" \| "tasks" \| "barn";` and `surface?: InspectorSurface` in the props type | U4a | U1 |
| `src/project/ProjectWizard.tsx:238` | `export interface ProjectWizardOutcome { graphApplied: boolean; git: GitInitResult \| null }` and `onDone: (root: string, openImport: boolean, outcome?: ProjectWizardOutcome) => void` | U2 | U4a |
| `src/git/GitWizard.tsx:267-275` | `.then((r) => …)` reads `r.status` (behaviour-preserving, A-12) | — | U2 |
| `src/project/TitleScreen.tsx:558-565` | `elapsedMs: 0` on the five placeholder rows (A-11) | — | U4a |
| `src/tasks/NewSkillDialog.tsx:9,101-114` | remove the `TASK_FORMAT_SKILL` import and the prefill button block (A-18) | — | U3 |

### 4.14 `src/wizard/roles.test.ts` — NEW (S0)

`WIZARD_ROLE_GROUPS` flattens to exactly 13 roles, `agent` absent, every group has ≥ 1 role, and for each role `NODE_TYPE_BY_ROLE[r].microExample.trim().length > 0`, `.label` and `.hint` non-empty (Block 1 acceptance test).

### 4.15 Consumer map (who imports what — the tester greps these)

| Seam | Consumers |
|---|---|
| `useToolchainStore`, `isToolFound`, `PROVIDER_COMPILE_TARGET` | `TitleScreen.tsx`, `AiToolchainModal.tsx` (U4a); `ModelPicker.tsx` (U3) |
| `useUiStore.agentWizard` | `NewAgentDialog.tsx` (U3 reads), `App.tsx` (U4a mounts), `GraphCanvas.tsx` + `MemoryNodeCard.tsx` (U4b open), `RailSections.tsx` + `OrchestratorView.tsx` (U3 open) |
| `useUiStore.hooksModalOpen` | `BarnScene.tsx` (B1 sets), `App.tsx` (U4a mounts `HooksModal`), `EventLog.tsx` (U1 sets) |
| `useHooksAddr` | `SettingsModal.tsx` (U4a), `HooksModal.tsx` + `EventLog.tsx` (U1) |
| `pushLocal` | `toolchain.ts` (S0); rows rendered by `EventLog.tsx` (U1) |
| `PROVIDER_SUPPORT_SENTENCE` | `TitleScreen.tsx`, `SettingsModal.tsx` (U4a), `ProjectWizard.tsx` (U2), `OrchestratorView.tsx` (U3) |
| `BUILTIN_SKILLS`, `useBuiltinSkillStates`, `setBuiltinInclude`, `skillsMaterialize` | `RailSections.tsx`, `SkillEditor.tsx`, `NewAgentDialog.tsx`, `CompileModal.tsx` (U3) |
| `PROVIDERS`, `defaultModelFor`, `providerForModel`, `AGENT_PRESETS` | `ModelPicker.tsx`, `NewAgentDialog.tsx`, `AgentEditor.tsx` (U3) |
| `PRINCIPLES`, `STACK_CATEGORIES`, `buildProjectGraph`, `gitInit(…, true)`, `GitStatus.identity*` | `ProjectWizard.tsx`, `GitWizard.tsx`, `BranchPicker.tsx` (U2) |
| `STATUS_LABELS`, `TASK_TYPE_OPTIONS`, `DEFAULT_PRIORITY`, `setLastRunAgentFile` | `NewTaskDialog.tsx`, `TasksBoard.tsx`, `MemoryNodeCard.tsx`, `AddAgentDialog.tsx` (U4b) |
| `selectNodeTypeHelpOpen`, `LocalOnlyBadge`, `Inspector.surface` | `Inspector.tsx` (U1) |
| `uiScale`/`uiFont`/`codeFont` + `*_FONT_STACKS`, `loadHooksAddr`, `ProjectWizardOutcome` | `App.tsx`, `SettingsModal.tsx` (U4a) |

---

## 5. File-zone grid

Exactly one owning lane per row. "S0 then X" = S0 edits the named lines first (§4.13 / §8); X owns the file once the parallel round starts. **Untouched** rows may not be edited by anyone this work order.

| File | Owner | Scope of change |
|---|---|---|
| `src/store/settings.ts` | S0 | §4.1 |
| `src/store/settings.test.ts` * | S0 | §4.1 |
| `src/store/toolchain.ts` * | S0 | §4.2 |
| `src/store/ui.ts` * | S0 | §4.3 |
| `src/store/events.ts` | S0 | §4.4 (previously unassigned — now assigned) |
| `src/store/project.ts` | S0 | §4.5 |
| `src/store/agents.ts` | S0 | §4.6 |
| `src/store/agents.test.ts` | S0 | §4.6 cases |
| `src/store/graph.ts` | S0 | `adoptFile` only (§4.7); everything else frozen |
| `src/store/tasks.ts` | S0 | §4.8 |
| `src/agents/types.ts`, `src/agents/api.ts`, `src/agents/modelCatalog.ts` | S0 | §4.10, §3.4 wrapper |
| `src/agents/builtinSkills.ts` * | S0 | §4.6 |
| `src/git/types.ts`, `src/git/api.ts` | S0 | §3.1, §3.2 |
| `src/git/GitWizard.tsx` | S0 then U2 | S0: lines 267-275 only |
| `src/fs/api.ts` | S0 | `hooksAddr()` |
| `src/project/toolchain.ts` | S0 | `elapsedMs` |
| `src/project/TitleScreen.tsx` | S0 then U4a | S0: placeholder `elapsedMs: 0` only |
| `src/project/ProjectWizard.tsx` | S0 then U2 | S0: prop type only |
| `src/inspector/Inspector.tsx` | S0 then U1 | S0: `surface?` prop type only |
| `src/tasks/NewSkillDialog.tsx` | S0 then U3 | S0: prefill removal only |
| `src/tasks/taskFormatSkill.ts` | S0 | **deleted** |
| `src/resources/**` (7 files) * | S0 | §4.9 |
| `src/wizard/projectGraph.ts` *, `src/wizard/projectGraph.test.ts` *, `src/wizard/roles.test.ts` * | S0 | §4.11, §4.14 |
| `src/ui/LocalOnlyBadge.tsx` * | S0 | §4.12 |
| `src-tauri/src/git.rs`, `src-tauri/src/git/tests.rs` | R1 | §3.1, §3.2 |
| `src-tauri/src/lib.rs` | R2 | §3.7 only |
| `src-tauri/src/hooks.rs`, `hooks/tests.rs`, `hooks_server.rs`, `hooks_server/tests.rs` | R2 | §3.3 |
| `src-tauri/src/toolchain.rs`, `toolchain/tests.rs` | R2 | §3.5 |
| `src-tauri/src/agents.rs`, `agents/tests.rs` | R2 | §3.4 |
| `src-tauri/src/tasks.rs`, `tasks/tests.rs` | R2 | §3.6 |
| `src/inspector/Inspector.tsx` (after S0), `sectionOrder.tsx`, `InspectorSection.tsx`, `EventLog.tsx`, `HooksModal.tsx` | U1 | §6 U1 |
| `src/wizard/NodeWizard.tsx`, `src/project/ProjectWizard.tsx` (after S0), `src/git/GitWizard.tsx` (after S0), `src/git/BranchPicker.tsx` *, `src/git/gitignorePresets.ts`, `src/ui/PreviewPane.tsx`, `src/ui/TwoPaneModal.tsx` | U2 | §6 U2 |
| `src/tasks/NewAgentDialog.tsx`, `src/tasks/NewSkillDialog.tsx` (after S0), `src/agents/AgentEditor.tsx`, `src/agents/ModelPicker.tsx` *, `src/agents/ToolPicker.tsx`, `src/agents/RailSections.tsx`, `src/agents/SkillEditor.tsx`, `src/icons/providers/{Anthropic,OpenAI,Gemini,Cursor,Copilot}.tsx` *, `src/icons/providers/index.ts` *, `src/compile/CompileModal.tsx`, `src/compile/types.ts`, `src/orchestrator/OrchestratorView.tsx`, `src/rail/Hierarchy.tsx` | U3 | §6 U3 (`Hierarchy.tsx`: reserved, no planned change) |
| `src/App.tsx`, `src/main.tsx`, `src/project/TitleScreen.tsx` (after S0), `src/project/AiToolchainModal.tsx`, `src/settings/SettingsModal.tsx`, `src/styles/tokens.css`, `src/styles/index.css`, `tailwind.config.js`, `src/ui/Dock.tsx` | U4a | §6 U4a |
| `src/canvas/GraphCanvas.tsx`, `LensControl.tsx`, `MemoryNodeCard.tsx`, `roleMeta.ts`, `EmptyCanvasGuide.tsx` *, `src/ui/menuTypes.ts`, `src/ui/useContextMenu.ts`, `src/ui/ContextMenu.tsx`, `src/sessions/AddAgentDialog.tsx`, `src/tasks/NewTaskDialog.tsx`, `src/tasks/TasksBoard.tsx` | U4b | §6 U4b |
| `src/scene/**` incl. `src/scene/sfx.ts` | B1 | §6 B1 (`sfx.ts`: previously unassigned — B1, no change expected) |
| `scripts/truth.mjs` *, `scripts/truth.lib.mjs` *, `src/truth/truth.test.ts` *, `package.json` (scripts block only), `.claude/scripts/docs-guard.ps1`, `AGENTS.md` (script only), `.agents/skills/**` (script only), `.codex/config.toml` (comment lines only), `README.md` | D1 | §6 D1 |
| `docs/design/WO15_CONTRACT.md`, `docs/design/PROVIDER_SUPPORT_MATRIX.md`, `docs/design/WO15_AUDIT.md` * | TL | |
| `docs/testing/GOLDEN_PATH_MANUAL.md` * | T | read-only elsewhere |
| `docs/fleet/*`, `docs/tasks/*`, `docs/TERMINOLOGY.md`, `docs/TERMINOLOGY_REFERENCE.md`, `CLAUDE.md` (Status prose + hard-rule sentence; truth block via script), `.claude/skills/cowtext-terminology/SKILL.md`, `.claude/skills/task-format/SKILL.md` | PM | after all lanes |
| `src-tauri/src/bin/cowtext_cli.rs`, `src-tauri/src/bin/cowtext_mcp.rs` | **untouched** (R2 read-only; previously unassigned — now explicitly frozen) | — |
| `src-tauri/src/handoff.rs` (+ tests) | **untouched** (previously unassigned — now explicitly frozen) | — |
| `src-tauri/src/{compile,preset,project,project_meta,assemble,sessions,watcher,import,lint,fsbatch,frontmatter,resolve_load,settings,worktree,tasklinks,taskctx,main}.rs`, `src-tauri/capabilities/*`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` | **untouched** | — |
| `src/config/**`, `src/store/{graph.test,tokens,tokens.test,sessions,tasklinks,review,toasts,projectSelection}.ts`, `src/canvas/*` not listed, `src/inspector/*` not listed, `src/preset/**`, `src/handoff/**`, `src/assemble/**`, `src/compile/{api,diff}.ts`, `src/ui/{ErrorBoundary,ToastHost,ResizeHandle,ScanOverlay}.tsx`, `src/ui/diff.ts`, `tests/fixtures/**`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `tsconfig*.json`, `.mcp.json`, `.codex/hooks.json`, `.codex/agents/*` | **untouched** | — |

Shared-parent overlap audit (memory class 3): `src/ui/` — S0 adds `LocalOnlyBadge.tsx`; U2 owns `PreviewPane.tsx`, `TwoPaneModal.tsx`; U4a owns `Dock.tsx`; U4b owns `menuTypes.ts`, `useContextMenu.ts`, `ContextMenu.tsx`; the rest frozen. `src/tasks/` — S0 deletes `taskFormatSkill.ts` and touches `NewSkillDialog.tsx` first; U3 owns `NewAgentDialog.tsx` + `NewSkillDialog.tsx`; U4b owns `NewTaskDialog.tsx` + `TasksBoard.tsx`; `api.ts` and the rest frozen. `src/agents/` — S0: `types.ts`, `api.ts`, `modelCatalog.ts`, `builtinSkills.ts`; U3: the components. `src/project/` — S0 first on `TitleScreen.tsx`/`ProjectWizard.tsx`, then U4a/U2 respectively; `types.ts`, `api.ts` frozen. `src/git/` — S0 on types/api/GitWizard lines, then U2. `src/store/` — S0 only. `src-tauri/src/` — R1 `git*`, R2 the six modules + `lib.rs`, everything else frozen.

---

## 6. Per-lane deliverables + acceptance gates

Gates "own" = what the lane runs before reporting; "full" = the tester after landing. Spec acceptance bullets are restated against real control names.

### S0 — tech-general, serialized first

Build everything in §4 and §4.13 in the order of §8. Gate: `npm run build`, `npm run lint` (0 errors; warnings ≤ 16), `npm run test` — all green at exit, nothing else mid-flight. Report the Vitest count (expected 163 + the new files' cases).

### R1 — tech-general (git)

1. §3.1 identity fields. 2. §3.2 `git_init(commit)` + `GitInitResult` + the consts. 3. Tests listed in §3.2 (+ the A-7 regression). 4. Verify by reading (no edit): `preset.rs:219-227` empty-graph tolerance (A-6).
Gates: `cargo test --all-targets`, `cargo clippy --all-targets -- -D warnings` (from `src-tauri/`).
Acceptance (Block 0): after New Project with branch `main`, `git branch --show-current` prints `main` and `git log --oneline | wc -l` is 1 · an existing repo is never re-initialised or committed (`skippedExistingRepo`) · missing identity ⇒ the exact `GIT_IDENTITY_ERR` string and no `.git` created · no commits on any later action (nothing else calls `git_init(…, true)` — tester greps).

### R2 — tech-general (hooks / toolchain / agents / tasks / lib.rs)

1. §3.3 `hooks_addr` + const unification (+ tests). 2. §3.4 `skills_materialize` (+ tests). 3. §3.5 `elapsed_ms` + 3 s + doc update (+ tests). 4. §3.6 alias (+ tests). 5. §3.7 `generate_handler!` — final count 78.
Gates: as R1. Acceptance: `rg -n "4923" src-tauri/src` matches **only** `hooks_server.rs:20` and test files · handler list has 78 entries · `detect_ai_tools` still returns five rows in `PROBES` order.

### U1 — tech-ui (Inspector, EventLog, HooksModal)

1. **Block 1.3/1.4** — `Inspector.tsx:605` `<FieldLabel>Role</FieldLabel>` → `Node type`; the trigger text (`:621`) shows `NODE_TYPE_BY_ROLE[node.role].label` (not the raw id); under it, a collapsible with `hint` + `microExample` (monospace block), open per `selectNodeTypeHelpOpen`, toggle writes `setNodeTypeHelpCollapsed(bool)`; a `?` icon button beside the label (aria-label `Node type help`) opens a popover (clone `RolePopup`'s anchor/escape/focus-return mechanics, `Inspector.tsx:451`) listing the 13 `WIZARD_ROLE_GROUPS` roles grouped, each row = glyph · label · hint · monospace `microExample`, footer line `WIZARD_BLOCKED_HINT`. Metadata header `hint` (`:1612`) shows the label, not `node.role`.
2. **Block 2** — `sectionOrder.tsx`: `MemoryNodeSectionKey` gains `"node.advanced"`, drops `"node.position"`; `MEMORY_NODE_ORDER = ["node.metadata","node.assemble","node.context","node.relations","node.file","node.advanced","node.actions"]`; `AGENT_NODE_ORDER = ["node.agent","node.context","node.relations","node.assemble","node.advanced","node.actions"]`. Metadata keeps Title, Node type, Owner (`BriefField`/`TagsField` move). `AssembleSection` (`:188`) renders, in order: **Brief** (helper `Seed sentence Assemble expands`) → **Tags** (helper `Used for subgraph selection and compile filtering`) → **Influence** (slider 0–100 + numeric input; memory nodes: `disabled`, value 50, `title="Not used for <Label>"`, helper `Influence is an agent setting stored in .cowtext/agents.json. It is not read by Assemble or resolveLoad yet.`; agent nodes: live, bound to `meta.influence` via `updateMeta`) → actions (Assemble / Summarize / Refine as today; tooltips `… with headless Claude Code (claude -p)`) → **live preview**: 400 ms debounced `assemblePreview(root, serializeGraph(in-memory), node.id, "assemble")` **without** `flushSave`, showing the first 12 lines of `prompt` (monospace, scrollable) + `neighbors` chips; errors inline; skipped while `busy`. `node.assemble` is open by default (no change to `collapsedSections`). **Advanced** section (`InspectorSection` gains `defaultCollapsed?: boolean`, D-18) holds `PositionField` with `<LocalOnlyBadge />` next to the label; same for the agent-node panel (`:1146-1150`).
3. **Tasks surface** — when `surface === "tasks"`, the fallback copy (`:2810`) becomes `Select a task to see its context subgraph and pinned nodes.`
4. `EventLog.tsx`: rows with `note` render the note as the detail text (tag `toolName`); `Install hooks` (`:195,207`) → `useUiStore.getState().setHooksModalOpen(true)`; the local `hooksOpen` state and the `<HooksModal>` mount at `:251` are removed (App mounts it, U4a). `HooksModal.tsx:180,196`: `{hooksAddr}` from `useHooksAddr()`.
Gates: build + lint. Acceptance: on a fresh project, selecting the only node shows the Influence slider **without scrolling at 1920×1080** (screenshot) · Brief/Tags edits change the preview within ~0.5 s · Position fields work but are visible only after expanding Advanced · `rg -n '\bRole\b' src --glob '*.tsx' | rg -v 'RoleGlyph|RolePopup|RoleField|RoleGroup|RolePicker|roleVar|ROLE_|NodeRole|//|\*'` → empty · every control in the panel either appears in compiled output or carries `LocalOnlyBadge` (Position, Influence on agent nodes).

### U2 — tech-ui (wizards, git)

1. **Block 1.1/1.2** — `NodeWizard.tsx:942` label `Type` → `Node type`; every tile of the step-1 grouped picker shows icon · name · hint · monospace `microExample` (add where missing); `PreviewPane.tsx:199` `How this is used` → `What you get`.
2. **Block 6 + Block 0 (wizard)** — `ProjectWizard.tsx` `new` mode steps: `STEPS = ["Folder","Project","Principles","Stack","Git","Create"]` (`convert` keeps `["Folder","Project","Create"]`). **Principles** = six checkboxes from `PRINCIPLES` (label + first body line as hint). **Stack** = search box + chips grouped by `STACK_CATEGORIES` + checkbox `Fixed stack — ask before adding a dependency`. **Git** = `BranchPicker` + toggle `Initialize git and make the first commit` (default on; disabled with notice `Existing repository detected — git init skipped` when `gitStatus.isRepo`; warning `Git identity is not configured — the first commit will fail. Set user.name and user.email, or turn the toggle off.` when either identity field is null; hidden when `!gitAvailable` with `git not found on PATH — skipping`). **Create** shows the live **Will create** list: `buildProjectGraph(...).summary` names + `.cowtext/project.json`, `context/project.md`, `.gitignore` (when git on), and the sentence `Nothing is written until you click Create.` Create = `projectInit` → `presetApply(plan.graphJson, plan.stubs)` (always, D-16) → if git on: `gitInit(root, branch, true)` → result line `branch main · 1 commit` or the error text (stay on the step; Create becomes `Retry`) → `onDone(root, false, { graphApplied: true, git })`. Convert mode unchanged except copy: the convert step imports `PROVIDER_SUPPORT_SENTENCE` and says `Imports the CLAUDE.md, AGENTS.md or .cursor/rules you already have — preview first.`
3. **`BranchPicker.tsx`** (new, shared): extracted from `GitWizard.tsx:222-225,411-444` — props `{ value: string; onChange(v: string): void; disabled?: boolean }` with the main/master/custom segmented + custom input + the existing `isValidBranchName` (moved here, exported).
4. **`GitWizard.tsx`**: uses `BranchPicker`; shows identity row (`identityName <identityEmail>` or `not configured`) and, after init, `committed ? "1 commit" : "no commits"` from `GitInitResult`; the existing init call passes `commit: true` only when a new `Make the first commit` toggle (default on, same disabled/notice rules) is on.
5. `gitignorePresets.ts`: `cowtext` preset lines += `.claude/settings.local.json`, `CLAUDE.local.md`, `.cowtext/cache/`.
Gates: build + lint. Acceptance (Block 6): selecting 3 principles + 4 stack chips creates exactly 3 `rule` nodes + 1 `architecture` stack node (plus the starter `context/project.md`), all with non-empty bodies, all visible on the canvas after Create · nothing on disk before Create (tester watches the folder) · Block 0 acceptance as R1 · every wizard control either produces a file/node or carries `LocalOnlyBadge` (the git toggle produces `.git`; none are local-only).

### U3 — tech-ui (agents, skills, compile modal, orchestrator)

1. **Block 3a** — `ModelPicker.tsx` (new; `AgentEditor.tsx:190-290` moves here): step 1 provider chips (icon from `src/icons/providers` + name; a chip whose `PROVIDER_COMPILE_TARGET[id]` is not found per `useToolchainStore` — or not scanned — renders dimmed with `title="Not found on this machine — still selectable"`); step 2 the provider's models grouped by tier (`Flagship` / `Balanced` / `Fast`) + last entry **Custom model id…** (free text, non-empty). Props `{ provider: ProviderId; model: string | null; disabled: boolean; onChange(v: { provider: ProviderId; model: string | null }): void }`. `NewAgentDialog` default = `{ provider: DEFAULT_PROVIDER, model: DEFAULT_AGENT_MODEL }`; on Create: `model` goes to frontmatter **iff** `provider === "anthropic"` (`composeAgentFile`, `:105`), else omitted and the field shows `<LocalOnlyBadge hint="Model for <Provider name> is kept locally until its agent format supports it" />`; `updateMeta(file, { provider })` always. `AgentEditor` uses the same picker (provider derived `meta.provider ?? providerForModel(model) ?? "anthropic"`). Icons: `src/icons/providers/*.tsx` — `({ size = 16, className }) => <svg viewBox="0 0 16 16" fill="currentColor" …/>`, hand-authored monochrome glyphs, no library; `index.ts` maps `ProviderIconId → component`.
2. **Block 3b** — `NewAgentDialog.tsx:152` `useState(DEFAULT_PRIORITY)`; `validateDescription` (`AgentEditor.tsx:376-402`) blocking rules become exactly: empty · `whenToUse.trim().length < 20` · `whenToUse.trim().toLowerCase() === name.trim().toLowerCase()` (signature gains `name: string`); everything else is a soft tip `Tip: start with "Use when…" so Claude picks this agent reliably` (shown when it doesn't start with `Use when`, never blocking); helper text visible before typing.
3. **Block 3c** — a **Preset** chip row at the top of the wizard from `AGENT_PRESETS` + `Custom` (clears); picking fills name, duties (= `description`), whenToUse, tools (`inherit` ⇒ `[]`), priority, model if present; all fields stay editable.
4. **Block 5b (wizard half)** — reads `useUiStore.agentWizard`: a **Context** row names the node when `contextNodeId` is set (`Context: <title> — imported by this agent`); on Create: `adoptFile(".claude/agents/<file>", name, position ?? undefined)` when `position !== null`, then `addEdge({ source: agentNodeId, target: contextNodeId, kind: "imports" })` when `contextNodeId !== null` (adopt first if the agent was not placed, so the edge has a source); otherwise select the agent in the rail as today. `RailSections.tsx:189` local mount → `openAgentWizard()`; its `No agents in .claude/agents/` row gains a `Create agent` button; `OrchestratorView.tsx:397-400` empty state → heading `No agents yet`, body `Agent definitions are Claude Code files in .claude/agents/. ` + `PROVIDER_SUPPORT_SENTENCE`, primary button `Create agent` → `openAgentWizard()`.
5. **Block 4** — Skills rail: two groups, **Built-in** (from `useBuiltinSkillStates`, each row: name · toggle `Include in compile` → `setBuiltinInclude` · badge `materialized` when applicable) and **Project** (`projectSkills(skills)` — includes `modified` built-ins with badge `modified from built-in` + action `Reset to built-in` → confirm strip `Overwrite .claude/skills/<id>/SKILL.md with the bundled version?` → `skillsMaterialize(root, [{ id, content }])` → `loadAgents(root)`). `SkillEditor` read-only view for `virtual` built-ins (content shown, no Save). Wizard skills list (`NewAgentDialog.tsx:446-461`) lists built-ins with the same badges; attaching a virtual one also `setBuiltinInclude(id, true)` (D-20).
6. **CompileModal** — after `compilePreview` resolves, append synthetic rows for each built-in with `include && state !== "modified"` (A-14): `relPath = .claude/skills/<id>/SKILL.md`, `target: "skill"` (`PreviewFile.target` union gains `"skill"` in `compile/types.ts`), `oldContent = onDisk?.content ?? null`, `newContent = content`, `unchanged = state === "materialized"`, approved by default iff `!unchanged`; diff via the existing client LCS. `doWrite` (`:487-508`): `compileWrite(approved non-skill rows)` → on success `skillsMaterialize(root, approved skill rows)` → `loadAgents(root)` → `rescan()`; footer counts include skill rows (`N of M files will be written`). A failure in `skillsMaterialize` shows the error and keeps the compile result (`written` lists what landed).
Gates: build + lint. Acceptance (Block 3): a new agent with no changes gets priority 1 and `claude-fable-5` · `Use when reviewing PRs for security issues.` ⇒ no error, no tip · the compiled preview shows `model: claude-fable-5` for the Claude Code target · each preset's fields round-trip into the preview. (Block 4): fresh project ⇒ Built-in group shows `task-format` immediately and `.claude/skills/` stays empty · enable + Compile ⇒ the file exists and the row shows `materialized`; editing it on disk moves it to Project with `modified from built-in` · no built-in is enabled by default. (Block 5b): `rg -n "<NewAgentDialog" src` matches **only** `App.tsx`.

### U4a — tech-ui (shell: title, settings, appearance, App)

1. **Block 5a + Stage 4 title** — `TitleScreen.tsx`: replace `useToolScan` (`:392-418`) with `useToolchainStore`; `useEffect` on mount: `if (phase === "idle") void scan()`; per-row `ScanMarch` while scanning; `✓ <version>` / `✗ not found` when done; button label `Rescan` once `phase === "done"` (`Check installs` only while `idle`); `AiToolchainModal` reads the store (`onRescan` → `scan`). Tagline (`:109`, both compositions) = `PROVIDER_SUPPORT_SENTENCE` verbatim. Doors (`:131-165`): Open folder hint `Opens a folder Cowtext already knows and scans its markdown` (stack: `A folder Cowtext already knows`); New project hint `Creates .cowtext/, context/ and starter nodes — recommended for a fresh start` (stack: `Creates .cowtext/, context/ and starter nodes`) + a `Recommended` chip (`border-accent-border bg-accent-surface text-accent-text`, blue = you); Convert existing hint `Turns the CLAUDE.md, AGENTS.md or .cursor/rules you already have into nodes — preview first` (stack: `Turns CLAUDE.md, AGENTS.md or .cursor/rules into nodes`), `title` `Scaffolds Cowtext's files alongside an existing project, then imports its context. Nothing is written until you approve.` Recents header (`:361`): `{n} of 8 kept`.
2. **Block 7** — `SettingsModal.tsx`: new section **Appearance** (between Sound and Agent): `UI scale` segmented `85% · 100% · 115% · 130%`; `UI font` select `System` / `IBM Plex Sans`; `Code font` select `JetBrains Mono` / `System monospace`; `Calm mode` and `FPS counter` rows move here (Sound keeps volume/toggles/mute). **Agent** section: first row = `PROVIDER_SUPPORT_SENTENCE`; `Hooks server` row (`:322`) value = `useHooksAddr()`; `HOOKS_ADDR` const (`:13`) deleted. `App.tsx`: startup effect applies `--ui-scale` (`uiScale / 100`), `--font-ui` (`UI_FONT_STACKS[uiFont]`), `--font-mono` (`CODE_FONT_STACKS[codeFont]`) on `document.documentElement` and re-applies on change; `zoom: var(--ui-scale)` on: title screen root, left rail, top bar, Inspector `<aside>`, Dock, and every portal root (`ContextMenu`, ToolPicker popup, modals, `ToastHost`) — **never** `.react-flow` or the Barn host (`tokens.css` gets `--ui-scale: 1` default; `index.css` gets the rule set; Dock reads `--font-mono`). `loadHooksAddr()` called beside `load()` (`:973`).
3. **Mounts + view** — `App.tsx`: `{agentWizard.open && <NewAgentDialog onClose={closeAgentWizard} />}` once; `{hooksModalOpen && root !== null && <HooksModal root={root} onClose={() => setHooksModalOpen(false)} />}` once; Inspector condition (`:851`) → `view === "canvas" || (view === "tasks" && taskSelected) || (barnView && sessionSelected)` with `surface={view === "barn" ? "barn" : view === "tasks" ? "tasks" : "canvas"}`; `onDone` (`:1140`) gains `outcome` and skips `setPendingStarterAdoptRoot` when `outcome?.graphApplied === true`; Run button title (`:505`) `Run — launches a headless Claude Code session (claude -p)`.
Gates: build + lint. Acceptance (Block 5a): title screen reaches `done` without user action; the Activity tab shows the `Toolchain scan: …` row. (Block 7): changing UI scale resizes rail, Inspector, Dock and every modal consistently; the Barn does not scale; settings persist across restart; at 130 % a rail context menu and the Inspector `?` popover align with their triggers (A-16). (P0.7): in Tasks view with nothing selected the Inspector is not mounted; selecting a task mounts it. `rg -n "<HooksModal" src` matches `App.tsx` and `ProjectWizard.tsx` only.

### U4b — tech-ui (canvas, menus, dialogs)

1. **Block 5b (menus)** — `GraphCanvas.tsx:253-282` pane menu: after `New node here…` add `New agent here…` (icon `Bot`) → `openAgentWizard({ position: <same flow position the node wizard would use> })`. `MemoryNodeCard.tsx` node menu (`:282-400`): add `New agent from this node…` → `openAgentWizard({ position: { x: node.position.x + 320, y: node.position.y }, contextNodeId: node.id })` (placed after `Open markdown`, before `Rename file…`).
2. **Stage 4 canvas** — `EmptyCanvasGuide.tsx` (new; mounted by `GraphCanvas` when `nodes.length === 0`): centred card `1 Create node → 2 Connect context → 3 Preview compiled output`, primary `Create first node` → `wizardAtCenter()` (`GraphCanvas.tsx:239`), secondary `Preview compile` disabled with `title="Add a node first"`; unmounts at ≥ 1 node.
3. **Smaller fixes** — `LensControl.tsx`: leading non-interactive label `Overlay:` (`font-pixel text-[8px] uppercase text-content-muted`, `aria-hidden`); segment titles kept. `MemoryNodeCard.tsx:646` `{node.role}` → `NODE_TYPE_BY_ROLE[node.role].label` (CSS uppercase as today) with `title={\`Node type: ${label} — ${hint}\`}`; `:497` fallback → `DEFAULT_PRIORITY`; `:426` read-order tooltip already present — keep. `AddAgentDialog.tsx` (`RunSessionDialog`): agent default = rail selection → else `lastRunAgentFile` if an agent with that `fileName` exists → else null; on a successful spawn `setLastRunAgentFile(agentFileName)`; Token ceiling (`:469-474`) becomes `<input type="number" min=0 placeholder="inherit">` — empty ⇒ inherit (link → agent default → global), `0` ⇒ unbounded, `n` ⇒ n — with hint `Effective: <formatCeiling(effective)> (from <this run | task link | agent default | global default>)`; the `cwd` effect (`:211-218`) becomes mount-only via a ref without `eslint-disable` (both warnings gone). `NewTaskDialog.tsx:236` Task type → chips `none · bug · feature · chore · docs` (stored lowercase; `none` ⇒ `""`); Status segmented already uses `STATUS_LABELS`. `TasksBoard.tsx:793-797` empty state → heading `No TASKS.md yet`, line `Each task can pin a context subgraph — Cowtext compiles only those nodes into the session.`, line `Saving the first task creates TASKS.md in this project.`, primary `Create task` (opens `NewTaskDialog`) (A-15); `:562` flat-segment copy unchanged.
Gates: build + lint. Acceptance (Block 5b): both menu items exist and open the wizard with the expected prefill (Context row names the node) · (Stage 4): the guide shows on an empty canvas with a working primary CTA and disappears at one node · `npm run lint` reports ≤ 14 warnings (the two `AddAgentDialog` warnings gone) · the Tasks empty state has one direct CTA.

### B1 — tech-barn (`src/scene/**`)

1. `SessionTicker` (`BarnScene.tsx:75-91`) → `{reads} reads · {writes} writes · {turns} turns`, `font-mono text-micro text-amber-text`, each token wrapped in a `<span title>`: `Files the agent read (hook events this session)` · `Edits and writes` · `Completed turns (Stop events)`.
2. Legend overlay (bottom-right, collapsible, default open, remembers nothing): `Cow = the agent · calves = subagents · desk lights = files being read/written` + buttons `Demo` (existing, moved into the strip) and `Connect hooks` → `useUiStore.getState().setHooksModalOpen(true)`.
3. Wide-screen fit (D-21): on mount and on host resize while `!userMoved`, `zoom = clamp(floor(min(hostW / boundsW, hostH / boundsH)), MIN_ZOOM, MAX_ZOOM)` where bounds are the scene's world layout bounds (the ones `centerCamera` uses); replaces the fixed `INITIAL_ZOOM` at `:169`; reduced-motion aware (no tween either way). No art, no sound changes.
Gates: build + lint. Acceptance: at 2560×1440 the whole barn floor is visible on open; at 1280×720 nothing clips; wheel-zoom ladder unchanged; `Connect hooks` opens the hooks modal (App mount); ticker tokens carry tooltips.

### D1 — tech-general (repo truth tooling)

1. `scripts/truth.lib.mjs` — pure functions: `parseHandlerList(libRs): string[]` · `extractTsInvokeNames(src): string[]` (regex `invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"`) · `extractGraphVersionRs(projectRs): number` / `extractGraphVersionTs(graphTs): number` · `extractCompileTargetsRs(projectRs): string[]` (variants of `pub enum CompileTarget`, lower-cased) / `extractCompileTargetsTs(graphTs): string[]` · `renderAgentsMd(claudeMd): string` (line 1 → `# AGENTS.md`; line 3 → `This file provides guidance to Codex and any AGENTS.md-reading agent when working with code in this repository. It is generated from CLAUDE.md by \`scripts/truth.mjs\` — edit CLAUDE.md, then run \`npm run truth:write\`.`; all other lines byte-identical) · `findStaleNumbers(text, live): Finding[]` · `findForbidden(text): Finding[]` · `renderTruthBlock(counts, isoDate): string` · `replaceTruthBlock(claudeMd, block): string` · `findStatusProseCounts(claudeMd): Finding[]`.
2. `scripts/truth.mjs` (Node ≥ 18, no deps; `--check` default, `--write`, `--no-cargo`). Checks, each printed as a table row with PASS/FAIL/WARN/SKIP: **T1** AGENTS.md == render(CLAUDE.md) (CRLF-normalised; first differing line reported) · **T2** every `.claude/skills/<x>/SKILL.md` has a byte-identical `.agents/skills/<x>/SKILL.md`; extra `.agents` dirs → WARN · **T3** invoke count from `generate_handler!` · **T4** every TS invoke name ∈ handler list (FAIL); handler names with no TS caller → WARN (P1 makes it FAIL) · **T5** `npx vitest run --reporter=json --outputFile=<tmp>` → `numTotalTests` / `numTotalTestSuites` · **T6** Rust: `cargo test --lib -- --list`, `--bin cowtext-cli -- --list`, `--bin cowtext-mcp -- --list` (lines ending `: test`), run from `src-tauri/`; SKIP under `--no-cargo` (A-19) · **T7** `GRAPH_VERSION` Rust == TS · **T8** compile targets Rust == TS (set equality) · **T9** stale numbers in CLAUDE.md, AGENTS.md, README.md, `docs/TERMINOLOGY.md`, `docs/TERMINOLOGY_REFERENCE.md`, `.claude/skills/*/SKILL.md`, `.agents/skills/*/SKILL.md`, `.claude/agents/*.md` — patterns `(\d+)\s+invoke commands`, `invoke commands \((\d+)\)`, `command list \((\d+)\)`, `(\d+)\s+Tauri invokes?`, `(\d+) Rust tests`, `(\d+)\s+(?:frontend\s+)?Vitest tests`, `(\d+) frontend tests`, `schema\s+\*{0,2}v(\d+)` must equal the live values (T6 values when available, else the committed block's) · **T10** forbidden strings `AGENTS.md / AGENTS.md`, `Codex -p`, `.Codex/`, `Codex.ai/code` in the T9 file set · **T11** `command` paths in `.mcp.json` and `.codex/config.toml` exist → else WARN `absent — build with \`cargo build --release --bin cowtext-mcp\` (from src-tauri/)` · **T12** `PROVIDER_SUPPORT_SENTENCE` literal present in README.md, CLAUDE.md, `docs/TERMINOLOGY.md`, `src/resources/index.ts`; identifier imported in `TitleScreen.tsx`, `SettingsModal.tsx`, `OrchestratorView.tsx`, `ProjectWizard.tsx` · **T13** CLAUDE.md `## Status` prose outside the truth block contains none of `/\b\d+\s*(?:→\s*\d+\s*)?(?:Rust|Vitest|frontend)\s+(?:Vitest\s+)?tests?\b/i`, `/\binvoke\b[^.\n]{0,12}\d+/i`, `/\b\d+\s+invokes?\b/i`, `/\bschema\s+v\d+/i` · **T14** the markers `<!-- truth:begin -->` / `<!-- truth:end -->` exist in CLAUDE.md. Exit 1 on any FAIL.
   `--write`: (1) rewrite the truth block in CLAUDE.md — inserted immediately before the line `Update this line at the end of every session.` when the markers are absent — as: `<!-- truth:begin -->` ⏎ `Live counts (generated YYYY-MM-DD by \`scripts/truth.mjs\` — do not edit by hand; run \`npm run truth:write\`): invoke **N** · Rust tests **N** (lib N · cli N · mcp N) · Vitest **N** tests / **N** files · graph schema **vN** · compile targets claude, agents, cursor, copilot, gemini · release gate: \`docs/tasks/ROADMAP.md\` §Release gate + \`docs/testing/GOLDEN_PATH_MANUAL.md\`.` ⏎ `<!-- truth:end -->` (under `--no-cargo` the Rust numbers are carried over from the existing block); (2) write AGENTS.md from the updated CLAUDE.md; (3) copy `.claude/skills/*/SKILL.md` → `.agents/skills/*/SKILL.md`. Nothing else is ever written.
3. `src/truth/truth.test.ts` — inline fixtures for every `truth.lib.mjs` function (handler list with trailing entry and no comma; AGENTS.md render keeps line 2 blank and line 4+ identical; stale-number detection hits `(76)` and passes `(78)`; forbidden strings; status-prose patterns hit `Invoke **75→76**` and `785 Rust tests`, pass prose without numbers).
4. `package.json` scripts: `"truth": "node scripts/truth.mjs --check"`, `"truth:write": "node scripts/truth.mjs --write"`.
5. `.claude/scripts/docs-guard.ps1` — before the generic denial (`:64`): `^AGENTS\.md$` → `AGENTS.md is generated from CLAUDE.md by scripts/truth.mjs. Edit CLAUDE.md, then run 'npm run truth:write'.`; `^\.agents/skills/` → `.agents/skills/ mirrors .claude/skills/ and is written by scripts/truth.mjs. Edit the .claude/skills/ copy, then run 'npm run truth:write'.` Root allow-list unchanged.
6. `.codex/config.toml` — three `#` comment lines at the top (matrix §3). `README.md` — the sentence verbatim + a `Compile targets` line naming all five files.
7. Run `npm run truth:write` then `npm run truth --no-cargo` at the end of the lane (AGENTS.md and `.agents/skills` are written by the script only; T13 may still FAIL until PM rewrites the Status prose — report it, do not edit CLAUDE.md prose).
Gates: `npm run test` (the new test file), `npm run lint`, `npm run truth --no-cargo` (T13 excepted until PM). Acceptance (P0.2/3/5/9): T1, T2, T10 PASS after `--write`; `rg -n "AGENTS.md / AGENTS.md|Codex -p|\.Codex/" AGENTS.md .agents` → 0.

### T — tester (after all lanes)

Run from the repo root: `npm run build`, `npm run lint`, `npm run test`; from `src-tauri/`: `cargo test --all-targets`, `cargo clippy --all-targets -- -D warnings`; then `npm run truth --no-cargo`. Invoke contract: handler list = 78, TS names ⊂ list, no `Stage-0 stub`. Mount greps from §4.15 (`<NewAgentDialog` only in App.tsx; `<HooksModal` in App.tsx + ProjectWizard.tsx; `useToolchainStore` in TitleScreen; `loadHooksAddr` in App.tsx; `EmptyCanvasGuide` imported by GraphCanvas; `BranchPicker` imported by both wizards; `ModelPicker` imported by NewAgentDialog + AgentEditor). Write `docs/testing/GOLDEN_PATH_MANUAL.md` (manual-format skill; 25–40 risk-based scenarios covering the 16 points of Stage 5; disposable project under `%TEMP%`; never a real project). Adversarial pass per lane (Windows paths, CRLF, races, trust boundaries, empty states), findings routed to owning lanes by file:line.

### PM — project-manager (final)

ACTIVITY_LOG (session entry; hook-row bloat as P1), ROSTER, TASKS, BUGS (close line 35 per A-7; add found), ROADMAP (`## Release gate` section = the single source of release-gate truth: golden-path walk + acceptance walks), TERMINOLOGY.md (invoke table → 78: `hooks_addr` under hooks, `skills_materialize` under agents; modules `src/store/toolchain.ts`, `src/store/ui.ts`, `src/resources/`; key terms **Built-in skill** (virtual / materialized / modified), **Provider support sentence**; **≤ 120 lines — it is 123 today, trim**), TERMINOLOGY_REFERENCE, CLAUDE.md: hard rule → `All project documentation \`.md\` lives in \`docs/\`. Only \`CLAUDE.md\`, \`README.md\` and the generated \`AGENTS.md\` (written by \`npm run truth:write\`, never by hand) stay at the repo root. …`; Status prose rewritten **without counts** (history with counts moves to ROADMAP's sprint log; the truth block carries the numbers); `.claude/skills/cowtext-terminology/SKILL.md` and `task-format/SKILL.md` updated; **last**: `npm run truth:write` then `npm run truth` (must PASS, T6 included).

---

## 7. Cross-lane rules

1. Zones never overlap (§5). Needing a foreign file ⇒ **STOP and report** the file, line and reason; the dispatcher re-assigns or the owning lane makes the change.
2. No snapshot/whole-file restores, ever. Never `git checkout`/`restore`/`reset` anything. The dirty worktree (`docs/INPUT_PROMPT.md`, `docs/fleet/ACTIVITY_LOG.md`, `.agents/`, `.codex/`, `AGENTS.md`, `docs/design/COMPETITIVE_ANALYSIS_MUNDER_DIFFLIN.md`) stays as is except where a lane is explicitly assigned (D1: AGENTS.md + `.agents/skills` via the script only; `.codex/config.toml` comments).
3. During the parallel round a foreign compile error is **reported, not fixed**. Your own gates are `build` + `lint` for U-lanes, `cargo test --all-targets` + clippy for R-lanes; a red gate caused by another lane's file is a report line, not a licence to edit.
4. Invoke names are byte-exact and live only in the api files named in §3 (`git/api.ts`, `fs/api.ts`, `agents/api.ts`, `project/toolchain.ts`). No new `invoke(` call sites elsewhere.
5. Every control in a modal/panel either appears in the compiled preview or carries `LocalOnlyBadge`. No third category. New controls this round: Node type help (informational, no data — exempt), Influence (agent: local-only; memory: disabled, informational), Position (local-only), provider chip for non-Anthropic (local-only), Include-in-compile toggle (produces a file — compiled), Token ceiling input (session parameter, not a file — `LocalOnlyBadge` with hint `Applies to this session only`).
6. Nothing is written to disk before Create / Save / Compile / Run approval. New writers this round and their gates: `git_init(commit)` — wizard Create or GitWizard button; `skills_materialize` — CompileModal after approval or the Reset confirm strip; `presetApply` — wizard Create. Previews (`buildProjectGraph`, `assemblePreview`, `compilePreview`) are in-memory.
7. The canonical provider sentence is used verbatim: **"Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code."** — TS via `PROVIDER_SUPPORT_SENTENCE`, markdown as the literal. No paraphrase, no "multi-provider" claims anywhere.
8. No bare `===` and no bare `.split("/")` on a `.md` path in `src/` — use `sameRelPath`/`canonPath` (`graph.ts:83-93`). Auditor greps for both.
9. `graph.json` stays v5; `resolveLoad` semantics untouched; Barn art untouched; no new dependencies; no new fonts.
10. Rust ↔ TS mirror pairs in this contract (`GitStatus`, `GitInitResult`, `AiTool`, `SkillInput`/`SkillsMaterialized`) are audited against **§3's text**, never against each other (memory class 9 corollary).

---

## 8. Stage 0 manifest (S0, in this order)

| # | File | Action | Gate after step |
|---|---|---|---|
| 1 | `src/agents/types.ts` | add `ProviderId`, `PROVIDER_IDS` | — |
| 2 | `src/resources/models.json`, `agent-presets.json`, `stacks.json`, `principles.json`, `skills/task-format/SKILL.md`, `index.ts` | create per §4.9 | — |
| 3 | `src/agents/modelCatalog.ts` | add `providerForModel` | — |
| 4 | `src/store/settings.ts` | §4.1 (export `mergeSettings`) | — |
| 5 | `src/store/events.ts` | §4.4 | — |
| 6 | `src/fs/api.ts` | `hooksAddr()` | — |
| 7 | `src/store/project.ts` | §4.5 | — |
| 8 | `src/project/toolchain.ts` + `src/project/TitleScreen.tsx:558-565` | `elapsedMs` + placeholder `0` | — |
| 9 | `src/store/toolchain.ts` | create §4.2 | — |
| 10 | `src/store/ui.ts` | create §4.3 | — |
| 11 | `src/store/agents.ts` | §4.6 (`DEFAULT_PRIORITY`, `provider`, `builtinInclude`, sidecar read/write, `normalizeSkillContent`) | — |
| 12 | `src/agents/builtinSkills.ts` | create §4.6 | — |
| 13 | `src/agents/api.ts` | `SkillInput`, `SkillsMaterialized`, `skillsMaterialize` | — |
| 14 | `src/git/types.ts`, `src/git/api.ts`, `src/git/GitWizard.tsx:267-275` | §3.1, §3.2, A-12 | — |
| 15 | `src/store/graph.ts` | `adoptFile` §4.7 | — |
| 16 | `src/store/tasks.ts` | §4.8 | — |
| 17 | `src/wizard/projectGraph.ts` | create §4.11 | — |
| 18 | `src/ui/LocalOnlyBadge.tsx` | create §4.12 | — |
| 19 | `src/inspector/Inspector.tsx:2689`, `src/project/ProjectWizard.tsx:238` | prop types §4.13 | — |
| 20 | `src/tasks/NewSkillDialog.tsx:9,101-114` then delete `src/tasks/taskFormatSkill.ts` | A-18 | `npm run build` |
| 21 | `src/resources/resources.test.ts`, `src/wizard/projectGraph.test.ts`, `src/wizard/roles.test.ts`, `src/store/settings.test.ts`, `src/store/agents.test.ts` (cases) | tests | `npm run test` |
| 22 | — | `npm run build && npm run lint && npm run test` all green; report counts | **exit gate** |

S0 writes no Rust: `lib.rs` is single-owner (R2) and no lane needs a Stage-0 Rust stub — R1 changes a signature, R2 adds both commands. At S0 exit the TS wrappers for §3.3–§3.5 exist ahead of their Rust; that is fine for the gates (invoke is stringly typed) and the tester exercises them only after integration.

---

## 9. Audit plan (tech-lead, after landing → `docs/design/WO15_AUDIT.md`)

1. **Mirrors vs this text, never vs twins**: `GitStatus`/`GitInitResult` (§3.1–3.2) field by field in `git.rs` and `git/types.ts`; `AiTool.elapsed_ms`/`elapsedMs`; `SkillInput`/`SkillsMaterialized`; sidecar §3.8 against both `parseMetaJson` and `serializeMeta`. The WO13 lesson: a pair that agrees with itself proves one author, not correctness.
2. **The exception-list lesson** (WO13 §18.1 ×3): every enumerated list in this contract is checked against the sections that change the behaviour it gates — §3.7's final handler list vs every `invoke(` in `src/`; §4.1's six fields vs `DEFAULT_SETTINGS`, `mergeSettings`, `persistNow` **and** the Appearance UI; §4.15's consumer map vs actual imports; §5's grid vs `git status --short` (any file outside the grid is a finding); T9's pattern set vs a manual read of every count in the scanned files.
3. **Writers audit** (memory classes 1, 8, 9): every new writer (§7.6) — who else writes the same path, under which lock, and whether a store debounce can clobber it (`skills_materialize` vs `skill_save`; `git_init`'s `.gitignore` vs `gitignore_write`; `presetApply` vs `flushSave` on the freshly opened project).
4. **Mounts** (class 5): §4.15 greps; anything exported and imported by nothing is a finding.
5. **Copy truth**: every surface in the matrix §5 carries the sentence verbatim; no surface says "multi-provider" for Assemble/Run/hooks; `.codex`/AGENTS.md truth per matrix §3; `rg -n "Codex -p|\.Codex/|AGENTS\.md / AGENTS\.md"` across the repo (excluding `docs/_archive`) → 0.
6. **Path comparisons** (§7.8): `rg -n '\.split\("/"\)' src` and bare `===` on `filePath`/`relPath` operands.
7. **Gates read sentence by sentence** (class 10): each lane's tests vs its acceptance bullets — what is *not* asserted.
8. **Live run**: dispatcher screenshots for: title (both compositions, scanned), empty canvas guide, Inspector with Influence visible at 1080p, Advanced collapsed/expanded, agent wizard with presets + provider chips (one dimmed), Skills rail both groups, CompileModal with a skill row, wizard Principles/Stack/Git steps + result line, Settings Appearance at 85 % and 130 % with an open context menu, Tasks empty state, Orchestrator empty state, Barn legend + fit at wide aspect.

### P0 acceptance criteria — proof per row

| # | Criterion | Proof |
|---|---|---|
| 1 | Title → Node → Edge → Compile preview without instruction | EmptyCanvasGuide CTA + door copy (U4a/U4b); golden-path scenarios 1–6 walked by the tester with no doc open |
| 2 | No UI/context file promises an unsupported Codex runtime | truth T10 + T12; matrix §2 classification; auditor item 5 |
| 3 | `AGENTS.md / AGENTS.md` and similar duplicates gone | truth T1 + T10 PASS after `--write` |
| 4 | Compile multi-target vs Claude runtime separated in plain language | the sentence on all matrix §5 surfaces (T12 + manual) |
| 5 | `.codex` honest | matrix §3 disposition + `.codex/config.toml` comment + T11 WARN; nothing deleted without Marty |
| 6 | Canvas, Tasks, Agents empty states have direct next actions | `Create first node` (U4b), `Create task` (U4b), `Create agent` (U3 ×2) — screenshots |
| 7 | Inspector not irrelevantly open in Tasks | `App.tsx` condition (U4a) — screenshot of Tasks view with no selection |
| 8 | Golden-path manual with 25–40 risk-based scenarios | `docs/testing/GOLDEN_PATH_MANUAL.md` (T) |
| 9 | Invoke/test counts match live gates | truth block in CLAUDE.md written by `truth:write`; `npm run truth` PASS incl. T6 at PM close-out |
| 10 | No user file written without preview/approval | §7.6 writer list; tester watches the disposable project folder during wizard/compile/skills flows |
| 11 | No new TS errors / Rust warnings / ESLint errors | tester gates: `tsc` clean, clippy `-D warnings`, ESLint 0 errors (warnings ≤ 14) |
| 12 | All mandatory gates pass | tester's five gates + `npm run truth` + dispatcher live run |

---

## 10. Needs Marty (work proceeds on the stated assumption)

1. Port 4923 confirmed as canon (8787 dropped) — D-2.
2. `.codex/hooks.json` and `.codex/agents/*.toml` — kept, marked unsupported/dev-only; delete?
3. Non-Anthropic model ids in `models.json` (§4.9) — review.
4. UI scale excludes canvas node cards (D-7, A-16) — accept, or schedule a geometry-aware canvas scale.
5. Task status ids unchanged on disk, labels only (D-6) — confirm; task type chips replace free text in the dialog (free text already on disk still shows).
6. Built-in skill placement after materialisation per D-5.
7. `git_init` with a missing identity leaves the folder untouched (A-4) rather than initialising and erroring — confirm.
