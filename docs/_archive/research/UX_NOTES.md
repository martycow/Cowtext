# Cowtext — UX Review & Improvement Proposals

Agent UX Designer review, 2026-08-15. Inputs: `CLAUDE.md`, `docs/FEATURES.md`,
`docs/design/DESIGN_SPEC.md`, `docs/DESIGN_PROMPT.md`, `COWTEXT_VIBECODE_PLAN.md`,
Phase 0 code (`src/App.tsx`, `src/store/project.ts`). Feature numbers refer to
`docs/FEATURES.md`; `NEW` = not in the backlog yet.

---

## 1. Journey maps

### J1 — First launch → first compiled `CLAUDE.md`

| Step | What happens today (per plan) | Friction / risk | Missing affordance | Keyboard |
|---|---|---|---|---|
| Launch | Empty state → "Open folder" | Fine. No recent list until 1.3 (P1) | — | `Ctrl+O` |
| Folder opens | Flat file list (P0), later empty canvas (P1) | **The cliff.** 23 `.md` files exist but the canvas is empty; no bridge from "your files" to "your nodes" | Bulk-adopt checklist ("found 23 files — adopt as nodes?"); 2.3 is one-at-a-time only | Multi-select + `Enter` |
| Repo already has `CLAUDE.md` | Nothing until 1.6 (P2) | The single most common real first-launch. A blank canvas next to a working hand-written `CLAUDE.md` reads as "this tool doesn't understand my project" | Detect existing `CLAUDE.md`/`AGENTS.md` and make **reverse-import the primary empty-canvas action** | — |
| Create/wire nodes | Drag edges; kind picker (2.2) | Four kinds with *compile-time* semantics that line styles alone can't teach. What kind does a dragged edge default to? | Kind picker **at drop point** with one-line compile consequence per kind ("imports → inlined", "references → 'see X when relevant'"); keys `1–4` | `1–4` on drop |
| Pin / order | `pinned` + `readOrder` in inspector | **Silent-empty-compile trap**: only pinned nodes compile. A first-timer wires 6 nodes, pins none, compiles, gets a near-empty file, concludes the tool is broken | Canvas-level "what compiles" visibility (see §3.1) + pre-compile guard: "0 pinned nodes — output will be empty" as a Problem (9.3) | — |
| Compile | Target picker → diff modal (4.5) | Good trust moment — but replacing a *hand-written* `CLAUDE.md` looks identical to replacing a generated one | Diff modal must escalate visually when the target lacks the GENERATED header, and offer "import it as a node first" (bridges to 4.8) | `Enter` = Approve only when diff focused |

### J2 — Daily driver: live session while coding elsewhere

| Step | Reality | Friction / risk | Missing affordance | Keyboard |
|---|---|---|---|---|
| Install hooks | Confirmation diff (6.1) | JSON diff alone doesn't build trust with non-hook-literate users | Plain-language line above the diff: what fires, where it posts, and that `\|\| true` means Claude never blocks if Cowtext is closed. Uninstall equally prominent (6.5) | — |
| Session runs | Events → pulses + feed | **Cowtext is not the focused window.** The user is in a terminal/editor. A full-window Canvas ⇄ Barn toggle assumes attention Cowtext doesn't have | Always-on-top mini-mode (7.12) is the real daily form factor — see §3.6 | Global toggle hotkey |
| Pipeline dies silently | Port taken / server down / hooks stale → **everything looks normal, zero events** | Worst failure mode in the app: indistinguishable from "agent didn't read anything" | Heartbeat in the hook status pill: "listening :4923 · last event 34s ago"; stale > N min during an active session → amber | — |
| Unknown path read | Logged (6.3) | Fine | One-click adopt (6.7) is exactly right — keep it inline in the row | `A` on row |
| Session ends | `stop` event | User in other window may miss it | Optional OS notification on Stop + session summary row | — |

### J3 — Stale graph after weeks away

