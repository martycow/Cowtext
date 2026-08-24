# Regression Manual Test Script — everything the golden path does not cover

The second half of release gate 2. `GOLDEN_PATH_MANUAL.md` walks the new-user path
end to end; this file walks **only what that path never touches** — the review queue,
session safety, task-file surgery, the two least-used compile adapters, the CLI, the
wizard's second write path, the v4→v5 migration, and three crash reports that can only
be confirmed with the app running. It replaces seven per-work-order manuals (WO01, WO02,
WO03, WO06, WO09, WO12, WO13 — 4,771 lines) that release gate 2 required walking
separately; each step below was re-derived from those manuals and **re-verified against
the code**, because a third of the original steps had gone stale.

Run it top to bottom in one sitting. Sections B–H reuse the `rho` project section A
creates. Written against the code as of 2026-08-24 (`src/store/review.ts`,
`src/store/tasks.ts`, `src/store/graph.ts`, `src/canvas/portSlots.ts`,
`src/wizard/NodeWizard.tsx`, `src/wizard/preset.ts`, `src/agents/AgentEditor.tsx`,
`src/sessions/AddAgentDialog.tsx`, `src/compile/CompileModal.tsx`,
`src/import/ImportReviewModal.tsx`, `src-tauri/src/sessions.rs`,
`src-tauri/src/tasks.rs`, `src-tauri/src/project.rs`,
`src-tauri/src/bin/cowtext_cli.rs`, `src-tauri/src/bin/cowtext_mcp.rs`). Every step names
the real control and the exact expected result — if reality differs, that is a bug (or
this manual is stale; either way, note it).

**Time budget:** ~50 min for A–J, plus ~15 min for K (production build) and L (crash
reports). Steps marked *(needs `claude`)* are skipped, not failed, when
`claude --version` does not work.

**Watch-the-folder rule:** steps that write say *Snap before / Snap after*, using the
`Snap` function from section A. The two listings must differ only by the files the step
names. Any other new file is a finding.

---

## A. Preconditions

1. **Free port 1420**, `git` on PATH with an identity. In PowerShell:

   ```powershell
   git --version; git config --global user.name; git config --global user.email
   claude --version   # optional — governs the "(needs claude)" steps
   ```

   *Expected:* a version line and two non-empty identity lines.

2. **Make the disposable projects** (never a real project — this walk writes and deletes):

   ```powershell
   $RG = Join-Path $env:TEMP "cowtext-rg"
   Remove-Item -Recurse -Force $RG -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force "$RG\rho", "$RG\sigma", "$RG\empty" | Out-Null
   function Snap($p) { Get-ChildItem -Recurse -Force $p | Where-Object { -not $_.PSIsContainer } | ForEach-Object { $_.FullName.Substring($p.Length) } | Sort-Object }
   Snap "$RG\rho"
   ```

   *Expected:* `rho` lists nothing.

3. Run `npm run tauri dev`, **New project** → `rho` → name `Rho` → accept the defaults
   through **Create**. Then add four nodes on the canvas: a `rule` named **House rules**,
   an `architecture` named **Shape**, an `invariant` named **Never**, and a `command`
   named **Build**. Wire `Shape --imports--> House rules`.
   *Expected:* `rho` is on `branch main` with one commit; the canvas shows four cards.

---

## B. External change and the review queue

The only surface that catches an outside editor — or an agent — rewriting a Memory Node.

4. Right-click the **House rules** card → **Open markdown**, append a line, press
   **Ctrl+S**.
   *Expected:* the save completes and the node content updates, and the amber
   `1 file changed on disk` strip above the workspace **never appears**. Cowtext's own
   write must not re-enter its own review queue — if it does, the user is offered
   *Revert* on the edit they just made, and one click destroys it.

5. From an outside editor, append `- external line` to `rho\context\house-rules.md`.
   Do nothing in the app for two seconds, then press **Review next**, then **Escape**,
   then **Review next** again.
   *Expected:* within ≤ 1 s the amber strip reads `1 file changed on disk`; the dialog
   shows panes `last known content` / `on disk now` with the new line tinted on the right
   only; Escape closes the modal but the strip **still** reads `1 file changed on disk`;
   reopening shows the identical diff. Closing must not silently drop a pending entry.

