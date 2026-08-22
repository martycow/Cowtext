# INPUT PROMPT FOR COWTEXT

Here lives a dynamic prompt for using inside Claude Code.
Consider everything below as a new prompt every time. It may or may not change. You can't tell before you read.
Don't make changes here. Just read it and follow the rules.

=== Everything below considered as a prompt ===

# TASKS_UI_ROUND2.md — UI/UX fixes after first dogfooding pass

## Execution rules (read first)

- Work **one block at a time**. After each block: run `pnpm typecheck && pnpm test`, summarize what changed (files + behavior), then **STOP and wait for review**. Do not start the next block unless told "next".
- Fixed tech stack: Tauri 2, React 18 + TypeScript, React Flow, PixiJS 8, Zustand, Tailwind, Howler.js, Rust (axum, notify), SQLite. **No new dependencies** without explicit approval — if you believe one is needed, stop and ask.
- Every control in a modal/panel must either appear in the compiled preview **or** carry a `local only` badge. No third category.
- Nothing is written to disk until the user confirms (Create / Save / Compile). Previews are in-memory.
- Keep naming consistent with `TASKS_NODE_TAXONOMY_UI.md`, `TASKS_EDGE_MODEL.md`, `TASKS_AGENT_MODAL.md`. If this spec conflicts with those, this spec wins for UI labels only; data model stays as specified there.
- Before editing, read the relevant existing component to find the actual file/prop names. Do not guess paths; `grep` first.

---

## Block 0 — Git init actually creates the branch (bug)

**Problem.** New Project Wizard lets the user pick a branch name (e.g. `master`), runs `git init`, but no branch exists afterwards. In Git a branch ref is only created by the first commit; `git init` alone only points `HEAD` at a not-yet-existing ref.

**Do.**
1. In the Rust project-init command: run `git init -b <branch>` (fallback for old git: `git init` then `git symbolic-ref HEAD refs/heads/<branch>`).
2. Create an initial commit containing at minimum `.gitignore` (with `.claude/settings.local.json`, `CLAUDE.local.md`, `.cowtext/cache/`) and `.cowtext/graph.json`. Commit message: `chore: init cowtext project`. Use the user's existing git identity; if none is configured, surface a clear error in the wizard instead of silently failing.
3. Wizard shows the result: `branch master · 1 commit` or the error text.

**Acceptance.**
- After New Project with branch `main`, `git branch --show-current` prints `main` and `git log --oneline | wc -l` is 1.
- Existing non-empty folders are never re-initialized; wizard detects `.git` and skips with a notice.

**Scope guard.** No commits on any later action. No push, no remote.

---

## Block 1 — One name for node type, and microExample everywhere

**Problem.** The same concept is labeled `Type` (New Node Wizard), `Role` (properties panel), and rendered as `ARCHITECTURE` (canvas card). The user could not tell what `Type` means. The taxonomy spec already defines a mandatory `microExample` per type, but the wizard does not show it.

**Do.**
1. Single UI label everywhere: **Node type**. Internal field name stays whatever the taxonomy spec defined; only labels change.
2. New Node Wizard: replace the bare `Type` select with a **picker grouped by the 4 taxonomy groups** (Constraints, Structure, Process, Knowledge). Each entry shows: icon, name, one-line description, and `microExample` rendered as a small monospace block. Selecting a type updates a right-hand "What you get" preview: compiled snippet for that type with the example filled in.
3. Properties panel `Role` field becomes `Node type` and shows the same description + microExample under it (collapsible, default open for the first 3 sessions, then remembered collapsed state — store in local settings).
4. Add a `?` affordance next to the label that opens a small popover listing all 13 types with their microExamples (this is the "examples for ALL nodes" request).

**Acceptance.**
- `grep -ri "role" src/` returns no user-visible string for node type (data model names excluded).
- Every one of the 13 types renders a non-empty microExample in both wizard and popover; add a unit test that iterates the taxonomy table and fails on a missing/empty example.

**Scope guard.** Do not change the taxonomy itself (13 types, 4 groups). Do not touch edge UI.

---

## Block 2 — Assemble becomes one component; Influence slider visible

**Problem.** Brief, Tags and Influence all feed the Assemble step, yet Brief and Tags live under Metadata, and Influence is in a collapsed Assemble section below the fold — the user reported "I can't see the slider".

