// Presets modal (contract §8.4) — save the current graph's STRUCTURE as an
// app-level preset, export/import via OS dialogs, and seed a new project
// from one. Apply is a write into the user's project ⇒ the file-list
// confirmation screen is mandatory, and preset_apply never overwrites.

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FolderInput, Package, X } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { GRAPH_VERSION, serializeGraph, useGraphStore, type BarnGraph } from "../store/graph";
import { useProjectStore } from "../store/project";
import { presetApply, presetExport, presetList, presetRead, presetSave } from "./api";
import { buildPreset, parsePreset, type CowtextPreset, type PresetInfo } from "./types";

type Phase = "list" | "confirm" | "applying" | "done" | "failed";

interface ConfirmState {
  preset: CowtextPreset;
  /** Files the apply would create; `exists` rows are skipped, never written. */
  files: { relPath: string; exists: boolean }[];
}

function projectNameFromRoot(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
}

const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content disabled:text-content-disabled disabled:hover:bg-transparent disabled:hover:text-content-disabled";

export function PresetsModal({ root, onClose }: { root: string; onClose: () => void }) {
  const graphLoaded = useGraphStore((s) => s.loaded);
  const nodeCount = useGraphStore((s) => s.nodes.length);

  const [phase, setPhase] = useState<Phase>("list");
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errText, setErrText] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [written, setWritten] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const canClose = phase !== "applying";

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const refresh = useCallback(async () => {
    setPresets(await presetList());
  }, []);

  useEffect(() => {
    refresh().catch((e: unknown) => setErrText(String(e)));
  }, [refresh]);

  const run = (op: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setErrText(null);
    op()
      .catch((e: unknown) => setErrText(String(e)))
      .finally(() => setBusy(false));
  };

  const doSave = () =>
    run(async () => {
      const name = saveName.trim();
      await presetSave(name, buildPreset(name));
      setSaveName("");
      await refresh();
    });

  const doExport = (info: PresetInfo) =>
    run(async () => {
      // The filter lets the OS dialog append the extension itself, so its
      // overwrite prompt covers the REAL final path; the Rust-side append
      // stays as a safety net but refuses to overwrite silently.
      const path = await save({
        defaultPath: `${info.name}.cowtext-preset.json`,
        filters: [{ name: "Cowtext preset", extensions: ["cowtext-preset.json"] }],
      });
      if (typeof path !== "string") return; // cancelled
      await presetExport(path, await presetRead(info.path));
    });

  const doImport = () =>
    run(async () => {
      const picked = await open({
        filters: [{ name: "Cowtext preset", extensions: ["json"] }],
      });
      if (typeof picked !== "string") return; // cancelled
      const json = await presetRead(picked);
      const parsed = parsePreset(json);
      const fileName = picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? picked;
      const fallback = fileName.replace(/\.cowtext-preset\.json$/i, "").replace(/\.json$/i, "");
      await presetSave(parsed.name !== "" ? parsed.name : fallback, json);
      await refresh();
    });

  // Apply requires an open project with an EMPTY graph (contract §8.4);
  // the Rust guard backs this up (an on-disk graph.json with `nodes: []`
  // is tolerated — deleting the last node leaves the file behind).
  const canApply = graphLoaded && nodeCount === 0;

  const startApply = (info: PresetInfo) =>
    run(async () => {
      const preset = parsePreset(await presetRead(info.path));
      const existing = new Set(
        useProjectStore.getState().files.map((f) => f.relPath.toLowerCase()),
      );
      setConfirm({
        preset,
        files: [
          ...preset.nodes.map((n) => ({
            relPath: n.filePath,
            exists: existing.has(n.filePath.replace(/\\/g, "/").toLowerCase()),
          })),
          { relPath: ".cowtext/graph.json", exists: false },
        ],
      });
      setPhase("confirm");
    });

  const doApply = () => {
    if (confirm === null) return;
    setPhase("applying");
    setErrText(null);
    (async () => {
      const { preset } = confirm;
      const graph: BarnGraph = {
        version: GRAPH_VERSION,
        projectName: projectNameFromRoot(root),
        // Presets saved before graph v2 may still carry the old "persona" role.
        nodes: preset.nodes.map((n) => ((n.role as string) === "persona" ? { ...n, role: "agent" as const } : n)),
        edges: preset.edges,
        compileTargets: preset.compileTargets,
      };
      const stubs = preset.nodes.map((n) => ({
        relPath: n.filePath,
        // The Inspector's new-node stub idiom — user content, no header.
        content: `# ${n.title}\n\n`,
      }));
      const paths = await presetApply(root, serializeGraph(graph), stubs);
      await useGraphStore.getState().loadGraph(root);
      void useProjectStore.getState().rescan();
      setWritten(paths);
      setPhase("done");
    })().catch((e: unknown) => {
      setErrText(String(e));
      setPhase("failed");
      // Stubs before the failure point are on disk (graph.json is written
      // last, so retry stays safe) — refresh the file rail to match.
      void useProjectStore.getState().rescan();
    });
  };

  const newFileCount = confirm?.files.filter((f) => !f.exists).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[var(--scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Presets"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        {/* Header — 44px */}
        <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
          <span className="text-[15px] font-semibold">Presets</span>
          <div className="min-w-0 flex-1" />
          <span
            className="min-w-0 max-w-[300px] truncate font-mono text-2xs text-content-muted"
            title={root}
          >
            {root}
          </span>
          <button onClick={onClose} disabled={!canClose} title="Close" className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errText !== null && (
            <div className="border-b border-border-subtle border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}

          {phase === "list" && (
            <>
              {/* Save current graph as preset */}
              <div className="flex h-[44px] items-center gap-2 border-b border-border-subtle px-4">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && saveName.trim() !== "" && nodeCount > 0) doSave();
                  }}
                  placeholder="Preset name"
                  className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-sm text-content outline-none placeholder:text-content-muted focus:border-accent-border"
                />
                <button
                  onClick={doSave}
                  disabled={busy || saveName.trim() === "" || nodeCount === 0}
                  title={nodeCount === 0 ? "The graph is empty" : "Save the current graph structure"}
                  className={SECONDARY_BTN}
                >
                  <Package size={14} strokeWidth={1.5} />
                  Save current graph
                </button>
                <button onClick={doImport} disabled={busy} className={SECONDARY_BTN}>
                  <FolderInput size={14} strokeWidth={1.5} />
                  Import…
                </button>
              </div>

              {presets === null ? (
                <p className="px-4 py-6 text-center text-sm text-content-muted">loading…</p>
              ) : presets.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-content-muted">
                  No presets yet — save the current graph to create one.
                </p>
              ) : (
                <ul>
                  {presets.map((p) => (
                    <li
                      key={p.path}
                      className="flex h-row items-center gap-2 border-b border-border-subtle px-4 hover:bg-[var(--surface-hover)]"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-content" title={p.path}>
                        {p.name}
                      </span>
                      <span className="inline-flex h-[17px] flex-none items-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-micro text-content-secondary">
                        {p.nodeCount} {p.nodeCount === 1 ? "node" : "nodes"}
                      </span>
                      <span className="flex-none font-mono text-2xs text-content-muted">
                        {p.savedAt.slice(0, 10)}
                      </span>
                      <button
                        onClick={() => doExport(p)}
                        disabled={busy}
                        title="Export preset file"
                        className={ICON_BTN}
                      >
                        <Download size={13} strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => startApply(p)}
                        disabled={busy || !canApply}
                        title={
                          canApply
                            ? "New project from this preset"
                            : "Open an empty project first"
                        }
                        className={SECONDARY_BTN.replace("h-control ", "h-control-sm ")}
                      >
                        Apply
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {(phase === "confirm" || phase === "applying") && confirm !== null && (
            <div className="flex flex-col">
              <p className="border-b border-border-subtle px-4 py-3 text-sm text-content">
                New project from{" "}
                <span className="font-semibold">
                  {confirm.preset.name !== "" ? confirm.preset.name : "preset"}
                </span>{" "}
                — these files will be created:
              </p>
              <ul className="py-1">
                {confirm.files.map((f) => (
                  <li key={f.relPath} className="flex h-[26px] items-center gap-2 px-4">
                    <span
                      className={`min-w-0 flex-1 truncate font-mono text-xs ${
                        f.exists ? "text-content-muted line-through" : "text-content"
                      }`}
                    >
                      {f.relPath}
                    </span>
                    {f.exists && (
                      <span className="flex-none font-mono text-2xs text-content-muted">
                        will be skipped
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-sm text-content">
                wrote {written.length} {written.length === 1 ? "file" : "files"}
              </p>
              <ul className="flex flex-col gap-0.5">
                {written.map((p) => (
                  <li key={p} className="font-mono text-xs text-content-secondary">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase === "failed" && errText === null && (
            <p className="px-4 py-6 text-center text-sm text-content-muted">Apply failed.</p>
          )}
        </div>

        {/* Footer — 50px */}
        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          {phase === "confirm" || phase === "applying" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Creates {newFileCount} {newFileCount === 1 ? "file" : "files"} in {root}. Existing
                files are never overwritten.
              </span>
              <button
                onClick={() => {
                  setConfirm(null);
                  setPhase("list");
                }}
                disabled={phase === "applying"}
                className={SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                onClick={doApply}
                disabled={phase === "applying"}
                className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled"
              >
                {phase === "applying" ? "· · ·" : "Create files"}
              </button>
            </>
          ) : phase === "done" || phase === "failed" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                {phase === "done"
                  ? "done — the graph is loaded"
                  : "apply failed — some stub files may exist; re-applying skips them"}
              </span>
              <button
                onClick={() => {
                  setConfirm(null);
                  setErrText(null);
                  setPhase("list");
                }}
                className={SECONDARY_BTN}
              >
                Back
              </button>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Close
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                Presets carry graph structure and briefs — never file content.
              </span>
              <button onClick={onClose} className={SECONDARY_BTN}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
