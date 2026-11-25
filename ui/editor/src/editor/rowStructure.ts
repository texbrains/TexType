import { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import type {
  AddLineEntry,
  MathSelectionSnapshot,
  RemoveLineEntry,
  ReplaceDocumentEntry,
} from "../history/historyTypes";
import { createFormulaLine, useEditorStore } from "../stores/editorStore";
import type { RowsEditorContext } from "./editorTypes";
import { captureSelection, hasRawLatexInput } from "./fieldHelpers";
import { normalizeChineseLatex } from "./normalizeChineseLatex";
import type { RowFocus } from "./rowFocus";
import {
  captureEditorScrollSnapshot,
  stabilizeEditorScroll,
} from "./rowScroll";
import type { RowsSelection } from "./rowsSelection";

export type RowStructure = ReturnType<typeof createRowStructure>;

/** Rows added, split, merged and removed (a new row takes the kind and style of the row it comes from); moving between rows. */
export function createRowStructure(
  ctx: RowsEditorContext,
  focus: RowFocus,
  selection: RowsSelection,
) {
  const {
    history: historyManager,
    surfaceRef,
    fieldRefs,
    linesRef,
  } = ctx;
  const {
    setActiveLine,
    focusLine,
    prepareFocusBeforeStructuralRemoval,
    finalizeFocusAfterStructuralRemoval,
    applyRowsDocument,
  } = focus;
  const { captureDocumentSnapshot } = selection;

  const addLineAfter = (index: number) => {
    historyManager.commitPendingTransaction();
    const state = useEditorStore.getState();
    const beforeActiveLineId = state.activeLineId;
    const beforeField = beforeActiveLineId
      ? fieldRefs.current.get(beforeActiveLineId)
      : undefined;
    const beforeSelection = beforeField ? captureSelection(beforeField) : null;
    const nextIndex = Math.max(0, Math.min(index + 1, state.lines.length));
    const anchorLineId =
      state.lines[Math.max(0, Math.min(index, state.lines.length - 1))]?.id ??
      beforeActiveLineId;
    const scrollSnapshot = captureEditorScrollSnapshot(
      surfaceRef.current,
      anchorLineId,
    );
    const anchorLine =
      state.lines[Math.max(0, Math.min(index, state.lines.length - 1))];
    const line = createFormulaLine(
      "",
      undefined,
      anchorLine?.mode,
      anchorLine?.displayStyle ?? "default",
    );
    const afterSelection: MathSelectionSnapshot = {
      ranges: [[0, 0]],
      direction: "none",
    };

    const nextLines = state.lines.map((currentLine) => ({ ...currentLine }));
    nextLines.splice(nextIndex, 0, line);
    const nextDocument: ReplaceDocumentEntry["after"] = {
      title: state.title,
      lines: nextLines,
      activeLineId: line.id,
      formulaAlignment: state.formulaAlignment,
      selectionByLineId: {},
    };

    applyRowsDocument(nextDocument);
    setActiveLine(line.id);

    const entry: AddLineEntry = {
      type: "add-line",
      line,
      index: nextIndex,
      beforeActiveLineId,
      afterActiveLineId: line.id,
      beforeSelection,
      afterSelection,
      timestamp: Date.now(),
    };
    historyManager.push(entry);
    focusLine(line.id, {
      latex: line.latex,
      selection: afterSelection,
      deferredRepair: false,
    });
    stabilizeEditorScroll(surfaceRef.current, scrollSnapshot);
  };

  const splitLineAtCaret = (
    index: number,
    lineId: string,
    field: MathfieldElement,
  ) => {
    // Raw LaTeX input still belongs to MathLive's command transaction. In
    // ordinary math input, Enter follows Word: a selection is removed first,
    // then the remaining content is split at the selection boundary.
    if (hasRawLatexInput(field)) {
      addLineAfter(index);
      return;
    }

    const selectedRange = field.selection.ranges[0];
    if (field.selection.ranges.length !== 1 || !selectedRange) {
      addLineAfter(index);
      return;
    }
    const splitStart = Math.max(
      0,
      Math.min(
        field.selectionIsCollapsed
          ? field.position
          : Math.min(selectedRange[0], selectedRange[1]),
        field.lastOffset,
      ),
    );
    const splitEnd = Math.max(
      splitStart,
      Math.min(
        field.selectionIsCollapsed
          ? field.position
          : Math.max(selectedRange[0], selectedRange[1]),
        field.lastOffset,
      ),
    );
    if (field.selectionIsCollapsed && splitEnd >= field.lastOffset) {
      addLineAfter(index);
      return;
    }

    const originalLatex = normalizeChineseLatex(field.value);
    const leftLatex = normalizeChineseLatex(
      field.getValue(0, splitStart, "latex"),
    );
    const rightLatex = normalizeChineseLatex(
      field.getValue(splitEnd, field.lastOffset, "latex"),
    );
    const comparable = (value: string) =>
      value.replace(/\s+/g, "").replace(/\{([A-Za-z0-9])\}/g, "$1");
    const verifier = new MathfieldElement();
    const canonicalize = (latex: string) => {
      verifier.setValue(latex, {
        mode: "math",
        format: "latex",
        insertionMode: "replaceAll",
        selectionMode: "after",
        silenceNotifications: true,
      });
      return comparable(verifier.value);
    };
    // MathLive offsets can point inside a structured atom such as a fraction
    // or matrix. Reparse the two serialized ranges before comparing them:
    // MathLive legitimately normalizes braces and command whitespace at a
    // safe boundary, which made direct string concatenation reject complex
    // trailing structures even though their model was lossless.
    if (
      field.selectionIsCollapsed &&
      (!rightLatex.trim() ||
        canonicalize(`${leftLatex} ${rightLatex}`) !==
          canonicalize(originalLatex))
    ) {
      addLineAfter(index);
      return;
    }

    historyManager.commitPendingTransaction();
    const state = useEditorStore.getState();
    const currentIndex = state.lines.findIndex((line) => line.id === lineId);
    if (currentIndex < 0) {
      addLineAfter(index);
      return;
    }

    const before = captureDocumentSnapshot();
    before.lines = before.lines.map((line) =>
      line.id === lineId ? { ...line, latex: originalLatex } : line,
    );

    const scrollSnapshot = captureEditorScrollSnapshot(
      surfaceRef.current,
      lineId,
    );
    const nextLine = createFormulaLine(
      rightLatex,
      undefined,
      before.lines[currentIndex]?.mode,
      before.lines[currentIndex]?.displayStyle ?? "default",
    );
    const nextLines = before.lines.map((line) =>
      line.id === lineId ? { ...line, latex: leftLatex } : { ...line },
    );
    nextLines.splice(currentIndex + 1, 0, nextLine);
    const startSelection: MathSelectionSnapshot = {
      ranges: [[0, 0]],
      direction: "none",
    };
    const after: ReplaceDocumentEntry["after"] = {
      title: before.title,
      lines: nextLines,
      activeLineId: nextLine.id,
      formulaAlignment: before.formulaAlignment,
      selectionByLineId: {
        ...before.selectionByLineId,
        [lineId]: {
          ranges: [[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]],
          direction: "none",
        },
        [nextLine.id]: startSelection,
      },
    };

    applyRowsDocument(after);
    setActiveLine(nextLine.id);

    const entry: ReplaceDocumentEntry = {
      type: "replace-document",
      before,
      after,
      source: "split-line",
      timestamp: Date.now(),
    };
    historyManager.push(entry);
    focusLine(nextLine.id, {
      latex: rightLatex,
      selection: startSelection,
      deferredRepair: false,
    });
    stabilizeEditorScroll(surfaceRef.current, scrollSnapshot);
  };

  const mergeLineWithPrevious = (
    index: number,
    lineId: string,
    field: MathfieldElement,
  ) => {
    if (index <= 0) return false;
    const state = useEditorStore.getState();
    const currentIndex = state.lines.findIndex((line) => line.id === lineId);
    if (currentIndex <= 0) return false;
    const currentLine = state.lines[currentIndex];
    const previousLine = state.lines[currentIndex - 1];
    if (!currentLine || !previousLine) return false;

    historyManager.commitPendingTransaction();
    const previousField = fieldRefs.current.get(previousLine.id);
    const previousLatex = normalizeChineseLatex(
      previousField?.value ?? previousLine.latex,
    );
    const currentLatex = normalizeChineseLatex(field.value);
    const joinOffset = previousField?.lastOffset ?? 0;
    const verifier = new MathfieldElement();
    const commandSeparator =
      /\\[A-Za-z]+$/.test(previousLatex) && /^[A-Za-z]/.test(currentLatex)
        ? " "
        : "";
    verifier.setValue(`${previousLatex}${commandSeparator}${currentLatex}`, {
      mode: "math",
      format: "latex",
      insertionMode: "replaceAll",
      selectionMode: "after",
      silenceNotifications: true,
    });
    const mergedLatex = normalizeChineseLatex(verifier.value);

    const before = captureDocumentSnapshot();
    before.lines = before.lines.map((line) => {
      if (line.id === previousLine.id) {
        return { ...line, latex: previousLatex };
      }
      if (line.id === currentLine.id) {
        return { ...line, latex: currentLatex };
      }
      return line;
    });
    const joinSelection: MathSelectionSnapshot = {
      ranges: [[joinOffset, joinOffset]],
      direction: "none",
    };
    const nextSelectionByLineId = { ...before.selectionByLineId };
    delete nextSelectionByLineId[currentLine.id];
    nextSelectionByLineId[previousLine.id] = joinSelection;
    const after: ReplaceDocumentEntry["after"] = {
      title: before.title,
      lines: before.lines
        .filter((line) => line.id !== currentLine.id)
        .map((line) =>
          line.id === previousLine.id
            ? { ...line, latex: mergedLatex }
            : { ...line },
        ),
      activeLineId: previousLine.id,
      formulaAlignment: before.formulaAlignment,
      selectionByLineId: nextSelectionByLineId,
    };

    const scrollSnapshot = captureEditorScrollSnapshot(
      surfaceRef.current,
      previousLine.id,
    );
    prepareFocusBeforeStructuralRemoval(previousLine.id, joinSelection);
    applyRowsDocument(after);
    setActiveLine(previousLine.id);
    historyManager.push({
      type: "replace-document",
      before,
      after,
      source: "merge-line",
      timestamp: Date.now(),
    });
    finalizeFocusAfterStructuralRemoval(previousLine.id, joinSelection);
    stabilizeEditorScroll(surfaceRef.current, scrollSnapshot);
    return true;
  };

  const removeEmptyLine = (index: number) => {
    const state = useEditorStore.getState();
    if (state.lines.length <= 1) return;
    const removedLine = state.lines[index];
    if (!removedLine) return;

    historyManager.commitPendingTransaction();
    const removedField = fieldRefs.current.get(removedLine.id);
    const beforeSelection = removedField
      ? captureSelection(removedField)
      : null;
    const remainingLines = state.lines.filter(
      (line) => line.id !== removedLine.id,
    );
    const targetIndex = Math.max(0, index - 1);
    const targetLine = remainingLines[targetIndex] ?? remainingLines[0];
    if (!targetLine) return;
    const targetField = fieldRefs.current.get(targetLine.id);
    const targetEnd = targetField?.lastOffset ?? targetLine.latex.length;
    const afterSelection: MathSelectionSnapshot = {
      ranges: [[targetEnd, targetEnd]],
      direction: "none",
    };

    const scrollSnapshot = captureEditorScrollSnapshot(
      surfaceRef.current,
      targetLine.id,
    );
    const nextDocument: ReplaceDocumentEntry["after"] = {
      title: state.title,
      lines: remainingLines.map((line) => ({ ...line })),
      activeLineId: targetLine.id,
      formulaAlignment: state.formulaAlignment,
      selectionByLineId: {
        [targetLine.id]: afterSelection,
      },
    };
    prepareFocusBeforeStructuralRemoval(targetLine.id, afterSelection);
    applyRowsDocument(nextDocument);
    setActiveLine(targetLine.id);

    const entry: RemoveLineEntry = {
      type: "remove-line",
      line: { ...removedLine },
      index,
      beforeActiveLineId: removedLine.id,
      afterActiveLineId: targetLine.id,
      beforeSelection,
      afterSelection,
      timestamp: Date.now(),
    };
    historyManager.push(entry);
    finalizeFocusAfterStructuralRemoval(targetLine.id, afterSelection);
    stabilizeEditorScroll(surfaceRef.current, scrollSnapshot);
  };

  // Up/Down with nothing above (below) inside the formula: the editing core
  // asks the editor to move to the previous (next) formula row.
  const moveToAdjacentLine = (
    index: number,
    direction: -1 | 1,
    field: MathfieldElement,
  ): boolean => {
    const targetLine = linesRef.current[index + direction];
    if (!targetLine) return false;
    historyManager.commitPendingTransaction();

    const targetField = fieldRefs.current.get(targetLine.id);
    const targetPosition = Math.max(
      0,
      Math.min(
        field.position,
        targetField?.lastOffset ?? targetLine.latex.length,
      ),
    );
    const targetSelection: MathSelectionSnapshot = {
      ranges: [[targetPosition, targetPosition]],
      direction: "none",
    };
    setActiveLine(targetLine.id);
    // focusLine's later repairs never replay over what the user typed meanwhile
    // (unguarded re-applications reversed fast typing: ArrowUp, x, y gave "yx")
    focusLine(targetLine.id, {
      latex: targetField?.isConnected ? null : targetLine.latex,
      selection: targetSelection,
    });
    return true;
  };

  return {
    addLineAfter,
    splitLineAtCaret,
    mergeLineWithPrevious,
    removeEmptyLine,
    moveToAdjacentLine,
  };
}
