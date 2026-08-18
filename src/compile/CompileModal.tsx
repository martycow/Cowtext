// Compile modal — the diff-preview trust boundary (CLAUDE.md: compile never
// writes without approval). Snapshot-in / commands-out: it serializes the
// graph store once per preview, talks to Rust only via api.ts, and keeps all
// preview state modal-local. Compile is user-initiated ⇒ accents are blue;
// danger is reserved for handwritten overwrites and failures.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { GRAPH_VERSION, serializeGraph, useGraphStore, type CompileTarget } from "../store/graph";
import { useProjectStore } from "../store/project";
import {
  COMPILE_WARN_LINES,
  COMPILE_WARN_TOKENS,
  compiledTokens,
  formatTokenCount,
  lineCount,
} from "../store/tokens";
import { compilePreview, compileWrite } from "./api";
import { play as sfxPlay } from "../scene/sfx";
import { diffLines, type DiffHunk } from "../ui/diff";
import type { CompilePreview, PreviewFile, ValidationError } from "./types";

type Phase = "loading" | "errors" | "preview" | "writing" | "done" | "failed";

const ALL_TARGETS: readonly CompileTarget[] = ["claude", "agents", "cursor"];

/** The single top-level file each adapter treats as "the" budget gate.
 *  Cursor has no analogous root — its output is a set of `.mdc` rule files —
 *  so it never warns, only totals. */
const ROOT_FILE: Partial<Record<CompileTarget, string>> = {
  claude: "CLAUDE.md",
  agents: "AGENTS.md",
};

interface TargetBudget {
  target: CompileTarget | "agent";
  totalTokens: number;
  warn: boolean;
  warnReason: string | null;
  /** Which threshold tripped `warn` — the fill width always reflects the
   *  token ratio (T3: total tokens for the target), but color/warn can flip
   *  on a *line*-count breach instead. Surfaced as a short inline label so
   *  the two channels never get silently read as the same metric. */
  warnKind: "lines" | "tokens" | null;
}

// ── Small pieces ──────────────────────────────────────────────────────

function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "danger" }) {
  return (
    <span
      className={`inline-flex h-[17px] flex-none items-center rounded-sm border px-1 font-mono text-micro ${
        tone === "danger"
          ? "border-danger bg-danger-surface text-danger-text"
          : "border-border bg-surface-2 text-content-secondary"
      }`}
    >
      {label}
    </span>
  );
}

/** 4-step amber pixel march — never a spinner (DESIGN_SPEC.md). */
function PixelMarch({ caption }: { caption: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-blink bg-amber"
            style={{ animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }}
          />
        ))}
        <span className="h-2 w-2 bg-border" />
      </div>
      <span className="font-pixel text-micro tracking-wide text-amber-text">{caption}</span>
    </div>
  );
}

/** Custom 15px checkbox (DESIGN_SPEC.md: 15px, r-xs) — native inputs render
 *  light-scheme in the webview (no `color-scheme: dark`), so we draw our own,
 *  matching the target-chip check square. Approving is user-initiated ⇒ blue. */
function ApproveCheckbox({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`grid h-[15px] w-[15px] flex-none place-items-center rounded-xs border transition-colors duration-fast disabled:opacity-50 ${
        checked
          ? "border-accent bg-accent"
          : "border-border-strong bg-surface-1 hover:border-accent-border"
      }`}
    >
      {checked && <Check size={11} strokeWidth={3} className="text-content-inverse" />}
    </button>
  );
}

/** One target's budget: slim track (surface-3) + accent fill scaled against
 *  COMPILE_WARN_TOKENS (clamped at 100%), number beside it. Warn flips both
 *  to amber — static amber = warning, never mixed with the blue user accent.
 *  The fill width always reads the *token* ratio; when `warn` was tripped by
 *  the *line* count instead (root file long but not token-heavy), the width
 *  and the color would otherwise imply different things. A short "lines"
 *  tag disambiguates without needing to change what the fill measures. */
