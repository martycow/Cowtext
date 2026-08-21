// AI toolchain details — what the title screen's "Details" button opens.
//
// The scan says which agent CLIs are on this machine; this is where that turns
// into a decision. Each row's tick is `defaultCompileTargets` in app settings:
// the targets a BRAND-NEW project starts with. It is deliberately NOT this
// project's `compileTargets` — the title screen is reached before any project
// is open, so there is no graph.json to write to. An existing project's own
// targets always win; this only seeds a project that has none yet
// (`graph.ts::loadGraph`).

import { useEffect, useRef } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { useSettingsStore } from "../store/settings";
import type { CompileTarget } from "../store/graph";
import type { AiTool } from "./toolchain";

export function AiToolchainModal({
  tools,
  onRescan,
  onClose,
}: {
  tools: AiTool[];
  onRescan: () => void;
  onClose: () => void;
}) {
  const defaults = useSettingsStore((s) => s.defaultCompileTargets);
  const setDefaults = useSettingsStore((s) => s.setDefaultCompileTargets);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: CompileTarget) => {
    setDefaults(
      defaults.includes(id) ? defaults.filter((t) => t !== id) : [...defaults, id],
    );
  };

  const foundCount = tools.filter((t) => t.found).length;
  const targetCount = tools.filter((t) => defaults.includes(t.id)).length;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="AI toolchain"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[620px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center justify-between border-b border-border-subtle pl-4 pr-3">
          <div className="flex items-center gap-2.5">
            <span className="text-lg font-semibold">AI toolchain</span>
            <span className="font-mono text-xs text-content-muted">
              {foundCount} of {tools.length} found
            </span>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="grid h-control-sm w-control-sm place-items-center rounded text-content-secondary transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="text-pretty px-4 pb-2 pt-3.5 text-sm leading-relaxed text-content-secondary">
            Scanned PATH and the usual install locations on this machine. Tick a tool to make it a
            compile target for new projects — Compile writes that file from the graph, and leaves
            every unticked one alone.
          </p>

          <div className="flex flex-col gap-1.5 px-4 pb-4 pt-2">
            {tools.map((t) => {
              const on = defaults.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-3 rounded border px-3 py-2.5 text-left transition-colors duration-fast ${
                    on
                      ? "border-accent-border bg-accent-surface hover:border-accent"
                      : "border-border bg-surface-2 hover:border-border-strong"
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 flex-none place-items-center rounded-xs border ${
                      on ? "border-accent bg-accent" : "border-border-strong bg-surface-1"
                    }`}
                  >
                    {on && <Check size={11} strokeWidth={3} className="text-content-inverse" />}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-[7px] w-[7px] flex-none rounded-pill ${
                          t.found ? "bg-success" : "bg-content-disabled"
                        }`}
                      />
                      <span
                        className={`text-base font-medium ${
                          t.found ? "text-content" : "text-content-muted"
                        }`}
                      >
                        {t.name}
                      </span>
                      <span
                        className={`font-mono text-xs ${
                          t.found ? "text-success-text" : "text-content-muted"
                        }`}
                      >
                        {t.found ? (t.version !== null ? `v${t.version}` : "installed") : "not found"}
                      </span>
                    </span>
                    <span className="truncate font-mono text-xs text-content-muted">
                      {t.path ?? `not on PATH — \`${t.cmd}\``}
                    </span>
                  </span>

                  <span className="flex-none rounded-sm border border-border px-1.5 py-0.5 font-mono text-xs text-content-secondary">
                    {t.emits}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex h-[56px] flex-none items-center justify-between border-t border-border-subtle bg-surface-0 px-4">
          <button
            onClick={onRescan}
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-sm text-content-secondary transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 hover:text-content"
          >
            <RefreshCw size={13} strokeWidth={1.6} />
            Re-scan
          </button>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-content-muted">
              {targetCount === 1 ? "1 compile target" : `${targetCount} compile targets`}
            </span>
            <button
              onClick={onClose}
              className="h-control-lg rounded bg-accent px-4 text-base font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
