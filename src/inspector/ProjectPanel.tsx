// WO11 G3 — project properties in the Inspector, reached by selecting the
// project row in the Hierarchy (App.tsx, UI-B — that store wiring is not
// this lane's file). Marty's ratified split (§5.4): identity and scaffold
// are read-only here (the wizard owns them); the six description fields are
// editable, committed on blur (not per keystroke — `project_meta_write`
// rewrites `context/project.md` whenever it exists, a user-owned Memory
// Node, so a per-keystroke write would thrash a file the user can see and
// edit themselves).
import { useEffect, useState, type ReactNode } from "react";
import { Folder, FolderOpen, GitBranch, ListChecks, RefreshCw, ShieldAlert } from "lucide-react";
import { InspectorSection } from "./InspectorSection";
import { PROJECT_ORDER, SectionStack, type ProjectSectionKey } from "./sectionOrder";
import { useProjectStore } from "../store/project";
import { revealPath } from "../fs/api";
import { projectMetaRead, projectMetaWrite } from "../project/api";
import { linesToList, listToLines, PROJECT_BRIEF_MAX, PROJECT_TYPES, type ProjectMeta } from "../project/types";
import { sameRelPath } from "../store/graph";
// WO11 §4.1/§6 — R1's frozen seam (git / avatar / memory invokes: UI-C is a
// named consumer). `src/git/api.ts` and `src/git/types.ts` are R1's files
// and had not landed at the time this lane wrote against them; the import
// is expected to resolve once R1's pass completes (contract's own ordering
// note: "R1+R2 before the call sites go green ... the build is only
// required green at integration").
import { gitStatus } from "../git/api";
import type { GitStatus } from "../git/types";

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

/** Read-only "well" — deliberately NOT a disabled `<input>`: a disabled
 *  control still looks like a control (border, focus-shaped box) and invites
 *  a click the app has to reject. This is inert text with the same visual
 *  language `FileField`'s protected-file rendering already uses. */
function ReadOnlyField({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        title={title ?? value}
        className="truncate rounded border border-border-subtle bg-surface-inset px-2 py-1.5 text-sm text-content-secondary"
      >
        {value === "" ? <span className="text-content-disabled">—</span> : value}
      </div>
    </div>
  );
}

/** Raw-text-owns-the-model textarea for a string[] field, committed on blur
 *  only. Mirrors ProjectWizard's frozen ListField fix (WO11 §2.1 A3) even
 *  though the controlled-per-keystroke bug that fix addresses can't occur
 *  here (this field only reserializes on blur, never on change) — same
 *  local-raw-state shape so a future edit that adds live validation doesn't
 *  reintroduce it by accident. */
function EditableListField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: readonly string[];
  onCommit: (next: string[]) => void;
}) {
  const [raw, setRaw] = useState(() => listToLines(value));

  useEffect(() => {
    setRaw(listToLines(value));
    // Reseed only when the persisted value's identity changes (selection
    // change, external write) — never mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join("\n")]);

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => onCommit(linesToList(raw))}
        rows={3}
        placeholder="One per line"
        className="min-h-[54px] max-h-[40vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content placeholder:text-content-disabled focus:border-accent"
      />
    </div>
  );
}

