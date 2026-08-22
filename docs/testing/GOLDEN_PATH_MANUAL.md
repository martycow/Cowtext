# Golden Path Manual Test Script — WO15 release walk (Title → Node → Edge → Compile → Task → Agent → Run → Hooks → Barn → Switch)

Hand-run, risk-based golden path for the v0.1.0 release gate: 38 scenarios covering the 16
Stage-5 points of `docs/INPUT_PROMPT.md` and the 12 P0 acceptance criteria. It is deliberately
NOT a mechanical click-through — each scenario names the one risk it exists to catch. Run it
top to bottom in one sitting; sections D–J reuse the `alpha` project section D creates, and
section C builds the blank-folder path first because P0 criterion 1 ("Title → Node → Edge →
Compile preview without instruction") is the thing a new user hits before anything else.
Written against the code as of 2026-08-22 (`src/project/TitleScreen.tsx`,
`src/project/ProjectWizard.tsx`, `src/canvas/EmptyCanvasGuide.tsx`, `src/inspector/Inspector.tsx`,
`src/compile/CompileModal.tsx`, `src/agents/RailSections.tsx`, `src/tasks/NewAgentDialog.tsx`,
`src/agents/ModelPicker.tsx`, `src/sessions/AddAgentDialog.tsx`, `src/scene/BarnScene.tsx`,
`src/settings/SettingsModal.tsx`, `src-tauri/src/git.rs`, `src-tauri/src/agents.rs`). Every step
names the real control and the exact expected result — if reality differs, that is a bug (or this
manual is stale; either way, note it).

**Time budget:** ~55 min full pass (≈ 40 min without a `claude` install), plus the 3-minute
regression at the end. Scenarios marked *(needs `claude`)* are skipped, not failed, when
`claude --version` does not work on this machine.

**Watch-the-folder rule (P0 criterion 10):** every scenario that can write into the disposable
project says *Snap before / Snap after*. `Snap` is defined in section A; the two listings must
differ only by the files the step names. Any other new file is a finding.

---

## A. Preconditions

### S1. Machine state

1. **Free port 1420** (`strictPort` — `tauri dev` fails rather than moving). Confirm `git` is on
   PATH and has an identity — run in PowerShell:

   ```powershell
   git --version; git config --global user.name; git config --global user.email
   claude --version   # optional — governs the "(needs claude)" scenarios
   ```

   *Expected:* a git version line and two non-empty identity lines. If either identity line is
   empty, set them now (`git config --global user.name "Tester"` / `user.email "t@example.com"`);
   scenario S34 removes and restores them on purpose later.
2. **Make the disposable projects** (never a real project — this walk writes, commits and deletes):

   ```powershell
   $GP = Join-Path $env:TEMP "cowtext-gp"
   Remove-Item -Recurse -Force $GP -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force "$GP\delta", "$GP\alpha", "$GP\gamma", "$GP\beta" | Out-Null
   Set-Content "$GP\beta\CLAUDE.md" "# Beta`n`n## Rules`n`n- Never commit without asking.`n`n## Architecture`n`nA Tauri 2 app with a React front end."
   git -C "$GP\gamma" init -q
   function Snap($p) { Get-ChildItem -Recurse -Force $p | Where-Object { -not $_.PSIsContainer } | ForEach-Object { $_.FullName.Substring($p.Length) } | Sort-Object }
   Snap "$GP\delta"; Snap "$GP\alpha"
   ```

   *Expected:* `delta` and `alpha` list nothing; `beta` holds exactly `\CLAUDE.md`; `gamma` is an
   empty git repo (`git -C "$GP\gamma" log` prints `fatal: your current branch 'master' does not
   have any commits yet` or similar — no commits).

### S2. Launch

3. From the repo root run:

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite on :1420, cargo builds, the Cowtext window opens on the **title screen**.
   No project is open. Nothing is created under `$GP` by launching (`Snap "$GP\alpha"` still empty).

---

## B. Title screen

### S3. Auto-scan reaches `done` with no click (Block 5a)

4. Watch the **AI toolchain** strip (first-run composition, centred) or the **AI toolchain**
   panel (two-column composition, bottom-right — shown when Recent projects exist).
   *Expected:* within ~3 s of the window appearing, and without pressing anything, the 4-step
   amber **pixel march** (never a spinner) stops and every row settles to either
   `✓ <version>` (e.g. `✓ 2.1.37`, or `✓ installed` when the CLI gives no version) or
   `✗ not found`. The strip header reads **`N of 5 on this machine:`** (panel: **`N of 5 found`**).
   The button reads **Rescan** — not `Check installs`. Five rows, always, in this order:
   Claude Code · Codex CLI · Cursor · GitHub Copilot · Gemini CLI.
5. Press **Rescan**. *Expected:* label flips to **Scanning…** and is disabled while the march
   runs; the previous ✓/✗ answers stay on screen (rows are never blanked); it settles again.
   Press it twice quickly — only one scan runs (no double march, no double Activity row later).

### S4. The sentence and the doors (Stage 1 + Stage 4)

6. Read the tagline under the cow/wordmark. *Expected, byte-exact:*
   **Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.**
7. Read the three doors. *Expected:* **Open folder** (primary, filled) ·
   **New project** carrying a small blue **Recommended** chip, hint
   `Creates .cowtext/, context/ and starter nodes — recommended for a fresh start` (two-column
   composition: `Creates .cowtext/, context/ and starter nodes`) ·
   **Convert existing**, hint `Turns the CLAUDE.md, AGENTS.md or .cursor/rules you already have into nodes — preview first`
   (two-column: `Turns CLAUDE.md, AGENTS.md or .cursor/rules into nodes`); hovering it shows the
   tooltip `Scaffolds Cowtext's files alongside an existing project, then imports its context. Nothing is written until you approve.`
   No door, hint or tooltip says "multi-provider" or promises a Codex/Cursor runtime.

### S5. Toolchain Details → default compile targets

8. *(two-column composition only — skip on a first run with no recents and come back after S13)*
   Press **Details**. *Expected:* the **AI toolchain** modal lists the same five rows with the
   same ✓/✗ text, a **Rescan** button (disabled + `Scanning…` while scanning), and one checkbox per
   row. Tick **Claude Code** only (untick anything else), close the modal.
   The footer line under the panel reads `Ticking a tool in Details makes it a compile target for new projects.`

---

## C. Blank folder → first node → typed edge → Compile (P0 criterion 1, on `delta`)

### S6. Open an empty folder — the canvas guide

9. Press **Open folder**, pick `%TEMP%\cowtext-gp\delta`. *Expected:* pixel-march load, then the
   workspace: left rail, an **empty canvas**, and — centred on it — the guide plate
   `1 Create node → 2 Connect context → 3 Preview compiled output` with a blue
   **Create first node** button and a greyed **Preview compile** whose tooltip reads
   `Add a node first`. The top-bar **Compile** button is disabled with tooltip `The graph is empty`.
   The left rail's **Skills** section already shows a **Built-in** group with one row,
   **task-format**, and a **Project** group reading `No skills in .claude/skills/`.
   `Snap "$GP\delta"` → still nothing on disk (opening writes nothing).
10. Right-click the empty canvas *beside* the plate. *Expected:* the pane menu still opens
    (`New node here…`, `New agent here…`, …) — the guide is an overlay, not a modal. Press Esc.

### S7. Create the first node from the guide (Block 1.1/1.2)

11. Press **Create first node**. *Expected:* the **New node** wizard opens at step 1 **Identity**
    (step rail: Identity · Load · Brief · Confirm). The picker is labelled **Node type** (not
    `Type`); each tile shows icon · name · one-line hint · a monospace example line.
    Type Title `Persona`, pick the **Rule** tile. The right pane is headed **What you get**
    (not `How this is used`) and shows a real destination path.
12. **Next** → Load (leave defaults) → **Next** → Brief: type
    `Who the agent is, how it speaks, what it never does.` → **Next** → Confirm →
    **Create node**. *Expected:* the wizard closes, the guide plate is gone, one card titled
    **Persona** is selected on the canvas, its footer type label reads **RULE** (uppercase CSS of
    the label `Rule`, never the raw id) with tooltip `Node type: Rule — A hard constraint the agent must never break.`
    The Inspector opens on its **Properties** tab. `Snap "$GP\delta"` →
    `\.cowtext\graph.json` and `\context\persona.md` exist now and nothing else (Create is the approval).

### S8. Node type label, `?` help and the disclosure (Block 1.3/1.4)

13. In the Inspector **Metadata** section find the field labelled **Node type** (there is no
    field called `Role` anywhere in the panel). *Expected:* the trigger shows **Rule** with the
    rule glyph; under it a **What this is** disclosure is OPEN (first three launches) showing the
    hint `A hard constraint the agent must never break.` and the monospace example.
    The collapsed-section hint beside **Metadata** also reads `Rule`.
14. Press the **?** button beside the label (aria-label `Node type help`). *Expected:* a popover
    listing the 13 wizard-selectable types grouped, each row = glyph · label · hint · monospace
    example, and a footer line `Agents are created in the Agents rail.` Scroll inside the
    popover — it stays open. Press **Esc**. *Expected:* it closes and keyboard focus is back on
    the **?** button (press Space — it reopens; Esc again).
15. Click **What this is** to collapse it, then select another node later (S9) and come back —
    *Expected:* it stays collapsed (the choice is remembered; reopening it is remembered too).

### S9. Second node and a typed edge

16. Double-click empty canvas → **New node**: Title `Architecture`, Node type **Architecture**,
    Brief `How the app is put together.` → **Create node**.
17. Drag from **Persona**'s source handle onto **Architecture**. *Expected:* the **edge kind
    picker** appears with five kinds — `imports`, `references`, `overrides`, `sequence`,
    `contradicts` — each with its one-line hint (`imports`: `Copies the target file's whole body into this one, every time.`).
    The `imports` row carries an amber note `Architecture notes are usually long. Inlining puts this in every request.` (a *warn*, still clickable).
    Pick **references**. *Expected:* an edge appears; clicking it shows the edge panel in the Inspector.
18. Drag **Architecture** → **Persona** and pick **imports**. *Expected:* allowed (no note) — a
    second edge, solid. Wait for the top-bar save indicator to read **saved**.

### S10. Edit the node — Assemble inputs above the fold (Block 2)

19. Select **Persona**. With the window at 1920×1080 and the Inspector at its default width, read
    the panel top-down *without scrolling*. *Expected order:* **Metadata** (Title · Node type ·
    Owner) then **Assemble** containing, in this order: **Brief** (helper
    `Seed sentence Assemble expands`) · **Tags** (helper `Used for subgraph selection and compile filtering`) ·
    **Influence** — a slider at 50 plus a number box, BOTH greyed; hovering the row shows
    `Not used for Rule`; helper `Influence is an agent setting stored in .cowtext/agents.json. It is not read by Assemble or resolveLoad yet.` ·
    the **Assemble** / **Summarize** buttons and the **Refine** input+button ·
    **Prompt preview** (`first 12 lines`) with a monospace block and a `neighbors` chip row
    containing **Architecture**. The Influence slider is visible without scrolling.
20. Hover **Assemble**, **Summarize**, **Refine**. *Expected tooltips* all end with
    `with headless Claude Code (claude -p)` (Assemble: `Expand the brief into a full file with headless Claude Code (claude -p)`).
    The line under them reads `Runs headless claude -p and rewrites context/persona.md on disk.`
21. Append ` Speaks in short sentences.` to **Brief**. *Expected:* within ~0.5 s the Prompt
    preview block changes to include the new text; nothing is written to disk
    (`Snap "$GP\delta"` unchanged, `context/persona.md` byte-identical — only `graph.json` changes after the ~1 s save).
22. Scroll to the bottom. *Expected:* **Advanced** is COLLAPSED by default, after **File** and
    before **Actions**. Expand it → **Position** X/Y fields with a `local only` badge (tooltip
    `Stays on this machine — never compiled into agent files.`). Select Architecture and back —
    Advanced stays expanded for this session. There is no section called `Position`.

### S11. Compile preview (Phase 2 trust boundary, five targets)

23. `Snap "$GP\delta"` (before). Press the top-bar **Compile** (enabled now).
    *Expected:* the **Compile** modal, header `→ <root>`; a **targets** row with five checkbox
    chips `claude · agents · cursor · copilot · gemini` (claude ticked — the default you left in
    S5, or `claude` alone on a first run); an amber pixel march **"the cow is compiling"**, then
    rows. With only `claude` ticked: `CLAUDE.md` (new file, approved) — footer
    **1 of 1 files will be written**. Tick **agents** and **cursor**: preview re-runs and adds
    `AGENTS.md` and `.cursor/rules/*.mdc` rows; footer count grows accordingly.
    `Snap` again → identical to before (preview writes nothing).
24. Untick `agents` and `cursor` again (leave `claude`). Press **Escape** while the march is
    running. *Expected:* inert (modal stays); once the preview shows, Esc closes it. Reopen.

### S12. Approve → write → GENERATED header (P0 criterion 10)

25. Press **Approve & write**. *Expected:* button reads `· · ·`, Esc and ✕ are inert until the
    write completes, then the body says **wrote 1 file** listing `CLAUDE.md`; the file rail gains
    `CLAUDE.md`. Verify on disk:

    ```powershell
    Get-Content "$GP\delta\CLAUDE.md" -TotalCount 1
    Snap "$GP\delta"
    ```

    *Expected* line 1, byte-exact:

    ```
    <!-- GENERATED BY COWTEXT — edit the graph or context/*.md, not this file -->
    ```

    and the Snap adds exactly `\CLAUDE.md` to the S11 listing. Close the modal.

---

## D. New project wizard → `alpha` (Blocks 0 + 6)

### S13. Home → New project → Folder / Project

26. Press **Home** (top-bar house icon, tooltip `Close project and return to the title screen`).
    *Expected:* title screen in the two-column composition; **Recent projects** header reads
    **1 of 8 kept** with `delta`; the toolchain panel still shows the S3 result and **Rescan**
    (no re-scan on return). Press **New project**. *Expected:* the **New project** wizard with a
    six-step rail **Folder · Project · Principles · Stack · Git · Create**.
27. **Choose folder…** → `alpha`. **Next**. Name `Alpha`; leave the rest. Footer copy reads
    `This becomes a pinned Memory Node.` **Next**.

### S14. Principles

28. *Expected:* six checkbox rows: `Never commit without asking` · `Short commit messages (≤ 50 chars subject)` ·
    `Ask before adding a dependency` · `Run tests before declaring done` ·
    `No destructive git operations (force-push, reset --hard)` · `Prefer editing existing files over creating new ones`,
    each with the rule's first body sentence as its hint. Tick the 1st, 4th and 5th (three).
    Footer copy `Each principle becomes a rule node.` **Next**.

### S15. Stack

29. Type `type` in **Search the stack…**. *Expected:* only **TypeScript** remains (category
    `Languages`); `Nothing in the list matches that search.` for a nonsense query. Clear it and
    tick **TypeScript**, **React**, **Tauri**, **Vitest** (four chips across Languages / Frontend /
    Tooling). Tick **Fixed stack — ask before adding a dependency**. Footer copy
    `The stack becomes one architecture node.` **Next**.

### S16. Git step

30. *Expected:* after a brief `checking git…`, the toggle **Initialize git and make the first
    commit** is ON (blue); the **default branch** picker shows `main` · `master` · `custom` with
    `main` lit; an `identity` row reads `<your name> <<your email>>` in normal text; NO warning
    strip. Copy reads `Runs git init, adds Cowtext's lines to .gitignore, and commits once as chore: init cowtext project. No remote, no push.`
31. Pick **custom**, type `feat x`. *Expected:* the rule line appears (`Branch name can't be empty, contain whitespace …`)
    and **Next** is disabled. Pick **main** again → Next enabled. **Next**.

### S17. Create step: Will-create list, the watch, the commit

32. *Expected* **Will create** list, in this order, each with a note:
    `.cowtext/project.json` · `.cowtext/graph.json` · `.claude/agents/` · `context/project.md` (Alpha) ·
    `context/stack.md` (Stack) · `context/principles/no-commit-without-asking.md` ·
    `context/principles/ask-before-dependency.md` · `context/principles/tests-before-done.md` ·
    `context/principles/no-destructive-git.md` · `.gitignore` (committed with the first commit).
    That is 4 rule files — three ticked plus the one **Fixed stack** implies, never twice
    (go Back, tick `Ask before adding a dependency` in Principles, return: still 4).
    Under the list: `Nothing is written until you click Create.` Then the line
    `Git: git init on branch main, then one commit.` Turn **Install Claude Code hooks** ON
    (amber toggle) — it only promises a modal, and it lets you see the git result line.
33. `Snap "$GP\alpha"` → **nothing**. Press **Create**. *Expected:* `· · ·`, then the
    **Install hooks** modal opens OVER the wizard; behind it the Create step shows a green line
    **branch main · 1 commit**. In the hooks modal press **Cancel**. *Expected:* the wizard
    closes and the workspace opens on alpha with six cards on a 3-column grid: **Alpha**, **Stack**
    and four rule nodes.
34. Verify on disk:

    ```powershell
    Snap "$GP\alpha"
    git -C "$GP\alpha" branch --show-current
    git -C "$GP\alpha" log --oneline | Measure-Object | Select-Object -Expand Count
    git -C "$GP\alpha" show --name-only --format= HEAD
    Get-Content "$GP\alpha\.gitignore"
    ```

    *Expected:* branch `main`; count `1`; the commit lists `.gitignore`, `.cowtext/graph.json`,
    `.cowtext/project.json`, `context/project.md`, `context/stack.md` and the four principle files;
    `.claude/settings.json` does NOT exist (you cancelled). `.gitignore` byte-exact:

    ```
    # --- added by Cowtext ---
    .claude/settings.local.json
    CLAUDE.local.md
    .cowtext/cache/
    ```

35. Open `context/stack.md` (select **Stack** → **Markdown** tab). *Expected body:*
    `# Stack`, then `## Languages` `- TypeScript`, `## Frontend` `- React` `- Tauri`,
    `## Tooling` `- Vitest`, last line `Fixed stack: ask before adding a dependency.`
    Each rule node's file is non-empty (starts with its `# ` heading).

---

## E. Built-in skill through Compile (Block 4) — on `alpha`

### S18. Include → Compile row → materialized

36. Left rail **Skills** → **Built-in** → row **task-format**. `Snap "$GP\alpha"` shows no
    `\.claude\skills\…`. Click the row. *Expected:* it expands a read-only view headed
    `.claude/skills/task-format/SKILL.md` with a `not on disk` badge, the full bundled text, and
    `Bundled with Cowtext and read-only here. Include it in compile and approve the diff to write it — after that it is an ordinary project file you can edit.`
    Flip its **Include in compile** switch ON. `Snap` → still no skill on disk.
37. Top bar **Compile**. *Expected:* besides the compile rows, one extra row
    `.claude/skills/task-format/SKILL.md` (new file, approved by default); the footer count
    includes it (e.g. **2 of 2 files will be written** with `claude` alone). **Approve & write**.
    *Expected:* **wrote 2 files** listing both; `Get-Content "$GP\alpha\.claude\skills\task-format\SKILL.md" -TotalCount 2`
    → `---` then `name: task-format` (frontmatter first — no GENERATED line on a skill).
    The rail row now wears a **materialized** badge and stays under **Built-in**.
38. Compile again immediately. *Expected:* the skill row is present but **unchanged** (greyed,
    unapproved, collapsed) and is NOT counted in `N of M files will be written`'s N. Cancel.

### S19. Modified → Project group → Reset to built-in

39. Append a line on disk: `Add-Content "$GP\alpha\.claude\skills\task-format\SKILL.md" "`nMy local tweak."`.
    Reload the agents store: **Home** → open **alpha** from Recent projects (the rail does not
    watch skill bodies). *Expected:* **task-format** has moved to the **Project** group with badge
    **modified from built-in**; the Built-in group no longer lists it; the **Skills** header count
    still counts it once.
40. Open **Compile**. *Expected:* NO `.claude/skills/…` row at all (a modified built-in is never
    clobbered by Compile). Cancel.
41. Right-click the Project row → **Reset to built-in…**. *Expected:* a red confirm strip
    `Overwrite .claude/skills/task-format/SKILL.md with the bundled version?` with **overwrite** /
    cancel. Press **overwrite**. *Expected:* the row returns to **Built-in** with **materialized**;
    the file no longer ends with `My local tweak.`

---

## F. Tasks (Stage 4 + D-6) — on `alpha`

### S20. Empty state and the absent Inspector (P0 criteria 6, 7)

42. View toggle → **Tasks**. *Expected:* heading **No TASKS.md yet**, the line
    `Each task can pin a context subgraph — Cowtext compiles only those nodes into the session.`,
    the smaller line `Saving the first task creates TASKS.md in this project.`, and ONE blue
    **Create task** button. The right-hand **Inspector is not mounted at all** — no panel, no
    "Select a node…" text, the board spans to the window edge. `Snap` → no `TASKS.md`.

### S21. Create a task — labels and chips

43. Press **Create task**. *Expected:* the **New task** dialog: **File** (TASKS.md lit), **Name**,
    **Description**, **Tags**, **Task type** as chips `none · bug · feature · chore · docs` (no free
    text box), **Priority**, **Agent**, **Status** segmented **Todo · In progress · In review · Done**
    (never `New` / `In production` / `In testing`). Name `Write the persona`, type **feature**,
    status **In review**, **Create**.
44. *Expected:* the board now shows the task under the **In review** lane, with a `feature` chip;
    `Get-Content "$GP\alpha\TASKS.md"` contains the task line and the stored status text is
    `in testing` (the id on disk is unchanged by the relabel). Right-click the card's status
    control (tooltip `Set status / move`) → items read `Move to Todo` … `Move to Done`.

### S22. Task context closure

45. Click the card. *Expected:* the Inspector mounts now, showing the task panel (**Name**,
    **Description**, **Tags**, **Priority**, **Agent**, **Status**, **Task Type**, **Phase**,
    **Save**) and under it the **Context** block. Click the card's context button (layers icon,
    tooltip `Task context — preview the Memory Node subgraph this task's session would receive`).
    *Expected:* the task gets an id minted into `TASKS.md`, and the **Task context** modal opens
    with the pixel march `resolving the subgraph`, then buckets `always in context · 6` (every
    wizard node is always-loaded) and a **compiled body** block. **Close**.
