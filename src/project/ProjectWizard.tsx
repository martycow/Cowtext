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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Plug,
  Plus,
  X,
} from "lucide-react";
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
import { gitInit, gitStatus } from "../git/api";
import { BranchPicker, isValidBranchName } from "../git/BranchPicker";
import type { GitInitResult, GitStatus } from "../git/types";
import { presetApply } from "../preset/api";
import { PRINCIPLES, PROVIDER_SUPPORT_SENTENCE } from "../resources";
import { useHooksAddr } from "../store/project";
import { useSettingsStore } from "../store/settings";
import { knownStackIds, stackGroups } from "../settings/stackTable";
import { buildProjectGraph } from "../wizard/projectGraph";

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

/** 34×19 pill toggle — mirrors NodeWizard's/NewAgentDialog's AmberToggle.
 *
 *  Tone is the accent law, not decoration: installing hooks is a promise
 *  about AGENT behaviour (Claude Code will start reporting to the barn), so
 *  it is amber (F4); `git init` is the user acting on the user's own folder,
 *  so it is blue. Two accents, never on the same control. */
function PillToggle({
  checked,
  onChange,
  tone = "amber",
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: "amber" | "accent";
  disabled?: boolean;
  label?: string;
}) {
  const on =
    tone === "amber" ? "border-amber-border bg-amber-surface" : "border-accent-border bg-accent-surface";
  const knobOn = tone === "amber" ? "bg-amber" : "bg-accent";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[19px] w-[34px] flex-none rounded-pill border transition-colors duration-fast disabled:opacity-50 ${
        checked ? on : "border-border-strong bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[13px] w-[13px] rounded-pill transition-all duration-fast ${
          checked ? `left-[16px] ${knobOn}` : "left-[2px] bg-content-muted"
        }`}
      />
    </button>
  );
}

/** 15px checkbox square, same geometry and palette as CompileModal's and
 *  GitWizard's (DESIGN_SPEC: 15px, r-xs, blue — a user-initiated choice).
 *  Presentational on purpose: every call site here nests it inside the row
 *  `<button role="checkbox">` that owns the click, so there is exactly one
 *  interactive element per row (GitWizard's D1a lesson — a button inside a
 *  button nets two handlers that cancel each other through bubbling). */
function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <span
      role="presentation"
      className={`mt-px grid h-[15px] w-[15px] flex-none place-items-center rounded-xs border transition-colors duration-fast ${
        checked ? "border-accent bg-accent" : "border-border-strong bg-surface-1"
      }`}
    >
      {checked && <Check size={11} strokeWidth={3} className="text-content-inverse" />}
    </span>
  );
}

/** The hint under a principle's label: the first line of its markdown body
 *  that is neither the `#` heading (which only repeats the label) nor
 *  blank — i.e. the rule itself, in the words it will be written to disk
 *  in. */
function principleHint(body: string): string {
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return lines[0]?.trim() ?? "";
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

/** WO15 Block 6 — the New Project path gains three steps between "Project"
 *  and "Create". Convert keeps its three: it inherits an existing project's
 *  context by import, so principles/stack/git are not its questions to ask
 *  (a folder being converted is nearly always a repo already). */
const NEW_STEPS = ["Folder", "Project", "Principles", "Stack", "Git", "Create"] as const;
const CONVERT_STEPS = ["Folder", "Project", "Create"] as const;

/** Step indices, by name — the render below reads these instead of magic
 *  numbers, because "step 2" means Principles in one mode and Create in the
 *  other. */
const STEP_FOLDER = 0;
const STEP_PROJECT = 1;
const STEP_PRINCIPLES = 2;
const STEP_STACK = 3;
const STEP_GIT = 4;

/** WO14 declutter — a left-rail numbered stepper replaces the header's flat
 *  pill row, so the wizard reads as a real sequence (numbered circles, a
 *  connecting line, a done-state check) instead of small text chips easy to
 *  miss above the form. Edit mode never renders this (it has no steps). */
function StepRail({ steps, step }: { steps: readonly string[]; step: number }) {
  return (
    <div className="flex w-[136px] flex-none flex-col border-r border-border-subtle px-4 py-4">
      {steps.map((label, i) => (
        <div key={label} className="relative flex items-start gap-2.5 pb-7 last:pb-0">
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute bottom-[-4px] left-[10px] top-[22px] w-px bg-border-default"
            />
          )}
          <span
            className={`z-10 grid h-[21px] w-[21px] flex-none place-items-center rounded-pill border font-mono text-[10.5px] ${
              i === step
                ? "border-accent bg-accent font-bold text-content-inverse"
                : i < step
                  ? "border-accent-border bg-accent-surface text-accent-text"
                  : "border-border-default bg-surface-2 text-content-muted"
            }`}
          >
            {i < step ? <Check size={11} strokeWidth={2.5} /> : i + 1}
          </span>
          <span
            className={`pt-0.5 text-xs ${
              i === step ? "font-medium text-content" : "text-content-muted"
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What the wizard actually did (WO15 §4.13, D-16). `graphApplied` tells
 *  App.tsx to SKIP its own starter adoption — the wizard already wrote a
 *  graph, and adopting `context/project.md` a second time would mint a
 *  duplicate node. `git` is `null` when the Git step was off or skipped. */
export interface ProjectWizardOutcome {
  graphApplied: boolean;
  git: GitInitResult | null;
}

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
   *  the existing ImportReviewModal once the project has finished loading.
   *  `outcome` is filled by U2; absent means "assume nothing was applied",
   *  which is exactly today's behaviour. */
  onDone: (root: string, openImport: boolean, outcome?: ProjectWizardOutcome) => void;
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

  // WO16 Block C — the user's stack table and their defaults for it. Read
  // above the state block because `stackIds` seeds itself from them.
  const defaultStackItemIds = useSettingsStore((s) => s.defaultStackItemIds);
  const customStackItems = useSettingsStore((s) => s.customStackItems);

  // ── Block 6 — principles, stack, git ─────────────────────────────────
  // Nothing here touches disk. Every selection feeds `buildProjectGraph`,
  // whose plan is what the Create step LISTS and what Create WRITES — one
  // computation, so the preview cannot drift from the result.
  const [principleIds, setPrincipleIds] = useState<readonly string[]>([]);
  // WO16 Block C — the wizard starts on the user's saved defaults rather
  // than blank. Filtered through the live table on the way in: a default
  // naming a custom item that has since been deleted is dropped HERE, at
  // the point of use, so `settings.json` is never quietly rewritten behind
  // the user's back (the same rule `defaultCompileTargets` follows).
  const [stackIds, setStackIds] = useState<readonly string[]>(() =>
    defaultStackItemIds.filter((id) => knownStackIds(customStackItems).has(id)),
  );
  const [fixedStack, setFixedStack] = useState(false);
  const [stackQuery, setStackQuery] = useState("");
  const [branch, setBranch] = useState("main");
  const [initGit, setInitGit] = useState(true);
  const [gitProbe, setGitProbe] = useState<GitStatus | null>(null);
  const [gitProbeFailed, setGitProbeFailed] = useState(false);
  const [gitResult, setGitResult] = useState<GitInitResult | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  // `projectInit` + `presetApply` succeeded once already — a Retry after a
  // failed `git_init` must not run them again: `preset_apply` fails closed
  // on a project that already has a non-empty graph (`preset.rs:219-227`),
  // which would turn a recoverable git error into a permanent dead end.
  const scaffolded = useRef(false);
  // Render-time twin of `scaffolded` (a ref cannot re-render): once true the
  // Create step becomes a RESULT block and the wizard stops being cancellable
  // — the files exist, so the only honest exit is into the project.
  const [created, setCreated] = useState(false);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  // The hooks modal is offered exactly once per Create, not again on a git
  // Retry — approving a diff twice for one wizard run is a trust-boundary
  // annoyance, not a feature.
  const hooksPrompted = useRef(false);

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
  const isNew = mode === "new";
  const title = isEdit
    ? "Project properties"
    : isConvert
      ? "Convert existing project"
      : "New project";

  const steps = isNew ? NEW_STEPS : CONVERT_STEPS;
  const lastStep = steps.length - 1;

  // The ticks the user made on the title screen (or in Settings) — a brand
  // new project starts compiled for exactly those targets. Subscribed, not
  // read once, so the Create step's preview follows a change made in
  // another window without a remount.
  const defaultCompileTargets = useSettingsStore((s) => s.defaultCompileTargets);

  // D-2 — the hooks receiver's address comes from the one Rust const through
  // the store, never from a literal in copy: a hard-coded port is a sentence
  // that keeps rendering confidently after the port moves.
  const hooksAddr = useHooksAddr();

  // THE plan: rendered as "Will create" on the last step, applied verbatim
  // by Create. Pure, in memory, deterministic (§4.11).
  const plan = useMemo(
    () =>
      buildProjectGraph({
        projectName: meta.name,
        principleIds,
        stackItemIds: stackIds,
        fixedStackRule: fixedStack,
        compileTargets: defaultCompileTargets,
        customStackItems,
      }),
    [meta.name, principleIds, stackIds, fixedStack, defaultCompileTargets, customStackItems],
  );

  // Git state, all derived from one probe. `gitOn` is the single truth the
  // Create step, the Will-create list and `create()` all read — a toggle
  // that is on but unusable (no git, already a repo) is OFF here.
  const gitAvailable = gitProbe !== null && gitProbe.gitAvailable;
  const gitIsRepo = gitProbe !== null && gitProbe.isRepo;
  const gitIdentityMissing =
    gitProbe !== null && (gitProbe.identityName === null || gitProbe.identityEmail === null);
  const gitOn = isNew && initGit && gitAvailable && !gitIsRepo;
  const branchOk = !gitOn || isValidBranchName(branch);
  // The probe is asynchronous, and until it lands `gitAvailable` is false —
  // i.e. `gitOn` reads exactly like "no git here" while the answer is still
  // unknown. Creating during that window would silently skip the repo the
  // user asked for, so Create waits (tester #9). A FAILED probe is a real
  // answer ("no git"), not a pending one — it must not block Create.
  const gitProbePending = isNew && root !== null && gitProbe === null && !gitProbeFailed;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Probe as soon as a folder is known — the Git step needs it, and so does
  // the Create step's file list. Read-only; a failure is not an error the
  // user has to clear, it just means the git step has nothing to offer.
  useEffect(() => {
    if (!isNew || root === null) return;
    let live = true;
    setGitProbe(null);
    setGitProbeFailed(false);
    void gitStatus(root)
      .then((s) => {
        if (live) setGitProbe(s);
      })
      .catch(() => {
        if (live) setGitProbeFailed(true);
      });
    return () => {
      live = false;
    };
  }, [isNew, root]);

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

  /** Hand the finished project to the host. In `new` mode the outcome is
   *  read off state at click time (not snapshotted at Create), so a git
   *  Retry between Create and Open project is reflected in what App.tsx
   *  gets. `graphApplied` keeps App from adopting `context/project.md` a
   *  second time (§4.13, D-16). */
  const openProject = useCallback(() => {
    if (root === null) return;
    onDone(root, isConvert, isNew ? { graphApplied: true, git: gitResult } : undefined);
  }, [root, isConvert, isNew, gitResult, onDone]);

  /** The one write path. Order is fixed and each step is guarded so a
   *  failure in a later one never re-runs an earlier one (Retry):
   *    1. `projectInit`  — sidecar + folders + `context/project.md`
   *    2. `presetApply`  — the plan's graph and stub files. ALWAYS in `new`
   *       mode (D-16), even with nothing ticked: the project's own node has
   *       to exist for the first commit to contain a graph.
   *    3. `gitInit(root, branch, true)` — repo + `.gitignore` + one commit.
   *  Only step 3 is allowed to fail recoverably; its error is shown on this
   *  step and the button becomes Retry. */
  const create = () => {
    if (root === null) return;
    setBusy(true);
    setError(null);
    setGitError(null);
    void (async () => {
      try {
        if (isEdit) {
          await projectMetaWrite(root, meta);
        } else if (!scaffolded.current) {
          await projectInit(root, meta);
          if (isNew) {
            try {
              await presetApply(root, plan.graphJson, plan.stubs);
            } catch (e: unknown) {
              // `preset_apply` fails closed on a folder that already holds a
              // real graph (`preset.rs:219-227`) — which means "New project"
              // was pointed at an existing Cowtext project. Rust's sentence
              // is kept verbatim; the way out is added, because the wizard
              // itself has no way to merge two graphs.
              const text = String(e);
              setError(
                text.includes("already has a graph")
                  ? `${text} — this folder is already a Cowtext project. Cancel and use Open folder instead.`
                  : text,
              );
              setBusy(false);
              return;
            }
          }
          scaffolded.current = true;
          // From here on the folder has files in it. In `new` mode the step
          // turns into a result block that survives a git failure, a Retry
          // and the hooks modal — the user sees what landed before the
          // wizard hands over (tester #6).
          if (isNew) setCreated(true);
        }

        if (gitOn && gitResult === null) {
          try {
            setGitResult(await gitInit(root, branch, true));
          } catch (e: unknown) {
            // Recoverable: the project itself is created and intact (Rust
            // rejects a commit with no identity BEFORE touching the folder,
            // A-4). Stay here so the user can fix git and press Retry.
            setGitError(String(e));
            setBusy(false);
            return;
          }
        }

        setBusy(false);
        // F4 — the toggle is a promise to open the trust-boundary modal
        // next, not a write itself. `.claude/agents` (created by
        // projectInit, just above) must exist before HooksModal's preview
        // runs, and at most one modal is ever on screen. Offered once per
        // run: a git Retry must not re-ask for the same diff.
        if (installHooks && !hooksPrompted.current) {
          hooksPrompted.current = true;
          setHooksOpen(true);
          return;
        }
        // `new` mode stops here: the result block is the last step, and
        // Open project is what calls `onDone`. Convert/edit are unchanged.
        if (isNew) return;
        onDone(root, isConvert, undefined);
      } catch (e: unknown) {
        setBusy(false);
        setError(String(e));
      }
    })();
  };

  // F4 — single close handler for both entry points (Create-step toggle,
  // edit-mode status row): edit mode has no `onDone` transition to make, it
  // just refreshes the row; convert mode finishes the wizard exactly as it
  // would have without the toggle; `new` mode returns to its result block.
  const closeHooksModal = () => {
    setHooksOpen(false);
    if (root === null) return;
    if (isEdit) {
      void hooksStatus(root)
        .then((s) => setEditHooksStatus(s))
        .catch(() => {});
    } else if (!isNew) {
      onDone(root, isConvert, undefined);
    }
    // `new` mode falls back to the result block underneath — it still has
    // the git line (and, if git failed, Retry) to show before handing over.
  };

  /** Escape, the scrim and the header × share one handler, because after
   *  Create there is nothing left to cancel: the files are on disk, so
   *  every dismissal is "open the project" instead. */
  const dismiss = useCallback(() => {
    if (created) openProject();
    else onClose();
  }, [created, openProject, onClose]);

  // Keyboard safety: the primary button changes identity at Create, so move
  // focus onto its replacement. Never while the hooks modal is up — that
  // layer owns focus until it closes.
  useEffect(() => {
    if (created && !hooksOpen) openBtnRef.current?.focus();
  }, [created, hooksOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F4 — HooksModal owns Escape while it's the top layer; the wizard
      // must not also close underneath it on the same keypress.
      if (e.key === "Escape" && !busy && !hooksOpen) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, hooksOpen, dismiss]);

  const patch = (p: Partial<ProjectMeta>) => setMeta((m) => ({ ...m, ...p }));
  const canCreate =
    root !== null &&
    meta.name.trim() !== "" &&
    !busy &&
    !hooksOpen &&
    branchOk &&
    !gitProbePending;

  const toggleIn = (list: readonly string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  // Every file this wizard is about to create, in write order — the same
  // plan Create applies, never a second description of it.
  const willCreate: { path: string; note?: string }[] = isNew
    ? [
        { path: ".cowtext/project.json", note: "project properties" },
        { path: ".cowtext/graph.json", note: "the graph" },
        { path: ".claude/agents/", note: "agent definitions live here" },
        ...plan.summary.relPaths.map((relPath, i) => ({
          path: relPath,
          note: plan.summary.names[i],
        })),
        // Before Create this row is a promise; after Create the same row is
        // a claim, so it only survives when git really ran. A failed init
        // (identity rejected before any mutation, A-4) or the D-15 skip
        // wrote no `.gitignore`, and a green check on a file that is not
        // there is the exact lie this block exists to avoid.
        ...(gitOn && (!created || (gitResult !== null && !gitResult.skippedExistingRepo))
          ? [{ path: ".gitignore", note: "committed with the first commit" }]
          : []),
      ]
    : [
        { path: ".cowtext/project.json" },
        { path: "context/project.md" },
        { path: "context/" },
        { path: ".claude/agents/" },
      ];

  /** Read off `GitInitResult`, never recomputed from the UI's own hopes —
   *  and never green just because the call resolved. Three answers:
   *
   *   • a real init            → `branch main · 1 commit`        (success)
   *   • skipped, zero commits  → the shape a Retry lands in after `git init`
   *     succeeded and the commit did not: the repo now exists, so `git_init`
   *     takes the D-15 skip path and can never commit into it. Painting that
   *     green would claim a commit that is not there (tester #3). (warning)
   *   • skipped, with commits  → a repository that was already here and was
   *     left untouched — information, not an achievement.          (info) */
  const gitResultLine: { tone: "success" | "warning" | "info"; text: string } | null =
    gitResult === null
      ? null
      : gitResult.skippedExistingRepo
        ? gitResult.commitCount === 0
          ? {
              tone: "warning",
              text: "Repository exists but has no commits yet — commit from your terminal (git add -A && git commit).",
            }
          : { tone: "info", text: "Existing repository detected — git init skipped" }
        : {
            tone: gitResult.committed ? "success" : "warning",
            text: `branch ${gitResult.status.branch ?? branch} · ${gitResult.commitCount} commit${
              gitResult.commitCount === 1 ? "" : "s"
            }`,
          };

  const stackQ = stackQuery.trim().toLowerCase();
  const stackRows = stackGroups(customStackItems)
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) => stackQ === "" || row.label.toLowerCase().includes(stackQ),
      ),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && !hooksOpen) dismiss();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex max-h-[85vh] w-[800px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">{title}</span>
          <div className="min-w-0 flex-1" />
          <button
            onClick={dismiss}
            title={created ? "Open project" : "Close"}
            disabled={busy || hooksOpen}
            className={ICON_BTN}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {!isEdit && <StepRail steps={steps} step={step} />}
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

          {isNew && step === STEP_PRINCIPLES && (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-content-secondary">
                Rules the agents working here must follow. Each one you tick becomes a rule node
                with its own file in <span className="font-mono">context/principles/</span>, always
                loaded — editable afterwards like any other node.
              </p>
              <div className="flex flex-col gap-1.5">
                {PRINCIPLES.map((p) => {
                  const checked = principleIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => setPrincipleIds((list) => toggleIn(list, p.id))}
                      className={`flex items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors duration-fast ${
                        checked
                          ? "border-accent-border bg-accent-surface"
                          : "border-border bg-surface-2 hover:border-border-strong"
                      }`}
                    >
                      <CheckSquare checked={checked} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-content">{p.label}</span>
                        <span className="block text-2xs leading-snug text-content-muted">
                          {principleHint(p.body)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isNew && step === STEP_STACK && (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-content-secondary">
                What this project is built with. Everything you tick becomes one architecture node
                at <span className="font-mono">context/stack.md</span>; tick nothing and no stack
                node is created.
              </p>
              <input
                value={stackQuery}
                onChange={(e) => setStackQuery(e.target.value)}
                placeholder="Search the stack…"
                aria-label="Search the stack"
                className={INPUT}
              />
              {stackRows.length === 0 ? (
                <p className="text-xs text-content-muted">Nothing in the list matches that search.</p>
              ) : (
                stackRows.map((group) => (
                  <div key={group.id}>
                    <p className="mb-1.5 font-mono text-2xs uppercase tracking-wider text-content-muted">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.rows.map((item) => {
                        const checked = stackIds.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => setStackIds((list) => toggleIn(list, item.id))}
                            className={`flex h-control-sm items-center gap-1.5 rounded border px-2 text-xs transition-colors duration-fast ${
                              checked
                                ? "border-accent-border bg-accent-surface text-accent-text"
                                : "border-border bg-surface-2 text-content-secondary hover:border-border-strong"
                            }`}
                          >
                            <CheckSquare checked={checked} />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              <button
                type="button"
                role="checkbox"
                aria-checked={fixedStack}
                onClick={() => setFixedStack((v) => !v)}
                className={`flex items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors duration-fast ${
                  fixedStack
                    ? "border-accent-border bg-accent-surface"
                    : "border-border bg-surface-2 hover:border-border-strong"
                }`}
              >
                <CheckSquare checked={fixedStack} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-content">
                    Fixed stack — ask before adding a dependency
                  </span>
                  <span className="block text-2xs leading-snug text-content-muted">
                    Adds that rule node and a closing line to{" "}
                    <span className="font-mono">context/stack.md</span>.
                  </span>
                </span>
              </button>
            </div>
          )}

          {isNew && step === STEP_GIT && (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-content-secondary">
                A new project is easiest to undo when it starts as a repository. Cowtext can run{" "}
                <span className="font-mono">git init</span> here and commit the files it is about
                to create — once, when you click Create.
              </p>

              {gitProbe === null && !gitProbeFailed && (
                <p className="text-xs text-content-muted">checking git…</p>
              )}

              {(gitProbeFailed || (gitProbe !== null && !gitAvailable)) && (
                <p className="rounded border border-border-subtle bg-surface-inset px-3 py-2 text-xs text-content-secondary">
                  git not found on PATH — skipping
                </p>
              )}

              {gitAvailable && (
                <>
                  <div
                    className={`flex items-start justify-between gap-3 rounded border px-3 py-2 ${
                      gitOn ? "border-accent-border bg-accent-surface" : "border-border-subtle bg-surface-inset"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-content">
                        Initialize git and make the first commit
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-content-secondary">
                        Runs <span className="font-mono">git init</span>, adds Cowtext&apos;s lines
                        to <span className="font-mono">.gitignore</span>, and commits once as{" "}
                        <span className="font-mono">chore: init cowtext project</span>. No remote,
                        no push.
                      </p>
                    </div>
                    <PillToggle
                      tone="accent"
                      checked={gitOn}
                      disabled={gitIsRepo}
                      label="Initialize git and make the first commit"
                      onChange={setInitGit}
                    />
                  </div>

                  {gitIsRepo && (
                    <p className="rounded border border-border-subtle bg-surface-inset px-3 py-2 text-xs text-content-secondary">
                      Existing repository detected — git init skipped
                    </p>
                  )}

                  <BranchPicker value={branch} onChange={setBranch} disabled={!gitOn} />

                  {gitOn && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="flex-none font-mono text-2xs uppercase tracking-wider text-content-muted">
                        identity
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-xs ${
                          gitIdentityMissing ? "text-warning-text" : "text-content-secondary"
                        }`}
                      >
                        {gitIdentityMissing
                          ? "not configured"
                          : `${gitProbe?.identityName} <${gitProbe?.identityEmail}>`}
                      </span>
                    </div>
                  )}

                  {gitOn && gitIdentityMissing && (
                    <div className="flex items-start gap-2 rounded border border-warning bg-warning-surface px-3 py-2">
                      <AlertTriangle
                        size={13}
                        strokeWidth={1.8}
                        className="mt-0.5 flex-none text-warning-text"
                      />
                      {/* One source line on purpose: the sentence is
                          contract copy (§6 U2) and must survive a literal
                          grep, not just render correctly. */}
                      <p className="text-xs leading-relaxed text-warning-text">
                        {"Git identity is not configured — the first commit will fail. Set user.name and user.email, or turn the toggle off."}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === lastStep && (
            <div className="flex flex-col gap-3">
              <p className="truncate font-mono text-xs text-content-secondary" title={root ?? ""}>
                {root}
              </p>
              {created && (
                <p className="text-sm leading-relaxed text-content-secondary">
                  <span className="font-medium text-success-text">Created.</span> Everything listed
                  below is on disk now.
                </p>
              )}
              {/* The live plan, not a fixed list: every principle and stack
                  tick shows up here as the file it will become, straight
                  off `buildProjectGraph`'s summary — the same object Create
                  hands to `presetApply`, and afterwards the receipt for what
                  it wrote. */}
              <div className="rounded border border-border-subtle bg-surface-inset p-3">
                <p className="mb-2 font-mono text-2xs uppercase tracking-wider text-content-muted">
                  {created ? "Created" : "Will create"}
                </p>
                <ul className="flex flex-col gap-1 text-xs text-content-secondary">
                  {willCreate.map((f) => (
                    <li key={f.path} className="flex items-baseline gap-1.5">
                      {/* The green check is the DONE marker, so before Create
                          the same list gets a neutral "+" — a row of ticks
                          under "Will create" reads as work already finished. */}
                      {created ? (
                        <Check
                          size={11}
                          strokeWidth={2}
                          className="mt-px flex-none self-start text-success-text"
                        />
                      ) : (
                        <Plus
                          size={11}
                          strokeWidth={2}
                          className="mt-px flex-none self-start text-content-muted"
                        />
                      )}
                      <span className="flex-none font-mono">{f.path}</span>
                      {f.note !== undefined && (
                        <span className="min-w-0 flex-1 truncate text-content-muted">{f.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {!created && (
                  <p className="mt-2 text-xs text-content-muted">
                    Nothing is written until you click Create.
                  </p>
                )}
              </div>
              {!created && (
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
              )}
              {!created && (
                <div className="flex items-start justify-between gap-3 rounded border border-amber-border bg-amber-surface px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-2xs uppercase tracking-wider text-amber-text">
                      Install Claude Code hooks
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                      This edits <span className="break-all font-mono">.claude/settings.json</span>{" "}
                      in your project so Claude Code reports file activity to Cowtext on{" "}
                      <span className="font-mono">{hooksAddr}</span>. Nothing is written until you
                      approve the exact diff below.
                    </p>
                  </div>
                  <PillToggle
                    checked={installHooks}
                    onChange={setInstallHooks}
                    label="Install Claude Code hooks"
                  />
                </div>
              )}

              {/* Git, on the step where the button that runs it lives. The
                  summary line before, the envelope's own answer after —
                  never a guess about what git did. */}
              {isNew && gitResult === null && gitError === null && (
                <p className="text-xs leading-relaxed text-content-muted">
                  {gitOn
                    ? `Git: git init on branch ${branch === "" ? "(none)" : branch}, then one commit.`
                    : gitIsRepo
                      ? "Git: existing repository detected — git init skipped."
                      : gitAvailable
                        ? "Git: skipped — this folder stays untracked."
                        : gitProbe === null && !gitProbeFailed
                          ? "Git: checking…"
                          : "Git: not found on PATH — skipping."}
                </p>
              )}
              {gitResultLine !== null && (
                <p
                  className={`rounded border px-3 py-2 font-mono text-xs ${
                    gitResultLine.tone === "success"
                      ? "border-success bg-success-surface text-success-text"
                      : gitResultLine.tone === "warning"
                        ? "border-warning bg-warning-surface text-warning-text"
                        : "border-border-subtle bg-surface-inset text-content-secondary"
                  }`}
                >
                  {gitResultLine.text}
                </p>
              )}
              {gitError !== null && (
                <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
                  {gitError}
                </div>
              )}

              {isConvert && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm leading-relaxed text-content-secondary">
                    {"Imports the CLAUDE.md, AGENTS.md or .cursor/rules you already have — preview first."}
                  </p>
                  <p className="text-xs leading-relaxed text-content-muted">
                    {PROVIDER_SUPPORT_SENTENCE}
                  </p>
                </div>
              )}
            </div>
          )}
          </div>
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {created
              ? "Files are written. Open the project to continue."
              : isEdit
                ? "These properties compile into context/project.md."
                : step === STEP_FOLDER
                  ? "Choose where this project lives."
                  : step === STEP_PROJECT
                    ? "This becomes a pinned Memory Node."
                    : isNew && step === STEP_PRINCIPLES
                      ? "Each principle becomes a rule node."
                      : isNew && step === STEP_STACK
                        ? "The stack becomes one architecture node."
                        : isNew && step === STEP_GIT
                          ? "The repository is created when you click Create."
                          : gitProbePending
                            ? "Checking git…"
                            : "Review and create."}
          </span>
          {/* Back and Cancel both stop existing once the files exist:
              re-answering a question that has already been written to disk
              is not a thing this wizard can honour, and there is nothing
              left to cancel. Every remaining exit opens the project. */}
          {!created && step > 0 && !isEdit && (
            <button onClick={() => setStep(step - 1)} disabled={busy} className={SECONDARY_BTN}>
              Back
            </button>
          )}
          {!created && (
            <button onClick={onClose} disabled={busy || hooksOpen} className={SECONDARY_BTN}>
              Cancel
            </button>
          )}
          {created ? (
            <>
              {gitError !== null && (
                <button onClick={create} disabled={busy} className={SECONDARY_BTN}>
                  {busy ? "· · ·" : "Retry"}
                </button>
              )}
              <button
                ref={openBtnRef}
                onClick={openProject}
                disabled={busy || hooksOpen}
                className={PRIMARY_BTN}
              >
                Open project
              </button>
            </>
          ) : step < lastStep && !isEdit ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={
                root === null ||
                (step === STEP_PROJECT && meta.name.trim() === "") ||
                (isNew && step === STEP_GIT && !branchOk)
              }
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
