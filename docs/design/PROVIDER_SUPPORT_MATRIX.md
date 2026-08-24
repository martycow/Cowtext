# Provider support matrix — the honest contract (P0.1)

Status: **FROZEN 2026-08-21** (WO15, tech-lead). Companion to `WO15_CONTRACT.md`.
Every cell below was read from the code on 2026-08-21; the evidence column names the
line that makes the cell true. When code and this table disagree, the code is the
bug or this table is stale — either way `npm run truth` (WO15 lane D1) is the gate.

## The sentence

Use verbatim, never paraphrased, on every surface listed in §5:

> **Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.**

The TypeScript constant is `PROVIDER_SUPPORT_SENTENCE` in `src/resources/index.ts`
(WO15 Stage 0). UI surfaces import the constant; markdown surfaces carry the literal.
`scripts/truth.mjs --check` fails when either is missing.

## 1. Capability × provider

Column ids are the `CompileTarget` wire values (`src-tauri/src/project.rs:421-429`,
`src/store/graph.ts:199`), not vendor names — `agents` is the `AGENTS.md` target that
Codex CLI (and 30+ other agents) read.

| Capability | `claude` — Claude Code | `agents` — Codex CLI | `cursor` — Cursor | `copilot` — GitHub Copilot | `gemini` — Gemini CLI | Evidence |
|---|---|---|---|---|---|---|
| **Compile target** | ✓ `CLAUDE.md` + `.claude/commands/*.md` (per `command` node) + managed block in `.claude/agents/*.md` | ✓ `AGENTS.md` (root + nested) | ✓ `.cursor/rules/*.mdc` | ✓ `.github/copilot-instructions.md` (**off by default**) | ✓ `GEMINI.md` (**off by default**) | `compile.rs:878-902` (write allowlist), `compile.rs:1105-1140` (commands emitter), `project.rs:431-433` (default = `claude` only) |
| **Import source** (Convert existing) | ✓ `CLAUDE.md` | ✓ `AGENTS.md` root + nested | ✓ `.cursor/rules/*.mdc` | ✗ | ✗ | `import.rs` module doc; `docs/TERMINOLOGY.md:16` |
| **Assemble / Refine / Summarize runtime** | ✓ `claude -p --output-format json`, prompt over stdin | ✗ | ✗ | ✗ | ✗ | `assemble.rs:1`, `assemble.rs:804`, `assemble.rs:895-898` |
| **Handoff generation** | ✓ same `claude -p` runner | ✗ | ✗ | ✗ | ✗ | `handoff.rs` (ClaudeRunner), `docs/TERMINOLOGY.md:22` |
| **Session / Run runtime** | ✓ headless `claude -p` resume loop → `agent://event` | ✗ | ✗ | ✗ | ✗ | `sessions.rs` (`agent://event`, `docs/TERMINOLOGY.md:71` — :69 is `assemble://status`); `App.tsx:526` |
| **Hooks / live events** | ✓ `PostToolUse` / `UserPromptSubmit` / `Stop` / `SubagentStop` → `curl` → `127.0.0.1:4923/event` → `barn://event` | ✗ | ✗ | ✗ | ✗ | `hooks.rs:19-37`, `hooks_server.rs:20` |
| **Agent definitions** | ✓ `.claude/agents/*.md` frontmatter (+ Cowtext-only `skills:` key, ignored by Claude Code) | ✗ | ✗ | ✗ | ✗ | `agents.rs:2`, `src/agents/api.ts:9-12` |
| **Skills** | ✓ `.claude/skills/<id>/SKILL.md` (CRUD + WO15 built-ins) | ✗ in the product. (`.agents/skills/` exists only in **this repo**, as a byte mirror of `.claude/skills/` — see §4) | ✗ | ✗ | ✗ | `agents.rs:2`, `compile.rs:869-870` (compile never writes skills) |
| **Settings path Cowtext writes** | `.claude/settings.json` (hooks; trust boundary, diff-confirmed) | — | — | — | — | `hooks.rs:19` |
| **MCP** | `cowtext-mcp` stdio server (14 tools) — usable by **any** MCP client; registered for Claude Code in `.mcp.json` and for Codex in `.codex/config.toml` — both in this repo only. (This said the exe was **absent**; verified present at `src-tauri/target/release/cowtext-mcp.exe` on 2026-08-24 — it is a local build artefact, so absence depends on whether a release build has been run, and the claim should not be stated as fact) (§4) | same binary | any MCP client | any MCP client | any MCP client | `src-tauri/src/bin/cowtext_mcp.rs`, `.mcp.json:5`, `.codex/config.toml:2` |
| **Toolchain detection** (title screen) | ✓ `claude --version` | ✓ `codex --version` | ✓ `cursor --version` | ✓ `gh copilot --version` (must succeed) | ✓ `gemini --version` | `toolchain.rs:62-108` |
| **Model picker** (WO15 Block 3a) | `model:` written to frontmatter | stored locally only (`local only` badge) | stored locally only | stored locally only | stored locally only | `WO15_CONTRACT.md` §6 U3 |

