# AGENTS SUITE CONTRACT — Agents & Sub-Agents management suite (+ Named Calves)

**Status: FROZEN 2026-08-18.** Authored by tech-lead from Marty's approved plan
(`what-s-the-next-feature-bright-mountain`). Once lanes start, nothing in §2–§9 changes
without a tech-lead ratification note appended to §11.

Everything below was verified against the code at `d717dc3` before freezing:
`project.rs:77` dot-dir skip · `project.rs:194` `is_rename_protected` covers `.claude/` ·
`preset.rs:85` `slugify` (private) · `preset.rs:235` `File::create_new` · `project.rs:127`
`write_atomic` · `hooks.rs:32` `HOOK_EVENTS` has 3 entries, no `SubagentStop` ·
`hooks_server.rs:114` normalizes `SubagentStop` → `subagent_stop` · `mapper.ts:142` treats
`subagent_stop` as a no-op · `sfx.ts:3` records `calf_spawn`/`calf_despawn` as unwired ·
fleet agent files carry a `skills: [...]` frontmatter key (e.g. `.claude/agents/tech-ui.md:6`) ·
`lib.rs` `generate_handler!` currently lists **27** commands.

---

## 1. Scope

Ship, in one fleet run:

1. A **manager window** (modal, not canvas) for the agent files of the *open user project*:
   `.claude/agents/*.md` and `.claude/skills/<name>/SKILL.md` — full CRUD, full skill editor.
2. A **hand-rolled lossless frontmatter** read-patch-write layer in Rust (no YAML crate).
3. A **sidecar** `.cowtext/agents.json` (v1) for Cowtext-only advisory metadata.
4. A shared **identity hash** producing a deterministic avatar *and* a matching calf look.
5. **Named Calves** in the Barn: `subagent_stop` spawns a recurring, seed-stable calf.

Out of scope (do not build): agents on the graph canvas, compile-time effect of
`priority`/`influence`, launching agents, editing `.claude/settings.json` outside the existing
hooks trust boundary, any new dependency, any binary asset.

Invoke contract grows **27 → 37**. Rust test count grows from the current baseline
(reported 88 passing) by ≥ 25.

---

## 2. Command contract (10 new commands)

Rules that bind all ten:

- Three coordinated edits each: `#[tauri::command] pub fn` in `agents.rs`, an entry in
  `lib.rs::generate_handler![]`, and exactly one `invoke("<name>")` in `src/agents/api.ts`.
  Names are byte-exact as written below. Args camelCase in JS, snake_case in Rust.
- **Paths are built server-side.** The webview never sends a relative path. It sends
  `root` plus a single component (`fileName` / `dirName` / `name`); Rust builds
  `<root>/.claude/agents/<fileName>` or `<root>/.claude/skills/<dirName>/SKILL.md`.
