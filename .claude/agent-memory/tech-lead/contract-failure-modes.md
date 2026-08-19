---
name: contract-failure-modes
description: The six recurring defect classes Cowtext work-order contracts must pre-empt, distilled from the WO02, WO03 and WO06 adversarial audits
metadata:
  type: project
---

Every Cowtext contract I write must close these six classes up front, because each has
already shipped a real defect once:

1. **Rust writes a file the Zustand store also owns → store clobbers it.** WO03-D1:
   `import_apply` wrote `graph.json`; the store's 700 ms debounced `flushSave` overwrote it
   with stale in-memory nodes. No error, permanent loss. Fix pattern: Rust returns a
   *proposal*, the store commits through its own actions — or the caller must `loadGraph`
   immediately (the `PresetsModal` precedent).
2. **Two serializers, two collations.** WO03-D5: Rust `String::cmp` vs TS `localeCompare` on
   ids containing `-` reorder a git-tracked file on every alternating write. Fix pattern: one
   writer owns the file, or both sides pin byte order with a fixture test.
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

**Why:** these are the defects that cost extra audit rounds in WO02, WO03 and WO06; all six are
seam defects, invisible inside any single lane's diff — every lane in WO06 reported success.

**How to apply:** when drafting a contract, walk each new command against all six before
freezing. When auditing, check them first — they are where the confirmed CRITICALs have been.
For 5 and 6, the fastest check is mechanical: grep every new component for an importer, and
grep for `Stage-0 stub` in the merged tree.

Related: [[cowtext-work-order-cadence]]
