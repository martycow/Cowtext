# JUICE.md — making the Barn irresistible

Research notes for Cowtext's charm budget: what makes 16-bit scenes feel *alive*, which
games already solved our exact problems, and a moment-by-moment storyboard for the six
core BarnEvents (plan §8). Written before Phase 5 so the barn is designed, not improvised.

**Ground rules this document respects** (from `docs/design/DESIGN_SPEC.md` and plan §8):

- Charm is **banned inside tool chrome**. The barn is the one room where juice lives.
- Every barn animation **≤ 1.5 s and interruptible**; events queue; walk paths recompute.
- **Calm mode and mute exist from day one** — one control, no sound + reduced motion.
- Sprites/SFX are **assets, not code**. Placeholder CC0 first (Kenney iso + itch.io farm
  packs), Aseprite originals later, tracked in a licence manifest (FEATURES 7.8).

---

## 0. The thesis: a fireplace, not a fireworks show

The barn is not a game — nobody is holding a controller. Steve Swink defines game feel as
*"real-time control of virtual objects in a simulated space, with interactions emphasised
by polish."* We only get the third block: **polish**. There is no player input to
amplify, so the barn's genre isn't "action game", it's **ambient companion** — closer to
a fish tank, a fireplace, or Coffee Talk's rain-soaked window than to a juiced-up
Breakout clone.

That reframe matters because the juice canon ("Juice it or Lose it", GDC 2012) was built
for *player actions*: every input gets tweening, scale-bounce, particles, screen shake,
pitch-varied sound. Applied raw to a passive scene it becomes a slot machine yelling in
your peripheral vision. The fix comes from **calm technology** (Weiser & Brown): the
scene lives in the periphery and *earns* the fovea only when something meaningful
happens. In Cowtext terms:

> **Ambient life is continuous and tiny. Event juice is rare and proportional.**
> The cow chewing hay is 2 pixels of motion. The end-of-turn "✓" trot is the biggest
> moment in the scene — because it's the moment Marty actually looks over.

Second reframe: the barn is also a **status display**. Every cute thing must double as
information ("Blue is you, amber is the cow" already gives us the vocabulary). A dust
mote is decoration; a filing-cabinet drawer left ajar because that node was read this
session is decoration *and* a usage heatmap you can feel. Prefer the second kind.

---

## 1. SNES visual grammar — the rules that make it read as 16-bit

What separates "looks like Harvest Moon" from "programmer art with big pixels":

1. **Palette discipline.** One master palette, 16–32 colours for the whole scene; each
   sprite draws from a 16-colour ramp. When a colour is missing, **hue-shift** an
   existing ramp (shadows shift toward blue/purple, highlights toward yellow) instead of
   adding greys. This is *the* single highest-leverage rule — a disciplined palette makes
   even placeholder shapes look intentional. Build the barn palette first, in Lospec
   format, and check every asset (including the amber HUD) against it.
2. **Warm light, cool shadow.** The plan calls for "dusk light through slats". SNES-era
   warmth = saturated midtones, desaturated *and hue-shifted* darks. Never shade with
   black-multiplied versions of the base colour.
3. **Selective outlines (sel-out).** Outline sprites in a darker version of the adjacent
   colour, not pure black; drop the outline on top edges where light hits. Characters get
   outlines (they must pop off the floor); floor tiles don't.
4. **Dithering is a spice.** 2×2 checker dither only for large gradients — the dusk light
   pool on the floorboards, the sky in the window. Never on small sprites, never as an
   all-over texture. (The tool layer already reserves dither for the canvas background;
   the barn should use it just as sparingly.)
5. **Max 4 frames per loop** (plan §8 hard rule) — and that's enough. Harvest Moon SNES
   walks are 4 frames; chicken pecks are 2. The trick is **held frames with snappy
   transitions**: 2 frames at 150 ms reads better than 8 frames at 40 ms. Timing charts
   over frame counts.
6. **2:1 isometric mechanics.** 32×16 base diamond (plan §8); every edge is a run of two
   pixels per row so tiles lock seamlessly. Elevation = stacked half-height tiles. Depth
   sort by `(isoY, isoX)`; the cow sorts against props per-tile, so props should own
   whole tiles. Light source fixed upper-left, shadows lower-right, everywhere,
   forever.
