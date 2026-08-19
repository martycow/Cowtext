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
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "opus",
      "sonnet",
      "haiku",
    ],
  },
  { company: "OpenAI", models: ["gpt-5", "gpt-5-mini", "o3"] },
  { company: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { company: "Other", models: [] },
];

/** Short explanations rendered under the picker; absent key = no note. */
export const MODEL_NOTES: Record<string, string> = {
  inherit:
    "Runs on whatever model the parent session is using — this agent pins no model of its own.",
  opus: "Alias: the current Opus tier, whatever that resolves to today. A dated id pins a snapshot.",
  sonnet: "Alias: the current Sonnet tier. A dated id pins a snapshot.",
  haiku: "Alias: the current Haiku tier. A dated id pins a snapshot.",
};

/** Infers which catalog company a stored model string belongs to — an
 *  unrecognized (or empty) value falls back to "Other" so the free-text
 *  input can carry it forward unmodified. */
export function companyFor(value: string | null): string {
  if (value === null || value.trim() === "") return MODEL_CATALOG[0].company;
  for (const c of MODEL_CATALOG) {
    if (c.models.includes(value)) return c.company;
  }
  return "Other";
}
