// Shared "what you get" preview pane (WO13_CONTRACT.md §14.1) — U1's
// second frozen deliverable, mounted into `TwoPaneModal`'s `right` slot by
// both the node wizard (U1) and the agent modal (U3, frozen consumer). This
// is THE preview mechanism — the agent spec forbids a second one outright,
// so nothing here talks to a bespoke renderer: real destination paths, real
// frontmatter, real before/after, all sourced by the caller from the one
// real compiler (`compile_preview`, plus R1's `overlay` for an unsaved
// draft — WO13_CONTRACT.md §10.1). This component only renders what it is
// handed; it does not call `compile_preview` and does not debounce — that
// 150ms debounce is the caller's job, against its own async I/O.
//
// Rendering order inside a file card is FROZEN (§14.1): destination path →
// rendered output → load sentence → token estimate. Output renders through
// CodeMirror in a read-only mode — "syntax-highlighted, read-only" per the
// dispatch means CodeMirror, not a markdown-to-HTML renderer (there is no
// markdown renderer dependency in this repo and adding one is out of
// bounds). `src/inspector/CodeMirrorEditor.tsx` is U4's sole-owned file and
// has no read-only mode today, so rather than cross a foreign zone for a
// one-line prop this file stands up its own minimal, LOCAL read-only
// CodeMirror view using the same installed `@codemirror` packages — not a
// second preview component (there is still exactly one preview mechanism:
// this pane), just this pane's own leaf renderer. Flagged in the lane
// report as a candidate for U4 to fold into a shared `readOnly` prop later.

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { CompileTarget } from "../store/graph";
import type { PreviewFile } from "../compile/types";

// Same palette as CodeMirrorEditor.tsx's `cowtextTheme`/`mdHighlight`, kept
// separate rather than imported — U4's file exports neither, and this pane
// must not reach into another lane's module internals.
const previewTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--surface-inset)",
      color: "var(--text-primary)",
      fontSize: "11.5px",
      height: "100%",
    },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
    ".cm-content": { padding: "6px 0" },
    ".cm-line": { padding: "0 10px" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      backgroundColor: "var(--surface-inset)",
      color: "var(--text-disabled)",
      border: "none",
      fontSize: "10px",
    },
  },
  { dark: true },
);

const previewHighlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--text-primary)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--accent-text)" },
  { tag: t.url, color: "var(--accent-text)" },
  { tag: t.monospace, color: "var(--amber-text)" },
  { tag: t.meta, color: "var(--text-muted)" },
  { tag: t.processingInstruction, color: "var(--text-muted)" },
  { tag: t.contentSeparator, color: "var(--text-muted)" },
  { tag: t.comment, color: "var(--text-muted)" },
]);

/** Read-only CodeMirror leaf — no onChange, no keymap beyond CodeMirror's
 *  built-in read-only defaults. Re-created only when `docKey` changes;
 *  content updates within the same key are applied as a replace transaction
 *  so the view doesn't visibly flash on every debounced preview tick. */
function ReadOnlyMarkdown({ docKey, content }: { docKey: string; content: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        indentOnInput(),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(previewHighlight),
        previewTheme,
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    });
    const view = new EditorView({ parent: host, state });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content applied via dispatch below
  }, [docKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
  }, [content]);

  return <div ref={hostRef} className="max-h-[280px] overflow-auto rounded border border-border-subtle" />;
}

function FileCard({ relPath, content, badge }: { relPath: string; content: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content" title={relPath}>
          → {relPath}
        </span>
        {badge !== undefined && (
          <span className="flex-none rounded-sm border border-border bg-surface-2 px-1 font-mono text-micro text-content-muted">
            {badge}
          </span>
        )}
      </div>
      <ReadOnlyMarkdown docKey={relPath} content={content} />
    </div>
  );
}

function fileBadge(f: PreviewFile): string | undefined {
  if (f.handwritten) return "handwritten";
  if (f.oldContent === null) return "new file";
  if (f.unchanged) return "unchanged";
  return "modified";
}

export interface PreviewTab {
  key: string;
  label: string;
  files: PreviewFile[];
  note?: string;
}

