// `mergeSettings` is the only thing standing between a hand-edited (or
// older, or newer) settings.json and the running app: every field it fails
// to defend becomes a UI state no control can leave. WO15 §4.1 adds six
// fields, so this file pins the whole merge contract — defaults for an old
// file, and accept/reject per field.
//
// `load()` is never called here: it touches `window.matchMedia`, and this
// test layer is `environment: node` on purpose (pure modules only).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  NODE_TYPE_HELP_OPEN_LAUNCHES,
  UI_SCALES,
  mergeSettings,
  selectNodeTypeHelpOpen,
  settingsAfterLoad,
  useSettingsStore,
  type SettingsState,
} from "./settings";

/** A `SettingsState` for the pure selectors, without running `load()`. */
function stateWith(patch: Partial<SettingsState>): SettingsState {
  return { ...useSettingsStore.getState(), ...patch };
}

describe("mergeSettings — an old settings.json", () => {
  it("defaults every WO15 field when the file predates them", () => {
    const merged = mergeSettings({ version: 1, masterVolume: 0.4 });
    expect(merged.masterVolume).toBe(0.4);
    expect(merged.uiScale).toBe(100);
    expect(merged.uiFont).toBe("plex");
    expect(merged.codeFont).toBe("jetbrains");
    expect(merged.launchCount).toBe(0);
    expect(merged.nodeTypeHelpCollapsed).toBeNull();
    expect(merged.lastRunAgentFile).toBe("");
  });

  it("returns the defaults wholesale for a non-object", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });
});

describe("mergeSettings — uiScale", () => {
  it("accepts every value the segmented control offers", () => {
    for (const scale of UI_SCALES) {
      expect(mergeSettings({ uiScale: scale }).uiScale).toBe(scale);
    }
  });

  it("rejects an off-ladder number, a string and a null", () => {
    expect(mergeSettings({ uiScale: 120 }).uiScale).toBe(100);
    expect(mergeSettings({ uiScale: "115" }).uiScale).toBe(100);
    expect(mergeSettings({ uiScale: null }).uiScale).toBe(100);
  });
});

describe("mergeSettings — fonts", () => {
  it("accepts the known enum members", () => {
    expect(mergeSettings({ uiFont: "system" }).uiFont).toBe("system");
    expect(mergeSettings({ uiFont: "plex" }).uiFont).toBe("plex");
    expect(mergeSettings({ codeFont: "system-mono" }).codeFont).toBe("system-mono");
    expect(mergeSettings({ codeFont: "jetbrains" }).codeFont).toBe("jetbrains");
  });

  it("rejects an unknown family rather than passing it to CSS", () => {
    expect(mergeSettings({ uiFont: "comic-sans" }).uiFont).toBe("plex");
    expect(mergeSettings({ codeFont: "courier" }).codeFont).toBe("jetbrains");
  });
});

describe("mergeSettings — launchCount", () => {
  it("accepts a non-negative integer and floors a fractional one", () => {
    expect(mergeSettings({ launchCount: 7 }).launchCount).toBe(7);
    expect(mergeSettings({ launchCount: 0 }).launchCount).toBe(0);
    expect(mergeSettings({ launchCount: 3.9 }).launchCount).toBe(3);
  });

  it("rejects a negative, a non-finite and a string", () => {
    expect(mergeSettings({ launchCount: -1 }).launchCount).toBe(0);
    expect(mergeSettings({ launchCount: Number.NaN }).launchCount).toBe(0);
    expect(mergeSettings({ launchCount: "12" }).launchCount).toBe(0);
  });
});

describe("mergeSettings — nodeTypeHelpCollapsed and lastRunAgentFile", () => {
  it("keeps all three legal states of the tri-state flag", () => {
    expect(mergeSettings({ nodeTypeHelpCollapsed: true }).nodeTypeHelpCollapsed).toBe(true);
    expect(mergeSettings({ nodeTypeHelpCollapsed: false }).nodeTypeHelpCollapsed).toBe(false);
    expect(mergeSettings({ nodeTypeHelpCollapsed: null }).nodeTypeHelpCollapsed).toBeNull();
  });

  it("rejects anything else", () => {
    expect(mergeSettings({ nodeTypeHelpCollapsed: "yes" }).nodeTypeHelpCollapsed).toBeNull();
    expect(mergeSettings({ nodeTypeHelpCollapsed: 1 }).nodeTypeHelpCollapsed).toBeNull();
  });

  it("takes any string as the last-run agent file, and nothing else", () => {
    expect(mergeSettings({ lastRunAgentFile: "tech-ui.md" }).lastRunAgentFile).toBe("tech-ui.md");
    expect(mergeSettings({ lastRunAgentFile: 12 }).lastRunAgentFile).toBe("");
  });
});

