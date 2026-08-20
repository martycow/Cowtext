// Memory node plate — the Barn canvas card (direction C, Marty 2026-08-19).
// 244px wide, hard 2px edge, offset shadow with no blur, square corners.
// Two shapes, one information order:
//   memory plate — solid role glyph chip in the top-left corner, read-order
//     tag in the top-right, role label / title / rtl path / tags.
//   agent plate  — notched top-left corner, framed portrait window and
//     model nameplate, whole 3px frame in the identity colour. Silhouette
//     is the identification, so it survives zoom-out and greyscale; the old
//     1px ring + AGENT chip did not (see the agent-nodes sheet).
// The whole plate is the hit target; ports straddle the edges.
// Phase 3/4 states: live-read pulse (amber ring + stripe while the agent
// touches the file), assembling bar, assembled success flash, error stripe.
// Connector hardware (WO09 round 2, docs/design/WO09_CONNECTOR_CONTRACT.md
// §6): ONE target handle on the input (left) edge, ONE source handle on the
// output (right) edge — no handle ids, frozen. Each side's block shows five
// contact fingers, but which finger a given wire lands on is decided by
// canvas/portSlots.ts and applied by canvas/edgePath.ts, not by the handle
// itself; see the port comment further down, just above the two <Handle>
// elements. Contract §7.9: right-click opens the node's dynamic context
// menu.

