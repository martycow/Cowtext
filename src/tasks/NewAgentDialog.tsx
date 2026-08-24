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
import { Bookmark, ImagePlus, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { DEFAULT_PRIORITY, useAgentsStore, type Selection } from "../store/agents";
import {
  AGENT_LOCAL_HINT,
  DescriptionEditor,
  FieldRow,
  FieldLabel,
  RuntimeLimits,
  Stepper,
  SystemPromptEditor,
  joinDescription,
  validateDescription,
} from "../agents/AgentEditor";
import { ModelPicker } from "../agents/ModelPicker";
import { providerForModel } from "../agents/modelCatalog";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ToolsField } from "../agents/ToolPicker";
import { useBuiltinSkillStates } from "../agents/builtinSkills";
import { normalizeFileName, slugForFile } from "../wizard/paths";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { TwoPaneModal } from "../ui/TwoPaneModal";
import { PreviewPane, type PreviewTab } from "../ui/PreviewPane";
import { LocalOnlyBadge } from "../ui/LocalOnlyBadge";
import type { PreviewFile } from "../compile/types";
import { pushToast, pushToastWithAction } from "../store/toasts";
import { useGraphStore } from "../store/graph";
import { NODE_TYPE_BY_ROLE } from "../config/nodeTypes";
import { useUiStore } from "../store/ui";
import {
  CUSTOM_PRESET_PREFIX,
  DEFAULT_AGENT_MODEL,
  DEFAULT_PROVIDER,
  PRESET_GROUPS,
  groupPresets,
  isCustomPresetId,
  type AgentPreset,
  type PresetGroup,
} from "../resources";
import { useSettingsStore } from "../store/settings";
import type { FmFields, ProviderId } from "../agents/types";

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
  const setBuiltinInclude = useAgentsStore((s) => s.setBuiltinInclude);
  const customPresets = useSettingsStore((s) => s.customAgentPresets);
  const saveCustomPreset = useSettingsStore((s) => s.saveCustomPreset);
  const builtins = useBuiltinSkillStates();

  // Block 5b — the canvas menus open this wizard with a prefill; the rail's
  // plain "Create agent" opens it with none. Read once per render, never
  // copied into local state: `openAgentWizard` resets both fields, and a
  // stale copy is exactly how the last node's id leaks into the next agent.
  const agentWizard = useUiStore((s) => s.agentWizard);
  const nodes = useGraphStore((s) => s.nodes);
  const adoptFile = useGraphStore((s) => s.adoptFile);
  const addEdge = useGraphStore((s) => s.addEdge);
  const contextNode =
    agentWizard.contextNodeId === null
      ? null
      : (nodes.find((n) => n.id === agentWizard.contextNodeId) ?? null);

  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [fileEditOpen, setFileEditOpen] = useState(false);
  const [withMemory, setWithMemory] = useState(true);
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [model, setModel] = useState<string | null>(DEFAULT_AGENT_MODEL);
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [presetId, setPresetId] = useState<string | null>(null);
  // Block B — the "Save as preset" strip is closed until asked for: it is a
  // second, optional outcome of this dialog, and a form that shows both
  // outcomes at once reads as though it cannot tell which one you want.
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetGroup, setPresetGroup] = useState<PresetGroup>("task");
  // Bumped by every preset click: `ToolsField` derives its inherit/restrict
  // radio from `tools` ONCE (useState initialiser), so a preset that fills
  // tools behind its back would leave the radio showing the old mode. A
  // remount is the honest fix — the alternative is a second copy of that
  // mode rule living here.
  const [presetNonce, setPresetNonce] = useState(0);
  const [influence, setInfluence] = useState(50);
  const [nickname, setNickname] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [disallowedTools, setDisallowedTools] = useState<string[]>([]);
  const [maxTurns, setMaxTurns] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<string | null>(null);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  // Tester #5 — built-in ids whose compile toggle this modal INTENDS to turn
  // on. Held here, applied in `submit` only: see `toggleBuiltinSkill`.
  const [pendingBuiltinIncludes, setPendingBuiltinIncludes] = useState<string[]>([]);
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

  /** D-20 — attaching a VIRTUAL built-in also turns its compile toggle on.
   *  Without this the agent's `skills:` would name a file that never gets
   *  written: the skill is bundled, not on disk, until a compile
   *  materialises it.
   *
   *  Tester #5 — that toggle is NOT flipped here. `setBuiltinInclude` rides
   *  the 700 ms sidecar debounce, so ticking a box would put
   *  `.cowtext/agents.json` on disk while this modal is still open and the
   *  footer is still promising "Nothing is written until you confirm"
   *  (§7.6). The intent is parked in `pendingBuiltinIncludes` and applied in
   *  `submit`, after `createAgent` succeeds; Cancel drops it and writes
   *  nothing. Detaching deliberately does NOT turn it back off — another
   *  agent may rely on it, and un-including is a Skills-rail decision, not
   *  a side effect of this checkbox. */
  const toggleBuiltinSkill = (id: string, label: string, virtual: boolean) => {
    const attaching = !skillNames.includes(label);
    toggleSkill(label);
    if (attaching && virtual) {
      setPendingBuiltinIncludes((cur) => (cur.includes(id) ? cur : [...cur, id]));
    }
  };

  /** WO16 Block B — save what is on the form right now as a reusable
   *  preset. Deliberately a separate act from Create: a preset is a
   *  template for agents you have not made yet, so it must be savable
   *  without also minting an agent, and creating an agent must not quietly
   *  leave a preset behind.
   *
   *  Saving over the SAME id when a custom preset is selected and its name
   *  is unchanged is what makes the Settings pane's "re-save from the New
   *  Agent dialog" promise true — otherwise correcting a preset's tools
   *  would strand a near-duplicate beside the original. */
  const presetSlug = presetName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const overwriting =
    presetId !== null && isCustomPresetId(presetId) && presetId === `${CUSTOM_PRESET_PREFIX}${presetSlug}`;
  const presetClash =
    !overwriting && customPresets.some((p) => p.id === `${CUSTOM_PRESET_PREFIX}${presetSlug}`);
  const canSavePreset = presetSlug !== "" && duties.trim() !== "" && !presetClash;

  const saveAsPreset = () => {
    if (!canSavePreset) return;
    const id = `${CUSTOM_PRESET_PREFIX}${presetSlug}`;
    const saved: AgentPreset = {
      id,
      name: presetName.trim(),
      group: presetGroup,
      description: duties,
      whenToUse,
      // Same rule the picker relies on and `applyPreset` reads back:
      // an empty tool list IS `inherit`, never a restrict-to-nothing.
      tools: tools.length === 0 ? [] : tools,
      mode: tools.length === 0 ? "inherit" : "restrict",
      priority,
      // D-13 again: `model` is only meaningful for Anthropic, so a preset
      // saved under another provider pins nothing and takes the wizard
      // default when it is applied.
      ...(provider === "anthropic" && model !== null ? { model } : {}),
    };
    saveCustomPreset(saved);
    setPresetId(id);
    setSavingPreset(false);
    pushToast({
      severity: "success",
      title: overwriting ? `Preset “${saved.name}” updated` : `Preset “${saved.name}” saved`,
      detail: "Available in this dialog and editable in Settings › Agent presets.",
    });
  };

  /** Block 3c — a preset fills the fields and then gets out of the way:
   *  every one of them stays editable, and nothing is written anywhere
   *  until Create. `Custom` clears back to the blank sheet. */
  const applyPreset = (preset: AgentPreset | null) => {
    setPresetId(preset?.id ?? null);
    setPresetNonce((n) => n + 1);
    if (preset === null) {
      setName("");
      setDuties("");
      setWhenToUse("");
      setTools([]);
      setPriority(DEFAULT_PRIORITY);
      setModel(DEFAULT_AGENT_MODEL);
      setProvider(DEFAULT_PROVIDER);
      return;
    }
    setName(preset.name);
    setDuties(preset.description);
    setWhenToUse(preset.whenToUse);
    setTools(preset.mode === "inherit" ? [] : preset.tools);
    setPriority(preset.priority);
    // So that re-saving a custom preset lands back in the same group rather
    // than defaulting to "task" and quietly moving it in the picker.
    setPresetGroup(preset.group);
    if (preset.model !== undefined) {
      setModel(preset.model);
      setProvider(providerForModel(preset.model) ?? DEFAULT_PROVIDER);
    }
  };

  const composedDescription = joinDescription(whenToUse, whenNotToUse);
  const others = agents.map((a) => ({
    label: a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName,
    description: a.fields.description ?? "",
  }));
  const descriptionValidation = validateDescription(name, whenToUse, composedDescription, others);

  // D-13 — `model:` is written for Anthropic only; every other provider
  // keeps the key out of the file (the picker says so with LocalOnlyBadge).
  const frontmatterModel = provider === "anthropic" ? model : null;

  // Block 4 — built-ins first (they exist in a project with no
  // `.claude/skills/` at all), then the project's own. A built-in the user
  // edited on disk is listed ONCE, from the built-in row, wearing the badge
  // that says where it came from (D-5).
  const skillRows = [
    ...builtins.map((b) => ({
      key: `builtin:${b.id}`,
      builtinId: b.id,
      virtual: b.state === "virtual",
      label:
        b.onDisk !== null && b.onDisk.fields.name !== null && b.onDisk.fields.name !== ""
          ? b.onDisk.fields.name
          : b.name,
      badge:
        b.state === "virtual"
          ? "bundled"
          : b.state === "materialized"
            ? "materialized"
            : "modified from built-in",
    })),
    ...skills
      .filter((sk) => !builtins.some((b) => b.id === sk.dirName))
      .map((sk) => ({
        key: `project:${sk.dirName}`,
        builtinId: null,
        virtual: false,
        label: sk.fields.name !== null && sk.fields.name !== "" ? sk.fields.name : sk.dirName,
        badge: null,
      })),
  ];
  const attachedVirtual = skillRows.some((r) => r.virtual && skillNames.includes(r.label));

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
            model: frontmatterModel,
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
        // D-13 / A-20 — the provider is recorded whether or not it reached
        // the file, so reopening the agent shows the chip the user picked;
        // the model rides the sidecar for exactly the providers whose file
        // format has no `model:` key. Anthropic writes it to frontmatter
        // instead (see `frontmatterModel`), so the sidecar stores `null` —
        // one home per value, never two that can disagree.
        provider,
        model: provider === "anthropic" ? null : model,
      });
      // Tester #5 — the deferred include toggles land here, on the same
      // sidecar debounce as the `updateMeta` above (one write, not two).
      // Reached only after `createAgent` and every post-create step
      // succeeded: the rollback path above throws before this line. Only
      // ids the agent is STILL attached to are applied — deferring made
      // attach-then-detach observable, and turning on a compile toggle for
      // a skill nothing references would add an unreferenced file to the
      // next Compile's write set. (An id already on stays on: this only
      // ever writes `true`.)
      for (const id of pendingBuiltinIncludes) {
        const row = skillRows.find((r) => r.builtinId === id);
        if (row !== undefined && skillNames.includes(row.label)) setBuiltinInclude(id, true);
      }

      // Block 5b — placement, then the edge. Adopt first even when only a
      // context node was named: `addEdge` needs a source, and an agent with
      // no node has none. `adoptFile` is idempotent and returns the id
      // either way (D-17).
      let edgeWarning: string | null = null;
      if (agentWizard.position !== null || agentWizard.contextNodeId !== null) {
        const agentNodeId = adoptFile(
          `.claude/agents/${createdFileName}`,
          name.trim(),
          agentWizard.position ?? undefined,
        );
        if (agentWizard.contextNodeId !== null) {
          const edgeId = addEdge({
            source: agentNodeId,
            target: agentWizard.contextNodeId,
            kind: "imports",
          });
          // Tester #2 — `addEdge` returns null when `edgeRules` denies the
          // pair (a `command` or `skill` node cannot be imported) or when
          // the node vanished while the modal was open. The Context row
          // promised an edge; staying silent about not drawing one is the
          // lie. The canvas menu disables the item for those roles
          // (FX-U4b) — this is the net under it, so it must survive the
          // menu being right.
          if (edgeId === null) {
            const target = useGraphStore
              .getState()
              .nodes.find((n) => n.id === agentWizard.contextNodeId);
            edgeWarning =
              target === undefined
                ? "Agent created, but the context node is no longer on the graph — no context edge was added."
                : target.deprecated !== undefined
                  ? "Agent created, but the context node is deprecated — no context edge was added."
                  : `Agent created, but ${NODE_TYPE_BY_ROLE[target.role].label} nodes cannot be imported — no context edge was added.`;
          }
        }
      }
      return { fileName: createdFileName, edgeWarning };
    })()
      .then(({ fileName: fileNameOk, edgeWarning }) => {
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
        if (edgeWarning !== null) pushToast({ severity: "warning", title: edgeWarning });
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
      model: frontmatterModel,
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

      {/* Block 5b — what the canvas asked for, in words, before any field.
          The edge is drawn on Create; naming it here is the only warning
          the user gets that this wizard is about to touch the graph. */}
      {(contextNode !== null || agentWizard.position !== null) && (
        <div className="flex items-center gap-2 rounded border border-accent-border bg-accent-surface px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-accent-text">
            {contextNode !== null
              ? `Context: ${contextNode.title} — imported by this agent`
              : "Placed on the canvas where you clicked"}
          </span>
        </div>
      )}

      {/* Preset — Block 3c, grouped in WO16 Block B.
          The two families are not interchangeable and the flat row said they
          were: a `task` preset is written so Claude Code's own dispatcher can
          MATCH it from a request, while Direction and Engineering presets are
          job titles a user picks deliberately. Headings say which is which
          before the click, not after. */}
      <div>
        <div className="flex items-center gap-2">
          <FieldLabel>Preset</FieldLabel>
          <div className="min-w-0 flex-1" />
          {!savingPreset && (
            <button
              type="button"
              disabled={busy || duties.trim() === ""}
              title={
                duties.trim() === ""
                  ? "Fill in the duties first — that is what a preset carries"
                  : "Save these fields as a reusable preset"
              }
              onClick={() => {
                setPresetName(name);
                setSavingPreset(true);
              }}
              className="flex h-control-sm flex-none items-center gap-1 rounded px-1.5 text-2xs text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <Bookmark size={11} strokeWidth={1.5} />
              Save as preset
            </button>
          )}
        </div>

        <div role="radiogroup" aria-label="Preset" className="space-y-1.5">
          <PresetChip
            label="Custom"
            on={presetId === null}
            disabled={busy}
            title="Start from an empty sheet"
            onClick={() => applyPreset(null)}
          />
          {groupPresets(customPresets).map((row) => (
            <div key={row.group}>
              <div className="mb-0.5 text-2xs uppercase tracking-wide text-content-muted">
                {row.label}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {row.presets.map((p) => (
                  <PresetChip
                    key={p.id}
                    label={p.name}
                    on={presetId === p.id}
                    disabled={busy}
                    title={p.whenToUse}
                    mine={isCustomPresetId(p.id)}
                    onClick={() => applyPreset(p)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {savingPreset ? (
          <div className="mt-1.5 rounded border border-accent-border bg-accent-surface p-2">
            <div className="flex items-center gap-1.5">
              <input
                value={presetName}
                autoFocus
                placeholder="Preset name…"
                aria-label="Preset name"
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveAsPreset();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSavingPreset(false);
                  }
                }}
                className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-xs text-content transition-colors duration-fast placeholder:text-content-muted focus:border-accent"
              />
              <select
                value={presetGroup}
                aria-label="Preset group"
                onChange={(e) => setPresetGroup(e.target.value as PresetGroup)}
                className="h-control-sm w-[112px] flex-none rounded border border-border bg-surface-2 px-1.5 text-xs text-content transition-colors duration-fast focus:border-accent"
              >
                {PRESET_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
              <button
                onClick={saveAsPreset}
                disabled={!canSavePreset}
                className="flex h-control-sm flex-none items-center rounded border border-accent-border bg-surface-2 px-2 text-xs text-accent-text transition-colors duration-fast disabled:cursor-not-allowed disabled:border-border disabled:text-content-disabled"
              >
                {overwriting ? "Update" : "Save"}
              </button>
              <button
                onClick={() => setSavingPreset(false)}
                className={ICON_BTN}
                title="Cancel"
                aria-label="Cancel saving preset"
              >
                <X size={13} strokeWidth={1.5} />
              </button>
            </div>
            <p className="pt-1 text-2xs leading-snug text-accent-text">
              {presetClash
                ? "You already have a preset by that name — rename it, or pick that one first to update it."
                : overwriting
                  ? "Updates the preset you started from. Agents already created from it are untouched."
                  : "Saves the duties, when-to-use, tools, priority and model on this form."}
            </p>
          </div>
        ) : (
          <p className="pt-1 text-2xs leading-snug text-content-muted">
            Fills the fields below — every one of them stays editable.
          </p>
        )}
      </div>

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
        <ModelPicker
          provider={provider}
          model={model}
          disabled={busy}
          onChange={(v) => {
            setProvider(v.provider);
            setModel(v.model);
          }}
        />
      </div>
      <div>
        <FieldLabel>Tools</FieldLabel>
        <ToolsField
          key={`tools-${presetNonce}`}
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

      {skillRows.length > 0 && (
        <div>
          <FieldLabel>Skills</FieldLabel>
          <p className="mb-1 text-xs leading-snug text-content-muted">
            A Cowtext convention — Claude Code ignores this key; attaching a skill here records
            intent only.
          </p>
          <ul className="flex flex-col gap-0.5 rounded border border-border-subtle bg-surface-inset p-1.5">
            {skillRows.map((row) => (
              <li key={row.key} className="flex h-[22px] items-center gap-2 px-1">
                <input
                  type="checkbox"
                  checked={skillNames.includes(row.label)}
                  onChange={() =>
                    row.builtinId === null
                      ? toggleSkill(row.label)
                      : toggleBuiltinSkill(row.builtinId, row.label, row.virtual)
                  }
                  className="h-3 w-3 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-content">{row.label}</span>
                {row.badge !== null && <SkillBadge label={row.badge} />}
              </li>
            ))}
          </ul>
          {attachedVirtual && (
            <p className="pt-1 text-2xs leading-snug text-content-muted">
              A bundled skill is written to .claude/skills/ by the next Compile — it is included
              there for review first.
            </p>
          )}
        </div>
      )}

      {/* Local only — last, quieter (contract §14.3) */}
      <div className="flex flex-col gap-3 rounded border border-border-subtle bg-surface-inset p-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">Local only</span>
          <LocalOnlyBadge hint={AGENT_LOCAL_HINT} />
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

/** Block 3c chip. Blue = the user picked it (accent law); the whole row is
 *  a radiogroup, so exactly one is ever on. */
function PresetChip({
  label,
  on,
  disabled,
  title,
  mine,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  title: string;
  /** One of the user's own presets — marked, because "did I write this or
   *  did Cowtext ship it?" is the question that decides whether editing it
   *  in Settings is even possible. */
  mine?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex h-control-sm flex-none items-center rounded border px-2 text-xs transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-60 ${
        on
          ? "border-accent-border bg-accent-surface text-accent-text"
          : "border-border bg-surface-2 text-content-secondary hover:border-border-strong hover:text-content"
      }`}
    >
      {label}
      {mine === true && (
        <span
          aria-hidden
          className="ml-1 text-micro uppercase tracking-wide text-content-muted"
        >
          yours
        </span>
      )}
    </button>
  );
}

/** Neutral state chip — `bundled` / `materialized` / `modified from
 *  built-in`. Not a warning, so not amber. */
function SkillBadge({ label }: { label: string }) {
  return (
    <span className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted">
      {label}
    </span>
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

