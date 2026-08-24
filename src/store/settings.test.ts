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

// ── WO16 Block B/C — the three additive fields ────────────────────────
//
// Same posture as every field above: a settings.json we do not understand
// must cost the user the ONE value that is wrong, never the whole list and
// never the app's ability to start. These three carry more risk than the
// scalars do, because two of them name things — a preset id that shadows a
// built-in, or an icon file name that is really a path — so the merge is
// where those are refused, not the UI that renders them.

describe("mergeSettings — custom agent presets", () => {
  const good = {
    id: "custom:my-reviewer",
    name: "My reviewer",
    group: "task",
    description: "Reads a diff.",
    whenToUse: "Use when I say so.",
    tools: ["Read", "Grep"],
    mode: "restrict",
    priority: 2,
  };

  it("defaults to none when the field is absent or not an array", () => {
    expect(mergeSettings({}).customAgentPresets).toEqual([]);
    expect(mergeSettings({ customAgentPresets: "nope" }).customAgentPresets).toEqual([]);
    expect(mergeSettings({ customAgentPresets: { id: "x" } }).customAgentPresets).toEqual([]);
  });

  it("keeps a well-formed preset verbatim", () => {
    expect(mergeSettings({ customAgentPresets: [good] }).customAgentPresets).toEqual([good]);
  });

  it("drops only the bad entry, never the rest of the list", () => {
    const out = mergeSettings({
      customAgentPresets: [good, { id: "custom:broken" }, { ...good, id: "custom:second" }],
    }).customAgentPresets;
    expect(out.map((p) => p.id)).toEqual(["custom:my-reviewer", "custom:second"]);
  });

  it("refuses an id that does not declare itself custom", () => {
    // Otherwise a hand-edited file could shadow a built-in and the picker
    // would render two chips claiming the same identity.
    expect(mergeSettings({ customAgentPresets: [{ ...good, id: "reviewer" }] }).customAgentPresets)
      .toEqual([]);
  });

  it("refuses an unknown group rather than filing it under a default", () => {
    expect(mergeSettings({ customAgentPresets: [{ ...good, group: "wat" }] }).customAgentPresets)
      .toEqual([]);
  });

  it("refuses an unknown mode", () => {
    expect(mergeSettings({ customAgentPresets: [{ ...good, mode: "yolo" }] }).customAgentPresets)
      .toEqual([]);
  });

  it("keeps the first of two entries sharing an id", () => {
    const out = mergeSettings({
      customAgentPresets: [good, { ...good, name: "Impostor" }],
    }).customAgentPresets;
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("My reviewer");
  });

  it("forces inherit to mean no tools at all, whatever the file claims", () => {
    const out = mergeSettings({
      customAgentPresets: [{ ...good, mode: "inherit", tools: ["Read"] }],
    }).customAgentPresets;
    expect(out[0].mode).toBe("inherit");
    expect(out[0].tools).toEqual([]);
  });

  it("falls back to priority 1 for a missing or unusable priority", () => {
    for (const priority of [undefined, "high", NaN, null]) {
      const out = mergeSettings({ customAgentPresets: [{ ...good, priority }] }).customAgentPresets;
      expect(out[0].priority).toBe(1);
    }
  });

  it("keeps a pinned model but omits the key when it is empty", () => {
    expect(
      mergeSettings({ customAgentPresets: [{ ...good, model: "claude-fable-5" }] })
        .customAgentPresets[0].model,
    ).toBe("claude-fable-5");
    expect(
      mergeSettings({ customAgentPresets: [{ ...good, model: "" }] }).customAgentPresets[0].model,
    ).toBeUndefined();
  });
});

describe("mergeSettings — custom stack items", () => {
  const item = { id: "custom:in-house", label: "In-house", categoryId: "tooling", iconFile: null };

  it("defaults to none, keeps a good row verbatim", () => {
    expect(mergeSettings({}).customStackItems).toEqual([]);
    expect(mergeSettings({ customStackItems: [item] }).customStackItems).toEqual([item]);
  });

  it("refuses an id that does not declare itself custom", () => {
    expect(mergeSettings({ customStackItems: [{ ...item, id: "typescript" }] }).customStackItems)
      .toEqual([]);
  });

  it("trims and caps an over-long label instead of dropping the row", () => {
    const out = mergeSettings({
      customStackItems: [{ ...item, label: `  ${"x".repeat(200)}  ` }],
    }).customStackItems;
    expect(out).toHaveLength(1);
    expect(out[0].label).toHaveLength(40);
  });

  it("drops a row with no usable label", () => {
    expect(mergeSettings({ customStackItems: [{ ...item, label: "   " }] }).customStackItems)
      .toEqual([]);
  });

  it("files a row with a missing category under Custom rather than losing it", () => {
    expect(
      mergeSettings({ customStackItems: [{ ...item, categoryId: undefined }] }).customStackItems[0]
        .categoryId,
    ).toBe("custom");
  });

  it("refuses an iconFile that is really a path", () => {
    // The icon name is joined onto app_config_dir Rust-side. Rust refuses
    // these too — this is the same rule stated on both sides of the wire on
    // purpose, because either one alone is one edit away from being the
    // only one (the WO15 standing lesson about mirrors).
    for (const iconFile of ["../evil.png", "sub/evil.png", "sub\\evil.png"]) {
      expect(mergeSettings({ customStackItems: [{ ...item, iconFile }] }).customStackItems[0]
        .iconFile).toBeNull();
    }
    expect(
      mergeSettings({ customStackItems: [{ ...item, iconFile: "abc123.png" }] }).customStackItems[0]
        .iconFile,
    ).toBe("abc123.png");
  });
});

describe("mergeSettings — default stack ids", () => {
  it("defaults to none and keeps only strings", () => {
    expect(mergeSettings({}).defaultStackItemIds).toEqual([]);
    expect(
      mergeSettings({ defaultStackItemIds: ["typescript", 7, "", null, "custom:x"] })
        .defaultStackItemIds,
    ).toEqual(["typescript", "custom:x"]);
  });

  it("carries through an id this build does not know", () => {
    // Deliberate: the wizard filters at the point of use, so a default
    // naming an item added by a NEWER build survives a round-trip through
    // an older one instead of being silently deleted.
    expect(mergeSettings({ defaultStackItemIds: ["not-a-real-item"] }).defaultStackItemIds).toEqual([
      "not-a-real-item",
    ]);
  });
});
