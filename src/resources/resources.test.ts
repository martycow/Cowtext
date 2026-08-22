// Validator for the bundled data tables (WO15 §4.9). The JSON files are
// hand-edited (Marty reviews the non-Anthropic model ids, D-10) and the
// types alone cannot express what actually matters about them: the exact
// ids, the order, the cross-table invariants, and the fact that every
// preset tool is a real tool. This file is that contract, in code.

import { describe, expect, it } from "vitest";
import {
  AGENT_PRESETS,
  BUILTIN_SKILLS,
  DEFAULT_AGENT_MODEL,
  DEFAULT_PROVIDER,
  FIXED_STACK_PRINCIPLE_ID,
  PRINCIPLES,
  PROVIDERS,
  PROVIDER_COMPILE_TARGET,
  PROVIDER_SUPPORT_SENTENCE,
  STACK_CATEGORIES,
  defaultModelFor,
  parseSkillMd,
  providerById,
  stackItemById,
} from "./index";
import { PROVIDER_IDS } from "../agents/types";
import { ALL_TOOLS } from "../agents/toolCatalog";
import { DEFAULT_PRIORITY } from "../store/agents";

// §4.9's `/^[a-z0-9][a-z0-9.\-]*$/`, with the hyphen moved to the end of the
// class instead of escaped — identical semantics, and `no-useless-escape`
// (an ESLint error, not a warning) rejects the escaped form.
const MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/;

describe("providers & models", () => {
  it("lists the five providers in PROVIDER_IDS order", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual([
      "anthropic",
      "openai",
      "google",
      "cursor",
      "github",
    ]);
    expect(PROVIDERS.map((p) => p.id)).toEqual([...PROVIDER_IDS]);
  });

  it("defaults to the Anthropic flagship the agent wizard ships", () => {
    expect(DEFAULT_PROVIDER).toBe("anthropic");
    expect(defaultModelFor("anthropic")).toBe(DEFAULT_AGENT_MODEL);
    const anthropic = providerById("anthropic");
    expect(anthropic).not.toBeNull();
    expect(anthropic?.models.find((m) => m.id === DEFAULT_AGENT_MODEL)?.tier).toBe("flagship");
  });

  it("has no model list — and so no default model — for cursor and github", () => {
    expect(providerById("cursor")?.models).toEqual([]);
    expect(providerById("github")?.models).toEqual([]);
    expect(defaultModelFor("cursor")).toBeNull();
    expect(defaultModelFor("github")).toBeNull();
  });

  it("uses unique, well-formed model ids everywhere", () => {
    const ids = PROVIDERS.flatMap((p) => p.models.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(MODEL_ID);
  });

  it("every model carries a label and a known tier", () => {
    for (const provider of PROVIDERS) {
      for (const model of provider.models) {
        expect(model.label.length).toBeGreaterThan(0);
        expect(["flagship", "balanced", "fast"]).toContain(model.tier);
      }
    }
  });

  it("maps every provider to the compile target that proves it is installed", () => {
    expect(Object.keys(PROVIDER_COMPILE_TARGET).sort()).toEqual([...PROVIDER_IDS].sort());
    expect(PROVIDER_COMPILE_TARGET.anthropic).toBe("claude");
    expect(PROVIDER_COMPILE_TARGET.openai).toBe("agents");
  });

  it("providerById is null for an unknown id, never a guess", () => {
    expect(providerById("meta")).toBeNull();
  });
});

describe("the provider-support sentence", () => {
  it("is the matrix's sentence verbatim", () => {
    expect(PROVIDER_SUPPORT_SENTENCE).toBe(
      "Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.",
    );
  });
});

