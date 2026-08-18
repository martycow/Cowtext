// Scan overlay (contract §7.8/#13). NOT a rotating spinner — the canonical
// waiting indicator is the 4-step amber pixel march. Mounted (by the caller)
// inside a `relative` ancestor over the Inspector and the file-rail list;
// it must never unmount its sibling (Inspector/CodeMirror survive a rescan).

import { useProjectStore } from "../store/project";
import { selectReducedMotion, useSettingsStore } from "../store/settings";

export function ScanOverlay({ caption = "rescanning" }: { caption?: string }) {
  const scanning = useProjectStore((s) => s.scanning);
  const reducedMotion = useSettingsStore(selectReducedMotion);

  if (!scanning) return null;

  return (
    <div
      role="status"
      aria-busy="true"
      className="absolute inset-0 z-panel flex flex-col items-center justify-center gap-2 pointer-events-auto"
      style={{ background: "var(--scrim)" }}
    >
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-2 w-2 bg-amber ${reducedMotion ? "" : "animate-blink"}`}
            style={
              reducedMotion
                ? undefined
                : { animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }
            }
          />
        ))}
        <span className="h-2 w-2 bg-border" />
      </div>
      <span className="font-pixel text-micro tracking-wide text-amber-text">{caption}</span>
    </div>
  );
}