## 2. Plain-language classification

**Universal (any agent that reads the generated file)**
- Compile: five targets, one graph, diff-preview before every write, GENERATED header on every file.
- Import: `CLAUDE.md`, `AGENTS.md` (root + nested), `.cursor/rules/*.mdc`.
- The MCP server binary (stdio) — any MCP-capable client can register it.
- Toolchain detection: all five CLIs.
- Everything the graph itself is: nodes, edges, tasks, task-context subgraphs, presets, `.cowtext/` sidecars.

**Claude Code only (today)**
- Assemble / Refine / Summarize / Handoff — spawn `claude -p`.
- Run (agent sessions) — spawn `claude -p` with resume.
- Live hooks and therefore the live Barn, the Activity feed from a real session, the canvas live pulse.
- Agent definitions (`.claude/agents/*.md`) and the agent modal's frontmatter keys (`tools`, `disallowedTools`, `permissionMode`, `maxTurns`, `memory`, `color`, `model`).
- Skills (`.claude/skills/<id>/SKILL.md`) and the hooks trust boundary (`.claude/settings.json`).

**Codex-supported (verified)**
- Reading `AGENTS.md` — the compile target. Nothing else. Cowtext does **not** spawn `codex`, does not write `.codex/`, and has no Codex hook contract.

**Not yet supported — must not be promised in UI or docs**
- Assemble/Run/hooks on any non-Claude runtime.
- Agent definitions, skills or settings for Codex, Cursor, Copilot, Gemini.
- Per-provider `model:` emission for non-Anthropic providers (stored locally, badged).
- Importing Copilot instructions or `GEMINI.md`.

**Needs Marty**
- Whether to delete `.codex/hooks.json` and `.codex/agents/*.toml` (§4 — not deleted in WO15).
- Review of the non-Anthropic model ids in `src/resources/models.json` (WO15 D-10).
- Whether a real Codex integration (spawn `codex exec`, a verified hooks contract) is a roadmap item. Until then the sentence above is the product's promise.

## 3. `.codex` + `.mcp.json` disposition (P0.3)

Stage 3 offers five dispositions per item: **(a)** works and is smoke-tested · **(b)** generated or set up by a script · **(c)** development-only · **(d)** temporarily unsupported, must not be promised · **(e)** delete after Marty confirms.

