import { useEffect, useRef, useState } from "react";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import {
  foldGutter,
  foldKeymap,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  tooltips,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { latex as latexLanguageSupport } from "codemirror-lang-latex";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import type { LatexSourceDraftResult } from "../clipboard/latexSourceParse";
import { toPortableBoldLatex } from "../clipboard/portableBoldLatex";
import { kernelLatexEditingExtensions } from "./latexSourceEditorSupport";
import {
  isTypingCommandName,
  latexSourceCompletion,
  latexSourceCompletionTheme,
} from "./latexSourceCompletion";
import styles from "./LatexSourceEditor.module.css";

const kernelLatexHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.definitionKeyword,
      tags.macroName,
      tags.labelName,
      tags.heading,
    ],
    color: "var(--syntax-command)",
  },
  {
    tag: [tags.className, tags.typeName, tags.namespace],
    color: "var(--syntax-function)",
    fontWeight: "650",
  },
  {
    tag: [tags.strong, tags.emphasis, tags.monospace],
    color: "var(--syntax-command)",
    fontWeight: "600",
  },
  {
    tag: [tags.operator, tags.processingInstruction],
    color: "var(--syntax-operator)",
  },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.bracket, color: "var(--syntax-bracket)" },
  { tag: [tags.string, tags.quote, tags.meta], color: "var(--syntax-string)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.variableName, tags.content], color: "var(--syntax-variable)" },
  { tag: tags.invalid, color: "var(--syntax-error)", textDecoration: "underline" },
]);

const externalSourceSync = Annotation.define<boolean>();
interface SourceDraftStatus {
  dirty: boolean;
  error: string | null;
  hasLivePreview: boolean;
}
const syncedDraft: SourceDraftStatus = { dirty: false, error: null, hasLivePreview: true };

interface Props {
  latex: string;
  /** The edited source; the result says whether it was taken over and how it previews. */
  onLiveChange: (latex: string) => LatexSourceDraftResult;
  onFocusChange: (focused: boolean) => void;
  forceExternalSync: boolean;
}

