---
name: ultracode
description: Fleet dispatcher for Cowtext — routes a task through the 6-agent fleet (tech-lead contract → parallel tech lanes with disjoint file zones → tester → project-manager). Invoke as /ultracode [task].
disable-model-invocation: true
argument-hint: [task]
allowed-tools: Read, Grep, Glob, Agent, Edit, Write, Bash
---

# ultracode — fleet dispatcher

Orchestrate the task in `$ARGUMENTS` through the Cowtext agent fleet. You dispatch
and integrate; the agents do the work.

## Procedure

0. **Read the fleet state first**: `docs/fleet/ROSTER.md` and
   `docs/fleet/ACTIVITY_LOG.md` (lanes, verdict authority, what happened last
   session).

1. **Pick the MINIMAL set of agents** for the task. Not every task needs the full
   fleet — a one-lane change needs one tech agent, tester, and project-manager.

2. **List the agents you are NOT launching in a single line**:
   `Idle by scope: <names>`. Idle by scope is not laziness and is never flagged.

3. **Order of battle**:
   - `tech-lead` first — writes the frozen contract, but only if the task spans
     more than one file or touches module boundaries.
   - `tech-general` ‖ `tech-ui` ‖ `tech-barn` — in parallel, each with a file zone
     that overlaps no other lane. Launch several `tech-general` instances if the
     core work itself splits into disjoint zones.
   - `tester` — manual (in the established format) + adversarial audit + gates.
   - `project-manager` — always.

4. **Every agent's prompt must carry**: the goal, its FILE ZONE (exact paths it
   may touch — leaving the zone is forbidden), and the acceptance criteria it
   must satisfy.

5. **Conflict resolution**: architecture and module boundaries — `tech-lead`'s
   verdict wins; interface matters — `tech-ui`'s verdict wins.

6. **The final agent is always `project-manager`** — it records the session
   (ROSTER, ACTIVITY_LOG, TERMINOLOGY, tasks/, the CLAUDE.md Status line) after
   all other lanes report.

## Rules

- Zones never overlap. If two lanes need the same file, re-cut the zones or
  serialize the lanes — never let both write it.
- Relay each agent's final report; confirmed defects go back to the owning lane,
  not fixed by the dispatcher.
- `product-analyst` is OUTSIDE this pipeline — never launched by ultracode.
