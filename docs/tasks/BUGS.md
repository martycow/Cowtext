# Bugs

Known defects and issues under watch. Schema: Name | Status | Priority | Tags | Agent | Created | Description.

Fixed bugs stay listed until their phase closes, then roll off (history in git and TASKS.md).

## Fixed (current phase)

| Name | Status | Priority | Tags | Agent | Created | Description |
|---|---|---|---|---|---|---|
| Stale comment in MemoryNodeCard.tsx: describes nonexistent three-handles architecture (WO09) | done | minor | wo09, comment, connector, architecture | tech-ui | 2026-08-19 | Lines 13-16 described three handles per side + pickHandles function contradicting real single-handle/no-id JSX. Fixed: comment text rewritten to match contract §6 and real implementation. Blamed to 7122ee1 (2026-08-18) but refreshed in WO09 lane. |
| Stale comment in MemoryEdge.tsx: per-kind stroke table (2px/4px vs actual 3px/5px) (WO09) | done | minor | wo09, comment, stroke, connector | tech-ui | 2026-08-19 | Lines 8-14 listed per-kind stroke widths (2px/4px) with every dash value off by one vs real const (3px/5px). Fixed: comment text updated to reflect actual stroke table. Blamed to 7122ee1 (2026-08-18) but refreshed in WO09 lane. |
| skipCurrent async race in review queue (WO01 Block C) | done | critical | wo01, block-c, compile, review, race |  | 2026-08-18 | If user clicks Compile on different node while prior diff streams, skipCurrent remains set. Next comparison silently skips lines. Fixed: clear at compile_preview start or guard against stale nodeId. |
| Frontmatter re-quote churn on any agent_save | done | critical | agents, frontmatter, data |  | 2026-08-18 | should_touch_key() now rewrites only when value actually changed. Descriptions with ': ' mid-sentence were being requoted on every save. |
| Orphan-key precedence race in sidecar | done | critical | agents, store, persistence, race |  | 2026-08-18 | Live meta now wins over orphan on serialize; reconcileOrphan on createAgent/rename. Old orphan could silently discard freshly-entered metadata. |
| Case-insensitive rename collision on Windows | done | medium | agents, rename, windows |  | 2026-08-18 | agent_rename now guards: if dest.exists() && dest != src. Renaming Foo.md → foo.md on Windows now works. |
| AgentEditor/SkillEditor Save button bypasses busy lock | done | medium | agents, inspector, modal, race |  | 2026-08-18 | Saves now route through AgentsModal's phase machine via onSave prop. Bypassed busy lock allowed mid-save row clicks. |
| refreshHooksStatus race: stale project state | done | critical | uxbatch, hooks, store, race |  | 2026-08-18 | Guard with if (get().root !== capturedRoot) return. Slow probes for old project could overwrite new project state. |
| TitleField stale-closure rename-collision bug | done | critical | uxbatch, inspector, race, rename |  | 2026-08-18 | TitleField not keyed per node. Stale callbacks painted errors under wrong node. Key by node id or add id guard. |
| reveal_path failures silently swallowed | done | critical | uxbatch, ui, reveal, silent-fail |  | 2026-08-18 | All 6 sites did .catch console.error with no UI. Implement toast system or surface errors inline per control. |

## Open / watching

| Name | Status | Priority | Tags | Agent | Created | Description |
|---|---|---|---|---|---|---|
| Optimistic-status rollback edge in Inspector run() | new | low | phase-3, assemble, frontend, race |  | 2026-08-16 | If enqueue rejects while store shows queued (unreachable via UI), rollback unfreeze badge. Audit's optional reconciliation not implemented. |
| ClaudeRunner .exe path untested | new | low | phase-3, assemble, rust, env |  | 2026-08-16 | Stdin-pipe path verified against npm claude; .exe resolver untested. Verify when .exe install exists. |
| Real-spawn path not unit-tested | new | low | phase-3, assemble, test-coverage |  | 2026-08-16 | All assemble tests use fake Runner; covered by empirical real-claude check + Phase 3 walk. No frontend test runner yet. |
| merge_hooks may reorder unrelated settings.json keys | new | low | phase-4, hooks, cosmetic |  | 2026-08-16 | First-time merge re-serializes with serde_json sorted order. Values preserved; needs preserve_order feature. |

Note: `cargo test` reporting 0 tests for `main.rs` binary and doc-tests is expected — all tests live in `cowtext_lib`.

## Rolled off (phases closed)

All phases 0–6 were accepted 2026-08-18, so every fixed-bug section rolled off:

- **WO01 Block A adversarial audit (2026-08-18)** — 2 findings, both FIXED in the fix round before re-gate (cargo test 169/169): 1 MAJOR (Windows notify rename halves: `map_event_kind` now maps `Modify(Name(From))` → Remove and `Modify(Name(To))` → Create ahead of the catch-all — no more ghost entries with false-fresh mtime under the Activity lens) and 1 MINOR (watcher `flush` TOCTOU: generation re-checked per pending entry via `flush_with`, so a project switch mid-batch stops emission at the flip point). +4 regression tests in `src-tauri/src/watcher/tests.rs`.
- **Phase 5+6 adversarial audit (2026-08-17)** — 24 confirmed findings, all fixed: 5 majors (demo-stop stale-event replay, demo accumulation persistence, assemble_done stale chime, preset-apply empty-graph guard, settings flush-on-quit) + 17 minors (TOCTOU never-clobber via `File::create_new`, integer zoom ladder, pre-gesture cue drop, `.cmd` resolution, and more). Detail: TASKS.md history + `c241b86`.
- **Phase 3+4 adversarial audit (2026-08-16)** — 6 confirmed defects, all fixed, incl. the critical ClaudeRunner argv→stdin spawn fix verified against real `claude -p`. Detail: TASKS.md history + `4f01275`.
- **Phase 2 audit (2026-08-16)** — 4 fixes (glob-dir aliasing, escaping-glob preview crash, unescaped YAML frontmatter, post-compile rescan unmount). Detail: TASKS.md history + `635ebaf`.
- **Main JS chunk size watch (2026-08-16)** — closed by the v0.0.0007 code-split (1,334 → 207 kB, `cb770d4`).
