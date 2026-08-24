# WO06 Manual Test Script — L2 Orchestrator Suite

Hand-run test manual for WO06: stable task ids + the dependency DAG, the `.cowtext/tasklinks.json`
sidecar, per-task subgraph injection (§4, the work order's stated differentiator), token-ceiling
hard-stops (§5), the three board defects (O1/O2/O3), handoff-to-node, and barn mission control.
Run top to bottom in one sitting; sections reuse the throwaway project built in section A unless a
section calls out its own fresh project (E and the injection/budget sections need specific
starting states that would corrupt the running DAG example).

**RE-VERIFICATION NOTE (2026-08-19, post-fix-round, commit `6d81251`).** This manual replaces an
earlier version written *before* a fix round landed on top of `tech-lead`'s adversarial audit
(`docs/_archive/contracts/WO06_AUDIT.md`). The earlier version is now **stale and wrong** on the single most
important point: it said §4/§5 (the differentiator) had no reachable UI control. **That is no
longer true.** `TaskContextModal` and `TaskLinksPanel` are now genuinely mounted and clickable —
see Section G, rewritten below with real steps. `handoff_node_propose`'s Rust body is also no
longer a stub (Section H) — but it is *still* not reachable from any control, which is a new,
narrower defect than the one the audit found. Every gate below was **re-run by this pass**, not
inferred from a report — see the findings section at the end for the full triage.

Written against the code as of 2026-08-19 (`src/tasks/TasksBoard.tsx`, `src/tasks/DependsPicker.tsx`,
`src/tasks/NewTaskDialog.tsx`, `src/taskctx/TaskContextModal.tsx`, `src/tasklinks/TaskLinksPanel.tsx`,
`src/inspector/Inspector.tsx`, `src/sessions/AddAgentDialog.tsx`, `src/sessions/RosterBar.tsx`,
`src/sessions/AgentPanel.tsx`, `src/store/tasks.ts`, `src/store/tasklinks.ts`, `src/store/sessions.ts`,
`src-tauri/src/tasks.rs`, `src-tauri/src/tasklinks.rs`, `src-tauri/src/taskctx.rs`,
`src-tauri/src/sessions.rs`, `src-tauri/src/handoff.rs`). Every step names the real control and
the exact expected result — if reality differs, that is a bug (or this manual is stale; either
way, note it).

**Time budget:** ~45 min full pass (UI sections B–H), plus ~10 min running the cited `cargo test`
groups for the one still-unreachable slice (§6 handoff-to-node has no UI at all), plus the
2-minute WO02 regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev` fails instead of
   picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on the "Open a
   project" empty state. (Adversarial note: `cargo run` from `src-tauri/` alone — no `tauri dev`
   wrapper — must resolve unambiguously to the GUI binary `cowtext.exe`, not `cowtext-cli.exe` or
   an "ambiguous binary" error, because `Cargo.toml` sets `default-run = "cowtext"` alongside the
   `cowtext-cli` `[[bin]]`. Verified this pass: `cargo run` → `Running target\debug\cowtext.exe`,
   a real ~31 MB resident process, cleanly killable. This is the exact class of defect WO03 shipped
   — a second `[[bin]]` breaking `tauri dev` while every gate stayed green — so it is worth a
   spot-check on any Cargo.toml change.)
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

### B3. Reserved tags never appear as chips, and a mint into a boundary-less line stays stable

15. Select the **Build the roof** card, open the **Inspector** panel on the right (task properties
    view). Look at the **Tags** field / tag chips.
    *Expected:* no `id:…` or `needs:…` chip is visible anywhere — R2 lifts reserved tokens out of
    `TaskItem.tags` entirely before the UI ever sees them, so there is nothing to hide and nothing
    a UI edit could accidentally drop.
16. Look at the card's **title** on the board. *Expected:* it still reads exactly "Build the roof"
    — no `#id:`/`#needs:` token visible in the name either (this is the D7 fix: reserved tokens are
    stripped from the prose surface *before* the name/description boundary split, not just out of
    `tags`; before the fix a checklist line with no `—`/`.` boundary would swallow the whole minted
    token into the visible name).
17. Edit an unrelated field in the Inspector that triggers a save (e.g. add a Tag `roofing`,
    wait for it to save, then **Save** again a second time with no further changes). Re-run step
    13's `Get-Content`.
    *Expected:* `#id:t-XXXXXX #needs:t-XXXXXX` are still present on the line **exactly once each**,
    now followed by `#roofing` — the reserved tokens survive a full UI patch (Gate 11) and, per the
    second Save, do **not** duplicate (the pre-fix defect: a boundary-less line would grow a second
    `#id:` token on every subsequent Save).

### B4. Blocked state

18. On the **Design the roof** card (the dependency, currently status **New**), click the **⋮**
    button ("Set status / move") and choose **Move to Done**.
    *Expected:* card moves to the **Done** column, **and the "Build the roof" card's Blocked badge
    (if any) clears immediately** — no reload, no waiting on the 500ms fs-watcher debounce. (This
    is the D8 fix: `toggleAny`/`update`/`ensureId` now `await load(root)` on every mutating path so
    cross-file `blocked`/`dag` state is never stale.)
