// Thin React binding for CodeMirror 6 — no third-party wrapper (task rule).
// The view is created once per `docKey` (the file identity); the parent
// mirrors the document through onChange and owns saving.

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Styled with our tokens, not a stock theme (DESIGN_SPEC.md owns the palette).
const cowtextTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--surface-inset)",
      color: "var(--text-primary)",
      fontSize: "12px",
      height: "100%",
    },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
    ".cm-content": { caretColor: "var(--accent)", padding: "8px 0" },
    ".cm-line": { padding: "0 12px" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "var(--accent-surface)" },
    ".cm-activeLine": { backgroundColor: "rgba(255,240,220,.03)" },
    ".cm-gutters": {
      backgroundColor: "var(--surface-inset)",
      color: "var(--text-disabled)",
      border: "none",
      fontSize: "10.5px",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-muted)" },
  },
  { dark: true },
);

const mdHighlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--text-primary)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent-text)" },
  { tag: t.url, color: "var(--accent-text)" },
  { tag: t.monospace, color: "var(--amber-text)" },
  { tag: t.quote, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: t.meta, color: "var(--text-muted)" },
  { tag: t.processingInstruction, color: "var(--text-muted)" },
  { tag: t.contentSeparator, color: "var(--text-muted)" },
  { tag: t.comment, color: "var(--text-muted)" },
]);

interface Props {
  /** Identity of the document; a new key rebuilds the editor state. */
  docKey: string;
  /** Initial document for the current docKey. */
  value: string;
  onChange: (doc: string) => void;
  /** Invoked on Mod-S. */
  onSave: () => void;
}

export function CodeMirrorEditor({ docKey, value, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  valueRef.current = value;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        cowtextTheme,
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ parent: host, state });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [docKey]);

  return <div ref={hostRef} className="h-full min-h-0 select-text overflow-hidden" />;
}
