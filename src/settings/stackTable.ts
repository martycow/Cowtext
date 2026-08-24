// The stack picker's table, bundled rows plus the user's own (WO16 Block C).
//
// This lives here rather than in `src/resources/` on purpose: that directory
// is DATA ONLY — identical for every install, no store imports — and the
// custom rows are neither. One module that knows about both is the seam;
// `resources/stacks.json` stays the closed table it has always been, and the
// New Project wizard and the Settings pane render from the same merge rather
// than each doing their own.

import { STACK_CATEGORIES, type StackCategory, type StackItem } from "../resources";
import {
  CUSTOM_STACK_CATEGORY_ID,
  CUSTOM_STACK_PREFIX,
  MAX_STACK_LABEL,
  type CustomStackItem,
} from "../store/settings";

/** A picker row. `custom` is what earns it a delete control in Settings and
 *  an icon; bundled rows are not editable from the UI. */
export interface StackRow extends StackItem {
  custom: boolean;
  /** Custom rows only — see `CustomStackItem.iconFile`. */
  iconFile?: string | null;
}

export interface StackGroup {
  id: string;
  label: string;
  rows: StackRow[];
}

/** Heading for custom items that name no bundled category. */
export const CUSTOM_STACK_CATEGORY_LABEL = "Custom";

/** Bundled categories in their declared order, each with its own rows plus
 *  any custom rows that named it, followed by a trailing "Custom" group for
 *  the leftovers. A custom row always sorts AFTER the bundled rows of the
 *  category it joins, so adding one never moves a row the user has learned
 *  the position of.
 *
 *  The trailing group is omitted when empty, which is the common case — it
 *  should not appear until the user has actually put something in it. */
export function stackGroups(custom: readonly CustomStackItem[]): StackGroup[] {
  const groups: StackGroup[] = STACK_CATEGORIES.map((category: StackCategory) => ({
    id: category.id,
    label: category.label,
    rows: [
      ...category.items.map((item) => ({ ...item, custom: false })),
      ...custom
        .filter((c) => c.categoryId === category.id)
        .map((c) => ({ id: c.id, label: c.label, custom: true, iconFile: c.iconFile })),
    ],
  }));

  const known = new Set(STACK_CATEGORIES.map((c) => c.id));
  const orphans = custom.filter((c) => !known.has(c.categoryId));
  if (orphans.length > 0) {
    groups.push({
      id: CUSTOM_STACK_CATEGORY_ID,
      label: CUSTOM_STACK_CATEGORY_LABEL,
      rows: orphans.map((c) => ({
        id: c.id,
        label: c.label,
        custom: true,
        iconFile: c.iconFile,
      })),
    });
  }
  return groups;
}

/** Every row id that currently exists, bundled or custom. The wizard filters
 *  `defaultStackItemIds` through this so a default naming a row the user has
 *  since deleted is dropped at the point of use rather than rewritten out of
 *  settings.json behind their back. */
export function knownStackIds(custom: readonly CustomStackItem[]): Set<string> {
  const out = new Set<string>();
  for (const category of STACK_CATEGORIES) for (const item of category.items) out.add(item.id);
  for (const c of custom) out.add(c.id);
  return out;
}

/** Resolve any row id to its label, for the wizard's generated `stack.md`.
 *  `null` when the id names nothing — the caller drops it. */
export function stackLabel(id: string, custom: readonly CustomStackItem[]): string | null {
  for (const category of STACK_CATEGORIES) {
    const hit = category.items.find((i) => i.id === id);
    if (hit !== undefined) return hit.label;
  }
  return custom.find((c) => c.id === id)?.label ?? null;
}

/** Slugify a typed label into the id half of `custom:<slug>`. Lowercase,
 *  ASCII word characters and single dashes only — the id ends up in
 *  `settings.json` and, via the wizard, in a generated markdown file, so it
 *  stays boring on purpose. */
export function stackSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_STACK_LABEL);
}

/** Why this label cannot be added, or `null` when it can. Checks the whole
 *  merged table, not just the custom half: a custom row duplicating a
 *  bundled one would give the picker two boxes meaning the same thing. */
export function stackAddProblem(
  label: string,
  custom: readonly CustomStackItem[],
): string | null {
  const trimmed = label.trim();
  if (trimmed === "") return "Give the item a name.";
  if (trimmed.length > MAX_STACK_LABEL) return `Keep it under ${MAX_STACK_LABEL} characters.`;
  const slug = stackSlug(trimmed);
  if (slug === "") return "Use at least one letter or digit.";
  if (knownStackIds(custom).has(`${CUSTOM_STACK_PREFIX}${slug}`)) {
    return "You already added that one.";
  }
  const clash = STACK_CATEGORIES.flatMap((c) => c.items).find(
    (i) => i.label.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash !== undefined) return `${clash.label} is already in the list.`;
  return null;
}

/** The id a freshly typed label becomes. */
export function stackIdFor(label: string): string {
  return `${CUSTOM_STACK_PREFIX}${stackSlug(label)}`;
}
