# Agents & Sub-Agents Manual Test Script — Agents Suite + Named Calves

Hand-run test manual for the Agents & Sub-Agents management suite (AGENTS_SUITE_CONTRACT.md):
the **Agents** manager window (`.claude/agents/*.md` + `.claude/skills/*/SKILL.md` CRUD, the
`.cowtext/agents.json` sidecar), the shared identity-hash avatars, and Named Calves in the Barn.
Run top to bottom in one sitting; sections C–E reuse the project and files built in section B.
Written against the code as of 2026-08-18 (`src/agents/*.tsx`, `src/store/agents.ts`,
`src/identity/identity.ts`, `src/scene/calf.ts`, `src-tauri/src/agents.rs`,
`src-tauri/src/frontmatter.rs`). Every step names the real control and the exact expected
result — if reality differs, that is a bug (or this manual is stale; either way, note it).

**Time budget:** ~25 min full pass, plus the 2-minute regression at the end.

> **REVISED in the unification pass (same day, v0.0.0012)** — read before running:
> the **Agents modal is gone**. Agents and skills now live in the app panels:
> - The **left rail** has AGENTS and SKILLS sections under the file list (mini avatars,
>   "+" to create, right-click for Adopt to graph / Reveal / Delete with inline confirm).
> - The full agent editor (avatar, nickname, priority/influence, tools, skills, duties)
>   renders in the **Inspector** when an agent is selected — via its graph node or its
>   rail row ("off-graph" agents open a standalone editor with an **Adopt to graph** button).
> - The former **persona** node role IS now the **agent** role (graph.json v2 migrates
>   v1 automatically; presets of both versions load). A legacy agent-role node backed by a
>   context file shows a **Convert to agent file** banner that moves it into .claude/agents/.
> - **Compile** now also emits a managed `COWTEXT CONTEXT` block into each adopted agent's
>   file from its outgoing imports/references edges (diff-previewed like any target).
> Steps below that say "open the Agents window" should be read as "use the rail section +
> Inspector"; everything about file formats, sidecar, byte-identity and calves is unchanged.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev` fails instead
   of picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens.
3. **Make a throwaway test project** (do NOT use a real project — this test writes and deletes
   files) with one hand-authored agent file that carries an **unknown frontmatter key**
   (`memory: project`, exactly the convention the fleet's own `.claude/agents/tech-ui.md`
   already uses in this repo) and mixed list forms, so the round-trip test below is real:

   ```powershell
   mkdir C:\_cowtest_agents\.claude\agents
   Set-Content C:\_cowtest_agents\.claude\agents\legacy-scribe.md @"
---
name: legacy-scribe
description: Use when historical records need updating
model: sonnet
tools: Read, Grep
skills: [design-tokens]
memory: project
---

# legacy-scribe

## Duties
- Keep records straight.

## Boundaries
- Read-only outside its own files.
"@
   ```

   *Expected:* `C:\_cowtest_agents\.claude\agents\legacy-scribe.md` exists with that exact
   content (comma-form `tools:`, bracket-form `skills:`, and the unknown `memory:` key after
   the known keys).
4. In Cowtext press **Open folder** (top-right) and pick `C:\_cowtest_agents`.
   *Expected:* the workspace opens; the top bar gains an **Agents** button (lucide people icon,
   between **Presets** and **Handoff** — only visible once a project is open).

---

## B. Happy path

### B1. Open the manager, confirm the pre-existing agent survives untouched

5. Press **Agents** in the top bar. *Expected:* a modal opens, header **Agents**, the project
   root path on the right, a ✕ button; two-pane layout — a 280px left rail with **Agents** and
   **Skills** sections, and a right pane reading "Select an agent or a skill, or create a new
   one on the left." (nothing is selected yet).
