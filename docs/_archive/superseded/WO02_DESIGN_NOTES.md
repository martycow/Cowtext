# WO02 — Design Notes (items 18, 19, 20)

> Author: tech-lead · Session 2026-08-18 · Companion to
> [`WO02_CONTRACT.md`](WO02_CONTRACT.md).
> **Design only — nothing here is built this session.** Each section ends with the
> implementation cost and the gate that must be cleared before it can be built.
> Source: `docs/INPUT_PROMPT.md` items 18 ("think deeper about what roles must
> exist"), 19 (Departments), 20 (Edge types incl. CONTROL).

---

## 1. Item #18 — What roles must exist

Marty's line sits between #17 (node-role description text) and #19 (agent
departments), so it is read on **both** axes. They are different vocabularies and
must never be merged into one list.

### 1.1 Node roles — the seven we have

`agent` · `rules` · `architecture` · `workflow` · `task` · `reference` · `glossary`

A node role answers: *what kind of knowledge is this, and how should an agent treat
it?* It drives the glyph, the colour, the skeleton the wizard writes, and (in
principle) the order things land in a compiled file.

The seven cover the common cases well. Three things a real project keeps producing
have **no home** and get crammed into `reference` or `architecture`, where they are
read with the wrong expectation:

| Proposed role | Answers | Why not an existing role |
|---|---|---|
| **`decision`** | *Why is it this way?* One choice, its alternatives, its date, its consequences. An ADR. | `architecture` describes the system **as it is now** — a statement of state. A decision is a statement of **history and rationale**, and an agent must not "fix" it when the code drifts. Filed under `architecture`, a superseded decision reads as a live instruction. This is the single most damaging gap. |
| **`example`** | *What does good look like here?* Canonical snippets to imitate. | `reference` is lookup material — read it when you need a fact. An example is **imitation material** — match this shape. Agents treat the two differently, and mislabeling an example as reference is why house style drifts. |
| **`environment`** | *How do I operate this repo?* Commands, ports, binaries, prerequisites, what breaks and why. | Today this is the "Commands" and "Scaffold constraints" half of a CLAUDE.md, wedged into `architecture` or `workflow`. It is neither: `workflow` is an ordered process for a recurring **job**; `environment` is the standing truth about the **machine**. It is also the highest-value thing to always pin. |

**Rejected**, with reasons, so nobody re-proposes them:

- `note`, `idea`, `scratch` — not context; they are the absence of a decision. If
  something is worth pinning it has a real role.
- `spec` — either `rules` (constraints) or `architecture` (shape) or `task`
  (finish line). "Spec" is a document format, not a role.
- `test` — the test files are the truth; a node about testing is `workflow`.
- `api`, `schema`, `interface` — `architecture` at a smaller radius. Adding these
  starts a slide toward one role per folder.
- `persona` — already renamed to `agent`; do not resurrect.
- `history`, `changelog` — `reference`, and mostly git's job.

**Recommendation**: adopt exactly three — `decision`, `example`, `environment` —
taking the set to ten. Ten is near the ceiling: the picker is a 4-column grid, the
glyph set has to stay distinguishable in greyscale, and the role colour ramp is
already staggered for deuteranopia. An eleventh role should have to fight for it.

Suggested one-liners, in the voice of the existing `ROLE_DESCRIPTIONS`:

```
decision:    "A choice already made: the options, the reason, the date. Do not silently revise."
example:     "Canonical shapes to imitate — this is what good looks like here."
environment: "How to run this thing: commands, ports, binaries, what breaks."
```

**Implementation cost (why it is not in WO02)**: `NodeRole` union + `NODE_ROLES` +
`ROLE_DESCRIPTIONS` + three new glyphs in `RoleGlyphs.tsx` + three `--role-*` tokens
+ `roleSkeleton.ts` templates + whatever `compile.rs` does with role grouping. And
because a role string is persisted in `graph.json`, this is a **schema change**:
`GRAPH_VERSION` 2 → 3 plus a migration (a no-op stamp forward — old graphs contain
no new roles — but a graph written by the new build **cannot** be read by the old
one, which is exactly why the version has to move).

**Gate before building**: confirm whether `compile.rs` orders or groups output by
role. If it does, three new roles change every compiled file, and that belongs in
the same change with a diff-preview walkthrough.

### 1.2 Agent roles — the fleet's job titles

The second reading. The current fleet already encodes a working vocabulary:
tech-lead · tech-general · tech-ui · tech-barn · tester · project-manager ·
product-analyst. Generalized, the roles a project actually needs are:

