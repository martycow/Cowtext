// Task context modal (WO06_CONTRACT.md §4, §10.3) — the product's whole
// pitch made visible: shows exactly which Memory Nodes a task's session
// would receive, why each one is in there, a token estimate, and the
// compiled body itself, and lets the user Save it
// (`.cowtext/context/task-<id>.md`). Launching a session with the context
// injected happens elsewhere now — the topbar's single Run button, via
// RunSessionDialog, which prefills the task from the board's own selection
// (F3, WO12).
//
// Frozen call-site signature (contract §10.3) — U1 mounts this from the
// board / Inspector task panel against exactly this interface; it must not
// change without a reported deviation.
//
// Same modal chrome, focus-hold-on-Cancel and Esc discipline as
// HandoffModal/RunSessionDialog — no new UI primitive. Local PixelMarch/
// ContentWell copies, per the established "modals never import across
// feature dirs" idiom (HandoffModal.tsx).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { GRAPH_VERSION, serializeGraph, useGraphStore, type MemoryNode } from "../store/graph";
import { useTaskLinksStore } from "../store/tasklinks";
import { ctxPercent, formatTokenCount, tokensForBytes } from "../store/tokens";
import { alwaysLoadedNodeIds } from "../config/resolveLoad";
import { taskContextPreview, taskContextWrite, TASK_CONTEXT_MAX_BYTES, type TaskContext, type TaskContextError } from "./api";

type Phase = "loading" | "ready" | "empty" | "error";

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

function errorText(e: TaskContextError): string {
  switch (e.kind) {
    case "emptySubgraph":
      return "This task's subgraph is empty — attach a Memory Node, pin one project-wide, or set a parent goal.";
    case "unknownTask":
      return `No task or tasklinks entry carries the id "${e.taskId}".`;
    case "parentCycle":
      return `Goal-ancestry cycle: ${e.path.join(" → ")}.`;
    case "missingFile":
      return `${e.nodeId} — file not found on disk: ${e.filePath}`;
    case "compile":
      return e.message;
  }
}

type Bucket = "seed" | "always" | "ancestry" | "closure";

const BUCKET_LABEL: Record<Bucket, string> = {
  seed: "linked to this task",
  always: "always in context",
  ancestry: "inherited from parent goal",
  closure: "pulled in via imports",
};

function NodeRow({ node, id }: { node: MemoryNode | undefined; id: string }) {
  return (
    <li className="flex items-center gap-2 px-3 py-1">
      {node !== undefined ? (
        <>
          <span style={{ color: roleVar(node.role) }}>
            <RoleGlyph role={node.role} size={11} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-content">{node.title}</span>
          <span className="flex-none font-mono text-2xs text-content-muted">{node.role}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-content-disabled" title={id}>
          {id} (not in the local graph)
        </span>
      )}
    </li>
  );
}

