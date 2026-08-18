# Cold Start to Productive Context — research & recommendations

Research task: what Cowtext needs so that starting a NEW project with it is the fastest
path to a good agent context — better than hand-writing a `CLAUDE.md`, better than
pasting an awesome-cursorrules template. Each recommendation is tagged with the
`docs/FEATURES.md` item it extends, or `NEW`, plus a proposed phase. Written 2026-08-15.

Verdict up front: the cold-start moat is **structure + briefs + Assemble**, not shipped
content. Every template collection on the market (awesome-cursorrules: 39.5k stars, 879
`.mdc` files) ships generic prose ("you are an expert in React") that costs tokens and
teaches the agent nothing about *this* repo. Cowtext's preset should ship an empty-but-
shaped graph whose briefs interrogate the actual project, and Assemble fills it. That is
a thing no template repo can do.

---

## 1. What current practice says (evidence base)

Condensed from 2025–2026 write-ups; sources at the bottom.

- **Small pinned context wins.** Anthropic's context-engineering guidance: context is a
  finite "attention budget" with diminishing returns; the goal is "the smallest possible
  set of high-signal tokens". Community consensus for `CLAUDE.md`: under ~200 lines,
  roughly ≤5% of the context window at session start; files over ~250 lines get
  skim-read. Cursor guidance: always-apply rules under ~200 words; 5–8 rules total is
  the sweet spot (one always-on base + 3–4 glob-scoped + 1–2 manual).
- **Rules must be specific and carry a "why".** "Write clean code" is dead weight;
  "server components by default, `use client` only when needed — hydration cost" is
  followed. A rule with a reason generalizes.
- **AGENTS.md won the format war.** 60k+ repos, 30+ tools read it natively (Codex,
  Cursor, Copilot, Gemini CLI, Windsurf, Zed, Devin…), now stewarded by the Linux
  Foundation's Agentic AI Foundation (OpenAI + Anthropic + Block founding members,
  Dec 2025). Claude Code consumes it via import. `.cursorrules` (single file) is legacy;
  `.cursor/rules/*.mdc` with `alwaysApply`/`globs`/`description` frontmatter is current.
- **Staleness is the failure mode with no symptom.** A stale rule is followed as
  faithfully as a correct one. Nobody measures this today; audits are manual prompts
  ("agent-docs-audit" skills, context-audit checklists). Real per-rule usage telemetry
  does not exist in any shipping tool — Cowtext's hooks pipeline can build it (this is
  FEATURES.md's own conclusion about 6.9, and the research confirms nothing competes).
- **Greenfield practice is converging on spec-driven development.** GitHub Spec Kit's
  flow (constitution → spec → plan → tasks, each a real `.md` file, dependency-ordered
  tasks) is the dominant 2026 pattern for starting new projects with agents. Its
  artifacts map almost 1:1 onto Cowtext node roles: constitution=rules, spec/plan=
  architecture, tasks=task. Cowtext should not reinvent this; it should be the visual
  editor for it.
- **Progressive disclosure is the load-bearing idea.** Claude Code's own ecosystem
  (skills load on trigger, subagents fork context, commands are explicit) exists to keep
  the always-on window lean. Cowtext's pinned/references/conditional edge kinds are the
  same idea — the compile adapters must exploit it, not flatten it.

---

## 2. Starter preset design — the default graph for a fresh repo

**R1 — Ship one opinionated "Blank project" preset, 6 nodes, compiling to <150 lines /
~2k pinned tokens.** *(extends 8.1/8.2/8.6 built-in starter set — Phase 6; graph shape
should be designed in Phase 2 when compile exists, so the team dogfoods it)*

The default graph:

| Node | Role | Pinned | Budget | Content at t=0 |
|---|---|---|---|---|
| Project charter | rules | yes | ~600 tok | Brief only → Assemble: "non-negotiables: stack, hard constraints, what NOT to do". Spec-kit's "constitution". |
| Architecture | architecture | yes | ~1200 tok | Brief only → Assemble interrogates the repo (dirs, manifests) before writing. Grows over time. |
| Commands | workflow | yes | ~400 tok | Brief → build/test/run commands. Verified, not aspirational. |
| Status | task | yes | ~300 tok | "Phase/last done/next" — the pattern Cowtext's own CLAUDE.md uses. Agent updates it at session end. |
| Conventions | reference | **no** (references edge) | — | Code style, naming. Read on demand. |
| Glossary | glossary | **no** (references edge) | — | Only stubbed if the brief mentions domain jargon; otherwise preset omits it. |

