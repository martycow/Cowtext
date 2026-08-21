---
name: wo12-app-shell-wave3
description: WO12 app-shell lane (wave 3, sole App.tsx owner) — Run button, four component mounts, RosterBar seam repair, starter-node adoption race fix.
metadata:
  type: project
---

WO12 app-shell (2026-08-20): App.tsx as the final-wave gate that closed F1/F2/F3/F5/F7.
Repaired the one expected carried-over break (`<RosterBar root={root} />` →
`<RosterBar />` — the run-button-sessions lane dropped that prop, see
[[project_wo12_run_button_sessions]]), added the topbar Run button (accent-filled,
between CompileSplitButton and the project-props gem button), and mounted
`RunSessionDialog` (lazy, `{ root, onClose }`), `AssembleConfirmModal` (lazy,
zero-prop, self-hiding), `AgentQuestionModal` (lazy, zero-prop, self-hiding), and
`ToastHost` (NOT lazy, no Suspense — must be present before the first failure,
mounted unconditionally as the last child before the closing `</div>`).

**Race condition worth remembering for any future App.tsx starter/adoption work:**
checking `useGraphStore.getState().nodes.length` immediately after `openProjectAt()`
resolves is WRONG — `openProjectAt` only runs the scan and sets `root`/`files`; the
actual `loadGraph(root)` call happens in a *separate* `useEffect` keyed on `root`
that hasn't necessarily fired yet (React effects run after commit, not synchronously
inside a zustand `set()`). Reading node count at that moment risks stale data from
whatever project was previously open (`closeProject()` clears `root`/`files` but
deliberately does NOT reset `useGraphStore`'s `nodes` — that reset is `loadGraph`'s
job on the next open). Fix pattern used for F5's starter-node adoption (mirrors the
file's existing `pendingImportRoot` convert-flow idiom exactly): record intent in a
`pendingStarterAdoptRoot` state, add a `useEffect` gated on BOTH `root ===
pendingStarterAdoptRoot` AND a subscribed `graphLoaded` (`useGraphStore((s) =>
s.loaded)`) flag. This is safe because `loadGraph` sets `loaded: false` and resets
`nodes: []` *synchronously* (before its first `await`) the instant it's invoked for
a new root — so by the time our effect (declared textually after the loadGraph
effect, hence run after it in the same passive-effect flush) observes `loaded ===
true`, that's guaranteed to be a completed load for the CURRENT root, never stale.
Also gated on `!openImport` (i.e. "new" mode only, never "convert") per the
contract's "don't fire two modals at once" — convert already opens
ImportReviewModal.

**Acceptance-check hygiene:** proactively renamed a code *comment* that used the
word "Spawn" (documenting RosterBar's removed button) to avoid tripping a literal
`grep -i Spawn src/` gate, even though this lane's own acceptance text said "no
*rendered UI text*" (looser than [[project_wo12_run_button_sessions]]'s stricter
reading). Cheap insurance — rename rather than argue about which acceptance
wording is authoritative when a downstream gate might run a blind grep.
