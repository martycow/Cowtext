// The shipped default task-format skill (F6) — a frozen constant, not a
// generator. Installed from the Skills rail via NewSkillDialog's "Use the
// built-in task-format skill" option, NOT from the project wizard (that
// keeps it off the trust-boundary path and out of that lane's file zone).
// Deliberately stricter than this repo's own `.claude/skills/task-format/
// SKILL.md`: this constant's grid is the six columns and nothing more —
// Name · Task Type · Priority · Tags · Status · Description — matching the
// backend's `map_columns` (src-tauri/src/tasks.rs) exactly.

/** Suggested skill directory name — `createSkill(name)` -> `skill_create`
 *  writes `.claude/skills/<name>/SKILL.md` verbatim from this. */
const NAME = "task-format";

const DESCRIPTION =
  "Reformat any task list into the strict six-column Cowtext task grid " +
  "(Name, Task Type, Priority, Tags, Status, Description) so every " +
  "convention file parses identically on the board. Load when asked to " +
  "normalize/reformat/grid-ify TASKS.md, SPRINT.md, BACKLOG.md, ROADMAP.md " +
  "or BUGS.md, or when a task's Type isn't showing up on the board.";

// Body only — no frontmatter fence here. `skill_save` (src-tauri/src/
// agents.rs) generates the `---\nname: …\ndescription: …\n---` block itself
// from the dialog's separate Name/Description fields; pasting a second
// frontmatter block into the body would duplicate it.
const BODY = `# task-format — the six-column Cowtext task grid

Cowtext's board (src-tauri/src/tasks.rs parser) reads FIVE convention files,
searched in this directory order (first hit per name wins): **project root
→ docs/ → docs/tasks/** — \`TASKS.md\`, \`SPRINT.md\`, \`BACKLOG.md\`,
\`ROADMAP.md\`, \`BUGS.md\`. Anything else is invisible to the board.

## The grid — exactly six columns, in this order

\`\`\`
| Name | Task Type | Priority | Tags | Status | Description |
| --- | --- | --- | --- | --- | --- |
| Ship the funnel port | bug | high | ui, wo09 | in progress | hover state broken |
\`\`\`

Nothing else — no Agent column, no Phase column, no Created column. The
header row is matched **case-insensitively by name, not by position** — a
table with the columns reordered still parses correctly, and columns this
skill doesn't use may be dropped or kept, at your discretion.

Recognized header cell text (case-insensitive, first match wins when two
cells would map to the same slot):

- **Name** — \`Name\` | \`Task\` | \`Title\`
- **Task Type** — \`Task Type\` | \`Type\` | \`Kind\`
- **Priority** — \`Priority\` | \`Prio\`
- **Tags** — \`Tags\`
- **Status** — \`Status\` | \`State\`
- **Description** — \`Description\` | \`Desc\` | \`Details\`

## Status normalization

Reformat every Status cell to one of these four canonical values (case and
punctuation-insensitive on the way in):

- \`new\` — from \`new\` | \`todo\`
- \`in production\` — from \`in progress\` | \`in production\` | \`wip\` | \`doing\`
- \`in testing\` — from \`testing\` | \`in testing\` | \`review\`
- \`done\` — from \`done\` | \`closed\`

Anything else defaults to \`new\` — never invent a fifth bucket.

## Priority normalization

Reformat every Priority cell to one of these four canonical values:

- \`low\` — from \`low\` | \`l\` | \`p3\`
- \`medium\` — from \`medium\` | \`med\` | \`normal\` | \`m\` | \`p2\`
- \`high\` — from \`high\` | \`h\` | \`p1\`
- \`critical\` — from \`critical\` | \`crit\` | \`blocker\` | \`urgent\` | \`p0\`

Text that doesn't match any alias is passed through **verbatim** — never
dropped, never guessed at.

## Task Type — free text, your call

Unlike Status/Priority, Task Type has no fixed vocabulary — it's whatever
taxonomy the project uses (\`bug\`, \`feature\`, \`chore\`, \`spike\`, \`docs\` are
common starting points, not a closed set). Keep it short (one or two words)
and consistent within a single file.

## Reformat procedure

1. Locate the five files across the three convention dirs (\`Glob\` for
   \`{,docs/,docs/tasks/}{TASKS,SPRINT,BACKLOG,ROADMAP,BUGS}.md\`). If a task
   list lives in a non-convention file, MOVE its rows into the right
   convention file (ask which one when unclear: actionable→TASKS,
   scoped→SPRINT, someday→BACKLOG, plan/history→ROADMAP, defect→BUGS).
2. Convert every task (checklist line or loosely-shaped table) into a row of
   the six-column grid above. Preserve every value; when a source field has
   no home in the grid (e.g. an Agent column), fold it into Description
   rather than discard it.
3. Preserve every non-task line (prose, headings, links) byte-for-byte;
   TASKS.md's \`##\` sprint headings stay where they are.
4. NEVER lose information: anything that doesn't fit a column stays in the
   Description cell.
5. Show the user a per-file summary (rows reformatted / left untouched) and,
   if Cowtext is running, remind them the board auto-refreshes via the
   watcher.

## Verify

After writing, re-read each file and check: the header row reads
\`| Name | Task Type | Priority | Tags | Status | Description |\` (or a
permutation with the same six names), every data row has six cells, and
Status/Priority cells use only the canonical values above. If the board
still misses or misreads a row, the row failed one of these shapes — fix the
row, not the parser.
`;

export const TASK_FORMAT_SKILL = {
  name: NAME,
  description: DESCRIPTION,
  body: BODY,
} as const;
