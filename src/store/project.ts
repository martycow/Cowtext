import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { hooksStatus } from "../fs/api";
import { flushSettings, useSettingsStore } from "./settings";
import { GRAPH_VERSION, migrateGraph, useGraphStore } from "./graph";
import { useFocusStore } from "../canvas/types";
import { flushAgentSave, flushMetaSave, useAgentsStore } from "./agents";
import { useTasksStore } from "./tasks";
import { useEventsStore } from "./events";
import { useReviewStore } from "./review";
import { useProjectSelectionStore } from "./projectSelection";

export interface MdFile {
  relPath: string;
  sizeBytes: number;
  modifiedMs: number | null;
}

interface ProjectScan {
  root: string;
  files: MdFile[];
}

/** Wire shape for the `fs://change` event (watcher.rs, WO01 Block A §4.1;
 *  `selfWrite` added Block C §T4 — true when Cowtext itself wrote this path
 *  within the self-write TTL, see `note_self_write`/`take_self_write`). */
export interface FsChange {
  relPath: string;
  modifiedMs: number | null;
  sizeBytes: number | null;
  kind: "modify" | "create" | "remove";
  selfWrite: boolean;
}

/** WO13 N-F/E-F — computed once per project open by diffing the raw
 *  on-disk graph against {@link migrateGraph}'s own output for that same
 *  input. This is a READ of the one real migrator (`migrateGraph`,
 *  `store/graph.ts`, Stage 0's file, imported not re-derived) against a
 *  second, independent read of `graph.json` — never a second
 *  implementation of the pass list itself, which is exactly the "one
 *  decider" discipline the rest of this contract enforces for
 *  `resolveLoad`. `null` means the current project either has no
 *  `graph.json` yet or was already on `GRAPH_VERSION` when opened — nothing
 *  to report. */
export interface MigrationSummary {
  fromVersion: number;
  totalNodes: number;
  nodesNeedingReview: number;
  /** "reference→architecture": 3, etc. — role migrations, node-rootLoad
   *  renames excluded (that one is universal and not diagnostic). */
  byRoleChange: Record<string, number>;
  /** "conditional→imports": 2, "supersedes→deprecated": 1,
   *  "conflicts-with→contradicts": 1 — edge conversions, keyed the same way
   *  the node roles are. */
  byEdgeChange: Record<string, number>;
  /** Edges present before migration and absent after (supersedes deletion,
   *  contradicts dedup collapse) — not an error, just accounted for so the
   *  edge count drop in the summary is never a silent mystery. */
  edgesDropped: number;
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** Pure diff of raw pre-migration JSON against the real migrator's output
 *  for that same input — see {@link MigrationSummary}'s doc comment for why
 *  this is not a second migrator. Returns `null` when there is nothing to
 *  report (no file, or already current). */
function computeMigrationSummary(raw: string | null): MigrationSummary | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt graph.json — loadGraph's own error path surfaces this
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const rawVersion = (parsed as { version?: unknown }).version;
  if (typeof rawVersion !== "number" || rawVersion >= GRAPH_VERSION) return null;

  const rawNodes = Array.isArray((parsed as { nodes?: unknown }).nodes)
    ? ((parsed as { nodes: unknown[] }).nodes as Record<string, unknown>[])
    : [];
  const rawEdges = Array.isArray((parsed as { edges?: unknown }).edges)
    ? ((parsed as { edges: unknown[] }).edges as Record<string, unknown>[])
    : [];

  let migrated;
  try {
    migrated = migrateGraph(parsed);
  } catch {
    return null; // loadGraph's own error path surfaces the real failure
  }

  const rawRoleById = new Map(rawNodes.map((n) => [String(n.id), n.role]));
  const byRoleChange: Record<string, number> = {};
  let nodesNeedingReview = 0;
  for (const n of migrated.nodes) {
    if (n.needsReview === true) nodesNeedingReview += 1;
    const before = rawRoleById.get(n.id);
    if (typeof before === "string" && before !== n.role) {
      bump(byRoleChange, `${before}→${n.role}`);
    }
  }

