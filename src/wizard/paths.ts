// Pure path helpers for the New Node wizard's TARGET step (WO01 Block D
// §T5). Kept separate from store/graph.ts's suggestFilePath — that one
// derives BOTH dir and slug from a title; here dir and file name are two
// independently editable fields.

/** Normalize a user-typed directory into a clean, forward-slash, no
 *  leading/trailing-slash relative path. Strips ".." segments so the
 *  result can never escape the project root. Empty input ⇒ "" (root). */
export function normalizeDir(raw: string): string {
  const parts = raw
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== "." && p !== "..");
  return parts.join("/");
}

/** Slug a display name into a filename-safe stem — same algorithm as
 *  store/graph.ts#slugify (private there), duplicated for the same reason
 *  as dedupePath below: a pure four-line helper isn't worth importing
 *  store internals for. */
export function slugForFile(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "node" : slug;
}

/** Force a ".md" extension onto a user-typed file name; falls back to
 *  "node" when the name is empty or was punctuation-only. */
export function normalizeFileName(raw: string, fallbackSlug: string): string {
  let name = raw.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  name = name.trim();
  if (name === "") name = fallbackSlug === "" ? "node" : fallbackSlug;
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

export function joinDirFile(dir: string, fileName: string): string {
  const d = normalizeDir(dir);
  return d === "" ? fileName : `${d}/${fileName}`;
}

/** De-dupe a relative path against a taken set with "-2", "-3"… suffixes
 *  before the extension — same shape as store/graph.ts#suggestFilePath,
 *  duplicated here (not imported) because the two inputs differ in shape
 *  and cross-importing store logic into a pure helper module isn't worth
 *  the coupling for four lines of arithmetic.
 *
 *  Compares case-insensitively: NTFS (and default-config APFS) resolve
 *  "Existing.md" and "existing.md" to the same file, so an exact-case
 *  `Set.has` here would miss the collision and let the wizard clobber an
 *  unrelated file's content on disk while a second, desynced node points
 *  at the differently-cased path (WO01 Block D defect). Over-deduping on a
 *  genuinely case-sensitive filesystem is the safe direction to err in. */
export function dedupePath(path: string, taken: ReadonlySet<string>): string {
  const takenLower = new Set(Array.from(taken, (p) => p.toLowerCase()));
  if (!takenLower.has(path.toLowerCase())) return path;
  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  let i = 2;
  let candidate = `${base}-${i}${ext}`;
  while (takenLower.has(candidate.toLowerCase())) {
    i += 1;
    candidate = `${base}-${i}${ext}`;
  }
  return candidate;
}