| Step | Reality | Friction / risk | Missing affordance | Keyboard |
|---|---|---|---|---|
| Reopen project | Canvas renders as it was | **No re-entry surface.** Files changed on disk, some deleted, `CLAUDE.md` maybe hand-edited — none of it is surfaced; the graph lies by omission | "Since you were away" banner: N files changed, M missing, CLAUDE.md drifted, K nodes unread in recent sessions. One banner, links into Problems (9.3) | — |
| Judge staleness | `stale` badge (2.7) | Stale relative to *what* is undefined anywhere in the docs | Define it: file mtime > last-compile timestamp ⇒ needs `lastCompiled` persisted per project (and per-node hash for 4.8). Without this the badge is vibes | — |
| Prune | Nothing until 6.9 (P6) | Graphs only grow; unread pinned nodes silently tax every session's context budget | Usage heatmap (6.9) + "unpin candidates" — agree with FEATURES ranking it top-5; token budget (3.6) is its partner | — |
| Recompile | Diff modal | Good — diff after weeks away is genuinely informative | Show token-count delta in the modal header, not just line diff | — |

### J4 — Project #2 from preset

| Step | Reality | Friction / risk | Missing affordance | Keyboard |
|---|---|---|---|---|
| New from preset (8.2) | Stubs files | Stub nodes will render with "never read"/empty-file badges — a fresh project that **looks broken** on first paint | A distinct `stub` visual state that reads as *todo* (brief present, content absent), not as error. Feeds Assemble batch (5.8) directly | — |
| Stub collision | Preset writes `context/*.md` | Project #2 may already have files at those paths | Per-file conflict choice during stubbing: keep existing / overwrite / rename — inside one modal, not N dialogs | — |
| Assemble all | 5.8 checkboxes | Fine | "Assemble all stubs" as the single obvious CTA after preset creation — this is the moment the product feels magic; don't bury it | `Ctrl+Shift+A` |

---

## 2. Phase 0 code observations (small, current)

- `rescan()` sets `scanning: true`, and `App.tsx` renders `<Scanning/>` **instead of** the
  file list — a manual rescan blanks the whole view for a flash. Rescan should be inline
  (spin the icon, keep the list); full-screen march is for first scan only.
- `error: String(e)` surfaces raw Rust/Tauri error text in the banner. Acceptable at P0;
  by P1 errors need a mapped, human message + the raw string demoted to a tooltip/log.
- Fast scans will flash the pixel march for ~1 frame. Either show it only after ~150ms
  or give it a minimum display time; a flash of "the cow is reading" reads as jank.
- Nice: `direction: rtl` path truncation already matches DESIGN_SPEC node anatomy.

---

## 3. Topic deep-dives

### 3.1 Information scent at 30+ nodes

Fixed 244×97 cards are readable at 1:1 and mush at 40% zoom. Three moves:

1. **Semantic zoom** (NEW): below a zoom threshold, swap the card body for role-stripe +
   glyph + title chip; hide paths, badges, and conditional-edge chips. React Flow gives
   zoom in the store; this is a render branch, not an engine change.
2. **Pinned lens** (NEW, the important one): a one-key overlay (`P`) that dims unpinned
   nodes and non-`imports` edges — the canvas shows *what actually compiles*. This
   single view kills the J1 empty-compile trap, doubles as the pruning view in J3, and
   makes `pinned` learnable by sight instead of by reading §5 of the plan.
3. Minimap tinted by role; `/` search (2.8) jumps-and-centres with a brief highlight ring.

Edge dash patterns are indistinguishable at low zoom — acceptable *because* edges are
neutral by rule; but the conditional midpoint chip must participate in semantic zoom or
30 nodes × chips becomes confetti.

### 3.2 Inspector vs modal editing