Opinions baked in, each grounded in the evidence above:

- **No persona node in the default.** Personas are the most-copied, least-useful
  template content ("you are a senior engineer…"). Available in the role picker, absent
  from the preset.
- **Four pinned nodes maximum at t=0** — mirrors Cursor's "one always-on + few scoped"
  sweet spot. Everything else enters via `references`/`conditional` edges.
- **Every preset node carries a brief, never boilerplate content.** A stub with generic
  prose is worse than an empty file: it costs tokens and reads as authoritative.
- **A pinned node whose file is still a stub must not compile silently.** Add a
  Problems-list rule: "stub node pinned — assemble it or unpin it". *(extends 2.9
  orphan/dead-node lint and 9.3 problems list — Phase 2)*

**R2 — Preset nodes carry `whyNote` guidance: role templates (3.9) prompt for the
"why" of each rule.** *(extends 3.9 — Phase 3)* The rules-role skeleton should be a
two-column shape — rule + reason — because a rule with a reason generalizes. Cheap to
do in the template text, differentiating in output quality.

**R3 — The Status node is a first-class preset concept: compile emits an "update this
at session end" instruction, and the Phase-4 event feed can verify it happened.**
*(extends 8.1 + 6.10 — graph part Phase 6, verification Phase 7+)* Cowtext already
lives this pattern in its own CLAUDE.md; productize it.

---

## 3. Template / brief libraries per project type

**R4 — Ship 4 built-in presets beyond Blank: webapp, CLI, game, library. They differ in
graph shape and briefs, not in shipped prose.** *(extends 8.6 built-in starter set —
Phase 6)*

What actually varies per type (this is the whole design):

