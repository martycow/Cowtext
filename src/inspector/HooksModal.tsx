// Hooks-install modal — a TRUST BOUNDARY (CLAUDE.md: writing hooks into a
// user project's .claude/settings.json always shows a confirmation diff).
// Flow: hooks_preview → user reads the diff → explicit "Approve & install"
// click → hooks_write with the exact previewed content. There is NO auto-write
// path; closing the modal any other way writes nothing.

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useProjectStore } from "../store/project";
import { diffLines, type DiffHunk } from "../ui/diff";

/** Mirrors src-tauri hooks::HooksPreview (contract §1.2). */
interface HooksPreview {
  relPath: string; // always ".claude/settings.json"
  oldContent: string | null; // null = file absent
  newContent: string;
  unchanged: boolean;
}

type Phase = "loading" | "preview" | "writing" | "done" | "failed";

function HooksDiffView({ hunks }: { hunks: DiffHunk[] }) {
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

export function HooksModal({ root, onClose }: { root: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<HooksPreview | null>(null);
  const [errText, setErrText] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Trust boundary: Cancel holds initial focus, so Enter/Space can never
  // install — approving takes a deliberate pointer/tab move.
  useEffect(() => {
    (cancelRef.current ?? panelRef.current)?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    invoke<HooksPreview>("hooks_preview", { root })
      .then((p) => {
        if (!live) return;
        setPreview(p);
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

  const canClose = phase !== "writing";

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const hunks = useMemo(
    () => (preview === null ? [] : diffLines(preview.oldContent, preview.newContent)),
    [preview],
  );

  const doWrite = () => {
    if (preview === null || preview.unchanged || phase === "writing") return;
    setPhase("writing");
    setErrText(null);
    invoke("hooks_write", { root, content: preview.newContent })
      .then(() => {
        setPhase("done");
        // The badge disappears without a reopen (contract §7.2).
        void useProjectStore.getState().refreshHooksStatus();
      })
      .catch((e: unknown) => {
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
        aria-label="Install Claude Code hooks"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[1040px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Install hooks</span>
          <div className="min-w-0 flex-1" />
          <span
            className="min-w-0 max-w-[300px] truncate font-mono text-2xs text-content-muted"
            title={`${root}/.claude/settings.json`}
          >
            {preview?.relPath ?? ".claude/settings.json"}
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

        {/* Body */}
        <div className="min-h-[46vh] flex-1 overflow-y-auto">
          {phase === "loading" ? (
            <p className="px-4 py-6 text-center text-sm text-content-muted">
              Reading .claude/settings.json…
            </p>
          ) : phase === "done" ? (
            <div className="flex flex-col gap-1 p-4">
              <p className="text-sm text-content">hooks installed</p>
              <p className="font-mono text-xs text-content-secondary">
                {preview?.relPath ?? ".claude/settings.json"}
              </p>
              <p className="text-xs text-content-muted">
                Claude Code sessions in this project now report to the barn on
                127.0.0.1:4923.
              </p>
            </div>
          ) : (
            <>
              {errText !== null && (
                <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
                  {errText}
                </div>
              )}
              {preview !== null && (
                <>
                  <div className="border-b border-border-subtle border-l-[3px] border-l-amber bg-amber-surface px-3 py-1.5 text-xs leading-relaxed text-amber-text">
                    This edits{" "}
                    <span className="break-all font-mono">{preview.relPath}</span> in your
                    project so Claude Code reports file activity to Cowtext on{" "}
                    <span className="font-mono">127.0.0.1:4923</span>. Nothing is written
                    until you approve the exact diff below.
                  </div>
                  {preview.unchanged ? (
                    <p className="px-4 py-6 text-center text-sm text-content-muted">
                      Hooks are already installed — settings.json needs no changes.
                    </p>
                  ) : (
                    <>
                      {preview.oldContent === null && (
                        <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-2xs text-accent-text">
                          new file
                        </div>
                      )}
                      <HooksDiffView hunks={hunks} />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer — 50px, consequence text left, actions right */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {phase === "done"
              ? "done — remove the hooks block from settings.json to uninstall"
              : preview !== null && preview.unchanged
                ? "nothing will be written"
                : preview !== null
                  ? "writes .claude/settings.json exactly as previewed"
                  : null}
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
                ref={cancelRef}
                onClick={onClose}
                disabled={!canClose}
                className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={doWrite}
                disabled={
                  phase !== "preview" || preview === null || preview.unchanged
                }
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {phase === "writing" ? "· · ·" : "Approve & install"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
