# UX Batch Manual Test Script — Rename-sync, Hooks Badge, Resizable Panels, Menus, Reveal

Hand-run test manual for the 12-item UX batch (`docs/design/UXBATCH_CONTRACT.md`):
filename↔title sync, hooks-installed indicator, resizable left/right panels + brief field,
wider modals, role descriptions, bigger read-order badge, recent projects, dynamic context
menus, Reveal in File Explorer, and the scan overlay + edge polish. Run top to bottom in one
sitting; sections C onward reuse the project and graph built in section B. Written against
the code as of 2026-08-18 (`src/App.tsx`, `src/ui/*`, `src/canvas/*`, `src/inspector/*`,
`src/store/{project,settings,graph}.ts`, `src/fs/api.ts`, `src-tauri/src/{project,hooks}.rs`).
Every step names the real control and the exact expected result — if reality differs, that is
a bug (or this manual is stale; either way, note it).

**Time budget:** ~35 min full pass, plus the 2-minute Phase 2 regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev` fails instead
   of picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on the
   "Open a project" empty state, no **Recent** section (first run, list is empty).
3. **Make a throwaway test project** (never a real project — this test renames and deletes
   files):

   ```powershell
   mkdir C:\_uxtest\context
   Set-Content C:\_uxtest\notes.md "# Notes`n`nSome handwritten notes."
   Set-Content C:\_uxtest\context\decoy.md "# Decoy`n`nOccupies a filename on purpose."
   ```

   *Expected:* `C:\_uxtest` with `notes.md` and `context\decoy.md`.
4. Press **Open folder** (top-right) and pick `C:\_uxtest`.
   *Expected:* pixel-march loading ("the cow is reading"), then the workspace opens.

---

## B. Happy path — rename sync, role popup, badge, resize, recent projects

### B1. Filename ↔ title sync (#1)

5. **Double-click** empty canvas. *Expected:* a node card "New node" appears, selected;
   inspector opens on **Properties**; file rail gains `context/new-node.md`.
6. In the inspector **Title** field, clear it and type `API surface`, then press **Tab**
   (blur commits — not per keystroke). *Expected:* no rename happens mid-typing; only on
   blur does the file move.
   *Expected after blur:* the **File** field at the bottom of Properties now reads
   `context/api-surface.md`; the file rail shows the new path (a rescan runs automatically);
   the canvas card title reads "API surface".
7. Verify on disk:

   ```powershell
   Test-Path C:\_uxtest\context\new-node.md    # False
   Test-Path C:\_uxtest\context\api-surface.md # True
   ```

8. **Collision case.** In Title, type `Decoy` and press **Enter** (Enter also commits, via
   blur). *Expected:* the title becomes "Decoy" immediately (title always applies), but under
   the Title field a red message appears: `Already exists: context/decoy.md` with an inline
   **Rename to context/decoy-2.md…** link. The File field still reads `context/api-surface.md`
   (rename refused, nothing on disk touched).
9. Click **Rename to context/decoy-2.md…**. *Expected:* the error clears, File field now reads
   `context/decoy-2.md`, and `context/api-surface.md` no longer exists on disk (moved, not
   copied).
10. **Toggle off sync.** Open **Settings** (top bar) → **Context** section → flip
    **Rename file with title** OFF. *Expected:* helper line below it reads "Editing a node's
    title also renames its .md file to match. Off leaves the file path untouched — you can
    still rename it by hand." Close Settings.
11. Change the Title to `Renamed manually never` and blur. *Expected:* title updates on the
    card; the File field is **unchanged** (`context/decoy-2.md`) — no rename attempted.
12. Re-open **Settings** and flip **Rename file with title** back ON.

> **Added in the v2 pass — direct rename.** The Inspector's **File** field is now an
> editable input (mono text) for non-protected files:
>
> 12a. Select a node, click into the **File** field, change the basename (keep `.md`), press
>      **Enter**. *Expected:* the file renames on disk (check the file rail), the field shows
>      the new path, helper line reads "Enter renames the file on disk. Esc cancels."
> 12b. Edit the field again and press **Esc**. *Expected:* the draft reverts, nothing renamed.
> 12c. Enter a path that collides with an existing file. *Expected:* an inline red error under
>      the field ("Already exists: …"), file untouched.
> 12d. Every **Rename file…** context-menu entry (node card, file-rail row, Inspector header,
>      File-field menu) now switches to Properties and puts focus in the File field with the
>      basename pre-selected, ready to type.
13. **Protected file.** Select the node adopted from `notes.md` (adopt it now via the file
    rail's **adopt** button if not already a node). Right-click the node card → **Rename
    file…** is present but **greyed out**, with a tooltip-equivalent hint line under it
    reading "generated file — not renameable" when you widen the menu (hover shows the hint
    text under the row). Edit that node's Title anyway and blur. *Expected:* title changes,
    file is NOT renamed (only truly-protected paths are `CLAUDE.md`/`AGENTS.md`/`.claude/**`
    /`.cursor/**`/`.cowtext/**` — a plain adopted file like `notes.md` is not protected, so
    this step should actually rename it; re-run this check instead against `.cowtext/graph.json`
    conceptually — there is no node backed by a protected file to select, so **skip the
    rename attempt** and instead confirm via **F. Protected-file guard** below).

### B2. Role descriptions (#5)

14. Select the `API surface` node (or any node). In Properties, click the **Role** control
    (glyph + role name in a bordered box, where the native `<select>` used to be).
    *Expected:* a popup opens below the control listing all **seven** roles, each row showing
    the role name and a one-line description (e.g. `persona` → "Who the agent is: voice,
    stance, standing preferences."), the current role's row carries a check mark.
15. **Keyboard:** close the popup (Escape), then focus the Role control with Tab and press
    **Enter**. *Expected:* popup reopens. Press **ArrowDown** repeatedly — the highlighted row
    advances through all seven, wrapping at the end. Press **Enter**. *Expected:* the role is
    set to the highlighted row and the popup closes.
16. *Expected regardless of popup state:* directly under the Role control, a description line
    for the **current** role is always visible (not just while the popup is open).

### B3. Bigger read-order badge (#7)

17. Connect two nodes with a **sequence** edge (drag a connection, pick **sequence** in the
    Edge-kind picker). *Expected (revised in the v2 pass):* the target node's card shows a
    read-order badge — now **26px tall**, minimum 26px wide, **bold base-size** tabular
    numerals, a visible border (`border-border-strong`) and full-strength text colour —
    unmistakably the most prominent element in the card's top row.
18. Chain enough sequence edges that a node reaches a **3-digit** order (or, quicker: this is a
    visual-only check — confirm at zoom 0.5, via the canvas zoom control or mouse wheel, the
    badge digits stay legible and don't collide with the pin icon or push the title into
    wrapping.

> **Added in the v2 pass — Relations grid.**
>
> 18a. Select a node that has at least one incoming and one outgoing edge. *Expected:* the
>      Properties tab shows a **Relations** section — one row per edge: a direction arrow
>      (**→** outgoing, **←** incoming), a kind chip (`imports`/`references`/…), and the other
>      node's title.
> 18b. Click the other node's **title** in a row. *Expected:* selection jumps to that node.
>      Click a **kind chip**. *Expected:* the edge itself is selected (edge panel opens).
> 18c. Select a node with no edges. *Expected:* "No relations yet — drag from a port on the
>      canvas."

### B4. Hooks-installed indicator (#2)

19. Look at the **Event log** header (bottom-right strip, click to expand if collapsed).
    *Expected (no hooks installed yet):* an **install hooks** button — border, muted text,
    plug icon, unchanged from before this batch.
20. Click **install hooks**, approve the diff in the modal that opens (**Install** or
    equivalent approve button — this is the existing hooks-write trust boundary, unchanged).
    *Expected after the write completes:* the modal's install button area shows the write
    succeeded; close the modal (✕).
    *Expected in the Event log header, without reopening the project:* the **install hooks**
    button is now **gone**, replaced by a static badge reading **hooks installed** (success
    tint, plug icon, no click target) with a title tooltip naming
    `C:\_uxtest\.claude\settings.json`.
21. **Unreadable case.** Close the app. Corrupt the hooks file:

    ```powershell
    Set-Content C:\_uxtest\.claude\settings.json "{ not json"
    ```

    Relaunch (`npm run tauri dev`), open `C:\_uxtest` again.
    *Expected:* the Event log header shows an **amber** badge reading
    `hooks: settings.json unreadable` — clickable. Click it. *Expected:* the Hooks modal opens
    and surfaces the parse problem (it must never silently claim "installed").
22. Repair the file (re-run **install hooks** flow from the modal, or restore valid JSON by
    hand and restart) before continuing to section B5.

### B5. Resizable panels (#3) and wider modals (#4)

23. Hover the thin strip between the file rail and the canvas. *Expected:* cursor becomes a
    column-resize cursor; on hover an accent-coloured vertical line appears inside the 10px
    hit strip.
24. **Drag** it further right by ~100px. *Expected:* the file rail widens smoothly, no layout
    jump, canvas does not remount (React Flow viewport/zoom unchanged, any drag-in-progress on
    a node is unaffected).
25. **Double-click** the same handle. *Expected:* the file rail snaps back to its 248px
    default.
26. Drag the file-rail handle hard left past the minimum. *Expected:* it stops clamped at
    180px (does not vanish or overlap the canvas).
27. Repeat drag / double-click / clamp for the **right** handle (between canvas and Inspector).
    *Expected:* default width **460px** (wider than the old 392px), clamps between 320px and
    900px, double-click resets to 460px.
28. **Restart persistence:** leave both panels at a custom width, close and relaunch
    (`npm run tauri dev`), reopen `C:\_uxtest`. *Expected:* both panels reopen at the widths you
    left them, not the defaults.
29. Press **Compile** in the top bar. *Expected:* the modal is now **1040px wide** (was 720px)
    — at a normal desktop window width it should clearly show more monospace columns than
    before, and the diff body has a taller minimum height. Close it (✕) and open **Hooks**
    (via the badge/button in the Event log) — same widened treatment. Close it.

### B6. Resizable brief field (#17)

30. Select a node, in Properties find the **Brief** textarea. **Drag** its bottom-right resize
    corner (native `resize-y` handle) to make it taller — roughly double its default height.
31. Select a **different** node, then select the original node again. *Expected:* the Brief
    field is still the taller height you set (previously it reset on every node switch — that
    was the bug this fixes).
32. Restart the app, reopen the project, select the node again. *Expected:* Brief height
    survived the restart.
33. *Expected:* dragging the field very tall still leaves the **Assemble** section below it
    reachable by scrolling the Properties tab — nothing is pushed permanently out of reach.

### B7. Recent projects (#8)

34. **Open folder** a second scratch project:

    ```powershell
    mkdir C:\_uxtest2
    Set-Content C:\_uxtest2\readme.md "# second project"
    ```

    Open folder → pick `C:\_uxtest2`.
35. Use **File → (there is no File menu; use the folder-open control)** or click **Open folder**
    again and pick `C:\_uxtest` to switch back. Then close the app entirely and relaunch.
    *Expected:* the app reopens on the empty state (no project auto-restored), and under
    **Open folder** a **Recent** section lists both projects, **newest opened first**
    (`_uxtest` above `_uxtest2` since it was opened last).
36. *Expected per row:* project folder name (bold), full path in dim monospace
    (right-aligned/truncated), and a relative time like "today". Hover a row: a small **×**
    button appears on the right.
37. Click the `_uxtest` row (not the ×). *Expected:* the project opens directly (same as
    picking it via the folder dialog).
38. Reopen the empty state (this is easiest by deleting `graph.json`'s project reference is not
    exposed — instead just trust step 35's restart) and click `_uxtest2`'s row again — it was
    already in the list. *Expected:* it moves to the **top** of the Recent list, not
    duplicated (list still shows exactly 2 rows).
39. Right-click a recent-project row. *Expected:* a context menu with **Open**, **Reveal in
    File Explorer**, and **Remove from list**.
40. **Missing folder.** Delete one scratch project's folder entirely while the OTHER one is
    open in Cowtext:

    ```powershell
    Remove-Item -Recurse -Force C:\_uxtest2
    ```

    Restart the app to reach the empty state again (or fully close the open project — there is
    no in-app "close project" control, so restart). *Expected:* the `_uxtest2` row now shows a
    **missing** tag, is visually dimmed, and clicking it does nothing; its context-menu
    **Open** and **Reveal in File Explorer** entries are disabled (with a hint); **Remove from
    list** still works.
41. Click the row's **×** (or use **Remove from list**) on the missing entry. Restart the app.
    *Expected:* the removed row is gone permanently (persisted).

---

## C. Dynamic context menus (#9) and Reveal in File Explorer (#10)

Reopen `C:\_uxtest` for this section.

42. **Node card.** Right-click a node card. *Expected:* a menu opens (no browser context menu
    underneath) with, depending on state: **Open markdown** (or **Create file** if the node's
    file doesn't exist on disk) · **Rename file…** · **Reveal in File Explorer** · a separator
    · **Pin**/**Unpin** · **Assemble** · **Summarize** · a separator · **Remove from graph**
    (shown in a danger/red tint).
