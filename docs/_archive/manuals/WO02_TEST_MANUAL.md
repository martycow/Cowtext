# WO02 Manual Test Script — Agent Memory, Task Grids, Priorities, FPS Overlay

Hand-run test manual for WO02 (`docs/_archive/contracts/WO02_CONTRACT.md`): per-agent memory
folders, wizard-only node creation at viewport centre, the task grid rewrite
(table-aware append/move, five convention files incl. `BUGS.md`, priority
buckets), the tag dropdown, the model catalog, and the Barn FPS overlay. Run it
top to bottom in one sitting; sections C–F reuse the project and agent built in
section B. Written against the code as of 2026-08-19 (`src-tauri/src/tasks.rs`,
`src-tauri/src/agents.rs`, `src/store/{tasks,settings,agents}.ts`,
`src/canvas/{GraphCanvas,MemoryNodeCard,viewport}.tsx/.ts`,
`src/wizard/NodeWizard.tsx`, `src/tasks/{TasksBoard,NewTaskDialog,TagPicker,
NewAgentDialog}.tsx`, `src/agents/{AgentEditor,modelCatalog}.ts(x)`,
`src/settings/SettingsModal.tsx`, `src/scene/BarnScene.tsx`). Every step names
the real control and the exact expected result — if reality differs, that is a
bug (or this manual is stale; either way, note it).