// ── tester #4 — a failed read must not overwrite the file ──────────────
//
// `load()` used to persist unconditionally 500 ms after every launch. One
// transient IPC failure, or a settings.json an editor left half-written, and
// the user's recents / panel sizes / claude path were replaced with defaults
// — permanently, from a possibly momentary problem. The launch still counts
// on every path (this loader IS the "app launched" event, A-2); only the
// write-back is withheld.

describe("settingsAfterLoad — what is adopted vs what may be written back", () => {
  it("first launch, no file yet: defaults, count 1, and DO create the file", () => {
    const out = settingsAfterLoad({ ok: true, raw: null });
    expect(out.settings).toEqual({ ...DEFAULT_SETTINGS, launchCount: 1 });
    expect(out.persist).toBe(true);
    expect(out.problem).toBeNull();
  });

  it("a good file: its values survive, the count advances, and it is written back", () => {
    const raw = JSON.stringify({ version: 1, launchCount: 7, uiScale: 115, claudeBinaryPath: "C:/claude.exe" });
    const out = settingsAfterLoad({ ok: true, raw });
    expect(out.settings.launchCount).toBe(8);
    expect(out.settings.uiScale).toBe(115);
    expect(out.settings.claudeBinaryPath).toBe("C:/claude.exe");
    expect(out.persist).toBe(true);
  });

  it("the IPC rejected: defaults in memory, count still advances, NOTHING written", () => {
    const out = settingsAfterLoad({ ok: false });
    expect(out.settings).toEqual({ ...DEFAULT_SETTINGS, launchCount: 1 });
    expect(out.persist).toBe(false);
    expect(out.problem).not.toBeNull();
  });

  it("unparseable JSON: the half-written file is left exactly as it is", () => {
    const out = settingsAfterLoad({ ok: true, raw: '{"version": 1, "recentProjects": [' });
    expect(out.settings).toEqual({ ...DEFAULT_SETTINGS, launchCount: 1 });
    expect(out.persist).toBe(false);
    expect(out.problem).not.toBeNull();
  });

  it("valid JSON that is not a settings object: still somebody's data, still untouched", () => {
    for (const raw of ["null", "[]", '"nope"', "12"]) {
      const out = settingsAfterLoad({ ok: true, raw });
      expect(out.persist).toBe(false);
      expect(out.settings.launchCount).toBe(1);
    }
  });

  it("an EMPTY object is a readable settings file — defaults, and safe to write", () => {
    const out = settingsAfterLoad({ ok: true, raw: "{}" });
    expect(out.persist).toBe(true);
    expect(out.problem).toBeNull();
    expect(out.settings.launchCount).toBe(1);
  });
});

describe("selectNodeTypeHelpOpen", () => {
  it("is open through the first N launches while the user has not chosen", () => {
    expect(
      selectNodeTypeHelpOpen(
        stateWith({ launchCount: NODE_TYPE_HELP_OPEN_LAUNCHES, nodeTypeHelpCollapsed: null }),
      ),
    ).toBe(true);
  });

  it("closes itself on the launch after that", () => {
    expect(
      selectNodeTypeHelpOpen(
        stateWith({ launchCount: NODE_TYPE_HELP_OPEN_LAUNCHES + 1, nodeTypeHelpCollapsed: null }),
      ),
    ).toBe(false);
  });

  it("an explicit false keeps it open forever, well past the launch window", () => {
    expect(selectNodeTypeHelpOpen(stateWith({ launchCount: 99, nodeTypeHelpCollapsed: false }))).toBe(
      true,
    );
  });

  it("an explicit true closes it even on launch 1", () => {
    expect(selectNodeTypeHelpOpen(stateWith({ launchCount: 1, nodeTypeHelpCollapsed: true }))).toBe(
      false,
    );
  });
});
