# Input Prompt Sweep Manual Test Script — WO12 (8 defects + 8 feature requests)

Hand-run test manual for the WO12 fix/feature sweep out of `docs/INPUT_PROMPT.md`: the 8 named
defects (D1–D8) found in the prior acceptance walk, plus the 8 feature requests (F1–F8) built
alongside them. Run it top to bottom in one sitting — later sections reuse the project, agent,
task and node state built in earlier ones. Written against the code as of 2026-08-20
(`src/git/GitWizard.tsx`, `src/project/ProjectWizard.tsx`, `src/wizard/NodeWizard.tsx`,
`src/wizard/roles.ts`, `src/wizard/preset.ts`, `src/tasks/NewAgentDialog.tsx`,
`src/agents/AgentEditor.tsx`, `src/inspector/Inspector.tsx`, `src/assemble/AssembleConfirmModal.tsx`,
`src/canvas/GraphCanvas.tsx`, `src/canvas/MemoryNodeCard.tsx`, `src/rail/Hierarchy.tsx`,
`src/agents/RailSections.tsx`, `src/store/tokens.ts`, `src/ui/ToastHost.tsx`, `src/store/toasts.ts`,
`src/sessions/AgentQuestionModal.tsx`, `src/sessions/AddAgentDialog.tsx`, `src/sessions/RosterBar.tsx`,
`src/preset/starter.ts`, `src/preset/PresetsModal.tsx`, `src/tasks/NewTaskDialog.tsx`,
`src/tasks/TasksBoard.tsx`, `src/tasks/taskFormatSkill.ts`, `src-tauri/src/git.rs`,
`src-tauri/src/worktree.rs`, `src-tauri/src/assemble.rs`, `src-tauri/src/sessions.rs`,
`src-tauri/src/bin/cowtext_mcp.rs`, `.mcp.json`). Every step names the real control and the exact
expected result — if reality differs, that is a bug (or this manual is stale; either way, note it).