7. **One pixel scale.** Integer zoom only (2×/3×), `nearestNeighbor` scaling in Pixi,
   camera positions snapped to whole screen pixels. A single mixed-resolution sprite or
   sub-pixel camera pan breaks the entire spell — this is the #1 crime in "modern retro"
   and it's free to avoid.
8. **Motion grammar.** Squash & stretch *in pixels*: the cow's landing frame is 1 px
   wider and 1 px shorter, not a 0.9× scale transform on the sprite (scaling pixel art
   arbitrarily produces shimmer). Pre-author the squash frames. Smooth transforms are
   allowed for **position** (walks, bubbles, camera) with ease-out; **appearance**
   changes stay frame-quantised.

---

## 2. The juice canon, adapted for a spectator scene

The distilled technique ladder from *Juice it or Lose it* / *Game Feel* / the 12
principles of animation, filtered through "nobody is playing this":

| Canon technique | Verdict for the barn |
|---|---|
| **Tweening + easing** | YES — everything that moves positionally eases out. Nothing linear, nothing instant except frame flips. |
| **Anticipation** | YES — the single best trick we can steal. 100–150 ms wind-up before every action (cow crouches 1 frame before trotting, drawer handle jiggles 1 frame before sliding) makes 4-frame animation read as intentional character, not state-machine flicker. |
| **Follow-through / secondary motion** | YES, cheap version — the blue scarf is *the* secondary-motion asset. 2-frame scarf flutter continues after the cow stops. Ears settle one frame late. |
| **Squash & stretch** | YES, pre-authored frames only (see §1.8). |
| **Particles** | Sparingly — 3–5 px dust puffs on cow footfalls, 2–3 paper scraps on a write, hay flecks on despawn. Pooled, palette-locked, ≤ 8 alive at once. |
| **Screen shake** | **NO.** Screen shake is the archetypal player-feedback tool; in a passive corner-of-eye scene it's an alarm. Banned. |
| **Sound per event, pitch-varied** | YES — ±5 % random pitch on every SFX so repeated reads don't machine-gun. Volume ducked ~50 % when the window is unfocused; muted entirely in calm mode. |
| **Slow-mo / hit-stop** | NO — there are no hits. |
| **Colour flash on impact** | Only the HUD amber blink already specced; never full-sprite flashes. |
| **"Eyes on the ball"** | YES — the canon's cutest trick, free to adopt: the cow's 2-px eyes glance toward whatever prop the *next queued event* targets. Sells intelligence with zero frames. |

**The Unpacking lesson (sound is half the juice):** Unpacking shipped 14,000 foley files
so every item sounded *correct* on every surface — sound designer Jeff van Dyck's rule
was that interactions must feel "satisfying, correct, and playful". We need maybe 12
sounds, but the same rule applies: **diegetic, materially correct, dry and short**.
A real wooden drawer, a real page flip, a felt-tipped typewriter. No UI bleeps, no synth
whooshes — the barn sounds like a barn. And their other insight transfers directly:
realistic sound *contrasting* stylised visuals is a feature, not a mismatch.

**The A Short Hike lesson:** its charm is 90 % ambience — wind, rustle, glide — under a
no-pressure loop. The barn's ambient bed (crickets? rain on the roof? see idea A2) will
do more for "stranger smiles in 30 seconds" (Phase 5 acceptance) than any single
animation.

**The Wilmot's Warehouse lesson:** organising abstract information *spatially* is
inherently satisfying — the warehouse IS the player's mental model made visible. That's
literally Cowtext's product thesis; the barn should lean in by making props visibly
*accumulate state* (paper stacks grow per write, a drawer left ajar per read) so a
glance shows the session's shape, like Wilmot's floor shows your mind.

