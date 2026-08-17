# Backlog

Known work not scheduled into the current sprint. Sources: `CLAUDE.md` hard rules & scaffold constraints, `COWTEXT_VIBECODE_PLAN.md`, build-day verification notes. Pull items into TASKS.md when a sprint picks them up.

Priority scale: P0 blocker · P1 high · P2 medium · P3 low.

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Tighten CSP before shipping | security, tauri, config | `tauri.conf.json` has `csp: null` (scaffold default). Define a real Content-Security-Policy before any distributable build. Flagged in CLAUDE.md scaffold constraints. | P1 | 2026-08-16 | 🔲 Backlog |
| Add ESLint + `npm run lint` script | tooling, dx, lint | The plan's `npm run lint` does not exist; `tsc` is the only frontend check. Add ESLint (config aligned with strict TS, no-`any`) and wire the script. Requires approval — stack additions are gated by the hard rules. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 3 Assemble prep | phase-3, assemble, rust | Delivered in the 2026-08-16 fleet session (see TASKS.md — assemble.rs queue + commands). | P1 | 2026-08-16 | ✅ Done — pulled into Sprint 3 |
| Code-split main JS chunk | frontend, perf, build | Main chunk now 1.25 MB (pixi + reactflow + codemirror in one bundle). Split the Barn scene (dynamic import) at Phase 5; also CodeMirror / compile modal. | P2 | 2026-08-16 | 🔲 Backlog |
| Remove `greet` placeholder command | cleanup, rust, scaffold | `create-tauri-app` demo `greet` command in `lib.rs` is placeholder code per CLAUDE.md — replace/remove rather than build around, if any remnant is still registered. | P3 | 2026-08-16 | 🔲 Backlog |
| Verify React 19 vs plan-era integration notes | frontend, react, risk | Plan §2 assumed React 18; scaffold shipped React 19.1. Check React Flow and (later) PixiJS integration guidance against 19 before Phase 5 work leans on plan-era assumptions. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 4 hooks pipeline prep | phase-4, hooks, rust | Delivered in the 2026-08-16 fleet session (see TASKS.md — hooks.rs, hooks_server.rs, EventLog, node pulse). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 3 |
| Replace placeholder sprites with Aseprite originals | phase-5, art, assets | Phase 5 starts with CC0 packs (Kenney isometric + itch.io farm packs); replace with original 16-bit assets per docs/design/ART_DIRECTION.md. Sprites are assets, not code — never base64 into source. | P3 | 2026-08-16 | 🔲 Backlog |
| Mute + calm mode from day one of the Barn | phase-5, a11y, sound | Delivered in the 2026-08-17 fleet session (see TASKS.md — Mute + Calm mode in SettingsModal, calm/mute gates in sfx.ts, calm-mode reduced motion in the scene). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| Digest Claude Design prototype into docs/design | design, docs | The Claude Design prototype (source of UI truth) has not yet been digested into `docs/design/`. Extract remaining tokens/idioms so future UI work doesn't drift. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 6 presets & handoff | phase-6, presets, handoff | Delivered in the 2026-08-17 fleet session (see TASKS.md — preset.rs/handoff.rs, never-clobber apply, `HANDOFF.md` + Chat/Code/Design clipboard variants). | P3 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| graph.json schema migration discipline | data-model, persistence | Standing rule, tracked so it survives context loss: any schema change to `graph.json` bumps `version` and adds a migration in the v1 harness (`src/store/graph.ts`). | P2 | 2026-08-16 | 🔲 Backlog |

## Pulled from Product Analyst ranking (docs/FEATURES.md, research pass 2026-08-16)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Streaming assemble output into the node | phase-3, assemble, ux, product | 2026 UX bar: stream token output into the node during Assemble (cuts perceived wait 55–70%); buffer incomplete markdown (half-open fences); explicit queued→running→diffing→done states. Current per-node Stop/Cancel + states landed; streaming did not. A spinner-only Assemble reads as broken. | P1 | 2026-08-16 | 🔲 Backlog |
| Surface token-cost counts during Assemble/Compile | product, tokens, compile, assemble | Token-cost display is now table stakes (ai-context-kit lints token cost across CLAUDE.md/AGENTS.md/.cursor/rules). Surface FEATURES 3.6 counts in the Compile modal and Assemble flow. | P1 | 2026-08-16 | 🔲 Backlog |
| Resolved-context preview (FEATURES 4.6) | product, moat, compile | Moat feature per competitor scan — no competitor pairs a visual graph editor with compile + live hooks; 4.6 preview of what an agent actually receives is a differentiator. | P1 | 2026-08-16 | 🔲 Backlog |
| Unmapped-read → one-click adopt (FEATURES 6.7) | phase-4, product, feed | Turn "not on graph" event rows into a one-click adopt action — makes the live feed an acquisition loop no competitor has. | P1 | 2026-08-16 | 🔲 Backlog |
| Node usage heatmap (FEATURES 6.9) | product, moat, feed | Aggregate live-feed events into per-node usage heat — second moat item from the competitor scan. | P2 | 2026-08-16 | 🔲 Backlog |
| Event feed hygiene: retention + layered status | phase-4, feed, perf | Standard feed anatomy: timestamp + icon + description + metadata per row; retention cap / virtualized list (200-ring landed — virtualize if cap rises); layered status (ambient badge → glanceable panel → interrupting alert). | P2 | 2026-08-16 | 🔲 Backlog |
| AGENTS.md positioning note in docs | docs, positioning | AGENTS.md is now the 30+-agent industry standard — add a positioning note to docs (README/marketing), not code. | P3 | 2026-08-16 | 🔲 Backlog |

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

## Deferred UX debt (integration pass 2026-08-16)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Filter demo events out of the live ring buffer | phase-4, feed, ux | Delivered in the 2026-08-17 fleet session (see TASKS.md — `LogEvent.demo` tag, demo-event filtering + DEMO badge; audit also fixed demo-stop stale-event replay and demo accumulation persistence). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| Barn HUD restyle to tokens | phase-5, barn, design | Delivered in the 2026-08-17 fleet session (see TASKS.md — HUD restyled to tokens in the Lane C juice pass). | P3 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| Idle-throttle the BarnScene ticker | phase-5, barn, perf, battery | Delivered in the 2026-08-17 fleet session (see TASKS.md — pause-when-hidden + idle FPS throttle in the Lane C juice pass). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
