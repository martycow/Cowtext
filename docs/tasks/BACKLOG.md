# Backlog

Post-phase work, now that all seven phases (0–6) are accepted (2026-08-18). One item gates the v0.1.0 cut (real sprites); everything else is post-v0.1.0 product work. Pull items into TASKS.md when work picks them up.

Priority scale: P0 blocker · P1 high · P2 medium · P3 low.

## Open

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Replace placeholder sprites with Aseprite originals | phase-5, art, assets, v0.1.0 | The one asset gate for the v0.1.0 cut: replace programmatic placeholder Graphics with original 16-bit assets per docs/design/ART_DIRECTION.md (18-sheet inventory). Sprites are assets, not code — never base64 into source. Marty-side. | P1 (raised from P3 2026-08-18 — blocks v0.1.0) | 2026-08-16 | 🔲 Backlog |
| Streaming assemble output into the node | assemble, ux, product | 2026 UX bar: stream token output into the node during Assemble (cuts perceived wait 55–70%); buffer incomplete markdown (half-open fences). Per-node Stop/Cancel + progress states landed in Phase 3; streaming did not. | P1 | 2026-08-16 | 🔲 Backlog |
| Surface token-cost counts during Assemble/Compile | product, tokens | Token-cost display is table stakes (ai-context-kit lints token cost across CLAUDE.md/AGENTS.md/.cursor/rules). Surface FEATURES 3.6 counts in the Compile modal and Assemble flow. | P1 | 2026-08-16 | 🔲 Backlog |
| Resolved-context preview (FEATURES 4.6) | product, moat, compile | Moat feature per competitor scan — the exact bytes the agent sees, imports expanded, total tokens. No competitor pairs a visual graph editor with compile + live hooks. | P1 | 2026-08-16 | 🔲 Backlog |
| Unmapped-read → one-click adopt (FEATURES 6.7) | product, feed | Turn "not on graph" event rows into a one-click adopt action — makes the live feed an acquisition loop no competitor has. | P1 | 2026-08-16 | 🔲 Backlog |
| Node usage heatmap (FEATURES 6.9) | product, moat, feed | Aggregate live-feed events into per-node usage heat — second moat item; foundation for several moat bets below. | P2 | 2026-08-16 | 🔲 Backlog |
| Event feed hygiene: retention + layered status | feed, perf | Feed anatomy: per-row metadata; virtualize if the 200-event ring cap rises; layered status (ambient badge → glanceable panel → interrupting alert). | P2 | 2026-08-16 | 🔲 Backlog |
| Digest Claude Design prototype into docs/design | design, docs | The Claude Design prototype (source of UI truth) has not been fully digested: `Cowtext Prototype.dc.html` (screen prototype) remains; extract remaining tokens/idioms so future UI work doesn't drift. | P2 | 2026-08-16 | 🔲 Backlog |
| graph.json schema migration discipline | data-model, persistence | Standing rule, tracked so it survives context loss: any schema change to `graph.json` bumps `version` and adds a migration in the v1 harness (`src/store/graph.ts`). | P2 | 2026-08-16 | 🔲 Standing rule |

## Triaged from docs/Brainstorm_Features.md (Product Analyst pass, triaged 2026-08-17)

All 18 brainstorm ideas accepted into backlog; none rejected. Priorities kept from the analyst ranking. Grouped by sequencing, not priority: quick wins can slot into any sprint; moat bets mostly depend on the usage-heatmap foundation (FEATURES 6.9, above); platform bets are post-v0.1.0 scope.

### Quick wins (small, self-contained — candidates for any pre-v0.1.0 sprint)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| The moo is the notification | audio, ambient, opt-in | Opt-in setting: while the app is hidden/minimized, only the turn-complete happy moo (plus optional low moo on tool errors) still plays quietly — the barn becomes the user's Claude-is-done sound. Everything else stays silent when hidden. Builds on the existing sfx.ts hidden gate. | P1 | 2026-08-17 | 🔲 Backlog |
| Named calves | multi-agent, identity, barn | Each subagent name/type hashes to a stable calf appearance (coat patch pattern + tiny prop), identical across sessions, so a six-agent fleet reads as six recurring characters instead of interchangeable sprites. | P1 | 2026-08-17 | 🔲 Backlog |
| Branch-aware graph | git, branches | Watch `.git/HEAD` per project; on checkout reload graph.json from the new branch, show the branch in the title bar, and warn via the GENERATED header hash when the on-disk CLAUDE.md was compiled from a different branch, offering one-click recompile. | P1 | 2026-08-17 | 🔲 Backlog |
| Dust and cobwebs | staleness, heatmap, barn | Nodes unread for many sessions gather visible dust/cobwebs on their barn cabinets and gently desaturate on canvas as lastVerified falls behind churn; heavily-read cabinets stay polished. Purely ambient, no toasts. Depends on: Node usage heatmap (FEATURES 6.9). | P2 | 2026-08-17 | 🔲 Backlog |

