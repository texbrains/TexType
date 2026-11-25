import type { MathfieldElement, Style } from "@app/kernel/kernel/mathlive.ts";
import { isSingleCompleteLatexEnvironment } from "@app/kernel/latex/environment.ts";
import { clampSelection } from "../history/HistoryManager";
import type {
  DocumentSnapshot,
  FormulaEditSource,
  MathSelectionSnapshot,
  ReplaceDocumentEntry,
  ReplaceFormulaEntry,
} from "../history/historyTypes";
import { createFormulaLine, useEditorStore } from "../stores/editorStore";
import type { Command, CommandSource } from "../types/command";
import { isSafeFormulaStyleColor } from "../workspace/formulaColor";
import {
  attemptLatexCommandInsertion,
  prepareLatexCommandInsertion,
} from "./commandInsertion";
import type {
  FormulaFieldEdit,
  MathEditorInsertionTarget,
  MathEditorSelectionStyle,
  MathEditorSelectionTarget,
  RowsEditorContext,
} from "./editorTypes";
import {
  captureFieldSnapshot,
  captureSelection,
  normalizeCompletedUprightDisplay,
  selectionHasContent,
} from "./fieldHelpers";
import {
  insertMathLiveRowBreak,
  paintMathLiveDetachedScripts,
  toggleMathLiveSelectionStyle,
} from "./mathLiveKernelCommands";
import { normalizeChineseLatex } from "./normalizeChineseLatex";
import type { RowFocus } from "./rowFocus";
import type { RowsSelection } from "./rowsSelection";

export type RowEdits = ReturnType<typeof createRowEdits>;

/**
 * Edits inside the rows' formulas as history steps: typed edits, discrete
 * mutations (commands, styles, insertions), and edits that replace a selection
 * across rows.
 */
