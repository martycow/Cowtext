// Node-wizard preset manifest (WO01 Block D §T5). DEVIATION from the frozen
// spec, recorded here: the work order asks for a bespoke manifest shaped
// {version:1, kind:"cowtext-node-preset", name, role, dir, fileName, pinned,
// brief, content}, written/read at an arbitrary OS-dialog path. The only
// Rust commands that do that (preset_export / preset_read, src-tauri/src/
// preset.rs) hard-validate `kind === "cowtext-preset"` and a `nodes` array
// (validate_preset) — this agent's file zone is UI-only, no Rust, so a new
// invoke command isn't an option here. Fix used instead: wrap the same
// eight fields inside a minimal single-node "cowtext-preset" envelope so
// the existing Rust validator accepts it unmodified. Round-trips exactly
// (export → import → confirm reproduces the created file byte-exact) since
// this module is the only reader/writer of the extra `content` field — the
// regular Presets modal (preset/types.ts) never sees or strips it.
// tech-lead/tech-general: a dedicated `node_preset_export`/`node_preset_read`
// pair (or a relaxed `kind` check) would let this match the literal spec;
// flagged in the WO01 Block D report.

import { save, open } from "@tauri-apps/plugin-dialog";
import { presetExport, presetRead } from "../preset/api";
import { NODE_ROLES, type NodeRole } from "../store/graph";
import { joinDirFile, normalizeDir, slugForFile } from "./paths";
import { isWizardRole, toWizardRole } from "./roles";

export interface WizardPresetFields {
  name: string;
  role: NodeRole;
  dir: string;
  fileName: string;
  pinned: boolean;
  brief: string;
  content: string;
}

/** What Import hands back. D3a (WO12): a preset file is untrusted input —
 *  hand-edited, or exported from an agent-tagged node in an older session —
 *  so its `role` goes through the same gate as the picker. `fields.role` is
 *  always a role the wizard may create; `blockedRole` names what the file
 *  actually asked for when the gate had to intervene, so the wizard can say
 *  so out loud instead of silently changing the user's data. */
export interface WizardPresetImport {
  fields: WizardPresetFields;
  blockedRole: NodeRole | null;
}

function buildEnvelope(fields: WizardPresetFields): string {
  const filePath = joinDirFile(fields.dir, fields.fileName);
  const envelope = {
    version: 1,
    kind: "cowtext-preset",
    name: fields.name,
    savedAt: new Date().toISOString(),
    nodes: [
      {
        id: "wizard-node",
        title: fields.name,
        role: fields.role,
        brief: fields.brief,
        filePath,
        readOrder: 1,
        ...(fields.pinned ? { rootLoad: "always" as const } : {}),
        position: { x: 0, y: 0 },
        // Extra field beyond the graph-preset node shape — this manifest's
        // whole reason to exist. See file header.
        content: fields.content,
      },
    ],
    edges: [],
    compileTargets: ["claude"],
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function parseEnvelope(json: string): WizardPresetImport {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("Not a node-preset file");
  const p = raw as Record<string, unknown>;
  if (p.kind !== "cowtext-preset" || !Array.isArray(p.nodes)) {
    throw new Error("Not a Cowtext node preset (kind mismatch)");
  }
  if (p.nodes.length !== 1) {
    throw new Error(
      "This looks like a full graph preset, not a node preset — use Presets… instead",
    );
  }
  const n = p.nodes[0] as Record<string, unknown>;
  if (typeof n.content !== "string") {
    throw new Error("This looks like a full graph preset, not a node preset (no content field)");
  }
  const filePath = typeof n.filePath === "string" ? n.filePath : "";
  const slash = filePath.lastIndexOf("/");
  const dir = slash >= 0 ? normalizeDir(filePath.slice(0, slash)) : "";
  const fileName = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const rawRole = NODE_ROLES.find((r) => r === n.role) ?? "architecture";
  // D3a (WO12) — the wizard's role exclusion is enforced HERE too, not only
  // at the picker. `NODE_ROLES` still contains "agent" (the Inspector needs
  // it for adopted agent nodes), so a preset naming `"role": "agent"` used to
  // validate cleanly and ride straight through Confirm into a context/*.md
  // tagged `agent` — the exact state the wizard's picker was filtered to make
  // impossible. Coerce, and report what was coerced.
  const role = toWizardRole(rawRole);
  const blockedRole = isWizardRole(rawRole) ? null : rawRole;
  const name = typeof n.title === "string" && n.title !== "" ? n.title : String(p.name ?? "");
  return {
    fields: {
      name,
      role,
      dir,
      fileName: fileName === "" ? `${slugForFile(name)}.md` : fileName,
      pinned: n.rootLoad === "always",
      brief: typeof n.brief === "string" ? n.brief : "",
      content: n.content,
    },
    blockedRole,
  };
}

/** Opens a save dialog and writes the manifest. Resolves false when the
 *  user cancels the dialog. */
export async function exportWizardPreset(fields: WizardPresetFields): Promise<boolean> {
  const path = await save({
    defaultPath: `${slugForFile(fields.name)}.node.cowtext-preset.json`,
    filters: [{ name: "Cowtext node preset", extensions: ["cowtext-preset.json"] }],
  });
  if (typeof path !== "string") return false;
  await presetExport(path, buildEnvelope(fields));
  return true;
}

/** Opens an open dialog and reads back a manifest. Resolves null when the
 *  user cancels the dialog. The returned `fields.role` has already passed the
 *  wizard's role gate (D3a). */
export async function importWizardPreset(): Promise<WizardPresetImport | null> {
  const picked = await open({ filters: [{ name: "Cowtext node preset", extensions: ["json"] }] });
  if (typeof picked !== "string") return null;
  const json = await presetRead(picked);
  return parseEnvelope(json);
}
