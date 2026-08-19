# WO06 Audit — L2 Orchestrator Suite (adversarial)

**Auditor:** tech-lead · **Date:** 2026-08-19 · **Against:** [`WO06_CONTRACT.md`](WO06_CONTRACT.md)
**Lanes audited:** T1-dag · T2-tasklinks · T3-injection · T4-budgets · U1-board · U2-linkage · B1-missioncontrol
**Verdict: NOT SHIPPABLE.** 3 critical, 6 major, 7 minor, 6 observations.

The headline is not a bug in any one lane. **The differentiator does not ship.** Contract §2.1
says in as many words: "If §4 is at risk, lanes 4–8 get cut, not §4." §4 is not at risk — §4 is
unreachable. Every Rust command behind it works and is well tested; there is no control anywhere
in the running app that calls any of them.

---

## 0. Gates — actually observed

I have no shell in this session (Bash disabled), so gates 1/2/3/5–17 were **not executed by me**.
What follows is what I could verify by reading the tree, plus what the lanes reported.

| # | Gate | Observed |
|---|---|---|
| 1 | clippy `--all-targets -D warnings` | **NOT RE-RUN ON THE MERGED TREE.** T1 reported clean at its landing. U2 measured **11 errors, fails to compile** (dead code in `tasks.rs`, one nit at `sessions.rs:504`) while G1/G3 were mid-flight. Nobody has run it since B1 landed. **Must be re-run by tester before anything else.** |
| 2 | `cargo test` green, test minimums | Counts verified statically: `tasks/tests.rs` **75**, `tasklinks/tests.rs` **22**, `taskctx/tests.rs` **21**, `sessions/tests.rs` **66** (479 `#[test]` crate-wide). Minimums (≥10 / ≥8 / ≥6) **exceeded**. Green-ness unverified: U2 measured **445 passed, 1 failed** mid-flight (`tasks_scan_missing_files_report_default_root_location`); T1 reports it since fixed. |
| 3 | `npm run build` / `npm run lint` | U2 and B1 both report **0 errors, 1 pre-existing warning** (`RoleGlyphs.tsx:187`). Not re-run post-merge. |
| 4 | Invoke contract 63/63 byte-exact | **RED.** `lib.rs:52-114` carries exactly **63** entries, correct order, module-qualified — correct. `docs/TERMINOLOGY.md:11,36` still says **54**, and `.claude/skills/cowtext-terminology/SKILL.md` still says **54**. Lane D has not run. Expected, recorded. |
| 5 | DAG cycle, 4 distinct rejections | Code present and distinct (`tasks.rs:2077,2090,2104,2108,2115`). Determinism-over-100-runs unverified. |
| 6 | Budget hard-stop provable | Tests present and named for every required case: under/at/over/stale/unknown-id/**exactly-once**/two-turn accumulator/real-child tree-kill (`sessions/tests.rs:599-940`). **No test for "restart resets tokens_used" — because it is not implemented (D3).** |
| 7 | tasklinks round-trip | Code satisfies each clause on reading (`normalize`, `serialize_tasklinks`, version guard). 22 tests. Unexecuted. |
| 8 | Task-context golden file | `taskctx/tests.rs` 21 tests, T3 reports golden-file + determinism + seeds-vs-pinned + needs-never-leaks + parent-included all covered. Unexecuted. |
| 9 | Allowlist disjointness both directions | **Structurally sound.** `task_context_rel_path` (taskctx.rs:334) derives the path from a grammar-checked id, never from a caller path; `classify_output` (compile.rs:780) cannot match `.cowtext/…`. T3 wrote both directions incl. a non-vacuous control. |
| 10 | Task-corpus regression | Unverified. **At risk from D7** for any checklist-sourced task once an id is minted — the baseline itself is unaffected (`taskId: null`), but the invariant §3.1 R2 rests on is falsified. |
| 11 | Reserved-token round-trip | **Partially fails — see D7.** The tokens survive; the *name* does not. |
| 12/13/14 | O1 / O2 / O3 | Code present and matches the contract's prescribed fixes (`store/tasks.ts:266`, `tasks.rs:1744-1775`, `tasks.rs:1873-1884`). Unexecuted. |
| 15 | Budget off ⇒ no behaviour change | Holds by inspection: with no ceiling `charge` returns `Ok` after mutating only `turn_tokens` (internal), and no event shape changes. |
| 16 | Spawn guard | Present and correct: `register` rejects before the lock, mutates nothing (`sessions.rs:224-230`). |
| 17 | Barn | `makeStallPlacard` mutates one persistent `Graphics`/`Text`, change-keyed (`props.ts:564-612`). No `tick()` work added. **But the gauge is dead — see D5.** |
| 18 | graph.json untouched | **Cannot confirm mechanically (no `git diff`).** Circumstantial: a grep for `WO06` across all `.rs/.ts/.tsx` hits 26 files, **none of which is** `compile.rs`, `project.rs`, `graph.ts`, `frontmatter.rs` or `agents.rs`. No lane claims an edit. **Tester must run the literal `git diff --stat` before close-out.** |

