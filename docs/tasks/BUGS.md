# Bugs

Known defects and issues under watch. Schema: Name, Tags, Description, Priority, Date Created, Status. Severity rides in Priority (P0 blocker · P1 high · P2 medium · P3 low). Fixed bugs stay listed until their phase closes, then roll off (history in git and TASKS.md).

## Open / watching

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Optimistic-status rollback edge in Inspector run() | phase-3, assemble, frontend, race | If enqueue rejects with "Node already queued" while the store shows "queued" from a REAL job (requires prior store/queue desync, unreachable through the disabled-button UI), rollback would unfreeze the badge; Rust's next event re-corrects it. Audit's optional `assemble_cancel(false)` → `assemble_status()` reconciliation not implemented. | P3 | 2026-08-16 | 👁 Watching |
| ClaudeRunner .exe path untested | phase-3, assemble, rust, env | Stdin-pipe path verified end-to-end against the npm `claude` on this machine; the resolver prefers a native `.exe` from `where claude`, but no `.exe` install was available to test. Verify when one exists. | P3 | 2026-08-16 | 👁 Watching |
| Real-spawn path not unit-tested | phase-3, assemble, test-coverage | All assemble tests use the fake `Runner` seam — inherent to the seam design; covered by one empirical real-`claude` check plus the Phase 3 acceptance walk (2026-08-18). No frontend test runner yet (BACKLOG: Vitest, FEATURES 9.6). | P3 | 2026-08-16 | 👁 Watching |
| merge_hooks may reorder unrelated settings.json keys | phase-4, hooks, cosmetic | First-time merge re-serializes with serde_json sorted key order, so the confirmation diff may show unrelated keys reordered (values preserved exactly; already-installed files round-trip byte-verbatim). Fix needs serde_json `preserve_order` feature. | P3 | 2026-08-16 | 👁 Watching |

Note: `cargo test` reporting 0 tests for the `main.rs` binary and doc-tests is expected, not a bug — all 88 tests live in `cowtext_lib`.

## Rolled off (phases closed)

All phases 0–6 were accepted 2026-08-18, so every fixed-bug section rolled off:

- **Phase 5+6 adversarial audit (2026-08-17)** — 24 confirmed findings, all fixed: 5 majors (demo-stop stale-event replay, demo accumulation persistence, assemble_done stale chime, preset-apply empty-graph guard, settings flush-on-quit) + 17 minors (TOCTOU never-clobber via `File::create_new`, integer zoom ladder, pre-gesture cue drop, `.cmd` resolution, and more). Detail: TASKS.md history + `c241b86`.
- **Phase 3+4 adversarial audit (2026-08-16)** — 6 confirmed defects, all fixed, incl. the critical ClaudeRunner argv→stdin spawn fix verified against real `claude -p`. Detail: TASKS.md history + `4f01275`.
- **Phase 2 audit (2026-08-16)** — 4 fixes (glob-dir aliasing, escaping-glob preview crash, unescaped YAML frontmatter, post-compile rescan unmount). Detail: TASKS.md history + `635ebaf`.
- **Main JS chunk size watch (2026-08-16)** — closed by the v0.0.0007 code-split (1,334 → 207 kB, `cb770d4`).
