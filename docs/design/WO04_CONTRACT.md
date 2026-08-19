# WO04 Contract — L1 Completion (frozen)

**Work order 04** · drafted 2026-08-19 · dispatcher: `/ultracode` · author: tech-lead

**Goal:** finish L1. After WO04 the context graph is *hierarchy-aware*, *link-safe on
Windows*, *round-trippable*, *previewable byte-for-byte*, *profile-able*, and
*CI-enforced*. This closes the moat layer; L2/L3/L4 build on it.

**Precondition:** WO03 landed and committed — graph v3 (12 roles / 7 edge kinds /
tags+owner+meta / edge color), 5 compile targets, `cowtext-cli`, `import_scan` /
`import_apply`, `lint_run`, invoke total **54**. Everything WO03 froze is treated
here as landed reality. Tree clean at dispatch.

**Frozen once lanes start.** A lane that finds this contract wrong stops, states the
failing assumption, and reports (WO02 §9 deviation protocol, unchanged). Improvising
across a seam is an automatic reject.

---

## 1. Must-NOT-break (read first, every lane)

Carried forward from WO03 — still binding:

1. **Byte-identity frontmatter** — `frontmatter.rs` / `agents.rs` are OUT of every
   lane's zone; nobody touches them.
2. **Deterministic compile** — an unedited graph produces byte-identical output for
   every target, run to run. Golden fixtures required for the 6th target.
3. **Never-clobber** — preset apply, `import_apply` and (new) `link_apply` never
   overwrite existing user content.
4. **Preset round-trip** — presets auto-upgrade on read/apply and re-save cleanly.
5. **Write allowlist + GENERATED header** — extended for the skill shape, never
   weakened; `compile_write` still refuses headerless content.
6. **Invoke-contract byte-exactness** — `generate_handler!`, `docs/TERMINOLOGY.md`
   and the `cowtext-terminology` skill agree, always, in the same commit.
7. **Errors XOR files** — `compile_preview` still returns errors or files, never both.

New in WO04, equally binding:

8. **No write outside the project root. Ever.** WO04 introduces exactly **two**
   read-only exceptions, both frozen below and both narrow: `<home>/.claude/CLAUDE.md`
   (hierarchy global layer) and the git directory named by a `.git` *file* (linked
   worktrees). No general "read outside root" primitive is added, and nothing outside
   the root is ever written.
9. **Frontmatter has one writer.** `frontmatter.rs` / `agents.rs` are the only code
   that writes bytes between `---` fences of `.claude/skills/*/SKILL.md`. The skill
   compile target writes body-block bytes only (§4.3).
10. **Never leave a broken link.** Every rung of the link ladder is verify-then-commit:
    the artifact is read back and compared to the master before the rung is accepted;
    a failed rung is deleted before falling through (§4.2).
11. **Sidecar over bump.** `GRAPH_VERSION` **stays 3** in WO04. Standing rule:
    per-project state that does not change compile output goes into a
    `.cowtext/<name>.json` sidecar with its own `version`, never into `graph.json`.
    Only data that changes compile output earns a graph bump.
12. **The GENERATED header string is frozen.** No hash, no branch, no timestamp. A
    header change invalidates every golden file and every user's compiled tree. Content
    hashing = FEATURES 4.8 tamper detection = WO05.
13. **`compile_preview` and `context_resolve` are read-only.** Neither touches disk
    except to read. The preview path never acquires write powers.
14. **`graph.json` shape is untouched.** No node field, no edge field, no role, no
    edge kind added. `compileTargets` gains one tolerant-parsed value (`skill`) —
    per WO03's own precedent for copilot/gemini, an additive default-off enum value
    is **not** a schema change.

**Explicitly out of scope:** `src/scene/**` (zero barn lanes — L1-first rule),
`sessions.rs`, `tasks.rs`, `hooks.rs` / `hooks_server.rs`, `watcher.rs`, `lint.rs`,
`assemble.rs`, `src/canvas/**`, `src/agents/**`, `src/wizard/**`.

---

## 2. Scope calls (decisions a builder could otherwise get wrong)

