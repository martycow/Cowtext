# Settings window — manual test (Lane B, Phase 5/6 contract §6)

Run `npm run tauri dev`. Settings gear (icon-only, top bar, right of Compile group) opens
the modal in any state — no project required.

## Shell

1. Open Settings → 560px panel on scrim, 44px header "Settings", ✕ closes.
2. Escape closes. Click on the scrim closes. Focus lands inside the panel on open.
3. Three sections: SOUND, AGENT, CONTEXT; footer reads "Settings apply immediately and
   persist on this machine." with a single secondary **Done** button. No primary/accent
   button anywhere, no cow, no pixel font.

## Sound

4. Master volume slider 0–100 step 5, mono `%` readout follows it. Default 60%.
5. Toggle **Mute** on → slider and its readout dim and stop responding; label dims too.
   Mute off → slider live again.
6. Toggle **Calm mode** on → Mute shows checked and is disabled with title
   "Calm mode implies mute"; slider dims. Calm off → Mute returns to its own value.
7. **Tool sounds** helper reads "Compile, assemble and problem chimes."; Calm helper reads
   "No sound and reduced motion. The barn keeps working, quietly."
8. With Windows Settings → Accessibility → Visual effects → Animation effects OFF (OS
   reduced motion) and Calm off: an extra muted line appears — "Your OS requests reduced
   motion — animations are already reduced." It disappears when Calm is turned on.
9. Toggles are accent (blue), 34×19 pills, keyboard-operable (Tab + Space/Enter).

## Agent

10. `claude` binary field: mono input, placeholder `auto-detect (where claude)`. Type a
    path, press Enter (or Tab away) → persisted (see 13); whitespace is trimmed.
11. Hooks server row shows `127.0.0.1:4923`, read-only.

## Context

12. No project open → "Context data — No project open" (muted). Open a project → the row
    shows `<root>\.cowtext\graph.json`, truncated from the LEFT (rtl), full path in the
    hover title.

## Persistence

13. Change several settings, wait ~1s, check
    `%AppData%\com.mooexe.cowtext\settings.json` — exact `AppSettings` shape, 2-space
    indent, keys in declared order, trailing newline. Restart the app → all values
    restored; `claude` binary override applies to Assemble runs at startup.
14. Delete/corrupt `settings.json` → app starts with defaults (volume 60%, both sound
    switches on, mute/calm off, empty binary path); no error surfaces in the UI.
