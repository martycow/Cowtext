// Settings › Agent presets (WO16 Block B).
//
// Presets are CREATED in the New Agent dialog — "Save as preset" captures a
// form the user has already filled in and proved they want. Creating one
// here instead would mean a second, emptier copy of that form, and the two
// would drift. So this pane does the other half: it shows what exists, lets
// the wording be corrected, and lets a preset be thrown away.
//
// Built-ins are listed read-only alongside. That is not decoration — it is
// the answer to "why is my preset at the bottom of that group?" and to "does
// one of these already do this?", asked at the moment the user is looking at
// their own list.

import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import {
  AGENT_PRESETS,
  PRESET_GROUPS,
  type AgentPreset,
  type PresetGroup,
} from "../resources";
import { useSettingsStore } from "../store/settings";
import { HelperLine, SectionLabel } from "./controls";

const FIELD =
  "h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content transition-colors duration-fast placeholder:text-content-muted focus:border-accent";
const AREA =
  "w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 text-sm leading-relaxed text-content transition-colors duration-fast placeholder:text-content-muted focus:border-accent";

export function PresetSettings() {
  const custom = useSettingsStore((s) => s.customAgentPresets);
  const savePreset = useSettingsStore((s) => s.saveCustomPreset);
  const removePreset = useSettingsStore((s) => s.removeCustomPreset);

  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="px-4 py-3">
      <SectionLabel>Your presets</SectionLabel>
      <HelperLine>
        Fill in the New Agent dialog and choose <em>Save as preset</em> to add one. Editing
        here changes the preset, never an agent already created from it.
      </HelperLine>

      {custom.length === 0 ? (
        <div className="mt-1 rounded border border-dashed border-border px-3 py-4 text-center text-sm text-content-muted">
          No presets of your own yet.
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          {custom.map((preset) => (
            <CustomPresetRow
              key={preset.id}
              preset={preset}
              open={openId === preset.id}
              onToggle={() => setOpenId(openId === preset.id ? null : preset.id)}
              onChange={savePreset}
              onDelete={() => {
                if (openId === preset.id) setOpenId(null);
                removePreset(preset.id);
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-border-subtle pt-3">
        <SectionLabel>Built in</SectionLabel>
        <HelperLine>
          Shipped with Cowtext and always available. Pick one in the New Agent dialog, change
          whatever you like, and save it as your own — the built-in is left alone.
        </HelperLine>
        <div className="space-y-2">
          {PRESET_GROUPS.map((group) => {
            const rows = AGENT_PRESETS.filter((p) => p.group === group.id);
            if (rows.length === 0) return null;
            return (
              <div key={group.id}>
                <div className="mb-0.5 text-2xs uppercase tracking-wide text-content-muted">
                  {group.label}
                </div>
                <div className="flex flex-wrap gap-1">
                  {rows.map((p) => (
                    <span
                      key={p.id}
                      title={p.whenToUse}
                      className="flex h-control-sm flex-none items-center rounded border border-border bg-surface-2 px-2 text-xs text-content-secondary"
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One custom preset: a collapsed summary row that expands into the three
 *  fields worth correcting after the fact — the name, the group it files
 *  under, and the two pieces of prose. Tools, mode and model are NOT edited
 *  here on purpose: those are decisions the New Agent dialog makes with a
 *  live capability picker and a provider→model list beside them, and a
 *  second, worse copy of that UI is how the two fall out of step. Re-saving
 *  over the preset from that dialog is the way to change them. */
function CustomPresetRow({
  preset,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  preset: AgentPreset;
  open: boolean;
  onToggle: () => void;
  onChange: (p: AgentPreset) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const toolSummary =
    preset.mode === "inherit"
      ? "inherits every tool"
      : `${preset.tools.length} tool${preset.tools.length === 1 ? "" : "s"}`;

  return (
    <div className="rounded border border-border bg-surface-2">
      <div className="flex h-row items-center gap-2 px-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
          ) : (
            <ChevronRight size={13} strokeWidth={1.5} className="flex-none text-content-muted" />
          )}
          <span className="min-w-0 truncate text-sm text-content">{preset.name}</span>
          <span className="flex-none text-2xs text-content-muted">{toolSummary}</span>
        </button>
        {confirming ? (
          <span className="flex flex-none items-center gap-1">
            <span className="text-2xs text-content-muted">Delete?</span>
            <button
              onClick={onDelete}
              className="flex h-control-sm flex-none items-center rounded border border-danger px-2 text-xs text-danger-text transition-colors duration-fast hover:bg-danger-surface"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="flex h-control-sm flex-none items-center rounded border border-border px-2 text-xs text-content-secondary transition-colors duration-fast hover:border-border-strong hover:text-content"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            title={`Delete ${preset.name}`}
            aria-label={`Delete ${preset.name}`}
            onClick={() => setConfirming(true)}
            className="grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-danger-surface hover:text-danger-text"
          >
            <Trash2 size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 border-t border-border-subtle px-2 py-2">
          <label className="block">
            <span className="mb-0.5 block text-2xs uppercase tracking-wide text-content-muted">
              Name
            </span>
            <input
              value={preset.name}
              onChange={(e) => onChange({ ...preset, name: e.target.value })}
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-2xs uppercase tracking-wide text-content-muted">
              Group
            </span>
            <select
              value={preset.group}
              onChange={(e) => onChange({ ...preset, group: e.target.value as PresetGroup })}
              className={FIELD}
            >
              {PRESET_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label} — {g.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-2xs uppercase tracking-wide text-content-muted">
              Use when
            </span>
            <textarea
              rows={2}
              value={preset.whenToUse}
              onChange={(e) => onChange({ ...preset, whenToUse: e.target.value })}
              className={AREA}
            />
            <span className="block pt-0.5 text-2xs leading-snug text-content-muted">
              Becomes the agent&rsquo;s <span className="font-mono">description:</span> — what
              Claude Code matches on when it picks an agent for a request.
            </span>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-2xs uppercase tracking-wide text-content-muted">
              Duties
            </span>
            <textarea
              rows={4}
              value={preset.description}
              onChange={(e) => onChange({ ...preset, description: e.target.value })}
              className={AREA}
            />
          </label>
        </div>
      )}
    </div>
  );
}
