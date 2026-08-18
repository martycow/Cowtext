// Disk-change review modal (WO01 Block C §T4) — side-by-side diff of the
// last known-good snapshot (left) against the current disk content (right)
// for one managed file. Accept adopts the external edit as the new
// baseline; Revert writes the snapshot back to disk (self-write-suppressed,
// so it never re-enqueues itself). Same keyboard-safe shell as CompileModal
// /HooksModal: Cancel/Close holds initial focus, Esc always closes.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useReviewStore, type ReviewEntry, type ReviewKind } from "../store/review";
import { diffLines, type DiffHunk } from "../ui/diff";

type Phase = "loading" | "ready" | "removed" | "failed";

interface Row {
  lineNo: number | null;
  text: string;
  tone: "header" | "context" | "changed" | "empty";
}

const KIND_LABEL: Record<ReviewKind, string> = {
  modify: "modified",
  create: "created",
  remove: "removed",
};

/** Two row lists, same length and same index → same line, so two
 *  independently-scrolled panes stay aligned without any per-row height
 *  math — an add/del op just leaves a blank row in the other pane. */
function buildRows(hunks: DiffHunk[]): { left: Row[]; right: Row[] } {
  const left: Row[] = [];
  const right: Row[] = [];
  for (const h of hunks) {
    const header = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
    left.push({ lineNo: null, text: header, tone: "header" });
    right.push({ lineNo: null, text: header, tone: "header" });
    for (const op of h.ops) {
      if (op.type === "context") {
        left.push({ lineNo: op.oldLine, text: op.text, tone: "context" });
        right.push({ lineNo: op.newLine, text: op.text, tone: "context" });
      } else if (op.type === "del") {
        left.push({ lineNo: op.oldLine, text: op.text, tone: "changed" });
        right.push({ lineNo: null, text: "", tone: "empty" });
      } else {
        left.push({ lineNo: null, text: "", tone: "empty" });
        right.push({ lineNo: op.newLine, text: op.text, tone: "changed" });
      }
    }
  }
  return { left, right };
}

function rowClass(tone: Row["tone"]): string {
  switch (tone) {
    case "header":
      return "px-2 text-content-muted";
    case "changed":
      return "bg-amber-surface text-amber-text";
    case "empty":
      return "text-content-disabled";
    default:
      return "text-content-secondary";
  }
}