export function createRowEdits(
  ctx: RowsEditorContext,
  focus: RowFocus,
  selection: RowsSelection,
) {
  const {
    history: historyManager,
    fieldRefs,
    linesRef,
    activeLineIdRef,
    suppressedHistoryLineIdRef,
    lastSelectionTargetRef,
    multiLineSelectionRef,
    documentSelectionRef,
    readOnly: interactionReadOnly,
    recordCommand,
  } = ctx;
  const {
    setActiveLine,
    focusLine,
    resolveTargetField,
    getSelectionMap,
    applyRowsDocument,
  } = focus;
  const {
    clearMultiLineSelection,
    crossRowsSelected,
    captureDocumentSnapshot,
    applyDocumentSelection,
    captureSelectionTarget,
    rowsSelectionBounds,
  } = selection;

  // MathLive owns edits within a formula. The document owns replacing a
  // selection that spans independently mounted formula fields.
  const finishDocumentSelectionEdit = (
    before: ReplaceDocumentEntry["before"],
    lineId: string,
    field: MathfieldElement,
  ) => {
    const line = before.lines.find((item) => item.id === lineId);
    if (!line) return false;
    const selection = captureSelection(field);
    const after: ReplaceDocumentEntry["after"] = {
      ...before,
      lines: [{ ...line, latex: normalizeChineseLatex(field.value) }],
      activeLineId: lineId,
      selectionByLineId: { [lineId]: selection },
    };
    clearMultiLineSelection();
    applyRowsDocument(after);
    setActiveLine(lineId);
    field.selection = selection;
    historyManager.push({
      type: "replace-document",
      before,
      after,
      source: "replace-multi-line",
      timestamp: Date.now(),
    });
    return true;
  };

  /**
   * The edit made in `lineId` (its own part of the selection replaced) replaces the whole selection across
   * rows: the first row's text before the selection and the last row's after it join the edited row, the rows
   * between go (one history step).
   */
  const finishRowsSelectionEdit = (
    before: DocumentSnapshot,
    lineId: string,
    field: MathfieldElement,
  ) => {
    const selection = before.documentSelection;
    if (!selection) return false;
    const indexOf = (id: string) =>
      before.lines.findIndex((line) => line.id === id);
    const anchorIndex = indexOf(selection.anchor.lineId);
    const focusIndex = indexOf(selection.focus.lineId);
    if (anchorIndex < 0 || focusIndex < 0 || anchorIndex === focusIndex)
      return false;
    const startIndex = Math.min(anchorIndex, focusIndex);
    const endIndex = Math.max(anchorIndex, focusIndex);
    const startLine = before.lines[startIndex];
    const endLine = before.lines[endIndex];
    const line = before.lines.find((item) => item.id === lineId);
    const first = fieldRefs.current.get(startLine.id);
    const last = fieldRefs.current.get(endLine.id);
    if (!line || !first?.isConnected || !last?.isConnected) return false;
    // the rows' selections (across rows each end stands at the top level of its formula)
    const prefix =
      lineId === startLine.id
        ? ""
        : first.getValue(
            0,
            Math.min(...first.selection.ranges.flat()),
            "latex",
          );
    const suffix =
      lineId === endLine.id
        ? ""
        : last.getValue(
            Math.max(...last.selection.ranges.flat()),
            last.lastOffset,
            "latex",
          );
    field.kernelInsertDocumentEdges(prefix, suffix);
    const caret = captureSelection(field);
    const latex = normalizeChineseLatex(field.value);
    const lines = [...before.lines];
    lines.splice(startIndex, endIndex - startIndex + 1, { ...line, latex });
    const after: DocumentSnapshot = {
      ...before,
      lines,
      activeLineId: lineId,
      documentSelection: null,
      selectionByLineId: { [lineId]: caret },
    };
    clearMultiLineSelection();
    applyRowsDocument(after);
    setActiveLine(lineId);
    focusLine(lineId, { latex, selection: caret });
    historyManager.push({
      type: "replace-document",
      before,
      after,
      source: "replace-multi-line",
      timestamp: Date.now(),
    });
    return true;
  };

  const handleFieldEdit = (edit: FormulaFieldEdit, field: MathfieldElement) => {
    if (suppressedHistoryLineIdRef.current === edit.lineId) return;
    if (crossRowsSelected() && !historyManager.getState().isReplaying) {
      historyManager.commitPendingTransaction();
      const before = captureDocumentSnapshot();
      before.selectionByLineId[edit.lineId] = edit.beforeSelection;
      before.lines = before.lines.map((line) =>
        line.id === edit.lineId ? { ...line, latex: edit.beforeLatex } : line,
      );
      if (finishRowsSelectionEdit(before, edit.lineId, field)) return;
    }
    if (
      documentSelectionRef.current &&
      !historyManager.getState().isReplaying
    ) {
      historyManager.commitPendingTransaction();
      const before = captureDocumentSnapshot(documentSelectionRef.current);
      if (finishDocumentSelectionEdit(before, edit.lineId, field)) return;
    }
    lastSelectionTargetRef.current = null;
    if (multiLineSelectionRef.current) clearMultiLineSelection();
    const state = useEditorStore.getState();
    const currentLine = state.lines.find((line) => line.id === edit.lineId);
    if (!currentLine) return;
    const beforeActiveLineId = state.activeLineId;
    const beforeLatex = currentLine.latex;

    state.replaceFormulaLine(edit.lineId, edit.afterLatex);
    state.setActiveLineId(edit.lineId);
    linesRef.current = useEditorStore.getState().lines;
    setActiveLine(edit.lineId);

    if (
      historyManager.getState().isReplaying ||
      suppressedHistoryLineIdRef.current === edit.lineId ||
      beforeLatex === edit.afterLatex
    ) {
      return;
    }

    historyManager.recordFormulaEdit({
      ...edit,
      beforeLatex,
      beforeActiveLineId,
      afterActiveLineId: edit.lineId,
    });
  };

  const applyDiscreteFormulaMutation = (
    lineId: string,
    field: MathfieldElement,
    source: FormulaEditSource,
    mutate: () => boolean,
    replaceDocumentSelection = true,
    recordHistory = true,
  ) => {
    historyManager.commitPendingTransaction();
    const state = useEditorStore.getState();
    const currentLine = state.lines.find((line) => line.id === lineId);
    if (!currentLine) return false;

    const documentBefore =
      replaceDocumentSelection && documentSelectionRef.current
        ? captureDocumentSnapshot(documentSelectionRef.current)
        : null;
    const rowsBefore =
      replaceDocumentSelection && !documentBefore && crossRowsSelected()
        ? captureDocumentSnapshot()
        : null;

    const before = captureFieldSnapshot(field);
    const beforeActiveLineId = state.activeLineId;
    suppressedHistoryLineIdRef.current = lineId;
    let changed = false;
    try {
      changed = mutate();
    } finally {
      suppressedHistoryLineIdRef.current = null;
    }
    if (!changed) return false;

    normalizeCompletedUprightDisplay(field);
    const after = captureFieldSnapshot(field);
    if (documentBefore) {
      field.resetUndo();
      return finishDocumentSelectionEdit(documentBefore, lineId, field);
    }
    if (rowsBefore) {
      field.resetUndo();
      if (finishRowsSelectionEdit(rowsBefore, lineId, field)) return true;
    }
    if (before.latex === after.latex) {
      field.resetUndo();
      return true;
    }
    state.replaceFormulaLine(lineId, after.latex);
    state.setActiveLineId(lineId);
    linesRef.current = useEditorStore.getState().lines;
    setActiveLine(lineId);

    field.resetUndo();

    const entry: ReplaceFormulaEntry = {
      type: "replace-formula",
      lineId,
      beforeLatex: before.latex,
      afterLatex: after.latex,
      beforeSelection: before.selection,
      afterSelection: after.selection,
      beforeActiveLineId,
      afterActiveLineId: lineId,
      timestamp: Date.now(),
      source,
    };
    if (recordHistory) historyManager.push(entry);
    return true;
  };

  const applyInFormulaRowBreak = (
    lineId: string,
    field: MathfieldElement,
    environment: "aligned" | "gathered",
  ) => {
    historyManager.commitPendingTransaction();
    const state = useEditorStore.getState();
    const currentLine = state.lines.find((line) => line.id === lineId);
    if (!currentLine) return false;

    const replacesDocument = Boolean(documentSelectionRef.current);
    const before = captureDocumentSnapshot(
      documentSelectionRef.current ?? getSelectionMap(),
    );

    suppressedHistoryLineIdRef.current = lineId;
    let changed = false;
    try {
      changed = insertMathLiveRowBreak(field, environment);
    } finally {
      suppressedHistoryLineIdRef.current = null;
    }
    if (!changed) return false;

    normalizeCompletedUprightDisplay(field);
    const afterLatex = normalizeChineseLatex(field.value);
    const afterSelection = captureSelection(field);
    field.resetUndo();

    const targetLine =
      before.lines.find((line) => line.id === lineId) ?? currentLine;
    const after: ReplaceDocumentEntry["after"] = {
      ...before,
      lines: replacesDocument
        ? [{ ...targetLine, latex: afterLatex, mode: "display" }]
        : before.lines.map((line) =>
            line.id === lineId
              ? { ...line, latex: afterLatex, mode: "display" }
              : { ...line },
          ),
      activeLineId: lineId,
      selectionByLineId: replacesDocument
        ? { [lineId]: afterSelection }
        : {
            ...before.selectionByLineId,
            [lineId]: afterSelection,
          },
    };

    if (replacesDocument) clearMultiLineSelection();
    applyRowsDocument(after);
    setActiveLine(lineId);
    historyManager.push({
      type: "replace-document",
      before,
      after,
      source: "multiline-row-break",
      timestamp: Date.now(),
    });
    return true;
  };

  const insertCommand = (
    command: Command,
    source: CommandSource = "toolbar",
  ) => {
    historyManager.commitPendingTransaction();
    const target = resolveTargetField();
    if (!target) return;
    const { lineId: targetLineId, field } = target;
    setActiveLine(targetLineId);
    field.focus();

    const prepared = prepareLatexCommandInsertion(field, command);
    const insertionTemplate = prepared.insertionTemplate;
    const historySource: FormulaEditSource =
      source === "candidate"
        ? "candidate"
        : source === "shortcut"
          ? "shortcut"
          : "toolbar";

    const tryInsert = () =>
      attemptLatexCommandInsertion(field, prepared, (mutate) =>
        applyDiscreteFormulaMutation(
          targetLineId,
          field,
          historySource,
          mutate,
        ),
      );

    const finishInsertion = () => {
      const normalizedValue = normalizeChineseLatex(field.value);
      recordCommand(command.id, "", source);
      focusLine(targetLineId, {
        latex: normalizedValue,
        selection: captureSelection(field),
        // Placeholder templates already synchronously focus MathLive's keyboard
        // sink after insertion. Replaying that focus/selection 80 ms later can
        // race the user's very first key (notably a physical backslash) before
        // raw-LaTeX mode has had a chance to appear.
        deferredRepair: !insertionTemplate.includes("\\placeholder{}"),
      });
    };

    // one attempt: a failed insertion leaves the formula and its selection as they were
    if (tryInsert()) finishInsertion();
  };

  const pasteLatexLines = (
    lineId: string,
    field: MathfieldElement,
    pastedLines: string[],
  ) => {
    if (pastedLines.length <= 1) return;
    insertMultipleLatexRowsAt(
      { lineId, ...captureSelection(field) },
      pastedLines,
      "paste",
    );
  };

  /**
   * Delete (Backspace, cut) on a selection across rows: the first row's part goes and the rows join there
   * (the last row's text after the selection follows the caret), one history step.
   */
  const deleteMultiLineSelection = () => {
    const selection = multiLineSelectionRef.current;
    if (
      !selection ||
      selection.anchor.lineId === selection.focus.lineId ||
      interactionReadOnly
    )
      return false;
    const indexOf = (lineId: string) =>
      linesRef.current.findIndex((line) => line.id === lineId);
    const anchorIndex = indexOf(selection.anchor.lineId);
    const focusIndex = indexOf(selection.focus.lineId);
    if (anchorIndex < 0 || focusIndex < 0) return false;
    const startLineId =
      anchorIndex < focusIndex
        ? selection.anchor.lineId
        : selection.focus.lineId;
    const field = fieldRefs.current.get(startLineId);
    return Boolean(
      field?.isConnected &&
      applyDiscreteFormulaMutation(
        startLineId,
        field,
        "keyboard",
        () =>
          field.selectionIsCollapsed || field.executeCommand("deleteBackward"),
      ),
    );
  };

  const normalizeInsertedFormulaLines = (latex: string) => {
    const normalized = latex.replace(/\r\n?/g, "\n");
    const trimmed = normalized.trim();
    if (isSingleCompleteLatexEnvironment(trimmed)) {
      return [normalizeChineseLatex(trimmed)];
    }
    return normalized
      .split("\n")
      .map((line) => normalizeChineseLatex(line.trim()))
      .filter(Boolean);
  };

  const applySelectionStyle = (
    style: MathEditorSelectionStyle,
    target: MathEditorSelectionTarget | null = captureSelectionTarget(),
  ) => {
    if (interactionReadOnly || !target?.selections.length) return false;
    if (
      (style.kind === "color" || style.kind === "backgroundColor") &&
      !(style.kind === "backgroundColor" && style.value === "none") &&
      !isSafeFormulaStyleColor(style.value)
    ) {
      return false;
    }
    const resolved = target.selections.flatMap((selectionTarget) => {
      const field = fieldRefs.current.get(selectionTarget.lineId);
      if (!field?.isConnected) return [];
      const selection = clampSelection(
        {
          ranges: selectionTarget.ranges,
          direction: selectionTarget.direction,
        },
        field.lastOffset,
      );
      if (!selectionHasContent(selection)) return [];
      field.selection = selection;
      return [{ lineId: selectionTarget.lineId, field, selection }];
    });
    if (!resolved.length) return false;

    historyManager.commitPendingTransaction();
    const documentBefore =
      resolved.length > 1 ? captureDocumentSnapshot() : null;
    for (const entry of resolved) {
      const { field, lineId } = entry;
      field.selection = entry.selection;
      if (style.kind === "bold" || style.kind === "italic") {
        const toggled = applyDiscreteFormulaMutation(
          lineId,
          field,
          "toolbar",
          () => {
            return toggleMathLiveSelectionStyle(
              field,
              style.kind,
              entry.selection,
            );
          },
          false,
          !documentBefore,
        );
        if (!toggled) field.selection = entry.selection;
        entry.selection = captureSelection(field);
        continue;
      }

      applyDiscreteFormulaMutation(
        lineId,
        field,
        "toolbar",
        () => {
          let mathLiveStyle: Pick<
            Style,
            "variant" | "variantStyle" | "color" | "backgroundColor"
          >;
          if (style.kind === "color") {
            mathLiveStyle = { color: style.value };
          } else {
            mathLiveStyle = { backgroundColor: style.value };
          }
          for (const [start, end] of entry.selection.ranges) {
            const range: [number, number] = [
              Math.min(start, end),
              Math.max(start, end),
            ];
            if (range[0] === range[1]) continue;
            field.applyStyle(mathLiveStyle, {
              range,
              operation: "set",
            });
          }
          paintMathLiveDetachedScripts(field, entry.selection);
          // MathLive normally derives the implicit style for future input from
          // the atom immediately before the caret. If the formatted selection
          // includes the last atom, typing at the end would otherwise inherit
          // its color/background even though these controls are selection-only.
          const resetPosition = Math.max(
            ...entry.selection.ranges.flatMap(([start, end]) => [start, end]),
          );
          field.selection = {
            ranges: [[resetPosition, resetPosition]],
            direction: "none",
          };
          field.applyStyle(
            style.kind === "color"
              ? { color: "none" }
              : { backgroundColor: "none" },
            { operation: "set" },
          );
          field.selection = entry.selection;
          return true;
        },
        false,
        !documentBefore,
      );
    }
    historyManager.commitPendingTransaction();

    if (documentBefore) {
      historyManager.push({
        type: "replace-document",
        before: documentBefore,
        after: captureDocumentSnapshot(),
        source: "format-multi-line",
        timestamp: Date.now(),
      });
    }

    const activeSelection =
      resolved.find(({ lineId }) => lineId === activeLineIdRef.current) ??
      resolved.at(-1);
    if (activeSelection) {
      setActiveLine(activeSelection.lineId);
      activeSelection.field.focus();
      activeSelection.field.selection = activeSelection.selection;
      activeSelection.field.shadowRoot
        ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
        ?.focus({ preventScroll: true });
    }
    lastSelectionTargetRef.current = null;
    return true;
  };

  /**
   * Several rows inserted at a row's selection (a paste, a pasted image's result): the first joins the text before the selection,
   * the last the text after it (the caret before that text); a selection across rows is replaced whole.
   */
  const insertMultipleLatexRowsAt = (
    target: MathEditorInsertionTarget,
    values: readonly string[],
    source: FormulaEditSource,
  ): boolean => {
    if (interactionReadOnly || values.length < 2) return false;
    const field = fieldRefs.current.get(target.lineId);
    if (!field?.isConnected) return false;
    historyManager.commitPendingTransaction();
    const before = captureDocumentSnapshot();
    const bounds = rowsSelectionBounds();
    const targetIndex = before.lines.findIndex(
      (line) => line.id === target.lineId,
    );
    if (targetIndex < 0) return false;
    const selected = clampSelection(
      {
        ranges: target.ranges.length
          ? target.ranges
          : [[field.lastOffset, field.lastOffset]],
        direction: target.direction,
      },
      field.lastOffset,
    ).ranges[0];
    const start = bounds?.start ?? {
      lineId: target.lineId,
      lineIndex: targetIndex,
      offset: Math.min(selected[0], selected[1]),
    };
    const end = bounds?.end ?? {
      lineId: target.lineId,
      lineIndex: targetIndex,
      offset: Math.max(selected[0], selected[1]),
    };
    const first = fieldRefs.current.get(start.lineId);
    const last = fieldRefs.current.get(end.lineId);
    if (!first || !last) return false;
    const prefix = first.getValue(0, start.offset, "latex");
    const suffix = last.getValue(end.offset, last.lastOffset, "latex");
    const selectionByLineId: Record<string, MathSelectionSnapshot> = {};
    const insertOptions = {
      mode: "math" as const,
      format: "latex" as const,
      selectionMode: "after" as const,
      silenceNotifications: true,
    };
    // the mounted model measures the caret before the kept tail: the last row's caret is not after that tail
    field.setValue(values[values.length - 1], { ...insertOptions });
    field.position = field.lastOffset;
    const lastSelection = captureSelection(field);
    field.kernelInsertDocumentEdges("", suffix);
    const lastLatex = normalizeChineseLatex(field.value);
    field.setValue(values[0], { ...insertOptions });
    field.position = field.lastOffset;
    field.kernelInsertDocumentEdges(prefix, "");
    const firstLatex = normalizeChineseLatex(field.value);
    const template = before.lines[start.lineIndex];
    const inserted = [
      { ...template, id: target.lineId, latex: firstLatex },
      ...values
        .slice(1)
        .map((latex, index) =>
          createFormulaLine(
            index === values.length - 2
              ? lastLatex
              : normalizeChineseLatex(latex),
            undefined,
            template.mode,
            template.displayStyle,
          ),
        ),
    ];
    const lastLine = inserted[inserted.length - 1];
    selectionByLineId[lastLine.id] = lastSelection;
    const lines = [...before.lines];
    lines.splice(
      start.lineIndex,
      end.lineIndex - start.lineIndex + 1,
      ...inserted,
    );
    const after: DocumentSnapshot = {
      ...before,
      lines,
      activeLineId: lastLine.id,
      selectionByLineId,
      documentSelection: null,
    };
    clearMultiLineSelection();
    applyRowsDocument(after);
    field.resetUndo();
    historyManager.push({
      type: "replace-document",
      before,
      after,
      source: source === "paste" ? "paste-multi-line" : "ocr",
      timestamp: Date.now(),
    });
    focusLine(lastLine.id, { latex: lastLine.latex, selection: lastSelection });
    return true;
  };

  const insertLatexAt = (
    target: MathEditorInsertionTarget,
    latex: string,
    source: FormulaEditSource = "ocr",
  ): boolean => {
    const values = normalizeInsertedFormulaLines(latex);
    if (!values.length) return false;
    // An insertion belongs to the captured target, even if other rows were selected meanwhile (a pasted image).
    if (target.documentSelection) {
      if (!applyDocumentSelection(target.documentSelection)) return false;
    } else if (target.documentSelection === null) {
      clearMultiLineSelection();
    }
    if (values.length > 1) {
      return insertMultipleLatexRowsAt(target, values, source);
    }
    const value = values[0];
    if (!linesRef.current.some((line) => line.id === target.lineId)) {
      return false;
    }
    const field = fieldRefs.current.get(target.lineId);
    if (!field?.isConnected) return false;

    const selection = clampSelection(
      {
        ranges: target.ranges.length
          ? target.ranges
          : [[field.lastOffset, field.lastOffset]],
        direction: target.direction,
      },
      field.lastOffset,
    );
    setActiveLine(target.lineId);
    field.focus();
    const inserted = applyDiscreteFormulaMutation(
      target.lineId,
      field,
      source,
      () => {
        field.selection = selection;
        return field.insert(value, {
          mode: "math",
          format: "latex",
          insertionMode: "replaceSelection",
          selectionMode: "after",
          focus: true,
          scrollIntoView: false,
        });
      },
    );
    if (!inserted) return false;
    focusLine(target.lineId, {
      latex: normalizeChineseLatex(field.value),
      selection: captureSelection(field),
    });
    return true;
  };

  return {
    handleFieldEdit,
    applyDiscreteFormulaMutation,
    applyInFormulaRowBreak,
    insertCommand,
    insertMultipleLatexRowsAt,
    insertLatexAt,
    applySelectionStyle,
    deleteMultiLineSelection,
    pasteLatexLines,
  };
}
