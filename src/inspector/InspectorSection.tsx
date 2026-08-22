// Inspector "components" (WO10 item 16).
//
// The properties pane was one flat column of twelve fields with nothing but
// vertical rhythm separating Title from Assemble from Delete. In a 392px
// panel that scrolls, that means hunting: everything looks equally
// important, and the one control you want is somewhere below the fold.
//
// The model here is Unity's inspector — a stack of named, collapsible
// components, each owning one concern, each remembering whether you left it
// open. It is deliberately NOT the whole Unity idea: there is no "add
// component" and no per-component remove, because Cowtext's sections aren't
// optional (a node always has metadata, always has a file, always has
// relations, even when they're empty). What is borrowed is the part that
// pays: a titled, iconed header you can scan, and a collapse that persists.
//
// State lives in AppSettings.collapsedSections as the list of COLLAPSED
// keys — a section added by a later release therefore starts open with no
// migration, and the panel doesn't reset itself on restart.

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useSettingsStore } from "../store/settings";

/** Collapse state for `defaultCollapsed` sections (WO15 D-18).
 *
 *  AppSettings.collapsedSections stores only the COLLAPSED exceptions, which
 *  is exactly the wrong shape for a section that starts closed: persisting
 *  "Advanced is open" would need a second, opposite-polarity list. D-18 rules
 *  that a start-closed section keeps SESSION-local state instead — so
 *  expanding Advanced sticks while you tour nodes (the panel remounts per
 *  selection, so component state alone would forget it on every click) and
 *  quietly resets on the next launch. Module scope, keyed by sectionKey. */
const sessionCollapsed = new Map<string, boolean>();

export function InspectorSection({
  sectionKey,
  title,
  icon: Icon,
  /** Right-aligned summary in the header — usually a count or a status word.
   *  Visible while COLLAPSED too, which is the point: a shut section should
   *  still say whether it holds anything. */
  hint,
  /** Override the body wrapper's classes (default `flex flex-col gap-3 p-3`).
   *  Escape hatch for a section that mounts a whole foreign component which
   *  already carries its own padding (WO11 D1 — AgentEditor) — avoids a
   *  visible double-padding seam without touching that component's file. */
  bodyClassName,
  /** Starts closed and keeps its collapse SESSION-local, never in
   *  AppSettings (WO15 D-18) — for a section whose contents are a footnote
   *  (Advanced: canvas position), not something you want back open on every
   *  node you click. */
  defaultCollapsed,
  children,
}: {
  sectionKey: string;
  title: string;
  icon: LucideIcon;
  hint?: string;
  bodyClassName?: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const persistedCollapsed = useSettingsStore((s) => s.collapsedSections.includes(sectionKey));
  const setSectionCollapsed = useSettingsStore((s) => s.setSectionCollapsed);
  const [sessionState, setSessionState] = useState(
    () => sessionCollapsed.get(sectionKey) ?? defaultCollapsed === true,
  );
  const session = defaultCollapsed === true;
  const collapsed = session ? sessionState : persistedCollapsed;
  const bodyId = useId();

  const toggle = () => {
    const next = !collapsed;
    if (session) {
      sessionCollapsed.set(sectionKey, next);
      setSessionState(next);
    } else {
      setSectionCollapsed(sectionKey, next);
    }
  };

  return (
    <section className="flex flex-col border-b border-border-subtle">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        // Same 26px header ramp the left rail's section headers use, so the
        // two panels read as one system.
        className="flex h-[26px] flex-none items-center gap-1.5 bg-surface-inset px-3 text-left transition-colors duration-fast hover:bg-[var(--surface-hover)]"
      >
        <span className="flex-none text-content-muted">
          {collapsed ? (
            <ChevronRight size={11} strokeWidth={2} />
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </span>
        <Icon size={11} strokeWidth={1.75} className="flex-none text-content-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs uppercase tracking-wider text-content-secondary">
          {title}
        </span>
        {hint !== undefined && hint !== "" && (
          <span className="flex-none font-mono text-micro text-content-disabled">{hint}</span>
        )}
      </button>
      {!collapsed && (
        <div id={bodyId} className={bodyClassName ?? "flex flex-col gap-3 p-3"}>
          {children}
        </div>
      )}
    </section>
  );
}