**Do.**
1. Create `AssembleSection` (or rename existing) in the properties panel containing, in this order: **Brief**, **Tags**, **Influence** (slider 0–100 with numeric input, default from taxonomy), **Assemble** action + result preview.
2. Remove Brief and Tags from the Metadata section. Metadata keeps: Title, Node type, Owner.
3. Section order in the panel: Metadata → Assemble → Context (pinned, read order) → Relations → File → Advanced.
4. `Position (X/Y)` moves into a collapsed `Advanced` section. It gets a `local only` badge.
5. Assemble section is **expanded by default**. Influence slider is always rendered (no conditional hiding based on node type); if a type ignores influence, show the slider disabled with tooltip "Not used for <type>".
6. Each field in Assemble gets a one-line helper: Brief — "Seed sentence Assemble expands"; Tags — "Used for subgraph selection and compile filtering"; Influence — "Weight in load resolution; see resolveLoad()".

**Acceptance.**
- On a fresh project, selecting the only node shows the Influence slider without scrolling at 1080p.
- Brief/Tags edits change the Assemble preview live.
- Position fields still function, but are only visible after expanding Advanced.

**Scope guard.** Do not change `resolveLoad()` semantics. No new fields in graph.json.

---

## Block 3 — New Agent Wizard: provider→model, priority, validation, presets

### 3a. Provider → Model selector
**Problem.** Flat model list, no provider concept, no latest models.

**Do.**
1. Add `src/resources/models.json` (bundled, read at startup; no network):
   ```json
   {
     "providers": [
       { "id": "anthropic", "name": "Anthropic", "icon": "anthropic", "cli": "claude",
         "models": [
           { "id": "claude-fable-5", "label": "Claude Fable 5", "tier": "flagship" },
           { "id": "claude-opus-4-8", "label": "Claude Opus 4.8", "tier": "flagship" },
           { "id": "claude-sonnet-5", "label": "Claude Sonnet 5", "tier": "balanced" },
           { "id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5", "tier": "fast" }
         ]},
       { "id": "openai", "name": "OpenAI", "icon": "openai", "cli": "codex", "models": [] },
       { "id": "google", "name": "Google", "icon": "gemini", "cli": "gemini", "models": [] },
       { "id": "cursor", "name": "Cursor", "icon": "cursor", "cli": "cursor", "models": [] },
       { "id": "github", "name": "GitHub Copilot", "icon": "copilot", "cli": "gh copilot", "models": [] }
     ]
   }
   ```
   Fill non-Anthropic model lists from the providers' current public model ids; **do not invent ids**. If unsure about an id, leave the list short and rely on the custom entry below. Marty will review the file.
2. Provider icons: inline SVG in `src/icons/providers/` — monochrome, currentColor, 16px grid. No icon libraries.
3. Wizard UI: step 1 — provider chips (icon + name). Providers not detected by the toolchain scan are rendered dimmed with tooltip "Not found on this machine — still selectable". Step 2 — model list for that provider, grouped by `tier`, plus a last entry **Custom model id…** (free text, validated non-empty).
4. Selection stored as `{ provider, model }`; compiled into the agent frontmatter exactly as the target format expects (Claude Code: `model:`; others: `local only` badge until their format supports it).

### 3b. Defaults and validation
1. Priority default = **1** (not 3). Check the same default in `agent-defaults.ts` or wherever it lives; one source of truth.
2. "When to use this agent" validator: replace keyword regex with: non-empty, ≥ 20 chars, not identical to the agent name. Anything else is a **soft warning** ("Tip: start with 'Use when…' so Claude picks this agent reliably"), never a blocking error. Keep it inline under the field.
3. Show the helper text *before* the user types, not only after an error.

### 3c. Agent presets
1. Add `src/resources/agent-presets.json` — a list of `{ id, name, description, whenToUse, tools, mode (inherit|restrict), priority, model? }`. Ship 5–6 built-ins: `reviewer`, `test-writer`, `docs-writer`, `refactorer`, `planner`, `debugger`. Keep `whenToUse` concrete (one sentence each).
2. Wizard top: a **Preset** row (chips). Picking one fills the form; every field remains editable; a "Custom" chip clears.
3. This is **separate** from the existing graph Presets window. Do not merge them.