/** The source dock's CodeMirror editor: edits go to the rows as they are typed. */
export function LatexSourceEditor({
  latex,
  onLiveChange,
  onFocusChange,
  forceExternalSync,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // CodeMirror owns draft text. This baseline is the last accepted source;
  // canonicalSourceRef is the current serialization of the visual document.
  const acceptedSourceRef = useRef(latex);
  const canonicalSourceRef = useRef(latex);
  canonicalSourceRef.current = latex;
  const statusRef = useRef(syncedDraft);
  // A command name being typed is applied once its completion list closes: half typed, the \b of \begin outside
  // math would turn the row into text for a moment.
  const draftHeldRef = useRef(false);
  const [status, setStatus] = useState(syncedDraft);
  const { dirty, error: syncError, hasLivePreview } = status;
  const onLiveChangeRef = useRef(onLiveChange);
  const onFocusChangeRef = useRef(onFocusChange);
  const focusReleaseFrameRef = useRef<number | null>(null);
  const isEn = useEditorStore((state) => state.language) === "en";
  onLiveChangeRef.current = onLiveChange;
  onFocusChangeRef.current = onFocusChange;

  const updateStatus = (next: SourceDraftStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const publishDraft = (value: string) => {
    draftHeldRef.current = false;
    const result = onLiveChangeRef.current(value);
    const preview = result.valid || result.values.length > 0 || Boolean(result.previewValues?.length);
    if (preview) acceptedSourceRef.current = value;
    updateStatus({
      dirty: !preview && value !== acceptedSourceRef.current,
      error: result.valid ? null : result.error ?? "invalid-latex",
      hasLivePreview: preview,
    });
  };

  const syncDocument = (view: EditorView, value: string) => {
    draftHeldRef.current = false;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: [externalSourceSync.of(true), Transaction.addToHistory.of(false)],
      });
    }
    acceptedSourceRef.current = value;
    updateStatus(syncedDraft);
  };

  useEffect(() => {
    if (!hostRef.current) return;

    const editorTheme = EditorView.theme({
      "&": {
        height: "100%",
        backgroundColor: "transparent",
        color: "var(--text)",
      },
      ".cm-scroller": {
        overflow: "auto",
        overscrollBehavior: "contain",
        scrollbarGutter: "stable",
      },
      ".cm-content": {
        caretColor: "var(--accent)",
        fontFamily: "var(--font-code)",
        fontSize: "var(--source-editor-font-size)",
        lineHeight: "1.62",
        padding: "10px 0 18px",
      },
      ".cm-line": {
        paddingInline: "4px 10px",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--text-faint)",
        border: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "32px",
        paddingInline: "6px 7px",
      },
      ".cm-foldGutter .cm-gutterElement": {
        width: "18px",
        paddingInline: "1px",
        color: "var(--text-faint)",
        cursor: "pointer",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "color-mix(in srgb, var(--accent-soft) 45%, transparent)",
        color: "var(--text-muted)",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--accent-soft) 32%, transparent)",
      },
      ".cm-focused": { outline: "none" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor:
          "color-mix(in srgb, var(--accent) 22%, transparent) !important",
      },
      ".cm-matchingBracket": {
        backgroundColor: "color-mix(in srgb, var(--syntax-bracket) 18%, transparent)",
        outline: "1px solid color-mix(in srgb, var(--syntax-bracket) 55%, transparent)",
        borderRadius: "2px",
      },
      ".cm-latex-indent-guide": {
        backgroundImage:
          "linear-gradient(to right, transparent calc(2ch - 1px), color-mix(in srgb, var(--border-strong) 58%, transparent) calc(2ch - 1px), color-mix(in srgb, var(--border-strong) 58%, transparent) 2ch)",
        backgroundSize: "2ch 100%",
      },
      ".cm-latex-command-default, .cm-latex-command-structure, .cm-latex-command-calculus, .cm-latex-command-matrix, .cm-latex-command-greek, .cm-latex-command-relation, .cm-latex-command-set, .cm-latex-command-arrow, .cm-latex-command-physics": {
        fontWeight: "600",
      },
      ".cm-latex-command-default, .cm-latex-command-structure": {
        color: "var(--syntax-command)",
      },
      ".cm-latex-command-calculus": { color: "var(--syntax-number)" },
      ".cm-latex-command-matrix": { color: "var(--syntax-function)" },
      ".cm-latex-command-greek": { color: "var(--syntax-string)" },
      ".cm-latex-command-relation": { color: "var(--syntax-error)" },
      ".cm-latex-command-set": { color: "var(--syntax-bracket)" },
      ".cm-latex-command-arrow": {
        color:
          "color-mix(in srgb, var(--syntax-command) 45%, var(--syntax-function))",
      },
      ".cm-latex-command-physics": {
        color:
          "color-mix(in srgb, var(--syntax-bracket) 55%, var(--syntax-string))",
      },
    });

    const state = EditorState.create({
      doc: canonicalSourceRef.current,
      extensions: [
        lineNumbers(),
        foldGutter({ openText: "⌄", closedText: "›" }),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        keymap.of([indentWithTab, ...foldKeymap, ...defaultKeymap, ...historyKeymap]),
        // The package's own completion is a generic document list (\section,
        // \cite, ...) that inserts bare commands; TexType supplies its own.
        // Environments are closed by TexType's Enter binding too (kernelLatexEditingExtensions): the
        // package's Enter binding came after the default keymap and never ran, and its } binding left the brace
        // the editor had paired behind \end{...}.
        latexLanguageSupport({
          enableLinting: false,
          enableTooltips: false,
          enableAutocomplete: false,
          autoCloseTags: false,
        }),
        latexSourceCompletion,
        latexSourceCompletionTheme,
        // Fixed tooltips are not clipped by the source panel's scroll box.
        tooltips({ position: "fixed" }),
        kernelLatexEditingExtensions,
        syntaxHighlighting(kernelLatexHighlightStyle),
        EditorView.contentAttributes.of({
          spellcheck: "false",
          autocapitalize: "off",
          autocomplete: "off",
          "data-gramm": "false",
        }),
        editorTheme,
        EditorView.lineWrapping,
        // Copied source leaves the app as portable LaTeX (\mathbfit and \bm
        // become \boldsymbol); the source itself is left as it is.
        EditorView.domEventHandlers({
          copy(event, view) {
            const selected = view.state.selection.ranges
              .filter((range) => !range.empty)
              .map((range) => view.state.sliceDoc(range.from, range.to))
              .join(view.state.lineBreak);
            const portable = toPortableBoldLatex(selected);
            if (!selected || portable === selected || !event.clipboardData) return false;
            event.clipboardData.setData("text/plain", portable);
            event.preventDefault();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.focusChanged) {
            if (focusReleaseFrameRef.current !== null) {
              window.cancelAnimationFrame(focusReleaseFrameRef.current);
              focusReleaseFrameRef.current = null;
            }
            if (update.view.hasFocus) {
              onFocusChangeRef.current(true);
            } else {
              focusReleaseFrameRef.current = window.requestAnimationFrame(() => {
                focusReleaseFrameRef.current = null;
                const view = viewRef.current;
                if (!view || view.hasFocus) return;
                if (draftHeldRef.current) publishDraft(view.state.doc.toString());
                onFocusChangeRef.current(false);
                if (statusRef.current.error || !statusRef.current.hasLivePreview) return;
                syncDocument(view, canonicalSourceRef.current);
              });
            }
          }
          if (update.transactions.some(tr => tr.annotation(externalSourceSync))) return;
          if (update.docChanged) {
            if (isTypingCommandName(update.state)) draftHeldRef.current = true;
            else publishDraft(update.state.doc.toString());
          } else if (draftHeldRef.current && !isTypingCommandName(update.state)) {
            publishDraft(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      if (focusReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(focusReleaseFrameRef.current);
        focusReleaseFrameRef.current = null;
      }
      if (view.hasFocus) {
        onFocusChangeRef.current(false);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!forceExternalSync && (view.hasFocus || statusRef.current.error)) return;
    syncDocument(view, latex);
  }, [forceExternalSync, latex]);

  const replaceDraft = (value: string) => {
    const view = viewRef.current;
    if (!view) return;
    syncDocument(view, value);
    publishDraft(value);
  };

  return (
    <section className={styles.panel} data-source-editor data-error={syncError ? "" : undefined}>
      {(dirty || syncError) && (
        <div className={styles.header}>
          {syncError && (
            <span className={styles.error}>
              <AlertTriangle size={12} />
              {syncError === "incomplete-format-wrapper"
                ? isEn
                  ? "Incomplete wrapper"
                  : "环境包裹未完成"
                : isEn
                  ? "Unvalidated source preview"
                  : "源码未通过校验，仅预览"}
            </span>
          )}
          <div className={styles.actions}>
            {(dirty || (syncError && !hasLivePreview)) && (
              <button
                type="button"
                className={styles.reset}
                data-source-reset
                onClick={() => replaceDraft(latex)}
              >
                <RotateCcw size={14} /> {isEn ? "Reset" : "还原"}
              </button>
            )}
          </div>
        </div>
      )}
      <div ref={hostRef} className={styles.code} />
    </section>
  );
}
