# WO06 Manual Test Script — L2 Orchestrator Suite

Hand-run test manual for WO06: stable task ids + the dependency DAG, the `.cowtext/tasklinks.json`
sidecar, per-task subgraph injection (§4, the work order's stated differentiator), token-ceiling
hard-stops (§5), the three board defects (O1/O2/O3), and barn mission control. Run top to bottom
in one sitting; sections reuse the throwaway project built in section A unless a section calls out
its own fresh project (O2 and the injection/budget sections need specific starting states that
would corrupt the running DAG example).

**Read this before you start:** as of the date below, §4 (per-task subgraph injection) and §5
(token ceilings) are **fully built and unit-tested on the Rust side but have no reachable control
anywhere in the running app** — `TaskContextModal` and `TaskLinksPanel` are never imported or
mounted by any other component, and the global default ceiling setting was never added to
Settings. Section G below documents this precisely and tells you how to verify that machinery
the only way currently possible: `cargo test`. Section H documents that Handoff → node
(`handoff_node_propose`, command 63/63) is not implemented at all — every call returns the literal
Stage-0 stub error. Sections B–F cover what genuinely is reachable and clickable: the task
DAG (ids, dependencies, blocked state, cycle/duplicate warnings) and the three board-defect fixes.

Written against the code as of 2026-08-19 (`src/tasks/TasksBoard.tsx`, `src/tasks/DependsPicker.tsx`,
`src/tasks/NewTaskDialog.tsx`, `src/taskctx/TaskContextModal.tsx`, `src/tasklinks/TaskLinksPanel.tsx`,
`src/sessions/AddAgentDialog.tsx`, `src/store/tasks.ts`, `src/store/sessions.ts`,
`src-tauri/src/tasks.rs`, `src-tauri/src/tasklinks.rs`, `src-tauri/src/taskctx.rs`,
`src-tauri/src/sessions.rs`, `src-tauri/src/handoff.rs`). Every step names the real control and
the exact expected result — if reality differs, that is a bug (or this manual is stale; either
way, note it).

**Time budget:** ~35 min full pass (UI sections B–F), plus ~10 min running the cited `cargo test`
groups for the non-reachable sections (G, H), plus the 2-minute WO02 regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev` fails instead of
   picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on the "Open a
   project" empty state.
3. **Make a throwaway test project** (do NOT use a real project — this test writes files):

   ```powershell
   mkdir C:\_cowtest6
   Set-Content C:\_cowtest6\notes.md "# Notes"
   ```

4. Press **Open folder** and pick `C:\_cowtest6`. *Expected:* the workspace loads; the left rail
   shows `notes.md`.
5. Switch to the **Tasks** tab (top nav). *Expected:* board loads with the segment toggle reading
   **TASKS / BACKLOG / ROADMAP / BUGS**, `TASKS` selected, and "No TASKS.md yet — add a task to
   create it."

---

## B. Happy path — stable ids and the dependency DAG

### B1. Create two tasks

6. Press **New task** (top-right of the board toolbar, `+` icon). *Expected:* a dialog opens,
   ~560px, with **File** (segmented: TASKS.md / SPRINT.md / BACKLOG.md / ROADMAP.md / BUGS.md),
   **Name**, **Description**, **Tags**, **Priority**, **Agent**, and (only when File = TASKS.md)
   **Status**.
7. Leave **File** on `TASKS.md`. Type Name `Design the roof`. Press **Create**.
   *Expected:* dialog closes; a card titled "Design the roof" appears in the **New** column of the
   Kanban board.
8. Press **New task** again, Name `Build the roof`, **Create**.
   *Expected:* a second card "Build the roof" appears in **New**.
9. Verify on disk:

   ```powershell
   Get-Content C:\_cowtest6\TASKS.md
   ```

   *Expected:* two `- [ ] Design the roof` / `- [ ] Build the roof` checklist lines, **no**
   `#id:`/`#needs:` tokens yet (ids are minted only on first link — §3.1 "No auto-mint").

### B2. Mint an id and link a dependency

10. On the **Build the roof** card, find the small **git-branch icon chip** near the bottom of the
    card (title "Link a dependency", no count shown yet). Click it.
    *Expected:* a popup opens directly under the chip with an autofocused input placeholder
    `Link a task…` and, below it, a list showing the other task ("Design the roof").
11. Click the **Design the roof** row in the candidate list.
    *Expected:* a brief spinner replaces the row, then the popup updates: "Design the roof" now
    appears above the input under its own linked-row area with a small status label (`new`) and an
    **X** remove button. The trigger chip (now closed) reads `1` next to the branch icon.
12. Press **Escape**. *Expected:* popup closes, focus returns to the trigger chip.
13. Verify the round-trip on disk:

    ```powershell
    Get-Content C:\_cowtest6\TASKS.md
    ```

    *Expected:*
    ```
    - [ ] Design the roof #id:t-XXXXXX
    - [ ] Build the roof #id:t-YYYYYY #needs:t-XXXXXX
    ```
    (six lower-case base36 characters each, `t-` prefix — grammar `^t-[0-9a-z]{6}$`). Both ids
    were minted automatically by step 11 (task_id_ensure on both ends), not by a separate action.
14. Reload the project (close and reopen the folder, or restart `tauri dev`). *Expected:* the
    dependency survives — the "Build the roof" card's dependency chip still reads `1`, and opening
    it still shows "Design the roof" linked.

### B3. Reserved tags never appear as chips

15. Select the **Build the roof** card, open the **Inspector** panel on the right (task properties
    view). Look at the **Tags** field / tag chips.
    *Expected:* no `id:…` or `needs:…` chip is visible anywhere — R2 lifts reserved tokens out of
    `TaskItem.tags` entirely before the UI ever sees them, so there is nothing to hide and nothing
    a UI edit could accidentally drop.
16. Edit an unrelated field in the Inspector that triggers a save (e.g. add a Tag `roofing`,
    wait for it to save). Re-run step 13's `Get-Content`.
    *Expected:* `#id:t-XXXXXX #needs:t-XXXXXX` are still present on the line, now followed by
    `#roofing` — the reserved tokens survive a full UI patch (Gate 11).

### B4. Blocked state

17. On the **Design the roof** card (the dependency, currently status **New**), click the **⋮**
    button ("Set status / move") and choose **Move to Done**.
    *Expected:* card moves to the **Done** column.
18. Look at the **Build the roof** card. *Expected:* it now shows nothing extra — `blocked`
    requires an *unfinished* dependency (D1), so once "Design the roof" is Done, "Build the roof"
    is never blocked in this scenario. To actually see the blocked badge, undo: right-click → move
    "Design the roof" back to **New** (⋮ → **Move to New**).
    *Expected:* the "Build the roof" card now shows a **Blocked** badge — static amber (not
    pulsing; pulsing amber means live agent activity, a different signal), tooltip
    `Blocked by: Design the roof`.
19. Move "Design the roof" back to **Done**. *Expected:* the **Blocked** badge disappears from
    "Build the roof" immediately (next scan).

---

## C. Validation — DAG rejections

### C1. Cycle, exact error text

20. On the **Design the roof** card, open its dependency chip and link **Build the roof** as a
    dependency (this would close a 2-cycle: Build needs Design, Design needs Build).
    *Expected:* the add is rejected. The popup's own error strip (bottom, danger-red monospace)
    reads exactly (with your minted ids substituted):
    `adding needs:t-YYYYYY would create a cycle: t-XXXXXX -> t-YYYYYY -> t-XXXXXX`
    (Rust's own ordered-path text, byte-for-byte — the UI does not paraphrase it.) The file on
    disk is unchanged (confirm with `Get-Content` — still only one `#needs:` token, on "Build the
    roof").

### C2. Duplicate id

21. Close the popup. Hand-edit the file to create a genuine duplicate id (something
    `task_id_ensure`'s own collision scan would never produce, but a hand-edited file can):

    ```powershell
    (Get-Content C:\_cowtest6\TASKS.md) -replace '#id:t-YYYYYY', '#id:t-XXXXXX' | Set-Content C:\_cowtest6\TASKS.md
    ```

    (Now both lines carry `#id:t-XXXXXX`.) Reload the project.
22. *Expected:* a warning banner appears at the top of the board, static amber, left border,
    reading `Duplicate task id: t-XXXXXX — links to these ids are refused until the duplicate is
    resolved.`
23. Create a third task (New task → Name `Paint the roof` → Create). Open its dependency picker
    and try to link one of the two duplicated-id rows.
    *Expected:* rejected; the popup error reads
    `t-XXXXXX: this id is assigned to more than one task — resolve the duplicate first`.
24. Repair the file (restore the original two distinct ids from step 13) before continuing, then
    reload.

### C3. Unresolved dependency (typo does not deadlock the board)

25. Hand-edit `TASKS.md` to add a dependency on an id that names nothing:

    ```powershell
    Add-Content C:\_cowtest6\TASKS.md "- [ ] Ghost task #needs:t-ghost1"
    ```

    Reload.
26. *Expected:* the board loads normally (an unresolved dependency does **not** block — D1's
    explicit rationale: "a typo must not deadlock the board"). The DAG warning banner shows
    `1 unresolved dependency: t-ghost1 needs t-ghost1`. The "Ghost task" card itself shows **no**
    Blocked badge.
27. Remove that hand-added line before continuing.

### C4. Self-dependency and unknown-id rejection — not reachable through this control

28. Note for the record (do not attempt through the UI): `task_depends_add` also rejects a
    self-dependency (`"a task cannot depend on itself: <id>"`) and a well-formed id that names no
    task (`"<id>: no task has this id"`). **Neither is reachable through `DependsPicker`** — its
    candidate list excludes the item's own row by construction, and every candidate the popup
    ever offers is a real scanned task's id, never an arbitrary string. Both are verified passing
    via `cargo test --lib tasks::tests::task_depends_add_rejects_self_dependency` and
    `tasks::tests::task_depends_add_rejects_unknown_id` (both green as of this build) — this is
    defense-in-depth against a future caller or a stale-state race, not a gap in this control.

---

## D. O1 — flat-list checkbox on BACKLOG / ROADMAP / BUGS

29. Switch the board segment to **BACKLOG**. Press **New task**, set **File** to `BACKLOG.md`,
    Name `Ship the weathervane`, **Create**.
    *Expected:* a row appears in the BACKLOG flat list with a **checkbox** to its left (this is
    the fix — before WO06 this checkbox only rendered for checklist-sourced rows, and every
    BACKLOG/ROADMAP/BUGS row is table-sourced since WO02, so none of them had one).
30. Also set a **Priority** and note the row's priority badge.
31. Click the row's **checkbox**. *Expected:* the row's text goes muted + strikethrough
    immediately; no page reload needed.
32. Verify on disk:

    ```powershell
    Get-Content C:\_cowtest6\BACKLOG.md
    ```

    *Expected:* the row's Status cell now reads `done` (or your grid's done-bucket spelling) and
    — critically — the **Priority cell you set in step 30 is still populated**, not blanked. (The
    documented trap: omitting `phase` — or any mapped cell — from the patch clears it, since
    `set_cell(None)` writes a blank. `toggleAny` resends every mapped field explicitly.)
33. Click the checkbox again to uncheck. *Expected:* row un-strikes; Status cell reverts to `new`
    in the file (unchecking a table row has no "previous bucket" memory — it always lands on
    `new`, matching the existing checklist-toggle behaviour, not a WO06 regression).

---

## E. O2 — a missing convention file is no longer created at the repo root

### E1. Totally empty project

34. Close the folder. Make a second empty scratch project:

    ```powershell
    mkdir C:\_cowtest6b
    ```

35. **Open folder** → `C:\_cowtest6b`. Switch to **Tasks** → segment **BUGS**. Press **New task**,
    File = `BUGS.md`, Name `Roof leaks`, **Create**.
36. Verify on disk:

    ```powershell
    Test-Path C:\_cowtest6b\BUGS.md
    Test-Path C:\_cowtest6b\docs\tasks\BUGS.md
    ```

    *Expected:* the **first** is `False`, the **second** is `True` — with nothing on disk at all,
    `home` falls back to `docs/tasks/` (Cowtext's own documented layout), never the repo root.

### E2. Co-location with an existing convention file

37. Close the folder. Make a third scratch project with only a root-level `TASKS.md`:

    ```powershell
    mkdir C:\_cowtest6c
    Set-Content C:\_cowtest6c\TASKS.md "# TASKS`n`n- [ ] existing task`n"
    ```

38. **Open folder** → `C:\_cowtest6c`. Segment **BUGS** → **New task** → File `BUGS.md` →
    Name `Gutter clogged` → **Create**.
39. Verify:

    ```powershell
    Test-Path C:\_cowtest6c\BUGS.md
    Test-Path C:\_cowtest6c\docs\tasks\BUGS.md
    ```

    *Expected:* the **first** is `True`, the **second** is `False` — `BUGS.md` co-locates with the
    existing `TASKS.md` (root), not `docs/tasks/`. (`TASKS.md` sorts first in Rust's
    `CONVENTION_NAMES`, so its directory always wins the tie when more than one convention file
    exists in different places — not exercised by this particular fixture but confirmed by reading
    `tasks_scan`'s `found_dirs`/`home` computation.)

---

## F. O3 — a moved task keeps its real status, id, and dependencies

Reopen `C:\_cowtest6` (section B/C's project — restore `TASKS.md` from step 27 if you skipped
cleanup) or build a fresh two-task TASKS.md with one linked pair as in B1–B2.

40. On the **Design the roof** card (status **Done** from step 19, carrying `#id:t-XXXXXX`),
    click **⋮** → you should see a separator, then **Move to BACKLOG.md** (and similarly for
    ROADMAP.md / BUGS.md). Click **Move to BACKLOG.md**.
41. Switch segment to **BACKLOG**. *Expected:* "Design the roof" appears there, **checkbox already
    checked** (arrived `done`, not reset to `new` — this is the O3 fix; before WO06 every moved
    task hardcoded `new`).
42. Verify on disk:

    ```powershell
    Get-Content C:\_cowtest6\BACKLOG.md
    Get-Content C:\_cowtest6\TASKS.md
    ```

    *Expected:* the line is gone from `TASKS.md`; in `BACKLOG.md` the row/line still carries
    `#id:t-XXXXXX` (or the equivalent Tags-cell token if BACKLOG.md is table-shaped) — the id
    survived the move untouched.
43. On the **Build the roof** card (still in TASKS, carrying `#needs:t-XXXXXX`), open its
    dependency chip. *Expected:* the link to "Design the roof" still resolves correctly (name,
    status `Done`) even though the target moved to a different file — `tasklinks`/dependency
    resolution keys purely on the stable `taskId`, never on `relPath`/`line`, so a cross-file move
    costs it nothing.

---

## G. Per-task subgraph injection + token budgets — code-verified, NOT reachable in this build

**Do not spend time hunting for a control here — there isn't one yet.** This is the headline
feature of WO06 (§2.1: "the differentiator") and it is fully implemented and unit-tested on the
Rust side, but no shipped UI opens it:

44. Confirm for yourself: with a project open, search the whole app for any button, menu item, or
    card affordance that mentions "context", "subgraph", "compile for this task", or "launch" tied
    to a specific task. *Expected:* none exists. `src/taskctx/TaskContextModal.tsx` and
    `src/tasklinks/TaskLinksPanel.tsx` both exist and are fully built (grouped node list, byte
    count + 32KB truncation warning, Save/Launch buttons, attach-node popup, parent-goal ancestry
    breadcrumb, per-task ceiling input) but neither is imported by `TasksBoard.tsx` or
    `Inspector.tsx` anywhere — confirm with:

    ```powershell
    Select-String -Path src\tasks\TasksBoard.tsx,src\inspector\Inspector.tsx -Pattern "TaskContextModal|TaskLinksPanel"
    ```

    *Expected:* zero matches.
45. Also confirm the global default token ceiling (contract §5.1: "per-task ceiling if present,
    else the global default") has no home either:

    ```powershell
    Select-String -Path src\store\settings.ts,src\settings\SettingsModal.tsx -Pattern "sessionTokenCeiling"
    ```

    *Expected:* zero matches in both files. `TaskContextModal.tsx`'s own ceiling computation
    (`effectiveCeiling = link.tokenCeiling ?? null`) has no fallback to a global default because
    that setting doesn't exist — so even once the modal above is mounted, a task with no
    explicit per-task ceiling launches **completely unlimited**, not "the global default."

### What to run instead, to verify the underlying feature actually works

46. From `src-tauri/`, run the closure/compile-reuse suite (Gate 8):

    ```powershell
    cargo test --lib taskctx::tests
    ```

    *Expected:* all pass, including `golden_task_context_body_and_node_ids_are_byte_exact` (a
    fixture graph compiles to a byte-exact expected `.md`), `golden_task_context_is_deterministic_
    across_repeated_runs`, `seeds_only_vs_seeds_plus_pinned_differ_exactly_by_pinned_nodes`,
    `needs_dependency_nodes_never_leak_into_an_unrelated_tasks_context`, and
    `parent_ancestry_nodes_are_present`.
47. Run the allowlist-disjointness suite (Gate 9):

    ```powershell
    cargo test --lib taskctx::tests -- gate9
    ```

    (Or simply re-run all of `taskctx::tests` — the Gate 9 tests are named descriptively, not
    literally `gate9*`; grep `task_context_write_rejects` / `compile_write_refuses` /
    `compile_write_still_accepts` in `src-tauri/src/taskctx/tests.rs`.) *Expected:* a task context
    write can never land on `CLAUDE.md`/`AGENTS.md`/etc, `compile_write` can never land on
    `.cowtext/context/task-*.md`, and both still work on their own real shapes.
48. Run the budget hard-stop suite (Gate 6):

    ```powershell
    cargo test --lib sessions::tests -- charge
    cargo test --lib sessions::tests a_budget_stop_verdict_tree_kills_a_real_dummy_child
    ```

    *Expected:* all pass — under/exactly-at/over-ceiling, stale-generation, exactly-once (a second
    charge on the same generation is `Stale`), and a real dummy child process is tree-killed by
    the `Stop` path.
49. Run the tasklinks round-trip and corruption-tolerance suite (Gate 7 + adversarial):

    ```powershell
    cargo test --lib tasklinks::tests
    ```

    *Expected:* all pass, including corrupt-JSON / wrong-shape / missing-file all degrading to
    `{version:1, links:[]}` rather than erroring, a `version:2` file hard-erroring, and unknown
    JSON fields silently dropped on the next rewrite.

**Known gap found while writing this manual (see the tester's findings for detail):**
`tasklinks::ancestor_chain` (`src-tauri/src/tasklinks.rs:92-113`, used by `tasklink_set`'s
cycle guard) can only resolve ancestry chains 7 real hops deep before incorrectly refusing a
valid, non-cyclic 8-hop chain with a cycle-shaped error — one hop short of the documented cap
(§3.2 L4: "depth is capped at 8"). `taskctx.rs`'s own, separately-written ancestry walk (used for
the read-side closure) does not have this bug and correctly supports depth 8
(`taskctx::tests::ancestry_depth_beyond_eight_generations_is_truncated_not_errored`, passing).
No existing test exercises `tasklinks::ancestor_chain` past 2 hops, so this does not show up in
`cargo test`'s green result. Not independently reproducible through the UI (goal-ancestry nesting
that deep has no control either, per this section).

---

## H. Handoff → node — not implemented

50. Open **Handoff** (wherever your session's handoff entry point is — `HandoffModal.tsx`) and
    generate a handoff summary as usual. *Expected:* this part still works unchanged (`handoff_
    generate`/`handoff_write`, both pre-existing, untouched by WO06).
51. Look for any "Create node from this handoff" / "Propose node" affordance. *Expected:* none
    exists — `handoff_node_propose` (command 63/63, §6) is wired into `generate_handler!` and is
    byte-exact in the invoke contract, but its Rust body is still the literal Stage-0 stub:

    ```powershell
    Select-String -Path src-tauri\src\handoff.rs -Pattern "not implemented \(WO06 Stage-0 stub\)"
    ```

    *Expected:* one match, inside `handoff_node_propose`. Calling this command from anywhere would
    always return `Err("handoff_node_propose: not implemented (WO06 Stage-0 stub)")`. There is no
    TypeScript wrapper for it either (`Select-String -Path src\handoff\api.ts -Pattern
    "handoffNodePropose"` → zero matches). Item 6 of the contract's own priority table ("closes
    the loop: the session's outcome re-enters the graph") is entirely absent from this build.

---

## I. Regression — WO02 board core flow, 2 minutes

52. In `C:\_cowtest6`, switch to **TASKS** segment. Drag-and-drop is not part of WO02's board (it
    uses the ⋮ menu) — instead: click a card, confirm the **Inspector** opens the task properties
    pane (Name/Description/Tags/Priority/Phase/Agent/Status, explicit **Save**).
53. Edit the Name field, press **Save** (or Ctrl+S). *Expected:* card title updates on the
    board; file on disk reflects the change.
54. Switch segment to **ROADMAP**. *Expected:* rows show the **When** chip (quarter/date) that
    TASKS/BACKLOG/BUGS rows do not — unaffected by WO06.
55. Restart: close and reopen `tauri dev`, **Open folder** → `C:\_cowtest6`. *Expected:* board
    state (all tasks, ids, dependency links, statuses) reloads identically — nothing WO06 added is
    held only in memory (§3.3 D5: "there is no persisted DAG... dependencies live in the markdown
    and nowhere else").

---

## Cleanup

56. Close the app and delete every scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowtest6, C:\_cowtest6b, C:\_cowtest6c
    ```

---

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Happy path — ids & DAG | | |
| C Validation — DAG rejections | | |
| D O1 — BACKLOG/ROADMAP/BUGS checkbox | | |
| E O2 — missing-file co-location | | |
| F O3 — status/id survive a move | | |
| G Injection + budgets (code-verified only) | | not reachable via UI in this build — see note |
| H Handoff → node | | not implemented — see note |
| I WO02 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