**Acceptance.**
- New agent with no changes gets priority 1 and an Anthropic model selected by default (the first `flagship` entry).
- Entering "Use when reviewing PRs for security issues." produces no error and no warning.
- Compiled preview pane shows `model: <id>` for Claude Code target.
- All preset fields round-trip through the compiled preview.

**Scope guard.** No network calls to list models. No changes to `disallowedTools` / `maxTurns` behavior from TASKS_AGENT_MODAL.

---

## Block 4 — Bundled skills are present by default

**Problem.** Pre-defined skills must be "created" before use. They should be available out of the box.

**Do.**
1. Skills section in the sidebar gets two groups: **Built-in** and **Project**. Built-in skills come from `src/resources/skills/<id>/SKILL.md` bundled with the app (start with the existing `task-format` plus any other predefined ones already in the repo).
2. Built-in skills are **virtual** until used: not written to `.claude/skills/`. Each has a toggle "Include in compile". Toggling on marks it; the actual write to `.claude/skills/<id>/SKILL.md` happens on **Compile**, after the diff preview (consistent with "nothing is written until confirmed").
3. A built-in skill that has been materialized and then edited on disk becomes a Project skill (detected by content hash mismatch); show "modified from built-in" badge with a "Reset to built-in" action.
4. Agent wizard tools/skills picker lists built-ins the same way, with the same badge.

**Acceptance.**
- Fresh project: Skills sidebar shows built-ins immediately, `.claude/skills/` stays empty.
- After enabling one and compiling, the file exists on disk and the sidebar moves it to Project (or keeps it with "built-in, materialized" badge — pick one and document).

**Scope guard.** Do not auto-enable any built-in skill. No changes to skill file format.

---

## Block 5 — Title screen auto-scan; "New agent here" in canvas context menu

### 5a. Auto-scan
1. On Title Screen mount, run the toolchain scan automatically (same Rust command as "Check installs"). Show a spinner per row while scanning; result per row: ✓ + version string, or ✗ "not found". Cache the result for the session; re-run on the existing button, now labeled **Rescan**.
2. Scan must be non-blocking and time-boxed (≤ 3 s per binary; `where`/`which` + `--version`). Failures never block the title screen.
3. Scan result is stored in the Zustand store so Block 3a's provider chips can read "detected/not detected".

### 5b. Context menu
1. Right-click on empty canvas: add **New agent here…** next to **New node here…**. It opens the Agent wizard; on Create, the agent node (if agents are rendered on canvas) is placed at the click position; otherwise just creates the agent and selects it in the sidebar.
2. Right-click on a node: add **New agent from this node…** which pre-fills the agent's context subgraph with that node (pinned). `local only` nothing here — this maps to the agent's context list in the compiled preview.

**Acceptance.**
- Title screen reaches "scanned" state without user action; timings logged in Activity tab.
- Both context menu items exist and open the wizard with the expected prefill.

**Scope guard.** No changes to the Pixi barn. No spawning of sessions from the context menu.

---

## Block 6 — New Project Wizard: principle checkboxes and stack presets

**Do.**
1. Add a **Principles** step with checkboxes; each maps to a Constraint-group node with a fixed `microExample`-style body:
   - Never commit without asking
   - Short commit messages (≤ 50 chars subject)
   - Ask before adding a dependency
   - Run tests before declaring done
   - No destructive git operations (force-push, reset --hard)
   - Prefer editing existing files over creating new ones
2. Add a **Stack** step: searchable chip picker grouped by category. Categories and starter lists (a curated `src/resources/stacks.json`, editable later):
   - Languages: TypeScript, Python, Rust, Go, C#, Java, Kotlin, Swift
   - Frontend: React, Vue, Svelte, Next.js, Tauri, Electron
   - Backend: Node/Express, FastAPI, Django, axum, Actix, ASP.NET, Spring
   - Engines/Graphics: Unity, Unreal, Godot, PixiJS, Three.js
   - Data: PostgreSQL, SQLite, Redis, Prisma, Drizzle
   - Tooling: pnpm, Vite, Tailwind, Zustand, Vitest, Playwright
   Selected chips produce one Structure-group node `stack.md` listing the stack, plus the "fixed stack, approval for additions" constraint if that checkbox is on.
3. Wizard shows a live preview of the nodes that will be created (count + names) before Create. Nothing is written until Create.

**Acceptance.**
- Selecting 3 principles + 4 stack chips creates exactly 3 Constraint nodes + 1 Structure node, all with non-empty bodies, all visible on canvas after creation.

