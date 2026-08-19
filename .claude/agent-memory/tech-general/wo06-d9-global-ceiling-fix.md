---
name: wo06-d9-global-ceiling-fix
description: D9 fix — global default sessionTokenCeiling added to settings.rs, inherited by sessions.rs via resolve_ceiling; the three-way explicit/inherit/opt-out design
metadata:
  type: project
---

WO06 shipped per-session token ceilings (contract §5) but the frontend-side global-default
deliverable (§5.1, lane U3) never landed — WO06_AUDIT.md D9: zero grep hits for
`sessionTokenCeiling`, so every session launched unbounded by default. Fixed in a Rust-only
dispatch (tech-general zone: `settings.rs` + `sessions.rs`/`sessions/tests.rs`), commit after
`6d81251`.

**Deviation from the original WO06 contract, deliberate and instructed by the dispatcher:**
§5.1 originally said "settings.rs needs no change... sessions.rs needs no settings read" and
pushed the effective-ceiling computation to the frontend. The D9 fix task explicitly reassigned
this to Rust instead (tech-ui was busy elsewhere and the zone was Rust-only), so
`agent_session_spawn` now reads `settings::global_token_ceiling(&app)` itself before calling
`register`. `[[wo06-lane-g3-budgets]]` covers the original atomic hard-stop this fix reuses
unmodified — do not re-derive `charge`/generation-fence logic, only the ceiling *value* changed.

**Design:**
- `settings.rs::DEFAULT_SESSION_TOKEN_CEILING: u64 = 200_000` — chosen (not 0/unlimited) because
  it's the exact number already baked into the product twice: `CONTEXT_WINDOW_TOKENS` in
  `src/store/tokens.ts` and the WO06 contract's own worked example
  (`WO06_CONTRACT.md` §3.2 `"tokenCeiling": 200000`). `0` remains the wire convention for
  "unlimited" everywhere (global setting or per-task).
- `settings.rs::global_token_ceiling(app) -> u64` (never `None` — 0 already means unlimited) is a
  thin AppHandle wrapper around the pure, directly-tested `parse_global_ceiling(json: &str) -> u64`.
  Tolerant on every axis (missing file/key, malformed JSON, negative, fractional float, non-numeric
  → default); integral floats (`75000.0`) are accepted, fractional ones (`1000.5`) are NOT (initial
  test assumed rejection but implementation truncated — fixed by requiring `f.fract() == 0.0`).
- `sessions.rs::resolve_ceiling(explicit: Option<u64>, global_default: u64) -> Option<u64>` is the
  entire three-way decision (`explicit.unwrap_or(global_default)` wrapped in `Some`), called once in
  `agent_session_spawn` before `RegistryCore::register` — `register`'s own signature and its
  Some(0)→None normalization test suite were left **completely untouched**, so none of WO06's
  existing ceiling/hard-stop/restart tests needed modification. This is the key seam-preservation
  move: keep the AppHandle-free `RegistryCore` testable exactly as before, do the settings read only
  in the async command wrapper.
- Semantics: `Some(n)` any n (including 0) from the caller always wins outright (0 = deliberate
  per-task opt-out to unbounded, never falls back to global). `None` from the caller inherits the
  global default (itself possibly 0 = whole-app opt-out).

**Testing without AppHandle:** no `tauri::test`/mock-app harness exists in this crate
(`tauri = { features = [] }`, no `test` feature). `global_token_ceiling`'s AppHandle half is
untested by design (matches the existing untested-wrapper posture of `init`/`apply_claude_override`
in the same file) — only the pure `parse_global_ceiling` core is unit tested. D9's required
"session inherits global default" / "hard-stop still fires exactly once" / "restart resets
tokens_used" tests are all satisfied by feeding `resolve_ceiling`'s output into the existing
`RegistryCore::register`/`charge`/`begin_restart` seam directly — no fake-Runner needed since
sessions.rs (unlike assemble.rs) has no Runner trait; it uses the RegistryCore-direct seam instead.

Gates after this fix: `cargo clippy --all-targets -- -D warnings` clean, `cargo test` 524 lib
(+18 over the 506 baseline, matching new test count exactly) + 18 cowtext-cli, 0 failed.
