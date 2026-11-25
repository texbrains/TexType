import { flushSync } from "react-dom";
import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import { clampSelection } from "../history/HistoryManager";
import type {
  DocumentSnapshot,
  MathSelectionSnapshot,
} from "../history/historyTypes";
import { useEditorStore } from "../stores/editorStore";
import type { RowsEditorContext } from "./editorTypes";
import { captureSelection, rawLatexInput } from "./fieldHelpers";
import { repaintMathLiveCaret } from "./formulaFieldStyles";
import { normalizeChineseLatex } from "./normalizeChineseLatex";

export type RowFocus = ReturnType<typeof createRowFocus>;

/** The active row, keyboard focus and caret placement, the rows' fields. */
export function createRowFocus(ctx: RowsEditorContext) {
  const {
    history: historyManager,
    fieldRefs,
    linesRef,
    activeIndexRef,
    activeLineIdRef,
    focusRequestRef,
    pendingFocusRef,
    setActiveIndex,
  } = ctx;

  const applyFocusState = (
    lineId: string,
    expectedLatex: string | null,
    selection: MathSelectionSnapshot | null,
    moveToEnd: boolean,
    requestId: number,
  ) => {
    if (
      requestId !== focusRequestRef.current ||
      activeLineIdRef.current !== lineId
    ) {
      return false;
    }

    const field = fieldRefs.current.get(lineId);
    if (!field?.isConnected) return false;

    if (
      expectedLatex !== null &&
      normalizeChineseLatex(field.value) !== expectedLatex
    ) {
      field.setValue(expectedLatex, {
        mode: "math",
        format: "latex",
        insertionMode: "replaceAll",
        selectionMode: "after",
        silenceNotifications: true,
      });
    }
    field.resetUndo();

    // Establish the final model position before focusing MathLive's hidden
    // keyboard sink. A webview can fail to repaint the caret when a focused
    // sink receives a programmatic selection change, leaving the correct
    // selection in the model but no visible caret until the next input.
    if (selection) {
      const clamped = clampSelection(selection, field.lastOffset);
      field.selection = clamped;
      const range = clamped.ranges[0];
      if (range && range[0] === range[1]) field.position = range[1];
    } else if (moveToEnd) {
      const end = field.lastOffset;
      field.selection = {
        ranges: [[end, end]],
        direction: "none",
      };
      field.position = end;
    }

    (field as HTMLElement).focus({ preventScroll: true });
    field.shadowRoot
      ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
      ?.focus({ preventScroll: true });
    return true;
  };

  const focusLine = (
    lineId: string,
    options: {
      latex?: string | null;
      selection?: MathSelectionSnapshot | null;
      moveToEnd?: boolean;
      deferredRepair?: boolean;
    } = {},
    remainingAttempts = 10,
    requestId = ++focusRequestRef.current,
  ) => {
    const index = linesRef.current.findIndex((line) => line.id === lineId);
    if (index < 0) return false;

    const expectedLatex = options.latex ?? null;
    const selection = options.selection ?? null;
    const moveToEnd = options.moveToEnd ?? false;
    const deferredRepair = options.deferredRepair ?? true;
    activeIndexRef.current = index;
    activeLineIdRef.current = lineId;
    setActiveIndex((current) => (current === index ? current : index));
    const currentState = useEditorStore.getState();
    if (currentState.activeLineId !== lineId) {
      currentState.setActiveLineId(lineId);
    }
    pendingFocusRef.current = {
      lineId,
      latex: expectedLatex,
      selection,
      moveToEnd,
      deferredRepair,
    };

    const apply = () =>
      applyFocusState(lineId, expectedLatex, selection, moveToEnd, requestId);
    const finish = () => {
      if (!apply()) return false;
      pendingFocusRef.current = null;
      if (!deferredRepair) return true;
      const appliedField = fieldRefs.current.get(lineId);
      const repairSelection = appliedField?.isConnected
        ? captureSelection(appliedField)
        : null;
      const selectionStillMatchesRepair = () => {
        if (!repairSelection) return true;
        const currentField = fieldRefs.current.get(lineId);
        if (!currentField?.isConnected) return false;
        const currentSelection = captureSelection(currentField);
        return (
          currentSelection.direction === repairSelection.direction &&
          JSON.stringify(currentSelection.ranges) ===
            JSON.stringify(repairSelection.ranges)
        );
      };
      window.requestAnimationFrame(() => {
        // A pointer click, arrow key or drag that moved the selection after
        // the initial focus is authoritative user input. Never replay an old
        // focus snapshot over it merely because the LaTeX source is unchanged.
        if (!selectionStillMatchesRepair() || !apply()) return;
        window.setTimeout(() => {
          const currentField = fieldRefs.current.get(lineId);
          // Do not let the delayed focus repair overwrite input or selection
          // changes that started immediately after a toolbar insertion.
          if (
            !currentField?.isConnected ||
            currentField.mode !== "math" ||
            rawLatexInput(currentField) ||
            !selectionStillMatchesRepair() ||
            (expectedLatex !== null &&
              normalizeChineseLatex(currentField.value) !== expectedLatex)
          ) {
            return;
          }
          apply();
        }, 80);
      });
      return true;
    };

    if (finish()) return true;
    window.requestAnimationFrame(() => {
      if (finish() || remainingAttempts <= 0) return;
      window.setTimeout(
        () => focusLine(lineId, options, remainingAttempts - 1, requestId),
        16,
      );
    });
    return true;
  };

  const registerField = (
    lineId: string,
    field: MathfieldElement | null,
    expectedField?: MathfieldElement,
  ) => {
    if (field) {
      fieldRefs.current.set(lineId, field);
    } else if (
      !expectedField ||
      fieldRefs.current.get(lineId) === expectedField
    ) {
      fieldRefs.current.delete(lineId);
    }

    const pending = pendingFocusRef.current;
    if (field && pending?.lineId === lineId) {
      focusLine(lineId, {
        latex: pending.latex,
        selection: pending.selection,
        moveToEnd: pending.moveToEnd,
        deferredRepair: pending.deferredRepair,
      });
    }
  };

  const prepareFocusBeforeStructuralRemoval = (
    lineId: string,
    selection: MathSelectionSnapshot,
  ) => {
    const field = fieldRefs.current.get(lineId);
    if (!field?.isConnected) return false;

    // Transfer the native focus while both keyboard sinks are still in the
    // document. A webview can drop a post-removal focus request made after the
    // keydown target has already been detached.
    focusRequestRef.current += 1;
    const index = linesRef.current.findIndex((line) => line.id === lineId);
    if (index >= 0) {
      activeIndexRef.current = index;
      activeLineIdRef.current = lineId;
      setActiveIndex((current) => (current === index ? current : index));
    }
    const currentState = useEditorStore.getState();
    if (currentState.activeLineId !== lineId) {
      currentState.setActiveLineId(lineId);
    }
    const clamped = clampSelection(selection, field.lastOffset);
    field.selection = clamped;
    const range = clamped.ranges[0];
    if (range && range[0] === range[1]) field.position = range[1];
    (field as HTMLElement).focus({ preventScroll: true });
    field.shadowRoot
      ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
      ?.focus({ preventScroll: true });
    return true;
  };

  const finalizeFocusAfterStructuralRemoval = (
    lineId: string,
    selection: MathSelectionSnapshot,
  ) => {
    queueMicrotask(() => {
      if (
        activeLineIdRef.current !== lineId ||
        !fieldRefs.current.get(lineId)?.isConnected
      ) {
        return;
      }
      const field = fieldRefs.current.get(lineId);
      if (!field?.isConnected) return;
      const clamped = clampSelection(selection, field.lastOffset);
      field.selection = clamped;
      const range = clamped.ranges[0];
      if (range && range[0] === range[1]) field.position = range[1];
      repaintMathLiveCaret(field);
    });
  };

  const commitPendingVisualTransaction = () => {
    if (
      historyManager.getState().pendingTransaction?.kind === "source-document"
    ) {
      return;
    }
    historyManager.commitPendingTransaction();
  };

  const setActiveLine = (lineId: string) => {
    const index = linesRef.current.findIndex((line) => line.id === lineId);
    if (index < 0) return;
    if (activeLineIdRef.current !== lineId) {
      historyManager.commitPendingTransaction();
      focusRequestRef.current += 1;
    }
    activeIndexRef.current = index;
    activeLineIdRef.current = lineId;
    setActiveIndex((current) => (current === index ? current : index));
    const state = useEditorStore.getState();
    if (state.activeLineId !== lineId) state.setActiveLineId(lineId);
  };

  const resolveTargetField = () => {
    let targetLineId = activeLineIdRef.current;
    let field = targetLineId ? fieldRefs.current.get(targetLineId) : undefined;
    if (!field?.isConnected) {
      targetLineId =
        linesRef.current.find((line) =>
          Boolean(fieldRefs.current.get(line.id)?.isConnected),
        )?.id ?? null;
      field = targetLineId ? fieldRefs.current.get(targetLineId) : undefined;
    }
    return targetLineId && field?.isConnected
      ? { lineId: targetLineId, field }
      : null;
  };

  /** Each mounted row's selection. */
  const getSelectionMap = (): Record<string, MathSelectionSnapshot> =>
    Object.fromEntries(
      linesRef.current.flatMap((line) => {
        const field = fieldRefs.current.get(line.id);
        return field?.isConnected
          ? [[line.id, captureSelection(field)] as const]
          : [];
      }),
    );

  /** The rows replaced by a document state, rendered at once (the fields of new rows exist afterwards). */
  const applyRowsDocument = (after: DocumentSnapshot) => {
    flushSync(() => useEditorStore.getState().replaceDocumentState(after));
    linesRef.current = useEditorStore.getState().lines;
  };

  return {
    setActiveLine,
    focusLine,
    registerField,
    prepareFocusBeforeStructuralRemoval,
    finalizeFocusAfterStructuralRemoval,
    commitPendingVisualTransaction,
    resolveTargetField,
    getSelectionMap,
    applyRowsDocument,
  };
}