- Every component passes `validate_component()` before use: non-empty after trim, no `/`,
  no `\`, no `:`, not `.` or `..`, no ASCII control chars, ≤ 100 chars. Agent file names
  must additionally end in `.md` (case-insensitive) and have a non-empty stem. The built
  path then still goes through `project::resolve_within_root` — belt and braces.
- Errors are plain `String` (the existing idiom). Every user-facing error names the entity.
- All writes use `project::write_atomic`. All creates use `fs::File::create_new`
  (never clobber). All renames check `dest.exists()` first and refuse.
- `.claude/` stays protected in `project::is_rename_protected` — these commands are the
  *only* sanctioned way in. Do not weaken the node-rename guard.

| # | Command | Rust signature | Returns |
|---|---|---|---|
| 1 | `agents_scan` | `(root: String)` | `AgentsScan` |
| 2 | `agent_create` | `(root: String, name: String)` | `AgentDoc` |
| 3 | `agent_save` | `(root: String, file_name: String, fields: Option<FmFields>, body: Option<String>, raw_content: Option<String>)` | `()` |
| 4 | `agent_rename` | `(root: String, file_name: String, new_name: String)` | `String` (new file name) |
| 5 | `agent_delete` | `(root: String, file_name: String)` | `()` |
| 6 | `skill_create` | `(root: String, name: String)` | `SkillDoc` |
| 7 | `skill_save` | `(root: String, dir_name: String, fields: Option<FmFields>, body: Option<String>, raw_content: Option<String>)` | `()` |
| 8 | `skill_rename` | `(root: String, dir_name: String, new_name: String)` | `String` (new dir name) |
| 9 | `skill_delete` | `(root: String, dir_name: String)` | `()` |
| 10 | `agents_meta_write` | `(root: String, content: String)` | `()` |

TS side (`src/agents/api.ts`, the ONLY file allowed to hold these ten `invoke()` calls):

```ts
agentsScan(root): Promise<AgentsScan>                       // invoke("agents_scan", { root })
agentCreate(root, name): Promise<AgentDoc>                  // { root, name }
agentSave(root, fileName, patch): Promise<void>             // { root, fileName, fields, body, rawContent }
agentRename(root, fileName, newName): Promise<string>       // { root, fileName, newName }
agentDelete(root, fileName): Promise<void>                  // { root, fileName }
skillCreate(root, name): Promise<SkillDoc>                  // { root, name }
skillSave(root, dirName, patch): Promise<void>              // { root, dirName, fields, body, rawContent }
skillRename(root, dirName, newName): Promise<string>        // { root, dirName, newName }
skillDelete(root, dirName): Promise<void>                   // { root, dirName }
agentsMetaWrite(root, content): Promise<void>               // { root, content }
```

Optional args are sent as `null` when absent (the `revealPath` idiom in `src/fs/api.ts`).

### 2.1 Per-command semantics

**`agents_scan`** — never fails on a bad individual file.
- Walks `<root>/.claude/agents/*.md` (non-recursive, `.md` case-insensitive) and
  `<root>/.claude/skills/*/SKILL.md` (one level of dirs; a dir without `SKILL.md` is skipped).
- A missing `.claude/`, `agents/` or `skills/` directory yields empty arrays, not an error.
- A file that parses badly is returned with `raw: true` and `parseError: Some(msg)`.
- A file that is not valid UTF-8 or is unreadable is **not** returned as a doc; its name goes
  into `skipped: Vec<String>` (`"agents/foo.md"` / `"skills/bar/SKILL.md"`, forward slashes).
- `metaJson` = the raw bytes of `<root>/.cowtext/agents.json` as a string, or `None` when the
  file is absent/unreadable. Rust does not parse it beyond existence.
- Results sorted: agents by `fileName`, skills by `dirName` (byte order).
- The command errors only when `root` is not a directory (`checked_root`).

**`agent_create`** — `name` → `slugify(name)` → `<slug>.md` under `.claude/agents/`.
`File::create_new`; on `AlreadyExists` return `Err("An agent named \"<slug>.md\" already exists")`.
Creates `.claude/agents/` if missing. Starter template (LF, exact):

```
---
name: <slug>
description: 
model: sonnet
tools: Read, Grep, Glob
skills: []
---

# <slug>

## Duties

## Boundaries
```

Returns the freshly parsed `AgentDoc`.

**`skill_create`** — `<slug>/SKILL.md` under `.claude/skills/`. `create_dir_all` the skill dir,
then `File::create_new` on `SKILL.md`; existing `SKILL.md` → `Err("A skill named \"<slug>\" already exists")`.
Template:

```
---
name: <slug>
description: 
---

