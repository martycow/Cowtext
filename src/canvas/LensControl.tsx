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
      <div
        role="radiogroup"
        aria-label="Canvas lens"
        className="flex h-control items-center overflow-hidden rounded border border-border bg-surface-2 shadow-card"
      >
        {LENS_MODES.map((mode, i) => {
          const active = lens === mode;
          return (
            <div key={mode} className="flex h-full items-center">
              {i > 0 && <div className="h-full w-px flex-none bg-border" aria-hidden />}
              <button
                type="button"
                role="radio"
                aria-checked={active}
                title={LENS_TITLES[mode]}
                onClick={() => setLens(mode)}
                className={`flex h-full items-center border px-2.5 font-mono text-micro uppercase transition-colors duration-fast ${
                  active
                    ? "border-accent-border bg-accent-surface text-accent-text"
                    : "border-transparent text-content-muted hover:bg-surface-3"
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
          <span className="text-micro text-content-muted">earlier</span>
          <div
            className="h-[6px] w-[96px] rounded-pill"
            style={{ background: "linear-gradient(90deg, var(--surface-3), var(--amber))" }}
          />
          <span className="text-micro text-content-muted">latest</span>
        </div>
      )}
    </div>
  );
}
