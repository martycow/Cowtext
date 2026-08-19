# WO04 Contract — L1 Completion (frozen)

**Work order 04** · drafted 2026-08-19 · **amended 2026-08-19 (A1, pre-dispatch)** ·
dispatcher: `/ultracode` · author: tech-lead

**Goal:** finish L1. After WO04 the context graph is *hierarchy-aware*, *link-safe on
Windows*, *round-trippable*, *previewable byte-for-byte*, *profile-able*, *CI-enforced* —
and **roles change the compiled artifact**, so "a graph, not a folder" is true in the
output and not only in the editor.

**Precondition:** WO03 landed and committed (`605760e`) — graph v3 (13 roles / 7 edge
kinds / tags+owner+meta / edge color), 5 compile targets, `cowtext-cli`, `import_scan` /
`import_apply`, `lint_run`, invoke total **54** (confirmed current in
`docs/TERMINOLOGY.md`). Tree clean at dispatch.

**Frozen once lanes start.** A lane that finds this contract wrong stops, states the
failing assumption, and reports (WO02 §9 deviation protocol, unchanged). Improvising
across a seam is an automatic reject.

### Amendment A1 (pre-dispatch, ratified by Marty)

`docs/design/WO03_AUDIT.md` §3/O2 established that of the 13 roles in the v3 schema,
**only `agent` has compile semantics** — the other twelve change zero bytes of output, so
the "richer taxonomy" moat claim is currently unearned. Marty's decision: **WO04 gives
roles real compile behaviour** (§4.1). Consequences folded in here:

- New lane **R3 — compile semantics** is the *sole* owner of `compile.rs`; the importer
  moved out to new lane **R5**. Lane count 7 → 8. No two lanes share a hot file.
- Must-not-break gains #15–#18 (legacy byte identity, ordering invariance, line-ending
  normalization, one owner per hot file).
- WO03 carry-forwards adjudicated here: `classify_output` consolidation (§4.5),
  cycle-detector duplication (permanently ratified, §4.5), D6 unknown-enum preservation
  (rejected with a substitute, §4.5).
- The SKILL.md target is **no longer a bespoke adapter** — it is the `Artifact` arm of the
  role mechanism (§4.1, §4.4).
- Invoke count unchanged: **54 → 62**. Role semantics adds no command.

---

## 1. Must-NOT-break (read first, every lane)

Carried forward from WO03 — still binding:

1. **Byte-identity frontmatter** — `frontmatter.rs` / `agents.rs` are OUT of every
   lane's zone; nobody touches them.
2. **Deterministic compile** — an unedited graph produces byte-identical output for
   every target, run to run, on every OS.
3. **Never-clobber** — preset apply, `import_apply` and (new) `link_apply` never
   overwrite existing user content.
4. **Preset round-trip** — presets auto-upgrade on read/apply and re-save cleanly.
5. **Write allowlist + GENERATED header** — extended for the skill shape, never
   weakened; `compile_write` still refuses headerless content.
6. **Invoke-contract byte-exactness** — `generate_handler!`, `docs/TERMINOLOGY.md`
   and the `cowtext-terminology` skill agree, always, in the same commit.
7. **Errors XOR files** — `compile_preview` returns `errors` or `files`, never both.
   The new `warnings` field (§4.1) is **not** part of that pair: warnings coexist with
   files and never block a write.

New in WO04, equally binding:

8. **No write outside the project root. Ever.** WO04 introduces exactly **two**
   read-only exceptions, both frozen below and both narrow: `<home>/.claude/CLAUDE.md`
   (hierarchy global layer) and the git directory named by a `.git` *file* (linked
   worktrees). No general "read outside root" primitive is added.
9. **Frontmatter has one writer.** `frontmatter.rs` / `agents.rs` are the only code
   that writes bytes between `---` fences of `.claude/skills/*/SKILL.md`. The skill
   artifact writes body-block bytes only (§4.4).
10. **Never leave a broken link.** Every rung of the link ladder is verify-then-commit;
    a failed rung is deleted before falling through (§4.3).
11. **Sidecar over bump.** `GRAPH_VERSION` **stays 3**. Standing rule: per-project state
    that does not change compile output goes into a `.cowtext/<name>.json` sidecar with
    its own `version`, never into `graph.json`.
12. **The GENERATED header string is frozen.** No hash, no branch, no timestamp.
    Content hashing = FEATURES 4.8 tamper detection = WO05.
13. **`compile_preview` and `context_resolve` are read-only.** Neither writes.
14. **`graph.json` shape is untouched.** No node field, no edge field, no role, no edge
    kind added. `compileTargets` gains one tolerant-parsed value (`skill`) — per WO03's
    own precedent for copilot/gemini, an additive default-off enum value is **not** a
    schema change.
15. **Legacy-role byte identity (A1).** A graph whose nodes use only the seven pre-WO03
    roles (`agent`, `rules`, `architecture`, `workflow`, `task`, `reference`, `glossary`)
    — and any graph with an *unrecognized* role string — compiles **byte-identically to
    `605760e`** for all five targets. WO03's golden files must not change one byte.
    `compile/tests.rs::v3_additions_do_not_change_legacy_target_output` is extended, not
    edited. This is the single most important gate in the work order.
16. **Role policy never touches ordering (A1).** `total_order`, `effective_pinned`,
    cycle validation, dangling-edge detection and `classify_output` are all invariant to
    role. A role decides only *how a node's entry is rendered*, never *whether the graph
    is valid* or *in what order nodes come out*.
17. **Line-ending normalization on every inlined byte (A1).** Inlined file bodies are
    normalized CRLF/CR → LF with trailing newlines trimmed, exactly as `emit_cursor`
    already does. Without this, a Windows working copy and a Linux CI runner produce
    different bytes and `cowtext-cli compile --check` fails in CI for every inlined node.
18. **One owner per hot file (A1).** `compile.rs` → R3 only. `lib.rs` → shared-append
    only, under §3.1. `src/store/graph.ts` → U2 only, one action. `src/App.tsx` → U3 only.
    `project.rs` / `lint.rs` / `import.rs` → R5 only. Parallel lanes sharing a hot file is
    the failure mode WO03 hit repeatedly; it does not recur here.

