#!/usr/bin/env python3
"""Cowtext placeholder SFX generator.

Procedurally synthesizes chiptune-style placeholder sounds for every cue in
docs/design/SOUND_DESIGN.md into assets/sfx/*.wav, plus a cues.json manifest
with measured stats. Python stdlib only (wave, struct, math, random, json).

Masters: 44.1 kHz, 16-bit, mono WAV. Deterministic (seeded noise).

Run from anywhere:  python scripts/gen_sfx.py
"""

import json
import math
import os
import random
import struct
import sys
import wave

FS = 44100
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "sfx")

TAU = 2.0 * math.pi


# ---------------------------------------------------------------- primitives

def silence(dur):
    return [0.0] * int(dur * FS)


def db(dbfs):
    """dBFS -> linear amplitude."""
    return 10.0 ** (dbfs / 20.0)


def cents(f, c):
    return f * (2.0 ** (c / 1200.0))


def osc(freq, dur, shape="sine", vib_rate=0.0, vib_depth=0.0, phase=0.0):
    """Phase-accumulating oscillator.

    freq: float, or (f0, f1) for a linear glide, or callable t->Hz.
    shape: sine | triangle | square.
    vib_depth: fractional frequency deviation (0.01 = 1%).
    """
    n = int(dur * FS)
    out = [0.0] * n
    p = phase
    for i in range(n):
        t = i / FS
        if callable(freq):
            f = freq(t)
        elif isinstance(freq, tuple):
            f0, f1 = freq
            f = f0 + (f1 - f0) * (t / dur)
        else:
            f = freq
        if vib_depth:
            f *= 1.0 + vib_depth * math.sin(TAU * vib_rate * t)
        p += f / FS
        frac = p - math.floor(p)
        if shape == "sine":
            v = math.sin(TAU * frac)
        elif shape == "triangle":
            v = 4.0 * abs(frac - 0.5) - 1.0
        elif shape == "square":
            v = 1.0 if frac < 0.5 else -1.0
        else:
            raise ValueError(shape)
        out[i] = v
    return out


def noise(dur, seed=1):
    rng = random.Random(seed)
    return [rng.uniform(-1.0, 1.0) for _ in range(int(dur * FS))]


def lowpass(x, cutoff):
    """One-pole lowpass. cutoff: Hz, or a list per-sample for sweeps."""
    y = 0.0
    out = [0.0] * len(x)
    if isinstance(cutoff, (int, float)):
        a = 1.0 - math.exp(-TAU * cutoff / FS)
        for i, s in enumerate(x):
            y += a * (s - y)
            out[i] = y
    else:
        for i, s in enumerate(x):
            a = 1.0 - math.exp(-TAU * cutoff[i] / FS)
            y += a * (s - y)
            out[i] = y
    return out


def highpass(x, cutoff):
    lp = lowpass(x, cutoff)
    return [s - l for s, l in zip(x, lp)]


def env_ad(n_or_sig, attack, tau, hold=0.0):
    """Attack (linear) + optional hold + exponential decay envelope.
    Applied in place if a signal is given; returns the envelope/signal."""
    if isinstance(n_or_sig, list):
        sig = n_or_sig
        n = len(sig)
    else:
        sig = None
        n = n_or_sig
    out = [0.0] * n
    for i in range(n):
        t = i / FS
        if t < attack:
            e = t / attack if attack > 0 else 1.0
        elif t < attack + hold:
            e = 1.0
        else:
            e = math.exp(-(t - attack - hold) / tau)
        out[i] = e * (sig[i] if sig else 1.0)
    return out


def mix(base, add, at=0.0, gain=1.0):
    """Mix `add` into `base` starting at time `at` (s). Extends base if needed."""
    start = int(at * FS)
    need = start + len(add)
    if need > len(base):
        base.extend([0.0] * (need - len(base)))
    for i, s in enumerate(add):
        base[start + i] += s * gain
    return base


def gain(x, g):
    return [s * g for s in x]


def normalize(x, peak_dbfs):
    peak = max((abs(s) for s in x), default=0.0)
    if peak == 0.0:
        return x
    g = db(peak_dbfs) / peak
    return [s * g for s in x]


def fade_edges(x, fade=0.004):
    """Tiny linear fade at both ends to kill clicks."""
    n = int(fade * FS)
    for i in range(min(n, len(x))):
        g2 = i / n
        x[i] *= g2
        x[-1 - i] *= g2
    return x


