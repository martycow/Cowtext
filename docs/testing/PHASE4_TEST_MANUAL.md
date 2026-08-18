# Phase 4 Manual Test Script — Live Feed & Hooks

Hand-run test manual for the live-session pipeline: hooks install (trust boundary),
the axum server on 127.0.0.1:4923, the event feed panel, and the canvas node pulse.
Run it top to bottom; sections C–G reuse the project built in section B. Written against
the code as of 2026-08-16 (`src/inspector/EventLog.tsx`, `src/inspector/HooksModal.tsx`,
`src/canvas/MemoryNodeCard.tsx`, `src-tauri/src/hooks.rs`, `src-tauri/src/hooks_server.rs`).
Every step names the real control and the exact expected result — if reality differs,
that is a bug (or this manual is stale; either way, note it).

**Time budget:** ~30 min full pass (section F needs a real Claude Code session).

---

## A. Preconditions

1. **Free ports 1420 and 4923.** The hooks server binds 127.0.0.1:4923 at app start;
   if something else owns it the app still starts but live events are dead (a
   bind-failure line appears in the `tauri dev` terminal).
2. Start the app from the repo root:

   ```powershell
   npm run tauri dev
   ```

3. **Make a throwaway test project with two node files:**

   ```powershell
   mkdir C:\_cowtest4\context
   Set-Content C:\_cowtest4\context\persona.md "# Persona`n`nBe terse."
   Set-Content C:\_cowtest4\context\rules.md "# Rules`n`nNo emoji."
   ```

4. **Open folder** → `C:\_cowtest4`. In the file rail, **adopt** both files (hover row →
   adopt button). *Expected:* two nodes on the canvas, `persona` and `rules`.
5. Find the **event feed** strip along the very bottom of the window (below the canvas
   AND below the file rail — full width). *Expected, collapsed by default:* a 31 px
   header reading `EVENT FEED`, an **install hooks** button (plug icon), a trash-can
   **clear** button (disabled — no events), and a chevron. No DEMO badge.
6. Click anywhere on the header text. *Expected:* the panel expands (the whole header
   is the toggle, not just the chevron) and shows the empty state: "No events yet.
   Install hooks, then run Claude Code in this project — or start barn demo mode."

---

## B. Hooks install — the trust boundary

### B1. Fresh install into a project with no settings.json

7. Confirm nothing exists yet: `Test-Path C:\_cowtest4\.claude\settings.json` → `False`.
8. Press **install hooks** in the event-feed header. *Expected:* a modal "**Install
   hooks**" opens — header shows the mono path `.claude/settings.json` on the right and
   a ✕; then (after a brief "Reading .claude/settings.json…") the preview:
   - An **amber warning strip**: "This edits `.claude/settings.json` in your project so
     Claude Code reports file activity to Cowtext on `127.0.0.1:4923`. Nothing is
     written until you approve the exact diff below."
   - A blue **new file** marker (the file is absent on disk).
   - A full line diff, all-green additions with dual line-number gutters, showing a
     JSON object with a `"hooks"` key containing exactly three events:
     `PostToolUse` (matcher `Read|Edit|Write|Grep|Glob`), `UserPromptSubmit`, `Stop` —
     each running `curl -s -m 1 -X POST --data-binary @- http://127.0.0.1:4923/event || true`.
   - Footer: "writes .claude/settings.json exactly as previewed" + **Cancel** +
     blue **Approve & install**.
9. **Keyboard safety:** without touching the mouse, press **Enter**, then **Space**.
   *Expected:* the modal CLOSES (or nothing installs) — initial focus is on **Cancel**,
   so no keystroke can ever install. Verify `Test-Path` is still `False`. Reopen the
   modal.
10. **Every dismissal writes nothing.** Try each in turn, reopening the modal after
    each: press **Escape**; click the dark scrim outside the panel; press **✕**; press
    **Cancel**. *Expected:* modal closes all four ways, and after each,
    `Test-Path C:\_cowtest4\.claude\settings.json` is still `False`.
