---
name: wo11-lane-r2-agents-backend
description: WO11 lane R2 (agents backend) — agent_memory_status, avatar commands, agent_save->AgentDoc, rename/delete avatar follow-through in src-tauri/src/agents.rs. Read before touching agents.rs avatar/memory-status code again.
metadata:
  type: project
---

Landed 2026-08-20. Full spec: `docs/design/WO11_CONTRACT.md` §4.2/§4.3/§5.7/§5.11.
Zone was exactly `src-tauri/src/agents.rs` + `agents/tests.rs` +
`src/agents/api.ts` + new `src/agents/avatarApi.ts`. `lib.rs` was explicitly
NOT mine (lane R1) — the 4 new commands compile but sit unregistered until
R1 lands `generate_handler!` entries; that's expected, not a defect.

**The dead_code trap recurred exactly as [[wo06-stage0-seams]] documents,
worth re-reading before any future "land backend before its lib.rs
registration" lane.** `cargo clippy --all-targets -- -D warnings` did NOT
save these new items from dead_code despite `agents/tests.rs` calling every
one of them — that WO06-memory claim ("--all-targets compiles #[cfg(test)]
so tests count as usage") only held there because the flagged items were
ALSO reachable via already-registered Stage-0 stub commands. Here nothing
new was registered yet, so the PLAIN (non-test) lib build's reachability
graph from `pub fn run()` still sees all 13 new symbols (2 structs, 2
consts, 9 fns including the 4 `#[tauri::command]` fns themselves) as dead,
and that plain build fails before cargo even gets to the test variant —
so `--all-targets` aborts on the untested-reachability build regardless of
what the tests exercise. Fix: individual narrow `#[allow(dead_code)]` on
each of the 13 items (not a wrapping module — `project.rs`'s `graph_v3`
submodule trick is unsafe to use across `#[tauri::command]` macro boundaries,
since the macro emits a sibling `__cmd__*` item at the same scope that
`generate_handler!` needs to resolve at the exact un-nested path). Helper
fns already called by pre-existing *registered* commands (`avatars_dir`,
`find_avatar_path`, `clear_avatar_files`, `move_avatar_best_effort`,
`AVATAR_EXTS`) were NOT flagged — `agent_rename`/`agent_delete` already
existed and are already in `generate_handler!`, so wiring the avatar
follow-through into their bodies made those helpers reachable for free.

**Design decisions, not fully spelled out by the contract:**
- No `image`/base64 crate (ratified, ASK #2) — hand-rolled a ~15-line
  standard base64 encoder and a magic-byte sniffer (`detect_image_ext`,
  order: PNG 4 bytes / JPEG 3 bytes / WebP RIFF..WEBP 12 bytes / GIF 6
  bytes). Format check runs before the 512 KB size check (matches contract
  prose order); a `.txt` renamed to `.png` and a 600 KB real PNG hit
  different error strings and are tested separately.
- Binary writes needed a new `write_atomic_bytes` (byte-slice sibling of
  `project::write_atomic`) since the existing one takes `&str`. Deliberately
  does NOT call `watcher::note_self_write` — confirmed by reading
  `watcher.rs`'s `classify`/`is_scannable_md` that avatar files under
  `.cowtext/avatars/` can never produce an `fs://change` event regardless
  (non-`.md`), so the self-write registry is moot for this path.
- Avatar destination path is doubly defended: `stem` passes
  `validate_component` (no `/\:` or control chars) AND the final join still
  goes through `resolve_within_root` — belt-and-braces per the module's own
  existing doctrine, even though either alone would already block traversal.
- `move_avatar_best_effort` (agent_rename follow-through) has a same-stem
  early return (`dest == src`) — without it, a case-only or identical-name
  rename would call the sibling-clear step first, which is stem-based and
  case-insensitive, and would delete the very file about to be moved before
  `fs::rename` ever ran. Caught by a dedicated regression test
  (`agent_rename_to_same_stem_case_change_keeps_avatar_intact`) mirroring
  the existing `agent_rename_to_identical_name_is_a_harmless_noop` case.
- `agent_save`'s new `Result<AgentDoc, String>` reuses the existing private
  `save_doc` (untouched, still `Result<(), String>`, still shared with
  `skill_save`) — `agent_save` just re-reads the file off disk after
  `save_doc` succeeds and rebuilds the `AgentDoc` via the existing
  `doc_from_content`. No duplication of the raw/fields ambiguity-guard
  logic. Round-trip byte-identity gate covered directly
  (`agent_save_returns_doc_matching_bytes_on_disk`).
- `agent_memory_status`'s `healthy` reads the WHOLE index file into memory
  for the UTF-8 check (`fs::read` + `str::from_utf8`) — fine at MEMORY.md
  index-file scale, don't over-engineer a streaming check here.

Test delta: +26 tests in `agents/tests.rs` (67 agents-module tests total,
all passing). Gates at handoff: `cargo clippy --all-targets -- -D warnings`
clean, `cargo clippy -- -D warnings` (no `--all-targets`) also clean,
`cargo test` (lib + cli) all green, `npx tsc --noEmit` clean, `npm run
lint` 0 errors (1 pre-existing `RoleGlyphs.tsx` warning, not mine), `npm
run build` succeeds.

See also [[wo06-stage0-seams]] for the original version of this trap.

**Fix-round follow-up 1 (LOW, tester audit #4):** `agent_avatar_set` read the
whole `source_path` into memory before checking the 512 KB cap. Fixed by
`fs::metadata` stat-first, reject-on-length, before ever calling `fs::read`.
Same error message/semantics, existing oversize test untouched; added a
sibling test using a **sparse file** (seek to 2 GB, write one byte) asserting
near-instant rejection — proves the stat-first path is actually exercised,
not just re-testing the small-file case.

**Fix-round follow-up 2 (HIGH, WO11 landing blocker — Amendment 2, contract
§11): `agent_save`/`agent_rename` TOCTOU.** Dispatcher initially routed this
as "verify only, tester believes `save_doc`'s `path.is_file()` fails
cleanly" — that hypothesis was WRONG and my refutation (with a deterministic
single-threaded repro, no real threads needed since it's an ordering bug)
changed tech-lead's ruling from LOW/no-op to HIGH/blocker. **Lesson: when
asked to "just verify, don't fix," actually verify by reproducing — don't
trust the asker's framing of the likely answer.** The bug: `save_doc`'s
`path.is_file()` guard is a *probe*, not a lock; `write_atomic` is
create-or-replace (never re-asserts the target existed), so an `agent_rename`
landing between the probe and the write resurrects the OLD filename as an
orphan holding the save's edit, while the real renamed file never receives
it — silent duplication + data loss, `agents_scan` then reports the orphan as
a second real agent.

**Fix mechanism (frozen by the ruling, not my design):** one module-scope
`static AGENT_FS: Mutex<()>` in `agents.rs`, never `.expect()`'d
(`.unwrap_or_else(|poisoned| poisoned.into_inner())` — recovers from
poisoning instead of cascading into a second `assemble.rs`-style
thirteenth-`.expect()` trap). Every command whose body calls `checked_root`
takes it immediately after (16 commands total: all mutating agent/skill
commands **plus** the three read-only ones — `agents_scan`,
`agent_avatar_read`, `agent_memory_status` — since a scan mid-rename would
otherwise observe a half-moved directory). Landed as a single `replace_all`
Edit inserting `let _guard = agent_fs_guard();` right after every
`let root_path = checked_root(&root)?;` line — all 16 call sites shared that
exact literal text, so one Edit call covered the whole module safely.
**Explicitly NOT fixed in `write_atomic`** (`project.rs`, not this lane's
file): 17 call sites across 11 modules, 14 of which need create-if-absent;
only 3 (all in `agents.rs`) want replace-only, so the fix stays local by
construction — never assume the general-purpose primitive should absorb a
narrow caller's stricter need. Helpers (`save_doc`, `rename_patch_name`,
`move_avatar_best_effort`, avatar helpers) stay deliberately lock-free and
are only ever called *under* a command's own guard — a helper that
self-locks is how a `Mutex<()>` deadlocks. No second `is_file()` re-check
was added before any `write_atomic` call — once the lock holds, a re-check
defends nothing and just re-teaches the mistaken belief that produced the
bug.

**Proving the fix — inverted the original repro instead of deleting it**
(`agent_rename_during_save_never_resurrects_the_old_file`, plus a
`skill_save`/`skill_rename` twin since `save_doc` is shared). The original
single-threaded manual-interleaving repro technique does NOT work as an
inverted proof: it called raw `fs`/`write_atomic` primitives directly,
bypassing `AGENT_FS` entirely, so it would "prove" the bug persists even
after the fix (false negative). The correct inversion uses **real
`std::thread::spawn`** calling the actual `agent_save`/`agent_rename`
command functions concurrently, then asserts the invariant that holds
regardless of which thread's critical section wins the race (both orderings
are safe by construction once the lock serializes full command bodies):
either the renamed file carries the edit, or the losing save fails cleanly
with "No such agent" — never both a resurrected orphan and the real file.
Looped 25 trials per test since real thread scheduling nondeterministically
picks the winner; ran an extra 5x standalone to confirm no flakiness before
reporting.

Test delta from the fix round: net +1 (removed 1 pre-fix repro, added 2
post-fix proofs) → 583 lib + 18 CLI = 601 total.

**Fix-round follow-up 3 (HIGH, WO11 landing blocker — Amendment 3, contract
§12): `write_md_file` was a second, uncoordinated writer to agent files.**
Zone extended for this one item only: `src-tauri/src/project.rs`, fenced
strictly to `write_md_file`'s rejection arm (plus `project/tests.rs`) — the
rest of `project.rs`, especially `write_atomic`, stays untouched and out of
scope. Different mechanism from §11: this is a stale-read/lost-update across
*human* time (the Markdown tab could hold a buffer open for minutes), not a
microsecond ordering bug, so `AGENT_FS` does NOT apply here — tech-lead
explicitly rejected extending it. The fix is a single new rejection arm
beside the existing `.claude/settings.json` one, matching
`.claude/agents/*.md` (normalized: `.replace('\', "/").to_ascii_lowercase()`
then `starts_with`/`ends_with` — the same idiom `agent_convert` and
`is_rename_protected` already use in this codebase; explicitly NOT a bare
`==`/`split("/")` comparison per the standing rule after seven prior defects
of that shape) → `Err("Use agent_save to write an agent file")`. Skills
(`.claude/skills/`) are a different prefix and pass through untouched by
construction — no separate carve-out logic needed, just don't over-broaden
the prefix to `.claude/`.

**Tooling trap hit while editing:** a Bash heredoc + Python string-literal
splice to insert the new function body silently collapsed `'\'` (a Rust
char-literal backslash) to `'\'` (invalid syntax) somewhere across the
heredoc→Python→Rust-source escaping layers — caught immediately by
`cargo build`, but worth remembering: for edits containing literal
backslashes inside Rust string/char literals, prefer the dedicated Edit tool
(exact-string, no shell/heredoc escaping) over Bash+heredoc+sed/python
splicing. Fixed with two direct Edit-tool calls once diagnosed.

Tests added this round (3): `project::tests::write_md_file_rejects_agent_paths`,
`project::tests::write_md_file_still_allows_skills_and_ordinary_md_files`,
`agents::tests::write_md_file_rejects_agent_paths_variants` (companion to the
pre-existing `write_md_file_rejects_settings_json_variants`, same file, same
pattern). Final count after this round: 586 lib + 18 CLI = 604 (R1's `git.rs`
landed concurrently in the shared tree, adding its own tests on top of mine).

This closed all three amendments (§11 lock, §12 write_md_file guard) — WO11
feature-complete for lane R2 as of this round.