function EditableTextField({
  label,
  value,
  onCommit,
  maxLen,
  multiline,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  maxLen?: number;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const clamp = (v: string) => (maxLen !== undefined ? v.slice(0, maxLen) : v);
  const near = maxLen !== undefined && draft.length >= maxLen * 0.9;

  const shared = {
    value: draft,
    onBlur: () => onCommit(draft),
    className:
      "w-full rounded border border-border bg-surface-2 px-2 text-sm leading-snug text-content placeholder:text-content-disabled focus:border-accent",
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        {maxLen !== undefined && (
          <span className={`font-mono text-2xs ${near ? "text-amber-text" : "text-content-muted"}`}>
            {draft.length} / {maxLen}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea
          {...shared}
          onChange={(e) => setDraft(clamp(e.target.value))}
          rows={3}
          className={`min-h-[54px] max-h-[40vh] resize-y py-1.5 ${shared.className}`}
        />
      ) : (
        <input
          {...shared}
          onChange={(e) => setDraft(clamp(e.target.value))}
          className={`h-control ${shared.className}`}
        />
      )}
    </div>
  );
}

export function ProjectPanel({ root, onOpenGit }: { root: string; onOpenGit: () => void }) {
  const files = useProjectStore((s) => s.files);
  const [meta, setMeta] = useState<ProjectMeta | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setMeta(undefined);
    setLoadError(null);
    projectMetaRead(root)
      .then((m) => {
        if (live) setMeta(m);
      })
      .catch((e: unknown) => {
        if (live) setLoadError(String(e));
      });
    setGit(null);
    setGitError(null);
    gitStatus(root)
      .then((g) => {
        if (live) setGit(g);
      })
      .catch((e: unknown) => {
        if (live) setGitError(String(e));
      });
    return () => {
      live = false;
    };
  }, [root]);

  const commit = (patch: Partial<ProjectMeta>) => {
    if (meta === null || meta === undefined) return;
    const next: ProjectMeta = { ...meta, ...patch };
    setMeta(next);
    setSaveError(null);
    projectMetaWrite(root, next)
      .then(() => void useProjectStore.getState().rescan())
      .catch((e: unknown) => setSaveError(String(e)));
  };

  const projectMdExists = files.some((f) => sameRelPath(f.relPath, "context/project.md"));
  const typeLabel = PROJECT_TYPES.find((t) => t.key === meta?.projectType)?.label ?? meta?.projectType ?? "";

  const sections: Partial<Record<ProjectSectionKey, ReactNode>> = {
    "project.identity": (
      <InspectorSection sectionKey="project.identity" title="Identity" icon={Folder}>
        {meta === undefined ? (
          <p className="text-sm text-content-muted">Reading…</p>
        ) : (
          <>
            <ReadOnlyField label="Name" value={meta?.name ?? ""} />
            <ReadOnlyField label="Type" value={typeLabel} />
            <ReadOnlyField label="Root" value={root} />
            <ReadOnlyField
              label=".cowtext/project.json"
              value={meta === null ? "not found" : "found"}
            />
            <ReadOnlyField
              label="context/project.md"
              value={projectMdExists ? "found" : "not found"}
            />
            <p className="text-xs leading-snug text-content-muted">
              Edit in the project wizard.
            </p>
            {loadError !== null && (
              <p className="break-words font-mono text-xs text-danger-text">{loadError}</p>
            )}
          </>
        )}
      </InspectorSection>
    ),
    "project.actions": (
      <InspectorSection sectionKey="project.actions" title="Actions" icon={RefreshCw}>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setRevealError(null);
              void revealPath(root, null).catch((e: unknown) => setRevealError(String(e)));
            }}
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            <FolderOpen size={13} strokeWidth={1.5} />
            Reveal in File Explorer
          </button>
          <button
            onClick={() => void useProjectStore.getState().rescan()}
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            <RefreshCw size={13} strokeWidth={1.5} />
            Rescan
          </button>
        </div>
        {revealError !== null && (
          <p className="break-words font-mono text-xs text-danger-text">{revealError}</p>
        )}
      </InspectorSection>
    ),
    "project.git": (
      <InspectorSection
        sectionKey="project.git"
        title="Git"
        icon={GitBranch}
        hint={git?.branch ?? undefined}
      >
        {gitError !== null ? (
          <p className="break-words font-mono text-xs text-danger-text">{gitError}</p>
        ) : git === null ? (
          <p className="text-sm text-content-muted">Reading…</p>
        ) : !git.gitAvailable ? (
          <p className="text-xs leading-snug text-content-muted">
            git is not on PATH — nothing to report.
          </p>
        ) : (
          <>
            <ReadOnlyField label="Repository" value={git.isRepo ? "initialized" : "not initialized"} />
            {git.isRepo && (
              <>
                <ReadOnlyField label="Branch" value={git.branch ?? "(detached)"} />
                <ReadOnlyField label="Commits" value={git.hasCommits ? "yes" : "none yet"} />
              </>
            )}
            <button
              onClick={onOpenGit}
              className="flex h-control items-center gap-1.5 self-start rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
            >
              <GitBranch size={13} strokeWidth={1.5} />
              {git.isRepo ? "Manage .gitignore…" : "Initialize repository…"}
            </button>
          </>
        )}
      </InspectorSection>
    ),
  };

  if (meta !== null && meta !== undefined) {
    sections["project.description"] = (
      <InspectorSection sectionKey="project.description" title="Description" icon={Folder}>
        <EditableTextField
          label="Brief"
          value={meta.brief}
          maxLen={PROJECT_BRIEF_MAX}
          multiline
          onCommit={(v) => commit({ brief: v })}
        />
        <EditableTextField
          label="Target audience"
          value={meta.targetAudience}
          onCommit={(v) => commit({ targetAudience: v })}
        />
        <EditableTextField
          label="Architecture"
          value={meta.architecture}
          multiline
          onCommit={(v) => commit({ architecture: v })}
        />
      </InspectorSection>
    );
    sections["project.requirements"] = (
      <InspectorSection sectionKey="project.requirements" title="Requirements" icon={ListChecks}>
        <EditableListField
          label="Requirements"
          value={meta.requirements}
          onCommit={(v) => commit({ requirements: v })}
        />
      </InspectorSection>
    );
    sections["project.rules"] = (
      <InspectorSection sectionKey="project.rules" title="Rules & constraints" icon={ShieldAlert}>
        <EditableListField
          label="Hard rules"
          value={meta.hardRules}
          onCommit={(v) => commit({ hardRules: v })}
        />
        <EditableListField
          label="Constraints"
          value={meta.constraints}
          onCommit={(v) => commit({ constraints: v })}
        />
      </InspectorSection>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex h-[30px] flex-none items-center gap-2 border-b border-border-subtle bg-accent-surface px-3 shadow-[inset_2px_0_0_var(--accent)]">
        <Folder size={12} strokeWidth={1.5} className="flex-none text-content-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
          {meta?.name !== undefined && meta.name !== "" ? meta.name : "Project"}
        </span>
      </div>
      {saveError !== null && (
        <p className="flex-none border-b border-border-subtle bg-danger-surface px-3 py-1 font-mono text-2xs text-danger-text">
          {saveError}
        </p>
      )}
      {meta === null && (
        <p className="flex-none border-b border-border-subtle px-3 py-2 text-xs leading-snug text-content-muted">
          No project properties file yet — create one from the project wizard's Edit mode.
        </p>
      )}
      <SectionStack order={PROJECT_ORDER} sections={sections} />
    </div>
  );
}