46. In the Inspector **Linked nodes**, press the **Attach a node** button, filter `Stack`, pick
    **Stack**. *Expected:* `Stack` appears under Linked nodes with a **Detach** control.
    Open the context button again. *Expected:* bucket `linked to this task · 1` lists Stack
    first; `always in context` still lists the rest; body begins with Stack's text.
    `Snap` → nothing new yet. Press **Save**. *Expected:* `\.cowtext\context\task-<id>.md`
    appears, and nothing else.

---

## G. Agents (Blocks 3a/3b/3c/5b) — on `alpha`

### S23. Orchestrator empty state

47. View toggle → **Agents**. *Expected:* **No agents yet**, body
    `Agent definitions are Claude Code files in .claude/agents/. Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.`
    and a blue **Create agent** button. The left rail's **Agents** section shows
    `No agents in .claude/agents/` plus its own **Create agent** button.

### S24. New agent — presets, validator, provider chips, preview

48. Press **Create agent**. *Expected:* the **New agent** two-pane modal; at the top a **Preset**
    radio row `Custom · Reviewer · Test writer · Docs writer · Refactorer · Planner · Debugger`
    with the helper `Fills the fields below — every one of them stays editable.`; footer note
    `Nothing is written until you confirm.`; **Create agent** disabled (no name).
