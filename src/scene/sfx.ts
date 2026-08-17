// The barn's voice. Only file importing howler. See PHASE56_CONTRACT §5.
//
// NOT WIRED (contract D9): calf_spawn / calf_despawn load with the rest but
// have no call site — calves aren't rendered and no spawn event kind exists.
// Deliberately silent (SOUND_DESIGN §2b): footsteps, bubbles, camera pan/zoom,
// view/demo toggles, queue-cap drops. Never queue a cue — late sound is wrong
// sound; anything that can't play NOW is dropped.
import { Howl, Howler } from "howler";
import { useSettingsStore, selectSoundOff, type SettingsState } from "../store/settings";
import { useGraphStore, type NodeRole } from "../store/graph";
import { useEventsStore, resolveNodeId, type LogEvent } from "../store/events";

import kbClackUrl from "../../assets/sfx/kb_clack.wav?url";
import drawerSlideUrl from "../../assets/sfx/drawer_slide.wav?url";
import pageFlipUrl from "../../assets/sfx/page_flip.wav?url";
import paperShuffleUrl from "../../assets/sfx/paper_shuffle.wav?url";
import dingUrl from "../../assets/sfx/ding.wav?url";
import sniffUrl from "../../assets/sfx/sniff.wav?url";
import mooHappyUrl from "../../assets/sfx/moo_happy.wav?url";
import calfSpawnUrl from "../../assets/sfx/calf_spawn.wav?url";
import calfDespawnUrl from "../../assets/sfx/calf_despawn.wav?url";
import compileOkUrl from "../../assets/sfx/compile_ok.wav?url";
import assembleDoneUrl from "../../assets/sfx/assemble_done.wav?url";
import errorSoftUrl from "../../assets/sfx/error_soft.wav?url";
import typewriterUrl from "../../assets/sfx/typewriter.wav?url";
import ambientLoopUrl from "../../assets/sfx/ambient_loop.wav?url";

export type SfxCue =
  | "kb_clack" | "drawer_slide" | "page_flip" | "paper_shuffle"
  | "ding" | "sniff" | "moo_happy" | "calf_spawn" | "calf_despawn"
  | "compile_ok" | "assemble_done" | "error_soft";

export type SfxGroup = "barn" | "tool" | "ambient";

// ── Cue tables ────────────────────────────────────────────────────────

const ONE_SHOT_URLS: Record<SfxCue, string> = {
  kb_clack: kbClackUrl,
  drawer_slide: drawerSlideUrl,
  page_flip: pageFlipUrl,
  paper_shuffle: paperShuffleUrl,
  ding: dingUrl,
  sniff: sniffUrl,
  moo_happy: mooHappyUrl,
  calf_spawn: calfSpawnUrl,
  calf_despawn: calfDespawnUrl,
  compile_ok: compileOkUrl,
  assemble_done: assembleDoneUrl,
  error_soft: errorSoftUrl,
};

const TOOL_CUES: ReadonlySet<SfxCue> = new Set<SfxCue>([
  "compile_ok", "assemble_done", "error_soft",
]);

/** Dropped-not-queued cooldowns (SOUND_DESIGN §2/§3, contract §5.3). */
const COOLDOWN_MS: Partial<Record<SfxCue, number>> = {
  kb_clack: 250,
  sniff: 1000,
  ding: 2000,
  moo_happy: 2000,
  error_soft: 10_000,
};

/** Max concurrent one-shot voices; a 4th steals (stops) the oldest. */
const MAX_VOICES = 3;
/** moo_happy is 0.55 s — the barn ducks −12 dB (×0.25) for its duration. */
const MOO_DUCK_MS = 600;
const MOO_DUCK = 0.25;
/** Bed ducks −6 dB (×0.5) under any one-shot/typewriter; recovers over 400 ms. */
const BED_DUCK = 0.5;

// ── Module state ──────────────────────────────────────────────────────

