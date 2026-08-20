# WO10 Manual Test Script — Canvas legibility, Inspector components, Project suite

Hand-run test manual for WO10 (contract `docs/design/WO10_CONTRACT.md`), which
implements all sixteen items of the 08/20 09:45AM brainstorm list plus the four
unbuilt items from 08/19 2:10PM. Run it top to bottom in one sitting — sections
C onward reuse the graph built in section B, and section K deliberately runs
last because it creates a second project.

Every step names the real control and the exact expected result. If reality
differs, that is a bug (or this manual is stale; either way, note it).

Written against the working tree as of 2026-08-20, on top of `ec7c1ba`. Gates at
authoring time: `npm run build` clean, `npm run lint` 0 errors,
`cargo clippy --all-targets -- -D warnings` clean, `cargo test` 553 passing,
66/66 invoke commands reachable.

**Time budget:** ~45 min for A–J, plus ~10 min for K (project suite), plus the
4-minute regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything is on 1420, `tauri dev`
   fails rather than picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite on :1420, cargo builds, the Cowtext window opens on the
   "Open a project" empty state.
3. **Make a throwaway test project** (do NOT use a real one):

   ```powershell
   mkdir C:\_wo10test
   Set-Content C:\_wo10test\notes.md "# Notes`n`nScratch."
   ```

4. **Do not open it yet** — section K needs the empty state, but section B needs
   a project. Open it now via **Open folder** → `C:\_wo10test`, and section K
   will close it again.
   *Expected:* workspace opens, empty canvas, file rail titled **Hierarchy**
   showing `notes.md`.
5. **Open WebView devtools** (right-click canvas → Inspect Element, or
   `Ctrl+Shift+I`). Sections C and G want it for exact pixel readings; there is
   an approximate fallback noted inline at each step that needs it.

---

## B. Build the test graph

### B1. Five cards

6. Double-click empty canvas. In the New Node Wizard, **look at the role grid on
   step 1 before doing anything else** (this is item 9).
   *Expected:* every role tile's description sits **inside** its own tile,
   ellipsised if too long. **FAIL** if any description spills past the tile's
   right edge into the neighbouring column or outside the grid.
7. Create five nodes, one at a time, named `Rules`, `Arch`, `Api`, `Task`, `Hub`
   — give `Hub` the role **agent** and the others any role. Accept the default
   paths.
   *Expected:* five cards on the canvas.
8. Drag them into a rough column with `Hub` alone on the right.

### B2. Wire them

9. Drag from `Rules`' right-hand pin block to `Hub`'s left-hand socket bay.
   Repeat from `Arch`, `Api` and `Task`.
   *Expected:* four wires, all landing on `Hub`'s input.
10. Drag one more wire from `Hub`'s output back to `Task`'s input.
    *Expected:* five wires total.

---

## C. Connector pins == connections (item 3)

11. Look at `Rules`' **output** block (right edge).
    *Expected:* exactly **one** contact finger, in a short block roughly 12px
    tall. Not five fingers, not an empty 44px bay.
12. Look at `Rules`' **input** block (left edge) — it has no incoming wires.
    *Expected:* exactly **one** finger. A port with no connections still shows
    one, so it stays visible and aimable.
13. Look at `Hub`'s **input** block.
    *Expected:* exactly **four** fingers (four incoming wires), evenly spaced,
    block roughly 36px tall. Each of the four wires terminates on a **different**
    finger — no two wires share a contact.
14. Wire a fifth edge into `Hub` (drag from `Task`'s output to `Hub`'s input
    again — if it refuses as a duplicate, create a sixth node and wire that).
    *Expected:* `Hub`'s input block grows to **five** fingers and its height to
    **exactly 44px** (devtools: select the handle, read the computed height —
    this is the frozen WO09 G1 value and the regression check that the amendment
    is a generalization, not a redesign).
