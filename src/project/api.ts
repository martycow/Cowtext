// Thin invoke wrappers for the project-properties commands (WO10 Lane 6).
// Names are byte-exact against `generate_handler!` in src-tauri/src/lib.rs.

import { invoke } from "@tauri-apps/api/core";
import { EMPTY_PROJECT_META, type ProjectInitResult, type ProjectMeta } from "./types";

/** Rust's `ProjectMeta` carries `skip_serializing_if` on every optional
 *  field so the on-disk sidecar stays tidy — which means an empty project
 *  comes back over IPC with `requirements` / `hardRules` / `constraints` /
 *  `targetAudience` / `architecture` simply ABSENT, not empty. The wire type
 *  says they are always there, so every consumer would read `undefined` off a
 *  `string[]` (`value.join(...)` → TypeError). Fill the holes once, here, so
 *  the type the callers were promised is the type they get. */
function normalizeMeta(raw: ProjectMeta): ProjectMeta {
  return { ...EMPTY_PROJECT_META, ...raw };
}

/** `null` when the project has no sidecar — every project predating this
 *  feature, plus any whose sidecar is corrupt (Rust reads tolerantly on
 *  purpose: a bad sidecar must never stop a project opening). */
export async function projectMetaRead(root: string): Promise<ProjectMeta | null> {
  const raw = await invoke<ProjectMeta | null>("project_meta_read", { root });
  return raw === null ? null : normalizeMeta(raw);
}

export async function projectMetaWrite(root: string, meta: ProjectMeta): Promise<void> {
  return invoke<void>("project_meta_write", { root, meta });
}

/** Scaffold `.cowtext/`, `context/`, `.claude/agents/`, the sidecar and the
 *  rendered `context/project.md`. Never clobbers anything but the sidecar. */
export async function projectInit(
  root: string,
  meta: ProjectMeta,
): Promise<ProjectInitResult> {
  return invoke<ProjectInitResult>("project_init", { root, meta });
}
