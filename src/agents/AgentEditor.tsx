// Right pane of the agent rail / Inspector for an agent selection (contract
// §7.3, amended WO11_CONTRACT.md §5.7/§5.11). Identity header (avatar,
// rename, nickname, reveal), fields grid bound to the draft, priority/
// influence bound to the sidecar meta (autosaved, debounced by the store),
// skills-attach checklist, Duties body editor. There is NO Save button
// (WO11 D4): every field edit for an agent autosaves through
// `agentEdit`/`attachSkill`/`detachSkill`, debounced 500 ms per file. When
// the doc is `raw` the fields grid is replaced by one whole-file editor —
// the identity header, avatar control and Memory control stay available
// either way, since none of them depend on frontmatter having parsed.

import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ImagePlus, Minus, Plus, RefreshCw, RotateCw, Trash2, X } from "lucide-react";
import {
  draftKey,
  flushAgentSave,
  metaOrDefault,
  seedFor,
  usedBy,
  useAgentsStore,
  type Selection,
} from "../store/agents";
import type { AgentDoc, FmFields, ProviderId } from "./types";
import { agentMemoryStatus, type AgentMemoryStatus } from "./api";
import { revealPath } from "../fs/api";
import { CodeMirrorEditor } from "../inspector/CodeMirrorEditor";
import { AgentAvatar } from "./AgentAvatar";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import { agentContextTokens } from "../store/tokens";
import { providerForModel } from "./modelCatalog";
import { ModelPicker } from "./ModelPicker";
import { ToolsField } from "./ToolPicker";
import { ContextMenu } from "../ui/ContextMenu";
import { LocalOnlyBadge } from "../ui/LocalOnlyBadge";
import { DEFAULT_PROVIDER } from "../resources";
import type { MenuItem } from "../ui/menuTypes";

// ── A1/A3 — the "local only" badge, one shared component ────────────────
//
// `compiles` is a REQUIRED prop, not an optional flag on a lookup table a
// new field could forget to add itself to — omitting it is a TypeScript
// error at every call site. That is the enforcement A3 asks for ("a new
// field cannot be added without answering the question"): a config array
// can silently go unedited, a required prop cannot silently go unpassed.
// Marking one field and leaving a neighbour unmarked is worse than no badge
// at all (A3).
//
// WO15 §4.12: the badge itself now lives in `ui/LocalOnlyBadge.tsx` so
// non-agent surfaces (Position, Influence, the token-ceiling input, a
// non-Anthropic model) carry the same mark. What is agent-specific is the
// HINT — for these fields "local" means one precise file.

/** Every field in this file's Local-only section lands in exactly this
 *  place, and the badge says so rather than something vaguer. */
export const AGENT_LOCAL_HINT =
  "Stored in .cowtext/agents.json — never written to the agent's own file.";