| Preset | Extra nodes vs Blank | Conditional edges | Brief slant |
|---|---|---|---|
| **webapp** | `API surface` (reference), `UI conventions` (reference) | `src/components/** → UI conventions`, `src/api/**` or `server/** → API surface` | Architecture brief asks for route map + data flow; rules brief asks for state-management and styling constraints |
| **CLI** | `Command surface` (reference), `Output & exit codes` (rules, pinned) | — | Rules brief: flags/exit-code/stderr discipline; workflow brief: how to run the binary against fixtures |
| **game** | `Game loop & state` (architecture), `Assets` (reference) | `assets/** → Assets` | Rules brief: perf budget, no allocations in the loop, asset-licence rule (Cowtext's own "sprites are assets not code") |
| **library** | `Public API` (rules, pinned), `Versioning & compat` (rules) | `src/** → Public API` | Rules brief: semver discipline, "breaking change = ask first", docs-per-export |

- **Conditional edges are the per-type payload.** Cursor's glob-scoped rules are the
  proven mechanism for "framework knowledge without token tax"; the presets should
  demonstrate `conditional` edges from day one so users learn the edge kind that keeps
  pinned context small.
- **Assemble prompts per preset** *(extends 5.9 editable prompt templates — Phase 6)*:
  each preset ships its role prompts in `.cowtext/prompts/`, so a webapp architecture
  node assembles differently from a library one. The prompt must instruct `claude -p`
  to read the repo (manifests, dir listing) before writing — assembled content that
  ignores the repo is awesome-cursorrules with extra steps.
- **NEW R5 — Community preset channel: "import preset from URL/gist".** *(NEW —
  Phase 7+)* 8.6 already defines the single-file `.cowtext-preset.json`; adding
  fetch-from-URL (with a review screen — presets contain prompts, i.e. instructions to
  an agent, so treat like the hooks trust boundary) turns the preset format into
  Cowtext's answer to awesome-cursorrules. Do not build a marketplace; a URL is enough.

---

## 4. Reverse-import quality bar (1.6)

Reverse-import is ranked #3 in FEATURES.md's top ten but has no acceptance criteria.
Proposed bar — all four must hold or the feature damages trust in the whole product:

**R6 — Reverse-import acceptance criteria.** *(extends 1.6 — Phase 2, same phase)*

1. **Zero content loss, provably.** Every byte of the source file lands in exactly one
   node file or is explicitly shown in an "unclassified" bucket. Verification is
   mechanical: concatenating node files in readOrder and normalizing whitespace must
   reproduce the source. Anything the classifier can't role-tag goes into a single
   `reference / Unsorted` node — never dropped, never silently merged.
2. **Round-trip is near-idempotent.** Import → compile must produce a file whose diff
   against the original is structural only (GENERATED header, `@context/` import lines
   replacing inlined sections) — the diff preview modal (4.5) shows exactly this diff as
   the import confirmation screen. Import of a Cowtext-compiled file must reconstruct
   the graph exactly (node count, roles, edges, order).
3. **Existing structure is respected, not re-invented.** `@import` lines in a source
   CLAUDE.md become nodes + `imports` edges. `.cursor/rules/*.mdc` frontmatter maps
   mechanically: `alwaysApply: true` → pinned node; `globs:` → `conditional` edge with
   that glob; description-only rules → `references` edge. "When working on X, read Y"
   sections → `references` edges (this is Cowtext's own compile output format, so parse
   what you emit first, heuristics second).
4. **Splitting is heading-based and conservative.** Split on `##` only; a section under
   ~10 lines merges with its neighbor rather than becoming a 40-token orphan node.
   Role classification by heading keyword table (commands/build/test → workflow;
   rules/constraints/never → rules; architecture/structure/layout → architecture;
   status/todo/next → task; everything else → reference). Show classification
   confidence in the import review; one click to re-role before accepting.

**NEW R7 — Import also inventories, read-only, what it will NOT convert:**
`.claude/skills/`, `commands/`, `agents/`, `MEMORY.md`, existing `AGENTS.md` when
CLAUDE.md was the import source. *(NEW — Phase 2 as a listing; adoption itself stays
1.9 / Phase 7+)* The import screen saying "found 3 skills, leaving them alone" is one
list-directory call and prevents the #1 reverse-import trust failure: the user thinking
Cowtext ate their setup.

---

## 5. Token budgeting heuristics

3.6 (per-node count + pinned total) and 4.6 (resolved preview with totals) exist.
What's missing is *what number is good*. Concrete defaults:

**R8 — Budget model: pinned total measured against a configurable context window
(default 200k), with three zones.** *(extends 3.6 + 4.6 — Phase 2)*

- **Green ≤ 2.5%** of window (~5k tokens): matches "≤5% at session start" community
  guidance with headroom for the system prompt and tool schemas.
- **Amber 2.5–5%**: warning badge on the compile preview.
- **Red > 5%** (~10k tokens): the budget bar in the resolved-context preview turns
  red and the compile modal's consequence line says what it costs ("~10.4k tokens
  pinned — loaded every session, every turn"). Never block — inform.

Per-node soft caps by role, used by the stale/"needs splitting" badge and by Assemble's
target length: rules ~600 tok, architecture ~1200, workflow ~400, task ~300, reference
~1500, glossary ~300. (Derived from the ≤60-line Assemble target in plan §6 and the
~200-line total budget; a role whose node blows its cap twice over is the "two badges
means split it" case from the design spec.)

- **Estimator: chars/4 is fine for badges; label it "~".** Don't ship a tokenizer dep
  for Phase 2. When Phase 3 adds `claude -p`, real counts are available opportunistically
  from its JSON output — true-up the estimate then. *(extends 2.7 badges — Phase 2/3)*
- **NEW R9 — Budget is a preset property.** `.cowtext-preset.json` carries its expected
  compiled budget; "New project from preset" (8.2) shows it. Keeps preset authors honest
  and gives users a number to hold the graph to as it grows. *(NEW — Phase 6)*

---

## 6. Measuring whether context helps — usage-driven pruning

6.9 (usage heatmap → prune suggestions) is the right feature; research adds precision
about what to measure. Staleness has no symptom, so the measurements must be passive.

**R10 — Three concrete metrics from the existing hooks pipeline, no new infra.**
*(extends 6.9 + 6.10 — Phase 6)*

1. **Node read-rate**: sessions-in-which-read / total sessions, per node. A *pinned*
   node always enters context, so for pinned nodes measure instead whether its
   *referenced* files get opened — pinned nodes can't be measured by reads; their
   cost is certain and their benefit isn't. Surface as: "pinned, 1.9k tok, no session
   in 30 days touched anything it points at — consider demoting to references".
2. **Context coverage**: % of a session's file-reads that hit graph nodes or files a
   node points to. Low coverage = the graph describes a project the agent isn't
   working on; the unmapped-read list (6.7) is the fix-it queue, ranked by read count.
3. **Demotion ladder, not deletion.** Suggestions move one rung: pinned → references →
   unlinked (node kept, orphan lint owns it). Prune suggestions that delete content
   will be ignored; suggestions that cheapen it get accepted.

- **NEW R11 — `lastVerified` timestamp on nodes.** *(NEW — schema field in Phase 1 while
  the graph.json schema is young — one migration cheaper now than later; UI in Phase 6)*
  Set when a human edits the file or explicitly confirms it. The heatmap view combines
  "old + never involved in any session" into a stale-confidence score. This is the
  anti-symptom for the no-symptom failure mode.
- **NEW R12 — Adherence testing (run prompts against variant contexts, compare
  rule-following) is real practice but manual and expensive. Do not build it.**
  Post-1.0 at most as an Assemble-powered "critique" sibling of 5.11. *(NEW — Phase 7+,
  explicitly deprioritized)*

---

## 7. Interop with the `.claude/` ecosystem

The 2026 reality: a project's agent config is CLAUDE.md **plus** skills, commands,
subagents, hooks, and auto-memory. Cowtext models only the first and risks reading as
obsolete-on-arrival if it pretends the rest don't exist.

- **R13 — "Promote to command/skill" advisory.** *(extends 3.9 + 9.3 — Phase 3)* A
  workflow-role node that is a numbered imperative procedure is, in 2026 practice, a
  slash command or skill — pinned procedures burn budget on sessions that never run
  them. Cheap version: a lint hint on workflow nodes over their token cap ("this reads
  like a procedure — consider `.claude/commands/`"). Full version (Cowtext writes the
  command file) is 1.9-adjacent, Phase 7+.
- **R14 — Compile mode: `AGENTS.md` as body, `CLAUDE.md` as pointer.** *(extends
  4.1/4.2 — Phase 2, small)* Given AGENTS.md's adoption (60k+ repos, foundation-
  stewarded), offer the emerging convention as a target-picker option: full content
  compiled into `AGENTS.md`, `CLAUDE.md` generated as the GENERATED header + one
  `@AGENTS.md` import line. One toggle, big compatibility win for teams mixing Codex/
  Cursor/Claude Code.
- **R15 — Never model auto-memory.** `MEMORY.md` is the agent's own notebook; Cowtext
  importing or compiling it crosses an ownership line and creates write conflicts.
  Show it in the R7 inventory as "agent-owned, not managed". *(NEW — policy, Phase 2
  with reverse-import)*
- **R16 — Hooks coexistence check.** 6.1 writes into `.claude/settings.json`; 2026
  projects already have hooks there (formatters, guards). The confirmation diff must
  be a *merge* diff preserving existing entries, and the uninstaller (6.5) must remove
  only Cowtext's own hook (match by the `:4923` URL). *(extends 6.1 + 6.5 — Phase 4)*

---

## 8. Team sharing

- **R17 — Personal overlay file: `.cowtext/local.json`, gitignored by the 1.7
  assistant.** *(extends 1.7 — Phase 2)* Holds per-user state: canvas viewport,
  collapsed panels, personal pin overrides. Direct analog of Cursor's committed-rules +
  gitignored `personal.mdc` convention. Without this split, graph.json churns with
  cosmetic diffs and teams stop committing it — which kills every sharing feature
  downstream.
- **R18 — graph.json merge story.** *(extends 1.5 — Phase 2 docs, Phase 7+ tooling)*
  1.5's stable serialization makes diffs clean; document the convention (one node per
  array element, sorted by id) so PR reviews of context changes are readable. A
  dedicated merge driver is 7+; don't build it until someone hits a real conflict.
