# Backlog

Post-phase work, now that all seven phases (0–6) are accepted (2026-08-18). One item gates the v0.1.0 cut (real sprites); everything else is post-v0.1.0 product work.

## Open

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Replace placeholder sprites with Aseprite originals | new | critical | phase-5, art, assets, v0.1.0 |  | One asset gate for v0.1.0: replace programmatic Graphics with 16-bit originals per ART_DIRECTION.md. Marty-side. |
| Streaming assemble output into the node | new | high | assemble, ux, product |  | Stream token output during Assemble (cuts perceived wait 55–70%); buffer incomplete markdown. |
| Surface token-cost counts during Assemble/Compile | new | high | product, tokens |  | Token-cost display in Compile modal and Assemble flow per ai-context-kit linting baseline. |
| Resolved-context preview (FEATURES 4.6) | new | high | product, moat, compile |  | Show exact bytes agent sees, imports expanded inline, with total token count. |
| Unmapped-read → one-click adopt (FEATURES 6.7) | new | high | product, feed |  | Turn "not on graph" event rows into one-click adopt action; live-feed acquisition loop. |
| Node usage heatmap (FEATURES 6.9) | new | high | product, moat, feed |  | Aggregate live-feed events into per-node usage heat; foundation for moat bets. |
| Event feed hygiene: retention + layered status | new | medium | feed, perf |  | Feed anatomy: per-row metadata, virtualize if ring cap rises, layered status (badge/panel/alert). |
| Digest Claude Design prototype into docs/design | new | medium | design, docs |  | Extract remaining tokens/idioms from Cowtext Prototype.dc.html so future UI work doesn't drift. |
| RU/EN localization | new | medium | i18n, product |  | Hand-rolled i18n layer: string extraction, locale store, translation file format. |
| Background chill 16-bit music | new | medium | audio, assets, barn |  | Looping calm-mode music for barn. Asset work (Marty) for track; code half (sfx.ts channel) is tech-barn's zone. |
| 'Run Claude' launcher window | new | medium | assemble, ui, process |  | Interactive launcher for `claude -p` flags, replacing hardcoded spawn. Needs own contract. |
| Edge colour persistence | new | medium | edges, graph, ui |  | Persist color field on MemoryEdge in graph.json. Requires v1→v2 schema bump + migration + preset upgrade. |
| Dockable markdown panel / separate editor window | new | low | markdown, editor, windows |  | Second Tauri WebviewWindow with cross-window Zustand sync. Architecture work of its own. |
| graph.json schema migration discipline | new | medium | data-model, persistence |  | Standing rule: any schema change bumps version and adds migration in v1 harness. |
| Comprehensive sub-agent management UI | done | high | multi-agent, barn, ui |  | Delivered 2026-08-18 (Agents Suite). UI chrome for CRUD, rename, reveal, identity/avatar/influence. |
| Resolution cap with measurement gate (V4) | new | high | barn, perf |  | Cap Barn renderer at Math.min(devicePixelRatio, 2) only after FPS <50 on default scene at DPR>2, with A/B screenshots. |
| Shared popup shell if third TagPicker caller appears (V3) | new | high | ui, components |  | Extract popup shell if third caller needs input-bearing popup (V3 follow-up). |
| Agent-card live session status | new | medium | ui, agents |  | Agent card shows spawned/running dot via useSessionsStore (backlog, cross-store subscription). |

## Triaged from docs/Brainstorm_Features.md (Product Analyst pass, triaged 2026-08-17)

All 18 brainstorm ideas accepted into backlog; none rejected. Priorities from analyst ranking.

### Quick wins

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| The moo is the notification | new | high | audio, ambient, opt-in |  | Opt-in: while hidden/minimized, only turn-complete happy moo plays quietly. Barn becomes Claude-is-done sound. |
| Named calves | done | high | multi-agent, identity, barn |  | fnv1a32 identity hash, avatar params (8×8 grid), calf look, cap-4 lifecycle, session-ordinal spawning. |
| Branch-aware graph | new | high | git, branches |  | Watch .git/HEAD per project; reload graph on checkout; warn via GENERATED header hash on branch mismatch. |
| Dust and cobwebs | new | medium | staleness, heatmap, barn |  | Unread nodes gather dust/cobwebs; desaturate on canvas as lastVerified falls behind. Depends: heatmap. |

