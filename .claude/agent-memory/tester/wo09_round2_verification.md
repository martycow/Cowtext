---
name: wo09-round2-verification
description: WO09 canvas connector round-2 gate results and audit outcome (2026-08-19) — both of Marty's round-1 findings independently verified fixed
metadata:
  type: project
---

WO09 round 2 (cartridge connectors, frozen contract `docs/_archive/contracts/WO09_CONNECTOR_CONTRACT.md`)
verified 2026-08-19 against uncommitted working tree on top of `c9f7ec6`. All gates green:
`npm run build` clean, `npm run lint` 0 errors, `cargo clippy --all-targets -- -D warnings`
clean, `cargo test` 542/542 (524 lib + 18 CLI), invoke-name contract 63/63 exact bijection
(diffed `generate_handler!` names against every `invoke(<T>?("name"` literal in `src/`).

Verdict: round 2 genuinely fixes both round-1 rejections. Verified by doing the pixel
arithmetic myself against the shipped CSS/TS constants (not trusting the contract's own
table), and by reading `node_modules/@xyflow/react` source directly rather than trusting
the task prompt's claim that `markerUnits="userSpaceOnUse"` breaks zoom scaling — it
doesn't, because React Flow zooms via a single CSS `transform: scale()` on
`.react-flow__viewport`, which wraps `EdgeRenderer` (so the `<path marker-end>`) and
`NodeRenderer` together; the `<defs>` sitting outside that div (as a sibling before
`<ReactFlow>`) doesn't matter for scaling since marker geometry is resolved at the
referencing `<path>`'s location, which IS inside the transformed viewport. This is the
kind of claim worth independently verifying via node_modules source rather than accepting
either the contract's or the dispatcher's framing at face value — see [[feedback_verify_dont_trust_prompt_claims]].

Two MINOR pre-existing (not WO09-introduced) doc defects found and written into the manual
as [KNOWN-FAIL] steps: `src/canvas/MemoryNodeCard.tsx:13-16` describes a nonexistent
3-handle-per-side + `src/canvas/handles.ts#pickHandles` architecture (file doesn't exist,
contradicts the actual 1-handle/no-id code 480 lines below and the frozen contract) —
blame traces to `7122ee1` (2026-08-18, prior UX-batch session), not this round.
`src/canvas/MemoryEdge.tsx:8-14`'s per-kind stroke-width/dash table is stale relative to
the actual `STROKE` const (comment says 2px/4px + one set of dash numbers, code says
3px/5px + numbers all +1) — the freshly-added comment directly above `STROKE` states the
correct numbers, only the older table drifted.

Manual: `docs/testing/WO09_TEST_MANUAL.md`.