---

## 1. CONFIRMED DEFECTS

### D1 · CRITICAL · The differentiator ships unreachable — dead code, not a feature
**Lane: U1-board (mount) + seams (unassigned component)**
**Files:** `src/tasklinks/TaskLinksPanel.tsx:98` · `src/taskctx/TaskContextModal.tsx:90` · `src/tasks/TasksBoard.tsx:38` (import list) · `src/inspector/Inspector.tsx:1186` (`TaskPanel`) · `src/App.tsx:42-50` (lazy list)

`TaskLinksPanel` is imported by **nothing**. `TaskContextModal` is imported **only** by
`TaskLinksPanel`. Neither appears in `App.tsx`'s lazy list, in `TasksBoard.tsx`, or in
`Inspector.tsx`. Verified by grep over every `.tsx`/`.ts` in `src/`, including dynamic
`import()`.

Contract §10.3 was written specifically to prevent this: *"U2's modal is mounted by U1 … the
contract freezes the interface and **U1 writes the mount against it before U2 has built it**."*
U1's scope line in §10 lists "the pre-specified mount of U2's modal". It was not written. U2
then invented a second, un-contracted component (`TaskLinksPanel`, in a new top-level directory
`src/tasklinks/` that §10.2 assigns to nobody) and reported it as "not yet mounted anywhere".
Neither lane owned the seam, so nobody closed it.

**Failure scenario.** Build the app, open a project, open the task board. Every task shows the
GitBranch deps chip (D-picker works). There is **no** control that calls `tasklink_set`,
`task_context_preview`, `task_context_write`, or `spawnForTask`. Commands **58, 59, 60, 61, 62**
are unreachable at runtime. A user cannot attach a single Memory Node to a task, cannot see a
task context, cannot launch a task-scoped session. WO06's items 2, 5, and 7 in the §2.1
hierarchy exist only to serve item 1, and item 1 is not present in the product.

What *did* ship end-to-end is items 3, 4 and 8 — stable ids, the dependency DAG, and the three
board defects. That is a kanban surface. **§2.1 explicitly forbids shipping exactly that:** "The
orchestrator layer is commoditized … Cowtext does not compete there and this work order must not
try to." As it stands WO06 delivers the commodity and withholds the differentiator.

**Fix.** (a) U1 mounts `TaskContextModal` against the frozen §10.3 signature from the board card
and from `TaskPanel`. (b) tech-lead ruling required on `TaskLinksPanel`: it is a real need (node
attach, parent goal, per-task ceiling) that the contract never gave a zone or a mount. Either
U1 mounts it inside `TaskPanel` (`Inspector.tsx` is U1's, §10.1 already reserves that panel for
task-graph editing), or its three controls fold into `TaskContextModal`'s left column. Do not
ship a third unmounted component.

---

### D2 · CRITICAL · Command 63 `handoff_node_propose` is still the Stage-0 stub
**Lane: seams**
**File:** `src-tauri/src/handoff.rs:298-305`

```rust
pub fn handoff_node_propose(...) -> Result<HandoffNodeProposal, String> {
    Err("handoff_node_propose: not implemented (WO06 Stage-0 stub)".to_string())
}
```