6. In the left rail, under **Agents**, one row: `legacy-scribe` (an 11px identicon square, the
   file's `name:` value as the label — no nickname yet, so no muted suffix). Under **Skills**:
   "No skills yet."
7. Click the **legacy-scribe** row. *Expected:* the right pane shows the identity header (44px
   identicon, name `legacy-scribe` in an editable input, a **nickname** input placeholder
   "optional", a **Reveal file** button, and `legacy-scribe.md` printed underneath it); the
   fields grid — **Description** ("Use when historical records need updating"), **Model**
   select showing `sonnet`, **Priority** stepper at `3` (sidecar default, file has none yet),
   **Influence** slider at `50%`, **Tools** chips `Read` `Grep`; a **Skills** section reading
   "No skills in this project yet." (the checklist only lists skills that actually exist as
   `SKILL.md` dirs — `legacy-scribe.md`'s own `skills: [design-tokens]` line is preserved data
   but renders no checklist row until a real `design-tokens` skill exists, created in step 14);
   **Duties** editor showing the two bullet sections.
8. **Reveal file.** *Expected:* the OS file explorer opens with `legacy-scribe.md`
   highlighted (or, if reveal fails on this machine, an inline red error appears under the
   button — never a silent no-op).
9. **Without changing anything**, note there is no amber dirty-dot next to Duties, and the
   **Save** buttons (next to Duties, and there is no separate one for the fields grid) are
   disabled.

### B2. Create an agent, edit every field, save, verify disk

10. In the left rail, type `Scout` into **New agent…** and press **Enter**.
    *Expected:* the row list gains `scout` (slugified, lowercase); it is auto-selected; the
    right pane shows the starter template — Description empty, Model `sonnet`, Priority `3`,
    Tools `Read` `Grep` `Glob`, Duties/Boundaries headings only.
11. Verify directly on disk (this modal has no file rail of its own — check the real file):

    ```powershell
    Get-Content C:\_cowtest_agents\.claude\agents\scout.md
    ```

    *Expected byte-exact template:*
    ```
    ---
    name: scout
    description: 
    model: sonnet
    tools: Read, Grep, Glob
    skills: []
    ---

    # scout

    ## Duties

    ## Boundaries
    ```
12. Back in the modal, type a **Description**: `Scouts new terrain`. *Expected:* an amber dirty
    dot appears next to **Duties** immediately (fields and body share one dirty indicator).
13. Change **Model** to `custom` in the select, then type `sonnet-4.5-thinking` in the text box
    that appears next to it. Click the **Priority** stepper's `+` three times → reads `4` (a
    sidecar field: watch that NO dirty dot reaction happens — priority autosaves separately).
    Drag **Influence** to `80%`. In **Tools**, type `Bash` then press **Enter** → a new chip
    `Bash` appears; press **Backspace** with the input empty → the `Bash` chip is removed again
    (edit-in-place chip editor).