- **R19 — Handoff (8.3–8.5) is also the team onboarding artifact.** *(extends 8.3 —
  Phase 6)* The same compiled brief that hands off to Claude Chat is what a new
  teammate reads on day one. Add a "for humans" clipboard variant (no @-imports,
  links resolved) to 8.4's variant list — near-zero cost, widens the audience of the
  compile output from agents to the whole team.
- **NEW R20 — "Context PR" flow is the realistic team loop: teammate edits a node file
  in their editor (no Cowtext installed), CI runs `cowtext compile --check` (4.13) and
  fails if generated files drift from the graph.** *(extends 4.13 — Phase 7+, but this
  is the argument for why the CLI matters: it makes Cowtext adoptable by teams where
  only one person runs the GUI.)*

---

## 9. Verification pass — two developments that change interop priorities

A second research pass (same date) confirmed §1's evidence base — AGENTS.md at 60k+
repos and foundation-stewarded since Dec 2025 checks out, as does the small-pinned-
context consensus (independent corroboration: Cursor community guidance now says
combined always-apply rules should stay under ~2k tokens — squarely inside R8's green
zone). Two findings are new and material:

**R21 — A SKILL.md adapter beats every per-tool adapter in 4.12's list.** *(extends
4.12 — Phase 7+, but reorder its queue)* **[APPROVED by Marty 2026-08-16 — skills ranked
more important than R23's default-target change; SKILL.md adapter leads the 4.12 queue.]** Anthropic released Agent Skills as an open
standard (Dec 18, 2025; agentskills.io, AAIF-governed); within a quarter it was read
by Cursor, VS Code, Codex CLI, Gemini CLI, Windsurf, Goose and ~40 tools total — the
same `.claude/skills/<name>/SKILL.md` directory, one format. 4.12 imagines Copilot/
Windsurf/Zed adapters; most of those tools now also read AGENTS.md *and* SKILL.md, so
two standard formats cover nearly the whole 2026 matrix. Opinion: build the skills
adapter (workflow-role node + trigger description → SKILL.md with name/description
frontmatter, body = node content), skip bespoke per-tool adapters unless a real user
asks.

**R22 — Promote-to-skill emits the standard; adopt-as-node parses it.** *(extends
R13 + 1.9 — hint stays Phase 3, emit/parse Phase 7+)* R13's "this reads like a
procedure" hint gains a stronger pitch: a promoted skill is portable to every tool the
user's team runs, not a Claude-Code-ism. Symmetrically, 1.9's read-only adoption of
`.claude/` siblings should parse SKILL.md frontmatter so the description shows on the
card like a conditional-edge chip — skills are conditional context by another name,
and the canvas should say so.

**R23 — Upgrade R14 from option to recommended default.** *(extends R14 / 4.1 / 4.2 —
Phase 2)* **[NOT ADOPTED 2026-08-16 — Marty prioritized R21 (skills) instead; CLAUDE.md
stays the primary compile body. Revisit if a real limitation appears.]** Nested AGENTS.md with nearest-file-wins is now honoured by effectively every
modern agent (Cursor reads it natively, no `.mdc` required); 2026 guidance converges on
"start with AGENTS.md, add tool-specific files only when you hit a limitation". So the
target picker should present AGENTS.md-as-body + CLAUDE.md-as-pointer as the
recommended configuration (still a choice, per the trust rules), and 4.2's
nested-per-directory output for clean glob mappings is the ecosystem-proven mechanism
for conditional edges — not a speculative feature. The `cursor` target stays off by
default with a stronger justification: Cursor users are already served by AGENTS.md.

---

## 10. Roll-up

| Rec | Extends / NEW | Phase | One-liner |
|---|---|---|---|
| R1 | 8.1/8.2/8.6 + 2.9/9.3 | 6 (lint: 2) | Blank preset: 6 nodes, 4 pinned, <2k tok, briefs not boilerplate; stub-pinned lint |
| R2 | 3.9 | 3 | Rules skeleton = rule + why |
| R3 | 8.1 + 6.10 | 6 / 7+ | Status node as productized pattern |
| R4 | 8.6 + 5.9 | 6 | 4 typed presets differing in shape/briefs/globs, not prose |
| R5 | NEW | 7+ | Preset import from URL, review-gated |
| R6 | 1.6 | 2 | Reverse-import bar: zero loss, round-trip, respect structure, conservative splits |
| R7 | NEW | 2 | Import inventories `.claude/` siblings read-only |
| R8 | 3.6 + 4.6 | 2 | Budget zones: green ≤2.5%, red >5% of window; per-role caps |
| R9 | NEW | 6 | Presets declare their compiled budget |
| R10 | 6.9 + 6.10 | 6 | Read-rate, coverage %, demotion ladder |
| R11 | NEW | 1 (schema) / 6 (UI) | `lastVerified` node field |
| R12 | NEW | 7+ | Adherence A/B testing: explicitly don't build |
| R13 | 3.9 + 9.3 | 3 | "Promote to command/skill" hint on procedure nodes |
| R14 | 4.1/4.2 | 2 | AGENTS.md-as-body / CLAUDE.md-as-pointer compile mode |
| R15 | NEW | 2 | Never manage MEMORY.md |
| R16 | 6.1 + 6.5 | 4 | Hook write is a merge; uninstall removes only ours |
| R17 | 1.7 | 2 | Gitignored `.cowtext/local.json` personal overlay |
| R18 | 1.5 | 2 / 7+ | Documented merge conventions; no merge driver yet |
| R19 | 8.3/8.4 | 6 | Human-readable handoff variant = onboarding doc |
| R20 | 4.13 | 7+ | `compile --check` in CI enables GUI-less teammates |
| R21 | 4.12 | 7+ | SKILL.md adapter first; skip bespoke per-tool adapters |
| R22 | R13 + 1.9 | 3 (hint) / 7+ | Promote-to-skill emits standard SKILL.md; adoption parses it |
| R23 | 4.1/4.2 (R14) | 2 | AGENTS.md-as-body becomes the recommended default, not just an option |

Phase-1 schema ask (only time-sensitive item): R11's `lastVerified` field — add while
graph.json is at version 1. Everything else lands in its feature's existing phase.

## Sources

- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [CLAUDE.md Best Practices: The Complete 2026 Guide (dev.to)](https://dev.to/nishilbhave/claudemd-best-practices-the-complete-2026-guide-435j)
- [AgentLint — CLAUDE.md Best Practices 2026](https://www.agentlint.app/blog/claude-md-best-practices-2026/)
- [Cursor Docs — Rules](https://cursor.com/docs/rules)
- [Morph — Cursor Rules Best Practices (.mdc guide)](https://www.morphllm.com/cursor-rules-best-practices)
- [Morph — AGENTS.md Spec 2026](https://www.morphllm.com/agents-md-guide)
- [AGENTS.md Complete Guide 2026 (codersera)](https://codersera.com/blog/agents-md-complete-guide-2026/)
- [Agentailor — Top AI Agent Standards 2026 (Agentic AI Foundation)](https://blog.agentailor.com/posts/top-ai-agent-standards-2026)
- [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules)
- [GitHub Spec Kit](https://github.com/github/spec-kit) and [Microsoft — Diving into Spec-Driven Development](https://developer.microsoft.com/blog/spec-driven-development-spec-kit/)
- [FlorianBruniaux — context-audit-prompt](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/tools/context-audit-prompt.md)
- [Devventa — CLAUDE.md mistakes that slow Claude Code down](https://www.devventa.com/ai-coding-assistants/claude-md-best-practices)
- [Auditing context injection from 228KB to 48KB (dev.to)](https://dev.to/bokuwalily/making-a-bloated-claude-code-fast-again-auditing-context-injection-down-from-228kb-to-48kb-1644)
- [Totalum — Claude Code Skills vs Hooks vs Subagents vs MCP](https://www.totalum.app/blog/claude-code-skills-totalum)

Verification pass (§9):

- [Linux Foundation — Formation of the Agentic AI Foundation (MCP, goose, AGENTS.md)](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [OpenAI — co-founding the Agentic AI Foundation](https://openai.com/index/agentic-ai-foundation/)
- [Paperclipped — Agent Skills open standard: SKILL.md adopted by Claude Code, Codex, Cursor + 32 tools](https://www.paperclipped.de/en/blog/agent-skills-open-standard-interoperability/)
- [Skillwright — Cursor Rules: the complete 2026 guide (.cursorrules + .mdc)](https://skillwright.app/blog/cursor-rules-guide)
- [codersera — AGENTS.md vs CLAUDE.md vs Cursor Rules vs Copilot (2026)](https://codersera.com/blog/agents-md-vs-claude-md-vs-cursor-rules-comparison-2026/)
- [Vibe Coding Academy — Cursor Rules .mdc guide & templates (2026)](https://www.vibecodingacademy.ai/blog/cursor-rules-complete-guide)
