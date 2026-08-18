# WO01 Block A Manual Test Script — Canvas Lenses + File Watcher

Hand-run test manual for the WO01 Block A feature: the canvas lens system
(None / Activity / Weight / Live) and the real-time Rust file watcher that feeds it without
ever rescanning. Run it top to bottom in one sitting; sections B onward reuse the project and
nodes built in section A. Written against the code as of 2026-08-18
(`src/canvas/lens.ts`, `src/canvas/LensControl.tsx`, `src/canvas/GraphCanvas.tsx`,
`src/canvas/MemoryNodeCard.tsx`, `src-tauri/src/watcher.rs`, `src/store/settings.ts`,
`src/store/project.ts`, `src/store/events.ts`). Every step names the real control and the exact
expected result — if reality differs, that is a bug (or this manual is stale; either way, note
it).

**Time budget:** ~15 min full pass (Blocks A/B), plus the 2-minute regression at the end, plus
~15 min for Block C (Disk-change review).

---

## A. Preconditions

1. **Free ports 1420 and 4923.** `strictPort` is on for Vite; the hooks server (used to
   simulate a live agent touch in B5) binds `127.0.0.1:4923` at app start.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on the
   "Open a project" empty state.
3. **Make a throwaway test project** (do NOT use a real project — this test writes files,
   backdates one, and renames one):

   ```powershell
   mkdir C:\_cowlens
   Set-Content C:\_cowlens\notes.md "# Notes`n`nA short memory node."
   Set-Content C:\_cowlens\old-notes.md "# Old notes`n`nStale on purpose, for the Activity lens contrast check."
   Set-Content C:\_cowlens\manifesto.md ("# Manifesto`n`n" + ("Cows remember everything so agents don't have to. " * 40))
   (Get-Item C:\_cowlens\old-notes.md).LastWriteTime = (Get-Date).AddHours(-2)
   ```

   *Expected:* three files in `C:\_cowlens` — `notes.md` (tiny), `old-notes.md` (backdated
   2 h, i.e. outside the 60-min Activity window), `manifesto.md` (by far the largest, ~2 KB —
   for the Weight lens contrast).
4. In Cowtext, press **Open folder** (top-right) and pick `C:\_cowlens`.
   *Expected:* pixel-march loading, then the workspace: the file rail header reads
   **`3 markdown files`**, canvas is empty.
5. In the file rail, hover each of `notes.md`, `old-notes.md`, `manifesto.md` in turn and
   click its **adopt** button (appears on hover, `+ adopt`, title "Adopt as memory node").
   *Expected:* three node cards appear on the canvas titled `notes`, `old-notes`,
   `manifesto`; each rail row swaps its file icon for a colored role-square dot and the
   adopt button disappears.

## B. Happy path — lens switching, activity decay, weight, live

### B1. Baseline (None) and the control itself

6. Look at the top-left **Panel**, to the right of the **New node** button.
   *Expected:* a 4-segment control reading **NONE · ACTIVITY · WEIGHT · LIVE** (mono,
   uppercase, `role="radiogroup"`, `aria-label="Canvas lens"`), **NONE** highlighted blue
   (accent surface/border/text), the other three muted grey with a hover tint.
7. Look at the three cards. *Expected:* plain, undimmed appearance — this is the pre-WO01
   baseline (no `filter`; only the existing box-shadow/ring/stripe logic applies).

### B2. Activity lens — decay + legend

8. Click the **ACTIVITY** segment. *Expected, instantly and without a fade — `filter` is
   not a transitioned property, this is a snap, not an animation:*
   - `ACTIVITY` turns blue-active, `NONE` returns to muted.
   - A legend strip appears to the right of the control: `earlier` label, a 96×6 px pill
     gradient (grey → amber), `latest` label.
   - `notes` and `manifesto` (both just-created, age ≈ 0) render **bright/washed out**
     (brightness pushed above 100%).
   - `old-notes` (backdated 2 h, outside the 60-min activity window) renders **visibly
     dimmer** than the other two — this is the lens floor.
   - No card moved, resized, or changed its handle positions versus B1.

