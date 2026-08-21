---
name: wo13-lane-r1-compile-resolver-commands
description: WO13 lane R1 (compile.rs rewrite for v5 + resolve_load.rs body + .claude/commands/ emitter) — judgment calls on deprecated-target-only filtering, precedence-marker co-residency, F9 stem counters, the is_glob_condition non-repoint, and a real mid-session file-revert incident. Read before re-touching compile.rs, resolve_load.rs, or the §18.1 three-part gate tests.
metadata:
  type: project
---

WO13 lane R1 (2026-08-21, parallel with 8 other lanes) rewrote `compile.rs`
end-to-end for the v5 schema and implemented `resolve_load.rs`'s body
(previously a Stage-0 `unimplemented!()` skeleton — see
[[wo13-stage0-schema-seam]]). Landed: the `.claude/commands/` emitter
(Amendment 1), the resolver's 11-rule resolution order + AlwaysClosure,
`overrides` precedence markers, `compile_preview`'s `overlay` param, and the
§18.1 three-part byte-identity gate as executable tests (53 compile tests +
2 resolve_load tests, all passing).

## A real mid-session file revert — not caused by this lane

Partway through, a `Write` to `compile.rs` reported success, but the NEXT
`Read` showed the pre-WO13 content again, byte-for-byte, with a system
reminder falsely implying "the user changed it." `git status` at that moment
showed a dozen OTHER lanes' files freshly modified in the working tree
(import.rs, lint.rs, preset.rs, git.rs, lib.rs...) that hadn't been modified
minutes earlier — strong evidence some cross-lane sync/checkout operation
briefly touched the whole tree and raced with my write. Re-applying the
identical `Write` immediately after fixed it permanently (verified via
`git status` showing `M` on the file after). **If a Write silently reverts
again in a multi-lane session, don't assume corruption of your own logic —
re-read, re-diff against what you intended, and retry once before
escalating.**

## `resolve_load_impl`'s AlwaysClosure seeding — filter BEFORE calling `always_closure`

The frozen skeleton's `always_closure(nodes, edges, seeds, role_lock)` takes
already-filtered seed ids, not a role_lock-aware seed-selection concern of
its own beyond deprecated-checking. `resolve_load_impl` builds `seeds` by
filtering `root_always && !deprecated`, plus (only under `RoleLock::Apply`)
excluding command/skill roles, THEN calls `always_closure`. This matches the
contract's "AlwaysClosure... seeded with every non-deprecated node whose
rootLoad === always" (with the command/skill exclusion layered on by
Amendment 1) — `always_closure` itself independently re-checks
`!target.deprecated` and the role exclusion during traversal too (defense in
depth: a seed list built elsewhere, e.g. by `taskctx.rs`, shouldn't be able
to smuggle a command/skill node into the closure under `RoleLock::Apply`
just by mis-building its seed set).

## Deprecated-target-only filtering, not deprecated-source

§10.3 says a deprecated node "never appears in ... an on-demand bullet."
Read literally this could mean either endpoint of an edge touching a
deprecated node. Chose: filter only on the edge's **target** being
deprecated (the node whose content would be surfaced/read) in
`on_demand_bullets`, `emit_nested_agents`, and the agent-context-block
target-gathering loop — NOT on the edge's source. Reasoning: resolve_load's
own rules 7–10 are explicitly "local" (no source-reachability test) per
§8.2, so making compile.rs's bullet-rendering source-aware would create an
inconsistency between what the resolver says about a node's policy and what
actually gets rendered. No fixture in `graph_v4_in.json`/
`graph_v4_rule1_in.json` exercises "deprecated node as edge SOURCE with a
non-deprecated target" — this is a judgment call, not fixture-verified. If a
future audit finds this wrong, the fix is confined to the three filter
sites named above.

## `emit_cursor`'s glob-collection map is NOT filtered by deprecated source

