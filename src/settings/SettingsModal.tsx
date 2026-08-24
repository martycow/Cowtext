// Settings modal — Lane B (contract §6). Sober tool UI, no charm in chrome.
// Every control reads/writes useSettingsStore; persistence is debounced inside
// the store (no Save button). Hooks port and context path are display-only —
// they are not persisted settings (contract §4).

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_SESSION_TOKEN_CEILING,
  UI_SCALES,
  useSettingsStore,
  type CodeFont,
  type UiFont,
  type UiScale,
} from "../store/settings";
import { useHooksAddr, useProjectStore } from "../store/project";
import { PROVIDER_SUPPORT_SENTENCE } from "../resources";
import { formatTokenCount } from "../store/tokens";
import { HelperLine, Row, SectionLabel, Segmented, Select, Toggle } from "./controls";
import { PresetSettings } from "./PresetSettings";
import { StackSettings } from "./StackSettings";

const UI_SCALE_OPTIONS: readonly { value: UiScale; label: string }[] = UI_SCALES.map((s) => ({
  value: s,
  label: `${s}%`,
}));

const UI_FONT_OPTIONS: readonly { value: UiFont; label: string }[] = [
  { value: "system", label: "System" },
  { value: "plex", label: "IBM Plex Sans" },
];

const CODE_FONT_OPTIONS: readonly { value: CodeFont; label: string }[] = [
  { value: "jetbrains", label: "JetBrains Mono" },
  { value: "system-mono", label: "System monospace" },
];

// ── Panes (WO16 Block C) ──────────────────────────────────────────────
//
// Settings was one scrolling column of five sections through WO15. Six was
// the point where it stopped working: the two longest sections (Agent, and
// now Tech stack) each fill more than a screen, so anything below them was
// only reachable by scrolling past settings the user was not looking for.
// A rail costs one click and makes the whole surface legible at a glance —
// which is also the honest answer to "how many settings are there?".
//
// Order is by how often a setting is touched, not alphabetically: sound and
// appearance are set once and forgotten, so they sit at the top where the
// eye lands, and the two tables that get maintained sit together below the
// things that configure them.

type PaneId = "sound" | "appearance" | "agent" | "presets" | "stack" | "view" | "context";

const PANES: readonly { id: PaneId; label: string }[] = [
  { id: "sound", label: "Sound" },
  { id: "appearance", label: "Appearance" },
  { id: "agent", label: "Agent" },
  { id: "presets", label: "Agent presets" },
  { id: "stack", label: "Tech stack" },
  { id: "view", label: "View" },
  { id: "context", label: "Context" },
];

