// Project properties wire types (WO10 Lane 6) — mirrors
// `src-tauri/src/project_meta.rs`'s `ProjectMeta` / `ProjectInitResult`
// field-for-field. Rust owns the file format and the rendering; this side
// owns the form.

/** `.cowtext/project.json` v1, minus the version envelope Rust adds on
 *  write and strips on read. */
export interface ProjectMeta {
  name: string;
  brief: string;
  projectType: string;
  requirements: string[];
  hardRules: string[];
  targetAudience: string;
  architecture: string;
  constraints: string[];
}

export interface ProjectInitResult {
  written: string[];
  skipped: string[];
  alreadyProject: boolean;
}

/** The picker's labels. Lives here, not in Rust: `projectType` is free-form
 *  on the wire and nothing server-side branches on it, so a second copy over
 *  there would be a second thing to keep in sync for no gain. */
export const PROJECT_TYPES: readonly { key: string; label: string; hint: string }[] = [
  { key: "app", label: "Application", hint: "Something with a UI and users." },
  {
    key: "game",
    label: "Video Game",
    hint: "Interactive, real-time; content and feel matter as much as code.",
  },
  { key: "library", label: "Library", hint: "Consumed by other code; its API is the product." },
  { key: "service", label: "Service", hint: "Runs continuously; uptime and contracts matter." },
  { key: "research", label: "Research", hint: "Exploratory; findings matter more than shipping." },
  { key: "other", label: "Other", hint: "None of the above." },
];

/** A2 — brief description cap. User input only; a longer hand-written
 *  sidecar round-trips untouched until edited (WO11 §5.1). */
export const PROJECT_BRIEF_MAX = 1000;

export const EMPTY_PROJECT_META: ProjectMeta = {
  name: "",
  brief: "",
  projectType: "app",
  requirements: [],
  hardRules: [],
  targetAudience: "",
  architecture: "",
  constraints: [],
};

/** Textarea ⇄ string[]: one entry per non-blank line. The wizard collects
 *  lists as free text because typing five requirements should not mean five
 *  clicks on a "+" button; Rust trims and drops blanks again on write, so a
 *  stray newline can never become an empty bullet. */
export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l !== "");
}

export function listToLines(items: readonly string[]): string {
  return items.join("\n");
}

/** Folder basename, for pre-filling the name field. Handles both separators
 *  and a trailing slash. */
export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
