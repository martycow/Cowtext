# Backlog

Re-triaged 2026-08-19 around the **v2 four-layer model** (see ROADMAP.md): L1 context graph (the moat), L2 orchestrator, L3 workflows, L4 observability + barn, plus platform bets. Each row carries its target work order in Tags (`wo03`…`wo08`); unassigned rows are unscheduled. Deck steal-list items (Blume/Chorus/Paperclip) are merged in. Schema: Name | Status | Priority | Tags | Agent | Description.

## L1 — Context graph (WO03–WO04)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Edge colour persistence | done | medium | edges, graph, wo03 |  | Absorbed into the WO03 graph v2→v3 bump (`color?` on MemoryEdge) alongside tags/owner/meta and the 3 new edge kinds. Delivered 2026-08-19. |
| Problems list (FEATURES 9.3) | done | high | lint, ui, wo03 |  | Unified Problems payload: cycles, missing files, dangling edges + linter v1 findings (conflict/duplication/stale). WO03 Lane E/F. Delivered 2026-08-19. |
| Orphan & dead-node lint (FEATURES 2.9) | done | medium | lint, wo03 |  | Structural half in WO03 linter v1 (cycles, missing, dangling, conflicts); usage-driven half depends on the WO05 heatmap. Delivered 2026-08-19. |
| Reverse-import (FEATURES 1.6) | done | high | import, moat, wo03, wo04 |  | MVP in WO03 (CLAUDE.md/AGENTS.md/.cursor rules → proposed changeset, never auto-writes); full round-trip incl. copilot/gemini parse-back in WO04. Delivered 2026-08-19. |
| cowtext-cli compile --check | done | high | ci, cli, wo03 |  | Second cargo binary; exit 1 on graph↔output drift; `lint` subcommand; `--json`. GitHub Action wrapper lands WO04. Delivered 2026-08-19. |
| Hierarchy simulator | new | high | compile, wo04 |  | Global `~/.claude/CLAUDE.md` → project → directory nearest-file-wins preview per path. Deck L1; absorbs FEATURES 1.10. |
| Windows-safe symlink manager | new | high | compile, windows, wo04 |  | AGENTS.md master pattern via junction/hardlink/copy fallback ladder; never a broken symlink on NTFS. Deck L1. |
| SKILL.md frontmatter compile target | new | medium | compile, skills, wo04 |  | Sixth target: skill nodes compile to `.claude/skills/*/SKILL.md` frontmatter shape. Deck L1. |
| Resolved-context preview (FEATURES 4.6) | new | high | product, moat, compile, wo04 |  | Show exact bytes agent sees, imports expanded inline, with total token count. |
| Surface token-cost counts during Assemble/Compile | done | high | product, tokens, wo04 |  | Verified shipped 2026-08-24: `src/compile/CompileModal.tsx:137-151` renders a `BudgetBar` with `≈tok` per target against `COMPILE_WARN_TOKENS` (`src/store/tokens.ts:35-36`); the Assemble side is `src/assemble/AssembleConfirmModal.tsx:147`. Pairs with Feature inventory 3.6, also verified shipped. |
| Context loadouts | new | medium | profiles, compile, wo04 |  | Named pinned-set profiles per project (frontend work, release, debugging) with readOrder overrides. |
| Preset starter packs per stack (FEATURES 8.6) | new | medium | presets, wo04 |  | Built-in starter set: Rust, Tauri, Next.js, Python packs. |
| Branch-aware graph | new | high | git, branches, wo04 |  | Watch .git/HEAD per project; reload graph on checkout; warn via GENERATED header hash on branch mismatch. |
| graph.json schema migration discipline | done | medium | data-model, persistence, wo03 |  | Standing rule: any schema change bumps version and adds migration. Exercised by the WO03 v2→v3 bump. Delivered 2026-08-19. |

## L4 — Observability + barn (WO05)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Node usage heatmap (FEATURES 6.9) | new | high | product, moat, feed, wo05 |  | Persist events (JSONL in `.cowtext/events/`), aggregate reads per node, 4th lens driven by read events. Foundation for all proof-layer bets. |
| Reality Check (drift lint) | new | high | drift, lint, git, wo05 |  | Static lint checking every file path, command, script, port cited in a node against the live repo. Red badges on broken claims. Blume-class differentiator. |
| Context audit changeset | new | high | heatmap, prune, tokens, wo05 |  | N sessions of hook data → changeset: unpin never-read, adopt unmapped hot files. Reviewed like a compile diff. |
| Dead-node report | new | high | heatmap, prune, wo05 |  | Never-read-across-N-sessions report with one-click prune. Deck L4. |
| Unmapped-read → one-click adopt (FEATURES 6.7) | new | high | product, feed, wo05 |  | Turn "not on graph" event rows into one-click adopt action; live-feed acquisition loop. |
| Sessions view + timeline (FEATURES 6.10) | new | medium | sessions, feed, wo05 |  | Session history: list, tools used, files touched, duration. |
| Provider quota / token-burn tracker | new | medium | tokens, quota, wo05 |  | Aggregate real session Usage across sessions; surface burn rate. Blume-class. Cross-provider later. |
| cowtext-hook shim | new | medium | hooks, multi-agent, wo05 |  | Tiny Rust bin translating Cursor/Codex/Gemini/OpenCode hook payloads → POST :4923. Cut-line item if WO05 overruns. |
| Event feed hygiene: retention + layered status | new | medium | feed, perf, wo05 |  | Per-row metadata, virtualize if ring cap rises, layered status (badge/panel/alert). |
| Dust and cobwebs | new | medium | staleness, heatmap, barn, wo05 |  | Unread nodes gather dust/cobwebs; desaturate as lastVerified falls behind. First UI reader of lastVerified. Depends: heatmap. |
| Merge sentry | new | medium | git, review-inbox, wo05 |  | After merge, queue affected nodes into review inbox. Clear by re-verifying (bump lastVerified) or editing. Stretch. |
| Replace placeholder sprites with Aseprite originals | new | high | art, assets, barn, wo05 |  | Marty-side asset track (can start anytime); integration lands WO05, per ART_DIRECTION.md. No longer the v0.1.0 gate. |
| Screenshot / GIF export (FEATURES 7.11) | new | high | barn, viral, wo05 |  | One-click GIF/screenshot of a session — the viral loop. Ships with sprites in WO05. |
| The moo is the notification | new | high | audio, ambient, opt-in, wo05 |  | Opt-in: while hidden/minimized, only turn-complete happy moo plays quietly. |
| Resolution cap with measurement gate (V4) | new | high | barn, perf, wo05 |  | Cap Barn renderer at min(devicePixelRatio, 2) only after FPS <50 measured at DPR>2, with A/B screenshots. |
| Background chill 16-bit music | new | medium | audio, assets, barn |  | Looping calm-mode music. Asset (Marty) + sfx.ts channel (tech-barn). Unscheduled. |

