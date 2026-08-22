// Git wizard (WO11 G2 — §5.10). Marty's ratified scope: `git init` if the
// project is not already a repo, plus a `.gitignore` composer. No staging,
// remotes or pushes — see WO11_CONTRACT.md §8.
//
// WO15 Block 0 adds exactly one write to that scope: an opt-out "Make the
// first commit" toggle on the init panel. It is opt-OUT (default on) because
// a repo with no commit is a state most tools handle badly (no HEAD, no
// diff, no `git log`), and the commit it makes is the empty-project one —
// `.gitignore` + `.cowtext/` + `context/`, nothing the user has not already
// seen this wizard create. Everything else about the commit lives in Rust
// (§3.2): identity is checked BEFORE any mutation, an existing repo is never
// re-initialised, and `.gitignore` lines are appended, never rewritten.
//
// Three states off one `git_status` probe, same shell idiom as
// ProjectWizard/NodeWizard (~560px, surface-1, r-xl, elev-4, Esc, scrim
// click-outside):
//   1. git missing from PATH — a dead-end panel, no retry loop.
//   2. not yet a repo — one button (`git_init`), falls through to (3).
//   3. a repo — the `.gitignore` composer, gated by the same diff-preview
//      trust boundary CompileModal uses (CLAUDE.md: a write into the user's
//      project always shows a confirmation diff first).
//
// DEVIATION flagged for tech-lead/R1: `src/git/gitignorePresets.ts` is lane
// R1's file and does not exist yet at the time this was written. The import
// below assumes the shape `{ key, label, lines }[]` exported as
// `GITIGNORE_PRESETS`, five groups named exactly "Node" / "Rust / Cargo" /
// "Tauri" / "Editors & OS" / "Cowtext" per §5.10. If R1 lands a different
// export name or shape, this file needs a one-line adjustment at
// integration — everything else here (composition rule, diff gate, the two
// upstream states) does not depend on that shape.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FolderGit2, X } from "lucide-react";
import { gitignoreWrite, gitInit, gitStatus } from "./api";
import { BranchPicker, isValidBranchName } from "./BranchPicker";
import { GITIGNORE_PRESETS } from "./gitignorePresets";
import type { GitInitResult, GitStatus } from "./types";
import { diffLines, type DiffHunk } from "../ui/diff";

const ICON_BTN =
  "grid h-control-sm w-control-sm flex-none place-items-center rounded text-content-muted transition-colors duration-fast hover:bg-[var(--surface-hover)] hover:text-content";
const SECONDARY_BTN =
  "flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3 disabled:text-content-disabled disabled:hover:border-border disabled:hover:bg-surface-2";
const PRIMARY_BTN =
  "flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-2 disabled:text-content-disabled";

const ADDED_MARKER = "# --- added by Cowtext ---";

/** 15px checkbox, matching CompileModal's `ApproveCheckbox` (DESIGN_SPEC:
 *  15px, r-xs, blue — every use here is a user-initiated choice).
 *
 *  D1a fix: `interactive` defaults to `true` (a standalone `<button
 *  role="checkbox">`, the "I've reviewed this diff" call site's shape,
 *  unchanged). Set `interactive={false}` when this square is nested inside
 *  another `<button>` (the preset chips) — it then renders a
 *  `<span role="presentation">` with identical pixel geometry and glyph but
 *  no click handler of its own and no `<button>` tag, so there is exactly
 *  one interactive element (the outer chip) instead of a nested pair whose
 *  two `onClick`s net-cancelled each other via bubbling. */
