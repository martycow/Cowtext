# Phase 3 Manual Test Script — Assemble

Hand-run test manual for the Assemble feature (headless `claude -p` queue: Assemble /
Refine / Summarize per node). Run it top to bottom in one sitting; sections C–F reuse the
project built in section B. Written against the code as of 2026-08-16
(`src/inspector/Inspector.tsx` AssembleSection, `src/canvas/MemoryNodeCard.tsx`,
`src-tauri/src/assemble.rs`). Every step names the real control and the exact expected
result — if reality differs, that is a bug (or this manual is stale; either way, note it).

**Time budget:** ~30 min full pass. Each `claude -p` call takes real wall time (10–60 s);
the queue section deliberately exploits that.

---

## A. Preconditions

1. **The `claude` CLI must resolve.** In PowerShell:

   ```powershell
   where.exe claude
   claude --version
   ```

   *Expected:* at least one path prints and `--version` answers. If not, install Claude
   Code first — every Assemble action in this manual will otherwise fail with a spawn
   error (that failure mode is tested separately in E, not here).
2. **Free port 1420**, then start the app from `D:\Moo.exe\Cowtext`:

   ```powershell
   npm run tauri dev
   ```

   *Expected:* the Cowtext window opens on the "Open a project" empty state.
3. **Make a throwaway test project** (do NOT use a real project — Assemble REWRITES
   node files on disk):

   ```powershell
   mkdir D:\_cowtest3
   ```

4. Press **Open folder** (top-right) and pick `D:\_cowtest3`.
   *Expected:* workspace opens — file rail `0 markdown files`, empty canvas, inspector
   placeholder text, collapsed **event feed** strip along the bottom.

---

## B. Single-node happy path — Assemble one brief

### B1. Create a node with a brief

5. **Double-click** the canvas. A node "New node" appears and the inspector opens its
   **Properties** tab. Rename **Title** to `Persona`.
6. In the **Brief** field (placeholder "One line for Assemble to expand later") type:
   `A terse, friendly coding assistant persona for a Rust desktop app.`
7. Wait for the top-bar save indicator to read **saved**.
8. Scroll the Properties tab down. *Expected:* below the File row there is an
   **Assemble** section (uppercase mono label) containing:
   - an accent (blue) **Assemble** button with a sparkles icon,
   - a **Summarize** button,
   - a **Refine** input (placeholder `Refine: e.g. add a testing section`) with a
     **Refine** button,
   - helper text: "Runs headless `claude -p` and rewrites `context/persona.md` on disk."
   No status badge is visible yet (idle status shows nothing).

### B2. Run Assemble and watch the status pipeline

9. Hover the **Assemble** button. *Expected tooltip:* "Expand the brief into a full file
   via claude -p" (with an empty brief it would instead read "Uses the title and
   neighbors — a brief makes it better").
10. Press **Assemble**. *Expected, in order:*
    1. A status badge appears next to the Assemble label: **queued** (neutral grey),
       with a small **✕** cancel button beside it.
    2. Within ~a second the badge becomes **assembling** (accent blue, with a blinking
       square dot) and the ✕ disappears — running jobs cannot be cancelled.
    3. Both buttons and the Refine input are **disabled** the whole time (busy =
       queued or running).
11. While it runs, look at the `Persona` **canvas card**. *Expected:* an accent
    indeterminate bar appears under the title (wide + blinking while running), and the
    footer shows at most ONE status badge — **assembling** (blue). No amber pulse, no
    error stripe.
12. Wait for completion. *Expected:* inspector badge flips to **assembled** (green);
    the canvas card flashes a 2 px **success ring** for ~0.9 s, then returns to rest;
    the indeterminate bar and footer badge disappear.
13. Verify the file on disk:

    ```powershell
    Get-Content D:\_cowtest3\context\persona.md
    ```

    *Expected:* real markdown content expanding the brief (not the stub), ending with a
    trailing newline. The file rail row for `context/persona.md` shows a grown size.
14. Open the inspector **Markdown** tab. *Expected:* the editor shows the assembled
    content (the tab re-reads from disk on node/file change; if you had the tab open
    during the run, re-select the node to force the re-read — stale content after
    re-selection is a bug).

---

## C. The queue — 5 briefs, max 2 run at once, FIFO

