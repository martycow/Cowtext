// Right pane of AgentsModal for an agent selection (contract §7.3). Identity
// header (avatar, rename, nickname, reveal), fields grid bound to the draft,
// priority/influence bound to the sidecar meta (autosaved, debounced by the
// store), skills-attach checklist, Duties body editor, explicit Save. When
// the doc is `raw` the fields grid is replaced by one whole-file editor.

import { useEffect, useRef, useState } from "react";
import { FolderOpen, Minus, Plus, X } from "lucide-react";
import {
  draftKey,
  isDirty,
  metaOrDefault,
  seedFor,
  usedBy,
  useAgentsStore,
  type Selection,
} from "../store/agents";
import type { AgentDoc, FmFields } from "./types";
import { revealPath } from "../fs/api";
import { CodeMirrorEditor } from "../inspector/CodeMirrorEditor";
import { AgentAvatar } from "./AgentAvatar";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import { agentContextTokens } from "../store/tokens";

const MODEL_PRESETS = ["sonnet", "opus", "haiku", "inherit"] as const;

const SAVE_BTN =
  "h-control-sm flex-none rounded bg-accent px-3 text-xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled";

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

function Stepper({
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

function ChipEditor({
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

function ModelSelect({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const isCustom = value !== null && value !== "" && !(MODEL_PRESETS as readonly string[]).includes(value);
  const selectValue = isCustom ? "custom" : (value ?? "sonnet");
  return (
    <div className="flex items-center gap-2">
      <select
        value={selectValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "custom" ? (value ?? "") : e.target.value)}
        className="h-control rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
      >
        {MODEL_PRESETS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
        <option value="custom">custom</option>
      </select>
      {isCustom && (
        <input
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="model id"
          className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
        />
      )}
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

export function AgentEditor({
  root,
  doc,
  disabled,
  onRequestDelete,
  onSave,
}: {
  root: string;
  doc: AgentDoc;
  disabled: boolean;
  onRequestDelete: () => void;
  /** Routes through AgentsModal's phase machine (busy lock) so a row switch
   *  mid-save can't raise a confirmDiscard sheet for this doc — see contract
   *  §7.3 and AgentsModal's `doSave`. */
  onSave: () => Promise<string | null>;
}) {
  const sel: Selection = { kind: "agent", key: doc.fileName };
  const rawDraft = useAgentsStore((s) => s.drafts[draftKey(sel)]);
  const meta = useAgentsStore((s) => s.meta);
  const dirty = useAgentsStore((s) => isDirty(s, sel));
  const updateDraft = useAgentsStore((s) => s.updateDraft);
  const updateMeta = useAgentsStore((s) => s.updateMeta);
  const renameSelected = useAgentsStore((s) => s.renameSelected);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const files = useProjectStore((s) => s.files);
  const contextTokens = agentContextTokens(doc, nodes, edges, files);

  const displayName = doc.fields.name !== null && doc.fields.name !== "" ? doc.fields.name : doc.fileName;
  const m = metaOrDefault(meta, doc.fileName);

  const [nameDraft, setNameDraft] = useState(displayName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const prevContent = useRef(doc.content);

  // Selection changed to a different file — resync locals and force the
  // editor to rebuild (§7.3 docKey idiom).
  useEffect(() => {
    setNameDraft(displayName);
    setRenameError(null);
    setRevealError(null);
    setSaveError(null);
    setGen((g) => g + 1);
  }, [doc.fileName, displayName]);

  useEffect(() => {
    if (doc.content !== prevContent.current) {
      prevContent.current = doc.content;
      setGen((g) => g + 1);
    }
  }, [doc.content]);

  // No draft exists until the first edit (store lazily creates one on
  // updateDraft/attachSkill/detachSkill) — fall back to the saved doc so a
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
    updateDraft(sel, { fields: { ...draft.fields, ...patch } });
  };

  const doSave = () => {
    setSaveError(null);
    void onSave().then((err) => {
      if (err !== null) setSaveError(err);
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Identity header */}
      <div className="flex items-start gap-3">
        <AgentAvatar seed={seedFor(meta, doc.fileName)} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
          <div className="flex items-center gap-2">
            <span className="flex-none font-mono text-2xs text-content-muted">nickname</span>
            <input
              value={m.nickname}
              onChange={(e) =>
                updateMeta(doc.fileName, { nickname: e.target.value.slice(0, 40) })
              }
              disabled={disabled}
              placeholder="optional"
              className="h-control-sm w-full max-w-[220px] rounded border border-border bg-surface-2 px-2 text-xs text-content placeholder:text-content-disabled focus:border-accent-border disabled:text-content-disabled"
            />
          </div>
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
          <span className="font-mono text-2xs text-content-muted">{doc.fileName}</span>
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

      {doc.raw ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {doc.parseError !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {doc.parseError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-content-muted">
              This file must be edited as raw text — the fields grid is unavailable.
            </span>
            <div className="flex-1" />
            {dirty && (
              <span className="h-1.5 w-1.5 flex-none rounded-pill bg-amber" title="Unsaved changes" />
            )}
            <button onClick={doSave} disabled={!dirty || disabled} className={SAVE_BTN}>
              Save
            </button>
          </div>
          {saveError !== null && <p className="font-mono text-xs text-danger-text">{saveError}</p>}
          <div className="h-[360px] min-h-0 rounded border border-border-subtle bg-surface-inset">
            <CodeMirrorEditor
              docKey={`${doc.fileName}:${gen}`}
              value={draft.rawContent}
              onChange={(v) => updateDraft(sel, { rawContent: v })}
              onSave={doSave}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="col-span-2">
              <FieldLabel>Description</FieldLabel>
              <input
                value={draft.fields.description ?? ""}
                onChange={(e) => patchFields({ description: e.target.value })}
                disabled={disabled}
                className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
              />
            </div>
            <div>
              <FieldLabel>Model</FieldLabel>
              <ModelSelect
                value={draft.fields.model}
                disabled={disabled}
                onChange={(v) => patchFields({ model: v })}
              />
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <Stepper
                value={m.priority}
                min={1}
                max={5}
                disabled={disabled}
                onChange={(v) => updateMeta(doc.fileName, { priority: v })}
              />
            </div>
            <div className="col-span-2">
              <FieldLabel>Influence</FieldLabel>
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
            </div>
            <div className="col-span-2">
              <FieldLabel>Tools</FieldLabel>
              <ChipEditor
                items={draft.fields.tools}
                disabled={disabled}
                placeholder="Read, Grep, Glob…"
                onChange={(items) => patchFields({ tools: items })}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Skills</FieldLabel>
            <p className="mb-1 text-xs leading-snug text-content-muted">
              A Cowtext convention — Claude Code ignores this key; attaching a skill here records
              intent only.
            </p>
            <SkillsChecklist fileName={doc.fileName} draftSkills={draft.fields.skills} disabled={disabled} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <FieldLabel>Duties</FieldLabel>
              <div className="flex-1" />
              {dirty && (
                <span className="h-1.5 w-1.5 flex-none rounded-pill bg-amber" title="Unsaved changes" />
              )}
              <button onClick={doSave} disabled={!dirty || disabled} className={SAVE_BTN}>
                Save
              </button>
            </div>
            {saveError !== null && (
              <p className="font-mono text-xs text-danger-text">{saveError}</p>
            )}
            <div className="h-[280px] min-h-0 rounded border border-border-subtle bg-surface-inset">
              <CodeMirrorEditor
                docKey={`${doc.fileName}:${gen}`}
                value={draft.body}
                onChange={(v) => updateDraft(sel, { body: v })}
                onSave={doSave}
              />
            </div>
          </div>
        </>
      )}

      <div className="border-t border-border-subtle pt-3">
        <button
          onClick={onRequestDelete}
          disabled={disabled}
          className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface disabled:text-content-disabled"
        >
          Delete agent
        </button>
      </div>
    </div>
  );
}
