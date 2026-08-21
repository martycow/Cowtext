// New / Convert project wizard (INPUT_PROMPT 08/19 items 7-10, WO10 Lane 6).
//
// The title screen used to offer exactly one door: "Open folder". That is
// fine for a project Cowtext already knows, and useless for the two cases a
// new user is actually in — an empty directory, or an existing repo full of
// hand-written `CLAUDE.md` / `.cursor/rules` that ought to become a graph.
// Both doors are this component, because they differ in two steps out of
// three: pick a folder, describe the project, then either scaffold it or
// scaffold it AND hand off to the importer.
//
// Deliberately NOT included: a starter-pack picker. Presets already have a
// full modal reachable from the top bar once a project is open, and a second
// preset UI here would be a second thing to keep correct for no new
// capability. The done screen points at it instead.
//
// Deliberately NOT included: a second importer. "Convert" ends by opening the
// existing ImportReviewModal — the reviewed, defect-fixed one from WO03, with
// its `alreadyManaged` / `compileOwned` guards — rather than re-implementing
// the scan.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Check, ChevronDown, ChevronRight, FolderOpen, Plug, X } from "lucide-react";
import { projectInit, projectMetaRead, projectMetaWrite } from "./api";
import {
  EMPTY_PROJECT_META,
  PROJECT_BRIEF_MAX,
  PROJECT_TYPES,
  basename,
  linesToList,
  listToLines,
  type ProjectMeta,
} from "./types";
import { hooksStatus, type HooksStatus } from "../fs/api";
import { HooksModal } from "../inspector/HooksModal";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content";
const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";
const PRIMARY_BTN =
  "flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled";
const INPUT =
  "h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent";
const AREA =
  "w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-relaxed text-content placeholder:text-content-disabled focus:border-accent";

export type ProjectWizardMode = "new" | "convert" | "edit";

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

/** 34×19 pill toggle — amber, mirrors NodeWizard's/NewAgentDialog's
 *  AmberToggle. Installing hooks is a promise about agent behaviour (Claude
 *  Code will start reporting to the barn), not a user action in itself, so
 *  amber is correct per the accent law (F4). */
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

/** A multi-line list field. Free text rather than a chip editor: typing five
 *  requirements should not cost five clicks on a "+", and Rust trims and
 *  drops blank lines again on write.
 *
 *  A3 fix (WO11 §2.1): this used to be a controlled textarea whose `value`
 *  was re-derived from the parsed list on every keystroke
 *  (`listToLines(value)`), while `onChange` immediately re-parsed
 *  (`linesToList`) — and `linesToList` trims and drops blank lines. Typing a
 *  trailing space or pressing Enter got silently erased on the very
 *  keystroke that produced it, because the round-trip through the cleaned
 *  list threw it away before the next render. Fix: the textarea now owns raw
 *  text in local state, seeded once from the incoming list and re-seeded
 *  only when the field's identity changes (`fieldKey`, e.g. switching which
 *  project is being edited) — never on every parent re-render. The clean
 *  list form is still produced on every keystroke via `onChange`, so the
 *  caller/sidecar never sees an unparsed value, but the textarea itself
 *  renders exactly what was typed. */
function ListField({
  label,
  hint,
  value,
  placeholder,
  onChange,
  fieldKey,
}: {
  label: string;
  hint?: string;
  value: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
  /** Identity of the underlying record — bump this (not `value`) to force
   *  the raw text to re-seed, e.g. when switching from one project to
   *  another. */
  fieldKey: string;
}) {
  const [raw, setRaw] = useState(() => listToLines(value));
  const seededFor = useRef(fieldKey);
  if (seededFor.current !== fieldKey) {
    seededFor.current = fieldKey;
    setRaw(listToLines(value));
  }
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {hint !== undefined && (
        <p className="mb-1 text-xs leading-snug text-content-muted">{hint}</p>
      )}
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(linesToList(e.target.value));
        }}
        placeholder={placeholder}
        rows={3}
        className={AREA}
      />
    </div>
  );
}

