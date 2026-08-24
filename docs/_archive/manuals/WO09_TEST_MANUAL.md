# WO09 Manual Test Script — Canvas connectors, round 2

Hand-run test manual for the round-2 cartridge-connector rework (frozen contract
`docs/_archive/contracts/WO09_CONNECTOR_CONTRACT.md`). Marty rejected round 1 on two counts —
"the wire is too far from the socket" and "connectors need to look like cartridge
contacts and support more than one wire" — and this script exists to prove both are
actually fixed, not just claimed fixed. Run it top to bottom in one sitting; sections
C onward reuse the graph built in section B. Written against the code as of
2026-08-19 (`src/canvas/portSlots.ts`, `src/canvas/edgePath.ts`,
`src/canvas/MemoryEdge.tsx`, `src/canvas/GraphCanvas.tsx`, `src/canvas/types.ts`,
`src/canvas/MemoryNodeCard.tsx`, `src/styles/index.css`, `src/styles/tokens.css`,
all currently uncommitted working-tree state on top of `c9f7ec6`). Every step names
the real control and the exact expected result — if reality differs, that is a bug
(or this manual is stale; either way, note it).

Two steps are marked **[KNOWN-FAIL]** — confirmed source-level defects found while
writing this script. They do not block any of the eight §10 on-screen checks (both
are stale/incorrect *comments*, not runtime behaviour), but they are real and are
included so Marty and tech-ui don't have to rediscover them.

**Time budget:** ~35 min full pass, plus the 3-minute regression at the end.

---

## A. Preconditions

1. **Free port 1420.** `strictPort` is on — if anything sits on 1420, `tauri dev`
   fails instead of picking another port.
2. **Start the app:**

   ```powershell
   npm run tauri dev
   ```

   *Expected:* Vite starts on :1420, cargo builds, the Cowtext window opens on the
   "Open a project" empty state.
3. **Make a throwaway test project** (do NOT use a real project):

   ```powershell
   mkdir C:\_wo09test
   Set-Content C:\_wo09test\notes.md "# Notes`n`nScratch."
   ```

4. Press **Open folder** and pick `C:\_wo09test`.
   *Expected:* workspace opens, empty canvas, file rail shows `notes.md`.
5. **Open WebView devtools** (right-click the canvas → **Inspect Element**, or
   `Ctrl+Shift+I`). Keep it docked for the whole session — sections B and F need it
   to read the exact zoom factor and, once, a computed style. If devtools does not
   open in this build, use the approximate fallback noted inline at each step that
   needs it.

---

## B. Plugged in — one edge, zero daylight, three zoom levels (§10.1, reject condition)

### B1. Build two cards and wire them

6. Press **New node** (top-left panel, `+ New node`). Wizard opens on step 1.
   Type `Card A` in **Name**, press **Next** twice (step 2 dir/file defaults are
   fine, no need to touch them), press **Next** once more (step 3 Brief, leave
   empty), then press **Create node** (step 4). *Expected:* a card titled `Card A`
   appears on the canvas, selected.
7. Repeat step 6 for `Card B`. *Expected:* two cards on the canvas. If they land on
   top of each other, drag `Card B` roughly 500px to the right of `Card A` (wide
   spacing keeps every wire in this script on the simple "forward run" — no detour
   lane — so the geometry stays easy to eyeball).
8. **Drag a connection** from `Card A`'s right-edge output pins to `Card B`'s
   left-edge socket. *Expected:* the **Edge kind** picker opens (Structural group:
   imports / sequence / overrides; Advisory group: references / conditional /
   supersedes / conflicts-with). Click **imports**. *Expected:* a solid 3px wire
   appears, leaving the middle pin of `Card A`'s output block and entering the
   middle contact of `Card B`'s input block — dead centre on both ends (this is
   `CENTER_SLOT`, the 1-wire case).

### B2. Zero daylight at 100%

9. In devtools Elements, select the `.react-flow__viewport` div and read its inline
   `transform: translate(...) scale(N)`. Use the bottom-left **Controls**
   zoom-in/zoom-out buttons (or `Ctrl`+scroll) until `N` reads exactly `1`
   (100%) — or press **Fit view** (the square-corners icon) if the two cards
   already fit inside the pane at 100%.
