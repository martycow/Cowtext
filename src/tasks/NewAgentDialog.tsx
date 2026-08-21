// New Agent dialog (contract Rev 2, R5) — replaces the rail's inline
// create-input. Creates the file via `createAgent`, patches the draft with
// the chosen fields/duties and saves it, then writes priority/influence/
// nickname to the sidecar via `updateMeta` (debounced autosave, same as the
// rest of the agent editor).

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAgentsStore, type Selection } from "../store/agents";
import { FieldLabel, ModelPicker, Stepper } from "../agents/AgentEditor";
import {
  CAPABILITIES,
  applyCapability,
  capabilityState,
  type Capability,
} from "../agents/toolCatalog";
import { normalizeFileName, slugForFile } from "../wizard/paths";

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

// WO10 item 11 — a tool list used to be declared here, and disagreed with
// the free-text Tools field the editor offered afterwards. WO12 — both now
// present the same CAPABILITY rows from agents/toolCatalog.ts, so creating
// and editing an agent ask the user the same question.

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const createAgent = useAgentsStore((s) => s.createAgent);
  const updateDraft = useAgentsStore((s) => s.updateDraft);
  const saveDoc = useAgentsStore((s) => s.saveDoc);
  const updateMeta = useAgentsStore((s) => s.updateMeta);
  const skills = useAgentsStore((s) => s.skills);
  const agents = useAgentsStore((s) => s.agents);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [description, setDescription] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [withMemory, setWithMemory] = useState(true);
  const [model, setModel] = useState<string | null>("sonnet");
  const [priority, setPriority] = useState(3);
  const [influence, setInfluence] = useState(50);
  const [tools, setTools] = useState<string[]>([]);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [duties, setDuties] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  // WO12 — capability-shaped, matching the editor's ToolPicker. A new agent
  // starts with an empty list, so every row is cleanly "none" or "all" here;
  // the tri-state still routes through applyCapability so creation and
  // editing share one writer rather than two that can drift.
  const toggleCapability = (cap: Capability) => {
    setTools((cur) => applyCapability(cur, cap, capabilityState(cur, cap) !== "all"));
  };

  const toggleSkill = (name_: string) => {
    setSkillNames((cur) => (cur.includes(name_) ? cur.filter((x) => x !== name_) : [...cur, name_]));
  };

  const canSubmit = name.trim() !== "" && !collision && !busy;

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      const err = await createAgent(name.trim(), { fileName: normalizedFileName, withMemory });
      if (err !== null) throw new Error(err);
      const sel = useAgentsStore.getState().selection;
      if (sel === null || sel.kind !== "agent") return;
      const createdFileName = sel.key;
      const doc = useAgentsStore.getState().agents.find((a) => a.fileName === createdFileName);
      if (doc !== undefined) {
        const patchedSel: Selection = { kind: "agent", key: createdFileName };
        updateDraft(patchedSel, {
          fields: { ...doc.fields, description: description.trim() === "" ? null : description.trim(), model, tools, skills: skillNames },
          body: duties,
        });
        const saveErr = await saveDoc(patchedSel);
        if (saveErr !== null) throw new Error(saveErr);
      }
      updateMeta(createdFileName, { nickname, priority, influence });
    })()
      .then(onClose)
      .catch((e: unknown) => {
        setBusy(false);
        setError(String(e));
      });
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New agent"
        tabIndex={-1}
        className="flex max-h-[85vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">New agent</span>
          <div className="min-w-0 flex-1" />
          <button onClick={onClose} title="Close" className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {error !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Name</FieldLabel>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
              />
            </div>
            <div>
              <FieldLabel>Nickname</FieldLabel>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 40))}
                placeholder="optional"
                className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent"
              />
            </div>
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="optional — one line, shown in the frontmatter"
              className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent"
            />
          </div>
          <div>
            <FieldLabel>File</FieldLabel>
            <input
              value={fileName}
              onChange={(e) => {
                setFileNameTouched(true);
                setFileName(e.target.value);
              }}
              placeholder="agent.md"
              className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content focus:border-accent"
            />
            <p className="mt-1 font-mono text-2xs text-content-muted">
              .claude/agents/{normalizedFileName}
            </p>
            {collision && (
              <p className="mt-1 text-xs leading-snug text-danger-text">
                An agent file named {normalizedFileName} already exists — choose a different name.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border-subtle pt-3">
            <div>
              <FieldLabel>Memory folder</FieldLabel>
              <p className="font-mono text-2xs text-content-muted">
                .claude/agent-memory/{memoryStem}/
              </p>
            </div>
            <AmberToggle checked={withMemory} onChange={setWithMemory} />
          </div>
          <div>
            <FieldLabel>Model</FieldLabel>
            <ModelPicker value={model} disabled={false} onChange={setModel} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Priority</FieldLabel>
              <Stepper value={priority} min={1} max={5} disabled={false} onChange={setPriority} />
            </div>
            <div>
              <FieldLabel>Influence</FieldLabel>
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
            </div>
          </div>
          <div>
            <FieldLabel>Tools</FieldLabel>
            <div className="flex flex-col gap-0.5 rounded border border-border-subtle bg-surface-inset p-1.5">
              {CAPABILITIES.map((cap) => {
                const state = capabilityState(tools, cap);
                return (
                  <label
                    key={cap.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 transition-colors duration-instant hover:bg-[var(--surface-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={state === "all"}
                      ref={(el) => {
                        // Native indeterminate is a DOM property, not an
                        // attribute — React cannot set it via JSX.
                        if (el !== null) el.indeterminate = state === "some";
                      }}
                      onChange={() => toggleCapability(cap)}
                      className="h-3 w-3 flex-none accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-content">{cap.label}</span>
                      <span className="block truncate text-micro leading-snug text-content-disabled">
                        {cap.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="pt-1 text-micro leading-snug text-content-muted">
              Leave all unticked to inherit every tool. Exact tool names are
              editable in the Inspector afterwards.
            </p>
          </div>
          {skills.length > 0 && (
            <div>
              <FieldLabel>Skills</FieldLabel>
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
          <div>
            <FieldLabel>Duties</FieldLabel>
            <textarea
              value={duties}
              onChange={(e) => setDuties(e.target.value)}
              rows={6}
              placeholder="Markdown body — what this agent does"
              className="min-h-[100px] max-h-[40vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs leading-relaxed text-content placeholder:text-content-disabled focus:border-accent"
            />
          </div>
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            Creates .claude/agents/&lt;name&gt;.md.
          </span>
          <button ref={cancelRef} onClick={onClose} disabled={busy} className={SECONDARY_BTN}>
            Cancel
          </button>
          <button onClick={submit} disabled={!canSubmit} className={PRIMARY_BTN}>
            {busy ? "· · ·" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
