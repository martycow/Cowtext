// Fix round (tester finding #5, edge spec E2). Pure-logic tests for the
// glob matcher shared by KindPicker.tsx (this lane) and the Inspector's
// GuardEditor (U4). No DOM, no store — `countGlobMatches`/`matchesGlob`
// take a plain file list, exactly the shape `useGlobMatchCount` reads from
// `useProjectStore`.

import { describe, expect, it } from "vitest";
import { countGlobMatches, matchesGlob, splitGlobPatterns } from "./globMatch";

const FILES = [
  { relPath: "context/rules.md" },
  { relPath: "context/architecture.md" },
  { relPath: "src/net/client.md" },
  { relPath: "src/net/server.md" },
  { relPath: "src/net/deep/handler.md" },
  { relPath: "docs/README.md" },
];

describe("matchesGlob", () => {
  it("`*` matches within a single path segment, never across `/`", () => {
    expect(matchesGlob("context/*.md", "context/rules.md")).toBe(true);
    expect(matchesGlob("context/*.md", "src/net/client.md")).toBe(false);
    expect(matchesGlob("*.md", "context/rules.md")).toBe(false); // no dir crossing
  });

  it("`**/` collapses to zero-or-more whole segments", () => {
    expect(matchesGlob("**/*.md", "docs/README.md")).toBe(true);
    expect(matchesGlob("**/*.md", "README.md")).toBe(true); // zero segments too
    expect(matchesGlob("**/*.md", "src/net/deep/handler.md")).toBe(true);
  });

  it("a directory `/**` matches every depth under it, including none", () => {
    expect(matchesGlob("src/net/**", "src/net/client.md")).toBe(true);
    expect(matchesGlob("src/net/**", "src/net/deep/handler.md")).toBe(true);
    expect(matchesGlob("src/net/**", "docs/README.md")).toBe(false);
  });

  it("`?` matches exactly one character, never `/`", () => {
    expect(matchesGlob("context/rule?.md", "context/rules.md")).toBe(true);
    expect(matchesGlob("context/rule?.md", "context/rule.md")).toBe(false);
  });

  it("a character class matches one of its members", () => {
    expect(matchesGlob("src/net/[cs]erver.md", "src/net/server.md")).toBe(true);
    expect(matchesGlob("src/net/[cs]erver.md", "src/net/xerver.md")).toBe(false);
  });

  it("is anchored — a glob never matches a bare substring", () => {
    expect(matchesGlob("net", "src/net/client.md")).toBe(false);
  });

  it("empty pattern matches nothing", () => {
    expect(matchesGlob("", "context/rules.md")).toBe(false);
    expect(matchesGlob("   ", "context/rules.md")).toBe(false);
  });
});

describe("splitGlobPatterns", () => {
  it("splits on newlines, trims, drops blanks", () => {
    expect(splitGlobPatterns("src/net/**\n\n  docs/*.md  \n")).toEqual(["src/net/**", "docs/*.md"]);
  });

  it("a single line with no newline is a one-element list", () => {
    expect(splitGlobPatterns("src/net/**")).toEqual(["src/net/**"]);
  });
});

describe("countGlobMatches", () => {
  it("counts distinct files matched by at least one pattern (union, deduped)", () => {
    const result = countGlobMatches(["src/net/**", "src/net/client.md"], FILES);
    expect(result.count).toBe(3); // client, server, deep/handler — not double-counted
    expect(result.scanned).toBe(FILES.length);
    expect(result.invalid).toBe(false);
  });

  it("accepts a single string OR an array of already-split patterns", () => {
    const fromString = countGlobMatches("src/net/**", FILES);
    const fromArray = countGlobMatches(["src/net/**"], FILES);
    expect(fromString).toEqual(fromArray);
  });

  it("a multi-line string is split the same way splitGlobPatterns does", () => {
    const result = countGlobMatches("context/*.md\nsrc/net/**", FILES);
    expect(result.count).toBe(5); // 2 context + 3 under src/net
  });

  it("empty or blank input is `invalid`, not a real zero", () => {
    expect(countGlobMatches("", FILES).invalid).toBe(true);
    expect(countGlobMatches("   \n  ", FILES).invalid).toBe(true);
    expect(countGlobMatches([], FILES).invalid).toBe(true);
  });

  it("a well-formed pattern matching nothing is a real, valid zero", () => {
    const result = countGlobMatches("nope/**", FILES);
    expect(result.invalid).toBe(false);
    expect(result.count).toBe(0);
  });

  it("`scanned` always reflects the full candidate list, even at zero matches", () => {
    expect(countGlobMatches("nope/**", FILES).scanned).toBe(FILES.length);
  });
});