**Time budget:** ~30 min full pass, plus the 3-minute WO01 regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev`
   fails instead of picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on
   the "Open a project" empty state.
3. **Make a throwaway test project** (do NOT use a real project — this test
   writes agent, task and memory files):

   ```powershell
   mkdir C:\_wo02test
   Set-Content C:\_wo02test\notes.md "# Notes`n`nplaceholder"
   ```

   *Expected:* folder `C:\_wo02test` with one file `notes.md`.
4. In Cowtext press **Open folder** and pick `C:\_wo02test`.
   *Expected:* the workspace opens; the file rail shows `notes.md`; no
   `.claude/agents` yet.

---

## B. Happy path — Agents suite (item #3, #6, #15)

### B1. New Agent dialog — calculated paths, model catalog, memory toggle

5. Open the **Agents** rail (or wherever the fleet exposes "New agent" in this
   build) and press **New agent**. *Expected:* the New Agent dialog opens
   (`~640px`, title "New agent").
6. In **Name**, type `Test Scout`. *Expected:* the **File** field live-updates
   to `test-scout.md` (auto-slug from Name) and the helper line under it reads
   `.claude/agents/test-scout.md`.
7. Click into **File** and type over it manually, e.g. `scout-2.md`.
   *Expected:* the helper line updates to `.claude/agents/scout-2.md`; typing
   further in Name no longer touches File (the auto-slug idiom stops tracking
   once the field is hand-edited — matches `NodeWizard`'s `fileNameTouched`
   behaviour).
8. Clear **File** back to empty, then retype `test-scout.md` exactly so it
   matches an agent that doesn't exist yet (no collision).
9. Look at **Memory folder**. *Expected:* a read-only mono line
   `.claude/agent-memory/test-scout/` and an amber **"Create memory folder"**
   toggle that is **ON by default**.
10. Open the **Model** picker. *Expected:* company select defaults to
    **Anthropic**; the version select's first option is **`inherit`**, and a
    helper line under the picker reads *"Runs on whatever model the parent
    session is using — this agent pins no model of its own."* Scroll the
    version list — **`claude-fable-5`** is present (between `inherit` and
    `claude-opus-5`).
11. Pick `sonnet`. *Expected:* helper line changes to *"Alias: the current
    Sonnet tier. A dated id pins a snapshot."*
12. Leave Duties blank, press **Create**.
    *Expected:* dialog closes; `.claude/agents/test-scout.md` exists on disk;
    `.claude/agent-memory/test-scout/MEMORY.md` also exists (memory toggle was
    on). Verify:

    ```powershell
    Get-Content C:\_wo02test\.claude\agents\test-scout.md
    Get-Content C:\_wo02test\.claude\agent-memory\test-scout\MEMORY.md
    ```

    *Expected MEMORY.md content, byte-exact:*

    ```
    # test-scout memory index

    <!-- One line per memory file: - [Title](file.md) — one-line hook -->
    ```

### B2. Collision guard

13. Press **New agent** again. Type Name `Test Scout` (or anything), then in
    **File** type `test-scout.md` (matching the agent just created; case
    doesn't have to match — try `TEST-SCOUT.MD`).
    *Expected:* an inline red error appears: *"An agent file named
    TEST-SCOUT.MD already exists — choose a different name."* **Create is
    disabled.** Change the file name to something unused; the error clears and
    Create re-enables.
14. Cancel the dialog.

### B3. AgentEditor — Memory row, Create memory folder button

15. Select the `Test Scout` agent (via the rail's off-graph agent list — it is
    **not** on the canvas yet, since agent creation is off-graph by default).
    *Expected:* the Agent Editor opens on the right (Inspector). Below Skills,
    a **Memory** row shows `.claude/agent-memory/test-scout/` in mono text and
    a secondary **"Create memory folder"** button.
16. Press **Create memory folder** again (idempotent backfill — the folder
    already exists from B1).
    *Expected:* no error, no console throw; nothing on disk changes (the
    existing `MEMORY.md` is never rewritten). If anything is reported, it
    surfaces inline where Save's error line would appear — never a silent
    failure and never a browser-console-only error.
17. Rename the agent (via the identity-header name field) to `Scout Two`,
    blur. *Expected:* the rename succeeds; the Memory row's path does **not**
    change (memory folders are keyed by the file stem `test-scout`, unaffected
    by the display-name rename — this is expected and not a bug: memory paths
    only move if the *file* is renamed, not the frontmatter `name:`).

### B4. Agent card visual identity on the canvas (item #5)

18. Go to the **Agents** rail entry for `Scout Two` and press **"Adopt to
    graph"** (shown in the standalone-agent panel header, "Off the graph —
    adopt it to wire context edges"). *Expected:* a node appears on the canvas
    for the agent.
19. Create 2–3 ordinary (non-agent) nodes via the wizard (see C below, or just
    double-click the canvas and pick any role) so there is a mix on screen.
20. Zoom the canvas out to **0.5** (scroll-wheel or the zoom control).
    *Expected, at a glance, without reading any text:* the agent card is
    identifiable — it shows a small square avatar plate (not the plain role
    glyph), a thin **1px identity-colour ring** around the whole card border
    (the agent role colour), and an `AGENT` micro-tag next to the name. Its
    footer carries two extra chips before the token count: a **model** chip
    (`sonnet`, from B1) and a **P`n`** priority chip (`P3` default).

---

## C. Happy path — wizard-only node creation (items #9, #16)

21. **Pan** the canvas noticeably off-origin (drag empty space), then **zoom**
    to something other than 1× (e.g. 0.6×).
22. Press the toolbar **"New node"** button (plain button, no split/chevron —
    the old dropdown menu is gone).
    *Expected:* the New Node wizard opens.
23. Fill Name = `Perf notes`, keep any role, press **Next** through to step 4,
    then press **Create node**.
    *Expected:* the new card appears **visually centred in the current pane**
    — not at the graph's logical origin. (This proves the position was
    re-derived at Confirm, not captured stale at the moment the wizard
    opened — the acceptance case for #16.)
24. Repeat: pan/zoom again to a *different* spot, open the wizard via the
    toolbar button, and **before** pressing Create, pan the canvas again while
    the wizard is still open. Then Create.
    *Expected:* the card lands centred on the pane's position **at the moment
    of Create**, not at the position when the wizard was opened.
25. **Double-click** an empty spot on the canvas away from any node.
    *Expected:* the wizard opens; complete it (Name = `Click spot`). The card
    lands **under the point you double-clicked**, not the viewport centre.
26. **Right-click** an empty spot on the canvas. *Expected:* the pane context
    menu shows exactly one creation entry, **"New node here…"** (Sparkles
    icon) — there is no second "New node wizard…" entry. Below it: "Fit view",
    then "Reveal project…". Pick "New node here…", complete it (Name =
    `Right-click spot`). *Expected:* the card lands under the right-click
    point.
27. Confirm no other path creates a node silently: there is no remaining
    split-button chevron, no dropdown offering direct creation without the
    wizard, anywhere on the canvas toolbar.

---

## D. Happy path — Tasks board & priorities (items #11, #12, #13, #14)

### D1. Board segments — right panel gone, BUGS present

28. Switch to the **Tasks** view (top view toggle). Its title reads **"Browse
    TASKS / BACKLOG / ROADMAP / BUGS"**.
    *Expected layout:* a `FilterBar` (agent filter + text filter + New task),
    then a segmented control reading **TASKS · BACKLOG · ROADMAP · BUGS**.
    There is **no fixed always-visible right-hand panel** — the segment
    control picks the single file that fills the full board width below it.
29. With no `TASKS.md`/`BACKLOG.md`/`BUGS.md` on disk yet, each segment shows
    its empty state: TASKS shows "No TASKS.md yet — add a task to create it.";
    switching to BACKLOG/ROADMAP/BUGS shows "create on first task" / "Nothing
    here." depending on file existence.

### D2. New task — tag dropdown with create-new, CRITICAL priority

30. Press **New task**. *Expected:* the New Task dialog opens; **File**
    segmented control offers `TASKS.md · SPRINT.md · BACKLOG.md · ROADMAP.md ·
    BUGS.md` — leave it on `TASKS.md`.
31. Name = `Ship the demo`. Description = `Wire the last export path.`
32. Click the **Tags** field (empty, placeholder "Add tags…").
    *Expected:* a popup opens below it, listing "No tags yet." (no tasks exist
    to source tags from) and a bottom row: a text input + a **+ (Add tag)**
    button.
33. Type `Release Notes` into the tag input, press **Enter**.
    *Expected:* the popup adds a chip `#release-notes` to the trigger
    (lowercased, spaces → hyphens) — **not** `#Release Notes` verbatim. Add a
    second tag `#demo` the same way, then click outside the popup to close it.
    *Expected:* the trigger now shows two chips: `#release-notes` `#demo`.
