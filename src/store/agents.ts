// Agents & Sub-Agents store — AGENTS_SUITE_CONTRACT.md §7.2 (frozen interface,
// lanes C and D code against this). graph.ts is the template. No React
// imports. Owns all ten src/agents/api.ts calls; nobody else invokes them.
//
// Two persistence layers:
//  - Documents (.claude/agents/*.md, .claude/skills/*/SKILL.md) — explicit
//    Save only (these are user-project files, the MarkdownTab rule).
//  - Sidecar (.cowtext/agents.json v1) — updateMeta autosaves, debounced
//    700 ms, per §5.

import { create } from "zustand";
import {
  agentConvert,
  agentCreate,
  agentDelete,
  agentMemoryEnsure,
  agentRename,
  agentSave,
  agentsMetaWrite,
  agentsScan,
  skillCreate,
  skillDelete,
  skillRename,
  skillSave,
} from "../agents/api";
import { agentAvatarClear, agentAvatarRead, agentAvatarSet } from "../agents/avatarApi";
import { PROVIDER_IDS } from "../agents/types";
import type { AgentDoc, AgentsScan, FmFields, ProviderId, SkillDoc } from "../agents/types";
// Data only (no store, no React) — the built-in skill ids the sidecar's
// `builtinSkills` map is validated against. An id this build does not ship
// is dropped on read AND on write (WO15 §3.8), so an old project's stale
// entry never resurrects a skill that no longer exists.
import { BUILTIN_SKILLS } from "../resources";

// ── Types (contract §7.2) ───────────────────────────────────────────────

export type EntityKind = "agent" | "skill";

export interface Selection {
  kind: EntityKind;
  key: string; // fileName | dirName
}

/** WO15 §4.6 / Block 3b — the priority a brand-new agent starts at, and the
 *  fallback for a sidecar entry with no `priority` key (D-19). One constant:
 *  the wizard, the parser and the merge all read it, so "what does a new
 *  agent weigh?" has exactly one answer. */
export const DEFAULT_PRIORITY = 1;

export interface AgentMeta {
  nickname: string;
  priority: number;
  influence: number;
  avatarSeed: string;
  /** Orchestrator: the working folder this agent spawns into by default.
   *  "" => no default; the spawn path asks for one as it always has. */
  defaultCwd: string;
  /** Orchestrator: token ceiling for a session spawned from the fleet view.
   *  null => inherit the global default; 0 => explicitly unbounded; >0 =>
   *  that ceiling. Same 0-is-unbounded convention as the global setting. */
  defaultTokenCeiling: number | null;
  /** WO15 D-13 — which provider's model this agent is configured for.
   *  Absent = unknown (a sidecar written before WO15, or a value this build
   *  doesn't know); the UI derives it with
   *  `providerForModel(model) ?? DEFAULT_PROVIDER`. Cowtext-local: it is
   *  never written into the agent's own frontmatter. */
  provider?: ProviderId;
  /** WO15 A-20 (audit F1) — the model id chosen for a NON-Anthropic
   *  provider. `null` = no choice recorded ("Inherit from the session").
   *
   *  Anthropic is the one agent format with a `model:` key
   *  (PROVIDER_SUPPORT_MATRIX.md), so an Anthropic agent's model lives in
   *  its frontmatter and NEVER here — `serializeMeta` drops it. For every
   *  other provider the frontmatter has nowhere to put it, and the picker
   *  says the choice is "kept locally": this field is that locality. Before
   *  A-20 the choice reached neither file and was silently lost at Create.
   *
   *  Required (not `?:`) so `metaOrDefault(...).model` is always
   *  `string | null` — exactly what `ModelPicker`'s `model` prop takes. */
  model: string | null;
}

export const DEFAULT_META: AgentMeta = {
  nickname: "",
  priority: DEFAULT_PRIORITY,
  influence: 50,
  avatarSeed: "",
  defaultCwd: "",
  defaultTokenCeiling: null,
  model: null,
};

/** Draft = the editable mirror of one doc. `rawContent` is used iff `raw`. */
export interface DocDraft {
  fields: FmFields;
  body: string;
  rawContent: string;
  raw: boolean;
}

export interface AgentsState {
  root: string | null;
  loading: boolean;
  loadError: string | null;

  agents: AgentDoc[]; // last saved state, sorted by fileName
  skills: SkillDoc[]; // sorted by dirName
  skipped: string[];

  meta: Record<string, AgentMeta>; // key = agent fileName
  metaError: string | null; // non-null => meta writes blocked
  orphanKeys: string[];

  /** WO15 Block 4 — which BUILT-IN skills this project includes in its
   *  compile, read from the sidecar's `builtinSkills` map. An absent id is
   *  `false` (nothing is included by default); reset to `{}` by
   *  `loadAgents`, like every other per-project map here. */
  builtinInclude: Record<string, boolean>;

  selection: Selection | null;
  drafts: Record<string, DocDraft>; // keyed by draftKey(selection)
  busy: boolean; // a command is in flight
  opError: string | null; // last operation error, cleared on next op

  /** WO11 D4 — per-file autosave status for AGENT documents (skills keep the
   *  explicit-Save discipline and never touch these two maps). Absent key =
   *  "idle" (nothing pending, nothing failed). Never gated by `busy` — a
   *  keystroke autosave must not flicker every other control in the editor
   *  between enabled/disabled twice a second. */
  agentSaveState: Record<string, "idle" | "saving" | "saved" | "error">;
  agentSaveErrors: Record<string, string>;

  /** WO11 G6 — cached avatar data URLs, keyed by agent fileName. A key
   *  absent from the map means "not fetched yet"; a key present with `null`
   *  means "fetched, no custom avatar" (render the identicon). */
  avatars: Record<string, string | null>;

  /** WO11 D4 — CodeMirror's `docKey` seam: `${fileName}:${reloadNonce}`.
   *  Bumped only by `loadAgents` (every agent gets the current load's
   *  generation number) and by `bumpAgentReloadNonce` (the hook a future
   *  fs-watcher calls for an external change to one file) — NEVER by our
   *  own autosave, which is the whole point: the editor must rebuild when
   *  the file changed out from under it, and must NOT rebuild (losing the
   *  caret) just because the debounced save it triggered came back. Absent
   *  key = 0. */
  reloadNonce: Record<string, number>;

  /** HIGH fix (post-WO13, tester-found) — a reload arrived (assemble wrote
   *  the file) while `drafts[fileName]` held an edit `reloadAgentFromDisk`
   *  chose NOT to discard. `true` ⇒ `AgentEditor` shows the same "Reload
   *  from disk" banner `AgentMarkdownTab`/`FileMarkdownTab` already show,
   *  instead of the draft ever being silently replaced. Absent/false = no
   *  banner. Cleared by `dismissStaleAgent` (keep editing) or
   *  `discardStaleAgentDraft` (adopt the fresh content). */
  staleAgents: Record<string, boolean>;

