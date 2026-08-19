---
name: wo06-t4-budgets-fix-d3-restart
description: WO06 fix round, D3 (CRITICAL) — begin_restart didn't reset tokens_used, so Restart after a budget stop immediately re-stopped, burning a paid turn every press. Read before touching sessions.rs's begin_restart/charge again.
metadata:
  type: project
---

WO06 tech-lead audit (`docs/design/WO06_AUDIT.md`) found D3 in lane
T4-budgets (= G3, `src-tauri/src/sessions.rs`): `begin_restart` bumped
`generation`/`alive`/`busy` but never cleared `tokens_used`/`turn_tokens`/
`info.tokens_used`, contradicting contract §5.5.2 ("restart resets
tokens_used to 0 — a restart is a new budget"). See [[wo06-lane-g3-budgets]]
for the original lane's design record — this is the fix round on top of it.

**Fix**: inside `begin_restart`'s existing critical section (single mutex
guard, same one that bumps generation/alive/busy), added:
```rust
entry.tokens_used = 0;
entry.turn_tokens = 0;
entry.info.tokens_used = 0;
```
right after `entry.busy = true` and before computing `prompt` — so the
`entry.info.clone()` returned to the caller (and thus the wire-visible
`SessionInfo` the UI gauge reads) already carries the reset.

**Test added** (`sessions/tests.rs`,
`restart_after_a_budget_stop_clears_tokens_used_so_the_new_turn_is_not_re_stopped`):
charge to `Stop` → `begin_restart` → `charge` again with a small
`observed_total` ⇒ must be `Ok`, not `Stop`. One non-obvious detail: the
expected post-restart `generation` is **2**, not 1 — `charge`'s own `Stop`
branch already bumps generation once (0→1) as the atomicity fence (§5.3
step 4), then `begin_restart` bumps it again (1→2). A test that assumes
generation is 1 after one restart-following-a-stop will fail; account for
the Stop's own bump.

**Gate numbers at this fix**: `cargo clippy --all-targets -- -D warnings`
and plain `cargo clippy -- -D warnings` both clean. `cargo test`: 480 lib +
18 cowtext-cli = 498 passing (up from the WO06 G3 handoff's 447+18=465 —
other lanes' work landed in between). `sessions::tests` alone: 70 passed
(69 + this 1 new). `npm run build` 0 errors, `npm run lint` 0 errors / 1
pre-existing warning (`RoleGlyphs.tsx`, not mine).

See also [[wo06-lane-g3-budgets]] (original lane, judgment calls on
charge/end_turn free-function design and the Stop-branch fold that this fix
builds on top of).