43. Press **Escape**. *Expected:* menu closes, focus returns to the node card (visibly
    focus-ringed or at least keyboard-interactable immediately after).
44. Right-click the same card again, then click anywhere else on the canvas (outside the
    menu). *Expected:* menu closes without triggering whatever you clicked underneath (no
    double-action).
45. Right-click a node card, then use **ArrowDown** repeatedly. *Expected:* highlight moves
    through the rows, skipping the separator; **Home** jumps to the first row, **End** to the
    last.
46. Click **Reveal in File Explorer** on a node whose file exists. *Expected:* a Windows
    Explorer window opens with that exact `.md` file selected/highlighted.
47. **Missing-file reveal.** Delete a node's file from disk without telling Cowtext:

    ```powershell
    Remove-Item C:\_uxtest\context\decoy-2.md
    ```

    Right-click that node → **Reveal in File Explorer**. *Expected:* Explorer opens the
    nearest existing **parent folder** (`context\`) instead of erroring or doing nothing.
48. **Canvas pane.** Right-click empty canvas. *Expected:* menu with **New node here** ·
    **Fit view** · a separator · **Reveal project in File Explorer**. Click **New node here**.
    *Expected:* a new node appears at the click position, not the canvas centre.
49. **Edge.** Right-click an edge. *Expected:* menu lists the four edge kinds (**imports** /
    **references** / **conditional** / **sequence**) each as a row, the edge's current kind
    carrying a check mark, then **Edit note…**, a separator, **Delete edge** (danger tint).
    Click a different kind. *Expected:* the edge's dash pattern/style changes immediately to
    match (kind is read from stroke style, not colour).
50. **File-rail row.** Right-click a file in the left rail. *Expected:* menu with either
    **Adopt as memory node** (file has no node yet) or **Select node** (it does) ·
    **Reveal in File Explorer** · **Copy relative path** · a separator · **Rescan**. Click
    **Copy relative path**, then paste (Ctrl+V) into any text field. *Expected:* the clipboard
    contains the exact relative path, forward slashes.
51. **File-rail header.** Right-click the file-rail header strip (where the file count and
    rescan/collapse buttons live). *Expected:* menu with **Rescan** · **Reveal project in File
    Explorer** · **Collapse panel**. Click **Collapse panel**. *Expected:* rail collapses to
    the narrow vertical strip (same as clicking the collapse icon). Click the strip's
    **Show files** button to restore it.
52. **Inspector header / File field.** Right-click the **Properties/Markdown** tab strip at the
    top of the Inspector, and separately right-click the **File** path box near the bottom of
    Properties. *Expected:* both open the same menu shape: **Reveal in File Explorer** ·
    **Copy relative path** · **Rename file…** · **Open markdown tab**.
53. **Event-log row.** Expand the Event log, trigger at least one event (any file edit while
    hooks are installed, or wait for a demo event), right-click a row that has a file path.
    *Expected:* **Reveal in File Explorer** appears only when the event's path resolves inside
    the project root; otherwise only **Copy path** is offered.
54. **Recent-project row** — already covered in step 39.
55. **No double menus.** Right-click a node card, then without closing it, right-click a
    different node card. *Expected:* the first menu closes and only the second one is visible
    at any moment — never two menus open together.

---

## D. Scan overlay (#13) and edge polish (#16 render-half)

56. With `C:\_uxtest` open and at least one node selected (Inspector visible) with unsaved text
    typed into the Markdown tab's editor (type a line, do NOT save), click **Rescan** (file
    rail header icon or its context-menu entry).
    *Expected within one frame:* a translucent veil covers the **Inspector** panel and the
    **file-rail list**, centred on a small amber **pixel-march** indicator (three blinking
    squares in sequence) with the caption **"rescanning"** — explicitly NOT a rotating spinner.
57. *Expected:* the veil is clickable-blocking (clicks inside the Inspector or file list do
    nothing while it's up) and clears automatically once the scan resolves (well under a
    second on a small test project).
58. *Expected after the veil clears:* your unsaved Markdown edit is **still in the editor**,
    un-lost, and the CodeMirror scroll position is unchanged (the editor was never unmounted).
59. *Expected:* the **canvas** itself was never veiled at any point (it does not depend on
    the scan).
60. Open **Settings** → flip **Calm mode** ON, close Settings, trigger another rescan.
    *Expected:* the pixel-march squares are static (no blink animation), caption still shows.
    Flip Calm mode back OFF afterward.
> **Revised in the v2 pass (connector revert):** the six per-half handles were removed.
> Each card now has exactly **one funnel-shaped input port** on its left edge and **one
> funnel-shaped output port** on its right edge, both **always visible** (neutral at rest,
> accent-blue on hover/while connecting). Edges route with stubs + a clearance lane so they
> never fold back across the endpoint cards.

61. **Edge routing.** Create two nodes stacked roughly vertically (one well above the other,
    similar X). Connect them (drag from the right funnel of one to the left funnel of the
    other). *Expected:* the edge leaves the output port heading right, detours through the
    gap between the cards (or around them) with rounded corners, and enters the input port
    heading right — it never draws through either endpoint card. Also place a target to the
    **left** of its source. *Expected:* a clean U-shaped detour around the cards, no
    spaghetti fold-back.
62. **Snap radius.** Start dragging a connection from a spot roughly 30–40px away from a
    node's funnel port (not directly on it). *Expected:* the connection still snaps to the
    port — the accepted radius is noticeably larger than the visible funnel.
63. Zoom the canvas to roughly 2× (mouse wheel / trackpad zoom in) and inspect an arrowhead
    closely. *Expected:* a single clean triangular/chevron shape, no stray line stub poking
    through the tip. Zoom out to ~0.4× and re-check — arrowhead still reads as one shape, not
    a blob.
64. Confirm all four edge kinds are still visually distinct by **line style** (solid /
    dashed / dotted / solid-with-step-dot for sequence) rather than colour — colour still
    only distinguishes selection state.

---

## E. Protected-file guard (backend trust boundary)

65. Select the node whose file is `CLAUDE.md` — if none exists yet, run **Compile** once
    (approve at least the `claude` target) to generate `C:\_uxtest\CLAUDE.md`, then it will
    not be a node unless adopted; adopt it via the file rail's **adopt** button on `CLAUDE.md`.
66. Right-click that node's card. *Expected:* **Rename file…** is present but disabled, and
    the row carries the hint text "generated file — not renameable" (visible as a muted line
    under the row label).
67. Select the node, edit its Title in the Inspector and blur. *Expected:* the title text
    changes on the card, but the **File** field stays `CLAUDE.md` — no rename attempted, no
    error shown (silently skipped per contract, since this path is the automatic-sync path,
    not a manual rename request).
68. Confirm on disk `CLAUDE.md` still exists at the project root, untouched:

    ```powershell
    Test-Path C:\_uxtest\CLAUDE.md   # True
    ```

---

## F. Known-issue checks (verify, don't "fix")

69. **Reveal failure surfacing.** Right-click a node card whose file was deleted from disk in
    a way that also removed its parent folder structure entirely down to a non-existent drive
    path is impractical to force from the UI — instead, trigger any **Reveal in File Explorer**
    entry while the project root itself has been deleted out from under the app (delete
    `C:\_uxtest` folder via a second Explorer window while Cowtext still has it open, then
    click Reveal). *Expected per contract §7.10:* "a reveal failure surfaces as an inline
    error, never a silent no-op." **If instead nothing visibly happens in the UI and only the
    dev-tools/terminal console shows an error, that is a confirmed defect — note it, do not
    treat the absence of an error banner as a pass.**
70. **Rapid project switching (hooks badge).** With two valid scratch projects available via
    Recent, open one, and *immediately* (within roughly a second) open the other from the
    Recent list before the Event log has settled. Watch the hooks badge in the Event log over
    the next couple of seconds. *Expected:* the badge always reflects the **currently open**
    project. *(Regression check — the original race was fixed with a stale-guard in
    `refreshHooksStatus`; a badge showing the previous project's state means the guard
    regressed.)*
71. **Rapid node switching mid-rename.** Trigger a title-rename collision on Node A (per step
    8, so the red error + "Rename to …" suggestion is showing under Node A's Title field), then
    *immediately* select Node B in the Inspector before clicking the suggestion. *Expected:*
    Node B's Title field shows no leftover error/suggestion from Node A. *(Regression check —
    the original stale-closure defect was fixed by remounting the Title field per node; any
    leftover message from Node A means the fix regressed. If it appears, do NOT click the
    suggestion.)*

---

## G. Phase 2 regression — 2 minutes

72. **Compile still works:** press **Compile**, confirm the modal opens at its new 1040px
    width, the target chips (`claude`/`agents`/`cursor`) still toggle the preview, and
    **Approve & write** still writes only checked files. Cancel without writing.
73. **Assemble still works:** right-click a node with a Brief filled in → **Assemble**.
    *Expected:* the card shows a queued/assembling state; no console errors.
74. **Drag/connect regression:** drag a node to a new position, connect two nodes with a new
    edge, pick any kind. *Expected:* both work exactly as before this batch, no layout jump
    from the resizable-panel changes.

---

## Cleanup

75. Close the app and delete the scratch projects:

    ```powershell
    Remove-Item -Recurse -Force C:\_uxtest
    Remove-Item -Recurse -Force C:\_uxtest2 -ErrorAction SilentlyContinue
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B1 Rename sync | | |
| B2 Role descriptions | | |
| B3 Read-order badge | | |
| B4 Hooks indicator | | |
| B5 Resizable panels / wider modals | | |
| B6 Resizable brief | | |
| B7 Recent projects | | |
| C Context menus + reveal | | |
| D Scan overlay + edge polish | | |
| E Protected-file guard | | |
| F Known-issue checks | | |
| G Phase 2 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
