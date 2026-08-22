// Empty-canvas guide (WO15 §6 U4b.2, Stage 4). A brand-new project opens on
// an empty grid with a "New node" button in the corner and nothing that says
// what the canvas is FOR — this card answers that in one line and gives the
// first step a target you cannot miss.
//
// Two rules it must not break:
//  1. It is an overlay, not a modal. The container is `pointer-events-none`
//     and only the card itself takes the pointer back, so right-click
//     (pane menu) and double-click (node wizard) still reach the React Flow
//     pane everywhere outside the card. GraphCanvas's own handlers test for
//     `.react-flow__pane` on the event target, so a click that lands on this
//     card is inert rather than mis-firing the wizard at a random point.
//  2. It unmounts the moment the graph has a node — GraphCanvas owns that
//     condition; this component never guesses at it.

import { Plus } from "lucide-react";

export function EmptyCanvasGuide({ onCreateNode }: { onCreateNode: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-canvas-ui grid place-items-center p-6">
      {/* Plate chrome, not modal chrome: this lives ON the canvas, so it
          wears the canvas's hard 2px edge and offset shadow rather than the
          rounded surface-1 a dialog would use. */}
      <div className="pointer-events-auto flex w-[400px] max-w-full flex-col items-center gap-3 border-2 border-plate-edge bg-plate px-5 py-4 shadow-plate">
        <p className="text-center text-sm leading-relaxed text-content-secondary">
          1 Create node → 2 Connect context → 3 Preview compiled output
        </p>
        <div className="flex items-center gap-2">
          {/* Blue is you: the one thing the user is here to do. */}
          <button
            type="button"
            onClick={onCreateNode}
            className="flex h-control flex-none items-center gap-1.5 rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
          >
            <Plus size={14} strokeWidth={1.5} />
            Create first node
          </button>
          {/* Disabled, with the reason on both the button and a wrapper —
              a disabled control swallows pointer events in some engines, so
              the span is what guarantees the tooltip is reachable. */}
          <span title="Add a node first" className="flex-none">
            <button
              type="button"
              disabled
              title="Add a node first"
              className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content-disabled"
            >
              Preview compile
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