  const rawEdgeById = new Map(rawEdges.map((e) => [String(e.id), e]));
  const migratedIds = new Set(migrated.edges.map((e) => e.id));
  const byEdgeChange: Record<string, number> = {};
  for (const e of migrated.edges) {
    const before = rawEdgeById.get(e.id);
    const beforeKind = before?.kind;
    if (typeof beforeKind === "string" && beforeKind !== e.kind) {
      bump(byEdgeChange, `${beforeKind}→${e.kind}`);
    }
  }
  let edgesDropped = 0;
  for (const id of rawEdgeById.keys()) {
    if (!migratedIds.has(id)) edgesDropped += 1;
  }
  // A supersedes edge is deleted outright (§5.5) rather than renamed, so it
  // never appears in byEdgeChange — count it there too, under the same
  // "old→new" convention the banner reads (target becomes deprecated).
  for (const [id, e] of rawEdgeById) {
    if (e.kind === "supersedes" && !migratedIds.has(id)) {
      bump(byEdgeChange, "supersedes→deprecated");
    }
  }

  return {
    fromVersion: rawVersion,
    totalNodes: migrated.nodes.length,
    nodesNeedingReview,
    byRoleChange,
    byEdgeChange,
    edgesDropped,
  };
}

function migrationBannerKey(root: string): string {
  return `cowtext:migration-banner-dismissed:${root}`;
}

interface ProjectState {
  root: string | null;
  files: MdFile[];
  scanning: boolean;
  error: string | null;
  /** null = never probed for this root. */
  hooksInstalled: boolean | null;
  /** false = .claude/settings.json exists but could not be parsed. */
  hooksReadable: boolean;
  /** WO13 N-F/E-F. Set once per `openProjectAt`/`rescan`-independent probe;
   *  see {@link MigrationSummary}. `undefined` = not probed yet (first
   *  render before the async read lands); `null` = probed, nothing to
   *  report. */
  migration: MigrationSummary | null | undefined;
  /** Persisted per-root via localStorage (UI-only preference, not part of
   *  the synced graph or `AppSettings` — `store/settings.ts` is outside
   *  this lane's WO13 zone; flagged in the session report as a candidate to
   *  fold into `AppSettings.dismissedMigrationBanners` in a later round). */
  migrationBannerDismissed: boolean;
  dismissMigrationBanner: () => void;
  /** WO13 N-F — "review-needed nodes findable in one action from the
   *  canvas". Selects every `needsReview` node and asks the canvas to pan
   *  to the first one; the caller still owns switching to the canvas VIEW
   *  (that's component-local state in App.tsx, not a store). No-op when
   *  there is nothing to review. */
  focusNeedsReview: () => void;

  openProject: () => Promise<void>;
  /** Open a known path (recent list). Resolves false when the scan failed;
   *  on failure `root` is left untouched and `error` is set. */
  openProjectAt: (root: string) => Promise<boolean>;
  rescan: () => Promise<void>;
  /** Re-reads hooks_status for the current root; no-op when root is null. */
  refreshHooksStatus: () => Promise<void>;
  /** Applies one `fs://change` event in place — never rescans (§5.2). */
  applyFsChange: (c: FsChange) => void;
  /** WO11 G1 — the Home button's action. Flushes every debounced write
   *  FIRST (order is frozen, contract §5.9: losing an edit on the way out
   *  is the failure mode this exists to prevent), then clears this store
   *  and every other panel-owning selection so the title screen never shows
   *  a stale card. Does NOT touch `useSessionsStore` — live agent sessions
   *  are never killed by Home (Marty's ratified ASK #3); they simply stop
   *  being rendered once `root` is null (RosterBar's own mount guard). The
   *  caller (App.tsx) still owns resetting its own local view/modal state
   *  (§5.9 step 4) since that's component state, not a store. */
  closeProject: () => Promise<void>;
}