10. Zoom in as far as the browser lets you (visually, not React Flow's zoom) on the
    exact point where the wire meets `Card B`'s socket. *Expected:* the arrowhead's
    tip is not visible past the socket's dark shell — the last ~3px of the triangle
    are swallowed by the connector housing, and the wire visually *plugs into* the
    hardware with no gap between stroke-end and socket face. This is the fix for
    Marty's finding 1 — compare against the round-1 screenshot if you have one; the
    daylight gap is gone.
11. Confirm the arrow is still legible: at least the front ~8 of its 11px remain
    outside the socket and the triangle shape is still readable, not fully hidden.

### B3. Zero daylight at 200% and 50%

12. Click the **+** zoom button repeatedly until it disables itself. *Expected:*
    `.react-flow__viewport`'s `transform` now reads `scale(2)` (React Flow's
    `maxZoom` is pinned to 2 in `GraphCanvas.tsx`, so the button capping out **is**
    exactly 200%). Re-check the wire/socket junction from step 10. *Expected:*
    still zero daylight — the whole viewport (nodes, edges, and every marker,
    since `EdgeMarkerDefs`'s `<svg>` is a sibling of `<ReactFlow>` but the actual
    `<path markerEnd=…>` it's attached to lives inside the same CSS-transformed
    `.react-flow__viewport` as the node cards) scales together as one pixel image,
    so a gap that isn't there at 100% cannot open at 200% either.
13. Click the **−** zoom button repeatedly until it disables (this pins at
    `minZoom` 0.2, i.e. 20% — there is no button-only way to land on exactly 50%).
    For exactly 50%, use `Ctrl`+scroll and watch the devtools `scale(...)` value
    until it reads `0.5`. *Expected:* zero daylight holds here too. Also note the
    connector still reads as distinct fingers rather than a grey smear (carries
    forward to check F1 below).

### B4. Occlusion and the connection-line preview

14. Return to 100% (Fit view). **Click the wire** to select it. *Expected:* it
    turns accent-blue (`--edge-selected`) and thickens its marker to the selected
    variant; the swallowed-tip behaviour is unchanged — a selected edge does not
    suddenly poke past the socket.
15. Drag `Card A` so it briefly overlaps `Card B`'s left edge, then drag it back.
    *Expected:* while overlapping, `Card B`'s plate visibly paints over the wire
    (never the reverse) — nodes always win, confirming the WO09 contract §2 paint
    order claim.