### Moat bets

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Reality Check (drift lint) | new | high | drift, lint, git |  | Static lint checking every file path, command, script, port cited in node against live repo. Red badges on broken claims. |
| Context audit changeset | new | high | heatmap, prune, tokens |  | N sessions of hook data → changeset: unpin never-read, adopt unmapped hot files. Reviewed like compile diff. |
| Memory Inbox | new | high | memory, curation |  | Ingest Claude Code auto-memory; one-click promote to Memory Node or dismiss. Flag contradictions with existing nodes. |
| Transcript mining for context gaps | new | high | sessions, gaps |  | Parse transcripts for gaps: agent rereads, unresolved questions. Surface as cards with one-click fixes. |
| Context loadouts | new | medium | profiles, compile |  | Named pinned-set profiles per project (frontend work, release, debugging) with readOrder overrides. |
| Merge sentry | new | medium | git, review-inbox |  | After merge, queue affected nodes into review inbox. Clear by re-verifying (bump lastVerified) or editing. |

### Platform & distribution

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| cowtext check (CI drift gate) | new | high | ci, cli, teams |  | Verify-only CLI + GitHub Action: fails PR when CLAUDE.md/AGENTS.md don't match graph.json or have drift-lint breakage. |
| Fleet dashboard | new | high | multi-project, home |  | Home screen listing projects as status cards (hook health, drift, last session, token total). Tray badge sums problems. |
| Barn Raising | new | high | progression, retention, barn |  | Barn size/furnishing derive from project history: node count→cabinets, sessions→weather, git age→loft. |
| cowtext-mcp | new | high | mcp, runtime, moat |  | Bundled MCP server exposing Memory Nodes as resources/tools for runtime demand-loading. Hooks log fetches. |
| Skill Studio | new | high | skills, authoring |  | Author skills/agents/commands as graph nodes; trigger simulator, one-click export as Claude Code plugin. |
| Barn mission control | new | medium | multi-agent, sessions, barn |  | Concurrent sessions get own stall and full cow; per-session color lanes; chalkboard lists subagents. |
| Context packages | new | medium | teams, sharing, versioning |  | Export subgraph as versioned package; imports render locked with approval-gated diffs. |
| Cowtext as a plugin | new | medium | distribution, hooks |  | Installable Claude Code plugin: hook config + skill for unmapped reads / node update suggestions. |

## Observations (from WO02 audit) — watching items

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Grid-only files lose checkbox on flat-list rows (O1) | new | low | ui, ux |  | FlatListPanel has no checkbox for BACKLOG/ROADMAP/BUGS items (gated on source=checklist). Complete only from Inspector. |
| Missing convention file creates at root (O2) | new | low | tasks, ui |  | NewTaskDialog.relPathFor creates missing file at root, not under docs/tasks/. Pre-existing for all files. |
| task_move writes status=new on moved items (O3) | new | low | tasks, rust |  | Done rows moved to BACKLOG arrive as New. Pre-existing; now explicit in spec. |

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

Merged from `docs/FEATURES.md` 2026-08-18 (original archived in `docs/_archive/superseded/`). Full feature list with phase assignments, derived from `COWTEXT_VIBECODE_PLAN.md` plus proposed additions. **As of 2026-08-18 all seven phases are accepted — every `SPEC` row with Phase ≤ 6 is built; the live remainder of this inventory is the unbuilt `NEW` rows and the `7+` column.** The research-pass ranked table ("Phase 3/4/5 build notes") was not carried over — its open items live in the Open table above; see the archived original for the ranked table and sources.

**Legend**
- `SPEC` — committed in the plan (§ reference given)
- `NEW` — proposed addition, not yet in the plan; needs Marty's yes before it counts as scope
- **Phase** follows plan §9. `P7+` = post-1.0 backlog, deliberately out of the phased build.

Rule from §9 still holds: do not implement a feature before its phase.

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