### B3. External edit brightens within 1 s — no click, no rescan (T2 acceptance)

9. With Activity still active and `old-notes` still dim, touch the file from **outside**
   the app:

   ```powershell
   (Get-Item C:\_cowlens\old-notes.md).LastWriteTime = Get-Date
   ```

10. **Do nothing in the app.** *Expected, within ≤ 1 s:* the `old-notes` card brightens to
    the same near-max brightness as `notes`/`manifesto`. There is **no** full-screen
    pixel-march scanner (that only appears for a real scan/rescan, which this must not
    trigger) and **no other card changes**.
11. Hover the `old-notes.md` row in the file rail. *Expected:* the row is still present and
    ordered alphabetically exactly as a real scan would place it — proof the watcher's
    `fs://change` event patched the store's file entry in place, not a coincidental
    unrelated re-render.

### B4. Weight lens — minimal viable styling

12. Click the **WEIGHT** segment. *Expected:*
    - No legend strip (legend is Activity-only).
    - `manifesto` (by far the largest file) renders clearly brighter than `notes` and
      `old-notes` (both tiny relative to `manifesto`'s ~2 KB, so both sit near the floor).
    - Still no layout change from B1.

### B5. Live lens — synthetic hook events (no Claude needed)

13. Click the **LIVE** segment. *Expected:* no legend strip; all three cards at the lens
    floor brightness (nothing has been "touched" by an agent this session).
14. Impersonate a Claude Code hook editing `notes.md` (same idiom as the Phase 4 manual):

    ```powershell
    '{"hook_event_name":"PostToolUse","tool_name":"Edit","session_id":"manual-1","tool_input":{"file_path":"C:\\_cowlens\\notes.md"}}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected, within ~1 s:* the `notes` card shows two signals at once — the pre-existing
    Phase 4 pulse (amber ring, amber stripe, blinking header square) **and** the Live lens
    snaps it to max brightness. `old-notes`/`manifesto` stay at floor.
15. Wait ~4 s. *Expected:* the amber pulse ring/stripe fade back to rest (that is the
    3.2 s window), but the `notes` card **stays at max Live-lens brightness** — proof the
    lens uses its own 60 s memory (`lensLiveTs`/`LENS_LIVE_WINDOW_MS`), distinct from the
    3.2 s card pulse. (Note: there is no dedicated timer that re-checks the Live lens after
    the 60 s window closes — only Activity has a ticker. If you leave the canvas completely
    idle for a full minute with no further hook events or clicks, `notes` may still read as
    "live" past the true cutoff; the next click, selection, or hook event resyncs it. This
    is the frozen contract's ticker rule working as designed, not a fail.)

### B6. Back to None, then persistence across restart

16. Click **NONE**. *Expected:* all three cards return instantly to the exact B1
    appearance.
17. Click **WEIGHT** (to have a non-default value to persist), wait ~1 s (500 ms persist
    debounce), then close the Cowtext window entirely.
18. Inspect the persisted settings on disk:

    ```powershell
    Get-Content "$env:APPDATA\com.mooexe.cowtext\settings.json" | Select-String '"lens"'
    ```

    *Expected:* the line reads `"lens": "weight",`.
19. Relaunch (`npm run tauri dev`), open `C:\_cowlens` again.
    *Expected:* **WEIGHT** is already the highlighted segment with no click, and the cards
    render with Weight styling immediately on load.

## C. Validation — unknown values, layout freeze, a known gap

### C1. Unknown persisted lens value falls back to None

20. Close the app. Edit the settings file directly:

    ```powershell
    (Get-Content "$env:APPDATA\com.mooexe.cowtext\settings.json") -replace '"lens":\s*"weight"', '"lens": "nonsense"' |
      Set-Content "$env:APPDATA\com.mooexe.cowtext\settings.json"
    ```

21. Relaunch, open `C:\_cowlens`. *Expected:* the app starts normally (no crash, no error
    dialog) and **NONE** is the highlighted segment — an unrecognized string is rejected to
    the default, never preserved or passed through as-is.

### C2. Layout-freeze law

22. Click through all four segments (**NONE → ACTIVITY → WEIGHT → LIVE → NONE**) several
    times in a row. *Expected every time:* only brightness changes; card width/height, node
    positions, edge routing, the New-node button and the file rail are all completely
    unaffected. Drag the `manifesto` node a few px between two of the clicks — its position
    after each subsequent lens switch is exactly where you dropped it, never reset or
    nudged.

### C3. Known gap — external rename leaves a stale, falsely-fresh node

23. With **ACTIVITY** active, rename a tracked file from **outside** the app:

    ```powershell
    Rename-Item C:\_cowlens\old-notes.md C:\_cowlens\old-notes-renamed.md
    ```

    *Expected per the watcher contract's own stated design ("rename ... handled correctly
    through the create/remove paths"):* `old-notes.md` disappears from the project's file
    list and a new `old-notes-renamed.md` entry appears.
    *Actual, as built:* `old-notes-renamed.md` appears correctly, but `old-notes.md` does
    **not** disappear — instead it snaps to full Activity brightness (as if freshly
    modified) and lingers in the project's file bookkeeping indefinitely, because nothing
    ever calls a rescan after a watcher event. This reproduces the rename-mapping defect
    filed against `src-tauri/src/watcher.rs` (Windows reports a rename as two separate
    `ModifyKind::Name(RenameMode::From/To)` events, and the watcher's `map_event_kind` maps
    both to plain `Modify`, never `Remove`). **Record this step as a known fail — do not
    chase it further here**, see the fleet defect report.
24. Recover: press the file rail's **Rescan** button (circular-arrow icon, top of the rail)
    to clear the stale entry before continuing.

## D. Regression — 2 minutes (Phase 3/4 basics still work under a lens)

25. With any lens still active, **drag** the `manifesto` node to a new spot.
    *Expected:* smooth drag, no console errors in the `tauri dev` terminal, lens brightness
    carries over unchanged on the moved card.
26. **Connect** `notes` → `manifesto` with a **references** edge.
    *Expected:* dashed edge draws normally; selecting it opens the inspector's Edge panel.
27. Select the `notes` node, open the inspector's Markdown tab, add a line, press **Save**
    (or Ctrl+S). *Expected:* saves normally, unaffected by whichever lens is active.
28. Press **Compile** (top bar). *Expected:* the modal still opens and behaves exactly as in
    the Phase 2 manual — lens styling is canvas-only and never touches Compile.

## Block B — Token budget

Extends WO01 Block B / T3 (`docs/INPUT_PROMPT.md`): per-file token/line chips in the
Compile modal, a per-target budget bar, the amber warn flip on an oversized root file, and
the canvas node badge staying live off both a Save and an external edit. Written against the
code as of 2026-08-18 (`src/store/tokens.ts`, `src/compile/CompileModal.tsx`,
`src/canvas/MemoryNodeCard.tsx`). Uses two new throwaway projects — `C:\_cowlens` from
section A is left alone (its `old-notes` node has a stale `filePath` after the C3 rename, so
Compile on that project now fails validation with a "missing file" error; don't reuse it here).

29. Close the Compile modal left open from step 28 (**Cancel**). Make a small scratch project
    and open it:

    ```powershell
    mkdir C:\_cowsmall
    Set-Content C:\_cowsmall\alpha.md "# Alpha`n`nFirst budget-test node."
    Set-Content C:\_cowsmall\beta.md "# Beta`n`nSecond budget-test node."
    ```

    Press **Open folder** and pick `C:\_cowsmall`. *Expected:* the file rail reads
    **`2 markdown files`**, canvas is empty.
30. Adopt both files (`+ adopt` on each rail row), then drag a **references** edge from
    `alpha` to `beta` (same idiom as B6/step 26). *Expected:* two node cards, one dashed
    references edge `alpha → beta`.
31. Press **Compile**. Targets default to `claude` only. *Expected:* one `FileSection` row,
    `CLAUDE.md`, with a mono chip between the path and the target `Badge` reading
    **`≈45 tok · 7 lines`**. Below the target-toggle row, a new **budget** row shows one item:
    label `claude`, a short near-empty accent-blue fill (`≈45` is 2% of the 2000-token warn
    scale), and the number `≈45` in the default muted-secondary color — no amber anywhere.
32. Click the **agents** target chip too (leave `claude` on). *Expected:* brief pixel-march
    reload, then **two** `FileSection` rows — `CLAUDE.md` (still `≈45 tok · 7 lines`) and
    `AGENTS.md` (`≈47 tok · 7 lines`) — and the budget row now shows **two** items,
    `claude ≈45` and `agents ≈47`, both still accent-blue (neither target's root crosses
    either warn threshold).
33. Close the modal (**Cancel**). Select the `alpha` node, open the inspector's Markdown tab.
    *Expected:* the card's footer chip (bottom-left, e.g. `8 tok`) reads a small number.
    Append five or six lines of filler text in the editor and press **Save** (or Ctrl+S).
    *Expected:* the footer chip's number increases immediately after the save completes — no
    manual refresh, no full rescan spinner — confirming `write_md_file` → `rescan()` still
    updates `sizeBytes` and the card reads it reactively.
34. Touch `alpha.md` from **outside** the app (grow it further, well past the last save):

    ```powershell
    Add-Content C:\_cowsmall\alpha.md ("`n" + ("More filler content for the watcher check. " * 10))
    ```

    **Do nothing in the app.** *Expected, within ≤ 1 s:* the `alpha` card's footer chip
    increases again to reflect the new file size, via the `fs://change` watcher path (same
    idiom as B3) — still no rescan spinner.
