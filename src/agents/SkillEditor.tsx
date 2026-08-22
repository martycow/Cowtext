// Right pane of AgentsModal for a skill selection (contract §7.3). Name +
// description + body editor, Rename, Delete (the destructive confirmation
// itself — naming extraFiles/extraFileCount — lives in AgentsModal, which
// owns every confirm phase; this component only requests it), and the
// "used by" agent list.

import { useEffect, useRef, useState } from "react";
import {
  draftKey,
  isDirty,
  useAgentsStore,
  usedBy,
  type Selection,
} from "../store/agents";
import type { SkillDoc } from "./types";
import { CodeMirrorEditor } from "../inspector/CodeMirrorEditor";

const SAVE_BTN =
  "h-control-sm flex-none rounded bg-accent px-3 text-xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled";

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

/** Block 4 — the read-only half of this editor: a built-in that is still
 *  VIRTUAL has no file, no draft and nothing to save, so it gets the text
 *  and nothing else.
 *
 *  Deviation, flagged: this renders from the Skills rail rather than the
 *  Inspector. `Inspector.tsx:1279-1280` resolves a skill selection with
 *  `skills.find(...)` and returns `null` when there is no on-disk doc — a
 *  virtual built-in can never reach `SkillEditor` through it, and
 *  `Inspector.tsx` belongs to another lane this round. The view lives here,
 *  where the contract asks for it; only its mount point moved. */
export function BuiltinSkillReadOnly({ id, content }: { id: string; content: string }) {
  return (
    <div className="border-y border-border-subtle bg-surface-inset px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-content-muted">
          .claude/skills/{id}/SKILL.md
        </span>
        <span className="flex-none rounded-sm border border-border px-1 font-mono text-micro text-content-muted">
          not on disk
        </span>
      </div>
      <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap font-mono text-micro leading-relaxed text-content-secondary">
        {content}
      </pre>
      <p className="mt-1 text-2xs leading-snug text-content-muted">
        Bundled with Cowtext and read-only here. Include it in compile and approve the diff to
        write it — after that it is an ordinary project file you can edit.
      </p>
    </div>
  );
}

export function SkillEditor({
  doc,
  disabled,
  onRequestDelete,
  onSave,
}: {
  doc: SkillDoc;
  disabled: boolean;
  onRequestDelete: () => void;
  /** Routes through AgentsModal's phase machine (busy lock) so a row switch
   *  mid-save can't raise a confirmDiscard sheet for this doc — see contract
   *  §7.3 and AgentsModal's `doSave`. */
  onSave: () => Promise<string | null>;
}) {
  const sel: Selection = { kind: "skill", key: doc.dirName };
  const rawDraft = useAgentsStore((s) => s.drafts[draftKey(sel)]);
  const agents = useAgentsStore((s) => s.agents);
  const dirty = useAgentsStore((s) => isDirty(s, sel));
  const updateDraft = useAgentsStore((s) => s.updateDraft);
  const renameSelected = useAgentsStore((s) => s.renameSelected);

  const displayName = doc.fields.name !== null && doc.fields.name !== "" ? doc.fields.name : doc.dirName;

  const [nameDraft, setNameDraft] = useState(displayName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const prevContent = useRef(doc.content);

  useEffect(() => {
    setNameDraft(displayName);
    setRenameError(null);
    setSaveError(null);
    setGen((g) => g + 1);
  }, [doc.dirName, displayName]);

  useEffect(() => {
    if (doc.content !== prevContent.current) {
      prevContent.current = doc.content;
      setGen((g) => g + 1);
    }
  }, [doc.content]);

  // No draft exists until the first edit (store lazily creates one on
  // updateDraft) — fall back to the saved doc so a freshly-selected,
  // untouched skill still renders its real content.
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

  const doSave = () => {
    setSaveError(null);
    void onSave().then((err) => {
      if (err !== null) setSaveError(err);
    });
  };

  const members = usedBy(agents, displayName);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <FieldLabel>Name</FieldLabel>
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
        {renameError !== null && <p className="mt-1 text-xs text-danger-text">{renameError}</p>}
        <p className="mt-1 font-mono text-2xs text-content-muted">{doc.dirName}/SKILL.md</p>
      </div>

      {doc.raw ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {doc.parseError !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {doc.parseError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-content-muted">
              This file must be edited as raw text.
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
              docKey={`${doc.dirName}:${gen}`}
              value={draft.rawContent}
              onChange={(v) => updateDraft(sel, { rawContent: v })}
              onSave={doSave}
            />
          </div>
        </div>
      ) : (
        <>
          <div>
            <FieldLabel>Description</FieldLabel>
            <input
              value={draft.fields.description ?? ""}
              disabled={disabled}
              onChange={(e) =>
                updateDraft(sel, { fields: { ...draft.fields, description: e.target.value } })
              }
              className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <FieldLabel>Body</FieldLabel>
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
            <div className="h-[320px] min-h-0 rounded border border-border-subtle bg-surface-inset">
              <CodeMirrorEditor
                docKey={`${doc.dirName}:${gen}`}
                value={draft.body}
                onChange={(v) => updateDraft(sel, { body: v })}
                onSave={doSave}
              />
            </div>
          </div>
        </>
      )}

      <div>
        <FieldLabel>Used by</FieldLabel>
        {members.length === 0 ? (
          <p className="text-xs text-content-muted">No agent has attached this skill.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 rounded border border-border-subtle bg-surface-inset p-1.5">
            {members.map((fileName) => (
              <li
                key={fileName}
                className="flex h-[22px] items-center px-1 font-mono text-xs text-content-secondary"
              >
                {fileName}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border-subtle pt-3">
        <button
          onClick={onRequestDelete}
          disabled={disabled}
          className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface disabled:text-content-disabled"
        >
          Delete skill
        </button>
      </div>
    </div>
  );
}
