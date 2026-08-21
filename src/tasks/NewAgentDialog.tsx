// New Agent modal (WO13_CONTRACT.md §14.3, Blocks A-A..A-F) — built on U1's
// shared `TwoPaneModal`/`PreviewPane` shells (§14.1); this file is the
// FROZEN consumer, never a second preview component (agent spec lines 888,
// 941). Creates the file via `createAgent`, patches the draft with the
// composed fields/system-prompt and saves it, uploads an avatar if one was
// picked, then writes the local-only fields (nickname/priority/influence/
// avatarSeed) to the sidecar via `updateMeta`. On any failure after the file
// itself lands, the partially-created agent is rolled back with
// `agent_delete` (§12.2) rather than left half-configured.
//
// Tree is RED until integration: `../ui/TwoPaneModal` and `../ui/PreviewPane`
// are U1's first deliverable and may not exist yet in this tree — this file
// is written against their frozen §14.1 prop shapes regardless.

import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useAgentsStore, type Selection } from "../store/agents";
import {
  DescriptionEditor,
  FieldRow,
  FieldLabel,
  LocalOnlyBadge,
  ModelPicker,
  RuntimeLimits,
  Stepper,
  SystemPromptEditor,
  joinDescription,
  validateDescription,
} from "../agents/AgentEditor";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ToolsField } from "../agents/ToolPicker";
import { normalizeFileName, slugForFile } from "../wizard/paths";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { TwoPaneModal } from "../ui/TwoPaneModal";
import { PreviewPane, type PreviewTab } from "../ui/PreviewPane";
import type { PreviewFile } from "../compile/types";
import { pushToastWithAction } from "../store/toasts";
import type { FmFields } from "../agents/types";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content";

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

const PRIMARY_BTN =
  "flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled";

/** 34×19 pill toggle — amber, mirrors NodeWizard's AmberToggle. "Create
 *  memory folder" is a promise about agent behaviour, not a user action on
 *  the UI itself, so amber is correct per the accent law (contract §7.3). */
function AmberToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[19px] w-[34px] flex-none rounded-pill border transition-colors duration-fast ${
        checked ? "border-amber-border bg-amber-surface" : "border-border-strong bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[13px] w-[13px] rounded-pill transition-all duration-fast ${
          checked ? "left-[16px] bg-amber" : "left-[2px] bg-content-muted"
        }`}
      />
    </button>
  );
}

/** Approximate client-side render of what `frontmatter.rs` would emit — a
 *  preview, not the compiler. Matches its two rendering rules read from the
 *  source (§14.4 gate context): a new key always emits in bracket-list form
 *  (`ListForm::Bracket`, "the newly appended default"), and a scalar is
 *  quoted only when it needs wrapping. Field order is FmFields declaration
 *  order plus the five §14.4 keys in their frozen append order. */
function renderScalar(v: string): string {
  const needsQuote = /^[[{#"']/.test(v) || /: /.test(v);
  if (!needsQuote) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

function renderList(items: string[]): string {
  return `[${items.map((i) => (i.includes(",") ? `"${i.replace(/"/g, '\\"')}"` : i)).join(", ")}]`;
}

function composeAgentFile(input: {
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  skills: string[];
  disallowedTools: string[];
  permissionMode: string | null;
  /** `FmFields.maxTurns` — a digit STRING (contract §14.4), not a number. */
  maxTurns: string | null;
  body: string;
}): string {
  const lines: string[] = [];
  if (input.name.trim() !== "") lines.push(`name: ${renderScalar(input.name.trim())}`);
  if (input.description.trim() !== "") lines.push(`description: ${renderScalar(input.description.trim())}`);
  if (input.model !== null && input.model.trim() !== "") lines.push(`model: ${renderScalar(input.model.trim())}`);
  if (input.tools.length > 0) lines.push(`tools: ${renderList(input.tools)}`);
  if (input.skills.length > 0) lines.push(`skills: ${renderList(input.skills)}`);
  if (input.disallowedTools.length > 0) lines.push(`disallowedTools: ${renderList(input.disallowedTools)}`);
  if (input.permissionMode !== null) lines.push(`permissionMode: ${input.permissionMode}`);
  if (input.maxTurns !== null) lines.push(`maxTurns: ${input.maxTurns}`);
  const body = input.body.startsWith("\n") ? input.body : `\n${input.body}`;
  if (lines.length === 0) return body.replace(/^\n/, "");
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

const EMPTY_EXAMPLE = {
  relPath: ".claude/agents/example-reviewer.md",
  content: composeAgentFile({
    name: "example-reviewer",
    description:
      "Use this agent whenever a pull request touches the payments module, to check for missing idempotency keys and unlogged refunds. Do not use it for unrelated modules.",
    model: null,
    tools: ["Read", "Grep", "Glob"],
    skills: [],
    disallowedTools: [],
    permissionMode: null,
    maxTurns: null,
    body:
      "\nYou review changes to the payments module for two specific risks: missing idempotency " +
      "keys on write paths, and refunds that skip the audit log. Read the diff, trace every call " +
      "into src/payments/, and flag violations with the exact file and line. You do not fix code " +
      "— you report findings only.\n",
  }),
};

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const createAgent = useAgentsStore((s) => s.createAgent);
  const updateDraft = useAgentsStore((s) => s.updateDraft);
  const saveDoc = useAgentsStore((s) => s.saveDoc);
  const updateMeta = useAgentsStore((s) => s.updateMeta);
  const setAvatarImage = useAgentsStore((s) => s.setAvatarImage);
  const select = useAgentsStore((s) => s.select);
  const skills = useAgentsStore((s) => s.skills);
  const agents = useAgentsStore((s) => s.agents);

  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [fileEditOpen, setFileEditOpen] = useState(false);
  const [withMemory, setWithMemory] = useState(true);
  const [model, setModel] = useState<string | null>(null);
  const [priority, setPriority] = useState(3);
  const [influence, setInfluence] = useState(50);
  const [nickname, setNickname] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [disallowedTools, setDisallowedTools] = useState<string[]>([]);
  const [maxTurns, setMaxTurns] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<string | null>(null);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [whenToUse, setWhenToUse] = useState("");
  const [whenNotToUse, setWhenNotToUse] = useState("");
  const [duties, setDuties] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Defect 4 fix — the seed is frozen at mount (`slugForFile("")`, a fixed
  // "node" identicon before anything is typed) and re-derives ONLY on an
  // explicit "Reset seed" action or while the user is directly editing the
  // File field (`fileNameTouched`). It never reacts to Name keystrokes.
  const [avatarSourcePath, setAvatarSourcePath] = useState<string | null>(null);
  const [avatarSeed, setAvatarSeed] = useState(() => slugForFile(name));
  const [avatarMenuAnchor, setAvatarMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // File name auto-slugs from Name until the user edits it directly (the
  // fileNameTouched idiom from NodeWizard — contract §7.3).
  useEffect(() => {
    if (fileNameTouched) return;
    setFileName(`${slugForFile(name)}.md`);
  }, [name, fileNameTouched]);

  const normalizedFileName = normalizeFileName(fileName, slugForFile(name));
  const memoryStem = normalizedFileName.replace(/\.md$/i, "");
  const collision = useMemo(
    () => agents.some((a) => a.fileName.toLowerCase() === normalizedFileName.toLowerCase()),
    [agents, normalizedFileName],
  );

  // Defect 4 — only a DIRECT file-field edit re-derives the seed, live,
  // while it's happening; the Name field never touches this effect.
  useEffect(() => {
    if (!fileNameTouched) return;
    setAvatarSeed(memoryStem);
  }, [fileNameTouched, memoryStem]);

  const openAvatarMenu = (rect: DOMRect) => {
    setAvatarMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
  };

  const doUploadAvatar = () => {
    void open({
      multiple: false,
      title: "Choose an avatar image",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    })
      .then((picked) => {
        if (typeof picked !== "string") return;
        setAvatarError(null);
        setAvatarSourcePath(picked);
      })
      .catch((e: unknown) => setAvatarError(String(e)));
  };

  const doResetAvatarSeed = () => {
    setAvatarSeed(Math.random().toString(36).slice(2));
  };

  const avatarMenuItems: MenuItem[] = [
    { kind: "item", id: "upload", label: "Upload image…", icon: ImagePlus, onSelect: doUploadAvatar },
    { kind: "item", id: "reset-seed", label: "Reset seed", icon: RefreshCw, onSelect: doResetAvatarSeed },
    ...(avatarSourcePath !== null
      ? [
          {
            kind: "item" as const,
            id: "remove",
            label: "Remove image",
            icon: Trash2,
            danger: true,
            onSelect: () => setAvatarSourcePath(null),
          },
        ]
      : []),
  ];

  const toggleSkill = (name_: string) => {
    setSkillNames((cur) => (cur.includes(name_) ? cur.filter((x) => x !== name_) : [...cur, name_]));
  };

  const composedDescription = joinDescription(whenToUse, whenNotToUse);
  const others = agents.map((a) => ({
    label: a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName,
    description: a.fields.description ?? "",
  }));
  const descriptionValidation = validateDescription(whenToUse, composedDescription, others);

  const canSubmit = name.trim() !== "" && !collision && !busy && descriptionValidation.blocking === null;

  // E3 — every path this Confirm will create, named plainly.
  const willCreate = [
    `.claude/agents/${normalizedFileName}`,
    ...(withMemory ? [`.claude/agent-memory/${memoryStem}/`] : []),
    ...(avatarSourcePath !== null ? [`.cowtext/avatars/${memoryStem}.<ext>`] : []),
  ];

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      const err = await createAgent(name.trim(), { fileName: normalizedFileName, withMemory });
      if (err !== null) throw new Error(err);
      const sel = useAgentsStore.getState().selection;
      if (sel === null || sel.kind !== "agent") throw new Error("Agent created but could not be selected");
      const createdFileName = sel.key;
      const doc = useAgentsStore.getState().agents.find((a) => a.fileName === createdFileName);
      try {
        if (doc !== undefined) {
          const patchedSel: Selection = { kind: "agent", key: createdFileName };
          // D4c — Mirrors agent_template. `body` is a WHOLE-body replacement
          // via frontmatter::patch, so the template's scaffold headers are
          // gone the instant we send anything — re-emit the system prompt
          // as the entire body rather than trying to preserve headers this
          // modal never showed the user in the first place. The leading
          // "\n" is required: frontmatter::emit concatenates the body
          // directly after the closing "---" line.
          const composedBody = `\n${duties.trim()}\n`;
          const patchedFields: FmFields = {
            ...doc.fields,
            description: composedDescription === "" ? null : composedDescription,
            model,
            tools,
            skills: skillNames,
            disallowedTools,
            permissionMode,
            maxTurns,
          };
          updateDraft(patchedSel, { fields: patchedFields, body: composedBody });
          const saveErr = await saveDoc(patchedSel);
          if (saveErr !== null) throw new Error(saveErr);
        }
        // D4b — `agentAvatarSet` needs the file's real (Rust-assigned) name,
        // which only exists after `createAgent` resolves, so the upload is
        // deferred to here rather than attempted while picking the file.
        if (avatarSourcePath !== null) {
          const avatarErr = await setAvatarImage(createdFileName, avatarSourcePath);
          if (avatarErr !== null) throw new Error(avatarErr);
        }
      } catch (inner) {
        // §12.2 — a partial failure (file landed, a later step didn't) is
        // rolled back with the existing agent_delete rather than left half-
        // configured. The memory folder, if any, is intentionally NOT
        // removed — deleting a directory the user may already have written
        // into is worse than leaving it (same ruling as Undo, below).
        select({ kind: "agent", key: createdFileName });
        await useAgentsStore.getState().deleteSelected();
        throw inner;
      }
      updateMeta(createdFileName, {
        nickname,
        priority,
        influence,
        avatarSeed,
      });
      return createdFileName;
    })()
      .then((fileNameOk) => {
        pushToastWithAction({
          severity: "success",
          title: "Agent created",
          detail: withMemory
            ? `.claude/agents/${fileNameOk} · Undo removes the agent file only — the memory folder stays.`
            : `.claude/agents/${fileNameOk}`,
          action: {
            label: "Undo",
            run: () => {
              select({ kind: "agent", key: fileNameOk });
              void useAgentsStore.getState().deleteSelected();
            },
          },
        });
        onClose();
      })
      .catch((e: unknown) => {
        setBusy(false);
        setError(String(e));
      });
  };

  const previewFile: PreviewFile = {
    relPath: `.claude/agents/${normalizedFileName}`,
    target: "agent",
    oldContent: null,
    newContent: composeAgentFile({
      name: name.trim(),
      description: composedDescription,
      model,
      tools,
      skills: skillNames,
      disallowedTools,
      permissionMode,
      maxTurns,
      body: duties,
    }),
    handwritten: false,
    unchanged: false,
  };
  // PreviewPane only renders `emptyExample` when the active tab's `files`
  // is empty — an empty `tabs` array resolves `active` to `undefined` and
  // short-circuits straight to "Nothing to preview yet.", never reaching
  // the empty-example branch. Always supply the one tab; its `files` array
  // is what toggles between the two.
  const hasContent = name.trim() !== "";
  const tabs: PreviewTab[] = [{ key: "agent", label: "Agent file", files: hasContent ? [previewFile] : [] }];
  const tokenEstimate = Math.round(previewFile.newContent.length / 4);

  const left = (
    <div className="flex flex-col gap-4 p-4">
      {error !== null && (
        <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
          {error}
        </div>
      )}

      {/* Identity — Block A4 */}
      <div>
        <FieldLabel>Name</FieldLabel>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <span className="font-mono text-2xs text-content-muted">name: {memoryStem}</span>
          <button
            type="button"
            onClick={() => setFileEditOpen((v) => !v)}
            title="Edit file name"
            className={ICON_BTN}
          >
            <Pencil size={11} strokeWidth={1.5} />
          </button>
        </div>
        {fileEditOpen && (
          <input
            value={fileName}
            onChange={(e) => {
              setFileNameTouched(true);
              setFileName(e.target.value);
            }}
            placeholder="agent.md"
            className="mt-1 h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content focus:border-accent"
          />
        )}
        {collision && (
          <p className="mt-1 text-xs leading-snug text-danger-text">
            An agent file named {normalizedFileName} already exists — choose a different name.
          </p>
        )}
      </div>

      {/* Dispatch — Block B */}
      <DescriptionEditor
        whenToUse={whenToUse}
        whenNotToUse={whenNotToUse}
        disabled={busy}
        validation={descriptionValidation}
        onChangeWhenToUse={setWhenToUse}
        onChangeWhenNotToUse={setWhenNotToUse}
      />

      {/* System prompt — Block B4 */}
      <SystemPromptEditor value={duties} docKey="new-agent" disabled={busy} onChange={setDuties} />

      {/* Runtime — Block C/D */}
      <div>
        <FieldLabel>Model</FieldLabel>
        <ModelPicker value={model} disabled={busy} onChange={setModel} />
      </div>
      <div>
        <FieldLabel>Tools</FieldLabel>
        <ToolsField
          tools={tools}
          disallowedTools={disallowedTools}
          disabled={busy}
          onChangeTools={setTools}
          onChangeDisallowed={setDisallowedTools}
        />
      </div>
      <RuntimeLimits
        maxTurns={maxTurns}
        permissionMode={permissionMode}
        disabled={busy}
        onChangeMaxTurns={setMaxTurns}
        onChangePermissionMode={setPermissionMode}
      />

      {skills.length > 0 && (
        <div>
          <FieldLabel>Skills</FieldLabel>
          <p className="mb-1 text-xs leading-snug text-content-muted">
            A Cowtext convention — Claude Code ignores this key; attaching a skill here records
            intent only.
          </p>
          <ul className="flex flex-col gap-0.5 rounded border border-border-subtle bg-surface-inset p-1.5">
            {skills.map((sk) => {
              const label = sk.fields.name !== null && sk.fields.name !== "" ? sk.fields.name : sk.dirName;
              return (
                <li key={sk.dirName} className="flex h-[22px] items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    checked={skillNames.includes(label)}
                    onChange={() => toggleSkill(label)}
                    className="h-3 w-3 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-content">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Local only — last, quieter (contract §14.3) */}
      <div className="flex flex-col gap-3 rounded border border-border-subtle bg-surface-inset p-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">Local only</span>
          <LocalOnlyBadge />
        </div>
        <div className="flex items-center gap-3">
          <AvatarButton
            seed={avatarSeed}
            onOpen={openAvatarMenu}
            menuAnchor={avatarMenuAnchor}
            menuItems={avatarMenuItems}
            onMenuClose={() => setAvatarMenuAnchor(null)}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {avatarSourcePath !== null ? (
              <p className="truncate font-mono text-2xs text-content-muted" title={avatarSourcePath}>
                {avatarSourcePath}
              </p>
            ) : (
              <p className="text-2xs text-content-muted">
                Identicon shown until you upload an image — uploaded after the agent is created.
              </p>
            )}
          </div>
        </div>
        {avatarError !== null && <p className="font-mono text-xs text-danger-text">{avatarError}</p>}
        <FieldRow label="Nickname" compiles={false}>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 40))}
            placeholder="optional"
            className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent"
          />
        </FieldRow>
        <FieldRow
          label="Priority (1 = highest)"
          compiles={false}
          hint="Your own ranking. Cowtext shows it on the fleet rail and the agent's canvas plate; it does not affect dispatch order or compiled context."
        >
          <Stepper value={priority} min={1} max={5} disabled={false} onChange={setPriority} />
        </FieldRow>
        <FieldRow label="Influence" compiles={false}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={influence}
              aria-label="Influence"
              onChange={(e) => setInfluence(Number(e.target.value))}
              className="h-[16px] w-[140px] cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-surface-inset [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-[12px] [&::-webkit-slider-thumb]:w-[12px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-accent"
            />
            <span className="w-[32px] text-right font-mono text-xs text-content-secondary">{influence}%</span>
          </div>
        </FieldRow>
        <FieldRow
          label="Memory folder"
          compiles={false}
          hint={`.claude/agent-memory/${memoryStem}/ — a real directory, but only Cowtext-side bookkeeping decides whether it's created.`}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-2xs text-content-muted">created on confirm</span>
            <AmberToggle checked={withMemory} onChange={setWithMemory} />
          </div>
        </FieldRow>
      </div>
    </div>
  );

  const right = (
    <PreviewPane
      tabs={tabs}
      activeKey="agent"
      onTab={() => {}}
      emptyExample={EMPTY_EXAMPLE}
      loadSentence="Read in full whenever this agent is dispatched — not part of the always-loaded context."
      tokenEstimate={tokenEstimate}
    />
  );

  // E3 — "Footer lists every path that will be created". `footerNote` is
  // the FROZEN verbatim promise line (§14.1); the path list is separate
  // content within the `footer` slot (free React nodes, not frozen text).
  const footer = (
    <div className="flex w-full items-center gap-3">
      <p className="min-w-0 flex-1 truncate font-mono text-2xs text-content-muted" title={willCreate.join(" · ")}>
        {willCreate.join(" · ")}
      </p>
      <button onClick={onClose} disabled={busy} className={SECONDARY_BTN}>
        Cancel
      </button>
      <button onClick={submit} disabled={!canSubmit} className={PRIMARY_BTN}>
        {busy ? "· · ·" : "Create agent"}
      </button>
    </div>
  );

  return (
    <TwoPaneModal
      title="New agent"
      onClose={onClose}
      left={left}
      right={right}
      footerNote="Nothing is written until you confirm."
      footer={footer}
    />
  );
}

// A tiny local helper so the avatar button + its menu are declared once —
// the button needs its own DOMRect at click time (menu anchor), which
// doesn't fit cleanly as a plain function; kept as a component instead of
// inlining the ref/measure logic twice.
function AvatarButton({
  seed,
  onOpen,
  menuAnchor,
  menuItems,
  onMenuClose,
}: {
  seed: string;
  onOpen: (rect: DOMRect) => void;
  menuAnchor: { x: number; y: number } | null;
  menuItems: MenuItem[];
  onMenuClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
        title="Change avatar"
        className="flex-none rounded-sm outline-none transition-opacity duration-fast hover:opacity-80"
      >
        <AgentAvatar seed={seed} size={40} />
      </button>
      {menuAnchor !== null && (
        // Defect 3 fix — this menu opens from inside a z-modal dialog
        // (TwoPaneModal); without `layer="modal"` it would paint BEHIND the
        // modal (§2.3), exactly the bug this contract names by file:line.
        <ContextMenu x={menuAnchor.x} y={menuAnchor.y} items={menuItems} layer="modal" onClose={onMenuClose} />
      )}
    </>
  );
}

