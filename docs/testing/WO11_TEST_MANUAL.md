# WO11 Manual Test Script — Acceptance-walk defects, Home/Git/Project/Avatars

Hand-run test manual for WO11 (contract `docs/design/WO11_CONTRACT.md`, including
the **§10 amendment** — D5 struck and replaced, the `agentDeleteListeners` seam,
the two "stray" path-comparison fixes — and a second fix round covering five
defects found during this manual's first authoring pass, four of which this
tester found and one — the `AGENT_FS` mutex around agent/skill file writes —
tech-lead/R2 found independently). Run top to bottom in one sitting. Section B
is deliberately first and stands alone — it targets the three crashes Marty
reported that could **not** be reproduced from a headless shell (B2, C1, F1)
and is the single most valuable thing to run if you only have a few minutes.
Sections D onward reuse the project built in section A; section I (Git) and
section J (Avatars) write into that same project's `.cowtext/` and `.claude/`
trees. **Section G is a regression pass against a real fix, not a fishing
expedition** — the steps in G.3/G.6 previously described a probabilistic race;
after this round's fix they are expected to pass **deterministically, on every
attempt**, and a single failure is a real regression. **Section G.7 is new and
currently unfixed** — it documents a second, independent bypass of the same
file-write surface, found during re-verification of the mutex fix, and should
be treated as an open defect until addressed.