  /** FULL project-open reset: discards drafts, selection, meta, timers and
   *  every per-file map, then re-scans. Reserved for opening a project and
   *  for the Inspector's explicit "Rescan agents" recovery button (WO15
   *  A-21) — anything that merely wants fresh SKILLS after writing one must
   *  call {@link AgentsState.reloadSkills} instead.
   *
   *  Flushes the sidecar and every pending agent autosave, awaited, BEFORE
   *  it discards anything (tester #10). */
  loadAgents(root: string): Promise<void>;
  /** WO15 A-21 (audit F2) — narrow refresh after something wrote a skill on
   *  disk (`skills_materialize`, "Reset to built-in"). Re-scans and replaces
   *  ONLY `skills`/`skipped`; the derived built-in three-state view
   *  (`useBuiltinSkillStates`) recomputes from that. Deliberately touches no
   *  drafts, no selection, no `meta`/`builtinInclude`, and cancels no
   *  autosave timer: those two call sites used `loadAgents`, which threw
   *  away an unsaved SkillEditor draft (skills are explicit-save, so a draft
   *  can be minutes old) and blanked the Inspector with no warning.
   *
   *  Best-effort: a failed re-scan leaves the current list on screen rather
   *  than emptying the rail; `loadAgents` remains the surface that reports a
   *  load error. A reply that arrives after the project changed is dropped. */
  reloadSkills(root: string): Promise<void>;
  select(sel: Selection | null): void;
  updateDraft(sel: Selection, patch: Partial<DocDraft>): void;
  revertDraft(sel: Selection): void;
  saveDoc(sel: Selection): Promise<string | null>; // null = success, else message
  /** WO11 D4 — the agent-only replacement for the Save button: updates the
   *  draft (as `updateDraft` does) and schedules a per-file, 500 ms debounced
   *  autosave keyed by `fileName` so two agents never share a timer. */
  agentEdit(fileName: string, patch: Partial<DocDraft>): void;
  /** Re-attempts a failed autosave immediately (bypasses the debounce). */
  retryAgentSave(fileName: string): void;
  createAgent(name: string, opts?: { fileName?: string; withMemory?: boolean }): Promise<string | null>;
  /** Idempotent backfill for an existing agent. null = success, else the message. */
  ensureMemory(fileName: string): Promise<string | null>;
  createSkill(name: string): Promise<string | null>;
  renameSelected(newName: string): Promise<string | null>;
  /** Selection-independent agent rename (graph-store rename routing).
   *  Resolves to the new fileName; throws the Rust error string. */
  renameAgentByFile(fileName: string, newName: string): Promise<string>;
  /** Convert a legacy context .md into a real agent file (moves it into
   *  .claude/agents/). Resolves to the new AgentDoc; throws on failure. */
  convertToAgent(relPath: string, newName: string): Promise<AgentDoc>;
  deleteSelected(): Promise<string | null>;
  attachSkill(fileName: string, skillName: string): void; // draft + autosave
  detachSkill(fileName: string, skillName: string): void; // draft + autosave
  updateMeta(fileName: string, patch: Partial<AgentMeta>): void; // 700 ms debounce
  /** WO15 Block 4 — include/exclude one built-in skill from this project's
   *  compile. Persists through the same 700 ms sidecar debounce
   *  `updateMeta` uses; an unknown id is ignored. */
  setBuiltinInclude(id: string, include: boolean): void;
  cleanupOrphans(): Promise<string | null>;
  /** WO11 G6 — lazily fetches and caches one agent's avatar; a no-op once
   *  the fileName key is already present in `avatars` (fetched or not). */
  loadAvatar(fileName: string): Promise<void>;
  /** `sourcePath` must come from `@tauri-apps/plugin-dialog`'s `open()` — see
   *  WO11_CONTRACT.md §4.2. null = success, else the message. */
  setAvatarImage(fileName: string, sourcePath: string): Promise<string | null>;
  clearAvatarImage(fileName: string): Promise<string | null>;
  /** Seam for a future fs-watcher: bump one file's `reloadNonce` so its open
   *  CodeMirror editor rebuilds from disk. Bumped by `reloadAgentFromDisk`
   *  below (WO13 defect 6) — no OTHER caller exists yet. */
  bumpAgentReloadNonce(fileName: string): void;
  /** WO13_CONTRACT.md §2.6/defect 6, agent half. Assemble writes an agent's
   *  `.md` file directly on disk (`write_atomic` in `assemble.rs`), which
   *  this store has no other way of learning about — `agent_save`'s queue
   *  is the assumed sole writer everywhere else, but assemble is a second,
   *  legitimate one. Re-reads the ONE named agent via a full `agentsScan`
   *  (the only read primitive `agents/api.ts` offers — there is no
   *  per-file agent read invoke) and splices just that entry back into
   *  `agents[]` unconditionally — `doc.fields`/`doc.body` always reflect
   *  disk truth after this resolves.
   *
   *  HIGH fix (tester-found, post-WO13): the draft is NOT always cleared
   *  any more. Whether `drafts[fileName]` holds a genuine unsaved edit is
   *  decided synchronously, inside the SAME `set()` call, by comparing it
   *  against the PRE-reload doc still sitting in the current state at that
   *  point — the store equivalent of `AgentMarkdownTab`'s pre-reload-
   *  baseline ref, except the store never needs a ref or a second ordered
   *  effect: unlike a component, it has the "before" and "after" in hand at
   *  once, in one atomic update, so there's no render in between where a
   *  stale comparison could sneak in.
   *    - Not dirty ⇒ same as before: draft cleared, `reloadNonce` bumped,
   *      any open CodeMirror instance rebuilds onto the fresh content.
   *    - Dirty ⇒ the draft is left COMPLETELY untouched (never a second
   *      writer — `saveAgentRaw`'s queue is still the only thing that ever
   *      writes an agent path) and `reloadNonce` is NOT bumped (no remount,
   *      no lost cursor/scroll); `staleAgents[fileName]` is set instead, so
   *      `AgentEditor` can show the same "Reload from disk" banner the
   *      Markdown tabs already show.
   *  Best-effort: a failed rescan leaves the stale content in place rather
   *  than surfacing a second error path for a rare race. The CALLER (a
   *  component, never the store itself — contract: "the subscription lives
   *  in the component") decides WHEN this fires. */
  reloadAgentFromDisk(fileName: string): Promise<void>;
  /** The stale banner's "Dismiss" (X) — keep editing, stay on the old
   *  baseline; the draft is untouched. Same UX as `FileMarkdownTab`'s
   *  `setStaleNotice(false)`. */
  dismissStaleAgent(fileName: string): void;
  /** The stale banner's "Reload from disk" — discards the draft (adopting
   *  the fresh `doc.fields`/`doc.body` `reloadAgentFromDisk` already
   *  spliced in), clears the stale flag, and bumps `reloadNonce` so
   *  CodeMirror remounts onto it. Mirrors `AgentMarkdownTab`'s
   *  `reloadFromDisk()` exactly (discard → adopt → remount → clear flag). */
  discardStaleAgentDraft(fileName: string): void;
}

// Rename fan-out: the GRAPH store keeps agent-backed nodes' filePath/title in
// sync by registering here (graph → agents import is one-directional; this
// callback list avoids the reverse import). Called after every successful
// agent rename with (oldFileName, newFileName, newName).
export type AgentRenameListener = (oldFileName: string, newFileName: string, newName: string) => void;
export const agentRenameListeners: AgentRenameListener[] = [];

function notifyAgentRenamed(oldFileName: string, newFileName: string, newName: string): void {
  for (const l of agentRenameListeners) l(oldFileName, newFileName, newName);
}

// Delete fan-out: same shape as the rename seam directly above, for the same
// reason (WO11_CONTRACT.md §10.3) — deleting an agent FILE from the rail's
// context menu must not silently orphan an adopted node on the graph, and
// the graph store cannot be reached from here directly (one-directional
// import). Called ONLY after `agent_delete` has actually succeeded on disk
// AND after this store's own `set()` has applied — never on the error path.
export type AgentDeleteListener = (fileName: string) => void;
export const agentDeleteListeners: AgentDeleteListener[] = [];

function notifyAgentDeleted(fileName: string): void {
  for (const l of agentDeleteListeners) l(fileName);
}

// ── Small pure helpers used both internally and exported (§7.2 / B6) ────

export function draftKey(sel: Selection): string {
  return `${sel.kind}:${sel.key}`;
}

function findDoc(st: Pick<AgentsState, "agents" | "skills">, sel: Selection): AgentDoc | SkillDoc | null {
  if (sel.kind === "agent") return st.agents.find((a) => a.fileName === sel.key) ?? null;
  return st.skills.find((s) => s.dirName === sel.key) ?? null;
}

function draftFromDoc(doc: AgentDoc | SkillDoc | null): DocDraft | null {
  if (doc === null) return null;
  return { fields: doc.fields, body: doc.body, rawContent: doc.content, raw: doc.raw };
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameFields(a: FmFields, b: FmFields): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.model === b.model &&
    sameStringArray(a.tools, b.tools) &&
    sameStringArray(a.skills, b.skills)
  );
}

