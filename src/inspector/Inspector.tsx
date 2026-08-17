// Inspector — right panel, 392px (DESIGN_SPEC.md). Tabs: Properties (visual
// form) + Markdown (CodeMirror on the node's file; explicit save writes to
// disk through Rust). The file on disk is the content source of truth.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Trash2, X } from "lucide-react";
import {
  NODE_ROLES,
  serializeGraph,
  useGraphStore,
  type AssembleStatus,
  type MemoryEdge,
  type MemoryNode,
  type NodeRole,
} from "../store/graph";
import { useProjectStore } from "../store/project";
import { RoleGlyph, roleVar } from "../canvas/RoleGlyphs";
import { assembleCancel, assembleNode, refineNode, summarizeNode } from "../assemble/api";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

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

function PropertiesTab({ node, root }: { node: MemoryNode; root: string }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3">
      <div>
        <FieldLabel>Title</FieldLabel>
        <input
          value={node.title}
          onChange={(e) => updateNode(node.id, { title: e.target.value })}
          className="h-control w-full rounded border border-border bg-surface-2 px-2 text-base text-content focus:border-accent"
        />
      </div>

      <div>
        <FieldLabel>Role</FieldLabel>
        <div className="flex items-center gap-2">
          <span style={{ color: roleVar(node.role) }}>
            <RoleGlyph role={node.role} size={13} />
          </span>
          <select
            value={node.role}
            onChange={(e) => updateNode(node.id, { role: e.target.value as NodeRole })}
            className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 text-base text-content focus:border-accent"
          >
            {NODE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <FieldLabel>Brief</FieldLabel>
        <textarea
          value={node.brief}
          onChange={(e) => updateNode(node.id, { brief: e.target.value })}
          rows={3}
          placeholder="One line for Assemble to expand later"
          className="w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-base leading-snug text-content placeholder:text-content-disabled focus:border-accent"
        />
      </div>

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
          className="truncate rounded border border-border-subtle bg-surface-inset px-2 py-1.5 font-mono text-2xs text-content-secondary [direction:rtl] [text-align:left]"
          title={node.filePath}
        >
          {node.filePath}
        </div>
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

type Tab = "properties" | "markdown";

export function Inspector({ root }: { root: string }) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useGraphStore((s) => s.selectedEdgeIds);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const [tab, setTab] = useState<Tab>("properties");

  const node =
    selectedNodeIds.length === 1
      ? nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;
  const edge =
    selectedNodeIds.length === 0 && selectedEdgeIds.length === 1
      ? edges.find((e) => e.id === selectedEdgeIds[0])
      : undefined;
  const multi = selectedNodeIds.length + selectedEdgeIds.length > 1;

  return (
    <aside className="flex w-inspector flex-none flex-col border-l border-border-subtle bg-surface-1">
      {node !== undefined ? (
        <>
          <div className="flex h-[30px] flex-none items-end gap-4 border-b border-border-subtle px-3">
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
          </div>
          {tab === "properties" ? (
            <PropertiesTab node={node} root={root} />
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
