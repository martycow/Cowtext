---
name: modal-deferred-writes
description: A debounced store action IS a disk write — a modal promising "Nothing is written until you confirm" must park the intent in local state and apply it in the Create path
metadata:
  type: feedback
---

In a create/confirm modal, calling a store action that rides a debounce
(`setBuiltinInclude` → 700 ms sidecar save, and anything else that
`schedule*Save`s) counts as writing to disk. Hold the intent in local state and
apply it inside the Create path, after the create call succeeds; Cancel then
writes nothing at all.

**Why:** `NewAgentDialog`'s footer promises "Nothing is written until you
confirm." (contract §7.6). Ticking a bundled skill flipped the compile toggle
immediately, so `.cowtext/agents.json` landed on disk while the modal was still
open and Cancel left it there — tester finding #5. The debounce hides this:
the write is 700 ms later, in another module, so it never looks like one at the
call site.

**How to apply:** when auditing a dialog, list every handler that reaches a
store, then check each one for a scheduled save — not just the obvious `invoke`
calls. Two corollaries learned while fixing it:
- Deferring makes attach-then-detach observable. Apply only the intents still
  true at Create (filter the pending ids by what is still attached), otherwise
  a checkbox the user un-ticked still turns a toggle on.
- Apply the deferred writes in the same tick as the other post-create
  `updateMeta`, so they coalesce into one file write, and place them AFTER the
  rollback path (which throws) so a failed create writes nothing.

See also [[wo15-u3-agents-skills]].