11. Reopen, press **Approve & install**. *Expected:* button shows `· · ·` briefly
    (✕/Escape/scrim inert while writing), then the done screen: "**hooks installed**",
    the mono path, "Claude Code sessions in this project now report to the barn on
    127.0.0.1:4923.", footer "done — remove the hooks block from settings.json to
    uninstall" with a single **Close** button.
12. Verify disk:

    ```powershell
    Get-Content C:\_cowtest4\.claude\settings.json -Raw
    ```

    *Expected:* valid JSON, byte-identical in content to the previewed diff.

### B2. Idempotence — already installed

13. Press **install hooks** again. *Expected:* the amber strip still shows, but the body
    reads "**Hooks are already installed — settings.json needs no changes.**", the
    footer reads "nothing will be written", and **Approve & install is disabled**.
    Close.

### B3. Merge preserves foreign keys

14. Add an unrelated key and a foreign hook, then reopen the modal:

    ```powershell
    Set-Content C:\_cowtest4\.claude\settings.json '{"model": "opus", "hooks": {"PreToolUse": []}}'
    ```

15. Press **install hooks**. *Expected:* a real diff (no "new file" marker) in which
    `"model": "opus"` and `"PreToolUse"` **survive** in the new content, with the three
    Cowtext events added alongside. (Known cosmetic quirk: keys may be re-ordered
    alphabetically on first merge — values must be intact.) **Approve & install**, then
    re-read the file and confirm `"model": "opus"` is still there.

### B4. Invalid JSON is never clobbered

16. Corrupt the file, then reopen the modal:

    ```powershell
    Set-Content C:\_cowtest4\.claude\settings.json '{ this is not json'
    ```

17. Press **install hooks**. *Expected:* a red error strip in the modal (parse failure
    message); **no diff, Approve disabled or absent** — there is no path that overwrites
    a file Cowtext cannot parse. Close, and confirm the broken content is untouched on
    disk. Then restore a clean install (repeat steps 16-with-`'{}'` → Approve, or just
    delete the file and redo B1 step 11).

---

## C. Synthetic events — deterministic feed check (no Claude needed)

The hooks server accepts any POST; these commands impersonate the installed hook.
Keep the event feed panel **expanded** and the canvas visible.

18. Send a **read of a node file** (absolute path with backslashes — path
    normalization is under test):

    ```powershell
    '{"hook_event_name":"PostToolUse","tool_name":"Read","session_id":"manual-1","tool_input":{"file_path":"C:\\_cowtest4\\context\\persona.md"}}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected, within ~a second:*
    - A row appears in the event feed: amber **read** kind tag (58 px mono uppercase),
      a small colored **role dot** (the persona node's role color), the path in mono
      (rtl-truncated so the filename survives), and a HH:MM:SS timestamp.
    - The **persona canvas card pulses**: its role stripe turns **amber**, a 2 px amber
      ring animates around the card, a 5 px blinking amber square appears in the
      header row (tooltip "Agent is reading this file"), and after ~3.2 s the card
      returns to rest on its own.
    - The header shows the running event **count**; the clear button is now enabled.
19. Send an **edit** of the other node file (same command, but
    `"tool_name":"Edit"` and `rules.md`). *Expected:* a green (**success**-colored)
    **edit** tag row with the rules role dot; the `rules` card pulses amber.
20. Send a **prompt** and a **stop**:

    ```powershell
    '{"hook_event_name":"UserPromptSubmit","session_id":"manual-1"}' | curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    '{"hook_event_name":"Stop","session_id":"manual-1"}' | curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected:* two rows with neutral-grey **prompt** and **stop** tags, path column
    shows `—`, no card pulses.
21. Send an **unknown tool**: `"hook_event_name":"PostToolUse","tool_name":"Bash"`, no
    `tool_input`. *Expected:* a neutral **other** row whose path column shows the tool
    name `Bash`.

### C1. Unknown-path events

