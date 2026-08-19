---
name: bubble-controller-silent
description: T6 bubble controller (cow.ts/mapper.ts) design — flavor idle bubbles are silent, real-event bubbles piggyback on existing per-event sfx.play() calls; no new sound was added for "bubble spawn" itself.
metadata:
  type: project
---

WO01 Block E T6 (docs/INPUT_PROMPT.md) asked for real-event bubbles above the
cow ("reading CLAUDE.md", "editing rules.md" — verb derived from
`BarnEvent.kind`, via a new `verbLabel()` helper in `src/scene/mapper.ts`)
plus a ~10-line flavor pool that rotates when idle > 30 s (`FLAVOR_LINES` /
`FLAVOR_GAP_MS` in `src/scene/cow.ts`, gated on `idleStage >= 2`, the same
30 s threshold BarnScene already uses for the lying pose). Real events
preempt flavor bubbles for free — `Cow.showBubble()` already unconditionally
overwrites `this.bubble` regardless of source, no extra preemption logic
needed.

**Why:** the task brief asked for SFX "on bubble spawn ... within the
sound-design law", but `docs/design/SOUND_DESIGN.md`'s deliberately-SILENT
list explicitly includes "bubbles". Rather than invent a new bubble-spawn cue
(which would contradict that list), the decision made was: flavor bubbles
stay fully silent (cow.ts never imports sfx.ts, so this is free); real-event
bubbles are not given a *new* cue either — they already coincide with (or
closely follow) mapper.ts's existing per-event `sfx.play()` calls (kb_clack
on prompt, drawer_slide/page_flip/paper_shuffle on read arrival — same
`onArrive` callback as the bubble text, ding on edit/write busy-end, moo_happy
on stop). That satisfies "sound plays around bubble spawn" without adding a
bubble-specific gate to sfx.ts or touching its cue-gating internals.

**How to apply:** if a future block (e.g. WO01 Block F's agent-status bubble
reuse, `docs/INPUT_PROMPT.md` Block F scene tie-in) wants bubbles to sound on
their own, that requires an explicit new decision overriding SOUND_DESIGN's
silent-list entry for "bubbles" — flag it back to the user/tech-lead rather
than assuming it's already covered. Don't reorder mapper.ts's existing sfx
call sites to "line them up" with bubble timing; a header comment in
mapper.ts (from a different lane) says those calls must stay in place.