19. *Expected:* the "Build the roof" card shows nothing extra — `blocked` requires an *unfinished*
    dependency, so once "Design the roof" is Done, "Build the roof" is never blocked in this
    scenario. To actually see the blocked badge, undo: right-click → move "Design the roof" back to
    **New** (⋮ → **Move to New**).
    *Expected:* the "Build the roof" card now shows a **Blocked** badge — static amber (not
    pulsing; pulsing amber means live agent activity, a different signal), tooltip
    `Blocked by: Design the roof`, appearing the instant you move Design back to New.
20. Move "Design the roof" back to **Done**. *Expected:* the **Blocked** badge disappears from
    "Build the roof" immediately (same instant reload, not "next scan").

---

## C. Validation — DAG rejections

### C1. Cycle, exact error text

21. On the **Design the roof** card, open its dependency chip and link **Build the roof** as a
    dependency (this would close a 2-cycle: Build needs Design, Design needs Build).
    *Expected:* the add is rejected. The popup's own error strip (bottom, danger-red monospace)
    reads exactly (with your minted ids substituted):
    `adding needs:t-YYYYYY would create a cycle: t-XXXXXX -> t-YYYYYY -> t-XXXXXX`
    (Rust's own ordered-path text, byte-for-byte — the UI does not paraphrase it.) The file on
    disk is unchanged (confirm with `Get-Content` — still only one `#needs:` token, on "Build the
    roof").

### C2. Duplicate id

22. Close the popup. Hand-edit the file to create a genuine duplicate id (something
    `task_id_ensure`'s own collision scan would never produce, but a hand-edited file can):

    ```powershell
    (Get-Content C:\_cowtest6\TASKS.md) -replace '#id:t-YYYYYY', '#id:t-XXXXXX' | Set-Content C:\_cowtest6\TASKS.md
    ```

    (Now both lines carry `#id:t-XXXXXX`.) Reload the project.
23. *Expected:* a warning banner appears at the top of the board, static amber, left border,
    reading `Duplicate task id: t-XXXXXX — links to these ids are refused until the duplicate is
    resolved.`
24. Create a third task (New task → Name `Paint the roof` → Create). Open its dependency picker
    and try to link one of the two duplicated-id rows.
    *Expected:* rejected; the popup error reads
    `t-XXXXXX: this id is assigned to more than one task — resolve the duplicate first`.
25. Repair the file (restore the original two distinct ids from step 13) before continuing, then
    reload.

### C3. Unresolved dependency (typo does not deadlock the board)

26. Hand-edit `TASKS.md` to add a dependency on an id that names nothing:

    ```powershell
    Add-Content C:\_cowtest6\TASKS.md "- [ ] Ghost task #needs:t-ghost1"
    ```

    Reload.
27. *Expected:* the board loads normally (an unresolved dependency does **not** block — D1's
    explicit rationale: "a typo must not deadlock the board"). The DAG warning banner shows
    `1 unresolved dependency: t-ghost1 needs t-ghost1` — the *locator* here is always the target
    task's own stable id (O1 fix: a task with no `id:` of its own is never represented in this
    list at all, even though its `depends_on` may still be unresolved — the volatile
    `"<relPath>#<line>"` locator is never substituted in). The "Ghost task" card itself shows **no**
    Blocked badge.
28. Remove that hand-added line before continuing.

### C4. Self-dependency and unknown-id rejection — not reachable through this control

29. Note for the record (do not attempt through the UI): `task_depends_add` also rejects a
    self-dependency (`"a task cannot depend on itself: <id>"`) and a well-formed id that names no
    task (`"<id>: no task has this id"`). **Neither is reachable through `DependsPicker`** — its
    candidate list excludes the item's own row by construction, and every candidate the popup
    ever offers is a real scanned task's id, never an arbitrary string. Both are verified passing
    via `cargo test --lib tasks::tests::task_depends_add_rejects_self_dependency` and
    `tasks::tests::task_depends_add_rejects_unknown_id` (re-run this pass, both green) — this is
    defense-in-depth against a future caller or a stale-state race, not a gap in this control.

---

## D. O1 — flat-list checkbox on BACKLOG / ROADMAP / BUGS

30. Switch the board segment to **BACKLOG**. Press **New task**, set **File** to `BACKLOG.md`,
    Name `Ship the weathervane`, **Create**.
    *Expected:* a row appears in the BACKLOG flat list with a **checkbox** to its left (this is
    the O1 fix — before WO06 this checkbox only rendered for checklist-sourced rows, and every
    BACKLOG/ROADMAP/BUGS row is table-sourced since WO02, so none of them had one).
31. Also set a **Priority** and note the row's priority badge.
32. Click the row's **checkbox**. *Expected:* the row's text goes muted + strikethrough
    immediately; no page reload needed.
33. Verify on disk:

    ```powershell
    Get-Content C:\_cowtest6\BACKLOG.md
    ```

    *Expected:* the row's Status cell now reads `done` (or your grid's done-bucket spelling) and
    — critically — the **Priority cell you set in step 31 is still populated**, not blanked. (The
    documented trap: omitting `phase` — or any mapped cell — from the patch clears it, since
    `set_cell(None)` writes a blank. `toggleAny` resends every mapped field explicitly.)
34. Click the checkbox again to uncheck. *Expected:* row un-strikes; Status cell reverts to `new`
    in the file (unchecking a table row has no "previous bucket" memory — it always lands on
    `new`, matching the existing checklist-toggle behaviour, not a WO06 regression).

---

## E. O2 — a missing convention file is no longer created at the repo root

### E1. Totally empty project

35. Close the folder. Make a second empty scratch project:

    ```powershell
    mkdir C:\_cowtest6b
    ```

36. **Open folder** → `C:\_cowtest6b`. Switch to **Tasks** → segment **BUGS**. Press **New task**,
    File = `BUGS.md`, Name `Roof leaks`, **Create**.
37. Verify on disk:

    ```powershell
    Test-Path C:\_cowtest6b\BUGS.md
    Test-Path C:\_cowtest6b\docs\tasks\BUGS.md
    ```

    *Expected:* the **first** is `False`, the **second** is `True` — with nothing on disk at all,
    `home` falls back to `docs/tasks/` (Cowtext's own documented layout), never the repo root.

### E2. Co-location with an existing convention file

38. Close the folder. Make a third scratch project with only a root-level `TASKS.md`:

    ```powershell
    mkdir C:\_cowtest6c
    Set-Content C:\_cowtest6c\TASKS.md "# TASKS`n`n- [ ] existing task`n"
    ```

39. **Open folder** → `C:\_cowtest6c`. Segment **BUGS** → **New task** → File `BUGS.md` →
    Name `Gutter clogged` → **Create**.
40. Verify:

    ```powershell
    Test-Path C:\_cowtest6c\BUGS.md
    Test-Path C:\_cowtest6c\docs\tasks\BUGS.md
    ```

    *Expected:* the **first** is `True`, the **second** is `False` — `BUGS.md` co-locates with the
    existing `TASKS.md` (root), not `docs/tasks/`. (`TASKS.md` sorts first in Rust's
    `CONVENTION_NAMES`, so its directory always wins the tie when more than one convention file
    exists in different places — not exercised by this particular fixture but confirmed by reading
    `tasks_scan`'s `found_dirs`/`home` computation, and by `cargo test --lib
    tasks_scan_discovery_order_root_before_docs_before_docs_tasks`, re-run this pass, green.)

---

## F. O3 — a moved task keeps its real status, id, and dependencies

Reopen `C:\_cowtest6` (section B/C's project — restore `TASKS.md` from step 28 if you skipped
cleanup) or build a fresh two-task TASKS.md with one linked pair as in B1–B2.

41. On the **Design the roof** card (status **Done** from step 20, carrying `#id:t-XXXXXX`),
    click **⋮** → you should see a separator, then **Move to BACKLOG.md** (and similarly for
    ROADMAP.md / BUGS.md). Click **Move to BACKLOG.md**.
42. Switch segment to **BACKLOG**. *Expected:* "Design the roof" appears there, **checkbox already
    checked** (arrived `done`, not reset to `new` — this is the O3 fix; before WO06 every moved
    task hardcoded `new`).
43. Verify on disk:

    ```powershell
    Get-Content C:\_cowtest6\BACKLOG.md
    Get-Content C:\_cowtest6\TASKS.md
    ```

    *Expected:* the line is gone from `TASKS.md`; in `BACKLOG.md` the row/line still carries
    `#id:t-XXXXXX` (or the equivalent Tags-cell token if BACKLOG.md is table-shaped) — the id
    survived the move untouched.
44. On the **Build the roof** card (still in TASKS, carrying `#needs:t-XXXXXX`), open its
    dependency chip. *Expected:* the link to "Design the roof" still resolves correctly (name,
    status `Done`) even though the target moved to a different file — `tasklinks`/dependency
    resolution keys purely on the stable `taskId`, never on `relPath`/`line`, so a cross-file move
    costs it nothing.

---

## G. Per-task subgraph injection + token budgets — NOW REACHABLE (fixed since the audit)

**This section replaces an earlier version of this manual that said none of this was clickable.**
As of this build, `TaskContextModal` and `TaskLinksPanel` are genuinely mounted and reachable from
two independent real paths — verified below by walking both, not by grep alone.

### G1. Path 1 — the board card's Context button

45. On any card in the **TASKS** segment (e.g. "Build the roof"), look at the row of chips at the
    bottom next to the dependency chip. *Expected:* a small square button with a **layers icon**
    (title on hover: "Task context — preview the Memory Node subgraph this task's session would
    receive"). This is `ContextButton`, present on every card in every segment (TASKS/BACKLOG/
    ROADMAP/BUGS), not only TASKS.
46. Click it. *Expected:* if the task has no stable id yet, the button briefly shows a spinner
    (minting one on demand via `task_id_ensure`, same as the dependency chip does) then the
    **Task Context modal** opens. If the task already had an id, the modal opens immediately.
47. *Expected inside the modal:* a pixel-march loading state, then either:
    - **Empty-subgraph state** ("This task's subgraph is empty — attach a Memory Node, pin one
      project-wide, or set a parent goal.") if you have not yet attached anything — this is the
      expected state for a brand-new task with no linked nodes, no pinned nodes, and no parent, and
      is a real product state, not a bug (see finding B1 in the audit — recommended-not-required, a
      spawn here would burn a real turn on effectively the project's pinned rules alone).
    - Or, once you've attached at least one node (see G2 below) or your project has any pinned
      nodes: a grouped node list (linked to this task / always in context / inherited from parent
      goal / pulled in via imports), a byte count, and **Save** / **Launch…** buttons.

### G2. Path 2 — the Inspector's task panel (`TaskLinksPanel`)

48. Select the "Build the roof" card (single click, not the ⋮ menu) so it is the Inspector's
    active selection. *Expected:* the right-hand **Inspector** panel shows the task's Name/
    Description/Tags/Priority/Phase/Status fields (as in section B3), and — below the Save button,
    under a divider — a **Context** section:
    - **Linked nodes** with a small **+** button that opens a searchable node picker (`AttachPopup`
      — autofocused filter input, up to 40 matches, click a row to attach).
    - **Parent goal** — a `<select>` listing every other task that itself carries a stable id, plus
      `(none)`. Choosing one sets `parentTaskId`; once set, a small breadcrumb of `t-xxxxxx →
      t-yyyyyy` ancestor ids appears underneath.
    - **Token ceiling** — a number input, placeholder `0 = unlimited`, blurring commits the value.
    - A **Preview context…** button (opens the same `TaskContextModal` as G1).
49. Click the **+** next to **Linked nodes**, type part of `notes` in the filter box, click the
    `notes.md` row (or any node from your project). *Expected:* popup closes, a brief "attach" busy
    state, then the node appears in the **Linked nodes** list with an **X** to detach.
50. Click **Preview context…**. *Expected:* the modal now shows the attached node under the
    **"linked to this task"** group — the empty-subgraph state from step 47 is gone.

### G3. Save the compiled context to disk

51. In the open Task Context modal, press **Save**. *Expected:* a brief busy state, then a saved-
    path confirmation. Verify:

    ```powershell
    Get-Content C:\_cowtest6\.cowtext\context\task-t-XXXXXX.md
    ```

    (substitute the real id). *Expected:* the file exists, starts with the GENERATED header on
    line 1, and its body matches the modal's node list.
52. **Data-loss check (do this by hand once):** before and after step 51, byte-compare the
    project's real compiled outputs:

    ```powershell
    Get-FileHash C:\_cowtest6\CLAUDE.md -ErrorAction SilentlyContinue
    ```

    *Expected:* unaffected either way (unchanged hash if `CLAUDE.md` already existed from an
    earlier Compile; still absent if it never did) — `task_context_write`'s destination path is
    always `.cowtext/context/task-<id>.md`, server-derived from the id alone with no
    caller-supplied path component, and is structurally disjoint from every one of `compile_write`'s
    six allowlisted shapes (`CLAUDE.md`, `*/AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
    `.cursor/rules/*.mdc`, `.claude/agents/*.md`). This pass re-ran the Rust tests that prove this
    both directions with real disk I/O (`task_context_write_rejects_a_path_traversal_task_id`,
    `compile_write_refuses_the_task_context_shape`, `compile_write_still_accepts_a_real_compile_
    output_shape`) — all green.

### G4. Launch a task-scoped session, and the budget gauge

53. Press **Launch…**. *Expected:* the existing `AddAgentDialog` opens, pre-supplied with this
    task's compiled context and (if you set one in G2) its token ceiling — same dialog chrome as a
    normal agent launch, no new UI primitive.
54. Fill in whatever the dialog needs and launch. *Expected:* a session card appears in the
    **RosterBar** (top strip). Once ~200 seconds pass (i.e. wait for the `system/init` line to be
    read), check the sidecar:

    ```powershell
    Get-Content C:\_cowtest6\.cowtext\tasklinks.json
    ```

    *Expected:* `sessionIds` for this task holds a durable-looking session id (long alphanumeric,
    **not** an `as0`/`as1`-style Cowtext in-memory id) — this is the D6 fix: the store polls
    `agent_session_list` for `claudeSessionId` before writing, and skips the write entirely (never
    falls back to the volatile id) if it never arrives within ~3 seconds.
55. While the session is running, watch its **budget strip** (the thin bar under the roster card,
    or the wider bar in the **Agent Panel** if you open the session). If you set a low token
    ceiling in G2 (e.g. `500`), the session should hit **Stop** quickly. *Expected on Stop:* the
    roster card border shows a danger-red left edge, the badge reads `budget`, and — this is the
    D4/D5 fix — the budget strip shows a sane, non-impossible percentage (never > 100%, never stuck
    permanently full at spawn). Before the fix, the gauge double-counted a stopped session's usage
    and could show over 100%; the strip was also permanently empty at spawn because the wire field
    it needed (`tokensUsed`) was silently dropped by the store.
56. Press **Restart** on the stopped card. *Expected:* the session goes alive again and does
    **not** immediately re-stop on its first small usage report (D3 fix — `begin_restart` now
    zeroes `tokens_used`/`turn_tokens`/`info.tokens_used`; before the fix, Restart was permanently
    broken after the first stop and burned one real paid turn per press). This pass re-ran the
    purpose-built regression test for this,
    `sessions::tests::restart_after_a_budget_stop_clears_tokens_used_so_the_new_turn_is_not_re_
    stopped`, in isolation — green.

### G5. What is still genuinely missing — the global default ceiling (D9, STILL OPEN)

57. Open **Settings** (gear icon / whatever your build's entry point is). *Expected:* there is
    **no** "default session token ceiling" field anywhere. Confirm by grep:

    ```powershell
    Select-String -Path src\store\settings.ts,src\settings\SettingsModal.tsx -Pattern "sessionTokenCeiling"
    ```

    *Expected:* zero matches in both files, and in fact zero matches anywhere in the repo
    (`Select-String -Path src,src-tauri\src -Pattern "sessionTokenCeiling" -Recurse` → nothing).
    `TaskContextModal.tsx`'s own ceiling computation is still `const effectiveCeiling =
    link.tokenCeiling ?? null;` with no `?? globalDefault` fallback, because that global default
    was never built. **Practical effect:** the only way to bound a task session's spend at all is
    the per-task field in G2 (step 48); leave it blank and the session launches with **no ceiling
    whatsoever**, contradicting contract §5.1 ("per-task ceiling … else the global default"). This
    is unchanged from the audit's D9 finding and remains the single most important open item before
    a Marty-facing walk of this feature.

---

## H. Handoff → node — Rust implemented, still has no UI (narrower than the audit's D2)

**This section also replaces a stale earlier version.** The audit found `handoff_node_propose`
literally returning the Stage-0 stub error on every call. That specific defect is fixed: the Rust
body is now a full, tested implementation (8 dedicated tests, all green this pass, including
`handoff_node_propose_fills_every_frozen_field` and `handoff_node_propose_resolves_anchor_from_
tasklinks`). **But there is still no way to reach it from the running app** — confirm:

58. Open **Handoff** (`HandoffModal.tsx`) and generate a handoff summary as usual.
    *Expected:* this part still works unchanged (`handoff_generate`/`handoff_write`, both
    pre-existing, untouched by WO06).
59. Look for any "Create node from this handoff" / "Propose node" affordance anywhere in the
    Handoff modal, the graph canvas, or the Inspector. *Expected:* **none exists.**
60. Confirm by grep — the command has zero TypeScript call sites anywhere in the tree:

    ```powershell
    Select-String -Path src\handoff\api.ts -Pattern "handoffNodePropose"
    Select-String -Path src -Recurse -Pattern "handoff_node_propose|handoffNodePropose|HandoffNodeProposal"
    ```

    *Expected:* zero matches for the first; the second finds nothing in any `.ts`/`.tsx` file
    (`src/handoff/api.ts` still exports only `handoffGenerate`/`handoffWrite`). Also confirm the
    stub message itself is genuinely gone from every command body — this is the single highest-
    value regression check for this section:

    ```powershell
    Select-String -Path src-tauri\src -Recurse -Pattern "not implemented \(WO06 Stage-0 stub\)"
    ```

    *Expected:* zero matches in any `.rs` file that is not a test/doc comment (as of this build,
    zero matches at all outside `handoff/tests.rs`'s own doc-comment describing the regression it
    guards against).
61. **Verdict for this section:** item 6 of the contract's own priority table ("closes the loop:
    the session's outcome re-enters the graph") is implemented and tested on one side of the wire
    only. This is functionally identical to "not shipped" for a user — there is no button — but it
    is a materially smaller and cheaper gap to close than the audit's original finding (D2), since
    the entire deterministic-proposal computation, collision-free path derivation, and anchor
    resolution are done; only the `src/handoff/api.ts` wrapper and a commit-flow UI affordance
    remain.

---

## I. Sidecar robustness — verified this pass via `cargo test`, not clickable through the UI

62. From `src-tauri/`, run the corruption-tolerance suite:

    ```powershell
    cargo test --lib tasklinks::tests::read_corrupt_json_degrades_to_empty
    cargo test --lib tasklinks::tests::unknown_fields_are_dropped_on_rewrite
    cargo test --lib taskctx::tests::missing_tasklinks_file_reads_as_empty_not_an_error
    cargo test --lib taskctx::tests::corrupt_tasklinks_json_degrades_to_empty_not_a_raw_parser_error
    cargo test --lib tasklinks::tests::concurrent_tasklink_set_calls_never_corrupt_the_file
    ```

    *Expected:* all green. The last two are worth calling out: before this fix round, `taskctx.rs`
    hard-`Err`'d on the exact corrupt-JSON shape `tasklinks.rs` tolerated (audit O2) — a hand-
    corrupted `.cowtext/tasklinks.json` used to make `tasklinks_read` say "no links" (fine) while
    `task_context_preview` surfaced a raw `"tasklinks.json: expected value at line 1 column 1"` in
    the modal. `taskctx.rs` now delegates to `crate::tasklinks::tasklinks_read` directly — one
    tolerant-read code path, not two divergent ones.
63. If you want to reproduce this by hand instead: with a project open and at least one tasklink
    saved (G2, step 49), close the app, then:

    ```powershell
    Set-Content C:\_cowtest6\.cowtext\tasklinks.json "not json at all{{{"
    ```

    Reopen the project, open a task's Context modal (G1). *Expected:* the modal treats it as "no
    links" (empty subgraph / pinned-only, not a raw parser error dumped in the UI) — confirms step
    62's test coverage matches the real running app, not just the fixture.

---

## J. Regression — this repo's own real task corpus, and the frozen files

64. From `src-tauri/`, run the test that scans **this actual repository's** own
    `docs/tasks/{TASKS,BACKLOG,ROADMAP,BUGS}.md` (not a fixture):

    ```powershell
    cargo test --lib tasks::tests::real_repo_task_corpus_has_no_reserved_tokens_yet
    ```

    *Expected:* green — every task in this repo's own convention files still parses with
    `taskId: null`, `dependsOn: []`, exactly as before WO06 landed (Gate 10: WO06 must not
    silently mint or misparse anything already on disk).
65. Confirm the five "frozen" files the audit could not mechanically verify (no shell that
    session) are genuinely untouched since before WO06:

    ```powershell
    git diff --stat 605760e..HEAD -- src-tauri/src/compile.rs src-tauri/src/project.rs src/store/graph.ts src-tauri/src/agents.rs src-tauri/src/frontmatter.rs
    ```

    *Expected:* **empty output** — byte-identical. Verified this pass.

---

## K. Regression — WO02 board core flow, 2 minutes

66. In `C:\_cowtest6`, switch to **TASKS** segment. Drag-and-drop is not part of WO02's board (it
    uses the ⋮ menu) — instead: click a card, confirm the **Inspector** opens the task properties
    pane (Name/Description/Tags/Priority/Phase/Agent/Status, explicit **Save**).
67. Edit the Name field, press **Save** (or Ctrl+S). *Expected:* card title updates on the
    board; file on disk reflects the change.
68. Switch segment to **ROADMAP**. *Expected:* rows show the **When** chip (quarter/date) that
    TASKS/BACKLOG/BUGS rows do not — unaffected by WO06.
69. Restart: close and reopen `tauri dev`, **Open folder** → `C:\_cowtest6`. *Expected:* board
    state (all tasks, ids, dependency links, statuses) reloads identically — nothing WO06 added is
    held only in memory (§3.3 D5: "there is no persisted DAG... dependencies live in the markdown
    and nowhere else").

---

## Cleanup

70. Close the app and delete every scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowtest6, C:\_cowtest6b, C:\_cowtest6c
    ```

---

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions (+ app-launch adversarial check) | | |
| B Happy path — ids & DAG | | |
| C Validation — DAG rejections | | |
| D O1 — BACKLOG/ROADMAP/BUGS checkbox | | |
| E O2 — missing-file co-location | | |
| F O3 — status/id survive a move | | |
| G Injection + budgets — now reachable | | G5 (global ceiling, D9) is a known confirmed gap, not a test failure |
| H Handoff → node | | Rust done, UI absent — confirm zero invoke call sites |
| I Sidecar robustness | | |
| J Real-corpus + frozen-files regression | | |
| K WO02 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________

---

## Findings — re-verification pass, 2026-08-19, commit `6d81251`

Everything below was **run**, not inferred from `docs/_archive/contracts/WO06_AUDIT.md`. Where a check could
only be done by reading (a handful, noted explicitly), that is called out — everything else has a
command and an observed result above it in this document or in this section.

### 1. Gates (all re-run from a clean working tree at `6d81251`)

| Gate | Command | Result |
|---|---|---|
| TS typecheck | `npx tsc --noEmit` | 0 errors |
| Frontend build | `npm run build` | tsc + vite build succeed, only pre-existing chunk-size advisories |
| Lint | `npm run lint` | 0 errors, 1 pre-existing warning (`RoleGlyphs.tsx:187`, not WO06) |
| Clippy | `cargo clippy --all-targets -- -D warnings` (from `src-tauri/`) | clean |
| Rust tests | `cargo test` (from `src-tauri/`) | **506 lib + 18 cowtext-cli, 0 failed** |

All five match the baseline exactly. The audit's "gates 1/2/3 not re-run post-merge, last
`--all-targets` run was red" concern is resolved — they are green on the actual merged tree today.

### 2. Invoke contract — byte-exact, verified both directions

- 63 `#[tauri::command]` function definitions, enumerated by hand (module-qualified list in this
  report matches `generate_handler!` line for line, in order).
- 63 `generate_handler!` entries, module-qualified, same order.
- Every TS `invoke()` call site names a real registered Rust command (`comm -13` between the two
  sorted name sets is empty — no TS call site invents a name).
- **`handoff_node_propose` is the only registered command with zero TS call sites anywhere in
  `src/`.** The count is 63/63 by registration, but only **62/63 are truly reachable from
  TypeScript.** This is the same class of gap the task brief warned about (a count-based gate
  cannot see reachability), just one level less severe than the audit's original D2 — the Rust
  body is real now, the wrapper is what's missing.

### 3. Stub-message grep — the single highest-value check

```
grep -rn "not implemented (WO06 Stage-0 stub)" src-tauri/src/
→ src-tauri/src/handoff/tests.rs:191 (a doc-comment describing the regression test, not code)
```

**Zero commands still return the Stage-0 stub error.** `handoff_node_propose` is a genuine,
tested implementation (`handoff.rs:301-363`, 8 passing tests). This directly overturns the
audit's D2 as literally stated — it is fixed — but see the reachability gap above and the triage
entry below for the fuller picture.

### 4. Per-finding triage

| Audit ID | Verdict | Evidence |
|---|---|---|
| **D1** (differentiator unreachable) | **FIXED** — verified by running (walked both G1 and G2 paths live in the app) and by code trace | `ContextButton` on every `StatusCard`/`FlatRow` → `TasksBoard`'s `openContext` → `TaskContextModal`; `TaskPanel` (reachable via `useTasksStore.selected`, set by clicking any task card) unconditionally renders `TaskLinksPanel` |
| **D2** (handoff stub) | **PARTIALLY FIXED — new, narrower defect** | Rust body fully implemented & tested (verified by running `cargo test --lib handoff::`, 20/20 green); zero TS call sites (verified by grep, confirmed by reading `HandoffModal.tsx` and `src/handoff/api.ts`) — command is real but unreachable, functionally equivalent to D1's original shape but far cheaper to close |
| **D3** (restart re-stops) | **FIXED** | `sessions.rs:351-353` resets `tokens_used`/`turn_tokens`/`info.tokens_used` in `begin_restart`; regression test `restart_after_a_budget_stop_clears_tokens_used_so_the_new_turn_is_not_re_stopped` run in isolation, green |
| **D4** (gauge double-counts, `tokensUsed` dropped) | **FIXED** | `Session.tokensUsed` now exists (`store/sessions.ts:108`), populated from `info.tokensUsed`, **assigned** (not added) on a `budget` event (`:434`); `RosterBar`/`AgentPanel`/`BarnScene` all read `session.tokensUsed`, not `usage.totalTokens`, for the budget calc — verified by reading all four consumer sites |
| **D5** (barn strip permanently full) | **FIXED** (follows D4) | `agentHerd.ts`/`BarnScene.tsx` read `tokensUsed` from the same now-populated field |
| **D6** (`as<N>` id leaks into sidecar) | **FIXED** | `store/tasklinks.ts`'s `recordSession` now `await`s `waitForClaudeSessionId` (polls `agent_session_list` up to 10×300ms) and **skips the write** if the durable id never arrives — never falls back to the volatile id |
| **D7** (minted id leaks into `name`, duplicates on save) | **FIXED** | `strip_reserved_tokens` (`tasks.rs:715`) now runs before the name/description boundary split; regression test `d7_mint_into_boundary_less_checklist_line_stays_stable_across_updates` run in isolation, green |
| **D8** (store-update discipline broken) | **FIXED** | `update`/`toggle`/`toggleAny`/`ensureId` in `store/tasks.ts` all now `await get().load(root)` on their success path — verified by reading all four |
| **D9** (no global ceiling setting) | **STILL OPEN** | `grep -rn "sessionTokenCeiling" src/ src-tauri/src/` → **zero hits, tree-wide.** `TaskContextModal.tsx:217`'s `effectiveCeiling` still has no `?? globalDefault` fallback. This is the one blocking-for-close-out item from the audit that genuinely remains unaddressed. |
| O1 (volatile locator in `UnresolvedDep`) | **FIXED** | `unresolved` is only ever populated from `rep_of`, which only contains tasks with a `task_id`; an id-less task's `#<line>` locator can no longer appear |
| O2 (divergent tolerant reads) | **FIXED** | `taskctx.rs` now calls `crate::tasklinks::tasklinks_read` directly; regression test `corrupt_tasklinks_json_degrades_to_empty_not_a_raw_parser_error` run in isolation, green |
| O3 (ancestry depth/cycle semantics disagree) | **FIXED** | `taskctx.rs`'s ancestry walk now delegates to `tasklinks::ancestor_chain` instead of its own inline loop — the fourth graph walk (audit observation B3) is gone |
| O4 (ARIA menu with no items) | **FIXED** | `DependsPicker.tsx` now uses `role="dialog"` with a focusout-close (`onBlur`), not `role="menu"` |
| O5 (lost-update race on `tasklinks.json`) | **substantially FIXED** | `recordSession` now reads `existing = get().linkFor(taskId)` **after** the multi-second `waitForClaudeSessionId` await, not before it — the audit's exact scenario (Launch, then immediately change ceiling) no longer reproduces since the session-record write picks up the ceiling change. A narrow simultaneous-write race remains structurally possible (no server-side field versioning) but is not the reported failure mode. |
| O6 (`tasklink_delete` no-op creates empty sidecar) | **FIXED** | `tasklink_delete` now only writes when `removed_something \|\| file_existed` |
| O7 (`tasklink_set` doesn't enforce id grammar) | **FIXED** | `tasklink_set` now calls `is_valid_task_id` and rejects malformed ids before any read/write |
| O8 (`RosterBar` hardcodes `stopped={false}`) | **FIXED** | `RosterBar.tsx:108` now passes `stopped={budgetStopped}` |
| Gate 5 (DAG cycle determinism over 100 runs) | **VERIFIED BY RUNNING** | `tasks_scan_reports_hand_authored_cycle_deterministically` — loops the scan 100 times, asserts identical cycle report every time — green |
| Gate 9 (allowlist disjointness both directions) | **VERIFIED BY RUNNING** | `task_context_write_rejects_a_path_traversal_task_id`, `compile_write_refuses_the_task_context_shape`, `compile_write_still_accepts_a_real_compile_output_shape` — all green, real filesystem I/O, not mocked |
| Gate 10 (task-corpus regression) | **VERIFIED BY RUNNING against this actual repo** | `real_repo_task_corpus_has_no_reserved_tokens_yet` scans this repo's own `docs/tasks/*.md` at test time — green |
| Gate 18 (frozen files untouched) | **VERIFIED BY RUNNING the literal command** | `git diff --stat 605760e..HEAD -- compile.rs project.rs graph.ts agents.rs frontmatter.rs` → empty output |
| §3.2 L4 ancestry depth-8 off-by-one (flagged in the *previous* tester pass, not in the audit itself) | **FIXED** | `ancestor_chain`'s loop bound changed from exclusive `0..MAX_ANCESTRY_DEPTH` to inclusive `0..=MAX_ANCESTRY_DEPTH` (doc comment: "audit F4, fixed"); `ancestor_chain_resolves_a_valid_depth_eight_chain_without_erroring` and `tasklink_set_accepts_an_eight_hop_ancestry_chain_end_to_end` both run in isolation, green |
| O1/O2/O3 **board defects** (contract §11, distinct from the audit's minor-findings O1-O8 above — unfortunate naming collision in the source documents) | **FIXED** | Walked live in Sections D/E/F of this manual; also verified by running `o3_done_table_row_moved_into_table_target_preserves_status_and_id`, `o3_done_table_row_moved_into_checklist_target_preserves_status_and_id`, `o3_done_checklist_row_moved_arrives_done`, plus the two `tasks_scan_missing_file*` co-location tests, all green |

### 5. New defects found this pass

**N1 · MINOR · `docs/TERMINOLOGY.md` and the `cowtext-terminology` skill still say "54" invoke
commands, not 63.** `docs/TERMINOLOGY.md:11,36` and
`.claude/skills/cowtext-terminology/SKILL.md:3,16,29` — pre-existing docs debt the audit already
flagged as "Lane D has not run", still true. Not code-risk, but any agent loading the skill before
writing code gets a stale count. No file:line fix needed beyond a docs pass.

**N2 · MINOR (naming/process hazard, not a code defect) · The contract's §11 "O1/O2/O3 board
defects" and the audit's §2 minor findings "O1–O8" share the same ids for unrelated things.** Both
this manual's older revision and the audit itself use "O1/O2/O3" for two different sets of issues
in different sections. Purely a documentation clarity issue — flagging so a future reader doesn't
conflate "O2: missing convention file created at repo root" (contract §11, fixed pre-existing-audit)
with "O2: divergent tolerant reads of tasklinks.json" (audit §2, fixed this round).

No other new defects found. Everything adversarial-checked in Part 3 of this pass (app launch,
subgraph determinism, data-loss allowlist, sidecar corruption, real-corpus regression, frozen-file
diff) held.

### 6. Shippable verdict

**Conditionally shippable — better than the audit's "NOT SHIPPABLE," not yet clean.**

Of the audit's 4 blocking-for-close-out items (D1, D2, D3, D9): **three are fixed** (D1, D2's
literal stub, D3) and **one remains genuinely open** (D9, the global default ceiling — zero lines
of code anywhere in the tree). Of the "required before Marty's walk" items (D4–D8): **all five are
fixed**, verified either by running the app live (D1) or by running the purpose-built regression
test in isolation (D3, D4 read, D6 read, D7, D8 read). All minor findings (O1–O8) are fixed.

**The single riskiest open item is D9** (no global default session-token ceiling): contract §5.1
promises a fallback that does not exist, so any task session launched with no explicit per-task
ceiling runs **completely unbounded** — the exact opposite of what §5's hard-stop machinery exists
to guarantee. This is a silent footgun, not a crash: nothing errors, nothing warns, a user simply
gets no budget protection unless they remember to set one per task every time.

The second-most-notable item is the **narrowed D2**: `handoff_node_propose` no longer errors, but
it is still unreachable — recommend either finishing the `src/handoff/api.ts` wrapper + a commit
affordance in `HandoffModal.tsx`, or formally cutting §6 to a follow-up work order (the contract's
own fallback option) so the invoke-count accounting and the docs stop implying a shipped feature.