22. Send a read of a file that is NOT on the graph:

    ```powershell
    '{"hook_event_name":"PostToolUse","tool_name":"Read","session_id":"manual-1","tool_input":{"file_path":"C:\\_cowtest4\\README.md"}}' |
      curl.exe -s -X POST --data-binary "@-" http://127.0.0.1:4923/event
    ```

    *Expected:* the row still appears (unknown paths are logged, never filtered) but is
    **accent-tinted** with a "**not on graph**" tag on the right and **no role dot**.
    **No canvas card pulses.** Same for a path outside the project entirely
    (`C:\\Windows\\whatever.md`).
23. Send garbage: `'not json at all' | curl.exe -s -X POST --data-binary "@-"
    http://127.0.0.1:4923/event`. *Expected:* curl gets a normal empty 200 reply, NO
    row appears, and the app does not crash or log an error dialog (lenient parse drops
    it silently).

### C2. Feed panel mechanics

24. The list **auto-pins to the newest row** — send a few more events and confirm the
    scroll follows; the feed area caps at ~168 px and scrolls beyond that.
25. Collapse the panel (click header), send one event, expand. *Expected:* the count
    kept climbing while collapsed and the new row is there.
26. Press the **trash** button. *Expected:* the feed empties back to the "No events
    yet" placeholder, count disappears, clear disables. (The button must NOT toggle
    collapse — inner buttons swallow the header click.)

---

## D. Node pulse ↔ resolution rule

27. The role dot / pulse must agree between the feed and the canvas: for every row that
    has a role dot the matching card pulsed; for every "not on graph" row nothing
    pulsed. Re-run steps 18 and 22 side-by-side and confirm the invariant.
28. Case-insensitivity: repeat step 18 with the path uppercased
    (`C:\\_COWTEST4\\CONTEXT\\PERSONA.MD`). *Expected:* still resolves — role dot +
    pulse.

---

## E. Restart survival

29. Close the Cowtext window, run `npm run tauri dev` again, Open folder →
    `C:\_cowtest4`. *Expected:* the feed starts **empty** (events are session-local,
    not persisted), and step 18 works again immediately — the server rebound to 4923
    on startup.

---

## F. A real Claude Code session

30. With Cowtext running and `C:\_cowtest4` open, run a real headless session from a
    second terminal **in the project folder**:

    ```powershell
    cd C:\_cowtest4
    claude -p "Read context/persona.md and context/rules.md, then briefly say what they contain."
    ```

    *Expected while it runs:* a **prompt** row, then **read** rows for both context
    files with role dots; the `persona` and `rules` cards pulse amber as their files
    are read; finally a **stop** row. Session id comes from the hook (not "manual-1").
31. Ask for an edit: `claude -p "Append one line '- no filler words' to
    context/rules.md"` (approve/permissions per your Claude Code setup). *Expected:*
    an **edit** (or **write**) row, `rules` card pulses, and the file on disk gains
    the line.

---

## G. App-closed hook no-op

The installed command ends in `|| true` with `-m 1` — a dead server must cost at most
~1 s and never fail the hook.

32. **Close the Cowtext app entirely.** Run the exact installed hook command by hand:

    ```powershell
    '{"hook_event_name":"Stop"}' | curl.exe -s -m 1 -X POST --data-binary "@-" http://127.0.0.1:4923/event
    echo "exit: $LASTEXITCODE"
    ```

    *Expected:* returns almost instantly (connection refused beats the 1 s timeout).
    The raw curl exit code is non-zero — that is exactly why the installed command has
    `|| true`; the hook as installed exits 0.
33. Still with Cowtext closed, run a real session: `claude -p "say hi"` from
    `C:\_cowtest4`. *Expected:* the session runs at full speed with **no error, no
    visible pause, no hook warning** — hooks are a silent no-op while the barn is away.
34. Reopen Cowtext + the project. *Expected:* live events flow again with no
    reinstall needed.

---

## Cleanup

35. Close the app and delete the scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_cowtest4
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Hooks install trust boundary | | |
| C Synthetic events + unknown paths | | |
| D Pulse/resolution invariant | | |
| E Restart survival | | |
| F Real Claude session | | |
| G App-closed no-op | | |

Tester: ____________  Date: ____________  Build/commit: ____________
