# WO06 Contract — L2 Orchestrator Suite (frozen)

**Work order 06** · drafted 2026-08-19 · dispatcher: `/ultracode` · author: tech-lead
**Baseline:** 54 invoke commands · 4 Tauri events · 13 node roles · 7 edge kinds · BarnGraph **v3**
**After WO06:** **63** invoke commands · **4** Tauri events (one new `kind` value on `agent://event`) · graph **still v3**

> **Frozen once Stage 0 starts.** A lane that finds this contract wrong stops, states the
> failing assumption, and reports (§14). Nothing here may be re-interpreted mid-flight.
> Companions: [`WO03_CONTRACT.md`](WO03_CONTRACT.md) (graph v3, still normative),
> [`WO03_AUDIT.md`](WO03_AUDIT.md) (§4.1/§4.2 rulings, still normative).

**Sequencing deviation, ratified up front:** ROADMAP.md sequences WO06 *after* WO05. WO06 runs
now instead. The one WO06 item that genuinely depends on WO05 — session-to-node attribution —
is cut (§2.3). Everything else in this work order is independent of the proof layer.

---

## 1. Must-NOT-break (read first, every lane)

Carried forward from WO03, still binding:

1. **Byte-identity frontmatter** — `src-tauri/src/frontmatter.rs` and `src-tauri/src/agents.rs`
   are outside every zone. Nobody opens them. No lane needs them.
2. **Deterministic compile** — `compile.rs` is **FROZEN this work order** (§4.4). Zero edits.
   Every one of the five targets must emit byte-identical output before and after WO06.
3. **Never-clobber** — no new command overwrites an existing file it did not create.
   `task_context_write` overwrites only its own `.cowtext/context/task-*.md`.
4. **Preset round-trip** — untouched; `preset.rs` is in no zone.
5. **Write allowlist + GENERATED header** — never weakened, never widened. `compile_write`
   keeps exactly today's five output shapes. The task-context writer has its **own, disjoint**
   allowlist (§4.5) and is not part of compile's.
6. **Invoke-contract byte-exactness** — 63/63 across `generate_handler!`, `docs/TERMINOLOGY.md`
   and `.claude/skills/cowtext-terminology/SKILL.md`.
7. **Errors XOR payload** — holds for `task_context_preview` (`errors` non-empty ⇒ `body == ""`
   and `nodeIds == []`) exactly as it holds for `compile_preview`.

New to WO06, equally binding:

8. **The existing board keeps parsing every current task file, unchanged.** Every task in the
   repo's own five convention files, and every foreign table/checklist, must produce a
   byte-identical `TaskItem` before any id is minted — the two new fields simply default empty.
   Gate 10.
9. **A task-scoped compiled context can never overwrite a compile output.** Structural, not
   procedural: two disjoint allowlists, enforced in both directions by Gate 9. This is the
   WO03-D2 data-loss class and it does not get to happen twice.
10. **Reserved tag tokens survive every write path.** `id:` / `needs:` are owned by Rust and
    re-emitted from the line being rewritten. No TypeScript caller can drop them (§3.1).
11. **`agent://event` is shape-stable.** No field added, no field removed, no change to the
    cardinality or ordering of any existing `kind`. One new `kind` value only (§5.4).
12. **Rust never writes `graph.json` in WO06.** The store stays authoritative. This is the
    WO03-D1 class (`import_apply` wrote the graph, the store clobbered it 700 ms later);
    WO06 uses the proposal pattern instead (§6).
13. **`graph.json` stays version 3.** No node role, no edge kind, no node/edge field, no
    `compileTargets` value. `src/store/graph.ts` and `src-tauri/src/project.rs` are in **no**
    lane's zone (§10). Provenance rides the existing `meta` map, which WO03 explicitly reserved
    for exactly this ("scalars never force a v4", `WO03_CONTRACT.md:29`, `graph.ts:82-85`).
14. **Budget off ⇒ byte-identical session behaviour.** With no ceiling, `run_turn` does what it
    does today, event for event.
15. **Determinism is sacred.** `(graph.json, tasklinks.json, taskId)` → byte-identical task
    context, every run, on every platform. Gate 8 pins it with a golden file.
16. **No new libraries.** No `rand`, no graph crate, no YAML crate. No change to
    `src-tauri/capabilities/default.json` — every new command is a core invoke.

---

## 2. Scope

### 2.1 The hierarchy — read this before designing anything

The orchestrator layer is **commoditized**. Chorus, Nimbalyst and Multica ship kanban plus
worktrees for free. Cowtext does not compete there and this work order must not try to.

**The differentiator is §4: per-task subgraph injection.** A task pulls exactly the subgraph of
Memory Nodes it needs, and the agent session for that task launches with a context compiled for
that task alone. Nobody else can do this because nobody else has the graph.

Everything else in WO06 exists to make §4 possible:

| # | Item | Why it exists | §
|---|---|---|---|
| **1** | **Per-task subgraph injection + compile-on-launch** | **THE feature** | **§4** |
| 2 | Tasklinks sidecar (task ↔ nodes ↔ sessions ↔ parent) | §4 needs somewhere to store "which nodes does this task need" | §3.2 |
| 3 | Stable task ids | §3.2 needs a key that survives a line moving | §3.1 |
| 4 | Task DAG / dependencies | scheduling: which task is launchable; also the natural home for `needs:` next to `id:` | §3.3 |
| 5 | Token ceilings with atomic hard-stop | a per-task session that runs away costs real money | §5 |
| 6 | Handoff → node | closes the loop: the session's outcome re-enters the graph | §6 |
| 7 | Barn mission control | ambient read-out of 5 and 1 | §10 lane B1 |
| 8 | O1 / O2 / O3 board defects | the board is the surface all of this is driven from | §11 |

Lane reports must keep this order visible. If §4 is at risk, lanes 4–8 get cut, not §4.

### 2.2 Not in scope (and why)

- Any change to `compile.rs`, `project.rs`, `agents.rs`, `frontmatter.rs`, `preset.rs`,
  `import.rs`, `lint.rs`, `hooks*.rs`, `watcher.rs`, `assemble.rs`, `src/store/graph.ts`,
  `src/canvas/**`, `src/compile/**`, `src-tauri/src/bin/cowtext_cli.rs`.
- New CLI flags for `claude`. `HEADLESS_ARGS` is documented as the only place those flags are
  written (`sessions.rs:35-39`) and every flag must first pass the `--help` probe
  (`REQUIRED_FLAGS`). Adding `--append-system-prompt` means extending the probe contract and
  risks bricking every session on a CLI build that lacks it. **RULED: no new CLI flags.**
  Deferred to WO07 with a probe extension.
- New SFX assets or sprites. Assets are Marty-side.

### 2.3 Explicitly deferred out of WO06 — session-to-node attribution

Recording *which rules were live for a given run* requires persisted hook events. Hook events
are currently fire-and-forget (`hooks_server.rs` → `emit` → in-memory `useEventsStore`); nothing
writes them to disk. Persistence is **WO05's proof layer** and does not exist yet. Building
attribution on top of an in-memory ring buffer would produce a claim Cowtext cannot back up —
which is worse than not making it. **Moves to WO05**, where the event store lands.

---

## 3. Data model

### 3.1 Stable task ids — reserved tag namespace (RULED, with the parser evidence)