**Scope guard.** No LLM calls in the wizard. Lists live in JSON resources, not in components.

---

## Block 7 — Appearance settings: font size and font family

**Do.**
1. New Settings section **Appearance** (move `Calm mode` and `FPS counter` into it; Sound keeps volume/toggles).
2. `UI scale` — 85 / 100 / 115 / 130 % (applies a CSS variable on `:root`; Tailwind rem-based sizes follow).
3. `UI font` — choice of: System, Inter (bundled if already present), and the current monospace for code/paths. `Code font` — separate select. Only fonts already shipped with the app or system fonts; **no new font files** without approval.
4. Persist in local settings (same mechanism as other settings). Barn/Pixi scene unaffected.

**Acceptance.**
- Changing UI scale resizes sidebar, panel, and modals consistently; canvas node cards scale too; Pixi scene does not.
- Settings persist across restart.

**Scope guard.** No theme/color changes in this block.

---

## Smaller fixes (fold into the nearest block, or do as Block 8 if reviewer prefers)

- Canvas toolbar `NONE / ACTIVITY / WEIGHT / LIVE`: prefix with a label `Overlay:` and add tooltips.
- Node card badge (the `1`): tooltip "Read order".
- Barn status line `R0 · M0 · ✓0`: replace with the same text format as the workspace status bar, or add a tooltip per token.
- Run Session: default `Agent file` to the last used agent; render `Token ceiling` as an editable input with "inherit" placeholder.
- New Task: `Status` values → `Todo / In progress / In review / Done`; `Task type` becomes enum chips `bug / feature / chore / docs`, or is removed if Tags cover it (ask before removing).
- Settings: hooks server port must come from one constant shared by Rust and the settings display (currently shows 4923; spec says 8787 — confirm which is right and fix the other).

---

## Backlog — blocked until approved

- **N1** Fetch model lists from provider CLIs (`claude --list-models` style) when available, to update `models.json` at runtime.
- **N2** Agent presets as user-savable entries (save current wizard state as preset).
- **N3** Per-project principle/stack nodes editable as a "Project profile" view instead of individual nodes.
- **N4** Theme (light/dark/contrast) under Appearance.
- **N5** Handoff window split into two tabs (LLM handoff vs deterministic Memory Node).

Ты работаешь над Cowtext в репозитории:

D:\Moo.exe\Cowtext

Cowtext — desktop context-graph editor и context compiler [компилятор контекста] для AI coding agents, построенный на Tauri 2, React 19, PixiJS 8, Zustand и Rust.

Используй как визуальный источник этот product audit:

https://www.figma.com/board/sRbx1bZWzMX1h5eaKViKV7

Исходные скриншоты также находятся здесь:

C:\Users\marty\.codex\visualizations\2026\08\22\01a027b2-a3af-7ec2-b79f-e431cce1fbb6\cowtext-audit

# Главная цель

Подготовить Cowtext к надёжному v0.1 release [выпуску], улучшив:

1. product truth [достоверность продукта];
2. first-run activation [успешный первый запуск];
3. context integrity [целостность контекста];
4. release acceptance [приёмку выпуска];
5. frontend confidence [надёжность frontend].

Не добавляй крупные L3/L4-функции, пока не закрыт P0 и не пройдены его acceptance criteria.

Основная проблема сейчас не в недостатке функций. Cowtext имеет сильное техническое ядро и хороший Compile trust model, но страдает от расхождений между кодом, UI, документацией, provider-specific context files и skills.

# Обязательные ограничения проекта

Перед началом полностью прочитай:

- CLAUDE.md;
- AGENTS.md, если он существует;
- README.md;
- docs/TERMINOLOGY.md;
- docs/TERMINOLOGY_REFERENCE.md;
- docs/design/DESIGN_SPEC.md;
- docs/design/ART_DIRECTION.md;
- docs/tasks/TASKS.md;
- docs/tasks/BACKLOG.md;
- docs/tasks/BUGS.md;
- docs/tasks/ROADMAP.md;
- docs/fleet/ROSTER.md;
- соответствующие skills в .claude/skills и .agents/skills.

Соблюдай следующие правила:

