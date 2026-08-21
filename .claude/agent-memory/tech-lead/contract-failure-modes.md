---
name: contract-failure-modes
description: The eleven recurring defect classes Cowtext work-order contracts must pre-empt, distilled from the WO02, WO03, WO06, WO11 and WO13 audits
metadata:
  type: project
---

Every Cowtext contract I write must close these nine classes up front, because each has
already shipped a real defect once:

1. **Rust writes a file the Zustand store also owns → store clobbers it.** WO03-D1:
   `import_apply` wrote `graph.json`; the store's 700 ms debounced `flushSave` overwrote it
   with stale in-memory nodes. No error, permanent loss. Fix pattern: Rust returns a
   *proposal*, the store commits through its own actions — or the caller must `loadGraph`
   immediately (the `PresetsModal` precedent).
2. **Two serializers, two collations — and its cousin, two notions of path equality.** WO03-D5:
   Rust `String::cmp` vs TS `localeCompare` on ids containing `-` reorder a git-tracked file on
   every alternating write. Fix pattern: one writer owns the file, or both sides pin byte order
   with a fixture test.
   **A "we fixed that" verdict does not hold at new call sites.** WO10 §4 declared `sameRelPath`
   the only sanctioned `.md` path comparison; WO11 then found four fresh violations shipped
   *after* that freeze (`Inspector.tsx` and `MemoryNodeCard.tsx` doing bare `.split("/")` to get
   a basename, and graph.ts's agent-rename listener comparing with bare `===` — so a
   backslash-stored node silently isn't renamed). Standing rule I now restate in every contract:
   no bare `===` and no bare `.split("/")` on a `.md` path anywhere in `src/`. When auditing,
   grep for both rather than trusting the prior work order's closure.
3. **Incomplete zone grid.** WO03-§4.3: Lane F needed `tokens.css`/`tailwind.config.js`, which
   the grid never named. Standing rule since: any lane adding a visual variant owns additive
   token entries; and every shared parent directory gets a file-level overlap audit in the
   contract itself.
4. **Positional / implicit coupling between a Rust array and a TS array.** WO02-§7.11:
   `CONVENTION_NAMES` ⇄ `TASK_FILE_NAMES` resolved by index; reordering either writes tasks
   into the wrong file silently. Fix pattern: freeze the order in the contract and make it a
   named gate.

5. **Pre-specified interface without a pre-specified mount → the feature ships as dead code.**
   WO06-D1: §10.3 froze `TaskContextModal`'s props and told U1 to write the call site first.
   U1 didn't; U2 also invented an unassigned `TaskLinksPanel` in a new directory. Both
   components ended up imported by nothing, so the work order's entire differentiator (5 Rust
   commands, all tested) was unreachable at runtime and every gate still looked green. Fix
   pattern: a frozen cross-lane component gets **both** a signature and a named mount file+line
   in the contract, plus a gate that greps for the import.
6. **A lane silently dropped at dispatch leaves a registered stub.** WO06-D2: contract lane G2
   had three slices (tasklinks / taskctx / handoff); dispatch split it into two agents and the
   handoff slice vanished. `handoff_node_propose` shipped as the Stage-0 `Err(...)` stub while
   the 63/63 invoke count still "passed". Fix pattern: the invoke-count gate must assert no
   handler body still returns the Stage-0 stub string, and dispatch must enumerate lanes
   against the contract's §10 grid, not against the agent list.

7. **A user-reported "it breaks the app's UI" is not a diagnosable symptom.** WO11 (2026-08-20):
   Marty's acceptance walk produced three separate "breaks the UI" defects. The app had (and as
   of that contract still has) **no React error boundary anywhere** — no `componentDidCatch`,
   no `getDerivedStateFromError` — so every render-phase throw unmounts the whole tree and
   blanks the window. Three unrelated causes therefore present as one identical symptom, and
   static reading cannot separate them. Fix pattern: a global ErrorBoundary is Stage-0
   infrastructure, not a nice-to-have; and a contract must never freeze a "fix the crash" lane
   before a reproduction has named the throwing line. Say "unresolved by reading" and specify
   the diagnostic instead of guessing.

8. **A shared write helper's create-or-replace semantics silently defeat a caller's existence
   guard.** WO11: `agents.rs::save_doc` guarded with `path.is_file()`, but `project.rs::write_atomic`
   is create-or-replace (`fs::write(tmp)` → `remove` → `rename`) and never re-asserts the target
   existed. A concurrent `agent_rename` landing between guard and rename **resurrects the old
   filename** as an orphaned duplicate holding the edit — silent loss plus duplication, which
   `agents_scan` then shows as a second agent. The tester's first read ("fails cleanly") was
   wrong; R2 refuted it with a deterministic (thread-free) repro. Fix pattern: a TOCTOU probe is
   not a lock — put one module-scope `Mutex<()>` in the owning module, never a per-path map (two
   paths ⇒ lock ordering ⇒ deadlock), and **never** re-check inside the shared helper: audit its
   call sites first. 14 of `write_atomic`'s 17 sites *require* create-if-absent, so "fix it in the
   helper" would have regressed eight commands.
   Corollary: when a work order changes an explicit action into a debounced autosave, it converts
   every latent write-window race into a routine one. Re-audit concurrency whenever that happens.