49. Pick **Reviewer**. *Expected:* Name `Reviewer`, the first description field
    `Use when a pull request or diff needs a second pair of eyes for bugs, security issues and missing tests before it merges.`,
    the system prompt `Reads a change set and reports risks with file and line; never edits.`,
    Tools restricted to `Read, Glob, Grep`, **Priority (1 = highest)** = 1, no error and no tip
    under the description. The right pane **Agent file** preview shows `name: Reviewer`,
    `description: …`, **`model: claude-fable-5`** and `tools: [Read, Glob, Grep]`; the line under
    the Name field reads `name: reviewer` (the file stem).
50. Replace the description with `Use when reviewing PRs for security issues.` *Expected:* no
    red error, no grey tip. Replace it with `Reviewer` → red
    `This just repeats the agent's name…`; with `Checks PRs` → red `Too short to dispatch on…`;
    with `Reads the diff and reports risks for every pull request.` → no error but the grey tip
    `Tip: start with "Use when…" so Claude picks this agent reliably`. Restore the Reviewer text.
51. **Model**: *Expected:* provider chips **Anthropic · OpenAI · Google · Cursor · GitHub
    Copilot**; every provider whose CLI was `✗ not found` in S3 is dimmed with tooltip
    `Not found on this machine — still selectable` (at least one is dimmed on any ordinary
    machine); Anthropic is lit. The select shows **Claude Fable 5** under `Flagship`, groups
    `Flagship / Balanced / Fast`, last entry **Custom model id…**.
    Click **OpenAI**. *Expected:* the chip lights even if dimmed, the select jumps to `GPT-5.2`,
    a `local only` badge appears with hint `Model for OpenAI is kept locally until its agent format supports it`
    and the note `No model: key is written — OpenAI agent files have no field for it yet.`; the
    preview's `model:` line is GONE. Click **Anthropic** again → `model: claude-fable-5` returns.