## L2 — Orchestrator (WO06)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Per-task subgraph injection + compile-on-launch | done | high | sessions, tasks, moat, wo06 |  | The L2 differentiator: task pulls exactly the subgraph it needs; session starts with a context file compiled for that task alone. Delivered 2026-08-19 (6d81251). |
| Tasklinks sidecar (task↔node↔session) | done | high | tasks, data-model, wo06 |  | `.cowtext/tasklinks.json` v1 `{taskId, nodeIds[], sessionIds[], parentTaskId?}`; task lines get stable `id:t-xxxxxx` tags. Goal ancestry via parentTaskId. Delivered 2026-08-19. |
| Task DAG / dependencies | done | high | tasks, dag, wo06 |  | Dependency modelling + cycle detection in the task format and board; blocked-by visualisation. Chorus-class. Delivered 2026-08-19. |
| Per-task/per-agent token ceilings with atomic hard-stop | done | high | sessions, budgets, wo06 |  | Paperclip-class budgets: spend cap enforced in sessions.rs; session stops dead at the limit. Delivered 2026-08-19 with global default (200,000) + per-task override logic. |
| Session-to-node attribution | new | medium | sessions, heatmap, wo05 |  | Which rules were live for this run: sessionIds × resolveNodeId aggregation on WO05 event data. Explicitly deferred from WO06 to WO05 (needs persisted hook events). |
| Handoff → node | done | medium | handoff, graph, wo06 |  | Session outcome becomes a new Memory Node wired into the graph (provenance recorded). Full implementation delivered 2026-08-19 (Rust + TS wiring + modal UI). |
| Streaming assemble output into the node | new | high | assemble, ux, wo06 |  | Stream token output during Assemble (cuts perceived wait 55–70%); buffer incomplete markdown. |
| 'Run Claude' launcher window | new | medium | assemble, ui, process, wo06 |  | Interactive launcher for `claude -p` flags, folded into session spawn options. |
| Agent-card live session status | new | medium | ui, agents, wo06 |  | Agent card shows spawned/running dot via useSessionsStore (cross-store subscription). |
| Barn mission control | done | medium | multi-agent, sessions, barn, wo06 |  | Concurrent sessions get own stall and full cow; per-session color lanes; chalkboard lists subagents. Delivered 2026-08-19. |

## L3 — Workflows & governance (WO07)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Heartbeat-scheduled agents | new | high | scheduler, sessions, wo07 |  | Paperclip-class: agents wake on schedule, check queue, act; auto-expiry + dangling-checkout cleanup. |
| Event triggers | new | medium | scheduler, hooks, wo07 |  | Trigger workflows on file change, PR opened, CI failure, test regression. Local-only by default. |
| Approval gates + dual-path verification | new | high | workflows, governance, wo07 |  | Plan-before-execute gates; agent self-check plus human sign-off. Chorus-class. |
| Permission grids (resources × actions) | new | high | governance, sessions, wo07 |  | Per-agent scoped permissions; deny-by-default; presets plus custom. Chorus-class. |
| Agent squads | new | medium | multi-agent, wo07 |  | Named roles with scoped permissions running as a group. |
| Auto-promote (Memory Inbox) | new | high | memory, curation, moat, wo07 |  | Ingest Claude Code auto-memory + repeated chat instructions; one-click promote to Memory Node or dismiss; flag contradictions. The sleeper feature: agents run, the graph learns. |
| Transcript mining for context gaps | new | high | sessions, gaps, wo07 |  | Parse transcripts for gaps: agent rereads, unresolved questions. Surface as cards with one-click fixes. |
| Revisioned config with rollback | new | medium | governance, history, wo07 |  | `.cowtext/history/`: graph change revisions, safe rollback. Absorbs FEATURES 4.10 + tamper detection 4.8. |
| Workflow packs | new | medium | packs, sharing, wo07 |  | Export/import chains + squads with secret scrubbing; provenance on every node. |

## Platform & distribution (WO08)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Fleet dashboard | new | high | multi-project, home, wo08 |  | Home screen listing projects as status cards (hook health, drift, last session, token total). Tray badge sums problems. |
| cowtext-mcp | partial | high | mcp, runtime, moat, wo08 |  | **Two thirds shipped in WO12, still filed as `new` until 2026-08-24.** Built: `src-tauri/src/bin/cowtext_mcp.rs` with 14 frozen tools (`:257-398`), spec `docs/design/MCP_SERVER.md`, 16 passing tests. Still open: Memory Nodes as MCP **resources** (the server exposes tools only), and hook-logged fetches. Rewrite the row to those two halves rather than closing it. |
| Skill Studio | new | high | skills, authoring, wo08 |  | Author skills/agents/commands as graph nodes; trigger simulator, one-click export as Claude Code plugin. |
| Context packages | new | medium | teams, sharing, versioning, wo08 |  | Export subgraph as versioned package; imports render locked with approval-gated diffs. |
| Cowtext as a plugin | new | medium | distribution, hooks, wo08 |  | Installable Claude Code plugin: hook config + skill for unmapped reads / node update suggestions. |
| Barn Raising | new | high | progression, retention, barn, wo08 |  | Barn size/furnishing derive from project history: node count→cabinets, sessions→weather, git age→loft. |

## WO17 — Visual environment (opened 2026-08-24)

Filed from `docs/design/WO17_PLAN.md`, which carries the thesis, the diagnosis and
the sequencing rationale. **The plan is grounded in a code audit, not in this
file** — the audit corrected two BACKLOG claims: undo/redo is **built** (the 2.5
row in the Feature inventory is wrong) and motion tokens **exist but are dead**
(`--dur-slow` used zero times).

