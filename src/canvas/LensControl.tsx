// Canvas lens picker — segmented control (None | Activity | Weight | Live)
// living in GraphCanvas's top-left Panel. Owns the ONLY ticker that drives
// the Activity lens's live decay (WO01_BLOCK_A_CONTRACT.md §6.2/§6.3).

import { useEffect } from "react";
import { LENS_MODES, useSettingsStore, type LensMode } from "../store/settings";
import { useLensTickStore } from "./lens";

const LENS_LABELS: Record<LensMode, string> = {
  none: "None",
  activity: "Activity",
  weight: "Weight",
  live: "Live",
};

const LENS_TITLES: Record<LensMode, string> = {
  none: "No lens — plain view",
  activity: "Activity lens — brighter nodes were touched more recently",
  weight: "Weight lens — brighter nodes carry more estimated tokens",
  live: "Live lens — highlights nodes the agent touched in the last minute",
};

const TICK_MS = 30_000;

export function LensControl() {
  const lens = useSettingsStore((s) => s.lens);
  const setLens = useSettingsStore((s) => s.setLens);
  const bump = useLensTickStore((s) => s.bump);

  // The only interval in the lens system; runs exclusively while Activity is
  // active, cleared on unmount or lens change (§6.2 ticker rule).
  useEffect(() => {
    if (lens !== "activity") return;
    const id = setInterval(bump, TICK_MS);
    return () => clearInterval(id);
  }, [lens, bump]);

  return (
    <div className="flex items-center gap-2">
      {/* WO15 §6 U4b.3 — the segments alone ("None · Activity · Weight ·
          Live") never said what they applied to. Non-interactive label, and
          `aria-hidden` because the radiogroup below already carries the same
          meaning in its own `aria-label`: a screen reader that heard both
          would hear "Overlay" twice, once as a stray text node. */}
      <span className="font-pixel text-[8px] uppercase text-content-muted" aria-hidden>
        Overlay:
      </span>
      <div
        role="radiogroup"
        aria-label="Canvas lens"
        className="flex h-control items-center overflow-hidden border-2 border-plate-edge bg-plate shadow-plate-sm"
      >
        {LENS_MODES.map((mode, i) => {
          const active = lens === mode;
          return (
            <div key={mode} className="flex h-full items-center">
              {i > 0 && <div className="h-full w-[2px] flex-none bg-plate-edge" aria-hidden />}
              {/* Active segment is a filled amber block with knocked-out
                  dark text — the same inversion the plate uses, so "on"
                  reads at a glance instead of as a tint. */}
              <button
                type="button"
                role="radio"
                aria-checked={active}
                title={LENS_TITLES[mode]}
                onClick={() => setLens(mode)}
                className={`flex h-full items-center px-2.5 font-pixel text-[8px] uppercase transition-colors duration-fast ${
                  active
                    ? "bg-amber text-[color:var(--barn-canvas)]"
                    : "text-content-muted hover:bg-plate-hi hover:text-content"
                }`}
              >
                {LENS_LABELS[mode]}
              </button>
            </div>
          );
        })}
      </div>
      {lens === "activity" && (
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="font-pixel text-[8px] uppercase text-content-muted">earlier</span>
          {/* Stepped ramp, not a gradient: five discrete swatches match the
              five brightness buckets the Activity lens actually applies. */}
          <div className="flex h-[8px] w-[100px] border-2 border-plate-edge">
            {[0.18, 0.38, 0.58, 0.78, 1].map((a) => (
              <div key={a} className="h-full flex-1" style={{ background: `rgba(232,163,61,${a})` }} />
            ))}
          </div>
          <span className="font-pixel text-[8px] uppercase text-content-muted">latest</span>
        </div>
      )}
    </div>
  );
}
