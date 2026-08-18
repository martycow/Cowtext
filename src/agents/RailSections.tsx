// Left-rail AGENTS and SKILLS sections (Marty 2026-08-18: agents live in the
// panels, not a modal). Rows select: an adopted agent selects its graph node
// (Inspector shows the agent editor), an un-adopted one selects in the agents
// store only (Inspector shows the standalone editor). Deletes are armed
// inline — first click arms a confirm strip, nothing is destructive in one
// click.

import { useState } from "react";
import { FolderOpen, Plus, Trash2, Workflow } from "lucide-react";
import { useAgentsStore, metaOrDefault, seedFor, type Selection } from "../store/agents";
import { useGraphStore } from "../store/graph";
import { revealPath } from "../fs/api";
import { AgentAvatar } from "./AgentAvatar";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";

function SectionHeader({
  label,
  count,
  onCreate,
}: {
  label: string;
  count: number;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-[26px] flex-none items-center gap-1.5 border-b border-t border-border-subtle bg-surface-1 px-3">
      <span className="min-w-0 flex-1 truncate font-mono text-2xs uppercase tracking-wider text-content-muted">
        {label} ({count})
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

function CreateInput({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="border-b border-border-subtle px-3 py-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && name.trim() !== "") {
            void onSubmit(name.trim()).then((err) => {
              if (err === null) onCancel();
              else setError(err);
            });
          }
        }}
        className="h-control-sm w-full rounded border border-border bg-surface-2 px-2 text-xs text-content placeholder:text-content-disabled focus:border-accent"
      />
      {error !== null && (
        <p className="mt-1 break-words font-mono text-2xs text-danger-text">{error}</p>
      )}
    </div>
  );
}

function ConfirmStrip({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-danger bg-danger-surface px-3 py-1">
      <span className="min-w-0 flex-1 truncate text-2xs text-danger-text">{label}</span>
      <button
        onClick={onConfirm}
        className="h-[18px] flex-none rounded-sm border border-danger px-1.5 font-mono text-micro text-danger-text transition-colors duration-fast hover:bg-danger hover:text-content-inverse"
      >
        delete
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
  const createAgent = useAgentsStore((s) => s.createAgent);
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const setSelection = useGraphStore((s) => s.setSelection);
  const adoptFile = useGraphStore((s) => s.adoptFile);
  const [creating, setCreating] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const menu = useContextMenu();

  const nodeFor = (fileName: string) =>
    nodes.find((n) => n.filePath === `.claude/agents/${fileName}`);

  const pick = (fileName: string) => {
    const sel: Selection = { kind: "agent", key: fileName };
    select(sel);
    const node = nodeFor(fileName);
    // Adopted agent → drive the normal three-way selection sync; otherwise
    // clear the graph selection so the Inspector shows the standalone editor.
    setSelection(node !== undefined ? [node.id] : [], []);
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
        onSelect: () => void revealPath(root, `.claude/agents/${fileName}`).catch(() => undefined),
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
      <SectionHeader label="Agents" count={agents.length} onCreate={() => setCreating(true)} />
      {creating && (
        <CreateInput
          placeholder="new agent name…"
          onSubmit={createAgent}
          onCancel={() => setCreating(false)}
        />
      )}
      <ul className="py-1">
        {agents.length === 0 && !creating && (
          <li className="px-3 py-1 text-2xs text-content-muted">No agents in .claude/agents/</li>
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
                title={`.claude/agents/${a.fileName}`}
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
                  label={`Delete .claude/agents/${a.fileName}?`}
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
  const createSkill = useAgentsStore((s) => s.createSkill);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const setSelection = useGraphStore((s) => s.setSelection);
  const [creating, setCreating] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const menu = useContextMenu();

  const openMenu = (e: React.MouseEvent, dirName: string) => {
    const items: MenuItem[] = [
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () =>
          void revealPath(root, `.claude/skills/${dirName}/SKILL.md`).catch(() => undefined),
      },
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

  return (
    <div className="flex-none">
      <SectionHeader label="Skills" count={skills.length} onCreate={() => setCreating(true)} />
      {creating && (
        <CreateInput
          placeholder="new skill name…"
          onSubmit={createSkill}
          onCancel={() => setCreating(false)}
        />
      )}
      <ul className="py-1">
        {skills.length === 0 && !creating && (
          <li className="px-3 py-1 text-2xs text-content-muted">No skills in .claude/skills/</li>
        )}
        {skills.map((sk) => {
          const isSelected =
            agentsSel?.kind === "skill" && agentsSel.key === sk.dirName && selectedNodeIds.length === 0;
          return (
            <li key={sk.dirName}>
              <div
                onClick={() => {
                  select({ kind: "skill", key: sk.dirName });
                  setSelection([], []);
                }}
                onContextMenu={(e) => openMenu(e, sk.dirName)}
                className={`flex h-row cursor-default items-center gap-2 px-3 ${
                  isSelected
                    ? "bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]"
                    : "hover:bg-[var(--surface-hover)]"
                }`}
                title={`.claude/skills/${sk.dirName}/SKILL.md`}
              >
                <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    isSelected ? "text-accent-text" : "text-content-secondary"
                  }`}
                >
                  {sk.dirName}
                </span>
                {sk.extraFileCount > 0 && (
                  <span className="flex-none font-mono text-2xs text-content-disabled">
                    +{sk.extraFileCount}
                  </span>
                )}
              </div>
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