# <slug>
```

**`agent_save` / `skill_save`** — read-patch-write per §3. Guards, in order:
1. `raw_content` XOR (`fields` and/or `body`); both present → `Err("Ambiguous save: raw content and fields")`; all three absent → `Ok(())` no-op.
2. Target must already exist (`is_file`), else `Err("No such agent/skill: …")`. Save never creates.
3. `raw_content` path: write the bytes verbatim, atomically. No parsing, no normalization.
4. `fields`/`body` path: re-read the file from disk, parse, patch, write. If the re-read doc is
   `raw` and `fields` was supplied → `Err("This file must be edited as raw text")`.

**`agent_rename`** — `new_name` → `slugify` → `<slug>.md`. Refuse if the destination exists.
`fs::rename`, then patch the `name:` frontmatter line of the renamed file to `<slug>`
(read-patch-write; if the doc is `raw`, skip the patch silently — the rename still succeeds and the
returned name is authoritative). Returns `<slug>.md`.

**`skill_rename`** — same over the directory: refuse if `<root>/.claude/skills/<slug>` exists,
`fs::rename` the directory, patch `name:` in the moved `SKILL.md`. Returns `<slug>`.

**`agent_delete`** — `fs::remove_file`. **`skill_delete`** — `fs::remove_dir_all` on the skill
directory only. Both are destructive: the UI MUST have confirmed (§7.3). Rust does not confirm.

**`agents_meta_write`** — `content` must parse as a JSON **object** containing a `"version"` key
whose value is a number, else `Err("Refusing to write invalid agents.json")`. Writes atomically to
`<root>/.cowtext/agents.json`. Rust stores bytes; the frontend owns the schema.

### 2.2 Two adjacent Rust changes

**`hooks.rs`** — `HOOK_EVENTS` becomes `[(&str, Option<&str>); 4]` with `("SubagentStop", None)`
appended last. Update the module docstring ("three hook events" → "four"), the comment in
`hooks/tests.rs`, and any test that asserts a count. Existing installs surface the new event
through the normal `hooks_preview` diff — no silent write, the trust boundary is untouched.

**`project.rs` (A5)** — `write_md_file` rejects the hooks file:

```rust
// hooks_write is the only sanctioned path into the trust boundary.
if rel_path.replace('\\', "/").to_ascii_lowercase() == ".claude/settings.json" {
    return Err("Use Install hooks to edit .claude/settings.json".to_string());
}
```
One `if`, one test in `project/tests.rs`. Do not broaden it to all of `.claude/` — that would
break nothing today but is scope the contract does not grant.

**`preset.rs`** — `slugify` becomes `pub(crate) fn slugify`; its error string generalizes to
`format!("Name has no usable characters: {name:?}")` and the doc comment loses "Preset".
No other line of `preset.rs` changes.

---

## 3. Frontmatter grammar and read-patch-write rules

`src-tauri/src/frontmatter.rs` — pure, no IO, no Tauri types. This is the correctness heart.

### 3.1 Grammar (subset, deliberate)

- A doc **has** frontmatter iff its first line is exactly `---` (after stripping a trailing `\r`
  and trailing spaces/tabs). Otherwise: no frontmatter, whole content is body, `raw: false`,
  fields empty.
- The block ends at the first later line that is exactly `---` (same stripping). No closing
  fence → `raw: true`, `parseError: "Unterminated frontmatter"`, whole content is body.
- Known keys, matched at **column 0** only: `name`, `description`, `model`, `tools`, `skills`.
  Key pattern `^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$`. A matching line whose key is not known is an
  `Extra` line.
- Any line inside the block that begins with a space or tab, or begins with `- ` at column 0
  (block-style YAML), makes the whole doc `raw: true` with
  `parseError: "Block-style YAML is not supported — edit as raw text"`.
- Blank lines and `#` comments inside the block are `Extra` lines.
- Parse result: `Vec<FmLine>` where `FmLine = Known { key, value_raw } | Extra { raw }`,
  preserving **every** line verbatim and in order.
- **Duplicate known key**: the first occurrence is the patch target; later occurrences are kept
  as `Extra` and never rewritten.
- Scalar value = the raw remainder, trimmed; if it is ≥ 2 chars and starts and ends with the same
  quote char (`"` or `'`), exactly one pair is stripped. No escape processing.
- List value (`tools`, `skills`), both forms accepted:
  - bracket: `[a, b]` (leading `[` and trailing `]` stripped, then comma split);
  - bare comma: `a, b`.
  Items are trimmed, one quote pair stripped, empty items dropped. Empty value → empty list.
  The originating form is remembered per key for round-trip fidelity.
- **EOL**: the doc's dominant EOL is CRLF if the file contains at least one `\r\n` and
  `crlf_count * 2 >= total_line_count`, else LF. Every line the patcher writes uses the dominant
  EOL. A trailing final newline present in the input is preserved.

### 3.2 Read-patch-write rules

