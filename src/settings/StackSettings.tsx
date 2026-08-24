// Settings › Tech stack (WO16 Block C).
//
// Two jobs on one pane, and the distinction matters because they persist to
// different places and survive differently:
//
//   TICKING a row sets `defaultStackItemIds` — which boxes the New Project
//   wizard starts with. A preference about the picker.
//
//   ADDING a row writes `customStackItems` — a row that did not exist
//   before. Part of the picker itself, so removing one is a deliberate act
//   with its own control, never a side effect of unticking.
//
// Icons are custom rows only (D-2, Marty 2026-08-22): bundled entries are a
// closed table Cowtext ships, and an upload slot on all forty of them would
// be forty invitations to do work the product should have already done.

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { STACK_CATEGORIES } from "../resources";
import {
  CUSTOM_STACK_CATEGORY_ID,
  MAX_STACK_LABEL,
  useSettingsStore,
  type CustomStackItem,
} from "../store/settings";
import { pushToast } from "../store/toasts";
import { HelperLine, SectionLabel } from "./controls";
import { stackIconDelete, stackIconImport, stackIconRead } from "./stackIconApi";
import {
  CUSTOM_STACK_CATEGORY_LABEL,
  stackAddProblem,
  stackGroups,
  stackIdFor,
  type StackRow,
} from "./stackTable";

/** Data URLs keyed by `iconFile`, loaded once per pane mount.
 *
 *  Deliberately NOT in the settings store: these are bytes derived from
 *  disk, not settings, and `settings.json` is persisted wholesale on every
 *  change — putting a base64 payload in that object would write it back to
 *  disk on every unrelated toggle. A missing or unreadable icon simply never
 *  lands in the map and the row falls back to its default glyph. */