let initialized = false;
let howls: Record<SfxCue, Howl> | null = null;
let typewriterHowl: Howl | null = null;
let ambientHowl: Howl | null = null;

let hidden = false;
let calm = false;
let muted = false;
const gains: Record<SfxGroup, number> = { barn: 1, tool: 1, ambient: 1 };

interface Voice {
  cue: SfxCue;
  group: SfxGroup;
  howl: Howl;
  id: number;
  baseVol: number;
}
let voices: Voice[] = [];
const lastPlayed: Partial<Record<SfxCue, number>> = {};
let mooUntil = 0;

let typewriterOn = false;
let typewriterFadeTimer: ReturnType<typeof setTimeout> | null = null;

// Read-burst throttle (claimed at event receipt).
let lastReadClaimTs = 0;
let lastReadCueTs = 0;
let readClaims: number[] = [];
let readBurst = false;

// Ambient bed — level/duck are frame-integrated in tickAmbient.
let bedLevel = 0;      // 0..1 fade state (in 800 ms, out 250 ms)
let duckLevel = 1;     // 0.25 (moo) / 0.5 (busy) / 1, recovers over 400 ms
let duckFloor = 1;     // deepest duck since last full recovery — scales the
                       // recovery rate so 400 ms spans the ACTUAL duck depth
let ambientLastTick = 0;
let ambientVolApplied = 0;

let sceneMounted = false;
let lastSeenEvent: LogEvent | null = null;

// ── Internal helpers ──────────────────────────────────────────────────

function soundOff(): boolean {
  return calm || muted;
}

/** Drop-not-queue also applies to a locked AudioContext: before the first
 *  user gesture the context is suspended and Howler would QUEUE plays until
 *  unlock, bursting them all on the first click — late sound is wrong sound.
 *  (@types/howler says AudioContext, but ctx is null before Howler boots.) */
function ctxRunning(): boolean {
  const ctx = Howler.ctx as AudioContext | null;
  return ctx !== null && ctx.state === "running";
}

function pruneVoices(): void {
  voices = voices.filter((v) => v.howl.playing(v.id));
}

function typewriterSounding(): boolean {
  return typewriterHowl !== null && typewriterHowl.playing();
}

/** Hard stop of every sound, ≤50 ms (mute/calm/window-hidden). */
function hardStopAll(): void {
  Howler.stop();
  voices = [];
  typewriterOn = false;
  if (typewriterFadeTimer !== null) {
    clearTimeout(typewriterFadeTimer);
    typewriterFadeTimer = null;
  }
  bedLevel = 0;
  duckLevel = 1;
  duckFloor = 1;
  ambientVolApplied = 0;
  mooUntil = 0;
}

/** Moo ducks the barn −12 dB for its duration; tool confirms are never ducked. */
function duckForMoo(now: number): void {
  mooUntil = now + MOO_DUCK_MS;
  for (const v of voices) {
    if (v.cue === "moo_happy" || v.group === "tool") continue;
    v.howl.volume(v.baseVol * MOO_DUCK, v.id);
  }
  if (typewriterOn && typewriterHowl !== null && typewriterHowl.playing()) {
    typewriterHowl.volume(gains.barn * MOO_DUCK);
  }
  setTimeout(() => {
    if (Date.now() < mooUntil) return; // a newer moo extended the duck
    pruneVoices();
    for (const v of voices) {
      if (v.group === "tool") continue;
      v.howl.volume(v.baseVol, v.id);
    }
    if (typewriterOn && typewriterHowl !== null && typewriterHowl.playing()) {
      typewriterHowl.volume(gains.barn);
    }
  }, MOO_DUCK_MS + 20);
}

/** Settings store → master volume, group gains, mute/calm (contract §5.2/§5.6). */
function applySettings(s: SettingsState): void {
  Howler.volume(s.masterVolume);
  setGroupGain("barn", s.barnSounds ? 1 : 0);
  setGroupGain("tool", s.toolSounds ? 1 : 0);
  // Ambient rides the Barn switch — no third toggle.
  setGroupGain("ambient", s.barnSounds ? 1 : 0);
  const off = selectSoundOff(s);
  calm = s.calmMode;
  muted = s.muted;
  if (off) hardStopAll();
}