9. **A second writer on a file a save queue owns — a lost update, not a race.** WO11: D4 replaced
   the agent panel's explicit Save with a debounced autosave queue, but the Inspector's Markdown
   tab kept its own independent `read_md_file`/`write_md_file` pair, and both tabs render for
   every node type. Type, switch tab before the debounce, save there ⇒ the first edit is silently
   gone; and bidirectionally, since `save_doc` re-reads and patches from disk. **A lock cannot fix
   this** — the two writes are separated by human time, not microseconds, so serializing them just
   makes the clobber orderly. Fix pattern: the queue owns both the read and the write; a surface
   that reads the file independently is already wrong before it writes. Then enforce it with a
   runtime rejection in the chokepoint command (`write_md_file` refuses agent paths, beside the
   `.claude/settings.json` arm that was already there), because documented-only invariants in this
   codebase have failed twice (see class 2).
   **Mirror-pair corollary (WO13): consistency between two implementations is not evidence
   of correctness — it is only evidence that one person wrote both.** Twice in WO13 a Rust/TS
   pair agreed with each other while both diverged from the spec: `always_closure`'s seed
   handling (D5) and the edge-legality matrix's deprecated-target rule (D15). Both times a lane
   checked cross-language agreement, found it, and reasonably stopped there. When auditing a
   mirror pair, check it against the **contract text**, never against its twin. And treat an
   unpinned mirror pair — one with no shared, tech-lead-owned fixture corpus asserted from both
   sides — as an incomplete deliverable, not a tolerable risk.
   **The tell:** replacing an explicit Save with an autosave queue is a *concurrency* change, not a
   UI change. It obliges an audit of every other reader and writer of those files in the same work
   order. Three of WO11's four highest-severity defects traced to that single omission.

10. **A gate authored by the lane it gates degrades into spot-checks.** WO13-D1: §18.1 demanded
    "compile pre-change, migrate, recompile, **diff the produced file sets**". R1 (author of both
    the emitter and its gate) shipped three `assert!(content.contains(…))` tests plus a comment
    saying the old compiler "no longer exists in this tree to run side-by-side". Four of the five
    file families the gate names were never asserted at all, and one enumerated row was vacuous by
    its own admission. 751 tests green. Fix pattern: **a byte-identity gate needs a committed
    baseline artifact, not a procedure.** Freeze the pre-change output as a fixture in the
    contract's fixture table (tech-lead-owned, lane-uneditable) so the lane cannot substitute
    a re-derivation of the expectation for the expectation.
    **The author's own failure mode, WO13 (four instances): a contract contradicts itself, and
    every lane implements both halves faithfully.** §7.3's specificity formula defeated §7.3's own
    required-rule table (D15); §18.1's exception list was incomplete three separate times, and
    **every omission was an output change specified elsewhere in the same document** (Amendment 1's
    lock, D2's closure row, §10.4's precedence marker); §14.2 asked for a control §4.1's wire shape
    cannot represent (open item 4). None was caught by any gate until something computed a real
    answer. Fix pattern: an enumerated-exception list must be **derived mechanically** from the set
    of sections that change the behaviour being gated — walk that set, don't write the list from
    the amendment in front of you. And when two sections disagree, the normative *table* states the
    intent; the *mechanism* is an implementation detail and yields.
    Cousin: **a fixture built to hit an enumerated list will hit exactly that list.** WO13-D2 —
    §18.1's five-row exception was missing a sixth (nodes downstream of a pinned `command` also
    leave `## Always read`), and neither fixture contained the edge that would expose it. When
    enumerating exceptions, derive the fixture from the *algorithm diff*, not from the list.

11. **A rule that costs a lane its ability to validate gets broken every time.** WO13: the
    zone grid was violated twice in one work order (U1 stubbed over T1's file; R1 patched five
    foreign files and "restored" them from its own stale snapshot, clobbering R2 and R3
    repeatedly) — the same incident as WO11, despite an explicit written rule. Both agents were
    making a build go green so they could check their own work, against a brief saying "the tree
    is red until integration". **Treat this as a design problem, not discipline.** Fix pattern,
    in order: (a) generate `.claude/zones/<lane>.json` from the §17 grid and enforce it with a
    PreToolUse hook, the `docs-guard.ps1` shape — a lane must be *unable* to write a foreign file,
    so stop-and-report is the only move left; (b) Stage 0 lays a compiling stub for **every**
    cross-lane seam it freezes, not just new commands, so the tree is green from the end of
    Stage 0 and the motive disappears (this already worked for `resolve_load.rs`); (c) hard rule —
    never restore a file you did not write from a snapshot you took, because your snapshot is
    stale the moment another lane writes.
    Related silent-degradation tell from the same round: a Stage 0 sweep licence that enumerates
    only TypeScript files. `#[serde(default)] pinned: bool` on a private Rust node projection is
    invisible to the compiler once the field leaves the wire — it just reads `false` forever
    (`assemble.rs`, `handoff.rs`, WO13-D11). Any wire-field rename needs both halves of the sweep.

**Why:** these are the defects that cost extra audit rounds in WO02, WO03, WO06, WO11 and WO13;
all eleven are seam defects, invisible inside any single lane's diff — every lane in WO06 reported
success, and WO13 passed clippy, 751 Rust tests, tsc, the production build and 95 Vitest specs
with five HIGHs open.

**How to apply:** when drafting a contract, walk each new command against all eleven before
freezing. When auditing, check them first — they are where the confirmed CRITICALs have been.
For 5 and 6, the fastest check is mechanical: grep every new component for an importer, and
grep for `Stage-0 stub` in the merged tree. For 10, read the gate's assertions against the
gate's own prose sentence by sentence — the gap is always in what it *doesn't* assert.

**Green gates are the start of an audit, not its conclusion.** Every WO13 finding was in a tree
that passed clippy `-D warnings`, 751 Rust tests, `tsc --noEmit`, the production build and
95 Vitest specs.

Related: [[cowtext-work-order-cadence]]
