---
name: wo11-ui-d-agent-properties
description: WO11 lane UI-D (agent properties) — B2 UNPROVEN, C3/D2/D3 fixes, D4 debounced-autosave design (queue/promise pattern for no-lost-keystroke), G5/G6 cross-lane gaps flagged
metadata:
  type: project
---

WO11 lane UI-D shipped 2026-08-20: `src/agents/AgentEditor.tsx` (full rewrite),
`src/agents/ToolPicker.tsx`, `src/agents/modelCatalog.ts`,
`src/agents/AgentAvatar.tsx`, `src/store/agents.ts`,
`src/orchestrator/OrchestratorView.tsx`. Full contract:
`docs/_archive/contracts/WO11_CONTRACT.md`. R2 (agents backend: avatars, memory probe,
`agent_save`→`AgentDoc`) and R1 (git + `lib.rs` registrations) had BOTH
already landed by the time this lane started — zero unresolved-import gates,
full green (`tsc`/`build`/`lint`) on the first pass. Don't assume "R2 hasn't
landed yet" from the dispatch text without checking `git status` first — it
may already be true by the time you actually read the files.

**B2 verdict: UNPROVEN, same as UI-A's F1.** Read every file in the zone
touching the agent-selection render path (AgentEditor + ModelPicker +
SkillsChecklist + ToolPicker + toolCatalog.ts + modelCatalog.ts +
AgentAvatar.tsx + CodeMirrorEditor.tsx, the last one read-only/foreign) and
found no throwing expression — `AgentDoc.fields` is Rust-guaranteed non-null
even on a raw/parse-failed doc (`FmFields::default()`), and ToolPicker/
ModelPicker/SkillsChecklist are structurally excluded from a raw doc's render
branch entirely, so a bad-frontmatter file can't reach them. Ruled out as
suspects; the remaining candidates (Inspector.tsx's wrapper branches) are
UI-C's zone, not mine to fix.

**D4 autosave design — the queue/promise pattern, generalizable.** "Debounce
per key, but never two concurrent writes for the same key, and never lose an
edit that arrives mid-flight" is a recurring shape (`store/agents.ts`'s
`runAgentSave`/`performAgentSave`/`agentSaveQueues`). The trick: a
`Map<key, { timer, promise, pendingAfterFlight }>`. If a save is triggered
while `promise !== null` (another save already in flight for that key), set
`pendingAfterFlight = true` and return the EXISTING promise rather than
starting a second one; the in-flight save's `.finally()` checks
`pendingAfterFlight` and, if set, immediately re-runs against whatever the
draft looks like NOW (not a stale snapshot) — so the very last keystroke
always eventually lands, with no interleaving. Also: an EXPORTED flush must
often be split in two — a public `(): void` fire-and-forget for the frozen
cross-lane seam (`flushAgentSave`, used by beforeunload where nothing can be
awaited anyway) and an internal `async` awaited variant
(`flushAgentSaveFor`) for call sites inside the same module that need a real
guarantee before proceeding (rename/delete — a queued save must land under
the OLD filename before the file moves, or it's silently lost).

**CodeMirror rebuild-vs-caret-jump seam.** `docKey` must never derive from
anything the component's OWN save touches (the old `doc.content !==
prevContent.current` effect was exactly this bug — our own debounced-save
success mutated `doc.content`, which the effect watched, which bumped `gen`,
which rebuilt CodeMirror and lost the caret mid-typing). Fix: a monotonic
per-load generation counter (`agentsLoadGeneration`), stamped onto every
agent's `reloadNonce` only inside `loadAgents` (project open OR explicit
rescan) — never touched by the save path. `docKey =
${fileName}:${reloadNonce}` then only changes on a REAL external reload.

**Cross-lane gap flagged, not fixed (out of zone):** `Inspector.tsx:1067` and
`:1205` wrap `AgentEditor` in `<InspectorSection sectionKey="node.agent"
title="Agent" ...>` without a `hint` prop. Contract §5.7 wants
`hint="unsaved"` (amber) on that section header while a save is in the error
state. `agentSaveState: Record<string, "idle"|"saving"|"saved"|"error">` is
now public store state (`useAgentsStore`) specifically so UI-C can read it
there — a one-line addition (`hint={agentSaveState[doc.fileName] === "error"
? "unsaved" : undefined}`), not done here because Inspector.tsx is UI-C's
zone.

**G5 "Edit in Inspector" can only select, not switch views.** `view` (canvas
vs orchestrator vs tasks) is `useState` local to `App.tsx`, not backed by any
store — so `OrchestratorView.tsx` (UI-D's zone) can call
`useAgentsStore.getState().select(...)` but cannot force the Inspector
on-screen (Inspector only renders when `view` is canvas/tasks, never
orchestrator). Implemented the selection-only half and labeled the button's
title honestly ("switch to Canvas or Tasks view to edit"); a real jump needs
either a shared view-control store or an App.tsx-side listener — flag for
tech-lead if Marty wants the literal jump.

**§10 amendment (same session, landed after the main items):** added
`agentDeleteListeners`/`notifyAgentDeleted` to `store/agents.ts`, same shape
as the pre-existing `agentRenameListeners` seam, notified in
`deleteSelected`'s agent branch strictly after `agentDelete` succeeds AND
after that branch's own `set()` — never on the error path. Also fixed
`MemoryNodeCard.tsx:80`'s bare-`/` split (fenced to that line + the import it
needed) using `canonPath`, the fourth instance of the same class of bug in
one work order (standing rule now: no bare `===`/`.split("/")` on a `.md`
path anywhere in `src/`, `canonPath`/`sameRelPath` only). Left ONE remaining
`tsc` error out-of-zone: `Inspector.tsx:64` — an unused `AgentsSelection`
import, a leftover from UI-C's in-progress D5 removal (deleting the
Inspector's agent-delete button entirely per the amendment's §10.1 verdict).
Not mine to fix; flagged for UI-C/tech-lead.

**Fix round 1 (tester adversarial audit, same session):** HIGH #1 was a real
bug in the design summarized above — `runAgentSave`'s "already in flight"
branch returned the ORIGINAL in-flight promise instead of one chained to the
newer follow-up it had just scheduled via `pendingAfterFlight`, so
`flushAgentSaveFor` (awaited before rename/delete) could resolve having
confirmed only the OLDER write landed. Fix: replaced the two-state
(`promise`/`pendingAfterFlight`) tracking with a single per-file FIFO
**promise chain** (`tail`) — every `runAgentSave` call does
`q.tail = q.tail.then(attempt, attempt); return q.tail;`, so the caller
always gets back a promise for the turn IT just enqueued (never someone
else's). Since `performAgentSave` reads the draft fresh at execution time
(not a snapshot), and the chain guarantees strict ordering with at most one
`agent_save` in flight per file, this closes both the race AND the
misattributed-error complaint (a failure now surfaces while the OLD fileName
is still the live selection, because the rename literally cannot proceed
until that specific chained turn settles). General lesson: a "debounced,
serialized-per-key async work queue" is far more robustly built as an
explicit promise chain (`tail = tail.then(...)`) than as manual
promise+boolean flag bookkeeping — the flag approach is exactly the kind of
thing that's easy to get subtly wrong under concurrent triggers (timer fire
+ explicit flush racing).

MEDIUM #3 — swept `src/store/review.ts` and `src/store/tokens.ts` (fenced
zone). `review.ts:81` (`isManaged`, bare `===` between a node's `filePath`
and an incoming `fs://change`'s `relPath` — genuinely different origins, a
real instance) fixed with `sameRelPath`. `tokens.ts:62,77` fixed with
`canonPath` on both sides of `Map` builds/lookups AND the `===` node-find —
also fixed the untouched-but-identical-bug at `tokens.ts:88` in the same
function (same `sizeByPath` Map, same fix), since leaving a twin of the cited
bug broken in code already being edited for the exact same reason would have
been dishonest completeness. Did NOT touch `review.ts:145-148` (`e.relPath
=== change.relPath`) despite matching the grep pattern — traced the origin
and confirmed both sides always come from the SAME watcher-emitted string
within one dedup pass (homogeneous origin), not the cross-representation
class `canonPath`/`sameRelPath` exists for. Swept the rest of `src/` for the
same grep pattern independently (not just trusting the tester's count) and
found nothing else that looked like a genuine cross-origin instance within
reach of my own zone; did not fix anything outside the two fenced files.

See also [[feedback_wo11_temp_stub_verification]],
[[project_wo11_ui_a_wizards]].

**Fix round 2 (§12 amendment, "the Markdown tab is a second writer", same session).** New doctrine landed as canon: *"Any UI surface that writes a file which a store-level save queue also writes MUST route through that queue... Corollary: replacing an explicit Save with an autosave queue is a concurrency change, not a UI change, and obliges an audit of every other reader and writer of those files in the same work order."* Implemented the frozen seam `saveAgentRaw(fileName, text): Promise<string | null>` and exported `flushAgentSaveFor(fileName): Promise<void>` from `src/store/agents.ts` — **both as free exported functions, NOT store actions**, because the consuming lane (UI-C's `Inspector.tsx`/`MarkdownTab`) needed them callable without a `Selection`/draft (just a bare fileName+text pair). Learned this the hard way: I first built `saveAgentRaw` as an `AgentsState` action (`useAgentsStore.getState().saveAgentRaw(...)`), which compiled fine in isolation but broke `tsc` against UI-C's already-landed import (`import { flushAgentSaveFor, saveAgentRaw } from "../store/agents"`) — **when a frozen seam names a signature, match its calling CONVENTION too (free function vs. store action), not just its type signature.** Both are exported free functions living beside `flushAgentSave` in `store/agents.ts`, matching that file's existing precedent (`flushMetaSave`/`flushAgentSave` are already free functions, not actions) — should have used that as the template from the start.

To make `saveAgentRaw`'s return value trustworthy (never a stale `agentSaveErrors[fileName]` left by an unrelated earlier attempt), refactored `runAgentSave`/`performAgentSave` to thread each turn's own outcome through the promise chain (`Promise<string | null>` per turn) rather than reading shared post-hoc state — the chain itself (`q.tail`) still only needs to track completion for ordering, derived from but decoupled from each turn's own result promise.

**Secondaries, both implemented:** `MemoryNodeCard.tsx` "Create file" now routes an agent path through `useAgentsStore.getState().createAgent(node.title, { fileName })` instead of `write_md_file` (writes the real template + seeds memory, instead of a frontmatter-less stub that scans as broken). `review.ts`'s `revertCurrent` now branches on `isAgentFile` — agent paths go through `saveAgentRaw` (which folds in the "clear pending timer, then write" guarantee internally, so callers don't need a separate explicit flush step); the previously-swallowed error is now stored in a new `revertError: string | null` field (not wired into `ReviewModal.tsx`'s UI, since that file isn't mine — flagged for whoever owns it to render).

**Writer audit result (asked for explicitly): found ONE more, not live but real.** `saveDoc`'s `sel.kind === "agent"` branch still called `agentSave(...)` directly, bypassing the queue entirely — DEAD today (grepped every call site; the only one left passes a skill selection, matching the contract's explicit skills-keep-explicit-Save carve-out), but a footgun: any future caller that wired an agent Selection into `saveDoc` would silently reintroduce exactly the bug this whole amendment closes. Hardened it to route through the same `runAgentSave` queue instead of reporting-only, per the doctrine's own enforcement principle ("a runtime rejection in the chokepoint, not a comment") — converts a latent risk into structurally impossible rather than leaving it as a note. No OTHER writer found in my zone (AgentEditor.tsx, ToolPicker.tsx, OrchestratorView.tsx, MemoryNodeCard.tsx post-fix, review.ts post-fix) — checked directly via grep for `agent_save`/`write_md_file`/`agentSave(`/`writeMdFile` across all of them.