6. With that entry still pending, press **Revert**, re-read the file, and wait ~5 s.
   *Expected:* the file returns byte-for-byte to its pre-edit content, and the banner
   does **not** reappear — Revert's own write is self-write-suppressed. If a revert ever
   fails, an amber `Revert failed: …` strip must show inside the still-open modal; a
   silent no-op is a finding.

7. Change **two** managed files from outside, click **Dismiss all** once, then
   **Confirm dismiss all?**, then re-read both files.
   *Expected:* the first click swaps the label in place to a danger-red
   `Confirm dismiss all?` while the strip still reads `2 files changed on disk`; the
   second click clears the strip; **both files still carry their external edits**. Dismiss
   must never write.

---

## C. Session safety

8. *(needs `claude`)* Launch a session on `rho` from the top-bar **Run** dialog, note its
   `claude`/`node` pids, then in the Agents dock tab press **Kill** → **Confirm kill?**:

   ```powershell
   Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'claude|node' } | Select ProcessId,Name
   ```

   *Expected:* the card dims, the dot stops animating, the Queue box disables with
   placeholder `session has exited`, and **none of the noted pids remain**. An orphan
   survives real API spend and can still write into the repo after "kill".

9. With one session live in `rho`, open **Run** and pick `rho` again; then bring the live
   count to four.
   *Expected:* red `an agent is already running there` with **Run** disabled even though
   the folder is a valid repo; at four alive the launch control is disabled with title
   `agent limit reached (4)`. Two headless sessions in one folder clobber each other.

10. *(needs `claude`)* **Run** → any agent file → **Token ceiling** `500` → **Run**.
    *Expected:* the session stops within one turn; the roster card gains a danger-red left
    edge and a mono `budget` badge; the tooltip reads `stopped: token ceiling reached`;
    the budget bar never renders past 100 %; the event stream carries
    `token ceiling 500 reached — session stopped`. A ceiling that displays but never fires
    is worse than no ceiling.

11. *(needs `claude`)* On that stopped session press **Restart**.
    *Expected:* it goes alive and **stays** alive through a full turn, and the budget bar
    restarts from ~0 %, not from the pre-stop total. Without the counter reset every
    Restart burns a paid turn and re-stops immediately.

---

## D. Task-file surgery

`TASKS.md` is the user's own markdown. Every step here catches a silent rewrite of it.

12. Open **Tasks**, segment **TASKS**, create two tasks with **New task**, then read the
    file.
    *Expected:* the file holds exactly **one** `| Name | Status | … |` header/separator
    pair, with the new rows appended after the first data row — not a second `# TASKS`
    block. Both cards show on the board. Status vocabulary is
    `Todo · In progress · In review · Done`.

13. Hand-edit one row's Priority cell to `someday`, let the board reload, then edit only
    that task's **Description** and press **Save**.
    *Expected:* the Priority segmented control shows **no** segment lit (a cosmetic
    fallback), and after Save the file's Priority cell still reads `someday` verbatim.
    Save must not normalise away a value the vocabulary does not know.

14. Set a **Task type** on a card, then (a) change its **Status** from the Inspector's
    task panel and **Save**, and (b) drag the same card to another status column.
    *Expected:* the type chip is still on the card after **both** edits. Regression guard
    for BUGS F6 — both paths once sent a partial patch, and `task_update` clears any key
    it does not receive.

15. Segment **BACKLOG**, create a task with a Priority, then click that row's checkbox.
    *Expected:* the row strikes through, and `BACKLOG.md` shows Status `done` **with the
    Priority cell still populated**. A toggle that omits a mapped column blanks it.

16. On task A's dependency chip (git-branch icon) pick task B, where B already needs A.
    *Expected:* the popup shows Rust's own text byte-for-byte in a danger-red mono strip —
    `adding needs:t-YYYYYY would create a cycle: t-XXXXXX -> t-YYYYYY -> t-XXXXXX` — and
    `TASKS.md` still holds exactly one `#needs:` token. A cyclic chain deadlocks the board.

