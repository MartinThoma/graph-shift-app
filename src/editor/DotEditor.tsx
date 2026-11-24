import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { DotError } from "../state/store";
import { dotHighlightStyle, dotLanguage } from "./dotLanguage";

const External = Annotation.define<boolean>();

export interface DotEditorHandle {
  focusAt: (offset: number) => void;
}

interface DotEditorProps {
  value: string;
  error: DotError | null;
  onChange: (value: string) => void;
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--white)", color: "var(--ink)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "22px", fontVariantLigatures: "none" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0 16px 0 6px" },
  ".cm-gutters": { backgroundColor: "var(--white)", color: "var(--muted-2)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 14px", minWidth: "36px" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--active-line)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--grid-major)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--accent)",
    textUnderlineOffset: "3px",
  },
  ".cm-gutter-lint": { width: "10px" },
  ".cm-lint-marker-error": { content: "none" },
  ".cm-tooltip": { border: "1px solid var(--ink)", backgroundColor: "var(--white)", fontFamily: "var(--font-ui)", fontSize: "13px" },
  ".cm-diagnostic-error": { borderLeft: "1px solid var(--accent)" },
});

/** CodeMirror-based DOT editor. Typing reports changes; external value changes are applied as minimal diffs. */
export const DotEditor = forwardRef<DotEditorHandle, DotEditorProps>(function DotEditor({ value, error, onChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          lintGutter(),
          dotLanguage,
          dotHighlightStyle,
          editorTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "DOT source", spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(External))) return;
            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply external changes (UI write-back, undo/redo) as a minimal diff.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    let start = 0;
    while (start < current.length && start < value.length && current[start] === value[start]) start++;
    let endCurrent = current.length;
    let endValue = value.length;
    while (endCurrent > start && endValue > start && current[endCurrent - 1] === value[endValue - 1]) {
      endCurrent--;
      endValue--;
    }
    view.dispatch({
      changes: { from: start, to: endCurrent, insert: value.slice(start, endValue) },
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
      scrollIntoView: false,
    });
  }, [value]);

  // Error diagnostics.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const length = view.state.doc.length;
    const diagnostics = error
      ? [
          {
            from: Math.min(error.offset, length),
            to: Math.min(length, Math.max(error.offset + 1, findTokenEnd(view.state.doc.toString(), error.offset))),
            severity: "error" as const,
            message: error.message,
          },
        ]
      : [];
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [error, value]);

  useImperativeHandle(ref, () => ({
    focusAt(offset: number) {
      const view = viewRef.current;
      if (!view) return;
      const pos = Math.min(offset, view.state.doc.length);
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
      view.focus();
    },
  }));

  return <div className="dot-editor" ref={hostRef} />;
});

function findTokenEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && !/[\s;,\[\]{}=]/.test(text[i])) i++;
  return i;
}
