// The only invoke() calls of the Preset module (PHASE56_CONTRACT §3).
// Names are byte-exact mirrors of the lib.rs generate_handler entries.

import { invoke } from "@tauri-apps/api/core";
import type { PresetInfo, StubFile } from "./types";

export function presetSave(name: string, presetJson: string): Promise<string> {
  return invoke<string>("preset_save", { name, presetJson });
}

export function presetList(): Promise<PresetInfo[]> {
  return invoke<PresetInfo[]>("preset_list");
}

export function presetRead(path: string): Promise<string> {
  return invoke<string>("preset_read", { path });
}

export function presetExport(path: string, presetJson: string): Promise<null> {
  return invoke<null>("preset_export", { path, presetJson });
}

export function presetApply(
  root: string,
  graphJson: string,
  stubs: StubFile[],
): Promise<string[]> {
  return invoke<string[]>("preset_apply", { root, graphJson, stubs });
}