17. Take a **Done** task that carries a stable id and an inbound `#needs:`, and use
    card **⋮** → **Move to BACKLOG.md**.
    *Expected:* it arrives already checked (not reset to `new`), still carries
    `#id:t-XXXXXX`, and the depending task's chip still resolves it by name with status
    `Done`. There is no undo for an orphaned dependency.

---

## E. Compile, import and the CLI

18. *Snap before.* In the Compile modal tick **copilot** and **gemini**, press
    **Approve & write**, then read line 1 of each file:

    ```powershell
    Get-Content "$RG\rho\.github\copilot-instructions.md" -TotalCount 1
    Get-Content "$RG\rho\GEMINI.md" -TotalCount 1
    ```

    *Expected:* both print exactly
    `<!-- GENERATED BY COWTEXT — edit the graph or context/*.md, not this file -->`, and
    the modal footer counted both rows as **new file**. *Snap after* differs by exactly
    those two files. An unmarked generated file is not recognised as compile-owned, so the
    importer later offers it for adoption and the next Compile eats hand-written content.

19. Press **Import existing context…** a second time on this already-compiled project and
    try to tick every row.
    *Expected:* rows for `CLAUDE.md` carry the red **compile writes this file** badge,
    rows for adopted `context/*.md` carry **already managed**, every one of those
    checkboxes is genuinely inert, no checkable duplicate row exists, and the footer counts
    **0 nodes to add**.

20. Add a second structural edge so `House rules --imports--> Shape` closes a cycle with
    the edge from step 3, then press **Compile**.
    *Expected:* the modal enters the **errors** phase — a red **cycle** badge row, footer
    `N problems — nothing …`, **Approve & write** disabled. Delete one edge and the preview
    returns with the button re-enabled. The write boundary must fail closed. Remove the
    extra edge before continuing.

21. Run the CLI matrix from the repo root:

    ```powershell
    cargo run -q --bin cowtext-cli -- compile --check --root "$RG\rho"; "exit=$LASTEXITCODE"
    # then edit any node title in the app, and re-run the same line
    cargo run -q --bin cowtext-cli -- compile --check --root "$RG\empty"; "exit=$LASTEXITCODE"
    cargo run -q --bin cowtext-cli -- compile --root "$RG\rho";           "exit=$LASTEXITCODE"
    cargo run -q --bin cowtext-cli -- lint --check --root "$RG\rho";      "exit=$LASTEXITCODE"
    cargo run -q --bin cowtext-cli -- frobnicate;                         "exit=$LASTEXITCODE"
    ```

    *Expected, in order:* `OK — N generated file(s) match the graph. No drift.` exit **0** ·
    after the edit, `DRIFT DETECTED …` exit **1** · `cowtext-cli compile: no .cowtext/graph.json found under …`
    exit **2** · `compile requires --check` exit **2** ·
    `--check is only valid for the compile command` exit **2** ·
    `unknown command: frobnicate` exit **2**. A CI gate that exits 0 on drift ships stale
    context; one that exits 1 on a usage error turns CI red for the wrong reason.

22. *Snap before.* Run `cowtext-cli compile --check --json` and `lint --json` against
    `rho`, then *Snap after*.
    *Expected:* `Compare-Object` prints nothing — the headless binary creates and changes
    zero files. This is the CLI's whole contract.

---

## F. The wizard's second write path, and the migration

23. Hand-write a headerless `CLAUDE.md`, then create a node through the wizard and reach
    step 4 **Confirm**:

    ```powershell
    Set-Content "$RG\rho\CLAUDE.md" "# Hand-written — do not lose me"
    ```

    Double-click the canvas → type a title → pick **Rule** → advance to **Confirm**.
    *Expected:* a `CLAUDE.md` row under additional files, badged **handwritten** in danger
    red, checkbox **unchecked**, banner
    `CLAUDE.md: handwritten file — Cowtext did not generate this. Approving will overwrite it.`,
    summary `0 of 1 additional file will be written.` Confirm → the file is byte-identical.
    Repeat, tick the box → summary `1 of 1 … — overwrites 1 handwritten file.`, Confirm →
    line 1 is now the GENERATED header. This is a **separate write path** from the Compile
    modal; the golden path exercises only the modal.

