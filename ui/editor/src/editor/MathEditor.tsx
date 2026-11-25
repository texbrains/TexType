import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import { installCustomSymbolGlobalStyle } from "@app/kernel/render/custom-symbol-rendering.ts";
import { useHistoryManager } from "../history/EditorSession";
import type { MathSelectionSnapshot } from "../history/historyTypes";
import { useEditorStore } from "../stores/editorStore";
import type { FormulaAlignment, FormulaLine } from "../types/formula";
import { useAlignmentLayout } from "./alignmentLayout";
import type {
  MathEditorHandle,
  MathEditorInsertionTarget,
  MathEditorSelectionTarget,
  MultiLineSelectionState,
  PendingFocus,
  PointerSelectionSession,
  RowsEditorContext,
} from "./editorTypes";
import { FormulaField } from "./FormulaField";
import {
  FormulaFieldErrorBoundary,
  FormulaFieldRenderFallback,
} from "./FormulaFieldErrorBoundary";
import { kernelSourcePreviewClass } from "./formulaFieldStyles";
import {
  configureMathLiveCompletion,
  dismissMathLiveSuggestions,
  type MathLivePersistentTypingStyle,
} from "./mathLiveKernelCommands";
import {
  inspectMathLiveSourceSafety,
  mathLiveSourceSafetyMessage,
} from "./mathLiveSourceSafety";
import { createRowEdits } from "./rowEdits";
import { createRowFocus } from "./rowFocus";
import { createRowKeyHandler } from "./rowKeys";
import { createRowStructure } from "./rowStructure";
import { createRowsDrag } from "./rowsDrag";
import { createRowsSelection } from "./rowsSelection";
import { useRowsPointer } from "./useRowsPointer";

export type {
  MathEditorFocusOptions,
  MathEditorHandle,
  MathEditorInsertionTarget,
  MathEditorSelectionStyle,
  MathEditorSelectionTarget,
} from "./editorTypes";
import styles from "./MathEditor.module.css";

interface Props {
  lines: FormulaLine[];
  activeLineId: string | null;
  formulaAlignment: FormulaAlignment;
  zoom: number;
  persistentTypingStyle: MathLivePersistentTypingStyle;
  /** The rows show the formulas only: the LaTeX source view has the focus. */
  previewOnly?: boolean;
  /** A press on the source preview: the rows take the focus back. Unset: the source view keeps it. */
  onPreviewActivate?: () => void;
  draftError?: string;
  /** An image pasted into a row, with the target its recognized LaTeX goes to (see insertLatexAt). */
  onPasteImage?: (file: File, target: MathEditorInsertionTarget) => void;
}