def crossfade_loop(x, overlap):
    """Make a seamless loop: equal-power crossfade tail into head, trim tail."""
    n_ov = int(overlap * FS)
    n = len(x) - n_ov
    out = x[:n]
    for i in range(n_ov):
        w = i / n_ov
        a = math.cos(w * math.pi / 2.0)
        b = math.sin(w * math.pi / 2.0)
        out[i] = x[n + i] * a + out[i] * b
    return out


def stats(x):
    peak = max((abs(s) for s in x), default=0.0)
    rms = math.sqrt(sum(s * s for s in x) / len(x)) if x else 0.0
    return peak, rms


def write_wav(path, x):
    frames = bytearray()
    for s in x:
        s = max(-1.0, min(1.0, s))
        frames += struct.pack("<h", int(round(s * 32767)))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(FS)
        w.writeframes(bytes(frames))


# ------------------------------------------------------------------- voices

def strike(tick_hz, seed, noise_amt=0.5, tick_amt=0.5, dur=0.09, bright=4000):
    """A single mechanical click: filtered noise burst + pitched tick."""
    out = silence(dur)
    nz = env_ad(highpass(lowpass(noise(dur, seed), bright), 300), 0.001, 0.010)
    tk = env_ad(osc(tick_hz, dur, "sine"), 0.0005, 0.008)
    mix(out, nz, 0.0, noise_amt)
    mix(out, tk, 0.0, tick_amt)
    return out


def soft_square(freq, dur, cutoff=2200, **kw):
    """Square through a lowpass — chip character without the shrill top."""
    return lowpass(osc(freq, dur, "square", **kw), cutoff)


def chime_note(freq, dur, tau, shape="triangle", cutoff=3000):
    body = lowpass(osc(freq, dur, shape), cutoff)
    sparkle = osc(freq * 2.0, dur, "sine")
    out = silence(dur)
    mix(out, env_ad(body, 0.004, tau), 0.0, 0.85)
    mix(out, env_ad(sparkle, 0.004, tau * 0.6), 0.0, 0.18)
    return out


# --------------------------------------------------------------------- cues

def cue_kb_clack():
    """prompt_submitted: one soft mechanical key."""
    out = silence(0.10)
    mix(out, strike(1900, seed=11, noise_amt=0.6, tick_amt=0.35), 0.0)
    mix(out, strike(1500, seed=12, noise_amt=0.3, tick_amt=0.2, dur=0.06), 0.028, 0.5)
    return normalize(out, -9.0)


def cue_drawer_slide():
    """read (cabinet): wooden drawer rolls open, soft thunk at the end."""
    dur = 0.26
    n = int(dur * FS)
    sweep = [2600.0 - 1900.0 * (i / n) for i in range(n)]  # darkening slide
    body = lowpass(noise(dur, seed=21), sweep)
    body = highpass(body, 180)
    shape_env = [math.sin(math.pi * min(1.0, (i / n) ** 0.8)) for i in range(n)]
    body = [s * e for s, e in zip(body, shape_env)]
    out = silence(dur)
    mix(out, body, 0.0, 1.0)
    thunk = env_ad(osc((130, 95), 0.06, "sine"), 0.002, 0.018)
    mix(out, thunk, dur - 0.07, 0.9)
    return normalize(fade_edges(out), -11.0)


def cue_page_flip():
    """read (bookshelf): two feather-light paper flicks."""
    out = silence(0.15)
    f1 = env_ad(highpass(lowpass(noise(0.05, seed=31), 5200), 900), 0.002, 0.012)
    f2 = env_ad(highpass(lowpass(noise(0.08, seed=32), 4200), 700), 0.004, 0.022)
    mix(out, f1, 0.0, 0.7)
    mix(out, f2, 0.055, 1.0)
    return normalize(out, -13.0)


def cue_paper_shuffle():
    """read (corkboard/crate): papers shuffled to the desk."""
    out = silence(0.28)
    rng = random.Random(41)
    at = 0.0
    for k in range(4):
        d = 0.05 + rng.uniform(0.0, 0.03)
        puff = env_ad(highpass(lowpass(noise(d, seed=42 + k), 2600), 500),
                      0.004, 0.020)
        mix(out, puff, at, 0.55 + 0.15 * k)
        at += 0.055 + rng.uniform(0.0, 0.02)
    return normalize(out, -13.0)