52. **Skills** list: *Expected:* `task-format` with a `materialized` badge (or `bundled` on a
    fresh project). Leave it unticked. `Snap "$GP\alpha"` (before). Press **Create agent**.
    *Expected:* toast **Agent created** with an **Undo** action; the rail lists **Reviewer**;
    Snap adds exactly `\.claude\agents\reviewer.md`, `\.claude\agent-memory\reviewer\MEMORY.md`
    (the memory folder toggle was ON; the index is seeded) and `\.cowtext\agents.json`. `Get-Content .claude\agents\reviewer.md -TotalCount 6`
    shows `model: claude-fable-5` and `.cowtext\agents.json` holds `"priority": 1` and
    `"provider": "anthropic"` for `reviewer.md`.

### S25. Canvas entry points — `New agent here…` and `…from this node…`

53. **Canvas** view. Right-click empty canvas → **New agent here…** (bot icon, directly after
    `New node here…`). *Expected:* the wizard opens with a blue row
    `Placed on the canvas where you clicked` and no Context row. Cancel. Right-click the **Alpha**
    card → **New agent from this node…** (after `Open markdown`, before `Rename file…`).
    *Expected:* the row reads **`Context: Alpha — imported by this agent`**.
54. Pick **Debugger**, **Create agent**. *Expected:* a new agent plate **Debugger** lands one
    card-pitch to the RIGHT of Alpha with an `imports` edge **Debugger → Alpha**; the rail lists
    it; the wizard closes. Open the rail's plain **+** (`New agent`) → no Context row, no
    "Placed" row (prefill does not leak). Cancel.