24. Hand-author a **v4** graph in `sigma` (version `4`, one node role `task`, one
    `reference`, one `rules`), **Open folder** → `sigma`, then clear one `needsReview` flag
    and check the backup:

    ```powershell
    Get-Content "$RG\sigma\.cowtext\graph.v4.bak.json" | ConvertFrom-Json | Select version
    ```

    *Expected:* banner `3 nodes migrated to the new format · 2 need review`; **Details**
    breaks it into `1× task→workflow` and `1× reference→architecture`; the `rules`→`rule`
    node is **not** flagged; **Review 2** pans to the two amber cards. The backup reads
    `version : 4` and is byte-identical to the fixture. Note the backup is taken lazily on
    the **first write after** migration — a step that only opens the project proves nothing,
    which is why clearing a flag is load-bearing. Migration is the one irreversible
    operation in the app, and every pre-WO13 project on disk still hits this path.

25. Draw a `references` edge from a lexically-greater source to a lesser target,
    right-click → **contradicts**, then draw the reciprocal the other way, then close and
    reopen the project.
    *Expected:* the edge renders with cross markers and no arrowhead; the reciprocal
    creates nothing and raises no error; after reload there is **exactly one**
    `contradicts` edge between the pair and no console errors. An un-normalised edge
    collapses on the next load, dropping one edge with its note and colour, silently.

---

## G. Canvas wire stability

26. Wire three edges into one card. Drag that card to a new position, then delete an edge
    **between two other cards**, and re-check which contact each wire sits on. Restart the
    app and reopen.
    *Expected:* the port shows exactly three contacts (the count follows the node's degree,
    floor 1, ceiling 9), 8 px apart; contact assignment is byte-identical before and after
    both actions and across the restart. Only adding or removing an edge **at that same
    port** re-packs it. `assignPortSlots` and `edgePath` have no Vitest coverage at all, so
    this step is their only guard.

---

## H. Agent editing and Assemble

27. *(needs `claude`)* Select an agent-backed node → Agent tab with **System prompt**
    visible → press **Assemble** → type continuously, never pausing 500 ms, until the
    card's phase bar reaches `writing`. Then stop typing.
    *Expected:* no keystroke lost, no cursor reset, no flicker; then an amber banner
    **"Assemble changed this file on disk. Your unsaved edits are still here."** appears in
    the Agent tab with **Reload from disk**, which swaps in the assembled body and clears
    the banner. A disk-reload that remounts the editor mid-edit destroys the user's typing,
    and node-env Vitest cannot reach this.

28. Select an agent, change **Model**, set **Influence** to ~80 %, tick a **Tool**, then
    press **Assemble** and read the full prompt in the confirmation dialog before pressing
    **Cancel**.
    *Expected:* the prompt contains an `Agent:` block with `- Name`, `- Model`,
    `- Priority`, `- Influence`, `- Tools` and a `- Duties:` body matching what was just
    edited. Cancel spends nothing. A prompt that silently omits the agent payload produces
    a lobotomised result at full price.

---

## I. Project properties, repo states and questions

29. Open **Project properties**, type a multi-line **Requirements** and one **Hard rules**
    line, **Save**, then **re-open the same dialog**.
    *Expected:* Requirements shows both lines immediately and Optional auto-expands showing
    the hard rule; `.cowtext\project.json` and the `## Requirements` section of
    `context\project.md` agree with the field. These load asynchronously after the dialog
    mounts — if they render empty the user retypes into a blank box and Save destroys the
    project's own source of truth.

30. On a folder Cowtext itself `git init`-ed that has **no commits yet**, open **Run** and
    read the git status line.
    *Expected:* `git -C <folder> log --oneline` errors with "does not have any commits
    yet", and the Run dialog nevertheless shows
    `repo main working copy — a separate worktree is recommended` with **Create worktree…**
    — never the red `not a git repository`. Unborn HEAD is the state every brand-new
    Cowtext project passes through; misreporting it blocks the whole orchestration loop.

