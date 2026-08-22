// New Skill dialog (contract Rev 2, R5) — replaces the rail's inline
// create-input for skills. Creates the dir via `createSkill`, patches the
// draft's description/body and saves it.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAgentsStore, type Selection } from "../store/agents";
import { FieldLabel } from "../agents/AgentEditor";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content";

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

const PRIMARY_BTN =
  "flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled";

export function NewSkillDialog({ onClose }: { onClose: () => void }) {
  const createSkill = useAgentsStore((s) => s.createSkill);
  const updateDraft = useAgentsStore((s) => s.updateDraft);
  const saveDoc = useAgentsStore((s) => s.saveDoc);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
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

  const canSubmit = name.trim() !== "" && !busy;

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      const err = await createSkill(name.trim());
      if (err !== null) throw new Error(err);
      const sel = useAgentsStore.getState().selection;
      if (sel === null || sel.kind !== "skill") return;
      const dirName = sel.key;
      const doc = useAgentsStore.getState().skills.find((s) => s.dirName === dirName);
      if (doc !== undefined) {
        const patchedSel: Selection = { kind: "skill", key: dirName };
        updateDraft(patchedSel, { fields: { ...doc.fields, description }, body });
        const saveErr = await saveDoc(patchedSel);
        if (saveErr !== null) throw new Error(saveErr);
      }
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
        aria-label="New skill"
        tabIndex={-1}
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">New skill</span>
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
          {/* WO15 A-18: the "Use the built-in task-format skill" prefill
              button lived here. Built-ins are no longer a prefill for a
              hand-written skill — they are their own group in the Skills
              rail, virtual until a compile materialises them (Block 4), so
              copying one into a new dir was a second, divergent copy of a
              file Cowtext already ships. */}
          <div>
            <FieldLabel>Name</FieldLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
            />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="min-h-[40px] max-h-[30vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content focus:border-accent"
            />
          </div>
          <div>
            <FieldLabel>Body</FieldLabel>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Markdown body"
              className="min-h-[120px] max-h-[50vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs leading-relaxed text-content placeholder:text-content-disabled focus:border-accent"
            />
          </div>
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            Creates .claude/skills/&lt;name&gt;/SKILL.md.
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
