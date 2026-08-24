// The merged stack table (WO16 Block C). Two consumers read this — the
// Settings pane and the New Project wizard — so the ORDER it produces is
// part of the contract, not an implementation detail: a user who has learned
// where "React" sits must not find it somewhere else after adding a row of
// their own.

import { describe, expect, it } from "vitest";
import { STACK_CATEGORIES } from "../resources";
import type { CustomStackItem } from "../store/settings";
import {
  CUSTOM_STACK_CATEGORY_LABEL,
  knownStackIds,
  stackAddProblem,
  stackGroups,
  stackIdFor,
  stackLabel,
  stackSlug,
} from "./stackTable";

const inTooling: CustomStackItem = {
  id: "custom:in-house-cli",
  label: "In-house CLI",
  categoryId: "tooling",
  iconFile: null,
};

const orphan: CustomStackItem = {
  id: "custom:orbit",
  label: "Orbit",
  categoryId: "nonexistent-category",
  iconFile: "abc.png",
};

describe("stackGroups", () => {
  it("with no custom items, is exactly the bundled table", () => {
    const groups = stackGroups([]);
    expect(groups.map((g) => g.id)).toEqual(STACK_CATEGORIES.map((c) => c.id));
    for (const [i, group] of groups.entries()) {
      expect(group.rows.map((r) => r.id)).toEqual(STACK_CATEGORIES[i].items.map((it) => it.id));
      expect(group.rows.every((r) => !r.custom)).toBe(true);
    }
  });

  it("adds no trailing Custom group until something needs one", () => {
    expect(stackGroups([]).some((g) => g.label === CUSTOM_STACK_CATEGORY_LABEL)).toBe(false);
    expect(stackGroups([inTooling]).some((g) => g.label === CUSTOM_STACK_CATEGORY_LABEL)).toBe(
      false,
    );
  });

  it("appends a custom row AFTER the bundled rows of the category it names", () => {
    const tooling = stackGroups([inTooling]).find((g) => g.id === "tooling");
    const bundled = STACK_CATEGORIES.find((c) => c.id === "tooling")?.items ?? [];
    expect(tooling?.rows.map((r) => r.id)).toEqual([
      ...bundled.map((i) => i.id),
      "custom:in-house-cli",
    ]);
    expect(tooling?.rows.at(-1)?.custom).toBe(true);
  });

  it("collects rows naming an unknown category under a trailing Custom group", () => {
    const groups = stackGroups([orphan]);
    const last = groups.at(-1);
    expect(last?.label).toBe(CUSTOM_STACK_CATEGORY_LABEL);
    expect(last?.rows.map((r) => r.id)).toEqual(["custom:orbit"]);
    // The icon travels with the row — the pane renders from this, not from
    // the settings list.
    expect(last?.rows[0].iconFile).toBe("abc.png");
  });
});

describe("knownStackIds", () => {
  it("covers every bundled id plus every custom one", () => {
    const ids = knownStackIds([inTooling]);
    expect(ids.has("typescript")).toBe(true);
    expect(ids.has("custom:in-house-cli")).toBe(true);
    expect(ids.has("custom:never-added")).toBe(false);
  });
});

describe("stackLabel", () => {
  it("resolves both halves of the table and nothing else", () => {
    expect(stackLabel("typescript", [])).toBe("TypeScript");
    expect(stackLabel("custom:in-house-cli", [inTooling])).toBe("In-house CLI");
    expect(stackLabel("custom:in-house-cli", [])).toBeNull();
    expect(stackLabel("who-knows", [])).toBeNull();
  });
});

describe("stackSlug / stackIdFor", () => {
  it("reduces a label to a boring, stable id", () => {
    expect(stackSlug("In-house CLI")).toBe("in-house-cli");
    expect(stackSlug("  Vue 3 !!  ")).toBe("vue-3");
    expect(stackSlug("C++")).toBe("c");
    expect(stackIdFor("In-house CLI")).toBe("custom:in-house-cli");
  });

  it("is empty when there is nothing sluggable, so the caller can refuse", () => {
    expect(stackSlug("!!!")).toBe("");
    expect(stackSlug("   ")).toBe("");
  });
});

describe("stackAddProblem", () => {
  it("accepts a genuinely new name", () => {
    expect(stackAddProblem("In-house CLI", [])).toBeNull();
  });

  it("refuses a blank or unsluggable name", () => {
    expect(stackAddProblem("   ", [])).not.toBeNull();
    expect(stackAddProblem("!!!", [])).not.toBeNull();
  });

  it("refuses a duplicate of the user's own row", () => {
    expect(stackAddProblem("In-house CLI", [inTooling])).not.toBeNull();
    // Same slug, different typing — still the same row.
    expect(stackAddProblem("in house cli", [inTooling])).not.toBeNull();
  });

  it("refuses a duplicate of a BUNDLED row, case-insensitively", () => {
    // Two boxes meaning the same thing is worse than no box: the wizard
    // would write the label twice into `context/stack.md`.
    expect(stackAddProblem("React", [])).not.toBeNull();
    expect(stackAddProblem("react", [])).not.toBeNull();
  });

  it("refuses an over-long name", () => {
    expect(stackAddProblem("x".repeat(41), [])).not.toBeNull();
  });
});
