// Hook half of the shared context-menu primitive (contract §7.9). Owns only
// open/close state and focus bookkeeping; all interaction behaviour (viewport
// flip, keyboard nav, outside-close) lives in ContextMenu.tsx.

import { useCallback, useRef, useState } from "react";
import type { MenuItem } from "./menuTypes";

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function useContextMenu(): {
  menu: MenuState | null;
  openAt: (e: React.MouseEvent, items: MenuItem[]) => void;
  close: () => void;
} {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The element that was right-clicked — focus returns here on close.
  const invokerRef = useRef<HTMLElement | null>(null);

  const openAt = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    invokerRef.current = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const close = useCallback(() => {
    setMenu(null);
    const el = invokerRef.current;
    invokerRef.current = null;
    // Defer past the click/keydown that triggered close so the returning
    // focus isn't immediately stolen by the same event's default action.
    if (el !== null) {
      requestAnimationFrame(() => el.focus());
    }
  }, []);

  return { menu, openAt, close };
}