**Time budget:** ~70 min full pass, plus the 5-minute regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev` fails instead of
   picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on the title screen
   with three doors: **Open folder**, **New project**, **Convert existing**.
3. **Make an empty throwaway folder** (do NOT use a real project — this sweep writes files, runs
   `git init`, and spawns real Claude Code sessions):

   ```powershell
   mkdir C:\_cowsweep
   ```

4. Leave the app on the title screen — section B creates the project through the wizard itself
   (that is D2/F4's own subject).

---

## B. D1 — Git wizard: checkbox click target + branch choice at init

5. Press **New project** on the title screen. Press **Choose folder…**, pick `C:\_cowsweep`.
   *Expected:* step advances to "Project" (step 2 of 3), path shown under the button.
6. Type Name `Sweep test`. Leave everything else default. Press **Next**, then on the "Create"
   step leave **Install Claude Code hooks** OFF for now (F4 covers this toggle in section M).
   Press **Create**. *Expected:* wizard closes, workspace loads, empty canvas, file rail shows the
   new `context/project.md`.
7. In the top bar press the **Git** button (branch icon, tooltip "Git — initialize a repository or
   edit .gitignore"). *Expected:* a **Git** dialog opens: "This project is not a git repository
   yet.", the project path in mono, a **default branch** row with a three-way segmented control
   **main / master / custom** (main selected by default), and a **Initialize a git repository
   here** button.
8. Press the **custom** segment. *Expected:* a text input appears next to the segments,
   placeholder `branch-name`, and the Initialize button becomes **disabled** (empty name is
   invalid). Type `-bad`. *Expected:* still disabled, and a helper line appears below the control:
   *"Branch name can't be empty, contain whitespace or any of `~^:?*[\`, start with `-`, contain
   `..`, or end with `.lock`."*
9. Clear the field and type `feature/sweep`. *Expected:* helper line disappears, Initialize
   re-enables.
10. Press **master** instead. Press **Initialize a git repository here**.
    *Expected:* button briefly reads `· · ·`, then the panel switches to the repo view: a green
    **repo** badge, `master` in mono next to it, and the `.gitignore` composer below.
11. **D1a checkbox click target.** In the **.gitignore presets** row, click directly on the small
    15×15 px checkbox glyph inside one of the preset chips (e.g. "Node"), NOT the text label next
    to it. *Expected:* the chip toggles to the selected (blue) state on that single click — the
    checkbox glyph is not a dead/nested hit target. Click the checkbox glyph again to untoggle it,
    confirming both directions work.
12. Re-select the "Node" preset (click anywhere on the chip this time — the whole chip is one
    button). *Expected:* the diff view below fills in with added `node_modules/` etc. lines, and
    the footer note reads "Nothing is written until you review and approve."
13. Click the **"I've reviewed this diff"** checkbox (its own standalone checkbox, left of the
    label). *Expected:* it turns solid blue with a check glyph, and **Write .gitignore** becomes
    enabled.
14. Press **Write .gitignore**. *Expected:* body switches to ".gitignore written." Press **Close**.
15. Verify the branch really landed (D1b — the Rust write, not just the UI):

    ```powershell
    git -C C:\_cowsweep symbolic-ref --short HEAD
    ```

    *Expected:* prints `master` — the branch chosen in step 10 is what `git init` actually used.

---

## C. D2 — Project properties: Requirements field must not render empty

16. In the top bar press the **Project properties** button (gem icon).
    *Expected:* "Project properties" dialog opens directly on the Project fields (no Folder step
    in edit mode) with **Name** `Sweep test`.
17. In **Requirements**, type two lines:

    ```
    Compile context to CLAUDE.md
    Run offline
    ```

    Expand **Optional (4)** and type one line into **Hard rules**: `Never commit without asking`.
    Press **Save**. *Expected:* dialog closes without error.
18. Verify the sidecar actually holds it:

    ```powershell
    Get-Content C:\_cowsweep\.cowtext\project.json
    ```

    *Expected:* JSON contains `"requirements": ["Compile context to CLAUDE.md", "Run offline"]` and
    the hard rule.
19. **The regression check.** Press **Project properties** again (re-opening the dialog is exactly
    the repro: fields load asynchronously after the dialog has already mounted).
    *Expected:* **Requirements** is NOT empty — it shows both lines typed in step 17, immediately
    (no need to click into the field or wait). **Hard rules** (inside Optional, which auto-expands
    because it holds a value) likewise shows the rule text, not a blank textarea. Close the dialog
    with **Cancel**.
20. Select the pinned `Sweep test` project node on the canvas (or in the Hierarchy file tree),
    open the Inspector's **Markdown** tab. *Expected:* `context/project.md` contains a
    `## Requirements` section listing the same two lines — the same data is visible in three
    places (sidecar JSON, wizard field, compiled markdown) and none of them disagree.

---

## D. D3 — New node wizard: no Agent role, and no infinite-update crash

21. Double-click empty canvas space. *Expected:* the **New node** wizard opens on step 1
    ("Identity"), step dots **1 Identity · 2 Target · 3 Brief · 4 Assemble** across the header.
22. Look at the **Role** picker. *Expected:* exactly three group headers — **Constraints**,
    **Process**, **Knowledge** — 12 role tiles total. There is **no "Identity" group and no
    "agent" tile anywhere in the grid.** Below the picker, a pointer line reads: *"Agents are
    created in the Agents rail."*
23. Type Name `Glossary test`, pick the **glossary** role tile (under Knowledge).
    Press **Next** twice (Target: leave directory/pinned defaults, Next), reaching step 3 (Brief).
    Type brief text `A quick manual test entry.`. Press **Next** to reach step 4 (Assemble).
24. Flip **Run Assemble after create** ON (amber toggle).
25. **D3b crash repro — exact click path:** press **Create node**.
    *Expected, precisely:*
    - The wizard closes immediately (it never waits on Assemble).
    - The new "Glossary test" node appears on the canvas, selected.
    - An **Assemble** confirmation dialog opens on top (header "Assemble", prompt textarea, a
      pixel-march "the cow is thinking" briefly, then the composed prompt).
    - **NO error boundary screen appears.** Specifically: the app must NOT show the red-dot panel
      titled **"Cowtext hit an error"** with a "Maximum update depth exceeded" stack trace naming
      `StoreUpdater` / `CanvasInner` / `Workspace` / `App`. If that panel appears at any point
      during or after this step, this is a REGRESSION of D3b — record it as failed with a screenshot
      of the stack trace shown.
    - Click around the canvas (pan, click empty space, click the new node, click another node)
      for about 10 seconds immediately after this step. *Expected:* canvas stays fully
      interactive, no flash-to-error-boundary, no console spam of repeated re-renders (check the
      `tauri dev` terminal for a flood of identical log lines).
26. In the Assemble confirmation dialog, press **Cancel** (do not spend a real `claude -p` call
    here — F7 covers the confirmation dialog itself in section P).
27. **D3a import-bypass regression check.** This confirms the exclusion also holds for the Import
    door, not just the picker. Create a hand-edited node-preset file that asks for the blocked
    role:

    ```powershell
    Set-Content C:\_cowsweep\bad-agent.node.cowtext-preset.json @'
    {
      "version": 1,
      "kind": "cowtext-preset",
      "name": "Sneaky agent",
      "savedAt": "2026-08-20T00:00:00.000Z",
      "nodes": [
        {
          "id": "wizard-node",
          "title": "Sneaky agent",
          "role": "agent",
          "brief": "",
          "filePath": "context/sneaky-agent.md",
          "readOrder": 1,
          "pinned": false,
          "position": { "x": 0, "y": 0 },
          "content": "# Sneaky agent\n"
        }
      ],
      "edges": [],
      "compileTargets": ["claude"]
    }
    '@
    ```

28. Double-click empty canvas again to reopen **New node**. Press the **Import preset…** button
    (download-into-tray icon, top right of the header). Pick `bad-agent.node.cowtext-preset.json`.
    *Expected:* the wizard jumps to step 1 with Name `Sneaky agent`, and an amber notice appears:
    *"This preset asked for the "agent" role, which the New node wizard cannot create — it was
    changed to "reference". Agents are created in the Agents rail."* The Role picker shows
    **reference** selected, not agent.
29. Press **Create node**. *Expected:* the node is created with role **reference** (check its
    canvas card — the small role glyph/colour is reference's, not agent's). Verify on disk:

    ```powershell
    Get-Content C:\_cowsweep\context\sneaky-agent.md
    ```

    There is no way, through either door of this wizard, to end up with a `context/*.md` file
    tagged role `agent`.

---

## E. D4 — New agent wizard: self-explanatory priority, avatar in-wizard, Duties header

30. In the left Hierarchy rail, find the **AGENTS (0)** section header. Press its **+** button
    ("New agent"). *Expected:* **New agent** dialog opens.
31. **D4b — avatar control.** At the top-left of the dialog, click the 44×44 px avatar square
    (an identicon). *Expected:* a context menu opens with **Upload image…**, **Reset seed**
    (no **Remove image** yet — nothing uploaded). Click **Reset seed**. *Expected:* the identicon
    pattern changes to a different one immediately (proves generation works in-wizard, no need to
    save first). Click the avatar again, choose **Upload image…**, pick any small PNG/JPG from
    your machine. *Expected:* the identicon preview does NOT change yet (uploads are deferred
    until Create — the caption under the avatar switches to the file's path in mono), but no error
    appears.
32. **D4a — self-explanatory priority.** Scroll to the **Priority (1 = highest)** field.
    *Expected:* the label itself states the direction (no more bare "Priority" with an
    unexplained default of 3), and directly under the stepper a muted helper line reads: *"Your
    own ranking. Cowtext shows it on the fleet rail and the agent's canvas plate; it does not
    affect dispatch order or compiled context."* Set it to `1` using the stepper's up/down control.
33. Type Name `Sweeper`, Description `Manual-test agent for the WO12 sweep.`. In **Duties**, type:

    ```
    Verify the WO12 fix sweep by hand.
    ```

34. Press **Create**. *Expected:* dialog closes, `Sweeper` appears in the AGENTS section, avatar
    shows the uploaded image (not the identicon) once the row repaints.
35. **D4c — Duties header written to disk.** Verify the file:

    ```powershell
    Get-Content C:\_cowsweep\.claude\agents\sweeper.md
    ```

    *Expected content includes, byte-exact:*
    ```
    # Sweeper

    ## Duties

    Verify the WO12 fix sweep by hand.

    ## Boundaries
    ```
    The `## Duties` header line must be present — not just the raw duties text with no heading.

---

## F. D5 — Inspector Assemble must consider ALL agent fields, not just title/description

36. Select **Sweeper** in the AGENTS rail (single click). *Expected:* the Inspector shows the
    agent editor: identity header, Model, **Priority (1 = highest)** (reads `1`), Influence,
    Tools, Skills, and the **Duties & boundaries** body editor.
37. Change **Model** to a different option, drag **Influence** to roughly `80%`, and tick at least
    one entry under **Tools**. Wait a moment for the autosave dot to clear.
38. Scroll to the **Assemble** section (bottom of the agent editor) and press **Assemble**.
    *Expected:* the F7 confirmation dialog opens (see section P for its full spec) with header
    "Assemble" and a prompt preview textarea. Read the prompt text carefully.
    *Expected content, in order after the `Node:` line:* a blank line, then an **`Agent:`** block
    with bullet lines for at least `- Name: Sweeper`, `- Model: <the model you set>`,
    `- Priority: 1`, `- Influence: 80`, `- Tools: <the tool(s) you ticked>`, and
    `- Duties:` followed by the duties text from step 33. This is the fix under test: the prompt
    must carry model/priority/influence/tools/duties, not just the node's title and brief.
39. Press **Cancel** (do not spend the call).

---

## G. D6 — Hierarchy: adopt-to-graph and click-to-select must never crash

40. Right-click **Sweeper** in the AGENTS rail. *Expected:* a context menu with **Select node on
    canvas** (Sweeper is already adopted from creation — WO12's Agent Wizard adopts on create) — if
    instead you see **Adopt to graph**, click it now.
41. **D6 crash repro #1 — exact click path:** click directly on the **Sweeper** row (single
    left-click on the row body, not the context menu). *Expected:* the row highlights, the
    Inspector shows Sweeper's agent editor, and — if the card was off-screen — the canvas pans/
    zooms to bring it into view. **NO error boundary screen appears** ("Cowtext hit an error" /
    "Maximum update depth exceeded" / `StoreUpdater`). Click the row 5 more times in a row rapidly.
    *Expected:* still no crash, canvas stays responsive each time.
42. **Restart the app** (close the window, `npm run tauri dev` again), reopen `C:\_cowsweep` via
    **Open folder**. *Expected:* Sweeper's node is on the canvas at its saved position (adoption
    persisted across restart).
43. **D6 crash repro #2 — exact click path (the sharper repro, per the original defect report):**
    in the freshly-reloaded session, click **Sweeper** in the AGENTS rail once.
    *Expected:* same as step 41 — selection succeeds, Inspector opens the agent editor, **no error
    boundary appears**. This is the specific sequence the original defect named ("after restart
    the agent node IS on the graph, but clicking it in the Hierarchy throws").

---

## H. D7 — Agent node token counts must not silently disagree

44. On the canvas, look at the **Sweeper** node card's footer row. *Expected:* a small tag reading
    `N tok file` (mono, muted), where hovering it shows the tooltip **"file size / 4 — estimate"**.
    Note the number.
45. Select Sweeper (Inspector agent editor open). Look at the top-right of the identity header.
    *Expected:* a line reading `≈N tok context` with tooltip **"estimate, chars/4 · window
    ~200k"**. Note this number too.
    *Expected relationship:* the Inspector's `tok context` number is **greater than or equal to**
    the card's `tok file` number (context includes the agent file itself plus its 1-hop
    imports/references) — and, crucially, **the two labels read differently** (`tok file` vs
    `tok context`), so even if the numbers happened to match nobody could mistake one for the
    other. They must never both say bare `tok` with no qualifier.

---

## I. D8 — Run must not misreport a fresh git-init'd repo as "not a git repository"

46. `C:\_cowsweep` is a repo from section B (git init, no commits made yet — the .gitignore write
    in step 14 IS a working-tree change but was never committed). Confirm no commit exists yet:

    ```powershell
    git -C C:\_cowsweep log --oneline
    ```

    *Expected:* error `fatal: your current branch 'master' does not have any commits yet` — this
    unborn-HEAD state is exactly D8's repro condition.
47. In the top bar press **Run** (blue, play icon). *Expected:* **Run session** dialog opens,
    **Folder** pre-filled with `C:\_cowsweep`, and after a brief "checking…" label:
    *Expected result:* a line reading **"repo main working copy — a separate worktree is
    recommended"** with a **Create worktree…** button. It must NOT read **"not a git repository"**
    — that red-text line is D8's exact defect, and it must not appear for a repo Cowtext itself
    just initialized.
48. Pick **Sweeper** from the **Agent file** dropdown. Leave Name as prefilled. *Expected:* the
    **Run** button in the footer is **enabled** (not greyed out) — the git-repo misdetection used
    to keep it disabled here.
49. Press **Run**. *Expected:* dialog closes, a new roster card for `Sweeper` appears in the strip
    above the status bar (avatar + name + status dot), status "waiting" or "working" — a real
    Claude Code session actually launched. (If `claude` is not on PATH in this environment, the
    card will instead show an error status — that failure is a missing-binary issue, not the D8
    git-repository misdetection this section is testing; the important assertion already passed
    in step 47/48.)

---

## J. F1 — Toast notifications

50. In the top bar, press **Handoff** (send icon; enabled once the graph has ≥1 node, which it
    does). *Expected:* Handoff dialog opens.
51. Press **Generate handoff**. Wait for it to finish (pixel march, then a preview of
    `HANDOFF.md — new file`).
52. Press **Write HANDOFF.md**. *Expected, in the bottom-right corner of the window:* a toast card
    slides/fades in — 340px wide, a thin blue bar down its left edge, title **"Wrote HANDOFF.md"**,
    an **X** dismiss button. It disappears on its own after a few seconds (info toasts are not
    sticky). Close the Handoff dialog.
53. **Danger toast + sticky behaviour.** In the Hierarchy AGENTS section, right-click **Sweeper**,
    choose **Reveal in File Explorer**. If your environment has a working file explorer this will
    just succeed silently — instead, force a failure to see the toast: rename the folder out from
    under Cowtext momentarily is disruptive, so instead trigger it via a known-bad reveal: right-
    click any file in the plain file tree whose relative path you then delete from disk first:

    ```powershell
    Remove-Item C:\_cowsweep\context\sneaky-agent.md
    ```

    Right-click the now-missing `sneaky-agent` row in the Hierarchy file tree (if still listed) and
    choose **Reveal in File Explorer**. *Expected:* a **danger**-coloured toast (red left bar)
    appears bottom-right with a mono detail line describing the failure, and it does **not**
    auto-dismiss (hover over it — even after 10+ seconds it stays until you click its **X**).
54. Press the toast's **X**. *Expected:* it disappears immediately; if any other toasts remain
    stacked beneath it, they slide down to fill the gap.

---

## K. F2 — Agent questions surfaced as a popup dialog

55. In the roster strip, find **Sweeper**'s card (from section I) — if it isn't alive anymore,
    press **Run** again with Sweeper and Folder `C:\_cowsweep`, and wait for its status dot to
    settle (not "working").
56. Click Sweeper's roster card to select it, open the session panel (Orchestrator/session view),
    and send it a message that should provoke the boot-prompt's own built-in question convention,
    e.g.:

    ```
    Before you do anything else, you need a decision from me — ask me to choose between
    two options, using the exact COWTEXT_ASK: <question> format you were told about at boot.
    ```

    *Expected:* shortly after Sweeper replies, a modal pops up over the whole app: header
    **"Sweeper is asking"**, the agent's question text in a bordered well, a **Your answer**
    textarea (focus already inside it), footer text **"Ctrl+Enter to send · Esc to dismiss"**, and
    **Dismiss** / **Send** buttons.
57. Press **Esc**. *Expected:* the modal closes immediately WITHOUT sending anything (check the
    session transcript — no new turn was sent). Re-provoke the same question if needed to continue.
58. This time, type an answer in the textarea and press **Ctrl+Enter**. *Expected:* button area
    briefly shows `· · ·`, the modal closes, and the session transcript shows your answer went in
    as the next turn (agent resumes).

---

## L. F3 — No "Spawn" button anywhere; a single "Run" button

59. Grep-by-eye across the whole app for this section: the **Roster** strip at the bottom has NO
    button of its own — only session cards with a dismiss **X** once a session ends. There is no
    "Spawn agent" button anywhere on it.
60. Open the **Orchestrator** view (the view-toggle in the top bar). Select any task or agent
    detail panel. *Expected:* wherever an agent could be launched from here, the button (if any)
    says **Run**-flavoured prose, never "Spawn". There is no "Spawn" button in this view.
61. The **only** way to launch a session anywhere in the app is the single accent-blue **Run**
    button in the top bar (Play icon, next to Compile). Confirm its disabled state: with 4 agent
    sessions alive at once (spawn a few dummy ones if needed, or just note the cap), *Expected:*
    the Run button greys out and its tooltip reads **"agent limit reached (4)"**.

---

## M. F4 — Install hooks inside the New/Convert Project wizard

62. From the title screen (Home button, top-left house icon, then confirm closing if prompted),
    start **New project** again on a second empty folder:

    ```powershell
    mkdir C:\_cowsweep2
    ```

    Choose folder `C:\_cowsweep2`, Name `Sweep hooks test`, press **Next**.
63. On the **Create** step, *expected:* an amber-bordered row titled **"Install Claude Code
    hooks"** with explanatory copy (mentions `.claude/settings.json` and `127.0.0.1:4923`) and a
    34×19 pill toggle, OFF by default.
64. Flip the toggle ON. Press **Create**. *Expected:* instead of the wizard closing straight to the
    workspace, a **trust-boundary diff dialog** opens on top (title bar shows the target path
    `.../.claude/settings.json`) showing the exact JSON diff that will be written. Escape/backdrop
    click on the now-underlying Project wizard must do nothing while this diff dialog is open (it
    owns focus).
65. Press **Approve & install**. *Expected:* dialog closes, workspace loads. Verify on disk:

    ```powershell
    Test-Path C:\_cowsweep2\.claude\settings.json
    ```

    *Expected:* `True`.
66. **Second entry point — edit mode.** Press **Project properties** (gem icon). *Expected:* a
    live status row above the Name field reads **"Claude Code hooks installed"** with a plug icon
    (no button next to it — nothing left to install). Close the dialog.

---

## N. F5 — Pre-defined starter nodes (Task Board / Backlog / Changelog)

67. Start a third empty project so the starter pack applies cleanly to a zero-node graph:

    ```powershell
    mkdir C:\_cowsweep3
    ```

    **New project** → choose `C:\_cowsweep3` → Name `Sweep starter test` → Next → Create (hooks
    toggle OFF this time). Wait for the empty workspace.
68. Press **Presets** in the top bar. *Expected:* a **Presets** dialog opens; the very first row,
    pinned above any saved presets, reads **"Starter pack"** with a **Built-in** badge and a
    **3 nodes** badge, and an **Apply** button.
69. Press **Apply** on that row. *Expected:* confirmation step, then three nodes land on the
    canvas: **Task Board** (`docs/tasks/TASKS.md`, role `task`), **Backlog**
    (`docs/tasks/BACKLOG.md`, role `reference`), **Changelog** (`docs/CHANGELOG.md`, role
    `reference`) — laid out left to right, no edges between them.
70. Verify the Task Board file is immediately usable by the Tasks board (not just a Memory Node):

    ```powershell
    Get-Content C:\_cowsweep3\docs\tasks\TASKS.md
    ```

    *Expected:* contains a `| Name | Status | Priority | Tags | Agent | Description |` header row
    with a separator line and zero data rows. Switch to the **Tasks** view in the app.
    *Expected:* the board loads with zero cards and no parse error (the seeded header is valid).

---

## O. F6 — Default task-format skill (strict 6-column grid)

71. In the Hierarchy rail, find **SKILLS (0)**, press its **+** ("New skill"). *Expected:* **New
    skill** dialog opens.
72. Press **Use the built-in task-format skill**. *Expected:* the Name/Description/Body fields
    fill in immediately: Name `task-format`, Description mentions "strict six-column Cowtext task
    grid", Body contains a fenced example row with header
    `| Name | Task Type | Priority | Tags | Status | Description |` — **exactly these six columns,
    nothing else** (no Agent column, no Created column).
73. Press **Save**. *Expected:* dialog closes, `task-format` appears under SKILLS. Verify on disk:

    ```powershell
    Get-Content C:\_cowsweep3\.claude\skills\task-format\SKILL.md | Select-String "Name.*Task Type.*Priority.*Tags.*Status.*Description"
    ```

    *Expected:* a match — the six-column header line is present verbatim.
74. **Task Type must persist, not just display.** Switch to the **Tasks** view, press **+ New
    task** (or the board's own add control). Fill Name `Sweep task`, and in the **Task Type**
    field type `chore` (a datalist offers bug/feature/chore/spike/docs as suggestions). Press
    **Create**. *Expected:* the new card on the board shows a muted `chore` chip next to its
    priority badge.
75. Select that card, open the Inspector's task panel. *Expected:* a **Task Type** field shows
    `chore` (editable, since this task lives in a table-backed file). Change **Status** to
    `in production` using the segmented control and press **Save**.
76. *Expected regression check:* the card's `chore` chip is STILL there after the save — changing
    Status via the Inspector must not silently clear Task Type. Now drag the card to a different
    status column directly on the board (or use its card-menu "Move to…"). *Expected:* the `chore`
    chip survives that move too — dragging/moving on the board must not clear Task Type either.

---

## P. F7 — Assemble always shows a confirmation dialog with the real prompt first

77. Select the **Changelog** node created in section N. In the Inspector's **Assemble** section,
    type an instruction into the **Refine** field: `Add one placeholder entry.` and press **Refine**
    (or press Enter in the field — both routes go through the same gate).
78. *Expected, immediately, before anything is spent:* a modal opens — header **"Refine"**, a
    `→ docs/CHANGELOG.md` path chip top-right, and body text `will create docs/CHANGELOG.md` (or
    `will overwrite N existing lines` if the file already has content) followed by a `neighbors:`
    line if any, followed by the **full literal prompt** in a scrollable monospace block — this is
    the exact text that would be sent to `claude -p`, not a summary of it.
79. *Expected inertness:* initial keyboard focus is on **Cancel**, not on the accent **Refine**
    button — pressing Enter right after the dialog opens must NOT approve it (only Ctrl+Enter/click
    approves; test by pressing Enter once and confirming the dialog is still open).
80. Press **Cancel**. *Expected:* dialog closes, footer note "preview failed — nothing was spent"
    never appeared, and no `claude -p` call was made (no roster/queue status ever showed for this
    node). Repeat steps 77–78 once more, this time press the accent **Refine** button.
    *Expected:* button reads `· · ·` briefly, dialog closes, the Changelog node's Assemble status
    badge shows **queued** then **assembling**.
81. Wait for it to resolve (or press the small **X** next to a "queued" badge to cancel it if you
    do not want to spend a real call). Confirm this same gate fires from the canvas context menu
    too: right-click the **Backlog** node → **Assemble**. *Expected:* the same confirmation dialog
    pattern (header "Assemble" this time) appears before anything is spent. Press **Cancel**.

---

## Q. F8 — MCP server exposes Cowtext's graph/compile/assemble/task operations

82. Build the MCP binary (debug is enough to prove the contract; `.mcp.json` at the repo root
    points at a release build for real Claude Code use — building that is a separate one-time step
    documented in `docs/design/MCP_SERVER.md`):

    ```powershell
    cd D:\Moo.exe\Cowtext\src-tauri
    cargo build --bin cowtext-mcp
    ```

    *Expected:* builds cleanly, `target\debug\cowtext-mcp.exe` exists.
83. Confirm the tool contract with the crate's own tests:

    ```powershell
    cargo test --bin cowtext-mcp
    ```

    *Expected:* all tests pass, including one named
    `tool_manifest_has_exactly_14_tools_with_valid_schemas`.
84. Smoke-test it live over stdio against the sweep project:

    ```powershell
    $req1 = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
    $req2 = '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
    ($req1, $req2) | & .\target\debug\cowtext-mcp.exe --root C:\_cowsweep3
    ```

    *Expected:* two JSON-RPC response lines print, no crash. The second response's
    `result.tools` array has **14** entries, with names including `cowtext_scan`,
    `cowtext_graph_read`, `cowtext_compile_preview`, `cowtext_task_append`,
    `cowtext_agents_scan` (all prefixed `cowtext_`, matching `.mcp.json`'s registered server name
    `cowtext`).
85. Verify `.mcp.json` itself is present and correctly shaped at the repo root:

    ```powershell
    Get-Content D:\Moo.exe\Cowtext\.mcp.json
    ```

    *Expected:* `"type": "stdio"`, `"command"` pointing at
    `src-tauri\target\release\cowtext-mcp.exe`. (If you want to actually connect a live Claude Code
    session to it, build the release binary first — `cargo build --release --bin cowtext-mcp` — then
    run `claude mcp list` / `/mcp` inside a Claude Code session started in this repo and confirm
    `cowtext` shows as connected with 14 tools; this is optional and outside the scope of what a
    solo tester can assert without a second Claude Code instance.)

---

## R. Regression — 5 minutes, the pre-sweep core loop must still hold

86. **Compile still works.** With `C:\_cowsweep3` open (3+ nodes from section N), press
    **Compile**. *Expected:* preview loads, `CLAUDE.md` row shows **new file**, footer reads
    "N of N files will be written". Press **Approve & write**, then **Close**. Verify
    `CLAUDE.md` exists and starts with the GENERATED header line.
87. **Drag/connect still work.** Drag the Task Board node to a new spot — smooth, no console
    errors. Draw one edge Task Board → Backlog, pick **references** — dashed edge appears,
    selectable, Delete edge works from the Inspector.
88. **Restart-restore.** Close the window, `npm run tauri dev`, **Open folder** →
    `C:\_cowsweep3`. *Expected:* all nodes at their saved positions, the new edge intact, the
    Sweeper agent (if adopted into this project) still shows correctly, no stray error boundary on
    load.
89. **Undo/Redo still works.** Move a node, press the Undo button in the top bar. *Expected:* node
    snaps back to its prior position; Redo restores the move.

---

## Cleanup

90. Close the app and delete every scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowsweep, C:\_cowsweep2, C:\_cowsweep3
    ```

---

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B D1 — Git checkbox + branch choice | | |
| C D2 — Project properties Requirements | | |
| D D3 — New node wizard (role gate + crash) | | |
| E D4 — New agent wizard (priority/avatar/Duties) | | |
| F D5 — Inspector Assemble full fields | | |
| G D6 — Hierarchy adopt/select crash | | |
| H D7 — Token count labelling | | |
| I D8 — Run vs. fresh git repo | | |
| J F1 — Toast notifications | | |
| K F2 — Agent question popup | | |
| L F3 — Single Run button, no Spawn | | |
| M F4 — Install hooks in wizard | | |
| N F5 — Starter nodes | | |
| O F6 — Task-format skill + persistence | | |
| P F7 — Assemble confirmation gate | | |
| Q F8 — MCP server | | |
| R Regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