function BudgetBar({ target, totalTokens, warn, warnReason, warnKind }: TargetBudget) {
  const pct = Math.min(1, totalTokens / COMPILE_WARN_TOKENS) * 100;
  return (
    <div className="flex items-center gap-1.5" title={warn ? (warnReason ?? undefined) : undefined}>
      <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">{target}</span>
      <div className="h-1.5 w-16 flex-none overflow-hidden rounded-pill bg-surface-3">
        <div
          className={`h-full rounded-pill ${warn ? "bg-amber" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`flex-none font-mono text-2xs ${warn ? "text-amber-text" : "text-content-secondary"}`}
      >
        {`≈${formatTokenCount(totalTokens)}`}
        {warn && warnKind === "lines" && (
          <span className="ml-1 uppercase tracking-wide text-content-muted">(lines)</span>
        )}
      </span>
    </div>
  );
}

function ErrorRow({ err }: { err: ValidationError }) {
  if (err.kind === "cycle") {
    return (
      <li className="flex items-start gap-2 bg-danger-surface px-3 py-2">
        <Badge label="cycle" tone="danger" />
        <span className="min-w-0 break-words font-mono text-xs leading-relaxed text-danger-text">
          {err.nodes.map((n) => n.title).join(" → ")}
        </span>
      </li>
    );
  }
  if (err.kind === "missingFile") {
    return (
      <li className="flex items-start gap-2 bg-danger-surface px-3 py-2">
        <Badge label="missing file" tone="danger" />
        <span className="min-w-0 break-words text-xs leading-relaxed text-content-secondary">
          <span className="font-semibold text-content">{err.title}</span>
          {" — "}
          <span className="font-mono text-danger-text">{err.filePath}</span>
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 bg-danger-surface px-3 py-2">
      <Badge label="broken edge" tone="danger" />
      <span className="min-w-0 break-words font-mono text-xs leading-relaxed text-danger-text">
        {err.edgeKind} edge {err.edgeId} → missing node {err.missingEnd}
      </span>
    </li>
  );
}

function DiffView({ hunks }: { hunks: DiffHunk[] }) {
  if (hunks.length === 0) {
    return (
      <div className="bg-surface-inset px-3 py-2 font-mono text-xs text-content-muted">
        no line changes
      </div>
    );
  }
  return (
    <div className="overflow-x-auto bg-surface-inset py-1 font-mono text-xs leading-[1.6]">
      <div className="min-w-max">
        {hunks.map((h, hi) => (
          <div key={hi}>
            <div className="px-2 text-content-muted">
              {`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`}
            </div>
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
                <span className="inline-block w-9 select-none pr-1 text-right text-content-disabled">
                  {op.oldLine ?? ""}
                </span>
                <span className="inline-block w-9 select-none pr-2 text-right text-content-disabled">
                  {op.newLine ?? ""}
                </span>
                <span className="whitespace-pre pr-3">
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

// ── Per-file section ──────────────────────────────────────────────────

interface FileSectionProps {
  file: PreviewFile;
  hunks: DiffHunk[];
  adds: number;
  dels: number;
  approved: boolean;
  collapsed: boolean;
  frozen: boolean;
  onToggleApproved: () => void;
  onToggleCollapsed: () => void;
}

function FileSection({
  file,
  hunks,
  adds,
  dels,
  approved,
  collapsed,
  frozen,
  onToggleApproved,
  onToggleCollapsed,
}: FileSectionProps) {
  const tok = compiledTokens(file.newContent);
  const ln = lineCount(file.newContent);
  return (
    <section className="border-b border-border-subtle">
      <div
        className="flex h-row cursor-default items-center gap-2 px-3 hover:bg-[var(--surface-hover)]"
        onClick={onToggleCollapsed}
      >
        <ApproveCheckbox
          checked={approved}
          disabled={file.unchanged || frozen}
          label={`Approve ${file.relPath}`}
          onToggle={onToggleApproved}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content" title={file.relPath}>
          {file.relPath}
        </span>
        <span
          className="flex-none whitespace-nowrap rounded-sm border border-border bg-surface-2 px-1 font-mono text-micro text-content-muted"
          title={`≈${tok} tokens · ${ln} lines`}
        >
          {`≈${formatTokenCount(tok)} tok · ${ln} ${ln === 1 ? "line" : "lines"}`}
        </span>
        <Badge label={file.target} />
        {file.oldContent === null ? (
          <span className="flex-none font-mono text-2xs text-accent-text">new file</span>
        ) : file.unchanged ? (
          <span className="flex-none font-mono text-2xs text-content-muted">unchanged</span>
        ) : (
          <span className="flex-none font-mono text-2xs">
            <span className="text-success-text">+{adds}</span>{" "}
            <span className="text-danger-text">−{dels}</span>
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          aria-expanded={!collapsed}
          title={collapsed ? "Show diff" : "Hide diff"}
          className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
        >
          {collapsed ? (
            <ChevronRight size={13} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={13} strokeWidth={1.5} />
          )}
        </button>
      </div>
      {file.handwritten && (
        <div className="border-l-[3px] border-danger bg-danger-surface px-3 py-1.5 text-xs leading-relaxed text-danger-text">
          <span className="break-all font-mono">{file.relPath}</span>
          {": handwritten file — Cowtext did not generate this. Approving will overwrite it."}
        </div>
      )}
      {!collapsed && <DiffView hunks={hunks} />}
    </section>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────

export function CompileModal({ root, onClose }: { root: string; onClose: () => void }) {
  const compileTargets = useGraphStore((s) => s.compileTargets);
  const setCompileTargets = useGraphStore((s) => s.setCompileTargets);

  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<CompilePreview | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [errText, setErrText] = useState<string | null>(null);
  const [written, setWritten] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Pull focus off the trigger button so Tab and Escape act on the modal,
  // not the chrome behind the scrim.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const targetsKey = compileTargets.join(",");

  // On open and on every target-toggle: flush the debounced save so disk and
  // preview agree, then serialize the store snapshot and ask Rust to preview.
  useEffect(() => {
    let live = true;
    setPhase("loading");
    setErrText(null);
    // Drop the previous target set's preview immediately — otherwise the
    // budget row (gated on `phase !== "done"`, not on `phase === "preview"`)
    // would keep showing stale totals from before the toggle while the body
    // already shows the loading state.
    setPreview(null);
    (async () => {
      await useGraphStore.getState().flushSave();
      const s = useGraphStore.getState();
      const graphJson = serializeGraph({
        version: GRAPH_VERSION,
        projectName: s.projectName,
        nodes: s.nodes,
        edges: s.edges,
        compileTargets: s.compileTargets,
      });
      const p = await compilePreview(root, graphJson);
      if (!live) return;
      const app: Record<string, boolean> = {};
      const col: Record<string, boolean> = {};
      for (const f of p.files) {
        app[f.relPath] = !f.unchanged && !f.handwritten;
        col[f.relPath] = f.unchanged;
      }
      setPreview(p);
      setApproved(app);
      setCollapsed(col);
      if (p.errors.length > 0) sfxPlay("error_soft");
      setPhase(p.errors.length > 0 ? "errors" : "preview");
    })().catch((e: unknown) => {
      if (!live) return;
      setPreview(null);
      setErrText(String(e));
      setPhase("failed");
    });
    return () => {
      live = false;
    };
  }, [root, targetsKey]);

  const canClose =
    phase === "preview" || phase === "errors" || phase === "done" || phase === "failed";

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const files = useMemo(() => preview?.files ?? [], [preview]);

  const diffs = useMemo(() => {
    const map = new Map<string, { hunks: DiffHunk[]; adds: number; dels: number }>();
    for (const f of files) {
      const hunks = diffLines(f.oldContent, f.newContent);
      let adds = 0;
      let dels = 0;
      for (const h of hunks) {
        for (const op of h.ops) {
          if (op.type === "add") adds += 1;
          else if (op.type === "del") dels += 1;
        }
      }
      map.set(f.relPath, { hunks, adds, dels });
    }
    return map;
  }, [files]);

  // Per-target totals: every file that adapter produced, changed or not —
  // this is "the total for the compiled output per target" (T3), the true
  // current size of what a target reads into context, not just today's
  // delta. That's deliberate: a root file that's already oversized should
  // keep warning even on a run that happens not to touch it.
  //
  // `TARGET_ROW_ORDER` covers the three selectable adapters plus "agent" —
  // per-node managed context blocks inside .claude/agents/*.md, emitted
  // independently of `compileTargets` (compile.rs PreviewFile.target).
  // "agent" isn't a toggle-able target (ALL_TARGETS stays claude/agents/
  // cursor for the chips above), but its files still carry real token
  // weight and already get a per-file chip in the list below — folding them
  // into their own budget row keeps that weight visible instead of silently
  // dropping it from every total on screen.
  const targetBudgets = useMemo<TargetBudget[]>(() => {
    const TARGET_ROW_ORDER: readonly (CompileTarget | "agent")[] = [...ALL_TARGETS, "agent"];
    const out: TargetBudget[] = [];
    for (const t of TARGET_ROW_ORDER) {
      const targetFiles = files.filter((f) => f.target === t);
      if (targetFiles.length === 0) continue;
      const totalTokens = targetFiles.reduce((sum, f) => sum + compiledTokens(f.newContent), 0);
      const rootName = t === "agent" ? undefined : ROOT_FILE[t];
      const root = rootName !== undefined ? targetFiles.find((f) => f.relPath === rootName) : undefined;
      let warn = false;
      let warnReason: string | null = null;
      let warnKind: "lines" | "tokens" | null = null;
      if (root !== undefined) {
        const rootLines = lineCount(root.newContent);
        const rootTokens = compiledTokens(root.newContent);
        if (rootLines > COMPILE_WARN_LINES) {
          warn = true;
          warnKind = "lines";
          warnReason = `${rootName}: ${rootLines} lines (over ${COMPILE_WARN_LINES})`;
        } else if (rootTokens > COMPILE_WARN_TOKENS) {
          warn = true;
          warnKind = "tokens";
          warnReason = `${rootName}: ≈${formatTokenCount(rootTokens)} tokens (over ${formatTokenCount(COMPILE_WARN_TOKENS)})`;
        }
      }
      out.push({ target: t, totalTokens, warn, warnReason, warnKind });
    }
    return out;
  }, [files]);

  const approvedFiles = files.filter((f) => approved[f.relPath] === true);
  const handwrittenApproved = approvedFiles.filter((f) => f.handwritten).length;
  const frozen = phase === "writing";

  const toggleTarget = (t: CompileTarget) => {
    const next = compileTargets.includes(t)
      ? compileTargets.filter((x) => x !== t)
      : ALL_TARGETS.filter((x) => compileTargets.includes(x) || x === t);
    setCompileTargets(next);
  };

  const doWrite = () => {
    if (approvedFiles.length === 0 || frozen) return;
    setPhase("writing");
    setErrText(null);
    compileWrite(
      root,
      approvedFiles.map((f) => ({ relPath: f.relPath, content: f.newContent })),
    )
      .then((paths) => {
        setWritten(paths);
        setPhase("done");
        sfxPlay("compile_ok");
        // New files (e.g. .cursor/rules/) should appear in the file rail.
        void useProjectStore.getState().rescan();
      })
      .catch((e: unknown) => {
        // Back to the preview with approvals intact; retry allowed.
        setErrText(String(e));
        setPhase("failed");
        sfxPlay("error_soft");
      });
  };

  const showsFileList =
    (phase === "preview" || phase === "writing" || phase === "failed") && preview !== null;

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
        aria-label="Compile"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[1040px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px, title 15/600, mono root right, ✕ */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Compile</span>
          <div className="min-w-0 flex-1" />
          <span
            className="min-w-0 max-w-[300px] truncate font-mono text-2xs text-content-muted"
            title={root}
          >
            {`→ ${root}`}
          </span>
          <button
            onClick={onClose}
            disabled={!canClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent disabled:hover:text-content-disabled"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Target toggles — checkbox chips, persisted via the store */}
        {phase !== "done" && (
          <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle px-4">
            <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
              targets
            </span>
            {ALL_TARGETS.map((t) => {
              const on = compileTargets.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTarget(t)}
                  disabled={frozen}
                  className={`flex h-control-sm items-center gap-1.5 rounded border px-2 font-mono text-xs transition-colors duration-fast disabled:opacity-60 ${
                    on
                      ? "border-accent-border bg-accent-surface text-accent-text"
                      : "border-border bg-surface-2 text-content-muted hover:border-border-strong"
                  }`}
                >
                  <span
                    className={`grid h-[11px] w-[11px] flex-none place-items-center rounded-xs border ${
                      on ? "border-accent bg-accent" : "border-border-strong bg-surface-1"
                    }`}
                  >
                    {on && <Check size={9} strokeWidth={3} className="text-content-inverse" />}
                  </span>
                  {t}
                </button>
              );
            })}
          </div>
        )}

        {/* Budget — one bar per target producing files, sum of that
            target's newContent tokens against COMPILE_WARN_TOKENS */}
        {phase !== "done" && targetBudgets.length > 0 && (
          <div className="flex h-[28px] flex-none items-center gap-4 border-b border-border-subtle px-4">
            <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
              budget
            </span>
            {targetBudgets.map((b) => (
              <BudgetBar key={b.target} {...b} />
            ))}
          </div>
        )}

        {/* Body */}
        <div className="min-h-[46vh] flex-1 overflow-y-auto">
          {phase === "loading" ? (
            <PixelMarch caption="the cow is compiling" />
          ) : phase === "errors" && preview !== null ? (
            <ul className="flex flex-col gap-px py-1">
              {preview.errors.map((err, i) => (
                <ErrorRow key={i} err={err} />
              ))}
            </ul>
          ) : phase === "done" ? (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-sm text-content">
                wrote {written.length} {written.length === 1 ? "file" : "files"}
              </p>
              <ul className="flex flex-col gap-0.5">
                {written.map((p) => (
                  <li key={p} className="font-mono text-xs text-content-secondary">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {phase === "failed" && errText !== null && (
                <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
                  {errText}
                </div>
              )}
              {showsFileList && files.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-content-muted">
                  {compileTargets.length === 0
                    ? "No targets selected — pick at least one above."
                    : "Nothing to compile."}
                </p>
              )}
              {showsFileList &&
                files.map((f) => {
                  const d = diffs.get(f.relPath) ?? { hunks: [], adds: 0, dels: 0 };
                  return (
                    <FileSection
                      key={f.relPath}
                      file={f}
                      hunks={d.hunks}
                      adds={d.adds}
                      dels={d.dels}
                      approved={approved[f.relPath] === true}
                      collapsed={collapsed[f.relPath] === true}
                      frozen={frozen}
                      onToggleApproved={() =>
                        setApproved((a) => ({ ...a, [f.relPath]: a[f.relPath] !== true }))
                      }
                      onToggleCollapsed={() =>
                        setCollapsed((c) => ({ ...c, [f.relPath]: c[f.relPath] !== true }))
                      }
                    />
                  );
                })}
            </>
          )}
        </div>

        {/* Footer — 50px, consequence text left, actions right */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {phase === "errors" && preview !== null ? (
              <>
                {preview.errors.length} problem{preview.errors.length === 1 ? "" : "s"} — nothing
                will be written
              </>
            ) : phase === "done" ? (
              <>done — the graph stays the source of truth</>
            ) : (showsFileList && files.length > 0) || phase === "writing" ? (
              <>
                {approvedFiles.length} of {files.length} files will be written
                {handwrittenApproved > 0 && (
                  <span className="text-danger-text">
                    {` · overwrites ${handwrittenApproved} handwritten file${
                      handwrittenApproved === 1 ? "" : "s"
                    }`}
                  </span>
                )}
              </>
            ) : null}
          </span>
          {phase === "done" ? (
            <button
              onClick={onClose}
              className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
            >
              Close
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={!canClose}
                className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={doWrite}
                disabled={approvedFiles.length === 0 || frozen || phase === "loading" || phase === "errors"}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {frozen ? "· · ·" : "Approve & write"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
