// Model helpers for the agent modal/editor. Stored value is always the plain
// `model:` string Claude Code accepts; nothing here wraps or namespaces it.
//
// WO13 finding #9: this file used to also export a company/version catalog
// (`MODEL_CATALOG`/`ModelCompany`) plus `isAliasModel`/`companyFor`, built
// for the old company-then-version `ModelPicker` (WO11 R6). WO13 Block D
// replaced that picker with a fixed radio list (Inherit / Haiku / Sonnet /
// Opus / "Pin a specific model ID") that needs no per-provider grouping —
// multi-provider support is explicitly out of scope (agent spec D1) — so
// those four exports lost every caller (confirmed by a repo-wide grep) and
// were DELETED rather than left half-correct: they encoded a bare-alias set
// (`opus`/`sonnet`/`haiku`) that the D9 docs ruling extended with `fable`,
// and that addition was never applied before they went dead. Leaving a
// provably-unreachable "fixed" set around is how a future caller inherits a
// subtly wrong alias list without any test ever exercising it — deleting is
// the sound alternative to a half-correct fix. `shortModelLabel` below is
// the one LIVE place that still special-cases the bare aliases; the `fable`
// gap is closed there instead, where it's actually reachable.

import { PROVIDERS } from "../resources";
import type { ProviderId } from "./types";

/** Short explanations rendered under the picker; absent key = no note. */
export const MODEL_NOTES: Record<string, string> = {
  inherit:
    "Runs on whatever model the parent session is using — this agent pins no model of its own.",
  opus: "Alias: the current Opus tier, whatever that resolves to today. A dated id pins a snapshot.",
  sonnet: "Alias: the current Sonnet tier. A dated id pins a snapshot.",
  haiku: "Alias: the current Haiku tier. A dated id pins a snapshot.",
  fable: "Alias: the current Fable tier (WO13_CONTRACT.md §3.0, D9). A dated id pins a snapshot.",
};

/** Anthropic id prefixes stripped for display — longest first, so
 *  "us.anthropic." is matched before "anthropic.". Other vendors keep their
 *  name, because for them the vendor IS the recognizable part ("Gemini-2.5-pro"
 *  reads; "2.5-pro" does not). */
const ANTHROPIC_PREFIXES = ["us.anthropic.", "anthropic.", "claude-"];

/**
 * A model id squeezed down to something a 46px nameplate can hold
 * (WO10 item 14). Rendering the raw `model:` string meant a node showed
 * "claude-h…" — the vendor prefix is the same on every Anthropic model, so
 * truncation ate the only part that differed.
 *
 * The rules, in order: keep the aliases and `inherit` verbatim (they are
 * already short and their exact spelling is meaningful); otherwise drop a
 * trailing 8-digit date snapshot, drop the vendor prefix, turn the version's
 * dashes back into dots, and title-case the family.
 *
 *   claude-fable-5              → Fable-5
 *   claude-haiku-4-5-20251001   → Haiku-4.5
 *   gpt-5-mini                  → GPT-5-mini
 *   inherit                     → inherit
 *
 * Total: anything unrecognized comes back trimmed but otherwise untouched,
 * because a model this doesn't model is still a model the user typed.
 */
const BARE_ALIASES = new Set(["inherit", "opus", "sonnet", "haiku", "fable"]);

export function shortModelLabel(model: string | null): string {
  const raw = (model ?? "").trim();
  if (raw === "") return "inherit";
  if (BARE_ALIASES.has(raw)) return raw;

  // A dated snapshot suffix carries no information at this size.
  let s = raw.replace(/-\d{8}$/, "");

  if (s.toLowerCase().startsWith("gpt-")) return `GPT-${s.slice(4)}`;

  const prefix = ANTHROPIC_PREFIXES.find((p) => s.toLowerCase().startsWith(p));
  const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
  if (prefix === undefined) return capitalize(s);

  // "haiku-4-5" → "Haiku-4.5": the first segment is the family, the rest is
  // a dotted version. A bare family ("fable") is just capitalized.
  s = s.slice(prefix.length);
  const parts = s.split("-");
  if (parts.length === 1) return capitalize(parts[0]);
  return `${capitalize(parts[0])}-${parts.slice(1).join(".")}`;
}

/** Prefix heuristics, in `PROVIDER_IDS` order (WO15 §4.10). Consulted only
 *  when the id is not one `models.json` names — a user-typed "Custom model
 *  id…" still needs a provider so the picker can open on the right chip. */
const PROVIDER_PREFIXES: readonly { provider: ProviderId; prefixes: readonly string[] }[] = [
  { provider: "anthropic", prefixes: ["claude-", "opus", "sonnet", "haiku", "fable"] },
  { provider: "openai", prefixes: ["gpt-", "o1", "o3", "o4", "codex"] },
  { provider: "google", prefixes: ["gemini-"] },
];

/**
 * Which provider does this model id belong to?
 *
 * Exact match against `PROVIDERS` first — that is the only authoritative
 * answer — then the prefix table above. `null` for `inherit`, `""`, and
 * anything unrecognized: the caller (an agent with no `provider` in the
 * sidecar) falls back to `DEFAULT_PROVIDER` itself rather than this
 * function guessing "anthropic" for a string it has never seen.
 */
export function providerForModel(modelId: string | null): ProviderId | null {
  const raw = (modelId ?? "").trim();
  if (raw === "") return null;
  for (const provider of PROVIDERS) {
    if (provider.models.some((m) => m.id === raw)) return provider.id;
  }
  const lower = raw.toLowerCase();
  for (const entry of PROVIDER_PREFIXES) {
    if (entry.prefixes.some((p) => lower.startsWith(p))) return entry.provider;
  }
  return null;
}