Keep the inspector; don't add an editor modal. The whole point of Cowtext is that editing
happens *next to* the graph (and, in P4+, next to live pulses) — a modal severs that.
Instead: (a) inspector is **user-resizable** with a double-width toggle for real writing
sessions; (b) an "Open in external editor" action on every node (file is source of truth
anyway — be honest about it; costs one Rust command via opener); (c) external-change
watch (3.5) is what makes (b) safe. A modal editor is only defensible for the resolved-
context preview (4.6), which is read-only.

### 3.3 Error / empty / loading states

| State | Verdict |
|---|---|
| Empty canvas, files exist | **Most important empty state in the app.** Primary action must be adopt/import, not "create node" — see J1 |
| Empty canvas, `CLAUDE.md` exists | Reverse-import CTA (1.6) front and centre |
| Hook pipeline up, no events | Needs explicit "listening, no events yet — start a Claude session" copy; silence must be a designed state, not an absence |
| Port conflict (6.6) | Must be loud at install time *and* at every launch; today's plan handles pick-a-port but not the "server died mid-session" heartbeat |
| `claude` binary missing (5.5) | Disable Assemble affordances with a tooltip *explaining how to fix*, don't hide them |
| Compile with 0 pinned | Problems entry + inline warning in target picker |
| Loading | Pixel march is charming; keep it determinate where possible per spec, and never for < 150ms |

### 3.4 Edge-kind discoverability

Line style + marker (DESIGN_SPEC) identifies kinds for people who already know them; it
teaches nothing. Fixes: kind picker at edge-drop with compile-consequence microcopy and
`1–4` keys (see J1); canvas legend chip (P1 chrome, already planned) whose tooltip repeats
the consequence line; and the resolved-context preview (4.6) as the ultimate teacher —
select an edge, see what it *did* to the output. Default kind on plain drag: `imports` —
it matches the naive mental model ("this feeds my context") and its effect is the most
visible in compile preview, so a wrong default gets caught; but the at-drop picker should
make the default rarely stick silently.

### 3.5 Trust moments

Ranked by how much damage a bad experience does:

1. **Overwriting a hand-written `CLAUDE.md`** (first compile). Diff modal needs a
   distinct escalated state when the target has no GENERATED header: amber framing,
   consequence text ("this file was not generated by Cowtext"), and an "import as node
   first" escape hatch. `.bak` (1.4) is the net under the net.
2. **Writing into `.claude/settings.json`** (6.1). Diff + plain-language explanation +
   visible uninstall. Never bundle hook install into onboarding "next-next-next".
3. **Assemble overwriting files** (5.4). Same diff discipline as compile.
4. **Tamper detection** (4.8): when it fires, the offered path must be recovery
   ("re-import your edits as a node"), never just "your changes will be lost".

### 3.6 Canvas ⇄ Barn relationship