/** Narrowed to exactly what it reads (mirrors `findDoc`'s own `Pick<...>`
 *  just above) rather than the full `AgentsState` — both call sites already
 *  pass the whole state, which still satisfies this structurally, and the
 *  narrower signature is what lets a pure-module Vitest test
 *  (`agents.test.ts`, §15: "no jsdom, no store/invoke wiring") construct a
 *  fixture without stubbing every action on the interface. */
export function isDirty(s: Pick<AgentsState, "agents" | "skills" | "drafts">, sel: Selection): boolean {
  const draft = s.drafts[draftKey(sel)];
  if (draft === undefined) return false;
  const doc = findDoc(s, sel);
  if (doc === null) return false;
  if (draft.raw) return draft.rawContent !== doc.content;
  return draft.body !== doc.body || !sameFields(draft.fields, doc.fields);
}

export function metaOrDefault(meta: Record<string, AgentMeta>, fileName: string): AgentMeta {
  return meta[fileName] ?? DEFAULT_META;
}

/** Effective identity seed: the stored avatarSeed, or the fileName stem when
 *  unset — "the only user-facing identity lever" (contract §5). */
export function seedFor(meta: Record<string, AgentMeta>, fileName: string): string {
  const m = meta[fileName];
  if (m !== undefined && m.avatarSeed !== "") return m.avatarSeed;
  return fileName.replace(/\.md$/i, "");
}

export function usedBy(agents: AgentDoc[], skillName: string): string[] {
  return agents.filter((a) => a.fields.skills.includes(skillName)).map((a) => a.fileName);
}

function byFileName(a: AgentDoc, b: AgentDoc): number {
  return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
}

function byDirName(a: SkillDoc, b: SkillDoc): number {
  return a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0;
}

// ── Sidecar parsing / serialization (§5) ────────────────────────────────

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : def;
  return Math.min(max, Math.max(min, n));
}

function clampNickname(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.slice(0, 40);
}

function defaultMetaFor(fileName: string): AgentMeta {
  return {
    nickname: "",
    priority: DEFAULT_PRIORITY,
    influence: 50,
    avatarSeed: fileName.replace(/\.md$/i, ""),
    defaultCwd: "",
    defaultTokenCeiling: null,
    model: null,
  };
}

/** A sidecar `provider` value, or `undefined` for anything this build does
 *  not know (WO15 §3.8: "any other value reads as absent"). */
function parseProvider(raw: unknown): ProviderId | undefined {
  if (typeof raw !== "string") return undefined;
  return PROVIDER_IDS.find((p) => p === raw);
}

/** A sidecar `model` value (WO15 A-20), or `null` for "no choice recorded".
 *  Anything that is not a non-blank string — a number, an object, `""`, a
 *  key the file never had — reads as `null`, i.e. "inherit from the
 *  session": the same tolerance rule every other field here follows, and
 *  the reason a hand-edited agents.json can never put the picker in a state
 *  it cannot leave. The string is kept VERBATIM (no trimming, no casing):
 *  model ids are opaque to Cowtext, and a custom id typed by the user is
 *  exactly as valid as one from the catalog. */
function parseModel(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw;
}

/** The ids this build ships a built-in skill for — the read/write filter for
 *  the sidecar's `builtinSkills` map. */
const BUILTIN_SKILL_IDS: readonly string[] = BUILTIN_SKILLS.map((s) => s.id);

/** `builtinSkills` per §3.8: only `include: true` entries exist, unknown ids
 *  are ignored. Anything malformed reads as "nothing included". */
function parseBuiltinInclude(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!BUILTIN_SKILL_IDS.includes(id)) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    if ((value as Record<string, unknown>).include === true) out[id] = true;
  }
  return out;
}

/** Skill text comparison normal form (WO15 §4.6): CRLF → LF, then trailing
 *  whitespace stripped. This is how "is the on-disk skill still the bundled
 *  one?" is decided — a checkout with `core.autocrlf` on, or an editor that
 *  added a final newline, must not read as "the user modified it". */
export function normalizeSkillContent(s: string): string {
  return s.replace(/\r\n/g, "\n").trimEnd();
}

/** null => inherit the global default; a finite number >= 0 is taken as-is
 *  (0 meaning unbounded). Anything else is treated as "not set". */
function parseCeiling(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.floor(raw);
}

function parseAgentMeta(raw: unknown, fileName: string): AgentMeta {
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const avatarSeedRaw = obj.avatarSeed;
  const provider = parseProvider(obj.provider);
  return {
    nickname: clampNickname(obj.nickname),
    priority: clampInt(obj.priority, DEFAULT_PRIORITY, 1, 5),
    influence: clampInt(obj.influence, 50, 0, 100),
    avatarSeed: typeof avatarSeedRaw === "string" ? avatarSeedRaw : fileName.replace(/\.md$/i, ""),
    defaultCwd: typeof obj.defaultCwd === "string" ? obj.defaultCwd : "",
    defaultTokenCeiling: parseCeiling(obj.defaultTokenCeiling),
    // Read unconditionally, even with no `provider` alongside it (a
    // hand-edited file, or one written by a build that dropped the
    // provider): keeping the id costs nothing, and `serializeMeta` is the
    // one place that decides whether it may be written back out.
    model: parseModel(obj.model),
    ...(provider !== undefined ? { provider } : {}),
  };
}

export interface ParsedMeta {
  meta: Record<string, AgentMeta>;
  metaError: string | null;
  orphanKeys: string[];
  orphan: Record<string, unknown>;
  builtinInclude: Record<string, boolean>;
}

const EMPTY_PARSED_META: ParsedMeta = {
  meta: {},
  metaError: null,
  orphanKeys: [],
  orphan: {},
  builtinInclude: {},
};

/** Exported for `agents.test.ts` only (pure, no store access) — the same
 *  reason `isDirty` is exported: the sidecar's wire shape is a contract
 *  (§3.8 + A-20) and the round trip through {@link serializeMeta} is what
 *  pins it. Nothing outside this module calls it in production. */
export function parseMetaJson(raw: string | null, agents: AgentDoc[]): ParsedMeta {
  if (raw === null) return { ...EMPTY_PARSED_META };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_PARSED_META, metaError: "Could not parse .cowtext/agents.json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...EMPTY_PARSED_META, metaError: "agents.json is not an object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version !== 1) {
    return {
      ...EMPTY_PARSED_META,
      metaError: `Unsupported agents.json version: ${JSON.stringify(obj.version)}`,
    };
  }
  const agentsRaw =
    typeof obj.agents === "object" && obj.agents !== null && !Array.isArray(obj.agents)
      ? (obj.agents as Record<string, unknown>)
      : {};
  const known = new Set(agents.map((a) => a.fileName));
  const meta: Record<string, AgentMeta> = {};
  const orphan: Record<string, unknown> = {};
  const orphanKeys: string[] = [];
  for (const [key, value] of Object.entries(agentsRaw)) {
    if (known.has(key)) {
      meta[key] = parseAgentMeta(value, key);
    } else {
      orphan[key] = value;
      orphanKeys.push(key);
    }
  }
  orphanKeys.sort();
  return {
    meta,
    metaError: null,
    orphanKeys,
    orphan,
    builtinInclude: parseBuiltinInclude(obj.builtinSkills),
  };
}

