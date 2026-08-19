---
name: feedback_ambiguous_zone_boundaries
description: How to resolve a file-zone grant that conflicts with, or under-specifies relative to, the governing contract's lane grid — Cowtext multi-agent dispatches.
metadata:
  type: feedback
---

Cowtext's `/ultracode` work orders (see `docs/design/WO0N_CONTRACT.md`) name
an authoritative lane grid (§10-ish section) with exclusive file zones. A
per-session dispatch to tech-ui sometimes restates the zone in its own words,
and that restatement can be narrower, broader, or reshaped relative to the
contract's grid (observed in WO06, see [[project_wo06_u2_linkage_zone]]).

Rule of thumb applied, worth repeating:

1. The DISPATCH's explicit "FILE ZONE" / "may NOT touch" lines are
   authoritative for what I may edit in THIS session — they override the
   contract's lane grid when the two disagree on who owns what.
2. A contract §-numbered FROZEN CROSS-LANE INTERFACE (an exact file path +
   exact prop/fn signature another lane's code is written against) must
   still be honored at that exact path, even if the dispatch's zone
   description doesn't name it by name — as long as it fits under something
   the dispatch DID grant (e.g. "new directories you create under src/ for
   this feature"). Skipping it breaks the other lane's build, which is a
   worse outcome than a slightly literal zone reading.
3. When a duty is explicitly assigned but mechanically undeliverable without
   touching a file that is neither granted nor forbidden by name (not in
   "FILE ZONE", not in "may NOT touch" either) — and it is the direct
   backing store/logic for a directory that WAS granted — the reasonable
   call is to extend it ADDITIVELY (new fields/cases, new sibling functions
   alongside existing ones, never restructuring or removing) and flag it
   prominently in the final report as a judgment call for the audit to
   ratify or reject. Do not silently skip the duty, and do not silently
   make a large/restructuring edit to an ungranted file.
4. Genuinely forbidden files (named explicitly, or squarely another lane's
   hot file like `TasksBoard.tsx`/`App.tsx`) still get the STOP-and-report
   treatment, never a workaround.
5. In a tech-lead AUDIT fix round (`docs/design/WO0N_AUDIT.md`), a defect
   sometimes carries an explicit either/or ruling ("either U1 mounts X inside
   Y, or its controls fold into Z's own file" — WO06 D1 on `TaskLinksPanel`).
   Pick the branch that lands entirely inside a file your OWN zone already
   owns (here: `Inspector.tsx`'s `TaskPanel`, U1-board's HOT file) over the
   branch that would require editing another lane's file — it resolves the
   ruling with a pure import/mount, zero cross-zone edits, and needs no
   further arbitration. See [[project_wo06_u1_fixround_d1_d8_o4]].

**Why this rule and not stricter-always:** a purely literal zone reading
that refuses anything not explicitly named would have made 2 of 3 assigned
duties undeliverable this session (budget UI needs `Session.tokenCeiling`/
`stopReason` and a `"budget"` event case). The dispatcher's job is to name
duties and boundaries; when the two are in tension, the additive-and-flagged
path serves the user (a real, working feature to review) better than a
technically-safe no-op.
