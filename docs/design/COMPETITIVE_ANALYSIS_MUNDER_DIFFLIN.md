# Competitive analysis — Munder Difflin

**Repo:** [chaitanyagiri/munder-difflin](https://github.com/chaitanyagiri/munder-difflin) · 3.3k stars · 362 forks · MIT · v0.4.4 ("working prototype") · [munderdiffl.in](https://munderdiffl.in/)

Researched 2026-08-21. Findings below come from the repo README, `MEMORY_GRAPH_SPEC.md`, the repo tree, the landing page, and search context — cross-checked against Cowtext's own current docs (ROADMAP, BACKLOG, DESIGN_SPEC, TERMINOLOGY, `src/scene/`) so the comparison is against what Cowtext has actually shipped, not what's still roadmap.

## What it actually is

Despite the *Office*-themed name, Munder Difflin is a real competitor, not a curiosity. It's an Electron + React + TypeScript + Pixi.js + xterm.js desktop app that wraps ten different terminal coding-agent CLIs (Claude Code, Antigravity/Gemini, OpenAI Codex, xAI Grok, Kimi Code, Qwen, OpenCode, Crush, pi.dev, GitHub Copilot) as real `node-pty` processes, coordinates them through an on-disk "hive" (mailboxes, message routing, a GOD orchestrator agent), gives each agent persistent markdown memory with semantic recall, and visualizes the whole thing as pixel-art avatars on a 2D office floor. That overlaps directly with Cowtext's L2 (orchestrator) and L4 (barn) layers, and its "memory graph" view overlaps conceptually with Cowtext's L1 node graph — worth a real look, not a dismissal.

## Feature-by-feature comparison

| Area | Munder Difflin | Cowtext (shipped today) |
|---|---|---|
| **Core unit of work** | Runs real agent CLI processes as a coordinated team ("clones") | Compiles a typed graph of Memory Nodes into agent context files |
| **Agent orchestration** | PTY-wrapped real processes, GOD-agent routing/escalation, atomic-file mailboxes, circuit breaker (steer→constrain→stop), per-agent token budgets with real cost tracking, human approval gates | Task DAG + kanban, tasklinks sidecar (task↔node↔session), headless `claude -p` sessions in worktrees, per-task subgraph injection + compile-on-launch, global token ceiling (200k default, hard-stop) |
| **Memory/context model** | Per-agent markdown memory files, semantic recall index, git-based append-only event log (single committer), knowledge-graph integration for enterprise docs | Typed Memory Node graph (14 roles, 5 edge kinds, schema v5) — the graph *is* the source of truth that compiles out, not a side log |
| **"Memory graph" visualization** | Read-only, non-editable force-directed SVG view: agent nodes + topic nodes, message-weighted edges, click-to-navigate to a memory file. Explicitly "a data view," never edited from there | Cowtext's graph *is* the primary editing surface (React Flow canvas, hand-editable orthogonal wire routing, CodeMirror 6 inspector) — a fundamentally different relationship between graph and content |
| **Compile / output story** | None — it runs agents, it doesn't generate their config/context files | Compile to CLAUDE.md / AGENTS.md / `.cursor/rules` / Copilot / Gemini targets, always behind mandatory diff-preview approval; `cowtext-cli compile --check` for CI; importer + linter (cycles, duplication, stale, conflicts) |
| **Visualization / scene** | Pixel-art office, avatars recolored from *The Office* cast, envelope animations between desks, "Animal Crossing × Earthbound × SNES menu UI." Bundled art is LimeZu, **non-commercial license only** | Barn scene: real Pixi 8 code (`BarnScene.tsx`, `cow.ts`, named `calf.ts` identities, `agentHerd.ts`, full SFX with ducking/calm-mode). Sprites are still programmatic Pixi Graphics placeholders — no Aseprite art yet (WO05 backlog) |
| **IDE / dev surface** | Built-in Monaco editor with git commit graph, diffs, branch compare | CodeMirror 6 node inspector only — no general multi-file IDE, and none planned |
| **Task board** | Kanban with dependency tracking, scheduled missions, heartbeat monitoring | Kanban with task DAG dependencies, per-task token ceilings and subgraph injection |
| **Extras they have, Cowtext doesn't plan** | Slack/webhook ingestion for ephemeral workers, `munderdifflin://hire` shareable role links, 227+ browsable skill catalog, voice "Talk" orchestration interface, Telegram integration (roadmap) | — |
| **Extras Cowtext has, they don't** | — | Multi-target compile (5 formats) with diff-approval as a trust boundary; graph-native context authoring; importer/linter for existing CLAUDE.md/AGENTS.md files |
| **Business model** | Freemium: free local, paid cloud sandbox (Solo+Cloud), Teams Lite/Pro (10–100+ seats, shared knowledge base), $20 one-time "Founding Supporter" | Not addressed by this research — out of scope |

## What Cowtext is doing that Munder Difflin isn't

It's easy to read a feature list like the one above and conclude Cowtext is behind on orchestration and art. The more important asymmetry is upstream of all of it: Munder Difflin has no compiler. It never produces `CLAUDE.md`/`AGENTS.md`/`.cursor/rules` — it *runs* the agents directly inside its own harness. Cowtext's node graph is the single source of truth that compiles out to whatever agent tooling the user already has (including tools Munder Difflin doesn't wrap, since it only supports terminal CLIs it can spawn a PTY for). That's the moat the 2026-08-19 v2 replan names explicitly: "orchestration is a feature, not the pitch." Munder Difflin's pitch is the orchestration; Cowtext's is the one-source-of-truth compiler underneath it.

## Recommendations

- **Worth a BACKLOG line:** a read-only graph/network view of live agent traffic (who-talked-to-whom, similar to their memory graph) as either an L1 canvas overlay or an L4 observability addition. Cowtext already has the typed node/edge substrate and the live event feed (axum :4923) this would read from — this is a cheap addition on existing infrastructure, not a new system. Not added to BACKLOG.md as part of this task; flagging for a follow-up `project-manager` pass if Marty wants it tracked.
- **Where the pixel-art gap matters:** Munder Difflin shipped a fuller (if legally non-commercial) art set; Cowtext's WO05 "real sprites" backlog item is the direct, already-planned answer — no new decision needed here.
- **Where it doesn't matter:** Cowtext's tokens/aesthetic rules are deliberately more restrained ("blue is you, amber is the cow," modern chrome outside the graph canvas) — this is not a race to match SNES-office visual density everywhere, only within the bounded Barn scene.
- **Positioning:** don't chase orchestration feature-parity (mailboxes, circuit breakers, voice control, Slack ingestion). That's explicitly out of scope per the v2 replan's own framing, and it's Munder Difflin's whole pitch, not a side feature it happens to have. Compete on the compiler.
