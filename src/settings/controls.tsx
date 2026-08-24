// Settings controls, shared by the modal shell and every pane it hosts.
//
// WO15 kept these inline in `SettingsModal.tsx` under the "idioms copied,
// not imported across lanes" rule, which was right while Settings was one
// file. WO16 splits Settings into panes, and three copies of the same
// toggle is not the same thing as one lane copying an idiom from another —
// so they move here rather than multiply. The idioms themselves are
// unchanged: Inspector-density controls, accent for user-initiated state
// ("Blue is you"), no charm in chrome.

import type { ReactNode } from "react";

export function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-2xs uppercase tracking-wide text-content-muted">{children}</div>
  );
}

/** 34×19 pill toggle (Inspector idiom, local copy). Settings are
 *  user-initiated ⇒ accent, not amber ("Blue is you"). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={`relative h-[19px] w-[34px] flex-none rounded-pill border transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-accent-border bg-accent-surface" : "border-border-strong bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[13px] w-[13px] rounded-pill transition-all duration-fast ${
          checked ? "left-[16px] bg-accent" : "left-[2px] bg-content-muted"
        }`}
      />
    </button>
  );
}

/** 28px row: label left, control right. */
export function Row({
  label,
  dimmed,
  children,
}: {
  label: ReactNode;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-row items-center justify-between gap-3">
      <span className={`text-sm ${dimmed ? "text-content-disabled" : "text-content"}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function HelperLine({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-2xs leading-relaxed text-content-muted">{children}</p>;
}

/** Segmented picker — App.tsx's ViewToggle idiom, local copy at settings
 *  density: 2px padding frame on surface-2, active segment surface-3. Radio
 *  semantics rather than a `<select>` because the four scales are worth
 *  seeing at once, and the active one is the answer to "how big is it now?". */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-none items-center gap-0.5 rounded border border-border bg-surface-2 p-[2px]"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-control-sm items-center rounded-sm px-2.5 font-mono text-xs transition-colors duration-fast ${
            value === o.value
              ? "bg-surface-3 text-content"
              : "text-content-muted hover:text-content-secondary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Native select, styled like every other one in the app (Inspector:1788). */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-control w-[196px] rounded border border-border bg-surface-2 px-2 text-sm text-content transition-colors duration-fast focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}