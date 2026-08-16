// Memory node card — anatomy per DESIGN_SPEC.md (244 × 97, role stripe,
// glyph + label, pin, read-order badge, title, rtl path, footer badges).
// The whole card is the hit target; handles sit 4px outside.

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pin } from "lucide-react";
import { useProjectStore } from "../store/project";
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
  const role = roleVar(node.role);

  return (
    <div
      className={`ct-node group relative w-node rounded border bg-surface-2 transition-colors duration-fast ${
        selected ? "border-transparent" : "border-border hover:border-border-strong"
      }`}
      style={{
        minHeight: 97,
        boxShadow: selected
          ? "0 0 0 2px var(--accent), 0 4px 14px rgba(0,0,0,.45)"
          : "var(--elev-1)",
      }}
    >
      {/* 1 — role stripe: the only place role colour appears as a fill */}
      <div
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l"
        style={{ background: role }}
      />

      <div className="flex flex-col gap-1 py-2 pl-3 pr-2">
        {/* 2/3/4 — glyph + role label · pin · read-order badge */}
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
          {node.pinned && (
            <Pin size={11} strokeWidth={1.5} className="flex-none text-amber-text" />
          )}
          <span className="grid h-4 w-4 flex-none place-items-center rounded-sm bg-surface-3 font-mono text-micro text-content-secondary">
            {node.readOrder}
          </span>
        </div>

        {/* 5 — title: single line, never wraps */}
        <div className="truncate text-base font-semibold text-content">{node.title}</div>

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
          {file === undefined && (
            <span className="rounded-sm bg-danger-surface px-1 py-px font-mono text-micro text-danger-text">
              missing file
            </span>
          )}
        </div>
      </div>

      {/* 8 — handles: 7px sharp squares, offset −4px */}
      <Handle type="target" position={Position.Left} className="ct-handle" />
      <Handle type="source" position={Position.Right} className="ct-handle" />
    </div>
  );
}

export const MemoryNodeCard = memo(MemoryNodeCardInner);
