# WO17 — Visual environment: the growth plan

**Opened 2026-08-24.** Not a frozen contract — a prioritised plan. The frozen
contract, if WO17 is dispatched, is written separately by tech-lead against the
items filed in `docs/tasks/BACKLOG.md` §WO17.

The band names below (P0…P5) are scoped to this document. In BACKLOG the same
rows carry a `WO17 ` prefix — `WO17 P1.1`, not `P1.1` — because an unrelated
`P1.1…P1.6` already exists there for the WO15 checkpoint blocks. The six
Marty-only decisions are open rows in `docs/tasks/TASKS.md`.

Grounded in a code audit (2026-08-24), **not** in BACKLOG claims. The audit
contradicted the backlog in two places; both corrections are recorded below.

## The thesis

> **The diagrams you draw to think are the context the agent reads.**

An architecture diagram does not sit *next to* the context — it **is** the
context. Draw the infrastructure and the agent knows the infrastructure. Draw the
intended user workflow and the agent knows where the product is going. This is
the only framing under which "visual environment" and "context compiler" are one
product rather than two in one window, and it is the asymmetry no competitor has:
elsewhere the graph is a *view onto data*; here the graph *is* the data.

Positioning consequence, and it needs Marty's ratification (see §Decisions): the
compiler becomes the **engine**, not the pitch.

## The diagnosis

**The product has systematically traded the fast path for the careful path.**

- Node creation leads into a four-step wizard — from **all four** entry points
  (`src/canvas/GraphCanvas.tsx:450-454, 264-282, 521-528` → `src/wizard/NodeWizard.tsx`).
- Edge creation opens a modal kind-picker before the edge exists
  (`GraphCanvas.tsx:331-334` → `src/canvas/KindPicker.tsx`).
- The Run button was **deliberately removed** from the task-context modal
  (`src/taskctx/TaskContextModal.tsx:93-98`) in favour of the global top-bar Run.

Each decision defended quality and was individually right. Together they cost:
**a 10-node / 12-edge graph is roughly 22 dialogs.** Sketching is not supported
by the current interaction model; deliberate, file-backed authoring is.

The cheap part: `createNode(position)` already exists in the store
(`src/store/graph.ts:643`) and **has zero UI call sites**. The fast path is built
and simply not wired.

## Audit corrections to BACKLOG

| Claim in BACKLOG | Reality in code |
|---|---|
| 2.5 Undo/redo — `NEW`, unbuilt | **Built.** Snapshot history, `HISTORY_CAP = 100` (`src/store/graph.ts:799`), global Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (`src/App.tsx:795-809`). Graph-only — file writes are never undone. |
| Motion tokens — implied missing | **Present but dead.** `--dur-instant/fast/base/slow/pulse` + easing curves exist (`src/styles/tokens.css:249-257`). `--dur-slow` is used **zero** times; `--dur-pulse` likewise. ~97 % of app motion is one 140 ms colour ease on hover, repeated 254 times. No modal, dropdown or panel enter animation exists. |

Two more facts the backlog does not carry: the barn is **already a full-surface
tab** (`src/App.tsx:856-860`), and its sprites are 100 % procedural Pixi
`Graphics` — the PNGs in `assets/sprites/` are 123-byte stubs that reach no
bundle.

## Priorities

Order is load-bearing: each level stands on the one above.

### P0 — Clear the table (≈1 week, blocks everything)

Nothing below can start on a dirty tree with eight open acceptance walks.

1. **Commit WO15 + WO16.** 25 modified + 6 new files sit on top of `b884dd9`.
2. **Walk the golden path.** 38 scenarios, ~55 min, one sitting. This *is* the
   v0.1.0 gate; ROADMAP §Release gate defines nothing else.
3. **Fold the eight per-WO manuals into one regression list.** WO01, 02, 03, 06,
   09, 10, 11, 12, 13 walked separately will never close. Take only what the
   golden path does not cover — 20–30 steps instead of eight runs. This lowers
   the bar deliberately; a bar nobody clears protects nothing.
4. **Cut v0.1.0.** The version is permission to start the next cycle, not a
   reward for the last one.

### P1 — Restore the fast path (2–3 weeks, highest ROI)

The direct answer to the diagnosis and to the stated metric.

1. **Inline node creation.** Double-click puts a card down *immediately*, caret in
   the title field, Enter commits. Default role, changed later in one click. The
   wizard moves behind "Advanced…" and stays where it earns its place. Wire the
   existing `createNode(position)`.
2. **Edge without a modal.** The edge lands with the last-used kind, the kind
   glyph rides the wire, clicking it changes the kind. The modal survives for the
   guard case. Draw-time legality checking is unaffected.
3. **Drop a connection on empty canvas → node + edge in one gesture.**
   `onConnectEnd` (`GraphCanvas.tsx:374-378`) currently only clears state.