/** A4 — collapsible disclosure for the optional block. Visually mirrors
 *  `InspectorSection`'s header idiom (chevron + mono uppercase tracking-wide
 *  title) so the two panels read as one system, but state is local and
 *  uncontrolled by `AppSettings.collapsedSections` — this is a wizard, not a
 *  panel, and its collapse state should not persist across opens (WO11
 *  §5.1). */
function Disclosure({
  title,
  open: isOpen,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border-subtle pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex h-[26px] w-full flex-none items-center gap-1.5 text-left transition-colors duration-fast hover:text-content"
      >
        <span className="flex-none text-content-muted">
          {isOpen ? (
            <ChevronDown size={11} strokeWidth={2} />
          ) : (
            <ChevronRight size={11} strokeWidth={2} />
          )}
        </span>
        <span className="font-mono text-2xs uppercase tracking-wider text-content-secondary">
          {title}
        </span>
      </button>
      {isOpen && <div className="flex flex-col gap-3 pt-2">{children}</div>}
    </div>
  );
}

const STEPS = ["Folder", "Project", "Create"] as const;

export function ProjectWizard({
  mode,
  /** Required in "edit" mode — the already-open project. Ignored otherwise,
   *  where the folder is what step 1 is for. */
  root: openRoot,
  onClose,
  onDone,
}: {
  mode: ProjectWizardMode;
  root?: string;
  onClose: () => void;
  /** Called after a successful scaffold. `openImport` asks the host to run
   *  the existing ImportReviewModal once the project has finished loading. */
  onDone: (root: string, openImport: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isEdit = mode === "edit";
  // Editing an open project skips the folder step entirely — there is
  // nothing to pick, and offering a picker would invite changing which
  // project you are editing halfway through editing it.
  const [step, setStep] = useState(isEdit ? 1 : 0);
  const [root, setRoot] = useState<string | null>(isEdit ? (openRoot ?? null) : null);
  const [meta, setMeta] = useState<ProjectMeta>(EMPTY_PROJECT_META);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installHooks, setInstallHooks] = useState(false);
  const [hooksOpen, setHooksOpen] = useState(false);

  // D2 fix — `meta` loads asynchronously in edit mode (below), but the
  // fields keyed on `fieldKey` (ListField's raw-text seed) only re-seed when
  // `fieldKey` itself changes. `mode`/`root` are both fixed before first
  // paint, so without this generation counter the async load landing after
  // ListField has already mounted+seeded-empty is invisible to it — the
  // textarea stays blank forever while `meta` (and Save) hold the real data.
  // Bumped once, right after the load lands (never on every keystroke).
  const [metaGen, setMetaGen] = useState(0);

  // A4 — the optional block starts collapsed, except that edit mode must
  // never hide data the user already typed: once the loaded sidecar (or the
  // fresh empty form) is known to hold a value in any of the four optional
  // fields, force it open exactly once. `optionalInitDone` latches so a
  // later manual collapse is never re-opened by an unrelated field edit.
  const [optionalOpen, setOptionalOpen] = useState(false);
  const optionalInitDone = useRef(false);
  useEffect(() => {
    if (optionalInitDone.current) return;
    const hasOptionalValue =
      meta.hardRules.length > 0 ||
      meta.targetAudience.trim() !== "" ||
      meta.architecture.trim() !== "" ||
      meta.constraints.length > 0;
    if (hasOptionalValue) {
      setOptionalOpen(true);
      optionalInitDone.current = true;
    } else if (!isEdit) {
      // New/convert mode has nothing to wait on — the form starts empty, so
      // there is no later "loaded" value that could still arrive.
      optionalInitDone.current = true;
    }
  }, [meta, isEdit]);

  // A3 — identity for ListField's raw-text seeding: re-seed only when we
  // switch which project is being edited, never on every keystroke. D2 —
  // `metaGen` also bumps this once the async load (below) actually lands.
  const fieldKey = `${mode}:${root ?? ""}:${metaGen}`;

  const isConvert = mode === "convert";
  const title = isEdit
    ? "Project properties"
    : isConvert
      ? "Convert existing project"
      : "New project";

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Load what is already on disk so editing is editing, not retyping. A
  // project with no sidecar yet (everything predating WO10) simply starts
  // from the empty form with its name pre-filled from the folder.
  useEffect(() => {
    if (!isEdit || openRoot === undefined) return;
    let live = true;
    void projectMetaRead(openRoot)
      .then((existing) => {
        if (!live) return;
        setMeta(existing ?? { ...EMPTY_PROJECT_META, name: basename(openRoot) });
        setMetaGen((g) => g + 1);
      })
      .catch((e: unknown) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [isEdit, openRoot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F4 — HooksModal owns Escape while it's the top layer; the wizard
      // must not also close underneath it on the same keypress.
      if (e.key === "Escape" && !busy && !hooksOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, hooksOpen, onClose]);

  // F4 — edit mode's second discoverable entry point: a live status row
  // instead of the Create-step toggle (there is no Create step to put it
  // on). Re-read after the modal closes so an install shows up immediately.
  const [editHooksStatus, setEditHooksStatus] = useState<HooksStatus | null>(null);
  useEffect(() => {
    if (!isEdit || root === null) return;
    let live = true;
    void hooksStatus(root)
      .then((s) => {
        if (live) setEditHooksStatus(s);
      })
      .catch(() => {
        // Passive status probe — a failure here just means the row stays on
        // "checking", never a hard error in the properties form.
      });
    return () => {
      live = false;
    };
  }, [isEdit, root]);

  const pickFolder = () => {
    setError(null);
    void open({ directory: true, title: `${title} — choose a folder` })
      .then((picked) => {
        if (typeof picked !== "string") return; // cancelled
        setRoot(picked);
        // Pre-fill the name from the folder, but only while the user hasn't
        // typed one — re-picking a folder must not silently overwrite a name
        // they already chose.
        setMeta((m) => (m.name.trim() === "" ? { ...m, name: basename(picked) } : m));
        setStep(1);
      })
      .catch((e: unknown) => setError(String(e)));
  };

  const create = () => {
    if (root === null) return;
    setBusy(true);
    setError(null);
    // Editing writes the sidecar (and refreshes the rendered node if one is
    // there); creating scaffolds the whole layout. Both are idempotent and
    // neither clobbers a file the user wrote.
    const work = isEdit ? projectMetaWrite(root, meta) : projectInit(root, meta).then(() => undefined);
    work
      .then(() => {
        setBusy(false);
        // F4 — the toggle is a promise to open the trust-boundary modal
        // next, not a write itself. `.claude/agents` (created by
        // projectInit, just above) must exist before HooksModal's preview
        // runs, and `onDone` must wait for the modal's own close so at most
        // one modal is ever on screen.
        if (installHooks) {
          setHooksOpen(true);
          return;
        }
        onDone(root, isConvert);
      })
      .catch((e: unknown) => {
        setBusy(false);
        setError(String(e));
      });
  };

  // F4 — single close handler for both entry points (Create-step toggle,
  // edit-mode status row): edit mode has no `onDone` transition to make, it
  // just refreshes the row; new/convert mode finishes the wizard exactly as
  // it would have without the toggle.
  const closeHooksModal = () => {
    setHooksOpen(false);
    if (root === null) return;
    if (isEdit) {
      void hooksStatus(root)
        .then((s) => setEditHooksStatus(s))
        .catch(() => {});
    } else {
      onDone(root, isConvert);
    }
  };

  const patch = (p: Partial<ProjectMeta>) => setMeta((m) => ({ ...m, ...p }));
  const canCreate = root !== null && meta.name.trim() !== "" && !busy && !hooksOpen;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && !hooksOpen) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex max-h-[85vh] w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">{title}</span>
          <div className="flex items-center gap-1.5">
            {(isEdit ? [] : STEPS).map((s, i) => (
              <span
                key={s}
                className={`rounded-sm px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider ${
                  i === step
                    ? "bg-accent-surface text-accent-text"
                    : i < step
                      ? "text-content-muted"
                      : "text-content-disabled"
                }`}
              >
                {s}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1" />
          <button onClick={onClose} title="Close" disabled={busy || hooksOpen} className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {error !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {error}
            </div>
          )}

          {step === 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-content-secondary">
                {isConvert
                  ? "Pick a folder that already has code and context in it. Cowtext will add its own files alongside — nothing existing is overwritten — and then offer to turn any CLAUDE.md, AGENTS.md or .cursor/rules it finds into Memory Nodes."
                  : "Pick an empty folder, or one you want to start managing. Cowtext creates .cowtext/, context/ and .claude/agents/, and writes your project description as a pinned Memory Node."}
              </p>
              <button onClick={pickFolder} className={`${PRIMARY_BTN} self-start`}>
                <FolderOpen size={14} strokeWidth={1.8} className="mr-1.5" />
                Choose folder…
              </button>
              {root !== null && (
                <p className="truncate font-mono text-xs text-content-secondary" title={root}>
                  {root}
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              {/* F4 — edit mode skips the Create step entirely, so this is
                  the feature's second discoverable entry point (contract
                  item 6): a live status row + button that opens the same
                  trust-boundary modal used elsewhere in the app. */}
              {isEdit && (
                <div className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-surface-inset px-3 py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Plug size={12} strokeWidth={1.5} className="flex-none text-content-muted" />
                    <span className="min-w-0 flex-1 truncate text-xs text-content-secondary">
                      {editHooksStatus === null
                        ? "Checking Claude Code hooks…"
                        : editHooksStatus.installed
                          ? "Claude Code hooks installed"
                          : "Claude Code hooks not installed"}
                    </span>
                  </div>
                  {editHooksStatus !== null && !editHooksStatus.installed && (
                    <button
                      type="button"
                      onClick={() => setHooksOpen(true)}
                      className={SECONDARY_BTN}
                    >
                      Install hooks…
                    </button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Name</FieldLabel>
                  <input
                    autoFocus
                    value={meta.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder="Project name"
                    className={INPUT}
                  />
                </div>
                <div>
                  <FieldLabel>Type</FieldLabel>
                  <select
                    value={meta.projectType}
                    onChange={(e) => patch({ projectType: e.target.value })}
                    className={`${INPUT} pr-1`}
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t.key} value={t.key} title={t.hint}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <FieldLabel>Brief description</FieldLabel>
                  <span
                    className={`font-mono text-2xs ${
                      meta.brief.length >= 900 ? "text-amber-text" : "text-content-muted"
                    }`}
                  >
                    {meta.brief.length} / {PROJECT_BRIEF_MAX}
                  </span>
                </div>
                <textarea
                  value={meta.brief}
                  onChange={(e) => patch({ brief: e.target.value.slice(0, PROJECT_BRIEF_MAX) })}
                  placeholder="One paragraph: what is this, and what is it for?"
                  rows={3}
                  className={AREA}
                />
              </div>

              <ListField
                label="Requirements"
                hint="What it must do. One per line."
                value={meta.requirements}
                placeholder={"Compile context to CLAUDE.md\nRun offline"}
                onChange={(requirements) => patch({ requirements })}
                fieldKey={fieldKey}
              />

              <Disclosure
                title="Optional (4)"
                open={optionalOpen}
                onToggle={() => setOptionalOpen((v) => !v)}
              >
                <ListField
                  label="Hard rules"
                  hint="Lines the agent must never break. These compile above everything else."
                  value={meta.hardRules}
                  placeholder={"Never commit without asking\nNo new dependencies"}
                  onChange={(hardRules) => patch({ hardRules })}
                  fieldKey={fieldKey}
                />
                <div>
                  <FieldLabel>Target audience</FieldLabel>
                  <input
                    value={meta.targetAudience}
                    onChange={(e) => patch({ targetAudience: e.target.value })}
                    placeholder="Who uses this?"
                    className={INPUT}
                  />
                </div>
                <div>
                  <FieldLabel>Architecture</FieldLabel>
                  <textarea
                    value={meta.architecture}
                    onChange={(e) => patch({ architecture: e.target.value })}
                    placeholder="Stack, layout, the shape of the thing."
                    rows={2}
                    className={AREA}
                  />
                </div>
                <ListField
                  label="Constraints"
                  value={meta.constraints}
                  placeholder={"Windows only\nNo telemetry"}
                  onChange={(constraints) => patch({ constraints })}
                  fieldKey={fieldKey}
                />
              </Disclosure>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="truncate font-mono text-xs text-content-secondary" title={root ?? ""}>
                {root}
              </p>
              <div className="rounded border border-border-subtle bg-surface-inset p-3">
                <p className="mb-2 font-mono text-2xs uppercase tracking-wider text-content-muted">
                  Will create
                </p>
                <ul className="flex flex-col gap-1 font-mono text-xs text-content-secondary">
                  {[
                    ".cowtext/project.json",
                    "context/project.md",
                    "context/",
                    ".claude/agents/",
                  ].map((p) => (
                    <li key={p} className="flex items-center gap-1.5">
                      <Check size={11} strokeWidth={2} className="flex-none text-success-text" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-start gap-2 rounded border border-border-subtle bg-surface-inset px-3 py-2">
                <AlertTriangle
                  size={13}
                  strokeWidth={1.8}
                  className="mt-0.5 flex-none text-amber-text"
                />
                <p className="text-xs leading-relaxed text-content-secondary">
                  Existing files are never overwritten. If{" "}
                  <span className="font-mono">context/project.md</span> is already there, yours is
                  kept and Cowtext just records the properties.
                </p>
              </div>
              <div className="flex items-start justify-between gap-3 rounded border border-amber-border bg-amber-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-2xs uppercase tracking-wider text-amber-text">
                    Install Claude Code hooks
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                    This edits <span className="break-all font-mono">.claude/settings.json</span>{" "}
                    in your project so Claude Code reports file activity to Cowtext on{" "}
                    <span className="font-mono">127.0.0.1:4923</span>. Nothing is written until you
                    approve the exact diff below.
                  </p>
                </div>
                <AmberToggle checked={installHooks} onChange={setInstallHooks} />
              </div>
              {isConvert && (
                <p className="text-sm leading-relaxed text-content-secondary">
                  Afterwards, the importer opens so you can review which of this project&apos;s
                  existing context files become Memory Nodes.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {isEdit
              ? "These properties compile into context/project.md."
              : step === 0
                ? "Step 1 of 3 — choose where this project lives."
                : step === 1
                  ? "Step 2 of 3 — this becomes a pinned Memory Node."
                  : "Step 3 of 3 — review and create."}
          </span>
          {step > 0 && !isEdit && (
            <button onClick={() => setStep(step - 1)} disabled={busy} className={SECONDARY_BTN}>
              Back
            </button>
          )}
          <button onClick={onClose} disabled={busy || hooksOpen} className={SECONDARY_BTN}>
            Cancel
          </button>
          {step < 2 && !isEdit ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={root === null || (step === 1 && meta.name.trim() === "")}
              className={PRIMARY_BTN}
            >
              Next
            </button>
          ) : (
            <button onClick={create} disabled={!canCreate} className={PRIMARY_BTN}>
              {busy ? "· · ·" : isEdit ? "Save" : isConvert ? "Convert" : "Create"}
            </button>
          )}
        </div>
      </div>
      {hooksOpen && root !== null && <HooksModal root={root} onClose={closeHooksModal} />}
    </div>
  );
}