| Role | Duty | Verdict authority |
|---|---|---|
| **Lead / Architect** | Frozen contracts, seams, adversarial audit. Writes no product code. | Architecture, boundaries |
| **Implementer** | Core + feature work. Runs as N instances with disjoint zones. | — |
| **Interface** | The surface a human touches: layout, tokens, copy. | Interface |
| **Specialist** | One domain nobody else should touch (rendering, audio, crypto, ML). | Its domain |
| **Quality** | Manuals, gates, adversarial passes. Edits no product code. | Gate pass/fail |
| **Custodian** | Docs, tasks, records. Always the final agent in a session. | — |
| **Analyst** | Outside research: competitors, users, feasibility. On call, never in the default fleet. | — |

Two structural rules worth keeping when this is formalized: **verdict authority is
per-role and singular** (exactly one role decides each conflict class), and **the
Lead and the Quality roles never write product code** — an author cannot be their own
adversary.

Storage, when built: a `role` key in the **`.cowtext/agents.json` sidecar**, not in
the agent's `.md` frontmatter. Claude Code owns that frontmatter's schema; Cowtext
must not invent keys in a file another tool parses. The sidecar is Cowtext's own and
already versioned. This also keeps agent roles cleanly separate from node roles —
same word, different vocabularies, different files.

---

## 2. Item #19 — Departments

> "Each agent should have a defined Department. User can create its own Department.
> The list of default departments is based on Project's type."

### 2.1 The model

A **Department** is an org-chart grouping of agents. It is a label, a colour, and an
order — nothing more. It is *not* a permission boundary (that is item #20's
`controls` edge) and *not* a file zone (that is per-task, assigned by the Lead).

- An agent belongs to **exactly one** department, or to none (`Unassigned`).
- Departments are **project-scoped and user-editable**: create, rename, reorder,
  delete. Deleting a department moves its agents to `Unassigned` — it never deletes
  an agent, and it never blocks on being non-empty.
- The default list is **seeded from the project type at project creation** and is
  fully editable afterwards. Seeding is a starting point, not a constraint: a
  Video Game project that wants a "Live Ops" department gets one.

### 2.2 Defaults by project type

| Project type | Default departments |
|---|---|
| Video Game | Design · Art · Audio · Engineering · Gameplay · Tools · QA · Production |
| Desktop Application | Product · Engineering · Interface · Platform · QA · Docs |
| SaaS / Web | Product · Frontend · Backend · Infrastructure · Data · Security · QA · Growth |
| Library / SDK | API Design · Core · Docs · Release · QA |
| Research / Data | Research · Data Engineering · Modeling · Evaluation · Docs |
| *(fallback, unknown type)* | Product · Engineering · Interface · QA · Docs |

Every list ends with the two departments no project escapes — a quality function and
a documentation function — because a fleet without them silently stops having them.

### 2.3 Storage

`.cowtext/agents.json`, **v1 → v2**:

```jsonc
{
  "version": 2,
  "departments": [                       // NEW — ordered, project-scoped
    { "id": "eng", "name": "Engineering", "color": "#4C9BE8" }
  ],
  "agents": {
    "tech-ui.md": {
      "nickname": "...", "priority": 3, "influence": 50, "avatarSeed": "...",
      "department": "eng"                // NEW — department id, or absent
    }
  }
}
```

