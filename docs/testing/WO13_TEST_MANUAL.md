# WO13 Manual Test Script — Taxonomy Overhaul + 7 Acceptance Defects + Fix Round

Hand-run test manual for WO13 (`docs/_archive/contracts/WO13_CONTRACT.md`, frozen +
Amendment 1 §21, Amendment 3 §7.3) **after** the post-audit fix round: the
node-role refactor (14 roles / 13 pickable), the edge model refactor (5
kinds, guards, `resolveLoad`, lint), the agent-modal refactor, the
`.claude/commands/` emitter, Marty's 7 acceptance defects from
`docs/INPUT_PROMPT.md`, and 16 defects found and fixed since this manual was
first written. Section B (the 7 defects) is deliberately first — it is why
this work order exists and the highest-value 20 minutes if that is all you
have. Section F needs a **pre-migration** project built by hand in section
A.3; section D's fix-round checks need a third hand-authored project built
in section A.4; every other section reuses the project built in section
A.2. Run top to bottom in one sitting.

Written against the working tree as of 2026-08-21 (uncommitted, on top of
`879c83a`, post fix-round): `src/wizard/NodeWizard.tsx`,
`src/ui/{TwoPaneModal,PreviewPane}.tsx`,
`src/canvas/{MemoryEdge,KindPicker,MemoryNodeCard,GraphCanvas,globMatch}.tsx`,
`src/tasks/NewAgentDialog.tsx`, `src/agents/{AgentEditor,ToolPicker}.tsx`,
`src/inspector/{Inspector,ProjectPanel}.tsx`, `src/rail/Hierarchy.tsx`,
`src/App.tsx`, `src/config/{nodeTypes,edgeRules,resolveLoad}.ts`,
`src/store/{agents,graph,tokens}.ts`, `src/agents/RailSections.tsx`,
`src/compile/CompileModal.tsx`, `src/handoff/HandoffNodeProposalModal.tsx`,
`src-tauri/src/{compile,resolve_load,lint,fsbatch,taskctx,assemble,git,handoff}.rs`.
Every step names the real control and the exact expected result — if reality
differs, that is a bug (or this manual is stale; either way, note it).

**Time budget:** ~20 min for section B alone. ~120 min for a full A–H pass,
plus the 3-minute WO12 regression at the end.

**Automated gates (run before or after the manual walk, not a substitute for
it) — re-verified independently 2026-08-21, all six green:**

```powershell
cd src-tauri
cargo clippy --all-targets -- -D warnings          # exit 0, zero warnings
cargo test --all-targets --no-fail-fast -- --test-threads=1
# 770 passed, 0 failed (736 lib + 18 CLI + 16 MCP)
cd ..
npx tsc --noEmit                                    # clean, no output
npm run lint                                         # 0 errors (16 pre-existing warnings, unrelated to WO13)
npm run test                                         # 163/163 across 12 files
```

**Use `--no-fail-fast -- --test-threads=1` on `cargo test`, always.** The
default parallel/fail-fast invocation *undercounts*: it stops at the first
failing target and never runs the CLI/MCP suites, and
`sessions::tests::kill_tree_*` fails intermittently under parallelism from
resource contention, not a real regression. Do not re-derive this the hard
way — just pass the flag.

