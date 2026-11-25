import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import {
  editingModelOf,
  kernelEditingCore,
} from "@app/kernel/render/layout-runtime.ts";
import { useEditorStore } from "../stores/editorStore";
import {
  greekLetterHotkeyCommandFromEvent,
  isGreekLetterHotkeyPrefix,
} from "../shortcuts/greekLetterHotkeys";
import { KERNEL_ALIGNMENT_MARKER_LATEX } from "./alignmentMarkers";
import type { RowsEditorContext } from "./editorTypes";
import {
  captureSelection,
  hasRawLatexInput,
  rawLatexInput,
} from "./fieldHelpers";
import {
  collapseMathLiveSelectionToEnd,
  dismissMathLiveSuggestions,
  insertMathLiveAlignmentPoint,
  moveMathLiveToNextColumn,
} from "./mathLiveKernelCommands";
import { normalizeChineseLatex } from "./normalizeChineseLatex";
import type { RowEdits } from "./rowEdits";
import type { RowFocus } from "./rowFocus";
import type { RowStructure } from "./rowStructure";
import type { RowsSelection } from "./rowsSelection";

/**
 * The editor's keys in a row's formula, offered before the kernel's: Select
 * All, leaving and deleting a selection across rows, the Greek-letter prefix
 * (Ctrl+G), Escape, undo/redo, Enter, & and the row-level
 * Backspace cases.
 */
