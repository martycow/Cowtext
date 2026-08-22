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
import {
  DEFAULT_META,
  DEFAULT_PRIORITY,
  isDirty,
  normalizeSkillContent,
  parseMetaJson,
  serializeMeta,
  type AgentMeta,
  type DocDraft,
  type Selection,
} from "./agents";
import { builtinSkillStates, projectSkills } from "../agents/builtinSkills";
import { BUILTIN_SKILLS } from "../resources";
import type { AgentDoc, FmFields, SkillDoc } from "../agents/types";

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

// ── WO15 §4.6 — built-in skills, the three-state model ─────────────────

const BUILTIN = BUILTIN_SKILLS[0];

function skillDoc(overrides: Partial<SkillDoc> = {}): SkillDoc {
  return {
    dirName: BUILTIN.id,
    fields: fields({ name: BUILTIN.id, description: BUILTIN.description }),
    body: BUILTIN.body,
    raw: false,
    parseError: null,
    content: BUILTIN.content,
    extraFiles: [],
    extraFileCount: 0,
    ...overrides,
  };
}

describe("normalizeSkillContent — the comparison that decides materialized vs modified", () => {
  it("treats a CRLF checkout as identical to the bundled LF text", () => {
    expect(normalizeSkillContent("a\r\nb\r\n")).toBe(normalizeSkillContent("a\nb\n"));
  });

  it("ignores trailing whitespace an editor added, in either direction", () => {
    expect(normalizeSkillContent("a\nb")).toBe(normalizeSkillContent("a\nb\n\n  \n"));
  });

  it("does NOT ignore a real edit", () => {
    expect(normalizeSkillContent("a\nb\n")).not.toBe(normalizeSkillContent("a\nB\n"));
  });

  it("leaves interior whitespace alone — the body is a document, not a token stream", () => {
    expect(normalizeSkillContent("a\n\n  b\n")).toBe("a\n\n  b");
  });
});

describe("builtinSkillStates", () => {
  it("is virtual when nothing is on disk — a fresh project costs no files", () => {
    const states = builtinSkillStates([], {});
    expect(states.length).toBe(BUILTIN_SKILLS.length);
    expect(states[0].state).toBe("virtual");
    expect(states[0].onDisk).toBeNull();
    expect(states[0].include).toBe(false);
    // `content` is always the BUNDLED text — that is what Reset writes.
    expect(states[0].content).toBe(BUILTIN.content);
  });

  it("is materialized when the on-disk copy matches, CRLF and all", () => {
    const crlf = BUILTIN.content.replace(/\n/g, "\r\n");
    const states = builtinSkillStates([skillDoc({ content: crlf })], {});
    expect(states[0].state).toBe("materialized");
    expect(states[0].onDisk).not.toBeNull();
  });

  it("is modified once the user edits the file — Compile must never clobber it", () => {
    const states = builtinSkillStates(
      [skillDoc({ content: `${BUILTIN.content}\nMy own extra rule.\n` })],
      {},
    );
    expect(states[0].state).toBe("modified");
  });

  it("reads `include` from the sidecar map — an absent id is false", () => {
    expect(builtinSkillStates([], { [BUILTIN.id]: true })[0].include).toBe(true);
    expect(builtinSkillStates([], { "some-other-skill": true })[0].include).toBe(false);
  });

  it("ignores an unrelated on-disk skill entirely", () => {
    const states = builtinSkillStates([skillDoc({ dirName: "design-tokens" })], {});
    expect(states[0].state).toBe("virtual");
  });
});

describe("projectSkills", () => {
  it("hides a materialized built-in — it is already listed under Built-in", () => {
    expect(projectSkills([skillDoc()])).toEqual([]);
  });

  it("keeps a MODIFIED built-in: the user's edit is what makes it theirs", () => {
    const edited = skillDoc({ content: `${BUILTIN.content}\nedited\n` });
    expect(projectSkills([edited]).map((s) => s.dirName)).toEqual([BUILTIN.id]);
  });

  it("keeps every hand-written skill", () => {
    const own = skillDoc({ dirName: "design-tokens", content: "---\nname: design-tokens\n---\n\nx\n" });
    expect(projectSkills([own, skillDoc()]).map((s) => s.dirName)).toEqual(["design-tokens"]);
  });
});