def cue_typewriter():
    """edit/write: loopable 0.5 s bar of four keystrikes (seamless loop)."""
    out = silence(0.5)
    ticks = [(0.000, 2100, 51), (0.125, 1750, 52), (0.250, 2300, 53), (0.375, 1900, 54)]
    for at, hz, seed in ticks:
        mix(out, strike(hz, seed=seed, noise_amt=0.5, tick_amt=0.3, dur=0.07), at,
            0.85 + 0.15 * math.sin(seed))
    return normalize(out, -10.0)


def cue_ding():
    """write lands: typewriter bell — warm, one strike, long-ish ring."""
    out = silence(0.7)
    mix(out, chime_note(880.0, 0.7, 0.16), 0.0, 1.0)          # A5
    mix(out, env_ad(osc(cents(880.0, 7) * 2.0, 0.5, "sine"), 0.002, 0.07), 0.0, 0.10)
    mix(out, strike(2600, seed=61, noise_amt=0.25, tick_amt=0.1, dur=0.03), 0.0, 0.4)
    return normalize(out, -10.0)


def cue_sniff():
    """grep/glob: cow sniffs — two tiny dark air puffs."""
    out = silence(0.22)
    p1 = env_ad(lowpass(noise(0.07, seed=71), 650), 0.010, 0.020)
    p2 = env_ad(lowpass(noise(0.09, seed=72), 550), 0.012, 0.026)
    mix(out, p1, 0.0, 0.7)
    mix(out, p2, 0.10, 1.0)
    return normalize(out, -16.0)


def cue_moo_happy():
    """stop (turn done): short two-note happy moo — detuned triangles, G2→C3."""
    dur = 0.55
    g2, c3 = 98.0, 130.81

    def melody(t):
        if t < 0.20:
            return g2
        if t < 0.26:                      # portamento up
            return g2 + (c3 - g2) * (t - 0.20) / 0.06
        return c3

    out = silence(dur)
    for det in (-6.0, 6.0):
        v = osc(lambda t, d=det: cents(melody(t), d), dur, "triangle",
                vib_rate=5.5, vib_depth=0.012)
        mix(out, v, 0.0, 0.5)
    hi = osc(lambda t: melody(t) * 2.0, dur, "triangle", vib_rate=5.5, vib_depth=0.012)
    mix(out, hi, 0.0, 0.16)                                    # octave "head voice"
    out = lowpass(out, 1400)                                   # keep it velvet
    e = env_ad(len(out), 0.030, 0.10, hold=0.30)
    out = [s * g2_ for s, g2_ in zip(out, e)]
    return normalize(fade_edges(out), -7.0)


def cue_calf_spawn():
    """subagent spawns: quick rising two-note blip (E5→A5)."""
    out = silence(0.18)
    mix(out, env_ad(soft_square(659.26, 0.07), 0.003, 0.025), 0.0, 1.0)
    mix(out, env_ad(soft_square(880.0, 0.10), 0.003, 0.035), 0.075, 1.0)
    return normalize(out, -13.0)


def cue_calf_despawn():
    """subagent done: same blip, falling (A5→E5)."""
    out = silence(0.18)
    mix(out, env_ad(soft_square(880.0, 0.07), 0.003, 0.025), 0.0, 1.0)
    mix(out, env_ad(soft_square(659.26, 0.10), 0.003, 0.035), 0.075, 1.0)
    return normalize(out, -13.0)


def cue_compile_ok():
    """compile written to disk: two-note confirm (C5→G5)."""
    out = silence(0.34)
    mix(out, env_ad(soft_square(523.25, 0.12, cutoff=2600), 0.004, 0.045), 0.0, 1.0)
    mix(out, env_ad(soft_square(783.99, 0.20, cutoff=2600), 0.004, 0.070), 0.12, 1.0)
    return normalize(out, -10.0)


def cue_assemble_done():
    """assemble finished: rising pentatonic arpeggio A4-C5-E5, triangle."""
    out = silence(0.55)
    for i, f in enumerate((440.0, 523.25, 659.26)):
        mix(out, chime_note(f, 0.30, 0.08), i * 0.11, 0.8 + 0.1 * i)
    return normalize(out, -10.0)


def cue_error_soft():
    """problem surfaced: low muted double-knock — concerned, never alarming."""
    out = silence(0.32)
    k1 = env_ad(lowpass(osc((150, 105), 0.10, "triangle"), 500), 0.003, 0.035)
    k2 = env_ad(lowpass(osc((132, 92), 0.14, "triangle"), 450), 0.003, 0.045)
    mix(out, k1, 0.0, 0.9)
    mix(out, k2, 0.13, 1.0)
    mix(out, env_ad(lowpass(noise(0.05, seed=91), 400), 0.002, 0.015), 0.13, 0.25)
    return normalize(out, -11.0)