describe("agent presets", () => {
  it("ships exactly the six presets, in order", () => {
    expect(AGENT_PRESETS.map((p) => p.id)).toEqual([
      "reviewer",
      "test-writer",
      "docs-writer",
      "refactorer",
      "planner",
      "debugger",
    ]);
  });

  it("every whenToUse is a real sentence that starts with 'Use when' and is not the name", () => {
    for (const preset of AGENT_PRESETS) {
      expect(preset.whenToUse.length).toBeGreaterThanOrEqual(20);
      expect(preset.whenToUse.startsWith("Use when")).toBe(true);
      expect(preset.whenToUse).not.toBe(preset.name);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("names only real tools, and none at all when the mode is inherit", () => {
    for (const preset of AGENT_PRESETS) {
      for (const tool of preset.tools) expect(ALL_TOOLS).toContain(tool);
      if (preset.mode === "inherit") expect(preset.tools.length).toBe(0);
      else expect(preset.tools.length).toBeGreaterThan(0);
    }
  });

  it("starts every preset at the shared default priority", () => {
    for (const preset of AGENT_PRESETS) expect(preset.priority).toBe(DEFAULT_PRIORITY);
  });

  it("pins only models that exist (none do today — the wizard default applies)", () => {
    const ids = PROVIDERS.flatMap((p) => p.models.map((m) => m.id));
    for (const preset of AGENT_PRESETS) {
      if (preset.model !== undefined) expect(ids).toContain(preset.model);
    }
  });
});

describe("stack categories", () => {
  it("ships the six categories with the exact labels", () => {
    expect(STACK_CATEGORIES.map((c) => c.id)).toEqual([
      "languages",
      "frontend",
      "backend",
      "engines",
      "data",
      "tooling",
    ]);
    expect(STACK_CATEGORIES.map((c) => c.label)).toEqual([
      "Languages",
      "Frontend",
      "Backend",
      "Engines/Graphics",
      "Data",
      "Tooling",
    ]);
  });

  it("ships the exact item labels, per category", () => {
    const byId = new Map(STACK_CATEGORIES.map((c) => [c.id, c.items.map((i) => i.label)]));
    expect(byId.get("languages")).toEqual([
      "TypeScript",
      "Python",
      "Rust",
      "Go",
      "C#",
      "Java",
      "Kotlin",
      "Swift",
    ]);
    expect(byId.get("frontend")).toEqual(["React", "Vue", "Svelte", "Next.js", "Tauri", "Electron"]);
    expect(byId.get("backend")).toEqual([
      "Node/Express",
      "FastAPI",
      "Django",
      "axum",
      "Actix",
      "ASP.NET",
      "Spring",
    ]);
    expect(byId.get("engines")).toEqual(["Unity", "Unreal", "Godot", "PixiJS", "Three.js"]);
    expect(byId.get("data")).toEqual(["PostgreSQL", "SQLite", "Redis", "Prisma", "Drizzle"]);
    expect(byId.get("tooling")).toEqual([
      "pnpm",
      "Vite",
      "Tailwind",
      "Zustand",
      "Vitest",
      "Playwright",
    ]);
  });

  it("uses globally unique item ids — stackItemById can never be ambiguous", () => {
    const ids = STACK_CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(stackItemById("axum")?.category.id).toBe("backend");
    expect(stackItemById("axum")?.item.label).toBe("axum");
    expect(stackItemById("cobol")).toBeNull();
  });
});

describe("principles", () => {
  it("ships the six principles in order, with the exact labels", () => {
    expect(PRINCIPLES.map((p) => p.id)).toEqual([
      "no-commit-without-asking",
      "short-commit-subjects",
      "ask-before-dependency",
      "tests-before-done",
      "no-destructive-git",
      "prefer-editing-existing",
    ]);
    expect(PRINCIPLES.map((p) => p.label)).toEqual([
      "Never commit without asking",
      "Short commit messages (≤ 50 chars subject)",
      "Ask before adding a dependency",
      "Run tests before declaring done",
      "No destructive git operations (force-push, reset --hard)",
      "Prefer editing existing files over creating new ones",
    ]);
  });

  it("every body is a real markdown node, not a one-liner", () => {
    for (const principle of PRINCIPLES) {
      expect(principle.body.trim().split("\n").length).toBeGreaterThanOrEqual(2);
      expect(principle.body.startsWith("# ")).toBe(true);
    }
  });

  it("the fixed-stack checkbox points at a principle that exists", () => {
    expect(PRINCIPLES.some((p) => p.id === FIXED_STACK_PRINCIPLE_ID)).toBe(true);
  });
});

describe("built-in skills", () => {
  it("ships task-format, frontmatter first", () => {
    const taskFormat = BUILTIN_SKILLS.find((s) => s.id === "task-format");
    expect(taskFormat).toBeDefined();
    expect(taskFormat?.content.startsWith("---\n")).toBe(true);
  });

  it("derives id from the frontmatter name, and never ships an empty field", () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toBe(skill.id);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("round-trips through parseSkillMd — body is exactly what the file holds", () => {
    for (const skill of BUILTIN_SKILLS) {
      const parsed = parseSkillMd(skill.content);
      expect(parsed.name).toBe(skill.name);
      expect(parsed.description).toBe(skill.description);
      expect(parsed.body).toBe(skill.body);
    }
  });

  it("parseSkillMd refuses to invent frontmatter for a file that has none", () => {
    const plain = "# Just a heading\n\nno fence here\n";
    expect(parseSkillMd(plain)).toEqual({ name: "", description: "", body: plain });
  });

  it("parseSkillMd tolerates CRLF and quoted scalars", () => {
    const crlf = '---\r\nname: "x"\r\ndescription: \'y\'\r\n---\r\n\r\nbody line\r\n';
    const parsed = parseSkillMd(crlf);
    expect(parsed.name).toBe("x");
    expect(parsed.description).toBe("y");
    expect(parsed.body).toBe("body line\r\n");
  });
});