// ── Modal ─────────────────────────────────────────────────────────────

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Not persisted: which pane you were last on is a fact about the last
  // thing you did, not a preference, and reopening Settings on "Tech stack"
  // because you once added an item there would be a small daily surprise.
  const [pane, setPane] = useState<PaneId>("sound");

  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const barnSounds = useSettingsStore((s) => s.barnSounds);
  const toolSounds = useSettingsStore((s) => s.toolSounds);
  const muted = useSettingsStore((s) => s.muted);
  const calmMode = useSettingsStore((s) => s.calmMode);
  const prefersReducedMotion = useSettingsStore((s) => s.prefersReducedMotion);
  const claudeBinaryPath = useSettingsStore((s) => s.claudeBinaryPath);
  const syncFileName = useSettingsStore((s) => s.syncFileName);
  const managerMode = useSettingsStore((s) => s.managerMode);
  const showFps = useSettingsStore((s) => s.showFps);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const uiFont = useSettingsStore((s) => s.uiFont);
  const codeFont = useSettingsStore((s) => s.codeFont);
  const sessionTokenCeiling = useSettingsStore((s) => s.sessionTokenCeiling);
  const persistError = useSettingsStore((s) => s.persistError);
  const setMasterVolume = useSettingsStore((s) => s.setMasterVolume);
  const setBarnSounds = useSettingsStore((s) => s.setBarnSounds);
  const setToolSounds = useSettingsStore((s) => s.setToolSounds);
  const setMuted = useSettingsStore((s) => s.setMuted);
  const setCalmMode = useSettingsStore((s) => s.setCalmMode);
  const setClaudeBinaryPath = useSettingsStore((s) => s.setClaudeBinaryPath);
  const setSyncFileName = useSettingsStore((s) => s.setSyncFileName);
  const setManagerMode = useSettingsStore((s) => s.setManagerMode);
  const setShowFps = useSettingsStore((s) => s.setShowFps);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const setUiFont = useSettingsStore((s) => s.setUiFont);
  const setCodeFont = useSettingsStore((s) => s.setCodeFont);
  const setSessionTokenCeiling = useSettingsStore((s) => s.setSessionTokenCeiling);

  const root = useProjectStore((s) => s.root);
  // D-2 — the hooks port has exactly one home (`hooks_server.rs`), read at
  // runtime through `hooks_addr`. This row used to hard-code 127.0.0.1:4923,
  // which is how a settings screen ends up lying about a port someone moved.
  const hooksAddr = useHooksAddr();

  // Draft for the claude path — committed per keystroke (the store debounce
  // absorbs the churn). Esc/scrim/Done unmount without firing blur, so a
  // blur-only commit would silently drop the draft (contract deviation
  // 2026-08-17). The draft state keeps in-progress whitespace visible.
  const [pathDraft, setPathDraft] = useState(claudeBinaryPath);

  // Ceiling draft — same "commit per keystroke, draft absorbs churn" idiom
  // as pathDraft above. `lastBoundedCeiling` remembers the last positive
  // value typed so flipping "Unbounded" off restores it instead of
  // resetting to the app default every time (0 itself is never a valid
  // draft — it is the Unbounded toggle's job, not a typed value).
  const [lastBoundedCeiling, setLastBoundedCeiling] = useState(
    sessionTokenCeiling > 0 ? sessionTokenCeiling : DEFAULT_SESSION_TOKEN_CEILING,
  );
  const [ceilingDraft, setCeilingDraft] = useState(String(lastBoundedCeiling));
  const unboundedDefault = sessionTokenCeiling <= 0;

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
        className="flex h-[80vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
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

        {/* Body — nav rail + exactly one pane */}
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="flex w-[168px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-border-subtle p-2"
          >
            {PANES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPane(p.id)}
                aria-current={pane === p.id ? "page" : undefined}
                className={`flex h-control flex-none items-center rounded px-2 text-left text-sm transition-colors duration-fast ${
                  pane === p.id
                    ? "bg-accent-surface text-accent-text"
                    : "text-content-secondary hover:bg-[var(--surface-hover)] hover:text-content"
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {persistError !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              Settings could not be saved: {persistError}
            </div>
          )}
          {pane === "sound" && (
          <section className="px-4 py-3">
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

          </section>
          )}

          {/* Appearance (WO15 Block 7) — how big and in what typeface, plus
              the two "how loud is the app visually" toggles that were filed
              under Sound and View because there was nowhere better. Calm
              mode still implies mute; it lives here because motion, not
              volume, is what a user is looking for when they go hunting for
              it. */}
          {pane === "appearance" && (
          <section className="px-4 py-3">
            <SectionLabel>Appearance</SectionLabel>

            <Row label="UI scale">
              <Segmented
                value={uiScale}
                options={UI_SCALE_OPTIONS}
                onChange={setUiScale}
                label="UI scale"
              />
            </Row>
            <HelperLine>
              Scales the chrome — rail, Inspector, dock, menus and dialogs. The graph canvas and
              the barn keep their own zoom: both are pixel art, and half-pixel scaling shimmers.
            </HelperLine>

            <Row label="UI font">
              <Select value={uiFont} options={UI_FONT_OPTIONS} onChange={setUiFont} label="UI font" />
            </Row>

            <Row label="Code font">
              <Select
                value={codeFont}
                options={CODE_FONT_OPTIONS}
                onChange={setCodeFont}
                label="Code font"
              />
            </Row>
            <HelperLine>
              Code font is used for anything the filesystem or the model produced — paths, diffs,
              versions, the event feed.
            </HelperLine>

            <Row label="Calm mode">
              <Toggle checked={calmMode} onChange={setCalmMode} label="Calm mode" />
            </Row>
            <HelperLine>No sound and reduced motion. The barn keeps working, quietly.</HelperLine>
            {prefersReducedMotion && !calmMode && (
              <HelperLine>
                Your OS requests reduced motion — animations are already reduced.
              </HelperLine>
            )}

            <Row label="FPS counter">
              <Toggle checked={showFps} onChange={setShowFps} label="FPS counter" />
            </Row>
            <HelperLine>
              Shows the Barn&rsquo;s frame rate in the scene overlay. The Barn deliberately drops
              to 12 fps while idle, so a low number there is not a bug.
            </HelperLine>
          </section>
          )}

          {pane === "agent" && (
          <section className="px-4 py-3">
            <SectionLabel>Agent</SectionLabel>

            {/* Stage 1 — the scope sentence, verbatim, above the controls it
                qualifies: everything in this section is Claude Code. */}
            <p className="mb-2 text-pretty text-sm leading-relaxed text-content-secondary">
              {PROVIDER_SUPPORT_SENTENCE}
            </p>

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

            <Row label="Default token ceiling">
              <span className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={ceilingDraft}
                  disabled={unboundedDefault}
                  aria-label="Default token ceiling"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, "");
                    setCeilingDraft(digits);
                    if (digits !== "") {
                      const n = Math.max(1, Number(digits));
                      setLastBoundedCeiling(n);
                      setSessionTokenCeiling(n);
                    }
                  }}
                  onBlur={() => {
                    // Never persist "" or 0 through this field — 0 is the
                    // Unbounded toggle's job, not something you can type in.
                    if (ceilingDraft === "" || Number(ceilingDraft) <= 0) {
                      setCeilingDraft(String(lastBoundedCeiling));
                      setSessionTokenCeiling(lastBoundedCeiling);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="h-control w-[90px] rounded border border-border bg-surface-2 px-2 text-right font-mono text-xs text-content transition-colors duration-fast focus:border-accent disabled:text-content-disabled disabled:opacity-60"
                />
                <span className="w-[76px] font-mono text-2xs text-content-muted">
                  {unboundedDefault
                    ? "unbounded"
                    : `≈${formatTokenCount(Math.max(0, Number(ceilingDraft) || lastBoundedCeiling))} tok`}
                </span>
                <Toggle
                  checked={unboundedDefault}
                  onChange={(b) => {
                    if (b) {
                      setSessionTokenCeiling(0);
                    } else {
                      setCeilingDraft(String(lastBoundedCeiling));
                      setSessionTokenCeiling(lastBoundedCeiling);
                    }
                  }}
                  label="Unbounded default"
                  title="No global cap — sessions run unbounded unless a task sets its own ceiling"
                />
              </span>
            </Row>
            <HelperLine>
              New agent sessions stop automatically once they spend this many tokens, unless the
              task they were launched for sets its own ceiling. Sessions already running are
              unaffected.
            </HelperLine>

            <Row label="Hooks server">
              <span className="font-mono text-xs text-content-secondary">{hooksAddr}</span>
            </Row>
          </section>
          )}

          {pane === "presets" && <PresetSettings />}

          {pane === "stack" && <StackSettings />}

          {pane === "view" && (
          <section className="px-4 py-3">
            <SectionLabel>View</SectionLabel>

            <Row label="Manager mode">
              <Toggle checked={managerMode} onChange={setManagerMode} label="Manager mode" />
            </Row>
            <HelperLine>
              Hides the Barn view and never loads the Pixi scene — a pure context-graph and
              agents UI.
            </HelperLine>
          </section>
          )}

          {pane === "context" && (
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
          )}
          </div>
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
