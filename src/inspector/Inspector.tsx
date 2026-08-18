// Inspector — right panel, 392px (DESIGN_SPEC.md). Tabs: Properties (visual
// form) + Markdown (CodeMirror on the node's file; explicit save writes to
// disk through Rust). The file on disk is the content source of truth.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, FileCode, FolderOpen, Pencil, Sparkles, Trash2, X } from "lucide-react";
import {
  NODE_ROLES,
  isRenameProtected,
  serializeGraph,
  suggestFilePath,
  useGraphStore,
  type AssembleStatus,
  type MemoryEdge,
  type MemoryNode,
} from "../store/graph";
import { useProjectStore } from "../store/project";
import { useSettingsStore } from "../store/settings";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { useInspectorTabStore } from "../canvas/types";
import { ROLE_DESCRIPTIONS } from "../canvas/roleMeta";
import { assembleCancel, assembleNode, refineNode, summarizeNode } from "../assemble/api";
import { revealPath } from "../fs/api";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { ScanOverlay } from "../ui/ScanOverlay";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";

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
        version: 1,
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

/** Role popup (contract §7.5) — built on the shared menu primitive so it
 *  gets viewport-flip, keyboard nav and Escape/outside-close for free. The
 *  primitive's MenuItem.icon is typed to lucide's LucideIcon and can't carry
 *  the hand-drawn 8×8 role glyph, so rows show name + description only; the
 *  active role's glyph + description stay visible under the control, per
 *  the acceptance criterion, regardless of whether the popup is open. */
function RoleField({ node }: { node: MemoryNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const openPopup = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setOpen({ x: rect.left, y: rect.bottom + 4 });
  };

  const items: MenuItem[] = NODE_ROLES.map((r) => ({
    kind: "item",
    id: r,
    label: r,
    hint: ROLE_DESCRIPTIONS[r],
    checked: r === node.role,
    onSelect: () => updateNode(node.id, { role: r }),
  }));

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
      <p className="mt-1 text-xs leading-snug text-content-muted">
        {ROLE_DESCRIPTIONS[node.role]}
      </p>
      {open !== null && (
        <ContextMenu
          x={open.x}
          y={open.y}
          items={items}
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
  const setTab = useInspectorTabStore((s) => s.setTab);
  const fileMenu = useContextMenu();

  const openFileMenu = (e: React.MouseEvent) => {
    const protectedFile = isRenameProtected(node.filePath);
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
        onSelect: () => setTab("properties"),
      },
      {
        kind: "item",
        id: "open-md",
        label: "Open markdown tab",
        icon: FileCode,
        onSelect: () => setTab("markdown"),
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3">
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

      <div>
        <FieldLabel>File</FieldLabel>
        <div
          onContextMenu={openFileMenu}
          className="truncate rounded border border-border-subtle bg-surface-inset px-2 py-1.5 font-mono text-2xs text-content-secondary [direction:rtl] [text-align:left]"
          title={node.filePath}
        >
          {node.filePath}
        </div>
        {fileMenu.menu !== null && (
          <ContextMenu
            x={fileMenu.menu.x}
            y={fileMenu.menu.y}
            items={fileMenu.menu.items}
            onClose={fileMenu.close}
          />
        )}
      </div>

      <AssembleSection node={node} root={root} />

      <div className="mt-2 border-t border-border-subtle pt-3">
        <button
          onClick={() => deleteNodes([node.id])}
          className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface"
        >
          <Trash2 size={13} strokeWidth={1.5} />
          Remove from graph
        </button>
        <p className="mt-1.5 text-xs text-content-muted">The .md file stays on disk.</p>
      </div>
    </div>
  );
}

// ── Markdown tab ──────────────────────────────────────────────────────

type LoadState =
  | { kind: "loading" }
  | { kind: "missing"; error: string }
  | { kind: "ready"; generation: number };

function MarkdownTab({ node, root }: { node: MemoryNode; root: string }) {
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

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <FieldLabel>Edge</FieldLabel>
        <p className="text-sm leading-relaxed text-content-secondary">
          <span className="text-content">{title(edge.source)}</span>
          <span className="px-1 font-mono text-content-muted">—{edge.kind}→</span>
          <span className="text-content">{title(edge.target)}</span>
        </p>
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
          placeholder="Optional label on the edge"
          className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content placeholder:text-content-disabled focus:border-accent"
        />
      </div>
      <button
        onClick={() => deleteEdges([edge.id])}
        className="flex h-control items-center gap-1.5 self-start rounded border border-border bg-surface-2 px-3 text-sm text-danger-text transition-colors duration-fast hover:border-danger hover:bg-danger-surface"
      >
        <Trash2 size={13} strokeWidth={1.5} />
        Delete edge
      </button>
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
        onSelect: () => setTab("properties"),
      },
      {
        kind: "item",
        id: "open-md",
        label: "Open markdown tab",
        icon: FileCode,
        onSelect: () => setTab("markdown"),
      },
    ]);
  };

  return (
    <div
      onContextMenu={openHeaderMenu}
      className="flex h-[30px] flex-none items-end gap-4 border-b border-border-subtle px-3"
    >
      {(["properties", "markdown"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`-mb-px border-b-2 pb-1 text-sm capitalize transition-colors duration-fast ${
            tab === t
              ? "border-accent font-medium text-content"
              : "border-transparent text-content-muted hover:text-content-secondary"
          }`}
        >
          {t}
        </button>
      ))}
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

  return (
    <aside
      className="relative flex flex-none flex-col border-l border-border-subtle bg-surface-1"
      style={{ width: rightPanelWidth }}
    >
      <ScanOverlay caption="rescanning" />
      {node !== undefined ? (
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
            <PropertiesTab node={node} root={root} onRevealError={setRevealError} />
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