function useStackIcons(items: readonly CustomStackItem[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  // Only the icon FILES matter here — relabelling an item must not refetch.
  const key = items
    .map((i) => i.iconFile ?? "")
    .filter((f) => f !== "")
    .sort()
    .join("|");

  useEffect(() => {
    let live = true;
    const files = key === "" ? [] : key.split("|");
    if (files.length === 0) {
      setIcons({});
      return;
    }
    void Promise.all(
      files.map(async (file) => [file, await stackIconRead(file).catch(() => null)] as const),
    ).then((pairs) => {
      if (!live) return;
      const next: Record<string, string> = {};
      for (const [file, dataUrl] of pairs) if (dataUrl !== null) next[file] = dataUrl;
      setIcons(next);
    });
    return () => {
      live = false;
    };
  }, [key]);

  return icons;
}

/** 20px square: the uploaded icon, or the item's first letter. Rendered at
 *  20 rather than the source's 32 because this is a list row — the icon is
 *  an aid to scanning, not the content. `object-contain` so a user's
 *  not-quite-square PNG is letterboxed rather than distorted. */
function StackIcon({ row, dataUrl }: { row: StackRow; dataUrl: string | undefined }) {
  if (dataUrl !== undefined) {
    return (
      <img
        src={dataUrl}
        alt=""
        className="h-5 w-5 flex-none rounded-sm object-contain"
        draggable={false}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 flex-none place-items-center rounded-sm border border-border bg-surface-2 text-2xs uppercase text-content-muted"
    >
      {row.label.slice(0, 1)}
    </span>
  );
}

export function StackSettings() {
  const defaults = useSettingsStore((s) => s.defaultStackItemIds);
  const custom = useSettingsStore((s) => s.customStackItems);
  const setDefaults = useSettingsStore((s) => s.setDefaultStackItemIds);
  const saveItem = useSettingsStore((s) => s.saveCustomStackItem);
  const removeItem = useSettingsStore((s) => s.removeCustomStackItem);

  const icons = useStackIcons(custom);
  const groups = stackGroups(custom);

  const [draftLabel, setDraftLabel] = useState("");
  const [draftCategory, setDraftCategory] = useState<string>(CUSTOM_STACK_CATEGORY_ID);
  const [busyIcon, setBusyIcon] = useState<string | null>(null);

  const addProblem = draftLabel.trim() === "" ? null : stackAddProblem(draftLabel, custom);
  const canAdd = draftLabel.trim() !== "" && addProblem === null;

  const toggleDefault = (id: string) => {
    setDefaults(defaults.includes(id) ? defaults.filter((d) => d !== id) : [...defaults, id]);
  };

  const addItem = () => {
    if (!canAdd) return;
    saveItem({
      id: stackIdFor(draftLabel),
      label: draftLabel.trim().slice(0, MAX_STACK_LABEL),
      categoryId: draftCategory,
      iconFile: null,
    });
    setDraftLabel("");
  };

  /** Pick an image for one custom row. The old icon file is deleted only
   *  after the new one is written and recorded — a failed import must never
   *  cost the user the icon they already had. Reference-counted, because
   *  the store is content-addressed: two rows given the same image share
   *  one file, so the old one is only removed when nothing else points at
   *  it. */
  const chooseIcon = async (item: CustomStackItem) => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof picked !== "string") return;
    setBusyIcon(item.id);
    try {
      const ref = await stackIconImport(picked);
      const previous = item.iconFile;
      saveItem({ ...item, iconFile: ref.file });
      if (previous !== null && previous !== ref.file) {
        const stillUsed = custom.some((c) => c.id !== item.id && c.iconFile === previous);
        if (!stillUsed) await stackIconDelete(previous).catch(() => undefined);
      }
    } catch (e) {
      pushToast({ severity: "danger", title: "Icon could not be used", detail: String(e) });
    } finally {
      setBusyIcon(null);
    }
  };

  const clearIcon = async (item: CustomStackItem) => {
    const previous = item.iconFile;
    saveItem({ ...item, iconFile: null });
    if (previous === null) return;
    const stillUsed = custom.some((c) => c.id !== item.id && c.iconFile === previous);
    if (!stillUsed) await stackIconDelete(previous).catch(() => undefined);
  };

  /** Deleting the row takes its icon with it, on the same reference count —
   *  an orphaned file in `app_config_dir` is invisible litter nobody will
   *  ever go and find. */
  const deleteItem = async (item: CustomStackItem) => {
    removeItem(item.id);
    if (item.iconFile === null) return;
    const stillUsed = custom.some((c) => c.id !== item.id && c.iconFile === item.iconFile);
    if (!stillUsed) await stackIconDelete(item.iconFile).catch(() => undefined);
  };

  const customById = new Map(custom.map((c) => [c.id, c]));

  return (
    <div className="px-4 py-3">
      <SectionLabel>New project defaults</SectionLabel>
      <HelperLine>
        Ticked items start selected in the New Project wizard&rsquo;s stack step, which writes
        them to <span className="font-mono">context/stack.md</span>. Every project can still
        change its own — this only sets where the wizard begins.
      </HelperLine>

      <div className="mt-2 space-y-3">
        {groups.map((group) => (
          <div key={group.id}>
            <div className="mb-1 text-2xs uppercase tracking-wide text-content-muted">
              {group.label}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {group.rows.map((row) => {
                const item = customById.get(row.id);
                return (
                  <div key={row.id} className="flex h-row items-center gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={defaults.includes(row.id)}
                        onChange={() => toggleDefault(row.id)}
                        className="h-3.5 w-3.5 flex-none accent-[var(--accent)]"
                      />
                      <StackIcon row={row} dataUrl={row.iconFile ? icons[row.iconFile] : undefined} />
                      <span className="min-w-0 truncate text-sm text-content">{row.label}</span>
                    </label>
                    {item !== undefined && (
                      <span className="flex flex-none items-center gap-0.5">
                        <IconButton
                          title={item.iconFile === null ? "Choose an icon…" : "Replace the icon…"}
                          disabled={busyIcon === item.id}
                          onClick={() => void chooseIcon(item)}
                        >
                          <ImagePlus size={13} strokeWidth={1.5} />
                        </IconButton>
                        {item.iconFile !== null && (
                          <IconButton title="Remove the icon" onClick={() => void clearIcon(item)}>
                            <X size={13} strokeWidth={1.5} />
                          </IconButton>
                        )}
                        <IconButton
                          title={`Delete ${item.label}`}
                          danger
                          onClick={() => void deleteItem(item)}
                        >
                          <Trash2 size={13} strokeWidth={1.5} />
                        </IconButton>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        <SectionLabel>Add your own</SectionLabel>
        <HelperLine>
          Anything Cowtext doesn&rsquo;t ship — an in-house framework, a service, a house
          convention. Give it a 32×32 icon and it reads as yours in the picker.
        </HelperLine>
        <div className="flex items-center gap-2">
          <input
            value={draftLabel}
            maxLength={MAX_STACK_LABEL}
            placeholder="Name…"
            aria-label="New stack item"
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            className="h-control min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-sm text-content transition-colors duration-fast placeholder:text-content-muted focus:border-accent"
          />
          <select
            value={draftCategory}
            aria-label="Category"
            onChange={(e) => setDraftCategory(e.target.value)}
            className="h-control w-[150px] flex-none rounded border border-border bg-surface-2 px-2 text-sm text-content transition-colors duration-fast focus:border-accent"
          >
            {STACK_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value={CUSTOM_STACK_CATEGORY_ID}>{CUSTOM_STACK_CATEGORY_LABEL}</option>
          </select>
          <button
            onClick={addItem}
            disabled={!canAdd}
            className="flex h-control flex-none items-center gap-1 rounded border border-accent-border bg-accent-surface px-2.5 text-sm text-accent-text transition-colors duration-fast disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-content-disabled"
          >
            <Plus size={13} strokeWidth={1.5} />
            Add
          </button>
        </div>
        {addProblem !== null && (
          <p className="pt-1 text-2xs leading-snug text-warning-text">{addProblem}</p>
        )}
      </div>
    </div>
  );
}

/** Square icon button at row density. Danger only ever means destructive —
 *  never merely "secondary". */
function IconButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-control-sm w-control-sm place-items-center rounded transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-content-muted hover:bg-danger-surface hover:text-danger-text"
          : "text-content-muted hover:bg-[var(--surface-hover)] hover:text-content"
      }`}
    >
      {children}
    </button>
  );
}