Written against the working tree as of 2026-08-20 (uncommitted, second fix
round on top of `ec7c1ba`): `src/store/agents.ts`, `src/store/graph.ts`,
`src/store/review.ts`, `src/store/tokens.ts`, `src/git/GitWizard.tsx`,
`src/ui/diff.ts`, `src/inspector/Inspector.tsx`, `src-tauri/src/agents.rs`,
`src-tauri/src/agents/tests.rs`, `src-tauri/src/git.rs`,
`src-tauri/src/project.rs`. Gates at authoring time (both re-measured
independently, not trusted from either party's report): `npx tsc --noEmit`
exit 0, `npm run lint` 0 errors (7 pre-existing `react-refresh/
only-export-components` warnings in `RoleGlyphs.tsx` and `sectionOrder.tsx`),
`npm run build` clean, `cargo clippy --all-targets -- -D warnings` clean,
`cargo test` **583 lib + 18 CLI = 601, 0 failed**, invoke contract **73/73**
declared = registered = TS-called by exact name (extracted and diffed, not
counted).

Every step names the real control and the exact expected result. If reality
differs, that is a bug (or this manual is stale; either way, note it). Steps
marked **[CODE AUDIT]** were verified by reading the source and, where noted,
by independently re-running `cargo test`'s new thread-race tests — not by
driving the live GUI (this pass had no interactive browser/window access).
That is as reliable as static analysis plus a real concurrency test gets, but
the *first* live run of each is still the real confirmation and should be
logged in the Notes column.

**Time budget:** ~20 min for section B alone if that is all you have. ~80 min
for a full A–N pass, plus the 4-minute WO10 regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri
   dev` fails rather than picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite on :1420, cargo builds, the Cowtext window opens on the
   title screen with **three** buttons: `Open folder`, `New project`,
   `Convert existing`.
3. **Make a throwaway test project:**

   ```powershell
   mkdir C:\_wo11test
   Set-Content C:\_wo11test\notes.md "# Notes`n`nScratch."
   ```

4. Click **Open folder** → `C:\_wo11test`.
   *Expected:* workspace opens, Hierarchy shows `notes.md`, empty canvas. This
   is a bare folder with no `.cowtext/project.json` yet — that is deliberate,
   section E1 exercises the "no project properties file yet" path before
   section C (wizards) creates one.
5. **Open WebView devtools** now and leave them open for the whole pass
   (right-click canvas → Inspect Element, or `Ctrl+Shift+I`). Section B needs
   the Console tab for stack traces and unhandled-rejection warnings; later
   sections use it to read network timing for the autosave/mutex checks in
   section G.

---

## B. The three unresolved crashes — one-pass capture

Marty reported three crashes (B2: selecting an agent in the Hierarchy; C1:
"Adopt to graph"; F1: Assemble-after-close then Finish) that this work order's
Stage 0 could not reproduce from a headless shell. A global `ErrorBoundary`
(`src/ui/ErrorBoundary.tsx`, wired around `<App/>` in `src/main.tsx`) now
renders the component stack + message + a **Reload** button instead of
blanking the window on any render-phase throw — confirmed present in the tree
this manual was written against. Do these three **first**, in order, before
anything else in this manual, because a still-live crash is worth more than
any other finding here.

6. **B2 capture.** In the Hierarchy's **Agents** section, click the `+` to
   create a fresh agent (any name), then click on **every** agent row in the
   list — the new one, any pre-existing ones, and (if you have graph nodes) one
   that is adopted onto the canvas vs. one that is not.
   *Expected:* the Inspector switches to the agent panel each time. No blank
   window.
   *If the ErrorBoundary fires:* screenshot or copy **all three** blocks —
   `error.name: error.message`, the **Component stack** pre block, and the
   **Stack trace** pre block. Note exactly which agent row (on-graph vs.
   off-graph, fresh vs. pre-existing) triggered it — this is the detail the
   contract's own hypothesis (`Inspector.tsx`'s old bare-`/`-split `fileName`
   derivation) was written against, and that code path no longer exists in
   `Inspector.tsx` (`rg "node.filePath.split" src/inspector/` returns nothing
   as of this writing) — so if it still fires, the cause has moved.
   *If nothing fires and nothing renders (the window silently does something
   other than show the agent panel):* check the Console tab for an
   **unhandled promise rejection** (a rejected `invoke()` with no `.catch`
   would not trip a React error boundary at all) and check the OS process list
   (Task Manager) for whether `cowtext.exe`'s Rust side is still alive. A dead
   Rust process with a still-open, now-frozen window is the signature of a
   `.expect()` panic on the async runtime (see F1 below) rather than a JS
   throw — record which.
7. **C1 capture.** Create a new agent via the Agents `+` that you deliberately
   do **not** adopt (leave it off-graph — the row shows an `off-graph` badge).
   Select it, then click **Adopt to graph** in the Inspector's Actions section.
   *Expected:* it lands on the canvas as a node, the strip disappears, exactly
   one card exists for that agent file.
   *If the boundary fires:* same capture as step 6. Note whether it fires
   immediately on click or after a delay (immediate = likely the `adoptFile`
   commit itself; delayed = likely a re-render triggered by the store update
   propagating to a different mounted panel).
8. Repeat step 7 a second time from a **different** entry point: right-click
   the same (now on-graph) agent's rail row and look for an "Adopt"-shaped
   item.
   *Expected per contract §5.3/WO10 item 10:* the menu now offers "Select node
   on canvas", not "Adopt to graph" again, and there is still exactly one card.
   Two cards for one file, or a second crash here, is worth its own line in the
   findings even if step 7 passed clean.
9. **F1 capture.** Double-click empty canvas to open the Node Wizard. Fill in a
   title, tick **Assemble after close** (or the equivalent brief-to-full-file
   toggle), then close the wizard's host — i.e. click the wizard's own **✕**
   or press Escape — *before* pressing the final Create/Finish button, if the
   UI allows that ordering; otherwise: press **Finish** normally, then
   immediately close the wizard panel while the assemble queue is still
   working (watch for the assembling-bar state on the new card).
   *Expected:* the node is created, the wizard closes, assemble proceeds to
   completion in the background, the app keeps rendering.
   *If the boundary fires:* capture as above.
   *If the window freezes with NO boundary and NO console error:* this is the
   contract's stronger hypothesis — a Rust-side panic in `assemble.rs`'s queue
   pump thread (`.expect("assemble queue mutex")` at multiple call sites,
   `assemble.rs:203,222,243,272,296`). A poisoned mutex there makes **every
   subsequent** `assemble_*` invoke panic too, not just this one — confirm by
   trying **Assemble** on a completely different, unrelated node right after:
   if that also silently does nothing (no pixel-march, no status change, no
   rejected-promise console entry), the mutex is poisoned and this verdict
   moves from a UI-lane bug to lane R2 (Rust) per the contract's own escalation
   rule (§2.2/§6 Stage 0). **Note the contrast with this round's own fix in
   section G**: the new `AGENT_FS: Mutex<()>` in `agents.rs` deliberately never
   `.expect()`s — it recovers from poisoning via
   `unwrap_or_else(|p| p.into_inner())` specifically because `assemble.rs`'s
   `.expect()` pattern is the leading suspect for this exact class of
   whole-app death. If F1 traces back to `assemble.rs`, the fix shape from
   `agents.rs` is the template for it.
10. Regardless of outcome, **restart the app** (`Ctrl+C` the `tauri dev`
    terminal, rerun) before continuing to section C — a poisoned assemble
    mutex or a torn-down React tree from step 9 must not contaminate later
    sections' results.

---

## C. Project wizard — A1–A4

11. From the title-screen-equivalent inside the app (top bar → the project
    row's context menu, or reopen fresh): open **New project** on a clean
    folder:

    ```powershell
    mkdir C:\_wo11new
    ```

    Choose folder → `C:\_wo11new`. *Expected:* step 2 of the wizard, Name
    pre-filled `_wo11new`.
12. **A1.** Open the **Type** dropdown/picker.
    *Expected:* **"Video Game"** is present as the second entry, with hint text
    about "Interactive, real-time; content and feel matter as much as code."
    Select it.
13. **A2.** Click into **Brief description**. Paste in 3000 characters (any
    repeated text works, e.g. `"x" * 3000` via a script, or hold a key).
    *Expected:* the field stops accepting input at exactly **1000** characters;
    the counter beside the label reads `1000 / 1000` in **amber** (the
    threshold is ≥ 900). Delete down to 500 characters — counter returns to
    the muted colour.
14. **A3 — the space/newline bug.** Click into **Requirements**. Type
    `Run tests` then a space then `before merging`, watching the caret as you
    type the space.
    *Expected:* the space is not eaten — you end up with
    `Run tests before merging` on one line, caret stays where you left it (no
    jump to end-of-field).
15. Press **Enter** to start a second line, type `- keep coverage above 80%`.
    *Expected:* a genuine second line exists (visually two rows in the
    textarea); the leading `- ` is visible **while typing** — it must not be
    stripped mid-keystroke. Click elsewhere to blur, or advance the wizard.
    *Expected on commit:* the leading dash is stripped only now (the bullet
    regex runs at commit time, not per keystroke) — verify by reopening the
    wizard on this project later (step 20) and seeing `keep coverage above
    80%` without the dash.
16. Repeat steps 14–15 in **Hard rules** and in **Constraints** (inside the
    Optional disclosure, see next step) — same caret-stability check in both.
17. **A4.** Before touching Hard rules/Target audience/Architecture/
    Constraints, look at the disclosure around them.
    *Expected:* it reads **`Optional (4)`** and is **collapsed** by default on
    this fresh New Project.
18. Click it open, fill in **Hard rules** (from step 16) and leave the other
    three empty, then finish the wizard (**Create**).
    *Expected:* project opens; check disk:

    ```powershell
    Get-Content C:\_wo11new\.cowtext\project.json
    Get-Content C:\_wo11new\context\project.md
    ```

    `project.json` has `"projectType": "game"` (or whatever key A1's entry
    uses — confirm it round-tripped, not translated). `project.md` contains
    the Requirements list with **two** real lines (`Run tests before merging`
    and `keep coverage above 80%`, no stray leading dash, no missing space).
19. **A4 edit-mode check.** From the rail's project row, right-click → **Edit
    project properties…**.
    *Expected:* the wizard reopens directly on step 2 (edit mode skips folder
    picking); the **Optional (4)** disclosure is **expanded already**, because
    Hard rules already has data — edit mode must never hide data you already
    typed. Close without changing anything.
20. **F1 note.** If section B's step 9 could not be captured because the
    wizard UI does not literally allow closing before Finish, use this
    project's Node Wizard instead: create a node, tick Assemble-after-close,
    Finish, and watch for the same signature (boundary fire vs. silent Rust
    death) — log whichever project you actually captured it on.

---

## D. Hierarchy & shell — B1, E1, G1, G4

21. **B1 row shape.** Create a subfolder with a file: in `C:\_wo11new`,

    ```powershell
    mkdir C:\_wo11new\context\design
    Set-Content C:\_wo11new\context\design\tokens.md "# Tokens"
    ```

    Rescan (rail header **Rescan**, or reselect the project row's context menu
    **Rescan**).
    *Expected:* under `context` → `design`, the file shows as **`tokens.md`**
    (basename only, not the full `context/design/tokens.md`); hovering it
    shows the full relPath in the `title` tooltip.
22. Look at the chevron column across every depth (root files, `context/`,
    `context/design/`).
    *Expected:* one consistent 16px gutter — empty (no icon) on file rows,
    a chevron on directory rows — aligned in a single column regardless of
    depth.
23. Look at sort order inside any directory with both files and subfolders.
    *Expected:* folders sort before files, both alphabetical within their
    group (VS Code order).
24. **E1.** Grep the whole tree for the retired label:

    ```powershell
    cd D:\Moo.exe\Cowtext
    ```

    (from the repo, not the test project) — `rg "Add agent" src/`.
    *Expected:* **zero hits.** In the app, the roster bar's session-spawn
    button reads **"Spawn agent"** (title `Spawn a session`); the rail's
    Agents section `+` still creates a file and needs no relabel (it was never
    "Add agent"). `AddAgentDialog`'s title bar reads `Spawn agent` normally,
    `Launch for task` when opened from a task.
25. **G1 Home — unsaved-work flush.** In `C:\_wo11new`, drag a node (create one
    first if none exist), rename an agent's nickname field, and resize the
    Inspector panel width if that is a persisted setting — do all three
    without waiting for any "saved" indicator. Immediately click the **Home**
    icon (top bar, left of the view segments).
    *Expected:* no confirm strip appears (no live sessions yet), the app
    returns to the title screen. Reopen `C:\_wo11new` (Open folder or the
    recent-projects list).
    *Expected:* the node position, the nickname, and the panel width are all
    exactly as you left them — Home flushed all three debounced writers before
    clearing state.
26. **G1 with a live session.** Spawn an agent session (roster bar → Spawn
    agent → pick an agent → Launch). While it is running, click **Home**.
    *Expected:* an amber confirm strip appears naming the session count
    (`N agent sessions keep running in the background`) with **Go home** /
    **Cancel**. Click **Cancel**.
    *Expected:* nothing closes, the session is still listed and still running.
    Click **Home** again, then **Go home**.
    *Expected:* the app returns to the title screen; the session is **not**
    killed — check the roster/orchestrator view is gone, but if you have OS
    access, the underlying process is still alive until the app itself exits.
27. **G4 reveal.** Right-click the project row → **Reveal in File Explorer**.
    *Expected:* the OS file explorer opens on `C:\_wo11new`. Rename the
    project's root folder on disk from outside the app (breaking the path),
    then try Reveal again without reopening the project.
    *Expected:* an inline error banner appears in the rail — never a silent
    no-op. Rename the folder back before continuing.

---

## E. Inspector — C1 regression, C2, D5, G3, cross-panel sync

28. **C2 section order.** Select any memory node.
    *Expected order top to bottom:* **Metadata, Context, Relations, File,
    Position, Assemble, Actions.** Position is the **fifth** section, not the
    first.
29. Select an agent node (on the graph).
    *Expected order:* **Agent, Context, Relations, Position, Assemble,
    Actions.**
30. Collapse **Assemble**, select a different node, then reselect the first
    one.
    *Expected:* still collapsed. Restart the app, reopen the project.
    *Expected:* still collapsed (persisted in `AppSettings.collapsedSections`).
31. **D5.** With an agent node selected, scan the **Actions** section.
    *Expected:* exactly one button, **"Remove from graph"**, with the helper
    line "The agent file stays on disk." — **no "Delete agent" button anywhere
    in the Inspector**, on this panel or the off-graph agent panel or the
    project panel. Confirm mechanically:

    ```powershell
    cd D:\Moo.exe\Cowtext
    ```

    `rg "Delete agent" src/inspector/` → zero hits.
32. **G3 project panel.** Click the project row itself (not a file/node) in
    the Hierarchy.
    *Expected:* the Inspector switches to a project-specific panel, header
    "Project" or the project's name, sections **Identity, Description,
    Requirements, Rules & constraints, Git, Actions**. `Name`, `Type`, `Root`,
    the two file-presence rows are **read-only inert wells** (not disabled
    inputs — no border-focus affordance), each captioned "Edit in the project
    wizard."
33. Edit **Brief** in this panel (append a sentence), then click elsewhere to
    blur.
    *Expected:* no write happens per keystroke — only on blur. After blur,
    check disk:

    ```powershell
    Get-Content C:\_wo11new\.cowtext\project.json | Select-String brief
    Get-Content C:\_wo11new\context\project.md
    ```

    Both reflect the new text.
34. **Never-resurrect check.** Delete `context/project.md` by hand:

    ```powershell
    Remove-Item C:\_wo11new\context\project.md
    ```

    Edit **Requirements** in the project panel and blur again.
    *Expected:* `.cowtext/project.json` updates; `context/project.md` is
    **not** recreated. The Identity section's "context/project.md" well now
    reads "not found."
35. **Selection-clears-selection regression (§5.4's own named fix).** Select a
    task in the Tasks view sidebar/board, then — without deselecting it —
    switch to the Canvas view and click an **off-graph** agent row in the
    Hierarchy.
    *Expected:* the Inspector shows the agent panel, not a stale task panel.
    (This is the early-return-moved-after-the-clears fix; a strand here means
    that fix regressed.)
36. Select the project row, then select any node.
    *Expected:* the project panel is replaced by the node panel — the project
    selection clears. Select the project row again while a node is selected.
    *Expected:* clean swap back, no dual-highlight, no stuck state.

---

## F. Agent properties basics — C3, D2, D3

37. **C3 Tools dropdown.** Select an agent, open the **Tools** field.
    *Expected:* a dropdown with `* (every tool)` then grouped headers Read /
    Write / Execute / Network / Orchestrate, a scrollable list capped around
    340px tall.
38. Scroll the list itself with the mouse wheel, several ticks.
    *Expected:* it scrolls its full length and **stays open**. Now move the
    pointer outside the popup, over the page behind it, and scroll.
    *Expected:* the popup **closes** (only an outside-scroll should dismiss
    it).
39. **D2 memory control.** Select a healthy agent (one with
    `.claude/agent-memory/<stem>/MEMORY.md` present and non-empty).
    *Expected:* the Memory row shows **"Reveal in Explorer"**. Click it —
    the OS file explorer opens on the index file.
40. Delete that agent's memory index by hand:

    ```powershell
    Remove-Item -Recurse -Force C:\_wo11new\.claude\agent-memory\<stem>
    ```

    Reselect the agent (click away and back, forcing a re-probe).
    *Expected:* the control flips to an **amber "Fix"** button with a title
    tooltip reading "no memory folder". Click **Fix**.
    *Expected:* the folder and `MEMORY.md` are recreated; the control flips
    back to "Reveal in Explorer" **without a full rescan** (the surrounding
    panel does not flicker/rebuild).
41. Create a zero-byte `MEMORY.md` by hand (folder exists, file exists, empty)
    and reselect.
    *Expected:* "Fix" again, tooltip "index is empty" this time — the reason
    text is specific to the actual defect shape, not a generic message.
42. **D3 model catalog.** Open the **Model** picker on any agent, company
    "Anthropic".
    *Expected:* exactly **five** entries: `inherit`, `claude-opus-5`,
    `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-fable-5`. No tier
    duplicated as a bare alias (`opus`/`sonnet`/`haiku` do not appear as
    pickable rows).
43. Hand-edit an agent file's frontmatter to `model: opus` (a bare legacy
    alias) outside the app, then reselect it in the app.
    *Expected:* the model select shows `opus` as a **disabled, appended**
    option labelled "opus (legacy alias)" — not blank, not silently swapped to
    a different model, not showing "Other".

---

## G. Agent-file write safety — autosave race (FIXED), the `AGENT_FS` mutex
    (FIXED), and a still-open bypass (G.7, NOT fixed)

This section covers the single highest-risk surface in WO11: everything that
writes `.claude/agents/*.md` or `.claude/skills/*/SKILL.md`. There have been
**two** distinct defects found on this surface across two audit rounds, both
fixed, plus a **third, still-open** one found while re-verifying the second
fix. Read the three subsections in order — G.3 and G.6 are regression checks
against real fixes (expect a clean pass every time); G.7 is new and expects a
**fail** until it is addressed.

### G.1 Basic debounce and disk verification

44. Select an agent, click into **Description**, type a sentence slowly (with
    pauses under 500ms between characters so it debounces as one save).
    *Expected:* no visible Save button anywhere on this panel. Watch the
    console/network — nothing fires until you stop typing for ~500ms.
45. Immediately after you stop typing, check disk:

    ```powershell
    Get-Content C:\_wo11new\.claude\agents\<file>.md
    ```

    *Expected:* the new sentence is there within ~1 second of the last
    keystroke, without you doing anything else.
46. Type again, and **within** the 500ms window keep typing continuously for
    5+ seconds (never pausing 500ms).
    *Expected:* no write happens until you finally pause — the debounce timer
    keeps resetting, exactly like a normal debounce, not a fixed-interval
    autosave.

### G.2 Caret stability and CodeMirror rebuild

47. Switch an agent to raw mode if one exists with a frontmatter parse error
    (or force one by hand-corrupting a frontmatter block), open it, and type
    in the middle of a line (not at the end).
    *Expected:* the caret stays exactly where you typed — the CodeMirror
    editor never rebuilds from an autosave round-trip (its `docKey` is
    `${fileName}:${reloadNonce}`, and `reloadNonce` is bumped only by a fresh
    `loadAgents`/rescan, never by the autosave path itself).
48. Type continuously for 10+ seconds across several debounce cycles (i.e.,
    pause occasionally to let saves land, then resume).
    *Expected:* caret never jumps, no visible flicker, no lost characters at
    any of the save boundaries.

### G.3 Rename/delete racing an in-flight save — [CODE AUDIT] FIXED, verify deterministically

**This is a regression check, not a fishing expedition.** A HIGH defect was
found here in the first audit pass: `flushAgentSaveFor()`
(`src/store/agents.ts`, then `:528-538`) could resolve before a queued
follow-up save (the one holding the latest keystroke) actually landed, because
the old `runAgentSave`'s "already in flight" branch returned the promise for
the write already running, not the newer one it had just queued. It has been
rewritten as a strict per-file FIFO promise chain
(`AgentSaveQueueEntry { timer, tail }` — `src/store/agents.ts:453-491`):
every call to `runAgentSave` appends its own turn to `q.tail` and returns a
promise for *that specific turn*, which by construction cannot resolve before
everything queued ahead of it (including itself) has settled.
`flushAgentSaveFor` (`:564-570`) now unconditionally clears the timer and
awaits a freshly-enqueued `runAgentSave` call, with no branch that can return
a stale reference. Read the code comments at `src/store/agents.ts:415-448` for
the full before/after reasoning.

49. Select an agent. In **Description**, type a burst of text and stop
    (letting the 500ms timer start counting).
50. The **instant** the debounce fires (watch dev-tools network activity, or
    time it at ~500ms after your last keystroke), type **one more character**
    immediately, then **immediately** (within well under a second) click into
    the **rename** field (the agent name input at the top of the editor),
    change the name, and press Enter to commit the rename.
51. Repeat steps 49–50 **at least five times**, varying the exact timing
    (some attempts right at the 500ms mark, some slightly after).
    *Expected (now deterministic, not probabilistic):* on **every** attempt,
    the very last character you typed survives on disk under the **new**
    filename, with no error banner anywhere. A single attempt where the last
    character is missing — with or without a visible error — is a real
    regression of this fix; log the exact repro timing, the character(s)
    typed, and the disk content under both the old (should not exist) and new
    filenames.
52. **Delete variant.** Repeat the same timing attack, but instead of renaming
    at step 50, right-click the agent's rail row → **Delete agent file…** →
    confirm, timed to land while the follow-up save from step 50 would
    previously have been in flight.
    *Expected:* the file and its node (if any) are gone cleanly, every
    attempt, with no stray error state left over (there is no longer a
    surviving in-flight write for the delete to race against — the FIFO chain
    guarantees `flushAgentSaveFor` inside `deleteSelected` has fully settled
    before `agentSaveQueues.delete(sel.key)` runs).

### G.4 Failure surface

53. Make an agent's file **read-only** on disk:

    ```powershell
    attrib +R C:\_wo11new\.claude\agents\<file>.md
    ```

    Edit the Description field.
    *Expected:* after the 500ms debounce, the `Agent` section shows the
    failure strip — amber background, the error message (should mention
    permission/access denied), and a **Retry** button. Your edit is **still
    visible in the field** (not reverted).
54. Remove the read-only flag and click **Retry**.
    *Expected:* the save succeeds immediately (bypasses the debounce), the
    strip disappears, disk now has your edit.

    ```powershell
    attrib -R C:\_wo11new\.claude\agents\<file>.md
    ```

### G.5 Selection-change and beforeunload flush

55. Type into an agent's Description, and **without waiting** for the 500ms
    debounce, immediately click a **different** agent in the rail.
    *Expected:* the previous agent's edit is still saved (the unmount/
    selection-change effect calls `flushAgentSave()`). Click back to the first
    agent and confirm the text is there.
56. Type into an agent field, then immediately close the whole app window
    (click the OS close button) without waiting.
    *Expected:* reopen the project — the edit survived. Note for the record
    that this path is deliberately **best-effort/fire-and-forget** (mirrors
    `flushMetaSave`'s existing idiom for `beforeunload` — a real await is not
    possible in that handler), so an edit typed in the last few hundred
    milliseconds before a hard OS-level kill (not a graceful window close) is
    the one scenario where loss is expected by design, not a bug — only flag
    this step if a **graceful** close/reopen loses data.

### G.6 The `AGENT_FS` mutex — Rust-side resurrection invariant — [CODE AUDIT] FIXED

Independently of G.3's JS-side fix, this tester's original report understated
the danger of the same race: `save_doc`'s `path.is_file()` pre-check
(`src-tauri/src/agents.rs`) only guards the ordering where a racing
`agent_rename` completes *before* that check runs. There is a second window
*after* the check but *before* `write_atomic`'s final `fs::rename` —
`write_atomic` never re-asserts the target still exists, so a save landing in
that window **recreates the old filename as an orphaned duplicate** holding a
stale-content edit, which `agents_scan` later picks up as a second, unrelated
agent. This is worse than a lost keystroke: silent data loss *and* file
duplication. tech-lead ruled this into `agents.rs` rather than `write_atomic`
itself (a replace-only re-check there would break the several commands that
need create-if-absent semantics). The fix is one module-scope
`static AGENT_FS: Mutex<()>` (`agents.rs:141`) taken, after `checked_root`, by
**16 commands**: `agents_scan`, `agent_create`, `agent_memory_ensure`,
`agent_memory_status`, `agent_avatar_set`, `agent_avatar_read`,
`agent_avatar_clear`, `agent_save`, `agent_rename`, `agent_delete`,
`skill_create`, `skill_save`, `skill_rename`, `skill_delete`, `agent_convert`,
`agents_meta_write` — verified to be **every** `#[tauri::command]` in
`agents.rs`, none missing. `agent_fs_guard()` recovers from a poisoned mutex
via `unwrap_or_else(|p| p.into_inner())` rather than `.expect()`, deliberately
(see step 9's note). **[CODE AUDIT — independently verified, no GUI needed for
this part]:**

- **No deadlock/re-entrancy risk found.** None of the 16 command bodies calls
  another of the 16 as a plain Rust function (only via separate Tauri
  invocations, which acquire and release independently); the shared helpers
  (`move_avatar_best_effort`, `clear_avatar_files`, `find_avatar_path`,
  `save_doc`, `rename_patch_name`, `doc_from_content`) never call
  `agent_fs_guard()` themselves, matching the module doc comment's own claim.
  No `drop(_guard)` anywhere — the guard is genuinely held for the full
  function body, including every early-return error path (Rust RAII).
- **The 16 are the right 16 for `agents.rs`** — every `#[tauri::command]` in
  that file is guarded, none missed. **However, see G.7: the mutex's coverage
  is scoped to `agents.rs`, and a completely different, unguarded command in
  `project.rs` can reach the exact same files.** That is a real gap the
  16-count alone does not capture.
- **The tests prove the invariant, not just the happy path.**
  `agent_rename_during_save_never_resurrects_the_old_file` and its
  `skill_rename_during_save_never_resurrects_the_old_skill_dir` twin
  (`src-tauri/src/agents/tests.rs`) spawn **real OS threads** (`std::thread::
  spawn`, genuine concurrency, not cooperative async on one executor) racing
  `agent_save`/`skill_save` against `agent_rename`/`skill_rename` on the same
  file, **25 trials each**, asserting on every trial: the rename always
  succeeds, the old path never exists afterward, a losing save fails with
  exactly `"No such agent"`/`"No such skill"` (never some other error), and
  exactly one file/dir remains on disk. This is a genuine regression test for
  the nondeterministic race, not a single deterministic happy-path run.

57. Re-run the Rust test suite specifically for this invariant and confirm it
    passes:

    ```powershell
    cd D:\Moo.exe\Cowtext\src-tauri
    cargo test agent_rename_during_save_never_resurrects_the_old_file -- --nocapture
    cargo test skill_rename_during_save_never_resurrects_the_old_skill_dir -- --nocapture
    ```

    *Expected:* both pass. Run each 3–4 times in a row (`cargo test <name>`
    repeatedly) — a race-dependent test that only sometimes passes would mean
    the invariant is not actually guaranteed; it should be **always** green.
58. **Manual stress, from the GUI.** With an agent selected, type into
    Description to start a pending autosave, and — as fast as you can, several
    times in a row — alternate typing and renaming (steps 49–50's timing
    attack, repeated in a tight loop for 20–30 seconds).
    *Expected:* check `.claude\agents\` afterward — exactly one file for that
    agent exists (no stray file under any earlier name it passed through
    during the renames), and its content reflects your last edit.

### G.7 — NOT FIXED — `write_md_file`/the Markdown tab bypass the mutex entirely

**New finding, found while re-verifying G.6.** The `AGENT_FS` mutex protects
every command in `agents.rs`, but a **different, older, generic command** —
`write_md_file` / `read_md_file` (`src-tauri/src/project.rs:713-728`) — can
target the exact same `.claude/agents/*.md` files and takes **no lock at
all**. `write_md_file` only special-cases `.claude/settings.json`
(`project.rs:723`); nothing blocks a `.claude/agents/*.md` destination. This
command is reachable from ordinary UI navigation, not just a hand-crafted
`invoke()` call:

- Every graph node — agent-backed or not — renders through the same
  `InspectorHeader` (`src/inspector/Inspector.tsx`, the unconditional render
  right before the properties/markdown ternary), whose **Properties /
  Markdown** segmented toggle (`:1980-1990`) and right-click **"Open markdown
  tab"** item (`:1952-1958`) are **not gated by `isAgentFile`**. Selecting
  `"markdown"` renders `MarkdownTab` (`:1586` onward) for **any** node,
  including an on-graph agent — the panel ternary at `:2062-2073` only checks
  `isAgentFile` inside the `"properties"` branch (routing to `AgentNodePanel`
  vs. `PropertiesTab`); the `"markdown"` branch has no such check at all.
- `MarkdownTab` does its own independent `read_md_file` on mount and an
  explicit-Save `write_md_file` (`:1630`, `:1657`, `:1672`) — entirely outside
  `store/agents.ts`'s autosave queue, `AGENT_FS`, and `save_doc`'s
  frontmatter-aware patch logic. It is a second, uncoordinated writer for the
  same file.
- The `tab` selection (`useInspectorTabStore`) does **not** reset on node
  selection change — only one narrow @-mention-navigation call site resets it
  to `"properties"` (`Inspector.tsx:1619`). This means a user who was on the
  Markdown tab for an ordinary memory node and then clicks an **agent** node
  lands in this bypass with **zero extra clicks**.
- Because `AgentEditor`'s unmount effect fires `flushAgentSave()` on the tab
  switch (best-effort, **not awaited**) while `MarkdownTab`'s own mount effect
  fires a **separate, lock-free** `read_md_file` at essentially the same
  moment, and `read_md_file` is a trivially cheaper single syscall versus
  `agent_save`'s lock + frontmatter-patch + atomic-write, `read_md_file`
  routinely **wins** the race — this is not a rare timing window, it is close
  to the *common* outcome. A user who types in the Agent tab, switches to
  Markdown within the debounce window, and clicks Save there will typically
  and silently discard their own pending edit, without any error, because both
  writes individually "succeed."
- Secondary instances of the same root gap, lower reachability: the canvas
  card's **"Create file"** context-menu item
  (`src/canvas/MemoryNodeCard.tsx:224-241`, gated by `file === undefined`, so
  practically unreachable for an agent whose file already exists) and the
  Review modal's **Revert** action (`src/store/review.ts:218`, reachable only
  when an agent file was externally edited *and* the user opens Review and
  clicks Revert on that entry) both call `write_md_file` the same
  unguarded way.

**Severity: HIGH — same tier as the now-fixed G.3/G.6 findings, arguably more
easily reached** since it needs no adversarial timing, just ordinary tab
navigation. It was not part of tech-lead's stated fix scope for this round
(which named `agents.rs`) and remains open. Confirmed by code reading only —
run the live repro below to get the first real-world confirmation.

59. Select an on-graph agent (Agent tab shown by default). Type a distinctive
    sentence into **Description**, do **not** wait for the save to land.
60. Immediately click the **Markdown** tab (segmented control at the top of
    the Inspector, or right-click the header → **Open markdown tab**).
    *Expected if the bypass is present:* the Markdown tab's content does
    **not** contain your just-typed sentence (it loaded before/racing the
    flush). Wait a couple of seconds, then check disk directly:

    ```powershell
    Get-Content C:\_wo11new\.claude\agents\<file>.md
    ```

    *If disk DOES have your sentence but the open Markdown tab does not* — the
    flush won the race that time; this alone is not the full bug, proceed to
    step 61 to force the data-loss outcome.
61. In the Markdown tab (whatever content it loaded), add an unrelated line at
    the end, and click **Save** (the Markdown tab's own explicit Save button —
    not the Agent tab, which has none per D4).
    *Expected if the bypass is present:* disk now has the Markdown tab's
    content — **your original Description sentence is gone**, silently
    replaced, with **no error anywhere** in either panel. This is the
    reproducible data-loss case. Log the exact sequence and timings; this is
    the strongest, most complete repro.
62. **Cross-check via `AGENT_FS`.** While a Markdown-tab Save (step 61) is
    plausible to be in flight, simultaneously trigger an agent rename or
    delete from the rail.
    *Expected:* since `write_md_file` takes no lock, this can interleave with
    `agent_rename`/`agent_delete` in ways `AGENT_FS` cannot prevent — watch for
    the same resurrection/orphan shape G.6 closed for the guarded path. This
    is a secondary confirmation, not required to prove the primary finding.

---

## H. Agent delete → graph orphan seam — regression + Windows path case

WO10 shipped a real bug here: deleting an agent's file from the rail left its
graph node behind, still selected, still saved into `graph.json`, silently
orphaned. WO11 §10.3 fixes it with a producer/consumer seam
(`agentDeleteListeners` in `store/agents.ts` → a listener in `store/graph.ts`
that resolves to `deleteNodes`) and, in the same hunk, converts a bare `===`
path comparison in the pre-existing rename listener to `sameRelPath` — both
verified present in the code as of this writing.

63. Adopt an agent onto the graph (Hierarchy → agent row → right-click →
    Adopt, or via the off-graph Inspector's "Adopt to graph").
    *Expected:* one node appears.
64. Wire an edge from/to that node, and select it (so it is the current graph
    selection).
65. Right-click the same agent's rail row → **Delete agent file…**.
    *Expected confirm-strip label (§10.4's copy fix):* since this agent has a
    graph node, the strip reads **"Delete .claude/agents/<file>? Its node on
    the graph goes too."** — not the shorter agent-only wording. Confirm.
66. *Expected after confirm:* the file is gone from disk and from the rail;
    the **node is also gone** from the canvas; the edge you wired is gone too;
    nothing is left selected (or a sane new selection, never a dangling
    reference); the Inspector shows no orphaned/missing-file badge for this
    agent anywhere.
67. **Undo check.** Press **Ctrl+Z**.
    *Expected:* the **node** comes back (with its edge), now showing a
    missing-file badge (the file itself is never restored by undo — that
    asymmetry is deliberate and documented). This is the "honest state," not a
    bug.
68. **Off-graph delete (no seam needed).** Create an agent you do **not**
    adopt, delete it via the rail context menu.
    *Expected confirm-strip label:* the shorter form, `Delete
    .claude/agents/<file>?` (no "node" clause — there is no node).
69. **Windows path case — backslash-stored node.** This one needs a hand-edit
    to simulate a shape the app is not supposed to produce anymore, but which
    could still exist in an older `graph.json` or one edited by another tool.
    Close the app. Open `.cowtext/graph.json` in a text editor, find a node
    whose `filePath` looks like `.claude/agents/<file>.md`, and change the
    forward slashes to backslashes: `.claude\\agents\\<file>.md` (remember
    JSON needs the backslash escaped). Save, reopen the project.
    *Expected:* the node still renders normally on the canvas (avatar, name,
    model chip — this is the `MemoryNodeCard.tsx:80` fix,
    `canonPath(node.filePath).split("/").pop()`).
70. Delete that same agent's file via the rail context menu as in step 65.
    *Expected:* the node is pruned exactly as in step 66 — `sameRelPath`
    inside the `agentDeleteListeners` consumer in `graph.ts` must match the
    backslash-stored node against the forward-slash `.claude/agents/<file>`
    path it constructs. **If the node survives this delete (badge or not),
    that is a regression of the exact class of bug §10.5 was written to
    close** — log the node's raw `filePath` string from `graph.json` verbatim.
71. **Case-only rename (Windows).** Rename an agent to a name that differs
    from its current one **only in case** (e.g. `tech-ui` → `Tech-UI`, which
    slugifies back to the same file). If your project doesn't have a
    convenient agent, create one and rename it this way.
    *Expected:* the rename succeeds (Windows filesystems are case-insensitive
    but case-preserving; `same_entry` in `agents.rs` uses `fs::canonicalize`
    to recognize this as "the same file," not a name collision). If the agent
    has an avatar (see section K), confirm the avatar is still attached after
    the case-only rename — `move_avatar_best_effort` has an explicit
    same-destination guard for exactly this case.

---

## I. Standing rule sweep — no bare `===`/`.split("/")` on a `.md` path

Four instances of this exact defect class were found and fixed inside the
first WO11 build round (`Inspector.tsx:1004`, `graph.ts:945`, `graph.ts:948`,
`MemoryNodeCard.tsx:80`) — all confirmed fixed in the current tree (steps 69–70
above exercise two of them directly). A **fifth and sixth** were found during
this manual's first authoring pass (`review.ts:81`, `tokens.ts:62,77`), and a
**seventh** was found by UI-D during the fix round (`tokens.ts:88`, the same
`agentContextTokens` function, one line further down) — **all now fixed**,
using `canonPath`/`sameRelPath` on both sides of every comparison. UI-D also
examined `review.ts:145-148` (matches the grep pattern superficially) and
**correctly judged it not an instance** — both sides of every comparison there
trace back to the exact same `change.relPath` string from one `fs://change`
event (confirmed independently below: `ReviewEntry.relPath` is constructed in
exactly one place, `review.ts:143`, always from `change.relPath`, which is
itself always Rust-canonical per `watcher.rs`'s own doc comment — never from a
graph node's `filePath`, the actually-risky side).

72. Repeat step 69's hand-edit (a node with a backslash `filePath`) — reuse the
    same node if you still have it, or make a fresh one.
73. With that project open and the watcher live, edit that node's underlying
    `.md` file **from outside the app** (Notepad, VS Code — anything that is
    not Cowtext) and save.
    *Expected (fixed):* an external-change notification/banner appears for
    this file exactly as it does for a normal forward-slash node — confirm by
    also editing a normal node's file externally in the same session and
    seeing the same banner behaviour for both.
74. Select the agent node from step 72 (assuming it is agent-backed) and look
    at its **"≈N tok context"** readout in the Agent section, and the same
    figure in the **Orchestrator** tab's detail column for that agent. Give it
    at least one `imports`/`references` edge to another sizeable node first,
    if it doesn't have one.
    *Expected (fixed):* the estimate **includes** the linked node's bytes,
    identically to the same agent with a normal, forward-slash `filePath` and
    the same edge — no undercount.
75. These are now closed — do not skip verifying them just because they
    predate WO11's own scope; the fix landed in this round regardless of
    origin, and a regression here is exactly as real as one in a WO11-native
    file.

---

## J. Git wizard — G2

76. Right-click the project row → **Git…** (also reachable from the topbar
    overflow menu if present).
    *Expected:* a ~560px modal, header "Git", focus starts on **Cancel** (the
    dialog's safe default).
77. `C:\_wo11new` likely has no `.git` yet.
    *Expected state:* "This project is not a git repository yet.", the root
    path shown in mono, one button **"Initialize a git repository here"**,
    helper text "Runs `git init` and nothing else — no commit, no remote, no
    first add."
78. Click it.
    *Expected:* button shows `· · ·` briefly, then the panel falls through to
    the `.gitignore` composer state: a `repo` badge, branch name if any, git
    version.
79. Verify nothing beyond `init` happened:

    ```powershell
    cd C:\_wo11new
    git log
    ```

    *Expected:* "does not have any commits yet" (or equivalent) — no commit
    was made, no `.git/config` remote entry exists beyond defaults.
80. **Presets.** Check the `Node`, `Rust / Cargo`, `Tauri`, `Editors & OS`
    preset chips.
    *Expected:* five groups, and **no** "Cowtext" preset ever offers
    `.cowtext/` itself as a line to ignore (only narrower `.cowtext/*.tmp`
    -style entries, if any) — `.cowtext/` is the project's source of truth and
    must stay tracked. Tick `Node` and `Rust / Cargo`.
81. Look at the diff preview below.
    *Expected:* since there is no existing `.gitignore`, every added line
    shows green/added, header reads "new .gitignore".
82. Tick **"I've reviewed this diff"**, then **Write .gitignore**.
    *Expected:* button shows `· · ·`, then "`.gitignore` written." Check disk:

    ```powershell
    Get-Content C:\_wo11new\.gitignore
    ```

    Ends with exactly one trailing newline; content matches the diff shown.
83. Reopen the wizard (close, reopen Git…). Tick the **same** `Node` preset
    again.
    *Expected:* "No new lines to add." (every line already present is never
    duplicated) — the diff view shows "no changes", Write stays disabled.

### J.1 CRLF `.gitignore` — Windows-specific, [CODE AUDIT] FIXED, verify both cases

**This was a MAJOR finding in the first audit pass, now fixed.**
`composeGitignore`'s no-op branch (`src/git/GitWizard.tsx:120-159`) used to
return `existingLines.join("\n")` — a re-encoded copy that silently converted
CRLF to LF even when zero content was actually being added, and comparing that
against the raw `status.gitignoreContent` produced a phantom full-file
delete+add diff (the shared `src/ui/diff.ts` splitter only recognizes `"\n"`,
leaving a trailing `"\r"` on every old-side line). The fix: the no-op branch
now returns the **literal original string**, so `proposed === status.
gitignoreContent` byte-for-byte, and `diffLines`'s own `oldText === newText`
fast path (`src/ui/diff.ts:143`) fires before either side is ever split — zero
hunks because nothing is proposed, not because `\r` got quietly stripped for
comparison purposes only. **Deliberate, correct choice on the flip side**: when
a real change *is* proposed against a CRLF-encoded existing file, the diff
still shows every old line changing, because `gitignore_write` genuinely
normalizes the whole file to LF on write — hiding that would make the diff
lie. A new `willNormalizeLineEndings` note (`GitWizard.tsx:442-447`) surfaces
that truth explicitly rather than leaving the user to guess why every line is
red/green. Verify **both** cases below — the no-change case must show
literally nothing, and the real-change case must show a truthful (not
alarming, not hidden) explanation.

84. Close the Git wizard. Overwrite `.gitignore` with CRLF line endings by
    hand:

    ```powershell
    $nl = "`r`n"
    [System.IO.File]::WriteAllText("C:\_wo11new\.gitignore", "node_modules$nl dist$nl", [System.Text.Encoding]::ASCII)
    ```

    (adjust so the content is a couple of simple lines with real `\r\n`
    between them — the exact lines don't matter, only the line-ending style).
85. Reopen **Git…**. Do **not** tick any preset, do **not** type any extra
    text.
    *Expected (fixed):* "No new lines to add." and the diff view shows **"no
    changes"** — no phantom delete/add lines, because the composed proposal is
    now the literal original string and the diff's fast path recognizes the
    two sides as identical before ever splitting into lines. The "I've
    reviewed this diff" checkbox stays disabled (nothing to review), **Write
    .gitignore** stays disabled. A single line of visible diff here is a
    regression — log it.
86. Now tick the **`Node`** preset (a real change).
    *Expected:* the diff view **does** show every existing line (`node_modules`,
    `dist`) as changed (CRLF→LF), plus the new preset lines as pure additions
    — and immediately below the diff, a note reading **"Existing line endings
    (CRLF) will be normalized to LF on write — some of the lines above differ
    only in that, not in content."** This note must appear only now (real
    change + CRLF existing), not in step 85's no-op case.
87. Tick **"I've reviewed this diff"**, **Write .gitignore**, then verify what
    actually landed matches what was shown:

    ```powershell
    Get-Content C:\_wo11new\.gitignore
    ```

    *Expected:* `node_modules`, `dist`, and the `Node` preset's lines, all LF,
    exactly one trailing newline — byte-for-byte what the diff proposed, not
    a different transformation.
88. **git missing from PATH.** Not practical to fully simulate without
    altering system PATH, but if you have a portable/sandboxed environment
    available: temporarily rename/hide `git.exe` from PATH, reopen the wizard.
    *Expected:* a dead-end panel explaining git was not found, install
    instructions, no retry loop, no crash. Restore PATH before continuing.

---

## K. Agent avatars — G6

89. Select an agent, click its **44px avatar** in the Inspector's Agent
    section.
    *Expected:* a menu opens: **Upload image…**, **Reset seed**, and (only if
    a custom avatar is already set) **Remove image**.
90. **Upload image…** → pick any small real PNG/JPEG file from your machine.
    *Expected:* the avatar updates in the Inspector **and** in the rail row
    for that agent, replacing the identicon.
91. **Oversized file.** Create a file that starts with valid PNG magic bytes
    but exceeds 512 KB:

    ```powershell
    $bytes = New-Object byte[] (600*1024)
    [System.IO.File]::WriteAllBytes("C:\_wo11new\big.png", $bytes)
    # patch in a real PNG header so the magic-byte check passes and only the size check trips
    $fs = [System.IO.File]::OpenWrite("C:\_wo11new\big.png")
    $fs.Write([byte[]](0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A), 0, 8)
    $fs.Close()
    ```

    Upload this file.
    *Expected:* rejected with an error containing "image too large (max 512
    KB)"; the previous avatar (from step 90) is unchanged.
92. **Wrong format, right extension.** Rename a plain text file to `.png`:

    ```powershell
    Set-Content C:\_wo11new\fake.png "not actually a png"
    ```

    Upload it (the dialog filter is by extension, so this will be pickable).
    *Expected:* rejected with "unsupported image format — PNG, JPEG, WebP or
    GIF" (magic-byte check, not extension).
93. **Very large / sparse file, timing — [CODE AUDIT] FIXED.** The original
    LOW finding here (`agent_avatar_set` reading the whole source file into
    memory *before* checking the 512 KB cap) is fixed: it now stats the file
    first (`fs::metadata`) and rejects on length before ever calling
    `fs::read` (`src-tauri/src/agents.rs:680-687`). A new Rust test
    (`avatar_set_rejects_oversize_image_via_stat_before_reading_bytes`) proves
    it with a **sparse 2 GB** source file (logical length 2 GB, only a few
    real bytes on disk) and asserts rejection completes in **under 5
    seconds**. If you want to reproduce live rather than trust the Rust test:

    ```powershell
    $fs = [System.IO.File]::Create("C:\_wo11new\huge.png")
    $fs.Write([byte[]](0x89,0x50,0x4E,0x47), 0, 4)
    $fs.Seek(2GB, [System.IO.SeekOrigin]::Begin) | Out-Null
    $fs.WriteByte(0)
    $fs.Close()
    ```

    Upload `huge.png`. *Expected:* the rejection ("image too large") appears
    within a second or two, no visible stall, no Task Manager memory spike for
    `cowtext.exe`.
94. **Reset seed.** Click the avatar → **Reset seed**.
    *Expected:* if there was no custom image, the identicon changes to a new
    random pattern (a fresh seed) instantly. If there **was** a custom image
    (from step 90), this option should still be present (per contract) but
    does not remove the custom image — the image continues to take visual
    priority.
95. **Remove image.** Click the avatar → **Remove image** (only present when a
    custom avatar exists).
    *Expected:* reverts to the identicon; the file under
    `.cowtext/avatars/<stem>.<ext>` is gone from disk.
96. **Replace format.** Upload a PNG, then upload a JPEG for the same agent.
    *Expected:* exactly **one** file remains in `.cowtext\avatars\` for that
    agent's stem — check:

    ```powershell
    Get-ChildItem C:\_wo11new\.cowtext\avatars
    ```

    Only the `.jpg`, the old `.png` is gone.
97. **Rename follows the avatar.** With a custom avatar set, rename the agent
    (any new name). *Expected:* the avatar file in
    `.cowtext\avatars\` moves to the new stem; the Inspector/rail still show
    the custom image immediately after the rename, no flash back to the
    identicon.
98. **Delete removes the avatar.** Delete that agent via the rail context
    menu. *Expected:* `.cowtext\avatars\<stem>.<ext>` is gone from disk (best
    effort — confirm it actually happened, not just that the delete overall
    succeeded).

---

## L. Orchestrator fleet detail — G5

99. Open the **Orchestrator** tab. Select any agent with sessions or without.
    *Expected:* a read-only detail column: avatar, model (short label, e.g.
    `Sonnet-5` not the raw id), tools, skills, memory status (healthy/needs
    attention — reusing the same `agent_memory_status` probe as section F),
    context estimate (`≈N tok`), and the two orchestration-only editable
    fields (**default cwd**, **default token ceiling**) — everything else is
    plainly not editable here (no border-focus affordance, just text).
100. Try to find any way to edit the model, tools, or skills from this panel.
     *Expected:* there is none — a caption reads roughly "Edited in the
     Hierarchy panel under Agents — one writer per field" with an **Edit in
     Inspector** button.
101. Click **Edit in Inspector**.
     *Expected:* the app selects that agent (switch to Canvas or wherever the
     Inspector is visible to confirm) so you can actually edit it there.
102. Change the agent's model in the **Inspector** (section F territory), then
     return to the Orchestrator tab.
     *Expected:* the fleet-view detail column reflects the new model
     immediately — one writer, two readers, never disagreeing.

---

## M. WO10 regression — 4 minutes

103. Reopen `C:\_wo11test` (the original bare project from section A) or any
     project with an existing graph. Compile to `claude`.
     *Expected:* diff preview appears, generated file carries the GENERATED
     header — WO11 did not touch Compile.
104. Draw a wire between two nodes, pick a kind, confirm the one-chip-per-wire
     label, port-finger count, and selected-wire-highlight-on-top all still
     behave as in WO10 (spot check only — full detail is WO10's own manual).
105. Ctrl+Z / Ctrl+Y a few edits, including a node delete.
     *Expected:* undo/redo still work.
106. Switch to the **Barn** view and back.
     *Expected:* renders, viewport preserved on return.
107. Open **Presets** → save one → check `"version": 4` still in the written
     preset file.
108. Right-click a memory-node card → context menu.
     *Expected:* "Remove from graph" and "Delete file" (if still present for
     memory nodes — not agents, per D5) remain distinct, both still work.

---

## Cleanup

109. Close the app and delete the scratch projects:

     ```powershell
     Remove-Item -Recurse -Force C:\_wo11test, C:\_wo11new
     ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B The three unresolved crashes (B2/C1/F1) | | |
| C Project wizard — A1–A4 | | |
| D Hierarchy & shell — B1, E1, G1, G4 | | |
| E Inspector — C2, D5, G3, selection sync | | |
| F Agent properties — C3, D2, D3 | | |
| G.1–G.5 Autosave basics + race fix (deterministic) | | |
| G.6 `AGENT_FS` mutex — resurrection invariant | | |
| G.7 `write_md_file`/Markdown-tab bypass — OPEN DEFECT | | |
| H Agent delete orphan seam + Windows path case | | |
| I Standing-rule path sweep (review.ts, tokens.ts) — FIXED | | |
| J Git wizard — G2 (incl. J.1 CRLF fix, both cases) | | |
| K Agent avatars — G6 (incl. oversize stat-first fix) | | |
| L Orchestrator fleet detail — G5 | | |
| M WO10 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
