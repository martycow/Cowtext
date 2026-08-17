# Phase 5 Juice — manual test walk (Lane C)

**Recommended walk order across the four 2026-08-17 manuals:**
`SETTINGS_TEST_MANUAL.md` first (the toggles the other walks rely on) → this
manual (demo mode, no `claude` needed) → `PHASE5_SOUND_TEST_MANUAL.md` (same
demo, sound on) → `PHASE6_TEST_MANUAL.md` last (needs `claude` on PATH).

Run `npm run tauri dev`, switch to the Barn view. Most checks use the Demo
button; waiting-choreography checks need patience (or a temporary threshold
edit — revert before closing). Calm mode toggles live in Settings.

## 1. Tier-1 juice (demo running)

| # | Check | Expect |
|---|---|---|
| 1.1 | Watch the cow walk (any read) | 2-frame trot bob; the blue scarf flips between two frames with the trot; on stop the scarf holds its last frame ~90 ms, then settles (J1) |
| 1.2 | Start of every walk | 1 px crouch for ~80 ms before the first step (J2); total walk still ≤ 1.5 s |
| 1.3 | Read arrives at a prop | prop jiggles 1 px sideways for one frame, then does the 2-frame bounce (J2) |
| 1.4 | While a task is queued | the cow's eye shifts 1 px toward the newest target's direction; resets on arrival (J3). Works across facing flips |
| 1.5 | Each footfall | small checker-dither dust puff, 3 frames ≈ 240 ms, warm wood colour, max 8 alive (J7) |
| 1.6 | End of every walk | one landing frame: body 1 px wider and shorter — a drawn frame, no scale shimmer (J7) |
| 1.7 | `stop` event | bounciest walk in the set: 2 px hop per stride, dust, arrival squash, then "✓" bubble + moo (J6/E6) |

## 2. Session accumulation (J5)

| # | Check | Expect |
|---|---|---|
| 2.1 | Let the demo do writes | side-desk paper stack grows one 2 px step per write event (at event receipt — the ding still lands later, at busy completion); caps at 8, then a second pile starts on the left; second pile caps and stays |
| 2.2 | Let the demo do reads | cabinet drawer stays 2 px ajar / bookshelf book stays popped / crate paper stays lifted for the whole session |
| 2.3 | Toggle Canvas ⇄ Barn | ajar props and (write count) paper stack are restored after remount — derived from the event ring, not from having animated it |
| 2.4 | Clear the event feed, toggle views | accumulation resets (ring is the source of truth) |
| 2.5 | Stop the demo | demo-grown papers and ajar props disappear immediately (ring purged §7.5, accumulation re-derived); the cow does not replay any stale event |

## 3. Waiting choreography (E5)

Stop the demo and don't touch anything.

| elapsed | Expect |
|---|---|
| 5 s | coffee cup with a slow 2-frame steam curl appears on the dev desk; cow walks home and chews (2 frames, 1.2 s period) |
| 30 s | cow lies down (legs folded, body settled); occasional micro-behaviour ≥ 8 s apart (slow blink or 1 px weight shift) |
| 5 min | eyes-closed frame; a small "Z" drifts up from the cow every 8 s |
| any event | cow pops up with a 2 px hop, scarf settles, goes straight into the event's animation; coffee disappears |

## 4. Calm mode / reduced motion

Enable Calm mode in Settings (or set OS reduced motion).

| # | Check | Expect |
|---|---|---|
| 4.1 | Any walk | cow still relocates (log/pulse truthful) at ~70 % alpha, no trot bob, no crouch, no dust, no squash, no scarf flutter |
| 4.2 | Read arrival | prop shows no jiggle/bounce (frame 0) but still ends up ajar — accumulation is information and stays |
| 4.3 | Writes | paper stack still grows |
| 4.4 | Waiting | coffee cup appears without steam; cow rests statically; no Z-motes, no micro-fidgets |
| 4.5 | Turn Calm off | juice returns immediately (no reload needed) |

## 5. Ticker hygiene

| # | Check | Expect |
|---|---|---|
| 5.1 | Hide the window / switch tabs | ticker stops (CPU near zero for the scene); on return, the scene resumes into the correct accumulated state |
| 5.2 | Leave idle > 10 s | frame rate drops to 12 fps (idle loops are ≥ 120 ms holds — visually identical); any event snaps back to 60 |
| 5.3 | Resize the window before touching the camera | scene re-centres; after any pan/zoom, resize leaves the camera alone |

## 6. Demo filtering + HUD

| # | Check | Expect |
|---|---|---|
| 6.1 | Run the demo, open the event feed | demo rows carry an amber `DEMO` chip after the kind tag |
| 6.2 | Stop the demo | demo rows are purged from the feed; live rows stay |
| 6.3 | Bottom-left of the barn | pixel-font amber session ticker `R n · W n · ✓ n` — counts non-demo events only (stays 0 during a pure demo run) |
| 6.4 | Demo button | token-styled (no inline colours); amber tint while running |