export function FieldRow({
  label,
  compiles,
  hint,
  children,
}: {
  label: string;
  /** REQUIRED — see the module note above. `false` renders `LocalOnlyBadge`. */
  compiles: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <FieldLabel>{label}</FieldLabel>
        {!compiles && <LocalOnlyBadge hint={AGENT_LOCAL_HINT} />}
      </div>
      {children}
      {hint !== undefined && <p className="pt-1 text-2xs leading-snug text-content-muted">{hint}</p>}
    </div>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

export function Stepper({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const stepBtn =
    "grid h-control-sm w-control-sm flex-none place-items-center rounded border border-border bg-surface-2 text-content-muted transition-colors duration-fast hover:border-border-strong hover:text-content disabled:text-content-disabled";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        className={stepBtn}
      >
        <Minus size={11} strokeWidth={1.5} />
      </button>
      <span className="w-[16px] text-center font-mono text-sm tabular-nums text-content">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        className={stepBtn}
      >
        <Plus size={11} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function ChipEditor({
  items,
  disabled,
  placeholder,
  onChange,
}: {
  items: string[];
  disabled: boolean;
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    setDraft("");
    if (v === "" || items.includes(v)) return;
    onChange([...items, v]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-surface-2 p-1.5">
      {items.map((it) => (
        <span
          key={it}
          className="flex items-center gap-1 rounded-sm border border-border-strong bg-surface-3 px-1.5 py-0.5 font-mono text-2xs text-content"
        >
          {it}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x !== it))}
              className="text-content-muted transition-colors duration-fast hover:text-content"
            >
              <X size={9} strokeWidth={1.5} />
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
            onChange(items.slice(0, -1));
          }
        }}
        onBlur={add}
        disabled={disabled}
        placeholder={items.length === 0 ? placeholder : ""}
        className="h-[20px] min-w-[100px] flex-1 bg-transparent text-xs text-content outline-none placeholder:text-content-muted disabled:text-content-disabled"
      />
    </div>
  );
}

/** The provider a stored agent is configured for: the sidecar's explicit
 *  value first (the user picked it), then a guess from the model id (an
 *  agent Cowtext never touched), then Anthropic — `.claude/agents/*.md` is
 *  Claude Code's own format, so that is the honest default (§6 U3.1). */
export function providerOf(sidecar: ProviderId | undefined, model: string | null): ProviderId {
  return sidecar ?? providerForModel(model) ?? DEFAULT_PROVIDER;
}

// ── B — description as a dispatch contract ───────────────────────────────

/** Frozen join (contract §14.3): the two halves are joined with this exact
 *  phrase and split on its first occurrence, so parsing is total and the
 *  round-trip (split → edit → compose → reopen → split) never drifts. */
export const DESCRIPTION_JOIN = " Do not use it when ";

export function splitDescription(description: string | null): { whenToUse: string; whenNotToUse: string } {
  const raw = description ?? "";
  const idx = raw.indexOf(DESCRIPTION_JOIN);
  if (idx === -1) return { whenToUse: raw, whenNotToUse: "" };
  return { whenToUse: raw.slice(0, idx), whenNotToUse: raw.slice(idx + DESCRIPTION_JOIN.length) };
}

export function joinDescription(whenToUse: string, whenNotToUse: string): string {
  const a = whenToUse.trim();
  const b = whenNotToUse.trim();
  if (a === "") return b === "" ? "" : `${DESCRIPTION_JOIN.trim()} ${b}`;
  return b === "" ? a : `${a}${DESCRIPTION_JOIN}${b}`;
}

function significantWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface DescriptionValidation {
  /** Non-null ⇒ Create/save-worthy state is blocked; names the consequence,
   *  never just "required" (dispatch: "say the consequence in plain terms"). */
  blocking: string | null;
  /** Advice, never a gate (WO15 Block 3b). */
  tip: string | null;
  /** The other agent's display label, when overlap crosses the threshold. */
  overlapWarning: string | null;
}

/** Frozen copy (§6 U3.2) — the ONE soft tip. It fires on shape, so it must
 *  never block: "Reads the diff and reports risks" is a perfectly good
 *  description that simply does not open with the recommended phrase. */
export const WHEN_TO_USE_TIP =
  'Tip: start with "Use when…" so Claude picks this agent reliably';

/** The three blocking rules, and no others (WO15 Block 3b). The old fourth
 *  — "must contain trigger language AND ≥ 15 words" — blocked half the
 *  presets this contract ships, which is how a validator gets discovered to
 *  be wrong: a rule that rejects your own examples is a rule, not a fact.
 *
 *  `composed` is the full frontmatter-bound string (both halves joined);
 *  `whenToUse` alone drives the length/name checks — "when NOT to use it"
 *  legitimately contains none of that shape. */
export function validateDescription(
  name: string,
  whenToUse: string,
  composed: string,
  others: { label: string; description: string }[],
): DescriptionValidation {
  const trimmed = composed.trim();
  const when = whenToUse.trim();
  let blocking: string | null = null;
  if (trimmed === "") {
    blocking =
      "Claude Code skips an agent file with no description entirely — it never loads, and nothing but the debug log says why.";
  } else if (when.length < 20) {
    blocking =
      "Too short to dispatch on. Claude Code matches this text against the task at hand — a handful of characters matches everything or nothing.";
  } else if (when.toLowerCase() === name.trim().toLowerCase()) {
    blocking =
      "This just repeats the agent's name. Claude Code has the name already; the description is the only place that says when to reach for it.";
  }
  const tip = when !== "" && !/^use when\b/i.test(when) ? WHEN_TO_USE_TIP : null;
  const mine = significantWords(whenToUse);
  let overlapWarning: string | null = null;
  let best = 0;
  for (const o of others) {
    const score = jaccard(mine, significantWords(o.description));
    if (score > best && score >= 0.6) {
      best = score;
      overlapWarning = o.label;
    }
  }
  return { blocking, tip, overlapWarning };
}

export function DescriptionEditor({
  whenToUse,
  whenNotToUse,
  disabled,
  validation,
  onChangeWhenToUse,
  onChangeWhenNotToUse,
}: {
  whenToUse: string;
  whenNotToUse: string;
  disabled: boolean;
  validation: DescriptionValidation;
  onChangeWhenToUse: (v: string) => void;
  onChangeWhenNotToUse: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>When to use this agent</FieldLabel>
        <textarea
          value={whenToUse}
          disabled={disabled}
          onChange={(e) => onChangeWhenToUse(e.target.value)}
          rows={2}
          placeholder="Use when a pull request touches the payments module, to check for…"
          className="min-h-[44px] max-h-[30vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content placeholder:text-content-disabled focus:border-accent disabled:text-content-disabled"
        />
        {/* Block 3b — guidance BEFORE the first keystroke, not a red line
            after it: the field is the dispatch contract, and the user has
            no way to know that from an empty box. */}
        <p className="pt-1 text-2xs leading-snug text-content-muted">
          Claude Code reads this to decide when to dispatch the agent — one sentence about the
          situation, not the agent's job title.
        </p>
      </div>
      <div>
        <FieldLabel>When not to use it (optional)</FieldLabel>
        <textarea
          value={whenNotToUse}
          disabled={disabled}
          onChange={(e) => onChangeWhenNotToUse(e.target.value)}
          rows={1}
          placeholder="Do not use it when…"
          className="min-h-[32px] max-h-[20vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content placeholder:text-content-disabled focus:border-accent disabled:text-content-disabled"
        />
      </div>
      {validation.blocking !== null && (
        <p className="text-xs leading-snug text-danger-text">{validation.blocking}</p>
      )}
      {validation.blocking === null && validation.tip !== null && (
        <p className="text-2xs leading-snug text-content-secondary">{validation.tip}</p>
      )}
      {validation.blocking === null && validation.overlapWarning !== null && (
        <p className="text-2xs leading-snug text-amber-text">
          Overlaps heavily with "{validation.overlapWarning}" — Claude Code may struggle to pick
          between them.
        </p>
      )}
    </div>
  );
}

// ── B4 — system prompt (DUTIES → System prompt) ─────────────────────────

const THIRD_PERSON_PATTERNS = [/\bthis agent\b/i, /\bthe agent\b/i, /\bagent's\b/i];

export function looksThirdPerson(text: string): boolean {
  const sample = text.trim();
  if (sample === "") return false;
  const hasMarker = THIRD_PERSON_PATTERNS.some((p) => p.test(sample));
  const hasYou = /\byou\b/i.test(sample);
  return hasMarker && !hasYou;
}

/** A mechanical, best-effort rewrite — not NLP. Offered, never applied
 *  (B4: "never auto-apply"); the user reviews the result in the preview
 *  and clicks Apply themselves, or dismisses it. */
export function rewriteToSecondPerson(text: string): string {
  return text
    .replace(/\bThis agent\b/g, "You")
    .replace(/\bThe agent\b/g, "You")
    .replace(/\bthis agent\b/g, "you")
    .replace(/\bthe agent\b/g, "you")
    .replace(/\bAgent's\b/g, "Your")
    .replace(/\bagent's\b/g, "your")
    .replace(/\bIt is\b/g, "You are")
    .replace(/\bit is\b/g, "you are")
    .replace(/\bIts\b/g, "Your")
    .replace(/\bits\b/g, "your");
}

export function SystemPromptEditor({
  value,
  docKey,
  disabled,
  onChange,
  onSave,
}: {
  value: string;
  docKey: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onSave?: () => void;
}) {
  const [rewrite, setRewrite] = useState<string | null>(null);
  const thirdPerson = looksThirdPerson(value);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <FieldLabel>System prompt</FieldLabel>
        <div className="flex-1" />
        {thirdPerson && rewrite === null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setRewrite(rewriteToSecondPerson(value))}
            className="h-control-sm flex-none rounded border border-border bg-surface-2 px-2 text-2xs text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled"
          >
            Offer a second-person rewrite
          </button>
        )}
      </div>
      <p className="text-2xs leading-snug text-content-muted">
        This is what the agent reads as instructions to itself — write "you", not "this agent".
      </p>
      {thirdPerson && rewrite === null && (
        <p className="text-2xs leading-snug text-amber-text">
          Reads like a description OF the agent, not instructions TO it.
        </p>
      )}
      {rewrite !== null && (
        <div className="rounded border border-accent-border bg-accent-surface p-2">
          <p className="mb-1 text-2xs text-content-secondary">Suggested rewrite — not applied yet:</p>
          <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap font-mono text-2xs text-content">
            {rewrite}
          </pre>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(rewrite);
                setRewrite(null);
              }}
              className="h-control-sm flex-none rounded bg-accent px-2 text-2xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setRewrite(null)}
              className="h-control-sm flex-none rounded border border-border bg-surface-2 px-2 text-2xs text-content transition-colors duration-fast hover:border-border-strong"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="h-[240px] min-h-0 rounded border border-border-subtle bg-surface-inset">
        <CodeMirrorEditor docKey={docKey} value={value} onChange={onChange} onSave={onSave ?? (() => {})} />
      </div>
    </div>
  );
}

// ── D — runtime limits (maxTurns + permissionMode) ───────────────────────
//
// Deliberately positioned beside the tools/Elevated section by every call
// site in this file, not at the bottom (contract: "the only bound on an
// agent that loops").

const PERMISSION_MODES: { value: string; label: string; consequence: string }[] = [
  { value: "default", label: "Default", consequence: "Asks before edits and commands, as normal." },
  {
    value: "acceptEdits",
    label: "Accept edits",
    consequence: "File edits apply without asking; other actions still ask.",
  },
  {
    value: "auto",
    label: "Auto",
    consequence: "Claude decides permissions itself — a parent session already in Auto ignores this setting entirely.",
  },
  { value: "dontAsk", label: "Don't ask", consequence: "Never prompts for permission on anything this agent does." },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    consequence: "Skips every permission check. Once a parent session is here, a child can't dial it back down.",
  },
  { value: "plan", label: "Plan only", consequence: "Plans the work but never executes it." },
];

export function RuntimeLimits({
  maxTurns,
  permissionMode,
  disabled,
  onChangeMaxTurns,
  onChangePermissionMode,
}: {
  /** `FmFields.maxTurns` — a digit STRING (contract §14.4: "rendered
   *  unquoted; sent/read as a plain digit string"), not a number. The
   *  numeric `<input>` below is the one place this file converts between
   *  the two; every other consumer moves the string as-is. */
  maxTurns: string | null;
  permissionMode: string | null;
  disabled: boolean;
  onChangeMaxTurns: (v: string | null) => void;
  onChangePermissionMode: (v: string | null) => void;
}) {
  const active = PERMISSION_MODES.find((m) => m.value === (permissionMode ?? "default")) ?? PERMISSION_MODES[0];
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <FieldLabel>Max turns</FieldLabel>
        <input
          type="number"
          min={1}
          step={1}
          value={maxTurns ?? ""}
          disabled={disabled}
          placeholder="unlimited"
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChangeMaxTurns(null);
              return;
            }
            const n = Math.max(1, Math.round(Number(raw)));
            onChangeMaxTurns(Number.isFinite(n) ? String(n) : null);
          }}
          className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
        />
        <p className="pt-1 text-2xs leading-snug text-content-muted">
          The only bound on an agent that loops. Empty = unlimited.
        </p>
      </div>
      <div>
        <FieldLabel>Permission mode</FieldLabel>
        <select
          value={permissionMode ?? "default"}
          disabled={disabled}
          onChange={(e) => onChangePermissionMode(e.target.value === "default" ? null : e.target.value)}
          className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="pt-1 text-2xs leading-snug text-content-muted">{active.consequence}</p>
      </div>
    </div>
  );
}

