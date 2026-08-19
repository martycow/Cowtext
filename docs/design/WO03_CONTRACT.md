# WO03 Contract — L1 Moat Hardening (frozen)

**Work order 03** · drafted 2026-08-19 (v2 replan session) · dispatcher: `/ultracode` · **landing = the v0.1.0 cut**

**Goal:** the context graph becomes defensibly better than hand-written config — richer taxonomy, five compile targets, CI-checkable, importable, lintable. First build phase of the v2 four-layer plan (see ROADMAP.md, strategy per `Cowtext_Strategy_2026.pdf`).

**Precondition:** WO02 committed (`103ac80`). Tree clean at dispatch.

---

## Must-NOT-break (read first, every lane)

1. **Byte-identity frontmatter** — `frontmatter.rs` / `agents.rs` are OUT of every lane's zone; nobody touches them.
2. **Deterministic compile** — a v2 graph migrated to v3 with no edits produces **byte-identical** claude/agents/cursor output. Regression fixture required (Lanes A+B).
3. **Never-clobber** — preset apply and `import_apply` never overwrite existing files; import creates graph entries pointing at existing files, never rewrites file content.
4. **Preset round-trip** — v2 presets auto-upgrade on read/apply and re-save cleanly.
5. **Write allowlist + GENERATED header** — extended for the two new targets, never weakened; `compile_write` still refuses headerless content.
6. **Invoke-contract byte-exactness** — the contract gate updates in the same commit as `lib.rs` changes (shared-append protocol, WO02 precedent).
7. **Errors XOR files** — holds for `import_scan` and for compile with the new targets.

**Explicitly out of scope:** barn/scene, `sessions.rs`, `tasks.rs`, `hooks.rs`/`hooks_server.rs`, `watcher.rs`, `sfx.ts`. Zero barn lanes (L1-first rule).

---

## Graph v3 schema (Lane A owns; frozen)

- `version: 3` (migration harness gains v2→v3; pure default-filling, idempotent, lossless).
- **Node `role` enum 7 → 12**: existing `agent, rules, architecture, workflow, task, reference, glossary` **+ new** `command, invariant, trap, skill, snippet, style`. (Deck mapping: Rule→`rules`, Persona→`agent`, Doc-ref→`reference`.)
- **New node fields:** `tags: string[]` (default `[]`) · `owner?: string` · `meta?: {}` (reserved extension map, keys serialized sorted — scalars never force a v4).
- **Edge kinds 4 → 7**: existing `imports, references, conditional, sequence` **+ new** `overrides` (STRUCTURAL — participates in Kahn/cycle validation and ordering), `supersedes`, `conflicts-with` (both NON-structural — excluded from Kahn, consumed by the linter only). Deck's `scopes-to` ≡ existing `conditional`; do not rename.
- **New edge field:** `color?: string` (absorbs the "edge colour persistence" backlog row).
- **`compileTargets`** value set: `"claude" | "agents" | "cursor" | "copilot" | "gemini"` (new two OFF by default).
- Deterministic serialization extends to all new fields (sorted keys, LF, trailing newline, fields omitted when default).
- **Preset format** bumps in lockstep; `preset_read` / `preset_apply` auto-upgrade v2 presets.

## New invoke commands (51 → 54)