The barn has two jobs with different form factors: **demo/delight** (full-view toggle,
phase 5, correct) and **ambient companion** (the actual daily-driver use — J2). For job
two, the right shape is a small always-on-top window: barn scene + hook status + last
event line, no chrome. That's 7.12, currently parked at P7+ — argued below as wrong.
Barn is a *display*, never a workspace: no editing affordances migrate into it; the event
feed is one shared component docked in either view. The segmented control (spec'd) is
right for in-window switching; add a hotkey.

### 3.7 Onboarding order

The wizard (1.8, P6) is fine as a *product*; it is wrong as the *only* onboarding. By P2
the app can compile, which means by P2 a stranger can be hurt or lost. Minimum guidance
must ship with the phase that creates the need: bulk-adopt with P1, reverse-import CTA
and empty-compile guard with P2, binary-missing explanation with P3, heartbeat with P4.
The P6 wizard then becomes a thin shell over affordances that already exist.

---

## 4. Top 10 UX changes, ranked

| # | Change | Tag | Impact | Effort | Phase |
|---|---|---|---|---|---|
| 1 | **Pinned lens** — one-key "what compiles" canvas overlay | NEW (ties 2.8, 9.3) | High — kills the empty-compile trap, teaches `pinned`, doubles as prune view | Low | 1–2 |
| 2 | **Edge-kind picker at drop** with compile-consequence microcopy, keys `1–4` | extends 2.2 | High — makes the core data model learnable in-flow | Low | 1 |
| 3 | **Bulk adopt + reverse-import as the empty-canvas primary actions** | extends 2.3, 1.6 | High — decides whether launch #1 converts | Med | 1–2 |
| 4 | **Hook heartbeat** — status pill shows "last event Xs ago"; amber on silence during active session | extends 6.5/6.6 | High — the silent-pipeline failure is the app's worst | Low | 4 |
| 5 | **Escalated diff state for non-generated targets** + "import as node first" | extends 4.5, bridges 4.8 | High — the #1 trust moment | Low | 2 |
| 6 | **"Since you were away" re-entry banner** (changed/missing/drifted/unread) | NEW (ties 3.5, 9.3, 6.9) | High — J3 currently has no surface at all | Med | 2–3 |
| 7 | **Barn mini-mode promoted from P7+ to P6** (small always-on-top window) | 7.12 | High — matches the real daily form factor | Med | 6 |
| 8 | **Semantic zoom** node/edge rendering below a zoom threshold | NEW | Med — 30+ node legibility | Med | 1 |
| 9 | **Resizable inspector + "Open in external editor"**; no editor modal | extends 3.1/3.3 | Med — honest pressure valve; cheap | Low | 1 |
| 10 | **Define staleness**: persist `lastCompiled` (+ per-node hash), badge means mtime > lastCompiled | supports 2.7/4.8 | Med — turns a vibes-badge into information | Low | 1–2 |

(1, 2, 5, 9 are near-free relative to their phase's existing work; 3 and 6 are the two
that need real design time.)

---

## 5. Explicit disagreements with current decisions

1. **Onboarding wizard held to Phase 6** (1.8). By Phase 2 the app can overwrite a user's
   hand-written `CLAUDE.md`; guidance has to ship with capability, not four phases later.
   Keep the wizard at P6, but move the guidance-shaped affordances (rows 2, 3, 5 above)
   into P1–P2 — otherwise every pre-P6 user learns the data model by being burned.

2. **Barn mini-mode parked at P7+** (7.12). J2 shows the daily user never has Cowtext
   focused, so the barn-as-full-view-toggle is a demo posture, not a usage posture; the
   Phase 5 acceptance test ("a stranger watches 30 seconds and smiles") literally
   optimizes for the demo. Mini-mode is the version Marty himself will run all day —
   it belongs in P6 at the latest, and the P5 HUD should be designed as if it will be
   shrunk to 380px wide, so nothing has to be redesigned.

3. **Phase 1 scope includes multi-select/align/distribute** (2.6). Align/distribute is
   polish that auto-layout (2.11) largely obsoletes, and P1 is already the heaviest
   phase in the plan (canvas + inspector + persistence + undo). Cut align/distribute
   from P1, keep multi-select + duplicate; spend the recovered evening on rows 2 and 9.

4. **"Adopt existing .md as node" designed as a single-node action** (2.3). The plan's
   P1 acceptance ("build a 6-node graph") hides that real projects open with 20–40
   candidate files; one-at-a-time adoption makes launch #1 feel like data entry. Bulk
   adopt is the same Rust surface and one checklist UI — it should be the P1 shape,
   with single-adopt as its degenerate case.

5. **Conditional-edge chip pinned at midpoint unconditionally** (DESIGN_SPEC edges).
   Correct at 1:1 zoom, confetti at 30+ nodes zoomed out. The chip should participate
   in semantic zoom (hide below threshold, reappear on hover/selection) — the spec
   currently reads as always-on.

6. **`stale` badge specced before staleness is defined** (2.7 / DESIGN_SPEC badges).
   No document says what stale is relative to; without a persisted `lastCompiled` (and
   later the 4.8 hash) the badge cannot be truthful. Define the semantics in the P1
   `graph.json` schema work, since adding it later is a version bump + migration (9.2)
   that could be avoided.
