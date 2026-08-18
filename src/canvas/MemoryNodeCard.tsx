// Memory node card — anatomy per DESIGN_SPEC.md (244 × 97, role stripe,
// glyph + label, pin, read-order badge, title, rtl path, footer badges).
// The whole card is the hit target; handles sit 4px outside.
// Phase 3/4 states: live-read pulse (amber ring + stripe while the agent
// touches the file), assembling bar, assembled success flash, error stripe.
// Contract §7.11: three target handles on the input (left) half, three
// source handles on the output (right) half — ids are frozen and never
// persisted (src/canvas/handles.ts#pickHandles derives the pair at render
// time). Contract §7.9: right-click opens the node's dynamic context menu.

import { memo, useEffect, useReducer, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import {
  FileCode,
  FilePlus2,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useProjectStore } from "../store/project";
import { GRAPH_VERSION, isAgentFile, isRenameProtected, serializeGraph, useGraphStore } from "../store/graph";
import { lastLiveTs, useEventsStore, LIVE_PULSE_MS } from "../store/events";
import { assembleCancel, assembleNode, summarizeNode } from "../assemble/api";
import { revealPath } from "../fs/api";
import { RoleGlyph, roleVar } from "./RoleGlyphs";
import { seedFor, useAgentsStore } from "../store/agents";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useHighlightStore, useInspectorTabStore, type CanvasNode } from "./types";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";

