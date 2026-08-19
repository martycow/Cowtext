// Thin React binding for CodeMirror 6 — no third-party wrapper (task rule).
// The view is created once per `docKey` (the file identity); the parent
// mirrors the document through onChange and owns saving.

import { useEffect, useRef } from "react";
import { EditorState, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
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
    // N1 chips — resolved mention is the accent (a link into the graph);
    // unresolved is muted with a dashed hint border, never the same visual
    // weight as a real chip so it doesn't read as clickable-and-broken.
    ".cm-at-mention": {
      cursor: "pointer",
      borderRadius: "var(--r-xs)",
      padding: "0 3px",
      border: "1px solid var(--accent-border)",
      backgroundColor: "var(--accent-surface)",
      color: "var(--accent-text)",
    },
    ".cm-at-mention:hover": { borderColor: "var(--accent)" },
    ".cm-at-mention-muted": {
      cursor: "default",
      border: "1px dashed var(--border-strong)",
      backgroundColor: "transparent",
      color: "var(--text-muted)",
    },
    ".cm-at-mention-muted:hover": { borderColor: "var(--border-strong)" },
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

// ── @path mention chips (N1) ────────────────────────────────────────
// A mark decoration over `@some/rel/path.md` tokens — chip-styled but
// still part of the editable text (no widget swap, so typing around it
// stays ordinary CodeMirror editing). Click focuses the resolved node;
// shift-click offers "add a references edge" from the node this editor
// is open on. Resolution is read fresh from the graph store at
// interaction time (never staled by the editor's own lifecycle); the
// chip's exists/muted styling is rebuilt whenever `mentionsKey` changes
// (see the effect below) so a node adopted after the editor opened still
// lights the chip up without a full editor rebuild.

const AT_MENTION_RE = /(?<![\w@])@([A-Za-z0-9_][\w./-]*\.md)\b/g;

export interface AtMentionHandlers {
  /** Node id for a relative .md path, or null when no node points at it. */
  resolve: (path: string) => string | null;
  /** True if a `references` edge already exists to `targetNodeId`. */
  hasReferenceEdge: (targetNodeId: string) => boolean;
  /** Select `nodeId` and switch the Inspector to its Properties tab. */
  onFocusNode: (nodeId: string) => void;
  /** Add a `references` edge from the editor's node to `targetNodeId`. */
  onAddReference: (targetNodeId: string) => void;
}

const forceAtMentionRedecorate = StateEffect.define<null>();

function buildAtMentionDecorations(
  view: EditorView,
  handlers: AtMentionHandlers | null,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (handlers === null) return builder.finish();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    AT_MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AT_MENTION_RE.exec(text)) !== null) {
      const path = m[1];
      const start = from + m.index;
      const end = start + m[0].length;
      const nodeId = handlers.resolve(path);
      const exists = nodeId !== null;
      builder.add(
        start,
        end,
        Decoration.mark({
          class: exists ? "cm-at-mention" : "cm-at-mention cm-at-mention-muted",
          attributes: {
            "data-at-path": path,
            title: exists
              ? "Click to focus the node · Shift-click to add a references edge"
              : "no node for this file",
          },
        }),
      );
    }
  }
  return builder.finish();
}

function atMentionExtension(handlersRef: { current: AtMentionHandlers | null }) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildAtMentionDecorations(view, handlersRef.current);
      }
      update(u: ViewUpdate) {
        const forced = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(forceAtMentionRedecorate)),
        );
        if (u.docChanged || u.viewportChanged || forced) {
          this.decorations = buildAtMentionDecorations(u.view, handlersRef.current);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(event) {
          const target =
            event.target instanceof HTMLElement ? event.target.closest(".cm-at-mention") : null;
          if (!(target instanceof HTMLElement)) return false;
          const handlers = handlersRef.current;
          const path = target.dataset.atPath;
          if (handlers === null || path === undefined) return false;
          const nodeId = handlers.resolve(path);
          event.preventDefault();
          if (nodeId === null) return true; // muted — swallow, no cursor jump
          if (event.shiftKey) {
            if (!handlers.hasReferenceEdge(nodeId)) handlers.onAddReference(nodeId);
          } else {
            handlers.onFocusNode(nodeId);
          }
          return true;
        },
      },
    },
  );
}

interface Props {
  /** Identity of the document; a new key rebuilds the editor state. */
  docKey: string;
  /** Initial document for the current docKey. */
  value: string;
  onChange: (doc: string) => void;
  /** Invoked on Mod-S. */
  onSave: () => void;
  /** @path chip support (N1) — omit to disable. */
  atMentions?: AtMentionHandlers;
  /** Bump (any string derived from the resolution universe, e.g. the
   *  sorted node id:filePath list) to force chip re-decoration without
   *  rebuilding the editor state. */
  mentionsKey?: string;
}

export function CodeMirrorEditor({ docKey, value, onChange, onSave, atMentions, mentionsKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  const atMentionsRef = useRef<AtMentionHandlers | null>(atMentions ?? null);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  valueRef.current = value;
  atMentionsRef.current = atMentions ?? null;

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
        atMentionExtension(atMentionsRef),
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

  // The resolution universe (which paths have a node) can change without
  // the document changing — re-decorate chips in place, no state rebuild.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: forceAtMentionRedecorate.of(null) });
  }, [mentionsKey]);

  return <div ref={hostRef} className="h-full min-h-0 select-text overflow-hidden" />;
}