§6 (Handoff → node) is unbuilt. There is no TS wrapper in `src/handoff/api.ts` (which still
exports only `handoffGenerate`/`handoffWrite`) and no commit flow. The 63/63 invoke count is met
by a handler that always errors.

Root cause is a dispatch gap, not a lane failure: §10 gave lane **G2** three slices —
tasklinks, taskctx, handoff. The dispatch split G2 into T2-tasklinks and T3-injection and
dropped the handoff slice. No lane report mentions it.

**Failure scenario.** Any caller wired to command 63 gets `"not implemented (WO06 Stage-0
stub)"`. Item 6 of §2.1 — "closes the loop: the session's outcome re-enters the graph" — does
not exist.

**Fix.** Dispatch the §6 slice (deterministic proposal, no LLM, `handoff.rs` only) plus the
`src/handoff/api.ts` wrapper and the three-step commit flow from `HandoffModal`. Or formally cut
§6 to WO07 and remove the handler entry — but then the count is 62 and §1.6 must be amended.
Leaving a registered stub is the one option that is not acceptable.

---

### D3 · CRITICAL · Restart after a budget stop immediately re-stops, burning a real turn
**Lane: T4-budgets**
**File:** `src-tauri/src/sessions.rs:334-351` (`begin_restart`), against `sessions.rs:907-917` (`charge`'s Stop branch)

Contract §5.5.2: *"a **Restart** button (restart resets `tokens_used` to 0 — a restart is a new
budget)."* `begin_restart` bumps `generation`, sets `alive`/`busy`, and returns. It never touches
`tokens_used`, `turn_tokens`, or `info.tokens_used`. Meanwhile `charge`'s Stop branch **folds the
overrun into the durable total** (`entry.tokens_used = spent; entry.info.tokens_used = spent;`,
`sessions.rs:914-916`) — correctly, since `finish_turn` never runs on a stop.

**Failure scenario.** Ceiling 200,000. Session stops at `spent = 200,431`; `tokens_used` is now
200,431 and the ceiling is unchanged. User clicks **Restart** (the remedy the UI offers —
`AgentPanel.tsx:245`). `store/sessions.ts:288` clears `stopReason` and marks the card alive. The
restarted turn spawns a real `claude` child. Its **first** assistant line carrying any usage
calls `charge`: `spent = 200,431 + n ≥ 200,000` ⇒ `Stop`. The session dies before producing one
token of visible output, one paid API turn is consumed, and the card returns to
"stopped: token ceiling reached". Repeatable indefinitely — Restart is permanently broken after
the first stop, and each press costs money.

**Fix.** Inside `begin_restart`'s existing critical section, alongside the generation bump:
```rust
entry.tokens_used = 0;
entry.turn_tokens = 0;
entry.info.tokens_used = 0;
```
Add the Gate-6 test that is currently missing: charge to Stop → `begin_restart` → charge again
with a small total → `Ok`, not `Stop`.

---

### D4 · MAJOR · The budget gauge shows a double-counted number; `SessionInfo.tokensUsed` is dropped
**Lane: U2-linkage (store), with T4-budgets on the wire semantics**
**Files:** `src/store/sessions.ts:71-101` (`Session` has no `tokensUsed`), `:141-161` (`sessionFromInfo` reads `info.tokenCeiling`, silently drops `info.tokensUsed`), `:382-411` (the `budget` case) · `src-tauri/src/sessions.rs:520-527` (`budget_event`) · `src/sessions/RosterBar.tsx:55,102` · `src/sessions/AgentPanel.tsx:171`

Two independent halves of one defect.

1. §8 appended `tokensUsed: number` to `SessionInfo` precisely so the UI has Rust's authoritative
   accumulator. `src/sessions/api.ts:24` declares it. **`Session` never carries it and
   `sessionFromInfo` never reads it.** Both gauges instead read
   `session.usage.totalTokens` — the store's own per-`usage`-event sum, a different accumulator
   from `SessionEntry.tokens_used` (`turn_tokens = max(observed)`, folded per turn).
2. `budget_event` deliberately sets `usage.total_tokens = spent` — the **cumulative** figure
   (`sessions.rs:524`, documented at `:517-519`). The store's `budget` case then **adds** it to
   its own cumulative total (`store/sessions.ts:400`).

