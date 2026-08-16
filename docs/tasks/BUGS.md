# Bugs

Known defects and issues under watch. Schema: Name, Tags, Description, Priority, Date Created, Status. Severity rides in Priority (P0 blocker · P1 high · P2 medium · P3 low). Fixed bugs stay listed with status ✅ Fixed until the phase closes, then roll off.

## Open / watching

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Main JS chunk exceeds Vite size warning | frontend, build, perf | Vite reports the main chunk at 944.52 kB (> 500 kB warning threshold). Not a runtime defect — watch item; fix is the "Code-split main JS chunk" backlog task. | P3 | 2026-08-16 | 👁 Watching |

Note: `cargo test` reporting 0 tests for the `main.rs` binary and doc-tests is expected, not a bug — all 23 tests live in `cowtext_lib`.

## Fixed — 2026-08-16 (Phase 2 audit)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| `clean_glob_dir` accepted aliasing dirs | compile, rust, correctness | Conditional condition `./**` emitted nested `./AGENTS.md` aliasing root `AGENTS.md` — root file silently overwritten with a broken two-line stub after approval; `src/./**` and `src//**` produced colliding paths / wrong `../` link depth. Fixed with a component walk (reject `.`, `..`, empty segments, backslashes, drive colons); dirty globs stay root bullets. | P1 | 2026-08-16 | ✅ Fixed |
| Escaping globs broke the whole preview | compile, rust, ux | `../lib/**` or `C:/x/**` produced a nested path that failed `resolve_within_root`, so `compile_preview` returned an opaque infrastructure `Err` for the entire compile instead of a validation error or fallback. Fixed by the same component-walk change — escaping globs never reach the path guard. | P1 | 2026-08-16 | ✅ Fixed |
| Unescaped YAML in `.mdc` frontmatter | compile, rust, cursor, correctness | Node titles containing `: `, leading `#`/`[`/`{`, or newlines produced invalid/truncated YAML in `description:` (and the unquoted `globs:` line), breaking Cursor rule parsing. Fixed with `yaml_scalar()` — plain scalars pass through byte-identical, unsafe values get double-quoted with escapes. | P2 | 2026-08-16 | ✅ Fixed |
| Post-compile rescan unmounted the workspace | frontend, react, ux | `rescan()` after a successful write set `scanning=true` and App swapped the entire tree to the full-screen Scanning component behind the still-open done modal — GraphCanvas viewport reset, inspector unmounted. Fixed: full-screen scanner only when `root === null`; in-session rescans keep the workspace mounted. | P1 | 2026-08-16 | ✅ Fixed |
