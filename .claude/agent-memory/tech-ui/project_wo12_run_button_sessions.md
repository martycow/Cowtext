---
name: wo12-run-button-sessions
description: F3 lane (run-button-sessions) — consolidating three spawn surfaces into one context-prefilled RunSessionDialog; the grep-based acceptance test forced renaming internal state, not just UI text.
metadata:
  type: project
---

WO12 F3 (2026-08-20): deleted RosterBar's "Spawn agent" button, OrchestratorView's
per-agent "Spawn" button + doSpawn, and TaskContextModal's "Launch…" button +
AddAgentDialog mount. `src/sessions/AddAgentDialog.tsx` keeps its filename but the
export becomes `RunSessionDialog({ root, onClose })` — zero other props; task
binding, agent binding, and ceiling are all derived from context at mount via
lazy `useState(() => store.getState()...)` initializers, not passed in.

**Non-obvious gotcha:** the acceptance criterion was "case-insensitive grep for
'Spawn' across src/ returns only wire/store identifiers (`agent_session_spawn`,
`spawn`, `spawnForTask`)". A literal grep also catches local variable names like
`spawning`/`spawnError` that merely contain the substring — those aren't wire
identifiers, so I renamed them to `running`/`runError` throughout the dialog
rather than leave grep noise, even though the acceptance intent ("zero rendered
buttons, tooltips or prose") probably didn't strictly require it. When a work
order's acceptance check is phrased as a literal grep, treat variable/comment
text as in-scope too, not just JSX-rendered strings — [[feedback_ambiguous_zone_boundaries]]
territory but for acceptance wording, not file zones.

**Cap gating moved wholesale**: `MAX_SESSIONS`/`atCap` logic (`sessions.filter(s
=> s.alive).length >= MAX_SESSIONS`, title `agent limit reached (${MAX_SESSIONS})`)
was copied verbatim from the deleted RosterBar button into the dialog's Run
button — same wording preserved so no user-facing regression.

**Folder/task prefill pattern**: initial `cwd` state defaults to
`metaOrDefault(meta, agentFileName ?? "").defaultCwd || root` computed once in a
lazy initializer; a **mount-only** `useEffect(() => { if (cwd !== null)
checkFolder(cwd) }, [])` with an `eslint-disable-next-line
react-hooks/exhaustive-deps` (precedent: `src/review/ReviewModal.tsx`) validates
it immediately so "Run" is actually clickable on open, not just displaying a
folder. Task-context body is fetched best-effort in a `[root, taskId]`-keyed
effect (mirrors TaskContextModal's own preview fetch); on error it falls back to
a plain (task-less) `spawn` rather than blocking Run — a deliberate design
choice since RunSessionDialog's task row is a convenience prefill, not
TaskContextModal's primary gated flow.

App.tsx (owned by the `app-shell` lane, wave 3) was the one documented,
permitted `npm run build` failure: `RosterBar` dropped its `root` prop, so
`<RosterBar root={root} />` at `src/App.tsx:1092` breaks until app-shell edits
it. Do not "fix" that line yourself — it's out of zone.