| # | Ambiguity | Decision | Rationale (one line) |
|---|---|---|---|
| D1 | Junction in the symlink ladder | **Junctions are not in the file ladder.** File rungs are symlink → hardlink → copy | `mklink /J` targets directories only; a junction cannot point at a file. WO04 links files only. |
| D2 | Which hierarchy does the simulator model | **`CLAUDE.md` only** (`<home>/.claude/CLAUDE.md` → root → each ancestor dir) | It models what Claude Code loads; AGENTS.md nesting is already emitted by the agents adapter. |
| D3 | Who writes SKILL.md frontmatter | **`agents.rs`, always.** The skill target writes only the managed body block | Preserves must-not-break #1 with zero coordination cost. |
| D4 | Where loadouts persist | **`.cowtext/loadouts.json` sidecar v1**, frontend-owned shape | Loadouts don't change compile output; a v4 bump two WOs after v3 for view state is unjustifiable. |
| D5 | Does applying a loadout mutate the graph | **Yes — apply writes `pinned` / `readOrder` into `graph.json`** | An invisible overlay would make `cowtext-cli compile --check` disagree with the app, which is the one thing the CLI exists to prevent. |
| D6 | Branch mismatch detection | **Drift = in-memory `compile_preview` vs disk**, not a header hash | Adding a hash to the header breaks #12 and every golden file. |
| D7 | Starter packs storage | **TS module `src/preset/starterPacks.ts`**, no new invoke | The preset format is already frontend-owned (Rust never re-serializes it). |
| D8 | Resolved preview for `cursor` / `skill` | **Rejected with an error message** | Those targets are sets of conditional fragments, not one context the agent sees at once. |
| D9 | Loadouts overriding `compileTargets` | **No.** Pinned set + readOrder only | Multiplying compile paths per profile is how a compiler stops being trustworthy. |
| D10 | Global `~/.claude/CLAUDE.md` editing | **Read-only in WO04** — a Global layer viewer, not a manager | FEATURES 1.10 is absorbed as *scope visibility*; writing outside the root is must-not-break #8. |
| D11 | `packed-refs` / full git plumbing | **Not parsed.** Loose ref only; `commit: null` if absent | The branch name drives the UI; the commit is decoration. |
| D12 | Unknown node ids inside a loadout | **Tolerated on apply, never auto-pruned** | Branch switches make ids come and go; auto-pruning would eat a loadout on checkout. |

---

## 3. New invoke commands — 54 → **62**

Byte-exact snake_case. camelCase in JS ⇄ snake_case in Rust. Adding one = three
coordinated edits (fn · `generate_handler!` entry · TS `invoke` name).

| # | Command | Args | Returns | Lane |
|---|---|---|---|---|
| 55 | `hierarchy_resolve` | `root: String, relPath: String` (+ `app: AppHandle`) | `HierarchyResolution` | R1 |
| 56 | `context_resolve` | `root: String, graphJson: String, target: String, relPath: Option<String>` | `ResolvedContext` | R1 |
| 57 | `link_status` | `root: String` | `Vec<LinkReport>` | R2 |
| 58 | `link_apply` | `root: String, masterRelPath: String, mirrorRelPath: String, allowCopy: bool` | `LinkReport` | R2 |
| 59 | `link_remove` | `root: String, mirrorRelPath: String` | `LinkReport` | R2 |
| 60 | `loadout_read` | `root: String` | `Option<String>` (raw JSON, `None` = no sidecar) | R4 |
| 61 | `loadout_write` | `root: String, content: String` | `()` | R4 |
| 62 | `git_head_watch` | `root: String` (+ `app`, `state`) | `GitHead` | R4 |

**Total after WO04: 62.** Not added, deliberately: no drift-check command (the
frontend calls `compile_preview` and reads `unchanged`), no starter-pack command
(D7), no assemble-token command (`src/store/tokens.ts` already has the estimator).

### 3.1 `lib.rs` append protocol (shared region — the only shared file)

`src-tauri/src/lib.rs` is **shared-append**. Three regions, all append-only:

- **`mod` block** — alphabetical. Final state: `agents, assemble, compile, frontmatter,
  git, handoff, hierarchy, hooks, hooks_server, import, lint, links, loadouts, preset,
  project, resolve, sessions, settings, tasks, watcher, worktree`.
- **`generate_handler!` list** — appended **at the end, in command-number order 55→62**,
  each line ending with a comma. **R1 lands first and adds a trailing comma to the
  current last entry (`sessions::agent_session_list`)**; from then on every lane appends
  `module::command,` and no lane ever has to move a comma. (`generate_handler!` accepts
  a trailing comma.)
- **`setup` block** — one new line, R4 only:
  `app.manage(git::GitState::default());` immediately after the `SessionRegistry` line.

R3 adds **no** command and therefore does not touch `lib.rs` at all.

### 3.2 Wire shapes

