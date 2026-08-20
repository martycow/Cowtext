// Model picker catalog (Task-Board Rev 2, R6) — company then version. Stored
// value is always the plain `model:` string Claude Code (or the relevant
// provider) accepts; the picker only helps CHOOSE that string, it never
// wraps or namespaces it. "Other" is a free-text escape hatch for anything
// not in the curated list.

export interface ModelCompany {
  company: string;
  models: string[];
}

export const MODEL_CATALOG: ModelCompany[] = [
  {
    company: "Anthropic",
    models: [
      "inherit",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-fable-5",
    ],
  },
  { company: "OpenAI", models: ["gpt-5", "gpt-5-mini", "o3"] },
  { company: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { company: "Other", models: [] },
];

/** WO11 D3 (fix, frozen §5.6): the bare aliases used to sit in
 *  `MODEL_CATALOG` as a second row per tier ("Opus" AND "Opus-5"). They stay
 *  valid on the wire — a hand-edited `model: opus` must still resolve to
 *  Anthropic and render as itself, never blank or "Other" — but they no
 *  longer appear as pickable rows. Module-private: `companyFor` consults it
 *  directly; `isAliasModel` is the narrow public door for a caller (the
 *  picker) that needs to know whether to render a value as a disabled
 *  legacy option instead of a real select choice. */
const ALIAS_MODELS = new Set(["opus", "sonnet", "haiku"]);

export function isAliasModel(value: string): boolean {
  return ALIAS_MODELS.has(value);
}

/** Short explanations rendered under the picker; absent key = no note. */
export const MODEL_NOTES: Record<string, string> = {
  inherit:
    "Runs on whatever model the parent session is using — this agent pins no model of its own.",
  opus: "Alias: the current Opus tier, whatever that resolves to today. A dated id pins a snapshot.",
  sonnet: "Alias: the current Sonnet tier. A dated id pins a snapshot.",
  haiku: "Alias: the current Haiku tier. A dated id pins a snapshot.",
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
export function shortModelLabel(model: string | null): string {
  const raw = (model ?? "").trim();
  if (raw === "") return "inherit";
  if (raw === "inherit" || raw === "opus" || raw === "sonnet" || raw === "haiku") return raw;

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

/** Infers which catalog company a stored model string belongs to — an
 *  unrecognized (or empty) value falls back to "Other" so the free-text
 *  input can carry it forward unmodified. */
export function companyFor(value: string | null): string {
  if (value === null || value.trim() === "") return MODEL_CATALOG[0].company;
  for (const c of MODEL_CATALOG) {
    if (c.models.includes(value)) return c.company;
  }
  // An alias no longer lives in the catalog's model list (D3), but it is
  // still an Anthropic id — falling through to "Other" here is exactly the
  // regression the fix exists to prevent.
  if (ALIAS_MODELS.has(value)) return MODEL_CATALOG[0].company;
  return "Other";
}