4. **Copy / paste / duplicate.** Absent today — the repo's own test says so
   (`src/store/graph.test.ts:504-505`).
5. **Command palette (Ctrl+K) and keyboard shortcuts.** The design spec already
   reserves z-index 400 and a keycap style. Beyond the palette: `N` new node,
   `/` search, `Ctrl+A`, arrow-key nudge, digits for view switching. Today the
   only global key handler in the app is undo/redo.
6. **Auto-layout + a Tidy button.** Needs dagre or elk (~40 kB) — **a new
   dependency, so Marty's permission is required** by the project's hard rule.
7. **Put Run back on the task card.** Its removal replaced a direct path with one
   that **degrades silently**: with no stable task id the dialog prefills nothing
   and the agent runs with no context behind a small amber line
   (`src/sessions/AddAgentDialog.tsx:109-116, 183-186`). Fix: a button on the
   card, auto-mint the id on first link, and refuse explicitly rather than
   launching context-free.

**Acceptance.** Twelve nodes and fifteen edges from empty in five minutes without
opening one modal. And: click a task → Run → the agent starts with that task's
subgraph, never touching the top bar.

### P2 — Maps: many graphs over one node pool (2–3 weeks)

The core of the idea, and cheaper than it sounds — every role it needs already
exists in schema v5. Zero new roles, zero migrations.

1. **Sidecar `.cowtext/maps.json`, no schema bump.** A map is
   `{id, name, kind, nodeIds[], positions{}, sketches[]}`. Node `x/y` in
   `graph.json` stays the default-map position; a map overrides it. One node may
   sit on several maps at different coordinates. Reversible: delete the sidecar
   and behaviour is exactly today's — the only reason to do it this way instead of
   bumping `graph.json` to v6.
2. **Five map kinds on existing roles.** Context (`rule` / `invariant` / `trap` /
   `glossary`) · Agents (`agent` / `skill` / `command`) · Architecture
   (`architecture` / `decision`) · Infrastructure (`env` / `tool`) · Workflow
   (`workflow` / `example`). The kind sets defaults — which roles are offered,
   which edges are legal, how the card looks. The data stays shared.
3. **Sketch elements: frames, labels, groups.** Not files, never compiled, living
   only in `maps.json`. This is what resolves the tension with the "a node is a
   real `.md`" invariant: draw freely, compile only what a file stands behind.
   The rule to state once and never break: **a node is a file; a sketch is never a
   file.**
4. **Map switcher and "show on map".** From any node's Inspector: "this node is
   on Context, Architecture" — one click and you are in the other view.

**Acceptance.** Draw an eight-block architecture on its own map, press Compile,
and the agent receives an architecture description that did not exist before —
without typing it as prose.

### P3 — Close the loop: board → agent → graph (3–4 weeks)

Three quarters of the loop shipped in WO06. With the first hop fixed in P1.7,
what remains is the return path.

1. **Drag and drop on the board.** Status changes go through a kebab menu today;
   a stale comment in `src/store/tasks.ts:293` still says "on every drag" — there
   has never been a drag.
2. **Agent result → proposed node behind diff preview.** Half exists
   (`handoff_node_propose`). Finish it to one button from the agent panel, over
   the same trust boundary as Compile.
3. **Memory Inbox — the graph learns.** The agent explains the same thing a third
   time; the app offers to mint a node. The sleeper feature: agents work, and the
   graph gets better without the user doing anything.
4. **Streaming assemble.** Text flows into the node as it generates. Cuts 55–70 %
   of *perceived* wait without making anything faster.
5. **Resolved-context preview.** The exact bytes the agent will see, imports
   expanded, token count attached. The one item on this whole list nobody else
   has — and what earns the word "compiler".

### P4 — The barn as the soul, not a tab (2 weeks + art track)

The scene is already full-surface and alive — 3,968 lines, idle choreography,
sound. Three things are missing.

1. **Real sprites (Aseprite).** Everything is procedural `Graphics` today.
   Marty-side track, parallel to anything. Strategic note: Munder Difflin's art is
   licensed **non-commercial only** — they cannot monetise their current visuals;
   original art means Cowtext can.
2. **Separate always-on-top window.** A full-surface tab is not enough for
   "I watch this instead of the terminal" — the barn has to live *beside* the
   editor, not instead of it.
3. **One-click GIF export.** The viral loop, and the one marketing asset
   competitors cannot copy. Everything else in this category is a weekend's work
   to clone; the barn is not.
4. **Legible in three seconds.** A glance tells you which of the four agents is
   doing what and how far along. Without this the barn is pretty but
   uninformative, and stops being opened in week two.
5. **Ambient life.** Day/night, dust motes, weather from project age.