**Failure scenario.** Ceiling 200,000. Turn 1's `result` usage reports `total_tokens = 150000` ⇒
store `usage.totalTokens = 150000`. Turn 2 crosses at `spent = 210000` ⇒ `budget` event carries
`totalTokens = 210000` ⇒ store shows **360,000**. `budgetPct(360000, 200000)` = **180%**. The
roster strip and the agent-panel bar both render a gauge past its own ceiling, while
`SessionInfo.tokens_used = 210000` — the correct number — sits unread. The `inputTokens` +
`outputTokens` sum no longer relates to `totalTokens` either, since `budget_event` mixes one
line's breakdown with a cumulative total.

**Fix.** Add `tokensUsed: number` to `Session`; populate from `info.tokensUsed` in
`sessionFromInfo`; in the `budget` case **assign** `tokensUsed = e.usage.totalTokens` rather than
adding it; point `RosterBar`/`AgentPanel`/`BarnScene` at `session.tokensUsed`. The wire is frozen
and correct — the fix is entirely in `src/store/sessions.ts`.

---

### D5 · MAJOR · The barn's budget strip is permanently full
**Lane: U2-linkage (root cause) — B1-missioncontrol is correct by construction**
**Files:** `src/scene/BarnScene.tsx:203-222` · `src/scene/agentHerd.ts:109-111`

B1 built against the §8 wire shape and wrote a structural view
`Session & { tokensUsed?: number; tokenCeiling?: number | null }` so the strip would light up
"once lane U3 lands those fields, with zero further edits". `tokenCeiling` landed. **`tokensUsed`
did not** (D4/D9), so `input.tokensUsed ?? 0` is always `0`.

**Failure scenario.** Spawn a task session with a 200,000 ceiling, burn 190,000 tokens. Every
stall placard shows a full amber strip. It never turns danger at ≥90%, and it never goes
hollow-dark on the Stop — the two states §5.5.3 and §10-B1 exist to render. Gate 17's visual
half is unmeetable as shipped.

**Fix.** Fixed by D4. No change in `src/scene/**`.

---

### D6 · MAJOR · `tasklinks.sessionIds` is written with Cowtext `as<N>` ids — the exact error §3.2 L3 names
**Lane: U2-linkage**
**Files:** `src/sessions/AddAgentDialog.tsx:174` (`onSpawned?.(result.id)`) → `src/taskctx/TaskContextModal.tsx:362-364` → `src/store/tasklinks.ts:141-155` (`recordSession`) → `tasklink_set`

Contract §3.2 L3, verbatim: *"`sessionIds` holds `claudeSessionId` values (the durable UUID from
the stream's `system/init` line) — **never** Cowtext's in-memory `as<N>` ids, which are
reassigned from zero on every app start. **A builder will get this wrong if it is not stated.**"*

`result.id` is `SessionInfo.id`, minted at `sessions.rs:257` as `format!("as{}", …)`.

**Failure scenario.** Launch a task session. `.cowtext/tasklinks.json` — a git-tracked file —
gains `"sessionIds": ["as0"]`. Restart Cowtext, launch an unrelated session for a different task:
it is also `as0`. Two tasks now claim the same "session", and neither id resolves to anything
after the process that minted it exited. This is persistent, committed, wrong provenance.

**Compounding gap:** there is currently **no** frontend path to a `claudeSessionId` for a fresh
session. `SessionInfo.claudeSessionId` is `None` at spawn (it arrives on the stream's
`system/init` line), and `applyEvent` has no branch that ever sets `Session.claudeSessionId` —
only `sessionFromInfo` does, from `hydrate()`/`agent_session_list`.

**Fix.** Ruling: do **not** persist `as<N>`. Record the session only once the durable id is
known. Cheapest correct route: after `spawnForTask` resolves, re-read via
`agent_session_list` (or a short-lived poll) and call `recordSession` with
`info.claudeSessionId` when it becomes non-null; skip the write if it never arrives. If a lane
believes an `agent://event` change is needed, that is a §1.11 matter and comes back to me first.

---