```rust
// hierarchy.rs — ascending precedence: layers[0] = global, last = deepest directory.
pub struct HierarchyResolution {
    pub rel_path: String,               // normalized echo of the queried path
    pub layers: Vec<HierarchyLayer>,    // absent layers are INCLUDED with exists:false
    pub winner_index: Option<usize>,    // index of the deepest existing layer
    pub total_bytes: u64,
    pub total_tokens: u64,
    pub global_content: Option<String>, // Some iff the global file exists and is < 256 KiB
}
pub struct HierarchyLayer {
    pub scope: String,             // "global" | "project" | "directory"
    pub label: String,             // "~/.claude/CLAUDE.md" | forward-slash rel path
    pub rel_path: Option<String>,  // None for the global layer (outside the root)
    pub exists: bool,
    pub bytes: u64,
    pub tokens: u64,               // ceil(bytes / 4)
    pub generated: bool,           // GENERATED header present
    pub depth: u32,                // 0 = global, 1 = project root, 2+ = directory depth
}

// resolve.rs
pub struct ResolvedContext {
    pub target: String,
    pub rel_path: String,       // entry file
    pub content: String,        // fully expanded bytes — what the agent actually sees
    pub bytes: u64,
    pub tokens: u64,
    pub sources: Vec<ResolvedSource>,  // every contributing file, in inclusion order
    pub warnings: Vec<String>,
    pub truncated: bool,
}
pub struct ResolvedSource { pub rel_path: String, pub depth: u32, pub bytes: u64, pub tokens: u64, pub included: bool }

// links.rs
pub struct LinkReport {
    pub master_rel_path: String,
    pub mirror_rel_path: String,
    pub mode: String,        // "symlink" | "hardlink" | "copy" | "none"
    pub managed: bool,       // present in .cowtext/links.json
    pub healthy: bool,       // mechanism intact AND mirror bytes == master bytes
    pub degraded: bool,      // a lower rung than requested was used
    pub same_volume: bool,
    pub detail: String,      // always non-empty; this is the sentence the UI shows
}

// git.rs
pub struct GitHead { pub branch: Option<String>, pub commit: Option<String>,
                     pub detached: bool, pub is_repo: bool, pub ts: u64 }
```

**Token formula is frozen and shared:** `tokens = ceil(bytes / 4)` over UTF-8 bytes —
byte-identical to `tokensForBytes` in `src/store/tokens.ts`. Rust and TS must never
disagree on a displayed number.

### 3.3 Events — 4 → **5**

| Event | Payload | Flow |
|---|---|---|
| `git://head` **(NEW)** | `GitHead` | `git.rs` notify watch on the resolved git dir (non-recursive, filtered to `HEAD`, 200 ms debounce) → emit → `src/store/git.ts` → graph reload + drift check → branch chip |

Why a new event rather than reusing `fs://change`: `fs://change` feeds
`useProjectStore.applyFsChange` and the lens machinery, which assume `.md` project
files. Pushing `.git/HEAD` through that seam would be a silent type lie. Emission is
**edge-triggered**: only when the payload differs from the last emitted one, so a
checkout back to the same branch does not re-fire.

`barn://event`, `assemble://status`, `fs://change`, `agent://event` are untouched.

### 3.4 Data model

