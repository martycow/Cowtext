---
name: wo13-u4-inspector-migration
description: WO13 U4 lane (Inspector/App.tsx/rail/handoff/store-project) — migration banner+review-filter design, E3 edge-inspector shape, defect 1/6 fixes, and the "build against a frozen contract signature before the cross-lane file lands" pattern used again here.
metadata:
  type: project
---

WO13 (`docs/design/WO13_CONTRACT.md`, FROZEN + Amendment 1) is a 9-parallel-lane
taxonomy overhaul. U4 owns `src/inspector/**` (sole owner of the 2300+-line
`Inspector.tsx`), `App.tsx`, `src/rail/Hierarchy.tsx`, `src/handoff/*`,
`src/store/project.ts`. Landed this session:

**Defect 1 (git init missing from Inspector).** `onOpenGit` already flowed
App.tsx → Workspace → FileRail/Hierarchy; the only gap was `ProjectPanel.tsx`
not taking the prop. Threaded `Inspector({root, onOpenGit})` →
`ProjectPanel({root, onOpenGit})`, replaced the literal pointer sentence with
a real button (`Initialize repository…` / `Manage .gitignore…` depending on
`git.isRepo`, opens the same `GitWizard`).

**Defect 6, file half (stale markdown after assemble).** `FileMarkdownTab`'s
load effect only re-ran on `[root, node.filePath]`. Added a second effect
watching `assembleStatus[node.id]` (already in the graph store) for a
transition INTO `"assembled"`: if the buffer is clean, silently re-reads via
`read_md_file`; if the user has an unsaved edit (`doc !== savedDoc`), shows a
dismissible "Assemble changed this file on disk" banner with an explicit
"Reload from disk" button instead of silently clobbering the edit. Never a
second writer — this only ever calls `read_md_file`, `assemble.rs`'s
`write_atomic` stays sole writer (WO11 one-writer doctrine).

**Migration banner + review filter (N-F) + summary (E-F).** No store field
existed for "was this graph just migrated / how many nodes / by what
conversion" — `store/graph.ts` is Stage-0-then-CLOSED and doesn't track it.
Solved by an **independent, read-only diff**: `store/project.ts` gained
`computeMigrationSummary(raw)`, which re-reads `graph.json` itself (a second
`invoke("read_graph", ...)` call, fired in parallel with `loadGraph`'s own),
and calls the REAL exported `migrateGraph()` (never a second implementation
of the pass list — same "one decider" discipline the contract enforces for
`resolveLoad`) to diff pre- vs post-migration node roles / edge kinds. Yields
`{fromVersion, totalNodes, nodesNeedingReview, byRoleChange, byEdgeChange,
edgesDropped}`. Banner renders in App.tsx (accent/info styling, not amber —
this is Cowtext's own one-shot action, not agent/warning territory per "blue
is you"), with an expandable "Details" breakdown and a "Review N" button.
Dismissal persists via **localStorage keyed by root**
(`cowtext:migration-banner-dismissed:<root>`) — flagged as a deviation since
no other UI-only-preference persistence exists in this codebase (everything
else goes through Rust-backed `AppSettings`, which is `store/settings.ts`,
outside U4's WO13 zone); candidate to fold into
`AppSettings.dismissedMigrationBanners` in a later round.

The "findable in one action" requirement got TWO entry points: the banner's
own dismissible "Review N" button, and a persistent chip in `FileRail`'s
header (`{N} review`, only rendered when count > 0) that survives dismissal
and restart — both call a new `useProjectStore.focusNeedsReview()` action
(`setSelection` + `useFocusStore.requestFocus`, U2's canvas-pan seam).

Also added the third N-F bullet ("opening one prefills... shows a single
line explaining what was guessed and why... clearing the flag is one click")
directly in `PropertiesTab`'s `node.metadata` section: a `needsReview===true`
banner with a best-effort `reviewReason(node)` (the node only stores THAT it
was flagged, never WHICH of §5.2's 4 rules fired, so the reason is inferred
from current shape — `node.deprecated` is unambiguous, role-based guesses are
phrased as guesses) and a "Mark reviewed" button calling the frozen
`setNeedsReview(id, false)` Stage-0 action.

**E3 edge inspector.** New `edge.load` section (added to `EDGE_ORDER` in
`sectionOrder.tsx`, between metadata and appearance) holding: a from-scratch
`GuardEditor` (old `edge.condition`/`"conditional"` code was dead — v5's
`EdgeKind` has no `conditional` member, `MemoryEdge.guard: EdgeGuard` replaced
it; TS already flagged the old code as a real type error, not just a style
issue) that never persists an empty-`globs`/empty-`text` guard (local draft
state, remounted per-edge via `key={edge.id}` on the `<EdgePanel>` call site —
same discipline `AgentMarkdownTab` uses); the resolved load policy for the
edge's TARGET via `resolveLoad(edge.target, graph)`, with a one-sentence
explanation (`loadExplanation`, exhaustive `switch` over all 11 `LoadReason`
members) that says **"This edge is why..."** when `load.decidingEdgeId ===
edge.id`, or names the actual deciding edge by its source node when it's a
different one (never just "somewhere else"); and lint diagnostics touching
the edge (`lintRun(root)` filtered on `edgeIds.includes(edge.id)`). "Order"
(§4.2) renders only for `sequence`-kind edges, as the target's `readOrder`.

**Verbatim primary sentence** (isDeciding=true, reason="imported"): `This
edge is why "${targetTitle}" is always in context — it's reached by an
unguarded import from the always-loaded set.`

**ProblemsPanel filter-by-severity**, extended not replaced per contract:
severity badges in the header became toggleable filter buttons (derived
dynamically from `Set(items.map(i => i.severity))`, ranked via an unbounded
`Record<string,number>` lookup rather than hardcoding the then-2-member
`Severity` union — this made the code forward-compatible with R2's later
3-member `Severity` extension with zero rework). Click-to-focus now also
calls `useFocusStore.requestFocus`, not just `setSelection` — selection alone
doesn't pan the canvas.

See [[feedback_wo13_build_against_unlanded_lane]] for the cross-lane-timing
pattern this whole session leaned on.
