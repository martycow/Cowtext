// New Node wizard — re-cut onto the shared two-pane shell for the v5, 14
// -role taxonomy (WO13_CONTRACT.md §14.2, carries N-C/N-D/N-E). Four steps,
// same header/footer promise as before: nothing is written until Confirm on
// step 4. The right pane is the ONE preview mechanism (`src/ui/PreviewPane`)
// — every step keeps it mounted so the "how this compiles" answer never
// disappears while the user edits.
//
// Live preview mechanism (§10.1, §14.1): a synthetic graph — the real
// store's nodes/edges plus one draft node — is sent to `compile_preview`
// with an `overlay` entry carrying the draft's in-memory body, so the ONE
// real compiler answers "what would this produce" before the file exists on
// disk. Debounced 150ms. The pane shows every file `compile_preview` reports
// as not `unchanged` — a deliberate single-call simplification (a stricter
// "only files THIS node moved" cut would need a second baseline call without
// the draft node; flagged in the lane report) that still answers the
// question this step exists to answer, at one call per keystroke burst.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FolderInput, Sparkles } from "lucide-react";
import {
  GRAPH_VERSION,
  isRenameProtected,
  serializeGraph,
  useGraphStore,
  type BarnGraph,
  type CompileTarget,
  type MemoryNode,
  type NodeRole,
} from "../store/graph";
import { useProjectStore } from "../store/project";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { NODE_TYPE_BY_ROLE, type NodeTypeMeta } from "../config/nodeTypes";
import { resolveLoad, type ResolvedLoad } from "../config/resolveLoad";
import { assembleNode } from "../assemble/api";
import { requestAssemble } from "../assemble/gate";
import { pushToastWithAction } from "../store/toasts";
import { compiledTokens, formatTokenCount } from "../store/tokens";
import { compilePreview } from "../compile/api";
import type { PreviewFile } from "../compile/types";
import { fsApplyBatch, type BatchEntry } from "../fs/api";
import { diffLines, type DiffHunk } from "../ui/diff";
import { TwoPaneModal } from "../ui/TwoPaneModal";
import { PreviewPane, type PreviewTab } from "../ui/PreviewPane";
import { dedupePath, joinDirFile, normalizeDir, normalizeFileName, slugForFile } from "./paths";
import { buildExampleBody, buildRoleSkeleton, splitExampleBody } from "./roleSkeleton";
import { exportWizardPreset, importWizardPreset } from "./preset";
import {
  WIZARD_BLOCKED_HINT,
  WIZARD_FALLBACK_ROLE,
  WIZARD_ROLE_GROUPS,
  isWizardRole,
} from "./roles";

const STEPS: { n: 1 | 2 | 3 | 4; label: string }[] = [
  { n: 1, label: "Identity" },
  { n: 2, label: "Load" },
  { n: 3, label: "Brief" },
  { n: 4, label: "Confirm" },
];

const WEIGHT_GUARD_TOKENS = 400;
const DEBOUNCE_MS = 150;

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

// ── Step 1 — Identity: the tile grid ───────────────────────────────────

const DISAMBIGUATOR_ROLES = ["rule", "invariant", "style"] as const;
const DISAMBIGUATOR_HINT: Record<(typeof DISAMBIGUATOR_ROLES)[number], string> = {
  rule: "A behavior constraint the agent must follow.",
  invariant: "A fact that must stay true.",
  style: "Voice and formatting, not logic.",
};

const TILE_COLS = 2;

function matchesFilter(meta: NodeTypeMeta, query: string): boolean {
  if (query.trim() === "") return true;
  const q = query.trim().toLowerCase();
  return (
    meta.label.toLowerCase().includes(q) ||
    meta.hint.toLowerCase().includes(q) ||
    meta.microExample.toLowerCase().includes(q)
  );
}

