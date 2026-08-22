---
name: no-rethrow-with-cause
description: In this repo you cannot rethrow a wrapped Error — ESLint's preserve-caught-error demands `{ cause }`, and tsconfig's lib doesn't type the 2-arg Error constructor; handle in place instead
metadata:
  type: feedback
---

Never write `throw new Error(msg)` inside a `catch` in `src/`. Both exits are
blocked:

- ESLint 10's core `preserve-caught-error` rule **errors**: "There is no
  `cause` attached to the symptom error being thrown".
- Adding `{ cause: e }` makes `tsc` fail with `TS2554: Expected 0-1
  arguments, but got 2` — the ES2022 two-argument `Error` constructor is not
  in the configured `lib`, and `tsconfig*.json` is frozen in most work
  orders.

**Why:** hit head-on in WO15 lane U2 (`ProjectWizard.tsx` `create()`), where
a `preset_apply` rejection needed a friendlier sentence appended. Both gates
must be green, and the tsconfig fix is out of a UI lane's zone.

**How to apply:** when a caught error needs decorating, do not rethrow —
handle it where you caught it: `setError(decorated); setBusy(false); return;`
inside the async flow. Reads better anyway (the error state is where the UI
shows it), and keeps Rust's original message verbatim with the extra guidance
appended rather than replacing it.
