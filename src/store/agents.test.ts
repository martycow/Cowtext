// Pure-module regression test for the HIGH defect: `reloadAgentFromDisk`
// (assemble finishing while `AgentEditor` is mid-edit) must never silently
// replace a dirty draft. The store action itself calls `agentsScan`, which
// goes through `@tauri-apps/api/core`'s `invoke` — not something this
// vitest layer mocks (§15: "no jsdom, no testing-library... pure-module
// tests only", and `src/store/graph.test.ts` sets the precedent of testing
// only the PURE exported functions, never the live store/invoke wiring).
//
// `isDirty` is the exact predicate `reloadAgentFromDisk` calls, synchronously,
// against the state as it stands the instant before it splices in the fresh
// disk content — that comparison IS the fix. This file exercises it directly
// against the same shapes the bug's repro produces (typing in Description /
// System prompt without pausing long enough for the 500ms autosave debounce),
// so the predicate that decides "clobber vs. preserve" is covered without a
// DOM. The async wiring around it (does `reloadAgentFromDisk` actually call
// `isDirty` before overwriting `agents[]`, does it skip the `reloadNonce`
// bump on the dirty branch) is NOT covered here — that needs the running
// store + a mocked `agentsScan`, which this repo's test layer doesn't do
// anywhere yet; left to `tester`'s manual walk.

import { describe, expect, it } from "vitest";
import { isDirty, type DocDraft, type Selection } from "./agents";
import type { AgentDoc, FmFields } from "../agents/types";

const SEL: Selection = { kind: "agent", key: "tech-ui.md" };

function fields(overrides: Partial<FmFields> = {}): FmFields {
  return {
    name: "tech-ui",
    description: "Use this agent when touching src/ UI files.",
    model: null,
    tools: [],
    skills: [],
    disallowedTools: [],
    permissionMode: null,
    maxTurns: null,
    memory: null,
    color: null,
    ...overrides,
  };
}

function doc(overrides: Partial<AgentDoc> = {}): AgentDoc {
  return {
    fileName: "tech-ui.md",
    fields: fields(),
    body: "\nYou build UI chrome.\n",
    raw: false,
    parseError: null,
    content: "---\nname: tech-ui\n---\n\nYou build UI chrome.\n",
    ...overrides,
  };
}

function draft(overrides: Partial<DocDraft> = {}): DocDraft {
  return {
    fields: fields(),
    body: "\nYou build UI chrome.\n",
    rawContent: "",
    raw: false,
    ...overrides,
  };
}

function stateWith(d: AgentDoc, dr?: DocDraft) {
  return {
    agents: [d],
    skills: [],
    drafts: dr === undefined ? {} : { "agent:tech-ui.md": dr },
  };
}

describe("isDirty — the predicate reloadAgentFromDisk's clobber-guard depends on", () => {
  it("is false with no draft — nothing to protect, safe to adopt fresh content", () => {
    expect(isDirty(stateWith(doc()), SEL)).toBe(false);
  });

  it("is false when the draft matches the doc exactly — safe to adopt fresh content", () => {
    expect(isDirty(stateWith(doc(), draft()), SEL)).toBe(false);
  });

  it("is true when the System prompt (body) diverges — the bug's literal repro", () => {
    const d = doc();
    const dr = draft({ body: "\nYou build UI chrome and you were mid-sentence when—" });
    expect(isDirty(stateWith(d, dr), SEL)).toBe(true);
  });

  it("is true when the Description diverges — the bug's other literal repro", () => {
    const d = doc();
    const dr = draft({ fields: fields({ description: "Use this agent when the user is still typing…" }) });
    expect(isDirty(stateWith(d, dr), SEL)).toBe(true);
  });

  it("is true in raw mode when rawContent diverges from doc.content", () => {
    const d = doc({ raw: true, parseError: "bad frontmatter", content: "not valid frontmatter" });
    const dr = draft({ raw: true, rawContent: "not valid frontmatter, and I'm editing it" });
    expect(isDirty(stateWith(d, dr), SEL)).toBe(true);
  });

  it("evaluated against the PRE-reload doc (what reloadAgentFromDisk actually does) still reports dirty — the clobber is correctly avoided", () => {
    // Mirrors reloadAgentFromDisk's exact call: isDirty(st, sel) is invoked
    // BEFORE `st.agents` is replaced with the freshly-scanned doc, using
    // the OLD doc still sitting in state at that point — this is the
    // store's equivalent of AgentMarkdownTab's pre-reload baseline ref,
    // taken atomically instead of across a render.
    const preReloadDoc = doc();
    const midEditDraft = draft({ body: "\nYou build UI chrome and the user kept typing without pausing" });
    expect(isDirty(stateWith(preReloadDoc, midEditDraft), SEL)).toBe(true);
  });
});
