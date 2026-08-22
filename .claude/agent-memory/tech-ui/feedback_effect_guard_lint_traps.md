---
name: effect-guard-lint-traps
description: How to write a debounced-IPC effect guard in this repo without earning a react-hooks warning — bump the sequence ref at effect START, never in the cleanup; use a plain closure boolean for unmount
metadata:
  type: feedback
---

`react-hooks/exhaustive-deps` also owns the "ref value will likely have
changed by the time this effect cleanup runs" warning. So the natural way to
write a sequence guard —

```ts
return () => { seqRef.current++; clearTimeout(timer); };   // warns
```

— costs a new lint warning even though the whole point is to read the LATEST
value there. The formulation that keeps the gate clean and the guard intact:
take the ticket at effect start (`const seq = ++seqRef.current`), test
`seq !== seqRef.current` inside the promise handlers, and cover unmount with
an ordinary closure `let live = true` flipped in the cleanup. Two guards, two
different holes: `seq` drops responses a later effect run superseded, `live`
drops responses that arrive after the instance is gone.

**Why:** the repo's gate is "0 errors" but the lanes also keep the warning
count flat — a lane that adds a warning gets it back from the audit. The
existing `let live = true` idiom is everywhere in `Inspector.tsx` already; it
just isn't sufficient on its own once an IPC can outlive its own debounce.

**How to apply:** any 400 ms-debounced `invoke` inside a component whose props
can change under it (Inspector previews, lint runs, markdown loads). Pair it
with a `key={node.id}` remount when the state being written is per-entity —
see [[wo15-u1-inspector]]; the key is the primary lock, the guards are the
second. Related tsc/eslint pairing trap: [[no-rethrow-with-cause]].
