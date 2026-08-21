// Handoff → node (WO06_CONTRACT.md §6) — the commit flow for
// `handoff_node_propose`. Same diff-preview-then-approve trust idiom as
// CompileModal/ImportReviewModal (CLAUDE.md: never write without explicit
// approval): the Rust command is deterministic (no `claude -p` call) and
// writes NOTHING (contract §1.12) — it only returns a `HandoffNodeProposal`.
// This modal is the only place that proposal is ever turned into a real
// node, and it does so through the SAME graph-store actions every other
// node-creating flow already uses (`createNodeFrom` + `updateNode` +
// `beginConnection`/`confirmConnection`, `src/store/graph.ts`) — no new
// Rust write path is introduced.
//
// Scope note: task association is read directly off the chosen session's
// own `taskId` (set only when it was spawned via `spawnForTask`) rather
// than offered as a separate picker — a task/tasklinks picker UI lives in
// `src/taskctx/`/`src/tasklinks/`, outside this lane's zone. `summary` is
// the one field the command has no other source for, so it stays a plain
// required textarea here.

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { FieldLabel } from "../agents/AgentEditor";
import { NODE_ROLES, useGraphStore, type NodeRole } from "../store/graph";
import { useSessionsStore } from "../store/sessions";
import { pushToast } from "../store/toasts";
import { handoffNodePropose } from "./api";
import type { HandoffNodeProposal, HandoffSessionInput } from "./types";

type Phase = "pick" | "proposing" | "review" | "committing" | "done" | "failed";

/** Rust's `role` field is a plain `String`, not a role enum (see the note
 *  at the top of `./types.ts`) — always `"reference"` today per handoff.rs,
 *  but validated here rather than cast, so a future Rust value can never
 *  silently produce a `MemoryNode` with an invalid `role`. */
function isNodeRole(x: string): x is NodeRole {
  return (NODE_ROLES as readonly string[]).includes(x);
}

/** Meta keys in a human-friendly reading order — the wire object itself is
 *  alphabetical (Rust's `BTreeMap<String, String>`), which reads fine as
 *  data but not as a story. */
const META_ORDER = ["source", "session", "agent", "task", "producedAt", "tokens"] as const;

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

/** 4-step amber pixel march — never a spinner (DESIGN_SPEC.md). Local copy,
 *  same idiom as HandoffModal/CompileModal's own. */
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

function ContentWell({ label, text }: { label: string; text: string }) {
  return (
    <section className="border-b border-border-subtle">
      <div className="flex h-[26px] items-center px-4">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
          {label}
        </span>
      </div>
      <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap bg-surface-inset px-4 py-2 font-mono text-xs leading-relaxed text-content-secondary">
        {text}
      </pre>
    </section>
  );
}

