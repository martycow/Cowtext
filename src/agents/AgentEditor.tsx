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
import type { AgentDoc, FmFields } from "./types";
import { agentMemoryStatus, type AgentMemoryStatus } from "./api";
import { revealPath } from "../fs/api";
import { CodeMirrorEditor } from "../inspector/CodeMirrorEditor";
import { AgentAvatar } from "./AgentAvatar";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import { agentContextTokens } from "../store/tokens";
import { companyFor, isAliasModel, MODEL_CATALOG, MODEL_NOTES } from "./modelCatalog";
import { ToolPicker } from "./ToolPicker";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/menuTypes";

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

/** Two-step model picker (contract R6) — company first, then that company's
 *  version list; "Other" swaps the version select for a free-text input.
 *  Company is INFERRED from the stored value every time this remounts (the
 *  caller keys it on the doc identity, same idiom as the CodeMirror
 *  `docKey`), so a value picked outside the catalog (hand-edited frontmatter)
 *  still lands on the right step instead of silently resetting.
 *
 *  WO11 D3: the bare aliases (`opus`/`sonnet`/`haiku`) no longer appear as
 *  pickable rows in the Anthropic list, but a file that already has one on
 *  disk must keep showing it — as a disabled, appended option — rather than
 *  going blank or silently swapping to a different model. */
export function ModelPicker({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [company, setCompany] = useState(() => companyFor(value));
  const companyDef = MODEL_CATALOG.find((c) => c.company === company) ?? MODEL_CATALOG[0];
  const isOther = company === "Other";

  const pickCompany = (next: string) => {
    setCompany(next);
    const def = MODEL_CATALOG.find((c) => c.company === next);
    if (def !== undefined && def.models.length > 0) onChange(def.models[0]);
  };

  const effectiveValue = value ?? companyDef.models[0];
  const note = MODEL_NOTES[effectiveValue];
  const legacyAlias = !isOther && value !== null && isAliasModel(value) && !companyDef.models.includes(value);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          value={company}
          disabled={disabled}
          onChange={(e) => pickCompany(e.target.value)}
          className="h-control rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
        >
          {MODEL_CATALOG.map((c) => (
            <option key={c.company} value={c.company}>
              {c.company}
            </option>
          ))}
        </select>
        {isOther ? (
          <input
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="model id"
            className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
          />
        ) : (
          <select
            value={effectiveValue}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
          >
            {/* the option's title mirrors the helper line under this select */}
            {companyDef.models.map((m) => (
              <option key={m} value={m} title={MODEL_NOTES[m]}>
                {m}
              </option>
            ))}
            {legacyAlias && value !== null && (
              <option value={value} disabled title={MODEL_NOTES[value]}>
                {value} (legacy alias)
              </option>
            )}
          </select>
        )}
      </div>
      {note !== undefined && (
        <p className="text-2xs leading-snug text-content-muted">{note}</p>
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
  const agentEdit = useAgentsStore((s) => s.agentEdit);
  const retryAgentSave = useAgentsStore((s) => s.retryAgentSave);
  const saveState = useAgentsStore((s) => s.agentSaveState[doc.fileName] ?? "idle");
  const saveErr = useAgentsStore((s) => s.agentSaveErrors[doc.fileName] ?? null);
  const reloadNonce = useAgentsStore((s) => s.reloadNonce[doc.fileName] ?? 0);
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

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Identity header */}
      <div className="flex items-start gap-3">
        <button
          ref={avatarBtnRef}
          type="button"
          onClick={openAvatarMenu}
          disabled={disabled}
          title="Change avatar"
          className="flex-none rounded-sm outline-none transition-opacity duration-fast hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <AgentAvatar seed={seedFor(meta, doc.fileName)} size={44} src={avatarSrc} />
        </button>
        {avatarMenuAnchor !== null && (
          <ContextMenu
            x={avatarMenuAnchor.x}
            y={avatarMenuAnchor.y}
            items={avatarMenuItems}
            onClose={() => setAvatarMenuAnchor(null)}
          />
        )}
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
      {avatarError !== null && (
        <p className="font-mono text-xs text-danger-text">{avatarError}</p>
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

      {/* WO11 D2 — memory control, unconditional (not gated on doc.raw): an
          agent whose frontmatter fails to parse still has a memory folder
          concept, and Marty's "does nothing" repro was on a healthy agent,
          not specifically a broken one. */}
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="col-span-2">
              <FieldLabel>Description</FieldLabel>
              <textarea
                value={draft.fields.description ?? ""}
                onChange={(e) => patchFields({ description: e.target.value })}
                disabled={disabled}
                rows={2}
                className="min-h-[40px] max-h-[30vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content focus:border-accent disabled:text-content-disabled"
              />
            </div>
            <div>
              <FieldLabel>Model</FieldLabel>
              <ModelPicker
                key={doc.fileName}
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
              {/* WO10 item 11 — a dropdown over agents/toolCatalog.ts, not
                  free text. Tool names are case-sensitive and a misspelled
                  one is dropped silently by Claude Code, so "type it and
                  hope" was the wrong control for this field. Free text
                  survives as the popup's bottom row, because MCP tool names
                  are per-installation and cannot be enumerated. */}
              <ToolPicker
                items={draft.fields.tools}
                disabled={disabled}
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
            <FieldLabel>Duties</FieldLabel>
            <div className="h-[280px] min-h-0 rounded border border-border-subtle bg-surface-inset">
              <CodeMirrorEditor
                docKey={docKey}
                value={draft.body}
                onChange={(v) => agentEdit(doc.fileName, { body: v })}
                onSave={() => retryAgentSave(doc.fileName)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