- Не добавляй libraries [библиотеки] или testing dependencies без явного разрешения Marty.
- Не трогай пользовательские изменения в dirty worktree [изменённом рабочем каталоге].
- Не выполняй reset, checkout или восстановление файлов из snapshot.
- Не изменяй файлы вне своей file zone [зоны владения], если работа выполняется fleet-агентами.
- Все filesystem operations проходят через Rust commands; webview не работает с путями напрямую.
- Compile никогда не пишет без diff-preview approval.
- Generated files всегда сохраняют GENERATED header.
- Schema change требует version bump и migration.
- Не создавай документацию вне docs/. В корне остаются только разрешённые context-файлы и README.
- Не обновляй status lines и не отмечай задачи выполненными, пока фактические gates не прошли.
- Не создавай commit и не отправляй изменения во внешний remote без прямого указания Marty.
- React Flow и PixiJS не импортируют друг друга; оба читают Zustand store.
- TypeScript остаётся strict, без any.
- cargo clippy -- -D warnings должен проходить.

Если используешь /ultracode или agent fleet:

1. Сначала подготовь frozen contract [зафиксированный контракт].
2. Создай Stage 0 manifest с точным перечнем изменяемых файлов.
3. Раздели file zones так, чтобы они не пересекались.
4. Не разрешай агентам восстанавливать целые файлы из сохранённых копий.
5. После landing выполни adversarial audit [критический аудит] зеркальных Rust↔TypeScript контрактов относительно спецификации, а не только относительно друг друга.

# Подтверждённая исходная ситуация

Сначала перепроверь всё live-командами, но используй эти факты как ориентир:

- Frontend build проходит.
- 163 frontend Vitest tests проходят.
- 785 Rust tests проходят: 751 library + 18 CLI + 16 MCP.
- cargo clippy --all-targets -- -D warnings проходит.
- ESLint сообщает 0 errors и 16 warnings.
- В frontend есть 12 файлов .test.ts и 0 файлов .test.tsx.
- src/store/graph.test.ts содержит no-op assertion `expect(true).toBe(true)`.
- В проекте есть около 17 suppressions для react-hooks/exhaustive-deps.
- AddAgentDialog содержит mount-only effect, использующий cwd, но dependency array пуст.
- Vite сообщает chunks CodeMirror и Pixi размером более 500 KB.
- src/inspector/Inspector.tsx содержит около 2817 строк.
- docs/fleet/ACTIVITY_LOG.md содержит около 1893 строк, несмотря на правило хранить три последние сессии.
- Текущий канон содержит 76 Tauri invokes, но часть context/skill files всё ещё говорит о 75.
- Текущий Rust baseline — 785 tests, но некоторые status lines всё ещё говорят о 770.
- Из семи пар .claude/skills ↔ .agents/skills четыре различаются.
- `.codex/config.toml` указывает на `src-tauri/target/release/cowtext-mcp.exe`, которого может не быть в clean/current workspace.
- `.codex/hooks.json` выглядит как Claude-style hooks configuration и ссылается на `.claude/scripts`.
- AGENTS.md содержит признаки слепого search-and-replace:
  - `AGENTS.md / AGENTS.md`;
  - `Codex -p`;
  - `.Codex/settings.json`;
  - `.Codex/agents`;
  - устаревшие invoke/test counts.
- Реальный Assemble runtime в коде использует `claude -p`.
- Run, Hooks и часть orchestration остаются Claude-specific, хотя Compile поддерживает несколько output targets.

Не принимай числовые значения из документации на веру. Вычисли их из кода и test output.

# Требуемый порядок работы

## Stage 0 — read-only discovery и frozen contract

До любых изменений:

1. Выполни `git status --short`.
2. Зафиксируй существующие пользовательские изменения.
3. Составь карту:
   - Compile targets;
   - Runtime providers;
   - Assemble provider;
   - Run provider;
   - Hooks provider;
   - Agent-definition paths;
   - provider-specific settings paths;
   - MCP configuration;
   - context/skill mirror pairs.
4. Найди фактические источники:
   - invoke command list;
   - test counts;
   - generated output targets;
   - runtime binary name;
   - hook paths;
   - task-file conventions.
5. Представь frozen contract:
   - что универсально;
   - что Claude-specific;
   - что поддерживает Codex;
   - что пока не поддерживается;
   - какие файлы планируется изменить;
   - какие изменения требуют решения Marty.

Не начинай реализацию, если provider contract нельзя достоверно вывести из кода.

## Stage 1 — P0.1 Product support matrix

Создай один честный provider support contract.

Он должен отдельно описывать:

- Compile target;
- Import source;
- Assemble runtime;
- Session/Run runtime;
- Hooks/event integration;
- Agent definitions;
- Settings path;
- MCP support.

Не называй функцию multi-provider, если реально multi-provider только generated output.

Предпочтительная формулировка до появления полноценной abstraction:

“Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.”

Эта граница должна одинаково отражаться в:

- Title screen;
- Convert existing copy;
- README;
- CLAUDE.md;
- AGENTS.md;
- terminology;
- provider-specific skills;
- Settings;
- Agents empty state;
- Run/Assemble tooltips.

## Stage 2 — P0.2 Context generation и drift prevention

Устрани blind search-and-replace между CLAUDE.md и AGENTS.md.

Требования:

1. Определи общий canonical source или явно поддерживаемый generator.
2. Provider-specific различия должны быть allowlisted.
3. Нельзя автоматически заменять:
   - `claude -p` на несуществующий `Codex -p`;
   - `.claude/settings.json` на неподтверждённый путь;
   - `.claude/agents` на другой формат без проверки;
   - Claude hook events на Codex hooks без реального контракта.
4. Добавь validation gate, находящий:
   - повторяющиеся output names вроде `AGENTS.md / AGENTS.md`;
   - несуществующие paths;
   - устаревшие invoke counts;
   - устаревшие test counts;
   - расхождение provider capabilities;
   - необъяснённое различие mirrored skills.
5. Не пытайся сделать `.claude` и `.agents` byte-identical, если provider-specific различия намеренны. Различия должны быть задокументированы и проверяемы.

## Stage 3 — P0.3 `.codex` integration truth

Проверь `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents` и `.agents/skills`.

Для каждого элемента выбери один из вариантов:

- работает и покрыт smoke test;
- генерируется/setup-скриптом;
- является development-only;
- временно не поддерживается и не должен обещаться пользователю;
- должен быть удалён после подтверждения Marty.

Не оставляй configuration, которая выглядит готовой, но указывает на отсутствующий binary.

Не создавай фиктивные Codex hooks. Используй только реально подтверждённый Codex contract.

## Stage 4 — P0.4 First-run activation

Сохрани существующий Cowtext design system:

- Barnlight palette;
- two-accent law;
- blue = user;
- amber = Cowtext;
- существующие radii, density, motion и focus ring;
- никаких новых визуальных систем и libraries.

Улучши следующие состояния.

### Title screen

- Явно обозначь recommended path.
- Объясни результат каждого входа.
- Исправь Claude-only Convert copy в соответствии с support matrix.
- Уточни смысл recent count.
- Не превращай экран в marketing landing page.

### Canvas

Для нового или почти пустого graph покажи краткий путь:

1. Create node.
2. Connect context.
3. Preview compiled output.

Главный CTA должен находиться рядом с объяснением, а не только в toolbar.

### Tasks empty state

- Добавь прямой Create task / Create TASKS.md CTA.
- Объясни связь задачи с task context subgraph.
- Не показывай нерелевантный node Inspector.
- Вместо него используй contextual task panel или скрывай panel до выбора task.

### Agents empty state

- Добавь прямой Create agent CTA.
- Не заставляй пользователя возвращаться в Hierarchy.
- Используй provider-neutral copy там, где функция действительно provider-neutral.
- Если agent definitions поддерживаются только для Claude, скажи это прямо.

### Barn

На P0 не делай art overhaul.

Можно только:

- объяснить, что означает сцена;
- дать понятный demo/connect hooks action;
- устранить очевидную wide-screen fit проблему, если это безопасная локальная правка.

Production sprite work оставить для P2.

## Stage 5 — P0.5 Golden-path acceptance

Не добавляй ещё один manual на сотни или тысячи механических шагов.

Создай один risk-based golden path примерно на 25–40 сценариев:

1. Title screen.
2. New project или Convert.
3. Create nodes.
4. Create typed edges.
5. Edit node.
6. Preview compiled output.
7. Approve write в disposable project.
8. Verify generated headers.
9. Create task.
10. Verify task context closure.
11. Create/select agent.
12. Run/Assemble с честным provider runtime.
13. Verify hooks/events.
14. Check Barn response.
15. Switch project и проверить отсутствие state leakage.
16. Проверить failure states и trust boundaries.

Используй disposable test project. Не пиши в реальный пользовательский проект.