### S26. Editing an agent — provider switch is local-only

55. Select the **Reviewer** plate (or rail row). *Expected:* the Inspector's agent editor shows
    the same **Model** picker with Anthropic lit and `Claude Fable 5`. Switch to **Google**.
    *Expected:* badge + note as in S51; after the autosave, `reviewer.md` has no `model:` line and
    `.cowtext/agents.json` shows `"provider": "google"`. Switch back to **Anthropic** →
    `model: claude-fable-5` is written again. The **Local only** block's badge tooltip reads
    `Stored in .cowtext/agents.json — never written to the agent's own file.`

---

## H. Run / Assemble — the honest runtime copy (Stage 5 point 12)

### S27. Run dialog copy, defaults and the ceiling

56. Hover the top-bar **Run**. *Expected tooltip:* `Run — launches a headless Claude Code session (claude -p)`.
    Press it. *Expected:* **Run session** dialog; **Agent file** is preselected to the rail's
    selection (Reviewer) — or `(none)` when nothing is selected; **Working folder** = project root
    with **Browse…**; **Token ceiling** is an input with placeholder `inherit`, a `local only`
    badge (tooltip `Applies to this session only`) and the line
    `Effective: 200k (from global default)`; footer copy `runs a real Claude Code session in that folder`.
57. Type `0` → `Effective: unbounded (from this run)`; type `50000` → `Effective: 50k (from this run)`;
    type `-5` → red `Whole number, 0 or more. Empty inherits; 0 is unbounded.` and **Run**
    disabled; clear it → back to `(from global default)`. **Cancel** (no run yet).