15. Delete that fifth edge (right-click it → Delete edge).
    *Expected:* the block shrinks back to four fingers. Wires re-land on
    contacts, still one each.
16. Hover any card.
    *Expected:* **all** of that card's fingers turn amber together. Hover a port
    itself: they turn scarf blue. Never both at once.

---

## D. Selected node highlights its wires (item 1)

17. Click `Hub`'s card.
    *Expected:* `Hub` gets the accent marquee, **and all five wires touching it
    change** — a lighter accent-border colour, one pixel thicker. Wires not
    touching `Hub` (if any) stay their kind colour.
18. Click `Rules`.
    *Expected:* only the one wire `Rules ⇄ Hub` is emphasised now; the rest of
    `Hub`'s wires drop back to rest.
19. Click empty canvas.
    *Expected:* every wire back to its kind colour. No wire is left stuck in the
    highlighted state.

---

## E. Selected wire paints on top (item 2)

20. Drag `Api` so its wire visibly **crosses** two other wires.
21. Click the crossing wire directly (on the line, not near a card).
    *Expected:* it turns full accent, its arrowhead turns accent too, and at
    every crossing point it is drawn **over** the other wires — you can follow it
    end to end without losing it.
22. With that wire still selected, open the **Problems panel** or the Inspector's
    Relations grid on a node and click a relation row to change the selection
    from outside the canvas.
    *Expected:* the canvas selection follows. (This is the store→canvas direction
    that used to be one-way; a selection made outside the canvas that does not
    light up on the canvas is a **FAIL**.)

---

## F. One label per wire, no overlap (item 5)

23. Look at every wire's label.
    *Expected:* **exactly one chip per wire** — a small icon plus one word:
    `Reads` for imports, `Refers` for references, `Then` for sequence, `Controls`
    for overrides, `Replaces` for supersedes, `Conflicts` for conflicts-with.
    Never two chips on one wire.
24. Right-click a wire → set its kind to **conditional**. Select it, and in the
    Inspector's **Edge** section type `src/net/**` into Condition.
    *Expected:* the chip reads `if src/net/**`. Type a long sentence instead.
    *Expected:* the chip clips with an ellipsis at ~18 characters and the full
    text is in the tooltip — it never grows wide enough to cover a card.
25. In the Inspector, put a Note on that edge.
    *Expected:* the note **replaces** the condition text in the same single chip.
    Still one chip.
26. Drag cards until several wires bunch tightly together.
    *Expected:* the chips **separate vertically** rather than stacking on top of
    each other. **FAIL** if any two chips visibly overlap.
27. Drag the cards apart again.
    *Expected:* chips settle back onto their own wires. No chip is stranded far
    from the wire it belongs to.

---

## G. Editable wire path (item 4)

28. Select any wire with at least one corner in it.
    *Expected:* small 9px accent squares appear at the **middle of each interior
    segment**. There is **no** handle on the first or last segment (the stubs
    into the connectors).
29. Drag one handle sideways (vertical segment) or up/down (horizontal segment).
    *Expected:* the wire follows the pointer live, stays fully orthogonal (no
    diagonals), and the ends stay plugged into their connectors.
30. Release.
    *Expected:* the bend persists. The Inspector's **Path** section now says
    `N bends` instead of `auto`.
31. Click the handle without moving it (or move it 1–2px).
    *Expected:* nothing changes, and **Ctrl+Z does not undo something unrelated**
    — a click is not an edit.
32. Move the card at either end of the hand-routed wire.
    *Expected:* the endpoints follow the card; the bend stays where you put it.
33. **Persistence:** close the app, `npm run tauri dev` again, reopen
    `C:\_wo10test`.
    *Expected:* the bend is still there. Inspect `.cowtext/graph.json`:

    ```powershell
    Get-Content C:\_wo10test\.cowtext\graph.json | Select-String -Pattern 'version|waypoints'
    ```

    *Expected:* `"version": 4` and a `"waypoints"` array on that one edge only.
    Edges you never touched must have **no** `waypoints` key at all.