/** Exported for tests — see {@link parseMetaJson}. */
export function serializeMeta(
  meta: Record<string, AgentMeta>,
  orphan: Record<string, unknown>,
  builtinInclude: Record<string, boolean>,
): string {
  const agentsOut: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(meta), ...Object.keys(orphan)])].sort();
  for (const k of keys) {
    // Live meta always wins over stale orphan data for a shared key: a key
    // only stays orphaned while no agent file claims it. If both are
    // present (e.g. reconciliation hasn't run yet), the freshly-entered
    // live entry must never be shadowed by a stale sidecar payload.
    if (k in meta) {
      const m = meta[k];
      agentsOut[k] = {
        nickname: m.nickname,
        priority: m.priority,
        influence: m.influence,
        avatarSeed: m.avatarSeed,
        defaultCwd: m.defaultCwd,
        defaultTokenCeiling: m.defaultTokenCeiling,
        // Emitted only when set (§3.8): an agent whose provider was never
        // chosen keeps the key out of the file rather than baking today's
        // default into every project's sidecar.
        ...(m.provider !== undefined ? { provider: m.provider } : {}),
        // `model` (A-20) — emitted only for a NON-Anthropic provider that
        // actually has an id. Two exclusions, each for its own reason:
        //   • no provider ⇒ nothing to interpret the id against, and the
        //     UI would derive the provider from the FRONTMATTER model
        //     anyway, so a stray sidecar id could only contradict it;
        //   • anthropic ⇒ `model:` belongs in the agent's frontmatter,
        //     which Claude Code actually reads. Writing it here too would
        //     create a second source of truth that silently wins or loses
        //     depending on which surface you opened last.
        ...(m.model !== null && m.provider !== undefined && m.provider !== "anthropic"
          ? { model: m.model }
          : {}),
      };
    } else {
      agentsOut[k] = orphan[k];
    }
  }
  // `builtinSkills` — only `include: true` entries, only ids this build
  // ships, sorted, and the whole key omitted when nothing is included
  // (§3.8). Absence IS false, so a project that includes nothing looks
  // exactly like one written before WO15.
  const builtinOut: Record<string, { include: true }> = {};
  for (const id of [...BUILTIN_SKILL_IDS].sort()) {
    if (builtinInclude[id] === true) builtinOut[id] = { include: true };
  }
  // Version stays 1 through the orchestrator's two added keys. The bump rule
  // exists for BREAKING schema changes; these are additive with defaults, and
  // parseMetaJson hard-rejects any version !== 1 — so bumping would make an
  // older build discard every agent's meta instead of just ignoring two keys
  // it does not know. Backward AND forward compatible is worth more here.
  const stable = {
    version: 1,
    agents: agentsOut,
    ...(Object.keys(builtinOut).length > 0 ? { builtinSkills: builtinOut } : {}),
  };
  return `${JSON.stringify(stable, null, 2)}\n`;
}

// Raw orphan entries, retained verbatim for re-emission. Not part of public
// state (the contract exposes only `orphanKeys: string[]`); module-level like
// graph.ts's `saveTimer`, scoped to this store's lifetime.
let orphanRaw: Record<string, unknown> = {};
let metaSaveTimer: ReturnType<typeof setTimeout> | undefined;

// Monotonic — every `loadAgents` (a fresh project OR an explicit rescan)
// gets the next number, stamped onto every agent's `reloadNonce`. This is
// what lets the SAME fileName in two different projects (or a rescan that
// picked up an external edit) still force a CodeMirror rebuild, while our
// own autosave — which never touches this counter — does not.
let agentsLoadGeneration = 0;

/** Removes `key` from the module-level orphan bookkeeping if present, and
 *  returns the reconciled AgentMeta parsed from the stale orphan payload
 *  (so a recreated/renamed-into agent inherits its old metadata) — or
 *  `undefined` if `key` was not orphaned. Callers still own updating
 *  `orphanKeys` in state and, when this returns non-undefined, `meta`. */
function reconcileOrphan(key: string): AgentMeta | undefined {
  if (!(key in orphanRaw)) return undefined;
  const reconciled = parseAgentMeta(orphanRaw[key], key);
  delete orphanRaw[key];
  return reconciled;
}

async function flushMetaSaveInternal(): Promise<void> {
  const s = useAgentsStore.getState();
  if (s.root === null || s.metaError !== null) return;
  const content = serializeMeta(s.meta, orphanRaw, s.builtinInclude);
  try {
    await agentsMetaWrite(s.root, content);
  } catch {
    // Best-effort autosave; the next edit reschedules a retry.
  }
}

function scheduleMetaSave(): void {
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => {
    void flushMetaSaveInternal();
  }, 700);
}

/** Forces an immediate sidecar write, bypassing the debounce. Wired into
 *  App.tsx's beforeunload flush (lane C).
 *
 *  Returns the write's promise (never rejects — `flushMetaSaveInternal`
 *  swallows) so a caller that is about to DESTROY the state this writes from
 *  can await it; the fire-and-forget call sites are unaffected, since
 *  ignoring a returned promise is exactly what they already do. */
export function flushMetaSave(): Promise<void> {
  clearTimeout(metaSaveTimer);
  metaSaveTimer = undefined;
  return flushMetaSaveInternal();
}

// ── Agent document autosave (WO11 §5.7 / D4) ────────────────────────────
//
// Per-fileName debounce, 500 ms, so two agents can never share a timer. The
// three correctness properties the contract calls out by name:
//   - no write storm       → one timer per file, cleared and reset on every
//                             edit (ordinary debounce).
//   - no interleaved        → every write attempt for a file is APPENDED to
//     out-of-order writes     that file's own `tail` promise chain
//                             (`runAgentSave`) — at most one `agent_save` is
//                             ever in flight per file, and later attempts
//                             always land after earlier ones, never before.
//   - no lost last keystroke → `performAgentSave` reads the draft FRESH at
//                             the moment its turn in the chain actually
//                             runs, not a snapshot taken when it was
//                             enqueued — so a turn that starts after more
//                             keystrokes arrived saves those keystrokes too.
//
// WO11 tester audit, fix round 1 (HIGH #1): the previous design tracked a
// single `promise | null` per file and, when a caller asked for a save while
// one was already in flight, set a `pendingAfterFlight` flag and handed back
// the ALREADY-IN-FLIGHT promise — which resolves when the OLD write lands,
// not the newer follow-up it just scheduled. `flushAgentSaveFor` (used
// before rename/delete, where the contract promises the write "must land or
// fail before the file moves") awaited exactly that stale promise, so it
// could report done while the write holding the user's latest keystroke was
// still in flight, unguarded, under the file's OLD name — `agent_rename`
// would then move the file out from under it, `agent_save` would fail
// cleanly (`path.is_file()`), and the error would land in
// `agentSaveState`/`agentSaveErrors` keyed to a fileName no panel was
// showing anymore. A silently lost keystroke with a misdirected error.
//
// The chain below removes the two-state (`promise`/`pendingAfterFlight`)
// tracking entirely: `runAgentSave` always returns a promise for the turn IT
// just enqueued, chained strictly after whatever was queued before it. A
// caller that awaits its own return value is therefore always waiting for
// ITS turn (and everything ahead of it) to actually settle — never a stale
// reference to someone else's write. Because that turn is *whatever is
// queued at the time it runs*, and `flushAgentSaveFor` is called and awaited
// synchronously before `agent_rename`/`agent_delete` proceed, the rename/
// delete can no longer race ahead of the write that holds the latest
// keystroke, and any failure surfaces while the old fileName is still the
// live selection.

interface AgentSaveQueueEntry {
  timer: ReturnType<typeof setTimeout> | undefined;
  /** FIFO chain of every write attempt for this file. Never rejects (see
   *  `runAgentSave`), so it never wedges. */
  tail: Promise<void>;
}

const agentSaveQueues = new Map<string, AgentSaveQueueEntry>();

function queueFor(fileName: string): AgentSaveQueueEntry {
  let q = agentSaveQueues.get(fileName);
  if (q === undefined) {
    q = { timer: undefined, tail: Promise.resolve() };
    agentSaveQueues.set(fileName, q);
  }
  return q;
}

/** Enqueues one write attempt for `fileName`, serialized strictly after
 *  whatever is already queued for that file. The returned promise resolves
 *  to THIS attempt's own outcome (`null` = landed or was a no-op, else the
 *  message) once this attempt — and everything ahead of it in the chain —
 *  has settled. Safe to await before a rename/delete, and safe for
 *  `saveAgentRaw` to read directly: unlike sharing `agentSaveErrors[fileName]`
 *  (which can hold a STALE message left by a different, unrelated attempt),
 *  the value threaded through this promise is never anyone else's.
 *
 *  `rawOverride`, when present, writes exactly that text as a whole-file
 *  raw save instead of reading `st.drafts` — this is `saveAgentRaw`'s path
 *  (WO11_CONTRACT.md §12.3/§12.5): the Markdown tab's buffer, and a review
 *  revert's snapshot, are NOT the structured fields-grid draft and must not
 *  create or disturb one. */
