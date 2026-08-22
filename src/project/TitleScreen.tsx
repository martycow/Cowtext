// The title screen — what Cowtext shows before a project is open.
//
// Three jobs, in the order a user needs them: say what this app is (brand
// lockup), get them into a project (recents + the three doors), and tell them
// which AI tools this machine actually has (the toolchain panel, scanned on
// demand). Extracted from App.tsx, which owned all of this inline.
//
// Two compositions, same parts. With recents, a two-column layout anchored top
// and bottom so the screen is never half-empty at any window height; on first
// run there is nothing to list, so it centres and the cow carries the screen —
// the one place DESIGN_SPEC.md's pixel-charm rules allow a large cow ("full-
// page empty states and onboarding: one cow illustration, large enough to be a
// decision, never a decoration").

import { lazy, Suspense, useEffect, useState } from "react";
import { FolderOpen, Info, RefreshCw, ScanLine, Sparkles, Workflow, X } from "lucide-react";
import { useProjectStore } from "../store/project";
import { useSettingsStore, type RecentProject } from "../store/settings";
import { useToolchainStore, type ToolchainPhase } from "../store/toolchain";
import { PROVIDER_SUPPORT_SENTENCE } from "../resources";
import { probeProjectDirs, revealPath } from "../fs/api";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import type { ProjectWizardMode } from "./ProjectWizard";
import type { AiTool } from "./toolchain";

const AiToolchainModal = lazy(() =>
  import("./AiToolchainModal").then((m) => ({ default: m.AiToolchainModal })),
);

// ── the cow ────────────────────────────────────────────────────────────

/** 16×14 pixel cow head in the Barnlight-29 palette (ART_DIRECTION.md).
 *  `K` outline, `H` horn, `M` milk, `p` patch, `d` patch-dark, `z` muzzle. */
const COW_ROWS = [
  "..KK........KK..",
  ".KHHK......KHHK.",
  ".KHHKKKKKKKKHHK.",
  ".KKMMMMMMMMMMKK.",
  "KKMMMppMMMMMMMKK",
  "KMMMMppMMMMMMMMK",
  "KMMddMMMMMMddMMK",
  "KMMddMMMMMMddMMK",
  "KMMMMMMMMMMMMMMK",
  ".KMMzzzzzzzzMMK.",
  ".KMzzdzzzzdzzMK.",
  ".KMzzzzzzzzzzMK.",
  "..KKzzzzzzzzKK..",
  "...KKKKKKKKKK...",
] as const;

const COW_INK: Record<string, string> = {
  K: "#241A12", // outline — the only outline colour
  H: "#E8A33D", // hay (= --amber)
  M: "#F4EFE7", // milk
  p: "#4A3728", // patch
  d: "#33251A", // patch-dark: eyes, nostrils
  z: "#E0A891", // muzzle
};

/** One `<path>` per colour rather than a rect per pixel: 184 elements is a lot
 *  of DOM for a logo, and six paths render identically. Computed once. */
const COW_PATHS: readonly { ink: string; d: string }[] = (() => {
  const acc = new Map<string, string>();
  COW_ROWS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const ink = COW_INK[ch];
      if (ink === undefined) return;
      acc.set(ink, (acc.get(ink) ?? "") + `M${x} ${y}h1v1h-1z`);
    });
  });
  return [...acc].map(([ink, d]) => ({ ink, d }));
})();

function PixelCow({ width }: { width: number }) {
  return (
    <svg
      width={width}
      height={Math.round((width / 16) * 14)}
      viewBox="0 0 16 14"
      shapeRendering="crispEdges"
      aria-hidden
      className="flex-none"
    >
      {COW_PATHS.map((p) => (
        <path key={p.ink} fill={p.ink} d={p.d} />
      ))}
    </svg>
  );
}

