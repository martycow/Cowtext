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
| B2: Selecting an agent in Hierarchy crashes to white screen | unproven | high | wo11, ui, crash, render |  | 2026-08-20 | Marty reported selecting every agent in the rail, on-graph and off-graph, produces a blank window (unmounted React tree, ErrorBoundary fires on throw). WO11 Stage 0 added global ErrorBoundary rendering component stack + message + Reload. All confirmed code defects on this path fixed (bare-`/` split in `Inspector.tsx:1004` → `canonPath`, backslash-stored node handling). Crash itself remains unproven from headless shell — requires live reproduction with `npm run tauri dev` to capture JS stack or Rust panic line. |
| C1: "Adopt to graph" on off-graph agent crashes to white screen | unproven | high | wo11, ui, crash, render |  | 2026-08-20 | Marty reported clicking "Adopt to graph" in the Inspector's Actions section produces a blank window. WO11 Stage 0 added ErrorBoundary. All confirmed code defects on the adoption path fixed (`AgentNodePanel`'s `fileName` derivation, graph selection priority seam). Crash remains unproven from headless — live reproduction required. |
| F1: Assemble-after-close then Finish crashes to frozen window | unproven | high | wo11, frontend, crash, assemble |  | 2026-08-20 | Marty reported closing the Node Wizard while "Assemble after close" is ticked, or pressing Finish then closing mid-assemble, produces a frozen window (no pixel-march, no error). **WO11 Stage 0 investigated the Rust hypothesis** (mutex poisoning from `assemble.rs` panic) **and refuted it**: every critical section in the queue is panic-free (enqueue = dup-check + push; status/cancel = Vec ops; pump = pop + push); crucially, `run_job` — the only fallible code path doing child-process spawn and file IO — executes after the lock guard is dropped (inside the async task). So a panic there cannot poison the mutex. **The JS side is the stronger suspect.** UI-A found and fixed one structural difference: `NodeWizard.tsx`'s `assembleNode(...).catch(...)` was a detached, un-awaited promise chain (unlike the working sibling paths in `Inspector.tsx`'s `AssembleSection.run` and `MemoryNodeCard.tsx`'s `runAssemble`, which are both awaited inside the same try/catch). That may be the fix; it is not claimed proven. Requires live reproduction with `npm run tauri dev`. **Diagnostic tell:** if the ErrorBoundary does not fire but the window blanks or freezes, check devtools Console for an unhandled rejection at the same moment, and the OS process list (Task Manager) for whether `cowtext.exe` is still alive — a dead process would indicate a genuine `panic=abort`, ruling out every mutex theory and pointing toward a segfault or OS-level crash. WO11 §11's `AGENT_FS: Mutex<()>` recovery shape is a good template if F1 ever does trace to a Rust mutex, but that path has been walked and closed. |
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