function RoleTile({
  meta,
  active,
  dimmed,
  tabIndex,
  tileRef,
  onSelect,
  onFocus,
  onKeyDown,
}: {
  meta: NodeTypeMeta;
  active: boolean;
  dimmed: boolean;
  tabIndex: 0 | -1;
  tileRef: (el: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <button
      ref={tileRef}
      type="button"
      tabIndex={tabIndex}
      onClick={onSelect}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1 rounded border p-2 text-left transition-opacity duration-fast ${
        active ? "border-accent bg-surface-3" : "border-border bg-surface-2 hover:border-border-strong"
      } ${dimmed ? "opacity-40" : "opacity-100"}`}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5" style={{ color: roleVar(meta.role) }}>
        <RoleGlyph role={meta.role} size={13} />
        <span className="min-w-0 truncate text-2xs font-semibold uppercase tracking-wider">
          {meta.label}
        </span>
      </span>
      <span className="w-full min-w-0 text-2xs leading-snug text-content-secondary">{meta.hint}</span>
      <span className="w-full min-w-0 truncate font-mono text-2xs italic text-content-muted" title={meta.microExample}>
        {meta.microExample}
      </span>
    </button>
  );
}

function RoleGrid({ role, onChange }: { role: NodeRole; onChange: (r: NodeRole) => void }) {
  const [filter, setFilter] = useState("");
  const [disambiguatorOpen, setDisambiguatorOpen] = useState(false);
  const flatRoles = useMemo(() => WIZARD_ROLE_GROUPS.flatMap((g) => g.roles), []);
  const [focusedIdx, setFocusedIdx] = useState(() => Math.max(0, flatRoles.indexOf(role)));
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    tileRefs.current[focusedIdx]?.focus();
  }, [focusedIdx]);

  const move = (delta: number) => {
    setFocusedIdx((i) => Math.min(flatRoles.length - 1, Math.max(0, i + delta)));
  };

  const onTileKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(TILE_COLS);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-TILE_COLS);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(flatRoles[focusedIdx]);
    }
  };

  let flatIdx = -1;

  return (
    <div className="flex flex-col gap-3">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter types…"
        className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
      />
      <button
        type="button"
        onClick={() => setDisambiguatorOpen((v) => !v)}
        className="self-start text-2xs text-accent-text underline decoration-dotted"
      >
        {disambiguatorOpen ? "Hide" : "What's the difference between Rule, Invariant and Style?"}
      </button>
      {disambiguatorOpen && (
        <div className="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-inset p-2">
          {DISAMBIGUATOR_ROLES.map((r) => {
            const meta = NODE_TYPE_BY_ROLE[r];
            return (
              <div key={r} className="flex items-start gap-2 text-2xs leading-snug">
                <span
                  className="flex-none font-mono uppercase tracking-wider"
                  style={{ color: roleVar(r) }}
                >
                  {meta.label}
                </span>
                <span className="min-w-0 flex-1 font-mono italic text-content-muted">
                  {meta.microExample}
                </span>
                <span className="min-w-0 flex-1 text-content-secondary">{DISAMBIGUATOR_HINT[r]}</span>
              </div>
            );
          })}
        </div>
      )}

      {WIZARD_ROLE_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-content-muted">
            {group.label}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {group.roles.map((r) => {
              flatIdx += 1;
              const idx = flatIdx;
              const meta = NODE_TYPE_BY_ROLE[r];
              return (
                <RoleTile
                  key={r}
                  meta={meta}
                  active={r === role}
                  dimmed={!matchesFilter(meta, filter)}
                  tabIndex={idx === focusedIdx ? 0 : -1}
                  tileRef={(el) => {
                    tileRefs.current[idx] = el;
                  }}
                  onSelect={() => {
                    setFocusedIdx(idx);
                    onChange(r);
                  }}
                  onFocus={() => setFocusedIdx(idx)}
                  onKeyDown={onTileKeyDown}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Step 2 — Load: root-load control + weight guard ────────────────────

function loadSentenceFor(
  policy: ResolvedLoad,
  meta: NodeTypeMeta,
  targets: readonly CompileTarget[],
): string {
  switch (policy) {
    case "always":
      return "Always included in context, for every request.";
    case "on-invoke":
      return "Runs only when you call it — never inlined.";
    case "on-demand":
      return meta.loadLocked
        ? "Loads itself when relevant — Claude decides, not an edge."
        : "Read when another node references it, or opened directly.";
    case "on-glob":
      return "Applies once a link tells it which files to watch.";
    case "excluded":
      return targets.length === 0
        ? "Not compiled anywhere — no compile targets are selected."
        : "Not yet reachable — link it from another node, or set Root load to Always.";
  }
}

function LockedBadge({ meta, rootLoad, targets }: { meta: NodeTypeMeta; rootLoad: boolean; targets: readonly CompileTarget[] }) {
  const cursorCaveat =
    rootLoad && targets.includes("cursor")
      ? " Cursor has no equivalent, so this still applies to every Cursor request."
      : "";
  return (
    <div className="flex flex-col gap-1 rounded border border-border-subtle bg-surface-inset px-2.5 py-2">
      <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">Root load</span>
      <span className="text-xs leading-snug text-content-secondary">
        {meta.lockedReason}
        {cursorCaveat}
      </span>
    </div>
  );
}

function RootLoadControl({ rootLoad, onChange }: { rootLoad: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">Root load</span>
      <div className="flex overflow-hidden rounded border border-border">
        <button
          type="button"
          onClick={() => onChange(true)}
          aria-pressed={rootLoad}
          className={`flex-1 px-2 py-1.5 text-left text-xs transition-colors duration-fast ${
            rootLoad ? "bg-amber-surface text-amber-text" : "bg-surface-2 text-content-secondary hover:bg-surface-3"
          }`}
        >
          <span className="block font-semibold">Always</span>
          <span className="block text-2xs leading-snug">In context for every request.</span>
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          aria-pressed={!rootLoad}
          className={`flex-1 border-l border-border px-2 py-1.5 text-left text-xs transition-colors duration-fast ${
            !rootLoad ? "bg-accent-surface text-accent-text" : "bg-surface-2 text-content-secondary hover:bg-surface-3"
          }`}
        >
          <span className="block font-semibold">On demand</span>
          <span className="block text-2xs leading-snug">Agent reads it when relevant.</span>
        </button>
      </div>
    </div>
  );
}

// ── Step 4 — diff list ──────────────────────────────────────────────────

function badgeFor(f: PreviewFile): { label: string; tone: "accent" | "neutral" } {
  if (f.oldContent === null) return { label: "create", tone: "accent" };
  return { label: "modify", tone: "neutral" };
}

function MiniDiff({ hunks }: { hunks: DiffHunk[] }) {
  if (hunks.length === 0) {
    return <div className="bg-surface-inset px-2 py-1.5 font-mono text-2xs text-content-muted">no line changes</div>;
  }
  return (
    <div className="overflow-x-auto bg-surface-inset py-1 font-mono text-2xs leading-[1.6]">
      <div className="min-w-max">
        {hunks.map((h, hi) => (
          <div key={hi}>
            <div className="px-2 text-content-muted">{`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`}</div>
            {h.ops.map((op, oi) => (
              <div
                key={oi}
                className={
                  op.type === "add"
                    ? "bg-success-surface text-success-text"
                    : op.type === "del"
                      ? "bg-danger-surface text-danger-text"
                      : "text-content-secondary"
                }
              >
                <span className="whitespace-pre px-2">
                  {(op.type === "add" ? "+" : op.type === "del" ? "-" : " ") + op.text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Same 15px/r-xs recipe as `CompileModal.tsx`'s `ApproveCheckbox` — one
 *  more place making the same "will this be written" decision, so it uses
 *  the same affordance rather than a second one. Not exported from
 *  CompileModal (module-private there), so redrawn here rather than
 *  reaching into another lane's file for an unexported component. */
function ApproveCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`grid h-[15px] w-[15px] flex-none place-items-center rounded-xs border transition-colors duration-fast ${
        checked ? "border-accent bg-accent" : "border-border-strong bg-surface-1 hover:border-accent-border"
      }`}
    >
      {checked && <Check size={11} strokeWidth={3} className="text-content-inverse" />}
    </button>
  );
}

function DiffFileRow({
  file,
  approved,
  onToggleApproved,
}: {
  file: PreviewFile;
  approved: boolean;
  onToggleApproved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const badge = badgeFor(file);
  const hunks = useMemo(() => diffLines(file.oldContent, file.newContent), [file.oldContent, file.newContent]);
  return (
    <div className="border-b border-border-subtle">
      <div
        className="flex h-row w-full cursor-default items-center gap-2 px-2 hover:bg-[var(--surface-hover)]"
        onClick={() => setOpen((v) => !v)}
      >
        <ApproveCheckbox
          checked={approved}
          label={`Write ${file.relPath}`}
          onToggle={onToggleApproved}
        />
        <span
          className={`flex-none rounded-sm border px-1 font-mono text-micro ${
            badge.tone === "accent"
              ? "border-accent-border bg-accent-surface text-accent-text"
              : "border-border bg-surface-2 text-content-secondary"
          }`}
        >
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content" title={file.relPath}>
          {file.relPath}
        </span>
        {file.handwritten && (
          <span className="flex-none rounded-sm border border-danger bg-danger-surface px-1 font-mono text-micro text-danger-text">
            handwritten
          </span>
        )}
      </div>
      {/* D3 — same wording as CompileModal.tsx's handwritten banner, same
          affordance for the same decision. */}
      {file.handwritten && (
        <div className="border-l-[3px] border-danger bg-danger-surface px-3 py-1.5 text-xs leading-relaxed text-danger-text">
          <span className="break-all font-mono">{file.relPath}</span>
          {": handwritten file — Cowtext did not generate this. Approving will overwrite it."}
        </div>
      )}
      {open && <MiniDiff hunks={hunks} />}
    </div>
  );
}

// ── The wizard ───────────────────────────────────────────────────────────

interface DraftState {
  name: string;
  role: NodeRole;
  dir: string;
  fileName: string;
  fileNameTouched: boolean;
  rootLoad: boolean;
  brief: string;
  body: string;
  bodyTouched: boolean;
  good: string;
  bad: string;
}

/** Entering "example" seeds the two-field editor from the current body
 *  (splitExampleBody), preserving prior work per C5 — a body that predates
 *  the Good/Bad structure lands whole into Good rather than vanishing. */
function seedGoodBad(body: string): { good: string; bad: string } {
  const split = splitExampleBody(body);
  if (split.good !== "" || split.bad !== "") return split;
  const withoutHeading = body.replace(/^#[^\n]*\n+/, "").trim();
  return withoutHeading === "" ? { good: "", bad: "" } : { good: withoutHeading, bad: "" };
}

export function NodeWizard({
  root,
  initialPosition,
  onClose,
}: {
  root: string;
  initialPosition: { x: number; y: number } | (() => { x: number; y: number });
  onClose: () => void;
}) {
  const createNodeFrom = useGraphStore((s) => s.createNodeFrom);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const compileTargets = useGraphStore((s) => s.compileTargets);
  const projectName = useGraphStore((s) => s.projectName);
  const files = useProjectStore((s) => s.files);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [maxStep, setMaxStep] = useState<1 | 2 | 3 | 4>(1);

  const [d, setD] = useState<DraftState>({
    name: "",
    role: "rule",
    dir: "context",
    fileName: "",
    fileNameTouched: false,
    rootLoad: false,
    brief: "",
    body: "",
    bodyTouched: false,
    good: "",
    bad: "",
  });

  const [runAssemble, setRunAssemble] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errText, setErrText] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [activeTargetKey, setActiveTargetKey] = useState<string>("claude");

  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);
  // D3 (coordinator audit) — per-file approval for step 4, same idiom as
  // `CompileModal.tsx`'s `approved` state: a handwritten file (Cowtext did
  // not generate it) starts UNCHECKED; every other changed/new file starts
  // checked. Re-derived whenever a fresh preview lands (CompileModal does
  // the same on every `compilePreview` resolve) — a manual untick made
  // mid-typing is not expected to survive a body edit that changes what the
  // preview even contains.
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const f of previewFiles) next[f.relPath] = !f.handwritten;
    setApproved(next);
  }, [previewFiles]);
  const previewSeq = useRef(0);

  const panelRef = useRef<HTMLDivElement>(null);
  // TwoPaneModal owns Escape/backdrop-click handling itself and always
  // calls the `onClose` it was given — `guardedClose` is the busy-gate this
  // component used to apply with its own window keydown listener pre-WO13;
  // routing it through the shell's single `onClose` prop instead keeps that
  // gate without a second Escape handler racing the shell's.
  const canClose = !busy;
  const guardedClose = () => {
    if (canClose) onClose();
  };

  const meta = NODE_TYPE_BY_ROLE[d.role];

  // Filename auto-slugs from the name until the user edits it directly.
  useEffect(() => {
    if (d.fileNameTouched) return;
    setD((s) => ({ ...s, fileName: `${slugForFile(s.name)}.md` }));
  }, [d.name, d.fileNameTouched]);

  // Body auto-syncs from the role skeleton until the user edits it
  // directly (any role) — switching role/name/brief before that point can
  // never destroy work because there is none yet (C5).
  useEffect(() => {
    if (d.bodyTouched) return;
    setD((s) => ({ ...s, body: buildRoleSkeleton(s.name, s.role, s.brief) }));
  }, [d.name, d.role, d.brief, d.bodyTouched]);

  // Entering "example" seeds good/bad once, from whatever body exists.
  const prevRole = useRef(d.role);
  useEffect(() => {
    if (d.role === "example" && prevRole.current !== "example") {
      const { good, bad } = seedGoodBad(d.body);
      setD((s) => ({ ...s, good, bad }));
    }
    prevRole.current = d.role;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seed on role transition
  }, [d.role]);

  const takenPaths = useMemo(
    () => new Set([...nodes.map((n) => n.filePath), ...files.map((f) => f.relPath)]),
    [nodes, files],
  );
  const normalizedDir = normalizeDir(d.dir);
  const normalizedFileName = normalizeFileName(d.fileName, slugForFile(d.name));
  const rawPath = joinDirFile(normalizedDir, normalizedFileName);
  const finalPath = dedupePath(rawPath, takenPaths);
  const protectedPath = isRenameProtected(finalPath);

  const bodyContent = d.role === "example" ? buildExampleBody(d.name, d.brief, d.good, d.bad) : d.body;

  const canNext1 = d.name.trim() !== "";
  const canNext2 = !protectedPath;
  const effectiveMaxStep: 1 | 2 | 3 | 4 = !canNext1 ? 1 : !canNext2 ? 2 : maxStep;

  const goto = (n: number) => {
    if (n < 1 || n > 4 || n > effectiveMaxStep) return;
    setStep(n as 1 | 2 | 3 | 4);
  };
  const advance = (n: 1 | 2 | 3 | 4) => {
    setStep(n);
    setMaxStep((m) => (n > m ? n : m));
  };

  // ── Draft graph + live preview (§10.1, debounced 150ms) ──────────────

  const draftGraph: BarnGraph = useMemo(() => {
    const draftNode: MemoryNode = {
      id: "__draft__",
      title: d.name.trim() === "" ? meta.label : d.name.trim(),
      role: d.role,
      brief: d.brief.trim(),
      filePath: finalPath,
      readOrder: nodes.reduce((m, n) => Math.max(m, n.readOrder), 0) + 1,
      ...(d.rootLoad ? { rootLoad: "always" as const } : {}),
      position: { x: 0, y: 0 },
    };
    return {
      version: GRAPH_VERSION,
      projectName,
      nodes: [...nodes, draftNode],
      edges,
      compileTargets,
    };
  }, [d.name, d.role, d.brief, d.rootLoad, finalPath, nodes, edges, compileTargets, projectName, meta.label]);

  const resolved = useMemo(() => resolveLoad("__draft__", draftGraph), [draftGraph]);

  useEffect(() => {
    const mySeq = (previewSeq.current += 1);
    const timer = setTimeout(() => {
      const graphJson = serializeGraph(draftGraph);
      // Cross-lane dependency (§10.1, R1): `compilePreview`'s 3rd arg
      // (`overlay`) is not yet landed in `src/compile/api.ts` — this call is
      // written against the FROZEN contract shape and will type-check once
      // R1 lands it. Until then this is a real, expected `tsc` red, not a
      // bug in this file (tree is red until integration, per dispatch).
      compilePreview(root, graphJson, [{ relPath: finalPath, content: bodyContent }])
        .then((res) => {
          if (previewSeq.current !== mySeq) return; // superseded
          setPreviewFiles(res.files.filter((f) => !f.unchanged));
        })
        .catch(() => {
          if (previewSeq.current !== mySeq) return;
          setPreviewFiles([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftGraph, finalPath, bodyContent, root]);

  const tabs: PreviewTab[] = useMemo(() => {
    const byTarget = new Map<string, PreviewFile[]>();
    for (const f of previewFiles) {
      const arr = byTarget.get(f.target) ?? [];
      arr.push(f);
      byTarget.set(f.target, arr);
    }
    const order: (CompileTarget | "agent")[] = ["claude", "agents", "cursor", "copilot", "gemini", "agent"];
    return order
      .filter((k) => byTarget.has(k))
      .map((k) => ({ key: k, label: k, files: byTarget.get(k) ?? [] }));
  }, [previewFiles]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTargetKey)) {
      setActiveTargetKey(tabs[0].key);
    }
  }, [tabs, activeTargetKey]);

  const emptyExample = useMemo(() => {
    if (d.name.trim() !== "" || d.bodyTouched) return undefined;
    return {
      relPath: `context/${slugForFile(meta.label)}-example.md`,
      content: buildRoleSkeleton(meta.label, d.role, meta.microExample),
    };
  }, [d.name, d.bodyTouched, d.role, meta]);

  const tokenEstimate = compiledTokens(bodyContent);
  // D3 — the step-4 summary line's counts, same shape as CompileModal's
  // "N of M files will be written · overwrites K handwritten files".
  const approvedGeneratedCount = previewFiles.filter((f) => approved[f.relPath] === true).length;
  const handwrittenApprovedCount = previewFiles.filter(
    (f) => f.handwritten && approved[f.relPath] === true,
  ).length;
  const weightGuardActive = step === 2 && d.rootLoad && tokenEstimate > WEIGHT_GUARD_TOKENS;

  const right = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PreviewPane
        tabs={tabs}
        activeKey={activeTargetKey}
        onTab={setActiveTargetKey}
        emptyExample={emptyExample}
        loadSentence={loadSentenceFor(resolved.policy, meta, compileTargets)}
        tokenEstimate={tokenEstimate}
      />
      {weightGuardActive && (
        <div className="flex-none rounded border-l-[3px] border-l-amber bg-amber-surface px-2.5 py-2 text-2xs leading-snug text-amber-text">
          ≈{formatTokenCount(tokenEstimate)} tokens, always in context — that's on every request.{" "}
          <button
            type="button"
            onClick={() => setD((s) => ({ ...s, rootLoad: false }))}
            className="underline decoration-dotted"
          >
            Switch to On demand
          </button>
        </div>
      )}
    </div>
  );

  // ── Import / export ────────────────────────────────────────────────

  const doImport = () => {
    setErrText(null);
    setNoticeText(null);
    importWizardPreset()
      .then((imported) => {
        if (imported === null) return;
        const { fields, blockedRole } = imported;
        setD((s) => ({
          ...s,
          name: fields.name,
          role: fields.role,
          dir: fields.dir,
          fileName: fields.fileName,
          fileNameTouched: true,
          rootLoad: fields.pinned,
          brief: fields.brief,
          body: fields.content,
          bodyTouched: true,
        }));
        setStep(1);
        setMaxStep(4);
        if (blockedRole !== null) {
          setNoticeText(
            `This preset asked for the "${blockedRole}" role, which the New node wizard cannot create — it was changed to "${fields.role}". ${WIZARD_BLOCKED_HINT}`,
          );
        }
      })
      .catch((e: unknown) => setErrText(String(e)));
  };

  const doExport = () => {
    if (d.name.trim() === "") {
      setErrText("Name a node before exporting a preset.");
      return;
    }
    setErrText(null);
    exportWizardPreset({
      name: d.name.trim(),
      role: d.role,
      dir: normalizedDir,
      fileName: normalizedFileName,
      pinned: d.rootLoad,
      brief: d.brief,
      content: bodyContent,
    }).catch((e: unknown) => setErrText(String(e)));
  };

  // ── Confirm (step 4) ───────────────────────────────────────────────

  const doConfirm = () => {
    if (busy) return;
    if (protectedPath) {
      setErrText("This path is managed by Cowtext — choose a different directory before creating the node.");
      setStep(2);
      return;
    }
    if (!isWizardRole(d.role)) {
      setD((s) => ({ ...s, role: WIZARD_FALLBACK_ROLE }));
      setNoticeText(
        `The New node wizard cannot create "${d.role}" nodes, so the role was reset to "${WIZARD_FALLBACK_ROLE}". ${WIZARD_BLOCKED_HINT} Review the role, then confirm again.`,
      );
      setStep(1);
      return;
    }
    setBusy(true);
    setErrText(null);
    setNoticeText(null);
    (async () => {
      // D3 (coordinator audit, CRITICAL) — only the files the user has
      // explicitly ticked are ever written. A `handwritten` file starts
      // UNCHECKED (the `approved` effect above) and is never written unless
      // the user turns it on, matching `CompileModal.tsx`'s existing opt-in
      // idiom exactly (same default, same wording, same "N of M … overwrites
      // K handwritten" footer language) rather than inventing a second
      // pattern for the same decision. An unticked handwritten file is a
      // VISIBLE exclusion (its checkbox is plainly unchecked, and the step-4
      // summary line says so) — never a silent narrowing.
      const approvedGenerated = previewFiles.filter((f) => approved[f.relPath] === true);
      const generatedBatch: BatchEntry[] = approvedGenerated.map((f) => ({
        relPath: f.relPath,
        content: f.newContent,
      }));

      // D13 (audit, LOW) — the node's own file used to be written TWICE:
      // once here via fs_apply_batch, once more by createNodeFrom below.
      // Rather than batch it here and let createNodeFrom redundantly
      // overwrite the same bytes, fs_apply_batch below covers ONLY the
      // generated derivatives; the node's own file has exactly one writer
      // (createNodeFrom). The inverse for that one entry is constructed by
      // hand — before Confirm the path did not exist (finalPath is deduped
      // against every current node AND project file, so it can never
      // collide with something already on disk), so "undo" for it is
      // unconditionally "delete" (`content: null`), exactly what
      // fs_apply_batch's own inverse convention would have produced anyway.
      let generatedInverse: BatchEntry[];
      try {
        generatedInverse = generatedBatch.length > 0 ? await fsApplyBatch(root, generatedBatch) : [];
      } catch (e) {
        setErrText(String(e));
        setBusy(false);
        return;
      }
      const inverse: BatchEntry[] = [{ relPath: finalPath, content: null }, ...generatedInverse];

      const newId = await createNodeFrom({
        title: d.name.trim(),
        role: d.role,
        filePath: finalPath,
        brief: d.brief.trim(),
        pinned: d.rootLoad,
        content: bodyContent,
        position: typeof initialPosition === "function" ? initialPosition() : initialPosition,
      });

      // Left untouched = not ticked at Confirm — in practice these are the
      // handwritten files that started unchecked (a user CAN uncheck a
      // non-handwritten one too, so this counts "skipped", not
      // "handwritten", to stay accurate either way).
      const skippedCount = previewFiles.length - approvedGenerated.length;
      pushToastWithAction({
        severity: "success",
        title: "Node created",
        // D13 — the agent modal's memory-folder detail is the precedent
        // ("Undo removes the agent file only — the memory folder stays.").
        // Undo here removes every file it wrote, but §12.3 forbids the
        // graph undo stack from learning about files, so the node itself
        // stays on the canvas (missing-file badge) until removed by hand —
        // that asymmetry used to go unsaid; now it doesn't.
        detail:
          (generatedBatch.length > 0 ? `${generatedBatch.length + 1} files written. ` : "") +
          "Undo removes the written file(s) only — the node stays on the canvas." +
          (skippedCount > 0
            ? ` ${skippedCount} file${skippedCount === 1 ? "" : "s"} left untouched.`
            : ""),
        action: {
          label: "Undo",
          run: async () => {
            await fsApplyBatch(root, inverse);
          },
        },
      });

      if (newId !== null && runAssemble) {
        try {
          await useGraphStore.getState().flushSave();
          const s = useGraphStore.getState();
          const graphJson = serializeGraph({
            version: GRAPH_VERSION,
            projectName: s.projectName,
            nodes: s.nodes,
            edges: s.edges,
            compileTargets: s.compileTargets,
          });
          requestAssemble({
            root,
            graphJson,
            nodeId: newId,
            mode: "assemble",
            instruction: null,
            onApprove: async () => {
              useGraphStore.getState().setAssembleStatus(newId, "queued");
              try {
                await assembleNode(root, graphJson, newId);
              } catch {
                if (useGraphStore.getState().assembleStatus[newId] === "queued") {
                  useGraphStore.getState().setAssembleStatus(newId, "idle");
                }
              }
            },
          });
        } catch {
          // flush/serialize failed — the node still exists; nothing to roll back.
        }
      }
      onClose();
    })().catch((e: unknown) => {
      setErrText(String(e));
      setBusy(false);
    });
  };

  const footer = (
    <div className="flex flex-none items-center gap-2">
      {step > 1 && (
        <button onClick={() => goto(step - 1)} disabled={busy} className={SECONDARY_BTN}>
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
  );

  const left = (
    <div ref={panelRef}>
      {errText !== null && (
          <div className="mb-3 border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
            {errText}
          </div>
        )}
        {noticeText !== null && (
          <div className="mb-3 border-l-[3px] border-l-warning bg-warning-surface px-3 py-2 text-xs leading-relaxed text-warning-text">
            {noticeText}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <FieldLabel>Name</FieldLabel>
              <input
                autoFocus
                value={d.name}
                onChange={(e) => setD((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. API conventions"
                className="h-control w-full rounded border border-border bg-surface-2 px-2 text-base text-content outline-none placeholder:text-content-muted focus:border-accent-border"
              />
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <RoleGrid
                role={d.role}
                onChange={(r) => {
                  setNoticeText(null);
                  setD((s) => ({ ...s, role: r }));
                }}
              />
              <p className="mt-1 text-xs leading-snug text-content-muted">{WIZARD_BLOCKED_HINT}</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <FieldLabel>Directory</FieldLabel>
                <input
                  value={d.dir}
                  onChange={(e) => setD((s) => ({ ...s, dir: e.target.value }))}
                  placeholder="context"
                  className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                />
              </div>
              <div className="min-w-0 flex-1">
                <FieldLabel>File name</FieldLabel>
                <input
                  value={d.fileName}
                  onChange={(e) => setD((s) => ({ ...s, fileName: e.target.value, fileNameTouched: true }))}
                  placeholder="node.md"
                  className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                />
              </div>
            </div>
            <div className="rounded border border-border-subtle bg-surface-inset px-2.5 py-1.5">
              <span className="font-mono text-xs text-content-secondary">{finalPath}</span>
              {finalPath !== rawPath && (
                <span className="ml-2 font-mono text-2xs text-content-muted">({rawPath} already exists — de-duped)</span>
              )}
            </div>
            {protectedPath && (
              <p className="text-xs leading-snug text-danger-text">
                This path is managed by Cowtext — pick a different directory.
              </p>
            )}

            <div className="border-t border-border-subtle pt-3">
              {meta.loadLocked ? (
                <LockedBadge meta={meta} rootLoad={d.rootLoad} targets={compileTargets} />
              ) : (
                <>
                  <RootLoadControl rootLoad={d.rootLoad} onChange={(v) => setD((s) => ({ ...s, rootLoad: v }))} />
                  {meta.defaultLoad === "on-glob" && (
                    <p className="mt-2 text-2xs leading-snug text-content-muted">
                      {meta.label} nodes usually apply to matching files once linked — draw a guarded edge
                      into it from another node after creating it to set that up.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <div>
              <FieldLabel>Brief</FieldLabel>
              <textarea
                value={d.brief}
                onChange={(e) => setD((s) => ({ ...s, brief: e.target.value }))}
                placeholder="One line for Assemble to expand later"
                rows={2}
                className="min-h-[48px] w-full resize-y rounded border border-border bg-surface-2 p-2 text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
              />
            </div>

            {d.role === "example" ? (
              <div className="flex flex-col gap-3">
                <div>
                  <FieldLabel>Good</FieldLabel>
                  <textarea
                    autoFocus
                    value={d.good}
                    onChange={(e) => setD((s) => ({ ...s, good: e.target.value, bodyTouched: true }))}
                    placeholder="What to do — a concrete instance"
                    rows={4}
                    className="min-h-[96px] w-full resize-y rounded border border-border bg-surface-2 p-2 font-mono text-xs leading-relaxed text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                  />
                </div>
                <div>
                  <FieldLabel>Bad</FieldLabel>
                  <textarea
                    value={d.bad}
                    onChange={(e) => setD((s) => ({ ...s, bad: e.target.value, bodyTouched: true }))}
                    placeholder="What not to do — a concrete instance"
                    rows={4}
                    className="min-h-[96px] w-full resize-y rounded border border-border bg-surface-2 p-2 font-mono text-xs leading-relaxed text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <FieldLabel>Body</FieldLabel>
                  {d.bodyTouched && (
                    <button
                      onClick={() => setD((s) => ({ ...s, bodyTouched: false }))}
                      className="font-mono text-2xs text-content-muted underline hover:text-content-secondary"
                    >
                      Reset to template
                    </button>
                  )}
                </div>
                <textarea
                  autoFocus
                  value={d.body}
                  onChange={(e) => setD((s) => ({ ...s, body: e.target.value, bodyTouched: true }))}
                  placeholder={meta.microExample}
                  spellCheck={false}
                  className="h-[260px] w-full resize-y rounded border border-border bg-surface-inset p-2 font-mono text-xs leading-relaxed text-content outline-none focus:border-accent-border"
                />
                {d.role === "command" && (
                  <p className="mt-1 text-2xs leading-snug text-content-muted">
                    <span className="font-mono">$ARGUMENTS</span> is substituted at invocation.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-end border-t border-border-subtle pt-2 font-mono text-2xs text-content-muted">
              ≈{formatTokenCount(tokenEstimate)} tok
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-snug text-content-secondary">
              Creates {finalPath}.{" "}
              {previewFiles.length === 0
                ? "No other files change."
                : `${approvedGeneratedCount} of ${previewFiles.length} additional ${
                    previewFiles.length === 1 ? "file" : "files"
                  } will be written` +
                  (handwrittenApprovedCount > 0
                    ? ` — overwrites ${handwrittenApprovedCount} handwritten file${handwrittenApprovedCount === 1 ? "" : "s"}`
                    : "") +
                  "."}
            </p>
            <div className="rounded border border-border-subtle">
              <div className="flex h-row items-center gap-2 border-b border-border-subtle bg-surface-2 px-2">
                <span className="flex-none rounded-sm border border-accent-border bg-accent-surface px-1 font-mono text-micro text-accent-text">
                  create
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-content">{finalPath}</span>
              </div>
              {previewFiles.map((f) => (
                <DiffFileRow
                  key={f.relPath}
                  file={f}
                  approved={approved[f.relPath] === true}
                  onToggleApproved={() =>
                    setApproved((s) => ({ ...s, [f.relPath]: !(s[f.relPath] === true) }))
                  }
                />
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-border-subtle pt-3">
              <div>
                <FieldLabel>Run Assemble after create</FieldLabel>
                <p className="text-xs text-content-muted">
                  Expands the brief into a full file via <span className="font-mono">claude -p</span> — overwrites the body above.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={runAssemble}
                onClick={() => setRunAssemble((v) => !v)}
                className={`relative h-[19px] w-[34px] flex-none rounded-pill border transition-colors duration-fast ${
                  runAssemble ? "border-amber-border bg-amber-surface" : "border-border-strong bg-surface-2"
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[13px] w-[13px] rounded-pill transition-all duration-fast ${
                    runAssemble ? "left-[16px] bg-amber" : "left-[2px] bg-content-muted"
                  }`}
                />
              </button>
            </div>
          </div>
        )}
    </div>
  );

  return (
    <TwoPaneModal
      title="New node"
      steps={STEPS}
      currentStep={step}
      onStep={goto}
      headerExtras={
        <Fragment>
          <button onClick={doImport} disabled={busy} title="Import preset…" className={ICON_BTN}>
            <FolderInput size={14} strokeWidth={1.5} />
          </button>
          <button onClick={doExport} disabled={busy} title="Export preset…" className={ICON_BTN}>
            <Download size={14} strokeWidth={1.5} />
          </button>
        </Fragment>
      }
      onClose={guardedClose}
      footerNote="Nothing is written until you confirm on step 4."
      right={right}
      left={left}
      footer={footer}
    />
  );
}