export function createRowKeyHandler(
  ctx: RowsEditorContext,
  focus: RowFocus,
  selection: RowsSelection,
  edits: RowEdits,
  structure: RowStructure,
) {
  const {
    history: historyManager,
    fieldRefs,
    linesRef,
    greekPrefixLineIdRef,
    multiLineSelectionRef,
    multiLineSelectedIdsRef,
    documentSelectionRef,
    documentSelectionNavigationRef,
    latexFormatProfile,
  } = ctx;
  const { setActiveLine, focusLine, getSelectionMap } = focus;
  const { clearMultiLineSelection, applyMultiLineSelection } = selection;
  const {
    applyDiscreteFormulaMutation,
    applyInFormulaRowBreak,
    insertCommand,
    deleteMultiLineSelection,
  } = edits;
  const {
    splitLineAtCaret,
    mergeLineWithPrevious,
    removeEmptyLine,
  } = structure;

  const handleKeyDown = (
    index: number,
    lineId: string,
    event: KeyboardEvent,
    field: MathfieldElement,
  ) => {
    setActiveLine(lineId);
    documentSelectionNavigationRef.current = null;

    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "a"
    ) {
      const first = linesRef.current[0];
      const lastIndex = linesRef.current.length - 1;
      const last = linesRef.current[lastIndex];
      const lastField = last && fieldRefs.current.get(last.id);
      if (first && last && lastField) {
        event.preventDefault();
        event.stopImmediatePropagation();
        historyManager.commitPendingTransaction();
        lastField.focus();
        setActiveLine(last.id);
        applyMultiLineSelection(
          { lineId: first.id, lineIndex: 0, offset: 0 },
          {
            lineId: last.id,
            lineIndex: lastIndex,
            offset: lastField.lastOffset,
          },
        );
        if (lastIndex > 0) documentSelectionRef.current = getSelectionMap();
      }
      return;
    }

    if (
      documentSelectionRef.current &&
      event.shiftKey &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      // Capture handlers run before MathLive navigation. Its selection-change
      // event is the authoritative endpoint, not a timed callback.
      documentSelectionNavigationRef.current = lineId;
    }

    if (
      multiLineSelectionRef.current &&
      !event.shiftKey &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Escape",
      ].includes(event.key)
    ) {
      const selectedIds = [...multiLineSelectedIdsRef.current];
      const backwards = ["ArrowLeft", "ArrowUp", "Home"].includes(event.key);
      const targetId =
        event.key === "Escape"
          ? lineId
          : backwards
            ? selectedIds[0]
            : selectedIds.at(-1);
      const targetField = targetId ? fieldRefs.current.get(targetId) : null;
      if (targetId && targetField) {
        const ranges = targetField.selection.ranges.flat();
        const offset = backwards ? Math.min(...ranges) : Math.max(...ranges);
        clearMultiLineSelection();
        event.preventDefault();
        event.stopImmediatePropagation();
        focusLine(targetId, {
          selection: { ranges: [[offset, offset]], direction: "none" },
        });
        return;
      }
    }

    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      deleteMultiLineSelection()
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (
      greekPrefixLineIdRef.current &&
      greekPrefixLineIdRef.current !== lineId
    ) {
      greekPrefixLineIdRef.current = null;
    }

    const rawLatexInputActive = hasRawLatexInput(field);
    if (!rawLatexInputActive && isGreekLetterHotkeyPrefix(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      greekPrefixLineIdRef.current = lineId;
      dismissMathLiveSuggestions(field);
      return;
    }

    if (greekPrefixLineIdRef.current === lineId) {
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        greekPrefixLineIdRef.current = null;
        return;
      }
      const greekCommand = greekLetterHotkeyCommandFromEvent(event);
      greekPrefixLineIdRef.current = null;
      if (greekCommand) {
        event.preventDefault();
        event.stopImmediatePropagation();
        insertCommand(greekCommand, "shortcut");
        return;
      }
    }

    // Escape and Enter: the editing core decides (keys.ts); the editor
    // performs the row commands.
    const editingModel = editingModelOf(field);
    if (
      event.key === "Escape" &&
      editingModel &&
      kernelEditingCore.escapeAction(
        editingModel,
        event,
        rawLatexInputActive,
      ) === "collapse"
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      collapseMathLiveSelectionToEnd(field);
      return;
    }

    const shortcutKey = event.key.toLocaleLowerCase();
    const primaryModifier = event.ctrlKey && !event.altKey && !event.metaKey;
    const requestsUndo =
      primaryModifier && shortcutKey === "z" && !event.shiftKey;
    const requestsRedo =
      primaryModifier &&
      ((shortcutKey === "z" && event.shiftKey) ||
        (shortcutKey === "y" && !event.shiftKey));
    if (requestsUndo || requestsRedo) {
      clearMultiLineSelection();
      event.preventDefault();
      event.stopPropagation();
      if (requestsRedo) historyManager.requestRedo();
      else historyManager.requestUndo();
      return;
    }

    const enterAction =
      event.key === "Enter" && editingModel
        ? kernelEditingCore.enterAction(
            editingModel,
            event,
            rawLatexInputActive,
          )
        : null;
    if (enterAction && enterAction !== "complete") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (enterAction === "split-row") {
        splitLineAtCaret(index, lineId, field);
        return;
      }
      const changed =
        enterAction === "row-break"
          ? applyInFormulaRowBreak(
              lineId,
              field,
              latexFormatProfile.multilineEnvironment === "align"
                ? "aligned"
                : "gathered",
            )
          : applyDiscreteFormulaMutation(lineId, field, "keyboard", () =>
              field.executeCommand("addRowAfter"),
            );
      if (changed) {
        focusLine(lineId, {
          latex: normalizeChineseLatex(field.value),
          selection: captureSelection(field),
        });
      }
      return;
    }

    const rawCommandActive = hasRawLatexInput(field);
    // Let native completion own Enter/Tab/arrows while typing a command.
    if (rawCommandActive || field.mode === "latex") return;

    // &: the editing core decides (keys.ts); the editor performs it as one
    // history step.
    const ampersandAction =
      event.key === "&" && editingModel
        ? kernelEditingCore.ampersandAction(
            editingModel,
            event,
            rawCommandActive,
            latexFormatProfile.multilineEnvironment === "align",
          )
        : null;
    if (ampersandAction === "alignment-point") {
      const inserted = applyDiscreteFormulaMutation(
        lineId,
        field,
        "keyboard",
        () => insertMathLiveAlignmentPoint(field),
      );
      if (inserted) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusLine(lineId, {
          latex: normalizeChineseLatex(field.value),
          selection: captureSelection(field),
        });
        return;
      }
    }

    if (ampersandAction === "alignment-marker") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const inserted = applyDiscreteFormulaMutation(
        lineId,
        field,
        "keyboard",
        () =>
          field.insert(KERNEL_ALIGNMENT_MARKER_LATEX, {
            mode: "math",
            format: "latex",
            insertionMode: "replaceSelection",
            selectionMode: "after",
            focus: true,
            scrollIntoView: false,
          }),
      );
      if (inserted) {
        focusLine(lineId, {
          latex: normalizeChineseLatex(field.value),
          selection: captureSelection(field),
        });
      }
      return;
    }

    // In a matrix, cases or array, & is LaTeX's column separator: it moves
    // to the cell on the right, or adds a column at the end of the row.
    // Where it does neither (not directly in a cell), & stays a character.
    if (ampersandAction === "next-column") {
      let moved = false;
      applyDiscreteFormulaMutation(lineId, field, "keyboard", () => {
        const before = JSON.stringify([field.value, captureSelection(field)]);
        moveMathLiveToNextColumn(field);
        moved =
          JSON.stringify([field.value, captureSelection(field)]) !== before;
        return moved;
      });
      if (moved) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusLine(lineId, {
          latex: normalizeChineseLatex(field.value),
          selection: captureSelection(field),
        });
        return;
      }
    }

    // Space belongs to the kernel and the editing core: the input
    // conversion first, then leaving the structure, or a visible space at
    // the top level.

    // Backspace/Delete inside a formula belong to the kernel's deletion rules
    // (and its input conversion, which undoes a fresh conversion first); the
    // edit is recorded from its input event. The editor only handles the
    // row-level cases below.
    if (event.key === "Backspace" || event.key === "Delete") {
      const visibleLatex = field.getValue("latex-without-placeholders").trim();
      const rawCommandInput = rawLatexInput(field);
      const state = useEditorStore.getState();
      const currentLine = state.lines.find((line) => line.id === lineId);
      const trulyEmpty = Boolean(
        currentLine &&
        visibleLatex.length === 0 &&
        rawCommandInput.length === 0 &&
        normalizeChineseLatex(field.value).trim().length === 0 &&
        currentLine.latex.trim().length === 0,
      );

      // Backspace on a truly empty row restores the multiline editor's
      // previous-row behavior. This check must happen before the raw-LaTeX
      // mode guard because MathLive can remain in `latex` mode after the
      // final raw command character has already been deleted.
      if (
        event.key === "Backspace" &&
        trulyEmpty &&
        field.selectionIsCollapsed &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        removeEmptyLine(index);
        return;
      }

      // While MathLive is collecting a non-empty raw LaTeX command such as
      // `\\mat`, its public formula value is intentionally still empty. Let
      // MathLive consume Backspace/Delete natively so one physical key
      // removes one raw command character instead of deleting the row.
      if (rawCommandInput) return;

      // Modified Backspace/Delete (Ctrl+Backspace deletes a word) stay MathLive's.
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (
        event.key === "Backspace" &&
        field.selectionIsCollapsed &&
        field.position === 0
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        mergeLineWithPrevious(index, lineId, field);
        return;
      }

      return;
    }

    if (
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      historyManager.commitPendingTransaction();
    }
  };

  return handleKeyDown;
}
