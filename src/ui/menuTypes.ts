// Shared context-menu item shape — contract §7.9. One primitive, eight
// surfaces; each surface computes its own item list per open (that's what
// makes the menus "dynamic": disabled state, labels and presence of rows
// reflect current store state, not a static table).

import type { LucideIcon } from "lucide-react";

export type MenuItem =
  | {
      kind: "item";
      id: string;
      label: string;
      icon?: LucideIcon;
      /** Explains a disabled row — required whenever disabled is true. */
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator"; id: string };
