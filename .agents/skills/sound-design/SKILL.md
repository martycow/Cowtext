---
name: sound-design
description: Cowtext SFX rules — ducking, cooldowns, read-burst throttle, voice pool, never-queue, and the calm/mute/hidden gates — plus the cue sheet and mixing tiers. Load when touching src/scene/sfx.ts or wiring any sound trigger. Full spec in docs/design/SOUND_DESIGN.md.
---

# Sound design rules

Source: `docs/design/SOUND_DESIGN.md`. Sound is the barn's voice — the audio
equivalent of Silkscreen. Tool-layer sound = state changed; barn sound = the cow
moved. Routine UI events NEVER sound (no hovers, clicks, toasts, selection).

## Architecture rules

- `src/scene/sfx.ts` is the ONLY file that imports howler.
- All gating lives **inside `play()`** — mute, calm, hidden, group gains, cooldowns,
  throttle, voice pool, ducking. Call sites stay dumb.
- Sound fires for the *event*, not the possibly-dropped animation task — except
  arrival-bound cues (read cues on `onArrive`, the moo on the ✓ arrival).
- Public API: `play(cue)`, `startTypewriter()`, `stopTypewriter()`,
  `tickAmbient(idleMs)`, `setCalm(b)`, `setMuted(b)`, `setGroupGain(group, g)`.

## Gates (checked in this order)

1. **Mute** — hard stop, no fade longer than 50 ms; animations continue.
2. **Calm mode** — one toggle, two effects: mute + reduced motion. OS
   `prefers-reduced-motion` force-enables the motion half, only *suggests* muting.
3. **Hidden/minimized window** — all sound suspends (pairs with the Pixi pause
   guard). Unfocused-but-visible keeps sounding — that's the point of the app.
4. **Pre-gesture drop** — while `AudioContext.state !== "running"`, cues are
   dropped, never queued for the unlock burst.

## Mixing rules

- **Tiers** (master peak → runtime group): Hero −7 (`moo_happy`) · Confirm −10
  (`ding`, `compile_ok`, `assemble_done`) · Action −9…−11 (`kb_clack`,
  `drawer_slide`, `typewriter`, `error_soft`) · Texture −13 (`page_flip`,
  `paper_shuffle`, calf blips) · Whisper −16 (`sniff`) · Bed −18 (`ambient_loop`).
  Ceiling −1 dBFS; default master volume 60%.
- **Ducking**: ambient bed ducks −6 dB under any one-shot/typewriter (400 ms
  recovery) and fades out 250 ms on any new event. The moo ducks all other barn
  cues −12 dB — the turn-complete moment belongs to the cow. Tool-layer confirms
  are never ducked.
- **Voice pool**: max 3 one-shots + 1 typewriter loop + 1 ambient bed; a fourth
  one-shot steals the oldest voice.
- **Never queue sound.** Animations queue; audio does not. A cue that can't play
  now is dropped — late sound is wrong sound.

## Cooldowns & throttle

- **Read-burst throttle**: ≤ 1 read cue per 150 ms; ≥ 4 reads inside 500 ms
  collapse to one `paper_shuffle`, then silence until the burst ends. Claimed at
  *event receipt*, before enqueue — a throttled read still walks/flashes, silently.
  Sound summarizes; visuals enumerate.
- Per-cue cooldowns: `sniff` 1 s (volleys → one sniff) · `ding` 2 s (and only if
  the typewriter actually ran) · `error_soft` 10 s (fires on 0 → n only, not
  n → n+1) · `moo_happy` ≤ 1× per turn, dropped (never queued) if interrupted ·
  calf spawn/despawn batch to one blip per second.

## Stays SILENT, deliberately

Footsteps · bubbles · camera pan/zoom · off-graph reads (no prop = no sound; the
EventLog row is the only trace) · `flashProp` outside a read arrival · view/demo
toggles · queue-cap drops · unknown event kinds (future kinds must opt in).
Demo mode plays cues normally — it exists to show the sound off.

## Assets

Masters: 44.1 kHz/16-bit mono WAV, per-tier peaks, ≤ 200 KB, seamless loops.
Names describe the *sound*, not the event (`ding.wav`, not `write_complete.wav`).
Sprite map offsets generate from `assets/sfx/cues.json` — never hand-typed.
No base64 audio in source, ever.