34. Set **Priority** to **CRITICAL** (the segmented control shows `none · Low ·
    Medium · High · CRITICAL` — CRITICAL is the only one rendered shouting in
    caps, per `PRIORITY_LABELS`).
35. Leave Agent as `Unassigned`. Since File = `TASKS.md`, a **Status** segmented
    control is visible too — leave it on `New`.
36. Press **Create**.
    *Expected:* dialog closes; the TASKS segment now shows one swimlane
    ("No sprint") with the card **`Ship the demo`** in the **New** column.
    The card's chip row shows a **danger-red `CRITICAL` chip**, `#release-notes`
    `#demo` tags, and the Unassigned chip.
37. Verify the write on disk:

    ```powershell
    Get-Content C:\_wo02test\TASKS.md
    ```

    *Expected content, byte-exact (a brand-new file, canonical table, WO02
    §2.3 case 3):*

    ```
    # TASKS

    | Name | Status | Priority | Tags | Agent | Description |
    |---|---|---|---|---|---|
    | Ship the demo | new | critical | release-notes, demo |  | Wire the last export path. |
    ```

    Note the Priority cell is the **normalized bucket** `critical` (lowercase),
    not the label `CRITICAL` shown in the UI — the UI label is cosmetic, the
    stored value is the canonical bucket string (WO02 §2.4).

### D3. Second task — table-aware append (row insertion, not a fresh table)

38. Press **New task** again. Name = `Fix the tooltip`, File = `TASKS.md`,
    Priority = `Medium`, no tags, Agent = Unassigned, Status = New. Create.
    *Expected:* the board now shows **two** cards in the New column
    (`Ship the demo` above `Fix the tooltip`, by line order).