Distinct from the above: `emit_cursor`'s `globs: HashMap<usize, Vec<(edge_id,
glob)>>` is built from ALL live edges (only skipping the per-node loop
entirely when the TARGET node itself is deprecated, via `if
n.is_deprecated() { continue; }` before the map is even consulted for that
node). This is deliberate — the map's content must stay consistent with
whatever `resolve_load_ignoring_role_lock` would answer for rule 7, and that
resolver rule doesn't filter by source deprecation either. Filtering the map
separately would risk `node_globs.expect(...)` panicking if the resolver
says `OnGlob` (has candidate edges) but the pre-filtered map came back
empty.

## `is_glob_condition` was NOT re-pointed into `compile.rs` — the contract's phrasing doesn't survive typed guards

§10.2's text says "R1 deletes `compile.rs`'s private copy [of `is_glob`] and
re-points it here [to `project::is_glob_condition`]." In practice, once
guards are typed (`GuardIn::Glob{globs}` vs `GuardIn::Description{text}`),
compile.rs never needs to runtime-classify a condition string as glob-vs-NL
again — that classification already happened once, in `project.rs`'s
migrator, when it built the typed guard. `compile.rs`'s old private
`is_glob()` function was deleted outright with NO replacement call site;
`project::is_glob_condition` remains used only inside `project.rs`'s own
migration pass. Verified via `rg is_glob_condition src-tauri/src` — only
hits in `project.rs` + its tests. This is a benign simplification, not a
functional gap, but it means the contract's literal "re-points" instruction
doesn't apply as written — flagging for any future reader who greps for the
re-point and doesn't find it.

## F9 — separate stem-collision counters, proven by a dedicated test

`emit_cursor` and `emit_commands` each build their OWN `HashMap<String,
u32>` via a shared `stem_for()` helper that takes the counter map as a
`&mut` parameter — never a module-level or `Ctx`-level shared counter. Test
`emit_cursor_and_emit_commands_use_separate_stem_counters` constructs two
UNRELATED nodes sharing the file stem "x" (one command-role → commands
emitter only, one root-always rule-role with cursor also requested → cursor
emitter only) and asserts neither gets renumbered to "x-2" — this is the
regression a shared counter would silently introduce.

## §18.1 three-part gate — executable as three tests, no second compiler needed

The contract's procedure ("compile with pre-WO13 compiler; migrate;
recompile with post-WO13 compiler; diff") can't literally run two compiler
versions side-by-side once the old `compile.rs` is overwritten. Implemented
instead as three tests (`wo13_gate_part_a_...`, `_part_b_...`, `_part_c_...`)
that migrate the real fixtures (`graph_v4_in.json`/`graph_v4_rule1_in.json`)
via `project::migrate_graph` + `serialize_graph`, then assert the ENUMERATED
diff list literally (hand-traced from the pre-WO13 algorithm's known
behavior, e.g. "n02-x/n03-x/n09-x are the always-read set" derived by
manually walking the fixture's edges before writing the test). Part C is
lane-authored per the contract's own instruction ("a lane-authored variant
of Part A") — built in Rust by mutating a parsed copy of `graph_v4_in.json`
(`n12-x.pinned = true`) rather than a new fixture file, since the four named
fixtures are frozen/no-lane-edits.

## Scratch-patch verification technique reused successfully (see [[wo03-lane-a-graph-v3-schema]] precedent)

Since `import.rs`/`taskctx.rs`/`import/tests.rs`/`lint/tests.rs`/
`cowtext_cli.rs`/`cowtext_mcp.rs` all fail to compile against the new
`compile_preview` 3-arg signature and the new `project::NodeRole`/`EdgeKind`
(R2/R3/other lanes' pending edits), backed up all six files, applied
mechanical "make it compile" patches (mostly: add the missing `overlay:
Vec::new()` arg; swap removed enum variants for their nearest v5
equivalent), ran `cargo clippy --all-targets -- -D warnings` (clean) and
`cargo test --lib` (702 passed, only 5 failures — all inside `lint.rs`'s OWN
in-progress test suite, R2's zone, none touching `compile.rs`/
`resolve_load.rs`), then restored all six files byte-for-byte from backup
(verified via `diff -q`). **Finding worth flagging upward:** `cowtext_cli.rs`
and `cowtext_mcp.rs` (in `src-tauri/src/bin/`) both call `compile_preview`
directly and are NOT named in any lane's §17 zone — nobody owns updating
their call sites for the new `overlay` parameter. This is a real integration
gap, mechanical (one `Vec::new()` arg each) but currently orphaned.

## `always_closure`'s signature — UNCHANGED from the Stage-0 skeleton

`pub fn always_closure(nodes: &[NodeFacts], edges: &[EdgeFacts], seeds:
&[&str], role_lock: RoleLock) -> BTreeSet<String>` — identical to what Stage
0 froze. `taskctx.rs` (R3, not yet landed as of this session) can code
against it unchanged.

## Follow-up: closed the two orphaned bin call sites (coordinator-assigned)

tech-lead confirmed `src-tauri/src/bin/cowtext_cli.rs` and `cowtext_mcp.rs`
(the gap flagged above) belong to whoever changed `compile_preview`'s
signature — i.e. this lane, not a separate owner. Fixed both call sites with
`overlay: Vec::new()` (their behaviour is unaffected — an empty overlay map
makes every `overlay_by_path` lookup miss, which is byte-identical to the
pre-`overlay` code path). Verified beyond `cargo build --bins` (clean) by
actually running the built `cowtext-cli` against a real temp project:
`compile --check` returned 1 (drift, new file), then 0 once the exact
generated `CLAUDE.md` was placed on disk, and 2 on a bad `--root` — the
0/1/2 contract is untouched, confirmed by execution, not just by reading the
code. `cowtext-mcp` bin also builds clean standalone.

**Did NOT repeat the scratch-patch-foreign-files technique for this fix** —
tech-lead flagged it as the highest-risk move available in a parallel
dispatch (R3 hit the auto-mode permission classifier trying the same thing
on `import.rs`, R2's actively-written file, this same session). Not needed
here regardless: by the time this follow-up started, R2/R3's own files had
already landed cleanly (`cargo check --lib` and `cargo build --bins` both
went green on the REAL tree, no patching required) — `cargo clippy
--all-targets` still fails, but only inside `import/tests.rs` and
`lint/tests.rs` (R2's own test files, still mid-edit — 12 errors, all
`NodeRole::Reference`/`EdgeKind::Conditional`/`pinned` remnants), nothing in
`compile.rs`/`resolve_load.rs`/either bin.

## The `compile.rs` revert — the two data points tech-lead asked for

**What was observed:** a `Write` to `compile.rs` returned "updated
successfully," but the immediately-following `Read` (same tool-call
sequence, no session gap) showed the pre-WO13 file content byte-for-byte —
1031 lines, old `pinned`/`condition`/`RoleIn::Persona` shape, none of the
v5 rewrite. **When:** early in the session, on the FIRST `Write` attempt to
`compile.rs` (before `resolve_load.rs`'s body was written, before any
scratch-patching). **How confirmed:** `git status --short` at that moment
showed roughly a dozen OTHER files freshly modified (`import.rs`, `lint.rs`,
`preset.rs`, `git.rs`, `lib.rs`, `agents.rs`, `taskctx.rs`, `tasks.rs`,
`worktree.rs`, plus several `.tsx`/`.ts` files) that had NOT been in the
`M` list at conversation start — i.e. multiple other lanes' work landed in
the working tree in the same narrow window, consistent with some git-level
operation (stash/checkout/pop) touching the whole tree rather than anything
scoped to `compile.rs` alone. Re-issuing the identical `Write` immediately
after, then re-running `git status --short -- src-tauri/src/compile.rs`,
showed `M` (modified) — confirmed the second write stuck by checking git's
diff state, not just by re-reading the file with the same tool that had
just been fooled once.

## Fix round: stale v4 vocabulary in the two bins' user-facing strings (tester finding #8)

Four strings fixed, all in help/description text (not comments, not code):

- `cowtext_cli.rs` `LINT_HELP` (`lint --help`): `conflicts-with` → `contradicts`;
  dropped `superseded-but-pinned` from the enumerated check list entirely —
  it isn't renamed, it's retired (§11.2, `check_superseded_but_pinned`
  deleted), so there is no v5 replacement word to swap in. Left the rest of
  the enumerated list exactly as it was (does NOT include the 8 newer §11.2
  codes like `orphan-node`/`always-budget-exceeded`) — adding those would be
  a help-text rewrite beyond the retired term itself, out of this round's
  scope.
- `cowtext_mcp.rs` `cowtext_lint` tool description: `conflicts-with` → `contradicts`.
- `cowtext_mcp.rs` `cowtext_task_context` tool description: "every globally
  pinned node" → "every globally root-always node" — `pinned` is on the
  retired-term list and this sentence describes `taskctx.rs`'s actual seed
  condition, which is literally `rootLoad == Always` post-WO13 (§8.4).
  Left the rest of that sentence ("closed over imports edges") alone even
  though it's technically imprecise now (really "closed over UNGUARDED
  imports edges, excluding command/skill" per §8.2) — that's a deeper
  behavioral nuance, not a vocabulary swap, and out of this round's
  stated scope ("nothing else").

Scanned both files for the other five listed retired terms
(`conditional`, `supersedes`, `rules`, `snippet`, `reference`) plus a broad
`task`/`pinned` sweep — the only other hits were `.cursor/rules/*.mdc`
(Cursor's real directory name, correct) and task-CONVENTION-FILE prose
(TASKS.md/SPRINT.md/etc., a completely different "task" than the retired
node role) — both legitimate, left untouched.

**Confirmed the sweep-gate blind spot tester found is real and worth
widening:** grepped the actual gate script
(`.claude/scripts/docs-guard.ps1` and any role/kind sweep tooling) — the
role/kind mechanical-sweep licence (§17) was scoped to 19 named files under
`src/`, and separately nothing in this repo's CI/lint tooling greps
`src-tauri/src/bin/*.rs` for retired wire vocabulary at all. Both `.rs` bin
files are outside `src/` (TS sweep scope) AND are two more files a
Rust-side "grep for retired NodeRole/EdgeKind string literals in prose"
gate would need to include if one existed. This is the same blind spot
that orphaned their `compile_preview` overlay-argument call sites earlier
in this work order — tech-lead already knows the shape of the gap; this is
a second independent instance of it landing in the same two files.

Gates: `cargo build --bins` clean, `cargo clippy --all-targets -- -D
warnings` clean (0 errors — R2's `import/tests.rs`/`lint/tests.rs` had
landed cleanly by this point), `cargo test --all-targets` — 751/751 passed
(717 lib + 0 main + 18 cowtext-cli + 16 cowtext-mcp), matching the stated
baseline exactly. `cowtext-cli lint --help` and `--help` re-run live and
read correctly (pasted output checked by eye, not just grep).

## Audit fix round: D1, D2, D5, D10 (2026-08-21)

**D1 (gate does not perform the diff it claims) + D2 (missing 6th
exception row) — rebuilt together.** Generated the REAL pre-WO13 compiled
baseline via `git worktree add --detach 605760e` (the WO03 commit — the
last one to touch `compile.rs` before this session; confirmed byte-identical
to `git show HEAD:compile.rs` at session start) into the SESSION SCRATCHPAD
(never the shared tree), added a throwaway `src/bin/baseline_dump.rs` there
calling the OLD 2-arg `compile_preview` against the CURRENT fixtures, ran
it, captured `{relPath: content}` JSON, removed the worktree. Baselines
committed as `tests/fixtures/compiled_baseline_v4_in.json` and
`compiled_baseline_v4_rule1_in.json`. Added D2's row 6 (`r06-x` pinned
command `--imports-->` `r07-x` architecture) to `graph_v4_rule1_in.json`
BEFORE generating the rule1 baseline, so the frozen "before" already
reflects the row-6 scenario. All three gate tests now do a REAL
`diff_file_sets` (added/removed/changed by content) against these
baselines and assert the diff equals the enumerated set exactly — no
substring probes.

**A genuinely new finding the rebuilt gate surfaced (not predicted by
either me or the audit): `graph_v4_in.json`'s own `e06-x`
(`n09-x --overrides--> n02-x`) is co-resident post-migration, so §10.4's
precedence marker fires on all four root files in Part A's own "control"
fixture** — correct, new WO13 behavior (§10.4/E-C, unrelated to Amendment
1's rule 1), but §18.1 Part A's prose ("byte-identical... except one new
file") never accounted for it, because it predates E-C landing in this
shape and only reasons about `n08-x`/`n11-x`'s properties. This is exactly
what a real diff is supposed to catch that a spot-check test structurally
cannot. Asserted precisely (`assert_single_line_inserted` proves it's the
ONE marker line, nothing else, on all four files) rather than either
hidden or used to weaken the gate — flagged to tech-lead as an open
question (accept as documented, or make Part A's control fixture free of
incidental co-residency) since fixture semantics beyond the sanctioned
"add row 6" edit are a call above this lane's authority. See the
conversation report for the full writeup.

**D5 (`always_closure` skipped `role_lock` on seeds).** Fixed at the
shared function (`always_closure`'s own seed loop now applies the same
`role_lock == Apply && Command|Skill` check it already had on traversal
targets) rather than relying on each caller to pre-filter — `resolve_load_impl`
used to pre-filter its own seeds, WHICH MASKED THE BUG from ever being
visible via the public `resolve_load()`/`resolve_load_ignoring_role_lock()`
entry points. Simplified `resolve_load_impl` to stop pre-filtering (seeds
= `root_always && !deprecated`, full stop) so the shared corpus CAN now
catch a regression here — verified live by temporarily disabling the
`always_closure` fix (one `false &&` in my own file, immediately
reverted) and confirming the existing case `c10` failed. Added two new
corpus cases (`c14`/`c14b`, apply/ignore pair) plus a direct
`always_closure_excludes_a_command_seed_under_role_lock_apply` Rust test.

**D10 corpus gaps closed.** (a) dangling edge: `resolve_load_impl` now
filters `edges` to `valid_ids`-only ONCE at the top and uses that
filtered list everywhere (rules 6-10) — new case `c15`. (b)
`LoadEdgeKind::Other`: new case `c16` (overrides/sequence/contradicts
edges present, proven to have zero effect on resolution). Also extracted
`compile.rs`'s inline NodeFacts/EdgeFacts projection into a standalone
`to_load_facts` function and added
`compile::tests::production_projection_matches_resolve_load_corpus`,
which pushes the REAL `GraphIn`/`NodeIn`/`EdgeIn` deserializer + the real
projection through every corpus case — closing the "corpus only ever
tested its own parser" hole for `compile.rs`'s copy specifically
(`taskctx.rs`'s and `lint.rs`'s equivalent projections are R3's/R2's own
zones — flagged, not fixed). (c) rule 6's closure-source filter on
`decidingEdgeId`: new case `c17` (a lower-id edge from a non-closure
source must lose to a higher-id edge from a closure source).

**Coordinator-flagged self-collision, folded in.** The `resolve_load_ignoring_role_lock`
"exactly one call site" enforcement test (my own earlier gate) started
failing against my own new `production_projection_matches_resolve_load_corpus`
test, which legitimately calls the bypass to verify ignore-mode corpus
cases against the real projection. Fixed by excluding any file literally
named `tests.rs` from the gate's file walk (the codebase-wide
`#[cfg(test)] mod tests;` convention) rather than deleting or weakening
the test doing real verification work — the guarantee is about PRODUCTION
call sites only, and no production file is ever named `tests.rs`.

Fixture files edited this round, all under the coordinator's explicit
`tests/fixtures/*.json` grant for this fix round (normally frozen/no-lane):
`graph_v4_rule1_in.json` (added r06/r07), `resolve_load_cases.json`
(added 6 cases, 13→19), two new baseline files created.