34. Select the hand-routed wire → Inspector **Path** → **Reset path**.
    *Expected:* it snaps back to the automatic route, the hint returns to `auto`,
    and the button greys out. The `waypoints` key disappears from `graph.json` on
    the next save.

---

## H. Wire colour (item 13)

35. Select any wire → Inspector → **Appearance**.
    *Expected:* seven swatches. The first ("Kind") shows that edge kind's own
    colour and is currently selected.
36. Click the amber swatch.
    *Expected:* the wire **and its arrowhead** both turn amber. A line that
    recolours while its arrowhead stays neutral is a **FAIL** (that is the
    marker-def path not being wired).
37. Select the node at one end of that wire.
    *Expected:* the related-wire highlight **wins** over the colour override —
    emphasis outranks decoration. Deselect: amber returns.
38. Reload the project (as in step 33).
    *Expected:* the colour survives. `graph.json` shows `"color": "amber"` — a
    palette **key**, not a hex.
39. Set it back to **Kind**.
    *Expected:* the `color` key disappears from `graph.json` entirely (absence,
    not the literal string `"default"`).

---

## I. Node plates (items 6, 14, 15)

40. Look at the four memory cards.
    *Expected:* each has its read-order number stamped in the top-right corner.
41. Look at the `Hub` **agent** card.
    *Expected:* **no read-order number anywhere on it.** This is item 6.