// F3 — launching moved to the single RunSessionDialog (reachable from the
// topbar Run button, prefilled from the board's task selection); this modal
// is preview/save only now. `onLaunched` stays in the frozen §10.3 call-site
// signature so TasksBoard.tsx (a different lane's file) doesn't need an
// edit — kept on `props` rather than destructured, since nothing inside
// calls it anymore.
export function TaskContextModal(props: {
  root: string;
  taskId: string;
  taskName: string;
  onClose: () => void;
  onLaunched?: (sessionId: string) => void;
}) {
  const { root, taskId, taskName, onClose } = props;
  const [phase, setPhase] = useState<Phase>("loading");
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [errors, setErrors] = useState<TaskContextError[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saveBusy, setSaveBusy] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(true);

  const link = useTaskLinksStore((s) => s.linkFor(taskId));
  const linksRoot = useTaskLinksStore((s) => s.root);
  const loadLinks = useTaskLinksStore((s) => s.load);
  const ancestryChain = useTaskLinksStore((s) => s.ancestryChain);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);

  useEffect(() => {
    liveRef.current = true;
    panelRef.current?.focus();
    return () => {
      liveRef.current = false;
    };
  }, []);

  // Closing is blocked while a Save write is in flight (HandoffModal idiom)
  // — its outcome must be seen, never silently discarded.
  const canClose = !saveBusy;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  useEffect(() => {
    if (linksRoot !== root) void loadLinks(root);
  }, [root, linksRoot, loadLinks]);

  useEffect(() => {
    setPhase("loading");
    setLoadError(null);
    setCtx(null);
    setErrors([]);
    setSavedPath(null);
    setSaveError(null);
    const s = useGraphStore.getState();
    const graphJson = serializeGraph({
      version: GRAPH_VERSION,
      projectName: s.projectName,
      nodes: s.nodes,
      edges: s.edges,
      compileTargets: s.compileTargets,
    });
    taskContextPreview(root, taskId, graphJson)
      .then((result) => {
        if (!liveRef.current) return;
        setCtx(result);
        if (result.errors.length > 0) {
          setErrors(result.errors);
          setPhase(result.errors.some((e) => e.kind === "emptySubgraph") ? "empty" : "error");
        } else {
          setPhase("ready");
        }
      })
      .catch((e: unknown) => {
        if (!liveRef.current) return;
        setLoadError(String(e));
        setPhase("error");
      });
    // Intentionally keyed on [root, taskId] only — `serializeGraph`/
    // `GRAPH_VERSION`/`useGraphStore` are stable imports, not reactive
    // values, so exhaustive-deps has nothing to add here. A live graph edit
    // does NOT re-trigger this preview while the modal is open (it would
    // move the ground under Save/Launch mid-review) — re-open to refresh.
  }, [root, taskId]);

  const doSave = () => {
    if (ctx === null || ctx.body === "") return;
    setSaveBusy(true);
    setSaveError(null);
    taskContextWrite(root, taskId, ctx.body)
      .then((relPath) => {
        if (!liveRef.current) return;
        setSaveBusy(false);
        setSavedPath(relPath);
      })
      .catch((e: unknown) => {
        if (!liveRef.current) return;
        setSaveBusy(false);
        setSaveError(String(e));
      });
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  // The same decider the linter and the compiler use (WO13 fix round,
  // T1's D6) — NOT a local `n.rootLoad === "always"` test. A node reached
  // only transitively through an unguarded `imports` edge is genuinely
  // always-in-context but carries no `rootLoad` of its own; a local test
  // would put it in the wrong bucket even though `ctx.nodeIds` (the actual
  // compiled closure) already contains it correctly.
  const alwaysIds = alwaysLoadedNodeIds({ nodes, edges });
  const seedIds = new Set(link.nodeIds);
  const ancestryIds = new Set(ancestryChain(taskId).flatMap((l) => l.nodeIds));

  const buckets: Record<Bucket, string[]> = { seed: [], always: [], ancestry: [], closure: [] };
  for (const id of ctx?.nodeIds ?? []) {
    if (seedIds.has(id)) buckets.seed.push(id);
    else if (alwaysIds.has(id)) buckets.always.push(id);
    else if (ancestryIds.has(id)) buckets.ancestry.push(id);
    else buckets.closure.push(id);
  }

  const tokenEstimate = ctx !== null ? tokensForBytes(ctx.bytes) : 0;
  const truncated = ctx !== null && ctx.bytes > TASK_CONTEXT_MAX_BYTES;

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
        aria-label="Task context"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Task context</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-muted" title={taskName}>
            {taskName}
          </span>
          <button
            onClick={onClose}
            disabled={!canClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {phase === "loading" && <PixelMarch caption="resolving the subgraph" />}

          {loadError !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {loadError}
            </div>
          )}

          {(phase === "empty" || phase === "error") && errors.length > 0 && (
            <div className="flex flex-col gap-2 p-4">
              {errors.map((e, i) => (
                <p
                  key={i}
                  className="rounded border border-l-[3px] border-danger border-l-danger bg-danger-surface px-3 py-2 text-sm leading-relaxed text-danger-text"
                >
                  {errorText(e)}
                </p>
              ))}
            </div>
          )}

          {phase === "ready" && ctx !== null && (
            <>
              <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2">
                <span className="font-mono text-xs text-content">
                  {ctx.nodeIds.length} node{ctx.nodeIds.length === 1 ? "" : "s"}
                </span>
                <span className="font-mono text-xs text-content-muted">
                  ≈{formatTokenCount(tokenEstimate)} tok · {ctxPercent(tokenEstimate)}% of ctx · {ctx.bytes.toLocaleString()} bytes
                </span>
                {truncated && (
                  <span className="rounded-sm border border-amber-border bg-amber-surface px-1.5 py-0.5 font-mono text-micro text-amber-text">
                    will be truncated at boot ({TASK_CONTEXT_MAX_BYTES.toLocaleString()}b)
                  </span>
                )}
              </div>

              {(Object.keys(buckets) as Bucket[])
                .filter((b) => buckets[b].length > 0)
                .map((b) => (
                  <section key={b} className="border-b border-border-subtle">
                    <div className="flex h-[24px] items-center px-4">
                      <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
                        {BUCKET_LABEL[b]} · {buckets[b].length}
                      </span>
                    </div>
                    <ul>
                      {buckets[b].map((id) => (
                        <NodeRow key={id} id={id} node={nodeById.get(id)} />
                      ))}
                    </ul>
                  </section>
                ))}

              <section className="border-b border-border-subtle">
                <div className="flex h-[26px] items-center px-4">
                  <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
                    compiled body
                  </span>
                </div>
                <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap bg-surface-inset px-4 py-2 font-mono text-xs leading-relaxed text-content-secondary">
                  {ctx.body}
                </pre>
              </section>
            </>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          {savedPath !== null ? (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-success-text">
              saved to {savedPath}
            </span>
          ) : saveError !== null ? (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-danger-text">{saveError}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
              {phase === "ready"
                ? "Additive to the worktree's own CLAUDE.md, not exclusive — see contract §4.3."
                : "Runs the same closure compile as Compile, scoped to this task."}
            </span>
          )}
          <button
            onClick={onClose}
            disabled={!canClose}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            Close
          </button>
          <button
            onClick={doSave}
            disabled={phase !== "ready" || saveBusy}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            {saveBusy ? "· · ·" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