### S28. Assemble / Run for real *(needs `claude`)*

58. Select **Persona**-equivalent node (any rule node), press **Assemble**. *Expected:* the
    confirmation gate names `claude -p`; on approve the card shows the pixel-march "assembling"
    state, the Activity dock later shows the job, and the node's file grows. If `claude` is
    absent: the inline error names the binary, nothing on disk changes.
59. **Run** → Agent file **Reviewer**, Name `smoke`, **Run**. *Expected:* the dialog closes, the
    **Agents** dock tab gains a badge `1`, and the Barn (S31) shows the cow at work. Reopen Run
    later with nothing selected → **Agent file** defaults to **Reviewer** (last run remembered).

---

## I. Hooks, events and the Barn (Stage 5 points 13–14)

### S29. Connect hooks from the Barn legend (trust boundary)

60. View toggle → **Barn**. *Expected:* bottom-right strip: the legend line
    `Cow = the agent · calves = subagents · desk lights = files being read/written` and three
    buttons **Demo**, **Connect hooks**, **Legend ▾**. Bottom-left ticker reads
    `0 reads · 0 writes · 0 turns`; hovering each token shows its tooltip
    (`Files the agent read (hook events this session)` / `Edits and writes` / `Completed turns (Stop events)`).
61. Press **Legend ▾** → the line hides, buttons stay; **Legend ▴** shows it again. Press
    **Connect hooks**. *Expected:* the **Install hooks** modal with the diff of
    `.claude/settings.json`, copy `… reports file activity to Cowtext on 127.0.0.1:4923. Nothing is written until you approve the exact diff below.`;
    **Cancel** holds initial focus (press Enter → modal closes, nothing written — `Snap` unchanged).