export interface PreviewPaneProps {
  tabs: PreviewTab[];
  activeKey: string;
  onTab: (key: string) => void;
  /** The empty-state worked example (WO13_CONTRACT.md §14.1/C.microExample):
   *  rendered in the SAME visual shape as a real file, never a placeholder. */
  emptyExample?: { relPath: string; content: string };
  /** "Loads when files in `src/api/` are touched" — written from the
   *  user's side, never the raw enum. */
  loadSentence: string;
  tokenEstimate: number;
  /** Never a fabricated path — name the target and say the mapping is
   *  missing (WO13_CONTRACT.md §3.1). */
  missingMapping?: { target: string };
}

const TARGET_LABEL: Partial<Record<CompileTarget | "agent", string>> = {
  claude: "Claude Code",
  agents: "AGENTS.md",
  cursor: "Cursor",
  copilot: "Copilot",
  gemini: "Gemini",
  agent: "Agent file",
};

export function PreviewPane({
  tabs,
  activeKey,
  onTab,
  emptyExample,
  loadSentence,
  tokenEstimate,
  missingMapping,
}: PreviewPaneProps) {
  const active = tabs.find((tb) => tb.key === activeKey) ?? tabs[0];
  // Whether there is anything real to show — false both when `tabs` is
  // empty (no target has produced output at all, e.g. nothing typed yet)
  // and when the active tab exists but is itself empty. Bug fixed here:
  // the old `active === undefined` short-circuit meant `emptyExample` was
  // only ever reachable in the second case, so the empty-state worked
  // example (node spec B2, "the primary anti-confusion device") never
  // rendered at the one moment it exists for — before the user has typed
  // anything, when `tabs` is `[]`. `hasFiles` collapses both cases into one
  // check so `emptyExample` is considered first, regardless of which case
  // produced "nothing to show".
  const hasFiles = active !== undefined && active.files.length > 0;

  return (
    <div aria-live="polite" className="flex h-full min-h-0 flex-col gap-3">
      {/* WO15 Block 1.2: "How this is used" described the mechanism; the
          pane's job is to answer "what do I get?" — the heading now says so.
          The content below is unchanged: real destination paths, real
          rendered output. */}
      <div className="flex flex-none items-center gap-1 font-mono text-2xs uppercase tracking-wider text-content-muted">
        What you get
      </div>

      {/* B2: "If no target is selected yet (step 1), default to Claude Code
          and label the tab area with a quiet note that targets are chosen
          on step 2." Only reachable when there is truly no tab yet — once
          any target has produced output the real tab strip below takes
          over (or nothing renders at all for the single-target case). */}
      {tabs.length === 0 && (
        <p className="flex-none text-2xs leading-snug text-content-muted">
          Showing Claude Code — other targets are chosen on step 2.
        </p>
      )}

      {tabs.length > 1 && (
        <div className="flex flex-none flex-wrap gap-1">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => onTab(tb.key)}
              aria-pressed={tb.key === activeKey}
              className={`flex-none rounded-sm border px-1.5 py-0.5 font-mono text-2xs transition-colors duration-fast ${
                tb.key === activeKey
                  ? "border-accent-border bg-accent-surface text-accent-text"
                  : "border-border bg-surface-2 text-content-muted hover:border-border-strong"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {missingMapping !== undefined && (
          <p className="text-xs leading-snug text-content-muted">
            No mapping for <span className="font-mono">{TARGET_LABEL[missingMapping.target as CompileTarget] ?? missingMapping.target}</span> yet — nothing is produced for this target.
          </p>
        )}

        {!hasFiles && emptyExample !== undefined ? (
          <div className="flex flex-col gap-2">
            <p className="text-2xs leading-snug text-content-muted">
              A worked example — replace it by naming the node.
            </p>
            <FileCard relPath={emptyExample.relPath} content={emptyExample.content} badge="example" />
          </div>
        ) : !hasFiles ? (
          <p className="text-xs leading-snug text-content-muted">Nothing to preview yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {active?.files.map((f) => (
              <FileCard key={f.relPath} relPath={f.relPath} content={f.newContent} badge={fileBadge(f)} />
            ))}
          </div>
        )}

        {active?.note !== undefined && (
          <p className="text-2xs leading-snug text-content-muted">{active.note}</p>
        )}
      </div>

      <div className="flex flex-none items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <span className="min-w-0 flex-1 truncate text-2xs leading-snug text-content-secondary">
          ◷ {loadSentence}
        </span>
        <span className="flex-none font-mono text-2xs text-content-muted">≈{tokenEstimate} tok</span>
      </div>
    </div>
  );
}
