// New Node wizard (WO01 Block D §T5) — four steps in one modal, the
// PresetsModal shell idiom (~720px, surface-1, r-xl, elev-4). Nothing is
// written to disk until Confirm on step 4; Import fills every field but
// still requires Confirm. Blue accent throughout (this is all user action);
// the pinned/assemble toggles stay amber — both are promises about what the
// agent will do, same rule as the Inspector (DESIGN_SPEC "blue is you,
// amber is the cow").

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderInput, Sparkles, X } from "lucide-react";
import {
  GRAPH_VERSION,
  NODE_ROLES,
  isRenameProtected,
  serializeGraph,
  useGraphStore,
  type CompileTarget,
  type NodeRole,
} from "../store/graph";
import { useProjectStore } from "../store/project";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { ROLE_DESCRIPTIONS } from "../canvas/roleMeta";
import { assembleNode } from "../assemble/api";
import { dedupePath, joinDirFile, normalizeDir, normalizeFileName, slugForFile } from "./paths";
import { buildRoleSkeleton } from "./roleSkeleton";
import { exportWizardPreset, importWizardPreset } from "./preset";

const STEPS: { n: 1 | 2 | 3 | 4; label: string }[] = [
  { n: 1, label: "Identity" },
  { n: 2, label: "Target" },
  { n: 3, label: "Brief" },
  { n: 4, label: "Assemble" },
];

const TARGET_LABEL: Record<CompileTarget, string> = {
  claude: "claude",
  agents: "agents",
  cursor: "cursor",
};

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent disabled:hover:text-content-disabled";

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

/** 34×19 pill toggle — amber, mirrors Inspector's Toggle. Both uses here
 *  (pinned, run-assemble) are promises about agent behaviour, not a user
 *  action in themselves, so amber is correct per the accent law. */
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