export function HandoffNodeProposalModal({
  root,
  onClose,
}: {
  root: string;
  onClose: () => void;
}) {
  const sessions = useSessionsStore((s) => s.sessions).filter((s) => s.root === root);

  const [sessionId, setSessionId] = useState<string | null>(sessions[0]?.id ?? null);
  const [summary, setSummary] = useState("");
  const [phase, setPhase] = useState<Phase>("pick");
  const [proposal, setProposal] = useState<HandoffNodeProposal | null>(null);
  const [errText, setErrText] = useState<string | null>(null);
  const [createdTitle, setCreatedTitle] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    panelRef.current?.focus();
    return () => {
      liveRef.current = false;
    };
  }, []);

  // Same posture as HandoffModal/CompileModal: closing is blocked only
  // while the write itself (here: the graph-store commit) is in flight —
  // its outcome must always be seen, never silently discarded.
  const canClose = phase !== "committing";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const summaryTrimmed = summary.trim();

  const anchorTitle = useMemo(() => {
    if (proposal === null || proposal.anchorNodeId === null) return null;
    const n = useGraphStore.getState().nodes.find((x) => x.id === proposal.anchorNodeId);
    return n?.title ?? null;
  }, [proposal]);

  const doPropose = () => {
    if (session === null || summaryTrimmed === "") return;
    setPhase("proposing");
    setErrText(null);
    const input: HandoffSessionInput = {
      id: session.id,
      name: session.name,
      agentFileName: session.agentFileName,
      cwd: session.cwd,
      claudeSessionId: session.claudeSessionId,
      tokensUsed: session.tokensUsed,
    };
    handoffNodePropose(root, input, session.taskId, summaryTrimmed)
      .then((p) => {
        if (!liveRef.current) return;
        setProposal(p);
        setPhase("review");
      })
      .catch((e: unknown) => {
        if (!liveRef.current) return;
        setErrText(String(e));
        setPhase("failed");
      });
  };

  // The only write in this file — every field comes straight from the
  // proposal Rust returned, never re-derived. `createNodeFrom` never
  // throws (it lands the node with a missing-file badge on a disk-write
  // failure); `null` here means only "no project open", still surfaced as
  // a failure rather than a silent no-op.
  const doCommit = () => {
    if (proposal === null || phase !== "review") return;
    setPhase("committing");
    setErrText(null);
    (async () => {
      const role: NodeRole = isNodeRole(proposal.role) ? proposal.role : "architecture";
      const newId = await useGraphStore.getState().createNodeFrom({
        title: proposal.title,
        role,
        filePath: proposal.relPath,
        brief: proposal.brief,
        pinned: false,
        content: proposal.content,
      });
      if (newId === null) throw new Error("No project open");
      useGraphStore.getState().updateNode(newId, { meta: proposal.meta });
      // Anchor is best-effort decoration (handoff.rs's own doc comment): a
      // node the anchor pointed at may have been deleted between propose
      // and commit, so re-check membership rather than trust the id blind.
      if (proposal.anchorNodeId !== null) {
        const stillExists = useGraphStore
          .getState()
          .nodes.some((n) => n.id === proposal.anchorNodeId);
        if (stillExists) {
          useGraphStore.getState().beginConnection({ source: newId, target: proposal.anchorNodeId });
          useGraphStore.getState().confirmConnection("references");
        }
      }
      if (!liveRef.current) return;
      setCreatedTitle(proposal.title);
      setPhase("done");
    })().catch((e: unknown) => {
      if (!liveRef.current) {
        // Unreachable via UI now (close is blocked while committing), but a
        // commit failure must never vanish without a trace.
        pushToast({
          severity: "danger",
          title: "Handoff node commit failed",
          detail: String(e),
        });
        return;
      }
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
        aria-label="Propose Memory Node from session"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Propose node from session</span>
          <div className="min-w-0 flex-1" />
          <button
            onClick={onClose}
            disabled={!canClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent disabled:hover:text-content-disabled"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errText !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}

          {(phase === "pick" || phase === "failed") && (
            <div className="flex flex-col gap-3 p-4">
              <p className="text-sm leading-relaxed text-content-secondary">
                Captures one agent session&rsquo;s outcome as a reviewable Memory Node under{" "}
                <span className="font-mono text-xs">context/handoff/</span> — deterministic, no{" "}
                <span className="font-mono text-xs">claude -p</span> call. Nothing is written until
                you approve the node below.
              </p>
              <div>
                <FieldLabel>Session</FieldLabel>
                {sessions.length === 0 ? (
                  <p className="text-xs text-content-muted">
                    No agent sessions in this project yet.
                  </p>
                ) : (
                  <select
                    value={sessionId ?? ""}
                    onChange={(e) => setSessionId(e.target.value === "" ? null : e.target.value)}
                    className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
                  >
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.agentFileName ?? "no agent"}
                        {s.alive ? "" : " (exited)"}
                      </option>
                    ))}
                  </select>
                )}
                {session !== null && (
                  <p className="mt-1 text-2xs text-content-muted">
                    {session.taskId !== null
                      ? `Task: ${session.taskId} — will be offered as the node's anchor link.`
                      : "No task — the node is created unlinked."}
                  </p>
                )}
              </div>
              <div>
                <FieldLabel>Summary</FieldLabel>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                  placeholder="What did this session accomplish, decide, or leave open?"
                  className="min-h-[80px] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content placeholder:text-content-muted focus:border-accent"
                />
                <p className="mt-1 text-2xs text-content-muted">
                  First line becomes the node&rsquo;s brief; the rest is the node body.
                </p>
              </div>
            </div>
          )}

          {phase === "proposing" && <PixelMarch caption="building the proposal" />}

          {phase === "committing" && <PixelMarch caption="creating the node" />}

          {(phase === "review" || phase === "committing") && proposal !== null && (
            <>
              <div className="flex flex-col gap-1 border-b border-border-subtle px-4 py-3">
                <span className="text-sm font-semibold text-content">{proposal.title}</span>
                <span className="font-mono text-2xs text-content-muted">{proposal.relPath}</span>
                <span className="text-xs leading-relaxed text-content-secondary">
                  {proposal.brief}
                </span>
                {anchorTitle !== null && (
                  <span className="mt-1 inline-flex w-fit items-center rounded-sm border border-accent-border bg-accent-surface px-1.5 py-px font-mono text-micro text-accent-text">
                    links to: {anchorTitle}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 border-b border-border-subtle px-4 py-2">
                {META_ORDER.map((k) => (
                  <div key={k} className="flex items-center gap-2 font-mono text-2xs">
                    <span className="w-20 flex-none text-content-muted">{k}</span>
                    <span className="min-w-0 flex-1 truncate text-content-secondary">
                      {proposal.meta[k] === undefined || proposal.meta[k] === ""
                        ? "—"
                        : proposal.meta[k]}
                    </span>
                  </div>
                ))}
              </div>
              <ContentWell label={`${proposal.relPath} — new file`} text={proposal.content} />
            </>
          )}

          {phase === "done" && createdTitle !== null && (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-sm text-content">created &ldquo;{createdTitle}&rdquo;</p>
            </div>
          )}
        </div>

        {/* Footer — 50px */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          {phase === "pick" || phase === "failed" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Builds a proposal — nothing is written yet.
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Cancel
              </button>
              <button
                onClick={doPropose}
                disabled={session === null || summaryTrimmed === ""}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {phase === "failed" ? "Retry" : "Propose"}
              </button>
            </>
          ) : phase === "proposing" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Building the proposal…
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Close
              </button>
            </>
          ) : phase === "done" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                the graph stays the source of truth
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Close
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Creates one node and writes its file — review above before approving.
              </span>
              <button onClick={onClose} disabled={phase === "committing"} className={SECONDARY_BTN}>
                Cancel
              </button>
              <button
                onClick={doCommit}
                disabled={phase === "committing"}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {phase === "committing" ? "· · ·" : "Create node"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
