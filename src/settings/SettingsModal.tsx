// Settings modal — Lane B (contract §6). Sober tool UI, no charm in chrome.
// Every control reads/writes useSettingsStore; persistence is debounced inside
// the store (no Save button). Hooks port and context path are display-only —
// they are not persisted settings (contract §4).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useSettingsStore } from "../store/settings";
import { useProjectStore } from "../store/project";

// hooks_server.rs bind address — a constant of the app, shown for reference.
const HOOKS_ADDR = "127.0.0.1:4923";

// ── Local controls (idioms copied, not imported across lanes) ─────────

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-2xs uppercase tracking-wide text-content-muted">{children}</div>
  );
}

/** 34×19 pill toggle (Inspector idiom, local copy). Settings are
 *  user-initiated ⇒ accent, not amber ("Blue is you"). */
function Toggle({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={`relative h-[19px] w-[34px] flex-none rounded-pill border transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-accent-border bg-accent-surface" : "border-border-strong bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[13px] w-[13px] rounded-pill transition-all duration-fast ${
          checked ? "left-[16px] bg-accent" : "left-[2px] bg-content-muted"
        }`}
      />
    </button>
  );
}

/** 28px row: label left, control right. */
function Row({
  label,
  dimmed,
  children,
}: {
  label: ReactNode;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-row items-center justify-between gap-3">
      <span className={`text-sm ${dimmed ? "text-content-disabled" : "text-content"}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

function HelperLine({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-2xs leading-relaxed text-content-muted">{children}</p>;
}

// ── Modal ─────────────────────────────────────────────────────────────

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const barnSounds = useSettingsStore((s) => s.barnSounds);
  const toolSounds = useSettingsStore((s) => s.toolSounds);
  const muted = useSettingsStore((s) => s.muted);
  const calmMode = useSettingsStore((s) => s.calmMode);
  const prefersReducedMotion = useSettingsStore((s) => s.prefersReducedMotion);
  const claudeBinaryPath = useSettingsStore((s) => s.claudeBinaryPath);
  const syncFileName = useSettingsStore((s) => s.syncFileName);
  const persistError = useSettingsStore((s) => s.persistError);
  const setMasterVolume = useSettingsStore((s) => s.setMasterVolume);
  const setBarnSounds = useSettingsStore((s) => s.setBarnSounds);
  const setToolSounds = useSettingsStore((s) => s.setToolSounds);
  const setMuted = useSettingsStore((s) => s.setMuted);
  const setCalmMode = useSettingsStore((s) => s.setCalmMode);
  const setClaudeBinaryPath = useSettingsStore((s) => s.setClaudeBinaryPath);
  const setSyncFileName = useSettingsStore((s) => s.setSyncFileName);

  const root = useProjectStore((s) => s.root);

  // Draft for the claude path — committed per keystroke (the store debounce
  // absorbs the churn). Esc/scrim/Done unmount without firing blur, so a
  // blur-only commit would silently drop the draft (contract deviation
  // 2026-08-17). The draft state keeps in-progress whitespace visible.
  const [pathDraft, setPathDraft] = useState(claudeBinaryPath);

  const soundOff = muted || calmMode;
  const graphPath = root !== null ? `${root}\\.cowtext\\graph.json` : null;

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
        aria-label="Settings"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Settings</span>
          <div className="min-w-0 flex-1" />
          <button
            onClick={onClose}
            title="Close"
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {persistError !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              Settings could not be saved: {persistError}
            </div>
          )}
          {/* Sound */}
          <section className="border-b border-border-subtle px-4 py-3">
            <SectionLabel>Sound</SectionLabel>

            <Row label="Master volume" dimmed={soundOff}>
              <span className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(masterVolume * 100)}
                  disabled={soundOff}
                  aria-label="Master volume"
                  onChange={(e) => setMasterVolume(Number(e.target.value) / 100)}
                  className="h-[16px] w-[180px] cursor-pointer appearance-none bg-transparent disabled:cursor-default disabled:opacity-40 [&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-surface-inset [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-[12px] [&::-webkit-slider-thumb]:w-[12px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-accent"
                />
                <span
                  className={`w-[36px] text-right font-mono text-xs ${
                    soundOff ? "text-content-disabled" : "text-content-secondary"
                  }`}
                >
                  {Math.round(masterVolume * 100)}%
                </span>
              </span>
            </Row>

            <Row label="Barn sounds">
              <Toggle checked={barnSounds} onChange={setBarnSounds} label="Barn sounds" />
            </Row>

            <Row label="Tool sounds">
              <Toggle checked={toolSounds} onChange={setToolSounds} label="Tool sounds" />
            </Row>
            <HelperLine>Compile, assemble and problem chimes.</HelperLine>

            <Row label="Mute">
              <Toggle
                checked={muted || calmMode}
                onChange={setMuted}
                label="Mute"
                disabled={calmMode}
                title={calmMode ? "Calm mode implies mute" : undefined}
              />
            </Row>

            <Row label="Calm mode">
              <Toggle checked={calmMode} onChange={setCalmMode} label="Calm mode" />
            </Row>
            <HelperLine>No sound and reduced motion. The barn keeps working, quietly.</HelperLine>
            {prefersReducedMotion && !calmMode && (
              <HelperLine>
                Your OS requests reduced motion — animations are already reduced.
              </HelperLine>
            )}
          </section>

          {/* Agent */}
          <section className="border-b border-border-subtle px-4 py-3">
            <SectionLabel>Agent</SectionLabel>

            <Row
              label={
                <>
                  <span className="font-mono">claude</span> binary
                </>
              }
            >
              <input
                type="text"
                value={pathDraft}
                placeholder="auto-detect (where claude)"
                aria-label="claude binary path"
                spellCheck={false}
                onChange={(e) => {
                  setPathDraft(e.target.value);
                  setClaudeBinaryPath(e.target.value.trim());
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="h-control w-[280px] rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content transition-colors duration-fast placeholder:text-content-muted focus:border-accent"
              />
            </Row>
            <HelperLine>Used by Assemble and Handoff. Leave empty to auto-detect.</HelperLine>

            <Row label="Hooks server">
              <span className="font-mono text-xs text-content-secondary">{HOOKS_ADDR}</span>
            </Row>
          </section>

          {/* Context */}
          <section className="px-4 py-3">
            <SectionLabel>Context</SectionLabel>

            <Row label="Rename file with title">
              <Toggle
                checked={syncFileName}
                onChange={setSyncFileName}
                label="Rename file with title"
              />
            </Row>
            <HelperLine>
              Editing a node&rsquo;s title also renames its .md file to match. Off leaves the
              file path untouched — you can still rename it by hand.
            </HelperLine>

            <Row label="Context data">
              {graphPath !== null ? (
                <span
                  dir="rtl"
                  title={graphPath}
                  className="min-w-0 max-w-[300px] truncate font-mono text-xs text-content-secondary"
                >
                  {graphPath}
                </span>
              ) : (
                <span className="text-xs text-content-muted">No project open</span>
              )}
            </Row>
          </section>
        </div>

        {/* Footer — 50px; nothing to confirm, so no primary button */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            Settings apply immediately and persist on this machine.
          </span>
          <button
            onClick={onClose}
            className="flex h-control flex-none items-center rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