| Item | Content (verified 2026-08-21) | Disposition | Action in WO15 |
|---|---|---|---|
| `.codex/config.toml` | `[mcp_servers.cowtext] command = 'D:\Moo.exe\Cowtext\src-tauri\target\release\cowtext-mcp.exe'`, `--root D:\Moo.exe\Cowtext` | **(c) development-only.** The MCP server is real and MCP is client-agnostic, but the path is an absolute, machine-specific path to a **release** build that is not in the tree (`src-tauri/target/release/` — only debug builds exist after `tauri dev`). | D1 adds a comment header: dev-only, build with `cargo build --release --bin cowtext-mcp` (from `src-tauri/`), `npm run truth` WARNs while the exe is absent. Not deleted, not promised to users. |
| `.mcp.json` | same exe, same args, Claude Code format | **(c) development-only**, same reason | `npm run truth` WARNs when the `command` path does not exist. File unchanged (JSON has no comments). |
| `.codex/hooks.json` | Claude-Code-shaped hooks (`PreToolUse` / `SessionStart` / `SubagentStop` / `Stop`) calling `.claude/scripts/*.ps1` | **(d) unsupported, not promised.** No verified Codex hooks contract exists in this repo; the file is a blind copy of `.claude/settings.json`'s hook block. | Listed here as unsupported. **Not deleted** (e) until Marty confirms. No code references it. |
| `.codex/agents/*.toml` (**5 files against `.claude/agents/`'s 7** — `tech-barn` and `product-analyst` have no Codex counterpart, and nothing regenerates this directory; verified 2026-08-24) | `name` / `description` / `developer_instructions` TOML, text copied from `.claude/agents/*.md` with blind substitutions (`AGENTS.md hard rules`, `AGENTS.md §Status` — these resolve, since `AGENTS.md` does carry both headings, but the substitution is unmanaged) | **(d) unverified Codex agent format, dev-only.** Nothing in the product reads or writes them. | Not deleted until Marty confirms (e). If kept, they are regenerated by a future script — out of WO15 scope. |
| `.agents/skills/*/SKILL.md` (7 dirs) | Mirrors of `.claude/skills/*`; four of seven currently differ, and every difference is a blind-replacement bug (`Codex -p`, `.Codex/agents`, `AGENTS.md/AGENTS.md`, "cow 24×24 (Codex, blue scarf)") — none is an intentional Codex-specific variation | **(b) generated by `scripts/truth.mjs --write`** as byte-identical copies; `--check` fails on drift. Stage 2's "don't force identity if differences are intentional" does not apply: no intentional difference exists. | D1 syncs via the script; docs-guard denies hand edits with a message naming the script. |
| `AGENTS.md` (repo root) | Generated from `CLAUDE.md` — currently a blind copy with `AGENTS.md / AGENTS.md`, `Codex -p`, `.Codex/settings.json`, `.Codex/agents`, stale counts | **(b) generated** — allowlisted differences are exactly line 1 (`# AGENTS.md`) and line 3 (the reader sentence); everything else is byte-identical to `CLAUDE.md` | D1's `truth.mjs --write` produces it; `--check` diffs it; forbidden strings fail the gate. |

## 4. Why byte-identical mirrors are honest

`CLAUDE.md` describes the product truthfully for any reader: it says Assemble uses
`claude -p`, that hooks are written to `.claude/settings.json`, that agents live in
`.claude/agents/`. A Codex reader needs those same facts, not a version where the
tool names were search-and-replaced into things that do not exist. Reader-specific
text is limited to the title line and the "this file provides guidance to…" sentence.

## 5. Surfaces that must carry the sentence (checked by `npm run truth` where marked)

| Surface | File | Lane | Checked |
|---|---|---|---|
| Title screen tagline | `src/project/TitleScreen.tsx` (imports `PROVIDER_SUPPORT_SENTENCE`) | U4a | ✓ T12 |
| Title screen "Convert existing" door copy (CLAUDE.md / AGENTS.md / .cursor/rules, preview first) | `src/project/TitleScreen.tsx` | U4a | manual |
| Project wizard convert step copy | `src/project/ProjectWizard.tsx` (imports the constant) | U2 | ✓ T12 |
| Settings → Agent section | `src/settings/SettingsModal.tsx` (imports the constant) | U4a | ✓ T12 |
| Orchestrator empty state | `src/orchestrator/OrchestratorView.tsx` (imports the constant) | U3 | ✓ T12 |
| Run button tooltip | `src/App.tsx:526` (was cited as :505, which is a layout div — corrected 2026-08-24) — "Run — launches a headless Claude Code session (claude -p)" | U4a | manual |
| Assemble / Refine / Summarize tooltips | `src/inspector/Inspector.tsx` AssembleSection — "… with headless Claude Code (claude -p)" | U1 | manual |
| EventLog empty copy | `src/inspector/EventLog.tsx:267` (was cited as :241, which is the "settings.json unreadable" string — corrected 2026-08-24; :267 already names Claude Code, keep) | U1 | manual |
| README.md | literal sentence + the five compile targets | D1 | ✓ T12 |
| CLAUDE.md (and therefore generated AGENTS.md) | literal sentence in the positioning paragraph | PM | ✓ T12 |
| docs/TERMINOLOGY.md key terms | literal sentence | PM | ✓ T12 |
| `.claude/skills/cowtext-terminology/SKILL.md` (mirrored to `.agents/skills/`) | literal sentence | PM (then `truth:write`) | ✓ T2 |