function formatTokens(bytes: number): string {
  const tokens = Math.max(1, Math.round(bytes / 4));
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(1)}k tok`;
}

function MemoryNodeCardInner({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.memory;
  const root = useProjectStore((s) => s.root);
  const file = useProjectStore((s) => s.files.find((f) => f.relPath === node.filePath));
  const assembleStatus = useGraphStore((s) => s.assembleStatus[node.id] ?? "idle");
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const setSelection = useGraphStore((s) => s.setSelection);
  const setInspectorTab = useInspectorTabStore((s) => s.setTab);
  const requestRename = useInspectorTabStore((s) => s.requestRename);
  const role = roleVar(node.role);
  // Agent-backed nodes wear their identity avatar instead of the role glyph.
  const agentBacked = isAgentFile(node.filePath);
  const agentFileName = agentBacked ? (node.filePath.split("/").pop() ?? node.filePath) : "";
  const avatarSeed = useAgentsStore((s) => (agentBacked ? seedFor(s.meta, agentFileName) : ""));
  const contextMenu = useContextMenu();
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op." The card has no room for a permanent
  // error line, so this is a dismissible banner anchored under the card
  // (the card is already `position: relative`) instead of a global toast.
  const [revealError, setRevealError] = useState<string | null>(null);

  // Live-read pulse: derived from the event feed; a timer re-renders once the
  // pulse window closes (the store itself never ticks).
  const liveTs = useEventsStore((s) => lastLiveTs(node.id, s.events));
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const live = liveTs !== null && Date.now() - liveTs < LIVE_PULSE_MS;
  useEffect(() => {
    if (liveTs === null) return;
    const remain = liveTs + LIVE_PULSE_MS - Date.now();
    if (remain <= 0) return;
    const t = setTimeout(bump, remain + 60);
    return () => clearTimeout(t);
  }, [liveTs]);

  // Assembled → 2px success ring, then fades back to rest (DESIGN_SPEC).
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (assembleStatus !== "assembled") return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [assembleStatus]);

  const assembling = assembleStatus === "queued" || assembleStatus === "running";
  const stripe =
    live ? "var(--amber)" : assembleStatus === "error" ? "var(--danger)" : role;

  // Hover-highlight echo from the Inspector's Relations grid: a softer
  // accent ring than real selection, so the two states stay tellable.
  const highlighted = useHighlightStore((s) => s.nodeIds.includes(node.id));
  const ring = selected
    ? "0 0 0 2px var(--accent), 0 4px 14px rgba(0,0,0,.45)"
    : highlighted
      ? "0 0 0 2px var(--accent-border), var(--elev-1)"
      : flash
        ? "0 0 0 2px var(--success), var(--elev-1)"
        : "var(--elev-1)";
  const boxShadow = live ? `${ring}, var(--glow-live)` : ring;

  // Fire-and-forget enqueue, mirroring Inspector's AssembleSection — the
  // card has no room for an error line, so failures surface through the
  // Inspector once the node is selected (setSelection below).
  const runAssemble = (fn: (graphJson: string) => Promise<void>) => {
    void (async () => {
      await useGraphStore.getState().flushSave();
      const s = useGraphStore.getState();
      const graphJson = serializeGraph({
        version: GRAPH_VERSION,
        projectName: s.projectName,
        nodes: s.nodes,
        edges: s.edges,
        compileTargets: s.compileTargets,
      });
      useGraphStore.getState().setAssembleStatus(node.id, "queued");
      try {
        await fn(graphJson);
      } catch {
        if (useGraphStore.getState().assembleStatus[node.id] === "queued") {
          useGraphStore.getState().setAssembleStatus(node.id, "idle");
        }
      }
    })();
  };

  const openMenu = (e: React.MouseEvent) => {
    if (root === null) return;
    const protectedFile = isRenameProtected(node.filePath);
    const items: MenuItem[] = [
      file === undefined
        ? {
            kind: "item",
            id: "create-file",
            label: "Create file",
            icon: FilePlus2,
            onSelect: () => {
              invoke("write_md_file", {
                root,
                relPath: node.filePath,
                content: `# ${node.title}\n\n`,
              })
                .then(() => {
                  setSelection([node.id], []);
                  setInspectorTab("markdown");
                  void useProjectStore.getState().rescan();
                })
                .catch((err: unknown) => console.error(err));
            },
          }
        : {
            kind: "item",
            id: "open-md",
            label: "Open markdown",
            icon: FileCode,
            onSelect: () => {
              setSelection([node.id], []);
              setInspectorTab("markdown");
            },
          },
      {
        kind: "item",
        id: "rename",
        label: "Rename file…",
        icon: Pencil,
        disabled: protectedFile,
        hint: protectedFile ? "generated file — not renameable" : undefined,
        onSelect: () => {
          setSelection([node.id], []);
          requestRename();
        },
      },
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        onSelect: () => {
          setRevealError(null);
          void revealPath(root, node.filePath).catch((err: unknown) => setRevealError(String(err)));
        },
      },
      { kind: "separator", id: "sep-1" },
      {
        kind: "item",
        id: "pin",
        label: node.pinned ? "Unpin" : "Pin",
        icon: node.pinned ? PinOff : Pin,
        onSelect: () => updateNode(node.id, { pinned: !node.pinned }),
      },
      {
        kind: "item",
        id: "assemble",
        label: "Assemble",
        icon: Sparkles,
        disabled: assembling,
        hint: assembling ? "already running" : undefined,
        onSelect: () => runAssemble((graphJson) => assembleNode(root, graphJson, node.id)),
      },
      {
        kind: "item",
        id: "summarize",
        label: "Summarize",
        disabled: assembling,
        hint: assembling ? "already running" : undefined,
        onSelect: () => runAssemble((graphJson) => summarizeNode(root, graphJson, node.id)),
      },
      ...(assembleStatus === "queued"
        ? ([
            {
              kind: "item",
              id: "cancel-assemble",
              label: "Cancel assemble",
              icon: XCircle,
              onSelect: () => {
                void assembleCancel(node.id).then((removed) => {
                  if (removed) useGraphStore.getState().setAssembleStatus(node.id, "idle");
                });
              },
            },
          ] satisfies MenuItem[])
        : []),
      { kind: "separator", id: "sep-2" },
      {
        kind: "item",
        id: "remove",
        label: "Remove from graph",
        icon: Trash2,
        danger: true,
        onSelect: () => deleteNodes([node.id]),
      },
    ];
    contextMenu.openAt(e, items);
  };

  return (
    <div
      onContextMenu={openMenu}
      className={`ct-node group relative w-node rounded border bg-surface-2 transition-colors duration-fast ${
        selected ? "border-transparent" : "border-border hover:border-border-strong"
      }`}
      style={{ minHeight: 80, boxShadow }}
    >
      {/* Live-read pulse ring — 2px amber, inset −4px, scale+fade loop */}
      {live && (
        <div
          className="pointer-events-none absolute -inset-1 animate-live-ring rounded-lg border-2 border-amber"
          aria-hidden
        />
      )}

      {/* 1 — role stripe: amber while live, danger on assemble error */}
      <div
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l"
        style={{ background: stripe }}
      />

      {/* Read-order badge — a corner marker overhanging the top-right edge
          so it is CLEARLY visible at any zoom without inflating the card:
          30px, bold xl numerals, strong border; grows for 2-3 digits. */}
      <span className="absolute -right-2 -top-2 z-10 flex h-[30px] min-w-[30px] items-center justify-center rounded-sm border border-border-strong bg-surface-3 px-1.5 font-mono text-xl font-bold tabular-nums text-content shadow-card">
        {node.readOrder}
      </span>

      <div className="flex flex-col gap-1 py-1.5 pl-3 pr-2">
        {/* 2/3 — glyph + role label · live square · pin (read-order badge
            moved to the top-right corner marker above) */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: role }}>
            {agentBacked ? <AgentAvatar seed={avatarSeed} size={11} /> : <RoleGlyph role={node.role} />}
          </span>
          <span
            className="font-mono text-micro uppercase"
            style={{ color: role, letterSpacing: "0.09em" }}
          >
            {node.role}
          </span>
          <div className="flex-1" />
          {live && (
            <span
              className="h-[5px] w-[5px] flex-none animate-blink bg-amber"
              style={{ animationTimingFunction: "steps(2)", animationDuration: "1s" }}
              title="Agent is reading this file"
            />
          )}
          {node.pinned && (
            <Pin size={11} strokeWidth={1.5} className="flex-none text-amber-text" />
          )}
        </div>

        {/* 5 — title: single line, never wraps */}
        <div className="truncate text-base font-semibold text-content">{node.title}</div>

        {/* Assembling — accent indeterminate bar under the title */}
        {assembling && (
          <div className="h-[3px] w-full overflow-hidden rounded-pill bg-surface-3">
            <div
              className={`h-full rounded-pill bg-accent ${
                assembleStatus === "running" ? "w-2/3 animate-blink" : "w-1/4 opacity-50"
              }`}
            />
          </div>
        )}

        {/* 6 — path: rtl so the filename survives truncation */}
        <div
          className="truncate font-mono text-2xs text-content-muted [direction:rtl] [text-align:left]"
          title={node.filePath}
        >
          {node.filePath}
        </div>

        {/* 7 — footer: token count always; at most ONE status badge */}
        <div className="flex items-center gap-1">
          <span className="rounded-sm border border-border px-1 py-px font-mono text-micro text-content-muted">
            {file !== undefined ? formatTokens(file.sizeBytes) : "0 tok"}
          </span>
          {file === undefined ? (
            <span className="rounded-sm bg-danger-surface px-1 py-px font-mono text-micro text-danger-text">
              missing file
            </span>
          ) : assembleStatus === "error" ? (
            <span className="rounded-sm bg-danger-surface px-1 py-px font-mono text-micro text-danger-text">
              assemble failed
            </span>
          ) : assembleStatus === "running" ? (
            <span className="rounded-sm bg-accent-surface px-1 py-px font-mono text-micro text-accent-text">
              assembling
            </span>
          ) : assembleStatus === "queued" ? (
            <span className="rounded-sm bg-surface-3 px-1 py-px font-mono text-micro text-content-secondary">
              queued
            </span>
          ) : null}
        </div>
      </div>

      {/* 8 — ports: ONE input funnel (left) and ONE output funnel (right),
          always visible — a port you cannot see is a port you cannot aim
          at. Edges carry no handle ids; routing is canvas/edgePath.ts. */}
      <Handle type="target" position={Position.Left} className="ct-port ct-port-in" />
      <Handle type="source" position={Position.Right} className="ct-port ct-port-out" />

      {revealError !== null && (
        <div className="absolute left-0 right-0 top-full z-tooltip mt-1 flex items-center gap-1.5 rounded border border-danger bg-danger-surface px-2 py-1 shadow-card">
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-danger-text">
            {revealError}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevealError(null);
            }}
            title="Dismiss"
            className="grid h-3.5 w-3.5 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
          >
            <X size={10} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {contextMenu.menu !== null && (
        <ContextMenu
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          items={contextMenu.menu.items}
          onClose={contextMenu.close}
        />
      )}
    </div>
  );
}

export const MemoryNodeCard = memo(MemoryNodeCardInner);
