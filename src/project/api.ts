// Thin invoke wrappers for the project-properties commands (WO10 Lane 6).
// Names are byte-exact against `generate_handler!` in src-tauri/src/lib.rs.

import { invoke } from "@tauri-apps/api/core";
import type { ProjectInitResult, ProjectMeta } from "./types";

/** `null` when the project has no sidecar — every project predating this
 *  feature, plus any whose sidecar is corrupt (Rust reads tolerantly on
 *  purpose: a bad sidecar must never stop a project opening). */
export async function projectMetaRead(root: string): Promise<ProjectMeta | null> {
  return invoke<ProjectMeta | null>("project_meta_read", { root });
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
