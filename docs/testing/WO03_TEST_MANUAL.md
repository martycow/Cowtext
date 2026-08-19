# WO03 Manual Test Script — L1 Moat Hardening

Hand-run test manual for WO03: graph v3 (13 roles, 7 edge kinds, tags/owner),
two new compile targets (copilot/gemini), the importer, the linter/Problems
panel, and `cowtext-cli`. Run top to bottom in one sitting; sections C, E, F,
G, H reuse the project and graph built in section B — section D is the one
exception, building its own separate throwaway project. Written against the
code as of
2026-08-19 (`src-tauri/src/{project,compile,import,lint}.rs`,
`src-tauri/src/bin/cowtext_cli.rs`, `src/canvas/{KindPicker,roleMeta,
RoleGlyphs,MemoryEdge}.tsx`, `src/inspector/{Inspector,ProblemsPanel}.tsx`,
`src/import/ImportReviewModal.tsx`, `src/compile/CompileModal.tsx`). Every
step names the real control and the exact expected result — if reality
differs, that is a bug (or this manual is stale; either way, note it).

**Time budget:** ~55 min full pass (B–G), plus the 2-minute WO02 regression
at the end. Section F (`cowtext-cli`) is a terminal walk, not a UI walk.

**Companion document:** `docs/design/WO03_AUDIT.md` (tech-lead, 2026-08-19)
is an independent adversarial code-review audit that originally returned
**"NO — WO03 does not ship as-is"** (1 CRITICAL, 3 MAJOR, 5 MINOR, 4 NIT
defects). **Mid-way through this tester's session, the owning lanes fixed
D1–D4, D7, D8, and D11 live** — this tester independently watched D1 go from
reproducibly broken to fixed by re-reading the source between checks, not
just trusting a changelog. Section D below describes the CURRENT (fixed)
behavior; a callout inside it documents exactly what the pre-fix defect
looked like, for institutional memory. **Still open from that audit as of
this manual's last edit:** D5 (MINOR, sort-collation mismatch churns
graph.json diffs), D6 (MINOR, strict enum parsing makes a hand-edited
graph.json that the app opens fine hard-fail `lint`/`compile --check`), D9
(MINOR, no differential test pinning lint.rs's and compile.rs's cycle
detectors together), D10 (NIT, stale "contract says 7→12" comments), D12
(NIT, presets silently drop node `meta`), D13 (NIT, nested `@`-imports
resolve root- instead of file-relative) — none of these are exercised as
UI steps in this manual; see the audit doc directly. **Separately, this
tester found one CRITICAL defect the tech-lead audit did not catch** (it's
a build-tooling gap, not a code-review-visible one) — see the blocker below.

---

## ⚠ BLOCKER — read before doing anything else

As shipped, **`npm run tauri dev` and `npm run tauri build` both fail
immediately**, before any window opens. `src-tauri/Cargo.toml` now declares a
second binary (`[[bin]] name = "cowtext-cli"`, added by WO03 Lane C) but
`[package]` has no `default-run` key, so `cargo run` — which both Tauri
commands shell out to — cannot pick a binary:

```
error: `cargo run` could not determine which binary to run. Use the `--bin` option to specify a binary, or the `default-run` manifest key.
available binaries: cowtext, cowtext-cli
```

(`tauri build`'s bundler hits the same ambiguity at its own binary-discovery
step: `failed to find main binary, make sure you have a 'package > default-run'
in the Cargo.toml file`.)

**Nobody can run this manual's UI sections (B–E, G) until this is fixed.**
The fix is one line, owned by Lane C (tech-general) — this tester does not
edit application code:

```toml
# src-tauri/Cargo.toml, in [package]
default-run = "cowtext"
```