function BrandLockup({ centered }: { centered: boolean }) {
  return (
    <div className={`flex flex-col gap-5 ${centered ? "items-center" : ""}`}>
      <PixelCow width={centered ? 144 : 112} />
      <div className={`flex flex-col gap-3 ${centered ? "items-center" : ""}`}>
        <div className="flex items-baseline gap-3">
          <span className={`font-pixel tracking-wide ${centered ? "text-[34px]" : "text-[30px]"}`}>
            cowtext
          </span>
          {!centered && <span className="font-mono text-xs text-content-muted">v0.1.0</span>}
        </div>
        {/* WO15 Stage 1 — the tagline IS the provider-support sentence, in
            both compositions and verbatim (PROVIDER_SUPPORT_MATRIX.md §5).
            The two hand-written taglines this replaced each promised a
            little more than the product delivers ("every agent you actually
            run"); the first thing a user reads is the wrong place to be
            approximately honest. */}
        <p
          className={`max-w-[470px] text-pretty text-md leading-relaxed text-content-secondary ${
            centered ? "text-center" : "max-w-[330px]"
          }`}
        >
          {PROVIDER_SUPPORT_SENTENCE}
        </p>
      </div>
    </div>
  );
}

// ── the three doors ────────────────────────────────────────────────────

/** WO10 (INPUT_PROMPT 08/19 items 7-8) — three doors, not one. "Open folder"
 *  only helps with a project Cowtext already knows; the other two are the
 *  states a new user is actually in.
 *
 *  WO15 fix round, F10 — the primary door FOLLOWS THE COMPOSITION. Both
 *  signals are blue (blue is you; no amber is involved), but a filled accent
 *  door and a Recommended chip on a different door are two "do this first"
 *  marks on one screen, and on first run they contradict each other: "Open
 *  folder" has nothing to open. So with recents, "Open folder" is the door
 *  most likely to be taken and keeps the filled accent while "New project"
 *  wears the chip one weight below it; without recents "New project" is the
 *  primary and drops the chip — the filled accent IS the recommendation, and
 *  a chip on the primary would say the same thing twice. */