async function scan(root: string): Promise<ProjectScan> {
  return invoke<ProjectScan>("scan_project", { root });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  root: null,
  files: [],
  scanning: false,
  error: null,
  hooksInstalled: null,
  hooksReadable: true,
  migration: undefined,
  migrationBannerDismissed: false,

  dismissMigrationBanner: () => {
    const root = get().root;
    if (root === null) return;
    try {
      window.localStorage.setItem(migrationBannerKey(root), "1");
    } catch {
      // Storage unavailable (e.g. private mode) — the dismissal just
      // doesn't survive a restart; the banner itself still closes.
    }
    set({ migrationBannerDismissed: true });
  },

  focusNeedsReview: () => {
    const ids = useGraphStore.getState().nodes.filter((n) => n.needsReview === true).map((n) => n.id);
    if (ids.length === 0) return;
    useGraphStore.getState().setSelection(ids, []);
    useFocusStore.getState().requestFocus(ids[0]);
  },

  openProject: async () => {
    const picked = await open({ directory: true, title: "Open project folder" });
    if (typeof picked !== "string") return; // cancelled
    await get().openProjectAt(picked);
  },

  openProjectAt: async (root) => {
    set({ scanning: true, error: null, hooksInstalled: null, migration: undefined });
    try {
      const result = await scan(root);
      set({ root: result.root, files: result.files, scanning: false });
      useSettingsStore.getState().pushRecentProject(result.root);
      void get().refreshHooksStatus();
      // WO13 N-F/E-F — independent, read-only probe (see
      // computeMigrationSummary's doc comment). Fire-and-forget: never
      // blocks the open, and a stale/slow response for a project the user
      // has since navigated away from is dropped rather than applied.
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(migrationBannerKey(result.root)) !== null;
      } catch {
        dismissed = false;
      }
      invoke<string | null>("read_graph", { root: result.root })
        .then((raw) => {
          if (get().root !== result.root) return; // stale: project switched meanwhile
          set({ migration: computeMigrationSummary(raw), migrationBannerDismissed: dismissed });
        })
        .catch(() => {
          if (get().root !== result.root) return;
          set({ migration: null, migrationBannerDismissed: dismissed });
        });
      return true;
    } catch (e) {
      set({ scanning: false, error: String(e) });
      return false;
    }
  },

  rescan: async () => {
    const root = get().root;
    if (!root) return;
    set({ scanning: true, error: null });
    try {
      const result = await scan(root);
      set({ files: result.files, scanning: false });
    } catch (e) {
      set({ scanning: false, error: String(e) });
    }
  },

  refreshHooksStatus: async () => {
    const root = get().root;
    if (!root) return;
    try {
      const status = await hooksStatus(root);
      if (get().root !== root) return; // stale: a different project opened meanwhile
      set({ hooksInstalled: status.installed && status.readable, hooksReadable: status.readable });
    } catch {
      if (get().root !== root) return; // stale: a different project opened meanwhile
      set({ hooksInstalled: null, hooksReadable: true });
    }
  },

  applyFsChange: (c) => {
    const { root, files } = get();
    if (root === null) return;

    if (c.kind === "remove") {
      const idx = files.findIndex((f) => f.relPath === c.relPath);
      if (idx === -1) return; // same array identity — no re-render
      const next = files.slice();
      next.splice(idx, 1);
      set({ files: next });
      return;
    }

    const idx = files.findIndex((f) => f.relPath === c.relPath);
    if (idx !== -1) {
      // modify on known path, or create degrading to modify.
      const prev = files[idx];
      const updated: MdFile = {
        ...prev,
        modifiedMs: c.modifiedMs ?? Date.now(),
        sizeBytes: c.sizeBytes ?? prev.sizeBytes,
      };
      const next = files.slice();
      next[idx] = updated;
      set({ files: next });
      return;
    }

    // create, or modify on an unknown path — insert sorted by relPath.
    const inserted: MdFile = {
      relPath: c.relPath,
      sizeBytes: c.sizeBytes ?? 0,
      modifiedMs: c.modifiedMs ?? Date.now(),
    };
    const next = files.slice();
    let pos = next.findIndex((f) => f.relPath > c.relPath);
    if (pos === -1) pos = next.length;
    next.splice(pos, 0, inserted);
    set({ files: next });
  },

  closeProject: async () => {
    // Step 1-2 (frozen order, §5.9): flush every debounced writer before
    // anything is cleared.
    await useGraphStore.getState().flushSave();
    flushAgentSave();
    flushMetaSave();
    flushSettings();

    // Step 3: clear this store...
    set({
      root: null,
      files: [],
      error: null,
      hooksInstalled: null,
      hooksReadable: true,
      migration: undefined,
      migrationBannerDismissed: false,
    });
    // ...and every other panel-owning selection. `useGraphStore` has no
    // public `reset()` — graph.ts is outside this lane's WO11 file zone
    // (lane UI-C) and the contract doesn't list one as a frozen cross-lane
    // seam. `setSelection([], [])` is the closest existing public surface;
    // it already clears the agents/tasks selections too (see its own doc
    // comment in store/graph.ts). Nothing here is load-bearing for
    // correctness either way: `loadGraph`/`loadAgents` both do a full reset
    // of their own store on the NEXT project open regardless of what was
    // left behind — this step is title-screen hygiene, not a data hazard.
    useGraphStore.getState().setSelection([], []);
    useAgentsStore.getState().select(null);
    useTasksStore.getState().select(null);
    useEventsStore.getState().clear();
    useReviewStore.getState().dismissAll();
    useProjectSelectionStore.getState().select(false);
  },
}));