Diagnosis in one line: *the product systematically traded the fast path for the
careful path* — node creation, edge creation and task launch each lost their
direct route, and a 10-node / 12-edge graph now costs ~22 dialogs.

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| WO17 P0.1 Commit WO15 + WO16 | done | critical | wo17, p0, hygiene |  | Closed by Marty 2026-08-24 as `a8abac7 "V0.1.0"` — 31 files, +2,795 / −934, all WO15 and WO16 work plus a rewrite of `docs/INPUT_PROMPT.md`. |
| WO17 P0.2 Fold the per-WO manuals into one regression list | done | critical | wo17, p0, qa, acceptance |  | **Approved and executed 2026-08-24.** Seven manuals (4,771 lines) → `docs/testing/REGRESSION_MANUAL.md`, 37 steps. Not a copy-paste merge: every candidate step was re-verified against the code, and roughly a third were dropped as stale (WO09's connector geometry superseded by WO10's dynamic pins; WO12's agent-question modal demoted by WO16; a role-filter step naming the v4 `reference` role). `docs/testing/` is now 2 files / 1,074 lines. Gate 2 in ROADMAP §Release gate rewritten to point at the one manual. |
| WO17 P0.3 Cut v0.1.0 | new | critical | wo17, p0, release |  | After gates 1–3 are green. The version is permission to start the next cycle, not a reward for the last one. |
| WO17 P1.1 Inline node creation | new | critical | wo17, p1, canvas, ux |  | Double-click drops a card immediately with the caret in the title field; Enter commits. Wizard moves behind "Advanced…". **`createNode(position)` already exists in the store (`src/store/graph.ts:643`) with zero UI call sites** — the fast path is built and unwired. Largest single contributor to the five-minute metric. |
| WO17 P1.2 Edge without a modal | new | high | wo17, p1, canvas, edges |  | Edge lands with the last-used kind; the kind glyph rides the wire and clicking it changes the kind. `KindPicker` survives for the guard case. Draw-time legality checking (`isValidConnection`) unaffected. |
| WO17 P1.3 Drop connection on empty canvas → node + edge | new | high | wo17, p1, canvas |  | One gesture creates both. `onConnectEnd` (`src/canvas/GraphCanvas.tsx:374-378`) currently only clears state. |
| WO17 P1.4 Copy / paste / duplicate on canvas | new | high | wo17, p1, canvas |  | Absent entirely; `src/store/graph.test.ts:504-505` asserts it. Supersedes Feature inventory 2.6 (partial — multi-select and box-select already ship). |
| WO17 P1.5 Command palette + keyboard shortcuts | new | high | wo17, p1, canvas, a11y |  | Ctrl+K palette (create node of role X, find node, switch map, compile, run task, undo). Plus `N`, `/`, `Ctrl+A`, arrow nudge, digits for view switching — today the only global key handler in the app is undo/redo (`src/App.tsx:795-809`). DESIGN_SPEC already reserves z-index 400 and the keycap style. Absorbs Feature inventory 2.10 and the keyboard half of P1.1 (a11y). |
| WO17 P1.6 Auto-layout + Tidy button | new | high | wo17, p1, canvas, dependency |  | Feature inventory 2.11. **Requires dagre or elk (~40 kB) — a new dependency, so Marty's permission is required** per the CLAUDE.md hard rule. A hand-rolled graph layout costs more than the library. |
| WO17 P1.7 Run button back on the task card | new | critical | wo17, p1, tasks, sessions |  | Its removal (`src/taskctx/TaskContextModal.tsx:93-98`) replaced a direct path with one that **degrades silently**: with no stable task id `AddAgentDialog` prefills nothing and the agent runs context-free behind a small amber line (`:109-116, 183-186`). Fix: button on the card, auto-mint the id on first link, explicit refusal instead of a context-free launch. Also closes the `TaskLinksPanel.tsx:133-143` dead end. |
| WO17 P1.8 Canvas search and filter | new | medium | wo17, p1, canvas |  | `/` to jump to a node; filter by role / rootLoad / orphan. Feature inventory 2.8. At 60 nodes the canvas is unnavigable without it. |
| WO17 P2.1 Maps sidecar `.cowtext/maps.json` | new | high | wo17, p2, maps, data-model |  | `{id, name, kind, nodeIds[], positions{}, sketches[]}`. Node `x/y` in `graph.json` stays the default-map position; a map overrides it, so one node can sit on several maps at different coordinates. **No `graph.json` schema bump and no migration** — delete the sidecar and behaviour is exactly today's. That reversibility is the whole reason for this shape over a v5→v6 bump. |
| WO17 P2.2 Five map kinds on existing roles | new | high | wo17, p2, maps |  | Context (rule/invariant/trap/glossary) · Agents (agent/skill/command) · Architecture (architecture/decision) · Infrastructure (env/tool) · Workflow (workflow/example). The kind sets defaults: roles offered, edges legal, card look. Zero new roles — schema v5's 14 roles already cover all five. |
| WO17 P2.3 Sketch elements (frames, labels, groups) | new | high | wo17, p2, maps, canvas |  | Not files, never compiled, live only in `maps.json`. Resolves the tension with the "a node is a real `.md`" invariant: draw freely, compile only what a file stands behind. Standing rule to state once: **a node is a file; a sketch is never a file.** Absorbs Feature inventory 2.12. Needs Marty's decision — first softening of the invariant in the project's history. |
| WO17 P2.4 Map switcher + "show on map" | new | medium | wo17, p2, maps, inspector |  | Switch maps from the canvas; from any node's Inspector, "this node is on Context, Architecture" with one-click navigation. |
| WO17 P3.1 Drag and drop on the task board | new | high | wo17, p3, tasks |  | Status changes go through a kebab menu today. A stale comment at `src/store/tasks.ts:293` says "on every drag" — there has never been a drag. |
| WO17 P3.2 Agent result → proposed node behind diff preview | new | high | wo17, p3, sessions, graph |  | Half exists (`handoff_node_propose`, delivered WO06). Finish to one button from the agent panel, over the same trust boundary as Compile. |
| WO17 P3.3 Memory Inbox / auto-promote | new | high | wo17, p3, memory, curation |  | Re-homed from WO07. The agent explains the same thing a third time → the app offers to mint a node. Sleeper feature: agents work, the graph learns without the user acting. |
| WO17 P3.4 Streaming assemble output | new | high | wo17, p3, assemble, ux |  | Re-homed from WO06 (row above, never built). Cuts 55–70 % of perceived wait without making anything faster. |
| WO17 P3.5 Resolved-context preview | new | high | wo17, p3, compile, moat |  | Exact bytes the agent will see, imports expanded, token count. Feature inventory 4.6, previously tagged wo04. The one item on the list no competitor has — and what earns the word "compiler". |
| WO17 P4.1 Real sprites (Aseprite) | new | high | wo17, p4, art, barn |  | Everything is procedural Pixi `Graphics` today; the PNGs in `assets/sprites/` are 123-byte stubs that reach no bundle. Marty-side track, parallel to anything. Strategic: Munder Difflin's art is licensed **non-commercial only**, so they cannot monetise their visuals; original art means Cowtext can. Merges with the standing "Replace placeholder sprites" row under WO05. |
| WO17 P4.2 Barn in a separate always-on-top window | new | high | wo17, p4, barn, windows |  | The barn is **already a full-surface tab** (`src/App.tsx:856-860`) — that is not the gap. To be watched instead of a terminal it must live *beside* the editor on a second monitor. Absorbs Feature inventory 7.12. |
| WO17 P4.3 One-click GIF / screenshot export | new | high | wo17, p4, barn, viral |  | Feature inventory 7.11, previously wo05. The viral loop and the one marketing asset competitors cannot copy. |
| WO17 P4.4 Barn legible in three seconds | new | high | wo17, p4, barn, ux |  | A glance tells which of the (max 4) agents is doing what and how far along. The WO15 legend is the start, not the answer. Without this the barn is pretty but uninformative and stops being opened in week two. |
| WO17 P4.5 Ambient life | new | medium | wo17, p4, barn |  | Day/night tint, dust motes, weather from project age. Feature inventory 7.10. Cheap, and it is what makes the scene watchable. |
| WO17 P5.1 Revive the dead motion tokens | new | high | wo17, p5, motion, ui |  | `--dur-instant/fast/base/slow/pulse` and the easing curves already exist (`src/styles/tokens.css:249-257`). `--dur-slow` ("panel collapse") is used **zero** times; `--dur-pulse` likewise. ~97 % of app motion is one 140 ms colour ease on hover ×254. No modal, dropdown or panel enter animation exists anywhere. |
| WO17 P5.2 Five signature moments | new | high | wo17, p5, motion, ui |  | Node appears · Compile fires (diff leaves, file lands) · agent starts · task completes · map switches. Exactly five. A few rehearsed movements make the impression; animation on every control cheapens it. |
| WO17 P5.3 Amend DESIGN_SPEC ban #6 | new | high | wo17, p5, design, decision |  | "Rules of the line" ban #6 explicitly forbids animation tied to routine UI events — and is the likely cause of today's static interface. Proposed amendment: motion is allowed when it **carries information** (state changed, something arrived, something is live), forbidden when decorative. **Blocks all of P5** until Marty rules. |
| WO17 P5.4 No new animation library (standing rule) | new | medium | wo17, p5, deps, motion |  | CSS transitions + Web Animations API. Only two `requestAnimationFrame` calls exist in all of `src/` today, so headroom is enormous. Framer Motion is +50 kB for what thirty lines do, and a direct hit on the lightweight constraint. |

## P1 — proposed, blocked on Marty's checkpoint (opened 2026-08-22)

The six blocks proposed in `docs/INPUT_PROMPT.md` after the P0 round (WO15). **None
may start without Marty's confirmation** — the plan says stop at the P0 checkpoint
and present a report first. The decision itself is tracked as an open task in
`docs/tasks/TASKS.md` ("WO15 P1 checkpoint decision").

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| P1.1 Accessibility pass | new | high | p1, a11y, ui |  | Keyboard-only operation; modal focus trap; 200 % zoom / reflow; Windows High Contrast; reduced motion; accessible names on every control; control target sizes; text size and contrast. Note: the WO15 Appearance section already ships a UI-scale control (chrome + portals, **not** canvas node cards — D-7), so 200 % reflow has a partial answer and a known exclusion to test against. |
| P1.2 Frontend interaction tests | new | high | p1, testing, vitest |  | Behaviour tests for: title screen, Compile modal, Settings, Tasks empty state, Agents empty state, project switching, stale-state prevention. Vitest runs in `node` today, so component rendering needs a DOM environment — **a new testing library requires permission before install** (explicit instruction). |
| P1.3 React state-synchronization audit | new | high | p1, react, state |  | Audit every `exhaustive-deps` suppression; `AddAgentDialog` cwd; project switch; modal open/close state; session selection. The WO15 fix round already made `AddAgentDialog`'s cwd effect mount-only — that is one instance of the class, not the class. |
| P1.4 Bidirectional invoke reachability | new | medium | p1, gates, testing |  | Every frontend `invoke` name is registered **and** every registered Rust command has a consumer or an explicit internal marker, checked automatically by exact name. **Partly landed in WO15**: `scripts/truth.mjs` T3 counts the handler list and T4 proves TS-names ⊂ handler-list with a WARN branch for handlers no TS file calls. What remains: turn that WARN into a FAIL behind an explicit allowlist of internal-only commands. Supersedes the older "Bidirectional invoke-reachability gate" row below. |
| P1.5 Documentation / context compression | new | high | p1, docs |  | Two halves, one now much smaller. **README** is still 9 lines — needs a five-minute quick start, the trust model, what is generated, limitations and troubleshooting, plus the support matrix. **ACTIVITY_LOG**: the 2,292 hook rows were removed 2026-08-24 (see the closed WO15-debt row above), taking the file from 2,486 to 201 lines; what remains is rolling 14 of its 17 sessions into `docs/_archive/`, still blocked on Marty because `docs/_archive/` is write-frozen by docs-guard and the move must be a `git mv`. |
| P1.6 Replace the no-op frontend test | new | medium | p1, testing, hygiene |  | Replace the placeholder test with a real behaviour test, or delete it until the feature it points at exists. A test that asserts nothing is worse than no test — it makes the suite count lie. |

## WO16 research items (opened 2026-08-22)

The three items filed under **For Research** in `docs/INPUT_PROMPT.md`. Scoped and
costed during WO16, deliberately **not** implemented — the work order asked for
research, and each one turns out to have a design fork worth deciding before code.
Feasibility notes are the outcome of that research, not a plan.

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Image node — a picture with a description | new | medium | wo16, nodes, research |  | **Feasible without breaking the core invariant.** A node is a real `.md` file, and an image node is one holding `![alt](path)` plus prose, with images under `context/assets/`. Compile emits the description and the relative path — never base64 (hard rule). Open questions, all worth answering before code: (1) a *series* of images per node vs. one — a series is a body convention, not a schema change, so prefer it; (2) what the canvas card previews (thumbnail vs. count) and what that costs the render budget; (3) token cost, since a described image is prose an agent pays for on every read; (4) whether adopting an existing image file mints a node the way `adoptFile` does for `.md`. New node role ⇒ graph schema bump + migration. |
| External Source node — URLs, folders, files | new | medium | wo16, nodes, research |  | **Split it; the two halves are not the same size.** v1 is pointer-only: a node whose body lists URLs and paths, compiled verbatim, and it costs almost nothing. v2 is *resolution* — fetching a URL, or globbing a folder into a file list — which is a network/trust boundary and needs the same never-write-without-diff-preview discipline Compile has, plus a cache with an explicit staleness story. Note the overlap to settle first: "point at a folder" is close to what the file rail's Adopt already does, and `import.rs` already ingests external context. Decide whether this is a new role or a tagged `tool`/`env` node before drawing anything. |
| Product Version node — pinned, undeletable, format-aware | new | medium | wo16, nodes, versioning, research |  | **The friction is "cannot be deleted", which no node can claim today.** Cleanest shape that keeps every invariant: the version itself lives in `ProjectMeta` (`src-tauri/src/project_meta.rs` — a versioned envelope, so adding a field is a cheap `PROJECT_META_VERSION` bump), and `context/version.md` is a real node carrying a new `pinned` flag that every delete path refuses. That is a `graph.json` v5→v6 bump plus migration, plus guards in the canvas, the rail and Rust — meaningful, not huge. The format wizard (`major.minor.####`) and the bump control are the easy half. Decide first: does "always in hierarchy" mean auto-wired edges to every root, and what happens to the node when a user deletes `context/version.md` on disk behind Cowtext's back. |

## WO15 debts (opened 2026-08-22)

Recorded at close-out; none blocks the release gate. Every row was read in the tree
by project-manager unless the Description says otherwise.

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| ACTIVITY_LOG hook-row bloat: `log-subagent.ps1` appends one row per SubagentStop | done | high | wo15, fleet, docs, hooks |  | Fixed 2026-08-24 in the `/fresh-docs` pass. The count was **2,292 rows against 198 lines of human log** (92 % of the file), not the ~1,900 estimated here. `.claude/scripts/log-subagent.ps1` now writes `.claude/logs/subagent-activity.log`; the historical rows moved there verbatim. `.log` is already gitignored, so the noise left both the docs tree and every diff — and the target is not `.md`, so it does not trip docs-guard's "unrecognised .md under .claude/" rule (a `docs/fleet/subagent-activity.md` target, as this row originally proposed, would have been blocked). `docs/fleet/ACTIVITY_LOG.md`: 2,486 → 201 lines. Git history retains the originals. The separate archive roll-out stays open under P1.5. |
| `npm run lint`: 16 react-refresh warnings | new | medium | wo15, lint, hygiene |  | 0 errors, 16 warnings, all `react-refresh/only-export-components` — files that export both a component and a non-component (constants, helpers). Harmless at runtime; they mask a real new warning by making "warnings exist" the normal state. Fix by moving the non-component exports into sibling modules, then lower the tester's ceiling from 16 to 0. |
| `Inspector.tsx` size | new | medium | wo15, refactor, inspector |  | The Inspector is the largest file in `src/` and gained sections again this round (AssembleSection, Advanced, the node-type popover, the `surface` prop). Splitting it is explicitly **P2**, not now — this row exists so the next work order that touches it budgets for the split instead of adding a tenth section. |
| `Segmented` is duplicated three times → now two | new | low | wo15, ui, duplication |  | **Re-verified 2026-08-24: the count and one of the three paths were stale.** WO16 already extracted the SettingsModal copy into an exported `src/settings/controls.tsx:83` (imported at `src/settings/SettingsModal.tsx:19`), so the cited `SettingsModal.tsx:92` copy no longer exists. Two private copies remain: `src/inspector/Inspector.tsx:1793` and `src/tasks/NewTaskDialog.tsx:45`. A shared component now exists — it just lives in `src/settings/controls.tsx`, not `src/ui/Segmented.tsx`. Next caller should import the existing one or move it to `src/ui/`; do not write a third copy. |
| Wizard result block has no sidecar-independent hooks CTA | new | low | wo15, wizard, hooks |  | The New Project wizard's result block offers the hooks step only through the flow that just ran; a user who skipped it has no direct "install hooks now" action from the result screen. Small, and the HooksModal is one click away from the Event log — filed so it is not rediscovered as a bug. |
| `lastRunAgentFile` is app-global, not per project | new | low | wo15, settings, sessions |  | Claim still true; **all but one line number were stale — re-verified 2026-08-24**: declared at `src/store/settings.ts:188` (not `:141`), written at `:780` (not `:612`), read at `src/sessions/AddAgentDialog.tsx:75` (unchanged). Opening project B pre-selects an agent file from project A. Same class as the compile-targets leak the title-screen round fixed. Fix: move it to the project sidecar, or clear it on project switch. |
| `stackItemById` has no production importer | new | low | wo15, dead-code, resources |  | Claim still true; line number stale — it is now `src/resources/index.ts:182` (not `:135`), re-verified 2026-08-24. Imported only by `src/resources/resources.test.ts:26` (audit N2). Contract-mandated export; either give it a caller or drop it with its test. |
| Document the UI-scale selector's structural assumption | done | low | wo15, styles, docs |  | Verified satisfied 2026-08-24: the requested note already sits next to `--ui-scale` at `src/styles/tokens.css:180-183` — it names the `body > *:not(#root)` match and warns that a future non-portal body child would be scaled silently. The row's other citation was also stale: `src/styles/index.css:97-116` is now a different comment block (viewport units); the selector lives at `:124+`. |
| `COWTEXT_GITIGNORE_LINES` mirror pinned by comment only | new | low | wo15, git, mirrors |  | `src-tauri/src/git.rs:323-324` and `src/git/gitignorePresets.ts:67-69` must stay identical and are kept so by a comment ("kept identical on purpose"), not a test (audit N10). Drift costs a duplicate `.gitignore` line — cheap, but it is exactly the mirror-pair shape that has bitten twice before. Pin it with a test on the next contract that touches either file. |

## Re-homing needed / Carried forward

Fell through dispatch/phase gaps and have no current WO home. Must not be lost.

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Full preservation of unknown enum values | new | medium | data-model, compat, wo04-wo07 |  | WO04 amendment routed this to WO06, but WO06's contract was frozen, so it fell through. Needs re-homing to WO07 or a follow-up. Enums survive round-trip without loss (tolerant read/drop-on-write); governs schema stability across versions. |
| Bidirectional invoke-reachability gate | superseded | medium | testing, gates, wo04-wo07, p1 |  | **Re-homed 2026-08-22 to P1.4 above.** Counting registered commands proves registration, not reachability; diffing invoke names in both directions catches registered-but-uncalled commands. WO03's `default-run` and WO06's `handoff_node_propose` both shipped unreachable; count-based gates cannot see this. Half of it landed in WO15's `scripts/truth.mjs` (T3 counts, T4 proves one direction with a WARN for the other); the remaining half is the FAIL-with-allowlist in P1.4. |
| Auditor has no shell | new | medium | process, gates, wo07+ |  | Tech-lead cannot run gates (Bash disabled), so its gate sections are static inference. Either grant it a shell or stop asking it for gate status. Process/permission decision for Marty. |

## Observations from WO03 audit (2026-08-19) — backlog, no fix round

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| O1: Barn role colour collision | new | low | barn, palette, wo05 |  | **Re-verified 2026-08-24: the named collision is already fixed, the counts are stale.** `src/scene/palette.ts:64-69` gives `invariant: PALETTE.iris` and `trap: PALETTE.orchid` (landed WO06 B1), so rules/invariant/trap no longer share straw. `ROLE_ACCENT` now has 10 entries, not 7, and there are 14 roles, not 13. Residual issue that survives: the four roles still absent from `ROLE_ACCENT` fall back to straw. Revisit `palette.ts` when WO05 opens. |
| O2: Node role barely changes compiled output | new | medium | compiler, moat, wo04 |  | **Re-verified 2026-08-24: no longer "only `agent`".** `src-tauri/src/compile.rs:139-146` (`to_load_role`) maps `Command`→`LoadRole::Command` and `Skill`→`LoadRole::Skill`, which drive the destination lock — so 3 of 14 roles now change output, not 1. The observation's substance still holds for the other 11: they change zero bytes in any of the 5 targets. Honest framing for v0.1.0: the taxonomy organises *your* graph. The moat arrives when role drives output structure (role-grouped sections, role-filtered subgraph). Work: WO04+. |
| O3: Missing `duplicate-id` lint code | new | low | lint, integrity |  | Duplicate node ids silently tolerated by compile/lint. Low reachability but it is one missing graph-integrity check. Three-line fix for linter. |
| O4: `import_apply` accepts any file path inside root | partial | low | import, defense, security |  | **Half closed, verified 2026-08-24.** `src-tauri/src/import.rs:1066-1071` now requires the path to resolve inside root and be an existing file, and `:1053+` refuses compile-output paths (D2). Still missing both guards this row names: no `.md`-extension refusal, and no `is_rename_protected` call anywhere in `import.rs`. |
| O5: Lane G docs obligations (WO03_AUDIT §3, ratified deviations) | done | medium | docs, wo03 |  | Verified satisfied 2026-08-24: `docs/TERMINOLOGY.md:89` (14 roles, v5), `:90` (5 edge kinds, `overrides` = target-before-source), `:91` (effective set excludes `overrides`), `:95` (version 5). One nit left for the next TERMINOLOGY pass: `:91` still uses the term `effective-pinned`, which `src-tauri/src/compile.rs:30` says "is gone". |

## Carried forward from WO03 audit (tech-lead consolidation questions)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Consolidate three cycle validators → there are two | new | medium | lint, compile, refactor |  | **Re-verified 2026-08-24: the count was wrong and one cited site was never a cycle validator.** Two `find_cycle` re-derivations exist — `src-tauri/src/lint.rs:379` and `src-tauri/src/compile.rs:753`. The third, `import.rs::is_compile_output_path`, now delegates to `compile::classify_output` (`src-tauri/src/import.rs:767-769`) and was output classification, not cycle detection. Tech-lead decision on the remaining pair: shared module vs per-module copies. Still no test pinning them together. |
| Unknown enum round-trip preservation | new | low | import, lint, coercion |  | D6 follow-up: unknown role/edge/target values are coerced silently, not preserved. `import.rs`/`lint.rs` need wildcard `#[serde(other)]` arms to round-trip unknown values through changeset and lint cycle. |
| JS byte-order sort fix unpaired | done | low | test, graph.json |  | **Premise is dead.** The row rests on "no frontend test runner exists yet" — Vitest landed in WO13. Verified 2026-08-24: `src/store/graph.test.ts:40-49` pins byte-for-byte fixture parity and `:479-486` pins that a re-serialize is byte-identical. |

## Unscheduled

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Digest Claude Design prototype into docs/design | new | medium | design, docs |  | Extract remaining tokens/idioms from Cowtext Prototype.dc.html so future UI work doesn't drift. |
| RU/EN localization | new | medium | i18n, product |  | Hand-rolled i18n layer: string extraction, locale store, translation file format. |
| Dockable markdown panel / separate editor window | new | low | markdown, editor, windows |  | Second Tauri WebviewWindow with cross-window Zustand sync. Architecture work of its own. |
| Shared popup shell — **the third caller has arrived** | new | high | ui, components |  | **Trigger condition met, verified 2026-08-24.** The row was written as "if a third caller appears"; three parallel copies of the popup idiom now exist: `src/tasks/TagPicker.tsx`, `src/agents/ToolPicker.tsx:21-23` (whose own comment says "parallel implementation rather than a shared one") and `src/tasks/DependsPicker.tsx:2-3`. Extract the shell. This is no longer conditional. |
| Comprehensive sub-agent management UI | done | high | multi-agent, barn, ui |  | Delivered 2026-08-18 (Agents Suite). UI chrome for CRUD, rename, reveal, identity/avatar/influence. |
| Named calves | done | high | multi-agent, identity, barn |  | fnv1a32 identity hash, avatar params (8×8 grid), calf look, cap-4 lifecycle, session-ordinal spawning. |

## Observations (from WO02 audit) — watching items

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Grid-only files lose checkbox on flat-list rows (O1) | done | low | ui, ux |  | Fixed in WO06 §11; verified 2026-08-24 — `src/tasks/TasksBoard.tsx:479-492` renders the checkbox unconditionally and routes it through `toggleAny`, so it no longer gates on `source=checklist`. |
| Missing convention file creates at root (O2) | done | low | tasks, ui |  | Verified fixed 2026-08-24 — `src/tasks/NewTaskDialog.tsx:132-145`: `relPathFor` returns `null` and `submit` raises "No convention slot for …". Nothing is created at the repo root any more. |
| task_move writes status=new on moved items (O3) | done | low | tasks, rust |  | Verified fixed 2026-08-24 — `src-tauri/src/tasks.rs:1961` passes `item.status.as_deref().unwrap_or("new")` instead of a literal, and checklist items carry a real bucket (`:800`). The WO06 fix is recorded at `:1355`. |

## Completed (rolled up)

Former backlog rows delivered during the phased build; detail in TASKS.md history and git.

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Tighten CSP before shipping | done | high | security, tauri |  | Production CSP + relaxed devCSP in v0.0.0007 ship-prep. |
| Add ESLint + `npm run lint` script | done | high | tooling, lint |  | ESLint 10 flat config + lint script, v0.0.0007. |
| Code-split main JS chunk | done | high | frontend, perf |  | 1,334 → 207 kB via React.lazy + manualChunks, v0.0.0007. |
| Verify React 19 vs plan-era integration notes | done | medium | frontend, react |  | Verified: all phases (React Flow 12 + Pixi 8) built and accepted on React 19.1. |
| Phase 3 Assemble prep · Phase 4 hooks pipeline prep | done | high | rust |  | Delivered in 2026-08-16 fleet session (Sprint 3). |
| Remove `greet` placeholder command | done | low | cleanup |  | Verified absent. |
| Mute + calm mode from day one of the Barn | done | high | a11y, sound |  | SettingsModal toggles + calm/mute gates in sfx.ts (Sprint 4). |
| Phase 6 presets & handoff | done | high | presets, handoff |  | preset.rs/handoff.rs + UI (Sprint 4). |
| AGENTS.md positioning note in docs | done | low | docs |  | Added to README.md. |
| Demo-event filtering · Barn HUD on tokens · idle-throttle ticker | done | high | feed, barn, perf |  | Lane C juice pass + LogEvent.demo filtering (Sprint 4). |

## Feature inventory

Merged from `docs/FEATURES.md` 2026-08-18 (original archived in `docs/_archive/superseded/`). Full feature list with phase assignments, derived from `COWTEXT_VIBECODE_PLAN.md` plus proposed additions. **As of 2026-08-18 all seven phases are accepted — every `SPEC` row with Phase ≤ 6 is built. The claim that once followed here — "the live remainder is the unbuilt `NEW` rows" — was checked against the code on 2026-08-24 and is false; see the verification stamp below the legend.** The research-pass ranked table ("Phase 3/4/5 build notes") was not carried over — its open items live in the Open table above; see the archived original for the ranked table and sources.

**Legend**
- `SPEC` — committed in the plan (§ reference given)
- `NEW` — proposed addition, not yet in the plan; needs Marty's yes before it counts as scope
- **Phase** follows plan §9. `P7+` = post-1.0 backlog, deliberately out of the phased build.

Rule from §9 still holds: do not implement a feature before its phase.

#### Verification stamp — 2026-08-24

**The preamble above is wrong, and this stamp is the correction.** It claims "the
live remainder of this inventory is the unbuilt `NEW` rows". A row-by-row check
against the code found **18 `NEW` rows already shipped** and 15 more partly built.
The tables below were left as written — they are the original plan — and this
stamp is the authority on what is actually true. Restamp it rather than editing
rows one at a time; the next check should re-derive, not trust this list either.

**Shipped, despite being filed `NEW`:** 1.5 stable serialization · 1.6
reverse-import · 1.7 `.gitignore` assist · 1.8 onboarding wizard · **2.5
undo/redo** (`src/store/graph.ts:708-713, 787-824`) · 2.9 orphan lint · 3.5
external file-change watch · 3.6 per-node tokens + pinned total · 3.7 rename/move
from inspector · 3.9 role templates · 4.9 conditional tester
(`src/canvas/globMatch.ts`) · 5.4 never blind-overwrite · 5.5 `claude` binary
detection · 6.8 event retention cap · 7.7 barn performance guards · 9.3 problems
list · 9.4 compile adapter tests. Plus **4.13** (`cowtext compile` CLI), a `7+`
row that shipped early in WO03.

**Partial — the row names more than exists:** 1.3 (recents list ships; "reopen
last on launch" does not) · 1.4 (`write_atomic` ships; `.bak` exists only for the
v4→v5 graph migration) · 2.6 (multi-select and box-select ship; duplicate and
align do not) · 2.7 (token, assemble and pin badges ship; raw file size and
last-modified do not) · 3.8 (front-matter half ships; no markdown preview — the
repo has no renderer dependency) · 4.8 (header is enforced but carries **no
hash**, so there is no tamper detection) · 5.6 (cancel ships; re-run-all-stale
does not) · 5.10 (model picker exists for agent files, not for an Assemble run) ·
6.5 (status ships; **no `stale` state and no uninstaller**) · 7.9 (`scenePos`
persists; no drag editor) · 7.10 (footfall dust only) · 8.5 (event log folds in;
no git diff) · 8.6 (export/import ships; the starter set is one generic preset) ·
9.5 (**three of its five named settings do not exist**: no theme, no context-dir,
no port) · 9.6 (Vitest ships; no end-to-end smoke test).

**Confirmed still open, and load-bearing for WO17:** 2.8 canvas search/filter ·
2.10 command palette · 2.11 auto-layout · 4.6 resolved-context preview · 4.7
compile-to-clipboard · 5.7 streaming assemble (`assemble.rs:78` documents the
runner as deliberately non-streaming) · 6.6 port conflict handling
(`hooks_server.rs:26` hard-codes 4923 and `:77-82` gives up on a failed bind) ·
7.8 asset licence manifest · 9.7 accessibility · 9.8 Windows code signing.

### 1. Project & workspace

| # | Feature | Src | Phase |
|---|---|---|---|
| 1.1 | Open project folder → Rust scans `.md` → list in UI | SPEC §9 P0 | 0 |
| 1.2 | `.cowtext/graph.json` per-project source of truth, git-friendly | SPEC §3 | 1 |
| 1.3 | Recent projects list; reopen last on launch | NEW | 1 |
| 1.4 | Atomic writes + `.bak` of any overwritten file; crash-safe graph save | NEW | 1 |
| 1.5 | Stable `graph.json` serialization (sorted keys, LF, fixed float precision) for clean git diffs | NEW | 1 |
| 1.6 | Reverse-import: parse existing `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` → generate a graph | NEW | 2 |
| 1.7 | `.gitignore` assist (commit `.cowtext/` by default; explain the choice) | NEW | 2 |
| 1.8 | Onboarding wizard: pick folder → import or preset → compile | NEW | 6 |
| 1.9 | Adopt `.claude/` siblings as nodes (`agents/*.md`, `skills/*/SKILL.md`, `commands/*.md`), read-only | NEW | 7+ |
| 1.10 | Global scope tab — manage `~/.claude/CLAUDE.md` next to the project one | NEW | 7+ |
| 1.11 | Multi-window / project switcher, shared settings | NEW | 7+ |

### 2. Graph canvas

| # | Feature | Src | Phase |
|---|---|---|---|
| 2.1 | React Flow canvas; create/drag Memory Nodes; minimap | SPEC §9 P1 | 1 |
| 2.2 | Edges with `kind` picker: `imports` / `references` / `conditional` / `sequence` | SPEC §4 | 1 |
| 2.3 | Adopt an existing `.md` file as a node | SPEC §9 P1 | 1 |
| 2.4 | Cycle validation across `imports` + `sequence`; topological `readOrder` | SPEC §4 | 1 |
| 2.5 | Undo/redo for every graph mutation (canvas + inspector) | NEW | 1 |
| 2.6 | Multi-select, box-select, duplicate, align/distribute | NEW | 1 |
| 2.7 | Node badges: file size, token estimate, last modified, assemble status | NEW | 1 |
| 2.8 | Search & filter — `/` jump-to-node; filter by role / pinned / orphan / stale | NEW | 2 |
| 2.9 | Orphan & dead-node lint (unreferenced and unpinned) | NEW | 2 |
| 2.10 | Command palette (Ctrl+K), keyboard-first node creation | NEW | 2 |
| 2.11 | Auto-layout (dagre/elk) + "tidy" button | NEW | 6 |
| 2.12 | Groups / collapsible lanes by role or feature area | NEW | 7+ |

### 3. Inspector & content editing

| # | Feature | Src | Phase |
|---|---|---|---|
| 3.1 | CodeMirror 6 raw markdown editor | SPEC §9 P1 | 1 |
| 3.2 | Visual form: title, role, brief, pinned, readOrder | SPEC §9 P1 | 1 |
| 3.3 | File on disk is content source of truth; inspector edits write through | SPEC §9 P1 | 1 |
| 3.4 | Delete node (graph only — **decided 2026-08-16**: never deletes the file; file deletion is a separate operation, out of scope) | NEW | 1 |
| 3.5 | External-change watch (`notify`) → reload, or conflict banner when dirty | NEW | 2 |
| 3.6 | Per-node token count + live total for the pinned set, with budget warning | NEW | 2 |
| 3.7 | Rename / move file from inspector; updates graph and all references | NEW | 2 |
| 3.8 | Markdown preview toggle; front-matter aware editing | NEW | 2 |
| 3.9 | Role templates (new `rules` node starts from a rules skeleton, etc.) | NEW | 3 |
| 3.10 | Split / merge nodes — extract a section into its own node, rewire edges | NEW | 7+ |

### 4. Compile

| # | Feature | Src | Phase |
|---|---|---|---|
| 4.1 | Adapter: `claude` → `CLAUDE.md` (pinned as `@context/*.md` in readOrder) | SPEC §5 | 2 |
| 4.2 | Adapter: `agents` → `AGENTS.md` (plain links; nested per directory where a glob maps cleanly) | SPEC §5 | 2 |
| 4.3 | Adapter: `cursor` → `.cursor/rules/*.mdc` (`alwaysApply`, `globs` front-matter) | SPEC §5 | 2 |
| 4.4 | GENERATED header on every output file | SPEC §5 | 2 |
| 4.5 | Diff preview modal — never write without approval | SPEC §5 | 2 |
| 4.6 | **Resolved-context preview**: exact bytes the agent sees, imports expanded inline, total tokens | NEW | 2 |
| 4.7 | Dry-run / compile-to-clipboard | NEW | 2 |
| 4.8 | Tamper detection — hash generated body into header; offer to re-import hand edits as a node | NEW | 3 |
| 4.9 | Conditional tester — type a path, see which nodes activate | NEW | 3 |
| 4.10 | Revert to previous generated version from `.cowtext/history/` | NEW | 3 |
| 4.11 | Compile-on-save (opt-in watch mode) | NEW | 6 |
| 4.12 | Pluggable adapters — Copilot, Windsurf, Zed, Gemini, without a release | NEW | 7+ |
| 4.13 | `cowtext compile` CLI for CI | NEW | 7+ |

### 5. Assemble (headless `claude -p`)

| # | Feature | Src | Phase |
|---|---|---|---|
| 5.1 | Brief → full file; child-process queue, max 2 concurrent | SPEC §6 | 3 |
| 5.2 | Per-node Assemble / Refine / Summarize | SPEC §6 | 3 |
| 5.3 | Node progress states; green flash on success | SPEC §6 | 3 |
| 5.4 | Never blind-overwrite — diff generated content against existing file first | NEW | 3 |
| 5.5 | `claude` binary detection at startup; explain clearly when absent, never crash | NEW | 3 |
| 5.6 | Cancel / retry / re-run-all-stale | NEW | 3 |
| 5.7 | Streaming output into the node while it writes | NEW | 3 |
| 5.8 | Batch assemble with per-node opt-out checkboxes | NEW | 3 |
| 5.9 | Editable prompt templates per role in `.cowtext/prompts/` | NEW | 6 |
| 5.10 | Model + effort selector; visible cost/duration readout per run | NEW | 6 |
| 5.11 | Critique pass — "review this node against its neighbours for contradictions" | NEW | 7+ |

### 6. Live monitor & hooks

| # | Feature | Src | Phase |
|---|---|---|---|
| 6.1 | Hook writer into `.claude/settings.json` behind a confirmation diff (trust boundary) | SPEC §7 | 4 |
| 6.2 | axum on `127.0.0.1:4923`, `POST /event` → `BarnEvent` → `app.emit("barn://event")` | SPEC §7 | 4 |
| 6.3 | Event log panel; unknown paths still logged | SPEC §7 | 4 |
| 6.4 | Canvas nodes pulse on read/edit | SPEC §9 P4 | 4 |
| 6.5 | Hook status indicator (installed / stale / missing) + uninstaller | NEW | 4 |
| 6.6 | Port conflict handling — pick a free port, inject it into the hook command; single-instance lock | NEW | 4 |
| 6.7 | Unmapped-read surfacing → one-click "adopt as node" | NEW | 4 |
| 6.8 | Event retention cap so the log can't grow forever | NEW | 4 |
| 6.9 | **Usage heatmap** — reads per node across sessions → unpin/prune suggestions | NEW | 6 |
| 6.10 | Sessions view: list, tools used, files touched, duration | NEW | 6 |
| 6.11 | Session timeline with scrub/replay into canvas or barn | NEW | 7+ |
| 6.12 | Embedded terminal launching `claude` with `--output-format stream-json` (tokens, subagents) | SPEC §7 stretch | 7+ |

### 7. The Barn (PixiJS scene)

| # | Feature | Src | Phase |
|---|---|---|---|
| 7.1 | Isometric 2:1 scene, 16-bit palette, placeholder sprites first | SPEC §8 | 5 |
| 7.2 | Cast: developer, cow agent, cabinets/bookshelves/corkboards per role, calves for subagents | SPEC §8 | 5 |
| 7.3 | Event → animation → SFX map; ≤1.5 s, interruptible, queued | SPEC §8 | 5 |
| 7.4 | Filename bubbles (truncated 24 chars) | SPEC §8 | 5 |
| 7.5 | Camera pan/zoom; Canvas ⇄ Barn toggle | SPEC §9 P5 | 5 |
| 7.6 | Mute + calm mode (no sound, reduced motion) — day one, not later | SPEC §8 | 5 |
| 7.7 | Performance guards: pause when hidden, FPS cap, sprite pooling | NEW | 5 |
| 7.8 | Asset licence manifest so CC0 placeholders swap out cleanly | NEW | 5 |
| 7.9 | Scene layout editor — drag props on the iso grid, persist `scenePos` | NEW | 6 |
| 7.10 | Idle life: day/night tint, dust motes, ambient loop | NEW | 6 |
| 7.11 | Screenshot / GIF export of a session | NEW | 6 |
| 7.12 | Barn mini-mode — small always-on-top second-monitor window | NEW | 7+ |

### 8. Presets & handoff

| # | Feature | Src | Phase |
|---|---|---|---|
| 8.1 | Save graph structure + briefs (no content) as preset | SPEC §9 P6 | 6 |
| 8.2 | New project from preset, stubbing files | SPEC §9 P6 | 6 |
| 8.3 | Handoff button → `claude -p` fills template → `HANDOFF.md` | SPEC §9 P6 | 6 |
| 8.4 | Clipboard variants for Claude Chat / Claude Code / Claude Design | SPEC §9 P6 | 6 |
| 8.5 | Handoff pulls the real session: event log + git diff since last handoff | NEW | 6 |
| 8.6 | Preset export/import as a single `.cowtext-preset.json`; built-in starter set | NEW | 6 |
| 8.7 | Graph export: PNG/SVG of canvas, markdown outline of the whole context | NEW | 7+ |

### 9. Cross-cutting

| # | Feature | Src | Phase |
|---|---|---|---|
| 9.1 | Dark Tailwind shell | SPEC §9 P0 | 0 |
| 9.2 | `graph.json` version bump + migration harness on any schema change | SPEC §11.2 | 1 |
| 9.3 | Problems list — missing files, cycles, failed writes, dead hooks; no silent failures | NEW | 2 |
| 9.4 | Rust unit tests for compile adapters (the code where a bug corrupts a user's `CLAUDE.md`) | NEW | 2 |
| 9.5 | Settings panel: theme, context dir, port, sound, `claude` binary path | NEW | 3 |
| 9.6 | Vitest for the store; one end-to-end smoke test | NEW | 4 |
| 9.7 | Accessibility: full keyboard nav, colourblind-safe role colours, reduced motion honoured | NEW | 5 |
| 9.8 | Tighten CSP (✅ done in v0.0.0007 ship-prep); sign the Windows build (still open) | NEW | 6 |
| 9.9 | Auto-update + local opt-in crash reporting | NEW | 7+ |

### Top ten additions, ranked

If only ten `NEW` items ship, these:

1. **4.6** Resolved-context preview with token counts
2. **3.6** Per-node token budget + pinned total
3. **1.6** Reverse-import an existing `CLAUDE.md` into a graph
4. **6.9** Usage heatmap → prune suggestions
5. **5.4 + 4.8** Never blind-overwrite; tamper detection
6. **2.5** Undo/redo
7. **3.5** External file-change watch
8. **2.8 + 2.7** Search/filter + node badges
9. **6.5 + 6.6** Hook status/uninstall + port conflict handling
10. **9.4** Tests for the compile adapters

Two of these are product, not polish: **4.6** and **6.9**. Nothing else on the market shows
what the agent actually reads versus what you told it to read.

### Phase rollup

| Phase | Adds |
|---|---|
| 0 | 1.1, 9.1 |
| 1 | 1.2–1.5, 2.1–2.7, 3.1–3.4, 9.2 |
| 2 | 1.6, 1.7, 2.8–2.10, 3.5–3.8, 4.1–4.7, 9.3, 9.4 |
| 3 | 3.9, 4.8–4.10, 5.1–5.8, 9.5 |
| 4 | 6.1–6.8, 9.6 |
| 5 | 7.1–7.8, 9.7 |
| 6 | 1.8, 2.11, 4.11, 5.9, 5.10, 6.9, 6.10, 7.9–7.11, 8.1–8.6, 9.8 |
| 7+ | 1.9–1.11, 2.12, 3.10, 4.12, 4.13, 5.11, 6.11, 6.12, 7.12, 8.7, 9.9 |
