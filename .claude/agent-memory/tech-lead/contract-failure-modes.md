---
name: contract-failure-modes
description: The nine recurring defect classes Cowtext work-order contracts must pre-empt, distilled from the WO02, WO03, WO06 and WO11 audits
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
   **The tell:** replacing an explicit Save with an autosave queue is a *concurrency* change, not a
   UI change. It obliges an audit of every other reader and writer of those files in the same work
   order. Three of WO11's four highest-severity defects traced to that single omission.

**Why:** these are the defects that cost extra audit rounds in WO02, WO03, WO06 and WO11; all
nine are seam defects, invisible inside any single lane's diff — every lane in WO06 reported
success.

**How to apply:** when drafting a contract, walk each new command against all six before
freezing. When auditing, check them first — they are where the confirmed CRITICALs have been.
For 5 and 6, the fastest check is mechanical: grep every new component for an importer, and
grep for `Stage-0 stub` in the merged tree.

Related: [[cowtext-work-order-cadence]]
