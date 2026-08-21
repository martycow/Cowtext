// WO13_CONTRACT.md §15 coverage table: "wizard/paths.test.ts — slug
// generation: spaces, case, diacritics, collisions."

import { describe, expect, it } from "vitest";
import { dedupePath, joinDirFile, normalizeDir, normalizeFileName, slugForFile } from "./paths";

describe("slugForFile", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugForFile("API Conventions")).toBe("api-conventions");
  });

  it("collapses punctuation runs into one hyphen and trims edges", () => {
    expect(slugForFile("  --Hello, World!--  ")).toBe("hello-world");
  });

  it("strips diacritics down to their base letters", () => {
    expect(slugForFile("café")).toBe("cafe");
    expect(slugForFile("Über naïve façade")).toBe("uber-naive-facade");
  });

  it("falls back to 'node' for empty or punctuation-only input", () => {
    expect(slugForFile("")).toBe("node");
    expect(slugForFile("   ")).toBe("node");
    expect(slugForFile("!!!")).toBe("node");
  });
});

describe("normalizeDir", () => {
  it("normalizes separators and drops (not resolves) '.'/'..' segments", () => {
    // normalizeDir strips "."/".." tokens outright rather than resolving
    // them against their siblings — see the function's own doc comment
    // ("so the result can never escape the project root").
    expect(normalizeDir("context\\api\\..\\rules")).toBe("context/api/rules");
    expect(normalizeDir("./context/")).toBe("context");
    expect(normalizeDir("")).toBe("");
  });
});

describe("normalizeFileName", () => {
  it("forces a .md extension and takes only the basename", () => {
    expect(normalizeFileName("notes", "fallback")).toBe("notes.md");
    expect(normalizeFileName("dir/notes.md", "fallback")).toBe("notes.md");
    expect(normalizeFileName("Already.MD", "fallback")).toBe("Already.MD");
  });

  it("falls back to the slug when the input is empty", () => {
    expect(normalizeFileName("", "my-slug")).toBe("my-slug.md");
  });
});

describe("joinDirFile", () => {
  it("joins with a slash, omitting it for the root", () => {
    expect(joinDirFile("context", "x.md")).toBe("context/x.md");
    expect(joinDirFile("", "x.md")).toBe("x.md");
  });
});

describe("dedupePath — collisions", () => {
  it("returns the path unchanged when not taken", () => {
    expect(dedupePath("context/x.md", new Set())).toBe("context/x.md");
  });

  it("appends -2, -3… before the extension until free", () => {
    const taken = new Set(["context/x.md", "context/x-2.md"]);
    expect(dedupePath("context/x.md", taken)).toBe("context/x-3.md");
  });

  it("compares case-insensitively (NTFS/APFS collision safety)", () => {
    const taken = new Set(["Context/X.md"]);
    expect(dedupePath("context/x.md", taken)).toBe("context/x-2.md");
  });
});