14. In the left rail, type `Design tokens` into **New skill…**, press **Enter**.
    *Expected:* the Skills section gains `design-tokens`, auto-selected, its own editor opens
    (Name/Description/Body, no Model/Priority/Tools — skills don't carry those). Type a
    **Description**: `Design token reference`. Press the **Save** button next to **Body**.
    *Expected:* dirty dot clears; disk now has
    `C:\_cowtest_agents\.claude\skills\design-tokens\SKILL.md` starting with
    `---\nname: design-tokens\ndescription: Design token reference\n---`.

### B3. Dirty-switch guard, then finish scout's edits

15. `scout` is still dirty from step 13 (Description/Model/Influence changed, Tools chip
    added-then-removed). Click the **legacy-scribe** row in the left rail. *Expected:* a
    floating sheet appears over the panel (list and editor stay visible behind it):
    `scout has unsaved changes. Discard them?` with **Cancel**, **Discard** (danger/red),
    **Save** (blue) buttons.
16. Press **Cancel**. *Expected:* the sheet closes, selection stays on `scout`, nothing is
    lost. Click **legacy-scribe** again to re-raise the same sheet.
17. Press **Save**. *Expected:* the sheet closes, selection moves to `legacy-scribe`, and on
    disk `scout.md`'s `description:` line now reads `description: Scouts new terrain`, `model:`
    reads `model: sonnet-4.5-thinking`, `tools:` still comma-form `Read, Grep, Glob` (list form
    preserved). Priority/Influence are NOT in this file — they went to the sidecar (B4).
18. In `scout`'s **Skills** checklist, check `design-tokens`. *Expected:* the checkbox ticks
    immediately (draft-only, no disk write yet) and the dirty dot lights. Press **Save** next
    to Duties. *Expected:* dirty dot clears; `scout.md`'s frontmatter gains a new line
    `skills: [design-tokens]` (bracket form — the contract's default for a newly-appended list
    key) appended immediately before the closing `---`, in canonical key order (after
    `tools:`).

### B4. Sidecar — nickname/priority/influence persist to `.cowtext/agents.json`

19. Select `scout`. Type `Ranger` into the **nickname** field. *Expected:* the left-rail row for
    `scout` immediately gains a small muted `Ranger` suffix next to the name (live, no debounce
    on the UI side).
20. Wait at least 1 second (the sidecar autosave debounces 700 ms), then check disk:

    ```powershell
    Get-Content C:\_cowtest_agents\.cowtext\agents.json
    ```

    *Expected:* the file now exists, 2-space indented, LF, trailing newline, and contains
    exactly:
    ```json
    {
      "version": 1,
      "agents": {
        "scout.md": {
          "nickname": "Ranger",
          "priority": 4,
          "influence": 80,
          "avatarSeed": "scout"
        }
      }
    }
    ```
    (Only `scout.md` has an entry — `legacy-scribe.md` was never edited via the sidecar
    controls, so it has no entry yet, which is correct: sidecar entries are created lazily.)

### B5. Avatar identity — same seed, same look, forever

21. Note the exact shape/colour of `scout`'s 44px identicon in the header and its 11px row
    avatar in the left rail (they must look identical — same seed). Close the app entirely
    (close the window), then `npm run tauri dev` again, **Open folder** → `C:\_cowtest_agents`,
    press **Agents**, select `scout`. *Expected:* the identicon is pixel-identical to before —
    same filled cells, same accent hue (the algorithm is a pure hash of the seed, which
    defaults to the fileName stem `scout` and is now pinned in `agents.json`'s `avatarSeed`).

### B6. Unknown-key preservation — the real regression this suite exists to prevent

22. Select `legacy-scribe`. Change **Description** to `Use when historical records need a
    rewrite` (touch nothing else). Press **Save** next to Duties.
23. Check disk:

    ```powershell
    Get-Content C:\_cowtest_agents\.claude\agents\legacy-scribe.md
    ```

    *Expected:* `description:` reflects the new text; `tools: Read, Grep` is still **comma
    form**; `skills: [design-tokens]` is still **bracket form**; and — the point of this
    step — the line `memory: project` is still present, in the same position, byte-identical,
    even though Cowtext has no UI for that key at all. The `# legacy-scribe` body and both
    headings are untouched.

---

## C. Validation cases

### C1. Create-name collision

24. Type `Scout` again into **New agent…** and press Enter (same slug as the existing
    `scout.md`). *Expected:* the input is **not cleared**, and directly under it, in red
    monospace, Rust's exact error string appears: `An agent named "scout.md" already exists`.
    Fix the name to `Scout Two` and press Enter — succeeds, creates `scout-two.md`.
25. Repeat for skills: type `Design tokens` into **New skill…** → error `A skill named
    "design-tokens" already exists`, input retained.

### C2. Raw-document fallback (block-style YAML)

26. Close the modal (see D-series for the close guard, or just press ✕ with nothing dirty).
    Hand-author a file the parser cannot represent structurally:

    ```powershell
    Set-Content C:\_cowtest_agents\.claude\agents\weird.md @"
---
name: weird
tools:
  - Read
  - Grep
---
# weird
"@
    ```
27. Reopen **Agents**, select `weird`. *Expected:* NO fields grid. Instead: a red-bordered
    banner reading `Block-style YAML is not supported — edit as raw text`, then one whole-file
    CodeMirror editor showing the entire file content (including the `---` fences), a **Save**
    button (disabled until you actually edit), and no Duties/Skills/Tools controls at all.
28. Add a trailing blank line in the raw editor, press **Ctrl+S** (CodeMirror's `onSave`).
    *Expected:* the dirty dot clears; disk shows the file written verbatim — no reformatting,
    no attempt to parse it.

### C3. Sidecar corruption is fail-closed, never clobbered

29. Close the modal. Corrupt the sidecar:

    ```powershell
    Set-Content C:\_cowtest_agents\.cowtext\agents.json "not json"
    ```
30. Reopen **Agents**. *Expected:* the footer shows, in red monospace,
    `agents.json: Could not parse .cowtext/agents.json`. Select `scout` — nickname/priority/
    influence controls all show DEFAULTS (`""`, `3`, `50%`), not an error state, and are still
    editable locally, but changing them does **not** write to disk (metaError blocks all meta
    writes — the broken file is left exactly as you corrupted it).
31. Verify: change scout's nickname, wait 2 seconds, re-check
    `Get-Content C:\_cowtest_agents\.cowtext\agents.json` → still literally `not json`,
    byte-for-byte. Restore it by hand or just delete it:
    `Remove-Item C:\_cowtest_agents\.cowtext\agents.json`, then reopen the modal to clear the
    error state before continuing.

### C4. Known issue — full-document Save can silently re-quote an untouched scalar

*(This step documents actual current behaviour, not a should-pass check — expect it to
reproduce until frontmatter.rs's emission rule is revisited.)*

32. Create a new agent named `Quote Test`. Set its **Description** to exactly
    `Reads files: quickly and carefully` (a colon followed by a space, a completely ordinary
    English sentence — this exact pattern already occurs in this repo's real
    `.claude/agents/tech-barn.md` and `.claude/agents/product-analyst.md`). Press **Save**.
33. Check disk — the line is unquoted: `description: Reads files: quickly and carefully`.
34. Without touching Description, add a tool chip (e.g. `Bash`) and press **Save** again.
35. Check disk again. *Expected (current, buggy behaviour):* the description line is now
    **wrapped in quotes** — `description: "Reads files: quickly and carefully"` — even though
    the user never edited that field. This happens because every Save resends the whole
    `FmFields` object and the emitter re-derives quoting need from scratch
    (`frontmatter.rs::render_scalar_value`, "contains `: `" ⇒ quote) on every present key, not
    only on keys that changed. The value round-trips correctly (`scalar_value` strips exactly
    one quote pair on the next read), so no data is lost — but any edit to *any* field of
    `tech-barn.md` or `product-analyst.md` in this suite will reformat their `description:`
    line the same way. Flag this to tech-general if not already fixed.

---

## D. Safety cases

### D1. Delete confirms and names the target

36. Select `scout-two`. Press **Delete agent** (bottom of the editor, red text). *Expected:* a
    confirm sheet: `Delete scout-two.md? This removes the file from disk and cannot be undone.`
    with **Cancel** / **Delete agent** (red). Press **Cancel** — file still on disk.
37. Press **Delete agent** again, this time confirm. *Expected:* `scout-two.md` is gone from
    disk and from the left rail; selection moves to a neighboring agent row.
38. Select `design-tokens` under Skills, press **Delete skill**. Since nothing else lives in
    that directory, the confirm sheet reads `Delete the skill design-tokens? This removes the
    whole directory and cannot be undone.` with no extra-files list. Cancel for now (scout's
    `skills: [design-tokens]` reference is used in the next check).
39. To see the extra-files list: on disk, `New-Item -ItemType File
    C:\_cowtest_agents\.claude\skills\design-tokens\notes.txt`. Reopen the delete confirm.
    *Expected:* now shows `1 additional file goes with it:` and a mono list containing
    `notes.txt`. Cancel.

### D2. Dirty-switch guard on close, not just row-switch

40. Select `scout`, change **Description**, do NOT save. Press the modal's ✕.
    *Expected:* the same `has unsaved changes. Discard them?` sheet appears (closing the whole
    modal goes through the identical guard as switching rows) — **not** an immediate close.
41. Press **Discard**. *Expected:* the modal closes; reopening **Agents** shows `scout`'s
    Description reverted to its last-saved value.

### D3. Busy state blocks Esc and further navigation — via the confirm-sheet Save path

42. Reopen **Agents**, select `scout`, change Description, press ✕ to raise the confirm sheet,
    then click the sheet's **Save** button. *Expected, during the brief write:* the sheet stays
    up with no buttons responding to a second click; Escape does nothing (phase is `busy`).
    Once the write completes the modal closes (successful save was the pending navigation's
    target).
43. Separately, note the **ordinary inline Save** button (next to Duties, not via a confirm
    sheet) does **not** lock the rest of the modal the same way: select `legacy-scribe`, make a
    small edit, click **Save**, and *immediately* (before it can possibly have finished) click a
    different row in the left rail. *Expected (current behaviour):* the click is accepted
    (rows are not disabled during a plain Save) and — if `legacy-scribe` is still dirty at that
    instant — the discard sheet pops up for a document that is mid-save. No data is lost (the
    store refuses a second concurrent write with an internal "Busy" state), but the UI does not
    make this obvious; a second **Save** click from that sheet silently no-ops. Worth a UX
    pass, not a data-safety bug.

### D4. Orphan sweep after an external delete

44. Close the modal. Delete `legacy-scribe.md` directly from disk (outside the app):
    `Remove-Item C:\_cowtest_agents\.claude\agents\legacy-scribe.md`. (Its sidecar entry, if
    any, remains — in this run it never got one; to force the interesting case, first give it
    one: reopen Agents, select `legacy-scribe`, set nickname `Ghost`, wait 1s for autosave,
    close, THEN delete the file, then reopen.)
45. Reopen **Agents**. *Expected:* `legacy-scribe` is gone from the left rail (no file, no
    entry in the scan). The footer shows, underlined amber, `1 orphaned entry · Clean up`.
46. Press **Clean up**. *Expected:* the footer's orphan notice disappears;
    `Get-Content C:\_cowtest_agents\.cowtext\agents.json` no longer has a `legacy-scribe.md`
    key, and `scout.md`'s entry is untouched.

### D5. Install-hooks diff shows the new `SubagentStop` event

47. Close the Agents modal. In the Inspector's collapsed **event feed** strip (bottom), find
    the **install hooks** button (plug icon, only shown when hooks aren't installed yet) and
    press it. *Expected:* the **Install hooks** modal opens, previews
    `.claude/settings.json`. Since this is a brand-new project, the diff shows a full `new
    file` addition containing all **four** hook blocks — `PostToolUse`, `UserPromptSubmit`,
    `Stop`, and (new in this suite) **`SubagentStop`**. Press **Approve & install**, then
    verify on disk that `.claude/settings.json`'s `hooks` object has a `SubagentStop` key.

---

## E. Named Calves — the Barn demo beat

48. Switch to the Barn view (the view toggle in the top bar). Start **demo mode** (however this
    build's demo toggle is exposed — check the Barn view's own controls). *Expected over the
    course of the script:* partway through, a calf appears at the barn door tile, hops
    (bouncing) to one of a handful of fixed spots, gets a `✓` speech bubble, and lingers ~4 s
    before fading out over ≤300 ms. A **second, visually distinct** calf (different patch
    pattern/accent colour/prop — seeded from `"tester"` vs the first one's `"tech-ui"`) appears
    later in the same script. Restarting demo mode reproduces the *same two* calves every time
    (seed-stable, not random).
49. Toggle **reduced motion** in Settings, replay the demo. *Expected:* calves appear directly
    at their target tile (no door, no hop, no bounce), the `✓` bubble still shows, the ~4 s
    linger is unchanged, and despawn is an instant disappearance (no fade). Sound cues
    (`calf_spawn`/`calf_despawn`, if audio is on) still fire once per real spawn/despawn — never
    for a cap-dropped 5th calf, which is silent by design.

---

## F. Regression — 2 minutes

50. **Compile still works:** with `C:\_cowtest_agents` open, press **Compile** in the top bar.
    *Expected:* the modal opens normally (empty-graph case is fine — this project has no
    Memory Nodes — the footer should read something like "0 of 0 files will be written" or the
    empty-graph disabled state from Phase 2, not a crash). Close it.
51. **Presets/Settings/Handoff buttons still present** alongside the new **Agents** button in
    the top bar, in the order Presets → Agents → Handoff. Open and close each without error.
52. **Barn scene still renders** normally outside demo mode: switch to the Barn view, confirm
    the cow idles normally and no console errors appear in the `tauri dev` terminal.

---

## Cleanup

53. Close the app and delete the scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowtest_agents
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Happy path | | |
| C Validation | | |
| D Safety | | |
| E Named Calves | | |
| F Regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