39. Verify on disk that the second task became a **new row in the existing
    table**, not a second header block:

    ```powershell
    Get-Content C:\_wo02test\TASKS.md
    ```

    *Expected:* still exactly one `| Name | Status | ... |` header/separator
    pair, with the new row appended immediately after the first data row.

### D4. BUGS.md segment — new convention file end to end

40. Switch the segment control to **BUGS**. Press **New task** — the dialog's
    File defaults to `TASKS.md`; change it to **BUGS.md**. Name = `Rename race
    on Windows`, Priority = `High`, tags = `windows`. Create.
    *Expected:* dialog closes; the segment auto-shows nothing new (segment
    stays wherever it was — this is fine, the store reloads regardless).
    Switch to the **BUGS** segment. *Expected:* the row `Rename race on
    Windows` appears with an **amber `High` chip**.
41. Verify `C:\_wo02test\BUGS.md` was created fresh with the same canonical
    table shape as TASKS.md (header `Name | Status | Priority | Tags | Agent |
    Description`).

### D5. Priority buckets round-trip through the Inspector

42. Click the `Ship the demo` card. *Expected:* the Inspector's Task panel
    opens showing Name/Description/Tags/Priority/Agent/Status/Phase fields,
    with **Priority segmented control showing CRITICAL selected**.