function Pane({
  title,
  rows,
  scrollRef,
  onScroll,
  empty,
}: {
  title: string;
  rows: Row[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  empty: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-border-subtle first:border-r">
      <div className="flex h-[24px] flex-none items-center border-b border-border-subtle bg-surface-2 px-2 font-mono text-2xs uppercase tracking-wider text-content-muted">
        {title}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-surface-inset py-1 font-mono text-xs leading-[1.6]"
      >
        {rows.length === 0 ? (
          <div className="px-3 py-2 text-content-muted">{empty}</div>
        ) : (
          <div className="min-w-max">
            {rows.map((r, i) => (
              <div key={i} className={`whitespace-pre px-2 ${rowClass(r.tone)}`}>
                {r.tone !== "header" && (
                  <span className="mr-3 inline-block w-9 select-none text-right text-content-disabled">
                    {r.lineNo ?? ""}
                  </span>
                )}
                {r.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReviewModal({ root, onClose }: { root: string; onClose: () => void }) {
  const entry = useReviewStore((s) => s.reviewing) as ReviewEntry | null;
  const snapshot = useReviewStore((s) => (entry === null ? undefined : s.snapshots.get(entry.relPath)));
  const acceptCurrent = useReviewStore((s) => s.acceptCurrent);
  const revertCurrent = useReviewStore((s) => s.revertCurrent);
  const skipCurrent = useReviewStore((s) => s.skipCurrent);
  const queueLen = useReviewStore((s) => s.queue.length);

  const [phase, setPhase] = useState<Phase>("loading");
  const [diskContent, setDiskContent] = useState("");
  const [errText, setErrText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // Trust-adjacent action (Revert writes to disk): Close/Cancel holds
  // initial focus, same recipe as CompileModal/HooksModal.
  useEffect(() => {
    (closeRef.current ?? panelRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (entry === null) return;
    let live = true;
    setBusy(false);
    setErrText(null);
    if (entry.kind === "remove") {
      setPhase("removed");
      return;
    }
    setPhase("loading");
    invoke<string>("read_md_file", { root, relPath: entry.relPath })
      .then((text) => {
        if (!live) return;
        setDiskContent(text);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        if (!live) return;
        setErrText(String(e));
        setPhase("failed");
      });
    return () => {
      live = false;
    };
    // Re-fetch whenever the reviewed entry (or the file it points at)
    // changes — `ts` bumps on every dedup update, not just relPath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, entry?.relPath, entry?.ts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hunks = useMemo(
    () => (phase === "ready" ? diffLines(snapshot ?? null, diskContent) : []),
    [phase, snapshot, diskContent],
  );
  const { left, right } = useMemo(() => buildRows(hunks), [hunks]);

  const syncScroll = (from: RefObject<HTMLDivElement | null>, to: RefObject<HTMLDivElement | null>) => () => {
    if (syncing.current) return;
    if (from.current === null || to.current === null) return;
    syncing.current = true;
    to.current.scrollTop = from.current.scrollTop;
    to.current.scrollLeft = from.current.scrollLeft;
    syncing.current = false;
  };

  if (entry === null) return null;

  const runAccept = () => {
    setBusy(true);
    void acceptCurrent(root).finally(() => setBusy(false));
  };
  const runRevert = () => {
    setBusy(true);
    void revertCurrent(root).finally(() => setBusy(false));
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Review disk change"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[1040px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span
            className="min-w-0 max-w-[420px] truncate font-mono text-[15px] font-semibold"
            title={entry.relPath}
          >
            {entry.relPath}
          </span>
          <span className="flex-none rounded-sm border border-amber-border bg-amber-surface px-1.5 py-0.5 font-mono text-micro text-amber-text">
            {KIND_LABEL[entry.kind]}
          </span>
          <div className="min-w-0 flex-1" />
          {queueLen > 1 && (
            <span className="flex-none font-mono text-2xs text-content-muted">
              {queueLen} to review
            </span>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-[46vh] flex-1 overflow-hidden">
          {phase === "loading" ? (
            <p className="px-4 py-6 text-center text-sm text-content-muted">Reading disk content…</p>
          ) : phase === "failed" ? (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          ) : phase === "removed" ? (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-sm text-content">
                This file was deleted on disk. Accept confirms the removal; Revert writes the
                last known content back.
              </p>
              <div className="max-h-[40vh] overflow-auto rounded border border-border-subtle bg-surface-inset p-2 font-mono text-xs leading-relaxed text-content-secondary">
                {(snapshot ?? "").split("\n").map((line, i) => (
                  <div key={i} className="whitespace-pre">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0">
              <Pane
                title="last known content"
                rows={left}
                scrollRef={leftRef}
                onScroll={syncScroll(leftRef, rightRef)}
                empty="no line changes"
              />
              <Pane
                title="on disk now"
                rows={right}
                scrollRef={rightRef}
                onScroll={syncScroll(rightRef, leftRef)}
                empty="no line changes"
              />
            </div>
          )}
        </div>

        {/* Footer — 50px, consequence text left, actions right */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            Accept keeps the disk version · Revert writes the last known content back
          </span>
          <button
            onClick={skipCurrent}
            disabled={busy || queueLen <= 1}
            title={queueLen <= 1 ? "Nothing else queued" : "Come back to this one later"}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            Skip
          </button>
          <button
            ref={closeRef}
            onClick={onClose}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            Close
          </button>
          <button
            onClick={runRevert}
            disabled={busy || (phase === "ready" && snapshot === undefined)}
            title="Write the last known content back to disk"
            className="flex h-control flex-none items-center rounded border border-danger bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:bg-danger-surface disabled:opacity-50"
          >
            Revert
          </button>
          <button
            onClick={runAccept}
            disabled={busy}
            className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {busy ? "· · ·" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
