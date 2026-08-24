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

## Block F — Agents MVP

Extends WO01 Block F (`docs/_archive/contracts/WO01_BLOCK_F_CONTRACT.md`, T7–T10 + barn tie-in): "Add agent"
spawns a real headless `claude -p --output-format stream-json --verbose` child per turn in a
chosen folder, the bottom **roster strip** shows one card per session, clicking a card opens the
Inspector's **Agent panel** (transcript, real token usage, a Queue box), **Kill**/**Restart**
manage the child process tree, and one existing calf sprite in the barn tracks each live session.
Written against the code as of 2026-08-18 (`src-tauri/src/sessions.rs`, `src-tauri/src/
worktree.rs`, `src/store/sessions.ts`, `src/sessions/api.ts`, `src/sessions/RosterBar.tsx`,
`src/sessions/AgentPanel.tsx`, `src/sessions/AddAgentDialog.tsx`, `src/scene/agentHerd.ts`).
Uses a **fresh throwaway git repository**, not a rescan-only markdown folder — agent sessions
require `worktree_check(cwd).isRepo == true`. **This section spawns real Claude Code child
processes and consumes real API usage** — keep prompts to short, cheap one-liners as scripted
below.

**Time budget:** ~20 min (most of it is waiting on real `claude` turns).

64. **Make a throwaway git project:**

    ```powershell
    mkdir C:\_cowagents
    cd C:\_cowagents
    git init -q
    git config user.email "test@test.com"
    git config user.name "test"
    Set-Content C:\_cowagents\README.md "# scratch repo for agent sessions"
    git add README.md
    git commit -q -m "init"
    cd C:\
    ```

    *Expected:* a one-commit git repo at `C:\_cowagents`.
65. In Cowtext, press **Open folder** and pick `C:\_cowagents`. *Expected:* the file rail reads
    **`1 markdown files`** (`README.md`), canvas empty. (The git repo underneath is what this
    section needs — the graph itself is unused.)

### F1. Add-agent flow — non-repo refusal, main-working-copy nudge, worktree creation

66. Look at the bottom of the window. *Expected:* a new **38 px roster strip** between the
    workspace and the Event log panel, reading **`no agents running`** in muted mono text, with
    an **Add agent** button (`+` icon) to its left.
67. Click **Add agent**. *Expected:* a modal titled **Add agent** opens, initial focus on
    **Cancel**; fields top to bottom are **Agent file** (select, default `(none)`), **Name**
    (text input, placeholder `agent name`), **Folder** (read-only path field + **Browse…**
    button); the footer reads `spawns a real Claude Code session in that folder`.
68. Click **Browse…** and pick a **non-git folder** (e.g. run `mkdir C:\_cownotrepo` first and
    pick that). *Expected:* after a brief `checking…`, a red line reads exactly
    **`not a git repository`** and the **Add** button stays disabled.
69. Click **Browse…** again and pick `C:\_cowagents` itself (the repo's **main working copy**,
    not a linked worktree). Type `scout` into **Name**. *Expected:* an amber line reads
    **`repo main working copy — a separate worktree is recommended`** with a
    **Create worktree…** button under it, and **Add** becomes enabled anyway — the main-working-
    copy case is a nudge, not a hard block (contract §8.3).
70. Click **Create worktree…**. *Expected:* a second folder picker opens titled
    **New worktree folder** — pick a new, not-yet-existing path, e.g. `C:\_cowagents-wt1`.
    *Expected after picking:* a branch-name input appears pre-filled with **`agent/scout`** (the
    slugified Name) plus a **Create** button.
71. Click **Create**. *Expected:* the button briefly reads `· · ·`, then the Folder field
    re-points to `C:\_cowagents-wt1` and a green line reads **`worktree · agent/scout`**.

### F2. Spawn, roster status, transcript, real usage

72. Click **Add**. *Expected:* the dialog closes immediately; a new roster card appears (avatar
    seeded on `scout`, name `scout`, amber blinking status dot) and the right panel opens on this
    session automatically — the Inspector's **first** branch, ahead of any node/edge selection
    (contract §8.2).
73. Watch the roster card and the panel's status pill. *Expected, within a few seconds and with
    no reload:* status flips **working** (amber, blinking) → **idle** (muted grey, no blink) once
    the boot turn's ready-line reply arrives.