**Explicitly out of scope:** `src/scene/**` (zero barn lanes — L1-first rule),
`sessions.rs`, `tasks.rs`, `hooks.rs` / `hooks_server.rs`, `watcher.rs`, `assemble.rs`,
`frontmatter.rs`, `agents.rs`, `preset.rs`, `src/canvas/**`, `src/agents/**`,
`src/wizard/**`.

---

## 2. Scope calls (decisions a builder could otherwise get wrong)

| # | Ambiguity | Decision | Rationale (one line) |
|---|---|---|---|
| D1 | Junction in the symlink ladder | **Junctions are not in the file ladder.** Rungs are symlink → hardlink → copy | `mklink /J` targets directories only; a junction cannot point at a file. |
| D2 | Which hierarchy the simulator models | **`CLAUDE.md` only** (`<home>/.claude/CLAUDE.md` → root → each ancestor dir) | It models what Claude Code loads; AGENTS.md nesting is already emitted by the agents adapter. |
| D3 | Who writes SKILL.md frontmatter | **`agents.rs`, always.** The skill artifact writes only the managed body block | Preserves must-not-break #1 with zero coordination cost. |
| D4 | Where loadouts persist | **`.cowtext/loadouts.json` sidecar v1**, frontend-owned shape | Loadouts don't change compile output; a v4 bump two WOs after v3 for view state is unjustifiable. |
| D5 | Does applying a loadout mutate the graph | **Yes — apply writes `pinned` / `readOrder` into `graph.json`** | An invisible overlay would make `cowtext-cli compile --check` disagree with the app, the one thing the CLI exists to prevent. |
| D6 | Branch mismatch detection | **Drift = in-memory `compile_preview` vs disk**, not a header hash | Adding a hash to the header breaks #12 and every golden file. |
| D7 | Starter packs storage | **TS module `src/preset/starterPacks.ts`**, no new invoke | The preset format is already frontend-owned (Rust never re-serializes it). |
| D8 | Resolved preview for `cursor` / `skill` | **Rejected with an error message** | Those targets are sets of fragments, not one context the agent sees at once. |
| D9 | Loadouts overriding `compileTargets` | **No.** Pinned set + readOrder only | Multiplying compile paths per profile is how a compiler stops being trustworthy. |
| D10 | Global `~/.claude/CLAUDE.md` editing | **Read-only in WO04** — a viewer, not a manager | FEATURES 1.10 absorbed as *scope visibility*; writing outside root is must-not-break #8. |
| D11 | `packed-refs` / full git plumbing | **Not parsed.** Loose ref only; `commit: null` if absent | The branch name drives the UI; the commit is decoration. |
| D12 | Unknown node ids inside a loadout | **Tolerated on apply, never auto-pruned** | Branch switches make ids come and go; auto-pruning would eat a loadout on checkout. |
| **D13** | Role→behaviour mechanism | **One `Emission` enum + one exhaustive `match` in `compile/roles.rs`.** Adapters branch on `Emission`, never on `RoleIn` | A `match` (not a map) makes the compiler refuse to build until a newly added role declares a policy — that is the "expandable, modular" property, and it costs one table row per role instead of twelve branches per adapter. |
| **D14** | Does `style` get a special emission | **No — rejected.** `style` stays `Link` | A style guide is long-form reference; grouping its link under a heading changes no meaning and buys a special case. Twelve roles do not each need a behaviour. |
| **D15** | Where inlining applies | **Pinned position only, four root targets, 8 KiB cap** | On-demand bullets are conditional by construction — inlining them unconditionally destroys the condition. `cursor` already inlines whole bodies, so the policy is a no-op there *by construction*, which is the check that the mechanism is shaped right. |
| **D16** | Skill nodes excluded from root files | **Only when the `skill` target is ON**; with it off they behave as `Link` | Never silently drop a pinned node from an agent's context because a target checkbox is unticked. |
| **D17** | Three re-derivations of compile logic | **`classify_output` consolidates** (`pub(crate)`, import's copy deleted). **Cycle duplication stays ratified**, permanently | An allowlist-shaped predicate copied twice is how a write hole opens; two cycle detectors over genuinely different types are a type-boundary decision WO03 §4.6 already settled and D9's differential test pins. |
| **D18** | D6 `Other(String)` preservation | **Rejected for WO04.** Substitute: coercions become a `lint_run` warning, and `import_apply` **refuses to write** a graph that contained one | `Other(String)` kills `Copy` on three enums and ripples through every use site; refusing to write converts a silent rewrite into a loud, fixable error at the one place data is actually lost. Full preservation → WO06, trigger: a second Rust writer of `graph.json`. |
| **D19** | Where compile reports non-fatal problems | **New `warnings: Vec<String>` on `CompilePreview`**, coexisting with `files` | Silent degradation (an oversize snippet quietly becoming a link) is worse than a wire field; warnings are explicitly outside errors-XOR-files. |
| **D20** | `compile.rs` ownership | **R3 alone.** Importer split into R5 | A1's direct instruction; also the WO03 failure mode. |

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

**Total after WO04: 62.** Not added, deliberately: no role/compile command (role
semantics rides `compile_preview`), no drift-check command (the frontend calls
`compile_preview` and reads `unchanged`), no starter-pack command (D7), no
assemble-token command (`src/store/tokens.ts` already has the estimator).

### 3.1 `lib.rs` append protocol (the only shared file)

Three append-only regions:

- **`mod` block** — alphabetical. Final state: `agents, assemble, compile, frontmatter,
  git, handoff, hierarchy, hooks, hooks_server, import, lint, links, loadouts, preset,
  project, resolve, sessions, settings, tasks, watcher, worktree`. Existing `pub mod`
  visibility for `compile`/`project`/`lint`/`import` (WO03 Lane C) is preserved verbatim.
- **`generate_handler!` list** — appended **at the end, in command-number order 55→62**,
  each line ending with a comma. **R1 lands first and adds a trailing comma to the current
  last entry**; from then on every lane appends `module::command,` and nobody moves a
  comma. (`generate_handler!` accepts a trailing comma.)
- **`setup` block** — one new line, R4 only: `app.manage(git::GitState::default());`
  immediately after the `SessionRegistry` line.

R3 and R5 add no command and do not touch `lib.rs`.

### 3.2 Wire shapes

```rust
// compile.rs — ADDITIVE field only; errors/files semantics unchanged (must-not-break #7)
pub struct CompilePreview {
    pub errors: Vec<ValidationError>,
    pub files: Vec<PreviewFile>,
    pub warnings: Vec<String>,   // NEW (D19) — non-fatal; coexists with files
}

// hierarchy.rs — ascending precedence: layers[0] = global, last = deepest directory.
pub struct HierarchyResolution {
    pub rel_path: String,
    pub layers: Vec<HierarchyLayer>,    // absent layers INCLUDED with exists:false
    pub winner_index: Option<usize>,    // deepest existing layer
    pub total_bytes: u64,
    pub total_tokens: u64,
    pub global_content: Option<String>, // Some iff global exists and is < 256 KiB
}
pub struct HierarchyLayer {
    pub scope: String,             // "global" | "project" | "directory"
    pub label: String,             // "~/.claude/CLAUDE.md" | forward-slash rel path
    pub rel_path: Option<String>,  // None for the global layer
    pub exists: bool, pub bytes: u64, pub tokens: u64,
    pub generated: bool, pub depth: u32,   // 0 global, 1 project root, 2+ directory
}

// resolve.rs
pub struct ResolvedContext {
    pub target: String, pub rel_path: String,
    pub content: String,       // fully expanded bytes — what the agent actually sees
    pub bytes: u64, pub tokens: u64,
    pub sources: Vec<ResolvedSource>, pub warnings: Vec<String>, pub truncated: bool,
}
pub struct ResolvedSource { pub rel_path: String, pub depth: u32, pub bytes: u64, pub tokens: u64, pub included: bool }

// links.rs
pub struct LinkReport {
    pub master_rel_path: String, pub mirror_rel_path: String,
    pub mode: String,        // "symlink" | "hardlink" | "copy" | "none"
    pub managed: bool,       // present in .cowtext/links.json
    pub healthy: bool,       // mechanism intact AND mirror bytes == master bytes
    pub degraded: bool, pub same_volume: bool,
    pub detail: String,      // always non-empty; the sentence the UI shows
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

Why a new event: `fs://change` feeds `useProjectStore.applyFsChange` and the lens
machinery, which assume `.md` project files. Pushing `.git/HEAD` through that seam is a
silent type lie. Emission is **edge-triggered** — only when the payload differs from the
last emitted one.

`barn://event`, `assemble://status`, `fs://change`, `agent://event` untouched.

### 3.4 Data model

`graph.json` — **unchanged**, `version` stays **3**. Two new sidecars:

```jsonc
// .cowtext/loadouts.json — v1, FRONTEND-owned shape (Rust validates + writes atomically)
{ "kind": "cowtext-loadouts", "version": 1, "activeId": "l-a1b2c3",
  "loadouts": [ { "id": "l-a1b2c3", "name": "Frontend work", "note": "",
                  "pinned": ["n-1","n-7"], "readOrder": { "n-1": 0, "n-7": 10 },
                  "capturedAt": "2026-08-20T09:00:00Z" } ] }

// .cowtext/links.json — v1, RUST-owned (it records what Rust did to the filesystem)
{ "kind": "cowtext-links", "version": 1,
  "links": [ { "master": "AGENTS.md", "mirror": "CLAUDE.md",
               "mode": "hardlink", "appliedAt": "2026-08-20T09:00:00Z" } ] }
```

Ownership rule: **the side that owns the format writes the file.** Both serialize
deterministically (sorted keys, `pinned` sorted, `links` sorted by mirror path, LF,
trailing newline).

---

## 4. Feature specs (frozen)

### 4.1 Role emission policy — the A1 headline (R3 · U1)

**The mechanism, in one sentence:** every role maps, through one exhaustive `match` in
one new file, to one of **three** emission strategies; adapters branch on the strategy,
never on the role.

```rust
// src-tauri/src/compile/roles.rs   (new; `mod roles;` inside compile.rs)

/// How a role reaches compiled output. Adapters match on this, never on RoleIn.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Emission {
    /// Pre-WO04 behaviour, byte-for-byte: a link/import line in the flat
    /// "Always read" list, or an on-demand bullet.
    Link,
    /// The node file's bytes are inlined under a per-role section heading,
    /// replacing the flat-list line. Pinned position only.
    Inline { heading: &'static str },
    /// No root-file entry at all; the node compiles to its own artifact.
    Artifact,
}

/// THE table. A `match`, not a map: adding a variant to RoleIn fails to
/// compile until its policy is declared here. One row per role, forever.
pub(super) fn emission(role: RoleIn) -> Emission { … }

/// Frozen section order and headings. Data, not control flow — `emit_root`
/// iterates this array; it never names a role.
pub(super) const INLINE_SECTIONS: [&str; 4] = ["Commands", "Invariants", "Traps", "Snippets"];
```

`RoleIn` is widened from `Agent | Persona | Other` to the full 13 + `Persona` + `#[serde(other)] Other`,
so the table can be exhaustive. Unknown role strings still parse to `Other`.

**The table:**

| Roles | Emission | Why |
|---|---|---|
| `agent`, `rules`, `architecture`, `workflow`, `task`, `reference`, `glossary`, `style`, and any unrecognized string (`Other`) | `Link` | Long-form context; a link is the right cost. This arm is what makes must-not-break #15 true by construction. |
| `command` | `Inline { "Commands" }` | Operational and short. This repo's own `CLAUDE.md ## Commands` is inlined text — that is the proof. |
| `invariant` | `Inline { "Invariants" }` | A rule the agent must never break is worthless behind a link it may not follow. |
| `trap` | `Inline { "Traps" }` | Same argument: a trap unread is a trap fallen into. |
| `snippet` | `Inline { "Snippets" }` | A reusable fragment costs a whole file read for five lines otherwise. |
| `skill` | `Artifact` | Compiles to `.claude/skills/<name>/SKILL.md` (§4.4). |

`style` deliberately gets **nothing** (D14). Twelve roles do not each need a behaviour.

**Scope of the policy (D15).** It applies to the **pinned entries of the four root
targets** (`claude`, `agents`, `copilot`, `gemini`) and to the skill artifact. Everywhere
else it is a no-op:

| Surface | Effect of role policy |
|---|---|
| `emit_root` pinned list | **Changed** — `Link` nodes stay in `## Always read`; `Inline` nodes move to their section; `Artifact` nodes are removed (see D16) |
| `emit_root` on-demand bullets (`## Read when relevant`) | **Unchanged** — conditional/reference bullets are conditional by construction |
| `emit_nested_agents` | **Unchanged** except `Artifact` exclusion |
| `emit_cursor` (`.mdc`) | **Unchanged** except `Artifact` exclusion — the adapter already inlines full bodies, so the policy is a no-op there by construction |
| Agent context block (`.claude/agents/*.md`) | **Unchanged** |
| `total_order`, `effective_pinned`, cycle/dangling validation, `classify_output` | **Unchanged** (must-not-break #16) |

Link syntax is untouched: `LinkStyle::{AtImport, MarkdownLink}` keeps deciding
`@path` vs `[title](path)` for the `Link` arm. Inlined bytes are literal markdown and are
therefore identical across all four root targets — role behaviour does **not** differ
per target.

**Frozen output shape.** `emit_root` becomes
`emit_root(&self, style: LinkStyle, read_file: &dyn Fn(&str) -> Result<String, String>)`
(the same seam `emit_cursor` already uses; a read failure is infrastructure `Err`, and
every node file was already proven to exist by validation). Emission order:

```
<GENERATED_HEADER>

# {project_name} — agent context

## Always read            ← only if ≥1 pinned Link node; contents byte-identical to today

<link lines, total order>

## {section}              ← per non-empty INLINE_SECTIONS entry, in that frozen order

### {node.title}

<!-- cowtext:node {node.file_path} -->

{normalized body}

## Read when relevant     ← unchanged

<bullets>
```

- Nodes within a section are in **total order** (`(readOrder, id)` Kahn), never in table
  order. Consecutive node blocks are separated by exactly one blank line. An empty body
  ends the block after the provenance line.
- `normalized body` = file bytes, CRLF/CR → LF, trailing newlines trimmed
  (must-not-break #17).
- The `<!-- cowtext:node … -->` provenance line is **mandatory**: it tells the user where
  to edit, and it is what lets `import_scan` (§4.5) recognize inlined content instead of
  re-importing it as a new node.
- **8 KiB cap.** A body exceeding 8192 bytes after normalization is **not** inlined: the
  node falls back to its `Link` line in `## Always read` and a warning is pushed —
  `"{file_path}: {n} bytes exceeds the 8 KiB inline cap for role '{role}' — linked instead"`.
  Deterministic, bounded, and never silent (D19).

**Artifact gating (D16).** `Artifact` exclusion from root/nested/cursor output applies
**only when the `skill` target is enabled**. With it off, a `skill` node behaves exactly as
`Link`. A `skill`-role node whose `filePath` is not `.claude/skills/<name>/SKILL.md`
behaves as `Link` and emits a warning.

**Regression obligation.** `compile/tests.rs::v3_additions_do_not_change_legacy_target_output`
is **extended, never edited**: same fixture, now also asserting an unrecognized role string
and a `style` node produce the pre-WO04 goldens byte-for-byte. Plus a new
all-13-roles golden set (gate 9).

### 4.2 Hierarchy simulator (R1 · U1)

- Pure core `resolve_hierarchy(root: &Path, global: Option<&Path>, rel: &str)`; the
  `#[tauri::command]` is a thin wrapper supplying `app.path().home_dir()`. Tests inject
  `global` — no test may depend on the machine's real home.
- Layer enumeration for `rel`: global · project root · every ancestor directory of `rel`
  from root downward · `rel`'s own directory. Absent layers are returned with
  `exists: false` — the simulator must show empty slots, that is the point.
- **Nearest-file-wins** = `winner_index` is the last layer with `exists: true`. Layers are
  additive in ascending precedence; where two conflict, the deepest is effective.
- `rel` resolves through `resolve_within_root`; > 32 path components → `Err`.
- `global_content` is the single sanctioned out-of-root read, capped at 256 KiB and
  returned inline precisely so no general out-of-root read primitive is needed.
- No capability change expected (`app.path()` from Rust does not traverse the capability
  system). A runtime rejection is a deviation report, not a silent edit of
  `capabilities/default.json`.

### 4.3 Windows-safe link manager (R2 · U3)

**Allowlist.** Master and mirror must each be exactly one of `CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`, `.github/copilot-instructions.md`, and must differ. Anything else → `Err`.

**Ladder (files, Windows-first).** Requested top-down, each rung verify-then-commit:

| Rung | Call | Fails when | Then |
|---|---|---|---|
| 1 symlink | `std::os::windows::fs::symlink_file` (`unix::fs::symlink` elsewhere) | No Developer Mode / no `SeCreateSymbolicLinkPrivilege` → **os error 1314** | fall to 2 |
| 2 hardlink | `std::fs::hard_link` | Different volume (**os error 17**), FAT32/exFAT | fall to 3 |
| 3 copy | `write_atomic(mirror, master_bytes)` | — | `mode:"copy"`, `degraded:true` |

Rung 3 only when `allowCopy` is true; with `allowCopy:false` the command returns `Err`
naming both prior failures so the UI can ask before degrading.

**Verify-then-commit.** After creating any rung: re-read the mirror, compare bytes to
master, and for a symlink additionally `read_link` + `canonicalize` and assert the target
is inside the canonical root. On any failure the artifact is **removed** and the ladder
falls through. `link_apply` never returns `Ok` with a mirror that does not read back as
the master's bytes.

**Traps that must be handled explicitly:**

- A **dangling symlink** makes `Path::exists()` return `false` — `write_atomic`'s existence
  check misses it and `fs::rename` then fails. Always probe with `fs::symlink_metadata`,
  never `metadata`; remove any pre-existing symlink at the mirror before creating one.
- `write_atomic` is temp + remove + rename. Over a **symlink mirror** it deletes the link
  and leaves a real file. Over a **hardlink master** it replaces the directory entry with a
  new inode, severing the pair and leaving the mirror silently stale. Both are detected by
  `link_status` (intent from the sidecar, health from a byte compare) and repaired by
  re-running `link_apply`.
- **Never-clobber:** if the mirror exists as a regular file that is neither byte-identical
  to master nor carrying the GENERATED header, `link_apply` refuses and leaves it
  untouched. No automatic backup in WO04.
- **Symlink targets are relative** (mirror-dir → master), never absolute — an absolute
  target breaks the moment the project folder moves.
- **Accepted risk, stated in `detail`:** git stores a symlink as a mode-120000 blob; on a
  machine without `core.symlinks` it checks out as a short text file. Cowtext does not edit
  `.gitignore` in WO04.
- **Known limitation, ratified in advance:** Rust std exposes no stable NTFS link-count API
  (`MetadataExt::number_of_links` is unstable; `GetFileInformationByHandle` needs a crate,
  which the fixed stack forbids). A severed hardlink is detected by content divergence; a
  same-content copy may report as a healthy hardlink. Re-applying repairs it either way.
  **Do not add a crate for this.**

`link_remove` materializes an **independent copy** of the current bytes at the mirror
before dropping the sidecar entry — removing a link never removes the user's file. If the
master is gone, the dangling link is deleted and nothing is left behind.

**Cross-lane seam (frozen):** `src/store/links.ts` (U3) exports
`reconcileLinks(root: string): Promise<LinkReport[]>`; `CompileModal` (U1) calls it once
after a successful `compile_write` and surfaces any `healthy:false` result.

### 4.4 Skill artifact target (R3 · U1)

The sixth `compileTargets` value **`"skill"`**, off by default, tolerant-parsed, no schema
bump. It is the `Artifact` arm of §4.1, not a bespoke adapter.

- A `skill`-role node at `.claude/skills/<name>/SKILL.md` emits a **managed body block**
  delimited by the existing `AGENT_BLOCK_START` / `AGENT_BLOCK_END` markers via the
  existing `merge_agent_block`. Content: the node's outgoing `imports`/`references`
  targets as `@path` lines in `(readOrder, id)` order — the rule the agent block already
  uses.
- **Compile never writes frontmatter and never creates the file.** A missing file already
  fails the existing `MissingFile` validation; the fix is `skill_create`.
- Frontmatter alignment (node title/brief → skill `name`/`description`) is a one-click
  call to the **existing** `skill_save`. Compile proposes; `agents.rs` writes.
- `classify_output` gains a third shape: `[".claude", "skills", name, "SKILL.md"]` →
  `Some(true)` (surgical family, markers required instead of the GENERATED header), one
  directory level only, no nesting. `compile_write`'s marker check already covers it.

### 4.5 Round-trip import + WO03 fidelity carry-forwards (R5)

`import_scan` / `import_apply` signatures are **frozen from WO03**. WO04 extends coverage
and settles three carry-forwards.

**Coverage.** Parse back `.github/copilot-instructions.md`, `GEMINI.md` and
`.cursor/rules/*.mdc` (frontmatter-aware: `alwaysApply`, `globs` → pinned / `conditional`
condition). **Managed detection**: a GENERATED header, an `AGENT_BLOCK_*` span, **or a
`<!-- cowtext:node … -->` provenance line** (§4.1) marks a span as already managed —
inlined role content must never be re-imported as a new node. Changeset items gain
`managed: bool`.

**Carry-forward 1 — `classify_output` consolidation (D17).** R3 changes
`fn classify_output` → `pub(crate) fn classify_output` and adds
`pub(crate) fn is_compile_output(rel: &str) -> bool { classify_output(rel).is_some() }`.
R5 then **deletes** `import.rs::is_compile_output_path` (`import.rs:767`) and calls
`compile::is_compile_output`. This closes the flagged reconciliation ask at
`import.rs:754-766` and removes a second copy of a write-allowlist-shaped predicate — the
exact shape in which a hole opens. **Serialized: R3 before R5.**

**Carry-forward 2 — cycle-detector duplication.** **Permanently ratified**, per WO03 audit
§4.6: two implementations over genuinely different types (`NodeIn`/`EdgeIn` tolerant vs
`MemoryNode`/`MemoryEdge` canonical), pinned by D9's differential test. WO04 does **not**
consolidate them and no lane may attempt it. `pub mod` visibility does not change that
calculus.

**Carry-forward 3 — D6 unknown enum values (D18).** Full `Other(String)` preservation is
**rejected for WO04**: it removes `Copy` from `NodeRole` / `EdgeKind` / `CompileTarget` and
ripples through every use site, for an exposure (a hand-edited typo, or a graph written by
a newer Cowtext) that is real but rare at v0.1.0. The substitute is *loud, not destructive*:

1. `migrate_graph` records each coercion (`unknown role "referance" on node n-3 → reference`).
2. `lint_run` reports them as `LintCode::UnknownEnumValue` / `Severity::Warning` items, so
   the Problems panel names them.
3. **`import_apply` refuses to write** when the graph it read contained a coercion,
   returning a message naming the offending values. It is the only Rust writer of
   `graph.json`, so this is the only place the coercion can actually destroy data.
4. `compile_preview`, `compile --check` and the app keep working on such a graph, unchanged.

The doc comment at `project.rs:570-591` is updated to point at this ruling. Full
preservation → **WO06**, trigger: a second Rust writer of `graph.json`.

### 4.6 Resolved-context preview (R1 · U1)

- Entry bytes come from **compile's in-memory render**, not disk — the preview shows the
  graph's truth before anything is written.
- Expansion: a line whose trimmed form is exactly `@<path>` is replaced by that file's
  bytes, recursively. Nothing else expands. **Content already inlined by §4.1 is not
  re-expanded** — it arrives as literal bytes with no `@` line, so there is nothing to
  double-inline; a builder must not add a second pass for it.
- **Dedup:** each file inlined at most once; a repeat emits
  `<!-- cowtext: already included: <path> -->`; a path on the inclusion stack emits
  `<!-- cowtext: cycle, already included: <path> -->` plus a warning.
- Caps: depth 16, total 4 MiB → `truncated: true` + warning.
- A missing/unreadable include leaves the `@path` line verbatim and warns — never fails.
- Graph validation failure → `Err("Graph has validation errors — fix them in the Compile
  preview first")`.
- **R1 must not edit `compile.rs`.** WO03 Lane C confirmed the core is callable headless
  (`pub fn compile_preview(root, graph_json)`, `pub mod compile`). If that surface is
  insufficient, R1 stops and reports; tech-lead hands the edit to R3.

### 4.7 Token-cost counts (U1)

- **Compile side**: per-file `≈ tokens` / lines already exist from WO01 Block B. U1 adds
  per-target and grand totals in the modal header, the resolved-preview total, and — new
  with §4.1 — makes clear that inlined bodies now *count against* the root file's budget
  (the existing `COMPILE_WARN_TOKENS` amber treatment does this automatically and must not
  be weakened).
- **Assemble side**: an `≈ N tokens` line before Assemble / Refine / Summarize counting
  **exactly the bytes `assemble.rs` sends** (read the prompt builder; `assemble.rs` is
  read-only reference, not U1's zone), plus a before → after token delta.
- All numbers use `tokensForBytes` / `compiledTokens`; the "≈" prefix stays.

### 4.8 Context loadouts (R4 · U2)

- Persistence per §3.4. `loadout_read` / `loadout_write` mirror `read_graph` /
  `write_graph`: frontend owns serialization, Rust validates the envelope
  (`kind`/`version`/`loadouts` is an array), exactly like `agents_meta_write`.
- **Capture** = snapshot current `pinned` + `readOrder`. **Apply** = write them back (D5)
  in **one undoable step** via a single new store action:
  ```ts
  // src/store/graph.ts — the ONLY change to this file in WO04.
  applyPinSet: (pinned: string[], readOrder: Record<string, number>) => void;
  ```
  One undo snapshot, one save schedule, no persisted-shape change, `GRAPH_VERSION` 3.
- Ids absent from the graph are skipped on apply and **preserved** in the file (D12).
- "Modified" state is derived by comparison against `activeId`'s snapshot — no extra
  persisted state.

### 4.9 Preset starter packs (U2)

- `src/preset/starterPacks.ts` exports exactly four packs: **Rust**, **Tauri**,
  **Next.js**, **Python**, each a complete preset at the current preset version (per
  WO03's lockstep bump) that passes Rust's `validate_preset`.
- Each pack: 5–8 nodes, briefs only (presets never carry content), sensible `pinned` /
  `readOrder`, at least one `imports` edge — and **at least one node per pack using a new
  emission role** (`command` or `invariant`), so the starter packs demonstrate §4.1 on
  first use rather than describing it.
- Applied through the existing `preset_apply` (never-clobber unchanged). Rendered in
  `PresetsModal` in a "Starter packs" section above saved presets.

### 4.10 GitHub Action (R4)

- `.github/actions/cowtext-check/action.yml` — composite, consumable as
  `uses: <owner>/cowtext/.github/actions/cowtext-check@<ref>`. Inputs: `root` (default
  `.`), `binary-path` (optional — skips the build), `fail-on`
  (`drift` | `lint` | `both`, default `drift`). Builds with
  `cargo build --release --bin cowtext-cli` behind a cargo cache when no binary is given.
- `.github/workflows/cowtext-check.yml` — this repo's own PR check, run against the
  committed fixture project `.github/fixtures/ci-demo/` so the gate is real and does not
  depend on Cowtext dogfooding itself. **The fixture must contain at least one `Inline`
  role node** so CI proves must-not-break #17 (a CRLF/LF mismatch would fail the check).
- Sub-path action, not a repo-root `action.yml`: keeps the root clean per CLAUDE.md.
- R4 may touch `src-tauri/src/bin/cowtext_cli.rs` **only** for a `--root <path>` flag,
  correct exit codes, and passing `warnings` through `--json` if that payload is
  hand-built. New subcommands = deviation report.
- R4 must not create `.github/copilot-instructions.md` in this repo — that path is a
  compile output and an importer fixture.

### 4.11 Branch-aware graph (R4 · U3)

- `git_head_watch(root)` reads `<root>/.git/HEAD`, arms one non-recursive notify watch on
  the resolved git dir filtered to `HEAD` (200 ms debounce, one watch per app in
  `GitState`, replacing any previous), and returns the current `GitHead`.
- `<root>/.git` may be a **file** containing `gitdir: <abs path>` — Cowtext's own
  `worktree_add` produces exactly this. Follow **one** level of indirection. Second and
  last sanctioned out-of-root read, read-only.
- Not a repo → `is_repo:false`, no watch, no error, feature silent.
- On `git://head`: `src/store/git.ts` calls `useGraphStore.getState().loadGraph(root)`,
  then runs a drift check (`compile_preview` in memory; collect files with
  `unchanged === false`). `App.tsx` renders a branch chip plus an amber "compiled output
  does not match this branch's graph" warning listing drifted paths. No header hash (D6).

---

## 5. Lane grid — exclusive file zones

Eight build lanes plus the standard close-out lane (7 → 8 under A1: role semantics forced
`compile.rs` into a dedicated single-owner lane and pushed the importer out). Zones are
exclusive; `lib.rs` is the only shared file and it is append-only under §3.1.
**No tech-barn lane** — `src/scene/**` is frozen (L1-first).

| Lane | Agent | Scope | File zone (exclusive) |
|---|---|---|---|
| **R1 — hierarchy & resolved context** | tech-general | §4.2, §4.6; commands 55–56 | `src-tauri/src/hierarchy.rs` + `hierarchy/tests.rs` *(new)* · `src-tauri/src/resolve.rs` + `resolve/tests.rs` *(new)* · `lib.rs` **shared-append** (lands first, adds the trailing comma) |
| **R2 — link manager** | tech-general | §4.3; commands 57–59; `.cowtext/links.json` | `src-tauri/src/links.rs` + `links/tests.rs` *(new)* · `lib.rs` **shared-append** |
| **R3 — compile semantics** | tech-general | §4.1 role emission · §4.4 skill artifact · `warnings` field · `classify_output` → `pub(crate)` + `is_compile_output`. **No new commands, does not touch `lib.rs`** | `src-tauri/src/compile.rs` · `src-tauri/src/compile/roles.rs` *(new)* · `src-tauri/src/compile/tests.rs` |
| **R4 — branch, loadouts, CI** | tech-general | §4.8 (Rust half), §4.10, §4.11; commands 60–62; event `git://head` | `src-tauri/src/git.rs` + `git/tests.rs` *(new)* · `src-tauri/src/loadouts.rs` + `loadouts/tests.rs` *(new)* · `src-tauri/src/bin/cowtext_cli.rs` *(narrow, §4.10)* · `.github/**` · `lib.rs` **shared-append** + the one `setup` line |
| **R5 — round-trip import & fidelity** | tech-general | §4.5: copilot/gemini/mdc parse-back, managed+provenance detection, delete the duplicate allowlist, D18 substitute (coercion warnings + `import_apply` refusal). **Runs after R3** | `src-tauri/src/import.rs` + `import/tests.rs` · `src-tauri/src/lint.rs` + `lint/tests.rs` · `src-tauri/src/project.rs` + `project/tests.rs` **(coercion reporting only — no enum widening, no other edit)** |
| **U1 — context & compile UI** | tech-ui | Hierarchy panel, Resolved tab, role sections + warnings in the diff, skill-target checkbox + frontmatter-sync button, token totals (§4.7) | `src/context/**` *(new: `ContextModal.tsx`, `HierarchyPanel.tsx`, `ResolvedPreview.tsx`, `api.ts`, `types.ts`)* · `src/compile/**` · `src/store/tokens.ts` · `src/inspector/Inspector.tsx` **(Assemble token lines only — nothing else in that file)** |
| **U2 — loadouts & starter packs UI** | tech-ui | §4.8 UI, §4.9 | `src/loadouts/**` *(new)* · `src/store/loadouts.ts` *(new)* · `src/store/graph.ts` **(exactly the `applyPinSet` action — no other edit)** · `src/preset/**` |
| **U3 — links, branch & shell wiring** | tech-ui | §4.3 UI, §4.11 UI, all modal wiring | `src/links/**` *(new)* · `src/store/links.ts` *(new)* · `src/store/git.ts` *(new)* · `src/App.tsx` |
| **P1 — docs close-out** | project-manager | Invoke 54→62, events 4→5, role-emission terms, new modules/sidecars, Status line, `docs/testing/WO04_TEST_MANUAL.md` | `docs/**` *(except `docs/design/WO04_*.md` — tech-lead)* · `CLAUDE.md` · `README.md` · `.claude/skills/cowtext-terminology/**` |

**Overlap audit.** `src-tauri/src/`: R1 `hierarchy*`+`resolve*` · R2 `links*` · R3
`compile*` (incl. `compile/roles.rs`, `compile/tests.rs`) · R4 `git*`+`loadouts*`+`bin/` ·
R5 `import*`+`lint*`+`project*`. `lib.rs` shared-append. `agents.rs`, `frontmatter.rs`,
`preset.rs`, `watcher.rs`, `tasks.rs`, `sessions.rs`, `hooks*`, `assemble.rs`,
`settings.rs`, `handoff.rs`, `worktree.rs` — **nobody**. `src/store/`: U1 `tokens.ts` ·
U2 `loadouts.ts`+`graph.ts` · U3 `links.ts`+`git.ts`; the rest — nobody. `src/`: U1
`context/`+`compile/`+`inspector/Inspector.tsx` · U2 `loadouts/`+`preset/` · U3
`links/`+`App.tsx`; `canvas/`, `agents/`, `wizard/`, `scene/`, `tasks/`, `settings/`,
`handoff/`, `sessions/`, `review/`, `import/`, `lint/`, `ui/`, `identity/`, `fs/`,
`assemble/`, other `inspector/*` — nobody.

**Frozen cross-lane interfaces** (so lanes never need to talk):

```ts
// U1 exports; U3 lazy-imports and mounts in App.tsx
export function ContextModal(props: { open: boolean; onClose: () => void }): JSX.Element;
// U2 exports; U3 lazy-imports and mounts in App.tsx
export function LoadoutsModal(props: { open: boolean; onClose: () => void }): JSX.Element;
// U3 exports; U1 calls after a successful compile_write
export function reconcileLinks(root: string): Promise<LinkReport[]>;
```

```rust
// R3 exports; R5 consumes (replaces import.rs's deleted local copy)
pub(crate) fn classify_output(rel: &str) -> Option<bool>;
pub(crate) fn is_compile_output(rel: &str) -> bool;
```

---

## 6. Sequencing

1. **R1 first** — it opens the `lib.rs` append region (trailing-comma fix). R2/R3/R4 may
   be *written* in parallel; they *land* after R1's `lib.rs` touch so the shared region
   stays a pure append.
2. **R3 before R5** — R5 deletes `is_compile_output_path` and calls R3's newly
   `pub(crate)` `is_compile_output`. Hard dependency, single direction.
3. **R3 before U1's gate** — role sections, the skill checkbox and the `warnings` field
   must exist before the Compile modal renders them.
4. **R2 before U3's gate**; **R4 before U2's and U3's gates** — TS `invoke` names must
   resolve against a landed handler list.
5. **U3 before U1's gate** — `reconcileLinks` must exist before `CompileModal` imports it.
6. **U2 independent** of U1/U3 once R4 has landed.
7. **P1 last**, after every merge. Then tech-lead adversarial audit → defect round by the
   owning lanes → tester re-runs all gates.

---

## 7. Acceptance gates

Standard stack:

| # | Gate | Owner |
|---|---|---|
| 1 | `cargo clippy --all-targets -- -D warnings` clean from `src-tauri/` | R1–R5 |
| 2 | `cargo test` green; `hierarchy.rs`, `resolve.rs`, `links.rs`, `git.rs`, `loadouts.rs` join the tested modules with ≥ 6 tests each | R1–R5 |
| 3 | `npm run build` (tsc strict, no unused, no `any`) clean | U1–U3 |
| 4 | `npm run lint` clean | U1–U3 |
| 5 | Invoke contract **62/62 byte-exact** across `generate_handler!`, `docs/TERMINOLOGY.md`, `cowtext-terminology` skill | R1/R2/R4 + P1 |
| 6 | Events **5/5** documented; `git://head` payload matches `GitHead` field-for-field | R4 + P1 |
| 7 | `GRAPH_VERSION === 3`; `git diff src/store/graph.ts` shows the `applyPinSet` action **and nothing else** | tech-lead audit |

Role-semantics gates (A1 — blocking):

| # | Gate | Owner |
|---|---|---|
| 8 | **Legacy byte identity.** A graph using only the 7 pre-WO03 roles, plus one node with an unrecognized role string, plus one `style` node, compiles byte-identically to `605760e` for all five targets. WO03's golden files are unmodified in the diff | R3 + tech-lead audit |
| 9 | **All-13-roles goldens.** A fixture with one node per role produces committed goldens for `claude`, `agents`, `copilot`, `gemini`, `cursor`, and the skill block; section order is `Commands, Invariants, Traps, Snippets`; nodes inside a section are in `(readOrder, id)` order | R3 |
| 10 | **Line-ending invariance.** The gate-9 fixture with CRLF line endings in every node file compiles byte-identically to the LF version | R3 |
| 11 | **Inline cap.** An 8193-byte `invariant` node is linked, not inlined, and produces exactly one warning; an 8192-byte one is inlined | R3 |
| 12 | **Artifact gating.** With the `skill` target OFF, a pinned `skill` node still appears in `## Always read`; with it ON it appears only in `SKILL.md` | R3 |
| 13 | **Ordering invariance.** For the gate-9 fixture, `total_order` and `effective_pinned` are identical with and without role policy applied (assert against the pre-WO04 values) | R3 |
| 14 | **Allowlist consolidation.** `rg "is_compile_output_path" src-tauri/` returns nothing; one test asserts `is_compile_output` accepts all six shapes incl. `.claude/skills/x/SKILL.md` and refuses the WO03 near-miss corpus | R3 + R5 |
| 15 | **Unknown-enum substitute.** A graph with `role:"referance"`, `kind:"blesses"`, `compileTargets:["windsurf"]` — `compile_preview` succeeds and output is unchanged; `lint_run` reports three `UnknownEnumValue` warnings; `import_apply` refuses with a message naming them | R5 |

WO04-specific fixtures:

| # | Gate | Owner |
|---|---|---|
| 16 | **Hierarchy fixture tree + expected-winner table** (below) passes with an injected global | R1 |
| 17 | **Round-trip import**: compile the gate-9 fixture to all six targets → `import_scan` proposes **zero** nodes, reports every emitted file as managed, and does not propose inlined role content as new nodes | R5 |
| 18 | **NTFS symlink-fallback walk** (6 steps, below) — manual, on real NTFS | tester |
| 19 | **GitHub Action dry-run**: the workflow's exact command sequence on a clean clone against `.github/fixtures/ci-demo/` — exit **0** pristine, exit **1** after mutating the fixture's `CLAUDE.md` | R4 + tester |
| 20 | **Link ↔ compile reconciliation**: apply a link → `compile_write` over the pair → `link_status` reports `healthy:false` with the severed-by-atomic-write detail → `link_apply` repairs | R2 + tester |
| 21 | **Loadouts round-trip**: capture → switch → apply → `graph.json` matches the snapshot byte-for-byte; a loadout naming a deleted node applies cleanly and keeps the stale id | R4 + U2 |
| 22 | **Resolved preview honesty**: a 3-level import chain resolves to a hand-assembled expectation, each file appears once, tokens `== ceil(bytes/4)`, and inlined role content is not double-expanded | R1 |
| 23 | Branch walk: `git checkout -b wo04-test` → chip updates without a restart; edit the graph, don't compile, switch branches → drift warning names the stale files | tester |

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

1. Developer Mode **ON** → apply → `mode:"symlink"`, healthy, `degraded:false`; `dir`
   shows `<SYMLINK>` and the target is **relative**.
2. Developer Mode **OFF**, non-elevated → symlink fails (1314) → `mode:"hardlink"`,
   healthy; `fsutil hardlink list AGENTS.md` lists both names.
3. Project on an exFAT/other volume → hardlink fails → `allowCopy:false` errors naming
   both failures; `allowCopy:true` → `mode:"copy"`, `degraded:true`, stale warning present.
4. Compile over the mirror → unhealthy → `link_apply` repairs (gate 20).
5. Hand-written mirror without a GENERATED header → apply refuses; file byte-identical
   before and after.
6. Symlink created, master deleted → unhealthy → `link_remove` leaves **no** dangling link
   and **no** zero-byte file; with a healthy link it leaves an independent copy.

Not gates: Marty's acceptance walk, and any WO05+ surface.

---

## 8. Deferred (explicitly NOT WO04)

| Item | Owner |
|---|---|
| Usage heatmap, event persistence, Reality Check drift lint, dead-node report, unmapped-read adopt, `cowtext-hook` shim, sprites/GIF/moo, quota tracker | **WO05** |
| GENERATED-header content hash / tamper detection (FEATURES 4.8) | **WO05** |
| 6 barn accent hues for the WO03 roles (audit O1) | **WO05**, with the sprites work |
| `Other(String)` unknown-enum preservation (audit D6 follow-up) | **WO06**, trigger: a second Rust writer of `graph.json` (D18) |
| Task DAG, tasklinks sidecar, per-task subgraph injection, compile-on-launch, token ceilings, session attribution, handoff→node | **WO06** |
| Role-filtered subgraph injection (the *other* half of audit O2) | **WO06** — WO04 makes roles change the artifact; WO06 makes them select the artifact |
| Heartbeats, event triggers, approval gates, permission grids, squads, auto-promote, revisioned config, workflow packs | **WO07** |
| Prebuilt `cowtext-cli` binaries published to Releases; MCP/plugin/packages | **WO08** |
| Writing or compiling into `~/.claude/CLAUDE.md` (global scope *management*) | unscheduled — WO04 is read-only global (D10) |
| Directory-level junction mirrors (e.g. `.cursor/rules`) | unscheduled (D1) |
| `packed-refs` parsing, git status/diff surfaces | unscheduled (D11) |
| Unifying the two cycle detectors | **never** — permanently ratified duplication (D17) |
| A per-role behaviour for `style` | **rejected** (D14) |
| Loadout `compileTargets` overrides | **rejected** (D9) |
| Conditional tester (FEATURES 4.9), compile-to-clipboard (4.7), `.cowtext/history/` revert (4.10), `duplicate-id` lint (audit O3) | unscheduled |
| Any `src/scene/**` work | **WO05** |