/** Detached mode (contract §5.4): event-receipt cues while the scene is unmounted. */
function playDetached(e: LogEvent): void {
  switch (e.kind) {
    case "prompt":
      play("kb_clack");
      break;
    case "read": {
      // Unresolved path → silent (sound never fires for off-graph activity).
      if (e.filePath === undefined) break;
      const nodeId = resolveNodeId(e.filePath);
      if (nodeId === null) break;
      const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
      if (node === undefined) break;
      if (claimReadCue()) play(readCueForRole(node.role));
      break;
    }
    case "grep":
    case "glob":
      play("sniff");
      break;
    case "edit":
    case "write":
      // Deliberate deviation from the ding's "typewriter ran first" clause:
      // in Canvas view the referent animation doesn't exist and the write
      // still deserves its confirm (2 s cooldown applies). Loop never plays
      // detached — "animation not visible" rule.
      play("ding");
      break;
    case "stop":
      play("moo_happy");
      break;
    default:
      // subagent_stop / other: silent — future hook kinds must opt in.
      break;
  }
}

// ── Public API ────────────────────────────────────────────────────────

/** Idempotent. Loads howls, subscribes to settings/graph/events stores,
 *  registers the visibilitychange suspend. Called once from App. */
export function initSfx(): void {
  if (initialized) return;
  initialized = true;

  const built = {} as Record<SfxCue, Howl>;
  for (const cue of Object.keys(ONE_SHOT_URLS) as SfxCue[]) {
    built[cue] = new Howl({ src: [ONE_SHOT_URLS[cue]], preload: true });
  }
  howls = built;
  typewriterHowl = new Howl({ src: [typewriterUrl], loop: true, preload: true });
  ambientHowl = new Howl({ src: [ambientLoopUrl], loop: true, preload: true });

  applySettings(useSettingsStore.getState());
  useSettingsStore.subscribe(applySettings);

  // assemble_done: queue drained after being busy, with ≥1 success FROM THIS
  // batch (§5.5 + contract Deviation 2026-08-17): statuses persist for the
  // session, so an any-'assembled' check would chime on a stale success from
  // an earlier batch even when the batch that just drained failed entirely.
  // Baseline the 'assembled' count at the busy rising edge (a re-queued node
  // leaves 'assembled' in that same update, so repeats count too) and chime
  // only if the count grew.
  // error_soft: assemble error count transitions 0 → n (never n → n+1).
  let wasBusy = false;
  let assembledBaseline = 0;
  let prevErr = 0;
  useGraphStore.subscribe((s) => {
    const sts = Object.values(s.assembleStatus);
    const busy = sts.some((x) => x === "queued" || x === "running");
    const assembled = sts.filter((x) => x === "assembled").length;
    if (!wasBusy && busy) assembledBaseline = assembled;
    if (wasBusy && !busy && assembled > assembledBaseline) play("assemble_done");
    wasBusy = busy;
    const errs = sts.filter((x) => x === "error").length;
    if (prevErr === 0 && errs > 0) play("error_soft");
    prevErr = errs;
  });

  // Detached mode (D5): fire event-receipt cues while the scene is unmounted.
  // One boolean keeps this inert while BarnScene's mapper is the trigger path.
  useEventsStore.subscribe((s) => {
    const last = s.events.length > 0 ? s.events[s.events.length - 1] : null;
    if (last === null || last === lastSeenEvent) return;
    lastSeenEvent = last;
    if (sceneMounted) return;
    playDetached(last);
  });

  // Hidden window: hard-stop ≤50 ms and suppress play(); loops do NOT
  // auto-resume on visible — the next tick/event restarts them.
  hidden = document.hidden;
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
    if (hidden) hardStopAll();
  });
}

