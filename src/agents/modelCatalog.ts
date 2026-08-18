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
  { company: "Anthropic", models: ["inherit", "opus", "sonnet", "haiku"] },
  { company: "OpenAI", models: ["gpt-5", "gpt-5-mini", "o3"] },
  { company: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { company: "Other", models: [] },
];

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