42. Select `Hub` → Inspector → **Metadata**/**Context**.
    *Expected:* the agent panel shows Position, Context (Pinned only — no Read
    order field), Relations, Assemble, Actions.
43. In the Hierarchy's **Agents** section, open `Hub`'s agent and set its model
    to `claude-haiku-4-5-20251001`.
    *Expected:* the card's nameplate reads **`Haiku-4.5`**, not `claude-h…`.
    Hover it: the tooltip shows the full id.
44. Set the model to `claude-fable-5`.
    *Expected:* nameplate reads `Fable-5`. Set it to `inherit`: reads `inherit`.
45. Give the agent a **nickname** in the agent editor (e.g. `Boss`).
    *Expected:* the card shows `"Boss"` in quotes directly under the title, and
    the `agent · <name>` identity line above the title is unchanged.
46. Clear the nickname.
    *Expected:* the quoted line disappears entirely — not an empty pair of quotes.

---

## J. Viewport, sync and the Inspector (items 7, 8, 10, 11, 12, 16)

### J1. Spawn and focus

47. Scroll/pan the canvas far away from every card (use the minimap to confirm
    you are in empty space).
48. In the Hierarchy, click the **adopt** button on `notes.md`.
    *Expected:* the new card appears **in the middle of your current view**, not
    back at the origin. This is item 7.
49. Pan far away again, then click a Hierarchy row whose node is off-screen.
    *Expected:* the canvas **pans to it** (smoothly, ~200ms) and the card is
    selected. This is item 8.
50. Click a Hierarchy row whose card is **already visible**.
    *Expected:* the canvas does **not** move. Selection changes only. A view that
    jumps on every click is a **FAIL**.

### J2. Three-way sync (item 10)

51. In the Hierarchy's Agents section, click the `Hub` agent row.
    *Expected:* the card is selected on the canvas, and the Inspector shows the
    **agent node** panel (avatar, frontmatter fields).
52. Now click empty canvas to deselect, then click the same agent row again.
    *Expected:* the Inspector shows the agent node panel. **FAIL** if it ever
    shows a strip reading "Off the graph — adopt it to wire context edges" for
    this agent — it is plainly on the graph.
53. Create a NEW agent from the Agents section "+" that you do **not** adopt.
    Click its row.
    *Expected:* now the "Off the graph — adopt it" strip **does** appear (this is
    the correct case). Click **Adopt to graph**.
    *Expected:* it lands on the graph and the strip disappears.
54. Click **Adopt to graph** again if it is still reachable, or use the rail's
    right-click → Adopt.
    *Expected:* the menu offers **"Select node on canvas"**, not "Adopt to
    graph", and there is exactly **one** card for that agent. Two cards for one
    file is a **FAIL**.

### J3. Tools dropdown (item 11)

55. Select an agent → agent editor → **Tools** field. Click it.
    *Expected:* a dropdown opens with `*  (every tool)` at the top, then grouped
    headers **Read / Write / Execute / Network / Orchestrate**. Not a bare text
    input.
56. Tick `Read` and `Bash`.
    *Expected:* two chips appear on the trigger.
57. Type `mcp__foo__bar` into the popup's bottom row and press Enter.
    *Expected:* it is accepted as a normal chip (MCP tools cannot be
    enumerated, so free text must still work).
58. Type `bahs` (a typo) and press Enter.
    *Expected:* it is accepted but the chip renders **amber** with a tooltip
    saying tool names are case-sensitive.
59. Tick `*`.
    *Expected:* the other rows dim and a line explains the wildcard already
    grants everything below.

### J4. Memory folder (item 12)

60. Create a fresh agent through the Agents "+" dialog, leaving the memory toggle
    on.
    *Expected:* both files exist with no extra click:

    ```powershell
    Test-Path C:\_wo10test\.claude\agents\<name>.md
    Test-Path C:\_wo10test\.claude\agent-memory\<name>\MEMORY.md
    ```

    Both `True`.
61. Open that agent's editor and look at the **Memory** field.
    *Expected:* the path is shown as text, and there is **no "Create memory
    folder" button** — nothing to press, because it is already done. This is
    item 12.
62. Delete the memory folder by hand, then click **Rescan** in the Hierarchy
    header and re-select the agent.
    *Expected:* now an amber **Create it** button appears. Click it: the folder
    and `MEMORY.md` come back and the button disappears again.

### J5. Inspector components (item 16)

63. Select a memory node.
    *Expected:* the Inspector is a stack of titled, iconed sections —
    **Position, Metadata, Context, Relations, File, Assemble, Actions** — each
    with a collapse chevron. Not one flat column of fields.
64. Look at the section headers' right-hand hints.
    *Expected:* Metadata shows the role, Context shows `pinned` or `#N`,
    Relations shows the edge count.
65. Collapse **Assemble** and **File**.
    *Expected:* they shut; their headers stay visible with their hints.
66. Select a different node, then come back.
    *Expected:* those two are still collapsed.
67. Restart the app entirely and reopen the project.
    *Expected:* still collapsed. (Persisted in `settings.json` as
    `collapsedSections`.)
68. Open the **Position** section and type a new X value.
    *Expected:* the card moves on the canvas as you type. Drag the card instead:
    the X/Y fields update to match.
69. Select a **wire**.
    *Expected:* the Inspector shows **Edge, Appearance, Path, Actions** as the
    same kind of collapsible sections.

---

## K. Project suite (08/19 items 7–10)

Do this section last — it closes the current project.

### K1. New project

70. Close the project (or restart the app) so the **empty state** is showing.
    *Expected:* **three** buttons — `Open folder`, `New project`,
    `Convert existing` — plus the recent-projects list.
71. Make an empty folder and click **New project**:

    ```powershell
    mkdir C:\_wo10new
    ```

    *Expected:* a 3-step wizard opens, step chips reading Folder / Project /
    Create.
72. **Choose folder…** → `C:\_wo10new`.
    *Expected:* it advances to step 2 and the **Name** field is pre-filled with
    `_wo10new`.
73. Fill in a brief, two Requirements (one per line), and two Hard rules. Leave
    the rest empty. Press **Next**.
74. On step 3, read the "Will create" list, then press **Create**.
    *Expected:* the project opens. Check disk:

    ```powershell
    Get-ChildItem C:\_wo10new -Recurse -Force | Select-Object FullName
    Get-Content C:\_wo10new\.cowtext\project.json
    Get-Content C:\_wo10new\context\project.md
    ```

    *Expected:* `.cowtext/project.json` (with `"version": 1`), `context/`,
    `context/project.md`, `.claude/agents/`. The markdown has `# <name>`, the
    brief, a `## Requirements` list, and `## Hard rules` **above** any softer
    section. Empty fields produce **no** empty headings.
75. **Never-clobber check.** Edit `context/project.md` by hand (add a line), then
    open the wizard again from the top bar (the gem icon → **Project
    properties**) and press **Save**.
    *Expected:* your hand-edited line is **kept**, and the rest of the file is
    refreshed from the properties. The properties round-trip: reopen the dialog
    and every field you typed is still there.
76. Delete `context/project.md`, then edit and save the properties again.
    *Expected:* the file is **not** resurrected — you removed it deliberately.
    `.cowtext/project.json` still updates.

### K2. Convert an existing project

77. Make a folder that looks like a real project with hand-written context:

    ```powershell
    mkdir C:\_wo10conv
    Set-Content C:\_wo10conv\CLAUDE.md "# My rules`n`n## Style`n`nTabs, not spaces."
    ```

78. Close the project, then on the empty state press **Convert existing** →
    choose `C:\_wo10conv` → fill the name → **Convert**.
    *Expected:* the project opens **and the Import Review modal opens by itself**,
    proposing nodes parsed out of `CLAUDE.md`.
79. Adopt the proposals.
    *Expected:* they become Memory Nodes. Critically:

    ```powershell
    Get-Content C:\_wo10conv\CLAUDE.md
    ```

    *Expected:* the original file is **unchanged** — converting must never
    overwrite the user's own `CLAUDE.md`.
80. Check the scaffold landed too: `.cowtext/project.json`, `context/`,
    `.claude/agents/` all present.

---

## L. Regression — 4 minutes

81. Reopen `C:\_wo10test`. Compile (top bar) to `claude`.
    *Expected:* diff preview appears; the generated file carries the GENERATED
    header. Nothing about WO10 changed compile.
82. Ctrl+Z / Ctrl+Y a few graph edits.
    *Expected:* undo/redo still work, including undoing a wire-path edit.
83. Open **Presets** → save a preset → check the file:
    *Expected:* `"version": 4`, and the hand-routed edge carries its `waypoints`.
84. Switch to the **Barn** view and back to the canvas.
    *Expected:* the barn renders; returning to the canvas keeps your viewport.
85. Open the **Orchestrator** tab.
    *Expected:* unchanged from WO06.
86. Right-click a card → the node context menu.
    *Expected:* all entries still work, including "Remove from graph" and
    "Delete file", which remain distinct operations.

---

## Cleanup

87. Close the app and delete the scratch projects:

    ```powershell
    Remove-Item -Recurse -Force C:\_wo10test, C:\_wo10new, C:\_wo10conv
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Build the test graph (incl. item 9 wizard overflow) | | |
| C Connector pins == connections — item 3 | | |
| D Selected node highlights its wires — item 1 | | |
| E Selected wire on top — item 2 | | |
| F One label per wire, no overlap — item 5 | | |
| G Editable wire path + v4 persistence — item 4 | | |
| H Wire colour — item 13 | | |
| I Node plates — items 6, 14, 15 | | |
| J1 Viewport spawn + focus — items 7, 8 | | |
| J2 Three-way sync — item 10 | | |
| J3 Tools dropdown — item 11 | | |
| J4 Memory folder — item 12 | | |
| J5 Inspector components — item 16 | | |
| K1 New project wizard — 08/19 items 7, 9, 10 | | |
| K2 Convert existing project — 08/19 item 8 | | |
| L Regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