62. Open it again and press **Approve & install**. *Expected:* `· · ·`, Esc inert, then
    `Claude Code sessions in this project now report to the barn on 127.0.0.1:4923.`;
    `\.claude\settings.json` appears (`Snap`) and contains `127.0.0.1:4923/event`; the Activity
    tab's **Install hooks** badge now reads **hooks installed**. Settings (gear) → **Agent**
    section: first line is the sentence verbatim; the **Hooks server** row reads `127.0.0.1:4923`.

### S30. Activity — the `Toolchain scan:` row

63. Dock → **Activity**. *Expected:* at least one row tagged **toolchain** whose text is
    `Toolchain scan: N of 5 found in <n> ms (claude ✓ <v> · codex ✗ · cursor ✗ · gh copilot ✗ · gemini ✗)`
    (your machine's mix; `cmd` names in that order). It is rendered in the UI font, not as a
    path, and it has no `not on graph` tag. Note: this row exists because the scan ran while
    this app process was alive — after **Home** (which clears the feed) it is gone until a
    **Rescan** on the title screen. The empty-feed copy (when none) reads
    `No events yet. Install hooks, then run Claude Code in this project — or start barn demo mode.`

### S31. Barn response and wide-fit

64. Barn → **Demo**. *Expected:* the button reads **Stop demo** (amber); the cow walks, bubbles
    appear, calves spawn on `subagent_stop`, the ticker counts climb (`… reads · … writes · … turns`);
    Activity rows carry a `DEMO` tag. **Stop demo** → rows with the tag are purged; the
    `toolchain` row from S30 survives the purge.
65. Maximise the window on a wide monitor (≥ 2560 px if available), then un-maximise / open the
    Inspector. *Expected:* on open and on each resize the whole barn floor is visible (largest
    integer zoom 1–4 that fits; never a fractional zoom, never a clipped floor); after you
    wheel-zoom or drag once, resizes stop re-fitting. *(needs `claude`)*: with hooks installed,
    run `claude -p "read context/project.md and stop"` in the alpha folder from a terminal —
    a `read` row appears in Activity and the cow reacts.

---

## J. Switch project — no state leakage (Stage 5 point 15)

### S32. Existing repo → New project skips git (D-15)

66. **Home** → **New project** → **Choose folder…** `gamma` (already `git init`ed in S1) →
    Name `Gamma` → Next ×2 (tick nothing) → **Git**: *Expected:* the toggle is OFF and disabled,
    notice `Existing repository detected — git init skipped`, the branch picker greyed.
    **Next** → Create step: no `.gitignore` in Will create; line
    `Git: existing repository detected — git init skipped.`; only ONE node file (`context/project.md`).
    **Create**. *Expected:* workspace with a single **Gamma** card.
    `git -C "$GP\gamma" log` → still no commits; `Test-Path "$GP\gamma\.gitignore"` → `False`.

### S33. Nothing leaks across projects

67. In gamma open **Compile**. *Expected:* target chips match your S5 ticks (`claude` only) —
    not alpha's. Cancel. The left rail **Skills** Built-in row's **Include in compile** is OFF
    (alpha's ON did not follow). **Tasks** view → `No TASKS.md yet` and no Inspector. **Agents**
    view → `No agents yet`. Dock **Agents** tab badge still shows alpha's live session if S59 ran
    (sessions survive Home by design). Title screen → the toolchain panel still shows S3's result
    with **Rescan** (the scan is a machine fact, intentionally kept).
68. In gamma, right-click the **Gamma** card → **New agent from this node…** → Cancel. Then the
    rail's **+** (`New agent`). *Expected:* no Context row. **Home**, open **alpha**, rail **+**:
    still no Context row, and alpha's graph is intact (six cards, Debugger → Alpha edge).

---

## K. Failure states and trust boundaries (Stage 5 point 16)

### S34. Missing git identity — the exact error, and no `.git` left behind

69. Save and remove your identity (PowerShell; restore in step 71 — do not skip it):

    ```powershell
    $SavedName = git config --global user.name; $SavedEmail = git config --global user.email
    git config --global --unset-all user.email
    New-Item -ItemType Directory -Force "$GP\epsilon" | Out-Null
    ```

70. **Home** → **New project** → `epsilon` → Name `Epsilon` → Next ×2 → **Git**. *Expected:*
    `identity` row reads `not configured` in warning colour and the strip
    `Git identity is not configured — the first commit will fail. Set user.name and user.email, or turn the toggle off.`
    Keep the toggle ON, **Next**, **Create**. *Expected:* the step shows the red error, byte-exact:
    `Git identity is not configured. Run: git config --global user.name "Your Name" and git config --global user.email "you@example.com" — then try again.`
    and the primary button now reads **Retry**. `Test-Path "$GP\epsilon\.git"` → **False** (nothing
    initialised); `.cowtext\graph.json` and `context\project.md` DO exist (the project itself was
    created once and is not re-created on Retry).
71. Restore identity and retry:

    ```powershell
    git config --global user.email $SavedEmail; git config --global user.name $SavedName
    git config --global user.email   # must print your email again
    ```

    Press **Retry**. *Expected:* the wizard proceeds (hooks modal or workspace); `git -C "$GP\epsilon" log --oneline`
    shows exactly one commit `chore: init cowtext project` on `main`.

### S35. New project pointed at an existing Cowtext project

72. **Home** → **New project** → **Choose folder…** `alpha` → Name `Alpha again` → Next to
    **Create** → **Create**. *Expected:* red error
    `project already has a graph (.cowtext/graph.json) — this folder is already a Cowtext project. Cancel and use Open folder instead.`;
    alpha's graph, nodes and files are untouched: `Snap "$GP\alpha"` lists the same files as
    before (only `.cowtext\project.json` — Cowtext's own sidecar — was rewritten in place;
    `context\project.md` and `.cowtext\graph.json` are byte-identical). **Cancel**.

### S36. Convert existing — preview first (`beta`)

73. **Convert existing** → `beta` → Name `Beta` → **Next** → Create step. *Expected:* the copy
    `Imports the CLAUDE.md, AGENTS.md or .cursor/rules you already have — preview first.` with
    the sentence under it; Will create lists `.cowtext/project.json`, `context/project.md`,
    `context/`, `.claude/agents/`. `Snap "$GP\beta"` → only `\CLAUDE.md`. **Convert**.
    *Expected:* the **Import** review modal opens listing rows such as `Adopt Rules` /
    `Adopt Architecture` with their target paths; nothing under `context/` has been written for
    them yet beyond the scaffold. Untick one, press **Adopt selected**. *Expected:* only the
    ticked sections become nodes on the canvas; `CLAUDE.md` itself is left byte-identical
    (`Get-Content "$GP\beta\CLAUDE.md"` unchanged) until you compile.

### S37. `.codex` honesty + UI scale 130 % alignment

74. Repo check (not the app): `Get-Content .codex\config.toml -TotalCount 3`. *Expected:* three
    `#` lines saying development-only / build with `cargo build --release --bin cowtext-mcp` /
    paths are machine-specific. `npm run truth -- --no-cargo` prints **T10 PASS** and
    **T11** PASS-or-WARN (never FAIL); no UI surface in this walk mentioned a Codex runtime.
75. Settings (gear) → **Appearance** → **UI scale** **130%**. *Expected:* rail, Inspector, dock,
    every modal and the Settings modal itself grow together; the canvas cards and the Barn do
    not. Right-click a rail agent row — the context menu opens at the pointer (not drifted
    right/down) and flips back on-screen near the window edge; Inspector **?** popover likewise
    sits under its button and Esc returns focus. **UI font** → **System**, **Code font** →
    **System monospace** → the panel text and mono text change family. **Done**; close and
    relaunch the app → the scale and fonts persist. Set them back to **100%** / IBM Plex Sans /
    JetBrains Mono.

---

## L. Regression — WO14 shell (3 minutes)

### S38. Dock, stepper, undo, save

76. With alpha open: Dock tabs **Agents · Problems · Activity** toggle their panes; **Problems**
    shows lint rows (the `imports` into Architecture warn from S9 is absent here — that edge is in
    delta). Drag a card, **Undo (Ctrl+Z)** restores its position, **Redo (Ctrl+Y)** re-applies.
    Rename a node title → save indicator `unsaved → saving… → saved`. Canvas **Overlay:** label
    precedes the lens segments. Close the app and relaunch: alpha reopens from Recent projects
    with the Debugger → Alpha edge, six grid positions and compile targets intact.

---

## Cleanup

77. Close the app, then remove the scratch projects (and nothing else):

    ```powershell
    Remove-Item -Recurse -Force (Join-Path $env:TEMP "cowtext-gp")
    ```

    If S34 was interrupted, re-run its step 71 block first so your git identity is restored.

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Title screen (S3–S5) | | |
| C Blank folder → Compile (S6–S12) | | |
| D New project wizard (S13–S17) | | |
| E Built-in skill (S18–S19) | | |
| F Tasks (S20–S22) | | |
| G Agents (S23–S26) | | |
| H Run / Assemble (S27–S28) | | |
| I Hooks, events, Barn (S29–S31) | | |
| J Switch project (S32–S33) | | |
| K Failure states (S34–S37) | | |
| L Regression (S38) | | |

Tester: ____________  Date: ____________  Build/commit: ____________