describe("DEFAULT_PRIORITY", () => {
  it("is 1 — one constant behind the wizard, the parser and the merge (D-19)", () => {
    expect(DEFAULT_PRIORITY).toBe(1);
  });
});

// ── WO15 A-20 / audit F1 — the sidecar's `model` key ───────────────────
//
// F1: picking GPT-5.2 for an OpenAI agent wrote the id nowhere (frontmatter
// `model:` is Anthropic-only, and the sidecar had no `model` key), while the
// picker's badge said the choice was "kept locally". These cases pin the
// round trip that makes the badge true, and the two exclusions that keep
// Anthropic's model in exactly one place.

const AGENT_FILE = "tech-ui.md";

function sidecarJson(entry: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, agents: { [AGENT_FILE]: entry } });
}

/** The parsed meta for the one agent in `sidecarJson`. */
function metaOf(raw: string): AgentMeta {
  return parseMetaJson(raw, [doc()]).meta[AGENT_FILE];
}

/** The one agent entry as it is actually written back to disk. */
function emitted(meta: AgentMeta): Record<string, unknown> {
  const file = JSON.parse(serializeMeta({ [AGENT_FILE]: meta }, {}, {})) as {
    agents: Record<string, Record<string, unknown>>;
  };
  return file.agents[AGENT_FILE];
}

describe("sidecar `model` — parse", () => {
  it("keeps a non-Anthropic model id — the choice F1 dropped on the floor", () => {
    expect(metaOf(sidecarJson({ provider: "openai", model: "gpt-5.2" })).model).toBe("gpt-5.2");
  });

  it("keeps a custom id verbatim — model ids are opaque to Cowtext", () => {
    expect(metaOf(sidecarJson({ provider: "google", model: "My-Fine.Tune_v3" })).model).toBe(
      "My-Fine.Tune_v3",
    );
  });

  it("reads a sidecar written before A-20 as null, not undefined", () => {
    expect(metaOf(sidecarJson({ provider: "openai" })).model).toBeNull();
  });

  it("tolerates garbage: a number, an object, an explicit null and a blank string", () => {
    expect(metaOf(sidecarJson({ model: 42 })).model).toBeNull();
    expect(metaOf(sidecarJson({ model: { id: "gpt-5.2" } })).model).toBeNull();
    expect(metaOf(sidecarJson({ model: null })).model).toBeNull();
    expect(metaOf(sidecarJson({ model: "   " })).model).toBeNull();
  });

  it("keeps the id even when the provider beside it is one this build does not know", () => {
    const meta = metaOf(sidecarJson({ provider: "skynet", model: "hal-9000" }));
    expect(meta.provider).toBeUndefined();
    expect(meta.model).toBe("hal-9000");
  });
});

describe("sidecar `model` — serialize", () => {
  it("round-trips a non-Anthropic pair back out unchanged", () => {
    const out = emitted(metaOf(sidecarJson({ provider: "openai", model: "gpt-5.2" })));
    expect(out.provider).toBe("openai");
    expect(out.model).toBe("gpt-5.2");
  });

  it("never writes it for an Anthropic agent — that model belongs in frontmatter", () => {
    const meta: AgentMeta = { ...DEFAULT_META, provider: "anthropic", model: "claude-fable-5" };
    expect("model" in emitted(meta)).toBe(false);
    expect(emitted(meta).provider).toBe("anthropic");
  });

  it("never writes it with no provider to interpret it against", () => {
    expect("model" in emitted({ ...DEFAULT_META, model: "gpt-5.2" })).toBe(false);
  });

  it("omits the key for a null model rather than emitting `\"model\": null`", () => {
    expect("model" in emitted({ ...DEFAULT_META, provider: "openai", model: null })).toBe(false);
  });

  it("drops an id whose provider this build no longer knows", () => {
    expect("model" in emitted(metaOf(sidecarJson({ provider: "skynet", model: "hal-9000" })))).toBe(
      false,
    );
  });
});