**The dev-tools-with-personality lesson** (Slack's loading copy, VS Code Pets, Claude
Code's tamagotchi buddy): personality is loved when it is **opt-in, peripheral, and
never gates work**. Slack's jokes live on loading screens (dead time); vscode-pets lives
in a panel you summon; the buddy reacts to what you do but demands nothing. The moment
charm blocks a task or repeats a joke at you, love flips to rage. Cowtext already has
the right architecture — the barn is a *separate view* behind a toggle — and DESIGN_SPEC
banning mascots from working chrome is precisely the discipline that made those tools
beloved. Hold that line even when a cow-in-a-toast seems like a good idea at 2 a.m.

---

## 3. Steal-this reference table

| Source | Steal this | Why it works |
|---|---|---|
| **Harvest Moon (SNES)** | Warm dusk palette; 4-frame walk cycles; animals as pure vibe objects; interiors made of ~6 prop types | Proof that tiny frame budgets + palette discipline read as "wistful and upbeat at once"; the whole cast fits in a sprite sheet smaller than our favicon |
| **Stardew Valley** | Anticipation + exaggeration on every tool swing; single-frame reaction poses (the ! surprise); seasons as palette swaps | ConcernedApe gets "juicy" out of held poses and easing, not frame count — the model for our ≤4-frame ceiling |
| **A Short Hike** | Ambient soundscape carrying the mood; motion that's calm but never static | Charm from atmosphere, not events — the template for the barn's idle state |
| **Unpacking** | Materially-correct dry foley; satisfaction from *placement*; contrast of real sound on stylised pixels | 14k foley files for a zen game — sound is half of "satisfying"; our 12 sounds must be chosen like theirs |
| **Wilmot's Warehouse** | Space as externalised memory; visible accumulation of organised stuff | The warehouse is a mental model you walk around in — exactly what the barn is for a context graph |
| **Game Dev Tycoon** | Workers-at-desks as progress display; glanceable "busy vs idle" office | Proof that watching sprites work *is* a status UI people enjoy leaving open |
| **Coffee Talk** | Rain-on-window + lo-fi loop as a "stay a while" invitation; one room, deeply dressed | One lovingly-lit room beats a big world; ambience makes people *choose* to keep the view open |
| **Tamagotchi / vscode-pets / Claude buddy** | Companion that reacts to your work but never demands; rarity/variety as delight | Personality is loved precisely when it's peripheral and optional — burnout-antidote, not distraction |
| **Slack (loading copy era)** | Charm confined to dead time; personality = feels like a co-worker | Charm placed where attention is already idle costs nothing and buys love |
| **Calm technology (Weiser & Brown)** | "Informs without demanding focus"; periphery ⇄ centre shifts | The theoretical licence for the whole barn: an ambient status display, not a notification system |
| **Kirokaze pixel GIFs** | Loopable micro-scenes: flicker, steam, rain, one moving figure | The aesthetic north star for "barn at idle" — 90 % still, 10 % alive, endlessly watchable |

---

## 4. Ranked idea list (delight per effort)

Effort: **S** ≤ half an evening · **M** 1–2 evenings · **L** 3+ evenings.
Delight: ★–★★★ expected smiles per stranger.
Phase column respects FEATURES.md — nothing here licenses building early.

### Tier 1 — maximum delight per pixel (do these)

| # | Idea | Effort | Delight | Phase |
|---|---|---|---|---|
| J1 | **Scarf physics**: 2-frame flutter while walking, settles one frame after stopping; the scarf is the brand, make it the most alive thing on screen | S | ★★★ | 5 |
| J2 | **Anticipation frames everywhere**: 1 pre-frame before trot, drawer, book-pull, sit | S | ★★★ | 5 |
| J3 | **Eyes toward next target**: cow glances at the prop for the next queued event | S | ★★★ | 5 |
| J4 | **Pitch-varied dry foley set** (~12 sounds, ±5 % pitch, ducked when unfocused) | M | ★★★ | 5 |
| J5 | **Session accumulation**: paper stack +1 per write, drawer ajar per read node — the barn *shows the session* at a glance | M | ★★★ | 5 |
| J6 | **Happy-moo turn-complete moment** — the one big payoff; see storyboard E6 | M | ★★★ | 5 |
| J7 | **Dust-puff footfalls + landing squash frame** (pooled particles, palette-locked) | S | ★★ | 5 |
| J8 | **Calf subagents** trotting out of the barn door, mini-scarves, despawn with hay fleck poof | M | ★★★ | 5 |

### Tier 2 — ambience (the "leave it open" layer)

| # | Idea | Effort | Delight | Phase |
|---|---|---|---|---|
| A1 | **Dusk light shafts** through wall slats, 2×2 dither, motes drifting in the beam (3–4 motes, 8 s loops) | M | ★★★ | 6 (7.10) |
| A2 | **Ambient audio bed**: barn-tone + occasional creak; optional rain-on-roof toggle (Coffee Talk move) | M | ★★ | 6 (7.10) |
| A3 | **Day/night tint from wall-clock time** — dusk palette swap, lantern glow at night; the barn knows it's late with you | M | ★★ | 6 (7.10) |
| A4 | **Idle micro-behaviours**, weighted random ≥ 8 s apart: cow chews hay, tail swish, ear flick, one slow blink; dev sips coffee, stretches | M | ★★★ | 6 (7.10) |
| A5 | **A barn cat** asleep on a crate; relocates at most once per 10 min; wakes only for `stop` | S | ★★★ | 6 |
| A6 | **Waiting choreography** (>5 s): coffee steam over dev, cow lies down after 30 s, asleep with Z-motes after 5 min — instant "is it running?" glanceability | M | ★★ | 5 (specced §8) |

### Tier 3 — earned extras (only after 1 & 2 land)

| # | Idea | Effort | Delight | Phase |
|---|---|---|---|---|
| X1 | **Filename bubbles with personality**: bubble pops in with 2-frame squash, tail points at the prop, mono type, 24-char truncation (specced) | S | ★★ | 5 |
| X2 | **Error moment**: tool-error event → cow's ears droop, "?" bubble, single low moo — sympathy, not alarm | S | ★★ | 5 |
| X3 | **Long-session weather**: gentle rain after 2 h of events — ambience as playtime clock | M | ★★ | 6 |
| X4 | **Seasonal palette swaps** by real calendar (Stardew move): hay green in spring, frost on the window in December | M | ★★ | 7+ |
| X5 | **GIF export of the session** (FEATURES 7.11) — shareability is the barn's marketing department | L | ★★★ | 6 |
| X6 | **Barn mini-mode** always-on-top window (FEATURES 7.12) — the fish-tank endgame | L | ★★★ | 7+ |
| X7 | **Rare idle events** (≤ 1/hour, weighted): a mouse crosses the floor; the cat opens one eye; a bird lands in the window. Never during events | M | ★★★ | 7+ |

### Anti-ideas (researched, rejected)

- **Screen shake, full-sprite flashes, confetti** — player-feedback tools; alarms in a
  peripheral scene.
- **Cow reacting to *typing* or cursor** — crosses into "watching you work"; the mascot
  ban exists for a reason.
- **Achievement toasts from the barn** — charm invading chrome; also gamifies a tool
  whose whole pitch is calm control.
- **Speech-bubble jokes / random quips** — text personality ages in a week (the Clippy
  failure mode). The cow communicates in filenames, glances, and moos only.
- **>4-frame "smooth" animation** — breaks the 16-bit contract and triples asset cost
  for negative return.

---

## 5. Storyboard — the six core events

Conventions: 60 fps timeline, frame-quantised sprite flips, positional tweens ease-out.
Every sequence is interruptible at any tick: a new event for the same actor cancels the
tail of the current one (walks recompute; SFX for a cancelled action doesn't fire).
**Calm mode**: column at the end of each event. All SFX one-shot, ±5 % pitch.

### E1 · `prompt_submitted` — "your move reaches the barn"

| t | Action |
|---|---|
| 0 ms | Dev sprite: 1-frame lean-in toward monitor (anticipation) |
| 100 ms | Monitor glow brightens one palette step; *keyboard clack* (3-tap foley) |
| 250 ms | Cow's head turns toward dev (2 frames); ear flick |
| 400 ms | "!" bubble pops over cow — 2-frame squash-in, holds 600 ms, 1-frame pop-out |
| ~1.2 s | Done; cow holds an "alert" stance until the next event arrives |

Calm mode: no sound; bubble appears/disappears without squash; lean-in kept (state info).

### E2 · `read <file>` — the signature loop

| t | Action |
|---|---|
| 0 ms | Eyes glance toward target prop (already done if E-queue foresaw it) |
| 80 ms | 1-frame crouch (anticipation) → trot begins, 4-frame walk, scarf flutter, dust puff per footfall; speed scales so any path ≤ 700 ms |
| arrive | 1-frame landing squash |
| +100 ms | Prop reacts by role: cabinet drawer handle jiggles 1 frame then slides open (*wood drawer*, dry); bookshelf book pops out 2 px with 1-frame overshoot (*page flip*); corkboard paper lifts (*paper rustle*) |
| +250 ms | Filename bubble squash-in above prop (mono, 24-char truncation) |
| +1.1 s | Bubble out; drawer stays **ajar 2 px** for the session (J5 accumulation) |

Total ≤ 1.5 s. Rapid-fire reads: if the next read arrives mid-walk, path recomputes
mid-stride; if ≥ 3 reads are queued, walks compress to 300 ms hops and bubbles show only
for the newest (the rest tally in the HUD ticker) — busy looks *busy*, not glitchy.

Calm mode: cow relocates with a 2-frame fade-walk (no dust, no SFX); drawer opens
without jiggle; bubble static. Ajar-drawer accumulation stays — it's information.

### E3 · `edit/write <file>` — "the cow is typing"

| t | Action |
|---|---|
| 0 ms | Trot to side desk (as E2, ≤ 700 ms) |
| arrive | Cow sits (2 frames); *chair creak* |
| +150 ms | Typewriter loop: 2 frames, hooves bounce; *soft typewriter* at 50 % volume, loops while writes continue |
| write confirmed | *Ding* + paper-scrap particle arcs onto stack; **stack sprite +1 height step** (caps at 8, then a second pile starts — visible productivity, Wilmot-style) |
| +1.4 s idle | If no follow-up write: cow leans back 1 frame, loop ends |

Consecutive writes extend the typing loop rather than restarting the sit — the ding +
paper is the per-write juice. Calm mode: typing loop 1 frame (static hooves-down), no
SFX, stack still grows.

### E4 · `grep/glob` — "sniffing around"

| t | Action |
|---|---|
| 0 ms | Cow lowers head (1 frame), "?" bubble squash-in |
| 150 ms | Sniff-walk between the two nearest prop clusters: 2-frame head-down walk, slower gait; *soft sniff* ×2, pitch-varied |
| 900 ms | Head up, ear flick — "found the scent" |
| ≤ 1.3 s | Bubble out; if the grep leads to reads, E2 chains and the eyes-glance sells cause → effect |

Calm mode: "?" bubble + static head-down pose 800 ms, no wander, no sound.

### E5 · waiting > 5 s — the fireplace state

Not an animation — a *state* with escalation. This is where ambience carries the scene:

| elapsed | Scene |
|---|---|
| 5 s | Coffee cup appears at dev's desk; 2-frame steam curl loop (8 s period); cow drifts to hay bale, chew loop (2 frames, 1.2 s period) |
| 30 s | Cow lies down (2-frame settle); idle micro-behaviours begin (A4): tail swish, ear flick, slow blink — weighted random, ≥ 8 s gaps |
| 5 min | Cow asleep: 1-frame eyes-closed + drifting Z-mote (3 px); dev leans back; ambient bed (if enabled) foregrounds slightly |
| any event | Wake = 1-frame head-pop + scarf settle, straight into E1–E4; **from-sleep wake gets a tiny 2-px hop** — the one exaggeration the scene allows, because it answers "did it hear me?" |

Calm mode: coffee + static resting pose only; no micro-behaviours, no Z-motes.

### E6 · `stop` — the payoff

The one moment the user reliably *looks at the barn* (their turn is starting). Spend the
budget here:

| t | Action |
|---|---|
| 0 ms | Cow's head pops up (1 frame anticipation) |
| 100 ms | Trot back to dev's desk — the *bounciest* walk in the set: +1 px hop per stride, scarf at full 2-frame flutter, dust puffs |
| ~700 ms | Arrive, 1-frame squash, head-tilt toward dev |
| 800 ms | "✓" bubble squash-in; **short happy moo** (< 400 ms, the only "voice" SFX in the app — scarcity keeps it lovable) |
| 1.0 s | Calf despawns if a subagent finished with the turn: trots to barn door, hay-fleck poof |
| 1.4 s | Bubble out; cow settles beside desk; HUD ticker rolls the session totals |

Calm mode: relocate-fade, static "✓" bubble 800 ms, no moo. The ✓ always shows — turn
completion is information, not decoration.

**Cross-event rules** (restating plan §8 with the research applied): one animation queue
per actor; walks recompute, never teleport (except calm-mode fade); bubbles are the only
UI-layer objects and never overlap (newest wins); SFX budget ≤ 3 concurrent, priority
moo > ding > foley; all particles from one pool, hard cap 8; scene pauses fully when the
window is hidden (FEATURES 7.7) and *resumes into the correct accumulated state* —
drawers ajar, stacks tall — because the accumulation is derived from the event log, not
from having animated it.

---

## 6. Sources

- [Juice it or Lose it — Jonasson & Purho (GDC 2012), summary](https://roblog.co.uk/2024/03/juicy-games/) · [GameJuice resource page](https://gamejuice.co.uk/resources/juice-it-or-lose-it) · [a playable demonstration](https://longwelwind.net/blog/juice-it/) · [a counter-argument worth knowing](https://www.gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-)
- [Game Feel — Steve Swink, ch. 1 (definition & three building blocks)](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf) · [Liz England's review](https://lizengland.com/blog/review-game-feel-by-steve-swink/) · [Game feel — Wikipedia](https://en.wikipedia.org/wiki/Game_feel)
- [12 Principles for Game Animation — Chris Totten](https://totter87.medium.com/12-principles-for-game-animation-a9137ef44345) · [Making a game feel juicy with simple effects](https://resprawn.medium.com/when-you-play-a-great-game-it-feels-good-d23761b6eccf)
- Pixel grammar: [Sel-out & outlines — Pixnote](https://pixnote.net/en/learn/outlines/) · [Dithering guide — Pixnote](https://pixnote.net/en/learn/dithering/) · [Pixel art fundamentals](https://www.sprite-ai.art/guides/pixel-art-fundamentals) · [SNES-style palette workflow](https://pixelartvillage.org/blog/how-to-get-pixel-art-version-of-image/)
- Isometric: [The 2:1 trick — the-pixel.art](https://the-pixel.art/articles/isometric-pixel-art/) · [Isometric pixel art — SLYNYRD Pixelblog 41](https://www.slynyrd.com/blog/2022/11/28/pixelblog-41-isometric-pixel-art) · [Isometric projection — Pikuma](https://pikuma.com/blog/isometric-projection-in-games) · [Iso guide — Pixnote](https://pixnote.net/en/learn/isometric/)
- References: [Harvest Moon SNES sprites](https://www.spriters-resource.com/snes/harvestmoon/) · [Making of Harvest Moon SNES](https://www.gamedeveloper.com/design/video-the-making-of-the-original-snes-i-harvest-moon-i-) · [Unpacking's 14,000 foley files — Kotaku](https://kotaku.com/hit-puzzle-game-unpacking-features-14-000-audio-fil-1848000220) · [Unpacking audio deep-dive — Game Developer](https://www.gamedeveloper.com/marketing/auditory-tales-from-the-making-of-zen-puzzler-unpacking) · [Wilmot's Warehouse design deep-dive](https://www.gamedeveloper.com/design/game-design-deep-dive-the-creative-camaraderie-behind-i-wilmot-s-warehouse-i-) · [A Short Hike review (ambience)](https://indiegameworld.com/indie-game-reviews/a-short-hike-a-cozy-adventure-game-review/) · [Coffee Talk — Wikipedia](https://en.wikipedia.org/wiki/Coffee_Talk_(video_game)) · [Kirokaze — Coffee in Rain](https://www.deviantart.com/kirokaze/art/Coffee-In-rain-558860147)
- Ambient life: [Idle animation — Wikipedia](https://en.wikipedia.org/wiki/Idle_animation) · [Idle animation design guide — MoCap Online](https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide) · [Day/night cycles as a design tool](https://www.designthegame.com/learning/tutorial/day-night-cycles-powerful-design-tool-game-development)
- Calm & personality: [Calm technology — Wikipedia](https://en.wikipedia.org/wiki/Calm_technology) · [Principles of Calm Technology](https://principles.design/examples/principles-of-calm-technology) · [Claude Code's tamagotchi buddy](https://www.mindstudio.ai/blog/what-is-claude-code-buddy-feature) · [vscode-pets](https://devrant.com/rants/6273561/the-things-people-do-lets-add-a-virtual-tamagotchi-to-vscode-vscode-pets-anyone) · [Why people love Slack's personality](https://awilkinson.medium.com/slack-s-2-8-billion-dollar-secret-sauce-5c5ec7117908)