`cargo build`, `cargo clippy --all-targets`, and `cargo test` are all
unaffected (they don't need to disambiguate a run target) — that's why this
slipped past the four required automated gates and was only caught by the
production-build/CSP step this manual folds in. Section F (`cowtext-cli`) is
also unaffected, since it's driven by `cargo build --bin cowtext-cli` / the
built exe directly, never `cargo run`.

**Step 0.** Confirm the blocker, apply the fix, re-confirm:

```powershell
cd D:\Moo.exe\Cowtext\src-tauri
cargo run 2>&1 | Select-String "could not determine"
# ^ reproduces the failure — add `default-run = "cowtext"` under [package] in Cargo.toml, then:
cd D:\Moo.exe\Cowtext
npm run tauri dev
```

*Expected after the fix:* Vite starts on :1420, cargo builds `cowtext`, the
Cowtext window opens. Do not proceed to section A until this works.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420,
   `tauri dev` fails instead of picking another port. (If a previous broken
   `tauri dev` attempt left a stray `vite` node process holding the port —
   this happens with the Step 0 failure, since `cargo run` errors out but the
   concurrently-started Vite dev server is not torn down — kill it first:
   `Get-Process node | Stop-Process -Force` or find it via
   `Get-NetTCPConnection -LocalPort 1420`.)
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* the Cowtext window opens on the "Open a project" empty state.
3. **Make a throwaway test project** (do NOT use a real project):

   ```powershell
   mkdir C:\_cowtest03\context
   Set-Content C:\_cowtest03\notes.md "# Notes`n`nSome handwritten notes."
   ```

4. Press **Open folder** (top-right) and pick `C:\_cowtest03`. *Expected:*
   workspace opens, file rail shows `notes.md`, empty canvas, **Compile**
   disabled ("The graph is empty").

---

## B. Happy path — graph v3 taxonomy tour

### B1. All 13 roles via the grouped RolePopup

5. Double-click empty canvas → a node card appears, selected, Inspector
   Properties tab open. Rename **Title** to `Agent Node`.
6. In the Inspector, click the **Role** field (shows a glyph + "Agent").
   *Expected:* a popup opens with four group headers in order — **Identity**
   (1 role: agent), **Constraints** (rules, invariant, trap), **Process**
   (architecture, workflow, task, command, skill), **Knowledge** (reference,
   glossary, snippet, style) — 13 roles total across the four groups.
7. Click **Trap** in the Constraints group. *Expected:* popup closes; the
   Role button now shows the trap glyph (hollow hazard diamond) and the text
   "Trap"; the description line below reads *"A known gotcha — a mistake made
   here before, flagged so it isn't repeated."*; the node card on canvas
   updates to the trap glyph/colour immediately.
8. Repeat steps 5–7 to create five more nodes, one per remaining new role —
   **Command**, **Invariant**, **Skill**, **Snippet**, **Style** — titled
   after their role (`Command Node`, `Invariant Node`, etc.). *Expected:*
   each gets a visually distinct 8×8 pixel glyph and a distinct role colour
   (no two of the six new roles render identically — command: chevron+cursor
   bar, invariant: padlock, trap: hazard diamond, skill: starburst, snippet:
   hollow brackets, style: diagonal brush stroke).
9. Also create one plain **Reference** node titled `Ref Node` (leave default
   role). You now have 8 nodes: Agent Node, Trap Node, Command Node,
   Invariant Node, Skill Node, Snippet Node, Style Node, Ref Node.

### B2. All 7 edge kinds via the grouped KindPicker

10. **Drag a connection** from `Agent Node` to `Command Node`. *Expected:*
    the Edge-kind picker opens with a **Structural** group header (dot +
    "changes compiled output") listing **imports / sequence / overrides**,
    then an **Advisory** group header (dot + "advisory only") listing
    **references / conditional / supersedes / conflicts-with** — 7 kinds,
    each row showing a small line-sample matching its real render style.
    Pick **imports**. *Expected:* a solid 1.75px edge, filled arrowhead.
11. Connect `Agent Node` → `Trap Node`, pick **overrides**. *Expected:* a
    solid 2px edge, filled arrowhead **with a trailing bar** (visually
    heavier than imports — "wins on conflict").
12. Connect `Agent Node` → `Skill Node`, pick **sequence**. *Expected:* solid
    edge with an open chevron arrowhead and a small numbered step-dot label
    at the midpoint.
13. Connect `Agent Node` → `Ref Node`, pick **references**. *Expected:*
    dashed edge (5 4), open-circle marker.
14. Connect `Agent Node` → `Invariant Node`, pick **conditional**, type
    `src/net/**` in the condition box, press **Add**. *Expected:* dotted
    edge (1.5 3.5), a small condition chip at the midpoint reading
    `src/net/**`.
15. Connect `Command Node` → `Snippet Node`, pick **supersedes**. *Expected:*
    dashed edge (8 3), a hollow square marker.
16. Connect `Skill Node` → `Style Node`, pick **conflicts-with**. *Expected:*
    dashed edge (1.5 1.5), a cross/X marker.
17. **Right-click any edge.** *Expected:* the context menu's kind list is
    grouped the same way as the picker — structural kinds first, a
    separator, then advisory kinds — each hint reading either "structural —
    changes compile order" or "advisory — lint only, doesn't change output".

### B3. Tags and Owner

18. Select `Agent Node`. In the Inspector, below **Brief**, click the
    **Tags** field (placeholder "Add tags…"). *Expected:* a popup opens:
    "No tags yet." plus a `new tag…` input with a **+** button.
19. Type `core`, press **Enter**. *Expected:* popup stays open, a `#core`
    chip appears in the field behind it. Close the popup (click outside).
20. Click **Owner** field below Tags, type `marty`. *Expected:* free-text
    input, no validation, no popup, no "Unassigned" roster.
21. Wait for the save indicator to read **saved**. Reopen the Inspector on a
    different node then back to `Agent Node`. *Expected:* `#core` tag chip
    and `marty` owner both persisted.

---

## C. Compile — five targets, two new ones OFF by default

22. Press **Compile** (now enabled). *Expected:* modal opens, **targets**
    row shows five chips in order **claude / agents / cursor / copilot /
    gemini**. On a project whose graph.json has never set `compileTargets`,
    **only `claude` is checked** — `agents`/`cursor`/`copilot`/`gemini` all
    start unchecked (the store's default is `["claude"]` alone, not "the
    three legacy targets" — confirm this against whatever the code currently
    does if it looks different; that's the ground truth to test against, not
    this manual).
23. Click the **copilot** chip. *Expected:* it turns accent-blue, checked;
    preview re-runs (brief "the cow is compiling" pixel march); a new row
    appears: `.github/copilot-instructions.md`, badge `copilot`, status
    **new file**.
24. Click the **gemini** chip too. *Expected:* another new row: `GEMINI.md`,
    badge `gemini`, status **new file**. Its diff should mirror `CLAUDE.md`'s
    `@`-import style (gemini shares the `@path` inline-import syntax with
    claude), while `.github/copilot-instructions.md` uses plain markdown
    links (like `agents`) — copilot has no import mechanism.
25. Check **claude** and **agents** too (leave **cursor** off for this pass).
    *Expected footer:* "**N of N files will be written**" where N matches
    the checked-and-changed row count; **Approve & write** enabled.
26. Press **Approve & write**. *Expected:* writing state, then "wrote N
    files" with the mono path list including `.github/copilot-instructions.md`
    and `GEMINI.md`. Press **Close**.
27. Verify on disk:

    ```powershell
    Get-Content C:\_cowtest03\.github\copilot-instructions.md -TotalCount 1
    Get-Content C:\_cowtest03\GEMINI.md -TotalCount 1
    ```

    *Expected:* both start with the exact line
    `<!-- GENERATED BY COWTEXT — edit the graph or context/*.md, not this file -->`.
28. Press **Compile** again, check all five chips including **cursor**.
    *Expected:* claude/agents/copilot/gemini rows show **unchanged**
    (disabled checkbox); only `cursor`'s `.mdc` file(s) show **new file**
    (checked). This proves toggling copilot/gemini on and back off doesn't
    perturb the other targets' already-written bytes. Approve, Close.

---

## D. Import — round-trip walk (the highest-value test in this WO)

This section builds a *second*, separate throwaway project that already has
hand-written agent-context files — simulating a project adopting Cowtext,
not one Cowtext built from scratch.

29. Close the current project (or just open a new folder over it — the app
    doesn't need a restart). Build the fixture:

    ```powershell
    mkdir C:\_cowtest03_import\context
    Set-Content C:\_cowtest03_import\CLAUDE.md @"
# Import Test — agent context

## Always read

@context/architecture.md

See also [the networking notes](context/networking.md) for details.
"@
    Set-Content C:\_cowtest03_import\context\architecture.md "# Architecture`n`nHow this hand-written project fits together."
    Set-Content C:\_cowtest03_import\context\networking.md "# Networking`n`nHand-written networking notes."
    ```

30. **Open folder** → `C:\_cowtest03_import`. *Expected:* empty canvas (no
    graph.json yet), file rail shows `CLAUDE.md`, `context\architecture.md`,
    `context\networking.md`.
31. Press the **Import** icon button in the top bar (next to Compile;
    tooltip "Scan CLAUDE.md / AGENTS.md / .cursor/rules for un-managed
    context to adopt"). *Expected:* modal opens, brief "the cow is scanning"
    pixel march, then a list of proposed nodes:
    - `CLAUDE.md` — checkbox **disabled and unchecked**, a red
      **"compile writes this file"** badge. This is `docs/design/
      WO03_AUDIT.md`'s **D2 (MAJOR)** fix: `CLAUDE.md`/`AGENTS.md`/`*.mdc`
      are paths `compile` itself owns and overwrites, so the importer now
      refuses to default-adopt them (server-enforced independently too —
      see step 40 below) and explains why inline rather than silently
      proposing a self-referential node.
    - `Architecture` (role `architecture` — matched by heading text) —
      checked by default.
    - `Networking` — check whatever role it actually infers — checked by
      default.
    Footer: "**2 of 3 nodes will be added**" (CLAUDE.md excluded from the
    count by default, not 3 of 3).
32. Try to force-check the `CLAUDE.md` row anyway (click its disabled
    checkbox). *Expected:* nothing happens — genuinely disabled, not merely
    styled to look disabled.
33. Press **Adopt selected**. *Expected:* "added 2 nodes and 0 edges" (the
    `@`/link edges the scan proposed *from* `CLAUDE.md` are silently dropped
    since `CLAUDE.md` itself was never adopted — the modal never invents an
    edge whose source wasn't itself adopted). Press **Close**.
34. **Look at the canvas.** *Expected:* it already shows the 2 adopted nodes
    (`Architecture`, `Networking`), no edges — this is `docs/design/
    WO03_AUDIT.md`'s **D1 (CRITICAL)** fix: `doApply()` now calls
    `useGraphStore.getState().loadGraph(root)` after a successful
    `importApply`, so the in-memory store is resynced immediately. **This
    tester independently confirmed D1 was still live and unfixed earlier in
    this same session** (the canvas stayed empty despite disk having the
    nodes, and any subsequent edit would have silently wiped them via the
    next autosave) — it was fixed by the owning lane mid-session, and this
    step now describes the corrected behavior. If you ever see the canvas
    NOT reflect an import immediately, that is a D1 regression — treat it
    as CRITICAL, not a rendering lag, and do not make any other edit until
    you've reloaded the project and confirmed graph.json's actual node
    count from disk.
35. Confirm on disk:

    ```powershell
    Get-Content C:\_cowtest03_import\.cowtext\graph.json
    ```

    *Expected:* `nodes` array has exactly 2 entries with `filePath` values
    `context/architecture.md` and `context/networking.md`. `CLAUDE.md`
    itself is NOT a node (you never adopted it — its checkbox was disabled).
36. Confirm the two source files are byte-identical to what you wrote in
    step 29 — Import must never touch file content, even indirectly:

    ```powershell
    Get-Content C:\_cowtest03_import\context\architecture.md
    ```

### D2. The round-trip trap

37. Press **Compile**, check only **claude**, approve & write. *Expected:*
    a fresh `CLAUDE.md` is written with Cowtext-generated content (your
    hand-written original from step 29 is gone — expected, since you never
    adopted it as a node; Compile treats it as a plain generated target like
    any other project).
38. Press **Import** again (re-scan the same project, now fully
    Cowtext-managed for its `CLAUDE.md` + the two context nodes). *Expected:*
    - The `CLAUDE.md` row is present but shows **"already managed"** (opacity
      dimmed, checkbox **disabled and unchecked** by default) — because it
      now carries the GENERATED header.
    - `Architecture` and `Networking` rows are **also** "already managed"
      (disabled, unchecked) — even though *their* files carry no GENERATED
      header — because they already back real graph nodes (`existing_paths`
      match on `filePath`).
    - **Critically: no new/undisabled rows appear for the same three files.**
      If you see a checkable, non-"already managed" row for
      `context/architecture.md`, `context/networking.md`, or `CLAUDE.md` at
      this point, that is the round-trip duplication bug — file it P0. (As
      of this writing it does NOT reproduce — `import::tests::
      scan_round_trip_generated_project_proposes_no_duplicates` covers this
      exact shape and passes.)
39. Try to force-check an "already managed" row anyway (click its disabled
    checkbox). *Expected:* nothing happens — the checkbox is genuinely
    disabled, not just styled to look disabled. Close the modal without
    adopting anything.
40. As defense-in-depth, confirm the backend also refuses a compile-owned or
    already-managed adoption even if the frontend were somehow bypassed —
    this part is verified by the automated test suite, not re-derived by
    hand in this manual: `cargo test apply_refuses_compile_output_path`
    and `cargo test apply_never_clobbers_existing_node_at_same_file_path`
    (from `src-tauri/`; already run as part of the automated gates, and the
    latter does real before/after byte + mtime comparison — not a UI step).

---

## E. Problems panel / linter

Return to the `C:\_cowtest03` project from sections B–C (Open folder again).

41. Find the **Problems** bar docked at the bottom of the window, above the
    status bar (below the canvas/tasks workspace). *Expected:* collapsed by
    default, shows a "Problems" label and either a count badge or "none".
42. Click the Problems bar to expand it. *Expected:* a scrollable list (max
    ~168px tall) of findings, or "No problems found." A small refresh icon
    button re-runs the check on demand (spins while loading).
43. **Trigger a cycle:** select the `overrides` edge from `Agent Node` →
    `Trap Node` (built in step 11); connect `Trap Node` → `Agent Node`,
    also **overrides**. *Expected:* within ~1s of the save settling, the
    Problems bar's error-count badge increments; expand it — a row with a
    red **cycle** badge and a message like `Cycle: Agent Node -> Trap Node ->
    Agent Node` (or similar path). Click the row. *Expected:* the app
    switches to canvas view and the two nodes in the cycle become selected.
    **Delete** one of the two overrides edges to clear the cycle before
    continuing (Compile would also refuse to write while this cycle exists —
    confirm: press Compile, expect the same error list as PHASE2's C1, not a
    file preview).
44. **Trigger conflicts-with:** already built in step 16
    (`Skill Node` -conflicts-with-> `Style Node`). *Expected:* Problems shows
    a warning-severity row, amber **conflict** badge, message naming both
    node titles ("... conflicts with ...").
45. **Trigger duplicate-title:** rename `Snippet Node` to `Ref Node` (same
    title as the existing Ref Node). *Expected:* a warning row, badge
    **duplicate title**, message "2 nodes share the title \"Ref Node\"".
    Rename it back afterward.
46. **Trigger near-duplicate-content:** open `Command Node`'s Markdown tab in
    the Inspector, paste in the exact same body text as `Invariant Node`'s
    file (any content ≥ ~40 normalized characters), save both. *Expected:* a
    warning row, badge **near-duplicate content**, both titles listed.
47. **Trigger superseded-but-pinned:** ensure `Snippet Node` (the target of
    the `supersedes` edge from step 15) is **Pinned** (toggle it on in its
    Inspector Properties tab if not already). *Expected:* a warning row,
    badge **superseded but pinned**, message naming the pinned node and what
    superseded it.
48. **Trigger readme-duplication:** create `README.md` at the project root
    with ≥3 lines that are also, verbatim (case/whitespace-insensitive), the
    bulk of some node's file content (e.g. copy `Ref Node`'s three lines
    into README.md too). Wait for the next lint refresh. *Expected:* a
    warning row, badge **duplicates README**, naming that node and an
    overlap percentage ≥ 70%.
49. **Not reachable via any UI control in this build** (documented here so
    the gap is explicit, not silently skipped):
    - `missing-file` and `dangling-edge` — both need starting the app clean
      before deleting a node's file (per PHASE2 §C2), OR (dangling-edge
      specifically) a node getting deleted while an edge to it survives,
      which `deleteNodes` does not currently allow to happen through normal
      use. `missing-file` **is** reachable — delete a node's `.md` file from
      disk with the app open (same technique as PHASE2 manual step 29) and
      confirm Problems reports it; `dangling-edge` genuinely has no UI path
      and is covered only by
      `lint::tests::dangling_edge_reported_for_missing_source_and_target`.
    - `stale-last-verified` — `MemoryNode.lastVerified` has **no editor
      anywhere in this build** (confirmed in `src/store/graph.ts`: "No UI
      reads it yet"). This code path is exercised only by
      `lint::tests::stale_last_verified_flagged_for_old_date`; there is
      currently no way for a real user to either trigger or clear this
      finding from the app.
50. **Corrupt-graph error surfacing:** hand-edit `.cowtext\graph.json` to
    remove the `"nodes"` key entirely, then click the Problems refresh
    button. *Expected:* a real error row/state naming the parse failure —
    NOT the generic "Lint isn't available in this build yet." message. This
    is `docs/design/WO03_AUDIT.md`'s **D7 (MINOR)** fix:
    `ProblemsPanel.tsx` now narrowly matches Tauri's own `Command {name} not
    found` wording for the genuine "unavailable" case (`isCommandNotFound`)
    and routes every other rejection — including a corrupt graph — to a
    distinct `error` status instead of conflating the two. Restore the file
    from your last good state (or delete it and rebuild the graph)
    afterward.

---

## F. `cowtext-cli` — terminal walk

No GUI needed for this section; it exercises the second binary directly.

51. Build it once if not already built:

    ```powershell
    cd D:\Moo.exe\Cowtext\src-tauri
    cargo build --bin cowtext-cli
    $CLI = ".\target\debug\cowtext-cli.exe"
    ```

52. **Top-level help:** `& $CLI` (no args). *Expected:* prints `TOP_HELP`
    (usage + both subcommands + exit-code table), **exit 0**.
    `& $CLI -h` and `& $CLI --help` behave identically.
53. **Lint, clean project:** `& $CLI lint --root C:\_cowtest03`. *Expected:*
    if section E left any warnings/errors uncleared, they print grouped
    ERRORS/WARNINGS; otherwise "No problems found." Exit code is **0** iff
    zero *error*-severity findings — warnings alone never fail it. Confirm
    with `echo $LASTEXITCODE`.
54. **Lint, JSON:** `& $CLI lint --root C:\_cowtest03 --json`. *Expected:*
    pretty JSON: `command`, `root`, `status` (`ok`/`problems`/`error`),
    `errorCount`, `warningCount`, `items[]` (each with camelCase `code`,
    `severity`, `message`, optional `nodeIds`/`edgeIds`/`filePath`).
55. **Compile --check, clean:** `& $CLI compile --check --root C:\_cowtest03`.
    *Expected:* if every generated file on disk matches the graph, "OK — N
    generated file(s) match the graph. No drift." and exit **0**. If you
    haven't re-compiled since section E's edits, expect DRIFT instead —
    that's correct, not a bug; re-run Compile in the app first if you want
    to see the clean case.
56. **Compile --check, missing graph:** in a brand-new empty directory with
    no `.cowtext\graph.json`:
    `& $CLI compile --check --root C:\_empty_dir_xyz` (create the dir first).
    *Expected:* stderr `cowtext-cli compile: no .cowtext/graph.json found
    under ...`, **exit 2**.
57. **Compile --check, nonexistent root:**
    `& $CLI compile --check --root C:\_definitely_does_not_exist`.
    *Expected:* stderr `Not a directory: ...`, **exit 2**.
58. **Usage errors:** `& $CLI compile` (no `--check`) → stderr "compile
    requires --check", **exit 2**. `& $CLI lint --check` → stderr "--check is
    only valid for the compile command", **exit 2**. `& $CLI frobnicate` →
    stderr "unknown command: frobnicate", **exit 2**.
59. **Read-only proof:** snapshot, run both commands, re-snapshot:

    ```powershell
    $before = Get-ChildItem C:\_cowtest03 -Recurse -File | Get-FileHash | Select Path,Hash
    & $CLI compile --check --root C:\_cowtest03 --json | Out-Null
    & $CLI lint --root C:\_cowtest03 --json | Out-Null
    $after = Get-ChildItem C:\_cowtest03 -Recurse -File | Get-FileHash | Select Path,Hash
    Compare-Object $before $after
    ```

    *Expected:* `Compare-Object` prints nothing — zero files touched, zero
    new files created. This binary must never write, under any flag
    combination.

---

## G. Production build / CSP check

Requires the Step 0 fix (`default-run = "cowtext"`) already applied.

60. Build the production bundle:

    ```powershell
    npm run tauri build
    ```

    *Expected:* Vite build, then a real `cargo build --release` (watch for
    `Compiling cowtext v0.1.0` in the output, not an immediate error), then
    bundler output producing an installer/executable under
    `src-tauri\target\release\bundle\`. If you instead see `failed to find
    main binary...` again, the Step 0 fix did not land — stop and re-check
    `src-tauri\Cargo.toml`.
61. Launch the built executable directly (not `tauri dev`):

    ```powershell
    & (Get-ChildItem "src-tauri\target\release" -Filter "cowtext.exe" -Recurse | Select -First 1).FullName
    ```

    *Expected:* window opens on the empty state, same as dev mode. Because
    `windows_subsystem = "windows"` suppresses the console in release, you
    won't see `println!`/panic output here — that's expected, not a bug.
62. Open `C:\_cowtest03`, confirm fonts render correctly (the pixel-font
    headings, the mono body text) — a CSP `font-src` refusal would show as
    system-fallback fonts or missing glyphs, not an error dialog.
63. Switch to the Barn view. *Expected:* the isometric barn scene renders,
    cow/calves animate, hover bubbles work. **Note honestly:** every sprite
    on screen is still hand-drawn PIXI `Graphics` (vector shapes), not real
    bitmap art — confirmed in `src/scene/{calf,hover,props,sceneGraph}.ts`.
    This is expected, tracked as a P1 backlog item (real sprites are a
    Marty-side asset), not a WO03 defect. Also note (`docs/design/
    WO03_AUDIT.md`'s **O1**, backlog not a defect): `rules`, `invariant`,
    and `trap` nodes all render as the same straw-cabinet prop in the barn —
    the barn's own accent palette wasn't extended for the six new roles.
    All 13 roles remain visually distinct on the *canvas* (glyph + colour),
    which is where a user actually identifies a node.
64. Trigger a sound (any SFX-producing action — e.g. Compile's completion
    chime, or typing in a text field for the typewriter tick). *Expected:*
    audible sound, no silent failure.
65. Run **Compile** with all 5 targets, approve & write. *Expected:* works
    identically to section C — this proves `invoke()` IPC functions under
    the production CSP (`connect-src 'self' ipc: http://ipc.localhost`), not
    just under the relaxed `devCsp`.
66. If you have a way to inspect the webview's devtools console in a release
    build (production builds normally disable devtools — if you can't open
    it, note that and move on rather than forcing it), look for any
    `Refused to ...` / `Content Security Policy` messages. *Expected:* none.
    This step is genuinely hard to perform without a debug-enabled release
    build; if skipped, mark it PENDING in the sign-off table rather than
    PASS, and say why.

---

## H. WO02 regression — 2 minutes

67. **Drag:** drag a node to a new spot on canvas. *Expected:* smooth drag,
    save indicator cycles to saved.
68. **Tasks board:** switch to the Tasks view (view toggle in the top bar).
    *Expected:* board renders with status columns; segments and priority
    buckets from WO02 still present.
69. **Agents:** open the roster bar / agent panel (if any agent files exist
    under `.claude/agents/` in this scratch project — if none, skip and
    note it). *Expected:* no crash switching views.
70. **Restart-restore:** close the Cowtext window, relaunch, Open folder →
    `C:\_cowtest03`. *Expected:* all 8 nodes at their positions, all edges
    with their kinds intact (including the 6 new-in-WO03 edges from section
    B2), tags/owner on `Agent Node` intact, `compileTargets` selection from
    section C persisted.

---

## Cleanup

71. Close the app and delete both scratch projects:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowtest03
    Remove-Item -Recurse -Force C:\_cowtest03_import
    Remove-Item -Recurse -Force C:\_empty_dir_xyz -ErrorAction SilentlyContinue
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| Step 0 — default-run blocker | | Must be fixed before anything else runs |
| A Preconditions | | |
| B1 13 roles | | |
| B2 7 edge kinds | | |
| B3 Tags/Owner | | |
| C Compile — 5 targets | | |
| D Import round-trip | | Step 34 documents audit D1 (CRITICAL, fixed live mid-session — verify it stays fixed); step 38 is the highest-value round-trip check |
| E Problems panel | | Note the 2 UI-unreachable codes (step 49) as PENDING, not FAIL; step 50 exercises D7's fix |
| F cowtext-cli | | |
| G Production build / CSP | | Step 66 may be PENDING if devtools unavailable |
| H WO02 regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
