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
  AlertTriangle,
  Bot,
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
import { useUiStore } from "../store/ui";
import { NODE_TYPE_BY_ROLE } from "../config/nodeTypes";
import { legalityFor } from "../config/edgeRules";
import {
  GRAPH_VERSION,
  canonPath,
  isAgentFile,
  isRenameProtected,
  sameRelPath,
  serializeGraph,
  useGraphStore,
  type AssemblePhase,
} from "../store/graph";
import { lastLiveTs, lensLiveTs, useEventsStore, LIVE_PULSE_MS } from "../store/events";
import { assembleCancel, assembleNode, summarizeNode } from "../assemble/api";
import type { AssembleMode } from "../assemble/types";
import { revealPath } from "../fs/api";
import { activityEmphasis, brightnessFor, useLensTickStore, weightEmphasis } from "./lens";
import { RoleGlyph, roleVar } from "./RoleGlyphs";
import { DEFAULT_PRIORITY, metaOrDefault, seedFor, useAgentsStore } from "../store/agents";
import { AgentAvatar } from "../agents/AgentAvatar";
import { shortModelLabel } from "../agents/modelCatalog";
import { portHeight } from "./portSlots";
import { useDenyTargetStore, useHighlightStore, useInspectorTabStore, type CanvasNode } from "./types";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { formatTokenCount, tokensForBytes } from "../store/tokens";
import { pushToast } from "../store/toasts";
import { requestAssemble } from "../assemble/gate";

