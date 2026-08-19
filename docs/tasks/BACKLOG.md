# Backlog

Re-triaged 2026-08-19 around the **v2 four-layer model** (see ROADMAP.md): L1 context graph (the moat), L2 orchestrator, L3 workflows, L4 observability + barn, plus platform bets. Each row carries its target work order in Tags (`wo03`…`wo08`); unassigned rows are unscheduled. Deck steal-list items (Blume/Chorus/Paperclip) are merged in. Schema: Name | Status | Priority | Tags | Agent | Description.

## L1 — Context graph (WO03–WO04)

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Edge colour persistence | new | medium | edges, graph, wo03 |  | Absorbed into the WO03 graph v2→v3 bump (`color?` on MemoryEdge) alongside tags/owner/meta and the 3 new edge kinds. |
| Problems list (FEATURES 9.3) | new | high | lint, ui, wo03 |  | Unified Problems payload: cycles, missing files, dangling edges + linter v1 findings (conflict/duplication/stale). WO03 Lane E/F. |
| Orphan & dead-node lint (FEATURES 2.9) | new | medium | lint, wo03 |  | Structural half in WO03 linter v1; usage-driven half depends on the WO05 heatmap. |
| Reverse-import (FEATURES 1.6) | new | high | import, moat, wo03, wo04 |  | MVP in WO03 (CLAUDE.md/AGENTS.md/.cursor rules → proposed changeset, never auto-writes); full round-trip incl. copilot/gemini parse-back in WO04. |
| cowtext-cli compile --check | new | high | ci, cli, wo03 |  | Second cargo binary; exit 1 on graph↔output drift; `lint` subcommand; `--json`. GitHub Action wrapper lands WO04. |
| Hierarchy simulator | new | high | compile, wo04 |  | Global `~/.claude/CLAUDE.md` → project → directory nearest-file-wins preview per path. Deck L1; absorbs FEATURES 1.10. |
| Windows-safe symlink manager | new | high | compile, windows, wo04 |  | AGENTS.md master pattern via junction/hardlink/copy fallback ladder; never a broken symlink on NTFS. Deck L1. |
| SKILL.md frontmatter compile target | new | medium | compile, skills, wo04 |  | Sixth target: skill nodes compile to `.claude/skills/*/SKILL.md` frontmatter shape. Deck L1. |
| Resolved-context preview (FEATURES 4.6) | new | high | product, moat, compile, wo04 |  | Show exact bytes agent sees, imports expanded inline, with total token count. |
| Surface token-cost counts during Assemble/Compile | new | high | product, tokens, wo04 |  | Token-cost display in Compile modal and Assemble flow (pairs with FEATURES 3.6). |
| Context loadouts | new | medium | profiles, compile, wo04 |  | Named pinned-set profiles per project (frontend work, release, debugging) with readOrder overrides. |
| Preset starter packs per stack (FEATURES 8.6) | new | medium | presets, wo04 |  | Built-in starter set: Rust, Tauri, Next.js, Python packs. |
| Branch-aware graph | new | high | git, branches, wo04 |  | Watch .git/HEAD per project; reload graph on checkout; warn via GENERATED header hash on branch mismatch. |
| graph.json schema migration discipline | new | medium | data-model, persistence, wo03 |  | Standing rule: any schema change bumps version and adds migration. Exercised by the WO03 v2→v3 bump. |

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
| Per-task subgraph injection + compile-on-launch | new | high | sessions, tasks, moat, wo06 |  | The L2 differentiator: task pulls exactly the subgraph it needs; session starts with a context file compiled for that task alone. |
| Tasklinks sidecar (task↔node↔session) | new | high | tasks, data-model, wo06 |  | `.cowtext/tasklinks.json` v1 `{taskId, nodeIds[], sessionIds[], parentTaskId?}`; task lines get stable `id:t-xxxxxx` tags. Goal ancestry via parentTaskId. |
| Task DAG / dependencies | new | high | tasks, dag, wo06 |  | Dependency modelling + cycle detection in the task format and board; blocked-by visualisation. Chorus-class. |
| Per-task/per-agent token ceilings with atomic hard-stop | new | high | sessions, budgets, wo06 |  | Paperclip-class budgets: spend cap enforced in sessions.rs; session stops dead at the limit. |
| Session-to-node attribution | new | medium | sessions, heatmap, wo06 |  | Which rules were live for this run: sessionIds × resolveNodeId aggregation on WO05 event data. |
| Handoff → node | new | medium | handoff, graph, wo06 |  | Session outcome becomes a new Memory Node wired into the graph (provenance recorded). |
| Streaming assemble output into the node | new | high | assemble, ux, wo06 |  | Stream token output during Assemble (cuts perceived wait 55–70%); buffer incomplete markdown. |
| 'Run Claude' launcher window | new | medium | assemble, ui, process, wo06 |  | Interactive launcher for `claude -p` flags, folded into session spawn options. |
| Agent-card live session status | new | medium | ui, agents, wo06 |  | Agent card shows spawned/running dot via useSessionsStore (cross-store subscription). |
| Barn mission control | new | medium | multi-agent, sessions, barn, wo06 |  | Concurrent sessions get own stall and full cow; per-session color lanes; chalkboard lists subagents. |

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
| cowtext-mcp | new | high | mcp, runtime, moat, wo08 |  | Bundled MCP server exposing Memory Nodes as resources/tools for runtime demand-loading. Hooks log fetches. |
| Skill Studio | new | high | skills, authoring, wo08 |  | Author skills/agents/commands as graph nodes; trigger simulator, one-click export as Claude Code plugin. |
| Context packages | new | medium | teams, sharing, versioning, wo08 |  | Export subgraph as versioned package; imports render locked with approval-gated diffs. |
| Cowtext as a plugin | new | medium | distribution, hooks, wo08 |  | Installable Claude Code plugin: hook config + skill for unmapped reads / node update suggestions. |
| Barn Raising | new | high | progression, retention, barn, wo08 |  | Barn size/furnishing derive from project history: node count→cabinets, sessions→weather, git age→loft. |

## Unscheduled

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| Digest Claude Design prototype into docs/design | new | medium | design, docs |  | Extract remaining tokens/idioms from Cowtext Prototype.dc.html so future UI work doesn't drift. |
| RU/EN localization | new | medium | i18n, product |  | Hand-rolled i18n layer: string extraction, locale store, translation file format. |
| Dockable markdown panel / separate editor window | new | low | markdown, editor, windows |  | Second Tauri WebviewWindow with cross-window Zustand sync. Architecture work of its own. |
| Shared popup shell if third TagPicker caller appears (V3) | new | high | ui, components |  | Extract popup shell if third caller needs input-bearing popup (V3 follow-up). |
| Comprehensive sub-agent management UI | done | high | multi-agent, barn, ui |  | Delivered 2026-08-18 (Agents Suite). UI chrome for CRUD, rename, reveal, identity/avatar/influence. |
| Named calves | done | high | multi-agent, identity, barn |  | fnv1a32 identity hash, avatar params (8×8 grid), calf look, cap-4 lifecycle, session-ordinal spawning. |

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
