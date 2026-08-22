// Left-rail AGENTS and SKILLS sections (Marty 2026-08-18: agents live in the
// panels, not a modal). Rows select: an adopted agent selects its graph node
// (Inspector shows the agent editor), an un-adopted one selects in the agents
// store only (Inspector shows the standalone editor). Deletes are armed
// inline — first click arms a confirm strip, nothing is destructive in one
// click.
//
// WO15: the agent wizard is no longer mounted here. `App.tsx` owns the one
// mount and `useUiStore.agentWizard` owns "is it open, and with what
// prefill" — the canvas menus need to open the same dialog with a position
// and a context node, and two mounts of a create-dialog is how you get two
// agents from one Create click. Skills grew a Built-in group (Block 4):
// what Cowtext ships is visible in a project that has no `.claude/skills/`
// at all, and stays virtual until a Compile writes it.

import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, RotateCcw, Trash2, Workflow } from "lucide-react";
import { flushMetaSave, useAgentsStore, metaOrDefault, seedFor } from "../store/agents";
import { useFocusStore } from "../canvas/types";
import { sameRelPath, useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import { useUiStore } from "../store/ui";
import { agentContextTokens } from "../store/tokens";
import { pushToast } from "../store/toasts";
import { revealPath } from "../fs/api";
import { AgentAvatar } from "./AgentAvatar";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import type { AgentDoc } from "./types";
import { projectSkills, useBuiltinSkillStates } from "./builtinSkills";
import { skillsMaterialize } from "./api";
import { BuiltinSkillReadOnly } from "./SkillEditor";
import { NewSkillDialog } from "../tasks/NewSkillDialog";

function SectionHeader({
  label,
  count,
  note,
  title,
  onCreate,
}: {
  label: string;
  count: number;
  /** Appended after the count as ` · <note>`, same quiet treatment. For
   *  rows that exist in the list but are not files yet (bundled skills) —
   *  the count stays a count of things on disk. */
  note?: string;
  title?: string;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-[26px] flex-none items-center gap-1.5 border-b border-t border-border-subtle bg-surface-1 px-3">
      <span
        title={title}
        className="min-w-0 flex-1 truncate font-mono text-2xs uppercase tracking-wider text-content-muted"
      >
        {label} ({count}){note !== undefined && ` · ${note}`}
      </span>
      <button
        onClick={onCreate}
        title={`New ${label.toLowerCase().replace(/s$/, "")}`}
        className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
      >
        <Plus size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** Group divider inside a section — Built-in / Project (Block 4). Quieter
 *  than `SectionHeader`: it labels rows, it does not own an action. */
function GroupLabel({ label }: { label: string }) {
  return (
    <li className="flex h-[20px] items-center px-3">
      <span className="font-mono text-micro uppercase tracking-wider text-content-disabled">
        {label}
      </span>
    </li>
  );
}

function RowBadge({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted"
    >
      {label}
    </span>
  );
}

/** 24×13 pill switch. Blue: including a skill in the compile is the user
 *  deciding what gets written, not the agent doing something (accent law). */
function IncludeToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative h-[13px] w-[24px] flex-none rounded-pill border transition-colors duration-fast ${
        checked ? "border-accent-border bg-accent-surface" : "border-border-strong bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-[1px] h-[9px] w-[9px] rounded-pill transition-all duration-fast ${
          checked ? "left-[12px] bg-accent" : "left-[1px] bg-content-muted"
        }`}
      />
    </button>
  );
}

function ConfirmStrip({
  label,
  confirmLabel = "delete",
  onConfirm,
  onCancel,
}: {
  label: string;
  /** The verb, lower-case — "delete" or "overwrite". Both are destructive,
   *  so both wear the danger strip; only the word changes. */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-danger bg-danger-surface px-3 py-1">
      <span className="min-w-0 flex-1 text-2xs text-danger-text">{label}</span>
      <button
        onClick={onConfirm}
        className="h-[18px] flex-none rounded-sm border border-danger px-1.5 font-mono text-micro text-danger-text transition-colors duration-fast hover:bg-danger hover:text-content-inverse"
      >
        {confirmLabel}
      </button>
      <button
        onClick={onCancel}
        className="h-[18px] flex-none rounded-sm border border-border px-1.5 font-mono text-micro text-content-secondary transition-colors duration-fast hover:border-border-strong"
      >
        cancel
      </button>
    </div>
  );
}

export function AgentsRailSection({ root }: { root: string }) {
  const agents = useAgentsStore((s) => s.agents);
  const meta = useAgentsStore((s) => s.meta);
  const agentsSel = useAgentsStore((s) => s.selection);
  const select = useAgentsStore((s) => s.select);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const setSelection = useGraphStore((s) => s.setSelection);
  const adoptFile = useGraphStore((s) => s.adoptFile);
  const openAgentWizard = useUiStore((s) => s.openAgentWizard);
  const requestFocus = useFocusStore((s) => s.requestFocus);
  const files = useProjectStore((s) => s.files);
  const assembleStatus = useGraphStore((s) => s.assembleStatus);
  const [armed, setArmed] = useState<string | null>(null);
  const menu = useContextMenu();

  const nodeFor = (fileName: string) =>
    nodes.find((n) => sameRelPath(n.filePath, `.claude/agents/${fileName}`));

  // WO13_CONTRACT.md §2.6/defect 6, agent half. This section is mounted
  // whenever a project is open regardless of which Inspector tab (or none)
  // is showing, so it's the one place that can reliably notice an agent's
  // assemble job finish and refresh the agents store — unlike AgentEditor,
  // which is only mounted while its "Agent" tab happens to be selected.
  // Diffs against the PREVIOUS status map rather than reading `"assembled"`
  // directly, so this fires exactly once per completion, not once per
  // render while the terminal state persists.
  const prevAssembleRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevAssembleRef.current;
    prevAssembleRef.current = assembleStatus;
    for (const a of agents) {
      const node = nodeFor(a.fileName);
      if (node === undefined) continue;
      const status = assembleStatus[node.id];
      if (status === "assembled" && prev[node.id] !== "assembled") {
        void useAgentsStore.getState().reloadAgentFromDisk(a.fileName);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembleStatus, agents, nodes]);

  const rowTitle = (doc: AgentDoc): string => {
    const tokens = agentContextTokens(doc, nodes, edges, files);
    return `.claude/agents/${doc.fileName} — ≈${tokens.toLocaleString()} tok context`;
  };

  const pick = (fileName: string) => {
    const node = nodeFor(fileName);
    // Graph selection FIRST, ours second: `setSelection` clears the other
    // panel-owning selections (WO10 item 10), so setting ours first would
    // immediately undo it.
    setSelection(node !== undefined ? [node.id] : [], []);
    select({ kind: "agent", key: fileName });
    // An adopted agent lives somewhere on the canvas — ask to be shown it.
    // GraphCanvas ignores the request when the card is already in view.
    if (node !== undefined) requestFocus(node.id);
  };

  const openMenu = (e: React.MouseEvent, fileName: string, title: string) => {
    const node = nodeFor(fileName);
    const items: MenuItem[] = [
      node === undefined
        ? {
            kind: "item",
            id: "adopt",
            label: "Adopt to graph",
            icon: Workflow,
            onSelect: () => {
              adoptFile(`.claude/agents/${fileName}`, title);
              select({ kind: "agent", key: fileName });
            },
          }
        : {
            kind: "item",
            id: "select",
            label: "Select node on canvas",
            icon: Workflow,
            onSelect: () => pick(fileName),
          },
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () =>
          void revealPath(root, `.claude/agents/${fileName}`).catch((e: unknown) =>
            pushToast({
              severity: "warning",
              title: "Could not reveal in File Explorer",
              detail: String(e),
            }),
          ),
      },
      { kind: "separator", id: "sep" },
      {
        kind: "item",
        id: "delete",
        label: "Delete agent file…",
        icon: Trash2,
        danger: true,
        onSelect: () => setArmed(fileName),
      },
    ];
    menu.openAt(e, items);
  };

  return (
    <div className="flex-none">
      <SectionHeader label="Agents" count={agents.length} onCreate={() => openAgentWizard()} />
      <ul className="py-1">
        {agents.length === 0 && (
          <li className="flex flex-col items-start gap-1 px-3 py-1.5">
            <span className="text-2xs text-content-muted">No agents in .claude/agents/</span>
            {/* Stage 4 — an empty state with no way out of it is a dead
                end; this is the same wizard the canvas menus open. */}
            <button
              onClick={() => openAgentWizard()}
              className="flex h-control-sm flex-none items-center gap-1.5 rounded border border-accent-border bg-accent-surface px-2 text-2xs text-accent-text transition-colors duration-fast hover:bg-accent hover:text-content-inverse"
            >
              <Plus size={11} strokeWidth={1.5} />
              Create agent
            </button>
          </li>
        )}
        {agents.map((a) => {
          const node = nodeFor(a.fileName);
          const isSelected =
            (node !== undefined && selectedNodeIds.includes(node.id)) ||
            (agentsSel?.kind === "agent" && agentsSel.key === a.fileName && selectedNodeIds.length === 0);
          const m = metaOrDefault(meta, a.fileName);
          return (
            <li key={a.fileName}>
              <div
                onClick={() => pick(a.fileName)}
                onContextMenu={(e) => openMenu(e, a.fileName, a.fields.name ?? "")}
                className={`flex h-row cursor-default items-center gap-2 px-3 ${
                  isSelected
                    ? "bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
                    : "hover:bg-[var(--surface-hover)]"
                }`}
                title={rowTitle(a)}
              >
                <span className="flex-none" style={{ color: "var(--role-agent)" }}>
                  <AgentAvatar seed={seedFor(meta, a.fileName)} size={11} />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    isSelected ? "text-accent-text" : "text-content-secondary"
                  }`}
                >
                  {a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName}
                </span>
                {m.nickname !== "" && (
                  <span className="flex-none truncate font-mono text-2xs text-content-disabled">
                    “{m.nickname}”
                  </span>
                )}
                {node === undefined && (
                  <span
                    className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted"
                    title="Not on the graph — right-click to adopt"
                  >
                    off-graph
                  </span>
                )}
              </div>
              {armed === a.fileName && (
                <ConfirmStrip
                  label={
                    // WO11 §10 amendment — a landing agentDeleteListeners seam
                    // (UI-D produces, UI-C consumes deleteNodes) means deleting
                    // an on-graph agent now takes its node, edges, selection
                    // and assemble state with it. This confirm must say so
                    // truthfully; an off-graph agent has no node to mention.
                    node !== undefined
                      ? `Delete .claude/agents/${a.fileName}? Its node on the graph goes too.`
                      : `Delete .claude/agents/${a.fileName}?`
                  }
                  onConfirm={() => {
                    setArmed(null);
                    select({ kind: "agent", key: a.fileName });
                    void useAgentsStore.getState().deleteSelected();
                  }}
                  onCancel={() => setArmed(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {menu.menu !== null && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} items={menu.menu.items} onClose={menu.close} />
      )}
    </div>
  );
}

export function SkillsRailSection({ root }: { root: string }) {
  const skills = useAgentsStore((s) => s.skills);
  const agentsSel = useAgentsStore((s) => s.selection);
  const select = useAgentsStore((s) => s.select);
  const setBuiltinInclude = useAgentsStore((s) => s.setBuiltinInclude);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const setSelection = useGraphStore((s) => s.setSelection);
  const builtins = useBuiltinSkillStates();
  const project = projectSkills(skills);
  const virtualCount = builtins.filter((b) => b.state === "virtual").length;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const menu = useContextMenu();

  const pickSkill = (dirName: string) => {
    // Graph selection first — see the note in the agents section's `pick`.
    setSelection([], []);
    select({ kind: "skill", key: dirName });
  };

  /** D-4/D-5 — the ONE write in this file, and it happens after an armed
   *  confirm strip, never on a click. `skills_materialize` is create-or-
   *  replace by design: reset IS the overwrite path. */
  const doReset = (id: string, content: string) => {
    setResetArmed(null);
    setResetError(null);
    // An include toggle flipped in the last 700 ms is still on the sidecar
    // debounce; flush it so the file on disk agrees with the toggle that is
    // on screen while this write runs.
    flushMetaSave();
    void skillsMaterialize(root, [{ id, content }])
      // A-21 — `reloadSkills`, never `loadAgents`: the latter is a
      // project-open reset that drops every unsaved skill draft, the rail
      // selection and the agent autosave timers. Resetting ONE skill to its
      // bundled copy must not take the editor's unsaved work with it.
      .then(() => useAgentsStore.getState().reloadSkills(root))
      .catch((e: unknown) => setResetError(String(e)));
  };

  const openMenu = (e: React.MouseEvent, dirName: string, resetContent: string | null) => {
    const items: MenuItem[] = [
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () =>
          void revealPath(root, `.claude/skills/${dirName}/SKILL.md`).catch((e: unknown) =>
            pushToast({
              severity: "warning",
              title: "Could not reveal in File Explorer",
              detail: String(e),
            }),
          ),
      },
      ...(resetContent !== null
        ? [
            {
              kind: "item" as const,
              id: "reset",
              label: "Reset to built-in…",
              icon: RotateCcw,
              onSelect: () => setResetArmed(dirName),
            },
          ]
        : []),
      { kind: "separator", id: "sep" },
      {
        kind: "item",
        id: "delete",
        label: "Delete skill…",
        icon: Trash2,
        danger: true,
        onSelect: () => setArmed(dirName),
      },
    ];
    menu.openAt(e, items);
  };

  const rowClass = (isSelected: boolean) =>
    `flex h-row cursor-default items-center gap-2 px-3 ${
      isSelected
        ? "bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
        : "hover:bg-[var(--surface-hover)]"
    }`;

  return (
    <div className="flex-none">
      <SectionHeader
        label="Skills"
        // Files, not rows (audit NIT). A `virtual` built-in has no
        // directory in `.claude/skills/` yet, so counting it here claimed a
        // file that a Reveal or a `ls` would not find. `project` already
        // holds every on-disk skill except the built-ins that are byte-
        // identical to the bundle, which is what the second term adds; a
        // `modified` built-in is in `project`, counted once.
        count={project.length + builtins.filter((b) => b.state === "materialized").length}
        note={virtualCount > 0 ? `${virtualCount} built-in` : undefined}
        title={
          virtualCount > 0
            ? "Count is the skills on disk in .claude/skills/ — built-in skills are bundled with Cowtext until a Compile writes them"
            : "Skills on disk in .claude/skills/"
        }
        onCreate={() => setDialogOpen(true)}
      />
      {dialogOpen && <NewSkillDialog onClose={() => setDialogOpen(false)} />}
      {resetError !== null && (
        <p className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-1 font-mono text-micro text-danger-text">
          {resetError}
        </p>
      )}
      <ul className="py-1">
        {/* Built-in — what Cowtext ships. Present on day one, in a project
            whose .claude/skills/ does not exist yet (Block 4). */}
        <GroupLabel label="Built-in" />
        {builtins.map((b) => {
          const isSelected =
            agentsSel?.kind === "skill" && agentsSel.key === b.id && selectedNodeIds.length === 0;
          // A `modified` built-in is listed under Project (D-5) — it is the
          // user's file now.
          if (b.state === "modified") return null;
          const virtual = b.state === "virtual";
          return (
            <li key={`builtin:${b.id}`}>
              <div
                onClick={() => (virtual ? setExpanded((c) => (c === b.id ? null : b.id)) : pickSkill(b.id))}
                className={rowClass(isSelected)}
                title={
                  virtual
                    ? `${b.description} — bundled with Cowtext; nothing on disk until a Compile writes it`
                    : `.claude/skills/${b.id}/SKILL.md`
                }
              >
                <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    isSelected ? "text-accent-text" : "text-content-secondary"
                  }`}
                >
                  {b.name}
                </span>
                {!virtual && <RowBadge label="materialized" title="On disk and identical to the bundled version" />}
                <IncludeToggle
                  checked={b.include}
                  label="Include in compile"
                  onChange={(v) => setBuiltinInclude(b.id, v)}
                />
              </div>
              {virtual && expanded === b.id && <BuiltinSkillReadOnly id={b.id} content={b.content} />}
            </li>
          );
        })}

        {/* Project — the .claude/skills/ this repo actually has. */}
        <GroupLabel label="Project" />
        {project.length === 0 && (
          <li className="px-3 py-1 text-2xs text-content-muted">No skills in .claude/skills/</li>
        )}
        {project.map((sk) => {
          const isSelected =
            agentsSel?.kind === "skill" && agentsSel.key === sk.dirName && selectedNodeIds.length === 0;
          const fromBuiltin = builtins.find((b) => b.id === sk.dirName && b.state === "modified") ?? null;
          return (
            <li key={`project:${sk.dirName}`}>
              <div
                onClick={() => pickSkill(sk.dirName)}
                onContextMenu={(e) => openMenu(e, sk.dirName, fromBuiltin?.content ?? null)}
                className={rowClass(isSelected)}
                title={`.claude/skills/${sk.dirName}/SKILL.md`}
              >
                <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    isSelected ? "text-accent-text" : "text-content-secondary"
                  }`}
                >
                  {sk.dirName}
                </span>
                {fromBuiltin !== null && (
                  <RowBadge
                    label="modified from built-in"
                    title="Edited copy of a built-in — right-click to reset it to the bundled version"
                  />
                )}
                {sk.extraFileCount > 0 && (
                  <span className="flex-none font-mono text-2xs text-content-disabled">
                    +{sk.extraFileCount}
                  </span>
                )}
              </div>
              {resetArmed === sk.dirName && fromBuiltin !== null && (
                <ConfirmStrip
                  label={`Overwrite .claude/skills/${sk.dirName}/SKILL.md with the bundled version?`}
                  confirmLabel="overwrite"
                  onConfirm={() => doReset(sk.dirName, fromBuiltin.content)}
                  onCancel={() => setResetArmed(null)}
                />
              )}
              {armed === sk.dirName && (
                <ConfirmStrip
                  label={`Delete .claude/skills/${sk.dirName}/ (${sk.extraFileCount} extra file${sk.extraFileCount === 1 ? "" : "s"})?`}
                  onConfirm={() => {
                    setArmed(null);
                    select({ kind: "skill", key: sk.dirName });
                    void useAgentsStore.getState().deleteSelected();
                  }}
                  onCancel={() => setArmed(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {menu.menu !== null && (
        <ContextMenu x={menu.menu.x} y={menu.menu.y} items={menu.menu.items} onClose={menu.close} />
      )}
    </div>
  );
}