### Moat bets (core differentiators — most need hook-data/heatmap foundations first)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Reality Check (drift lint) | drift, lint, git | Static lint checking every file path, command, script and port cited in a node against the live repo, with an optional `claude -p` pass for semantic claims; broken claims get a red drift badge and a Problems entry quoting the exact lie. Runs on project open and after git operations. | P1 | 2026-08-17 | 🔲 Backlog |
| Context audit changeset | heatmap, prune, tokens | Turns N sessions of hook data into one applyable changeset — unpin never-read nodes, adopt unmapped hot files, split partially-read rules — each line quoting its weekly token cost; reviewed and applied like a compile diff, atomically. Superset of: Unmapped-read one-click adopt (FEATURES 6.7); depends on: Node usage heatmap (FEATURES 6.9). | P1 | 2026-08-17 | 🔲 Backlog |
| Memory Inbox | memory, curation | Ingest Claude Code auto-memory (MEMORY.md) as an inbox lane on the canvas; one click promotes a machine-written fact into a real git-synced Memory Node or dismisses it, flagging duplicates/contradictions with existing nodes, and showing which memories exist only on this machine. | P1 | 2026-08-17 | 🔲 Backlog |
| Transcript mining for context gaps | sessions, gaps | Opt-in, local-only parsing of `~/.claude` project transcripts to find context failure signatures (agent grepping for facts an unpinned node contains, re-reading a file 4+ times, asking questions a node answers), each surfaced as a gap card with a one-click fix (pin, edge, new node). | P1 | 2026-08-17 | 🔲 Backlog |
| Context loadouts | profiles, compile | Named pinned-set profiles per project (frontend work, release, debugging) with readOrder overrides; switching recompiles, the header records the active loadout, and hook sessions are tagged with it so the usage heatmap can compare per-loadout. | P2 | 2026-08-17 | 🔲 Backlog |
| Merge sentry | git, review-inbox | After a pull/merge/rebase, diff incoming commits against a path-to-node index and queue affected nodes into a review inbox ("this merge touched 14 files under src/auth — auth-rules.md may be stale"); items clear by re-verifying (bumps lastVerified) or editing. | P2 | 2026-08-17 | 🔲 Backlog |

### Platform & distribution bets (bigger scope — post-v0.1.0)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| cowtext check (CI drift gate) | ci, cli, teams | Verify-only CLI plus a published GitHub Action that fails a PR when generated CLAUDE.md/AGENTS.md/.cursor/rules no longer match graph.json, were hand-edited (header hash), or contain drift-lint breakage, posting a graph-level diff as the PR comment. Makes the graph canonical by policy. | P1 | 2026-08-17 | 🔲 Backlog |
| Fleet dashboard | multi-project, home | Home screen listing every known project as a status card (hook health, drift-lint count, last session time, pinned-token total, unreviewed unmapped reads); tray badge sums problems across the fleet. Optional farmstead skin renders each project as a small barn. | P1 | 2026-08-17 | 🔲 Backlog |
| Barn Raising | progression, retention, barn | Barn size and furnishing derive deterministically from real project history — node count adds cabinets, total sessions weather the wood, git age adds a loft — so a year-old project opens to a big lived-in barn. No XP, no unlocks, no notifications. Builds on the Phase 5 session-accumulation layer. | P1 | 2026-08-17 | 🔲 Backlog |
| cowtext-mcp | mcp, runtime, moat | Bundled MCP server exposing Memory Nodes as resources/tools so any agent (Claude Code, Cursor, Codex) pulls nodes on demand at runtime instead of eating the whole pinned set; role and conditional-glob metadata become retrieval hints, and hooks log which nodes were fetched. | P1 | 2026-08-17 | 🔲 Backlog |
| Skill Studio | skills, authoring | Author skills, agents and commands as graph nodes, with a trigger simulator (type a hypothetical prompt, see which skills would load and their token cost) plus one-click export as an installable Claude Code plugin bundle. | P1 | 2026-08-17 | 🔲 Backlog |
| Barn mission control | multi-agent, sessions, barn | Concurrent Claude Code sessions each get their own stall and full cow (peer, not calf) with per-session color lanes in the event log and tinted canvas pulses; a chalkboard lists active subagents with task brief and working/done/stalled ticks. | P2 | 2026-08-17 | 🔲 Backlog |
| Context packages | teams, sharing, versioning | Export a subgraph (org TS standards, security rules) as a versioned package other projects import by git URL; imports render as a locked group with approval-gated update diffs, and local edits fork the node with a diverged-from-upstream marker. | P2 | 2026-08-17 | 🔲 Backlog |
| Cowtext as a plugin | distribution, hooks | Package the hook configuration plus a small graph-respecting skill (report unmapped reads, suggest node updates) as an installable Claude Code plugin, so a teammate without the desktop app wires the hooks feed with one install and the app detects/adopts it — replacing hand-edited settings.json onboarding. | P2 | 2026-08-17 | 🔲 Backlog |

## Completed (rolled up)

Former backlog rows delivered during the phased build; detail in TASKS.md history and git.

| Name | Tags | Resolution |
|---|---|---|
| Tighten CSP before shipping | security, tauri | ✅ Production `csp` + relaxed `devCsp` in the v0.0.0007 ship-prep (`cb770d4`) |
| Add ESLint + `npm run lint` script | tooling, lint | ✅ ESLint 10 flat config + lint script, v0.0.0007 |
| Code-split main JS chunk | frontend, perf | ✅ 1,334 → 207 kB via React.lazy + manualChunks, v0.0.0007 |
| Verify React 19 vs plan-era integration notes | frontend, react | ✅ Implicitly verified — all six phases (React Flow 12 + Pixi 8) built and accepted on React 19.1 |
| Phase 3 Assemble prep · Phase 4 hooks pipeline prep | rust | ✅ Delivered in the 2026-08-16 fleet session (Sprint 3) |
| Remove `greet` placeholder command | cleanup | ✅ Verified absent |
| Mute + calm mode from day one of the Barn | a11y, sound | ✅ Sprint 4 — SettingsModal toggles + calm/mute gates in sfx.ts |
| Phase 6 presets & handoff | presets, handoff | ✅ Sprint 4 — preset.rs/handoff.rs + UI |
| AGENTS.md positioning note in docs | docs | ✅ Added to README.md |
| Demo-event filtering · Barn HUD on tokens · idle-throttle ticker (UX debt ×3) | feed, barn, perf | ✅ Sprint 4 — Lane C juice pass + `LogEvent.demo` filtering |

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