### D7 · MAJOR · Minting an id into a boundary-less checklist line leaks the token into `name`, and every subsequent save duplicates it
**Lane: T1-dag**
**Files:** `src-tauri/src/tasks.rs:712-714` (`parse_checklist_line` runs `split_name_desc` on text that still contains `#id:`) · `tasks.rs:853-872` (`regenerate_checklist_line`) · `src/inspector/Inspector.tsx:1204, 1223-1230` (`TaskPanel` prefills `name` from `item.name` and sends it back)

`split_name_desc` (`tasks.rs:606-632`) splits on the first `" — "` / `" - "` / `"."`. A minted
token contains none of those (`t-a1b2c3` has no surrounding spaces), so on a line with no
boundary the whole tail — token included — becomes the **name**; on a line with a `.` it becomes
the **description**. This is a pre-WO06 quirk for hand-typed `#tags`, but WO06 is the first
feature that writes a `#` token into a user's line **unprompted**, so WO06 is where it becomes a
defect.

**Failure scenario.**
1. File contains `- [ ] Wire the hooks server`. Board caption: "Wire the hooks server".
2. User opens the deps picker and links it. `task_id_ensure` splices → `- [ ] Wire the hooks
   server #id:t-a1b2c3`.
3. `reparse_single_line` returns `name = "Wire the hooks server #id:t-a1b2c3"`. **The board
   caption visibly changes** the instant a task is linked.
4. User opens the Inspector and presses Save. `TaskPanel` sends that name verbatim;
   `regenerate_checklist_line` writes the name, then re-emits the reserved tokens (correctly, per
   R4) → `- [ ] Wire the hooks server #id:t-a1b2c3 #id:t-a1b2c3`.
5. Save again → three copies. **Unbounded growth of the user's markdown line on every edit.**

This falsifies the premise §3.1 R2 rests on — *"`TaskItem.tags` never contains a reserved token,
so no UI change is needed to hide them and no UI can drop them."* The token is not hidden; it
moved from `tags` (where the UI would have shown a junk chip) to `name` (where the UI shows it
as the task's title and then writes it back). T1 flagged the `task_move` half of this; the
`task_update` half — far more common — was not reported.

**Fix (T1, one place).** In `parse_checklist_line`, strip well-formed `#id:`/`#needs:` words from
`text` before `split_name_desc` and before the description split. They are already lifted out of
`tags`; lift them out of the prose surface too. Then re-run Gate 11 with a checklist fixture that
has no `—`/`-`/`.` boundary, asserting a stable `name` across mint → update → update.

---

### D8 · MAJOR · Store-update discipline broken for the four mutations that need it
**Lane: U1-board**
**File:** `src/store/tasks.ts:225` (`update`), `:245` (`toggle`), `:266` (`toggleAny`), `:280` (`ensureId`)

Contract §8, verbatim: *"Every command that mutates a task line returns the new `TaskItem`, **and**
the tasks store then re-runs `tasks_scan` — because `blocked` and `dag` are cross-file
derivations that a single-file return cannot carry. **One `void load(root)` after every mutating
task command; this kills the stale-badge class outright.**"*

`addDependency`, `removeDependency`, `append` and `move` do reload. The four above do not — they
patch one row into `st.tasks` and return.

**Failure scenario.** Task B carries `needs:t-aaa111` (task A, in `BACKLOG.md`). A is `new`, so B
shows the amber **Blocked** badge. User ticks A's checkbox on the board (`toggleAny` → `update`,
since A is a table row). A flips to done; **B's Blocked badge stays on**, and `dag.cycles` /
`dag.duplicateIds` are never recomputed. It self-heals only if the fs watcher happens to fire —
a 500 ms debounce on `fs://change` — which does not happen if the watcher is not running, if the
task file lives outside the watched subtree, or on a network share. The exact stale-badge class
§8 was written to kill.

**Fix.** `await get().load(root)` on the success path of all four. The contract already priced
in the extra scan.

---