/** Fire a one-shot. All gating (mute/calm/group gain/cooldowns/voice pool/
 *  ducking/pitch variance) lives INSIDE this function — call sites stay dumb. */
export function play(cue: SfxCue): void {
  if (howls === null) return;
  // ctxRunning sits BEFORE the cooldown stamp — a cue dropped by a locked
  // context must not consume its cooldown window.
  if (hidden || soundOff() || !ctxRunning()) return;
  const group: SfxGroup = TOOL_CUES.has(cue) ? "tool" : "barn";
  if (gains[group] <= 0) return;

  const now = Date.now();
  const cd = COOLDOWN_MS[cue];
  const last = lastPlayed[cue];
  if (cd !== undefined && last !== undefined && now - last < cd) return; // dropped
  lastPlayed[cue] = now;

  pruneVoices();
  if (voices.length >= MAX_VOICES) {
    const oldest = voices.shift();
    if (oldest !== undefined) oldest.howl.stop(oldest.id);
  }

  const baseVol = gains[group];
  const mooDucked = now < mooUntil && group !== "tool" && cue !== "moo_happy";
  const howl = howls[cue];
  const id = howl.play();
  howl.rate(0.95 + Math.random() * 0.1, id); // pitch variance — one-shots only
  howl.volume(mooDucked ? baseVol * MOO_DUCK : baseVol, id);
  voices.push({ cue, group, howl, id, baseVol });

  if (cue === "moo_happy") duckForMoo(now);
}

/** Read-burst throttle, claimed at EVENT RECEIPT (SOUND_DESIGN §2b).
 *  Returns true if this read may sound on arrival. A false claim still
 *  walks/flashes — silently. */
export function claimReadCue(): boolean {
  const now = Date.now();
  // Burst ends after 500 ms with no claim.
  if (now - lastReadClaimTs >= 500) {
    readBurst = false;
    readClaims = [];
  }
  lastReadClaimTs = now;
  readClaims = readClaims.filter((t) => now - t < 500);
  readClaims.push(now);
  if (readBurst) return false;
  if (readClaims.length >= 4) {
    // ≥4 reads inside 500 ms: one paper_shuffle summarizes the burst.
    readBurst = true;
    play("paper_shuffle");
    return false;
  }
  if (now - lastReadCueTs < 150) return false; // ≤1 read cue per 150 ms
  lastReadCueTs = now;
  return true;
}

/** Cabinet=rules/persona → drawer_slide; bookshelf=architecture/reference/
 *  glossary → page_flip; crate=task/workflow → paper_shuffle. */
export function readCueForRole(role: NodeRole): SfxCue {
  return role === "rules" || role === "persona" ? "drawer_slide"
    : role === "task" || role === "workflow" ? "paper_shuffle"
    : "page_flip";
}

/** No-ops if already running; auto-fades after 3 s continuous (≤200 ms fade,
 *  the typing animation continues silently). */
export function startTypewriter(): void {
  if (typewriterHowl === null) return;
  if (hidden || soundOff() || gains.barn <= 0 || !ctxRunning()) return;
  if (typewriterOn) return;
  typewriterOn = true;
  const vol = gains.barn * (Date.now() < mooUntil ? MOO_DUCK : 1);
  typewriterHowl.volume(vol);
  typewriterHowl.play();
  typewriterFadeTimer = setTimeout(() => {
    typewriterFadeTimer = null;
    if (typewriterHowl !== null && typewriterHowl.playing()) {
      // Fade from the LIVE volume — `vol` is stale if a moo ducked the loop
      // since start; fading from it would snap the duck back up audibly.
      const cur = typewriterHowl.volume() as number;
      typewriterHowl.fade(cur, 0, 200);
      typewriterHowl.once("fade", () => {
        typewriterHowl?.stop();
      });
    }
  }, 3000);
}

