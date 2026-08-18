# Task-Board Batch Manual Test Script — Board, Undo, Hierarchy, Producer, Tokens, Barn Hover

Hand-run manual for Marty's 7-item batch (TASKBOARD_BATCH_CONTRACT.md). Written against the
code as of 2026-08-18 (`src/tasks/*`, `src/store/{tasks,tokens,graph}.ts`, `src-tauri/src/tasks.rs`,
`src/scene/hover.ts`). Every step names the real control and the exact expected result.

**Time budget:** ~18 min.

## A. Preconditions (2 min)

1. Throwaway project `C:\_tbtest` with a couple of context nodes on the graph.
2. Create `C:\_tbtest\TASKS.md` with:
   ```
   # Tasks
   - [ ] Wire the API #backend @producer P1
   - [x] Draft the schema #data P2
   ```
3. Leave SPRINT.md / BACKLOG.md / ROADMAP.md absent.

## B. Tasks board (5 min)

1. Top bar → **Tasks**. *Expected:* 1040px modal, four columns TASKS·SPRINT·BACKLOG·ROADMAP;
   TASKS shows 2 cards; the other three columns show a create hint.
2. Card "Wire the API": tag chip `backend`, priority badge **P1** (amber), agent chip
   **producer**; "Draft the schema" has a CHECKED done checkbox.
3. Toggle "Wire the API" done. *Expected:* `TASKS.md` on disk now has `- [x]` on that line
   (check in an editor).
4. Column SPRINT quick-add: type `Ship the board #ui P0`, Enter. *Expected:* `SPRINT.md`
   is created (with a `# Sprint` header) and the card appears with a **P0** (danger) badge.
5. Card menu → **Move to… → BACKLOG**. *Expected:* the line leaves SPRINT.md and lands at
   the end of BACKLOG.md (file created); board refreshes.
6. Filter bar: agent select **Producer**. *Expected:* tasks with `@producer` AND tasks with
   no agent at all remain; text filter narrows further.
7. **External-edit refresh:** with the modal open, append `- [ ] From outside` to TASKS.md
   in another editor and save. *Expected:* the board refreshes itself within ~1.5 s
   (watcher → fs://change → debounced reload), no button pressed.

## C. Undo / redo (3 min)

8. Create a node, drag it, delete it. Press **Ctrl+Z** three times. *Expected:* deletion
   undone → move undone → creation undone (node gone). **Ctrl+Y** replays them forward.
   Top-bar Undo2/Redo2 buttons enable/disable to match.
9. Type several characters into a node Title, blur, then Ctrl+Z once. *Expected:* the whole
   typing burst reverts as ONE step (coalesced), not per keystroke.
10. With focus INSIDE the markdown editor, press Ctrl+Z. *Expected:* CodeMirror's own undo
    fires; the graph does NOT change.
11. Known limit (by design): undo of a node whose FILE was renamed/converted does not
    rename files back — the restored node just shows "missing file".

## D. Rail hierarchy (2 min)

12. Left panel FILES: root files (CLAUDE.md, README.md) listed first flat, then directories
    (`context/`, `docs/`…) as collapsible headers with chevrons, files indented beneath;
    collapse/expand works; AGENTS/SKILLS sections unchanged below.

## E. Producer + tokens (3 min)

13. AGENTS section: **Producer** is ALWAYS the first row. In a project without
    `.claude/agents/producer.md` it renders as a virtual "click to create" row; clicking
    materializes the real file. Rename/delete on producer.md → error "Reserved agent: producer".
14. Top bar shows `≈N tok pinned` (hover title says estimate + ~200k window); pin/unpin a
    node → the number moves. Agent editor identity header shows `≈N tok context`; wiring an
    imports edge from the agent's node to a fat node grows it.
15. Honest limit: per-agent SPENT tokens / real context remaining are NOT shown anywhere —
    they need Block F runtime telemetry; everything visible is labeled ≈.

## F. Barn hover (2 min)

16. Barn view: rest the pointer on the cow ~150 ms. *Expected:* paper bubble "The cow — your
    Claude agent at work"; moves off → hides. Props show "<title> — <role> node (<path>)";
    desk → "The developer — that's you"; door → "Barn door — agents come and go"; in demo
    mode calves show "Calf — subagent #N". Calm mode: bubbles appear/disappear instantly.
17. No sound plays on hover (routine UI is silent by rule).

## G. Regression (1 min)

18. Create node, connect two nodes, Compile preview opens, Agents rail selection still
    drives the Inspector. No layout shifts from lenses/board work.

| Section | Pass/Fail | Notes |
|---|---|---|
| B Board | | |
| C Undo/redo | | |
| D Hierarchy | | |
| E Producer/tokens | | |
| F Barn hover | | |
| G Regression | | |