| Command | Args (camelCase ⇄ snake_case) | Returns | Notes |
|---|---|---|---|
| `import_scan` | `root: string` | `ImportChangeset { nodes[], edges[], warnings[] }` XOR errors | Parses existing CLAUDE.md / AGENTS.md / .cursor/rules/*.mdc → proposed nodes+edges. Read-only. GENERATED-header files report as "already managed". |
| `import_apply` | `root: string, changeset (approved subset)` | applied summary | Writes graph entries only; never file content; never clobbers existing nodes. |
| `lint_run` | `root: string` | `Problems { items: LintItem[] }` | Unified payload: cycle/missing-file/dangling-edge + conflict/duplication/stale. |

No new Tauri events (all three are request/response). The four existing events are untouched.

---

## Lanes (7) — file-zone ownership grid

Zones are exclusive unless marked **shared-append** (`lib.rs` handler list + invoke-contract gate: append-only, coordinate commit order, WO02 protocol).

| Lane | Agent | Scope | File zone |
|---|---|---|---|
| **A — graph-v3** | tech-general | v3 schema + migration + deterministic serialization; preset format bump + auto-upgrade; TS types | `src-tauri/src/project.rs` + `project/tests.rs` · `src-tauri/src/preset.rs` + tests · `src/store/graph.ts` (types only; lands FIRST — F depends on it) |
| **B — compile-targets** | tech-general | `copilot` adapter → `.github/copilot-instructions.md`; `gemini` adapter → `GEMINI.md`; identical Kahn `(readOrder, id)` order; GENERATED header; `classify_output` allowlist extension; `overrides` edges honored in ordering | `src-tauri/src/compile.rs` + `compile/tests.rs` (golden files) |
| **C — cli** | tech-general | Second `[[bin]]` **`cowtext-cli`**: `compile --check` (preview vs disk, exit 1 on drift), `lint`, `--json`. Feasibility verified: `cowtext_lib` is `rlib`; compile.rs core is tauri-free except the two `#[tauri::command]` wrappers — C extracts the pure core, B owns adapter internals; **C sequenced after B** | `src-tauri/src/bin/cowtext_cli.rs` (new) · `src-tauri/Cargo.toml` (`[[bin]]` entry) · compile.rs core-split refactor only |
| **D — importer** | tech-general | Round-trip MVP per `import_scan`/`import_apply` above | `src-tauri/src/import.rs` + `import/tests.rs` (new) · `lib.rs` **shared-append** |
| **E — linter** | tech-general | Linter v1: conflict (explicit `conflicts-with` edges + duplicate-title + near-dup content hash), duplication vs README/other nodes, stale (`lastVerified` age; superseded-but-still-pinned via `supersedes` chains); unify with cycle/missing/dangling into one Problems payload | `src-tauri/src/lint.rs` + `lint/tests.rs` (new) · `lib.rs` **shared-append** |
| **F — frontend** | tech-ui | 12-role KindPicker + RoleGlyphs; 7-kind edge picker (structural vs lint-only affordance); tags/owner editors in Inspector; Problems panel; import-review UI (changeset diff, adopt/skip per item); compile-modal checkboxes for copilot/gemini | `src/canvas/` · `src/inspector/` · `src/compile/` · `graph.ts` consumers (after A's types land) |
| **G — docs close-out** | project-manager | Final lane, after all merges: invoke count 51→54 in TERMINOLOGY + skill; v3 schema terms; new-target terms; Status line; `docs/testing/WO03_TEST_MANUAL.md` (manual-format skill; includes the CSP production-build step — retired old v0.1.0 gate) | `docs/**` · `CLAUDE.md` · `README.md` · `.claude/skills/cowtext-terminology/` |

Audit (tech-lead) + gates (tester) follow the WO02 protocol: adversarial audit after lanes land, defect fix round by owning lanes, all gates re-run.

## Gates

`npm run build` · `npm run lint` · `cargo clippy -- -D warnings` · `cargo test` (import.rs/lint.rs join the tested modules) · invoke contract **54/54 byte-exact** · golden files for all 5 targets · migration corpus (v2 fixture → v3 → byte-identical claude/agents/cursor output) · preset v2 round-trip · CLI smoke (`compile --check` exit 0 clean / exit 1 drifted) · import walk on a real repo with a hand-written CLAUDE.md · CSP production-build step in the manual.

## Deferred (explicitly NOT this WO)

SKILL.md target, hierarchy simulator, symlink manager, full round-trip import, resolved-context preview → **WO04**. Heatmap/drift/shim → **WO05**. DAG/subgraph injection/budgets → **WO06**. Heartbeats/gates/squads/auto-promote → **WO07**. See ROADMAP.md.
