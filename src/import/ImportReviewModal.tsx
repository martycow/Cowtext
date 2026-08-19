// Import review modal — the same diff-preview trust idiom as CompileModal
// (CLAUDE.md: never write without approval). Scans on open, shows every
// proposed node/edge as a reviewable row with a per-item adopt/skip
// checkbox, and only calls import_apply with the adopted subset. Nothing is
// written until Apply. import_scan/import_apply are wired (WO03 Lane D
// landed import.rs; src/import/types.ts is reconciled against it, audit
// D3) — a rejected invoke surfaces as an inline error, never a crash.
//
// WO03 audit D1: import_apply writes .cowtext/graph.json directly on disk
// without going through the graph store, so doApply() below MUST reload
// the store (useGraphStore.getState().loadGraph) before reporting success —
// otherwise the next debounced autosave from anywhere else in the app
// overwrites the just-imported nodes with the store's stale pre-import
// state. Same precedent as PresetsModal.tsx's doApply.

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { importApply, importScan } from "./api";
import type { ImportApplyResult, ImportChangeset, ImportProposedNode } from "./types";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";

type Phase = "loading" | "preview" | "applying" | "done" | "failed";

/** Same 15px custom checkbox as Compile's ApproveCheckbox (native inputs
 *  render light-scheme in the webview) — kept local rather than shared
 *  since compile/CompileModal.tsx doesn't export it. */