This is the sidecar, **not `graph.json`** — no `GRAPH_VERSION` bump, no graph
migration. The sidecar's own v1 → v2 migration is a read-time default (`departments:
[]`, `department` absent ⇒ Unassigned), which is the pattern the file already uses.
`color` is optional; when absent the UI derives one from the id hash, the same way
avatars already derive from `avatarSeed`.

### 2.4 Surfaces

- **AgentEditor / NewAgentDialog** — a Department select with an inline
  "＋ New department…" row (the same create-in-place idiom as WO02's tag picker).
- **Agents rail** — group by department when more than one department exists;
  flat list when there is one or none, so a solo project never sees org chrome.
- **Task board** — the agent filter gains department options ("all of Engineering").
- **Barn (later)** — departments are the natural mapping to pens/zones in the
  scene. Noted only; the Barn stays out of this until the data model has shipped.

### 2.5 Dependency and gate

Department **defaults** depend on project type, which does not exist until item #2
(new-project wizard) is built. Two viable orders:

1. Build #2 first, then departments seeded by type. Cleanest.
2. Build departments now with the *fallback* list and a manual editor; seeding is a
   one-line addition once #2 lands.

**Recommendation**: option 2 — the department model is useful the moment a project
has more than three agents, and it does not have to wait on the biggest feature in
the backlog. But it is still a whole UI surface plus a sidecar version bump, which
is why it is not in WO02.

---

## 3. Item #20 — Edge types, and what CONTROL really is

> "Think deeply about Edge's types. For example, 'Agent Task Manager' should
> CONTROL TASKS.md."

### 3.1 The insight

The four edge kinds we have — `imports` (inline), `references` (soft link),
`conditional` (glob/NL condition), `sequence` (order only) — are all answers to one
question: **what text ends up in the compiled file, and in what order?** They are
context-assembly edges. Every one of them is consumed by `compile.rs`.

"Agent Task Manager CONTROLS TASKS.md" is not that question. It says nothing about
what gets inlined. It says **who is allowed to write this file**. That is an
*authority* relation, and cramming it in as a fifth peer of `imports` would mean
every consumer of `EdgeKind` — validation, the Kahn topological sort, the three
compile adapters, the edge renderer, the readOrder step dots — has to learn to
ignore it. A kind that every consumer must special-case to ignore is not a kind.

**Proposal: two axes, not five kinds.**

| Axis | Kinds | Consumed by | Contributes to compile output |
|---|---|---|---|
| **Context** (today) | `imports` · `references` · `conditional` · `sequence` | `compile.rs`, readOrder | Yes |
| **Authority** (new) | `controls` · `observes` | tasks routing, review queue, barn attribution | **Never** |

An authority edge is *documentation of ownership that the app acts on*. It is
skipped by validation's cycle check and never enters the topological sort — a graph
where A controls B and B controls A is silly, but it is not a compile error, because
neither edge produces output.

### 3.2 `controls`

**Semantics** — source (a node with role `agent`) is the single authority for the
target node's file:

1. **Compile ignores it entirely.** No inlining, no ordering, no cycle
   participation. If `compile.rs` ever sees a `controls` edge in its topological
   input, that is a bug, not a policy choice.
2. **Task routing.** Tasks parsed out of a controlled file default to that agent
   when the line carries no `@agent` token. This is exactly the example: draw
   `Agent Task Manager → controls → TASKS.md` and every unassigned row in
   `TASKS.md` belongs to the Task Manager, with no per-row annotation.
3. **Review attribution.** An `fs://change` on a controlled file is labelled with
   its owner in the review strip and status bar. A write by anyone else surfaces as
   an **out-of-lane change** — the same amber channel as today's external-change
   banner, with a name attached.
4. **Exactly one `controls` edge may target a node.** A second one is a *validation
   error*, not a warning. Single ownership is the entire point; two owners is the
   state the edge exists to prevent.
5. **Generated files may not be controlled.** `CLAUDE.md`, `AGENTS.md`,
   `.cursor/rules/*` are owned by Compile. Pointing `controls` at one is a
   validation error with the same voice as the existing rename-protection guard.

### 3.3 `observes`

Source (an agent node) reads the target but never writes it. Cheap, and it earns its
place by making #2 above precise: it lets the review queue tell "this agent is
supposed to be in here" from "something wrote a file nobody owns", and it gives the
Barn a real reason to walk a cow to a specific prop.

### 3.4 Rejected kinds

- **`depends`** — either `imports` (I need your text) or `sequence` (I need to be
  read after you). Adding it invites the two to be confused.
- **`extends`** — `imports` with extra words.
- **`blocks`** — task-to-task blocking is the board's job, not the context graph's.
  Nodes are knowledge; tasks are work. Do not let the two vocabularies merge.
- **`contains`** — that is the filesystem, and it is already the tree in the rail.

### 3.5 Rendering

Authority edges must not read as context edges. Dashed stroke, no mid-line kind
marker, muted stroke colour, a small square cap at the target end (ownership lands
*on* the file), and **never** a numbered step dot. In the Inspector's Relations grid
they get their own section — "Authority" — below the context edges, so the count in
the status bar keeps meaning "context edges".

### 3.6 Implementation cost and gate

This is the largest of the three design items and touches the most dangerous file:

- `EdgeKind` union widening ⇒ persisted enum change ⇒ **`GRAPH_VERSION` 2 → 3 plus
  a migration** (forward stamp; old builds cannot read new graphs).
- `compile.rs` must **explicitly** filter authority kinds out of validation and the
  topological sort. A silent inclusion corrupts every compiled file in every
  project — this is the one place where "it compiled, so it works" is false.
- `KindPicker`, `MemoryEdge`, `edgePath.ts`, the Inspector Relations grid, the
  status-bar edge count, and the tasks store's agent resolution all need to learn
  the second axis.

**Gate before building**: a written enumeration of every `EdgeKind` consumer in the
codebase, each marked *handles authority edges* or *must filter them out*, reviewed
before a line is written. Then the migration test: a `version: 2` graph loads,
gains a `controls` edge, saves as `version: 3`, and `compile_preview` produces
**byte-identical** output to before the edge existed.

**Recommendation**: this is the headline feature of a WO03, after v0.1.0 ships. It
is the item in the whole dump with the most leverage — it is what turns Cowtext from
a context editor into an org chart the agents actually obey — and it is also the one
most likely to quietly corrupt output if it is rushed in beside a dozen quick wins.