/** The formula rows editor: one FormulaField per row, edits and selections across rows, undo/redo steps. */
export const MathEditor = forwardRef<MathEditorHandle, Props>(
  function MathEditor(
    {
      lines,
      activeLineId,
      formulaAlignment,
      zoom,
      persistentTypingStyle,
      previewOnly = false,
      onPreviewActivate,
      draftError,
      onPasteImage,
    },
    ref,
  ) {
    // the editor's session history
    const history = useHistoryManager();
    const surfaceRef = useRef<HTMLDivElement>(null);
    const fieldRefs = useRef(new Map<string, MathfieldElement>());
    const linesRef = useRef(lines);
    const activeIndexRef = useRef(0);
    const activeLineIdRef = useRef<string | null>(activeLineId);
    const focusRequestRef = useRef(0);
    const pendingFocusRef = useRef<PendingFocus | null>(null);
    const previewOnlyRef = useRef(previewOnly);
    const greekPrefixLineIdRef = useRef<string | null>(null);
    const suppressedHistoryLineIdRef = useRef<string | null>(null);
    const multiLineSelectionRef = useRef<MultiLineSelectionState | null>(null);
    const multiLineSelectionLatexRef = useRef(new Map<string, string>());
    const multiLineSelectedIdsRef = useRef(new Set<string>());
    const documentSelectionRef = useRef<Record<
      string,
      MathSelectionSnapshot
    > | null>(null);
    const documentSelectionNavigationRef = useRef<string | null>(null);
    const lastSelectionTargetRef = useRef<MathEditorSelectionTarget | null>(
      null,
    );
    const pointerSelectionSessionRef = useRef<PointerSelectionSession | null>(
      null,
    );
    const [, setMultiLineSelectionRevision] = useState(0);
    const [, setActiveIndex] = useState(() =>
      Math.max(
        0,
        lines.findIndex((line) => line.id === activeLineId),
      ),
    );
    const usage = useEditorStore((state) => state.usage);
    const personalize = useEditorStore((state) => state.personalize);
    const suggestionCount = useEditorStore((state) => state.suggestionCount);
    const recordCommand = useEditorStore((state) => state.recordCommand);
    const language = useEditorStore((state) => state.language);
    const autoPairDelimiters = useEditorStore(
      (state) => state.autoPairDelimiters,
    );
    const showLineNumbers = useEditorStore((state) => state.showLineNumbers);
    const formulaInsetLeft = useEditorStore((state) => state.formulaInsetLeft);
    const formulaInsetRight = useEditorStore(
      (state) => state.formulaInsetRight,
    );
    const formulaRowVerticalInset = useEditorStore(
      (state) => state.formulaRowVerticalInset,
    );
    const formulaLetterFont = useEditorStore(
      (state) => state.formulaLetterFont,
    );
    const formulaChineseFont = useEditorStore(
      (state) => state.formulaChineseFont,
    );
    const latexFormatProfile = useEditorStore(
      (state) => state.latexFormatProfile,
    );
    const interactionReadOnly = previewOnly;
    previewOnlyRef.current = previewOnly;

    linesRef.current = lines;
    activeLineIdRef.current =
      lines.find((line) => line.id === activeLineId)?.id ??
      lines[0]?.id ??
      null;

    const ctx: RowsEditorContext = {
      history,
      surfaceRef,
      fieldRefs,
      linesRef,
      activeIndexRef,
      activeLineIdRef,
      focusRequestRef,
      pendingFocusRef,
      setActiveIndex,
      suppressedHistoryLineIdRef,
      lastSelectionTargetRef,
      greekPrefixLineIdRef,
      multiLineSelectionRef,
      multiLineSelectionLatexRef,
      multiLineSelectedIdsRef,
      documentSelectionRef,
      documentSelectionNavigationRef,
      pointerSelectionSessionRef,
      bumpSelectionRevision: () =>
        setMultiLineSelectionRevision((revision) => revision + 1),
      readOnly: interactionReadOnly,
      latexFormatProfile,
      recordCommand,
    };
    const focus = createRowFocus(ctx);
    const selection = createRowsSelection(ctx, focus);
    const edits = createRowEdits(ctx, focus, selection);
    const structure = createRowStructure(ctx, focus, selection);
    const drag = createRowsDrag(ctx, focus, selection);
    const handleKeyDown = createRowKeyHandler(
      ctx,
      focus,
      selection,
      edits,
      structure,
    );
    useRowsPointer(
      ctx,
      focus,
      selection,
      drag,
      edits,
      previewOnlyRef,
      onPreviewActivate,
    );
    useAlignmentLayout(
      fieldRefs,
      linesRef,
      latexFormatProfile.multilineEnvironment === "align",
      formulaAlignment,
      [
        formulaInsetLeft,
        formulaInsetRight,
        formulaRowVerticalInset,
        lines,
        showLineNumbers,
        zoom,
      ],
    );

    useEffect(() => {
      installCustomSymbolGlobalStyle();
    }, []);

    useEffect(() => {
      for (const field of fieldRefs.current.values()) {
        configureMathLiveCompletion(field, {
          usage,
          personalize,
          count: suggestionCount,
        });
      }
    }, [lines, usage, personalize, suggestionCount]);

    useEffect(() => {
      const surface = surfaceRef.current;
      const accepted = (event: Event) => {
        const detail = (event as CustomEvent<{ id: string; query: string }>)
          .detail;
        if (detail?.id) recordCommand(detail.id, detail.query, "candidate");
      };
      surface?.addEventListener("kernel-command-accepted", accepted);
      return () =>
        surface?.removeEventListener("kernel-command-accepted", accepted);
    }, [recordCommand]);

    // The source preview: the fields read-only, without caret, selection or candidates.
    useLayoutEffect(() => {
      const fields = Array.from(fieldRefs.current.values()).filter(
        (field) => field.isConnected,
      );

      if (!previewOnly) {
        for (const field of fields) {
          field.classList.remove(kernelSourcePreviewClass);
          field.readOnly = false;
        }
        return;
      }

      focus.commitPendingVisualTransaction();
      lastSelectionTargetRef.current = null;
      pointerSelectionSessionRef.current = null;
      selection.clearMultiLineSelection();

      for (const field of fields) {
        field.classList.add(kernelSourcePreviewClass);
        field.readOnly = true;
        const position = Math.max(
          0,
          Math.min(field.position, field.lastOffset),
        );
        if (!field.selectionIsCollapsed) {
          field.selection = {
            ranges: [[position, position]],
            direction: "none",
          };
        }
        field.blur();
        field.classList.remove("has-kernel-multi-line-selection");
        field
          .closest<HTMLElement>("[data-line-id]")
          ?.classList.remove("is-multi-line-selected");
        dismissMathLiveSuggestions(field);
      }

      return () => {
        if (previewOnlyRef.current) return;
        for (const field of fields) {
          if (!field.isConnected) continue;
          field.classList.remove(kernelSourcePreviewClass);
          field.readOnly = false;
        }
      };
    }, [lines, previewOnly]);

    // rows changed from outside (the source view, undo) end a selection across them
    useEffect(() => {
      if (!multiLineSelectionRef.current) return;
      const changed = [...multiLineSelectionLatexRef.current].some(
        ([lineId, latex]) => {
          const line = lines.find((item) => item.id === lineId);
          return !line || line.latex !== latex;
        },
      );
      if (changed) selection.clearMultiLineSelection();
    }, [lines]);

    useEffect(() => {
      const lineId =
        lines.find((line) => line.id === activeLineId)?.id ??
        lines[0]?.id ??
        null;
      const index = lineId
        ? Math.max(
            0,
            lines.findIndex((line) => line.id === lineId),
          )
        : 0;
      activeLineIdRef.current = lineId;
      activeIndexRef.current = index;
      setActiveIndex(index);
    }, [lines, activeLineId]);

    useImperativeHandle(ref, () => ({
      insertCommand: edits.insertCommand,
      insertLatexAt: edits.insertLatexAt,
      focus: (options = {}) => {
        const target = options.target ?? "active";
        const lineId =
          target === "first"
            ? linesRef.current[0]?.id
            : target === "last"
              ? linesRef.current.at(-1)?.id
              : (activeLineIdRef.current ?? linesRef.current[0]?.id);
        if (lineId) {
          focus.focusLine(lineId, {
            moveToEnd: options.moveToEnd ?? false,
          });
        }
      },
      getSelectionMap: focus.getSelectionMap,
      // After undo/redo: the row focused with the history's selection. Resolves at once: the history replay ends
      // here, so a key pressed right after undo/redo is a new edit (the focus repairs only an untouched row).
      restoreSelection: async (lineId, latex, restored) => {
        history.commitPendingTransaction();
        return focus.focusLine(lineId, {
          latex,
          selection: restored,
          moveToEnd: !restored,
        });
      },
      captureDocumentSnapshot: () => selection.captureDocumentSnapshot(),
      restoreDocumentSelection: selection.restoreDocumentSelection,
      captureSelectionTarget: selection.captureSelectionTarget,
      captureInsertionTarget: selection.captureInsertionTarget,
      applySelectionStyle: edits.applySelectionStyle,
    }));

    return (
      <div
        ref={surfaceRef}
        className={styles.surface}
        style={
          {
            "--local-inset-left": `${formulaInsetLeft}px`,
            "--local-inset-right": `${formulaInsetRight}px`,
            "--local-row-inset": `${formulaRowVerticalInset}px`,
          } as CSSProperties
        }
        data-alignment={formulaAlignment}
        data-read-only={interactionReadOnly || undefined}
        data-preview={previewOnly || undefined}
        data-source-draft-error={draftError}
        data-active-line-id={activeLineIdRef.current ?? ""}
      >
        <div className={styles.stack}>
          {lines.map((line, index) => {
            const lineId = line.id;
            const safetyIssue = inspectMathLiveSourceSafety(line.latex);
            return (
              <div
                className={styles.row}
                data-active={lineId === activeLineIdRef.current || undefined}
                data-selected={multiLineSelectedIdsRef.current.has(lineId) || undefined}
                data-line-id={lineId}
                key={lineId}
              >
                {safetyIssue ? (
                  <FormulaFieldRenderFallback
                    message={`${mathLiveSourceSafetyMessage(safetyIssue, language)} ${
                      language === "en"
                        ? "The LaTeX source is preserved."
                        : "LaTeX 源码已保留。"
                    }`}
                  />
                ) : (
                  <FormulaFieldErrorBoundary
                    language={language}
                    recoveryKey={[
                      lineId,
                      line.latex,
                      zoom,
                      formulaRowVerticalInset,
                      formulaLetterFont,
                      formulaChineseFont,
                      autoPairDelimiters,
                      previewOnly,
                    ].join("\u0000")}
                  >
                    <FormulaField
                      lineId={lineId}
                      index={index}
                      latex={line.latex}
                      mode={line.mode}
                      displayStyle={line.displayStyle}
                      latexFormatProfile={latexFormatProfile}
                      alignment={formulaAlignment}
                      zoom={zoom}
                      formulaRowVerticalInset={formulaRowVerticalInset}
                      language={language}
                      formulaLetterFont={formulaLetterFont}
                      formulaChineseFont={formulaChineseFont}
                      autoPairDelimiters={autoPairDelimiters}
                      persistentTypingStyle={persistentTypingStyle}
                      readOnly={interactionReadOnly}
                      register={focus.registerField}
                      onEdit={edits.handleFieldEdit}
                      onSelectionChange={selection.rememberSelectionTarget}
                      onCommitPending={focus.commitPendingVisualTransaction}
                      onFocus={() => focus.setActiveLine(lineId)}
                      onKeyDown={(lineIndex, event, field) =>
                        handleKeyDown(lineIndex, lineId, event, field)
                      }
                      onVerticalExit={structure.moveToAdjacentLine}
                      onPasteImage={onPasteImage}
                      onPasteLatexLines={edits.pasteLatexLines}
                      selectionDrag={drag.rowSelectionDrag}
                    />
                  </FormulaFieldErrorBoundary>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
