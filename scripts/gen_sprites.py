#!/usr/bin/env python3
"""Cowtext placeholder sprite generator.

Pixel art lives here as ASCII grids (one char = one pixel, '.' = transparent).
Running this script regenerates every SVG in assets/sprites/svg/ and every
1x PNG in assets/sprites/png/ — those files are the committed assets; this
file is their source of truth. PNGs are written with a stdlib (zlib/struct)
writer, so the script has zero dependencies (no Pillow needed).

Palette: docs/design/ART_DIRECTION.md "Barnlight-29". Every hex below derives
from docs/design/tokens.css (see the derivation column in the doc).

Usage:  python scripts/gen_sprites.py
"""

from __future__ import annotations

import os
import sys

# ── Barnlight-29 palette ─ char -> (name, hex) ──────────────────────────────
PALETTE: dict[str, tuple[str, str]] = {
    "K": ("outline",        "#241A12"),  # warm near-black; the only outline colour
    "N": ("night",          "#16130F"),  # --surface-0; interior shadow / cavities
    "w": ("wood-shadow",    "#5A3F28"),
    "W": ("wood-mid",       "#7A5636"),
    "L": ("wood-light",     "#9C7248"),
    "P": ("wood-pale",      "#BC9260"),
    "h": ("hay-deep",       "#B07D2E"),
    "H": ("hay",            "#E8A33D"),  # == --amber
    "y": ("hay-light",      "#F0BE72"),  # == --amber-text
    "Y": ("hay-pale",       "#F7DCA8"),  # paper
    "M": ("milk",           "#F4EFE7"),  # == --text-primary; cow white
    "c": ("cream",          "#E4D9C8"),
    "p": ("patch",          "#4A3728"),  # cow patches, hooves
    "d": ("patch-dark",     "#33251A"),  # eyes, darkest patch
    "z": ("muzzle",         "#E0A891"),
    "S": ("scarf",          "#4C9BE8"),  # == --accent  (blue is you)
    "s": ("scarf-shade",    "#3B85CE"),  # == --accent-active
    "t": ("scarf-light",    "#82BAF0"),  # == --accent-text
    "R": ("barn-red",       "#A34233"),  # --danger dusked down for walls
    "r": ("barn-red-shade", "#7E3226"),
    "g": ("slate",          "#8E8477"),  # == --text-muted; cabinet metal
    "f": ("slate-dark",     "#5C544A"),  # == --text-disabled
    "E": ("screen",         "#56B4E9"),  # == --role-architecture; monitor glow
    "e": ("screen-dark",    "#2B5A75"),
    "G": ("leaf",           "#4FB477"),  # == --success; book spines, plants
    "O": ("clay",           "#E4784F"),  # == --role-persona; book spines
    "U": ("straw",          "#E3C25F"),  # == --role-rules; book spines
    "V": ("iris",           "#8A8BEE"),  # == --role-task; book spines
    "Q": ("orchid",         "#C58BC9"),  # == --role-reference; book spines
}

# ── Sprites ─ ASCII grids. Rows shorter than the canvas are right-padded
#    with '.', so only trailing transparency may be omitted. ────────────────

SPRITES: dict[str, tuple[int, int, list[str]]] = {}


def sprite(name: str, w: int, h: int, rows: list[str]) -> None:
    assert len(rows) <= h, f"{name}: {len(rows)} rows > {h}"
    full = [r.ljust(w, ".") for r in rows] + ["." * w] * (h - len(rows))
    for i, r in enumerate(full):
        assert len(r) == w, f"{name} row {i}: len {len(r)} != {w}: {r!r}"
        bad = set(r) - set(PALETTE) - {"."}
        assert not bad, f"{name} row {i}: unknown chars {bad}"
    SPRITES[name] = (w, h, full)


# cow — Claude. Side view, facing left. Blue scarf at the neck, hay tail tuft.
sprite("cow", 24, 24, [
    "",
    "",
    "",
    ".KK...KK",
    "KppK.KppK",
    "KpppKpppK",
    ".KMMMMMK",
    ".KMMMMMMKKKKKKKKKKKKKK",
    "KMdMMMMMMMMMMMMMMMMMMK",
    "KMMMMMMMMMMMMppMMMMMMK",
    "KzzzzMMMMMMMppppMMMMMK",
    "KzKzzMMSSMMMppppMMMMMKh",
    "KzzzzMSSssMMMppMMMMMMKh",
    ".KKKKMSStsMMMMMMMMMMMKK",
    ".....KSSsKMMMMMMppMMMK",
    "......KsKMMMMMMppppMMK",
    ".......KKMMMMMMMppMMK",
    "........KMMMMMMMMMMMK",
    "........KMcK...KMcK",
    "........KMcK...KMcK",
    "........KpcK...KpcK",
    "........KKKK...KKKK",
])