**Invoke-name contract:** 75 `#[tauri::command]` fns in
`generate_handler![...]` (`src-tauri/src/lib.rs`), 75 unique `invoke(...)`
call names across `src/`, byte-identical in both directions (checked by
diffing the two name sets, not just counting them).

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri
   dev` fails rather than picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite on :1420, cargo builds, the Cowtext window opens on the
   title screen.
3. **A.2 — main throwaway project** (sections B–E, G, H):

   ```powershell
   mkdir C:\_wo13test
   Set-Content C:\_wo13test\notes.md "# Notes`n`nScratch."
   ```

   Open it (**Open folder** → `C:\_wo13test`). This is a bare folder with no
   `.cowtext/graph.json` yet, so nothing has migrated — section F needs its
   own separate project with a genuine pre-v5 graph, built next.
4. **A.3 — a second, pre-migration project** (section F only). Close the app
   or use a second window; hand-author a v4 graph so the migration banner has
   something real to report:

   ```powershell
   mkdir C:\_wo13migrate\.cowtext
   mkdir C:\_wo13migrate\context
   Set-Content C:\_wo13migrate\context\house-rules.md "# House rules`n`nNever commit to main."
   Set-Content C:\_wo13migrate\context\old-task.md "# Old task`n`nShip the thing."
   Set-Content C:\_wo13migrate\context\lookup.md "# Lookup`n`nSome reference material."
   ```

   ```powershell
   $graph = @'
   {
     "version": 4,
     "projectName": "Migrate test",
     "nodes": [
       { "id": "n1", "title": "House rules", "role": "rules", "brief": "Hard rules.", "filePath": "context/house-rules.md", "readOrder": 1, "pinned": true, "position": { "x": 0, "y": 0 } },
       { "id": "n2", "title": "Old task", "role": "task", "brief": "A task node.", "filePath": "context/old-task.md", "readOrder": 2, "pinned": false, "position": { "x": 260, "y": 0 } },
       { "id": "n3", "title": "Lookup", "role": "reference", "brief": "Reference material.", "filePath": "context/lookup.md", "readOrder": 3, "pinned": false, "position": { "x": 520, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "n2", "target": "n3", "kind": "conflicts-with" },
       { "id": "e2", "source": "n3", "target": "n2", "kind": "conflicts-with" }
     ],
     "compileTargets": ["claude"]
   }
   '@
   Set-Content C:\_wo13migrate\.cowtext\graph.json $graph
   ```

   Do **not** open this project yet — section F opens it fresh so the
   migration banner fires on first load.
5. **A.4 — a third, hand-authored v5 project** (section D's fix-round checks
   only: D15 deprecated-node deny, D7 `contradicts` normalization on the
   `updateEdge` path, D5/D6 always-budget resolver). Hand-authoring a v5
   graph directly (no migration) is the only way to reach two states the UI
   itself cannot produce: a `command`-role node with an illegal
   `rootLoad: "always"` (the wizard locks this away — §C42 below — so only
   stale/pre-fix data or a hand edit can carry it), and a node deprecated
   with no migration pass involved.

   ```powershell
   mkdir C:\_wo13edge\.cowtext
   mkdir C:\_wo13edge\context
   Set-Content C:\_wo13edge\context\root-rule.md "# Root rule`n`nAlways-loaded root for the budget-resolver check."
   Set-Content C:\_wo13edge\context\transitive-arch.md "# Transitive arch`n`nReached only via an unguarded import from Root rule -- never marked Always itself."
   Set-Content C:\_wo13edge\context\stale-command.md "# Stale command`n`nSimulates pre-fix data: a command-role node whose wire rootLoad says always, which the wizard itself could never produce."
   Set-Content C:\_wo13edge\context\deprecated-doc.md "# Deprecated doc`n`nHand-marked deprecated for the D15 deny-precondition check."
   Set-Content C:\_wo13edge\context\live-linker.md "# Live linker`n`nDraws a pre-existing structural edge into the deprecated node, for the lint no-double-report check."
   ```

   ```powershell
   $graph2 = @'
   {
     "version": 5,
     "projectName": "Edge edge-cases",
     "nodes": [
       { "id": "n1", "title": "Root rule", "role": "rule", "brief": "Always-loaded root.", "filePath": "context/root-rule.md", "readOrder": 1, "rootLoad": "always", "position": { "x": 0, "y": 0 } },
       { "id": "n2", "title": "Transitive arch", "role": "architecture", "brief": "Reached only transitively.", "filePath": "context/transitive-arch.md", "readOrder": 2, "position": { "x": 260, "y": 0 } },
       { "id": "n3", "title": "Stale command", "role": "command", "brief": "Illegal stale rootLoad from pre-fix data.", "filePath": "context/stale-command.md", "readOrder": 3, "rootLoad": "always", "position": { "x": 520, "y": 0 } },
       { "id": "n4", "title": "Deprecated doc", "role": "architecture", "brief": "Marked out of date by hand.", "filePath": "context/deprecated-doc.md", "readOrder": 4, "deprecated": { "replacedBy": "n1" }, "position": { "x": 780, "y": 0 } },
       { "id": "n5", "title": "Live linker", "role": "rule", "brief": "Draws a structural edge into the deprecated node.", "filePath": "context/live-linker.md", "readOrder": 5, "position": { "x": 1040, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "n1", "target": "n2", "kind": "imports" },
       { "id": "e2", "source": "n5", "target": "n4", "kind": "imports" }
     ],
     "compileTargets": ["claude"]
   }
   '@
   Set-Content C:\_wo13edge\.cowtext\graph.json $graph2
   ```

   Do **not** open this project yet — section D opens it fresh.
6. **Open WebView devtools** now and leave them open (right-click canvas →
   Inspect Element, or `Ctrl+Shift+I`) — several steps below check the
   Network/Console tab.

---

## B. The 7 acceptance defects

Open `C:\_wo13test` for this whole section.

### B1 — Defect 1: git init reachable from three places

7. Right-click the project row in the Hierarchy.
   *Expected:* a **Git…** item is in the context menu.
8. Click the project row (not right-click) to select it, so the Inspector
   shows the project panel. Scroll to the **Git** section.
   *Expected:* a real **Git…** button — not the sentence "Manage git from the
   project row's context menu." Confirm mechanically:

   ```powershell
   cd D:\Moo.exe\Cowtext
   ```

   `rg "Manage git from" src/` → zero hits.
9. Look at the top bar (header row above the canvas).
   *Expected:* a git-branch icon button is present, opening the same Git
   wizard as the two entry points above.

### B2 — Defect 2: chosen branch is the default branch after init (two root causes)

10. From any of B1's three entry points, open **Git…** on `C:\_wo13test` (a
    fresh, non-repo folder). Pick a custom branch name, e.g. `trunk`, and
    **Initialize**.
    *Expected:* the wizard falls through to the `.gitignore` composer with a
    `repo` badge. Verify on disk:

    ```powershell
    Get-Content C:\_wo13test\.git\HEAD
    ```

    *Expected:* `ref: refs/heads/trunk` — not `master` or `main`. This is the
    **fresh commitless repo** root cause: before WO13, `git_status`'s
    `--is-inside-work-tree` probe could not report a branch name on an unborn
    HEAD at all.
11. **Nested-repo root cause.** Close the app. Make a folder nested inside an
    *existing* git repo (this very Cowtext checkout is one):

    ```powershell
    mkdir D:\Moo.exe\Cowtext\_wo13nested
    ```

    Open `D:\Moo.exe\Cowtext\_wo13nested` as a Cowtext project, then open
    **Git…**.
    *Expected:* the wizard reports **"This project is not a git repository
    yet."** — not silently reporting the *outer* Cowtext repo as this
    project's repo (the pre-fix bug: `--is-inside-work-tree` returned true for
    the outer repo and the nested folder's own git state was never checked).
12. Initialize with branch `feature-x` inside that nested folder.
    *Expected:* `_wo13nested\.git\HEAD` reads `ref: refs/heads/feature-x`, and
    the outer Cowtext repo (`D:\Moo.exe\Cowtext\.git`) is completely
    untouched — check `git -C D:\Moo.exe\Cowtext status` still shows the
    original branch, no new commits, no stray files.

    ```powershell
    Remove-Item -Recurse -Force D:\Moo.exe\Cowtext\_wo13nested
    ```

    Reopen `C:\_wo13test` before continuing.

### B3 — Defect 3: agent-wizard avatar menu opens, not hidden behind the modal

13. Roster bar (or Hierarchy Agents section) → **+** to open the New agent
    dialog.
14. Click the **44px avatar** at the top-left of the left pane.
    *Expected:* a menu opens (**Upload image…**, **Reset seed**) and is
    **visibly on top of the modal**, fully clickable — it must not paint
    behind the dialog. Click **Reset seed**.
    *Expected:* the menu closes and the identicon changes to a new pattern.
15. With the dialog still open, click into the **Tools** field/dropdown (if
    reachable in this mode) and confirm it too renders above the dialog, not
    behind it — this is the same `ContextMenu` `layer` bug's second known
    latent site.
16. Close the dialog (✕ or Escape) without creating anything.
    *Expected:* dialog closes cleanly, no crash, canvas unchanged.

### B4 — Defect 4: avatar stops changing while typing Name

17. Reopen the New agent dialog. Note the current identicon pattern.
18. Type a 20+ character name into **Name**, one character at a time,
    watching the avatar after every few keystrokes.
    *Expected:* the identicon **never changes** while typing Name — it stays
    exactly what it was when the dialog opened.
19. Click the **pencil** icon next to `name: <slug>` to open the File field,
    and edit it directly (type a character).
    *Expected:* the avatar **does** change now — editing the File field
    directly is the one thing (besides Reset seed) allowed to reseed it.
20. Close without creating anything.

### B5 — Defect 5: Assemble shows a real 3-step stepper, not a blink

21. Create a plain node (double-click canvas → pick **Rule** → give it a
    title and a one-line brief) and tick whatever toggle queues an Assemble
    job (or select the node afterward and press **Assemble** in the
    Inspector's Assemble section).
22. Watch the node card on canvas the instant the job starts.
    *Expected:* a **3-segment bar** under the card, segments corresponding to
    `starting → running → writing`. Exactly one segment blinks
    (`animate-hard-blink`) at a time — the *current* phase — not the whole
    bar blinking uniformly with nothing behind it.
23. Hover the bar (or the card).
    *Expected:* a tooltip/title reads `Assembling — <phase>` naming the
    actual phase word (`starting`, `running`, or `writing`), not a static
    "Assembling…".
24. Watch for a live **mm:ss elapsed** readout next to or on the card while
    the job runs.
    *Expected:* the timer visibly increments in real time. **There is no
    percentage anywhere** — confirm none is shown; a percentage would be
    invented, since assemble is a one-shot non-streaming call with no
    denominator. Do not treat the absence of a percentage as a bug.
25. Let the job finish.
    *Expected:* the bar disappears, status settles to `assembled`.

### B6 — Defect 6: Markdown preview updates after assemble (plain + agent), unsaved-edit banner — including the FIXED continuous-typing race

26. Select the node from B5 (now assembled). Switch the Inspector to its
    **Markdown** tab (segmented control, or right-click header → **Open
    markdown tab**).
    *Expected:* the tab shows the just-assembled content — not stale content
    from before the assemble ran.
27. **Agent half, Markdown tab.** Adopt or create an agent-backed node. With
    that agent selected in the Inspector's **Agent** tab, trigger Assemble on
    it (brief → full system prompt). While it runs, switch to the
    **Markdown** tab for the same node and watch it.
    *Expected:* once the job reaches `assembled`, the Markdown tab's content
    updates to the new body automatically — no reselect required.
28. **FIXED — the exact regression repro that was the riskiest open item
    (tester's own finding #2, previous audit round).** Select the same
    agent-backed node and stay on its **Agent** tab, with the **System
    prompt** field visible. Trigger a fresh **Assemble** on this node from
    the Inspector's Assemble section. While it runs, **type continuously
    into the System prompt field, never leaving a pause longer than 500 ms**
    between keystrokes (this keeps the autosave debounce from ever firing,
    so the draft is continuously dirty for the whole job) — keep typing
    until you see the card's phase bar (B5) reach `writing`/finish.
    *Expected:* not one keystroke is lost, the field never remounts (cursor
    position is never reset, no visible flicker), and your buffer is
    completely intact once you stop typing. This is `reloadAgentFromDisk`
    checking dirty state atomically inside one `set()` call: while dirty it
    never touches the draft and never bumps `reloadNonce` (which is what
    would force a CodeMirror remount). Before the fix, this exact
    interaction — assembling while typing without pausing — could destroy
    the buffer; it must now pass cleanly.
29. Now pause typing (job already finished from step 28).
    *Expected:* the same amber banner the Markdown tabs use appears in the
    **Agent tab itself** (not just the Markdown tab): **"Assemble changed
    this file on disk. Your unsaved edits are still here."** with **Reload
    from disk** and a dismiss (✕). This is the surface that was previously
    untested (the old manual explicitly excluded the Agent tab from this
    check) and is exactly where the fix lives.
30. Click **Reload from disk** on the Agent-tab banner.
    *Expected:* the System prompt field now shows the freshly assembled
    content, the banner disappears, your typed text is gone (you chose to
    discard it).
31. **Unsaved-edit path, plain node Markdown tab (do not clobber).** Select a
    plain node's Markdown tab, type a few characters into the editor (do
    **not** click Save), then trigger a fresh Assemble on that same node from
    the Inspector's Assemble section. Wait for it to finish.
    *Expected:* the same amber banner appears, your typed characters are
    **still in the editor**, not silently discarded.
32. Click **Reload from disk**.
    *Expected:* the editor now shows the assembled content, banner
    disappears, your typed characters are gone.
33. Repeat 31–32 for an **agent** node's **Markdown** tab (not the Agent
    tab — steps 28–30 above already covered that surface) — same banner,
    same "Reload from disk" recovery, same non-clobbering behavior.

### B7 — Defect 7: edge label after recolouring — legible, tinted, not shoved below (STILL OPEN — Marty's walk is the only thing that settles this)

34. Draw two edges into the same node close enough that their labels would
    collide (e.g., two `references` edges into one target from two different
    sources positioned near each other), so both chips are visible and one is
    displaced.
35. Select one wire, open its color picker in the Inspector's edge panel (or
    right-click → colour), and change it to a distinct colour (e.g., amber or
    violet).
    *Expected:* the wire's label chip **immediately** takes on the same tint
    as the wire (border and text colour match), and is **legible** — not
    washed-out grey.
36. Look at the vertical position of the two colliding chips.
    *Expected:* they are split — **one above the line, one below** — not both
    displaced downward.
37. **The investigative step Marty specifically asked for — NOT settled by
    code review, THIS is the walk that decides it.** Before recolouring,
    note the exact pixel position of the label chip. Recolour the wire and
    watch closely (screen-record or slow it down) whether the chip **moves
    position** at the same moment it recolours, or only recolours in place.
    The fix round repaired two *proven* causes (a washed-out chip colour, and
    an always-downward displacement) but could **not** prove or disprove
    that recolouring itself moves the label — that half shipped as a stated
    assumption (no re-measure logic is wired to a pure colour change, by
    inspection), not a verified fact.
    *Expected per the code audit:* the chip should **only recolour**, not
    move. **If the chip visibly moves at the moment of recolouring, that is
    a genuine third cause and must be reported as a new finding** — this is
    explicitly Marty's call to make, not something this manual or the fix
    round can certify from a sandbox. Log the result either way.

---

## C. Node taxonomy refactor (14 roles, 13 pickable)

Continue in `C:\_wo13test`.

38. Double-click empty canvas to open the Node Wizard.
    *Expected header:* **① Identity ② Load ③ Brief ④ Confirm**.
39. **Never-blank preview.** With nothing typed, look at the right pane.
    *Expected:* a full worked example is rendered — destination path,
    frontmatter/body, load sentence, token estimate — **never** the sentence
    "Nothing to preview yet." Change the selected type tile (e.g., from Rule
    to Command) with the form still empty.
    *Expected:* the worked example changes instantly to the new type's
    example — still never blank.
40. **All 13 tiles, no disclosure.** Count the visible tiles under
    **Constraints / Structure / Process / Knowledge**.
    *Expected:* 13 tiles, all visible without expanding anything: Rule,
    Invariant, Trap (constraints); Architecture, Decision (structure);
    Workflow, Command, Skill, Env, Tool (process); Glossary, Example, Style
    (knowledge). `Agent` is **not** among them (it has its own creation path).
41. **microExample as instance.** Read each tile's dimmed mono line.
    *Expected:* every one is a concrete instance ("Never commit directly to
    main"), never an abstract definition ("a directive to the agent").
42. **Default selection.** Reopen the wizard fresh.
    *Expected:* **Rule** is preselected, not the first tile in DOM order.
43. **Filter dims, does not remove.** Type `env` into the filter field
    (placeholder `Filter types…`).
    *Expected:* the `Env` tile stays highlighted/full-opacity; every
    non-matching tile visibly **dims** (lower opacity) but stays in its grid
    position — the grid does not reflow. Clear the filter.
44. **Disambiguator.** Click **"What's the difference between Rule, Invariant
    and Style?"**.
    *Expected:* an inline three-row comparison expands in place (no second
    modal, no hover tooltip that vanishes). Click again to collapse.
45. **Type change preserves body.** Select **Rule**, type a title and a
    multi-line body into step 3's Brief editor. Go back to step 1 and switch
    to **Workflow**.
    *Expected:* the title and body are unchanged when you return to step 3 —
    nothing was cleared by the type switch.
46. **Locked-load badge.** Select **Command** on step 1, advance to step 2.
    *Expected:* no segmented Always/On-demand control — instead a read-only
    badge reading **"Commands only run when you call them."** Switch to
    **Skill**.
    *Expected:* badge reads **"Skills load themselves when they're
    relevant."**
47. **Root load control.** Select **Architecture** (unlocked), advance to
    step 2.
    *Expected:* a two-option control, **Always** / **On demand**, with the
    one-line consequences "In context for every request." / "Agent reads it
    when relevant." — not four options; glob/invoke policy is set on edges,
    not here.
48. **Weight guard.** With Architecture + Always selected, paste a body over
    ~1600 characters (≈400 tokens) into step 3.
    *Expected:* back on step 2 (or visible in the right pane depending on
    which step you're on), an inline amber suggestion appears: `≈NNN tokens,
    always in context — that's on every request.` with a **Switch to On
    demand** link. Click it.
    *Expected:* the root-load control flips to On demand and the suggestion
    disappears — this never blocked you.
49. **Example role, good/bad round trip.** Step 1 → **Example**. Step 3 shows
    a two-field good/bad editor.
    *Expected headings when you inspect the compiled body (right pane):* `##
    Good` and `## Bad`. Fill in both fields, go back to step 1, forward again
    to step 3.
    *Expected:* the same content re-splits into the same two fields — no
    drift, no merge artifacts.
50. **No write before Confirm.** With a node filled in on step 3, check the
    project tree:

    ```powershell
    Get-ChildItem -Recurse C:\_wo13test\context 2>$null
    ```

    *Expected:* no new file exists yet. Advance to step 4 (Confirm) — diff
    list appears. Still no write:

    ```powershell
    Get-ChildItem -Recurse C:\_wo13test\context 2>$null
    ```
51. Click **Confirm**.
    *Expected:* toast **"Node created"** with an **Undo** action; the file
    now exists on disk matching the diff shown.
52. Click **Undo** on the toast.
    *Expected:* the file is gone from disk again, the node is gone from
    canvas — exact prior state restored (nothing existed before, so nothing
    remains).
53. **Mid-write failure leaves the tree unchanged.** Repeat node creation to
    step 4. Before clicking Confirm, make the `context` directory read-only:

    ```powershell
    attrib +R C:\_wo13test\context
    ```

    Click **Confirm**.
    *Expected:* an error is reported naming the failing path; the project
    tree is unchanged (no partial file). Remove the read-only flag before
    continuing:

    ```powershell
    attrib -R C:\_wo13test\context
    ```

### C.CRITICAL — fix-round finding D3: wizard step 4 Confirm no longer silently overwrites a hand-written `CLAUDE.md`

**This is the single most important step in the manual.** It is the app's
core promise — "nothing is written until you approve it on Confirm" — and it
was provably broken: before this fix, `NodeWizard.tsx`'s step-4 Confirm
batch-wrote *every* changed compile-derivative file with no per-file
approval and no handwritten gate, so creating one ordinary node could
silently overwrite a hand-written `CLAUDE.md` with zero warning.
`CompileModal.tsx` (the top-bar Compile flow, tested separately in §G) was
never affected — only the wizard's own step-4 batch write was broken.

54. Hand-write a `CLAUDE.md` at the project root with **no** GENERATED
    header — simulating a real user's hand-authored file:

    ```powershell
    Set-Content C:\_wo13test\CLAUDE.md "# Hand-written CLAUDE.md`n`nDo not overwrite me. No GENERATED header on this file."
    ```
55. Double-click canvas → New node wizard → pick **Rule**, give it a title
    (e.g. "A new rule") and a one-line brief, advance to step 4 (**Confirm**).
    *Expected:* below the "Creates `context/<file>.md`." summary line, a
    second row appears for `CLAUDE.md` under the additional-files list,
    badged **handwritten** (danger-red badge), checkbox **UNCHECKED** by
    default. Directly under that row, a danger-tinted inline banner reads
    exactly: `CLAUDE.md: handwritten file — Cowtext did not generate this.
    Approving will overwrite it.` The summary line reads `0 of 1 additional
    file will be written.` — no "overwrites" clause, since nothing is
    ticked.
56. Click **Confirm** without ticking the `CLAUDE.md` checkbox.
    *Expected:* toast **"Node created"**. Check disk:

    ```powershell
    Get-Content C:\_wo13test\CLAUDE.md
    ```

    *Expected:* byte-identical to what you wrote in step 54 — `CLAUDE.md`
    was **never touched**, even though creating the node changed what
    `CLAUDE.md` would compile to.
57. Repeat: create a second Rule node, advance to step 4. This time **tick**
    the `CLAUDE.md` row's checkbox before Confirm.
    *Expected:* the summary line updates live to `1 of 1 additional file
    will be written — overwrites 1 handwritten file.`
58. Click **Confirm**.
    *Expected:* toast **"Node created"**. Check disk:

    ```powershell
    (Get-Content C:\_wo13test\CLAUDE.md -TotalCount 1)
    ```

    *Expected:* the first line is now the exact GENERATED header —
    `<!-- GENERATED BY COWTEXT — edit the graph or context/*.md, not this
    file -->` — `CLAUDE.md` has been overwritten, exactly as explicitly
    approved. This is the whole point: silent-by-default is CRITICAL-severity
    wrong, opt-in overwrite with a named count is correct.

---

## D. Edge model refactor (5 kinds, guards, legality, `resolveLoad`)

59. Create two plain nodes on canvas (any role). Drag a connection from one to
    the other to open the **KindPicker**.
    *Expected groups, in order:* **Structural** — `imports`, `references`,
    `overrides`, `sequence` (each captioned "changes what lands in the
    file") — then **Advisory** — `contradicts` (captioned "linter only, never
    compiled"). Every row shows a concrete micro-example, not a definition.
60. Pick **imports**, confirm the edge. Right-click the new wire.
    *Expected:* a context menu offering every kind, with the current kind
    checked.
61. **Deny at draw time.** Draw a connection from any node into a `command`-
    role node, opening KindPicker, and try `imports`.
    *Expected:* the `imports` row is **dimmed/disabled** with the reason
    inline: "Commands run when you call them — inlining one removes the point
    of it. Use references." — you cannot select it.
62. **Deny reason during drag, before drop.** Start dragging a connection
    from a node toward a `command`-role node and pause mid-drag without
    dropping.
    *Expected:* the target dims and a reason tooltip appears near the cursor
    **before** you release — not only after the drop is attempted.
63. **Guard + dashed rendering.** Draw an `imports` edge, then via the
    KindPicker's guard affordance (branch icon next to the row) or the
    Inspector's **Guard** control on a selected edge, set a glob guard
    (`src/net/**`).
    *Expected:* the wire renders **dashed** on canvas. Open the Inspector's
    edge panel for it — **Guard** section shows `Glob` selected with the text
    you entered.
64. **Live glob match count — now implemented on both surfaces (FIXED, was
    logged as a spec gap).** With the guard editor from step 63 open, type a
    glob that matches real files in the project (e.g. `context/*.md`).
    *Expected:* directly under the guard text field, `~matches N of M
    tracked files` appears — a live count, rendered identically in the
    KindPicker's draw-time guard editor *and* the Inspector's Guard section
    (`GuardEditor`). Zero is a valid, neutral answer — it is not styled as a
    warning.
65. Clear the field and type a source-only glob, e.g. `src/**`.
    *Expected:* the count reads near-zero (likely `0 of M`) even in a
    project with real `.ts`/`.tsx` source files. **This is correct, not a
    bug** — the count is populated by `scan_project`, which only walks
    `.md` files project-wide, so a glob describing source files will almost
    always undercount against what it actually matches on disk. This is a
    known, documented limitation (typo-catching only), not a defect to log.
66. **`contradicts` is symmetric, no arrowhead.** Draw a `contradicts` edge
    between two nodes.
    *Expected:* the wire renders with a small cross/tension marker at
    **both** ends — no directional arrowhead anywhere on it.
67. Try to draw the reciprocal `contradicts` edge the other direction between
    the same two nodes.
    *Expected:* nothing new is created (no duplicate, no error) — the
    existing edge already covers both directions.
68. **Edge inspector explains resolved load.** Select the `imports` edge
    from step 60 (no guard). Open the Inspector's edge panel.
    *Expected:* one plain sentence naming why the target node is (or isn't)
    always in context, e.g. "This edge is why '<target>' is always in
    context — it's reached by an unguarded import from the always-loaded
    set." — and it names *this* edge as the deciding one when applicable.
69. Select the glob-guarded edge from step 63.
    *Expected:* the sentence instead explains the glob-guarded (`on-glob`)
    policy, not "always".
70. **Legality spot checks.** Try drawing `overrides` from a `glossary`-role
    node to any target.
    *Expected:* denied, reason "A glossary defines words; it doesn't outrank
    rules."
71. Try drawing `imports` into an `architecture`-role node.
    *Expected:* **allowed but warned** — the edge is created; check the
    Problems panel afterward for an `edge-legality-warning` entry quoting
    "Architecture notes are usually long. Inlining puts this in every
    request." verbatim.
72. **`updateEdge` gate check.** Select an existing edge whose kind change
    would be denied by the matrix (e.g. an edge into a `command` node),
    right-click it, and try switching its kind to `imports` via the wire's
    own context menu (not the initial draw).
    *Expected:* the `imports` option is disabled/dimmed exactly as at draw
    time, and selecting it does nothing. **FIXED (D7) — this is now
    enforced at two layers, not one.** Before the fix round, the
    context-menu's dimming was a UI-side courtesy check only, with no
    store-level backstop for kind *changes* the way `addEdge` always had for
    creation — a bypass of that one menu could have written a denied edge
    straight to the graph. `updateEdge` (`store/graph.ts`) now re-runs the
    §7.3 legality gate itself against the patched result and refuses the
    whole update on `deny`, so the real chokepoint every write path goes
    through enforces this, not just the one visible control. §D.D15/D7 below
    exercises this against a genuinely denied target end to end.

### D.D15/D7 — deprecated-node deny precondition + the `updateEdge`/`contradicts` write-path fixes

Close `C:\_wo13test`. Open `C:\_wo13edge` (built in A.4 above) — a v5
graph, no migration involved.

73. **Deny at draw time, deprecated target (FIXED — was scored, now a
    precondition).** Drag a connection from **Transitive arch** (`n2`) into
    **Deprecated doc** (`n4`), opening KindPicker.
    *Expected:* **every one of the five kind rows** (`imports`,
    `references`, `overrides`, `sequence`, `contradicts`) is dimmed/disabled,
    each showing the identical reason in danger-red text: **"That node is
    marked out of date and won't reach the agent."** Before the fix, this
    `@deprecated` rule scored the *lowest* specificity in the table, so
    every one of twelve role-pair rows outranked it — a deprecated target
    could be drawable-into with only a warning, or denied with the wrong
    verbatim reason (e.g. quoting the command-role denial text on a target
    whose actual problem was being out of date). Deprecation is now checked
    as a precondition before any scoring runs, so this reason is correct for
    every kind, unconditionally.
74. **Deny reason during drag, before drop, on the deprecated target.** Start
    dragging from any node toward **Deprecated doc** and pause mid-drag
    without dropping.
    *Expected:* the target dims and the same reason tooltip appears near the
    cursor before release — the "all-kind denial" path (§D62's mechanism)
    applies here too since every kind agrees on the reason.
75. **No double-reporting (FIXED).** Open the Problems panel.
    *Expected:* exactly **one** finding mentions the pre-existing `n5→n4`
    edge (Live linker → Deprecated doc, kind `imports`, built into the A.4
    fixture) — a `structural-edge-into-deprecated` **error** reading exactly:
    `"Live linker" has a imports edge into "Deprecated doc", which is
    deprecated — use "Root rule" instead`. There must be **no second**
    `edge-legality-warning` entry for the same edge. Before the fix, a
    structural edge (`imports`/`sequence`/`overrides`) into a deprecated
    target could be reported by both checks at once — one report per edge
    now, owned solely by `structural-edge-into-deprecated`.
76. **`updateEdge` refuses a kind switch into a deprecated target.**
    Right-click the pre-existing `n5→n4` (`imports`) wire → its own
    kind-switcher context menu.
    *Expected:* every kind option is disabled/dimmed (target is still
    deprecated, so every kind still denies) — confirming §D72's two-layer
    fix end to end against a real deny, not just a hypothetical one.
77. **D7 — `contradicts` endpoint normalization on the `updateEdge` write
    path (FIXED).** Draw a `references` edge from **Stale command** (`n3`)
    to **Root rule** (`n1`) — note the arrow points `n3 → n1` on canvas
    (source `n3` is lexically greater than target `n1`, i.e. NOT already in
    normal form). Right-click this new wire → its kind-switcher context
    menu → select **contradicts**.
    *Expected:* the wire immediately re-renders in `contradicts` style
    (cross markers both ends, no arrowhead).
78. Now try to draw a **new** `contradicts` edge the opposite direction,
    from **Root rule** (`n1`) to **Stale command** (`n3`).
    *Expected:* nothing new is created — no duplicate wire, no error. This
    confirms `updateEdge`'s kind-switch normalized the edge's endpoint order
    to the canonical `source < target` form exactly as `addEdge` always did.
    Before the fix, `normalizeContradicts` ran only on `addEdge`; a
    kind-switch via the context menu (as you just did in step 77) could
    leave a mis-ordered `contradicts` edge that a later save→reload cycle
    would silently reorder — and if a genuine reciprocal existed, collapse
    and delete one edge outright, discovered a reload after the edit that
    caused it. That data-loss window is what this step closes.
79. **Persistence round trip.** Close and reopen `C:\_wo13edge`.
    *Expected:* exactly one `contradicts` edge still exists between
    **Root rule** and **Stale command** — no console errors, no duplicate,
    no silent drop.

### D.D5/D6 — shared always-budget resolver (FIXED — gauge and Problems panel can no longer disagree)

80. Still in `C:\_wo13edge`, look at the top-bar **≈N tok pinned** chip.
    *Expected:* the count reflects **Root rule** (`n1`, `rootLoad: "always"`)
    **and** **Transitive arch** (`n2`, reached only via `n1`'s unguarded
    `imports` edge — never itself marked Always) — both are in the
    always-loaded closure. It **excludes Stale command** (`n3`) entirely,
    even though `n3`'s wire data illegally carries `rootLoad: "always"` — a
    `command`-role node is excluded from the always-closure by role lock
    (D5) regardless of what its own `rootLoad` says. Sanity-check the byte
    math:

    ```powershell
    (Get-Item C:\_wo13edge\context\root-rule.md).Length + (Get-Item C:\_wo13edge\context\transitive-arch.md).Length
    ```

    *Expected:* the chip's token estimate is in the right ballpark for that
    combined byte count (÷4 rounding) — not for all three files' combined
    size.
81. Open the Problems panel.
    *Expected:* no finding anywhere mentions **Stale command** (`n3`) as
    part of the always-loaded set — the linter's own closure
    (`resolve_load::always_closure`, Rust) and the frontend gauge now share
    ONE computation (`alwaysLoadedNodeIds` in `resolveLoad.ts`), so they
    cannot show two different totals for the same graph the way the
    pre-fix local `rootLoad === "always"` gauge check could (it both
    undercounted transitively-reached nodes and overcounted stale
    `command`/`skill` `rootLoad` values like `n3`'s).

---

## E. Agent modal refactor

Reopen `C:\_wo13test`.

82. Roster bar / Hierarchy Agents **+** → New agent dialog.
83. **Description required.** Leave **When to use this agent** empty. Look at
    **Create**.
    *Expected:* Create is disabled (or blocked on click) with an inline
    reason: **"Claude Code skips an agent file with no description
    entirely — it never loads, and nothing but the debug log says why."**
84. Type fewer than ~15 words with no trigger language, e.g. "A senior tech
    lead who reviews things."
    *Expected:* still blocked, different message: **"This description
    doesn't say when to use the agent. The file will be created and valid,
    but Claude Code will never choose to invoke it."** — distinct wording
    from the empty case, and correctly describing the weaker (not "never
    loads") consequence.
85. Type a real trigger-shaped description: "Use this agent when reviewing
    architecture decisions or evaluating infrastructure changes."
    *Expected:* the blocking message clears, Create becomes available.
86. **Identity-shaped warning.** Replace it with "A senior tech lead who
    reviews architecture decisions." (identity framing, not trigger framing).
    *Expected:* a non-blocking warning appears (Create still works) noting
    the description reads as identity rather than a trigger.
87. **When not to use it.** Fill **When to use this agent** with a valid
    trigger description, then fill the second field, **"When not to use
    it"**, with e.g. "refactoring existing code." Look at the right-pane
    preview's `description:` line.
    *Expected:* one joined string: `<when-to-use> Do not use it when
    <when-not-to-use>`. Close and reopen the same agent's editor (after
    creating it) and confirm the two fields split back apart correctly in the
    UI — the join/split round-trips.
88. **System prompt, not Duties.** Confirm the body field is labeled **System
    prompt**, placeholder written in second person ("You are responsible
    for…").
89. Type third-person text: "He reviews the codebase and delegates
    implementation."
    *Expected:* an offer to rewrite to second person appears — it must not
    auto-apply. Dismiss it and confirm your original text is untouched.
90. **Tools — Inherit is default, Restrict reveals the grid.** Look at the
    Tools mode selector.
    *Expected:* **Inherit every tool** is selected by default; no checkbox
    grid is visible. Switch to **Restrict to selected**.
    *Expected:* the grid appears, grouped into three tiers: **Read-only**,
    **Mutating**, **Elevated** — visually distinguished by more than colour
    alone (icon or explicit label). The Elevated tier shows a permanent
    one-line consequence next to it (not a hover-only tooltip).
91. Expand one group (e.g. Mutating).
    *Expected:* it lists the exact tool names it grants (e.g. Write, Edit) —
    not just the group label.
92. **Denylist conflict.** With Restrict mode on, tick a tool (e.g. `Bash`)
    into the Restrict grid, then also add `Bash` to the **disallowedTools**
    input.
    *Expected:* an inline validation message reads exactly: `"Bash" is in
    both lists — the denial wins, so this agent will not have "Bash". Remove
    it from one list.` — not a generic "conflict" message.
93. **No provider dropdown.** Scan the whole left pane.
    *Expected:* no "Anthropic"/provider selector anywhere.
94. **Model radio.** Look at the Model control.
    *Expected:* a radio list — Inherit from the main session (default),
    Haiku, Sonnet, Opus, and "Pin a specific model ID" with a free-text
    field. Create the agent with Inherit selected and check the written
    file:

    ```powershell
    Get-Content C:\_wo13test\.claude\agents\<file>.md | Select-String "model:"
    ```

    *Expected:* **no `model:` line at all** — `inherit` is the format
    default and is omitted, not written literally.
95. **Local-only badges.** Scroll to the bottom group (Nickname, Priority,
    Avatar, Influence-if-present).
    *Expected:* every field here carries a quiet **"local only"** badge with
    a one-line note of what it does affect (e.g. Priority: "does not affect
    dispatch order or compiled context"). No field anywhere in the modal is
    left unmarked and also absent from the preview — check by comparing every
    visible field against the live preview pane.
96. **Footer lists every path.** Toggle the memory-folder option ON, look at
    the footer.
    *Expected:* it lists **both** paths that will be created — the agent
    `.md` file and the memory directory — not just the agent file.
97. Click **Create**.
    *Expected:* toast **"Agent created"** with **Undo**. Click **Undo**.
    *Expected:* the agent file (and any memory folder just created) is
    removed; the toast/detail line notes the memory folder is **not**
    force-deleted if it pre-existed with content (not applicable to a fresh
    one here, but note the wording).

---

## F. Migration surface + lint

Close `C:\_wo13test`. Open `C:\_wo13migrate` (built in A.3) — this is its
**first** load since the hand-authored v4 graph was written.

98. Watch the top of the app on load.
    *Expected:* a **migration banner** appears reading `3 nodes migrated to
    the new format · 2 need review` (exact counts may vary slightly by
    implementation detail — the two role-changed nodes, `Old task` →
    `workflow` and `Lookup` → `architecture`, must both be flagged;
    `House rules` → `rule` must **not** be flagged, since a pure rename is
    not ambiguous).
99. Click **Details** on the banner.
    *Expected:* a breakdown line appears, e.g. `1× task→workflow`,
    `1× reference→architecture`, plus an edge-conversion count for the
    `conflicts-with` pair.
100. Click **Review N** on the banner.
     *Expected:* the canvas pans to and selects the flagged nodes; both
     `Old task` and `Lookup` show an amber warning-triangle marker on their
     canvas card.
101. Select the `Old task` node (now role `Workflow`) in the Inspector.
     *Expected:* it shows the `needsReview` state and a way to clear it
     (confirm/correct the role). Clear it.
     *Expected:* the marker disappears from the canvas card immediately.
102. **Persistence across restart.** Close and reopen `C:\_wo13migrate`.
     *Expected:* `Old task`'s cleared flag is still cleared (persisted to
     `graph.json`); `Lookup`'s flag (never cleared) is still present.
103. **Banner dismissal persists too.** Dismiss the migration banner (✕).
     Restart the app, reopen the same project.
     *Expected:* the banner does not reappear. **Known architecture note:**
     this dismissal is implemented via `window.localStorage`, not
     `AppSettings` (the mechanism nearly everything else in this app uses for
     persisted UI state) — functionally it should still work in this manual
     walk, but note it if the banner reappears unexpectedly after clearing
     browser/webview storage, since that is the one path that would break it.
104. **`.cowtext/graph.v4.bak.json` backup.** Check disk:

     ```powershell
     Get-Content C:\_wo13migrate\.cowtext\graph.v4.bak.json | ConvertFrom-Json | Select-Object version
     ```

     *Expected:* `version: 4` — the exact pre-migration bytes, written once by
     the first `write_graph` call after migration (e.g. triggered by step
     101's clear).
105. **`contradicts` collapse.** Select the collapsed `contradicts` edge
     between `Old task`/`Lookup`.
     *Expected:* exactly **one** edge exists between them post-migration (the
     two reciprocal `conflicts-with` edges collapsed into one), rendered with
     no arrowhead per §D66.
106. **Lint — Problems panel.** Open the Problems panel.
     *Expected:* the `contradicts` finding from step 105 is listed as a
     `warning` with message quoting both node titles, e.g. `"Old task"
     contradicts "Lookup"`.
107. Draw a `references` edge into some node twice from the same source (an
     exact duplicate `imports`, per the lint table — use `imports` twice from
     the same source into the same target).
     *Expected:* a **info**-severity `duplicate-imports` finding appears,
     with a one-click fix to drop the redundant edge. Apply the fix.
     *Expected:* the redundant edge is removed and the finding clears; `Ctrl+Z`
     restores it (fix is reversible via existing undo).
108. **Severity filter.** In the Problems panel's severity filter, confirm
     three options are present: error / warning / **info** (not just the old
     two).

---

## G. Manual-walk steps the automated gates cannot cover

Use `C:\_wo13test` (or a fresh scratch project) for this section.

109. **The generated slash command is real — Marty-only, contract §10.5.**
     Create a `Command`-role node with a short body, e.g. "Run the full test
     suite and report failures." Compile to `claude`, confirm, and check
     disk:

     ```powershell
     Get-Content C:\_wo13test\.claude\commands\<stem>.md
     ```

     *Expected:* `---`, `description: <the node's title>`, `---`, the
     GENERATED header, then the body. **Now open Claude Code in
     `C:\_wo13test`** (a real Claude Code session, not this sandbox), type
     `/`, and look for the command in the list under its `description`.
     *Expected:* it is listed and runs. **This one is explicitly Marty's to
     answer, not a sandbox call** — whether `description:` frontmatter is
     required or works either way cannot be verified without real Claude
     Code. If it is not listed, report which form (with or without the
     fence) actually works, since `project-manager` needs the real answer
     for `TERMINOLOGY.md`.
110. **Hand-authored command file is protected.** Before compiling, hand-write
     `C:\_wo13test\.claude\commands\deploy.md` with no GENERATED header (any
     content). Create a `Command`-role node whose file stem is `deploy`
     (`context/deploy.md` or similar, so the derived stem collides). Compile
     and open the diff preview.
     *Expected:* the `deploy.md` entry under `.claude/commands/` is flagged
     **handwritten** and is **not** ticked/written unless you explicitly opt
     in — same idiom as §C.CRITICAL above, this time via the top-bar Compile
     flow (`CompileModal.tsx`) rather than the wizard's own step 4.
111. **`.claude/skills/` is never written by compile.** Create a `Skill`-role
     node with some body. Compile to `claude` and look at the full diff
     preview list.
     *Expected:* **no file under `.claude/skills/` appears anywhere** in the
     preview — a skill's destination file is managed exclusively by the
     Agents rail's skill commands, never by compile.
112. **D11b — handoff-proposed nodes land as `architecture`, not the deleted
     `reference` role.** Open the **Handoff** modal (from wherever a session
     summary/handoff is triggered) and click **Propose node from session…**.
     Review the proposal and commit it.
     *Expected:* the created node's role is **Architecture**. Note: this
     specific fix is not independently observable from the UI alone — a
     client-side safety net in `HandoffNodeProposalModal.tsx` already
     silently substituted `architecture` for any role it didn't recognize
     (including the old `reference` value), so the *visible* outcome is
     unchanged before and after. What changed is that `handoff.rs` itself
     now sends `"architecture"` directly instead of relying on that
     substitution to mask stale data — worth confirming the role is right,
     but do not expect to be able to tell the fix apart from the old
     masked-by-a-safety-net behaviour just by looking.
113. **D11a — the assemble boot prompt says "Always in context", not a dead
     "Pinned" line.** Select a node with its root-load control set to
     **Always** (§C47). Trigger Assemble on it, and in the confirmation
     modal that appears before the call is spent ("review the prompt before
     spending a claude call"), read the raw prompt text.
     *Expected:* a line reads exactly `Always in context: this file is
     included in every request.` Before the fix, this line read from the
     removed `pinned` boolean field (always `false` after the v5 wire
     rename), so it silently never fired for any node since the v5
     migration — now it reads `resolve_load`'s real answer for this node.
114. **Defect 7's actual trigger — repeat from B7 with two full attempts.**
     Do steps 34–37 again on a *different* pair of colliding edges, this time
     recording (screenshot before/after, or note pixel Y) whether the chip
     position changes at the moment of recolouring. Log the result explicitly
     either way — this is the one place a human walk settles something code
     review could not, and it is **explicitly Marty's item**, not something
     this manual can certify pass/fail on its own.

---

## H. WO12 regression — 3 minutes

115. Reopen `C:\_wo13test` (or any project with an existing graph). Compile to
     `claude`.
     *Expected:* diff preview appears, generated file carries the GENERATED
     header.
116. Draw a wire between two nodes, confirm the one-chip-per-wire label,
     port-finger count, and selected-wire-highlight-on-top all still behave.
117. Ctrl+Z / Ctrl+Y a few edits, including a node delete.
     *Expected:* undo/redo still work.
118. Switch to the **Barn** view and back.
     *Expected:* renders, viewport preserved, no console errors — this
     exercises B1's role-set fallout (`propForRole`'s 14-way exhaustive
     switch) live.
119. Open **Presets** → save one → check the written preset file's version.
     *Expected:* `"version": 5`.
120. Right-click a memory-node card → context menu.
     *Expected:* "Remove from graph" and "Delete file" remain distinct roles,
     both still work.
121. Open the **Orchestrator** tab, select any fleet agent.
     *Expected:* renders, model/tools/skills/memory columns populated as
     before, no console errors from the new field set.

---

## Cleanup

122. Close the app and delete the scratch projects:

     ```powershell
     Remove-Item -Recurse -Force C:\_wo13test, C:\_wo13migrate, C:\_wo13edge
     ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B1 Defect 1 — git init reachable (3 places) | | |
| B2 Defect 2 — chosen branch is default (2 root causes) | | |
| B3 Defect 3 — avatar menu opens above modal | | |
| B4 Defect 4 — avatar stops churning on Name | | |
| B5 Defect 5 — 3-step stepper + elapsed, no blink-only | | |
| B6 Defect 6 — markdown reload, plain + agent, FIXED continuous-typing race, Agent-tab banner | | |
| B7 Defect 7 — label recolours, splits up/down, **STILL OPEN — Marty's call** | | |
| C Node taxonomy (14 roles, preview never blank, no write before Confirm) | | |
| C.CRITICAL — D3 wizard Confirm defaults handwritten files to unticked | | |
| D Edge model (kinds, guards, legality, resolveLoad, glob match count) | | |
| D.D15/D7 — deprecated-node deny precondition, updateEdge/contradicts write-path fixes | | |
| D.D5/D6 — shared always-budget resolver | | |
| E Agent modal (description gate, tools tiers, model radio, local-only) | | |
| F Migration + lint (banner, needsReview, backup, contradicts collapse) | | |
| G Manual-walk items — §10.5 slash command **STILL OPEN — Marty's call**, handwritten guard, no skills emitter, D11a/D11b, Defect 7 repeat **STILL OPEN — Marty's call** | | |
| H WO12 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
