---
name: wo15-u2-wizards-git
description: WO15 lane U2 — project wizard gained Principles/Stack/Git steps + first commit; the scaffold-once retry guard, the preset_apply fail-closed trap, the fix-round result block, and the deviations I flagged
metadata:
  type: project
---

WO15 lane U2 (2026-08-22): `ProjectWizard.tsx` (6-step `new` mode),
`BranchPicker.tsx` (new, shared with `GitWizard.tsx`), `GitWizard.tsx`
(identity row + "Make the first commit"), `gitignorePresets.ts`,
`NodeWizard.tsx` "Node type", `PreviewPane.tsx` "What you get". Contract:
`docs/design/WO15_CONTRACT.md` §6 U2.

**The scaffold-once guard is load-bearing.** The wizard's Create runs
`projectInit → presetApply → gitInit(root, branch, true)`, and only the git
step may fail recoverably (button becomes Retry). A naive retry re-runs
everything — and `preset_apply` **fails closed** on a project that already
has a non-empty graph (`preset.rs:219-227`, "project already has a graph"),
so the second attempt would turn a fixable git-identity error into a
permanent dead end. Fix: a `useRef` latch set after step 2 succeeds, plus
seeding `git` from the already-stored `GitInitResult` so a re-entry never
double-commits. Any future multi-write wizard flow needs the same shape.

**Same guard, second face:** pointing "New project" at an existing Cowtext
folder makes `presetApply` reject. The wizard keeps Rust's sentence verbatim
and appends "— this folder is already a Cowtext project. Cancel and use Open
folder instead." (decorating in place, see [[no-rethrow-with-cause]]).

**Deviations flagged, not hidden:** (1) the "Will create" list is a superset
of the contract's enumeration — it also names `.cowtext/graph.json` and
`.claude/agents/`, which `presetApply`/`projectInit` really do write, because
an incomplete list is a lie on the one screen that promises "nothing is
written until you click Create"; (2) the principle hint is the first
**non-heading** body line (the literal first line is `# <label>`, which just
repeats the label); (3) `defaultCompileTargets` is read with a subscribed
selector rather than `getState()` so the live preview follows a change.

**Fix round (2026-08-22) — a wizard that writes files must not call `onDone`
in the same tick.** The `branch main · 1 commit` line existed and was
literally unobservable: Create resolved and the host unmounted the wizard on
the same render. Shape now: a `created` state twin of the `scaffolded` ref
(a ref cannot re-render), the Create step becomes a RESULT block (`Created.`
+ the Will-create list re-marked with green checks instead of the neutral
`Plus` it carries beforehand + the git line), Back and Cancel STOP EXISTING,
and Escape/scrim/× all route through one `dismiss()` that opens the project
instead of closing. Focus is moved onto the new primary (`Open project`) —
but never while `HooksModal` is up, or the parent effect steals focus from
the child modal that just mounted. The outcome is read off state at click
time, so a git Retry between Create and Open project reaches App.tsx.

**`skippedExistingRepo && commitCount === 0` is a defect signature, not a
success.** It is the exact shape of "git init worked, the first commit
failed, the user pressed Retry" — D-15 makes the retry skip, so Cowtext can
never commit there. Rendered as a warning naming the terminal way out, in
both wizards. Rule of thumb: `GitInitResult` needs three tones (real init =
success, skip-with-commits = info, skip-without = warning); one green box for
all three is how the lie got in.

**BranchPicker owns the segmented shape, the caller owns the string.** Props
are `{ value, onChange, disabled? }` with `isValidBranchName` exported from
the same file (contract-mandated) — which costs exactly one
`react-refresh/only-export-components` warning; precedent exists in
`AgentEditor.tsx`, `ToolPicker.tsx`, `sectionOrder.tsx`. The choice
(main/master/custom) is local state seeded once: deriving it from `value`
every render makes clicking "custom" snap back to "main" (empty custom box is
a state no string can express).
