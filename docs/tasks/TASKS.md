# Tasks

Active and recently completed work items. Schema: Name, Tags, Description, Priority, Date Created, Status. Completed tasks roll off to the bottom section after a sprint closes; open tasks live at the top.

Priority scale: P0 blocker · P1 high · P2 medium · P3 low.

## Open

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Phase 2 manual acceptance walk | phase-2, compile, acceptance, qa | Run `npm run tauri dev`; open a real project; build/verify a graph; press Compile; check preview (errors state, handwritten warning, unchanged handling, target chips); approve & write; verify `CLAUDE.md` works in a real Claude Code session and `AGENTS.md` is readable by Codex; also walk the Phase 1 §9 acceptance (drag/connect/save UX) which was never verified in a running window. Update CLAUDE.md Status line after. | P0 | 2026-08-16 | 🔲 Open |

## Done — 2026-08-16 (Phase 2 build day)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Phase 2 implementation spec (frozen contract) | phase-2, compile, design, spec | Code Lead spec v1: edge-direction semantics, effective-pinned set (BFS over `imports`), deterministic Kahn ordering with `(readOrder, id)` tie-break, glob detection, §3 IPC command contract shared by both coders. | P0 | 2026-08-16 | ✅ Done |
| compile.rs — adapters + commands (Rust) | phase-2, compile, rust, backend | New `src-tauri/src/compile.rs`: GENERATED_HEADER constant; tolerant serde input model; wire-exact `CompilePreview` output; full validation (cycles with concrete path, missing files, dangling edges); three adapters (claude `@`-imports, agents markdown links + nested `AGENTS.md` for clean folder globs, cursor `.mdc` frontmatter); `compile_preview` / `compile_write` commands with output allowlist + header requirement; reused `resolve_within_root` / `write_atomic` via `pub(crate)`; 13 unit tests. | P0 | 2026-08-16 | ✅ Done |
| Rust audit of compile.rs | phase-2, compile, rust, review, security | Adversarial review found 3 medium defects: `clean_glob_dir` accepting aliasing/degenerate dirs (`./**` overwriting root `AGENTS.md`), escaping globs (`../lib/**`) turning preview into an opaque infrastructure `Err`, and unescaped YAML interpolation in `.mdc` frontmatter. | P1 | 2026-08-16 | ✅ Done |
| Fix all 3 audit findings | phase-2, compile, rust, fix | `clean_glob_dir` now does a component walk (rejects `.`, `..`, empty segments, backslashes, drive colons — dirty globs stay root bullets); escaping globs can no longer reach `resolve_within_root` in preview; new `yaml_scalar()` escapes unsafe YAML plain scalars while keeping golden outputs byte-identical. 3 tests added (23 total). | P1 | 2026-08-16 | ✅ Done |
| Frontend compile module | phase-2, compile, frontend, react | New `src/compile/`: wire types, `api.ts` (the module's only two `invoke` calls), hand-rolled LCS line-diff with hunk merging and 1M-cell DP guard, `CompileModal.tsx` phase machine (loading/errors/preview/writing/done/failed) with per-file approval, handwritten-overwrite warnings, target chips, unified diff render. Store gained `setCompileTargets`; App.tsx gained the Compile button in the TopBar. | P0 | 2026-08-16 | ✅ Done |
| UI polish pass on compile modal | phase-2, compile, frontend, design, a11y | 7 fixes against DESIGN_SPEC.md: custom ApproveCheckbox (native rendered light-scheme), dialog focus + aria roles, disabled-state hover reset, path wrapping in warning strip, empty-preview copy, keyboard-reachable collapse chevron, and a real bug — post-compile `rescan()` unmounting the whole workspace behind the modal (full-screen scanner now only when `root === null`). | P1 | 2026-08-16 | ✅ Done |
| Phase 2 verification pass | phase-2, verify, ci | Confirmed: tsc strict typecheck pass, `cargo clippy --all-targets -- -D warnings` clean, 23/23 cargo tests pass, frontend↔Rust invoke contract matches §3. No fixes needed. Two non-blocking notes recorded (see BUGS.md / BACKLOG.md). | P1 | 2026-08-16 | ✅ Done |
