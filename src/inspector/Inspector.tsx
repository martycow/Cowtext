// Inspector — right panel, 392px (DESIGN_SPEC.md). Tabs: Properties (visual
// form) + Markdown (CodeMirror on the node's file; explicit save writes to
// disk through Rust). The file on disk is the content source of truth.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Bot,
  Check,
  Copy,
  FileCode,
  FileText,
  FolderOpen,
  Layers,
  Move,
  Palette,
  Pencil,
  Sparkles,
  Spline,
  Tag,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  EDGE_KINDS,
  GRAPH_VERSION,
  isAgentFile,
  isRenameProtected,
  sameRelPath,
  serializeGraph,
  suggestFilePath,
  useGraphStore,
  type AssembleStatus,
  type MemoryEdge,
  type MemoryNode,
  type NodeRole,
} from "../store/graph";
import { useProjectStore } from "../store/project";
import { useProjectSelectionStore } from "../store/projectSelection";
import { useReviewStore } from "../store/review";
import { useSettingsStore } from "../store/settings";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { isStructuralEdgeKind } from "../canvas/edgeKind";
import { EDGE_COLORS } from "../canvas/edgeColor";
import { InspectorSection } from "./InspectorSection";
import {
  AGENT_NODE_ORDER,
  EDGE_ORDER,
  MEMORY_NODE_ORDER,
  OFF_GRAPH_AGENT_ORDER,
  SectionStack,
  type AgentNodeSectionKey,
  type EdgeSectionKey,
  type MemoryNodeSectionKey,
  type OffGraphAgentSectionKey,
} from "./sectionOrder";
import { ProjectPanel } from "./ProjectPanel";
import { useHighlightStore, useInspectorTabStore } from "../canvas/types";
import { ROLE_DESCRIPTIONS, ROLE_GROUPS } from "../canvas/roleMeta";
import { assembleCancel, assembleNode, refineNode, summarizeNode } from "../assemble/api";
import { revealPath } from "../fs/api";
import { flushAgentSaveFor, PRODUCER_FILE, saveAgentRaw, useAgentsStore } from "../store/agents";
import type { AgentDoc } from "../agents/types";
import { AgentEditor } from "../agents/AgentEditor";
import { SkillEditor } from "../agents/SkillEditor";
import {
  normalizePriority,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  statusOf,
  useTasksStore,
  type TaskStatus,
} from "../store/tasks";
import { TagPicker } from "../tasks/TagPicker";
// WO06 audit D1/F1 fix: §10.1 reserves TaskPanel for task-graph editing;
// mounting TaskLinksPanel here is the tech-lead-ruled fix for the
// differentiator's other missing entry point (node attach / parent goal /
// per-task ceiling, plus its own "Preview context…" launch of the frozen
// §10.3 TaskContextModal) — U2's component, U1's mount.
import { TaskLinksPanel } from "../tasklinks/TaskLinksPanel";
import { useSessionsStore } from "../store/sessions";
import { AgentPanel } from "../sessions/AgentPanel";
import { CodeMirrorEditor, type AtMentionHandlers } from "./CodeMirrorEditor";
import { ScanOverlay } from "../ui/ScanOverlay";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";

// ── WO11 §12 — one writer per file ──────────────────────────────────────
//
// D4 replaced the Agent panel's explicit Save with a debounced autosave
// queue (store/agents.ts). The Markdown tab predates that queue and, for an
// agent file, used to do its own independent `read_md_file`/`write_md_file`
// — a second, uncoordinated writer on the same file. Because the two writes
// are separated by human time (the Markdown tab can hold its buffer for
// minutes before Save), no lock can fix this; the queue must be the only
// reader AND writer of an agent file, full stop (§12.8 doctrine). These two
// helpers are the seam every "go to the Markdown tab" entry point routes
// through.

/** Resolve a node's backing `AgentDoc.fileName` — never a bare `.split("/")`
 *  or `===` on `.filePath` (WO11 §10.5's standing rule; the same class of
 *  bug produced four defects in this work order). The fallback only fires
 *  when the doc isn't loaded yet, in which case there is almost certainly
 *  no pending autosave queue for it to flush anyway. */
function resolveAgentFileName(filePath: string): string {
  const doc = useAgentsStore
    .getState()
    .agents.find((a) => sameRelPath(`.claude/agents/${a.fileName}`, filePath));
  return doc?.fileName ?? (filePath.replace(/\\/g, "/").split("/").pop() ?? filePath);
}

/** Every entry point that can land the Inspector on the Markdown tab routes
 *  through this, not a bare `setTab("markdown")`. For an agent file it
 *  awaits `flushAgentSaveFor` FIRST — clearing any pending debounce timer
 *  and draining the in-flight write chain — so that by the time the
 *  Markdown branch mounts and reads `AgentDoc.content`, the agents store is
 *  quiescent and that content is current. Skipping this is exactly the §12.1
 *  hazard: a stale read racing a queue the Markdown tab doesn't know about. */
async function openMarkdownTab(node: MemoryNode): Promise<void> {
  if (isAgentFile(node.filePath)) {
    await flushAgentSaveFor(resolveAgentFileName(node.filePath));
  }
  useInspectorTabStore.getState().setTab("markdown");
}

// ── Small controls ────────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block font-mono text-2xs uppercase tracking-wider text-content-muted">
      {children}
    </label>
  );
}

/** 34×19 pill toggle. Pinned is an agent-facing guarantee ⇒ amber, not blue. */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
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

// ── Assemble section (Phase 3) ────────────────────────────────────────
// Fire-and-forget enqueue: the invoke only rejects at enqueue time (unknown
// node, already queued, bad root). Everything after that arrives through
// "assemble://status" events → graph store → this badge + the canvas card.

const STATUS_BADGE: Record<Exclude<AssembleStatus, "idle">, { label: string; cls: string }> = {
  queued: { label: "queued", cls: "border-border bg-surface-2 text-content-secondary" },
  running: { label: "assembling", cls: "border-accent-border bg-accent-surface text-accent-text" },
  assembled: { label: "assembled", cls: "border-transparent bg-success-surface text-success-text" },
  error: { label: "error", cls: "border-danger bg-danger-surface text-danger-text" },
};

