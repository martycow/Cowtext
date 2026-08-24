// Frontend IPC wrapper for custom stack-item icons (WO16 Block C).
// Storage is app-level — `app_config_dir/stack-icons/<hash>.<ext>` — because
// the custom stack table lives in `settings.json` and travels with the
// install, not with any one project.
//
// `sourcePath` is the one absolute, webview-supplied path these commands
// accept: it must come from `@tauri-apps/plugin-dialog`'s `open()` (a
// user-chosen file), never a value the frontend built for itself. Same rule
// as `agents/avatarApi.ts`, whose shape this deliberately mirrors.

import { invoke } from "@tauri-apps/api/core";

export interface StackIconRef {
  /** Bare basename — what `CustomStackItem.iconFile` stores. */
  file: string;
  /** "data:image/png;base64,…" — rendered directly in an `<img src>`, so no
   *  asset-protocol scope and no CSP change was needed for this feature. */
  dataUrl: string;
  bytes: number;
}

/** Validates by magic bytes (PNG/JPEG/WebP/GIF), never by extension, and
 *  caps at 64 KB. Content-addressed: importing the same image twice reuses
 *  one file on disk. */
export function stackIconImport(sourcePath: string): Promise<StackIconRef> {
  return invoke<StackIconRef>("stack_icon_import", { sourcePath });
}

/** `null` both when there is no icon and when the file cannot be read back
 *  — a broken icon falls back to the default glyph and must never stop the
 *  stack picker from rendering. */
export function stackIconRead(file: string): Promise<string | null> {
  return invoke<string | null>("stack_icon_read", { file });
}

export function stackIconDelete(file: string): Promise<void> {
  return invoke<void>("stack_icon_delete", { file });
}