35. Build a project whose `CLAUDE.md` output alone crosses the 150-line warn threshold. The
    root only contains one `@path` bullet per **references**/**conditional** edge (not
    per-node, not the file's own content), so hitting 150+ lines through node-by-node
    adoption would mean ~150 individual `+ adopt` clicks — script it instead, writing
    `.cowtext/graph.json` directly (one hub node, 160 children, 160 references edges):

    ```powershell
    mkdir C:\_cowbudget
    1..160 | ForEach-Object { Set-Content "C:\_cowbudget\child$_.md" "# Child $_" }
    Set-Content C:\_cowbudget\hub.md "# Hub"
    mkdir C:\_cowbudget\.cowtext
    $children = 1..160 | ForEach-Object {
      [ordered]@{
        id = "child$_"; title = "Child $_"; role = "reference"; brief = ""
        filePath = "child$_.md"; readOrder = $_; pinned = $false
        position = @{ x = ($_ * 24); y = 200 }
      }
    }
    $hub = [ordered]@{
      id = "hub"; title = "Hub"; role = "reference"; brief = ""
      filePath = "hub.md"; readOrder = 0; pinned = $false
      position = @{ x = 0; y = 0 }
    }
    $edges = 1..160 | ForEach-Object {
      [ordered]@{ id = "e$_"; source = "hub"; target = "child$_"; kind = "references" }
    }
    $graph = [ordered]@{
      version = 2
      projectName = ""
      nodes = @($hub) + $children
      edges = $edges
      compileTargets = @("claude")
    }
    $graph | ConvertTo-Json -Depth 8 | Set-Content -Encoding ascii C:\_cowbudget\.cowtext\graph.json
    ```

    Press **Open folder** and pick `C:\_cowbudget`. *Expected:* the graph loads straight from
    the pre-built `graph.json` (no adopting needed) — 161 nodes appear on the canvas.
    Press **Compile**. *Expected:* the `CLAUDE.md` row's chip reads **`≈1.8k tok · 166
    lines`**; the `claude` budget bar's fill turns amber (`bg-amber`, ~92% of the track —
    the fill width is only ever the token/2000 ratio, 1847/2000, it does **not** jump to
    100% just because the *line* threshold is what tripped the warn), and the number `≈1.8k`
    renders in amber text. Hover the `claude` budget item. *Expected:* a tooltip reading
    exactly **`CLAUDE.md: 166 lines (over 150)`** — the token count (1847) stays under the
    2000 warn threshold, so this is specifically the *line*-threshold branch, not the token
    one; the fill-width/color split (width = token ratio always, color = either threshold)
    is worth double-checking here since it's an easy spot for a future regression.

## Block C — Disk-change review

Extends WO01 Block C / T4 (`docs/INPUT_PROMPT.md`): the self-write-tagged watcher
(`src-tauri/src/watcher.rs` `note_self_write`/`take_self_write`, `src-tauri/src/project.rs`
`write_atomic`) feeding `src/store/review.ts`'s review queue, the `ReviewBanner` strip in
`src/App.tsx`, and the side-by-side `src/review/ReviewModal.tsx`. Written against the code as
of 2026-08-18. Uses a fresh throwaway project — `C:\_cowlens`/`C:\_cowsmall`/`C:\_cowbudget`
from earlier sections are left alone.

36. Close any open modal from section B. Make a throwaway project:

    ```powershell
    mkdir C:\_cowreview
    Set-Content C:\_cowreview\one.md "# One`n`nFirst review-test node."
    Set-Content C:\_cowreview\two.md "# Two`n`nSecond review-test node."
    ```

    Press **Open folder** and pick `C:\_cowreview`. *Expected:* the file rail reads
    **`2 markdown files`**, canvas is empty.
37. Adopt both files (**+ adopt** on each rail row). *Expected:* two node cards, `one` and
    `two`, no edges needed for this section.

### C1. Cowtext's own Save never banners (self-write suppression)

38. Select the `one` node, open the inspector's **Markdown** tab, append a line, press
    **Save** (or Ctrl+S). *Expected:* saves normally — and at no point does the amber
    ReviewBanner strip appear above the workspace. This is `write_atomic` registering the
    write in the self-write registry before the watcher's own `fs://change` event for that
    same write is flushed (§T4); the write is real and the node's content updates, it just
    never becomes a review-queue entry.

### C2. External edit banners within ≤1 s; Close does not lose the entry

39. From **outside** the app, edit `one.md`:

    ```powershell
    Add-Content C:\_cowreview\one.md "`nAn external line, added by hand."
    ```

40. **Do nothing in the app.** *Expected, within ≤ 1 s:* a 31 px amber strip appears above
    the workspace reading exactly **`1 file changed on disk`**, with an amber dot and two
    buttons, **Review next** and **Dismiss all**.
41. Click **Review next**. *Expected:* the review modal opens (`role="dialog"`,
    `aria-label="Review disk change"`); the header reads `one.md` with an amber **modified**
    badge; the body briefly reads "Reading disk content…" then shows two side-by-side panes
    titled **last known content** (left) and **on disk now** (right). The line "An external
    line, added by hand." appears amber-tinted only in the right pane, appended at the
    bottom; the rest of both panes reads identically as plain context lines.
42. Press **Escape** (or click the footer's **Close** button). *Expected:* the modal closes,
    but the ReviewBanner strip is **still** showing `1 file changed on disk` — Close only
    drops the review pointer (`closeReview`), it does not dequeue the entry.
43. Click **Review next** again. *Expected:* the modal reopens showing the exact same
    `one.md` diff as step 41 — proof the entry survived the Close.
44. Click **Accept**. *Expected:* the modal closes and the ReviewBanner strip disappears
    (queue now empty). Wait a few seconds — it does not reappear on its own.

### C3. Revert restores the old bytes; its own write does not re-banner

45. From outside the app, edit `two.md`:

    ```powershell
    Add-Content C:\_cowreview\two.md "`nA second unwanted external line."
    ```

46. *Expected, within ≤ 1 s:* the banner reappears reading `1 file changed on disk`.
47. Click **Review next**. *Expected:* the modal shows `two.md`, **modified** badge, the new
    line tinted on the right pane only.
48. Record the current disk content for comparison:

    ```powershell
    Get-Content C:\_cowreview\two.md
    ```

    *Expected:* three lines — `# Two`, blank, `Second review-test node.`, `A second unwanted
    external line.`
49. Click **Revert**. *Expected:* the modal closes, the banner disappears. Re-run the same
    `Get-Content C:\_cowreview\two.md` command. *Expected:* back to exactly the original two
    content lines (`# Two`, blank, `Second review-test node.`) — the unwanted line is gone.
    Wait a few seconds. *Expected:* the banner does **not** reappear — Revert's own write is
    self-write-suppressed, it never re-enqueues itself.

### C4. Dismiss all — two-click arm, never touches disk

50. Populate a 2-entry queue at once:

    ```powershell
    Add-Content C:\_cowreview\one.md "`nEdit A"
    Add-Content C:\_cowreview\two.md "`nEdit B"
    ```

51. *Expected, within ≤ 1 s:* the banner reads exactly **`2 files changed on disk`**.
52. Click **Dismiss all** once. *Expected:* the button's own label swaps in place to
    **`Confirm dismiss all?`** (danger-red border/text) — nothing has been dismissed yet, the
    banner still reads `2 files changed on disk`.
53. Click **Confirm dismiss all?**. *Expected:* the banner disappears entirely. Verify disk
    was never touched:

    ```powershell
    Get-Content C:\_cowreview\one.md; Get-Content C:\_cowreview\two.md
    ```

    *Expected:* both files still carry `Edit A` / `Edit B` — `dismissAll` only clears the
    in-memory queue, it never writes.

### C5. Open-tab limitation on Accept (documented, not a bug)

54. Select the `one` node and open the inspector's **Markdown** tab. Leave it open and
    visible for the rest of this section.
55. From outside the app:

    ```powershell
    Add-Content C:\_cowreview\one.md "`nAnother external change."
    ```

56. Wait for the banner, click **Review next**, then **Accept**.
57. **Without clicking away**, look at the still-open Markdown tab for `one`. *Expected known
    limit:* the editor content has **not** changed — "Another external change." is absent
    from the visible editor even though disk and the snapshot both now include it.
58. Select the `two` node, then reselect `one`. *Expected:* the Markdown tab now re-reads
    from disk and shows "Another external change." — confirms the gap is scoped to an
    already-open tab not hot-reloading, not a permanent desync.

### C6. Known gap — Skip does not reliably advance and can drop/duplicate queue entries

59. Populate a 2-entry queue again:

    ```powershell
    Add-Content C:\_cowreview\one.md "`nSkip test A"
    Add-Content C:\_cowreview\two.md "`nSkip test B"
    ```

60. Wait for the banner (`2 files changed on disk`), click **Review next**. *Expected:* the
    modal opens on one of the two files — note its `relPath` in the header, call it **File
    X** (the other queued file is **File Y**); the header also shows `2 to review` next to
    the kind badge.
61. Click **Skip**. *Expected per the button's own stated intent ("come back to this one
    later"), it should now show File Y.* *Actual, as built:* the header still reads **File
    X** — the first Skip press is a no-op on the visible entry. Root cause:
    `skipCurrent` in `src/store/review.ts` builds `rotated = [...queue, reviewing]` and then
    drops `rotated[0]`; since `reviewing` already **is** `queue[0]` at this point,
    `rotated[0]` is still the same File X object, so nothing advances.
62. Click **Skip** a second time. *Expected:* now advances to File Y. *Actual, as built:*
    it does advance, but the queue has silently corrupted in the process — File Y's entry
    was dropped from `queue` while it was being shown, so it is no longer anywhere in the
    pending list; a third **Skip** or a **Review next** after closing shows File X again,
    now duplicated. **Record this as a known fail — do not chase it further here**, see the
    fleet defect report (`src/store/review.ts::skipCurrent`). Recover by clicking
    **Accept**/**Revert** on whatever is showing until the banner clears, or **Dismiss all**.

## Cleanup

63. Close the app and delete all four scratch projects:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowlens, C:\_cowsmall, C:\_cowbudget, C:\_cowreview
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Happy path | | |
| C Validation | | |
| D Regression | | |
| Block B Token budget | | |
| Block C Disk-change review | | |

Tester: ____________  Date: ____________  Build/commit: ____________