function AssembleSection({ node, root }: { node: MemoryNode; root: string }) {
  const status = useGraphStore((s) => s.assembleStatus[node.id] ?? "idle");
  const jobError = useGraphStore((s) => s.assembleErrors[node.id] ?? null);
  const setAssembleStatus = useGraphStore((s) => s.setAssembleStatus);
  const [instruction, setInstruction] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const busy = status === "queued" || status === "running";

  const run = (fn: (graphJson: string) => Promise<void>) => {
    setActionError(null);
    void (async () => {
      // Disk and prompt must agree — same flush discipline as Compile.
      await useGraphStore.getState().flushSave();
      const s = useGraphStore.getState();
      const graphJson = serializeGraph({
        version: GRAPH_VERSION,
        projectName: s.projectName,
        nodes: s.nodes,
        edges: s.edges,
        compileTargets: s.compileTargets,
      });
      // Optimistic freeze BEFORE the invoke: Rust emits its own events from
      // a concurrent task, and a fast-failing job can deliver its terminal
      // status before the invoke promise settles — real events must always
      // win over this optimistic mark, never be overwritten by it.
      setAssembleStatus(node.id, "queued");
      try {
        await fn(graphJson);
      } catch (e) {
        // Enqueue rejected — roll back the optimistic mark unless a real
        // event has already moved the status on.
        if (useGraphStore.getState().assembleStatus[node.id] === "queued") {
          setAssembleStatus(node.id, "idle");
        }
        throw e;
      }
    })().catch((e: unknown) => setActionError(String(e)));
  };

  const cancel = () => {
    setActionError(null);
    assembleCancel(node.id)
      .then((removed) => {
        if (removed) setAssembleStatus(node.id, "idle");
      })
      .catch((e: unknown) => setActionError(String(e)));
  };

  const secondaryBtn =
    "flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

  return (
    <div className="border-t border-border-subtle pt-3">
      <div className="mb-2 flex items-center gap-2">
        <FieldLabel>Assemble</FieldLabel>
        <div className="flex-1" />
        {status !== "idle" && (
          <span
            className={`inline-flex h-[17px] items-center gap-1 rounded-sm border px-1 font-mono text-micro ${STATUS_BADGE[status].cls}`}
          >
            {status === "running" && (
              <span className="h-[5px] w-[5px] animate-blink bg-accent" />
            )}
            {STATUS_BADGE[status].label}
          </span>
        )}
        {status === "queued" && (
          <button
            onClick={cancel}
            title="Remove from queue"
            className="grid h-control-sm w-control-sm place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => run((graphJson) => assembleNode(root, graphJson, node.id))}
          disabled={busy}
          title={
            node.brief === ""
              ? "Uses the title and neighbors — a brief makes it better"
              : "Expand the brief into a full file via claude -p"
          }
          className="flex h-control items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
        >
          <Sparkles size={13} strokeWidth={1.5} />
          Assemble
        </button>
        <button
          onClick={() => run((graphJson) => summarizeNode(root, graphJson, node.id))}
          disabled={busy}
          title="Compress the current file content"
          className={secondaryBtn}
        >
          Summarize
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={busy}
          placeholder="Refine: e.g. add a testing section"
          onKeyDown={(e) => {
            if (e.key === "Enter" && instruction.trim() !== "" && !busy) {
              run((graphJson) => refineNode(root, graphJson, node.id, instruction.trim()));
            }
          }}
          className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent disabled:text-content-disabled"
        />
        <button
          onClick={() =>
            run((graphJson) => refineNode(root, graphJson, node.id, instruction.trim()))
          }
          disabled={busy || instruction.trim() === ""}
          className={secondaryBtn}
        >
          Refine
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-content-muted">
        Runs headless <span className="font-mono">claude -p</span> and rewrites{" "}
        <span className="font-mono">{node.filePath}</span> on disk.
      </p>
      {(actionError !== null || jobError !== null) && (
        <p className="mt-1.5 break-words font-mono text-xs text-danger-text">
          {actionError ?? jobError}
        </p>
      )}
    </div>
  );
}

// ── Properties tab ────────────────────────────────────────────────────

/** Commits on blur/Enter only (contract §7.1) — renames never fire per
 *  keystroke. A collision leaves the title applied but the file untouched,
 *  and offers the de-duped suggestion as a one-click retry. */
function TitleField({ node }: { node: MemoryNode }) {
  const commitTitle = useGraphStore((s) => s.commitTitle);
  const renameNodeFile = useGraphStore((s) => s.renameNodeFile);
  const [draft, setDraft] = useState(node.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // A different node selected, or an external update (e.g. rename retry) —
  // resync the draft, never mid-edit.
  useEffect(() => {
    setDraft(node.title);
    setRenameError(null);
    setSuggestion(null);
  }, [node.id, node.title]);

  const protectedFile = isRenameProtected(node.filePath);

  const commit = () => {
    if (draft.trim() === "" || draft === node.title) {
      setDraft(node.title);
      return;
    }
    setRenameError(null);
    void commitTitle(node.id, draft).then((err) => {
      if (err === null) return;
      setRenameError(err);
      const taken = new Set([
        ...useGraphStore.getState().nodes.map((n) => n.filePath),
        ...useProjectStore.getState().files.map((f) => f.relPath),
      ]);
      setSuggestion(suggestFilePath(node.filePath, draft, taken));
    });
  };

  const retry = () => {
    if (suggestion === null) return;
    void renameNodeFile(node.id, suggestion)
      .then(() => {
        setRenameError(null);
        setSuggestion(null);
      })
      .catch((e: unknown) => setRenameError(String(e)));
  };

  return (
    <div>
      <FieldLabel>Title</FieldLabel>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-control w-full rounded border border-border bg-surface-2 px-2 text-base text-content focus:border-accent"
      />
      {renameError !== null && (
        <p className="mt-1 text-xs leading-snug text-danger-text">
          {renameError}
          {suggestion !== null && (
            <>
              {" — "}
              <button onClick={retry} className="underline hover:text-danger">
                Rename to {suggestion}…
              </button>
            </>
          )}
        </p>
      )}
      {protectedFile && (
        <p className="mt-1 text-xs text-content-muted">generated file — not renameable</p>
      )}
    </div>
  );
}

/** Flattened role order, groups collapsed — the unit arrow-key navigation
 *  moves over (module scope: ROLE_GROUPS is static, no need to recompute
 *  per render/instance). */
const ROLE_FLAT: readonly NodeRole[] = ROLE_GROUPS.flatMap((g) => g.roles);

/** Grouped role popup (WO03) — 13 roles read poorly as one flat list, so
 *  this renders ROLE_GROUPS' sections (canvas/roleMeta.ts, the same
 *  taxonomy NodeWizard's step-1 grid uses). Bespoke rather than the shared
 *  ContextMenu primitive: MenuItem has no "header" row, and every option
 *  here needs BOTH the hand-drawn glyph and a description line, which the
 *  primitive's icon slot (typed to lucide's LucideIcon) can't carry — same
 *  viewport-flip / outside-close / Escape idiom as TagPicker's popup.
 *
 *  WO03 audit D4: this was originally focus-management-free — Tab from the
 *  trigger skipped straight to the next Inspector control because the
 *  portal renders at the end of `document.body`, so DOM order never puts
 *  the 13 buttons next in line. `role="menu"` + `role="menuitemradio"`
 *  promised arrow-key navigation it didn't implement — a WCAG 2.1.1
 *  failure, not a style nit. Fixed with real roving-tabindex focus (one
 *  button is a tab stop at a time, ArrowUp/Down/Home/End move it, mirroring
 *  ui/ContextMenu.tsx's own arrow-key handling) rather than reusing
 *  ContextMenu itself — see the header note above for why a bespoke popup
 *  is still the right call; it just has to carry the same accessibility
 *  ContextMenu gets for free. */
function RolePopup({
  anchor,
  role,
  onSelect,
  onClose,
}: {
  anchor: { x: number; y: number };
  role: NodeRole;
  onSelect: (r: NodeRole) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: anchor.x,
    top: anchor.y,
    ready: false,
  });
  const initialIndex = Math.max(0, ROLE_FLAT.indexOf(role));
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useLayoutEffect(() => {
    const el = popRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > vw - 4) left = Math.max(4, vw - rect.width - 4);
    if (top + rect.height > vh - 4) top = Math.max(4, vh - rect.height - 4);
    setPos({ left, top, ready: true });
  }, [anchor.x, anchor.y]);

  // Focus follows open — without this, real Tab-order never reaches a
  // document.body-portaled menu (WO03 audit D4). Mount-only: activeIndex
  // starts at the current role and only changes via explicit arrow keys
  // after that, so this must not re-fire on every activeIndex update.
  useEffect(() => {
    itemRefs.current[initialIndex]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popRef.current !== null && !popRef.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const moveTo = (i: number) => {
    setActiveIndex(i);
    itemRefs.current[i]?.focus();
  };
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = ROLE_FLAT.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveTo(activeIndex >= last ? 0 : activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(activeIndex <= 0 ? last : activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(last);
    }
    // Enter/Space need no handling: each item is a real <button>, so the
    // browser already fires its onClick. Escape is the window-level
    // listener above (restores focus to the trigger via onClose).
  };

  return createPortal(
    <div
      ref={popRef}
      role="menu"
      onKeyDown={onMenuKeyDown}
      style={{ position: "fixed", left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      className="z-dropdown flex max-h-[380px] w-[280px] flex-col overflow-y-auto rounded-lg border border-border bg-surface-3 p-1 shadow-dropdown outline-none"
    >
      {ROLE_GROUPS.map((group) => (
        <Fragment key={group.label}>
          <div className="px-2 pb-1 pt-2 font-mono text-2xs uppercase tracking-wider text-content-muted">
            {group.label}
          </div>
          {group.roles.map((r) => {
            const flatIndex = ROLE_FLAT.indexOf(r);
            return (
              <button
                key={r}
                ref={(el) => {
                  itemRefs.current[flatIndex] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={r === role}
                tabIndex={flatIndex === activeIndex ? 0 : -1}
                onFocus={() => setActiveIndex(flatIndex)}
                onClick={() => {
                  onSelect(r);
                  onClose();
                }}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors duration-instant hover:bg-[var(--surface-hover)]"
              >
                <span className="mt-0.5 flex-none" style={{ color: roleVar(r) }}>
                  <RoleGlyph role={r} size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm capitalize text-content">{r}</span>
                    {r === role && (
                      <Check size={12} strokeWidth={2} className="flex-none text-accent-text" />
                    )}
                  </span>
                  <span className="block text-2xs leading-snug text-content-disabled">
                    {ROLE_DESCRIPTIONS[r]}
                  </span>
                </span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

function RoleField({ node }: { node: MemoryNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const openPopup = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setOpen({ x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div>
      <FieldLabel>Role</FieldLabel>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopup}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPopup();
          }
        }}
        className="flex h-control w-full items-center gap-2 rounded border border-border bg-surface-2 px-2 text-left text-base text-content focus:border-accent"
      >
        <span className="flex-none" style={{ color: roleVar(node.role) }}>
          <RoleGlyph role={node.role} size={13} />
        </span>
        <span className="min-w-0 flex-1 capitalize">{node.role}</span>
      </button>
      <p className="mt-1 text-xs leading-snug text-content-secondary">
        {ROLE_DESCRIPTIONS[node.role]}
      </p>
      {open !== null && (
        <RolePopup
          anchor={open}
          role={node.role}
          onSelect={(r) => updateNode(node.id, { role: r })}
          onClose={() => {
            setOpen(null);
            btnRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Brief textarea (contract §7.12) — height bound to AppSettings.briefHeight
 *  so it survives a node switch (the field remounts per node, which reset
 *  height to the CSS default before this) and an app restart. Committed via
 *  ResizeObserver + a global pointerup so a drag that ends outside the
 *  textarea still persists. */
function BriefField({ node }: { node: MemoryNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const briefHeight = useSettingsStore((s) => s.briefHeight);
  const setBriefHeight = useSettingsStore((s) => s.setBriefHeight);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (el === null) return undefined;
    let pending = false;
    const ro = new ResizeObserver(() => {
      pending = true;
    });
    ro.observe(el);
    const onPointerUp = () => {
      if (pending) {
        setBriefHeight(el.offsetHeight);
        pending = false;
      }
    };
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      ro.disconnect();
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [setBriefHeight]);

  return (
    <div>
      <FieldLabel>Brief</FieldLabel>
      <textarea
        ref={taRef}
        value={node.brief}
        onChange={(e) => updateNode(node.id, { brief: e.target.value })}
        style={{ height: briefHeight }}
        placeholder="One line for Assemble to expand later"
        className="min-h-[48px] max-h-[50vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-base leading-snug text-content placeholder:text-content-disabled focus:border-accent"
      />
    </div>
  );
}

/** Canvas position (WO10 item 16 — the "Transform" component).
 *
 *  The graph has always stored a position and the canvas has always let you
 *  drag one, but there was no way to TYPE one: aligning two cards to the same
 *  x, or nudging a card off a wire by exactly 8px, meant dragging and hoping.
 *  Commits on change (not blur) because `moveNode` is already the same
 *  cheap, undoable store write a drag performs many times a second. */
function PositionField({ node }: { node: MemoryNode }) {
  const moveNode = useGraphStore((s) => s.moveNode);
  const set = (axis: "x" | "y", raw: string) => {
    const v = Number.parseInt(raw, 10);
    if (!Number.isFinite(v)) return;
    moveNode(node.id, { ...node.position, [axis]: v });
  };
  const input =
    "h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content focus:border-accent";
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <FieldLabel>X</FieldLabel>
        <input
          type="number"
          value={Math.round(node.position.x)}
          onChange={(e) => set("x", e.target.value)}
          className={input}
        />
      </div>
      <div className="min-w-0 flex-1">
        <FieldLabel>Y</FieldLabel>
        <input
          type="number"
          value={Math.round(node.position.y)}
          onChange={(e) => set("y", e.target.value)}
          className={input}
        />
      </div>
    </div>
  );
}

/** Tags editor (WO03 — new node field). Reuses tasks/TagPicker.tsx's
 *  trigger-chips + popup pattern verbatim rather than a parallel
 *  implementation; its "known tags" suggestion list is sourced from the
 *  task board (useTasksStore), not from other memory nodes' tags — a node
 *  tag and a task tag share one free-text vocabulary in this app, so that
 *  reads as a feature (one suggestion pool) rather than a bug, but it's
 *  flagged here since TagPicker itself is outside this lane's file zone
 *  (src/tasks/) and can't be pointed at a node-tags union without editing
 *  it — worth a tech-lead look if the two tag pools should ever merge. */
function TagsField({ node }: { node: MemoryNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  return (
    <div>
      <FieldLabel>Tags</FieldLabel>
      <TagPicker
        items={node.tags ?? []}
        disabled={false}
        onChange={(tags) => updateNode(node.id, { tags })}
      />
    </div>
  );
}

/** Owner editor (WO03 — new node field). Free text, no roster to validate
 *  against yet (no such directory exists in the app) — same trust level as
 *  Brief. */
function OwnerField({ node }: { node: MemoryNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  return (
    <div>
      <FieldLabel>Owner</FieldLabel>
      <input
        value={node.owner ?? ""}
        onChange={(e) => updateNode(node.id, { owner: e.target.value })}
        placeholder="Unassigned"
        className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
      />
    </div>
  );
}

/** Editable file path with direct rename (the "Rename file…" menu entries
 *  land here). Commits on Enter/blur when changed, Escape reverts, errors
 *  (collision, protected, IO) show inline. Protected files render read-only.
 *  Keyed by node.id from PropertiesTab, so in-flight commits can never paint
 *  onto another node (same remount discipline as TitleField). */
function FileField({
  node,
  root,
  onRevealError,
}: {
  node: MemoryNode;
  root: string;
  onRevealError: (msg: string) => void;
}) {
  const renameNodeFile = useGraphStore((s) => s.renameNodeFile);
  const renamePending = useInspectorTabStore((s) => s.renamePending);
  const consumeRename = useInspectorTabStore((s) => s.consumeRename);
  const fileMenu = useContextMenu();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(node.filePath);
  const [error, setError] = useState<string | null>(null);
  const protectedFile = isRenameProtected(node.filePath);

  useEffect(() => {
    setDraft(node.filePath);
    setError(null);
  }, [node.filePath]);

  // A "Rename file…" menu entry fired (possibly before this field mounted):
  // consume the flag by moving focus into the input, basename selected.
  useEffect(() => {
    if (!renamePending) return;
    consumeRename();
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    const slash = node.filePath.lastIndexOf("/");
    const dot = node.filePath.toLowerCase().lastIndexOf(".md");
    el.setSelectionRange(slash + 1, dot > slash ? dot : node.filePath.length);
  }, [renamePending, consumeRename, node.filePath]);

  const commit = () => {
    const next = draft.trim().replace(/\\/g, "/");
    if (next === "" || next === node.filePath) {
      setDraft(node.filePath);
      setError(null);
      return;
    }
    setError(null);
    renameNodeFile(node.id, next).catch((e: unknown) => setError(String(e)));
  };

  const openFileMenu = (e: React.MouseEvent) => {
    fileMenu.openAt(e, [
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () => {
          void revealPath(root, node.filePath).catch((err: unknown) => onRevealError(String(err)));
        },
      },
      {
        kind: "item",
        id: "copy",
        label: "Copy relative path",
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(node.filePath),
      },
      {
        kind: "item",
        id: "rename",
        label: "Rename file…",
        icon: Pencil,
        disabled: protectedFile,
        hint: protectedFile ? "generated file — not renameable" : undefined,
        onSelect: () => inputRef.current?.focus(),
      },
      {
        kind: "item",
        id: "open-md",
        label: "Open markdown tab",
        icon: FileCode,
        onSelect: () => void openMarkdownTab(node),
      },
    ]);
  };

  return (
    <div onContextMenu={openFileMenu}>
      <FieldLabel>File</FieldLabel>
      {protectedFile ? (
        <>
          <div
            className="truncate rounded border border-border-subtle bg-surface-inset px-2 py-1.5 font-mono text-2xs text-content-secondary [direction:rtl] [text-align:left]"
            title={node.filePath}
          >
            {node.filePath}
          </div>
          <p className="mt-1 text-xs text-content-muted">generated file — not renameable</p>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(node.filePath);
                setError(null);
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            title={node.filePath}
            className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content focus:border-accent"
          />
          <p className="mt-1 text-xs leading-snug text-content-muted">
            Enter renames the file on disk. Esc cancels.
          </p>
        </>
      )}
      {error !== null && (
        <p className="mt-1 break-words text-xs leading-snug text-danger-text">{error}</p>
      )}
      {fileMenu.menu !== null && (
        <ContextMenu
          x={fileMenu.menu.x}
          y={fileMenu.menu.y}
          items={fileMenu.menu.items}
          onClose={fileMenu.close}
        />
      )}
    </div>
  );
}

/** Relations grid — every edge touching this node, one row each: direction,
 *  kind (click selects the edge), the other node (click selects it).
 *  Sortable by port (inputs then outputs), by the other node's name, or by
 *  connection kind. */
type RelationsSort = "port" | "name" | "kind";

function RelationsSection({ node }: { node: MemoryNode }) {
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const setSelection = useGraphStore((s) => s.setSelection);
  const setHighlight = useHighlightStore((s) => s.setHighlight);
  const [sort, setSort] = useState<RelationsSort>("port");

  // Never leave a stale highlight behind when the grid goes away (node
  // switch, tab switch, deselection) — mouseleave won't fire then.
  useEffect(() => () => useHighlightStore.getState().clearHighlight(), []);

  const rows = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const out = e.source === node.id;
      const otherId = out ? e.target : e.source;
      return { e, out, otherId, other: nodes.find((n) => n.id === otherId) };
    });
  const name = (r: (typeof rows)[number]): string => r.other?.title ?? "";
  rows.sort((a, b) => {
    if (sort === "port" && a.out !== b.out) return Number(a.out) - Number(b.out);
    if (sort === "kind" && a.e.kind !== b.e.kind) {
      return EDGE_KINDS.indexOf(a.e.kind) - EDGE_KINDS.indexOf(b.e.kind);
    }
    return name(a).localeCompare(name(b));
  });

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <span className="font-mono text-2xs uppercase tracking-wider text-content-muted">
          Relations
        </span>
        <div className="flex-1" />
        {rows.length > 1 &&
          (["port", "name", "kind"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              title={
                k === "port" ? "Inputs first, then outputs" : k === "name" ? "By node name" : "By connection kind"
              }
              className={`h-[18px] rounded-sm border px-1.5 font-mono text-micro transition-colors duration-fast ${
                sort === k
                  ? "border-accent-border bg-accent-surface text-accent-text"
                  : "border-border text-content-muted hover:border-border-strong hover:text-content-secondary"
              }`}
            >
              {k}
            </button>
          ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs leading-snug text-content-muted">
          No relations yet — drag from a port on the canvas.
        </p>
      ) : (
        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-1 rounded border border-border-subtle bg-surface-inset px-2 py-1.5">
          {rows.map(({ e, out, otherId, other }) => {
            // Hover anywhere on the row → echo the neighbour + edge on the
            // canvas. Handlers sit on every cell (the grid has no row element).
            const hover = {
              onMouseEnter: () => setHighlight([otherId], [e.id]),
              onMouseLeave: () => useHighlightStore.getState().clearHighlight(),
            };
            return (
              <Fragment key={e.id}>
                <span
                  {...hover}
                  title={out ? "outgoing" : "incoming"}
                  className={`font-mono text-xs ${out ? "text-content" : "text-content-muted"}`}
                >
                  {out ? "→" : "←"}
                </span>
                <button
                  {...hover}
                  onClick={() => setSelection([], [e.id])}
                  title="Select edge"
                  className="rounded-sm border border-border px-1 py-px text-left font-mono text-micro text-content-secondary transition-colors duration-fast hover:border-border-strong hover:text-content"
                >
                  {e.kind}
                </button>
                <button
                  {...hover}
                  onClick={() => setSelection([otherId], [])}
                  title={other?.filePath}
                  className="truncate text-left text-sm text-content transition-colors duration-fast hover:text-accent-text hover:underline"
                >
                  {other?.title ?? "?"}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Inline danger confirm — nothing destructive happens in one click. */
function DangerConfirm({
  label,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-danger bg-danger-surface px-2 py-1.5">
      <span className="min-w-0 flex-1 text-xs leading-snug text-danger-text">{label}</span>
      <button
        onClick={onConfirm}
        className="h-control-sm flex-none rounded border border-danger px-2 font-mono text-micro text-danger-text transition-colors duration-fast hover:bg-danger hover:text-content-inverse"
      >
        {confirmLabel}
      </button>
      <button
        onClick={onCancel}
        className="h-control-sm flex-none rounded border border-border px-2 font-mono text-micro text-content-secondary transition-colors duration-fast hover:border-border-strong"
      >
        cancel
      </button>
    </div>
  );
}

/** Banner on a legacy agent-role node whose file still lives outside
 *  .claude/agents/ — one click moves it there (agent_convert) and the node
 *  becomes a real agent. */
function ConvertBanner({ node }: { node: MemoryNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const busy = useAgentsStore((s) => s.busy);
  const [error, setError] = useState<string | null>(null);

  const convert = () => {
    setError(null);
    void useAgentsStore
      .getState()
      .convertToAgent(node.filePath, node.title)
      .then((doc) => {
        updateNode(node.id, { filePath: `.claude/agents/${doc.fileName}` });
        void useProjectStore.getState().rescan();
      })
      .catch((e: unknown) => setError(String(e)));
  };

  return (
    <div className="rounded border border-accent-border bg-accent-surface px-2 py-1.5">
      <p className="text-xs leading-snug text-accent-text">
        This agent is not backed by a real <span className="font-mono">.claude/agents</span> file
        yet — Claude Code cannot see it.
      </p>
      <button
        onClick={convert}
        disabled={busy}
        className="mt-1.5 h-control-sm rounded bg-accent px-2.5 text-xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled"
      >
        Convert to agent file
      </button>
      {error !== null && (
        <p className="mt-1 break-words font-mono text-2xs text-danger-text">{error}</p>
      )}
    </div>
  );
}

/** Properties pane for a node backed by a real .claude/agents file: the full
 *  agent editor (identity, meta, tools, skills, duties), Assemble/Refine/
 *  Summarize on the agent file (contract Rev 2 R7), plus the graph-side
 *  facts (relations, pinned, remove-from-graph). No Read order here — agents
 *  are not part of the compiled read order (contract Rev 2 R8); normal nodes
 *  still carry the field in PropertiesTab. */
function AgentNodePanel({ node, root }: { node: MemoryNode; root: string }) {
  // WO11 C1/tech-lead finding: a bare "/" split left the whole path as
  // `fileName` on a node stored with backslashes (easy on Windows), so it
  // never matched any agent's fileName and the panel fell through to
  // "Agent file … is not loaded" even when the agent was loaded fine.
  // sameRelPath (canonPath under the hood) normalizes both separators and
  // case before comparing, the same way StandaloneAgentsPanel's `onGraph`
  // check already does.
  const doc = useAgentsStore((s) =>
    s.agents.find((a) => sameRelPath(`.claude/agents/${a.fileName}`, node.filePath)),
  );
  const busy = useAgentsStore((s) => s.busy);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const edgeCount = useGraphStore(
    (s) => s.edges.filter((e) => e.source === node.id || e.target === node.id).length,
  );

  if (doc === undefined) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className="text-sm text-content-muted">
          Agent file <span className="font-mono text-xs">{node.filePath}</span> is not loaded.
        </p>
        <button
          onClick={() => void useAgentsStore.getState().loadAgents(root)}
          className="h-control self-start rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
        >
          Rescan agents
        </button>
      </div>
    );
  }

  // WO11 D1/C2: the agent editor is now a proper collapsible section like
  // every other component, in its declared slot (AGENT_NODE_ORDER) rather
  // than floating above the section stack unconditionally. Read order is
  // still absent by contract: an agent is the thing doing the reading, not
  // a step in the order.
  //
  // WO11 D5 (§10.1 amendment — supersedes the earlier §5.8 reading):
  // AgentEditor's onSave/onRequestDelete are gone, and this panel no longer
  // carries any agent-FILE delete trigger either — not even in its own
  // Actions section. Agent-file deletion lives in exactly one place now,
  // the rail row's context menu; the graph-side orphan that used to make an
  // Inspector-side combo button look necessary is fixed at the store layer
  // instead (agentDeleteListeners, graph.ts). `Remove from graph` stays —
  // it deletes a node, never a file.
  const sections: Partial<Record<AgentNodeSectionKey, ReactNode>> = {
    "node.agent": (
      <InspectorSection sectionKey="node.agent" title="Agent" icon={Bot} bodyClassName="flex flex-col">
        <AgentEditor root={root} doc={doc} disabled={busy} />
      </InspectorSection>
    ),
    "node.position": (
      <InspectorSection sectionKey="node.position" title="Position" icon={Move}>
        <PositionField node={node} />
      </InspectorSection>
    ),
    "node.context": (
      <InspectorSection
        sectionKey="node.context"
        title="Context"
        icon={Layers}
        hint={node.pinned ? "pinned" : undefined}
      >
        <div className="flex items-center justify-between">
          <div>
            <FieldLabel>Pinned</FieldLabel>
            <p className="text-xs leading-snug text-content-muted">
              Always in context, survives compile.
            </p>
          </div>
          <Toggle checked={node.pinned} onChange={(v) => updateNode(node.id, { pinned: v })} />
        </div>
      </InspectorSection>
    ),
    "node.relations": (
      <InspectorSection
        sectionKey="node.relations"
        title="Relations"
        icon={Workflow}
        hint={String(edgeCount)}
      >
        <RelationsSection node={node} />
      </InspectorSection>
    ),
    "node.assemble": (
      <InspectorSection sectionKey="node.assemble" title="Assemble" icon={Sparkles}>
        <AssembleSection node={node} root={root} />
      </InspectorSection>
    ),
    "node.actions": (
      <InspectorSection sectionKey="node.actions" title="Actions" icon={Trash2}>
        <div>
          <button
            onClick={() => deleteNodes([node.id])}
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface"
          >
            <Trash2 size={13} strokeWidth={1.5} />
            Remove from graph
          </button>
          <p className="mt-1.5 text-xs text-content-muted">The agent file stays on disk.</p>
        </div>
      </InspectorSection>
    ),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SectionStack order={AGENT_NODE_ORDER} sections={sections} />
    </div>
  );
}

/** Right-panel editor for a rail selection with no graph node: an off-graph
 *  agent or a skill. */
function StandaloneAgentsPanel({ root }: { root: string }) {
  const sel = useAgentsStore((s) => s.selection);
  const agents = useAgentsStore((s) => s.agents);
  const skills = useAgentsStore((s) => s.skills);
  const busy = useAgentsStore((s) => s.busy);
  const adoptFile = useGraphStore((s) => s.adoptFile);
  // WO10 item 10 — ask the GRAPH whether this agent is adopted instead of
  // inferring it from which Inspector branch we landed in. The old strip was
  // rendered unconditionally, so any path that reached this panel with a
  // stale agents-store selection advertised "Adopt to graph" for a node that
  // was already on the canvas — and adopting again used to mint a duplicate.
  const onGraph = useGraphStore((s) =>
    sel?.kind === "agent"
      ? s.nodes.some((n) => sameRelPath(n.filePath, `.claude/agents/${sel.key}`))
      : false,
  );
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setArmed(false);
  }, [sel?.kind, sel?.key]);

  if (sel === null) return null;

  if (sel.kind === "agent") {
    const doc = agents.find((a) => a.fileName === sel.key);
    if (doc === undefined) return null;
    // WO11 D1/C2, and D5 per the §10.1 amendment: same InspectorSection
    // idiom as the on-graph panel, in the declared off-graph order
    // (Agent · Actions). Agent-FILE delete lives in exactly one place now —
    // the rail row's context menu — so this panel carries none at all;
    // `armed`/`DangerConfirm` below are for the skill branch only.
    const sections: Partial<Record<OffGraphAgentSectionKey, ReactNode>> = {
      "node.agent": (
        <InspectorSection sectionKey="node.agent" title="Agent" icon={Bot} bodyClassName="flex flex-col">
          <AgentEditor root={root} doc={doc} disabled={busy} />
        </InspectorSection>
      ),
      "node.actions": (
        <InspectorSection sectionKey="node.actions" title="Actions" icon={Workflow}>
          {onGraph ? (
            <p className="text-xs leading-snug text-content-muted">
              Already on the graph — select its node for graph-side actions.
            </p>
          ) : (
            <div>
              <button
                onClick={() => adoptFile(`.claude/agents/${doc.fileName}`, doc.fields.name ?? "")}
                className="flex h-control items-center gap-1.5 rounded border border-accent-border bg-accent-surface px-3 text-sm text-accent-text transition-colors duration-fast hover:bg-accent hover:text-content-inverse"
              >
                Adopt to graph
              </button>
              <p className="mt-1.5 text-xs leading-snug text-content-muted">
                Wires this agent into the graph as a node.
              </p>
            </div>
          )}
        </InspectorSection>
      ),
    };
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SectionStack order={OFF_GRAPH_AGENT_ORDER} sections={sections} />
      </div>
    );
  }

  const skill = skills.find((sk) => sk.dirName === sel.key);
  if (skill === undefined) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {armed && (
        <div className="p-3 pb-0">
          <DangerConfirm
            label={`Delete .claude/skills/${skill.dirName}/ (${skill.extraFileCount} extra file${skill.extraFileCount === 1 ? "" : "s"})?`}
            confirmLabel="delete"
            onConfirm={() => {
              setArmed(false);
              useAgentsStore.getState().select(sel);
              void useAgentsStore.getState().deleteSelected();
            }}
            onCancel={() => setArmed(false)}
          />
        </div>
      )}
      <SkillEditor
        doc={skill}
        disabled={busy}
        onRequestDelete={() => setArmed(true)}
        onSave={() => useAgentsStore.getState().saveDoc(sel)}
      />
    </div>
  );
}

// ── Task panel (contract Rev 2, R4) ─────────────────────────────────────

const STATUS_ORDER = TASK_STATUSES;
const PRIORITY_OPTIONS = ["none", ...TASK_PRIORITIES] as const;

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded border border-border bg-surface-2 p-[2px]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`h-control-sm rounded-sm px-2 font-mono text-2xs transition-colors duration-fast ${
            value === opt ? "bg-surface-3 font-medium text-content" : "text-content-muted hover:text-content-secondary"
          }`}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}

/** Agent field: a select over Producer + known agent files, falling back to
 *  a free-text input when the task's raw `agent` string doesn't match any
 *  known file/display name — never silently drops a hand-written value. */
function TaskAgentField({
  value,
  agents,
  onChange,
}: {
  value: string;
  agents: AgentDoc[];
  onChange: (v: string) => void;
}) {
  const known = agents.filter((a) => a.fileName !== PRODUCER_FILE);
  const labelFor = (a: AgentDoc) => (a.fields.name !== null && a.fields.name !== "" ? a.fields.name : a.fileName);
  const knownLabels = known.map(labelFor);
  const isKnown = value === "" || knownLabels.includes(value);
  return (
    <div className="flex items-center gap-2">
      <select
        value={isKnown ? value : "custom"}
        onChange={(e) => onChange(e.target.value === "custom" ? value : e.target.value)}
        className="h-control rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
      >
        <option value="">Producer</option>
        {known.map((a) => (
          <option key={a.fileName} value={labelFor(a)}>
            {labelFor(a)}
          </option>
        ))}
        <option value="custom">custom…</option>
      </select>
      {!isKnown && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="@agent"
          className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content focus:border-accent"
        />
      )}
    </div>
  );
}

/** Properties pane for a selected task line (contract Rev 2 R4) — editable
 *  mirror of the TaskItem, explicit Save via `task_update`. Rendered only
 *  when no node/edge is selected (branch priority in the main export gives
 *  the graph selection first claim; the store also clears `selected` on
 *  reload if the underlying line vanished). No delete this round — move the
 *  line to Backlog from the Tasks tab instead. */
function TaskPanel({ root }: { root: string }) {
  const item = useTasksStore((s) => s.selected);
  const update = useTasksStore((s) => s.update);
  const agents = useAgentsStore((s) => s.agents);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<string | null>(null);
  const [phase, setPhase] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<TaskStatus>("new");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    if (item === null) return;
    setName(item.name);
    setDescription(item.description ?? "");
    setTags(item.tags);
    setPriority(item.priority);
    setPhase(item.phase ?? "");
    setAgent(item.agent ?? "");
    setStatus(statusOf(item));
    setSaveError(null);
    setRevealError(null);
    // Resync only when the selected task's identity changes — mid-edit
    // keystrokes on the same item must never be clobbered by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (item === null) return null;

  const save = () => {
    setSaving(true);
    setSaveError(null);
    void update(item, {
      name,
      description,
      tags,
      priority,
      phase: item.source === "table" ? phase : null,
      agent: agent.trim() === "" ? null : agent.trim(),
      status,
    }).then((err) => {
      setSaving(false);
      if (err !== null) setSaveError(err);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-none items-center gap-2 border-b border-border-subtle bg-surface-inset px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            setRevealError(null);
            void revealPath(root, item.relPath).catch((e: unknown) => setRevealError(String(e)));
          }}
          title="Reveal in File Explorer"
          className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-content-secondary transition-colors duration-fast hover:border-border-strong hover:text-content"
        >
          {item.relPath}#{item.line}
        </button>
        <span className="text-2xs text-content-muted">task file</span>
      </div>
      {revealError !== null && (
        <p className="flex-none border-b border-border-subtle bg-danger-surface px-3 py-1 font-mono text-2xs text-danger-text">
          {revealError}
        </p>
      )}
      <div className="flex flex-col gap-3 p-3">
        <div>
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent"
          />
        </div>
        <div>
          <FieldLabel>Description</FieldLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="min-h-[54px] max-h-[40vh] w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-snug text-content focus:border-accent"
          />
        </div>
        <div>
          <FieldLabel>Tags</FieldLabel>
          <TagPicker items={tags} disabled={false} onChange={setTags} />
        </div>
        <div>
          <FieldLabel>Priority</FieldLabel>
          <Segmented
            value={normalizePriority(priority) ?? "none"}
            options={PRIORITY_OPTIONS}
            labels={PRIORITY_LABELS}
            onChange={(v) => setPriority(v === "none" ? null : v)}
          />
        </div>
        <div>
          <FieldLabel>Agent</FieldLabel>
          <TaskAgentField value={agent} agents={agents} onChange={setAgent} />
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <Segmented value={status} options={STATUS_ORDER} labels={STATUS_LABELS} onChange={setStatus} />
        </div>
        <div>
          <FieldLabel>Phase</FieldLabel>
          <input
            value={phase}
            disabled={item.source !== "table"}
            onChange={(e) => setPhase(e.target.value)}
            className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
          />
          {item.source !== "table" && (
            <p className="mt-1 text-xs text-content-muted">Checklist tasks don't carry a phase column.</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
          <button
            onClick={save}
            disabled={saving}
            className="h-control flex-none rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled"
          >
            {saving ? "· · ·" : "Save"}
          </button>
          {saveError !== null && (
            <p className="min-w-0 flex-1 break-words font-mono text-xs text-danger-text">{saveError}</p>
          )}
        </div>
      </div>
      <TaskLinksPanel root={root} taskId={item.taskId} taskName={item.name} />
    </div>
  );
}

function PropertiesTab({
  node,
  root,
  onRevealError,
}: {
  node: MemoryNode;
  root: string;
  onRevealError: (msg: string) => void;
}) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const edgeCount = useGraphStore(
    (s) => s.edges.filter((e) => e.source === node.id || e.target === node.id).length,
  );

  // WO11 C2 — the declared order (sectionOrder.ts, §5.3) is the only thing
  // that decides layout now: this object is a plain keyed lookup, built in
  // whatever order is convenient to write, and SectionStack below walks
  // MEMORY_NODE_ORDER to render it. Position/Transform is no longer first
  // just because it's typed first.
  const sections: Partial<Record<MemoryNodeSectionKey, ReactNode>> = {
    "node.metadata": (
      <InspectorSection sectionKey="node.metadata" title="Metadata" icon={Tag} hint={node.role}>
        {/* Keyed by node.id: without this React reuses the same TitleField
            instance across a node switch. commit()/retry() close over the
            `node` prop from the render that created them, and commitTitle is
            async (awaits rename_node_file), so a selection change before the
            promise settles let a stale collision message and a stale
            `suggestion` string (derived from the PREVIOUS node's title) paint
            — and act — on the newly selected node. Remounting on id change
            discards the old instance and its in-flight closures outright. */}
        <TitleField key={node.id} node={node} />
        <RoleField node={node} />
        <BriefField node={node} />
        <TagsField node={node} />
        <OwnerField node={node} />
      </InspectorSection>
    ),
    "node.context": (
      <InspectorSection
        sectionKey="node.context"
        title="Context"
        icon={Layers}
        hint={node.pinned ? "pinned" : `#${node.readOrder}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <FieldLabel>Pinned</FieldLabel>
            <p className="text-xs leading-snug text-content-muted">
              Always in context, survives compile.
            </p>
          </div>
          <Toggle checked={node.pinned} onChange={(v) => updateNode(node.id, { pinned: v })} />
        </div>

        <div>
          <FieldLabel>Read order</FieldLabel>
          <input
            type="number"
            min={0}
            value={node.readOrder}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(v)) updateNode(node.id, { readOrder: v });
            }}
            className="h-control w-[88px] rounded border border-border bg-surface-2 px-2 font-mono text-sm text-content focus:border-accent"
          />
        </div>
      </InspectorSection>
    ),
    "node.relations": (
      <InspectorSection
        sectionKey="node.relations"
        title="Relations"
        icon={Workflow}
        hint={String(edgeCount)}
      >
        <RelationsSection node={node} />
      </InspectorSection>
    ),
    "node.file": (
      <InspectorSection sectionKey="node.file" title="File" icon={FileText}>
        <FileField key={`file-${node.id}`} node={node} root={root} onRevealError={onRevealError} />
      </InspectorSection>
    ),
    "node.position": (
      <InspectorSection sectionKey="node.position" title="Position" icon={Move}>
        <PositionField node={node} />
      </InspectorSection>
    ),
    "node.assemble": (
      <InspectorSection sectionKey="node.assemble" title="Assemble" icon={Sparkles}>
        <AssembleSection node={node} root={root} />
      </InspectorSection>
    ),
    "node.actions": (
      <InspectorSection sectionKey="node.actions" title="Actions" icon={Trash2}>
        <div>
          <button
            onClick={() => deleteNodes([node.id])}
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface"
          >
            <Trash2 size={13} strokeWidth={1.5} />
            Remove from graph
          </button>
          <p className="mt-1.5 text-xs text-content-muted">The .md file stays on disk.</p>
        </div>
      </InspectorSection>
    ),
  };

  return (
    // No gap and no padding on the scroller: each section carries its own
    // padding and its own bottom rule, so the stack reads as a column of
    // components rather than a form with headings floating in it.
    <div className="flex flex-col overflow-y-auto">
      {node.role === "agent" && !isAgentFile(node.filePath) && (
        <div className="p-3 pb-0">
          <ConvertBanner node={node} />
        </div>
      )}
      <SectionStack order={MEMORY_NODE_ORDER} sections={sections} />
    </div>
  );
}

// ── Markdown tab ──────────────────────────────────────────────────────
//
// WO11 §12.3 item 1 — "one writer per file". An agent file's only reader
// and writer of record is store/agents.ts's autosave queue; this dispatcher
// exists so a plain node keeps its own independent read_md_file/
// write_md_file path (FileMarkdownTab, unchanged) while an agent file is
// rerouted entirely onto the queue (AgentMarkdownTab, new) — never both.

type LoadState =
  | { kind: "loading" }
  | { kind: "missing"; error: string }
  | { kind: "ready"; generation: number };

function MarkdownTab({ node, root }: { node: MemoryNode; root: string }) {
  // N1: @path mention chips. `nodes` is subscribed only so `mentionsKey`
  // recomputes when the resolution universe changes (adopt, rename,
  // remove); the handlers themselves always read fresh via getState() so
  // they can never act on a stale node/edge list. Shared by both branches
  // below — mentioning another node works the same whether the file being
  // edited happens to be an agent's or not.
  const nodes = useGraphStore((s) => s.nodes);
  const mentionsKey = useMemo(
    () => nodes.map((n) => `${n.id}:${n.filePath}`).sort().join("|"),
    [nodes],
  );
  const atMentions = useMemo<AtMentionHandlers>(
    () => ({
      resolve: (path) =>
        useGraphStore.getState().nodes.find((n) => sameRelPath(n.filePath, path))?.id ?? null,
      hasReferenceEdge: (targetNodeId) =>
        useGraphStore
          .getState()
          .edges.some(
            (e) => e.source === node.id && e.target === targetNodeId && e.kind === "references",
          ),
      onFocusNode: (nodeId) => {
        useGraphStore.getState().setSelection([nodeId], []);
        useInspectorTabStore.getState().setTab("properties");
      },
      onAddReference: (targetNodeId) => {
        const gs = useGraphStore.getState();
        gs.beginConnection({ source: node.id, target: targetNodeId });
        gs.confirmConnection("references");
      },
    }),
    [node.id],
  );

  if (isAgentFile(node.filePath)) {
    return (
      <AgentMarkdownTab key={node.filePath} node={node} atMentions={atMentions} mentionsKey={mentionsKey} />
    );
  }
  return <FileMarkdownTab node={node} root={root} atMentions={atMentions} mentionsKey={mentionsKey} />;
}

function FileMarkdownTab({
  node,
  root,
  atMentions,
  mentionsKey,
}: {
  node: MemoryNode;
  root: string;
  atMentions: AtMentionHandlers;
  mentionsKey: string;
}) {
  const rescan = useProjectStore((s) => s.rescan);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [doc, setDoc] = useState("");
  const [savedDoc, setSavedDoc] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    setSaveError(null);
    invoke<string>("read_md_file", { root, relPath: node.filePath })
      .then((text) => {
        if (!live) return;
        setDoc(text);
        setSavedDoc(text);
        setState((prev) => ({
          kind: "ready",
          generation: prev.kind === "ready" ? prev.generation + 1 : 0,
        }));
      })
      .catch((e: unknown) => {
        if (live) setState({ kind: "missing", error: String(e) });
      });
    return () => {
      live = false;
    };
  }, [root, node.filePath]);

  const dirty = state.kind === "ready" && doc !== savedDoc;

  const save = () => {
    if (state.kind !== "ready") return;
    setSaveError(null);
    invoke("write_md_file", { root, relPath: node.filePath, content: doc })
      .then(() => {
        setSavedDoc(doc);
        // The review baseline moves with an explicit in-app save — this
        // content is now "known good", not a pending external edit (Block
        // C §T4). Known limit: an open Markdown tab does not itself
        // hot-reload on a later Accept; reselecting the node re-reads.
        useReviewStore.getState().noteSelfSave(node.filePath, doc);
        void rescan();
      })
      .catch((e: unknown) => setSaveError(String(e)));
  };

  const createFile = () => {
    const stub = `# ${node.title}\n\n`;
    invoke("write_md_file", { root, relPath: node.filePath, content: stub })
      .then(() => {
        setDoc(stub);
        setSavedDoc(stub);
        useReviewStore.getState().noteSelfSave(node.filePath, stub);
        setState({ kind: "ready", generation: Date.now() });
        void rescan();
      })
      .catch((e: unknown) => setSaveError(String(e)));
  };

  if (state.kind === "loading") {
    return <div className="p-3 text-sm text-content-muted">Reading file…</div>;
  }

  if (state.kind === "missing") {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-sm leading-relaxed text-content-secondary">
          <span className="font-mono text-danger-text">{node.filePath}</span> is not on disk
          yet.
        </p>
        <button
          onClick={createFile}
          className="h-control self-start rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover"
        >
          Create file
        </button>
        {saveError !== null && (
          <p className="font-mono text-xs text-danger-text">{saveError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle px-3">
        <span
          className="truncate font-mono text-2xs text-content-muted [direction:rtl] [text-align:left]"
          title={node.filePath}
        >
          {node.filePath}
        </span>
        <div className="flex-1" />
        {dirty && <span className="h-1.5 w-1.5 flex-none rounded-pill bg-amber" title="Unsaved changes" />}
        <button
          onClick={save}
          disabled={!dirty}
          title="Ctrl+S"
          className="h-control-sm flex-none rounded bg-accent px-2.5 text-xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled"
        >
          Save
        </button>
      </div>
      {saveError !== null && (
        <div className="flex-none border-b border-border-subtle bg-danger-surface px-3 py-1 font-mono text-xs text-danger-text">
          {saveError}
        </div>
      )}
      <div className="min-h-0 flex-1 bg-surface-inset">
        <CodeMirrorEditor
          docKey={`${node.id}:${node.filePath}:${state.generation}`}
          value={savedDoc}
          onChange={setDoc}
          onSave={save}
          atMentions={atMentions}
          mentionsKey={mentionsKey}
        />
      </div>
    </div>
  );
}

/** WO11 §12.3 item 1 — the agent-file branch. Reads `AgentDoc.content` from
 *  the agents store (never `read_md_file`) and saves through `saveAgentRaw`,
 *  which enqueues on the SAME per-file queue `agentEdit` uses — never a
 *  second queue, which was the whole point of the ruling (§12.1/§12.2: a
 *  lock cannot fix a stale-read/lost-update separated by human time, only
 *  a single owner can). By the time this mounts, `openMarkdownTab` has
 *  already awaited `flushAgentSaveFor` for this file, so `doc.content` here
 *  is guaranteed current, not a stale snapshot racing the queue.
 *
 *  Keyed by `node.filePath` in the parent (MarkdownTab) rather than resynced
 *  via an effect: switching to a DIFFERENT agent file is a hard remount, so
 *  there is no code path that can overwrite an in-progress edit by reacting
 *  to an unrelated store update — the same discipline `TitleField`/
 *  `FileField` already use elsewhere in this file for the same reason. */
function AgentMarkdownTab({
  node,
  atMentions,
  mentionsKey,
}: {
  node: MemoryNode;
  atMentions: AtMentionHandlers;
  mentionsKey: string;
}) {
  const doc = useAgentsStore((s) =>
    s.agents.find((a) => sameRelPath(`.claude/agents/${a.fileName}`, node.filePath)),
  );
  const [text, setText] = useState(doc?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savedContent = doc?.content ?? "";
  const dirty = doc !== undefined && text !== savedContent;

  const save = () => {
    if (doc === undefined || !dirty) return;
    setSaving(true);
    setSaveError(null);
    void saveAgentRaw(doc.fileName, text).then((err: string | null) => {
      setSaving(false);
      if (err !== null) setSaveError(err);
      // No local resync on success: the queue's own `set()` updates
      // `doc.content` to exactly `text` (agent_save's raw_content arm is a
      // whole-file write), so `savedContent` catches up on the next render
      // and `dirty` goes false without this component doing anything extra.
    });
  };

  if (doc === undefined) {
    return (
      <div className="p-3 text-sm text-content-muted">
        Agent file <span className="font-mono text-xs">{node.filePath}</span> is not loaded.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[31px] flex-none items-center gap-2 border-b border-border-subtle px-3">
        <span
          className="truncate font-mono text-2xs text-content-muted [direction:rtl] [text-align:left]"
          title={node.filePath}
        >
          {node.filePath}
        </span>
        <div className="flex-1" />
        {dirty && <span className="h-1.5 w-1.5 flex-none rounded-pill bg-amber" title="Unsaved changes" />}
        <button
          onClick={save}
          disabled={!dirty || saving}
          title="Ctrl+S"
          className="h-control-sm flex-none rounded bg-accent px-2.5 text-xs font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover disabled:bg-surface-2 disabled:text-content-disabled"
        >
          {saving ? "· · ·" : "Save"}
        </button>
      </div>
      {saveError !== null && (
        <div className="flex-none border-b border-border-subtle bg-danger-surface px-3 py-1 font-mono text-xs text-danger-text">
          {saveError}
        </div>
      )}
      <div className="min-h-0 flex-1 bg-surface-inset">
        <CodeMirrorEditor
          docKey={`${doc.fileName}:agent-raw`}
          value={text}
          onChange={setText}
          onSave={save}
          atMentions={atMentions}
          mentionsKey={mentionsKey}
        />
      </div>
    </div>
  );
}

// ── Edge panel ────────────────────────────────────────────────────────

function EdgePanel({ edge }: { edge: MemoryEdge }) {
  const nodes = useGraphStore((s) => s.nodes);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const title = (id: string) => nodes.find((n) => n.id === id)?.title ?? "?";

  const structural = isStructuralEdgeKind(edge.kind);

  const routed = edge.waypoints !== undefined && edge.waypoints.length > 0;
  const colorKey = edge.color ?? "default";

  // WO11 C2 — same declared-order model as the node panels (EDGE_ORDER,
  // sectionOrder.ts). §5.3's table names Metadata·Path·Actions; Appearance
  // (WO10 item 13) is kept between them — see EDGE_ORDER's own comment for
  // why dropping it would be the actual regression here.
  const sections: Partial<Record<EdgeSectionKey, ReactNode>> = {
    "edge.metadata": (
      <InspectorSection sectionKey="edge.metadata" title="Edge" icon={Workflow} hint={edge.kind}>
        <div>
          <FieldLabel>Edge</FieldLabel>
          <p className="text-sm leading-relaxed text-content-secondary">
            <span className="text-content">{title(edge.source)}</span>
            <span className="px-1 font-mono text-content-muted">—{edge.kind}→</span>
            <span className="text-content">{title(edge.target)}</span>
          </p>
          {/* At-a-glance affordance (contract §"F — frontend"): does this
              edge change what gets compiled, or is it advisory/lint-only?
              Right-click the edge on the canvas to change its kind — the
              same grouped structural/advisory list as the KindPicker. */}
          <span
            className={`mt-1.5 inline-flex h-[17px] items-center rounded-sm border px-1 font-mono text-micro uppercase tracking-wider ${
              structural
                ? "border-border-strong bg-surface-2 text-content-secondary"
                : "border-border bg-surface-2 text-content-muted"
            }`}
            title={
              structural
                ? "Structural — participates in compile ordering and cycle checks"
                : "Advisory — lint-only, never changes compiled output"
            }
          >
            {structural ? "structural" : "advisory"}
          </span>
        </div>
        {edge.kind === "conditional" && (
          <div>
            <FieldLabel>Condition</FieldLabel>
            <input
              value={edge.condition ?? ""}
              onChange={(e) => updateEdge(edge.id, { condition: e.target.value })}
              placeholder="src/net/** or plain language"
              className="h-control w-full rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent"
            />
          </div>
        )}
        <div>
          <FieldLabel>Note</FieldLabel>
          <input
            value={edge.note ?? ""}
            onChange={(e) => updateEdge(edge.id, { note: e.target.value })}
            placeholder="Replaces the verb on the wire's label"
            className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent"
          />
        </div>
      </InspectorSection>
    ),
    // WO10 item 13 — the palette is closed and token-backed
    // (canvas/edgeColor.ts): hue on this canvas belongs to roles, so a free
    // colour picker would let a wire impersonate a role marker. "Kind" is
    // the absence of an override, stored as no `color` at all rather than
    // as a literal "default".
    "edge.appearance": (
      <InspectorSection
        sectionKey="edge.appearance"
        title="Appearance"
        icon={Palette}
        hint={colorKey === "default" ? undefined : colorKey}
      >
        <div>
          <FieldLabel>Colour</FieldLabel>
          <div className="flex flex-wrap items-center gap-1.5">
            {EDGE_COLORS.map((c) => {
              const active = colorKey === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  title={c.key === "default" ? "Use the edge kind's own colour" : c.label}
                  aria-pressed={active}
                  onClick={() =>
                    updateEdge(edge.id, { color: c.key === "default" ? undefined : c.key })
                  }
                  className={`h-6 w-6 rounded-sm border-2 transition-colors duration-fast ${
                    active ? "border-accent" : "border-border hover:border-border-strong"
                  }`}
                  style={{
                    background: c.css === "" ? `var(--edge-${edge.kind})` : c.css,
                  }}
                />
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-content-muted">
            {colorKey === "default"
              ? "Following the edge kind."
              : "Overrides the kind colour on the line and its arrowhead."}
          </p>
        </div>
      </InspectorSection>
    ),
    // WO10 item 4 — the route itself is data now (graph v4 `waypoints`).
    // Editing happens on the canvas, by dragging a selected wire's segment
    // handles; the only thing worth a button here is the way back.
    "edge.path": (
      <InspectorSection
        sectionKey="edge.path"
        title="Path"
        icon={Spline}
        hint={routed ? `${edge.waypoints?.length ?? 0} bends` : "auto"}
      >
        <div>
          <button
            onClick={() => updateEdge(edge.id, { waypoints: [] })}
            disabled={!routed}
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:cursor-default disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2"
          >
            <Spline size={13} strokeWidth={1.5} />
            Reset path
          </button>
          <p className="mt-1.5 text-xs leading-snug text-content-muted">
            {routed
              ? "This wire is hand-routed. Reset returns it to the automatic route."
              : "Automatic. Select the wire on the canvas and drag a segment handle to route it by hand."}
          </p>
        </div>
      </InspectorSection>
    ),
    "edge.actions": (
      <InspectorSection sectionKey="edge.actions" title="Actions" icon={Trash2}>
        <button
          onClick={() => deleteEdges([edge.id])}
          className="flex h-control items-center gap-1.5 self-start rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface"
        >
          <Trash2 size={13} strokeWidth={1.5} />
          Delete edge
        </button>
      </InspectorSection>
    ),
  };

  return (
    <div className="flex flex-col overflow-y-auto">
      <SectionStack order={EDGE_ORDER} sections={sections} />
    </div>
  );
}

// ── Panel shell ───────────────────────────────────────────────────────

function InspectorHeader({
  node,
  root,
  onRevealError,
}: {
  node: MemoryNode;
  root: string;
  onRevealError: (msg: string) => void;
}) {
  const tab = useInspectorTabStore((s) => s.tab);
  const setTab = useInspectorTabStore((s) => s.setTab);
  const requestRename = useInspectorTabStore((s) => s.requestRename);
  const headerMenu = useContextMenu();

  const openHeaderMenu = (e: React.MouseEvent) => {
    const protectedFile = isRenameProtected(node.filePath);
    headerMenu.openAt(e, [
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () => {
          void revealPath(root, node.filePath).catch((err: unknown) => onRevealError(String(err)));
        },
      },
      {
        kind: "item",
        id: "copy",
        label: "Copy relative path",
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(node.filePath),
      },
      {
        kind: "item",
        id: "rename",
        label: "Rename file…",
        icon: Pencil,
        disabled: protectedFile,
        hint: protectedFile ? "generated file — not renameable" : undefined,
        onSelect: () => requestRename(),
      },
      {
        kind: "item",
        id: "open-md",
        label: "Open markdown tab",
        icon: FileCode,
        onSelect: () => void openMarkdownTab(node),
      },
    ]);
  };

  return (
    <div onContextMenu={openHeaderMenu} className="flex-none">
      {/* Identity bar — always shows WHICH node the Inspector is editing,
          in the same highlight language as the file rail's selected row
          (accent surface + inset accent bar): glyph in role colour, bold
          title, mini read-order badge. */}
      <div
        className="flex h-[30px] items-center gap-2 border-b border-border-subtle bg-accent-surface px-3 shadow-[inset_2px_0_0_var(--accent)]"
        title={node.title}
      >
        <span className="flex-none" style={{ color: roleVar(node.role) }}>
          <RoleGlyph role={node.role} size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
          {node.title}
        </span>
        <span className="flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-sm border border-border-strong bg-surface-3 px-1 font-mono text-xs font-bold tabular-nums text-content">
          {node.readOrder}
        </span>
      </div>
      <div className="flex h-[30px] items-end gap-4 border-b border-border-subtle px-3">
        {(["properties", "markdown"] as const).map((t) => (
          <button
            key={t}
            onClick={() => (t === "markdown" ? void openMarkdownTab(node) : setTab(t))}
            className={`-mb-px border-b-2 pb-1 text-sm capitalize transition-colors duration-fast ${
              tab === t
                ? "border-accent font-medium text-content"
                : "border-transparent text-content-muted hover:text-content-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {headerMenu.menu !== null && (
        <ContextMenu
          x={headerMenu.menu.x}
          y={headerMenu.menu.y}
          items={headerMenu.menu.items}
          onClose={headerMenu.close}
        />
      )}
    </div>
  );
}

export function Inspector({ root }: { root: string }) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useGraphStore((s) => s.selectedEdgeIds);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const tab = useInspectorTabStore((s) => s.tab);
  const agentsSel = useAgentsStore((s) => s.selection);
  const taskItem = useTasksStore((s) => s.selected);
  const projectSelected = useProjectSelectionStore((s) => s.selected);
  const sessionSelectedId = useSessionsStore((s) => s.selectedId);
  const rightPanelWidth = useSettingsStore((s) => s.rightPanelWidth);
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op." Both reveal entry points in this panel
  // (header menu, File-field menu) feed this one banner.
  const [revealError, setRevealError] = useState<string | null>(null);

  const node =
    selectedNodeIds.length === 1
      ? nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;
  const edge =
    selectedNodeIds.length === 0 && selectedEdgeIds.length === 1
      ? edges.find((e) => e.id === selectedEdgeIds[0])
      : undefined;
  const multi = selectedNodeIds.length + selectedEdgeIds.length > 1;

  // A stale reveal error from the previous node/edge must not linger under
  // the newly selected one.
  useEffect(() => {
    setRevealError(null);
  }, [node?.id, edge?.id]);

  // WO11 §12.3 item 3 — the Markdown tab must not outlive the selection it
  // was opened for. §12.1 confirmed `tab` being global with no relationship
  // to the selection is exactly what made the stale-read hazard zero-click
  // reachable: clicking a different agent node while already on the
  // Markdown tab landed straight in it. One string standing in for "what is
  // selected right now" across every panel-owning selection store (session,
  // node, edge, multi, project, task, agent); any change resets the tab via
  // the dedicated `resetTab` seam (canvas/types.ts), never a bare `setTab`.
  const selectionIdentity = [
    sessionSelectedId ?? "",
    node?.id ?? "",
    edge?.id ?? "",
    multi,
    projectSelected,
    taskItem?.id ?? "",
    agentsSel === null ? "" : `${agentsSel.kind}:${agentsSel.key}`,
  ].join("|");
  useEffect(() => {
    // Fires only when WHAT is selected changes, never on a user's own tab
    // click (setTab/openMarkdownTab don't touch selectionIdentity).
    useInspectorTabStore.getState().resetTab();
  }, [selectionIdentity]);

  return (
    <aside
      className="relative flex flex-none flex-col border-l border-border-subtle bg-surface-1"
      style={{ width: rightPanelWidth }}
    >
      <ScanOverlay caption="rescanning" />
      {sessionSelectedId !== null ? (
        <AgentPanel />
      ) : node !== undefined ? (
        <>
          <InspectorHeader node={node} root={root} onRevealError={setRevealError} />
          {revealError !== null && (
            <div className="flex flex-none items-center gap-2 border-b border-border-subtle bg-danger-surface px-3 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-danger-text">
                {revealError}
              </span>
              <button
                onClick={() => setRevealError(null)}
                title="Dismiss"
                className="grid h-4 w-4 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            </div>
          )}
          {tab === "properties" ? (
            isAgentFile(node.filePath) ? (
              <AgentNodePanel node={node} root={root} />
            ) : (
              <PropertiesTab node={node} root={root} onRevealError={setRevealError} />
            )
          ) : (
            <MarkdownTab node={node} root={root} />
          )}
        </>
      ) : edge !== undefined ? (
        <EdgePanel edge={edge} />
      ) : multi ? (
        <div className="flex flex-col gap-3 p-3">
          <p className="text-sm text-content-secondary">
            {selectedNodeIds.length} node{selectedNodeIds.length === 1 ? "" : "s"},{" "}
            {selectedEdgeIds.length} edge{selectedEdgeIds.length === 1 ? "" : "s"} selected.
          </p>
          <button
            onClick={() => {
              deleteNodes(selectedNodeIds);
              deleteEdges(selectedEdgeIds);
            }}
            className="flex h-control items-center gap-1.5 self-start rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface"
          >
            <Trash2 size={13} strokeWidth={1.5} />
            Delete selection
          </button>
          <p className="text-xs text-content-muted">Files stay on disk.</p>
        </div>
      ) : projectSelected ? (
        <ProjectPanel root={root} />
      ) : taskItem !== null ? (
        <TaskPanel root={root} />
      ) : agentsSel !== null ? (
        <StandaloneAgentsPanel root={root} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-3">
          <p className="max-w-[240px] text-center text-sm leading-relaxed text-content-muted">
            Select a node to edit its properties and markdown. Double-click the canvas to
            create one.
          </p>
        </div>
      )}
    </aside>
  );
}
