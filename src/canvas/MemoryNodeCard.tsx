// Memory node card — anatomy per DESIGN_SPEC.md (244 × 97, role stripe,
// glyph + label, pin, read-order badge, title, rtl path, footer badges).
// The whole card is the hit target; handles sit 4px outside.
// Phase 3/4 states: live-read pulse (amber ring + stripe while the agent
// touches the file), assembling bar, assembled success flash, error stripe.

import { memo, useEffect, useReducer, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin } from "lucide-react";
import { useProjectStore } from "../store/project";
import { useGraphStore } from "../store/graph";
import { lastLiveTs, useEventsStore, LIVE_PULSE_MS } from "../store/events";
import { RoleGlyph, roleVar } from "./RoleGlyphs";
import type { CanvasNode } from "./types";

function formatTokens(bytes: number): string {
  const tokens = Math.max(1, Math.round(bytes / 4));
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(1)}k tok`;
}

function MemoryNodeCardInner({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.memory;
  const file = useProjectStore((s) => s.files.find((f) => f.relPath === node.filePath));
  const assembleStatus = useGraphStore((s) => s.assembleStatus[node.id] ?? "idle");
  const role = roleVar(node.role);

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

  const ring = selected
    ? "0 0 0 2px var(--accent), 0 4px 14px rgba(0,0,0,.45)"
    : flash
      ? "0 0 0 2px var(--success), var(--elev-1)"
      : "var(--elev-1)";
  const boxShadow = live ? `${ring}, var(--glow-live)` : ring;

  return (
    <div
      className={`ct-node group relative w-node rounded border bg-surface-2 transition-colors duration-fast ${
        selected ? "border-transparent" : "border-border hover:border-border-strong"
      }`}
      style={{ minHeight: 97, boxShadow }}
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

      <div className="flex flex-col gap-1 py-2 pl-3 pr-2">
        {/* 2/3/4 — glyph + role label · live square · pin · read-order badge */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: role }}>
            <RoleGlyph role={node.role} />
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
          <span className="grid h-4 w-4 flex-none place-items-center rounded-sm bg-surface-3 font-mono text-micro text-content-secondary">
            {node.readOrder}
          </span>
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

      {/* 8 — handles: 7px sharp squares, offset −4px */}
      <Handle type="target" position={Position.Left} className="ct-handle" />
      <Handle type="source" position={Position.Right} className="ct-handle" />
    </div>
  );
}

export const MemoryNodeCard = memo(MemoryNodeCardInner);
