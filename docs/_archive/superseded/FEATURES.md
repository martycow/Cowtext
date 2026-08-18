# Cowtext — Feature Backlog

Full feature list with phase assignments. Derived from `COWTEXT_VIBECODE_PLAN.md`
(kept outside the repo) plus proposed additions.

**Legend**
- `SPEC` — committed in the plan (§ reference given)
- `NEW` — proposed addition, not yet in the plan; needs Marty's yes before it counts as scope
- **Phase** follows plan §9. `P7+` = post-1.0 backlog, deliberately out of the phased build.

Rule from §9 still holds: do not implement a feature before its phase.

---

## 1. Project & workspace

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

## 2. Graph canvas

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

## 3. Inspector & content editing

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

## 4. Compile

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

## 5. Assemble (headless `claude -p`)

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

## 6. Live monitor & hooks

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

## 7. The Barn (PixiJS scene)

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

## 8. Presets & handoff

| # | Feature | Src | Phase |
|---|---|---|---|
| 8.1 | Save graph structure + briefs (no content) as preset | SPEC §9 P6 | 6 |
| 8.2 | New project from preset, stubbing files | SPEC §9 P6 | 6 |
| 8.3 | Handoff button → `claude -p` fills template → `HANDOFF.md` | SPEC §9 P6 | 6 |
| 8.4 | Clipboard variants for Claude Chat / Claude Code / Claude Design | SPEC §9 P6 | 6 |
| 8.5 | Handoff pulls the real session: event log + git diff since last handoff | NEW | 6 |
| 8.6 | Preset export/import as a single `.cowtext-preset.json`; built-in starter set | NEW | 6 |
| 8.7 | Graph export: PNG/SVG of canvas, markdown outline of the whole context | NEW | 7+ |

## 9. Cross-cutting

| # | Feature | Src | Phase |
|---|---|---|---|
| 9.1 | Dark Tailwind shell | SPEC §9 P0 | 0 |
| 9.2 | `graph.json` version bump + migration harness on any schema change | SPEC §11.2 | 1 |
| 9.3 | Problems list — missing files, cycles, failed writes, dead hooks; no silent failures | NEW | 2 |
| 9.4 | Rust unit tests for compile adapters (the code where a bug corrupts a user's `CLAUDE.md`) | NEW | 2 |
| 9.5 | Settings panel: theme, context dir, port, sound, `claude` binary path | NEW | 3 |
| 9.6 | Vitest for the store; one end-to-end smoke test | NEW | 4 |
| 9.7 | Accessibility: full keyboard nav, colourblind-safe role colours, reduced motion honoured | NEW | 5 |
| 9.8 | Tighten CSP (currently `null` in `tauri.conf.json`); sign the Windows build | NEW | 6 |
| 9.9 | Auto-update + local opt-in crash reporting | NEW | 7+ |

---

## Top ten additions, ranked

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

## Phase 3/4/5 build notes, ranked (research pass 2026-08-16)

Competitor + UX research digest, scoped to what is being built now (Assemble, hooks feed, Barn).
Importance: **P1** = build it in-phase or the phase underdelivers; **P2** = strong add if cheap;
**P3** = note for later, do not build now. Competitive read: nothing on the market pairs a
*visual* graph editor with compile + live hooks — closest adjacents are CLI linters
(ai-context-kit: lint/token-cost across CLAUDE.md/AGENTS.md/.cursor/rules) and backend memory
graphs (Zep/Graphiti, Mem0, Neo4j agent-memory) with no desktop authoring UI. Our moat is 4.6
(resolved-context preview) and 6.9 (usage heatmap); protect them.

| Rank | Feature | Imp | Rationale (one line) |
|---|---|---|---|
| 1 | 5.7 Streaming output into node while Assemble writes | P1 | Token streaming cuts perceived wait 55–70%; a spinner-only Assemble will feel broken next to every 2026 AI tool. |
| 2 | 5.6 Cancel (Stop Generation) per node + retry | P1 | Universal expectation for AI generation; also saves API cost by killing the `claude -p` child early. |
| 3 | 5.3 + explicit progress states (queued → running → diffing → done/failed) | P1 | Multi-layer status (ambient badge / glanceable panel / interrupt / summary) is the established agent-monitoring pattern. |
| 4 | 5.4 Diff before overwrite on Assemble | P1 | Same trust boundary as Compile; blind overwrite is the one failure users never forgive. |
| 5 | 6.3 Event log with timestamp + event-type icon + per-event metadata | P1 | Standard live-feed anatomy (AGUI / mission-control feeds); makes the black box transparent and doubles as Barn debug. |
| 6 | 5.5 `claude` binary detection with a clear empty-state | P1 | First-run failure mode; competitors die here and it reads as "app is broken". |
| 7 | 6.8 Event retention cap | P1 | Every live-feed pattern caps or virtualizes; an unbounded log will hang the webview mid-session. |
| 8 | 3.6 Token counts surfaced during Assemble/Compile | P2 | ai-context-kit made token cost the headline metric; table stakes for a context tool, cheap to show. |
| 9 | 6.7 Unmapped-read → one-click adopt | P2 | Turns the passive feed into an acquisition loop no competitor has; small UI on top of 6.3. |
| 10 | Buffered markdown render while streaming (part of 5.7) | P2 | Half-open fences/bold must not break layout; defer code blocks until the closing fence. |
| 11 | 7.6 Mute + calm mode shipped with the first Barn build | P2 | Reduced-motion/ambient-status is an accessibility norm; retrofitting sound/motion opt-out is always worse. |
| 12 | Aggregate feed header (session totals: events, files touched, duration) | P3 | Common in agent dashboards (tokens/cost headers); nice glanceable layer, fits 6.10 later. |
| 13 | AGENTS.md-first messaging in docs/UI copy | P3 | AGENTS.md is now the 30+-agent industry standard; positioning note, not code. |

Sources: [ai-context-kit](https://github.com/ofershap/ai-context-kit) ·
[AGENTS.md spec 2026](https://www.morphllm.com/agents-md-guide) ·
[Streaming UX pattern](https://www.aiuxplayground.com/pattern/streaming/) ·
[Agent status monitoring patterns](https://www.aiuxdesign.guide/patterns/agent-status-monitoring) ·
[Agent activity patterns](https://agentic-design.ai/patterns/ui-ux-patterns/agent-status-activity-patterns) ·
[AGUI control layer](https://www.mindstudio.ai/blog/what-is-agui-human-control-layer-ai-agents) ·
[Graphiti/Zep](https://github.com/getzep/graphiti) ·
[Mem0 graph memory](https://mem0.ai/blog/graph-memory-solutions-ai-agents)

## Phase rollup

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