def cue_ambient_loop():
    """waiting > 5 s: barn at rest — low warm drone + faint hay/wind bed.
    Rendered 2.5 s, crossfaded to a seamless 2.0 s loop."""
    dur = 2.5
    out = silence(dur)
    # Warm drone: A1 + A2 + E3, slow periodic swells (periods divide 2.0 s).
    for f, g, lfo in ((55.0, 0.50, 0.5), (110.0, 0.30, 1.0), (164.81, 0.12, 0.5)):
        v = osc(f, dur, "sine")
        sw = [0.75 + 0.25 * math.sin(TAU * lfo * (i / FS) + f) for i in range(len(v))]
        mix(out, [a * b for a, b in zip(v, sw)], 0.0, g)
    # Hay/wind: very quiet dark noise, slow amplitude wander.
    bed = lowpass(noise(dur, seed=101), 320)
    wander = [0.6 + 0.4 * math.sin(TAU * 0.5 * (i / FS) + 1.3) for i in range(len(bed))]
    mix(out, [a * b for a, b in zip(bed, wander)], 0.0, 0.35)
    out = crossfade_loop(out, 0.5)      # -> exactly 2.0 s, loops clean
    return normalize(out, -18.0)


# -------------------------------------------------------------------- main

CUES = [
    # (file stem, builder, loop?, min RMS gate)
    ("kb_clack",      cue_kb_clack,      False, 0.010),
    ("drawer_slide",  cue_drawer_slide,  False, 0.010),
    ("page_flip",     cue_page_flip,     False, 0.008),
    ("paper_shuffle", cue_paper_shuffle, False, 0.008),
    ("typewriter",    cue_typewriter,    True,  0.008),
    ("ding",          cue_ding,          False, 0.010),
    ("sniff",         cue_sniff,         False, 0.004),
    ("moo_happy",     cue_moo_happy,     False, 0.030),
    ("calf_spawn",    cue_calf_spawn,    False, 0.008),
    ("calf_despawn",  cue_calf_despawn,  False, 0.008),
    ("compile_ok",    cue_compile_ok,    False, 0.010),
    ("assemble_done", cue_assemble_done, False, 0.010),
    ("error_soft",    cue_error_soft,    False, 0.010),
    ("ambient_loop",  cue_ambient_loop,  True,  0.010),
]

MAX_BYTES = 200_000


def main():
    out_dir = os.path.normpath(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    manifest = {}
    failures = []
    print(f"{'cue':<14} {'dur':>6} {'peak dB':>8} {'rms dB':>8} {'bytes':>8}  loop")
    for stem, build, loop, min_rms in CUES:
        x = build()
        peak, rms = stats(x)
        path = os.path.join(out_dir, stem + ".wav")
        write_wav(path, x)
        size = os.path.getsize(path)
        dur = len(x) / FS
        ok = True
        if rms < min_rms:
            failures.append(f"{stem}: RMS {rms:.5f} below gate {min_rms}")
            ok = False
        if peak > db(-1.0):
            failures.append(f"{stem}: peak {peak:.3f} above -1 dBFS ceiling")
            ok = False
        if size > MAX_BYTES:
            failures.append(f"{stem}: {size} bytes exceeds {MAX_BYTES}")
            ok = False
        peak_db = 20 * math.log10(peak) if peak > 0 else float("-inf")
        rms_db = 20 * math.log10(rms) if rms > 0 else float("-inf")
        print(f"{stem:<14} {dur:>5.2f}s {peak_db:>7.1f} {rms_db:>7.1f} {size:>8}  "
              f"{'loop' if loop else '-'}{'' if ok else '  << FAIL'}")
        manifest[stem] = {
            "file": f"assets/sfx/{stem}.wav",
            "duration_s": round(dur, 3),
            "peak_dbfs": round(peak_db, 1),
            "rms_dbfs": round(rms_db, 1),
            "loop": loop,
            "bytes": size,
        }
    with open(os.path.join(out_dir, "cues.json"), "w", encoding="utf-8") as f:
        json.dump({"sample_rate": FS, "bit_depth": 16, "channels": 1,
                   "generator": "scripts/gen_sfx.py", "cues": manifest},
                  f, indent=2, sort_keys=True)
        f.write("\n")
    if failures:
        print("\nFAILURES:")
        for msg in failures:
            print("  " + msg)
        sys.exit(1)
    print(f"\nOK — {len(CUES)} cues written to {out_dir}")


if __name__ == "__main__":
    main()