43. Without touching Priority, edit the Description slightly and press
    **Save**. *Expected:* saves cleanly; re-open the card — Priority is still
    CRITICAL on disk (`Get-Content TASKS.md` still shows `critical` in that
    row's Priority cell).

---

## E. Happy path — Barn FPS overlay (item #7)

44. Open **Settings** → the **View** section. *Expected:* below "Manager
    mode", a row **"FPS counter"** with a blue Toggle, **OFF** by default, and
    a helper line: *"Shows the Barn's frame rate in the scene overlay. The
    Barn deliberately drops to 12 fps while idle, so a low number there is not
    a bug."*
45. Switch to the **Barn** view with the toggle still OFF.
    *Expected:* **no FPS text anywhere** on the scene — open devtools (if
    available in dev mode) and confirm there is no interval firing every
    500 ms tied to it (informal: CPU stays low, no extra re-renders visible in
    React devtools Profiler if you have it).
46. Open Settings again, flip **FPS counter** ON, close Settings.
    *Expected:* back on the Barn view, a small amber pixel-font readout
    appears top-left: `NN fps` (some number, typically near 60 while the
    window has focus and the scene is active).
47. Move the mouse away and leave the Barn scene alone (no hooks events, no
    interaction) for **at least 12 seconds**.
    *Expected:* the readout gains a suffix: `NN fps · idle`, and the number
    itself drops toward ~12 (the ticker's `maxFPS` throttles from 60 → 12
    after ~10 s of no live events — this is by design, not a bug).
48. Move the mouse over the scene / trigger any interaction.
    *Expected:* `· idle` disappears immediately and the fps number climbs back
    toward 60 (maxFPS resets to 60 the instant idle ends).
49. Flip **FPS counter** OFF again in Settings.
    *Expected:* the overlay disappears immediately.

### E1. Barn perf spot-check (item #8 — record, don't fix)

50. With FPS counter ON, note the **device pixel ratio** of the display
    Cowtext is running on:

    ```powershell
    # In the tauri dev devtools console (if reachable), or note manually:
    # window.devicePixelRatio
    ```

51. With the default/demo Barn scene (or your test project's Barn, whichever
    is showing), record the **median fps** reading over ~5 seconds of active
    scene (mouse moving, or during a demo event) and the **worst-case** fps if
    you see any dip. Record the DPR from step 50 alongside it. This is a
    baseline snapshot for comparison against tech-barn's investigation
    report — it is not a pass/fail gate on its own; note the numbers in the
    sign-off table's Notes column.

---

## F. Validation — edge cases

52. **Path-traversal rejection (agent memory).** This cannot be triggered
    through the built UI (the wizard always sends a validated file name), so
    this is a code-review note, not a manual step: confirm in
    `src-tauri/src/agents/tests.rs` that
    `agent_memory_ensure_rejects_path_traversal_file_name` exists and passes
    (`cargo test` — already run as part of the automated gates).
53. **Untouched unrecognized priority survives Save.** Manually edit
    `C:\_wo02test\BUGS.md` in a text editor, changing the `Rename race on
    Windows` row's Priority cell to a free-text value the bucket vocabulary
    doesn't recognize, e.g. `someday`. Save the file, then in Cowtext switch
    away from Tasks and back (or wait for the debounced `fs://change` reload).
    Select that task's card. *Expected:* the Priority segmented control shows
    **no segment highlighted** (falls back to "none" display — there is no
    "someday" option to show verbatim in this control). Without touching
    Priority, edit something else (e.g. Description) and Save.
    *Expected:* re-check the file — the Priority cell **still reads
    `someday`**, unchanged. The raw text is not silently normalized away or
    dropped by an untouched Save (this is the correct, contract-specified
    behaviour, not a bug — the segmented control's neutral display is
    cosmetic only).
54. **Agent file-name collision, case-insensitive.** Covered in B2 above.

---

## G. Known-pending gate — docs/tasks board columns (gate 10, PENDING)

This section documents a gate that is **expected to fail today** and is
called out here so it isn't mistaken for a regression: `docs/tasks/*.md`
have **not yet** been rewritten to the WO02 canonical grid schema by
project-manager (P1's deliverable, §7.8). Do not fail the WO02 acceptance walk
on this section — mark it **pending P1**, not **fail**.

55. Close the `C:\_wo02test` project and **open the real Cowtext repo**
    (`D:\Moo.exe\Cowtext`) in Cowtext, switch to Tasks → TASKS segment.
    *Expected TODAY (pending P1 rewrite):* completed rows that carry the
    legacy cell text `✅ Done — accepted by Marty 2026-08-18` normalize to the
    **New** column instead of **Done** — this is the documented live defect
    the contract calls out (§7.8), not a WO02 regression. Once P1 rewrites
    `docs/tasks/*.md` to the canonical `new | in-production | in-testing |
    done` status vocabulary, re-run this step and *every* item should land in
    its correct column with **no Done-labeled row sitting in New**.
56. Re-close the repo project and re-open `C:\_wo02test` before continuing,
    so the regression pass below starts from a clean, known state.

---

## H. WO01 regression — 3 minutes

57. **Compile still works:** with `C:\_wo02test` open, press **Compile**
    (top bar). *Expected:* the diff-preview modal opens normally, listing
    `CLAUDE.md`/`AGENTS.md` as new files (no WO02 change touched
    `compile.rs`). Cancel without writing.
58. **Assemble still works on an agent card:** select the `Scout Two` agent
    node, Inspector → Assemble section is present with Assemble/Summarize/
    Refine controls (unchanged from Phase 3/4).
59. **Drag / connect / delete a node:** drag any ordinary node to a new spot,
    connect it to another with a **references** edge, then delete the edge
    via the Inspector's Relations grid. *Expected:* all work exactly as
    before WO02 — no regression from the canvas creation-path rewrite.
60. **Restart-restore:** close the window, `npm run tauri dev` again, reopen
    `C:\_wo02test`. *Expected:* all nodes/edges/agents/tasks are exactly as
    left; the FPS-counter setting persisted (check Settings still shows
    whatever you left it at in step 49 — OFF).

---

## Cleanup

61. Close the app and delete the scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_wo02test
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Agents suite (memory, model catalog, card identity) | | |
| C Wizard-only node creation | | |
| D Tasks board & priorities | | |
| E Barn FPS overlay + perf spot-check | | record median/worst fps + DPR here |
| F Validation edge cases | | |
| G Gate 10 — docs/tasks columns | | expected PENDING until P1 rewrites |
| H WO01 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