function runAgentSave(fileName: string, rawOverride?: string): Promise<string | null> {
  const q = queueFor(fileName);
  // `result` is what THIS call hands back to ITS caller. `q.tail` only needs
  // to track completion for ordering (not the value), and must never
  // reject — so it is derived from `result` but always settles to
  // `undefined` regardless of that outcome.
  const result = q.tail.then(
    () => performAgentSave(fileName, rawOverride),
    () => performAgentSave(fileName, rawOverride),
  );
  q.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function performAgentSave(fileName: string, rawOverride?: string): Promise<string | null> {
  const s = useAgentsStore.getState();
  if (s.root === null) return "No project open";
  const doc = s.agents.find((a) => a.fileName === fileName);
  if (doc === undefined) return rawOverride === undefined ? null : "Agent not found";

  let patch: { fields?: FmFields; body?: string; rawContent?: string };
  if (rawOverride !== undefined) {
    if (rawOverride === doc.content) {
      useAgentsStore.setState((st) => {
        if (st.agentSaveState[fileName] === undefined || st.agentSaveState[fileName] === "idle") return {};
        return { agentSaveState: { ...st.agentSaveState, [fileName]: "idle" } };
      });
      return null;
    }
    patch = { rawContent: rawOverride };
  } else {
    const sel: Selection = { kind: "agent", key: fileName };
    const draft = s.drafts[draftKey(sel)];
    if (draft === undefined) return null; // nothing was ever edited — a background timer with no draft
    const unchanged = draft.raw
      ? draft.rawContent === doc.content
      : draft.body === doc.body && sameFields(draft.fields, doc.fields);
    if (unchanged) {
      useAgentsStore.setState((st) => {
        if (st.agentSaveState[fileName] === undefined || st.agentSaveState[fileName] === "idle") return {};
        return { agentSaveState: { ...st.agentSaveState, [fileName]: "idle" } };
      });
      return null;
    }
    patch = draft.raw ? { rawContent: draft.rawContent } : { fields: draft.fields, body: draft.body };
  }

  const root = s.root;
  useAgentsStore.setState((st) => ({
    agentSaveState: { ...st.agentSaveState, [fileName]: "saving" },
  }));
  try {
    const savedDoc = await agentSave(root, fileName, patch);
    useAgentsStore.setState((st) => {
      // The file may have been renamed/deleted while this save was in
      // flight; only splice the result back in if it is still present.
      if (!st.agents.some((a) => a.fileName === fileName)) return {};
      const agents = st.agents.map((a) => (a.fileName === fileName ? savedDoc : a)).sort(byFileName);
      const agentSaveErrors = { ...st.agentSaveErrors };
      delete agentSaveErrors[fileName];
      // A raw-override write (Markdown tab / review revert) is not the
      // structured draft the Agent panel edits — clear any stale draft so
      // that panel falls back to the fresh, freshly-re-parsed `savedDoc`
      // instead of continuing to show whatever it had before. A normal
      // draft-driven save leaves the draft alone (D4 §5.7 — avoids an
      // in-progress keystroke burst losing its caret to a rebuild).
      const drafts = { ...st.drafts };
      if (rawOverride !== undefined) delete drafts[draftKey({ kind: "agent", key: fileName })];
      return {
        agents,
        drafts,
        agentSaveState: { ...st.agentSaveState, [fileName]: "saved" },
        agentSaveErrors,
      };
    });
    return null;
  } catch (e) {
    const msg = String(e);
    useAgentsStore.setState((st) => ({
      agentSaveState: { ...st.agentSaveState, [fileName]: "error" },
      agentSaveErrors: { ...st.agentSaveErrors, [fileName]: msg },
    }));
    return msg;
  }
}

function scheduleAgentSave(fileName: string): void {
  const q = queueFor(fileName);
  clearTimeout(q.timer);
  q.timer = setTimeout(() => {
    q.timer = undefined;
    void runAgentSave(fileName);
  }, 500);
}

/** Awaited flush for a single file — used before a rename/delete (where the
 *  write must land or fail before the file moves) and before WO11 §12's
 *  agent-aware Markdown tab mounts (`Inspector.tsx`'s `openMarkdownTab`),
 *  so the store is quiescent and `AgentDoc.content` is current before that
 *  branch reads it. Distinct from the fire-and-forget `flushAgentSave()`
 *  below (used for navigation/unload, where nothing can be awaited) — do
 *  not collapse the two.
 *
 *  Always enqueues (and awaits) a fresh turn rather than branching on
 *  whether a timer/in-flight write already exists: `runAgentSave` chains
 *  strictly after whatever is already queued, so this is correct whether
 *  nothing is pending (the turn reads an unchanged draft and no-ops fast —
 *  see `performAgentSave`'s `unchanged` check), a debounce timer is still
 *  counting down (cleared here so the turn runs now instead of at +500 ms),
 *  or a write is already in flight (the turn queues behind it and reads
 *  whatever the draft looks like BY THE TIME its turn actually runs — so it
 *  still captures a keystroke that arrived after this call started). This is
 *  precisely the fix for HIGH #1: no branch here can return a promise that
 *  resolves before the LATEST queued write for this file has settled. */
export async function flushAgentSaveFor(fileName: string): Promise<void> {
  const q = agentSaveQueues.get(fileName);
  if (q === undefined) return; // this agent was never edited — nothing to flush
  clearTimeout(q.timer);
  q.timer = undefined;
  await runAgentSave(fileName);
}

/** Awaited counterpart of `flushAgentSave()` below: settles EVERY file that
 *  has a queue entry, in parallel. Used by `loadAgents`, which clears those
 *  queues outright a line later — a 500 ms debounce still counting down at
 *  that moment holds the user's last keystroke, and clearing the timer threw
 *  it away silently (tester #10). Runs while `root` still names the OLD
 *  project, so each write lands where it belongs. Never rejects
 *  (`runAgentSave` resolves failures as a message string). */
async function flushPendingAgentSaves(): Promise<void> {
  await Promise.all([...agentSaveQueues.keys()].map((fileName) => flushAgentSaveFor(fileName)));
}

/** Best-effort flush of every pending agent autosave — mirrors
 *  `flushMetaSave`'s idiom (fire, don't await) because its exported contract
 *  is `(): void`. Wired into App.tsx's beforeunload handler, agent selection
 *  change and project close (lane UI-B); rename/delete and the Markdown tab
 *  use the awaited `flushAgentSaveFor` instead, where a real guarantee is
 *  needed. */
export function flushAgentSave(): void {
  for (const [fileName, q] of agentSaveQueues) {
    if (q.timer !== undefined) {
      clearTimeout(q.timer);
      q.timer = undefined;
      void runAgentSave(fileName);
    }
    // A file with no pending timer either has nothing dirty, or already has
    // a write in flight/queued in its `tail` chain — either way it will
    // settle on its own; nothing to do here for a fire-and-forget flush.
  }
}

/** WO11_CONTRACT.md §12.3/§12.5/§12.6 — the frozen seam for any surface that
 *  owns a whole-file buffer for an agent (the Markdown tab; a review
 *  revert's snapshot) instead of the structured fields-grid draft. Enqueues
 *  a raw whole-file write on the SAME per-file `runAgentSave` queue
 *  `agentEdit` uses — never a second queue, never `write_md_file` — after
 *  first clearing any pending debounce timer, so a stale structured-draft
 *  turn cannot land after this one and clobber it (the "flush, then write"
 *  guarantee, folded into one call so every caller gets it for free without
 *  having to also call `flushAgentSaveFor` itself). Resolves `null` on
 *  success or a true no-op, else the message — always THIS attempt's own
 *  outcome, never a stale `agentSaveErrors[fileName]` left by an unrelated
 *  earlier failure. Never gated by, and never sets, the global `busy` flag,
 *  matching `agentEdit`'s autosave discipline. A free function, like
 *  `flushAgentSave`/`flushAgentSaveFor` above — not a store action — so a
 *  caller with only a `fileName`/`text` pair (no `Selection`, no draft) can
 *  use it directly. */
export async function saveAgentRaw(fileName: string, text: string): Promise<string | null> {
  const s = useAgentsStore.getState();
  if (s.root === null) return "No project open";
  const q = queueFor(fileName);
  clearTimeout(q.timer);
  q.timer = undefined;
  return runAgentSave(fileName, text);
}

// ── Store ─────────────────────────────────────────────────────────────

export const useAgentsStore = create<AgentsState>((set, get) => ({
  root: null,
  loading: false,
  loadError: null,

  agents: [],
  skills: [],
  skipped: [],

  meta: {},
  metaError: null,
  orphanKeys: [],
  builtinInclude: {},

  selection: null,
  drafts: {},
  busy: false,
  opError: null,

  agentSaveState: {},
  agentSaveErrors: {},
  avatars: {},
  reloadNonce: {},
  staleAgents: {},

  loadAgents: async (root) => {
    // Tester #10 — everything below this point DISCARDS state. A sidecar
    // toggle flipped less than 700 ms ago and a keystroke less than 500 ms
    // ago are, at this instant, still nothing but a pending timer; the old
    // first two statements of this action (`clearTimeout` + `.clear()`)
    // deleted them without a trace. Flush both first, awaited, while
    // `root`/`meta`/`drafts` still describe the project those writes are
    // for. Neither call can reject.
    await flushMetaSave();
    await flushPendingAgentSaves();
    clearTimeout(metaSaveTimer);
    orphanRaw = {};
    for (const q of agentSaveQueues.values()) clearTimeout(q.timer);
    agentSaveQueues.clear();
    set({
      root,
      loading: true,
      loadError: null,
      agents: [],
      skills: [],
      skipped: [],
      meta: {},
      metaError: null,
      orphanKeys: [],
      builtinInclude: {},
      selection: null,
      drafts: {},
      busy: false,
      opError: null,
      agentSaveState: {},
      agentSaveErrors: {},
      avatars: {},
      reloadNonce: {},
      staleAgents: {},
    });
    try {
      const scan: AgentsScan = await agentsScan(root);
      const parsed = parseMetaJson(scan.metaJson, scan.agents);
      orphanRaw = parsed.orphan;
      agentsLoadGeneration += 1;
      const gen = agentsLoadGeneration;
      const reloadNonce: Record<string, number> = {};
      for (const a of scan.agents) reloadNonce[a.fileName] = gen;
      set({
        agents: scan.agents,
        skills: scan.skills,
        skipped: scan.skipped,
        meta: parsed.meta,
        metaError: parsed.metaError,
        orphanKeys: parsed.orphanKeys,
        builtinInclude: parsed.builtinInclude,
        loading: false,
        reloadNonce,
      });
    } catch (e) {
      set({ loading: false, loadError: String(e) });
    }
  },

  reloadSkills: async (root) => {
    try {
      const scan: AgentsScan = await agentsScan(root);
      // The project may have closed or switched while the scan was in
      // flight; a late reply must never repopulate another project's rail.
      if (get().root !== root) return;
      set({ skills: scan.skills, skipped: scan.skipped });
    } catch {
      // Best-effort — see the interface doc comment. Nothing is cleared on
      // this path, so a transient read failure costs the user nothing.
    }
  },

  select: (sel) => set({ selection: sel, opError: null }),

  updateDraft: (sel, patch) => {
    const key = draftKey(sel);
    set((st) => {
      const existing = st.drafts[key] ?? draftFromDoc(findDoc(st, sel));
      if (existing === null) return {};
      return { drafts: { ...st.drafts, [key]: { ...existing, ...patch } } };
    });
  },

  revertDraft: (sel) => {
    const key = draftKey(sel);
    set((st) => {
      if (st.drafts[key] === undefined) return {};
      const drafts = { ...st.drafts };
      delete drafts[key];
      return { drafts };
    });
  },

  agentEdit: (fileName, patch) => {
    get().updateDraft({ kind: "agent", key: fileName }, patch);
    scheduleAgentSave(fileName);
  },

  retryAgentSave: (fileName) => {
    const q = queueFor(fileName);
    clearTimeout(q.timer);
    q.timer = undefined;
    void runAgentSave(fileName);
  },

  saveDoc: async (sel) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    const key = draftKey(sel);
    const draft = s.drafts[key];
    if (draft === undefined) return null;
    if (sel.kind === "agent") {
      // WO11 doctrine (§12.8, "one writer per file") — no live call site
      // passes an agent Selection to `saveDoc` anymore (AgentEditor routes
      // every edit through `agentEdit`/the autosave queue exclusively,
      // D4), but this branch used to call `agent_save` directly, which
      // would be a second, uncoordinated writer to the exact file the
      // queue owns the instant anything called it again. Routing through
      // the SAME `runAgentSave` queue instead — reading the same draft
      // this function already found — makes that impossible rather than
      // merely unlikely, per the enforcement principle §12.8 records
      // ("a runtime rejection ... not a comment"). Not gated by `busy`
      // (the queue has its own discipline), so the check below is
      // skipped for this branch.
      const err = await runAgentSave(sel.key);
      if (err === null) {
        set((st) => {
          const drafts = { ...st.drafts };
          delete drafts[key];
          return { drafts };
        });
      }
      return err;
    }
    set({ busy: true, opError: null });
    try {
      const patch = draft.raw ? { rawContent: draft.rawContent } : { fields: draft.fields, body: draft.body };
      await skillSave(s.root, sel.key, patch);
      // Simplest correct choice (§7.2): refresh from a full agentsScan.
      const scan = await agentsScan(s.root);
      set((st) => {
        const drafts = { ...st.drafts };
        delete drafts[key];
        return { agents: scan.agents, skills: scan.skills, skipped: scan.skipped, drafts };
      });
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  createAgent: async (name, opts) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    const root = s.root;
    set({ busy: true, opError: null });
    try {
      const doc = await agentCreate(root, name, opts?.fileName ?? null);
      // The reclaimed fileName may still be sitting in the orphan bucket
      // (external delete + in-app recreate under the same name): drop it
      // from orphan bookkeeping and, if it carried metadata, promote it
      // into `meta` so serializeMeta never has the two disagree.
      const reconciled = reconcileOrphan(doc.fileName);
      set((st) => ({
        agents: [...st.agents, doc].sort(byFileName),
        selection: { kind: "agent", key: doc.fileName },
        orphanKeys: st.orphanKeys.includes(doc.fileName)
          ? st.orphanKeys.filter((k) => k !== doc.fileName)
          : st.orphanKeys,
        meta: reconciled !== undefined ? { ...st.meta, [doc.fileName]: reconciled } : st.meta,
      }));
      if (reconciled !== undefined) scheduleMetaSave();
      if (opts?.withMemory !== false) {
        // A memory-folder failure must not fail the create: the agent has
        // already landed. Surface the message through opError only.
        try {
          await agentMemoryEnsure(root, doc.fileName);
        } catch (e) {
          set({ opError: String(e) });
        }
      }
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  ensureMemory: async (fileName) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    set({ busy: true, opError: null });
    try {
      await agentMemoryEnsure(s.root, fileName);
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  createSkill: async (name) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    set({ busy: true, opError: null });
    try {
      const doc = await skillCreate(s.root, name);
      set((st) => ({
        skills: [...st.skills, doc].sort(byDirName),
        selection: { kind: "skill", key: doc.dirName },
      }));
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  renameSelected: async (newName) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    if (s.selection === null) return "Nothing selected";
    const sel = s.selection;
    set({ busy: true, opError: null });
    try {
      if (sel.kind === "agent") {
        // A rename is a `mv`: whatever the draft holds must land on disk
        // under the OLD name before the file moves, or it is lost.
        await flushAgentSaveFor(sel.key);
        const nextName = await agentRename(s.root, sel.key, newName);
        // As in createAgent: the destination name may already be sitting
        // in the orphan bucket. Reconcile it so serializeMeta never has to
        // choose between live and orphan data for the same key.
        const reconciled = reconcileOrphan(nextName);
        set((st) => {
          const drafts = { ...st.drafts };
          const oldKey = draftKey(sel);
          const newSel: Selection = { kind: "agent", key: nextName };
          if (drafts[oldKey] !== undefined) {
            drafts[draftKey(newSel)] = drafts[oldKey];
            delete drafts[oldKey];
          }
          const meta = { ...st.meta };
          if (meta[sel.key] !== undefined) {
            meta[nextName] = meta[sel.key];
            delete meta[sel.key];
          } else if (reconciled !== undefined) {
            meta[nextName] = reconciled;
          }
          const agents = st.agents
            .map((a) => (a.fileName === sel.key ? { ...a, fileName: nextName } : a))
            .sort(byFileName);
          const orphanKeys = st.orphanKeys.includes(nextName)
            ? st.orphanKeys.filter((k) => k !== nextName)
            : st.orphanKeys;
          const avatars = { ...st.avatars };
          if (avatars[sel.key] !== undefined) {
            avatars[nextName] = avatars[sel.key];
            delete avatars[sel.key];
          }
          const agentSaveState = { ...st.agentSaveState };
          delete agentSaveState[sel.key];
          const agentSaveErrors = { ...st.agentSaveErrors };
          delete agentSaveErrors[sel.key];
          const staleAgents = { ...st.staleAgents };
          delete staleAgents[sel.key];
          return {
            agents,
            drafts,
            meta,
            selection: newSel,
            orphanKeys,
            avatars,
            agentSaveState,
            agentSaveErrors,
            staleAgents,
          };
        });
        scheduleMetaSave();
        notifyAgentRenamed(sel.key, nextName, newName);
      } else {
        const nextName = await skillRename(s.root, sel.key, newName);
        set((st) => {
          const drafts = { ...st.drafts };
          const oldKey = draftKey(sel);
          const newSel: Selection = { kind: "skill", key: nextName };
          if (drafts[oldKey] !== undefined) {
            drafts[draftKey(newSel)] = drafts[oldKey];
            delete drafts[oldKey];
          }
          const skills = st.skills
            .map((sk) => (sk.dirName === sel.key ? { ...sk, dirName: nextName } : sk))
            .sort(byDirName);
          return { skills, drafts, selection: newSel };
        });
      }
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  renameAgentByFile: async (fileName, newName) => {
    // Selection-independent rename used by the GRAPH store when a title-sync
    // or File-field rename targets an agent-backed node. Same bookkeeping as
    // renameSelected's agent branch; selection is only rewritten when it was
    // pointing at the renamed agent. Resolves to the new fileName; throws
    // with the Rust error string on failure.
    const s = get();
    if (s.busy) throw new Error("Busy");
    if (s.root === null) throw new Error("No project open");
    set({ busy: true, opError: null });
    try {
      const sel: Selection = { kind: "agent", key: fileName };
      await flushAgentSaveFor(fileName);
      const nextName = await agentRename(s.root, fileName, newName);
      const reconciled = reconcileOrphan(nextName);
      set((st) => {
        const drafts = { ...st.drafts };
        const oldKey = draftKey(sel);
        const newSel: Selection = { kind: "agent", key: nextName };
        if (drafts[oldKey] !== undefined) {
          drafts[draftKey(newSel)] = drafts[oldKey];
          delete drafts[oldKey];
        }
        const meta = { ...st.meta };
        if (meta[fileName] !== undefined) {
          meta[nextName] = meta[fileName];
          delete meta[fileName];
        } else if (reconciled !== undefined) {
          meta[nextName] = reconciled;
        }
        const agents = st.agents
          .map((a) => (a.fileName === fileName ? { ...a, fileName: nextName } : a))
          .sort(byFileName);
        const orphanKeys = st.orphanKeys.includes(nextName)
          ? st.orphanKeys.filter((k) => k !== nextName)
          : st.orphanKeys;
        const selection =
          st.selection !== null && st.selection.kind === "agent" && st.selection.key === fileName
            ? newSel
            : st.selection;
        const avatars = { ...st.avatars };
        if (avatars[fileName] !== undefined) {
          avatars[nextName] = avatars[fileName];
          delete avatars[fileName];
        }
        const agentSaveState = { ...st.agentSaveState };
        delete agentSaveState[fileName];
        const agentSaveErrors = { ...st.agentSaveErrors };
        delete agentSaveErrors[fileName];
        const staleAgents = { ...st.staleAgents };
        delete staleAgents[fileName];
        return {
          agents,
          drafts,
          meta,
          selection,
          orphanKeys,
          avatars,
          agentSaveState,
          agentSaveErrors,
          staleAgents,
        };
      });
      scheduleMetaSave();
      notifyAgentRenamed(fileName, nextName, newName);
      return nextName;
    } catch (e) {
      // Rethrow the original (a plain Rust error string over IPC) so callers
      // see the exact message; opError mirrors it for the panel.
      set({ opError: String(e) });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  convertToAgent: async (relPath, newName) => {
    const s = get();
    if (s.busy) throw new Error("Busy");
    if (s.root === null) throw new Error("No project open");
    set({ busy: true, opError: null });
    try {
      const doc = await agentConvert(s.root, relPath, newName);
      // WO10 item 12 — an agent gets its memory index when it becomes an
      // agent, however it got there. `createAgent` already did this; convert
      // did not, so a converted agent was the one kind that still needed the
      // (now removed) "Create memory folder" button. Idempotent server-side,
      // and best-effort: failing to seed a memory index must not undo a
      // conversion that already succeeded on disk.
      try {
        await agentMemoryEnsure(s.root, doc.fileName);
      } catch (e) {
        set({ opError: String(e) });
      }
      const reconciled = reconcileOrphan(doc.fileName);
      set((st) => {
        const agents = [...st.agents.filter((a) => a.fileName !== doc.fileName), doc].sort(byFileName);
        const meta = reconciled !== undefined ? { ...st.meta, [doc.fileName]: reconciled } : st.meta;
        const orphanKeys = st.orphanKeys.filter((k) => k !== doc.fileName);
        return { agents, meta, orphanKeys };
      });
      if (reconciled !== undefined) scheduleMetaSave();
      return doc;
    } catch (e) {
      // Rethrow the original (a plain Rust error string over IPC) so callers
      // see the exact message; opError mirrors it for the panel.
      set({ opError: String(e) });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  deleteSelected: async () => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    if (s.selection === null) return "Nothing selected";
    const sel = s.selection;
    set({ busy: true, opError: null });
    try {
      if (sel.kind === "agent") {
        // Deleting a file with an unsaved pending edit still in flight would
        // otherwise race the delete — settle it first (even though the
        // result is about to be discarded, this keeps `agent_save` from
        // ever writing to a file `agent_delete` has already removed).
        await flushAgentSaveFor(sel.key);
        agentSaveQueues.delete(sel.key);
        await agentDelete(s.root, sel.key);
        set((st) => {
          const idx = st.agents.findIndex((a) => a.fileName === sel.key);
          const agents = st.agents.filter((a) => a.fileName !== sel.key);
          const drafts = { ...st.drafts };
          delete drafts[draftKey(sel)];
          const meta = { ...st.meta };
          delete meta[sel.key];
          const avatars = { ...st.avatars };
          delete avatars[sel.key];
          const agentSaveState = { ...st.agentSaveState };
          delete agentSaveState[sel.key];
          const agentSaveErrors = { ...st.agentSaveErrors };
          delete agentSaveErrors[sel.key];
          const staleAgents = { ...st.staleAgents };
          delete staleAgents[sel.key];
          const neighbor = agents[idx] ?? agents[idx - 1];
          const selection: Selection | null = neighbor ? { kind: "agent", key: neighbor.fileName } : null;
          return { agents, drafts, meta, selection, avatars, agentSaveState, agentSaveErrors, staleAgents };
        });
        scheduleMetaSave();
        // WO11_CONTRACT.md §10.3 — after the delete has actually succeeded
        // AND after this store's own state has settled, never before and
        // never on the error path (the catch block below never reaches
        // here). The graph store registers against this to prune the
        // now-orphaned node (agentDeleteListeners, declared above).
        notifyAgentDeleted(sel.key);
      } else {
        await skillDelete(s.root, sel.key);
        set((st) => {
          const idx = st.skills.findIndex((sk) => sk.dirName === sel.key);
          const skills = st.skills.filter((sk) => sk.dirName !== sel.key);
          const drafts = { ...st.drafts };
          delete drafts[draftKey(sel)];
          const neighbor = skills[idx] ?? skills[idx - 1];
          const selection: Selection | null = neighbor ? { kind: "skill", key: neighbor.dirName } : null;
          return { skills, drafts, selection };
        });
      }
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  attachSkill: (fileName, skillName) => {
    const sel: Selection = { kind: "agent", key: fileName };
    const key = draftKey(sel);
    let changed = false;
    set((st) => {
      const existing = st.drafts[key] ?? draftFromDoc(findDoc(st, sel));
      if (existing === null) return {};
      if (existing.fields.skills.includes(skillName)) return { drafts: { ...st.drafts, [key]: existing } };
      changed = true;
      const skills = [...existing.fields.skills, skillName];
      return { drafts: { ...st.drafts, [key]: { ...existing, fields: { ...existing.fields, skills } } } };
    });
    if (changed) scheduleAgentSave(fileName);
  },

  detachSkill: (fileName, skillName) => {
    const sel: Selection = { kind: "agent", key: fileName };
    const key = draftKey(sel);
    let changed = false;
    set((st) => {
      const existing = st.drafts[key] ?? draftFromDoc(findDoc(st, sel));
      if (existing === null) return {};
      if (!existing.fields.skills.includes(skillName)) return { drafts: { ...st.drafts, [key]: existing } };
      changed = true;
      const skills = existing.fields.skills.filter((s) => s !== skillName);
      return { drafts: { ...st.drafts, [key]: { ...existing, fields: { ...existing.fields, skills } } } };
    });
    if (changed) scheduleAgentSave(fileName);
  },

  updateMeta: (fileName, patch) => {
    if (get().metaError !== null) return;
    set((st) => {
      const base = st.meta[fileName] ?? defaultMetaFor(fileName);
      const merged: AgentMeta = {
        nickname: patch.nickname !== undefined ? clampNickname(patch.nickname) : base.nickname,
        priority:
          patch.priority !== undefined
            ? clampInt(patch.priority, DEFAULT_PRIORITY, 1, 5)
            : base.priority,
        influence: patch.influence !== undefined ? clampInt(patch.influence, 50, 0, 100) : base.influence,
        avatarSeed: patch.avatarSeed !== undefined ? patch.avatarSeed : base.avatarSeed,
        defaultCwd: patch.defaultCwd !== undefined ? patch.defaultCwd : base.defaultCwd,
        defaultTokenCeiling:
          patch.defaultTokenCeiling !== undefined
            ? parseCeiling(patch.defaultTokenCeiling)
            : base.defaultTokenCeiling,
        provider: patch.provider !== undefined ? patch.provider : base.provider,
        // Same merge rule as `provider` (A-20): an explicit `null` in the
        // patch IS a value — "inherit from the session" — and must be able
        // to clear a previously recorded id, which is why this tests
        // `undefined` rather than nullishness.
        model: patch.model !== undefined ? patch.model : base.model,
      };
      return { meta: { ...st.meta, [fileName]: merged } };
    });
    scheduleMetaSave();
  },

  setBuiltinInclude: (id, include) => {
    if (get().metaError !== null) return;
    if (!BUILTIN_SKILL_IDS.includes(id)) return;
    set((st) => {
      if ((st.builtinInclude[id] === true) === include) return {};
      const next = { ...st.builtinInclude };
      // Absence IS false (§3.8) — store it the way it serializes, so the
      // map and the file can never disagree about what "off" looks like.
      if (include) next[id] = true;
      else delete next[id];
      return { builtinInclude: next };
    });
    scheduleMetaSave();
  },

  cleanupOrphans: async () => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    if (s.orphanKeys.length === 0) return null;
    set({ busy: true, opError: null });
    try {
      orphanRaw = {};
      clearTimeout(metaSaveTimer);
      const content = serializeMeta(get().meta, orphanRaw, get().builtinInclude);
      await agentsMetaWrite(s.root, content);
      set({ orphanKeys: [] });
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  loadAvatar: async (fileName) => {
    const s = get();
    if (s.root === null) return;
    if (fileName in s.avatars) return; // already fetched (string or null)
    const root = s.root;
    try {
      const dataUrl = await agentAvatarRead(root, fileName);
      set((st) => ({ avatars: { ...st.avatars, [fileName]: dataUrl } }));
    } catch {
      // A broken avatar must never stop the rail/editor from rendering
      // (contract §4.2) — cache "no avatar" so this doesn't retry forever.
      set((st) => ({ avatars: { ...st.avatars, [fileName]: null } }));
    }
  },

  setAvatarImage: async (fileName, sourcePath) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    set({ busy: true, opError: null });
    try {
      const ref = await agentAvatarSet(s.root, fileName, sourcePath);
      set((st) => ({ avatars: { ...st.avatars, [fileName]: ref.dataUrl } }));
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  clearAvatarImage: async (fileName) => {
    const s = get();
    if (s.busy) return "Busy";
    if (s.root === null) return "No project open";
    set({ busy: true, opError: null });
    try {
      await agentAvatarClear(s.root, fileName);
      set((st) => ({ avatars: { ...st.avatars, [fileName]: null } }));
      return null;
    } catch (e) {
      const msg = String(e);
      set({ opError: msg });
      return msg;
    } finally {
      set({ busy: false });
    }
  },

  bumpAgentReloadNonce: (fileName) => {
    set((st) => ({ reloadNonce: { ...st.reloadNonce, [fileName]: (st.reloadNonce[fileName] ?? 0) + 1 } }));
  },

  reloadAgentFromDisk: async (fileName) => {
    const s = get();
    if (s.root === null) return;
    try {
      const scan = await agentsScan(s.root);
      const fresh = scan.agents.find((a) => a.fileName === fileName);
      if (fresh === undefined) return; // deleted externally mid-flight — nothing to splice back in
      const sel: Selection = { kind: "agent", key: fileName };
      let wasDirty = false;
      set((st) => {
        // `isDirty(st, sel)` reads `st.agents`/`st.drafts` as they stand
        // RIGHT NOW, before the line below replaces the entry — this IS the
        // pre-reload baseline, taken atomically in the same update rather
        // than across a render boundary (see the interface doc comment for
        // why that sidesteps the ref/ordered-effect dance `AgentMarkdownTab`
        // needs). Reusing `isDirty` also means there is exactly one
        // dirty-comparison implementation for agent drafts, not two that
        // could quietly drift apart.
        wasDirty = isDirty(st, sel);
        const agents = st.agents.map((a) => (a.fileName === fileName ? fresh : a));
        if (wasDirty) {
          // Never touch the draft: `saveAgentRaw`'s queue stays the only
          // writer, and this must not become a second one by discarding
          // work it never wrote. Flag it instead of clobbering it.
          return { agents, staleAgents: { ...st.staleAgents, [fileName]: true } };
        }
        const drafts = { ...st.drafts };
        delete drafts[draftKey(sel)];
        return { agents, drafts };
      });
      // Bumping `reloadNonce` remounts CodeMirror (AgentEditor's `docKey`
      // includes it) — only do that when the buffer is actually about to
      // show different content. While dirty, the draft is untouched, so a
      // remount here would cost the user's cursor/scroll position for zero
      // visible change.
      if (!wasDirty) get().bumpAgentReloadNonce(fileName);
    } catch {
      // Best-effort — see the interface doc comment above.
    }
  },

  dismissStaleAgent: (fileName) => {
    set((st) => {
      if (st.staleAgents[fileName] !== true) return {};
      const staleAgents = { ...st.staleAgents };
      delete staleAgents[fileName];
      return { staleAgents };
    });
  },

  discardStaleAgentDraft: (fileName) => {
    set((st) => {
      const drafts = { ...st.drafts };
      delete drafts[draftKey({ kind: "agent", key: fileName })];
      const staleAgents = { ...st.staleAgents };
      delete staleAgents[fileName];
      return { drafts, staleAgents };
    });
    get().bumpAgentReloadNonce(fileName);
  },
}));