function StepDots({
  step,
  maxStep,
  onJump,
}: {
  step: number;
  maxStep: number;
  onJump: (n: 1 | 2 | 3 | 4) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center gap-1.5">
      {STEPS.map((s, i) => (
        <Fragment key={s.n}>
          {i > 0 && <span className="h-px w-4 flex-none bg-border" aria-hidden />}
          <button
            type="button"
            onClick={() => onJump(s.n)}
            disabled={s.n > maxStep}
            title={s.label}
            className="flex items-center gap-1.5 disabled:cursor-default"
          >
            <span
              className={`grid h-4 w-4 flex-none place-items-center rounded-pill border font-mono text-micro ${
                s.n === step
                  ? "border-accent bg-accent text-content-inverse"
                  : s.n < step
                    ? "border-accent-border bg-accent-surface text-accent-text"
                    : "border-border bg-surface-2 text-content-disabled"
              }`}
            >
              {s.n}
            </span>
            <span
              className={`font-mono text-2xs ${s.n === step ? "text-content" : "text-content-muted"}`}
            >
              {s.label}
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

function RolePicker({ role, onChange }: { role: NodeRole; onChange: (r: NodeRole) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {NODE_ROLES.map((r) => {
        const active = r === role;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            aria-pressed={active}
            className={`flex flex-col items-start gap-1 rounded border p-2 text-left transition-colors duration-fast ${
              active ? "bg-surface-3" : "border-border bg-surface-2 hover:border-border-strong"
            }`}
            style={active ? { borderColor: roleVar(r) } : undefined}
          >
            <span className="flex items-center gap-1.5" style={{ color: roleVar(r) }}>
              <RoleGlyph role={r} size={13} />
              <span className="font-mono text-2xs uppercase tracking-wider">{r}</span>
            </span>
            <span className="truncate text-2xs leading-snug text-content-secondary" title={ROLE_DESCRIPTIONS[r]}>
              {ROLE_DESCRIPTIONS[r]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AdapterChips({ pinned }: { pinned: boolean }) {
  const targets = useGraphStore((s) => s.compileTargets);
  if (!pinned) {
    return (
      <p className="text-2xs leading-snug text-content-muted">
        Not pinned — compiles on demand only, unless another node references it.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-2xs text-content-muted">Pinned — always included in:</span>
      {targets.length === 0 ? (
        <span className="font-mono text-2xs text-content-disabled">no compile targets selected</span>
      ) : (
        targets.map((t) => (
          <span
            key={t}
            className="rounded-sm border border-amber-border bg-amber-surface px-1.5 py-px font-mono text-micro text-amber-text"
          >
            {TARGET_LABEL[t]}
          </span>
        ))
      )}
    </div>
  );
}

export function NodeWizard({
  root,
  initialPosition,
  onClose,
}: {
  root: string;
  // Contract §7.7 (#16): a thunk lets the centre entry point re-derive at
  // Confirm rather than trusting the value captured at open, so panning
  // while the wizard is open still lands the card in view.
  initialPosition: { x: number; y: number } | (() => { x: number; y: number });
  onClose: () => void;
}) {
  const createNodeFrom = useGraphStore((s) => s.createNodeFrom);
  const nodes = useGraphStore((s) => s.nodes);
  const files = useProjectStore((s) => s.files);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [maxStep, setMaxStep] = useState<1 | 2 | 3 | 4>(1);

  const [name, setName] = useState("");
  const [role, setRole] = useState<NodeRole>("reference");

  const [dir, setDir] = useState("context");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [pinned, setPinned] = useState(false);

  const [brief, setBrief] = useState("");

  const [previewText, setPreviewText] = useState("");
  const [previewTouched, setPreviewTouched] = useState(false);
  const [runAssemble, setRunAssemble] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errText, setErrText] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const canClose = !busy;
  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  // Filename auto-slugs from the name until the user edits it directly.
  useEffect(() => {
    if (fileNameTouched) return;
    setFileName(`${slugForFile(name)}.md`);
  }, [name, fileNameTouched]);

  const takenPaths = useMemo(
    () => new Set([...nodes.map((n) => n.filePath), ...files.map((f) => f.relPath)]),
    [nodes, files],
  );
  const normalizedDir = normalizeDir(dir);
  const normalizedFileName = normalizeFileName(fileName, slugForFile(name));
  const rawPath = joinDirFile(normalizedDir, normalizedFileName);
  const finalPath = dedupePath(rawPath, takenPaths);
  const protectedPath = isRenameProtected(finalPath);

  // Preview stays live-synced to name/role/brief until the user edits the
  // textarea by hand (or Import supplies content directly) — this also
  // means Export always has current content, regardless of which step is
  // showing (WO01 Block D: "export→import→confirm reproduces byte-exact").
  useEffect(() => {
    if (previewTouched) return;
    setPreviewText(buildRoleSkeleton(name, role, brief));
  }, [name, role, brief, previewTouched]);

  const canNext1 = name.trim() !== "";
  const canNext2 = !protectedPath;
  // `maxStep` is a monotonic high-water mark (never resets once a step has
  // been reached), so it alone can't gate navigation: Back, then editing a
  // step-2 field back into an invalid state (e.g. onto a protected path),
  // then jumping a StepDot straight past step 2 would reach step 4 without
  // ever re-clearing canNext2 (WO01 Block D defect). Re-derive the ceiling
  // from the *current* field validity every render so it can only ever be
  // as far as the fields would currently allow, regardless of history.
  const effectiveMaxStep: 1 | 2 | 3 | 4 = !canNext1 ? 1 : !canNext2 ? 2 : maxStep;

  const goto = (n: 1 | 2 | 3 | 4) => {
    if (n > effectiveMaxStep) return;
    setStep(n);
  };
  const advance = (n: 1 | 2 | 3 | 4) => {
    setStep(n);
    setMaxStep((m) => (n > m ? n : m));
  };

  const doImport = () => {
    setErrText(null);
    importWizardPreset()
      .then((fields) => {
        if (fields === null) return; // cancelled
        setName(fields.name);
        setRole(fields.role);
        setDir(fields.dir);
        setFileName(fields.fileName);
        setFileNameTouched(true);
        setPinned(fields.pinned);
        setBrief(fields.brief);
        setPreviewText(fields.content);
        setPreviewTouched(true);
        setStep(1);
        setMaxStep(4);
      })
      .catch((e: unknown) => setErrText(String(e)));
  };

  const doExport = () => {
    if (name.trim() === "") {
      setErrText("Name a node before exporting a preset.");
      return;
    }
    setErrText(null);
    exportWizardPreset({
      name: name.trim(),
      role,
      dir: normalizedDir,
      fileName: normalizedFileName,
      pinned,
      brief,
      content: previewText,
    }).catch((e: unknown) => setErrText(String(e)));
  };

  const doConfirm = () => {
    if (busy) return;
    // Belt-and-suspenders: `effectiveMaxStep` already keeps step 4
    // unreachable while `protectedPath` is true, but Confirm re-checks the
    // live path itself rather than trusting navigation state — this is the
    // trust boundary CLAUDE.md's hard rules call out for generated/managed
    // files, so it must hold even if a future change loosens the gating.
    if (protectedPath) {
      setErrText("This path is managed by Cowtext — choose a different directory before creating the node.");
      setStep(2);
      return;
    }
    setBusy(true);
    setErrText(null);
    (async () => {
      const newId = await createNodeFrom({
        title: name.trim(),
        role,
        filePath: finalPath,
        brief: brief.trim(),
        pinned,
        content: previewText,
        position: typeof initialPosition === "function" ? initialPosition() : initialPosition,
      });
      if (newId !== null && runAssemble) {
        // Fire-and-forget, exactly like the Inspector's Assemble button —
        // failures surface on the node card / Inspector once selected, the
        // wizard itself has already closed by the time they could arrive.
        await useGraphStore.getState().flushSave();
        const s = useGraphStore.getState();
        const graphJson = serializeGraph({
          version: GRAPH_VERSION,
          projectName: s.projectName,
          nodes: s.nodes,
          edges: s.edges,
          compileTargets: s.compileTargets,
        });
        useGraphStore.getState().setAssembleStatus(newId, "queued");
        assembleNode(root, graphJson, newId).catch(() => {
          if (useGraphStore.getState().assembleStatus[newId] === "queued") {
            useGraphStore.getState().setAssembleStatus(newId, "idle");
          }
        });
      }
      onClose();
    })().catch((e: unknown) => {
      setErrText(String(e));
      setBusy(false);
    });
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New node wizard"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px, step dots centered (the amber-march spot is for
            progress bars; this is a navigable index, so plain accent dots). */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="flex-none text-[15px] font-semibold">New node</span>
          <StepDots step={step} maxStep={effectiveMaxStep} onJump={goto} />
          <button onClick={doImport} disabled={busy} title="Import preset…" className={ICON_BTN}>
            <FolderInput size={14} strokeWidth={1.5} />
          </button>
          <button onClick={doExport} disabled={busy} title="Export preset…" className={ICON_BTN}>
            <Download size={14} strokeWidth={1.5} />
          </button>
          <button onClick={onClose} disabled={!canClose} title="Close" className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {errText !== null && (
            <div className="mb-3 border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>Name</FieldLabel>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. API conventions"
                  className="h-control w-full rounded border border-border bg-surface-2 px-2 text-base text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                />
              </div>
              <div>
                <FieldLabel>Role</FieldLabel>
                <RolePicker role={role} onChange={setRole} />
                <p className="mt-2 text-xs leading-snug text-content-secondary">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <FieldLabel>Directory</FieldLabel>
                  <input
                    value={dir}
                    onChange={(e) => setDir(e.target.value)}
                    placeholder="context"
                    className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <FieldLabel>File name</FieldLabel>
                  <input
                    value={fileName}
                    onChange={(e) => {
                      setFileNameTouched(true);
                      setFileName(e.target.value);
                    }}
                    placeholder="node.md"
                    className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                  />
                </div>
              </div>
              <div className="rounded border border-border-subtle bg-surface-inset px-2.5 py-1.5">
                <span className="font-mono text-xs text-content-secondary">{finalPath}</span>
                {finalPath !== rawPath && (
                  <span className="ml-2 font-mono text-2xs text-content-muted">
                    ({rawPath} already exists — de-duped)
                  </span>
                )}
              </div>
              {protectedPath && (
                <p className="text-xs leading-snug text-danger-text">
                  This path is managed by Cowtext — pick a different directory.
                </p>
              )}
              <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                <div>
                  <FieldLabel>Pinned</FieldLabel>
                  <p className="text-xs text-content-muted">Always in context, not just on demand.</p>
                </div>
                <AmberToggle checked={pinned} onChange={setPinned} />
              </div>
              <AdapterChips pinned={pinned} />
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-2">
              <FieldLabel>Brief</FieldLabel>
              <textarea
                autoFocus
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="One line for Assemble to expand later"
                rows={3}
                className="min-h-[72px] w-full resize-y rounded border border-border bg-surface-2 p-2 text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
              />
              <p className="text-xs leading-snug text-content-muted">
                Feeds both the step-4 preview below and, if you run Assemble, the AI expansion.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <FieldLabel>{finalPath}</FieldLabel>
                {previewTouched && (
                  <button
                    onClick={() => setPreviewTouched(false)}
                    className="font-mono text-2xs text-content-muted underline hover:text-content-secondary"
                  >
                    Reset to template
                  </button>
                )}
              </div>
              <textarea
                value={previewText}
                onChange={(e) => {
                  setPreviewTouched(true);
                  setPreviewText(e.target.value);
                }}
                spellCheck={false}
                className="h-[220px] w-full resize-y rounded border border-border bg-surface-inset p-2 font-mono text-xs leading-relaxed text-content outline-none focus:border-accent-border"
              />
              <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                <div>
                  <FieldLabel>Run Assemble after create</FieldLabel>
                  <p className="text-xs text-content-muted">
                    Expands the brief into a full file via <span className="font-mono">claude -p</span>{" "}
                    — overwrites the preview above.
                  </p>
                </div>
                <AmberToggle checked={runAssemble} onChange={setRunAssemble} />
              </div>
            </div>
          )}
        </div>

        {/* Footer — 50px */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {step === 4
              ? `Creates ${finalPath} and selects it on the canvas.`
              : "Nothing is written until you confirm on step 4."}
          </span>
          {step > 1 && (
            <button onClick={() => goto((step - 1) as 1 | 2 | 3 | 4)} disabled={busy} className={SECONDARY_BTN}>
              Back
            </button>
          )}
          {step < 4 ? (
            <button
              onClick={() => advance((step + 1) as 1 | 2 | 3 | 4)}
              disabled={step === 1 ? !canNext1 : step === 2 ? !canNext2 : false}
              className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
            >
              Next
            </button>
          ) : (
            <button
              onClick={doConfirm}
              disabled={busy || protectedPath}
              className="flex h-control flex-none items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
            >
              <Sparkles size={13} strokeWidth={1.5} />
              {busy ? "· · ·" : "Create node"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
