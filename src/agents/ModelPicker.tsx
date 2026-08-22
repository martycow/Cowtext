// Provider → model, in two steps (WO15 Block 3a). Lifted out of
// `AgentEditor.tsx:190-290`, where it was a five-radio list of Anthropic
// aliases: that picker said "multi-provider is out of scope" out loud, and
// WO15's answer is the opposite — Cowtext compiles context for several
// agents, so the model field has to name which one it is talking about.
//
// What is honest here and what is not:
//   • provider is ALWAYS local (sidecar `provider`, `.cowtext/agents.json`);
//   • `model:` reaches the agent file only for Anthropic — Claude Code is
//     the one agent format with that key (PROVIDER_SUPPORT_MATRIX.md) — so
//     for every other provider the choice is kept in the sidecar beside the
//     provider (A-20) and the field carries `LocalOnlyBadge` naming that
//     file, rather than pretending the choice lands in a compiled one
//     (§7.5). Both call sites persist it; the picker itself does not;
//   • a chip dims when the matching CLI is not on this machine, and stays
//     clickable: not having `codex` installed is not a reason Cowtext gets
//     to refuse to describe an OpenAI agent.
//
// The picker owns no persistence and no defaults beyond "picking a provider
// selects that provider's flagship" — both call sites decide what to write.

import { useState } from "react";
import {
  PROVIDERS,
  PROVIDER_COMPILE_TARGET,
  defaultModelFor,
  providerById,
  type ModelTier,
} from "../resources";
import { PROVIDER_ICONS } from "../icons/providers";
import { isToolFound, useToolchainStore } from "../store/toolchain";
import { LocalOnlyBadge } from "../ui/LocalOnlyBadge";
import { MODEL_NOTES } from "./modelCatalog";
import type { ProviderId } from "./types";

export interface ModelSelection {
  provider: ProviderId;
  model: string | null;
}

/** Frozen copy (§6 U3.1) — one string for both "found: false" and "never
 *  scanned", because the chip behaves identically either way. */
const NOT_FOUND_TITLE = "Not found on this machine — still selectable";

const TIER_ROWS: readonly { tier: ModelTier; label: string }[] = [
  { tier: "flagship", label: "Flagship" },
  { tier: "balanced", label: "Balanced" },
  { tier: "fast", label: "Fast" },
];

/** Sentinel `<option>` values — no real model id starts with `__`
 *  (`resources.test.ts` pins ids to /^[a-z0-9][a-z0-9.\-]*$/). */
const INHERIT_VALUE = "__inherit";
const CUSTOM_VALUE = "__custom";

function isListedModel(provider: ProviderId, model: string | null): boolean {
  if (model === null || model.trim() === "") return false;
  return providerById(provider)?.models.some((m) => m.id === model) === true;
}

export function ModelPicker({
  provider,
  model,
  disabled,
  onChange,
}: {
  provider: ProviderId;
  model: string | null;
  disabled: boolean;
  onChange: (v: ModelSelection) => void;
}) {
  const tools = useToolchainStore((s) => s.tools);
  const active = providerById(provider);

  // "Custom model id…" is sticky while its box is empty — otherwise picking
  // it would immediately snap the select back to Inherit (empty ⇒ model
  // null) before a single character was typed.
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(() =>
    !isListedModel(provider, model) && model !== null ? model : "",
  );

  const pinnedCustom = model !== null && model.trim() !== "" && !isListedModel(provider, model);
  const showCustom = customOpen || pinnedCustom;
  const selectValue = showCustom
    ? CUSTOM_VALUE
    : model === null || model.trim() === ""
      ? INHERIT_VALUE
      : model;

  const pickProvider = (id: ProviderId) => {
    if (id === provider) return;
    setCustomOpen(false);
    setCustomDraft("");
    onChange({ provider: id, model: defaultModelFor(id) });
  };

  const pickModel = (value: string) => {
    if (value === INHERIT_VALUE) {
      setCustomOpen(false);
      onChange({ provider, model: null });
      return;
    }
    if (value === CUSTOM_VALUE) {
      setCustomOpen(true);
      onChange({ provider, model: customDraft.trim() === "" ? null : customDraft.trim() });
      return;
    }
    setCustomOpen(false);
    onChange({ provider, model: value });
  };

  const note = MODEL_NOTES[model ?? "inherit"];
  const groups = TIER_ROWS.map((row) => ({
    ...row,
    models: (active?.models ?? []).filter((m) => m.tier === row.tier),
  })).filter((g) => g.models.length > 0);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Step 1 — provider */}
      <div role="radiogroup" aria-label="Provider" className="flex flex-wrap items-center gap-1.5">
        {PROVIDERS.map((p) => {
          const Icon = PROVIDER_ICONS[p.icon];
          const on = p.id === provider;
          // `null` = the toolchain was never scanned; treated as "not found"
          // for the dimming, exactly as §6 U3.1 asks.
          const found = isToolFound(tools, PROVIDER_COMPILE_TARGET[p.id]) === true;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => pickProvider(p.id)}
              title={found ? `${p.cli} found on this machine` : NOT_FOUND_TITLE}
              className={`flex h-control-sm flex-none items-center gap-1.5 rounded border px-2 text-xs transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-60 ${
                on
                  ? "border-accent-border bg-accent-surface text-accent-text"
                  : "border-border bg-surface-2 text-content-secondary hover:border-border-strong hover:text-content"
              } ${found ? "" : "opacity-55"}`}
            >
              <Icon size={13} />
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Non-Anthropic: the choice is real, the file it lands in is not. */}
      {provider !== "anthropic" && (
        <div className="flex items-center gap-1.5">
          <LocalOnlyBadge
            hint={`Model for ${active?.name ?? provider} is stored in .cowtext/agents.json until its agent format supports it`}
          />
          <span className="min-w-0 flex-1 text-2xs leading-snug text-content-muted">
            {`No model: key is written — ${active?.name ?? provider} agent files have no field for it yet.`}
          </span>
        </div>
      )}

      {/* Step 2 — model */}
      <select
        aria-label="Model"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => pickModel(e.target.value)}
        className="h-control w-full rounded border border-border bg-surface-2 px-2 text-sm text-content focus:border-accent disabled:text-content-disabled"
      >
        <option value={INHERIT_VALUE}>Inherit from the session</option>
        {groups.map((g) => (
          <optgroup key={g.tier} label={g.label}>
            {g.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM_VALUE}>Custom model id…</option>
      </select>

      {showCustom && (
        <input
          value={customDraft}
          disabled={disabled}
          onChange={(e) => {
            setCustomDraft(e.target.value);
            onChange({ provider, model: e.target.value.trim() === "" ? null : e.target.value.trim() });
          }}
          aria-label="Custom model id"
          placeholder="claude-opus-4-8, gpt-5.1, gemini-2.5-pro…"
          className="h-control-sm w-full rounded border border-border bg-surface-2 px-2 font-mono text-2xs text-content placeholder:text-content-disabled focus:border-accent disabled:text-content-disabled"
        />
      )}
      {showCustom && customDraft.trim() === "" && (
        <p className="text-2xs leading-snug text-content-muted">
          Type a model id — an empty box means the agent inherits the session's model.
        </p>
      )}
      {note !== undefined && <p className="text-2xs leading-snug text-content-muted">{note}</p>}
    </div>
  );
}