15. Create **four more** nodes (double-click canvas ×4) titled `Rules`, `Architecture`,
    `Testing`, `Workflow`, each with a one-line **Brief** (any text, e.g. "House rules
    for the agent.", "High-level architecture notes.", "How we test.", "Release
    workflow."). Wait for **saved**.
16. Now enqueue all five quickly: select `Persona`, press **Assemble**; select `Rules`,
    press **Assemble**; then `Architecture`, `Testing`, `Workflow` the same way.
    (Selecting a different node re-enables the buttons — busy-disable is per node.)
17. Immediately look at the **five canvas cards** (the canvas shows every node's status
    at once; the inspector only shows the selected one). *Expected:* exactly **2** cards
    show the **assembling** badge + blinking bar (max 2 concurrent — `MAX_CONCURRENT`
    is 2), and the other **3** show the grey **queued** badge with a thin dim bar.
    All five showing "assembling" at once is a bug.
18. Watch the queue drain. *Expected:* as each running job finishes (success flash),
    the **oldest queued** card is promoted to assembling — FIFO order: `Architecture`
    before `Testing` before `Workflow`. Never more than 2 assembling at any moment.
19. When all five are done, verify disk:

    ```powershell
    Get-ChildItem D:\_cowtest3\context\*.md | Select Name, Length
    ```

    *Expected:* five files, all substantially larger than a stub.

---

## D. Refine and Summarize

20. Select `Persona`. In the **Refine** input type `add a section on tone of voice`.
    *Expected:* the **Refine** button is enabled only while the input is non-empty
    (empty input = disabled button).
21. Press **Enter** in the input (keyboard path — must behave identically to clicking
    **Refine**). *Expected:* same queued → assembling → assembled pipeline as B2.
22. Check `context\persona.md` on disk. *Expected:* the persona content now contains a
    tone-of-voice section; the rest of the file is a coherent revision, not an append
    of raw model chatter.
23. Select `Rules`, press **Summarize** (tooltip: "Compress the current file content").
    *Expected:* the usual pipeline; afterwards `context\rules.md` is **shorter** than
    before (compare Length before/after) while keeping the key content.

---

## E. Error paths

### E1. Job failure surfaces, never crashes

24. Create a node titled `Ghost` (double-click canvas), wait for **saved**, then delete
    its file out from under it:

    ```powershell
    Remove-Item D:\_cowtest3\context\ghost.md
    ```

25. With `Ghost` selected, press **Summarize** (Summarize must read the current file
    content, so a missing file is a guaranteed job error — no claude call needed).
    *Expected:* badge goes queued → then **error** (red), NOT assembling-forever. Below
    the Assemble section a mono red error line appears containing the file path
    (`context/ghost.md`) and the OS read error.
26. Look at the `Ghost` canvas card. *Expected:* the role stripe has turned **danger
    red** and the footer badge reads **missing file** (the missing-file badge outranks
    the assemble-error badge — only ONE badge shows). No success flash.
27. Confirm the app is still healthy: select another node, its Assemble section is
    normal and enabled. Re-running any action on `Ghost` after pressing **Create file**
    in its Markdown tab must work again.

### E2. Double-fire is impossible through the UI

28. Select any idle node, press **Assemble**, and immediately try to click **Assemble**,
    **Summarize**, and **Refine** again. *Expected:* all three controls are disabled
    from the instant the badge shows **queued** — the backend's "Node already queued"
    rejection is unreachable via the UI. If you ever see that message in the error
    line, the disable logic regressed; note it.

### E3. Enqueue rejection rolls back cleanly

29. (Only if step 1 found NO `claude` on PATH — otherwise skip.) Press **Assemble** on
    any node. *Expected:* the badge appears as queued, the job then fails with an
    **error** badge and a "failed to spawn claude" message in the error line. The badge
    must never stick at "queued" forever.

---

## F. Cancel — queued jobs only

30. Enqueue three nodes back-to-back (as in C) so at least one card shows **queued**.
31. Select a node whose badge reads **queued** (not assembling). *Expected:* a small
    **✕** button sits next to the badge, tooltip "Remove from queue".
32. Press **✕**. *Expected:* the badge disappears (back to idle), the canvas card's
    queued badge and bar disappear, buttons re-enable. The cancelled node's file is
    NEVER written by this run.
33. Let the remaining jobs finish. *Expected:* the cancelled node is skipped — the two
    others complete normally; the queue does not stall.
34. Select a node while its badge reads **assembling**. *Expected:* NO ✕ button —
    running jobs cannot be cancelled from the UI (`assemble_cancel` only removes
    queued jobs). Its job runs to completion.

---

## G. Regression — Compile still coexists

35. Pin `Persona` (Pinned toggle ON), press **Compile** in the top bar, keep target
    `claude` checked, approve the write. *Expected:* the assembled content flows into
    the generated `CLAUDE.md` exactly as handwritten content would — Assemble output
    is ordinary node-file content to the compiler. Close the modal.

---

## Cleanup

36. Close the app and delete the scratch project:

    ```powershell
    Remove-Item -Recurse -Force D:\_cowtest3
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Single assemble | | |
| C Queue (5 briefs, max 2, FIFO) | | |
| D Refine + Summarize | | |
| E Error paths | | |
| F Cancel | | |
| G Compile regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