The plan proposed `id:t-xxxxxx` in the Tags column. I validated it against the real parser and
it holds, with **one mandatory correction** that the plan did not anticipate.

**What holds:**

- `split_tags` (`tasks.rs:429-435`) splits a Tags cell on `,` and whitespace only. `id:t-a1b2c3`
  contains neither, so it survives the table scan intact.
- `extract_tokens` (`tasks.rs:513-553`) strips `#` then `trim_matches` non-alphanumeric
  characters **at the ends only**; an interior `:` is untouched. So `#id:t-a1b2c3` in a
  checklist line yields the tag string `id:t-a1b2c3` — the *same* string as the table form.
  One token spelling, both sources.
- `pipe_cells` is unaffected (no `|`), `is_separator_row` is unaffected, `map_columns` is
  unaffected.

**What does NOT hold, and is the correction:** the token is not line-surgery-safe as a plain
tag. `regenerate_table_row` (`:848`) and `regenerate_checklist_line` (`:725-733`) rewrite the
tags from `TaskPatch.tags` verbatim. The Inspector must hide `id:…` from the user's tag chips
(otherwise it is a visible junk chip in `TagPicker`, which also feeds `allTags()`), and the
moment it hides it, the next `task_update` drops it. **A task would lose its identity on the
first edit.** That is a silent data-loss path and it is not acceptable.

**RULING — reserved tag namespace, owned by Rust:**

| Rule | Statement |
|---|---|
| R1 | Two reserved prefixes: **`id:`** (at most one per task) and **`needs:`** (repeatable). Table form: bare token in the Tags cell. Checklist form: `#id:…` / `#needs:…`. |
| R2 | `parse_tasks` **lifts** reserved tokens out of `tags` into `TaskItem.task_id` and `TaskItem.depends_on`. `TaskItem.tags` never contains a reserved token, so no UI change is needed to hide them and no UI can drop them. |
| R3 | **`TaskPatch.tags` may never carry a reserved token.** A patch that does is rejected: `Err("reserved tag prefix in patch.tags: <token>")`. |
| R4 | Every write path re-emits the reserved tokens **from the line it is rewriting** (`task_update`) or **from the source item** (`task_move`), never from the patch. Order inside the Tags cell is frozen: `id:` first, then each `needs:` sorted byte-order, then the user tags in their existing order. |
| R5 | Id grammar: `^t-[0-9a-z]{6}$` (base36, lower-case). Nothing else is an id. |
| R6 | **`TaskItem.id` (`"<relPath>#<line>"`) is a volatile locator and keeps its meaning exactly. `TaskItem.taskId` is the stable id. They are never conflated, never substituted for one another, and `tasklinks.json` keys only on `taskId`.** |

**Why not an `Id` column?** Because `set_cell` (`tasks.rs:812-819`) returns early when the
column is unmapped. Cowtext cannot write an id into any table that does not already have the
column, and restructuring a user's table would violate byte-exact cell preservation. The Tags
column is present in every canonical grid and in most foreign tables, and the checklist form
already has a `#tag` slot. The reserved namespace is the only mechanism that works uniformly
across both sources. This is settled; do not revisit it in a lane.

**Minting (`task_id_ensure`), frozen:**

1. If the line already carries an `id:` token, return the item unchanged (idempotent, no write).
2. If the target is a table row whose header maps **no Tags column**, fail with
   `Err("<relPath>#<line>: this table has no Tags column — add one, or move the task to a canonical grid")`. Never silently succeed, never add a column.
3. Mint: `h = fnv1a64(now_nanos ^ process_counter ^ rel_path_bytes ^ line)`, `h % 36^6`,
   rendered base36 zero-padded to 6 chars, prefixed `t-`. No new dependency.
4. Collision check: scan **all five convention files** for existing `id:` tokens; retry up to
   16 times; then `Err("could not mint a unique task id")`.
5. Write via the same line-surgery path as `task_update` (only the Tags cell / the tag run of
   the checklist line changes; every other byte of the line is preserved).

**No auto-mint.** `task_append` and `task_move` never mint. Ids appear only when the user first
links a task to something. Rationale: auto-minting pollutes every task file with ids nobody
uses and makes `task_append` non-deterministic.