74. Read the panel's transcript. *Expected:* at least one plain text line carrying the agent's
    short ready confirmation (the boot prompt's `BOOT_PROMPT_TAIL` reply, contract §6.3).
75. Look at the usage line just under the cwd/agent-file meta. *Expected:* **not**
    `no usage yet` — a line shaped `↑<N> ↓<N> · <N> tok · <N> turns`; hovering it shows the
    tooltip **`reported by claude, not an estimate`**.

    ⚠ **Known gap, confirm rather than assume a typo:** the CLI emits a `usage` payload twice
    per logical turn — once on the streamed assistant text message, once on the final `result`
    line — and both are non-zero, so the panel (which sums every `usage` event) double-counts:
    after this single boot turn `turns` reads **`2`**, not `1`, and the token totals are roughly
    double the turn's real usage. Reproducible outside the app too: pipe a one-line prompt
    through `claude -p --output-format stream-json --verbose` in any repo and diff the
    `assistant.message.usage` block against the final `result.usage` block — both present,
    both non-zero, different `output_tokens`. Record as a known fail, do not chase further here
    (see the fleet defect report against `src-tauri/src/sessions.rs`'s `map_line` and
    `src/store/sessions.ts`'s `applyEvent` "usage" case).
76. Type a one-line prompt in the **Queue** box — `What is 2+2? Reply with just the number.` —
    and press **Enter**. *Expected:* the textarea clears, status flips to `working`, and within a
    few seconds a reply appears in the transcript; the usage line's `turns` count jumps again
    (by 2, not 1, per the same gap noted in step 75).

### F3. Queue while busy

77. Immediately after sending in step 76, while status still reads `working`, type a second
    prompt (`What is 3+3? Reply with just the number.`) and press **Enter** right away.
    *Expected:* it is **not** sent immediately — helper text **`queued: 1`** appears next to
    **Send** — and once the session returns to `idle` the queued prompt sends itself; its reply
    appears in the transcript without touching **Send** again.

### F4. Barn tie-in

78. Switch to the **Barn** view (top view switcher). *Expected:* the `scout` Agent panel is
    **still open** — barn view also mounts the Inspector while a session is selected (§8.2). One
    calf sprite stands near the developer's desk with the **same look/colors** as `scout`'s
    roster-card avatar (both seed on the session name `scout`).
79. Hover the `scout` calf. *Expected:* the hover label reads **`scout — idle`** (or
    `scout — working: <Tool>` if a turn happens to be mid-flight) — never a generic
    `Calf — subagent #n` label.

### F5. Kill — verify no orphan processes

80. Note the running `claude` processes before killing:

    ```powershell
    Get-Process claude -ErrorAction SilentlyContinue | Select-Object Id, ProcessName
    ```

    *Expected:* zero or more rows — a turn is one child process, so between turns (status
    `idle`) there may be none; that alone is not a failure. If the list is empty, send one more
    quick prompt and move to the next step while `scout` is still `working`.
81. In the panel, click **Kill**. *Expected:* the button's label swaps in place to
    **`Confirm kill?`** (danger red) — nothing has happened yet.
82. Wait 5 s without clicking anything else. *Expected:* the button reverts to plain **Kill** —
    the 4 s auto-disarm fired.
83. Click **Kill** to re-arm, then immediately click **Confirm kill?**. *Expected:* the roster
    card dims to `opacity-60` with a dismiss **X**, its dot stops animating, and the panel's
    Queue box disables with placeholder `session has exited`.
84. Verify no descendants survive:

    ```powershell
    Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'claude|node' }
    ```

    *Expected:* none of the pid(s) noted in step 80 remain (a brand-new unrelated `claude`/`node`
    process on the machine is fine — the check is "your session's pid is gone", not "the process
    name never appears"). Switch to **Barn**. *Expected:* the `scout` calf sprite is gone.

### F6. Restart — same worktree, same conversation

85. Click **Restart** on the exited `scout` panel. *Expected:* the button briefly reads `· · ·`,
    then the roster card returns to full opacity with a working→idle cycle, and the transcript
    gains a new muted line reading exactly **`— restarted —`**, followed by a fresh ready
    confirmation — everything above that line (the F2/F3 exchange) is still there.
86. Ask something that depends on the earlier exchange — `What number did I ask you about
    earlier?` — and press Enter. *Expected:* the reply references the earlier 2+2/3+3 exchange,
    proving `--resume <claudeSessionId>` continued the same conversation rather than starting a
    fresh one (T10 acceptance).
87. Return to **Barn**. *Expected:* the `scout` calf sprite is back.

### F7. Guardrails — dup-cwd and MAX_SESSIONS

88. Click **Add agent**, pick `C:\_cowagents-wt1` (the folder `scout` is running in) as the
    Folder. *Expected:* once the worktree check settles, a red line reads exactly
    **`an agent is already running there`** and **Add** stays disabled, even though the folder
    checks out as a perfectly valid worktree.
89. Cancel. Kill `scout` (Kill → Confirm kill?), then add three more short-lived agents in three
    fresh worktrees off the same repo (repeat F1/F2 with new names/branches, e.g.
    `C:\_cowagents-wt2/3/4`; boot turn only, skip the Send steps, to limit cost) until **4** are
    alive at once. *Expected while adding the 4th:* it spawns normally, and the **Add agent**
    button now renders disabled with title **`agent limit reached (4)`** — clicking it has no
    effect.
90. Confirm the roster strip holds all 4 cards via horizontal scroll (`overflow-x-auto`), not by
    wrapping or clipping. Kill all 4 (F5's Kill → Confirm per card), then re-run:

    ```powershell
    Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'claude|node' }
    ```

    *Expected:* no descendant of any of the four sessions remains.

91. Close the app and remove the scratch repo and its worktrees (adjust names to whatever you
    actually created in F7):

    ```powershell
    Remove-Item -Recurse -Force C:\_cowagents, C:\_cowagents-wt1, C:\_cowagents-wt2, C:\_cowagents-wt3, C:\_cowagents-wt4, C:\_cownotrepo -ErrorAction SilentlyContinue
    ```

## Block D — New Node wizard

Extends WO01 Block D / T5 (`docs/INPUT_PROMPT.md`): the 4-step **New node wizard**
(Identity → Target → Brief → Assemble), reached from a split "New node" button and the
pane's right-click menu, plus its Import/Export preset round-trip and "Run Assemble after
create". Written against the code as of 2026-08-18 (`src/wizard/NodeWizard.tsx`,
`src/wizard/paths.ts`, `src/wizard/roleSkeleton.ts`, `src/wizard/preset.ts`,
`src/store/graph.ts` `createNodeFrom`/`commitNewNode`, `src/canvas/GraphCanvas.tsx`).
Uses a fresh throwaway project — earlier scratch projects are gone (Cleanup, step 63) or a
sunk repo (F7's cleanup); do not reuse them.

**Time budget:** ~12 min full pass.

92. Make a throwaway project and open it:

    ```powershell
    mkdir C:\_cowwizard
    Set-Content C:\_cowwizard\existing.md "# Existing`n`nAlready on disk before the wizard runs."
    ```

    Press **Open folder** and pick `C:\_cowwizard`. *Expected:* the file rail reads
    **`1 markdown files`**, canvas empty.

### D1. Entry points

93. Look at the top-left **Panel**. *Expected:* the **New node** button is now a split
    control — a left segment (`+ New node`) and a thin right segment holding only a
    chevron (▾), separated by a hairline border, both inside one rounded pill.
94. Click the **chevron** segment. *Expected:* a small menu opens with exactly one item,
    **New node wizard…** (sparkle icon). Click it. *Expected:* the wizard modal opens
    (`role="dialog"`, `aria-label="New node wizard"`), centered, ~720 px wide, titled
    **New node**, header shows 4 step-dots labeled **Identity · Target · Brief ·
    Assemble** with **1** highlighted blue and the other three greyed/disabled (not yet
    reachable by clicking).
95. Press **Escape**. *Expected:* the modal closes with no file written — confirm nothing
    landed on disk or on the canvas:

    ```powershell
    Get-ChildItem C:\_cowwizard -Recurse -Filter *.md
    ```

    *Expected:* still only `existing.md`.
96. Right-click empty canvas. *Expected:* the pane context menu includes, in order,
    **New node here**, **New node wizard…**, then **Fit view**. Click **New node
    wizard…**. *Expected:* the wizard reopens (same as step 94), and this time it will
    place the new node at the click point rather than viewport center — keep this instance
    open for D2.

### D2. Identity → Target → Brief → Assemble, nothing written before Confirm

97. **Step 1 (Identity):** the **Next** button is disabled (greyed). Type `API
    Conventions` into the **Name** field. *Expected:* **Next** enables. Look at the **Role**
    grid: 7 cards in a 4-column layout (`agent`, `rules`, `architecture`, `workflow`,
    `task`, `reference`, `glossary`), each showing a glyph + colored label; **reference**
    is pre-selected (highlighted card, colored border). Click the **rules** card.
    *Expected:* selection moves to `rules`, the description line below the grid updates to
    describe rules. Click **Next**.
98. **Step 2 (Target):** *Expected:* **Directory** reads `context`, **File name** reads
    `api-conventions.md` (auto-slugged from the Name), and the path-preview strip below
    reads `context/api-conventions.md` with no de-dupe note. Now test collision de-dupe:
    change **File name** to `existing.md`. *Expected:* the preview strip reads
    `context/existing.md` (unchanged, since `existing.md` lives at the project root, not
    under `context/` — no collision) — then change **Directory** to empty (clear the
    field). *Expected:* the preview strip now reads **`existing.md (existing.md already
    exists — de-duped)`**-style output: the shown path is **`existing-2.md`**, with a
    grey note `(existing.md already exists — de-duped)` next to it. Now type
    `.cowtext` into **Directory**. *Expected:* a red line reads **`This path is managed by
    Cowtext — pick a different directory.`** and **Next** disables. Restore **Directory**
    to `context` and **File name** to `api-conventions.md`.
99. Flip the **Pinned** toggle ON (amber pill, right-aligned under "Always in context, not
    just on demand."). *Expected:* the toggle turns amber-filled; below it, the adapter-chip
    line changes from "Not pinned — compiles on demand only…" to **`Pinned — always
    included in:`** followed by one amber chip per active compile target (at minimum
    `claude`, the default). Click **Next**.
100. **Step 3 (Brief):** type `Conventions the agent must follow for this repo's API
     surface.` into the textarea (placeholder was "One line for Assemble to expand
     later"). Click **Next**.
101. **Step 4 (Assemble):** *Expected:* the field label shows the exact target path
     `context/api-conventions.md`; the preview textarea is prefilled with a template
     starting `# API Conventions`, then the brief text verbatim, then a `## Rules` section
     (role-specific heading for `rules`) with an italic hint line. Manually edit the
     preview (append a line `- No breaking changes without a version bump.`). *Expected:*
     a **Reset to template** link appears next to the label. Click it. *Expected:* the
     preview reverts to the freshly-generated template (your manual edit is gone) and the
     link itself disappears. Leave **Run Assemble after create** OFF for this pass.
102. Look at the footer. *Expected:* it reads exactly **`Creates
     context/api-conventions.md and selects it on the canvas.`** Click **Create node**.
     *Expected:* the modal closes immediately; a new card titled **API Conventions**
     appears on the canvas, selected (accent ring); the role glyph matches **rules**.
     Verify the file on disk:

     ```powershell
     Get-Content C:\_cowwizard\context\api-conventions.md
     ```

     *Expected:* starts with `# API Conventions`, then the brief line, then a `## Rules`
     heading and hint — the template as shown in step 101 (post-reset), byte for byte.

### D3. Export → Import → Confirm round-trip

103. Reopen the wizard (chevron → **New node wizard…**). Fill **Step 1**: Name
     `Deploy Steps`, Role **workflow**. **Step 2**: leave Directory `context`, File name
     auto-slugs to `deploy-steps.md`. **Step 3**: Brief `How we ship a release.`
     **Step 4**: hand-edit the preview textarea to add one distinguishing line, e.g.
     `- Tag the release before deploying.` at the end.
104. Click the header's **Export preset…** icon (download icon, left of Close). A save
     dialog opens. Save as `C:\_cowwizard-preset\deploy-steps.node.cowtext-preset.json`
     (create the folder first if the dialog requires it to pre-exist). *Expected:* dialog
     closes with no error banner in the modal.
105. Click **Close (X)** without confirming. *Expected:* modal closes, and no
     `deploy-steps.md` exists yet:

     ```powershell
     Test-Path C:\_cowwizard\context\deploy-steps.md
     ```

     *Expected:* `False`.
106. Reopen the wizard. Click **Import preset…** (folder-in icon) and pick the file saved
     in step 104. *Expected:* the modal jumps straight to **step 1** with **Name**
     `Deploy Steps`, **Role** `workflow`, all four step-dots now clickable (import unlocks
     every step). Jump to **step 4** by clicking its dot. *Expected:* the preview textarea
     contains your exact hand-edited text from step 103, including the
     `Tag the release before deploying.` line — the imported `content` field, not a
     freshly regenerated template.
107. Click **Create node**. *Expected:* new node `Deploy Steps` appears, selected. Diff the
     created file against the exported preset's `content` field to confirm the byte-exact
     round-trip:

     ```powershell
     Get-Content C:\_cowwizard\context\deploy-steps.md -Raw |
       Out-File C:\_cowwizard-preset\roundtrip-disk.txt -Encoding utf8 -NoNewline
     $preset = Get-Content C:\_cowwizard-preset\deploy-steps.node.cowtext-preset.json -Raw |
       ConvertFrom-Json
     $preset.nodes[0].content | Out-File C:\_cowwizard-preset\roundtrip-preset.txt -Encoding utf8 -NoNewline
     (Get-FileHash C:\_cowwizard-preset\roundtrip-disk.txt).Hash -eq
       (Get-FileHash C:\_cowwizard-preset\roundtrip-preset.txt).Hash
     ```

     *Expected:* `True`.

### D4. Import validation — bad file rejected inline, never a crash

108. Reopen the wizard, click **Import preset…**, and pick a file that is **not** a preset
     (e.g. `C:\_cowwizard\existing.md`, filtered out by the `.json` extension filter — if
     your OS dialog still allows picking it via "all files", do so; otherwise create
     `C:\_cowwizard-preset\bad.json` containing `{"not":"a preset"}` and pick that).
     *Expected:* the wizard stays open on whatever step it was on, a red inline banner
     appears at the top of the body reading a **`kind mismatch`**-flavored error (from
     Rust's `validate_preset`) — the app does not crash and no fields change.
109. Import again, this time picking a **regular graph preset** if one exists (Presets…
     modal → Export a normal multi-node preset first, then try importing that file here).
     *Expected:* red inline error reading **`This looks like a full graph preset, not a
     node preset — use Presets… instead`** (or the "no content field" variant if it has
     exactly one node).

### D5. Run Assemble after create

110. Open the wizard once more. Step 1: Name `Release Notes`, Role **task**. Step 2:
     defaults. Step 3: Brief `Summarize what changed for the next release.` Step 4: flip
     **Run Assemble after create** ON (amber pill under the preview, warns "overwrites the
     preview above"). Click **Create node**.
111. *Expected:* the modal closes immediately (fire-and-forget, same as the Inspector's
     Assemble button); the new `Release Notes` card appears selected with the amber
     assemble indicator (queued/running) within a second or two, then settles once the
     real `claude -p` turn completes (or shows the error state if the CLI isn't
     configured in this environment — either is an acceptable outcome here, this step is
     checking the *wiring*, not CLI availability). Open the Inspector's Markdown tab for
     `Release Notes` once settled. *Expected:* if assembled successfully, the content no
     longer matches the plain role-skeleton template — it has been expanded.

### D6. Known gap — same-name-different-case dir/file silently overwrites an existing file

112. This step demonstrates a real defect found in audit; expect it to reproduce as
     described (Windows' filesystem is case-insensitive, but the wizard's de-dupe check is
     case-sensitive). Open the wizard, Step 1: Name `Existing Clobber Test`. Step 2:
     type **Directory** as empty, **File name** as `EXISTING.MD` (same name as the
     project's `existing.md` from step 92, but upper-cased). *Expected per the frozen
     spec's "never-clobber via existing write path w/ collision de-dupe"*: this should
     either de-dupe to `EXISTING-2.MD` or block, the way step 98 did for a same-case
     collision. *Actual, as built:* the path-preview strip shows `EXISTING.MD` with **no**
     de-dupe note (`rawPath === finalPath` — the exact-case check in
     `src/wizard/paths.ts::dedupePath` never sees the collision against the taken set's
     lowercase `existing.md`), and **Next**/**Create node** are not blocked. Step through
     to Confirm and click **Create node**. *Expected known fail:* a **second** node titled
     `Existing Clobber Test` appears on the canvas with `filePath = "EXISTING.MD"`, while
     the original `existing.md`'s content on disk has been **silently overwritten** by the
     new node's template content (NTFS resolves both names to the same file; Rust's
     `write_atomic` in `src-tauri/src/project.rs` removes-then-renames unconditionally).
     Confirm the loss:

     ```powershell
     Get-Content C:\_cowwizard\existing.md
     ```

     *Expected actual:* the original "Already on disk before the wizard runs." line is
     gone, replaced by the wizard's generated template — with zero warning shown anywhere
     in the UI. **Record this as a known fail — do not chase it further here**, see the
     fleet defect report (`src/wizard/paths.ts::dedupePath`, `src/wizard/NodeWizard.tsx`
     taken-path check). Recover by deleting both the stray canvas node (select it, Delete)
     and restoring `existing.md` from the Set-Content command in step 92 if you continue
     testing.

### D7. Regression — the quick "New node" one-click path still works

113. Click the **left** segment of the split button (`+ New node`, not the chevron).
     *Expected:* exactly the old one-click behaviour — a new, unselected-then-selected
     node titled **New node** appears immediately at the viewport center, `context/
     new-node.md` (or `-2`/`-3`… if already taken), role `reference`, no modal involved.
114. Double-click empty canvas. *Expected:* same quick-create behaviour at the click
     point — untouched by this work order.

## Cleanup (Block D)

115. Close the app and remove the scratch project and preset folder:

     ```powershell
     Remove-Item -Recurse -Force C:\_cowwizard, C:\_cowwizard-preset -ErrorAction SilentlyContinue
     ```

## Block E — Thought bubbles

Extends WO01 Block E / T6 (`docs/INPUT_PROMPT.md`): the cow's existing bubble system
upgraded into a controller — real `BarnEvent`s show a verb+filename bubble ("reading X" /
"editing X" / "writing X"), and after 30 s idle the cow cycles a 10-line flavor pool,
meant to be preempted instantly by the next real event. Written against the code as of
2026-08-18 (`src/scene/cow.ts` `FLAVOR_LINES`/flavor countdown, `src/scene/mapper.ts`
`verbLabel`). Uses a fresh throwaway project; live event injection via the same
`curl.exe` → `:4923/event` idiom as Block A's B5.

**Time budget:** ~10 min (includes two required ≥30 s idle waits).

116. Make a throwaway project and open it, then switch to the **Barn** view:

    ```powershell
    mkdir C:\_cowbubbles
    Set-Content C:\_cowbubbles\notes.md "# Notes`n`nShort file for the bubble verb check."
    ```

    Press **Open folder**, pick `C:\_cowbubbles`. In the file rail, hover `notes.md` and
    click **+ adopt**. Click the **Barn** segment of the top view toggle. *Expected:* the
    barn scene renders, the cow stands near the dev desk, no bubble showing.

117. **Real event bubble text (read, happy path):** POST a synthetic read event for the
    adopted file:

    ```powershell
    '{"hook_event_name":"PostToolUse","tool_name":"Read","session_id":"manual-e1","tool_input":{"file_path":"C:\\_cowbubbles\\notes.md"}}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected, within ~1.5 s:* the cow walks to the bookshelf prop and a bubble reading
    exactly **`reading notes.md`** appears above her head; the `page_flip` cue plays once
    on arrival (matching the existing read cue, no new sound added).

118. **Real event bubble text — verb-dropping truncation (known gap):** POST a write event
    for a longer, nested path (this file need not exist on disk or be adopted — the
    edit/write bubble text doesn't require a resolved prop):

    ```powershell
    '{"hook_event_name":"PostToolUse","tool_name":"Write","session_id":"manual-e1","tool_input":{"file_path":"C:\\_cowbubbles\\context\\architecture.md"}}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected per the T6 acceptance ("editing rules.md" — derive verb from kind):* a
    bubble reading something like `writing architecture.md`. *Actual, as built:* the
    bubble reads **`…context/architecture.md`** — the verb is silently gone. Root cause:
    `mapper.ts`'s `verbLabel()` builds `` `${verb} ${filePath}` `` and only *then* calls
    the existing `truncateLabel`'s 24-char tail-keep; once `"writing " + filePath` exceeds
    24 chars (true for almost any file more than one directory deep — real repo paths like
    `docs/design/SOUND_DESIGN.md` or `src/scene/BarnScene.tsx` reproduce it too), the
    ellipsis-tail truncation eats the verb before the filename. Repeat the same curl with
    `"tool_name":"Edit"` on the identical path. *Expected difference:* a different verb.
    *Actual:* the resulting bubble text is **byte-identical** to the write case,
    `…context/architecture.md` — reading vs. editing vs. writing become visually
    indistinguishable for any nested path. **Record as a known fail — do not chase it
    further here**, see the fleet defect report against `src/scene/mapper.ts::verbLabel`.

119. **Idle 30 s flavor rotation:** let the barn sit with no further events for at least
    35 s (past `IDLE_LIE_MS` = 30 000 ms in `BarnScene.tsx`). *Expected:* the cow lies down
    (pre-existing E5 pose escalation) and, some seconds after lying down, a bubble appears
    reading one of the ten flavor-pool lines (`chewing grass`, `mooing thoughtfully`,
    `swishing tail`, `watching dust motes`, `counting hay bales`, `dreaming of clover`,
    `humming a tune`, `practicing patience`, `polishing a hoof`, `waiting for a commit`) —
    no sound plays on spawn. Watch for at least two more rotations (~8–12 s apart).
    *Expected:* the bubble swaps to a new line each time; **note but do not fail on** an
    occasional exact repeat — the pool pick is a plain `Math.random()` index with no
    anti-repeat guard, so the same line twice in a row is possible (~1-in-10 per swap).

120. **Preemption — social/search events (immediate, works as spec'd):** while a flavor
    bubble is showing, POST a prompt-submitted event:

    ```powershell
    '{"hook_event_name":"UserPromptSubmit","session_id":"manual-e1"}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected:* the flavor bubble is replaced by **`!`** on the very next frame — no fade,
    no waiting for the flavor bubble's remaining lifetime to elapse. This path
    (`bubbleOnStart`, fired at task pickup) does satisfy "immediately."

121. **Preemption — file-access events (known gap):** wait for another flavor bubble to
    appear (idle 30 s+ again), then immediately re-run step 117's read curl. *Expected per
    the T6 acceptance ("a real file-access event replaces an active flavor bubble
    immediately")*: the flavor bubble should vanish the instant the event is received.
    *Actual, as built:* the flavor bubble stays on screen unchanged for the whole walk to
    the bookshelf — `bubbleOnArrive` only fires inside `Cow.arrive()`, not at task start —
    which can be up to ~1.5 s later, before it flips to `reading notes.md`. This bubble-
    timing model predates this drop (edit/write/read never had a `bubbleOnStart`), but T6's
    spec explicitly promises immediate preemption for file-access events specifically, so
    it reproduces as a gap here. **Record as a known fail — do not chase it further here**,
    see the fleet defect report against `src/scene/cow.ts`/`src/scene/mapper.ts`'s
    read/edit/write arms.

122. **Calm mode — instant swap, still silent:** open **Settings** (gear icon, top bar) and
    flip **Calm mode** ON. Close Settings. Let the barn idle 30 s+ again. *Expected:* the
    cow rests in the static reduced-motion pose (no walk-fade, no juice) and the flavor
    bubble still appears/swaps every ~8–12 s with a plain instant swap (there was never an
    animation to suppress). Re-run step 117's read curl. *Expected:* the bubble still
    updates to `reading notes.md` in calm mode (the mapper/cow bubble logic runs regardless
    of `reducedMotion()`), and the whole exchange stays completely silent (Calm mode
    implies mute; bubbles were already silent by design). Turn **Calm mode** back OFF
    before continuing.

123. **No new cues, no interference with hover:** with Calm mode off, hover the bookshelf
    prop `notes.md` sits on with the mouse. *Expected:* the pre-existing hover bubble
    (`src/scene/hover.ts`) appears independently near the prop, unaffected by and not
    replaced by whatever the cow's own head-bubble is doing at the same moment — the two
    bubbles coexist without fighting over the same state. Re-run step 117's read curl while
    still hovering. *Expected:* only the existing per-event `page_flip` cue plays — no
    extra "bubble spawn" sound fires for either the real bubble or a flavor bubble,
    consistent with `SOUND_DESIGN.md`'s deliberately-silent "bubble show/expire" line.

## Cleanup (Block E)

124. Close the app and remove the scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowbubbles -ErrorAction SilentlyContinue
    ```

## N1–N5 — WO01 Nice-to-haves

Extends `docs/INPUT_PROMPT.md` N1–N5: @path mention chips in the Markdown editor,
the Compile split-button, Manager mode, the bottom status bar, and ctx%/cost in the
usage line. Written against the code as of 2026-08-18 (`src/inspector/
CodeMirrorEditor.tsx`, `src/inspector/Inspector.tsx`, `src/App.tsx`, `src/compile/
CompileModal.tsx`, `src/store/settings.ts`, `src/settings/SettingsModal.tsx`,
`src/store/review.ts`, `src/store/tokens.ts`, `src/sessions/AgentPanel.tsx`,
`src/sessions/RosterBar.tsx`, `src-tauri/src/sessions.rs`). Uses a fresh throwaway
project; earlier scratch projects are gone (or a sunk repo) — do not reuse them.

**Time budget:** ~12 min (N5's step needs one real, cheap `claude -p` boot turn).

125. Make a throwaway project and open it:

     ```powershell
     mkdir C:\_cowmentions
     Set-Content C:\_cowmentions\main.md "# Main`n`nSee @ref.md and also @missing.md for details."
     Set-Content C:\_cowmentions\ref.md "# Ref`n`nReferenced content."
     ```

     Press **Open folder**, pick `C:\_cowmentions`. *Expected:* the file rail reads
     **`2 markdown files`**. Adopt only `main.md` and `ref.md` (**+ adopt** on each
     rail row) — `missing.md` deliberately never existed, so no node will ever
     resolve it (that's the unresolved-chip case below). *Expected:* two node cards,
     `main` and `ref`.

### N1 — @path mention chips

126. Select the `main` node, open the Inspector's **Markdown** tab. *Expected:* inside
     the editor, `@ref.md` renders as an accent-bordered chip (`.cm-at-mention`) and
     `@missing.md` renders with a dashed muted border (`.cm-at-mention-muted`) —
     visually distinct at a glance, not just by hover.
127. Hover the `@ref.md` chip. *Expected:* the tooltip reads exactly **`Click to focus
     the node · Shift-click to add a references edge`**. Click it (plain click).
     *Expected:* selection moves to the `ref` node and the Inspector switches to the
     **Properties** tab.
128. Reselect `main`, reopen the **Markdown** tab. Hover `@missing.md`. *Expected:*
     the tooltip reads exactly **`no node for this file`**, cursor is the default
     arrow (not a pointer) over the chip. Click it. *Expected:* nothing happens — no
     selection change, no console error in the `tauri dev` terminal.
129. Shift-click the `@ref.md` chip. Switch to the **Canvas** view. *Expected:* a new
     dashed **references** edge now runs `main → ref`. Reopen `main`'s Markdown tab
     and shift-click `@ref.md` again. *Expected:* no second edge — back on Canvas,
     exactly one `main → ref` edge exists (the store's own duplicate guard in
     `confirmConnection` holds even if a caller re-fires the same add).

### N2 — Compile split-button

130. Look at the top-left **Compile** control. *Expected:* it is now a split button —
     a left `Compile` segment and a thin right chevron segment, hairline-separated.
     Click the **chevron**. *Expected:* a dropdown opens with exactly three items, in
     order, each with an icon: **CLAUDE.md**, **AGENTS.md**, **.cursor/rules**. Click
     **AGENTS.md**. *Expected:* the Compile modal opens with the preview already
     auto-running (brief pixel-march, then the file list) and, in place of the usual
     three-chip target row, a single **locked** accent chip reading **`agents`** next
     to the label `target` — no way to flip to `claude`/`cursor` from inside this
     modal. Close it (**Cancel**).
131. Click the split button's **left** segment (`Compile`, not the chevron).
     *Expected:* the modal reopens showing the full three-chip target-toggle row
     (today's original behaviour, untouched by N2). Close it.

### N3 — Manager mode

132. Open **Settings** (gear icon, top bar). *Expected:* a new **View** section
     appears with a **Manager mode** row and a toggle, helper text mentioning it
     "never loads the Pixi scene". Flip it **ON**, close Settings. *Expected:* the
     top view-toggle strip now shows only **Canvas** and **Tasks** — the **Barn**
     segment is gone entirely, not just disabled.
133. Open Settings again, flip **Manager mode** back **OFF**, close Settings.
     *Expected:* **Barn** reappears in the view toggle immediately, no reload
     needed, and clicking it still opens the barn scene normally.

### N4 — Status bar

134. Look at the very bottom of the window, below the roster strip and the event
     log. *Expected:* a slim ~24px strip reads exactly **`2 nodes · 1 edge · 0
     changed on disk · 0 to review`** (mono, muted; note the singular "edge" —
     the strip pluralizes each unit independently) — matching the 2 adopted nodes
     and the 1 references edge from step 129. Edit `ref.md` from **outside** the
     app:

     ```powershell
     Add-Content C:\_cowmentions\ref.md "`nAn external line."
     ```

     *Expected within ~1 s:* the strip updates to **`2 nodes · 1 edge · 1 changed
     on disk · 1 to review`** and the amber ReviewBanner appears above the
     workspace. Click **Review next**, then **Accept**. *Expected:* the strip's "to
     review" count drops back to **0**, but "changed on disk" **stays at 1** — it is
     a session counter that only resets on a project switch, never on Accept/
     Revert/Dismiss.

### N5 — ctx% + cost in the usage line

135. Add a real agent to exercise real usage reporting (see Block F/F1 for the full
     flow if any step below is unfamiliar):

     ```powershell
     cd C:\_cowmentions
     git init -q
     git config user.email "test@test.com"
     git config user.name "test"
     git add -A
     git commit -q -m "init"
     cd C:\
     ```

     In Cowtext, click **Add agent** (bottom roster strip), leave **Agent file**
     `(none)`, type `probe` for **Name**, point **Folder** at `C:\_cowmentions`
     (accept the main-working-copy nudge, no worktree needed for this quick check),
     click **Add**. Wait for the boot turn to settle (status dot goes amber →
     idle).
136. Read the Agent panel's usage line (just under the cwd/agent-file meta).
     *Expected:* it reads **`≈<N> tok · <X>% of 200k · $<Y.YYYY>`** (4 decimal
     places on the cost; if this `claude` build never reports `total_cost_usd`, the
     last segment instead reads exactly **`cost n/a`**, never `$0.0000`) — not the
     old `↑<N> ↓<N> · <N> tok · <N> turns` format, which is now only in the line's
     hover tooltip. Look at the `probe` roster card. *Expected:* a thin 2px bar
     under the status dot, accent-colored, reflecting the same percentage (would
     switch to amber at ≥80% of the 200k window — not expected to trip on one boot
     turn).
137. Kill `probe` (**Kill** → **Confirm kill?**) to avoid leaving a stray process.

## Cleanup (N1–N5)

138. Close the app and remove the scratch project:

     ```powershell
     Remove-Item -Recurse -Force C:\_cowmentions -ErrorAction SilentlyContinue
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
| Block F Agents MVP | | |
| Block D New Node wizard | | |
| Block E Thought bubbles | | |
| N1-N5 Nice-to-haves | | |

Tester: ____________  Date: ____________  Build/commit: ____________