### P5 — Bring the interface alive (1–2 weeks, woven through P1–P4)

1. **Revive the dead tokens.** See the audit correction above. Modals, dropdowns
   and panels currently snap.
2. **Five signature moments, and no more.** Node appears · Compile fires (the diff
   leaves, the file lands) · agent starts · task completes on the board · map
   switches. A few rehearsed movements make the impression; animation on every
   button cheapens it.
3. **Resolve the contradiction with our own spec.** `DESIGN_SPEC.md` "Rules of the
   line" ban #6 **explicitly forbids** animation tied to routine UI events — and
   is the likely reason the interface is static today. Proposed amendment: motion
   is allowed when it **carries information** (state changed, something arrived,
   something is live) and forbidden when decorative. The discipline survives; the
   blanket ban does not.
4. **No new animation library.** CSS transitions plus the Web Animations API —
   there are only two `requestAnimationFrame` calls in all of `src/` today, so the
   headroom is enormous. Framer Motion is +50 kB for what thirty lines do.

## Sequencing

| Level | Stands on | Why here | Size |
|---|---|---|---|
| P0 | — | Cannot build on a dirty tree; v0.1.0 unblocks the money conversation | 1 wk |
| P1 | P0 | Drawing speed is a precondition for maps — five maps at 22 dialogs a graph multiplies the pain | 2–3 wk |
| P2 | P1 | Maps turn the compiler into an environment; nobody else has this | 2–3 wk |
| P3 | P2 | An improvement loop needs something to improve — i.e. maps first | 3–4 wk |
| P4 | P3 | The barn is interesting with several agents live; earlier it is pretty but empty | 2 wk |
| P5 | woven | Polish inside each level. Deferred polish never happens | — |

## Explicit non-goals

Half the plan is refusals; without them focus dissolves in two weeks.

- **Do not chase Munder Difflin's orchestration.** Mailboxes, circuit breakers,
  voice, Slack, ten engines — that is their pitch, not a side feature, and
  Anthropic's own Agent Teams now stands in that lane.
- **Do not build a second IDE.** Monaco, a multi-file editor, a git graph.
- **Do not panic about weight, and do not add to it.** Bundle is 3.6 MB; Pixi
  (524 kB) and CodeMirror (514 kB) are half the JS but both lazy, so first paint
  pays for neither. Nothing to optimise — but every new dependency is a decision
  with a price.
- **Do not add a second game metaphor over the graph.** The barn holds that role.
- **Do not rewrite undo/redo.** It works. Surface it in the palette and the hints;
  users simply do not know it is there.
- **Do not touch `Inspector.tsx` without budget.** 3,354 lines, the largest file
  in `src/`. The next feature that goes in there budgets for the split instead of
  adding a tenth section (already filed as a WO15 debt).

## Decisions — Marty only

1. **Positioning.** "Context compiler" → "the visual environment where you design
   a product with AI", compiler as engine not pitch. This edits `CLAUDE.md`, where
   positioning is a hard rule. Recommendation: change it, but with the
   "diagrams become context" formulation, not a vague "environment for everything".
2. **Lift the ban on animating routine UI events.** See P5.3. Without this, P5
   cannot start without violating our own spec.
3. **dagre or elk as a new dependency.** Needed for P1.6; a hand-rolled graph
   layout costs more than the library.
4. **Do non-file objects belong on the canvas?** Sketch elements (P2.3). First
   softening of the "a node is a real `.md`" invariant in the project's history.
   Assessed safe — a sketch never compiles — but the call is Marty's.
5. **Trade care for speed?** P1 systematically reverses decisions somebody made on
   purpose. The wizard guaranteed every node had a role, a brief and a sensible
   name; inline creation guarantees none of that. Recommendation: let the graph
   accumulate rough nodes — the linter and `needsReview` exist for exactly this,
   and an empty graph is worse than an untidy one.
6. **The WO15 P1 checkpoint.** Six blocks have waited since 2026-08-22.
   Recommendation: take keyboard accessibility only — it directly serves P1.5 —
   and defer the rest to P3.

## Sources

Code read 2026-08-24: `src/canvas/`, `src/store/{graph,tasks,sessions}.ts`,
`src/wizard/NodeWizard.tsx`, `src/tasks/`, `src/sessions/`, `src/scene/`,
`src/styles/tokens.css`, `src-tauri/src/sessions.rs`, `package.json`, `dist/`.
Docs read: `docs/design/DESIGN_SPEC.md`,
`docs/design/COMPETITIVE_ANALYSIS_MUNDER_DIFFLIN.md`, `docs/tasks/*`,
`docs/TERMINOLOGY.md`. Tree state from `git status` at `b884dd9`.

Sizes are for the pace WO13 and WO15 actually ran at, not abstract person-weeks.