`graph.json` — **unchanged**, `version` stays **3** (must-not-break #14).

Two new sidecars, each versioned independently:

```jsonc
// .cowtext/loadouts.json  — v1, FRONTEND-owned shape (Rust validates + writes atomically)
{ "kind": "cowtext-loadouts", "version": 1, "activeId": "l-a1b2c3",
  "loadouts": [ { "id": "l-a1b2c3", "name": "Frontend work", "note": "",
                  "pinned": ["n-1","n-7"], "readOrder": { "n-1": 0, "n-7": 10 },
                  "capturedAt": "2026-08-20T09:00:00Z" } ] }

// .cowtext/links.json — v1, RUST-owned (it records what Rust did to the filesystem)
{ "kind": "cowtext-links", "version": 1,
  "links": [ { "master": "AGENTS.md", "mirror": "CLAUDE.md",
               "mode": "hardlink", "appliedAt": "2026-08-20T09:00:00Z" } ] }
```

Ownership rule, frozen: **the side that owns the format writes the file.** Loadouts are
user data the UI edits → frontend serializes, `loadout_write` validates
(`kind`/`version`/`loadouts` is an array) and writes atomically, exactly like
`agents_meta_write`. Links record filesystem mechanism state → Rust owns them end to end.

Both sidecars serialize deterministically: sorted keys, sorted arrays (`pinned`,
`links` by mirror path), LF, trailing newline.

---

## 4. Feature specs (frozen)

### 4.1 Hierarchy simulator (R1 · U1)

- Pure core `resolve_hierarchy(root: &Path, global: Option<&Path>, rel: &str)`; the
  `#[tauri::command]` is a thin wrapper supplying `app.path().home_dir()`. Tests inject
  `global` — no test may depend on the machine's real home.
- Layer enumeration for `rel`: global · project root · every ancestor directory of
  `rel` from root downward · `rel`'s own directory. Absent layers are returned with
  `exists: false` — the simulator must show empty slots, that is the whole point.
- **Nearest-file-wins** = `winner_index` is the last layer with `exists: true`. Layers
  are additive in ascending precedence; where two layers conflict, the deepest is the
  effective one. The UI renders a stack with the winner marked.
- `rel` resolves through `resolve_within_root`; more than 32 path components → `Err`.
- `global_content` is the single sanctioned out-of-root read. It is capped at 256 KiB
  and returned inline precisely so no general out-of-root read primitive is needed.
- No capability change is expected (`app.path()` from Rust does not traverse the
  capability system). A runtime rejection is a deviation report, not a silent edit of
  `capabilities/default.json`.

### 4.2 Windows-safe link manager (R2 · U3)

**Allowlist.** Master and mirror must each be exactly one of `CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`, `.github/copilot-instructions.md`, and must differ. Anything else → `Err`.
This is a compile-output mirror tool, not a general link primitive.

**Ladder (files, Windows-first).** Requested top-down, each rung verify-then-commit:

| Rung | Call | Fails when | Then |
|---|---|---|---|
| 1 symlink | `std::os::windows::fs::symlink_file` (`unix::fs::symlink` elsewhere) | No Developer Mode / no `SeCreateSymbolicLinkPrivilege` → **os error 1314** | fall to 2 |
| 2 hardlink | `std::fs::hard_link` | Different volume (**os error 17**), or FAT32/exFAT | fall to 3 |
| 3 copy | `write_atomic(mirror, master_bytes)` | — | `mode:"copy"`, `degraded:true` |

Rung 3 is taken **only** when `allowCopy` is true; with `allowCopy:false` the command
returns `Err` naming both prior failures so the UI can ask before degrading.

**Verify-then-commit.** After creating any rung: re-read the mirror, compare bytes to
master, and for a symlink additionally `fs::read_link` + `canonicalize` and assert the
target is inside the canonical root. On any failure the created artifact is **removed**
and the ladder falls through. `link_apply` never returns `Ok` with a mirror that does
not currently read back as the master's bytes.

**Traps that must be handled explicitly:**

- A **dangling symlink** makes `Path::exists()` return `false` — `write_atomic`'s
  existence check would miss it and `fs::rename` would fail. Always probe with
  `fs::symlink_metadata`, never `metadata`, and remove any pre-existing symlink at the
  mirror path before creating a new one.
- `write_atomic` is temp + remove + rename. Over a **symlink mirror** it deletes the
  link and leaves a real file. Over a **hardlink master** it replaces the directory
  entry with a new inode, severing the pair and leaving the mirror silently stale. Both
  are detected by `link_status` (intent from the sidecar, health from a byte compare)
  and repaired by re-running `link_apply`.
- **Never-clobber:** if the mirror exists as a regular file that is neither
  byte-identical to master nor carrying the GENERATED header, `link_apply` refuses and
  leaves the file untouched. WO04 performs no automatic backup; replacing a
  hand-written mirror is the user's explicit action.
- **Symlink targets are relative** (computed mirror-dir → master), never absolute — an
  absolute target breaks the moment the project folder moves.
- **Accepted risk, stated in `detail`:** git stores a symlink as a mode-120000 blob;
  on a machine without `core.symlinks` it checks out as a short text file. The report's
  `detail` sentence must say so. Cowtext does not edit `.gitignore` in WO04.
- **Known limitation, ratified in advance:** Rust std exposes no stable API for NTFS
  link counts (`MetadataExt::number_of_links` is unstable; `GetFileInformationByHandle`
  needs a new crate, which the fixed stack forbids). A severed hardlink is therefore
  detected by content divergence, and a same-content copy may report as a healthy
  hardlink. Re-applying repairs the mechanism either way. Do not add a crate for this.

`link_remove` materializes an **independent copy** of the current bytes at the mirror
path before dropping the sidecar entry — removing a link must never remove the user's
file. If the master is gone, the dangling link is deleted and nothing is left behind.

**Cross-lane seam (frozen):** `src/store/links.ts` (U3) exports
`reconcileLinks(root: string): Promise<LinkReport[]>`; `CompileModal` (U1) calls it once
after a successful `compile_write` and surfaces any `healthy:false` result. U3 lands
before U1 is gated.

### 4.3 SKILL.md compile target (R3 · U1)

Sixth `compileTargets` value: **`"skill"`**, off by default, tolerant-parsed
(`TargetIn` already has `#[serde(other)] Unknown`), no schema bump.

- A node with role `skill` whose `filePath` matches `.claude/skills/<name>/SKILL.md`
  emits a **managed body block** delimited by the existing `AGENT_BLOCK_START` /
  `AGENT_BLOCK_END` markers, merged by the existing `merge_agent_block`. Content is the
  node's outgoing `imports`/`references` targets as `@path` lines in `(readOrder, id)`
  order — the same rule the agent block already uses.
- **compile never writes frontmatter and never creates the file.** A `skill` node whose
  file is missing already fails the existing `MissingFile` validation; the fix is
  `skill_create`. A `skill`-role node outside `.claude/skills/*/SKILL.md` is silently
  not a skill output — exactly how `is_agent_node_file` already behaves for agents.
- Frontmatter alignment (node title/brief → skill `name`/`description`) is offered by
  the UI as a one-click call to the **existing** `skill_save` command. Compile proposes;
  `agents.rs` writes.
- `classify_output` gains a third shape: `[".claude", "skills", name, "SKILL.md"]` →
  `Some(true)` (surgical/agent-style, markers required instead of the GENERATED header),
  one directory level only, no nesting. `compile_write`'s marker check already covers it.
- Unlike the agent block (ungated, unchanged), the skill block is **gated on the
  `skill` target** so users opt in.

### 4.4 Full round-trip import (R3)

`import_scan` / `import_apply` signatures are **frozen from WO03**. WO04 extends
coverage only:

- Parse back `.github/copilot-instructions.md`, `GEMINI.md`, and `.cursor/rules/*.mdc`
  (frontmatter-aware: `alwaysApply`, `globs` → pinned / `conditional` edge condition).
- **Managed-block detection**: a file carrying the GENERATED header, or a region between
  `AGENT_BLOCK_START`/`AGENT_BLOCK_END`, reports as *already managed* and proposes **no**
  nodes for the managed span. Hand-written content outside a managed block in the same
  file is still proposed.
- Changeset items gain `managed: bool` (additive wire field).
- Round-trip invariant, gated: compile a fixture graph to all six targets, run
  `import_scan` on the result, and get **zero proposed nodes** and one
  "already managed" warning per emitted file.

### 4.5 Resolved-context preview (R1 · U1)

- Entry bytes come from **compile's in-memory render**, not from disk — the preview
  shows the graph's truth before anything is written.
- Expansion: a line whose trimmed form is exactly `@<path>` is replaced by that file's
  bytes, recursively. Nothing else expands — no `@` inside prose, no markdown links.
- **Dedup:** each file is inlined at most once per resolution; a repeat emits
  `<!-- cowtext: already included: <path> -->`. A path already on the inclusion stack
  emits `<!-- cowtext: cycle, already included: <path> -->` plus a warning.
- Caps: depth 16, total 4 MiB → `truncated: true` + warning, inlining stops.
- A missing/unreadable include leaves the `@path` line verbatim and adds a warning —
  never fails the whole preview.
- Graph validation failure → `Err("Graph has validation errors — fix them in the
  Compile preview first")`. The errors-XOR-files invariant stays confined to
  `compile_preview`.
- **R1 must not edit `compile.rs`.** It consumes the tauri-free core WO03 Lane C
  extracted. If that surface is insufficient, R1 stops and reports; tech-lead hands the
  edit to R3.

### 4.6 Token-cost counts (U1)

- **Compile side**: per-file `≈ tokens` / lines already exist from WO01 Block B. U1 adds
  the per-target and grand total in the modal header and the resolved-preview total.
  Do not duplicate what is already rendered.
- **Assemble side**: an `≈ N tokens` line before Assemble / Refine / Summarize, counting
  **exactly the bytes `assemble.rs` sends** — U1 reads the prompt builder and counts what
  it actually composes (`assemble.rs` is read-only reference, not U1's zone) — plus a
  before → after token delta on the resulting file.
- All numbers use `tokensForBytes` / `compiledTokens`; the "≈" prefix stays (chars/4
  heuristic, per `tokens.ts`'s existing header comment).

### 4.7 Context loadouts (R4 · U2)

- Persistence per §3.4. `loadout_read` / `loadout_write` mirror `read_graph` /
  `write_graph` exactly: frontend owns serialization, Rust validates the envelope.
- **Capture** = snapshot the current `pinned` set + `readOrder` map. **Apply** = write
  them back into the graph (D5) in **one undoable step** via a single new store action:
  ```ts
  // src/store/graph.ts — the ONLY change to this file in WO04.
  applyPinSet: (pinned: string[], readOrder: Record<string, number>) => void;
  ```
  One undo snapshot, one save schedule, no persisted-shape change,
  `GRAPH_VERSION` stays 3.
- Ids not present in the graph are skipped on apply and **preserved** in the file (D12).
- The UI shows "modified" when the live graph no longer matches `activeId`'s snapshot —
  derived by comparison, no extra persisted state.

### 4.8 Preset starter packs (U2)

- `src/preset/starterPacks.ts` exports exactly four packs: **Rust**, **Tauri**,
  **Next.js**, **Python**. Each is a complete preset object at the **current preset
  version (3, per WO03's lockstep bump)** and must pass Rust's `validate_preset`
  (`kind: "cowtext-preset"`).
- Each pack: 5–8 nodes across `rules` / `architecture` / `workflow` / `glossary` /
  `command`, briefs only (no content — presets never carry content), sensible `pinned`
  and `readOrder`, and edges that demonstrate `imports` at least once.
- Applied through the **existing** `preset_apply` (never-clobber unchanged). Starters
  appear in `PresetsModal` in a separate "Starter packs" section above saved presets,
  visually distinguished from user presets.

### 4.9 GitHub Action (R4)

- `.github/actions/cowtext-check/action.yml` — composite action, consumable as
  `uses: <owner>/cowtext/.github/actions/cowtext-check@<ref>`. Inputs: `root`
  (default `.`), `binary-path` (optional — skips the build), `fail-on`
  (`drift` | `lint` | `both`, default `drift`). Builds with
  `cargo build --release --bin cowtext-cli` behind a cargo cache when no binary is given.
- `.github/workflows/cowtext-check.yml` — this repo's own PR check, run against the
  committed fixture project `.github/fixtures/ci-demo/` so the gate is real and does not
  depend on Cowtext dogfooding itself.
- Sub-path action, not a repo-root `action.yml`: keeps the root clean per CLAUDE.md's
  layout rule. Publishing prebuilt binaries to Releases is **WO08**, not this.
- R4 may touch `src-tauri/src/bin/cowtext_cli.rs` **only** for what the Action needs
  (a `--root <path>` flag and correct exit codes). New subcommands = deviation report.
- R4 must not create `.github/copilot-instructions.md` in this repo — that path is a
  Cowtext compile output and an importer fixture.

### 4.10 Branch-aware graph (R4 · U3)

- `git_head_watch(root)` reads `<root>/.git/HEAD`, arms one non-recursive notify watch
  on the resolved git dir filtered to `HEAD` (200 ms debounce, one watch per app held in
  `GitState`, replacing any previous), and returns the current `GitHead`.
- `<root>/.git` may be a **file** containing `gitdir: <abs path>` — Cowtext's own
  `worktree_add` produces exactly this. Follow **one** level of indirection. This is the
  second and last sanctioned out-of-root read, and it is read-only.
- Not a repo → `is_repo: false`, no watch, no error, feature stays silent.
- On `git://head`: `src/store/git.ts` calls `useGraphStore.getState().loadGraph(root)`,
  then runs a **drift check** — `compile_preview` in memory, collect every file with
  `unchanged === false` — and stores the list. `App.tsx` renders a branch chip plus an
  amber "compiled output does not match this branch's graph" warning listing the drifted
  paths. No header hash anywhere (D6, must-not-break #12).

---

## 5. Lane grid — exclusive file zones

Seven build lanes plus the standard close-out lane. Zones are exclusive; `lib.rs` is the
only shared file and it is append-only under §3.1. **No tech-barn lane this work order**
— `src/scene/**` is frozen (L1-first).

| Lane | Agent | Scope | File zone (exclusive) |
|---|---|---|---|
| **R1 — hierarchy & resolved context** | tech-general | §4.1, §4.5; commands 55–56 | `src-tauri/src/hierarchy.rs` + `hierarchy/tests.rs` *(new)* · `src-tauri/src/resolve.rs` + `resolve/tests.rs` *(new)* · `lib.rs` **shared-append** (lands first, adds the trailing comma) |
| **R2 — link manager** | tech-general | §4.2; commands 57–59; `.cowtext/links.json` | `src-tauri/src/links.rs` + `links/tests.rs` *(new)* · `lib.rs` **shared-append** |
| **R3 — skill target & round-trip import** | tech-general | §4.3, §4.4; **no new commands** | `src-tauri/src/compile.rs` + `compile/tests.rs` · `src-tauri/src/import.rs` + `import/tests.rs` · **does not touch `lib.rs`** |
| **R4 — branch, loadouts, CI** | tech-general | §4.7 (Rust half), §4.9, §4.10; commands 60–62; event `git://head` | `src-tauri/src/git.rs` + `git/tests.rs` *(new)* · `src-tauri/src/loadouts.rs` + `loadouts/tests.rs` *(new)* · `src-tauri/src/bin/cowtext_cli.rs` *(narrow, §4.9)* · `.github/**` · `lib.rs` **shared-append** + the one `setup` line |
| **U1 — context preview UI** | tech-ui | Hierarchy panel, Resolved tab in the Compile modal, skill-target checkbox + frontmatter-sync button, token totals (§4.6) | `src/context/**` *(new: `ContextModal.tsx`, `HierarchyPanel.tsx`, `ResolvedPreview.tsx`, `api.ts`, `types.ts`)* · `src/compile/**` · `src/store/tokens.ts` · `src/inspector/Inspector.tsx` **(Assemble token lines only — nothing else in that file)** |
| **U2 — loadouts & starter packs UI** | tech-ui | Loadout capture/apply/rename/delete + active indicator; starter-pack section | `src/loadouts/**` *(new: `LoadoutsModal.tsx`, `api.ts`, `types.ts`)* · `src/store/loadouts.ts` *(new)* · `src/store/graph.ts` **(exactly the `applyPinSet` action of §4.7 — no other edit)** · `src/preset/**` |
| **U3 — links, branch & shell wiring** | tech-ui | Links modal + ladder/degraded messaging, branch chip + drift warning, all modal wiring | `src/links/**` *(new: `LinksModal.tsx`, `api.ts`, `types.ts`)* · `src/store/links.ts` *(new)* · `src/store/git.ts` *(new)* · `src/App.tsx` |
| **P1 — docs close-out** | project-manager | Invoke 54→62, events 4→5, new modules/terms/sidecars, Status line, `docs/testing/WO04_TEST_MANUAL.md` | `docs/**` *(except `docs/design/WO04_*.md` — tech-lead)* · `CLAUDE.md` · `README.md` · `.claude/skills/cowtext-terminology/**` |

**Overlap audit.** `src-tauri/src/`: R1 owns `hierarchy*`+`resolve*`, R2 `links*`, R3
`compile*`+`import*`, R4 `git*`+`loadouts*`+`bin/`. `lib.rs` shared-append. `agents.rs`,
`frontmatter.rs`, `project.rs`, `preset.rs`, `lint.rs`, `watcher.rs`, `tasks.rs`,
`sessions.rs`, `hooks*`, `assemble.rs`, `settings.rs`, `handoff.rs`, `worktree.rs` —
**nobody**. `src/store/`: U1 `tokens.ts`, U2 `loadouts.ts`+`graph.ts`, U3 `links.ts`+
`git.ts`; `project.ts`, `events.ts`, `settings.ts`, `agents.ts`, `tasks.ts`, `review.ts`,
`sessions.ts` — nobody. `src/`: U1 `context/`+`compile/`+`inspector/Inspector.tsx`,
U2 `loadouts/`+`preset/`, U3 `links/`+`App.tsx`; `canvas/`, `agents/`, `wizard/`,
`scene/`, `tasks/`, `settings/`, `handoff/`, `sessions/`, `review/`, `ui/`, `identity/`,
`fs/`, `assemble/`, `inspector/*` other than `Inspector.tsx` — nobody.

**Frozen cross-lane interfaces** (so lanes never need to talk):

```ts
// U1 exports; U3 lazy-imports and mounts in App.tsx
export function ContextModal(props: { open: boolean; onClose: () => void }): JSX.Element;
// U2 exports; U3 lazy-imports and mounts in App.tsx
export function LoadoutsModal(props: { open: boolean; onClose: () => void }): JSX.Element;
// U3 exports; U1 calls after a successful compile_write
export function reconcileLinks(root: string): Promise<LinkReport[]>;
```

---

## 6. Sequencing

1. **R1 first** — it opens the `lib.rs` append region (trailing-comma fix). R2, R3, R4
   may be *written* in parallel against this contract; they *land* after R1's `lib.rs`
   touch to keep the shared region a pure append.
2. **R3 before U1's gate** — the skill target must exist before the Compile modal offers
   its checkbox. R3 must not change the compile core's public surface; if it must, it
   reports and R1 rebases.
3. **R2 before U3's gate**, **R4 before U2's and U3's gates** — the TS `invoke` names
   must resolve against a landed handler list.
4. **U3 before U1's gate** — `reconcileLinks` must exist before `CompileModal` imports it.
5. **U2 independent of U1/U3** once R4 has landed.
6. **P1 last**, after every merge. Then tech-lead adversarial audit → defect round by the
   owning lanes → tester re-runs all gates (WO02/WO03 protocol).

---

## 7. Acceptance gates

Standard stack:

| # | Gate | Owner |
|---|---|---|
| 1 | `cargo clippy -- -D warnings` clean from `src-tauri/` | R1–R4 |
| 2 | `cargo test` green; `hierarchy.rs`, `resolve.rs`, `links.rs`, `git.rs`, `loadouts.rs` join the tested modules with ≥ 6 tests each | R1–R4 |
| 3 | `npm run build` (tsc strict, no unused, no `any`) clean | U1–U3 |
| 4 | `npm run lint` clean | U1–U3 |
| 5 | Invoke contract **62/62 byte-exact** across `generate_handler!`, `docs/TERMINOLOGY.md`, `cowtext-terminology` skill | R1/R2/R4 + P1 |
| 6 | Events **5/5** documented; `git://head` payload matches `GitHead` field-for-field | R4 + P1 |
| 7 | `GRAPH_VERSION === 3`; `git diff src/store/graph.ts` shows the `applyPinSet` action **and nothing else** | tech-lead audit |
| 8 | Golden files for **all six** targets; an unedited graph recompiles byte-identically | R3 |

WO04-specific fixtures:

| # | Gate | Owner |
|---|---|---|
| 9 | **Hierarchy fixture tree + expected-winner table** (below) passes as a unit test with an injected global | R1 |
| 10 | **Round-trip import**: compile the fixture graph to all six targets → `import_scan` proposes **zero** nodes and reports every emitted file as already managed | R3 |
| 11 | **NTFS symlink-fallback walk** (6 steps, below) — manual, on real NTFS | tester |
| 12 | **GitHub Action dry-run**: the workflow's exact command sequence, run locally on a clean clone against `.github/fixtures/ci-demo/` — exit **0** pristine, exit **1** after mutating the fixture's `CLAUDE.md` | R4 + tester |
| 13 | **Link ↔ compile reconciliation**: apply a link → `compile_write` over the pair → `link_status` reports `healthy:false` with the severed-by-atomic-write detail → `link_apply` repairs to `healthy:true` | R2 + tester |
| 14 | **Loadouts round-trip**: capture → switch → apply → `graph.json` matches the snapshot byte-for-byte; a loadout naming a deleted node applies cleanly and keeps the stale id in the sidecar | R4 + U2 |
| 15 | **Resolved preview honesty**: for a 3-level import chain the resolved bytes equal a hand-assembled expectation, each file appears once, and the token count equals `ceil(bytes/4)` | R1 |
| 16 | Branch walk: `git checkout -b wo04-test` → branch chip updates without a restart; edit the graph, don't compile, switch branches → drift warning names the stale files | tester |

**Hierarchy fixture** (`hierarchy/tests.rs`):

```
fixture/CLAUDE.md                 fixture/src/CLAUDE.md
fixture/src/net/            (no CLAUDE.md)
fixture/src/net/deep/CLAUDE.md    fixture/docs/   (no CLAUDE.md)
global (injected): home/.claude/CLAUDE.md
```

| Queried path | Layers (global · root · …) | `winner_index` → file |
|---|---|---|
| `src/net/deep/x.rs` | ✓ · ✓ · `src` ✓ · `src/net` ✗ · `src/net/deep` ✓ | `src/net/deep/CLAUDE.md` |
| `src/net/x.rs` | ✓ · ✓ · `src` ✓ · `src/net` ✗ | `src/CLAUDE.md` |
| `docs/x.md` | ✓ · ✓ · `docs` ✗ | `CLAUDE.md` |
| `README.md` | ✓ · ✓ | `CLAUDE.md` |
| `README.md`, no project `CLAUDE.md` | ✓ · ✗ | global |
| `README.md`, no global, no project file | ✗ · ✗ | `None` |

**NTFS symlink-fallback walk** (manual, `docs/testing/WO04_TEST_MANUAL.md`):

1. Developer Mode **ON** → apply → `mode:"symlink"`, `healthy`, `degraded:false`;
   `dir` shows `<SYMLINK>` and the target is **relative**.
2. Developer Mode **OFF**, non-elevated → apply → symlink fails (1314) → `mode:"hardlink"`,
   `healthy`; `fsutil hardlink list AGENTS.md` lists both names.
3. Project copied to an exFAT/other volume → hardlink fails → `allowCopy:false` returns
   an error naming both prior failures; `allowCopy:true` → `mode:"copy"`, `degraded:true`,
   and `detail` warns the copy goes stale.
4. Compile over the mirror → `link_status` unhealthy → `link_apply` repairs (gate 13).
5. Hand-written mirror without a GENERATED header → apply refuses; the file is
   byte-identical before and after.
6. Create a symlink, delete the master → status unhealthy → `link_remove` leaves **no**
   dangling link and **no** zero-byte file; with a healthy link, `link_remove` leaves an
   independent copy of the current bytes.

Not gates, do not attempt as such: Marty's acceptance walk, and any WO05+ surface.

---

## 8. Deferred (explicitly NOT WO04)

| Item | Owner |
|---|---|
| Usage heatmap, event persistence, Reality Check drift lint, dead-node report, unmapped-read adopt, `cowtext-hook` shim, sprites/GIF/moo, quota tracker | **WO05** |
| GENERATED-header content hash / tamper detection (FEATURES 4.8) | **WO05** |
| Task DAG, tasklinks sidecar, per-task subgraph injection, compile-on-launch, token ceilings, session attribution, handoff→node | **WO06** |
| Heartbeats, event triggers, approval gates, permission grids, squads, auto-promote, revisioned config, workflow packs | **WO07** |
| Prebuilt `cowtext-cli` binaries published to Releases; MCP/plugin/packages | **WO08** |
| Writing or compiling into `~/.claude/CLAUDE.md` (global scope *management*) | unscheduled — WO04 is read-only global (D10) |
| Directory-level junction mirrors (e.g. `.cursor/rules`) | unscheduled (D1) |
| `packed-refs` parsing, git status/diff surfaces | unscheduled (D11) |
| Conditional tester (FEATURES 4.9), compile-to-clipboard (4.7), `.cowtext/history/` revert (4.10) | unscheduled |
| Loadout `compileTargets` overrides | **rejected**, not deferred (D9) |
| Any `src/scene/**` work | **WO05** |