function CheckSquare({
  checked,
  disabled,
  label,
  onToggle,
  interactive = true,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle?: () => void;
  interactive?: boolean;
}) {
  const className = `grid h-[15px] w-[15px] flex-none place-items-center rounded-xs border transition-colors duration-fast disabled:opacity-50 ${
    checked
      ? "border-accent bg-accent"
      : "border-border-strong bg-surface-1 hover:border-accent-border"
  }`;
  const glyph = checked && <Check size={11} strokeWidth={3} className="text-content-inverse" />;

  if (!interactive) {
    return (
      <span role="presentation" className={className}>
        {glyph}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={className}
    >
      {glyph}
    </button>
  );
}

/** Same unified-diff rendering idiom as CompileModal's `DiffView` — kept
 *  local since that one is not exported and this wizard's file zone does not
 *  include `src/compile/**`. */
function DiffView({ hunks }: { hunks: DiffHunk[] }) {
  if (hunks.length === 0) {
    return (
      <div className="bg-surface-inset px-3 py-2 font-mono text-xs text-content-muted">
        no changes
      </div>
    );
  }
  return (
    <div className="max-h-[220px] overflow-auto bg-surface-inset py-1 font-mono text-xs leading-[1.6]">
      <div className="min-w-max">
        {hunks.map((h, hi) => (
          <div key={hi}>
            <div className="px-2 text-content-muted">
              {`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`}
            </div>
            {h.ops.map((op, oi) => (
              <div
                key={oi}
                className={
                  op.type === "add"
                    ? "bg-success-surface text-success-text"
                    : op.type === "del"
                      ? "bg-danger-surface text-danger-text"
                      : "text-content-secondary"
                }
              >
                <span className="inline-block w-9 select-none pr-2 text-right text-content-disabled">
                  {op.oldLine ?? ""}
                </span>
                <span className="whitespace-pre pr-3">
                  {(op.type === "add" ? "+" : op.type === "del" ? "-" : " ") + op.text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 34×19 pill toggle, accent-toned — this one is a user decision about the
 *  user's own repository ("blue is you"), unlike ProjectWizard's amber hooks
 *  toggle which promises agent behaviour. */
function Toggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[19px] w-[34px] flex-none rounded-pill border transition-colors duration-fast disabled:opacity-50 ${
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

/** The git identity the first commit will be attributed to — the same two
 *  values Rust refuses to commit without (WO15 §3.2 `GIT_IDENTITY_ERR`).
 *  Shown before the button that needs them, so "not configured" is
 *  something you read rather than something you hit. */
function IdentityRow({ status }: { status: GitStatus }) {
  const configured = status.identityName !== null && status.identityEmail !== null;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="flex-none font-mono text-2xs uppercase tracking-wider text-content-muted">
        identity
      </span>
      <span
        className={`min-w-0 flex-1 truncate font-mono text-xs ${
          configured ? "text-content-secondary" : "text-warning-text"
        }`}
      >
        {configured ? `${status.identityName} <${status.identityEmail}>` : "not configured"}
      </span>
    </div>
  );
}

/** Composition rule, frozen (§5.10): existing content preserved verbatim and
 *  first; preset + free-text lines are appended under a marker comment; a
 *  line already present anywhere in the file (or already staged to be
 *  added) is never added twice; nothing already there is ever removed. */
function composeGitignore(
  existing: string | null,
  selectedPresetKeys: ReadonlySet<string>,
  extraText: string,
): string {
  const existingLines = existing !== null ? existing.split(/\r\n|\r|\n/) : [];
  // Trailing blank lines from the split of a file ending in \n would
  // otherwise grow by one on every re-compose; drop them, the writer adds
  // exactly one trailing newline back on write.
  while (existingLines.length > 0 && existingLines[existingLines.length - 1] === "") {
    existingLines.pop();
  }
  const seen = new Set(existingLines.map((l) => l.trim()).filter((l) => l !== ""));
  const toAdd: string[] = [];
  const addLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed === "" || seen.has(trimmed)) return;
    seen.add(trimmed);
    toAdd.push(line);
  };
  for (const preset of GITIGNORE_PRESETS) {
    if (!selectedPresetKeys.has(preset.key)) continue;
    for (const line of preset.lines) addLine(line);
  }
  for (const line of extraText.split("\n")) addLine(line);
  // J.1 fix (tester audit, MAJOR): when nothing is actually being added,
  // propose leaving the file exactly as it is — the ORIGINAL raw string,
  // not `existingLines.join("\n")`. That rejoin silently re-encoded CRLF to
  // LF even when zero content changed, and comparing that against the raw
  // `status.gitignoreContent` produced a phantom delete+add of every line
  // (the shared `src/ui/diff.ts` splitter only recognizes "\n", so it left
  // a trailing "\r" on every old-side line, `src/ui/diff.ts` is outside
  // this lane's zone and cannot be touched). Returning the untouched
  // original makes `proposed === existing` byte-for-byte, which trips
  // `diffLines`'s own `oldText === newText` fast path below — zero hunks
  // because nothing is genuinely proposed, not because "\r" got quietly
  // stripped for the comparison. When a real write IS proposed (below),
  // the diff stays honest about the bytes that land on disk: a pre-existing
  // CRLF file gaining new lines will show every old line changing too,
  // because `gitignore_write` really does normalize the whole file to LF.
  if (toAdd.length === 0) return existing ?? "";
  const body =
    existingLines.length > 0
      ? [...existingLines, "", ADDED_MARKER, ...toAdd]
      : [ADDED_MARKER, ...toAdd];
  return body.join("\n");
}

type Phase = "loading" | "error" | "ready" | "initializing" | "writing" | "written";

export function GitWizard({ root, onClose }: { root: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [errText, setErrText] = useState<string | null>(null);

  const [selectedPresets, setSelectedPresets] = useState<ReadonlySet<string>>(new Set());
  const [extraText, setExtraText] = useState("");
  const [reviewed, setReviewed] = useState(false);

  // D1b: default-branch choice offered at init time. Default "main" per
  // contract; the resolved name (never null from this UI — `BranchPicker`
  // always resolves to a string) is what gets sent to `gitInit`.
  const [branch, setBranch] = useState("main");
  const branchIsValid = isValidBranchName(branch);
  // WO15 Block 0 — opt-out first commit. `false` here reproduces the
  // pre-WO15 behaviour byte-for-byte (init, nothing else).
  const [makeCommit, setMakeCommit] = useState(true);
  const [initResult, setInitResult] = useState<GitInitResult | null>(null);

  const canClose = phase !== "initializing" && phase !== "writing";

  const load = () => {
    setPhase("loading");
    setErrText(null);
    gitStatus(root)
      .then((s) => {
        setStatus(s);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        setErrText(String(e));
        setPhase("error");
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    // Focus held on Cancel, not the panel shell — the dialog's one
    // guaranteed-safe default action.
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const doInit = () => {
    if (!branchIsValid) return;
    setPhase("initializing");
    setErrText(null);
    // WO15 §3.2: `gitInit` resolves to a `GitInitResult` envelope. With
    // `commit` true this is a WRITE (a `.gitignore` append and one commit) —
    // the toggle above the button is its approval, and a missing identity
    // rejects before anything is created, so a failure here leaves the
    // folder exactly as it was.
    gitInit(root, branch, makeCommit)
      .then((r) => {
        setStatus(r.status);
        setInitResult(r);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        setErrText(String(e));
        setPhase("ready");
      });
  };

  const proposed = useMemo(
    () => composeGitignore(status?.gitignoreContent ?? null, selectedPresets, extraText),
    [status, selectedPresets, extraText],
  );
  // Old and new are compared on equal footing by construction, not by
  // stripping "\r" for the comparison: `proposed` is either the untouched
  // original (see `composeGitignore`'s no-op branch — byte-identical to
  // `status.gitignoreContent`, so `diffLines`'s `oldText === newText` guard
  // fires before either side is ever line-split) or a real new proposal, in
  // which case any CRLF-to-LF change shown is real — `gitignore_write`
  // normalizes every write, so that transformation genuinely lands on disk.
  // The trailing-newline template literal this used to wrap `proposed` in
  // made no difference to the computed hunks (the shared `splitLines`
  // already discards a single trailing empty line either way, with or
  // without it) and only risked its own phantom blank-line diff in the
  // no-op case, so it is gone.
  const hunks = useMemo(
    () => diffLines(status?.gitignoreContent ?? null, proposed),
    [status, proposed],
  );
  const hasChanges = hunks.length > 0;
  // A distinct, honest note (not folded into the line diff itself) for the
  // one thing `hasChanges` alone doesn't explain: a real write is
  // happening AND the existing file was CRLF, so part of what the diff
  // below shows is pure line-ending normalization, not new content.
  const willNormalizeLineEndings =
    hasChanges && (status?.gitignoreContent ?? "").includes("\r");

  const togglePreset = (key: string) => {
    setReviewed(false);
    setSelectedPresets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const doWrite = () => {
    if (!hasChanges || !reviewed) return;
    setPhase("writing");
    setErrText(null);
    gitignoreWrite(root, proposed)
      .then(() => {
        setStatus((s) =>
          s === null ? s : { ...s, gitignoreExists: true, gitignoreContent: proposed },
        );
        setSelectedPresets(new Set());
        setExtraText("");
        setReviewed(false);
        setPhase("written");
      })
      .catch((e: unknown) => {
        setErrText(String(e));
        setPhase("ready");
      });
  };

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
        aria-label="Git"
        tabIndex={-1}
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal outline-none"
      >
        <div className="flex h-topbar flex-none items-center gap-2 border-b border-border-subtle px-4">
          <FolderGit2 size={14} strokeWidth={1.8} className="flex-none text-content-muted" />
          <span className="text-[15px] font-semibold">Git</span>
          <div className="min-w-0 flex-1" />
          <button onClick={onClose} disabled={!canClose} title="Close" className={ICON_BTN}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {errText !== null && (
            <div className="border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {errText}
            </div>
          )}

          {phase === "loading" && (
            <p className="py-8 text-center text-sm text-content-muted">checking git…</p>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-content-secondary">
                Could not check this project&apos;s git status.
              </p>
              <button onClick={load} className={`${SECONDARY_BTN} self-start`}>
                Retry
              </button>
            </div>
          )}

          {status !== null && phase !== "loading" && phase !== "error" && !status.gitAvailable && (
            <div className="flex flex-col gap-2">
              <p className="text-sm leading-relaxed text-content-secondary">
                <span className="font-mono text-content">git</span> was not found on your system{" "}
                <span className="font-mono">PATH</span>. Cowtext looks for a{" "}
                <span className="font-mono">git</span> executable it can run directly — nothing
                bundled, nothing else it can try from here.
              </p>
              <p className="text-xs leading-relaxed text-content-muted">
                Install Git for Windows, make sure it&apos;s on <span className="font-mono">PATH</span>
                , then reopen this dialog.
              </p>
            </div>
          )}

          {status !== null &&
            phase !== "loading" &&
            phase !== "error" &&
            status.gitAvailable &&
            !status.isRepo && (
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed text-content-secondary">
                  This project is not a git repository yet.
                </p>
                <p className="truncate rounded border border-border-subtle bg-surface-inset px-2.5 py-1.5 font-mono text-xs text-content-secondary" title={root}>
                  {root}
                </p>
                <BranchPicker
                  value={branch}
                  onChange={setBranch}
                  disabled={phase === "initializing"}
                />

                <div className="flex items-start justify-between gap-3 rounded border border-border-subtle bg-surface-inset px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-content">Make the first commit</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
                      Adds <span className="font-mono">.gitignore</span>,{" "}
                      <span className="font-mono">.cowtext/</span> and{" "}
                      <span className="font-mono">context/</span> and commits them as{" "}
                      <span className="font-mono">chore: init cowtext project</span>. No remote, no
                      push.
                    </p>
                  </div>
                  <Toggle
                    checked={makeCommit}
                    disabled={phase === "initializing"}
                    label="Make the first commit"
                    onChange={setMakeCommit}
                  />
                </div>

                {makeCommit && <IdentityRow status={status} />}

                {makeCommit &&
                  (status.identityName === null || status.identityEmail === null) && (
                    <div className="flex items-start gap-2 rounded border border-warning bg-warning-surface px-3 py-2">
                      <AlertTriangle
                        size={13}
                        strokeWidth={1.8}
                        className="mt-0.5 flex-none text-warning-text"
                      />
                      <p className="text-xs leading-relaxed text-warning-text">
                        {"Git identity is not configured — the first commit will fail. Set user.name and user.email, or turn the toggle off."}
                      </p>
                    </div>
                  )}

                <button
                  onClick={doInit}
                  disabled={phase === "initializing" || !branchIsValid}
                  className={`${PRIMARY_BTN} self-start`}
                >
                  {phase === "initializing" ? "· · ·" : "Initialize a git repository here"}
                </button>
                <p className="text-xs leading-relaxed text-content-muted">
                  {makeCommit
                    ? "Runs git init, appends Cowtext's lines to .gitignore, and makes one commit — no remote, no push."
                    : "Runs git init and nothing else — no commit, no remote, no first add."}
                </p>
              </div>
            )}

          {status !== null &&
            phase !== "loading" &&
            phase !== "error" &&
            status.gitAvailable &&
            status.isRepo && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs text-content-secondary">
                  <span className="rounded-sm border border-success bg-success-surface px-1.5 py-px font-mono text-micro text-success-text">
                    repo
                  </span>
                  {status.branch !== null && (
                    <span className="font-mono text-content-muted">{status.branch}</span>
                  )}
                  {/* Only after THIS dialog initialised the repo — the
                      envelope is the only honest source for "did a commit
                      happen", and a pre-existing repo never gets one. The
                      tone follows the answer: "no commits" is not a success,
                      it is the state a failed first commit leaves behind. */}
                  {initResult !== null && (
                    <span
                      className={`font-mono ${
                        initResult.committed ? "text-success-text" : "text-warning-text"
                      }`}
                    >
                      {initResult.committed ? "1 commit" : "no commits"}
                    </span>
                  )}
                  {status.gitVersion !== null && (
                    <span className="font-mono text-content-disabled">{status.gitVersion}</span>
                  )}
                </div>

                {/* The Retry shape (WO15 fix round, tester #3): `git init`
                    succeeded, the commit did not, and the second press found
                    a repo — so `git_init` took the D-15 skip path and can
                    never commit into it from here. Say what actually
                    happened and name the way out, instead of a green badge
                    over an empty history. */}
                {initResult !== null &&
                  initResult.skippedExistingRepo &&
                  initResult.commitCount === 0 && (
                    <div className="flex items-start gap-2 rounded border border-warning bg-warning-surface px-3 py-2">
                      <AlertTriangle
                        size={13}
                        strokeWidth={1.8}
                        className="mt-0.5 flex-none text-warning-text"
                      />
                      <p className="text-xs leading-relaxed text-warning-text">
                        {"Repository exists but has no commits yet — commit from your terminal (git add -A && git commit)."}
                      </p>
                    </div>
                  )}

                <div>
                  <p className="mb-1.5 font-mono text-2xs uppercase tracking-wider text-content-muted">
                    .gitignore presets
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {GITIGNORE_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        role="checkbox"
                        aria-checked={selectedPresets.has(p.key)}
                        onClick={() => togglePreset(p.key)}
                        className={`flex h-control-sm items-center gap-1.5 rounded border px-2 font-mono text-xs transition-colors duration-fast ${
                          selectedPresets.has(p.key)
                            ? "border-accent-border bg-accent-surface text-accent-text"
                            : "border-border bg-surface-2 text-content-muted hover:border-border-strong"
                        }`}
                      >
                        <CheckSquare
                          checked={selectedPresets.has(p.key)}
                          label={p.label}
                          interactive={false}
                        />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 font-mono text-2xs uppercase tracking-wider text-content-muted">
                    extra lines
                  </p>
                  <textarea
                    value={extraText}
                    onChange={(e) => {
                      setReviewed(false);
                      setExtraText(e.target.value);
                    }}
                    placeholder={"*.local\nsecrets/"}
                    rows={2}
                    className="w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs leading-relaxed text-content placeholder:text-content-disabled focus:border-accent"
                  />
                </div>

                <div>
                  <p className="mb-1 font-mono text-2xs uppercase tracking-wider text-content-muted">
                    {status.gitignoreExists ? ".gitignore diff" : "new .gitignore"}
                  </p>
                  <DiffView hunks={hunks} />
                  {willNormalizeLineEndings && (
                    <p className="mt-1 text-2xs leading-snug text-content-muted">
                      Existing line endings (CRLF) will be normalized to LF on write — some of the
                      lines above differ only in that, not in content.
                    </p>
                  )}
                </div>

                <label className="flex items-center gap-2">
                  <CheckSquare
                    checked={reviewed}
                    disabled={!hasChanges}
                    label="I've reviewed this diff"
                    onToggle={() => setReviewed((v) => !v)}
                  />
                  <span className="text-xs text-content-secondary">I&apos;ve reviewed this diff</span>
                </label>
              </div>
            )}

          {phase === "written" && (
            <p className="text-sm text-content-secondary">
              <span className="text-success-text">.gitignore written.</span> Select more presets to
              add another batch, or close this dialog.
            </p>
          )}
        </div>

        <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
            {status !== null && status.gitAvailable && status.isRepo
              ? hasChanges
                ? "Nothing is written until you review and approve."
                : "No new lines to add."
              : ""}
          </span>
          <button ref={cancelRef} onClick={onClose} disabled={!canClose} className={SECONDARY_BTN}>
            {phase === "written" ? "Close" : "Cancel"}
          </button>
          {status !== null && status.gitAvailable && status.isRepo && phase !== "written" && (
            <button
              onClick={doWrite}
              disabled={!hasChanges || !reviewed || phase === "writing"}
              className={PRIMARY_BTN}
            >
              {phase === "writing" ? "· · ·" : "Write .gitignore"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