1. Re-read the file from disk immediately before patching (never patch the client's copy).
2. Parse. If `raw` and `fields` was supplied → error (§2.1).
3. If the doc has no frontmatter block and `fields` is supplied with at least one non-empty value,
   a new block is **prepended**: `---`, the known lines in canonical order, `---`, blank line, then
   the existing content verbatim as body.
4. For each known key present in `fields`:
   - non-empty value → replace the value of the existing `Known` line **in place** (key spelling
     and position untouched; emitted as `key: value`), or, if no such line exists, append a new
     `Known` line immediately before the closing `---`.
   - cleared value (`null`, empty string after trim, or empty list) → delete that `Known` line.
5. Append order for keys that did not exist: `name`, `description`, `model`, `tools`, `skills`.
6. List emission preserves the original form for that key (bracket stays bracket, comma stays
   comma); a newly appended list key uses bracket form `key: [a, b]`. Items are emitted verbatim,
   joined with `", "`. An item containing a comma or a leading/trailing space is quoted with `"`.
7. Scalar emission: verbatim, unquoted, unless the value is empty (then the line is deleted) or it
   begins with `[`, `{`, `#`, `"`, `'`, or contains a `:` followed by a space — then it is wrapped
   in `"` (no inner escaping is attempted; such values are rejected instead if they contain `"`).
8. `body` supplied → the body replaces the old body verbatim, except that when the dominant EOL is
   CRLF, lone `\n` in the incoming body are normalized to `\r\n` (CodeMirror emits LF).
9. `body` absent → body bytes are preserved byte-for-byte.
10. **Invariant**: parse-then-emit with no patch is byte-identical to the input, for every input.

### 3.3 Required Rust tests (`frontmatter/tests.rs`, ≥ 12; `agents/tests.rs`, ≥ 8)

Frontmatter:
1. Round-trip byte-identical for all **7 real fleet agent files** (`.claude/agents/*.md` content
   pasted into the test as fixtures — no filesystem reads of the repo) and one `SKILL.md`.
2. Round-trip byte-identical for a CRLF document.
3. No-frontmatter document → body only, `raw == false`, fields empty; round-trip identical.
4. Unterminated fence → `raw`, `parseError`, body = whole content, round-trip identical.
5. Block-style (indented / `- item`) → `raw` with the block-style `parseError`.
6. Both list forms parse to the same `Vec<String>`; `tools: []` and `tools:` → empty.
7. Patch `description` on a doc carrying an unknown `memory: project` key → the unknown key, its
   position, and every comment survive **byte-identically**; only the description line changed.
8. Patch preserves list form: a comma-form `tools:` stays comma-form; a bracket-form stays bracket.
9. Cleared field (`model: null`) deletes the line; the rest is untouched.
10. New key appended before the closing fence in canonical order, with the dominant EOL.
11. Body replacement keeps the frontmatter byte-identical; LF body into a CRLF doc is normalized.
12. Duplicate known key: first is patched, the second survives verbatim.
13. Quoted scalar loses exactly one quote pair on parse and is re-emitted without gaining one.

Agents module:
1. `validate_component` rejects `..`, `a/b`, `a\b`, `` (empty), a 101-char name, `CON:`-style colons.
2. `agents_scan` on a project with no `.claude/` → empty arrays, `metaJson == None`, `Ok`.
3. `agents_scan` returns a bad-frontmatter file as `raw` + `parseError`, never an `Err`.
4. `agents_scan` fills `SkillDoc.extraFiles`/`extraFileCount` for a skill dir with side files.
5. `agent_create` twice with the same name → second is `Err`, first file unchanged on disk.
6. `agent_rename` onto an existing name → `Err`, both files still present.
7. `agent_rename` patches the `name:` line of the moved file.
8. `agent_save` with both `fields` and `raw_content` → `Err`; with neither → `Ok` no-op, file byte-identical.
9. `agent_save` on a missing file → `Err`, nothing created.
10. `skill_delete` removes the whole directory; `agent_delete` a missing file → `Err`.
11. `agents_meta_write` rejects `[]`, `"x"`, `{}` (no `version`), accepts `{"version":1,...}`.
12. `write_md_file` rejects `.claude/settings.json` (also `.CLAUDE/Settings.JSON`, backslashes).

---

## 4. Wire shapes

Rust `#[derive(Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]`.
`src/agents/types.ts` mirrors these 1:1 and is the only TS definition of them.

```ts
/** Known-key subset of the frontmatter. A total value: the UI always sends all five. */
export interface FmFields {
  name: string | null;        // null / "" ⇒ the key is deleted on save
  description: string | null;
  model: string | null;
  tools: string[];            // [] ⇒ the key is deleted on save
  skills: string[];
}

export interface AgentDoc {
  fileName: string;           // "tech-ui.md" — never a path
  fields: FmFields;
  body: string;               // everything after the closing fence, verbatim
  raw: boolean;               // true ⇒ edit `content` as whole text, fields are unusable
  parseError: string | null;
  content: string;            // full file text (raw fallback + dirty comparison)
}

export interface SkillDoc {
  dirName: string;            // "design-tokens"
  fields: FmFields;
  body: string;
  raw: boolean;
  parseError: string | null;
  content: string;
  /** Everything in the skill dir except SKILL.md: recursive, relative, forward
   *  slashes, sorted, capped at 100 entries. Drives the delete confirmation. */
  extraFiles: string[];
  extraFileCount: number;     // uncapped total
}

export interface AgentsScan {
  agents: AgentDoc[];         // sorted by fileName
  skills: SkillDoc[];         // sorted by dirName
  metaJson: string | null;    // raw .cowtext/agents.json bytes
  skipped: string[];          // unreadable / non-UTF-8 files, e.g. "agents/x.md"
}
```

Rust field names are the snake_case originals (`file_name`, `dir_name`, `parse_error`,
`extra_files`, `extra_file_count`, `meta_json`); serde renames them. `FmFields` derives
`Deserialize` as well because it is an input to the two save commands; `Option<String>` maps to
`string | null` and `Vec<String>` to `string[]`.

---

## 5. Sidecar — `.cowtext/agents.json` v1

Frontend-owned schema; Rust only validates "JSON object with a numeric `version`" and stores bytes.

```json
{
  "version": 1,
  "agents": {
    "tech-lead.md": { "nickname": "Ledger", "priority": 3, "influence": 50, "avatarSeed": "tech-lead" }
  }
}
```

- Key = the agent's `fileName` (with `.md`).
- `nickname`: string, default `""`, trimmed, ≤ 40 chars.
- `priority`: integer 1–5, default 3, clamped on read and write.
- `influence`: integer 0–100, default 50, clamped.
- `avatarSeed`: string, default = `fileName` with the trailing `.md` removed. Changing it rerolls
  both the avatar and the calf; it is the only user-facing identity lever.
- Serialization is **stable**, mirroring `serializeGraph`: keys of `agents` sorted byte-wise, field
  order exactly `nickname, priority, influence, avatarSeed`, 2-space indent, LF, trailing newline.
- `version !== 1` or the file not parsing as an object → the store sets `metaError`, keeps `meta`
  empty, and **blocks all meta writes** (never clobber someone else's file). The modal shows the
  error in its footer. Any future schema change bumps `version` and adds a migration.
- **Orphans** = keys in `agents` with no matching agent file (external rename/delete). They are
  never silently dropped: the raw entry objects are retained verbatim and re-emitted on every
  write, the modal footer shows `N orphaned entries · Clean up`, and only `cleanupOrphans()`
  removes them (one write). In-app rename/delete re-keys or removes the entry immediately, so
  in-app operations never create orphans.
- Unknown keys inside a *live* entry are dropped on the next write — accepted, v1 is a closed shape.

---

## 6. The `skills:` frontmatter convention

Recorded verbatim in the contract, in `src/agents/api.ts`'s header comment, and in the editor UI
as a one-line hint:

> `skills:` is a **Cowtext / ultracode convention**, not a Claude Code feature. Claude Code has no
> native per-agent skills key and ignores unknown frontmatter keys; the fleet's own agent files
> already use it. Attaching a skill in Cowtext records intent — it does not change what Claude
> Code loads.

The suite therefore never warns about, rewrites, or removes a `skills:` key it did not create.

---

## 7. Frontend contracts

### 7.1 Identity — `src/identity/identity.ts` (ONE shared pure module)

No imports except types. No DOM, no Pixi, no React, no store, no randomness, no `Date`.
Imported by both `src/agents/AgentAvatar.tsx` (lane C) and `src/scene/calf.ts` (lane D).

```ts
export type CalfProp = "bell" | "bandana" | "flower" | "tag" | "none";
export interface AvatarParams { rows: string[]; bits: number; accentIdx: number }
export interface CalfLook { patchMask: number; accentIdx: number; prop: CalfProp }

export function fnv1a32(s: string): number;      // >>> 0, Math.imul
export function avatarParams(seed: string): AvatarParams;
export function calfLook(seed: string): CalfLook;
export const ACCENT_ROLES: readonly NodeRole[];  // the 7 roles, order = roleMeta/NODE_ROLES
export function accentVar(accentIdx: number): string;  // `var(--role-${ACCENT_ROLES[i]})`
```

Frozen algorithm — any deviation changes every user's avatars:

- `norm(seed) = seed.trim().toLowerCase()`; empty → `"cowtext"`.
- `fnv1a32`: `h = 0x811c9dc5`; for each `charCodeAt(i)`: `h ^= c; h = Math.imul(h, 0x01000193)`;
  return `h >>> 0`. (Code units, not UTF-8 bytes — deterministic because only TS consumes it.)
- `h1 = fnv1a32(norm)`, `h2 = fnv1a32(norm + "#2")`.
- **Avatar**: 8×8, vertically symmetric. Cell index `i = row * 4 + col`, `row` 0–7 top→bottom,
  `col` 0–3 left→right (left half only); the right half mirrors (`col 4+k` = `col 3-k`).
  `bits = ((h1 & 0x0FFFFFF0) | 0x00CCCC00) >>> 0` — the AND clears rows 0 and 7 (breathing room),
  the OR guarantees a solid 2×4 core, so density is always 8–24 of 32 cells.
  Cell `i` is filled iff `(bits >>> i) & 1`. `rows` = 8 strings of 8 chars, `#` filled / `.` empty
  (the `RoleGlyphs.toPath` idiom consumes exactly this shape).
  `accentIdx = h2 % 7`.
- **Calf**: coat grid 4 wide × 3 tall, cell index `i = row * 4 + col`.
  `let m = (h1 >>> 8) & 0xfff;` if `popcount(m) < 2` then `m |= 0x041`; while `popcount(m) > 7`
  then `m &= m - 1` (clears the lowest set bit). `patchMask = m` → 2–7 patches, always.
  `accentIdx = h2 % 7` — **identical to the avatar**, so a calf and its avatar share a hue.
  `prop = ["bell","bandana","flower","tag","none"][(h2 >>> 8) % 5]`.
- Same seed ⇒ same avatar and same calf, forever, across sessions and processes.

### 7.2 Store — `src/store/agents.ts` (FROZEN INTERFACE; C and D code against this)

Zustand, `graph.ts` as the template. No React imports. The store owns all ten `api.ts` calls.

```ts
export type EntityKind = "agent" | "skill";
export interface Selection { kind: EntityKind; key: string }   // key = fileName | dirName

export interface AgentMeta { nickname: string; priority: number; influence: number; avatarSeed: string }
export const DEFAULT_META: AgentMeta;   // { nickname:"", priority:3, influence:50, avatarSeed:"" }

/** Draft = the editable mirror of one doc. `rawContent` is used iff `raw`. */
export interface DocDraft { fields: FmFields; body: string; rawContent: string; raw: boolean }

export interface AgentsState {
  root: string | null;
  loading: boolean;
  loadError: string | null;

  agents: AgentDoc[];                       // last saved state, sorted by fileName
  skills: SkillDoc[];                       // sorted by dirName
  skipped: string[];

  meta: Record<string, AgentMeta>;          // key = agent fileName
  metaError: string | null;                 // non-null ⇒ meta writes blocked
  orphanKeys: string[];

  selection: Selection | null;
  drafts: Record<string, DocDraft>;         // keyed by draftKey(selection)
  busy: boolean;                            // a command is in flight
  opError: string | null;                   // last operation error, cleared on next op

  loadAgents(root: string): Promise<void>;
  select(sel: Selection | null): void;
  updateDraft(sel: Selection, patch: Partial<DocDraft>): void;
  revertDraft(sel: Selection): void;
  saveDoc(sel: Selection): Promise<string | null>;      // null = success, else message
  createAgent(name: string): Promise<string | null>;
  createSkill(name: string): Promise<string | null>;
  renameSelected(newName: string): Promise<string | null>;
  deleteSelected(): Promise<string | null>;
  attachSkill(fileName: string, skillName: string): void;   // draft-only
  detachSkill(fileName: string, skillName: string): void;   // draft-only
  updateMeta(fileName: string, patch: Partial<AgentMeta>): void;  // 700 ms debounce
  cleanupOrphans(): Promise<string | null>;
}

export const useAgentsStore: /* create<AgentsState> */;
export function draftKey(sel: Selection): string;         // `${sel.kind}:${sel.key}`
export function isDirty(s: AgentsState, sel: Selection): boolean;
export function metaOrDefault(meta: Record<string, AgentMeta>, fileName: string): AgentMeta;
export function seedFor(meta: Record<string, AgentMeta>, fileName: string): string;
export function usedBy(agents: AgentDoc[], skillName: string): string[];   // agent fileNames
export function flushMetaSave(): void;                    // added to App.tsx beforeunload
```

Behaviour, frozen:

- **Explicit Save** for every document (these are user-project files — the `MarkdownTab` rule).
  Only `updateMeta` autosaves, debounced 700 ms, and only into the sidecar.
- `isDirty` compares the draft against the saved doc: `raw` docs compare `rawContent` vs
  `content`; otherwise `fields` (deep) and `body`.
- `saveDoc` sends `{ rawContent }` when `draft.raw`, else `{ fields, body }`; on success it
  refreshes that one entity from a full `agentsScan` (simplest correct choice) and clears the draft.
- `createAgent` / `createSkill` push the returned doc into the list, select it, no draft.
- `renameSelected` re-keys the draft, the selection, and the meta entry in one `set`.
- `deleteSelected` removes the doc, its draft, its meta entry, and selects the neighbouring row.
- Every mutating call sets `busy` true → false in a `finally`, and returns the error string
  rather than throwing. Concurrent calls while `busy` are refused with `"Busy"`.
- `attachSkill`/`detachSkill` mutate only the draft's `fields.skills` (dedup, stable order:
  existing order, appends at the end). Nothing reaches disk until Save.
- `updateMeta` is a no-op when `metaError !== null`.
- The store never touches `useGraphStore`, `useEventsStore`, or Pixi.

### 7.3 Modal component tree — `src/agents/*.tsx` (lane C)

`PresetsModal` is the shell reference (overlay, focus trap, Esc, `SECONDARY_BTN`/`ICON_BTN`
class constants). Panel widens to `w-[1040px] max-w-[94vw]`. Tokens only — no raw hex.
"Blue is you, amber is the cow": blue = user actions, amber = the dirty dot. Never mixed.

```
AgentsModal.tsx   shell + phase machine: "browse" | "confirmDeleteAgent" | "confirmDeleteSkill"
                  | "confirmDiscard" | "busy". Esc is inert while phase === "busy".
                  Loads via useAgentsStore.loadAgents(root) on mount. Footer: skipped files,
                  metaError, and "N orphaned entries · Clean up".
AgentList.tsx     left pane (280px): "Agents" and "Skills" sections; row = 11px AgentAvatar +
                  name + muted nickname; inline "New agent" / "New skill" name inputs; a create
                  collision renders Rust's error string under the input, verbatim.
AgentEditor.tsx   right pane. Identity header: 44px avatar, agent name + Rename, nickname input,
                  "Reveal file" via revealPath(root, `.claude/agents/${fileName}`).
                  Fields grid: description, model select (sonnet | opus | haiku | inherit | custom
                  text), priority stepper 1–5, influence slider 0–100, tools chip editor.
                  Skills attach checklist, each row showing "used by N".
                  Duties = CodeMirrorEditor, docKey = `${fileName}:${gen}` where `gen` increments
                  on every load/save/revert so the editor rebuilds on external change.
                  Save button + amber dirty dot. When doc.raw: one whole-file CodeMirror over
                  `rawContent` plus the parseError banner, and the fields grid is hidden.
SkillEditor.tsx   name / description fields + body editor, Rename, Delete (confirm lists
                  extraFiles and extraFileCount), and the "used by" agent list.
AgentAvatar.tsx   <svg viewBox="0 0 8 8" shapeRendering="crispEdges">, path built from
                  avatarParams(seed).rows with the RoleGlyphs `toPath` idiom; fill =
                  accentVar(accentIdx). Sizes 11 (rows) and 44 (header). aria-hidden.
```

Interaction rules: switching selection with a dirty draft → `confirmDiscard`
(Discard / Cancel / Save). Delete always confirms and names the file (agents) or the directory
plus its extra files (skills). Nothing in this lane calls `invoke` directly.

### 7.4 `App.tsx` (lane C)

`const AgentsModal = lazy(() => import("./agents/AgentsModal").then(m => ({ default: m.AgentsModal })))`,
`agentsOpen` state, a TopBar **Agents** button (lucide `Users`, 14px, `strokeWidth={1.5}`,
between Presets and Handoff, rendered only when `root !== null`), a `{agentsOpen && root !== null}`
Suspense mount, and `flushMetaSave()` added to the existing `beforeunload` flush. Nothing else in
`App.tsx` changes.

### 7.5 Barn — Named Calves (lane D)

`src/scene/calf.ts` (new), pure Pixi + `identity.ts` + `palette.ts` + `props.ts` primitives.
No React, no store imports (the mapper owns store access, as today).

```ts
export function makeCalf(look: CalfLook): CalfSprite;   // ~0.6 cow scale, programmatic
export class CalfHerd {
  constructor(layer: Container);
  spawn(seed: string): void;
  tick(dtMs: number, reduced: boolean): void;
  destroy(): void;
}
```

Frozen bounds:
- Cap **4** concurrent calves. A `spawn` at cap is ignored (never evict — eviction flickers).
- Lifecycle: appear at the door tile → hop to a free tile (not the cow's tile, not a prop tile,
  not another calf's tile; deterministic pick from the seed hash over the free list) → "✓" bubble
  via `makeBubble` → linger **4000 ms** → despawn (fade out ≤ 300 ms).
- `sfx.play("calf_spawn")` on spawn and `sfx.play("calf_despawn")` on despawn — the first call
  sites for those two cues. All gating stays inside `sfx.ts`; the `sfx.ts` "NOT WIRED" comment is
  updated by lane D (it is the only `sfx.ts` edit permitted, and it is a comment).
- `reducedMotion()` respected: no hop (appear at the target tile), no bounce, no fade; the bubble
  and the 4 s linger stay.
- Depth via `depthOf(tile, true)`; calves live in `layout.objects` like the cow.
- Colour: palette + `accentVar` hue mapped through `ROLE_ACCENT`; patches from `patchMask` over a
  4×3 coat grid; the prop is 2–3 px drawn with `Graphics`. No new assets, no base64.

`mapper.ts` — the `subagent_stop` arm stops being a no-op:
`ctx.herd.spawn(seedFor(e))` where `seedFor(e) = `${e.sessionId}#${ordinal}`` and `ordinal` is a
module-level per-`sessionId` counter starting at 1. `MapperCtx` gains `herd: CalfHerd`. The `other`
arm stays a no-op. Every existing `sfx.*` call site stays exactly where it is.

**Recorded limitation:** live hook payloads carry no agent name, so live seeds are
`sessionId#ordinal` — stable within a session, not across sessions. Cross-session identity is what
`calfLook()` delivers and what demo mode demonstrates.

`BarnScene.tsx` — construct one `CalfHerd(layout.objects)` beside the cow, pass it in `MapperCtx`,
call `herd.tick(ticker.deltaMS, reduced)` inside the existing ticker next to `layout.tick`, and
`herd.destroy()` in `cleanups`. Nothing else changes.

`demo.ts` — `DemoStep` gains an optional `sessionId?: string`; the player uses it in place of
`"demo"` when present. Two beats are added to `SCRIPT`, `{ kind: "subagent_stop", sessionId:
"tech-ui" }` and `{ kind: "subagent_stop", sessionId: "tester" }`, so the demo shows two stable,
visibly different recurring calves. `src/scene/types.ts` changes only if a type genuinely needs it —
`BarnEvent` is a mirror of the Rust wire shape and **must not** gain fields.

---

## 8. File-zone grid (zones are strictly disjoint; leaving your zone is forbidden)

| Lane | Agent | Files it may create or edit |
|---|---|---|
| **A** | tech-general | `src-tauri/src/frontmatter.rs` (new) · `src-tauri/src/frontmatter/tests.rs` (new) · `src-tauri/src/agents.rs` (new) · `src-tauri/src/agents/tests.rs` (new) · `src-tauri/src/lib.rs` · `src-tauri/src/hooks.rs` · `src-tauri/src/hooks/tests.rs` · `src-tauri/src/preset.rs` (*slugify visibility + doc comment + error string only*) · `src-tauri/src/project.rs` (*the A5 `write_md_file` guard only*) · `src-tauri/src/project/tests.rs` (*one added test*) |
| **B** | tech-general | `src/identity/identity.ts` (new) · `src/agents/types.ts` (new) · `src/agents/api.ts` (new) · `src/store/agents.ts` (new) |
| **C** | tech-ui | `src/agents/AgentsModal.tsx` · `src/agents/AgentList.tsx` · `src/agents/AgentEditor.tsx` · `src/agents/SkillEditor.tsx` · `src/agents/AgentAvatar.tsx` (all new) · `src/App.tsx` |
| **D** | tech-barn | `src/scene/calf.ts` (new) · `src/scene/mapper.ts` · `src/scene/BarnScene.tsx` · `src/scene/demo.ts` · `src/scene/types.ts` (*only if unavoidable; `BarnEvent` must not change*) · `src/scene/sfx.ts` (*the "NOT WIRED" comment line only*) |

Nobody else touches `src/agents/*.ts` (B) or `src/agents/*.tsx` (C) — same directory, disjoint
files. `App.tsx` is C-only. `lib.rs` is A-only. `src/store/agents.ts` is B-only.
Docs (`docs/**`, `.claude/skills/**`) belong to project-manager after the lanes land.

Cross-lane dependencies are **contract-only**: C and D code against §7.1/§7.2 before B lands, so a
lane may see unresolved imports until integration. Full-repo `npx tsc --noEmit` is an integration
gate, not a per-lane gate.

---

## 9. Acceptance gates

Repo-wide, after all four lanes land:

- `npm run build` (tsc strict + vite) clean; `npm run lint` 0 errors; no `any`, no new
  eslint-disable lines.
- `cargo clippy -- -D warnings` clean from `src-tauri/`; `cargo test` all green with ≥ 25 new tests.
- Invoke contract = **37**: the count of `#[tauri::command]` fns registered in
  `generate_handler!` equals the count of distinct `invoke("…")` names in `src/`.
- `package.json`, `Cargo.toml` unchanged (no new libraries). No binary or base64 asset added.
- `git status` shows no writes outside the four zones plus `docs/`.
- `.claude/agents/*.md` in this repo round-trip byte-identically through the parser (tests prove it).

Per-lane gates are listed with each lane's task list in the dispatch.

---

## 10. Deferred / explicitly not in this batch

Streaming assemble output, token-cost counts, resolved-context preview, unmapped-read adopt,
agents on the canvas, per-agent skill loading semantics inside Claude Code, calf name labels in
the scene, and any compile-time use of `priority`/`influence`.

---

## 11. Ratified deviations

None yet. Append here (dated, with the reason) — never edit §2–§9 in place.
