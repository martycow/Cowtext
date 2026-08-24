# Phase 5 — Sound manual test (Lane A)

Walk with the app running (`npm run tauri dev`), a project open, and Settings at
defaults (master 60%, Barn + Tool sounds on, Mute/Calm off). Spec authority:
`docs/design/SOUND_DESIGN.md` §2b/§3, `docs/_archive/contracts/PHASE56_CONTRACT.md` §5.

## Barn cues (Barn view, run the Demo)

1. **kb_clack** — demo `prompt` step: one soft key clack at event receipt ("!" bubble). Never more than one per prompt.
2. **Read cues** — cow walks to a prop; the sound lands on the prop flash (arrival), not on walk start. Cabinet (rules/persona) = drawer slide; bookshelf (architecture/reference/glossary) = page flip; crate (task/workflow) = paper shuffle.
3. **Read burst** — the demo's 5-read volley: at most one read cue per 150 ms; 4+ reads inside 500 ms collapse to a single paper shuffle, then silence until the volley ends. Every read still walks/flashes.
4. **typewriter + ding** — `edit`/`write`: loop starts when the busy bob starts at the side desk, stops when it ends, then one ding. Interrupt mid-busy (click Stop demo timed right, or fire `stop`): loop cuts ≤50 ms, **no ding**.
5. **sniff** — `grep`/`glob`: one sniff at the first hop's start; second hop silent; repeat searches within 1 s stay silent.
6. **moo_happy** — `stop`: moo lands with the "✓" bubble at the dev desk. While it plays, other barn sound ducks audibly (−12 dB). If a new event interrupts before arrival, no moo (dropped, never queued).
7. **Ambient bed** — leave the barn idle >5 s: bed fades in over ~800 ms. Any event kills it within ~250 ms. While a one-shot plays over the bed, the bed dips (−6 dB) and recovers over ~400 ms.
8. **Voice pool** — hammer events (demo + live): never more than 3 one-shots at once; the oldest is stolen, nothing queues or lags.

## Tool cues (any view)

9. **compile_ok** — Compile → approve diff → written: two-note confirm on "done". Dry-run/cancel: silent.
10. **error_soft (compile)** — open Compile with a graph problem (e.g. cycle): one soft double-knock when the preview shows errors. Re-open repeatedly: silent for 10 s (cooldown).
11. **assemble_done** — queue 2+ assembles: one rising arpeggio when the whole queue drains (not per node), only if ≥1 succeeded.
12. **error_soft (assemble)** — a failing assemble (bogus claude path): knock when the error count goes 0→n; further errors while n>0 are silent.

## Detached mode (Canvas view)

13. Switch to Canvas, feed live events (or hooks): prompt→clack, resolved read→role cue, grep→sniff, edit/write→ding (no typewriter loop — the animation isn't visible), stop→moo. Unresolved reads silent.
14. Switch back to Barn: no double-fire (mapper takes over; detached path goes inert).

## Gates

15. **Mute** — everything stops ≤50 ms; animations continue. Unmute: next event sounds.
16. **Calm mode** — same hard stop (calm implies mute).
17. **Barn sounds off** — barn cues + bed + typewriter silent; tool cues still play. **Tool sounds off** — inverse.
18. **Master volume** — slider scales everything live.
19. **Hidden window** — minimize mid-sound: all sound stops ≤50 ms; restore: silence until the next event/tick (loops don't auto-resume).
20. **calf_spawn / calf_despawn** — never heard (loaded, unwired — contract D9). Footsteps, bubbles, camera, view/demo toggles: always silent.