**Scan-time duplicates are reported, never repaired.** Two rows with the same `id:` both keep
it; both appear in `TasksScan.dag.duplicateIds`; `tasklinks` resolution refuses to bind a
duplicated id and the UI shows the warning. Cowtext does not rewrite a user's file to fix an
id collision. (Same posture as WO03-D6's ruling: report, do not refuse to run.)

### 3.2 `.cowtext/tasklinks.json` — v1 sidecar

```jsonc
{
  "version": 1,
  "links": [
    {
      "taskId": "t-a1b2c3",
      "nodeIds": ["m1abc-x9", "m2def-k1"],
      "sessionIds": ["9f3c…-uuid"],
      "parentTaskId": "t-000001",
      "tokenCeiling": 200000
    }
  ]
}
```

| Rule | Statement |
|---|---|
| L1 | **Written only by Rust.** No TypeScript writer, ever. This structurally removes the WO03-D5 class (Rust `String::cmp` vs TS `localeCompare` producing churn on a git-tracked file). |
| L2 | Deterministic: `links` sorted by `taskId` with `String::cmp` (byte order); `nodeIds` and `sessionIds` sorted byte-order and deduped; absent optionals omitted (`skip_serializing_if`); `serde_json::to_string_pretty` + one trailing `\n`; written through `project::write_atomic`. |
| L3 | **`sessionIds` holds `claudeSessionId` values (the durable UUID from the stream's `system/init` line) — never Cowtext's in-memory `as<N>` ids**, which are reassigned from zero on every app start. A builder will get this wrong if it is not stated. |
| L4 | `parentTaskId` is goal ancestry (Paperclip-style), not a dependency. Ancestry cycles are rejected by `tasklink_set` and depth is capped at 8. |
| L5 | `tokenCeiling` absent or `0` ⇒ no per-task ceiling; the global default applies (§5.1). |
| L6 | Tolerant read: a missing file reads as `{version:1, links:[]}`; unknown JSON fields are dropped on rewrite (app-owned file in a dot-directory — documented, not a bug). A `version` > 1 is a hard `Err` (forward-compat guard), matching the graph loader's posture. |
| L7 | `.cowtext/` is a dot-directory, so `project.rs::is_scannable_md` never matches it and no `fs://change` fires. Mutations therefore reach the UI **only through the command's return value** (§8). |

### 3.3 Task DAG

`TaskItem` gains three fields, **appended last** (after `when`):

```rust
/// Stable task id lifted out of the Tags cell (§3.1). None until minted.
pub task_id: Option<String>,
/// Stable ids this task depends on, lifted from `needs:` tokens. Order as written.
pub depends_on: Vec<String>,
/// SCAN-ONLY: any dependency resolves to a task whose status != "done".
/// ALWAYS `false` from the single-file commands (toggle/update/append/move) —
/// they cannot see the other four files. Only `tasks_scan` computes it.
pub blocked: bool,
```

`TasksScan` gains one field, **appended last**:

```rust
pub dag: TaskDag,

pub struct TaskDag {
    /// Each entry is a task-id cycle path with the first id repeated last —
    /// same convention as compile.rs's `ValidationError::Cycle`.
    pub cycles: Vec<Vec<String>>,
    pub duplicate_ids: Vec<String>,
    pub unresolved: Vec<UnresolvedDep>,   // { taskId, dependsOn }
}
```

| Rule | Statement |
|---|---|
| D1 | `blocked = depends_on.iter().any(|d| resolved(d).is_some_and(\|t\| t.status != "done"))`. An **unresolved** dependency does NOT block; it is reported in `dag.unresolved`. Rationale: a typo must not deadlock the board. |
| D2 | A cycle in the dependency graph is **reported, never fatal**. `tasks_scan` always succeeds; cycles land in `dag.cycles`; tasks in a cycle are reported `blocked: true`. |
| D3 | `task_depends_add` **rejects** an edge that would create a cycle, a self-dependency, an id that matches no task, and an id that is in `duplicate_ids`. Four distinct error messages. |
| D4 | Cycle detection is a **third** implementation (after `compile.rs:577-626` and `lint.rs:233-291`), over a third type (`TaskItem`). **Ratified up front on the same type-boundary grounds WO03-§4.6 used**, and subject to the same condition: it must use the identical deterministic walk (smallest-id first, stable tie-break) and Gate 5 must pin its determinism. It is not unified with the other two. |
| D5 | The DAG is derived at scan time. There is no persisted DAG. Dependencies live in the markdown and nowhere else — that is what makes them survive a round-trip and remain human-editable. |

### 3.4 No `graph.json` bump — RULED

`GRAPH_VERSION` stays **3**. v3 landed one work order ago; a v4 for a sidecar-shaped concern
would be pure cost. Everything WO06 needs is already available:

- task↔node linkage → `tasklinks.json` (a sidecar, versioned independently, git-friendly).
- handoff provenance → the existing `MemoryNode.meta` map, which WO03 reserved for exactly this
  and documented as "scalars never force a v4".

A lane that believes it needs a graph field **stops and reports**. Inventing one mid-flight is
an automatic reject (WO02 §9 precedent).

---

## 4. Per-task subgraph injection — the differentiator

### 4.1 Closure rule (RULED — this is the decision that matters most)

Given `seeds = tasklinks[taskId].nodeIds`:

```
ancestry = nodeIds of every task reachable via parentTaskId (depth ≤ 8, cycle ⇒ error)
base     = seeds ∪ ancestry ∪ { every node with pinned == true }
effective= transitive closure of `base` over `imports` edges only
edges    = every edge of the full graph whose BOTH endpoints are in `effective`
```

| Decision | Ruling and one-line rationale |
|---|---|
| `imports` closure | **IN.** `imports` means "this node's content is part of mine"; dropping the target yields a context with a dangling reference. Same relation compile's `effective_pinned` closes over — one closure rule in the product. |
| Globally `pinned` nodes | **IN, always.** Pinned means always-in-context. A task context that silently drops the project's hard rules produces an agent that does not know them. This is the single most important safety property of the feature. |
| `overrides` | **NOT closed over** — precedence, not inclusion (WO03 §4.2, normative). Kept as an edge when both ends are already in `effective`, so ordering stays right. |
| `sequence`, `references`, `conditional`, `supersedes`, `conflicts-with` | **NOT closed over.** |
| Task **dependencies** (`needs:`) | **Contribute NOTHING.** A dependency is a scheduling relation, not a context relation; pulling a dependency's nodes in would balloon the context — the exact opposite of the feature's point. A builder could easily get this wrong. |
| Parent **ancestry** (`parentTaskId`) | **Contributes nodes.** That is what goal ancestry is for: a subtask inherits its parent goal's context. Depth cap 8; a cycle is a `ParentCycle` error, not a silent truncation. |
| Induced-edge rule | Both-endpoints-in-set ⇒ `compile_preview` can never report a `DanglingEdge` for a task subgraph. Deliberate. |
| Determinism | Traversal order is irrelevant: compile re-sorts by Kahn `(readOrder, id)`. Seeds are sorted byte-order before closure anyway. |
| Empty result | `effective` empty ⇒ `TaskContextError::EmptySubgraph`, `body == ""`. Never compile an empty graph. |

### 4.2 Compilation — reuse, do not reimplement

`taskctx.rs` synthesizes a **subgraph JSON string** and calls the existing headless entry point:

```rust
crate::compile::compile_preview(root.clone(), subgraph_json)   // pub fn, already callable (WO03 Lane C)
```

The synthesized JSON is a full `BarnGraph` v3 document containing only `effective` nodes and
induced edges, with:

- `"version": 3`
- `"projectName": "<real projectName or root dir name> · task <taskId>"` — so the compiled file
  self-identifies in its own title line. This is the **only** transform applied; compile's
  output bytes are then taken **verbatim**.
- `"compileTargets": ["claude"]` — forced, regardless of what the project's graph says.

From the returned `CompilePreview`:

- `errors` non-empty ⇒ map to `TaskContextError` and return with `body == ""` (errors XOR body).
- Otherwise take **exactly one** `PreviewFile`: the one with `target == "claude"` and
  `relPath == "CLAUDE.md"`. **Every other preview file is discarded**, including any
  `target == "agent"` file for an `agent`-role node in the subgraph. If that one file is absent,
  return `TaskContextError::EmptySubgraph`.
- `oldContent`, `handwritten` and `unchanged` are read and discarded — they describe the
  project's real `CLAUDE.md`, which is none of this feature's business.

The body therefore carries the GENERATED header on line 1, unmodified. Do not prepend anything.

### 4.3 Delivery — boot-prompt injection (RULED)

**The compiled context is handed to the session through the boot prompt, over stdin. Nothing is
written into the worktree.**

`agent_session_spawn` gains `task_context: Option<String>` (the already-compiled body, produced
by the frontend calling `task_context_preview` first). `build_boot_prompt` inserts it after the
agent-file body and before `BOOT_PROMPT_TAIL`:

```
--- BEGIN TASK CONTEXT (Cowtext, task <taskId>) ---
<body>
--- END TASK CONTEXT ---
```

- Cap `TASK_CONTEXT_MAX_BYTES = 32 * 1024`, truncated with the existing
  `truncate_at_char_boundary`, followed by the literal line
  `[truncated at 32768 bytes — open the task context in Cowtext for the full text]`.
- **`task_id.is_some()` with `task_context` absent or empty ⇒ `agent_session_spawn` returns
  `Err`.** Silently launching a task session with no task context is precisely the failure this
  feature exists to prevent, and a wasted real agent turn costs money.

**Why the frontend pre-compiles instead of `sessions.rs` calling `taskctx`:** it lets the user
*see* exactly what the session will receive before spending a turn, it keeps `sessions.rs` free
of any dependency on `taskctx.rs`/`compile.rs` (lanes G3 and G2 become fully independent), and
compile errors surface in a modal instead of as a spawn failure.

**Stated limitation, on the record:** a git worktree of the same repo still contains the
project's real `CLAUDE.md`, which Claude Code auto-loads. The task context is therefore
*authoritative and additive*, not *exclusive* — the injected block says so in its own header
line. Full suppression would require either writing into the worktree (the data-loss path
§1.9 forbids) or a CLI flag that does not exist (§2.2). Do not claim exclusivity in UI copy.

### 4.4 `compile.rs` is FROZEN

Zero edits. Everything taskctx needs is already `pub`: `compile` is `pub mod` (`lib.rs:13`),
`compile_preview` is `pub fn` (`compile.rs:272`), `GENERATED_HEADER` is `pub const`
(`compile.rs:57`). Gate 9's disjointness assertion is written against `compile_write`
(also `pub fn`) so it needs no visibility change either. `compile.rs` appears in **no** lane's
zone; it is not a hot file this work order.

### 4.5 Where the file lands, and its own allowlist

The durable artifact is optional and explicit — `task_context_write`, invoked when the user
asks to save. Path:

```
.cowtext/context/task-<taskId>.md
```

```rust
/// The ONLY path shape `task_context_write` will ever produce. Derived from
/// `task_id` server-side — the caller does NOT supply a path.
fn task_context_rel_path(task_id: &str) -> Result<String, String>
```

- `task_id` must match `^t-[0-9a-z]{6}$` or it is rejected. No caller-supplied path, no
  traversal surface, no way to name a file that is not `task-t-xxxxxx.md`.
- The content must carry the GENERATED header on line 1 or it is rejected.
- **Disjointness, both directions, gated (Gate 9):** `classify_output` (`compile.rs:780-799`)
  matches only `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`,
  `GEMINI.md` and `.claude/agents/*.md` — none of which can ever start with `.cowtext/`.
  Conversely `task_context_write` cannot emit any of those six shapes.
- **Cleanup: none needed.** No temp files, no worktree writes. The write is idempotent and
  deterministic — re-running produces byte-identical content. `.cowtext/context/` is app-owned
  scratch inside an already-app-owned dot-directory. The docs close-out recommends
  gitignoring it; **no code writes a `.gitignore`** (trust boundary).

---

## 5. Token ceilings with atomic hard-stop

### 5.1 Where a budget is configured

| Level | Home | Owner |
|---|---|---|
| Global default | `AppSettings.sessionTokenCeiling: number`, **appended last**, `version` stays `1` (tolerant merge), **default `0` = unlimited** | `src/store/settings.ts` (U3) |
| Per task | `tasklinks[taskId].tokenCeiling?: number` | `.cowtext/tasklinks.json` (G2) |
| Effective | per-task ceiling if the session was spawned with a `taskId` whose link carries one, else the global default; `0`/absent ⇒ unlimited | computed **in the frontend**, passed to spawn |

**Default `0` (off) is deliberate.** A hard-stop that kills sessions by default, for users who
never asked for one, is a worse product than one you opt into.

`settings.rs` needs **no** change: the Rust side is shape-agnostic ("frontend owns shape").
`sessions.rs` needs **no** settings read and **no** tasklinks read: `agent_session_spawn` takes
`token_ceiling: Option<u64>` directly. Both cross-module dependencies disappear.

### 5.2 Accounting

`SessionEntry` gains `tokens_used: u64`, `turn_tokens: u64`, `token_ceiling: Option<u64>`,
`task_id: Option<String>`. `SessionInfo` gains `tokens_used: u64` and
`token_ceiling: Option<u64>`, appended last.

`map_line` gains a **non-emitted** field on `MappedLine`:

```rust
/// Usage observed on this line, for budget accounting ONLY. Populated from
/// BOTH the assistant-message usage block and the terminal `result` line.
/// Never turned into an `agent://event` — the emitted stream is unchanged
/// (see `map_line_assistant_usage_never_emits_a_usage_event`).
pub observed_usage: Option<Usage>,
```

This is what makes the stop *mid-turn* rather than end-of-turn: assistant lines already carry
usage today, they are just suppressed on the wire.

**Named assumption (audit-visible):** within a single turn, `total_tokens` observed on
successive lines is monotonically non-decreasing and describes *that turn*. So
`turn_tokens = observed_total.max(turn_tokens)` and `spent = tokens_used + turn_tokens`;
`finish_turn` folds `tokens_used += turn_tokens; turn_tokens = 0`. `cost_usd` is documented as a
conversation running total (`sessions.rs:93-102`) and is **not** used for budgeting. Gate 6
pins the two-turn accumulator. If a future CLI proves tokens are cumulative-across-resume, that
is a documented follow-up, not a silent miscount.

### 5.3 "Atomic", concretely

One new AppHandle-free method on `RegistryCore` — the same unit-testable shape as `register` /
`begin_send` / `begin_kill`:

```rust
enum ChargeVerdict {
    Ok,
    Stale,
    Stop { pid: Option<u32>, spent: u64, ceiling: u64 },
}
fn charge(&self, id: &str, generation: u64, observed_total: u64) -> ChargeVerdict
```

Inside **one** critical section over the registry mutex:

1. entry missing, or `entry.generation != generation` ⇒ `Stale` (mutate nothing).
2. `entry.turn_tokens = observed_total.max(entry.turn_tokens)`; `spent = tokens_used + turn_tokens`.
3. `ceiling` absent or `0` ⇒ `Ok`.
4. `spent >= ceiling` ⇒ `entry.generation += 1`, `entry.info.alive = false`, `entry.busy = false`,
   `pid = entry.child_pid.take()` ⇒ `Stop { … }`. Else `Ok`.

**The generation bump inside that same lock is the fence.** Every later emit and every later
registry mutation from that turn is already gated on the captured generation
(`generation_current`, `emit_gated`, `finish_turn`), so all of them become no-ops the instant
the lock is released. A second `charge` from the same turn sees a stale generation ⇒ `Stale`.
**Exactly one `Stop` per session, by construction, with no extra flag and no second lock.**

On `Stop`, `run_turn`:

1. emits — **ungated** (`app.emit` directly; `emit_gated` would swallow it, the generation was
   just bumped) — a `budget` event, then the existing `exit` event;
2. `kill_tree(pid).await`;
3. `return`s immediately. It does **not** call `finish_turn` (generation-gated, would no-op).

### 5.4 What reaches the UI — no new Tauri event

**RULED: `agent://event` gains exactly one `kind` value, `"budget"`. No fifth Tauri event.**

```jsonc
{ "id": "as2", "kind": "budget",
  "usage": { "inputTokens": …, "outputTokens": …, "totalTokens": 200431, "costUsd": … },
  "text": "token ceiling 200,000 reached — session stopped",
  "ts": 1755… }
```

No field is added to `AgentEvent`; `usage` and `text` already exist. The TS `AgentEventKind`
union widens by one member.

**Why not a new channel:** `RosterBar`, `AgentPanel`, the inspector transcript and the barn
already subscribe to `agent://event` and route on `kind`. A fifth channel would mean three new
subscriptions for one message. **Why not sniff the existing `error` text:** string-matching a
human-readable message is exactly the kind of tripwire WO03-D3 was written about.

**DAG changes need no event either.** `.cowtext/tasklinks.json` is inside a dot-directory the
watcher ignores (§3.2 L7), and the five task files already reach the board through `fs://change`
+ `isTaskFile`. Every tasklinks/DAG mutation returns the new state from its own command and the
store applies it (§8).

### 5.5 What the user sees

1. Roster card and Agent panel: a token gauge `used / ceiling`, amber, turning danger at ≥ 90%.
   Hidden entirely when the ceiling is `0`.
2. On a stop: the transcript shows the `budget` line in danger styling, the status dot goes
   dead, and the card shows **"Stopped: token ceiling reached"** with a **Restart** button
   (restart resets `tokens_used` to 0 — a restart is a new budget).
3. Barn: the stall's gauge empties and goes dark (§10 lane B1).

---

## 6. Handoff → node

`handoff_node_propose` is **deterministic and does not call an LLM.** `handoff_generate` already
exists for LLM prose; duplicating it here would add a failure mode to a graph-mutating flow. The
user runs Handoff first if they want prose, and passes it in as `summary`.

Input takes a **frontend-supplied session summary**, not a registry lookup — so `handoff.rs`
needs nothing from `sessions.rs` and the two lanes stay independent:

```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
pub struct HandoffSessionInput {
    pub id: String,
    pub name: String,
    pub agent_file_name: Option<String>,
    pub cwd: String,
    pub claude_session_id: Option<String>,
    pub tokens_used: u64,
}
```

Output is a **proposal**; Rust writes nothing:

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct HandoffNodeProposal {
    pub title: String,        // "Handoff — <session name> — <taskId or session id>"
    pub rel_path: String,     // "context/handoff/<slug>.md", collision-free (…-2, …-3)
    pub role: String,         // ALWAYS "reference"
    pub brief: String,        // one line, ≤ 120 chars
    pub content: String,      // provenance block + summary, LF, trailing newline
    pub meta: BTreeMap<String, String>,
    pub anchor_node_id: Option<String>,
}
```

`meta` (the WO03-reserved extension map — scalars only, sorted keys, no v4):

| Key | Value |
|---|---|
| `source` | `"handoff"` |
| `session` | `claudeSessionId` if present, else the `as<N>` id |
| `agent` | agent file stem, or `""` |
| `task` | the stable `taskId`, or `""` |
| `producedAt` | ISO-8601 UTC |
| `tokens` | decimal string |

`anchor_node_id` = the first entry of `tasklinks[taskId].nodeIds` (byte-order sorted), or `None`.

**The frontend commits it, using only existing store actions — `src/store/graph.ts` is not
edited by any lane:**

1. `createNodeFrom({ title, role: "reference", filePath: relPath, brief, pinned: false, content })`
   → writes the `.md` and lands the node.
2. `updateNode(id, { meta })`.
3. `beginConnection({ source: newId, target: anchorNodeId })` then
   `confirmConnection("references")` — **exactly one edge**, to the anchor only. The full
   `nodeIds` list is already recorded in tasklinks; N edges would just be noise.

Steps 1–3 produce three undo entries. Accepted; not worth a new store action.

---

## 7. Command contract — 54 → 63

Handler entries are **module-qualified** (`tasks::task_id_ensure`); the TypeScript `invoke` name
is **bare** (`"task_id_ensure"`). camelCase in JS ⇄ snake_case in Rust.

| # | Command | Module | Args | Returns |
|---|---|---|---|---|
| 55 | `task_id_ensure` | tasks | `root, relPath, line` | `TaskItem` (idempotent; no write if already present) |
| 56 | `task_depends_add` | tasks | `root, relPath, line, dependsOn` | `TaskItem` · `Err` on cycle / self / unknown / duplicated id |
| 57 | `task_depends_remove` | tasks | `root, relPath, line, dependsOn` | `TaskItem` (removing an absent dep is a no-op success) |
| 58 | `tasklinks_read` | tasklinks | `root` | `TaskLinks` (missing file ⇒ `{version:1,links:[]}`) |
| 59 | `tasklink_set` | tasklinks | `root, link: TaskLink` | `TaskLinks` (upsert one entry, returns the whole doc) |
| 60 | `tasklink_delete` | tasklinks | `root, taskId` | `TaskLinks` (unknown id ⇒ no-op success) |
| 61 | `task_context_preview` | taskctx | `root, taskId, graphJson` | `TaskContext` — **errors XOR body** |
| 62 | `task_context_write` | taskctx | `root, taskId, content` | `String` (the written relPath) |
| 63 | `handoff_node_propose` | handoff | `root, session: HandoffSessionInput, taskId?, summary` | `HandoffNodeProposal` — writes nothing |

**Upsert, not whole-file write (59/60):** a whole-document `tasklinks_write` would let two UI
paths clobber each other's entry. Upsert cannot.

### 7.1 Changed signature — `agent_session_spawn` (no new command)

WO02 precedent (`agent_create` gaining `file_name`). Three appended optional args:

```rust
#[tauri::command]
pub async fn agent_session_spawn(
    app: AppHandle,
    state: State<'_, SessionRegistry>,
    root: String,
    agent_file_name: Option<String>,
    name: String,
    cwd: String,
    task_id: Option<String>,        // NEW
    task_context: Option<String>,   // NEW — the already-compiled body (§4.3)
    token_ceiling: Option<u64>,     // NEW — None / Some(0) = unlimited
) -> Result<SessionInfo, String>
```

```ts
export function agentSessionSpawn(
  root: string, agentFileName: string | null, name: string, cwd: string,
  taskId: string | null, taskContext: string | null, tokenCeiling: number | null,
): Promise<SessionInfo> {
  return invoke<SessionInfo>("agent_session_spawn",
    { root, agentFileName, name, cwd, taskId, taskContext, tokenCeiling });
}
```

All three `null` ⇒ **behaviour byte-identical to today** (§1.14). Callers always pass explicit
`null`, never omit the key (WO02 precedent).

---

## 8. Wire shapes and events

| Shape | Change |
|---|---|
| `TaskItem` | +3 appended: `taskId: string \| null`, `dependsOn: string[]`, `blocked: boolean` |
| `TasksScan` | +1 appended: `dag: TaskDag` |
| `TaskDag`, `UnresolvedDep` | NEW (§3.3) |
| `TaskPatch` | **unchanged fields**; new *validation*: reserved prefixes rejected in `tags` (§3.1 R3) |
| `TaskLinks`, `TaskLink` | NEW (§3.2) |
| `TaskContext`, `TaskContextError` | NEW (§4) |
| `HandoffSessionInput`, `HandoffNodeProposal` | NEW (§6) |
| `SessionInfo` | +2 appended: `tokensUsed: number`, `tokenCeiling: number \| null` |
| `AgentEvent` | **no field change**; `kind` gains the value `"budget"` |
| `Usage` | unchanged |
| `AppSettings` | +1 appended: `sessionTokenCeiling: number`; `version` stays `1` |
| `BarnGraph` / `MemoryNode` / `MemoryEdge` | **FROZEN — see §3.4** |
| `.cowtext/agents.json` sidecar | untouched |

**Events: still four.** `barn://event`, `assemble://status`, `fs://change`, `agent://event`.
Only `agent://event`'s `kind` union widens (§5.4). No new channel is justified anywhere in this
work order.

**Store-update discipline** (because `.cowtext/**` fires no `fs://change`): every command that
mutates tasklinks returns the full new `TaskLinks` and the store replaces its copy from the
return value. Every command that mutates a task line returns the new `TaskItem`, **and** the
tasks store then re-runs `tasks_scan` — because `blocked` and `dag` are cross-file derivations
that a single-file return cannot carry (§3.3). One `void load(root)` after every mutating task
command; this kills the stale-badge class outright.

---

## 9. STAGE-0 SEAMS SPEC

**One agent (tech-general), before any lane starts, in one commit.** After Stage 0, `lib.rs` is
closed for the rest of the work order and every lane fills in bodies in its own files with zero
contention. The seams agent needs **no judgment**; everything below is literal.

Gate for Stage 0: `cargo clippy --all-targets -- -D warnings` and `cargo test` both green with
every stub still returning its error.

### 9.1 New files

| File | Stage-0 content |
|---|---|
| `src-tauri/src/tasklinks.rs` | module doc, `#[cfg(test)] mod tests;`, the `TaskLink` / `TaskLinks` types **complete** (§3.2), the three command stubs (§9.4) |
| `src-tauri/src/tasklinks/tests.rs` | one trivial passing test (`fn tasklinks_module_compiles() {}`) — **required**, or `mod tests;` fails to resolve |
| `src-tauri/src/taskctx.rs` | module doc, `#[cfg(test)] mod tests;`, the `TaskContext` / `TaskContextError` types **complete** (§9.4), the two command stubs |
| `src-tauri/src/taskctx/tests.rs` | one trivial passing test |

### 9.2 `lib.rs` — the complete and only wiring

Module declarations, inserted in byte order (`taskctx` < `tasklinks` < `tasks`), i.e. **directly
above the existing `mod tasks;` at line 24**:

```rust
mod taskctx;
mod tasklinks;
```

Both private `mod` — no non-GUI consumer needs them, so no `pub mod` (contrast `lib.rs:3-12`).

Handler entries: put a comma after the current last entry `import::import_apply` and append
these nine, in this exact order, as the new tail (last entry keeps no trailing comma):

```rust
            tasks::task_id_ensure,
            tasks::task_depends_add,
            tasks::task_depends_remove,
            tasklinks::tasklinks_read,
            tasklinks::tasklink_set,
            tasklinks::tasklink_delete,
            taskctx::task_context_preview,
            taskctx::task_context_write,
            handoff::handoff_node_propose
```

Nothing else in `lib.rs` changes — no new `manage`, no new plugin, no `setup` line.

### 9.3 Edits inside existing modules (Stage 0 only; lanes fill the bodies in place)

**`src-tauri/src/tasks.rs`** — append at end of file under the banner
`// ── WO06 Stage-0 seams (bodies belong to Lane G1) ──────────────────`:

```rust
#[tauri::command]
#[allow(unused_variables)]
pub fn task_id_ensure(root: String, rel_path: String, line: usize) -> Result<TaskItem, String> {
    Err("task_id_ensure: not implemented (WO06 Stage-0 stub)".to_string())
}

#[tauri::command]
#[allow(unused_variables)]
pub fn task_depends_add(
    root: String, rel_path: String, line: usize, depends_on: String,
) -> Result<TaskItem, String> {
    Err("task_depends_add: not implemented (WO06 Stage-0 stub)".to_string())
}

#[tauri::command]
#[allow(unused_variables)]
pub fn task_depends_remove(
    root: String, rel_path: String, line: usize, depends_on: String,
) -> Result<TaskItem, String> {
    Err("task_depends_remove: not implemented (WO06 Stage-0 stub)".to_string())
}
```

Stage 0 does **not** add the `TaskItem` / `TasksScan` fields — those change serialization and
belong to G1.

**`src-tauri/src/sessions.rs`** — two mechanical edits, no logic:

1. `agent_session_spawn`'s signature gains the three params of §7.1, and as the **first line of
   the body**: `let _ = (&task_id, &task_context, &token_ceiling);`
2. `SessionInfo` gains, appended last:
   ```rust
   pub tokens_used: u64,
   pub token_ceiling: Option<u64>,
   ```
   with `tokens_used: 0, token_ceiling: None` at the single construction site
   (`RegistryCore::register`, `sessions.rs:209-217`).

Stage 0 touches nothing else in `sessions.rs` — not `SessionEntry`, not `map_line`, not
`run_turn`.

**`src-tauri/src/handoff.rs`** — append at end of file:

```rust
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HandoffSessionInput { /* exactly the six fields of §6 */ }

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HandoffNodeProposal { /* exactly the seven fields of §6 */ }

#[tauri::command]
#[allow(unused_variables)]
pub fn handoff_node_propose(
    root: String,
    session: HandoffSessionInput,
    task_id: Option<String>,
    summary: String,
) -> Result<HandoffNodeProposal, String> {
    Err("handoff_node_propose: not implemented (WO06 Stage-0 stub)".to_string())
}
```

(`handoff.rs` already imports `serde::{Deserialize, Serialize}`; add
`std::collections::BTreeMap` if absent.)

### 9.4 Exact stub signatures for the new modules

```rust
// tasklinks.rs
pub const TASKLINKS_VERSION: u32 = 1;
pub const TASKLINKS_REL_PATH: &str = ".cowtext/tasklinks.json";

#[tauri::command] #[allow(unused_variables)]
pub fn tasklinks_read(root: String) -> Result<TaskLinks, String> { Err("…stub".into()) }
#[tauri::command] #[allow(unused_variables)]
pub fn tasklink_set(root: String, link: TaskLink) -> Result<TaskLinks, String> { Err("…stub".into()) }
#[tauri::command] #[allow(unused_variables)]
pub fn tasklink_delete(root: String, task_id: String) -> Result<TaskLinks, String> { Err("…stub".into()) }

// taskctx.rs
pub const TASK_CONTEXT_DIR: &str = ".cowtext/context";
pub const TASK_CONTEXT_MAX_BYTES: usize = 32 * 1024;

#[derive(Serialize, Clone, Debug)] #[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub task_id: String,
    pub node_ids: Vec<String>,
    pub body: String,
    pub bytes: usize,
    pub errors: Vec<TaskContextError>,
}

#[derive(Serialize, Clone, Debug)] #[serde(tag = "kind", rename_all = "camelCase")]
pub enum TaskContextError {
    EmptySubgraph,
    #[serde(rename_all = "camelCase")] UnknownTask { task_id: String },
    #[serde(rename_all = "camelCase")] ParentCycle { path: Vec<String> },
    #[serde(rename_all = "camelCase")] MissingFile { node_id: String, file_path: String },
    #[serde(rename_all = "camelCase")] Compile { message: String },
}

#[tauri::command] #[allow(unused_variables)]
pub fn task_context_preview(root: String, task_id: String, graph_json: String)
    -> Result<TaskContext, String> { Err("…stub".into()) }
#[tauri::command] #[allow(unused_variables)]
pub fn task_context_write(root: String, task_id: String, content: String)
    -> Result<String, String> { Err("…stub".into()) }
```

Stub message format everywhere: `"<command_name>: not implemented (WO06 Stage-0 stub)"`.

### 9.5 Stage 0 does not touch TypeScript

Each TS lane writes its own `api.ts` wrappers. The one-file-per-invoke rule holds:
`src/tasks/api.ts` (55–57), a new `src/tasks/tasklinksApi.ts` (58–60), a new
`src/taskctx/api.ts` (61–62), `src/handoff/api.ts` (63), `src/sessions/api.ts` (§7.1).

---

## 10. Lane grid — 7 build lanes

**Zones are exclusive. There is no shared-append file this work order** — that is the entire
point of §9. A lane that needs a byte outside its zone **stops and reports** (§14).

| Lane | Agent | Scope | File zone (exclusive) |
|---|---|---|---|
| **S0** *(Stage 0, not one of the 7)* | tech-general | §9 verbatim; nothing else | `src-tauri/src/lib.rs` · new `tasklinks.rs` + `tasklinks/tests.rs` · new `taskctx.rs` + `taskctx/tests.rs` · the three mechanical edits of §9.3 |
| **G1 — task DAG** | tech-general | §3.1 reserved namespace + minting · §3.3 DAG, cycles, blocked · commands 55–57 · O2 co-location · O3 status-on-move · reserved-token re-emission in `write_task_fields` / `regenerate_*` | **`src-tauri/src/tasks.rs`** *(HOT)* · `src-tauri/src/tasks/tests.rs` |
| **G2 — links, context, handoff** | tech-general | §3.2 sidecar · §4 closure + compile reuse + write allowlist · §6 proposal · commands 58–63 | `src-tauri/src/tasklinks.rs` + `tasklinks/tests.rs` · `src-tauri/src/taskctx.rs` + `taskctx/tests.rs` · `src-tauri/src/handoff.rs` |
| **G3 — budgets + injection** | tech-general | §5.2 `observed_usage` · §5.3 `charge` + hard-stop · §5.4 `budget` kind · §4.3 boot-prompt injection + the `taskId`-without-context rejection | **`src-tauri/src/sessions.rs`** *(HOT)* · `src-tauri/src/sessions/tests.rs` |
| **U1 — tasks surface** | tech-ui | DAG UI (deps picker, blocked badge, cycle/duplicate warnings), O1 checkbox, task-id affordance, the pre-specified mount of U2's modal | **`src/tasks/**`** *(TasksBoard.tsx is HOT)* · `src/store/tasks.ts` · **`src/inspector/Inspector.tsx`** *(HOT)* |
| **U2 — context + handoff surface** | tech-ui | Task-context modal (subgraph list, compiled preview, byte count, Save, Launch), handoff→node commit flow per §6 | `src/taskctx/**` *(new dir)* · `src/handoff/**` |
| **U3 — budgets + sessions surface** | tech-ui | Ceiling setting, effective-ceiling computation, spawn plumbing, `budget` kind in the store, roster/panel gauges, stop state | `src/store/sessions.ts` · `src/store/settings.ts` · `src/sessions/**` · `src/settings/SettingsModal.tsx` · **`src/App.tsx`** *(HOT)* |
| **B1 — barn mission control** | tech-barn | Per-session stall + nameplate + budget gauge; dark on stop | `src/scene/**` (whole directory) |
| **D — docs close-out** *(post-lane)* | project-manager | 54→63 in `docs/TERMINOLOGY.md` **and** `.claude/skills/cowtext-terminology/SKILL.md` · new terms (stable task id, tasklinks, task context, budget) · Status line · `docs/testing/WO06_TEST_MANUAL.md` · backlog rows | `docs/**` · `CLAUDE.md` · `.claude/skills/cowtext-terminology/**` |

### 10.1 Hot files — each assigned to exactly one lane

| Hot file | Owner | Everyone else |
|---|---|---|
| `src-tauri/src/tasks.rs` | **G1** (after S0's stub append) | forbidden |
| `src-tauri/src/sessions.rs` | **G3** (after S0's two edits) | forbidden |
| `src-tauri/src/compile.rs` | **NOBODY — frozen (§4.4)** | forbidden |
| `src-tauri/src/lib.rs` | **S0 only** | forbidden |
| `src/tasks/TasksBoard.tsx` | **U1** | forbidden |
| `src/inspector/Inspector.tsx` | **U1** (the deps editor lives in `TaskPanel`) | forbidden |
| `src/App.tsx` | **U3** | forbidden |
| `src/store/graph.ts` | **NOBODY — frozen (§3.4)** | forbidden |
| `src-tauri/src/project.rs` | **NOBODY** | forbidden |

### 10.2 Overlap audit (every shared parent directory, resolved at file level)

- `src-tauri/src/` → S0: `lib.rs`, the two new modules, three mechanical stub edits. G1: `tasks*`.
  G2: `tasklinks*`, `taskctx*`, `handoff.rs`. G3: `sessions*`. Everything else: nobody.
- `src/tasks/` → **U1 owns the whole directory** (`TasksBoard.tsx`, `api.ts`, new
  `tasklinksApi.ts`, `NewTaskDialog.tsx`, `TagPicker.tsx`, new `DependsPicker.tsx`,
  `NewAgentDialog.tsx`, `NewSkillDialog.tsx`).
- `src/store/` → U1: `tasks.ts`. U3: `sessions.ts`, `settings.ts`. `graph.ts` frozen; `project.ts`,
  `events.ts`, `review.ts`, `tokens.ts`, `agents.ts`: nobody.
- `src/inspector/` → U1 owns `Inspector.tsx` only. `EventLog.tsx`, `HooksModal.tsx`,
  `ProblemsPanel.tsx`, `CodeMirrorEditor.tsx`: nobody.
- `src/sessions/` → U3 owns the whole directory. `src/handoff/` → U2 owns the whole directory.
  `src/taskctx/` → U2, new. `src/settings/` → U3. `src/scene/` → B1.
- `docs/` → lane D, post-merge. `docs/design/WO06_*.md` → tech-lead. `docs/testing/` → D + tester.

### 10.3 The one cross-lane integration point, pre-specified

U2's modal is mounted by U1 (it is opened from the board and from the task Inspector). To keep
`TasksBoard.tsx` exclusively U1's, **the contract freezes the interface and U1 writes the mount
against it before U2 has built it**:

```ts
// src/taskctx/TaskContextModal.tsx  — U2 owns the file, U1 owns the call site
export function TaskContextModal(props: {
  root: string;
  taskId: string;          // already minted by the caller
  taskName: string;
  onClose: () => void;
  /** Fires after a successful spawn so the caller can refresh. */
  onLaunched?: (sessionId: string) => void;
}): JSX.Element;
```

U2 may not change this signature. If U2 believes it must, it stops and reports (§14).

### 10.4 Build order

```
S0  ──►  G1 ─┐
         G2 ─┼──►  U1, U2, U3  ──►  B1  ──►  audit (tech-lead)  ──►  gates (tester)  ──►  D
         G3 ─┘
```

G1/G2/G3 are mutually independent by construction (§4.3, §5.1 removed every cross-module call).
U1/U2/U3 are mutually independent. B1 consumes U3's store fields, so it gates after U3. Lanes
may be *written* in parallel against this frozen contract; they are *gated* in this order.

---

## 11. The three board defects (O1 / O2 / O3)

### O1 · Flat-list rows have no checkbox for BACKLOG / ROADMAP / BUGS — **U1**

`TasksBoard.tsx:352` gates the checkbox on `task.source === "checklist"`. Since WO02 made grids
canonical, every row in those three files is a table row, so none of them can be completed from
the board. `task_toggle` genuinely refuses table rows (`tasks.rs:1200-1202`) and must keep doing
so — it is a checklist primitive.

**Fix:** a store helper `toggleAny(task, done)` in `src/store/tasks.ts` routing
`checklist → taskToggle`, `table → taskUpdate(root, relPath, line, patch)` where the patch is
built from the item and carries **every** editable field — `name`, `description`, `tags`,
`priority`, **`phase`**, `agent` — plus `status: done ? "done" : "new"` and `done`.
**Omitting `phase` clears a mapped cell** (`set_cell` writes a single space for `None`); that is
the trap in this fix. Reserved tokens are not in `tags` and Rust re-emits them (§3.1 R4), so
they cannot be lost here.

### O2 · A missing convention file is created at the repo root — **G1**

`NewTaskDialog.relPathFor` (`NewTaskDialog.tsx:121-123`) uses `files[idx].relPath`, and
`tasks_scan` reports a missing file as the bare name (`tasks.rs:1175-1179`) = the root. The fix
belongs in Rust: all path resolution goes through Rust, and fixing it in TS would leave the
`tasks_scan` contract lying.

**Fix — co-location rule** in `tasks_scan`'s `None` arm:

1. Let `home` = the directory of the **existing** convention file whose name comes first in
   `CONVENTION_NAMES` order (deterministic, no majority vote, no tie).
2. If no convention file exists at all, `home = "docs/tasks/"` — Cowtext's own documented
   layout, and what O2 asks for.
3. Report `relPath = format!("{home}{name}")` with `exists: false`.

`ensure_convention_path` already accepts all 15 combinations, and `write_atomic` already
`create_dir_all`s the parent (`project.rs:239`) — so nothing else changes.

### O3 · `task_move` writes `status = new` onto moved items — **G1**

`build_table_append_row` hardcodes `set_cell(map.status, Some("new"))` (`tasks.rs:1002`) and the
checklist branch composes a bare `- [ ] ` marker.

**Fix:** `write_task_fields` gains `status: &str` (the source item's bucket) **and**
`task_id: Option<&str>` + `depends_on: &[String]` (§3.1 R4 — otherwise moving a linked task
silently orphans its tasklinks entry, which is a second, worse defect hiding inside this one).
`build_table_append_row` takes the status through; the checklist branch uses
`marker_for_bucket(status)`.

**`task_append` still writes `new`** — there is still no append-with-status primitive, and that
stays true.

---

## 12. Acceptance gates

Every gate green before the work order closes.

| # | Gate | Owner |
|---|---|---|
| 1 | `cargo clippy --all-targets -- -D warnings` clean | S0, G1, G2, G3 |
| 2 | `cargo test` green; ≥ 10 new tests in `tasks/tests.rs`, ≥ 8 in `tasklinks/tests.rs` + `taskctx/tests.rs`, ≥ 6 in `sessions/tests.rs` | G1, G2, G3 |
| 3 | `npm run build` (tsc strict, no `any`, no unused) clean · `npm run lint` clean | all TS lanes |
| 4 | Invoke contract **63/63 byte-exact** across `generate_handler!`, `docs/TERMINOLOGY.md`, and the `cowtext-terminology` skill | S0 + D |
| 5 | **DAG cycle:** `task_depends_add` returns `Err` for a would-be cycle, a self-dependency, an unknown id, and a duplicated id (4 distinct messages). A fixture file hand-authored with `A needs:B, B needs:A` still scans successfully and reports the cycle in `dag.cycles` with a deterministic node order across 100 repeated runs | G1 |
| 6 | **Budget hard-stop, provable:** unit tests on `RegistryCore::charge` — under / exactly-at / over / stale-generation / **exactly-once** (a second `charge` on the same captured generation returns `Stale`) — plus the two-turn accumulator fixture (§5.2), plus an integration test that a `spawn_dummy()` child (the existing seam, `sessions/tests.rs:393-465`) is tree-killed by the `Stop` path | G3 |
| 7 | **tasklinks round-trip:** write → read → write is byte-identical; upsert preserves every other entry; delete of an unknown id is a no-op; a `version: 2` file is a hard `Err`; a file with `nodeIds` in reverse order re-serializes sorted | G2 |
| 8 | **Task-context golden file:** a fixture graph + tasklinks compiles to a byte-exact expected `.md`, and a second run produces identical bytes. Plus: seeds-only vs seeds+pinned differ exactly by the pinned nodes; a `needs:` dependency's nodes are **absent**; a parent's nodes are **present** | G2 |
| 9 | **Allowlist disjointness, both directions:** `compile_write(root, [{relPath: ".cowtext/context/task-t-abc123.md", …}])` → `Err`; `task_context_write` with `taskId = "../../CLAUDE"` → `Err`; `task_context_write` cannot emit any of compile's six output shapes; content without the GENERATED header → `Err` | G2 |
| 10 | **Task-corpus regression:** the repo's own five convention files parse to a `TaskItem` set identical to the pre-WO06 baseline, field for field, with `taskId: null`, `dependsOn: []` | G1 |
| 11 | **Reserved-token round-trip:** mint an id → `task_update` with a full UI patch → the `id:` and every `needs:` token is still present, in frozen order, and every unmapped cell is byte-exact. Same for `task_move` across all four source/target shape combinations | G1 |
| 12 | **O1:** a table row in `BACKLOG.md` toggles from the board and the status cell round-trips; the `Phase` cell is not cleared | U1 |
| 13 | **O2:** in a project with `docs/tasks/TASKS.md` and no `BUGS.md`, creating a BUGS task creates `docs/tasks/BUGS.md`; in an empty project it creates `docs/tasks/BUGS.md` | G1 + U1 |
| 14 | **O3:** a `done` row moved from `TASKS.md` to `BACKLOG.md` arrives `done`; a linked task moved between files keeps its `id:`/`needs:` tokens and its tasklinks entry still resolves | G1 |
| 15 | **Budget off ⇒ no behaviour change:** with `tokenCeiling` null, a full session produces the same `agent://event` sequence as the pre-WO06 build | G3 + tester |
| 16 | **Spawn guard:** `agent_session_spawn` with a `taskId` and no `taskContext` returns `Err` and registers nothing | G3 |
| 17 | **Barn:** stalls appear/disappear with alive sessions; the gauge mutates an existing display object rather than rebuilding `Graphics` per frame; FPS on the default scene is unchanged from the pre-WO06 reading (the `showFps` overlay is the instrument) | B1 |
| 18 | **graph.json untouched:** `git diff --stat -- src/store/graph.ts src-tauri/src/project.rs src-tauri/src/compile.rs` reports no change | tech-lead audit |

Not gates, and must not be attempted as such: Marty's acceptance walk, and the production
`tauri build` CSP check (already an open item elsewhere).

---

## 13. Deferred (explicitly NOT this work order)

| Item | Goes to |
|---|---|
| Session-to-node attribution (which rules were live for a run) | **WO05** — needs persisted hook events (§2.3) |
| Usage heatmap, drift lint, dead-node report, event persistence | WO05 |
| Role-filtered subgraph / role-grouped compile sections (WO03 audit O2) | WO04 |
| Hierarchy simulator, SKILL.md target, full round-trip import, resolved-context preview | WO04 |
| `--append-system-prompt` / exclusive context (suppressing the worktree's own CLAUDE.md) | WO07, behind a probe extension |
| Approval gates, permission grids, squads, heartbeat scheduling, auto-promote, chains | WO07 |
| Whole-document `tasklinks_write`, multi-select bulk linking, cross-project tasklinks | not planned |
| Cost-based (USD) ceilings | not this WO — `cost_usd` is a conversation running total (§5.2) |

---

## 14. Deviation protocol

A lane that finds this contract wrong — a signature that cannot compile, a zone that forces it
into a foreign file, a store field the seam actually needs — **stops, states the failing
assumption, and reports.** It does not improvise across a seam. tech-lead ratifies or rejects;
ratified deviations are recorded in the audit with the reason.

Automatic rejects: a `graph.json` schema change (§3.4) · an edit to `compile.rs`,
`frontmatter.rs`, `agents.rs`, or `project.rs` · a new dependency · a fifth Tauri event ·
weakening either write allowlist · a lane editing `lib.rs` after Stage 0.
