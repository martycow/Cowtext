# Bugs

Known defects and issues under watch. Schema: Name, Tags, Description, Priority, Date Created, Status. Severity rides in Priority (P0 blocker · P1 high · P2 medium · P3 low). Fixed bugs stay listed with status ✅ Fixed until the phase closes, then roll off.

## Open / watching

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Main JS chunk exceeds Vite size warning | frontend, build, perf | Vite reports the main chunk at 1.33 MB as of 2026-08-17 (> 500 kB warning threshold; grew with howler + preset/handoff UI). Not a runtime defect — watch item; fix is the "Code-split main JS chunk" backlog task. | P3 | 2026-08-16 | 👁 Watching |

| Optimistic-status rollback edge in Inspector run() | phase-3, assemble, frontend, race | If enqueue rejects with "Node already queued" while the store shows "queued" from a REAL job (requires prior store/queue desync, unreachable through the disabled-button UI), rollback would unfreeze the badge; Rust's next event re-corrects it. Audit's optional `assemble_cancel(false)` → `assemble_status()` reconciliation not implemented. | P3 | 2026-08-16 | 👁 Watching |
| ClaudeRunner .exe path untested | phase-3, assemble, rust, env | Stdin-pipe path verified end-to-end against the npm `claude` on this machine; the resolver now prefers a native `.exe` from `where claude`, but no `.exe` install was available to test. Verify when one exists. | P3 | 2026-08-16 | 👁 Watching |
| Real-spawn path not unit-tested | phase-3, assemble, test-coverage | All 19 assemble tests use the fake `Runner` seam — inherent to the seam design; covered by one empirical real-`claude` check. Frontend fixes (race, cow interrupt, resolveProp) verified by tsc + code reading only (no frontend test runner). Manual walk before phase close. | P3 | 2026-08-16 | 👁 Watching |
| merge_hooks may reorder unrelated settings.json keys | phase-4, hooks, cosmetic | First-time merge re-serializes with serde_json sorted key order, so the confirmation diff may show unrelated keys reordered (values preserved exactly; already-installed files round-trip byte-verbatim). Fix needs serde_json `preserve_order` feature. | P3 | 2026-08-16 | 👁 Watching |

Note: `cargo test` reporting 0 tests for the `main.rs` binary and doc-tests is expected, not a bug — all 88 tests (as of 2026-08-17) live in `cowtext_lib`.

## Fixed — 2026-08-17 (Phase 5+6 adversarial audit, 24 confirmed findings)

Five audit lenses (sound spec, scene/Pixi, Rust Phase 6, frontend state, contract compliance) raised 28 findings; skeptic verification confirmed 24; all 24 fixed across two passes, gates re-run green after each. The majors get rows; the 17 minors are batched.

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Demo-stop replayed a stale live event | phase-5, barn, demo | Purging the demo ring made the events subscription re-dispatch the previous live tail through the mapper (spurious cue + walk). Fixed with a shrink guard on the subscription; purge stays in `setDemoMode`. | P1 | 2026-08-17 | ✅ Fixed |
| Demo accumulation persisted after stop | phase-5, barn, demo | Paper stacks / ajar props accumulated during a demo run survived demo stop until Barn remount. Fixed: demo-stop now cancels the cow queue, recounts papers from the purged ring, rebuilds props. | P1 | 2026-08-17 | ✅ Fixed |
| assemble_done chimed after all-failure batch | phase-5, sfx | Queue-drain chime keyed on a stale `assembled` count from a previous batch. Fixed with an `assembledBaseline` recorded at the busy rising edge (contract §5.5 deviation logged). | P1 | 2026-08-17 | ✅ Fixed |
| Preset Apply enabled for empty graph.json, then always failed | phase-6, presets | The never-clobber guard rejected an existing-but-empty `.cowtext/graph.json` that the UI promised to overwrite. Fixed fail-closed via `graph_is_empty()` (+2 tests). | P1 | 2026-08-17 | ✅ Fixed |
| Settings lost when app closed within debounce | phase-5, settings | 500 ms debounced persist had no close-time flush. Fixed: `flushSettings()` on beforeunload; persist failures surface as a danger banner in Settings. | P1 | 2026-08-17 | ✅ Fixed |
| 17 minor audit fixes (batch) | phase-5, phase-6, audit | Duck-recovery 400 ms math; typewriter fade under moo duck; mount-replay vs live accumulation parity; glance wipe on interrupted arrival; stale prompt-walk tile (CowTask.target now optional); integer zoom ladder (no sub-pixel camera); TOCTOU never-clobber via `File::create_new`; partial-apply reporting; preset_export overwrite guard + dialog filter; import validation of node filePaths; bare `claude` name resolved through `where` for .cmd installs; pre-gesture cues dropped (no AudioContext burst); HandoffModal unclosable during write; claude-path draft committed per keystroke; CLAUDE.md status + brainstorm-doc placement handled by the docs pass. | P3 | 2026-08-17 | ✅ Fixed |

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