// WO13_CONTRACT.md §3.3 / defect 5: `AssembleProgress` genuinely has no
// denominator (the runner is one-shot, `assemble.rs:751-781`), so the fix is
// a 3-step stepper plus a live elapsed readout — determinate where the data
// is real (which phase we're in), elapsed time where it isn't (how long).
// "queued"/"done"/"error" are not steps on the track: "queued" is before it,
// "done"/"error" both flip `assembleStatus` away from queued/running almost
// immediately, which is what actually gates whether this block renders at
// all (see `assembling` below) — so the track only ever needs to answer
// "which of these three are we past."
const PHASE_STEPS: readonly AssemblePhase[] = ["starting", "running", "writing"];

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function MemoryNodeCardInner({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.memory;
  const root = useProjectStore((s) => s.root);
  const file = useProjectStore((s) => s.files.find((f) => sameRelPath(f.relPath, node.filePath)));
  const assembleStatus = useGraphStore((s) => s.assembleStatus[node.id] ?? "idle");
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const setSelection = useGraphStore((s) => s.setSelection);
  const setInspectorTab = useInspectorTabStore((s) => s.setTab);
  const requestRename = useInspectorTabStore((s) => s.requestRename);
  const role = roleVar(node.role);
  const nodeType = NODE_TYPE_BY_ROLE[node.role];
  // Agent-backed nodes wear their identity avatar instead of the role glyph.
  const agentBacked = isAgentFile(node.filePath);
  // WO11_CONTRACT.md §10.5 — a bare "/" split left a Windows backslash path
  // (`.claude\agents\tech-ui.md`) as the whole `agentFileName`, matching no
  // AgentDoc. `canonPath` normalizes separators/case first, same fix as
  // Inspector.tsx's AgentNodePanel and graph.ts's rename listener.
  const agentFileName = agentBacked ? (canonPath(node.filePath).split("/").pop() ?? node.filePath) : "";
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
  // WO10 item 14 — the nameplate is a fixed 46px box, so a raw wire id like
  // "claude-haiku-4-5-20251001" showed as "claude-h…" and told you nothing.
  // The full id stays in the tooltip.
  const agentModelShort = shortModelLabel(agentModel);
  // WO10 item 15 — the nickname is what Marty actually calls this agent; it
  // was stored in the sidecar and rendered in three other places but never
  // on the plate, which is the one surface you look at while wiring.
  const agentNickname = agentMeta?.nickname.trim() ?? "";
  // WO10 item 3 — pin counts ride in on node data (computed once per edge
  // change in GraphCanvas), so a card never sweeps the edge list itself.
  const inPins = data.pins?.in ?? 1;
  const outPins = data.pins?.out ?? 1;
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
  // Defect 5 (§3.3): `phase`/`startedAt` are additive telemetry beside the
  // authoritative `assembleStatus` above — `assembling` still decides
  // whether this block renders at all, `phase` only decides what's inside.
  const assemblePhase = useGraphStore((s) => s.assemblePhase[node.id]);
  const assembleStartedAt = useGraphStore((s) => s.assembleStartedAt[node.id]);
  const phaseIndex = assemblePhase !== undefined ? PHASE_STEPS.indexOf(assemblePhase) : -1;
  // Same "force a re-render, read Date.now() at render time" idiom as the
  // live-pulse reducer above — a live mm:ss readout with no store-side timer.
  const [, bumpClock] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!assembling || assembleStartedAt === undefined) return;
    const t = setInterval(bumpClock, 1000);
    return () => clearInterval(t);
  }, [assembling, assembleStartedAt]);
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
  // §7.3 E4: this card is the currently-hovered target of an in-progress
  // connection drag AND every edge kind would deny it — dim it so the
  // refusal is visible on the card itself, not just in the cursor tooltip
  // GraphCanvas renders from the same store entry.
  const denyReason = useDenyTargetStore((s) => (s.nodeId === node.id ? s.reason : null));
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

  // F7: routes through the always-on confirmation gate instead of invoking
  // the Rust command directly — flush/serialize still happen up front (the
  // preview must describe the saved state), but the optimistic "queued"
  // mark moves inside `onApprove` so a cancelled gate leaves the node's
  // status untouched. F1: the swallowed `catch {}` this replaced (the card
  // has no room for a permanent error line) now surfaces as a toast rather
  // than silently resetting to idle.
  const runAssemble = (mode: AssembleMode, fn: (graphJson: string) => Promise<void>) => {
    if (root === null) return;
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
      requestAssemble({
        root,
        graphJson,
        nodeId: node.id,
        mode,
        instruction: null,
        onApprove: async () => {
          useGraphStore.getState().setAssembleStatus(node.id, "queued");
          try {
            await fn(graphJson);
          } catch (e) {
            if (useGraphStore.getState().assembleStatus[node.id] === "queued") {
              useGraphStore.getState().setAssembleStatus(node.id, "idle");
            }
            pushToast({ severity: "danger", title: "Assemble could not start", detail: String(e) });
          }
        },
      });
    })();
  };

  const openMenu = (e: React.MouseEvent) => {
    if (root === null) return;
    const protectedFile = isRenameProtected(node.filePath);
    // Fix round (tester #2) — see the "New agent from this node…" row below.
    // `false` for the deprecation axis is deliberate: this asks whether the
    // node's ROLE can ever be imported, which is a permanent property, not
    // whether this particular node happens to be deprecated right now (a
    // state one Inspector toggle away, and one that would need a different
    // sentence than the role hint below).
    const agentCannotImport = legalityFor("agent", "imports", node.role, false).legality === "deny";
    const items: MenuItem[] = [
      file === undefined
        ? {
            kind: "item",
            id: "create-file",
            label: "Create file",
            icon: FilePlus2,
            onSelect: () => {
              // WO11_CONTRACT.md §12.5 — an agent path must never be created
              // through the generic `write_md_file` (a bare `# {title}\n\n`
              // stub with no frontmatter, which `agents_scan` then reports
              // as a broken `raw` agent). Route through the SAME
              // `agent_create` every other "new agent" surface uses, at the
              // exact fileName this node already names — it writes the real
              // template and seeds the memory folder.
              if (isAgentFile(node.filePath)) {
                const fileName = canonPath(node.filePath).split("/").pop() ?? node.filePath;
                void useAgentsStore
                  .getState()
                  .createAgent(node.title, { fileName })
                  .then((err) => {
                    if (err !== null) {
                      pushToast({ severity: "danger", title: "Could not create agent file", detail: err });
                      return;
                    }
                    setSelection([node.id], []);
                    setInspectorTab("markdown");
                    void useProjectStore.getState().rescan();
                  });
                return;
              }
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
                .catch((err: unknown) =>
                  pushToast({ severity: "danger", title: "Could not create file", detail: String(err) }),
                );
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
      // WO15 Block 5b — the second half of "an agent is created FROM the
      // context it reads": the wizard opens with this node already named as
      // the agent's context, and the new agent plate lands one card-pitch to
      // the right (320 = 244px card + a 76px gutter) so the `imports` wire
      // it draws has somewhere to go. The wizard (U3) owns what it does with
      // the prefill; this row only states the intent.
      //
      // Fix round (tester #2): the wizard's last act is `addEdge({ source:
      // <the new agent>, target: node.id, kind: "imports" })`
      // (`NewAgentDialog.tsx:437-441`), and `addEdge` returns null — silently,
      // nothing is surfaced — when `edgeRules` denies that edge. On a Command
      // or Skill node this row therefore promised a Context row that no wire
      // could ever back. The question is put to the SAME resolver the store
      // enforces (`legalityFor`, with `agent` — the role `adoptFile` gives
      // every `.claude/agents/*.md` node — as the source), never a hard-coded
      // list of roles, so the row's enabled state moves with §7.3's table on
      // its own.
      {
        kind: "item",
        id: "new-agent-from-node",
        label: "New agent from this node…",
        icon: Bot,
        disabled: agentCannotImport,
        hint: agentCannotImport ? `Agents can't import ${nodeType.label} nodes` : undefined,
        onSelect: () =>
          useUiStore.getState().openAgentWizard({
            position: { x: node.position.x + 320, y: node.position.y },
            contextNodeId: node.id,
          }),
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
        label: node.rootLoad === "always" ? "Unpin" : "Pin",
        icon: node.rootLoad === "always" ? PinOff : Pin,
        onSelect: () =>
          updateNode(node.id, { rootLoad: node.rootLoad === "always" ? undefined : "always" }),
      },
      {
        kind: "item",
        id: "assemble",
        label: "Assemble",
        icon: Sparkles,
        disabled: assembling,
        hint: assembling ? "already running" : undefined,
        onSelect: () => runAssemble("assemble", (graphJson) => assembleNode(root, graphJson, node.id)),
      },
      {
        kind: "item",
        id: "summarize",
        label: "Summarize",
        disabled: assembling,
        hint: assembling ? "already running" : undefined,
        onSelect: () => runAssemble("summarize", (graphJson) => summarizeNode(root, graphJson, node.id)),
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
  //
  // WO10 item 6: memory plates only. Read order is the sequence the CONTEXT
  // is assembled in; an agent is the thing doing the reading, not a step in
  // it, so a number stamped on an agent plate was answering a question
  // nobody asked. The field itself stays on the node (sequence edges still
  // read it, and the Inspector still edits it on memory nodes) — this hides
  // the badge, it does not drop the data.
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
      {/* N-F: the canvas half of the migration-review marker (WO13_CONTRACT.md
          §5.2/§3.6a) — `needsReview` is a NODE field only, set once by a
          migration pass that actually rewrote a value (or by an explicit
          user deprecation) and never re-fired on an unchanged value, so this
          is a real "look at this" flag, not decoration. The banner/filter
          half is U4's (App.tsx / Inspector). */}
      {node.needsReview === true && (
        <span
          className="flex-none text-warning-text"
          title="Needs review — a migration changed this automatically; confirm it's still right"
        >
          <AlertTriangle size={11} strokeWidth={1.5} />
        </span>
      )}
      {node.rootLoad === "always" && (
        <Pin size={11} strokeWidth={1.5} className="flex-none text-amber-text" />
      )}
    </>
  );

  // Title · assemble progress · rtl path — identical on both plates.
  const titleBlock = (
    <>
      <div className="truncate text-base font-semibold text-content">{node.title}</div>
      {assembling && (
        <div className="flex items-center gap-1.5" title={`Assembling — ${assemblePhase ?? "queued"}`}>
          <div className="flex flex-none gap-[2px]">
            {PHASE_STEPS.map((step, i) => (
              <span
                key={step}
                className={`h-[4px] w-[16px] ${i === phaseIndex ? "animate-hard-blink" : ""}`}
                style={{
                  background: i <= phaseIndex ? "var(--accent)" : "var(--plate-inset)",
                }}
              />
            ))}
          </div>
          <span className="flex-1 truncate font-mono text-micro text-content-muted">
            {assembleStartedAt !== undefined
              ? formatElapsed(Date.now() - assembleStartedAt)
              : "queued"}
          </span>
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
      {/* D-19: one source of truth for the priority default — a sidecar
          entry with no `priority` key reads the same `1` the store and the
          agent editor use, not a second hard-coded `3` that disagreed with
          both. */}
      {agentBacked && <span className={TAG}>{`P${agentMeta?.priority ?? DEFAULT_PRIORITY}`}</span>}
      <span className={TAG} title="file size / 4 — estimate">
        {file !== undefined ? `${formatTokenCount(tokensForBytes(file.sizeBytes))} tok file` : "0 tok file"}
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
    <div
      onContextMenu={openMenu}
      className="ct-node group relative w-node"
      style={denyReason !== null ? { ...lensStyle, opacity: 0.4 } : lensStyle}
      title={denyReason ?? undefined}
    >
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
      {/* §7.3 E4 — dims first (opacity above) and adds a dashed danger
          outline on top; drawn before the selection marquee so a card can
          still show BOTH (selected while a different drag hovers it). */}
      {denyReason !== null && (
        <div
          className="pointer-events-none absolute -inset-[5px] border-2 border-dashed border-danger"
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
            {/* No orderTag here — WO10 item 6. */}
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
                {agentModelShort}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-2 pl-1.5 pr-2.5 pt-[9px]">
              <div className="flex items-center gap-1.5 pr-1">
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
              {/* Nickname sits directly under the title, in quotes, so it
                  reads as what you CALL this agent rather than as another
                  identifier. Absent when unset — an empty pair of quotes
                  would be worse than nothing. */}
              {agentNickname !== "" && (
                <div
                  className="-mt-0.5 truncate text-xs italic text-content-secondary"
                  title={`Nickname: ${agentNickname}`}
                >
                  {`“${agentNickname}”`}
                </div>
              )}
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
              {/* WO15 Block 1 — the plate shows the node type's LABEL, not
                  the stored role id, and the tooltip carries the one-line
                  hint. Same source of truth as the wizard grid and the
                  Inspector's Node type field (`config/nodeTypes.ts`), so the
                  three surfaces can't drift. CSS uppercase, as before. */}
              <span
                className="truncate font-pixel text-[8px] uppercase leading-none"
                style={{ color: role }}
                title={`Node type: ${nodeType.label} — ${nodeType.hint}`}
              >
                {nodeType.label}
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
          visible — a port you cannot see is a port you cannot aim at. Still
          no handle ids: which finger a given wire lands on is decided by
          canvas/portSlots.ts and applied by canvas/edgePath.ts, not by the
          handle itself.

          WO10 item 3 — the fingers are DOM children now, one per connection
          (floor 1, capped at MAX_PINS), instead of a fixed five painted by a
          repeating-linear-gradient. A port therefore SAYS how loaded it is
          before you trace a single wire, and the block's height follows from
          `portHeight` — 44px at five pins, exactly the frozen WO09 G1. */}
      <Handle
        type="target"
        position={Position.Left}
        className="ct-port ct-port-in"
        style={{ height: portHeight(inPins) }}
      >
        {Array.from({ length: inPins }, (_, i) => (
          <span key={i} className="ct-pin" />
        ))}
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        className="ct-port ct-port-out"
        style={{ height: portHeight(outPins) }}
      >
        {Array.from({ length: outPins }, (_, i) => (
          <span key={i} className="ct-pin" />
        ))}
      </Handle>

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