# calf — subagent. Same silhouette at 16 px, smaller scarf.
sprite("calf", 16, 16, [
    "",
    "",
    ".KK..KK",
    "KppKKppK",
    ".KMMMMK",
    ".KMMMMKKKKKKKK",
    "KMdMMMMMMMMMMKh",
    "KzzMMSSMMppMMKh",
    "KzzMSSsMMppMMK",
    ".KKKSsKMMMMMMK",
    ".....KMMMMMMK",
    ".....KcK..KcK",
    ".....KpK..KpK",
    ".....KKK..KKK",
])

# filing cabinet, closed — rules/persona nodes. Slate metal, three drawers.
sprite("cabinet_closed", 16, 24, [
    "",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KgggKKKKgggK",
    "..KggggggggggK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KgggKKKKgggK",
    "..KggggggggggK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KgggKKKKgggK",
    "..KggggggggggK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KfK......KfK",
    "..KKK......KKK",
])

# filing cabinet, open — middle drawer pulled, hay-pale paper peeking.
sprite("cabinet_open", 16, 24, [
    "",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KgggKKKKgggK",
    "..KggggggggggK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KNNNNNNNNNNK",
    ".KKYyYYyYYYyYKK",
    ".KggggggggggggK",
    ".KgggKKKKKggggK",
    ".KffffffffffffK",
    ".KKKKKKKKKKKKKK",
    "..KKKKKKKKKKKK",
    "..KggggggggggK",
    "..KgggKKKKgggK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KffffffffffK",
    "..KKKKKKKKKKKK",
    "..KfK......KfK",
    "..KKK......KKK",
])

# bookshelf — architecture/reference nodes. Spines use the role hues.
_shelf1 = "OOUUNEEGGNVVQQNOOU"
_shelf2 = "UUEENGGVVNQQOONUUE"
_shelf3 = "GGVVNQQOONUUEENGGV"
sprite("bookshelf", 24, 28, [
    "KKKKKKKKKKKKKKKKKKKKKKKK",
    "KWLLLLLLLLLLLLLLLLLLLLWK",
    "KKKKKKKKKKKKKKKKKKKKKKKK",
    "KWKNNNNNNNNNNNNNNNNNNKWK",
    f"KWK{_shelf1}KWK",
    f"KWK{_shelf1}KWK",
    f"KWK{_shelf1}KWK",
    f"KWK{_shelf1}KWK",
    "KWKKKKKKKKKKKKKKKKKKKKWK",
    "KWLLLLLLLLLLLLLLLLLLLLWK",
    "KWKKKKKKKKKKKKKKKKKKKKWK",
    "KWKNNNNNNNNNNNNNNNNNNKWK",
    f"KWK{_shelf2}KWK",
    f"KWK{_shelf2}KWK",
    f"KWK{_shelf2}KWK",
    f"KWK{_shelf2}KWK",
    "KWKKKKKKKKKKKKKKKKKKKKWK",
    "KWLLLLLLLLLLLLLLLLLLLLWK",
    "KWKKKKKKKKKKKKKKKKKKKKWK",
    "KWKNNNNNNNNNNNNNNNNNNKWK",
    f"KWK{_shelf3}KWK",
    f"KWK{_shelf3}KWK",
    f"KWK{_shelf3}KWK",
    f"KWK{_shelf3}KWK",
    "KKKKKKKKKKKKKKKKKKKKKKKK",
    "KWWWWWWWWWWWWWWWWWWWWWWK",
    "KKKKKKKKKKKKKKKKKKKKKKKK",
])