Согласуй TASKS, ROADMAP, status line и acceptance state. Должен существовать один источник истины о release gate.

## Stage 6 — P0.6 Generated release truth

Автоматизируй или надёжно проверяй:

- invoke count;
- Rust test count;
- frontend test count;
- schema version;
- compile targets;
- current acceptance status.

Status line не должен требовать ручного поиска и замены в нескольких provider files.

# P0 acceptance criteria

P0 считается завершённым только когда выполнено всё:

1. Новый пользователь может пройти Title → Node → Edge → Compile preview без внешней инструкции.
2. Ни один UI/context файл не обещает неподдерживаемый Codex runtime.
3. `AGENTS.md / AGENTS.md` и аналогичные duplicate replacements отсутствуют.
4. Compile multi-target и Claude-specific runtime разделены понятным языком.
5. `.codex` configuration либо реально работает, либо честно помечена/удалена после подтверждения.
6. Canvas, Tasks и Agents empty states имеют прямые следующие действия.
7. Inspector не остаётся нерелевантно открытым в Tasks.
8. Golden-path manual содержит разумное количество risk-based scenarios.
9. Invoke/test counts соответствуют live code and gates.
10. Ни один пользовательский файл не записывается без preview/approval.
11. Нет новых TypeScript errors, Rust warnings или ESLint errors.
12. Все обязательные gates проходят.

# P1 — только после P0 checkpoint

После завершения P0 остановись и представь Marty checkpoint report.

Не начинай P1 без подтверждения.

Предлагаемый P1:

1. Accessibility pass:
   - keyboard-only;
   - modal focus trap;
   - 200% zoom/reflow;
   - Windows High Contrast;
   - reduced motion;
   - accessible names;
   - control target sizes;
   - meaningful text size and contrast.

2. Frontend interaction tests:
   - Title screen;
   - Compile modal;
   - Settings;
   - Tasks empty state;
   - Agents empty state;
   - project switching;
   - stale state prevention.

Если нужна новая testing library, сначала запроси разрешение.

3. React state synchronization:
   - аудит exhaustive-deps suppressions;
   - AddAgentDialog cwd;
   - project switch;
   - modal open/close state;
   - session selection.

4. Bidirectional invoke reachability:
   - каждый frontend invoke зарегистрирован;
   - каждый registered Rust command имеет consumer или explicit internal marker;
   - exact-name contract проверяется автоматически.

5. Documentation/context compression:
   - полноценный README;
   - support matrix;
   - five-minute quick start;
   - trust model;
   - generated files;
   - limitations;
   - troubleshooting;
   - ACTIVITY_LOG хранит только три последние сессии;
   - старые записи архивируются только через git mv.

6. Заменить no-op frontend test реальным behaviour test или удалить его до появления функции.

# P2 — не выполнять сейчас

После P1 можно отдельно планировать:

- безопасное разделение Inspector.tsx, graph store, agents store и AgentEditor;
- frontend performance budget;
- CodeMirror/Pixi chunk reduction;
- production Barn sprites;
- responsive Barn camera;
- унификацию task-file conventions;
- skill mirror validation;
- обучение edge semantics через preview compiled consequences.

# Обязательные gates

Frontend из корня:

- npm run build
- npm run lint
- npm run test

Rust из src-tauri:

- cargo test --all-targets
- cargo clippy --all-targets -- -D warnings

Также:

- запусти npm run tauri dev;
- проверь реальные UI states;
- сними screenshots после UI-изменений;
- проверь отсутствие text clipping, overlap, неправильного focus и пустых тупиковых состояний;
- не считай screenshots достаточной accessibility-проверкой.

# Формат отчёта после каждого stage

Для каждого stage сообщай:

1. Outcome [результат].
2. Изменённые файлы.
3. Изменённое пользовательское поведение.
4. Какой риск закрыт.
5. Выполненные tests/gates.
6. Оставшиеся риски.
7. Нужны ли решения Marty.

В конце P0 предоставь:

- краткий before/after;
- таблицу всех P0 acceptance criteria;
- список незакрытых рисков;
- фактические live counts;
- `git diff --stat`;
- подтверждение, что существующие пользовательские изменения не были отменены;
- рекомендацию: готов ли Cowtext переходить к P1.

Начни со Stage 0. Сначала покажи frozen contract и file manifest. Не изменяй код до завершения этой проверки.