function AdoptCheckbox({
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

function NodeRow({
  node,
  adopted,
  onToggle,
}: {
  node: ImportProposedNode;
  adopted: boolean;
  onToggle: () => void;
}) {
  // D2 fix, UI half (WO03 audit): a compile-owned path (CLAUDE.md,
  // AGENTS.md, .cursor/rules/*.mdc, ...) would be silently overwritten by
  // the very next Compile run if adopted as a node — import_apply refuses
  // it independently either way, but disabling + explaining here (same
  // treatment as alreadyManaged) is what stops the user from re-checking a
  // box that will just silently no-op.
  const blocked = node.alreadyManaged || node.compileOwned;

  return (
    <li
      className={`flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 ${
        blocked ? "opacity-60" : ""
      }`}
    >
      <AdoptCheckbox
        checked={adopted}
        disabled={blocked}
        label={`Adopt ${node.title}`}
        onToggle={onToggle}
      />
      <span className="flex-none" style={{ color: roleVar(node.role) }}>
        <RoleGlyph role={node.role} size={11} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-content">{node.title}</span>
      <span className="min-w-0 max-w-[220px] flex-none truncate font-mono text-2xs text-content-muted" title={node.sourceFile}>
        {node.sourceFile}
      </span>
      {node.pinned && (
        <span
          className="flex-none rounded-sm border border-amber-border bg-amber-surface px-1.5 py-px font-mono text-micro text-amber-text"
          title="Adopted as pinned — .mdc alwaysApply: true"
        >
          pinned
        </span>
      )}
      {node.compileOwned && (
        <span
          className="flex-none rounded-sm border border-danger bg-danger-surface px-1.5 py-px font-mono text-micro text-danger-text"
          title="Compile writes this file — adopting it would be overwritten by the next Compile run"
        >
          compile writes this file
        </span>
      )}
      {node.alreadyManaged && (
        <span className="flex-none font-mono text-2xs text-content-disabled">already managed</span>
      )}
    </li>
  );
}

export function ImportReviewModal({ root, onClose }: { root: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [changeset, setChangeset] = useState<ImportChangeset | null>(null);
  const [adopted, setAdopted] = useState<Record<string, boolean>>({});
  const [errText, setErrText] = useState<string | null>(null);
  const [result, setResult] = useState<ImportApplyResult | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    setPhase("loading");
    setErrText(null);
    importScan(root)
      .then((cs) => {
        if (!live) return;
        // D2 fix, UI half (WO03 audit): compile-owned paths default to NOT
        // adopted, same reasoning as alreadyManaged — see NodeRow's `blocked`.
        const init: Record<string, boolean> = {};
        for (const n of cs.nodes) init[n.id] = !n.alreadyManaged && !n.compileOwned;
        setChangeset(cs);
        setAdopted(init);
        setPhase("preview");
      })
      .catch((e: unknown) => {
        if (!live) return;
        setErrText(String(e));
        setPhase("failed");
      });
    return () => {
      live = false;
    };
  }, [root]);

  const canClose = phase === "preview" || phase === "done" || phase === "failed";

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const adoptedNodes = (changeset?.nodes ?? []).filter((n) => adopted[n.id] === true);
  const adoptedIds = new Set(adoptedNodes.map((n) => n.id));
  // An edge only makes sense once both its endpoints are being adopted —
  // otherwise import_apply would receive an edge pointing at a node that
  // was skipped. Filtered silently here, same "never clobbers" spirit as
  // the contract's #3 must-not-break rule.
  const adoptedEdges = (changeset?.edges ?? []).filter(
    (e) => adoptedIds.has(e.source) && adoptedIds.has(e.target),
  );

  // D1 fix (WO03 audit): import_apply writes .cowtext/graph.json directly
  // on disk — the in-memory graph store is never told. Without a reload
  // here, the store still holds the PRE-import node/edge arrays; the very
  // next debounced save (any drag, any title edit) would overwrite the
  // freshly-written file with those stale arrays and silently erase every
  // adopted node. Same precedent as PresetsModal.tsx's doApply: reload the
  // store from disk, then rescan the file rail, before reporting done.
  const doApply = () => {
    if (adoptedNodes.length === 0 || phase !== "preview") return;
    setPhase("applying");
    setErrText(null);
    (async () => {
      const r = await importApply(root, { nodes: adoptedNodes, edges: adoptedEdges });
      await useGraphStore.getState().loadGraph(root);
      void useProjectStore.getState().rescan();
      setResult(r);
      setPhase("done");
    })().catch((e: unknown) => {
      setErrText(String(e));
      setPhase("failed");
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
        aria-label="Import"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Import</span>
          <div className="min-w-0 flex-1" />
          <span className="min-w-0 max-w-[300px] truncate font-mono text-2xs text-content-muted" title={root}>
            {`→ ${root}`}
          </span>
          <button
            onClick={onClose}
            disabled={!canClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-[40vh] flex-1 overflow-y-auto">
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 animate-blink bg-amber"
                    style={{ animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }}
                  />
                ))}
              </div>
              <span className="font-pixel text-micro tracking-wide text-amber-text">
                the cow is scanning
              </span>
            </div>
          )}
          {phase === "failed" && errText !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}
          {phase === "done" && result !== null && (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-sm text-content">
                added {result.nodesAdded} {result.nodesAdded === 1 ? "node" : "nodes"} and{" "}
                {result.edgesAdded} {result.edgesAdded === 1 ? "edge" : "edges"}
                {result.skipped > 0 && ` — ${result.skipped} skipped (already present)`}
              </p>
            </div>
          )}
          {(phase === "preview" || phase === "applying") && changeset !== null && (
            <>
              {changeset.nodes.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-content-muted">
                  Nothing new found — CLAUDE.md / AGENTS.md / .cursor/rules are either empty or
                  already managed.
                </p>
              ) : (
                <ul>
                  {changeset.nodes.map((n) => (
                    <NodeRow
                      key={n.id}
                      node={n}
                      adopted={adopted[n.id] === true}
                      onToggle={() =>
                        setAdopted((a) => ({ ...a, [n.id]: a[n.id] !== true }))
                      }
                    />
                  ))}
                </ul>
              )}
              {changeset.warnings.length > 0 && (
                <ul className="border-t border-border-subtle">
                  {changeset.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="border-b border-border-subtle bg-amber-surface px-3 py-1.5 font-mono text-2xs text-amber-text"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {phase === "preview" || phase === "applying" ? (
              <>
                {adoptedNodes.length} of {changeset?.nodes.length ?? 0} nodes will be added
              </>
            ) : phase === "done" ? (
              <>done — the graph stays the source of truth</>
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
                className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled"
              >
                Cancel
              </button>
              <button
                onClick={doApply}
                disabled={adoptedNodes.length === 0 || phase !== "preview"}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {phase === "applying" ? "· · ·" : "Adopt selected"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
