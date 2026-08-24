# WO10 — Canvas legibility, Inspector components, Project suite

Status: LANDED 2026-08-20. Built in one pass from `docs/INPUT_PROMPT.md`: the
16-item 08/20 09:45AM list plus the four items from 08/19 2:10PM that were
never built (#7–10). Marty chose "include everything now" over deferring the
project suite.

Amends `WO09_CONNECTOR_CONTRACT.md` §3 (see its §3a) and bumps `graph.json`
v3 → v4.

---

## 1. Why

The 08/20 list is one complaint said sixteen ways: **the canvas does not tell
you what it knows.** Every wire looked the same whatever it did; a selected
node did not show what it touched; a selected wire vanished under the wires
crossing it; a port carrying one connection looked exactly like a port carrying
five; labels piled on top of each other; an agent plate showed a read-order
number that means nothing for an agent, and a model id clipped to `claude-h…`.

The Inspector had the mirror problem: 1845 lines rendering one flat column of
twelve fields, where the control you want is always below the fold.

And the title screen had one door — "Open folder" — which is the one case a new
user is *not* in.

## 2. Decisions taken before building

Four, all Marty's:

1. **Scope** — all 20 items in one round, not a canvas round then a project round.
2. **Hand-edited routes persist** — `waypoints` on the edge, graph schema v4
   with migrations on both sides. A route you lose on reload is worse than no
   route editing at all.
3. **Connector height grows with pin count** — amends the frozen WO09 geometry
   rather than keeping 44px and varying only the fill.
4. **Inspector = collapsible titled components**, no add/remove-component
   machinery. Cowtext's sections aren't optional, so the part of Unity worth
   borrowing is the header and the persisted collapse, not the plumbing.

## 3. Item → landing

| # | Item (08/20) | Landed as |
|---|---|---|
| 1 | Selected node highlights its connections | `--edge-related` tone in `MemoryEdge.tsx`; subscribes to a BOOLEAN, so selecting a node re-renders only the wires whose answer changed |
| 2 | Selected connection on top | `GraphCanvas.tsx` seeds `selected` from the STORE (it only ever preserved React Flow's own before) + explicit `zIndex` 1000 |
| 3 | Pins == connections, floor 1 | `portSlots.ts` `pinCount` / `portHeight` / `slotOffset({rank,pins})`; fingers are `.ct-pin` elements, not a gradient |
| 4 | Editable connection path | graph v4 `waypoints`; `edgeEdit.ts` (pure), segment handles on a selected wire, `routeEdge` chains through them, "Reset path" |
| 5 | One verb per label, no intersections | `edgeVerb.ts` (verb + icon table) and `labelSlots.ts` (pure collision sweep, deterministic by id) |
| 6 | No read order on agent plates | `MemoryNodeCard.tsx` — badge gated to the memory plate; the FIELD stays, because sequence edges read it |
| 7 | Spawn at viewport centre | `viewport.ts` `registerViewportCenter` / `viewportCenter`; `adoptFile` uses it instead of a fixed (80,80) cascade |
| 8 | Hierarchy selection focuses viewport | `useFocusStore` (nodeId + nonce); GraphCanvas moves ONLY when the card is off-screen |
| 9 | Wizard descriptions overflow | `w-full min-w-0` — `truncate` in a `flex-col items-start` button had nothing to clip against |
| 10 | Hierarchy / Graph / Inspector sync | `sameRelPath` everywhere + `setSelection` clears the other panel-owning selections |
| 11 | Tools dropdown | `toolCatalog.ts` + `ToolPicker.tsx`; `NewAgentDialog`'s private list now reads the same catalog |
| 12 | "Create memory folder" redundant | Button only when the index is genuinely missing; `convertToAgent` now ensures memory like `createAgent` already did |
| 13 | Per-edge colour | `edgeColor.ts` closed palette + `--edge-c-*`; markers generated per (shape × tone) |
| 14 | Short model name | `shortModelLabel()` in `modelCatalog.ts` |
| 15 | Nickname on the plate | Under the title, in quotes, when set |
| 16 | Unity-style Inspector | `InspectorSection.tsx`; node / agent-node / edge panels all rebuilt on it; collapse persists in `AppSettings.collapsedSections` |

| # | Item (08/19 2:10PM) | Landed as |
|---|---|---|
| 7 | New Project wizard | `ProjectWizard.tsx` mode `"new"` on the title screen |
| 8 | Convert existing project | Same component, mode `"convert"`; ends by opening the EXISTING `ImportReviewModal` |
| 9 | Cowtext-friendly format | `project_init` scaffolds `.cowtext/`, `context/`, `.claude/agents/` |
| 10 | Project properties | `.cowtext/project.json` v1 + `project_meta_read` / `_write`, editable from the top bar |

## 4. The root causes worth remembering

**Selection was one-way.** `GraphCanvas` seeded an edge's `selected` flag from
the PREVIOUS React Flow edge only, so a selection made anywhere else — the edge
context menu, the Problems panel, the Inspector's relations grid — never
reached the canvas. That is also why "selected wire on top" looked broken:
React Flow *does* elevate a selected edge by +1000, but only for edges it knows
are selected.

**Two notions of path equality.** `isAgentFile` normalized separators and case;
`nodeFor`, `adoptFile`'s duplicate guard, and the file rail's lookup used a
bare `===`. A node stored with backslashes therefore rendered as an agent plate
on the canvas AND reported "off the graph" in the rail — and adopting it again
sailed past the duplicate guard and minted a second node for the same file.
`sameRelPath` is now the only comparison.

**A selection nothing cleared.** `useAgentsStore.selection` was set in seven
places and cleared in exactly one (`loadAgents`). No `select(null)` existed
anywhere in the codebase, so a stale agents selection outlived every graph
selection and the Inspector's branch ladder fell through to it — offering
"Adopt to graph" for a node plainly on the graph.

## 5. Schema v4

One field: `MemoryEdge.waypoints` — `Vec<Position>` in Rust, `{x,y}[]` in TS,
omitted at default on both sides so serialization stays byte-identical. v3 → v4
is pure default-filling; `#[serde(default)]` does the work, which is why
`migrate_graph`'s body did not grow a step. Preset format bumps in lockstep
(v3 → v4) because a preset carries layout, and a route is layout.

## 6. New modules

Pure (no React, no store, no I/O) — the shape the rest of the canvas already
uses, and the only way to keep this reviewable without a frontend test runner:

- `src/canvas/edgeEdit.ts` — segment drag → waypoint list
- `src/canvas/labelSlots.ts` — label boxes → y offsets
- `src/canvas/edgeVerb.ts` — kind → verb + icon
- `src/canvas/edgeColor.ts` — palette + stroke/marker resolution
- `src/agents/toolCatalog.ts` — the tool vocabulary

Stateful:

- `src/inspector/InspectorSection.tsx` — the collapsible component primitive
- `src/agents/ToolPicker.tsx` — trigger + portal popup (TagPicker idiom)
- `src/project/ProjectWizard.tsx` — new / convert / edit, one component
- `src-tauri/src/project_meta.rs` — the sidecar, the renderer, the scaffolder

## 7. Deliberately NOT built

- **A starter-pack step in the New Project wizard.** Presets already have a
  full modal on the top bar; a second preset UI is a second thing to keep
  correct for no new capability.
- **A second importer.** "Convert" hands off to `ImportReviewModal` — the
  reviewed, defect-fixed WO03 one, with its `alreadyManaged` / `compileOwned`
  guards intact.
- **A global router.** `routeEdge` still sidesteps at most the two endpoint
  cards. Hand-editing is now the answer where it gets a route wrong; a real
  router remains open (08/19 2:10PM item 2, still only partly met).
- **Draggable endpoint stubs.** Moving either would tear a wire out of its
  connector, which is a bug, not an edit.

## 8. Gates at landing

`npm run build` · `npm run lint` (0 errors, 1 pre-existing warning) ·
`cargo clippy --all-targets -- -D warnings` · `cargo test` **553 passing** ·
**66/66 invoke commands** declared, registered, and called from TS by exact name.