# corkboard — task/workflow nodes. Three pinned hay-pale papers; pins are
# scarf-blue, amber, and outline — matching the two-accent rule.
sprite("corkboard", 24, 18, [
    "KKKKKKKKKKKKKKKKKKKKKKKK",
    "KWWWWWWWWWWWWWWWWWWWWWWK",
    "KWKKKKKKKKKKKKKKKKKKKKWK",
    "KWKhhhhhhhhhhhhhhhhhhKWK",
    "KWKhYYSYYhhhhhhYYKYYhKWK",
    "KWKhYYYYYhhyhhhYYYYYhKWK",
    "KWKhYYYYYhYHYYhYYYYYhKWK",
    "KWKhYYYYYhYYYYhYYYYYhKWK",
    "KWKhYYYYYhYYYYhYYYYYhKWK",
    "KWKhYYYYYhYYYYhYYYYYhKWK",
    "KWKhYYYYYhYYYYhhyhhhhKWK",
    "KWKhhhhhhhYYYYhhhhhhhKWK",
    "KWKhhyhhhhhhhhhhhhyhhKWK",
    "KWKhhhhhhhhhhhhhhhhhhKWK",
    "KWKhhhhhhhhhhhhhhhhhhKWK",
    "KWKKKKKKKKKKKKKKKKKKKKWK",
    "KWWWWWWWWWWWWWWWWWWWWWWK",
    "KKKKKKKKKKKKKKKKKKKKKKKK",
])

# crate — task/workflow nodes (crate of papers).
sprite("crate", 16, 16, [
    "",
    "....YY...YY",
    "...YYYY.YYYY",
    "..YYYYYYYYYYY",
    ".KKKKKKKKKKKKK",
    ".KLLKWWWWWKLLK",
    ".KLLKWWWWWKLLK",
    ".KLLKwwwwwKLLK",
    ".KLLKWWWWWKLLK",
    ".KLLKWWWWWKLLK",
    ".KLLKwwwwwKLLK",
    ".KLLKWWWWWKLLK",
    ".KLLKWWWWWKLLK",
    ".KwwKwwwwwKwwK",
    ".KKKKKKKKKKKKK",
])

# desk — the dev's desk, dual monitors (screen glow = role-architecture blue).
sprite("desk", 32, 24, [
    "",
    "..KKKKKKKKKK....KKKKKKKKKK",
    "..KtEEEEEEEK....KtEEEEEEEK",
    "..KEEEEEEEEK....KEEEEEEEEK",
    "..KEEEEEEEEK....KEEEEEEEEK",
    "..KeeeeeeeeK....KeeeeeeeeK",
    "..KKKKKKKKKK....KKKKKKKKKK",
    "......KfK...........KfK",
    ".....KfffK.........KfffK",
    "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
    "KPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPK",
    "KLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLK",
    "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
    ".KWWK......................KWWK",
    ".KWWK......................KWWK",
    ".KWWK......................KWWK",
    ".KWWK......................KWWK",
    ".KWWK......................KWWK",
    ".KWWK......................KWWK",
    ".KwwK......................KwwK",
    ".KKKK......................KKKK",
])


# dev — pixel Marty, side view facing left (toward the desk's monitors),
# seated. Scarf-blue shirt: blue is you — the developer is the user.
sprite("dev", 16, 20, [
    "...KKKKK",
    "..KdddddK",
    ".KdddddddK",
    ".KdddddddK",
    ".KzzzzdddK",
    ".KzKzzdddK",
    ".KzzzzddK",
    "..KzzzKK",
    "..KKKK",
    "..KSSSSK",
    ".KSSSSSSK",
    "KzKSSSSSK",
    "KzKsSStSK",
    ".KsssssK",
    ".KppppK",
    ".KppppK",
    "..KpKpK",
    "..KpKpK",
    ".KdKKdK",
    ".KKK.KKK",
])


def _floor_tile() -> list[str]:
    """32x16 2:1 isometric diamond, wood planks, dithered lower-right shade."""
    rows: list[str] = []
    for yy in range(16):
        k = yy if yy < 8 else 15 - yy
        x0, x1 = 14 - 2 * k, 17 + 2 * k
        row = []
        for xx in range(32):
            if xx < x0 or xx > x1:
                row.append(".")
            elif xx in (x0, x0 + 1, x1 - 1, x1):
                row.append("K")
            elif yy % 4 == 3:
                row.append("w")          # plank seam
            elif yy <= 3:
                row.append("L")          # lit top edge
            elif yy >= 11 and (xx + yy) % 2 == 0:
                row.append("w")          # 50% checker dither shade
            elif (xx * 7 + yy * 3) % 23 == 0:
                row.append("w")          # sparse grain flecks
            else:
                row.append("W")
        rows.append("".join(row))
    return rows


sprite("floor_tile", 32, 16, _floor_tile())