import { memo, useEffect, useMemo, useReducer, useState } from "react";
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
import { useSettingsStore } from "../store/settings";
import { GRAPH_VERSION, isAgentFile, isRenameProtected, serializeGraph, useGraphStore } from "../store/graph";
import { lastLiveTs, lensLiveTs, useEventsStore, LIVE_PULSE_MS } from "../store/events";
import { assembleCancel, assembleNode, summarizeNode } from "../assemble/api";
import { revealPath } from "../fs/api";
import { activityEmphasis, brightnessFor, useLensTickStore, weightEmphasis } from "./lens";
import { RoleGlyph, roleVar } from "./RoleGlyphs";
import { metaOrDefault, seedFor, useAgentsStore } from "../store/agents";
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
  // §7.2 (#5): display name + model chip come from the live agent doc;
  // priority chip comes from the sidecar meta. Both fall back gracefully
  // when the agent doc hasn't loaded yet (e.g. mid-scan).
  const agentDoc = useAgentsStore((s) =>
    agentBacked ? s.agents.find((a) => a.fileName === agentFileName) : undefined,
  );
  const agentMeta = useAgentsStore((s) => (agentBacked ? metaOrDefault(s.meta, agentFileName) : null));
  const agentDisplayName =
    agentDoc?.fields.name?.trim() || agentFileName.replace(/\.md$/i, "");
  const agentModel = agentDoc?.fields.model ?? "inherit";
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
  // The plate's 2px edge carries state. Role colour no longer appears as an
  // edge at all — it moved to the corner glyph chip — so the edge is free to
  // mean "something is happening to this node".
  const plateEdge = live
    ? "var(--amber)"
    : assembleStatus === "error"
      ? "var(--danger)"
      : "var(--plate-edge)";
  // Agent plates take their ENTIRE frame from the identity colour, which is
  // what makes them a different object at any zoom (the notch does the rest).
  const agentFrame = live
    ? "var(--amber)"
    : assembleStatus === "error"
      ? "var(--danger)"
      : "var(--role-agent)";

  // Hover-highlight echo from the Inspector's Relations grid: a softer
  // accent than real selection, so the two states stay tellable.
  const highlighted = useHighlightStore((s) => s.nodeIds.includes(node.id));
  // Selection is a stamped marquee around the plate rather than a ring on it:
  // the agent plate is clip-path'd, so a box-shadow ring would be clipped
  // into the notch. One rule, both plate shapes, priority as before.
  const marquee = selected
    ? "var(--accent)"
    : highlighted
      ? "var(--accent-border)"
      : flash
        ? "var(--success)"
        : null;

  // Lens emphasis/brightness — styling only, never layout (contract §6.1).
  // `tick` is subscribed unconditionally (rules-of-hooks); it only ever
  // advances while the Activity lens is mounted and active (LensControl).
  const lens = useSettingsStore((s) => s.lens);
  const tick = useLensTickStore((s) => s.tick);
  const maxBytes = useProjectStore((s) => s.files.reduce((m, f) => Math.max(m, f.sizeBytes), 0));
  const liveEmphasisTs = useEventsStore((s) => lensLiveTs(node.id, s.events));
  // Date.now() is intentionally not itself a dependency: tick/lens are the
  // proxies that decide when "now" should be recomputed (contract §6.2).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowMs = useMemo(() => Date.now(), [tick, lens]);
  const lensEmphasis =
    lens === "activity"
      ? activityEmphasis(nowMs, file?.modifiedMs ?? null)
      : lens === "weight"
        ? weightEmphasis(file?.sizeBytes, maxBytes)
        : lens === "live"
          ? liveEmphasisTs !== null
            ? 1
            : 0
          : 1;
  const lensBrightness = lens === "none" ? 1 : brightnessFor(lensEmphasis);
  const lensStyle: React.CSSProperties & { [customProp: `--${string}`]: string | number } = {
    "--lens-brightness": lensBrightness,
    "--lens-emphasis": lens === "none" ? 1 : lensEmphasis,
    filter: "brightness(var(--lens-brightness, 1))",
  };

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

  // ── Shared plate parts. Both plate shapes carry the same information in
  // the same order; only the frame and the identity mark differ.
  const TAG = "border border-plate-edge px-1 py-px font-mono text-micro leading-none text-content-muted";

  // Read-order — a stamped corner tag butted into the top-right edge, so it
  // never collides with the selection marquee and never inflates the plate.
  const orderTag = (
    <span
      className="absolute right-0 top-0 z-10 flex h-6 min-w-[26px] items-center justify-center border-b-2 border-l-2 px-1 font-pixel text-[10px] leading-none text-content"
      style={{ background: "var(--barn-tag)", borderColor: "var(--plate-edge-hi)" }}
      title={`Read order ${node.readOrder}`}
    >
      {node.readOrder}
    </span>
  );

  const liveAndPin = (
    <>
      {live && (
        <span
          className="h-[6px] w-[6px] flex-none animate-hard-blink bg-amber"
          title="Agent is reading this file"
        />
      )}
      {node.pinned && <Pin size={11} strokeWidth={1.5} className="flex-none text-amber-text" />}
    </>
  );

  // Title · assembling bar · rtl path — identical on both plates.
  const titleBlock = (
    <>
      <div className="truncate text-base font-semibold text-content">{node.title}</div>
      {assembling && (
        <div className="h-[4px] w-full overflow-hidden bg-plate-inset">
          <div
            className={`h-full bg-accent ${
              assembleStatus === "running" ? "w-2/3 animate-hard-blink" : "w-1/4 opacity-50"
            }`}
          />
        </div>
      )}
      <div
        className="truncate font-mono text-2xs text-content-muted [direction:rtl] [text-align:left]"
        title={node.filePath}
      >
        {node.filePath}
      </div>
    </>
  );

  // Footer: token count always; at most ONE status badge. Agent plates add
  // a priority tag (the model lives on the portrait nameplate instead).
  const tagRow = (
    <div className="flex items-center gap-1">
      {agentBacked && <span className={TAG}>{`P${agentMeta?.priority ?? 3}`}</span>}
      <span className={TAG}>
        {file !== undefined ? formatTokens(file.sizeBytes) : "0 tok"}
      </span>
      {file === undefined ? (
        <span className="bg-danger-surface px-1 py-px font-mono text-micro leading-none text-danger-text">
          missing file
        </span>
      ) : assembleStatus === "error" ? (
        <span className="bg-danger-surface px-1 py-px font-mono text-micro leading-none text-danger-text">
          assemble failed
        </span>
      ) : assembleStatus === "running" ? (
        <span className="bg-accent-surface px-1 py-px font-mono text-micro leading-none text-accent-text">
          assembling
        </span>
      ) : assembleStatus === "queued" ? (
        <span className="bg-barn-tag px-1 py-px font-mono text-micro leading-none text-content-secondary">
          queued
        </span>
      ) : null}
    </div>
  );

  return (
    <div onContextMenu={openMenu} className="ct-node group relative w-node" style={lensStyle}>
      {/* Live-read marquee — a hard 2px amber rectangle that blinks in one
          step. No scale, no fade: on this canvas things flash, they don't
          breathe. Under reduced motion the animation stops and the
          rectangle simply stays put, which is still the whole signal. */}
      {live && (
        <div
          className="pointer-events-none absolute -inset-[5px] animate-hard-blink border-2 border-amber"
          aria-hidden
        />
      )}
      {/* Selection · relations-hover · assembled-flash, in that priority. */}
      {marquee !== null && (
        <div
          className="pointer-events-none absolute -inset-[5px] border-2"
          style={{ borderColor: marquee }}
          aria-hidden
        />
      )}

      {agentBacked ? (
        // ── Agent stall plate. The notched top-left corner and the framed
        // portrait window are the identification: both are silhouette, so
        // they survive zoom-out and greyscale where a ring and a chip did
        // not. The whole 3px frame is the identity colour.
        <div
          className="relative"
          style={{
            background: agentFrame,
            padding: 3,
            clipPath: "polygon(18px 0, 100% 0, 100% 100%, 0 100%, 0 18px)",
            // clip-path clips box-shadow, so the hard offset has to come
            // from a filter — same 4px 4px 0, follows the notch.
            filter: "drop-shadow(var(--plate-drop))",
          }}
        >
          <div
            className="relative flex bg-plate transition-colors duration-fast group-hover:bg-plate-hi"
            style={{
              clipPath: "polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)",
              boxShadow: "inset 1px 1px 0 var(--plate-lip)",
            }}
          >
            {orderTag}
            {/* Portrait window + nameplate */}
            <div className="flex w-[66px] flex-none flex-col items-start gap-[5px] pb-2 pl-[10px] pt-[10px]">
              <span
                className="grid h-[46px] w-[46px] flex-none place-items-center border-2 bg-plate-inset"
                style={{ borderColor: agentFrame }}
              >
                <AgentAvatar seed={avatarSeed} size={30} />
              </span>
              <span
                className="w-[46px] truncate px-[2px] py-[3px] text-center font-pixel text-[8px] leading-none"
                style={{ background: agentFrame, color: "var(--barn-canvas)" }}
                title={`Model: ${agentModel}`}
              >
                {agentModel}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-2 pl-1.5 pr-2.5 pt-[9px]">
              <div className="flex items-center gap-1.5 pr-[22px]">
                <span
                  className="truncate font-pixel text-[8px] leading-none"
                  style={{ color: agentFrame }}
                  title={agentDisplayName}
                >
                  {`agent · ${agentDisplayName}`}
                </span>
                <div className="flex-1" />
                {liveAndPin}
              </div>
              {titleBlock}
              {tagRow}
            </div>
          </div>
        </div>
      ) : (
        // ── Memory plate. Role colour is a solid corner chip with the 8×8
        // glyph knocked out of it — louder than the old 3px stripe, and it
        // frees the plate edge to carry state instead.
        <div
          className="relative border-2 bg-plate shadow-plate transition-colors duration-fast group-hover:bg-plate-hi"
          style={{ borderColor: plateEdge }}
        >
          <span
            className="absolute left-0 top-0 grid h-6 w-6 place-items-center"
            style={{ background: role, color: "var(--barn-canvas)" }}
          >
            <RoleGlyph role={node.role} size={14} />
          </span>
          {orderTag}
          <div className="flex flex-col gap-1.5 pb-2 pl-8 pr-2.5 pt-[5px]">
            <div className="flex h-[14px] items-center gap-1.5 pr-[22px]">
              <span
                className="truncate font-pixel text-[8px] uppercase leading-none"
                style={{ color: role }}
              >
                {node.role}
              </span>
              <div className="flex-1" />
              {liveAndPin}
            </div>
            {titleBlock}
            {tagRow}
          </div>
        </div>
      )}

      {/* Ports: ONE socket bay (left) and ONE pin block (right), always
          visible — a port you cannot see is a port you cannot aim at. Each
          side is a run of five cartridge contact fingers (styles/index.css
          connector block); still no handle ids — which finger a given wire
          lands on is decided by canvas/portSlots.ts and applied by
          canvas/edgePath.ts, not by the handle itself. */}
      <Handle type="target" position={Position.Left} className="ct-port ct-port-in" />
      <Handle type="source" position={Position.Right} className="ct-port ct-port-out" />

      {revealError !== null && (
        <div className="absolute left-0 right-0 top-full z-tooltip mt-2 flex items-center gap-1.5 border-2 border-danger bg-danger-surface px-2 py-1 shadow-plate-sm">
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