16. **Start a new connection** (mouse-down on `Card A`'s output pin, drag toward
    empty canvas, don't release). *Expected:* an accent-blue **step-shaped**
    preview line follows the cursor and visibly draws **over** both cards' pins
    if you drag across one — accepted as-is per contract §9.4 (not a defect; this
    line is not the routed wire and never goes through `edgePath.ts`). Press
    `Escape` or release over empty canvas to cancel.

---

## C. Three into one — fan-in slot assignment (§10.2, reject condition)

17. Build three more cards left of `Card B`: `Feed 1`, `Feed 2`, `Feed 3`, each via
    **New node** (step 6's recipe), then drag them so all three sit to the left of
    `Card B`, vertically staggered by at least 150px each (so their plates don't
    overlap) and each roughly 400-600px to `Card B`'s left.
18. Connect `Feed 1` → `Card B` (any kind, e.g. **references**), `Feed 2` →
    `Card B` (**references**), `Feed 3` → `Card B` (**references**).
    *Expected while dragging each:* three separate wires, each starting from its
    own `Feed N` card's output pin.
19. Zoom in on `Card B`'s input block. *Expected:* three distinct wires land on
    three **adjacent** contacts of the five-finger block — per `portSlots.ts`'s
    `slotForRank(rank, 3)` (`count<=5` branch: `floor((5-3)/2)+rank`), the three
    edges occupy slots `{1,2,3}`, i.e. y-offsets **−8, 0, +8** from the port
    centre — 8px apart, matching `FINGER_PITCH`. You should be able to count three
    wires without following any of them back to its source.
20. Each wire's final turn (the vertical "riser" segment before it goes straight
    into the socket) should land at its **own** x-column, staggered by
    `RISER_STEP` (8px) per slot — look at the three vertical segments just left of
    `Card B`; they should not all sit on the same x.

---

## D. Fan-out — three outgoing edges (§10.4, reject condition)

21. Delete the three fan-in edges from section C (right-click each wire → **Delete
    edge**, or select + `Delete`/`Backspace`). Reconnect them the other direction:
    `Card B` → `Feed 1`, `Card B` → `Feed 2`, `Card B` → `Feed 3` (drag from
    `Card B`'s output pin each time; pick **references** again).
22. Zoom in on `Card B`'s **output** block. *Expected:* three wires leave three
    **different pins** of the five-pin output block (again slots `{1,2,3}`, same
    8px spacing) — not one bundle off the centre pin. This is what the contract
    calls out explicitly: round 1's fan-out admission ("still overlaps on the
    source side") is retired; verify it actually is by eye here.

---

## E. Oversubscribed — six edges into one port (§10.3, informational — not a reject condition, but must not vanish a wire)

23. Delete the three edges from section D. Create three more cards: `Feed 4`,
    `Feed 5`, `Feed 6`, positioned like `Feed 1-3`. You now have six source cards
    (`Feed 1`…`Feed 6`).
24. Connect all six into `Card B`: `Feed 1` → `Card B`, `Feed 2` → `Card B`, …,
    `Feed 6` → `Card B` (any kind is fine — **references** for all six keeps this
    step simple; section G revisits with a mixed kind).
25. Zoom in on `Card B`'s input block. *Expected:* all **five** contact fingers
    show at least one wire — none idle. Per `portSlots.ts`'s overflow rule
    (`count>5` ⇒ `rank % SLOT_COUNT`), the topmost finger (slot 0, y-offset −16)
    is the one that wraps and therefore carries **two** wires (rank 0 and rank 5
    by `(source,id)` lexicographic order); the other four fingers carry exactly
    one each. *Expected:* no wire is missing, and none is routed off the block
    entirely (e.g. floating past the plate edge) — six wires in, six wires
    visible, one shared contact.
26. Click each of the six wires in turn and read the Inspector's edge header
    (`SourceTitle —kind→ Card B`) to confirm all six `Feed N → Card B` edges are
    present and none silently got dropped by the slot assignment.

---

## F. Stability — the reject condition that is easy to break by accident (§10.7, reject condition)

27. With the six-wire graph from section E still up, note which contact each wire
    currently occupies (roughly — "topmost has two, then one each going down").
28. **Delete an edge that does NOT touch `Card B`'s input port** — delete the
    `Card A → Card B` edge from section B if it's still there, or create and then
    delete a throwaway edge between two of the `Feed` cards' unused handles that
    has nothing to do with `Card B`. *Expected:* re-inspect `Card B`'s input
    block — every one of the six `Feed N → Card B` wires is on the **exact same
    contact** as before. Nothing reshuffled.
29. **Drag `Feed 3` (or any of the six source cards) to a new position** on the
    canvas and drop it. *Expected:* mid-drag, the wire follows smoothly; after
    drop, re-check the contact assignment on `Card B` — unchanged. Dragging a card
    must never re-slot a wire (per contract §5: ranking keys on ids only, never
    position).
30. **Add a seventh edge** from a brand-new card (`Feed 7`) into `Card B`.
    *Expected:* this DOES legitimately reshuffle — the group re-packs/re-wraps
    with 7 members now, so some existing wires may land on different contacts.
    This is the one sanctioned reshuffle (adding an edge that touches the same
    port); verify it's the *only* thing in this section that moved anything.
    Delete `Feed 7`'s edge afterward to return to the six-edge baseline.

---

## G. Cartridge read and state colours (§10.5, §10.6)

31. At 100% zoom (Fit view), look at any port on any card. *Expected:* a dark
    shell (`--port-body`) with a run of five bright horizontal bars
    (`--port-contact`) inside it — hard square corners, no rounded edges, no
    antialiased grey blur on the bar edges (crisp, stepped). The input side reads
    as a recessed bay cut into the plate's left edge (open on the left, closed on
    top/bottom/right); the output side reads as a solid shoulder with pins
    protruding to the right.
32. Zoom to 50% (per B3's method). *Expected:* the five-finger structure is still
    legible as discrete bars, not merged into a solid blob.
33. **Hover the card body** (not the port) of any node. *Expected:* that card's
    both ports' contact fingers recolour to amber (`--amber-text`) — both input
    and output blocks together, one CSS custom property flip.
34. **Select the node** (click it, not the port). *Expected:* same amber recolour
    persists while selected, independent of hover.
35. **Hover directly over a port** (not the card body). *Expected:* that port's
    fingers switch to accent blue (`--accent`) and, for an input port, the bay's
    background fill also tints `--accent-surface`. This should override the
    card-hover amber if both are true at once (hover the card first, then move
    onto its port without leaving the card) — *expected:* colour transitions
    amber → accent blue, never shows both or flickers between them.
36. **Start dragging a connection** from an output pin without releasing.
    *Expected:* that pin's fingers go accent blue for the duration of the drag,
    same as port-hover. Release over empty canvas to cancel without creating an
    edge.

---

## H. Loud edge into a busy port (§10.8)

37. Using the six-wire `Card B` input port from section E, right-click one of the
    six wires → in the kind menu pick **overrides** (Structural group, 5px stroke
    + arrow-plus-trailing-bar marker per `MemoryEdge.tsx`'s `STROKE` table).
38. Zoom in on `Card B`'s input block. *Expected:* the now-`overrides` wire (5px
    wide) still lands cleanly on its own contact finger; its stroke does not
    visually merge with the 3px `references` wire on the neighbouring finger 8px
    away (half-widths 2.5px + 1.5px = 4px < 8px pitch, so there is always at
    least 4px of visible gap between the two strokes' edges). The arrow-plus-bar
    marker is still individually readable as "overrides" and not confused with a
    plain arrow.

---

## I. Documentation cross-check (source-level; not a runtime defect)

These two steps are **[KNOWN-FAIL]** — they read source files directly rather than
the screen, because the defect is a misleading comment, not a rendering bug. They
do not block any of B-H above and are not one of the four reject conditions.

39. **[KNOWN-FAIL]** Open `src/canvas/MemoryNodeCard.tsx` lines 13-16.
    *Actual:* `// Contract §7.11: three target handles on the input (left) half,
    three source handles on the output (right) half — ids are frozen and never
    persisted (src/canvas/handles.ts#pickHandles derives the pair at render
    time).` *Expected if this were accurate:* a file `src/canvas/handles.ts`
    exporting `pickHandles`, and three `<Handle>` elements per side. *Reality:*
    `src/canvas/handles.ts` does not exist anywhere in the repo (confirmed via
    glob — zero matches), `pickHandles` is referenced nowhere else in `src/`, and
    lines 495-496 of the same file render exactly **one** `<Handle>` per side with
    **no** `id` prop — which is what the frozen WO09 contract §6 actually
    requires ("The two `<Handle>` elements keep no `id`: FROZEN"). This comment
    block pre-dates WO09 (`git blame` → commit `7122ee1`, 2026-08-18, the prior
    "UX batch" session) and was not introduced this round, but it sits in a file
    this round's lane (Z6) owns for comments and directly contradicts both the
    correct header 480 lines below it (L489-494, which tech-ui did update
    correctly this round) and the frozen contract. Severity: MINOR (misleads the
    next reader/agent about the connector's handle architecture; zero runtime
    effect). Fix: delete or rewrite L13-16 to match L489-494.
40. **[KNOWN-FAIL]** Open `src/canvas/MemoryEdge.tsx` lines 8-14 (the per-kind
    stroke-width/dash table) and compare against the `STROKE` const at lines
    33-41. *Comment says:* imports/sequence/references/conditional/supersedes/
    conflicts-with = **2px**, overrides = **4px**, dash patterns `4 4` / `2 4` /
    `8 4` / `2 2`. *Code says (and actually renders):* those six kinds = **3px**,
    overrides = **5px**, dash patterns `5 5` / `3 5` / `9 5` / `3 3` — every
    number in the comment is off by exactly 1 from the code it documents. The
    freshly-added comment immediately above `STROKE` (lines 28-31, "3px is the
    standard gauge… `overrides` stays the loud one at 5px") states the *correct*
    numbers and is not itself wrong — only the older per-kind table above it is
    stale. This does not affect H's "loud edge" check (the code, not the comment,
    drives rendering, and the code value is the correct 5px). Severity: MINOR.
    Fix: update L8-14 to match L33-41 (or delete the redundant table now that the
    comment above `STROKE` says the same thing correctly).

---

## J. Regression — 3 minutes

41. **Create and delete a plain edge:** connect any two cards, pick **sequence**.
    *Expected:* solid wire with a step-number tag rendered at the label position;
    right-click → **Delete edge** removes it cleanly, no orphaned marker or stray
    pixel left behind.
42. **Kind picker still gates conditional edges correctly:** drag a new connection,
    pick **conditional** in the picker. *Expected:* a condition text input appears
    inline (`src/net/** or plain language` placeholder) before the edge commits;
    type a value and press **Add**. *Expected:* dotted edge with a condition chip
    label.
43. **Edge selection and hover-highlight still work:** select any wire from the
    canvas; then hover the matching row in the Inspector's Relations grid (if
    present) — canvas echoes the highlight as an accent stroke, same as before
    WO09.
44. **Restart-persist:** close the window, `npm run tauri dev` again, reopen
    `C:\_wo09test`. *Expected:* every card is at its saved position, every edge
    kind/condition intact, and the contact-slot assignment for the six-wire port
    (section E/F/H) recomputes identically on reload — `assignPortSlots` is pure
    and keys only on ids, so a fresh load must reproduce the same layout (topmost
    finger still doubled, same wire on it).

---

## Cleanup

45. Close the app and delete the scratch project:

    ```powershell
    Remove-Item -Recurse -Force C:\_wo09test
    ```

## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Plugged in / zero daylight (100/50/200%) — §10.1 REJECT | | |
| C Three into one — §10.2 REJECT | | |
| D Fan-out — §10.4 REJECT | | |
| E Oversubscribed (six into one) | | |
| F Stability — §10.7 REJECT | | |
| G Cartridge read + state colours — §10.5/§10.6 | | |
| H Loud edge — §10.8 | | |
| I Documentation cross-check (2 known-fail, non-blocking) | | |
| J Regression | | |

Tester: ____________  Date: ____________  Build/commit: ____________