def _wall() -> list[str]:
    """32x24 barn wall segment: red planks, wood top beam, dusk-light slits."""
    rows: list[str] = []
    slits = {9, 21}  # x positions where dusk light leaks through the slats
    for yy in range(24):
        row = []
        for xx in range(32):
            if yy == 0 or yy == 23 or xx == 0 or xx == 31:
                row.append("K")
            elif yy in (1, 2):
                row.append("W")          # top beam
            elif yy == 3 or yy == 22:
                row.append("K")
            elif xx % 6 == 5:
                row.append("r")          # plank seam
            elif xx in slits and 6 <= yy <= 19 and yy % 2 == 0:
                row.append("y")          # dashed light slit (dusk through slats)
            elif yy >= 19 and (xx + yy) % 2 == 0:
                row.append("r")          # dither shade at the floor line
            else:
                row.append("R")
        rows.append("".join(row))
    return rows


sprite("wall", 32, 24, _wall())


def _door() -> list[str]:
    """24x28 closed barn door: red planks, wood frame, X-brace, slate handle.
    Calves (subagents) spawn here."""
    w, h = 24, 28
    rows: list[str] = []
    for yy in range(h):
        row = []
        for xx in range(w):
            on_frame = yy in (0, h - 1) or xx in (0, w - 1)
            in_beam = yy in (1, 2) or yy in (h - 3, h - 2) or xx in (1, 2) or xx in (w - 3, w - 2)
            # X-brace diagonals across the inner door field (3..20 by 3..24)
            t = (yy - 3) / (h - 7)               # 0..1 down the field
            dx = 3 + t * (w - 7)                 # main diagonal x
            mx = (w - 4) - t * (w - 7)           # mirrored diagonal x
            on_brace = abs(xx - dx) < 1.3 or abs(xx - mx) < 1.3
            if on_frame:
                row.append("K")
            elif in_beam:
                row.append("W")
            elif on_brace:
                row.append("L")
            elif xx == w - 5 and yy in (13, 14):
                row.append("g")                  # handle
            elif xx % 5 == 4:
                row.append("r")                  # plank seam
            elif yy >= h - 7 and (xx + yy) % 2 == 0:
                row.append("r")                  # dither shade at the floor
            else:
                row.append("R")
        rows.append("".join(row))
    return rows


sprite("door", 24, 28, _door())

# ── Emitters ────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_DIR = os.path.join(ROOT, "assets", "sprites", "svg")
PNG_DIR = os.path.join(ROOT, "assets", "sprites", "png")


def emit_svg(name: str, w: int, h: int, rows: list[str]) -> str:
    used = sorted({ch for r in rows for ch in r if ch != "."})
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" shape-rendering="crispEdges">',
        f"<!-- {name} — {w}x{h} px. Generated by scripts/gen_sprites.py; edit",
        "     the ASCII grid there, not this file. Palette: Barnlight-29",
        "     (docs/design/ART_DIRECTION.md). Colours used here: -->",
    ]
    for ch in used:
        n, hexv = PALETTE[ch]
        lines.append(f"<!--   {ch} = {n} {hexv} -->")
    for yy, row in enumerate(rows):
        px = [
            f'<rect x="{xx}" y="{yy}" width="1" height="1" fill="{PALETTE[ch][1]}"/>'
            for xx, ch in enumerate(row)
            if ch != "."
        ]
        if px:
            lines.append(f"<!-- y={yy:02d} -->")
            lines.extend(px)
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def emit_png(path: str, w: int, h: int, rows: list[str]) -> None:
    """Minimal RGBA PNG writer — stdlib only (zlib + struct), deterministic."""
    import struct
    import zlib

    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type: None
        for ch in row:
            if ch == ".":
                raw += b"\x00\x00\x00\x00"
            else:
                hexv = PALETTE[ch][1].lstrip("#")
                raw += bytes(int(hexv[i : i + 2], 16) for i in (0, 2, 4))
                raw.append(255)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main() -> None:
    os.makedirs(SVG_DIR, exist_ok=True)
    os.makedirs(PNG_DIR, exist_ok=True)
    for name, (w, h, rows) in SPRITES.items():
        path = os.path.join(SVG_DIR, f"{name}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(emit_svg(name, w, h, rows))
        print(f"svg  {os.path.relpath(path, ROOT)}  ({w}x{h})")
        path = os.path.join(PNG_DIR, f"{name}.png")
        emit_png(path, w, h, rows)
        print(f"png  {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