### D9 · MAJOR · Lane U3 never ran; its deliverables are absent and its zone was absorbed
**Lane: seams**
**Files:** `src/store/settings.ts` (no `sessionTokenCeiling`) · `src/settings/SettingsModal.tsx` (no control) · `src/taskctx/TaskContextModal.tsx:217` · `src/sessions/**` + `src/store/sessions.ts` (U3's zone, written by U2)

Three separate problems, one cause.

1. **No global ceiling exists.** §5.1 and §8 both specify `AppSettings.sessionTokenCeiling:
   number`, appended last, version stays 1, default 0. A grep for `sessionTokenCeiling` across
   `src/` returns **zero hits**. There is no field, no control, no persistence.
2. **No effective-ceiling computation.** §5.1: *"per-task ceiling if the session was spawned with
   a `taskId` whose link carries one, **else the global default**"*.
   `TaskContextModal.tsx:217` is `const effectiveCeiling = link.tokenCeiling ?? null;` — there is
   no `?? globalDefault` because there is no global default. Combined with D1, **the only way to
   set any ceiling at all is a control inside an unmounted panel.** The whole of §5 is
   unreachable from the UI, exactly like §4.
3. **Zone violation.** §10 and §10.2 give `src/store/sessions.ts`, `src/sessions/**`,
   `src/store/settings.ts`, `src/settings/SettingsModal.tsx` and `src/App.tsx` exclusively to U3.
   U2 wrote six files under `src/sessions/` and `src/store/sessions.ts`. U2 also created
   `src/tasklinks/` — a top-level directory §10.2 assigns to nobody (§9.5 put the 58–60 wrappers
   at `src/tasks/tasklinksApi.ts`, U1's zone).

**Ruling (mine, as arbiter).** The zone move is **RATIFIED after the fact** — U2's code is
coherent, `spawn` was left byte-identical, and no third party contended those files. The
*deliverables gap* is **NOT** ratified: the global ceiling setting and the effective-ceiling
fallback are still owed and must land before close-out. The `src/tasklinks/` directory is
ratified as U2's, and §10.2 should be amended in the docs close-out rather than the files moved.

---

## 2. MINOR

### O1 · `UnresolvedDep.taskId` carries a volatile locator — §3.1 R6 violation
`src-tauri/src/tasks.rs:1686` pushes `t.id` (`"<relPath>#<line>"`) into a field the contract
defines as a stable id. R6: *"never conflated, never substituted for one another."*
`src/tasks/TasksBoard.tsx:167` renders `${u.taskId} needs ${u.dependsOn}` → the banner reads
`docs/tasks/TASKS.md#42 needs t-abc123`. Only reachable from a hand-edited file (the UI mints
self's id before adding a `needs:`). **Lane T1-dag.** Fix: omit id-less tasks from `unresolved`,
or add a separate `locator` field.

### O2 · Two divergent tolerant-reads of the same sidecar
`src-tauri/src/tasklinks.rs:182-202` degrades unparseable JSON to `{version:1,links:[]}`;
`src-tauri/src/taskctx.rs:358-376` hard-`Err`s on it, and checks `version` *after* shape parse
rather than before. **Failure:** hand-corrupt `.cowtext/tasklinks.json` — `tasklinks_read` says
"no links" and the UI looks fine, while `task_context_preview` surfaces a raw
`"tasklinks.json: expected value at line 1 column 1"` in the modal. T3's landing-order argument
for the private copy expired the moment both lanes landed. **Lane T3-injection.** Fix: call
`crate::tasklinks::tasklinks_read`, or extract one `pub(crate) fn read_tasklinks`.

### O3 · Ancestry depth/cycle semantics disagree between the two modules
`tasklinks::ancestor_chain` (`tasklinks.rs:92-113`) returns `Err` when `MAX_ANCESTRY_DEPTH` is
exhausted. `taskctx`'s inline walk (`taskctx.rs:138-157`) silently `break`s at `generation > 8`,
so a parent cycle longer than 8 hops is **truncated, not reported** — §4.1 says *"a cycle is a
`ParentCycle` error, not a silent truncation."* Normally unreachable (`tasklink_set` refuses to
persist such a chain), reachable via a hand-edited sidecar. **Lane T3-injection.**

### O4 · `role="menu"` with no menu items, and an `<input>` inside it
`src/tasks/DependsPicker.tsx:150-153`. The popup declares `role="menu"` but owns a text `<input>`
(`:188`) and plain `<button>`s with no `role="menuitem"` — an ARIA 1.2 required-owned-elements
violation. A screen reader announces a menu with zero items. Keyboard operation itself is sound
(real buttons, `autoFocus`, Escape closes and refocuses the trigger, outside-pointerdown, scroll
close) — this is **not** a repeat of WO03's 2.1.1 failure. Secondary: focus is not contained;
Tab from the last candidate leaves the portal while it stays open. **Lane U1-board.** Fix:
`role="dialog" aria-modal="false"` (or `role="group"`), plus a focusout-close or a focus trap.

### O5 · Lost-update window on `tasklinks.json`
`tasklink_set` is a whole-document read-modify-write server-side (`tasklinks.rs:234-251`) **and**
the store builds the upserted entry from its own possibly-stale snapshot
(`src/store/tasklinks.ts:88-90`, `:114`, `:128`, `:142`). `recordSession` is fired un-awaited
(`TaskContextModal.tsx:363`). **Failure:** click Launch, then immediately change the ceiling — the
two calls interleave and one field's change is lost. §7's "upsert cannot clobber" holds per
entry, not per field. **Lanes T2-tasklinks / U2-linkage.** Fix: serialize the store's mutations
behind a promise chain, or have the store re-read `linkFor` from the last adopted doc inside the
mutation rather than capturing it before the `await`.

### O6 · `tasklink_delete` on a project with no sidecar creates an empty sidecar
`src-tauri/src/tasklinks.rs:258-265` writes unconditionally. A no-op delete makes a git-visible
`.cowtext/tasklinks.json` appear from nowhere. **Lane T2-tasklinks.** Fix: skip the write when
`retain` removed nothing and the file did not already exist.

### O7 · `tasklink_set` does not enforce the id grammar
`src-tauri/src/tasklinks.rs:230` guards only non-empty. `task_context_preview` then rejects the
same id via `is_valid_task_id` (`taskctx.rs:114`) and reports `UnknownTask`. A link written for a
malformed id is silently unusable rather than refused at the door. T2 read the "stable id
minting is T1's job" note as covering this; the grammar check is cheap and belongs here too.
**Lane T2-tasklinks.**

### O8 · `RosterBar` passes `stopped={false}` to a strip it has already computed the stop for
`src/sessions/RosterBar.tsx:56` computes `budgetStopped`; `:102` hardcodes `stopped={false}`. The
roster border and badge show the stop; the strip does not. **Lane U2-linkage.**

---

## 3. OBSERVATIONS (no action required, recorded)

**B1 · `UnknownTask` never fires for a well-formed id with no links.** `taskctx.rs:114-125` only
reports `UnknownTask` for a grammar failure. A valid id with no `tasklinks` entry compiles a
context consisting solely of the globally pinned closure — a "task context" with nothing
task-specific in it. The §4.3 spawn guard only checks non-empty, so a user can spend a real turn
on what is effectively the project's pinned rules. Not a contract violation (§4.1 defines only
`EmptySubgraph`), but it undercuts the feature's claim. Recommend `TaskContextModal` warn when
`seeds ∪ ancestry` is empty. **Lane T3-injection.**

**B2 · A budget stop charged on the terminal `result` line discards the completed answer.**
`sessions.rs:1055-1070` charges before emitting, so on the `result` line the `text`, `usage` and
`status: idle` events are never emitted — the user pays for a turn whose answer they never see.
Contract-conformant (§5.2 mandates reading both lines; §5.3 mandates the immediate return). Worth
a UX ruling in WO07, not a defect here.

**B3 · Simplicity: WO06 added five graph walks; §3.3 D4 ratified one.** Landed:
`find_task_cycle` (`tasks.rs:1578`, **ratified**), `would_create_cycle` (`tasks.rs:1523`, a
separate BFS — defensible, "would this new edge close a cycle" is a different question),
`ancestor_chain` (`tasklinks.rs:92`), `taskctx`'s inline ancestry loop (`taskctx.rs:138`), and
`ancestryChain` in TS (`store/tasklinks.ts:73`). The last two are the problem: `ancestor_chain`
is `pub(crate)` and was explicitly exposed by T2 *for T3 to use*, and T3 wrote its own with
different semantics (O3). Fixing O3 by calling `ancestor_chain` removes the fourth walk. The TS
copy is display-only and documented as such — accepted.

**B4 · Only one cycle is reported per scan.** `tasks.rs:1693`
(`find_task_cycle(...).into_iter().collect()`), while `TaskDag.cycles` is `Vec<Vec<String>>`.
Matches `compile.rs`/`lint.rs` exactly, documented by T1, deterministic. **RATIFIED.**

**B5 · `src/scene/palette.ts` `ROLE_ACCENT.invariant`/`.trap` rechannelled to `iris`/`orchid`.**
In B1's zone, outside WO06's scope, reported by the lane, no 30th colour added, `ROLE_ACCENT` is
used only inside `src/scene/`. **RATIFIED** as a reported drive-by fix.

**B6 · `src/inspector/Inspector.tsx` gained no deps editor.** §10.1 says "U1 (the deps editor
lives in `TaskPanel`)". `DependsPicker` was mounted only on the board's `StatusCard`/`FlatRow`.
Not a defect on its own; folded into D1's fix, since `TaskPanel` is where the task-context and
linkage mounts belong.