/** Hard stop ≤50 ms (busy loop ended or was interrupted). */
export function stopTypewriter(): void {
  if (typewriterFadeTimer !== null) {
    clearTimeout(typewriterFadeTimer);
    typewriterFadeTimer = null;
  }
  typewriterOn = false;
  if (typewriterHowl !== null && typewriterHowl.playing()) typewriterHowl.stop();
}

/** Called every ticker frame with ms since the last BarnEvent.
 *  >5000 → ambient bed fades in (800 ms); <5000 → fades out (250 ms).
 *  Also integrates the bed's duck (−6 dB under anything, −12 dB under the
 *  moo, recovery over 400 ms). Only ticks while the scene is mounted, so
 *  the bed never plays in Canvas view. */
export function tickAmbient(idleMs: number): void {
  if (ambientHowl === null) return;
  const now = performance.now();
  const dt = ambientLastTick === 0 ? 16 : Math.min(100, now - ambientLastTick);
  ambientLastTick = now;

  pruneVoices();
  const busySounding = voices.length > 0 || typewriterSounding();
  const gate = !hidden && !soundOff() && gains.ambient > 0 && ctxRunning();

  if (!gate || idleMs < 5000) {
    bedLevel = Math.max(0, bedLevel - dt / 250);
  } else if (bedLevel > 0 || !busySounding) {
    // Don't START the fade-in while a one-shot sounds; keep fading if begun.
    bedLevel = Math.min(1, bedLevel + dt / 800);
  }

  const duckTarget = Date.now() < mooUntil ? MOO_DUCK : busySounding ? BED_DUCK : 1;
  duckLevel = duckTarget < duckLevel
    ? Math.max(duckTarget, duckLevel - dt / 50) // duck fast
    // recover over 400 ms from the actual duck depth (rate scaled by the
    // floor: a full-scale dt/400 slew finished the 0.5 duck in ~200 ms)
    : Math.min(duckTarget, duckLevel + (dt * (1 - duckFloor)) / 400);
  duckFloor = duckLevel >= 1 ? 1 : Math.min(duckFloor, duckLevel);

  const vol = bedLevel * duckLevel * gains.ambient;
  if (vol <= 0.001) {
    if (ambientHowl.playing()) ambientHowl.stop();
    ambientVolApplied = 0;
  } else {
    if (!ambientHowl.playing()) ambientHowl.play();
    ambientHowl.volume(vol);
    ambientVolApplied = vol;
  }
}

/** Public for scene/tests; the settings-store subscription is the source of truth. */
export function setCalm(b: boolean): void {
  calm = b;
  if (b) hardStopAll();
}

export function setMuted(b: boolean): void {
  muted = b;
  if (b) hardStopAll();
}

export function setGroupGain(group: SfxGroup, gain: number): void {
  gains[group] = gain;
  if (gain > 0) return;
  // A zeroed group silences its currently-sounding voices too.
  if (group === "ambient") {
    if (ambientHowl !== null && ambientHowl.playing()) ambientHowl.stop();
    bedLevel = 0;
    ambientVolApplied = 0;
    return;
  }
  for (const v of voices) {
    if (v.group === group) v.howl.stop(v.id);
  }
  pruneVoices();
  if (group === "barn" && typewriterSounding()) typewriterHowl?.stop();
}

/** BarnScene calls true on mount, false on unmount. While false, sfx.ts
 *  itself fires event-receipt cues (detached mode, §5.4). */
export function setSceneMounted(mounted: boolean): void {
  sceneMounted = mounted;
  if (mounted) return;
  // Scene gone: the busy animation and the idle clock no longer exist.
  stopTypewriter();
  if (ambientHowl !== null && ambientHowl.playing()) {
    ambientHowl.fade(ambientVolApplied, 0, 250);
    ambientHowl.once("fade", () => {
      ambientHowl?.stop();
    });
  }
  bedLevel = 0;
  duckLevel = 1;
  duckFloor = 1;
  ambientLastTick = 0;
  ambientVolApplied = 0;
}