**Fix round 3 (final WO11 item, same session) — the dequeue-vs-error-strip race.** `revertCurrent`'s two final `set()` calls (`revertError: err`, then unconditional `reviewing: null`) ran with no `await` between them; React 19's automatic batching (`createRoot`) coalesced them into one commit, and `App.tsx`'s `<ReviewModal>` mount gate (`reviewing !== null`) unmounted the modal in that same commit — the error was captured correctly but the strip that renders it never got a chance to paint. **General lesson: a store update that sets an error AND clears the thing a consumer's mount condition depends on, in the same synchronous tick, is a real bug under React 19 batching even with zero literal async races — "no `await` between two `set()` calls" is itself the hazard, not just interleaved async work.** Fix: `revertCurrent` now only dequeues/nulls `reviewing` on success; on failure both stay put, and Close/Skip/Accept (verified all three remain reachable — Skip is disabled only when it's the sole queue entry, Close is never disabled) are how the user moves on. Left a stale comment in `ReviewModal.tsx` (UI-C's file, out of zone) uncorrected — flagged in the report instead of touched, since it now asserts something false ("No Retry here... revertCurrent always dequeues") that a Retry button could actually exploit now that the entry persists on failure.

WO11 is now fully closed (tech-lead confirmed: tsc 0, lint 0, build ✓, clippy clean, 604 tests, invoke 73/73/73).