---

## 4. Deviations ratified

| Deviation | Ruling |
|---|---|
| `charge`/`end_turn` as free functions taking `&Registry` instead of `&self` on `RegistryCore` (§5.3's literal shape) | **RATIFIED.** T4's reason is sound and documented at `sessions.rs:862-872`: `run_turn` carries only the cloned handle, and a `&self` wrapper would be dead code under plain `cargo clippy -D warnings`. One symbol, exercised by both `run_turn` and the tests. |
| `charge`'s Stop branch folds `tokens_used` itself (not in §5.3's pseudocode) | **RATIFIED.** `finish_turn` never runs on a stop, so nothing else would ever fold it. Necessary, not optional. |
| Spawn guard inside `register()` before the lock rather than in the command body | **RATIFIED.** `Err` mutates nothing, Gate 16 holds, and it is unit-testable without an `AppHandle`. |
| One cycle per scan, first-wins duplicate-id representative, table minting byte-exact vs checklist field-exact | **RATIFIED** (B4; T1's memory note has the full rationale). |
| `taskctx` reads the sidecar itself instead of calling `tasklinks_read` | **REJECTED** — see O2. The landing-order argument does not survive both lanes landing. |
| `agentSessionSpawn`'s three new params defaulted rather than required-explicit-`null` | **RATIFIED.** The wrapper still sends explicit `null` on the wire; §7.1's intent is satisfied and the pre-WO06 call site is untouched. |
| U2 writing `src/sessions/**` + `src/store/sessions.ts`; new `src/tasklinks/` directory | **RATIFIED after the fact** (D9), with the deliverables gap still owed. §10.2 to be amended in the docs close-out. |
| §6 handoff slice never dispatched | **REJECTED** — see D2. |

---

## 5. Verdict

**NOT SHIPPABLE.**

The Rust layer is, with three exceptions, the best-built part of this work order: the closure
rule, the two disjoint allowlists, the atomic hard-stop and its generation fence, the surgical
tag writes and the deterministic sidecar are all correct, well-tested and faithful to the
contract. Gate 9's disjointness and Gate 16's spawn guard are structurally sound, not procedural.

But WO06 is judged on §2.1's own ordering, and by that ordering it fails at the top. Item 1 —
per-task subgraph injection, "THE feature" — has no UI entry point (D1). Item 6 is a stub (D2).
Item 5's remedy path is broken and costs money (D3), its gauge shows a wrong number (D4/D5) and
its global switch does not exist (D9). What is shippable today is items 3, 4 and 8: stable ids,
a dependency DAG, and three board fixes — precisely the commodity layer §2.1 forbids competing
on.

**Blocking for close-out:** D1, D2, D3, D9. **Required before Marty's walk:** D4, D5, D6, D7, D8.
**Re-run gates 1/2/3 on the merged tree first** — no lane measured them after B1 landed, and the
last recorded `--all-targets` run was red.