function StartDoors({
  onWizard,
  layout,
}: {
  onWizard: (mode: ProjectWizardMode) => void;
  layout: "stack" | "row";
}) {
  const { openProject } = useProjectStore();
  const stack = layout === "stack";
  // The two compositions are one branch in TitleScreen: `row` IS the first
  // run (no recents), `stack` IS the two-column screen that has them — so
  // layout already carries the fact the hierarchy depends on, and no second
  // prop can drift out of step with it.
  const hasRecents = stack;
  // WO15 Stage 4 — every hint now names what lands on disk, in the user's
  // words: "Creates .cowtext/, context/ and starter nodes" beats "scaffold a
  // fresh graph", which assumes you already know what a graph is. The stack
  // variants are the short ones (62px rows in the two-column composition);
  // the row variants carry the full sentence because a 244px card has space
  // for it and first-run is exactly when the sentence is needed.
  const doors = [
    {
      key: "open",
      primary: hasRecents,
      recommended: false,
      icon: FolderOpen,
      label: "Open folder",
      hint: stack
        ? "A folder Cowtext already knows"
        : "Opens a folder Cowtext already knows and scans its markdown",
      onClick: () => void openProject(),
      title: undefined as string | undefined,
    },
    {
      key: "new",
      primary: !hasRecents,
      // The one door a first-run user should take. With recents it says so
      // with the accent-surface chip — one weight below the filled primary,
      // so the two blues read as hierarchy rather than as two primaries.
      // Without them it IS the filled primary, and the chip would be a
      // second mark on the same control.
      recommended: hasRecents,
      icon: Sparkles,
      label: "New project",
      hint: stack
        ? "Creates .cowtext/, context/ and starter nodes"
        : "Creates .cowtext/, context/ and starter nodes — recommended for a fresh start",
      onClick: () => onWizard("new"),
      title: undefined,
    },
    {
      key: "convert",
      primary: false,
      recommended: false,
      icon: Workflow,
      label: "Convert existing",
      hint: stack
        ? "Turns CLAUDE.md, AGENTS.md or .cursor/rules into nodes"
        : "Turns the CLAUDE.md, AGENTS.md or .cursor/rules you already have into nodes — preview first",
      onClick: () => onWizard("convert"),
      title:
        "Scaffolds Cowtext's files alongside an existing project, then imports its context. Nothing is written until you approve.",
    },
  ];

  return (
    <div className={stack ? "flex flex-col gap-2" : "flex items-stretch gap-3"}>
      {doors.map((d) => (
        <button
          key={d.key}
          onClick={d.onClick}
          title={d.title}
          className={`flex text-left transition-colors duration-fast ${
            stack ? "h-[62px] items-center gap-3 px-4" : "w-[244px] flex-col gap-2.5 p-4"
          } rounded ${
            d.primary
              ? "border border-accent-border bg-accent-surface hover:border-accent hover:bg-[rgba(76,155,232,.20)]"
              : "border border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3"
          }`}
        >
          <span
            className={`grid h-control-lg w-control-lg flex-none place-items-center rounded ${
              d.primary ? "bg-accent text-content-inverse" : "bg-surface-3 text-content-secondary"
            }`}
          >
            <d.icon size={16} strokeWidth={d.primary ? 1.8 : 1.6} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className={`text-md ${d.primary ? "font-semibold" : "font-medium"}`}>
                {d.label}
              </span>
              {d.recommended && (
                <span className="flex-none rounded-sm border border-accent-border bg-accent-surface px-1.5 py-px text-2xs text-accent-text">
                  Recommended
                </span>
              )}
            </span>
            <span className="text-xs leading-normal text-content-secondary">{d.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ── recent projects ────────────────────────────────────────────────────

/** Relative last-opened, coarse — "today", "3 days ago", falling back to a
 *  date once it's old enough that a relative phrase stops being useful. */
function relativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const day = 86_400_000;
  if (diffMs < day) return "today";
  const days = Math.floor(diffMs / day);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  // Day-month-year, month spelled — a numeric locale date next to "3 days
  // ago" reads as ambiguous (03/07 is two different days on two machines).
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function RecentProjectRow({ project, missing }: { project: RecentProject; missing: boolean }) {
  const openProjectAt = useProjectStore((s) => s.openProjectAt);
  const removeRecentProject = useSettingsStore((s) => s.removeRecentProject);
  const contextMenu = useContextMenu();
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op."
  const [revealError, setRevealError] = useState<string | null>(null);

  const open = () => {
    if (missing) return;
    void openProjectAt(project.root);
  };

  const openMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = [
      { kind: "item", id: "open", label: "Open", icon: FolderOpen, disabled: missing, hint: missing ? "folder not found" : undefined, onSelect: open },
      {
        kind: "item",
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: FolderOpen,
        disabled: missing,
        hint: missing ? "folder not found" : undefined,
        onSelect: () => {
          setRevealError(null);
          void revealPath(project.root, null).catch((err: unknown) => setRevealError(String(err)));
        },
      },
      { kind: "separator", id: "sep-1" },
      {
        kind: "item",
        id: "remove",
        label: "Remove from list",
        icon: X,
        danger: true,
        onSelect: () => removeRecentProject(project.root),
      },
    ];
    contextMenu.openAt(e, items);
  };

  return (
    <li onContextMenu={openMenu} className="group flex flex-none flex-col">
      <div
        onClick={open}
        className={`flex h-[44px] items-center gap-2.5 border-b border-border-subtle px-3 ${
          missing ? "cursor-default opacity-60" : "cursor-pointer hover:bg-[var(--surface-hover)]"
        }`}
      >
        <FolderOpen size={14} strokeWidth={1.5} className="flex-none text-content-muted" />
        <span className="flex-none text-base font-medium text-content">{project.name}</span>
        <span
          dir="rtl"
          title={project.root}
          // `unicode-bidi: plaintext` keeps the `:` and `\` of a Windows path
          // from being resolved against the RTL paragraph direction (which
          // can jump a trailing separator to the front); `text-align: left`
          // keeps the path beside the name rather than against the timestamp.
          style={{ unicodeBidi: "plaintext", textAlign: "left" }}
          className="hidden max-w-[240px] flex-none truncate font-mono text-xs text-content-muted md:block"
        >
          {project.root}
        </span>
        <span className="flex-1" />
        {missing && (
          <span className="flex-none rounded-sm bg-danger-surface px-1.5 py-px font-mono text-xs text-danger-text">
            missing
          </span>
        )}
        <span className="w-[92px] flex-none text-right font-mono text-xs text-content-muted">
          {relativeTime(project.lastOpenedMs)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeRecentProject(project.root);
          }}
          title="Remove from list"
          className="hidden h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content group-hover:grid"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      {revealError !== null && (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-danger-surface px-3 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-danger-text">
            {revealError}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevealError(null);
            }}
            title="Dismiss"
            className="grid h-3.5 w-3.5 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
          >
            <X size={10} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {contextMenu.menu !== null && (
        <ContextMenu
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          items={contextMenu.menu.items}
          onClose={contextMenu.close}
        />
      )}
    </li>
  );
}

/** Up to 8 rows, newest first (contract §7.7). */
function RecentProjects({ projects }: { projects: RecentProject[] }) {
  const [missing, setMissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (projects.length === 0) return;
    let live = true;
    void probeProjectDirs(projects.map((p) => p.root)).then((exists) => {
      if (!live) return;
      const next = new Set<string>();
      projects.forEach((p, i) => {
        if (exists[i] === false) next.add(p.root);
      });
      setMissing(next);
    });
    return () => {
      live = false;
    };
    // Re-probe only when the list identity (roots) changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.root).join("|")]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="font-mono text-xs uppercase tracking-wider text-content-muted">
          Recent projects
        </span>
        {/* "3 of 8 kept" — the old "3 of 8" read as a page counter. The list
            is a fixed-size ring: the ninth project opened drops the oldest. */}
        <span className="font-mono text-xs text-content-muted">{projects.length} of 8 kept</span>
      </div>
      <ul className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-border-subtle bg-surface-1">
        {projects.map((p) => (
          <RecentProjectRow key={p.root} project={p} missing={missing.has(p.root)} />
        ))}
      </ul>
    </div>
  );
}

// ── AI toolchain ───────────────────────────────────────────────────────

/** 4-step amber pixel march — never a spinner (DESIGN_SPEC.md). */
function ScanMarch() {
  return (
    <span className="flex flex-none gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-blink bg-amber"
          style={{ animationDelay: `${i * 200}ms`, animationTimingFunction: "steps(2)" }}
        />
      ))}
      <span className="h-1.5 w-1.5 bg-border-strong" />
    </span>
  );
}

/** WO15 Block 5a — the scan now lives in `store/toolchain.ts` and runs on
 *  mount instead of on a click. Two things changed the "don't spawn five
 *  child processes unasked" judgement this screen was written with: the
 *  probes are time-boxed at 3 s each in Rust (§3.5), and the answer is what
 *  the screen is FOR — a panel that says "not checked yet" until you press a
 *  button is a chore, not information. The store also means the agent
 *  modal's provider chips read the same answer instead of scanning again. */
function ScanButton({ phase, onScan }: { phase: ToolchainPhase; onScan: () => void }) {
  // `Check installs` survives only for the pre-scan instant (and for a
  // machine where the effect never ran); once there are rows on screen the
  // honest verb is Rescan — including after a failure, where re-trying is
  // exactly what the button is for.
  const label =
    phase === "idle" ? "Check installs" : phase === "scanning" ? "Scanning…" : "Rescan";
  return (
    <button
      onClick={onScan}
      disabled={phase === "scanning"}
      title="Look for installed AI CLIs on this machine"
      className="flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-muted"
    >
      {phase === "idle" ? (
        <ScanLine size={13} strokeWidth={1.6} />
      ) : (
        <RefreshCw size={13} strokeWidth={1.6} />
      )}
      {label}
    </button>
  );
}

function toolDot(tool: AiTool): string {
  return tool.found ? "bg-success" : "bg-content-disabled";
}

/** Status cell for one row: the amber march while the probe is in flight,
 *  then a tick and the version or a cross and "not found". Text glyphs, not
 *  icons — the column is monospace and 5 rows tall, and ✓/✗ line up in it. */
function ToolStatus({ tool, phase, scanned }: { tool: AiTool; phase: ToolchainPhase; scanned: boolean }) {
  if (phase === "scanning") return <ScanMarch />;
  if (!scanned) return <span className="font-mono text-xs text-content-muted">—</span>;
  return (
    <span
      className={`font-mono text-xs ${tool.found ? "text-success-text" : "text-content-muted"}`}
    >
      {tool.found ? `✓ ${tool.version ?? "installed"}` : "✗ not found"}
    </span>
  );
}

/** The full panel — the two-column composition's bottom-right card. */
function ToolchainPanel({ onDetails }: { onDetails: () => void }) {
  const phase = useToolchainStore((s) => s.phase);
  const tools = useToolchainStore((s) => s.tools);
  const error = useToolchainStore((s) => s.error);
  const scan = useToolchainStore((s) => s.scan);
  // A failed RESCAN keeps the previous answers in the store, so "have we ever
  // had real rows?" is the question that decides ✓/✗ vs "—", not `phase`.
  const scanned = tools.length > 0;
  const foundCount = tools.filter((t) => t.found).length;
  const summary =
    phase === "scanning"
      ? ""
      : scanned
        ? `${foundCount} of ${tools.length} found`
        : phase === "failed"
          ? "scan failed"
          : "not checked yet";

  return (
    <div className="flex-none overflow-hidden rounded-lg border border-border-subtle bg-surface-1">
      <div className="flex h-topbar items-center justify-between gap-3 border-b border-border-subtle pl-3.5 pr-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-base font-semibold">AI toolchain on this machine</span>
          <span
            className={`font-mono text-xs ${
              phase === "failed" ? "text-danger-text" : "text-content-muted"
            }`}
          >
            {summary}
          </span>
        </div>
        <div className="flex flex-none items-center gap-2">
          {phase === "scanning" && (
            <span className="flex items-center gap-2">
              <ScanMarch />
              <span className="font-pixel text-micro tracking-wide text-amber-text">scanning</span>
            </span>
          )}
          {scanned && (
            <button
              onClick={onDetails}
              className="h-control flex-none rounded border border-border bg-surface-2 px-2.5 text-sm text-content-secondary transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 hover:text-content"
            >
              Details
            </button>
          )}
          <ScanButton phase={phase} onScan={() => void scan()} />
        </div>
      </div>

      {/* The error is a strip above the rows, not instead of them: a failed
          rescan must not blank out answers the user already had. */}
      {phase === "failed" && error !== null && (
        <div className="border-b border-border-subtle bg-danger-surface px-3.5 py-2 font-mono text-xs text-danger-text">
          {error}
        </div>
      )}
      <div>
        {(scanned ? tools : PLACEHOLDER_ROWS).map((t) => (
          <div
            key={t.id}
            className="flex h-[36px] items-center gap-2.5 border-b border-border-subtle px-3.5"
          >
            <span
              className={`h-[7px] w-[7px] flex-none rounded-pill ${
                phase === "scanning" ? "bg-amber" : scanned ? toolDot(t) : "bg-content-disabled"
              }`}
            />
            <span
              className={`w-[150px] flex-none text-base ${
                scanned && !t.found ? "text-content-muted" : "text-content"
              }`}
            >
              {t.name}
            </span>
            <span className="w-[100px] flex-none font-mono text-xs text-content-muted">
              {t.cmd}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-muted">
              {t.emits}
            </span>
            <span className="flex flex-none justify-end">
              <ToolStatus tool={t} phase={phase} scanned={scanned} />
            </span>
          </div>
        ))}
      </div>

      <div className="flex h-[34px] items-center gap-2 px-3.5 text-content-muted">
        <Info size={12} strokeWidth={1.6} className="flex-none" />
        <span className="text-xs">
          {scanned
            ? "Ticking a tool in Details makes it a compile target for new projects."
            : "Cowtext compiles one graph out to each of these."}
        </span>
      </div>
    </div>
  );
}

/** Rows shown before a scan has run. The panel is a fixed list of targets
 *  whose STATUS changes — not a list that appears once you scan — so the
 *  unscanned state must still show every row. Mirrors `PROBES` in
 *  `src-tauri/src/toolchain.rs`; the scan replaces these wholesale. */
const PLACEHOLDER_ROWS: AiTool[] = [
  { id: "claude", name: "Claude Code", cmd: "claude", emits: "CLAUDE.md", found: false, version: null, path: null, elapsedMs: 0 },
  { id: "agents", name: "Codex CLI", cmd: "codex", emits: "AGENTS.md", found: false, version: null, path: null, elapsedMs: 0 },
  { id: "cursor", name: "Cursor", cmd: "cursor", emits: ".cursor/rules/*.mdc", found: false, version: null, path: null, elapsedMs: 0 },
  { id: "copilot", name: "GitHub Copilot", cmd: "gh copilot", emits: ".github/copilot-instructions.md", found: false, version: null, path: null, elapsedMs: 0 },
  { id: "gemini", name: "Gemini CLI", cmd: "gemini", emits: "GEMINI.md", found: false, version: null, path: null, elapsedMs: 0 },
];

/** The compact strip — first run, where there is no column to fill. */
function ToolchainStrip() {
  const phase = useToolchainStore((s) => s.phase);
  const tools = useToolchainStore((s) => s.tools);
  const scan = useToolchainStore((s) => s.scan);
  const scanned = tools.length > 0;
  const rows = scanned ? tools : PLACEHOLDER_ROWS;
  const foundCount = tools.filter((t) => t.found).length;
  return (
    <div className="flex h-topbar items-center gap-3.5 rounded-lg border border-border-subtle bg-surface-1 py-0 pl-4 pr-2">
      <span className="flex-none text-sm text-content-secondary">
        {scanned
          ? `${foundCount} of ${tools.length} on this machine:`
          : phase === "failed"
            ? "Could not scan this machine"
            : "Which AI tools do you run?"}
      </span>
      <span className="flex items-center gap-2">
        {rows.map((t) => (
          <span
            key={t.id}
            // Found: the resolved binary path. Not found (or not yet asked):
            // the file that target compiles to, which is the reason the row
            // is on screen at all.
            title={
              scanned && t.found
                ? `${t.path ?? t.cmd}${t.version !== null ? ` — ${t.version}` : ""}`
                : t.emits
            }
            className={`flex h-control-sm flex-none items-center gap-1.5 rounded-sm border px-2 ${
              scanned && t.found
                ? "border-[rgba(79,180,119,.35)] bg-success-surface"
                : "border-border bg-surface-2"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-pill ${
                phase === "scanning" ? "bg-amber" : scanned ? toolDot(t) : "bg-content-disabled"
              }`}
            />
            <span
              className={`font-mono text-xs ${
                scanned && !t.found ? "text-content-muted" : "text-content-secondary"
              }`}
            >
              {t.name}
            </span>
          </span>
        ))}
      </span>
      {phase === "scanning" && <ScanMarch />}
      <ScanButton phase={phase} onScan={() => void scan()} />
    </div>
  );
}

// ── the screen ─────────────────────────────────────────────────────────

export function TitleScreen({ onWizard }: { onWizard: (mode: ProjectWizardMode) => void }) {
  const recentProjects = useSettingsStore((s) => s.recentProjects);
  const phase = useToolchainStore((s) => s.phase);
  const toolCount = useToolchainStore((s) => s.tools.length);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Block 5a — scan on arrival, once. The store's own in-flight guard makes
  // this StrictMode-safe, and the `idle` test means neither a remount (the
  // title screen unmounts on open and remounts on Home) nor the second
  // composition re-probes: the answer is already in the store.
  useEffect(() => {
    if (phase === "idle") void useToolchainStore.getState().scan();
  }, [phase]);

  const details =
    detailsOpen && toolCount > 0 ? (
      <Suspense fallback={null}>
        <AiToolchainModal onClose={() => setDetailsOpen(false)} />
      </Suspense>
    ) : null;

  // First run: nothing to list, so the cow gets the screen.
  if (recentProjects.length === 0) {
    return (
      <div className="ct-zoom flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-10">
        <BrandLockup centered />
        <StartDoors onWizard={onWizard} layout="row" />
        <ToolchainStrip />
        {details}
      </div>
    );
  }

  return (
    <div className="ct-zoom grid min-h-0 flex-1 grid-cols-[456px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col justify-between overflow-y-auto border-r border-border-subtle px-10 pb-10 pt-11">
        <BrandLockup centered={false} />
        <div className="mt-8 flex flex-col gap-2.5">
          <div className="pl-0.5 font-mono text-xs uppercase tracking-wider text-content-muted">
            Start
          </div>
          <StartDoors onWizard={onWizard} layout="stack" />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-6 py-10 pl-9 pr-10">
        <RecentProjects projects={recentProjects} />
        <div className="flex-1" />
        <ToolchainPanel onDetails={() => setDetailsOpen(true)} />
      </div>

      {details}
    </div>
  );
}