31. *(needs `claude`)* With two sessions running, provoke a reply ending in
    `COWTEXT_ASK: <question>` from the **selected** session, then from an **unselected**
    one. Press **Esc** on the popup, re-provoke, then answer with **Ctrl+Enter**.
    *Expected:* the selected session answers **inline above the Agent Panel composer**; the
    unselected one raises `AgentQuestionModal` ("<name> is asking", footer
    `Ctrl+Enter to send · Esc to dismiss`). Esc closes it and the transcript gains no turn;
    Ctrl+Enter shows `· · ·`, closes, and the answer appears as the next turn — never
    "agent is busy". This is the only channel by which a running agent can block on the
    user.

32. Hand-write `sigma.node.cowtext-preset.json` containing `"role": "agent"`, then in the
    node wizard press **Import preset…** and create the node.
    *Expected:* an amber notice names the blocked role and the substitute
    (**architecture**), the picker shows the substitute selected, and the created
    `context\*.md` is not tagged `agent`. Regression guard for BUGS D3a — import is the
    wizard's back door around the role picker, and an agent-tagged file in `context/` is a
    node Claude Code cannot see.

---

## J. The MCP server

33. Build and smoke the second entry point, from `src-tauri/`:

    ```powershell
    cargo test -q --bin cowtext-mcp
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
      & .\target\debug\cowtext-mcp.exe --root "$RG\rho"
    ```

    *Expected:* the tests pass, including
    `tool_manifest_has_exactly_14_tools_with_valid_schemas`; the smoke prints exactly two
    JSON lines, the second carrying `result.tools` of length **14**, every name prefixed
    `cowtext_`. This is a whole second way into the graph, compile and task writers, with no
    UI and no other coverage — a stray `println!` alone would corrupt the stdout stream.
    `.mcp.json` hard-codes an absolute release path and is marked development-only; a
    missing release binary here is not a failure.

---

## K. Production build (~10 min, run last)

34. `npm run tauri build`, then launch `src-tauri\target\release\cowtext.exe` **directly**
    — not through `tauri dev` — open `rho`, run one Compile write and one action that makes
    a sound.
    *Expected:* the bundle builds into `src-tauri\target\release\bundle\`; the exe opens the
    title screen; pixel and mono fonts render; the Barn renders and a sound plays; Compile
    across all five targets approves and writes. The production CSP is strictly narrower
    than `devCsp` — no `'unsafe-inline'`, no `'unsafe-eval'`, no `ws://localhost:1420` — so
    a webview that works under `tauri dev` can white-screen or lose IPC in the bundle. This
    is the only step in either manual that exercises the shipped artefact.

---

## L. Crash reports awaiting live confirmation

Three `unproven` rows in `docs/tasks/BUGS.md`. All confirmed code defects on these paths
are fixed and a global ErrorBoundary is installed, so the expected result is now
**no crash** — but only a live run can close them. If one does reproduce, capture the
ErrorBoundary's component stack, or the devtools console plus whether `cowtext.exe` is
still alive in Task Manager.

35. **B2** — select every agent in the file rail, both on-graph and off-graph, one by one.
    *Expected:* the Inspector renders each agent; no blank window.

36. **C1** — on an off-graph agent, press **Adopt to graph** in the Inspector's Actions
    section.
    *Expected:* the agent becomes a node; no blank window.

37. **F1** — *(needs `claude`)* open the Node Wizard, tick **Assemble after close**, and
    close the wizard; then repeat, press **Finish**, and close mid-assemble.
    *Expected:* the window stays responsive, the pixel march runs, and the assemble either
    completes or reports an error; no frozen window.

---

## Cleanup

38. Close the app, then remove the scratch projects and nothing else:

    ```powershell
    Remove-Item -Recurse -Force (Join-Path $env:TEMP "cowtext-rg")
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions (1–3) | | |
| B Review queue (4–7) | | |
| C Session safety (8–11) | | |
| D Task-file surgery (12–17) | | |
| E Compile, import, CLI (18–22) | | |
| F Wizard write path + migration (23–25) | | |
| G Wire stability (26) | | |
| H Agent editing + Assemble (27–28) | | |
| I Properties, repo states, questions (29–32) | | |
| J MCP server (33) | | |
| K Production build (34) | | |
| L Crash reports (35–37) | | |

Tester: ____________  Date: ____________  Build/commit: ____________
