// Default-branch picker (WO15 §6 U2.3) — one control, two callers: the Git
// wizard's init panel and the New Project wizard's Git step. Extracted from
// `GitWizard.tsx` rather than copied, because the two wizards must agree on
// what a legal branch name is: both of them hand the result to the same
// `git_init`, whose Rust side re-validates and is the source of truth.
//
// The component owns only the SHAPE of the choice (which of the three
// segments is lit, what is typed in the custom box). The resolved branch
// name is the caller's state — `value` in, `onChange` out — so the caller
// can gate its own primary button on `isValidBranchName(value)` without
// reaching into this component's internals.

import { useState } from "react";

/** Mirrors `validate_branch` in `src-tauri/src/worktree.rs` (WO11 D1b: the
 *  same rule set `git_init`'s branch argument is validated against
 *  server-side). A client-side pre-check only — Rust re-validates and is the
 *  source of truth; this just avoids offering a button that would round-trip
 *  into a guaranteed error. */
const INVALID_BRANCH_CHARS = ["~", "^", ":", "?", "*", "[", "\\"];

export function isValidBranchName(name: string): boolean {
  if (name === "" || /\s/.test(name)) return false;
  if (INVALID_BRANCH_CHARS.some((c) => name.includes(c))) return false;
  if (name.startsWith("-")) return false;
  if (name.includes("..")) return false;
  if (name.endsWith(".lock")) return false;
  return true;
}

type BranchChoice = "main" | "master" | "custom";

const SEGMENTS: readonly BranchChoice[] = ["main", "master", "custom"];

export function BranchPicker({
  /** The resolved branch name — what the caller will send to `git_init`. */
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  // Local, seeded once from `value`: the segmented control is a view of the
  // caller's string, but "custom" with an empty box is a real state that no
  // string can express, so the choice cannot be derived on every render
  // (clicking `custom` would snap straight back to `main`).
  const [choice, setChoice] = useState<BranchChoice>(() =>
    value === "main" || value === "master" ? value : "custom",
  );
  // Raw text, never re-derived from `value` — trimming on the way out must
  // not eat the space the user just typed on the way back in.
  const [custom, setCustom] = useState(() => (value === "main" || value === "master" ? "" : value));

  const pick = (next: BranchChoice) => {
    setChoice(next);
    onChange(next === "custom" ? custom.trim() : next);
  };

  return (
    <div>
      <p className="mb-1.5 font-mono text-2xs uppercase tracking-wider text-content-muted">
        default branch
      </p>
      <div className="flex items-center gap-1.5">
        <div className="flex h-control-sm flex-none overflow-hidden rounded border border-border">
          {SEGMENTS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              disabled={disabled}
              aria-pressed={choice === opt}
              className={`h-full px-2.5 font-mono text-xs transition-colors duration-fast disabled:opacity-50 ${
                choice === opt
                  ? "bg-accent-surface text-accent-text"
                  : "bg-surface-2 text-content-muted hover:bg-surface-3"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {choice === "custom" && (
          <input
            type="text"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              onChange(e.target.value.trim());
            }}
            disabled={disabled}
            placeholder="branch-name"
            aria-label="Custom branch name"
            className="h-control-sm min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 font-mono text-xs text-content placeholder:text-content-disabled focus:border-accent disabled:opacity-50"
          />
        )}
      </div>
      {choice === "custom" && !isValidBranchName(value) && (
        <p className="mt-1 text-2xs leading-snug text-content-muted">
          Branch name can&apos;t be empty, contain whitespace or any of{" "}
          <span className="font-mono">~^:?*[\</span>, start with{" "}
          <span className="font-mono">-</span>, contain <span className="font-mono">..</span>, or
          end with <span className="font-mono">.lock</span>.
        </p>
      )}
    </div>
  );
}
