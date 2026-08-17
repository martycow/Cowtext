# Bugs

Known defects and issues under watch. Schema: Name, Tags, Description, Priority, Date Created, Status. Severity rides in Priority (P0 blocker · P1 high · P2 medium · P3 low). Fixed bugs stay listed with status ✅ Fixed until the phase closes, then roll off.

## Open / watching

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Main JS chunk exceeds Vite size warning | frontend, build, perf | Vite reports the main chunk at 944.52 kB (> 500 kB warning threshold). Not a runtime defect — watch item; fix is the "Code-split main JS chunk" backlog task. | P3 | 2026-08-16 | 👁 Watching |

| Optimistic-status rollback edge in Inspector run() | phase-3, assemble, frontend, race | If enqueue rejects with "Node already queued" while the store shows "queued" from a REAL job (requires prior store/queue desync, unreachable through the disabled-button UI), rollback would unfreeze the badge; Rust's next event re-corrects it. Audit's optional `assemble_cancel(false)` → `assemble_status()` reconciliation not implemented. | P3 | 2026-08-16 | 👁 Watching |
| ClaudeRunner .exe path untested | phase-3, assemble, rust, env | Stdin-pipe path verified end-to-end against the npm `claude` on this machine; the resolver now prefers a native `.exe` from `where claude`, but no `.exe` install was available to test. Verify when one exists. | P3 | 2026-08-16 | 👁 Watching |
| Real-spawn path not unit-tested | phase-3, assemble, test-coverage | All 19 assemble tests use the fake `Runner` seam — inherent to the seam design; covered by one empirical real-`claude` check. Frontend fixes (race, cow interrupt, resolveProp) verified by tsc + code reading only (no frontend test runner). Manual walk before phase close. | P3 | 2026-08-16 | 👁 Watching |
| merge_hooks may reorder unrelated settings.json keys | phase-4, hooks, cosmetic | First-time merge re-serializes with serde_json sorted key order, so the confirmation diff may show unrelated keys reordered (values preserved exactly; already-installed files round-trip byte-verbatim). Fix needs serde_json `preserve_order` feature. | P3 | 2026-08-16 | 👁 Watching |

Note: `cargo test` reporting 0 tests for the `main.rs` binary and doc-tests is expected, not a bug — all 60 tests live in `cowtext_lib`.

## Fixed — 2026-08-16 (Phase 3+4 adversarial audit)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| ClaudeRunner passed prompt as argv | phase-3, assemble, rust, critical | Prompt was passed as an argument to `claude -p <prompt>`; fixed to pipe over stdin (`Stdio::piped`, concurrent write task avoiding pipe-buffer deadlock); resolver prefers `.exe` over `.cmd`. Verified end-to-end against real `claude -p --output-format json`. | P0 | 2026-08-16 | ✅ Fixed |
| Inspector run() optimistic-status race | phase-3, frontend, race | Optimistic "queued" was set after `await`, so Rust's concurrently-emitted events could be overwritten. Fixed: optimistic mark set before the invoke; rollback only if status is still "queued". | P1 | 2026-08-16 | ✅ Fixed |
| `where claude` flashed a console window | phase-3, rust, windows | `where` spawn lacked CREATE_NO_WINDOW; fixed with `.creation_flags(0x0800_0000)`. | P3 | 2026-08-16 | ✅ Fixed |
| Cow interrupted mid-step teleported | phase-5, barn, animation | Task pick-up in `cow.ts` update() could start mid-step; now guarded with `stepTo === null` so a post-interrupt task starts from the landing tile. | P3 | 2026-08-16 | ✅ Fixed |
| mapper resolveProp disagreed with EventLog | phase-5, barn, consistency | Scene used its own suffix match; now delegates to `resolveNodeId` from src/store/events.ts (suffix match kept only as DEMO_NODES fallback when the graph is empty). | P3 | 2026-08-16 | ✅ Fixed |
| AssembleProgress.error omitted instead of null | phase-3, contract, serde | Undeclared `#[serde(skip_serializing_if)]` dropped the field; removed so `error` serializes as a real `null`, matching the frozen contract and TS mirror. | P3 | 2026-08-16 | ✅ Fixed |

Rolled off (phase closed): the four Phase 2 audit fixes (glob-dir aliasing, escaping-glob preview crash, unescaped YAML frontmatter, post-compile rescan unmount) — Phase 2 accepted 2026-08-16; history in git and TASKS.md.