function SkillsChecklist({
  fileName,
  draftSkills,
  disabled,
}: {
  fileName: string;
  draftSkills: string[];
  disabled: boolean;
}) {
  const skills = useAgentsStore((s) => s.skills);
  const agents = useAgentsStore((s) => s.agents);
  const attachSkill = useAgentsStore((s) => s.attachSkill);
  const detachSkill = useAgentsStore((s) => s.detachSkill);

  if (skills.length === 0) {
    return <p className="text-xs text-content-muted">No skills in this project yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-0.5 rounded border border-border-subtle bg-surface-inset p-1.5">
      {skills.map((sk) => {
        const name = sk.fields.name !== null && sk.fields.name !== "" ? sk.fields.name : sk.dirName;
        const checked = draftSkills.includes(name);
        const count = usedBy(agents, name).length;
        return (
          <li key={sk.dirName} className="flex h-[22px] items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e) =>
                e.target.checked ? attachSkill(fileName, name) : detachSkill(fileName, name)
              }
              className="h-3 w-3 accent-[var(--accent)]"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-content">{name}</span>
            <span className="flex-none font-mono text-2xs text-content-muted">
              used by {count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** WO11 D2 fix: which of the four unhealthy shapes a memory index is in,
 *  read straight off the `agent_memory_status` probe — never inferred from
 *  the project scan (`useProjectStore.files` cannot see `.claude/`). */
function memoryReason(status: AgentMemoryStatus): string {
  if (!status.dirExists) return "no memory folder";
  if (!status.indexExists) return "no MEMORY.md";
  if (status.indexBytes === 0) return "index is empty";
  return "index is not valid UTF-8";
}

export function AgentEditor({
  root,
  doc,
  disabled,
}: {
  root: string;
  doc: AgentDoc;
  disabled: boolean;
}) {
  const sel: Selection = { kind: "agent", key: doc.fileName };
  const rawDraft = useAgentsStore((s) => s.drafts[draftKey(sel)]);
  const meta = useAgentsStore((s) => s.meta);
  const allAgents = useAgentsStore((s) => s.agents);
  const agentEdit = useAgentsStore((s) => s.agentEdit);
  const retryAgentSave = useAgentsStore((s) => s.retryAgentSave);
  const saveState = useAgentsStore((s) => s.agentSaveState[doc.fileName] ?? "idle");
  const saveErr = useAgentsStore((s) => s.agentSaveErrors[doc.fileName] ?? null);
  const reloadNonce = useAgentsStore((s) => s.reloadNonce[doc.fileName] ?? 0);
  // HIGH fix (tester-found, post-WO13) — see store/agents.ts's
  // `reloadAgentFromDisk` doc comment: while this is true, `reloadNonce`
  // deliberately did NOT bump and the draft was deliberately NOT touched.
  // Same banner/copy/dismiss idiom as Inspector.tsx's Markdown tabs.
  const stale = useAgentsStore((s) => s.staleAgents[doc.fileName] ?? false);
  const dismissStaleAgent = useAgentsStore((s) => s.dismissStaleAgent);
  const discardStaleAgentDraft = useAgentsStore((s) => s.discardStaleAgentDraft);
  const updateMeta = useAgentsStore((s) => s.updateMeta);
  const renameSelected = useAgentsStore((s) => s.renameSelected);
  const ensureMemory = useAgentsStore((s) => s.ensureMemory);
  const avatars = useAgentsStore((s) => s.avatars);
  const loadAvatar = useAgentsStore((s) => s.loadAvatar);
  const setAvatarImage = useAgentsStore((s) => s.setAvatarImage);
  const clearAvatarImage = useAgentsStore((s) => s.clearAvatarImage);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const files = useProjectStore((s) => s.files);
  const contextTokens = agentContextTokens(doc, nodes, edges, files);

  const displayName = doc.fields.name !== null && doc.fields.name !== "" ? doc.fields.name : doc.fileName;
  const m = metaOrDefault(meta, doc.fileName);
  const memoryStem = doc.fileName.replace(/\.md$/i, "");
  const memoryPath = `.claude/agent-memory/${memoryStem}/`;
  const avatarSrc = avatars[doc.fileName] ?? null;

  const [nameDraft, setNameDraft] = useState(displayName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarMenuAnchor, setAvatarMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [memStatus, setMemStatus] = useState<AgentMemoryStatus | null>(null);
  const [memoryActionError, setMemoryActionError] = useState<string | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);

  // Selection changed to a different file — resync locals.
  useEffect(() => {
    setNameDraft(displayName);
    setRenameError(null);
    setRevealError(null);
    setAvatarError(null);
  }, [doc.fileName, displayName]);

  // WO11 D4 (§5.9) — "agent selection change" is one of the flush points:
  // whatever autosave is pending for the file we're LEAVING must be kicked
  // off rather than left to the timer alone. Fires on fileName change and
  // on unmount (covers the Inspector switching away entirely).
  useEffect(() => {
    return () => {
      flushAgentSave();
    };
  }, [doc.fileName]);

  // WO11 D2 (§5.5) — source of truth is the read-only probe, re-run whenever
  // the selected file changes and after every Fix/action, NEVER inferred
  // from the project scan.
  const refreshMemoryStatus = useCallback(() => {
    void agentMemoryStatus(root, doc.fileName)
      .then((status) => setMemStatus(status))
      .catch((e: unknown) => setMemoryActionError(String(e)));
  }, [root, doc.fileName]);

  useEffect(() => {
    setMemStatus(null);
    setMemoryActionError(null);
    refreshMemoryStatus();
  }, [refreshMemoryStatus]);

  // WO11 G6 — lazy fetch, cached in the store; a no-op once cached.
  useEffect(() => {
    void loadAvatar(doc.fileName);
  }, [doc.fileName, loadAvatar]);

  // No draft exists until the first edit (store lazily creates one on
  // agentEdit/attachSkill/detachSkill) — fall back to the saved doc so a
  // freshly-selected, untouched file still renders its real content.
  const draft = rawDraft ?? { fields: doc.fields, body: doc.body, rawContent: doc.content, raw: doc.raw };

  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed === "" || trimmed === displayName) {
      setNameDraft(displayName);
      return;
    }
    setRenameError(null);
    void renameSelected(trimmed).then((err) => {
      if (err !== null) setRenameError(err);
    });
  };

  const patchFields = (patch: Partial<FmFields>) => {
    agentEdit(doc.fileName, { fields: { ...draft.fields, ...patch } });
  };

  const doFixMemory = () => {
    setMemoryActionError(null);
    void ensureMemory(doc.fileName).then((err) => {
      if (err !== null) setMemoryActionError(err);
      else refreshMemoryStatus();
    });
  };

  const doRevealMemory = () => {
    if (memStatus === null) return;
    setMemoryActionError(null);
    void revealPath(root, memStatus.indexRelPath).catch((e: unknown) => setMemoryActionError(String(e)));
  };

  const openAvatarMenu = () => {
    if (disabled) return;
    const rect = avatarBtnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setAvatarMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
  };

  const doUploadAvatar = () => {
    void open({
      multiple: false,
      title: "Choose an avatar image",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    }).then((picked) => {
      if (typeof picked !== "string") return;
      setAvatarError(null);
      void setAvatarImage(doc.fileName, picked).then((err) => {
        if (err !== null) setAvatarError(err);
      });
    });
  };

  const doResetAvatarSeed = () => {
    updateMeta(doc.fileName, { avatarSeed: Math.random().toString(36).slice(2) });
  };

  const doRemoveAvatarImage = () => {
    setAvatarError(null);
    void clearAvatarImage(doc.fileName).then((err) => {
      if (err !== null) setAvatarError(err);
    });
  };

  const avatarMenuItems: MenuItem[] = [
    { kind: "item", id: "upload", label: "Upload image…", icon: ImagePlus, onSelect: doUploadAvatar },
    { kind: "item", id: "reset-seed", label: "Reset seed", icon: RefreshCw, onSelect: doResetAvatarSeed },
    ...(avatarSrc !== null
      ? [
          {
            kind: "item" as const,
            id: "remove",
            label: "Remove image",
            icon: Trash2,
            danger: true,
            onSelect: doRemoveAvatarImage,
          },
        ]
      : []),
  ];

  const docKey = `${doc.fileName}:${reloadNonce}`;
  const { whenToUse, whenNotToUse } = splitDescription(draft.fields.description);
  const others = allAgents
    .filter((a) => a.fileName !== doc.fileName)
    .map((a) => ({
      label: a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName,
      description: a.fields.description ?? "",
    }));
  const descriptionValidation = validateDescription(
    draft.fields.name ?? doc.fileName,
    whenToUse,
    joinDescription(whenToUse, whenNotToUse),
    others,
  );

  // Block 3a — provider is the sidecar's, or a guess from the model id for
  // an agent Cowtext never wrote. Where the MODEL lives follows from the
  // provider (A-20): Anthropic keeps it in the file's own `model:` key
  // (D-13), everyone else in the sidecar, because their agent formats have
  // no field for it. Two homes, never both — so the picker reads from
  // whichever one the current provider owns and the other stays null.
  const provider = providerOf(m.provider, draft.fields.model);
  const pickedModel = provider === "anthropic" ? draft.fields.model : m.model;

  // E2 order: identity → dispatch → system prompt → runtime → local-only
  // (last, quieter). Avatar/nickname/priority/influence are ALL local-only
  // (contract §14.3) — moved out of the identity header into the Local
  // only section at the bottom, consistent with NewAgentDialog.

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Identity */}
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNameDraft(displayName);
                setRenameError(null);
                e.currentTarget.blur();
              }
            }}
            disabled={disabled}
            className="h-control w-full max-w-[320px] rounded border border-border bg-surface-2 px-2 text-base font-semibold text-content focus:border-accent disabled:text-content-disabled"
          />
          {renameError !== null && <p className="text-xs text-danger-text">{renameError}</p>}
          <span className="font-mono text-2xs text-content-muted">name: {memoryStem}</span>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => {
              setRevealError(null);
              void revealPath(root, `.claude/agents/${doc.fileName}`).catch((e: unknown) =>
                setRevealError(String(e)),
              );
            }}
            className="flex h-control-sm items-center gap-1.5 rounded border border-border bg-surface-2 px-2 text-xs text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            <FolderOpen size={12} strokeWidth={1.5} />
            Reveal file
          </button>
          <span
            title="estimate, chars/4 · window ~200k"
            className="font-mono text-2xs text-content-muted"
          >
            ≈{contextTokens.toLocaleString()} tok context
          </span>
        </div>
      </div>
      {revealError !== null && (
        <p className="font-mono text-xs text-danger-text">{revealError}</p>
      )}

      {/* WO11 D4 — the failure surface for the per-keystroke autosave. A
          failed save keeps the draft (nothing is lost); Retry re-attempts
          the exact current draft, bypassing the debounce. Rendered here,
          above the raw/structured split, so it is visible in BOTH branches —
          fixing D2's second, smaller defect (the old error only rendered
          deep inside the structured branch). */}
      {saveState === "error" && (
        <div className="flex items-center gap-2 rounded border border-amber-border bg-amber-surface px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-amber-text">
            {saveErr ?? "Autosave failed"}
          </span>
          <button
            type="button"
            onClick={() => retryAgentSave(doc.fileName)}
            disabled={disabled}
            className="flex h-control-sm flex-none items-center gap-1.5 rounded border border-amber-border bg-surface-2 px-2 text-2xs text-amber-text transition-colors duration-fast hover:bg-amber-surface disabled:text-content-disabled"
          >
            <RotateCw size={11} strokeWidth={1.5} />
            Retry
          </button>
        </div>
      )}

      {/* HIGH fix (tester-found, post-WO13) — same copy, same affordance,
          same dismiss behaviour as Inspector.tsx's Markdown-tab banners
          (FileMarkdownTab / AgentMarkdownTab). The draft underneath is
          untouched while this is showing (store/agents.ts never cleared
          it), so "Reload from disk" is the ONLY thing that discards it. */}
      {stale && (
        <div className="flex items-center gap-2 rounded border border-amber-border bg-amber-surface px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-amber-text">
            Assemble changed this file on disk. Your unsaved edits are still here.
          </span>
          <button
            type="button"
            onClick={() => discardStaleAgentDraft(doc.fileName)}
            disabled={disabled}
            className="flex h-control-sm flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-2 text-2xs text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled"
          >
            Reload from disk
          </button>
          <button
            type="button"
            onClick={() => dismissStaleAgent(doc.fileName)}
            title="Dismiss"
            className="grid h-4 w-4 flex-none place-items-center text-amber-text transition-opacity duration-fast hover:opacity-70"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* WO11 D2 — memory control, unconditional (not gated on doc.raw): an
          agent whose frontmatter fails to parse still has a memory folder
          concept, and Marty's "does nothing" repro was on a healthy agent,
          not specifically a broken one. Not part of the local-only/compiles
          split (§14.3 names exactly nickname/priority/avatarPath/influence)
          — this creates a real project file, it just isn't the agent's own
          frontmatter, so it stays near identity rather than joining either
          badge group. */}
      <div>
        <FieldLabel>Memory</FieldLabel>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-secondary">
            {memStatus?.dirRelPath ?? memoryPath}
          </span>
          {memStatus !== null &&
            (memStatus.healthy ? (
              <button
                type="button"
                onClick={doRevealMemory}
                disabled={disabled}
                className="flex h-control-sm flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-2 text-xs text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled"
              >
                <FolderOpen size={12} strokeWidth={1.5} />
                Reveal in Explorer
              </button>
            ) : (
              <button
                type="button"
                onClick={doFixMemory}
                disabled={disabled}
                title={memoryReason(memStatus)}
                className="flex h-control-sm flex-none items-center gap-1.5 rounded border border-amber-border bg-amber-surface px-2 text-xs text-amber-text transition-colors duration-fast hover:border-amber disabled:text-content-disabled"
              >
                Fix
              </button>
            ))}
        </div>
        {memStatus !== null && !memStatus.healthy && (
          <p className="mt-1 text-2xs text-content-muted">{memoryReason(memStatus)}</p>
        )}
        {memoryActionError !== null && (
          <p className="mt-1 font-mono text-xs text-danger-text">{memoryActionError}</p>
        )}
      </div>

      {doc.raw ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {doc.parseError !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {doc.parseError}
            </div>
          )}
          <p className="text-xs text-content-muted">
            This file must be edited as raw text — the fields grid is unavailable.
          </p>
          <div className="h-[360px] min-h-0 rounded border border-border-subtle bg-surface-inset">
            <CodeMirrorEditor
              docKey={docKey}
              value={draft.rawContent}
              onChange={(v) => agentEdit(doc.fileName, { rawContent: v })}
              onSave={() => retryAgentSave(doc.fileName)}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Dispatch — Block B */}
          <DescriptionEditor
            whenToUse={whenToUse}
            whenNotToUse={whenNotToUse}
            disabled={disabled}
            validation={descriptionValidation}
            onChangeWhenToUse={(v) => patchFields({ description: joinDescription(v, whenNotToUse) })}
            onChangeWhenNotToUse={(v) => patchFields({ description: joinDescription(whenToUse, v) })}
          />

          {/* System prompt — Block B4 */}
          <SystemPromptEditor
            key={doc.fileName}
            value={draft.body}
            docKey={docKey}
            disabled={disabled}
            onChange={(v) => agentEdit(doc.fileName, { body: v })}
            onSave={() => retryAgentSave(doc.fileName)}
          />

          {/* Runtime — Block C/D */}
          <div>
            <FieldLabel>Model</FieldLabel>
            <ModelPicker
              key={doc.fileName}
              provider={provider}
              model={pickedModel}
              disabled={disabled}
              onChange={(v) => {
                // Provider always persists (sidecar). `model:` reaches the
                // agent file for Anthropic only — for anyone else it is
                // dropped from frontmatter, so a stale Claude model can
                // never survive a switch to OpenAI (D-13) — and the pick is
                // written to the sidecar instead, in the same call, so it
                // is still there when this panel is reopened (A-20).
                updateMeta(doc.fileName, {
                  provider: v.provider,
                  model: v.provider === "anthropic" ? null : v.model,
                });
                patchFields({ model: v.provider === "anthropic" ? v.model : null });
              }}
            />
          </div>
          <div>
            <FieldLabel>Tools</FieldLabel>
            <ToolsField
              key={doc.fileName}
              tools={draft.fields.tools}
              disallowedTools={draft.fields.disallowedTools}
              disabled={disabled}
              onChangeTools={(items) => patchFields({ tools: items })}
              onChangeDisallowed={(items) => patchFields({ disallowedTools: items })}
            />
          </div>
          <RuntimeLimits
            maxTurns={draft.fields.maxTurns}
            permissionMode={draft.fields.permissionMode}
            disabled={disabled}
            onChangeMaxTurns={(v) => patchFields({ maxTurns: v })}
            onChangePermissionMode={(v) => patchFields({ permissionMode: v })}
          />

          <div>
            <FieldLabel>Skills</FieldLabel>
            <p className="mb-1 text-xs leading-snug text-content-muted">
              A Cowtext convention — Claude Code ignores this key; attaching a skill here records
              intent only.
            </p>
            <SkillsChecklist fileName={doc.fileName} draftSkills={draft.fields.skills} disabled={disabled} />
          </div>
        </>
      )}

      {/* Local only — last, quieter (contract §14.3), and rendered
          UNCONDITIONALLY (outside the raw/structured split above): none of
          avatar/nickname/priority/influence depend on frontmatter having
          parsed, same reasoning as the Memory control. Every field here is
          stored in .cowtext/agents.json / .cowtext/avatars/, never in the
          agent's own frontmatter or body. */}
      <div className="flex flex-col gap-3 rounded border border-border-subtle bg-surface-inset p-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">Local only</span>
          <LocalOnlyBadge hint={AGENT_LOCAL_HINT} />
        </div>
        <div className="flex items-start gap-3">
          <button
            ref={avatarBtnRef}
            type="button"
            onClick={openAvatarMenu}
            disabled={disabled}
            title="Change avatar"
            className="flex-none rounded-sm outline-none transition-opacity duration-fast hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AgentAvatar seed={seedFor(meta, doc.fileName)} size={36} src={avatarSrc} />
          </button>
          {avatarMenuAnchor !== null && (
            <ContextMenu
              x={avatarMenuAnchor.x}
              y={avatarMenuAnchor.y}
              items={avatarMenuItems}
              onClose={() => setAvatarMenuAnchor(null)}
            />
          )}
          <FieldRow label="Nickname" compiles={false} hint="Shown on the fleet rail only.">
            <input
              value={m.nickname}
              onChange={(e) => updateMeta(doc.fileName, { nickname: e.target.value.slice(0, 40) })}
              disabled={disabled}
              placeholder="optional"
              className="h-control-sm w-full max-w-[220px] rounded border border-border bg-surface-2 px-2 text-xs text-content placeholder:text-content-disabled focus:border-accent-border disabled:text-content-disabled"
            />
          </FieldRow>
        </div>
        {avatarError !== null && <p className="font-mono text-xs text-danger-text">{avatarError}</p>}
        <FieldRow
          label="Priority (1 = highest)"
          compiles={false}
          hint="Your own ranking. Cowtext shows it on the fleet rail and the agent's canvas plate; it does not affect dispatch order or compiled context."
        >
          <Stepper
            value={m.priority}
            min={1}
            max={5}
            disabled={disabled}
            onChange={(v) => updateMeta(doc.fileName, { priority: v })}
          />
        </FieldRow>
        <FieldRow label="Influence" compiles={false}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={m.influence}
              disabled={disabled}
              aria-label="Influence"
              onChange={(e) => updateMeta(doc.fileName, { influence: Number(e.target.value) })}
              className="h-[16px] w-[180px] cursor-pointer appearance-none bg-transparent disabled:cursor-default disabled:opacity-40 [&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-surface-inset [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-[12px] [&::-webkit-slider-thumb]:w-[12px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-accent"
            />
            <span className="w-[32px] text-right font-mono text-xs text-content-secondary">
              {m.influence}%
            </span>
          </div>
        </FieldRow>
      </div>
    </div>
  );
}
