import { useEffect, useLayoutEffect, useRef } from "react";
import {
  MathfieldElement,
  type Selector,
} from "@app/kernel/kernel/mathlive.ts";
import type { SelectionDragHost } from "@app/kernel";
import { storedLatexToUser } from "@app/kernel/latex/exam-zh-symbols.ts";
import { installMathLiveContourIntegralShadowStyle } from "@app/kernel/latex/expand.ts";
import { KERNEL_MATHLIVE_COMPATIBILITY_MACROS } from "@app/kernel/latex/kernel-macros.ts";
import { composeCustomSymbolMacrosForMathfield } from "@app/kernel/render/custom-symbols.ts";
import { installCustomSymbolShadowStyle } from "@app/kernel/render/custom-symbol-rendering.ts";
import type {
  FormulaChineseFont,
  FormulaLetterFont,
} from "@app/kernel/render/fonts.ts";
import {
  kernelEditingCore,
  placeCaretAtPoint,
} from "@app/kernel/render/layout-runtime.ts";
import { KERNEL_SYMBOL_SEQUENCES } from "@app/kernel/typing/judgment.ts";
import { formatFormulaSelectionUniversal } from "../clipboard/LatexCopyService";
import { toPortableBoldLatex } from "../clipboard/portableBoldLatex";
import { clampSelection } from "../history/HistoryManager";
import type {
  EditKind,
  FormulaEditSource,
  MathSelectionSnapshot,
} from "../history/historyTypes";
import { formatLatexSourceForEditor } from "../source-editor/latexSourceEditorSupport";
import type {
  FormulaDisplayStyle,
  FormulaLineMode,
  LatexFormatProfile,
} from "../types/formula";
import type {
  FormulaFieldEdit,
  MathEditorInsertionTarget,
} from "./editorTypes";
import {
  captureFieldSnapshot,
  captureSelection,
  focusControlOutsideFormulas,
  inferEditKind,
  inferEditSource,
  normalizeCompletedUprightDisplay,
  normalizePhysicalBackslashInput,
  pastedImage,
  pastedLatexRows,
  rawLatexInput,
  type PhysicalBackslashInputKind,
} from "./fieldHelpers";
import {
  applyKernelFormulaFonts,
  cancelCaretRepaint,
  installKernelStructuralPlaceholderStyle,
  kernelSourcePreviewClass,
  markKernelFormulaGlyphFonts,
} from "./formulaFieldStyles";
import { installMathLiveOptionMutationGuard } from "./mathLiveOptionCompatibility";
import {
  setMathLivePersistentTypingStyle,
  type MathLivePersistentTypingStyle,
} from "./mathLiveKernelCommands";
import { normalizeChineseLatex } from "./normalizeChineseLatex";
import {
  applyFormulaRowHeight,
  formulaRowHeightMetrics,
  measuredFormulaRowHeight,
  predictedFormulaRowHeight,
} from "./rowHeight";
import styles from "./FormulaField.module.css";
import type { FormulaAlignment } from "../types/formula";

export interface FormulaFieldProps {
  lineId: string;
  index: number;
  latex: string;
  /** The row's kind and style: copied text leaves in the row's code format. */
  mode?: FormulaLineMode;
  displayStyle?: FormulaDisplayStyle;
  latexFormatProfile: LatexFormatProfile;
  /** how the formula sits in its row (the editor's row alignment) */
  alignment: FormulaAlignment;
  zoom: number;
  formulaRowVerticalInset: number;
  language: "cn" | "en";
  formulaLetterFont: FormulaLetterFont;
  formulaChineseFont: FormulaChineseFont;
  autoPairDelimiters: boolean;
  persistentTypingStyle: MathLivePersistentTypingStyle;
  readOnly: boolean;
  register: (
    lineId: string,
    field: MathfieldElement | null,
    expectedField?: MathfieldElement,
  ) => void;
  onEdit: (edit: FormulaFieldEdit, field: MathfieldElement) => void;
  onSelectionChange: (lineId: string, selection: MathSelectionSnapshot) => void;
  onFocus: (index: number, field: MathfieldElement) => void;
  onCommitPending: () => void;
  onKeyDown: (
    index: number,
    event: KeyboardEvent,
    field: MathfieldElement,
  ) => void;
  /** Up/Down found nothing to move to inside the formula: move to another row. */
  onVerticalExit: (
    index: number,
    direction: -1 | 1,
    field: MathfieldElement,
  ) => boolean;
  onPasteImage?: (file: File, target: MathEditorInsertionTarget) => void;
  onPasteLatexLines: (
    lineId: string,
    field: MathfieldElement,
    lines: string[],
  ) => void;
  /** Dragging the formula's selection out to the other rows (DESIGN §6.12). */
  selectionDrag: SelectionDragHost;
}

/**
 * One row's formula: a MathLive field driven by the kernel. It reports its
 * edits (with the selections before and after) and keys to the editor, keeps
 * its row's height, and guards IME and Backslash input.
 */
export function FormulaField(props: FormulaFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const registeredLineIdRef = useRef(props.lineId);
  const syncFrameSizeRef = useRef<(() => void) | null>(null);
  const lastSnapshotRef = useRef<ReturnType<
    typeof captureFieldSnapshot
  > | null>(null);
  const compositionStartRef = useRef<ReturnType<
    typeof captureFieldSnapshot
  > | null>(null);
  const sizingZoomRef = useRef(props.zoom);
  const sizingRowVerticalInsetRef = useRef(props.formulaRowVerticalInset);
  const propsRef = useRef(props);
  propsRef.current = props;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initialLineId = propsRef.current.lineId;
    registeredLineIdRef.current = initialLineId;
    const lineId = initialLineId;
    const field = new MathfieldElement();
    MathfieldElement.locale =
      propsRef.current.language === "en" ? "en" : "zh-cn";
    field.value = propsRef.current.latex;
    field.className = styles.field;
    // Copied text leaves the app as portable LaTeX (\mathbfit -> \boldsymbol), in the row's code
    // format, and in the user's spelling of the congruence and similarity signs.
    field.onExport = (_mathfield, latex, range) => {
      const current = propsRef.current;
      const wholeLine = range[0] <= 0 && range[1] >= field.lastOffset;
      const source = formatFormulaSelectionUniversal(
        {
          id: current.lineId,
          latex: current.latex,
          mode: current.mode,
          displayStyle: current.displayStyle,
        },
        latex,
        current.latexFormatProfile,
        wholeLine,
      );
      return storedLatexToUser(
        toPortableBoldLatex(formatLatexSourceForEditor(source)),
      );
    };
    field.smartMode = false;
    field.smartFence = propsRef.current.autoPairDelimiters;
    field.readOnly = propsRef.current.readOnly;
    // TexType handles superscript and subscript auto-exit independently.
    // Keep MathLive's built-in superscript heuristic disabled so it cannot
    // move out of an empty superscript before the first character is inserted.
    field.smartSuperscript = false;
    // The kernel leaves a superscript, subscript or accent after one typed character only when asked.
    field.dataset.kernelAutoExitSuperscript = "true";
    field.dataset.kernelAutoExitSubscript = "true";
    field.dataset.kernelAutoExitAccent = "true";
    field.popoverPolicy = "auto";
    field.maxMatrixCols = 10;
    field.setAttribute("math-virtual-keyboard-policy", "manual");
    const isEn = propsRef.current.language === "en";
    field.setAttribute(
      "aria-label",
      isEn
        ? "Formula line " + (propsRef.current.index + 1)
        : "第 " + (propsRef.current.index + 1) + " 行公式",
    );
    field.removeAttribute("placeholder");
    const initialMetrics = formulaRowHeightMetrics(
      propsRef.current.latex,
      propsRef.current.zoom,
      propsRef.current.formulaRowVerticalInset,
    );
    const initialRowHeight = predictedFormulaRowHeight(
      propsRef.current.latex,
      propsRef.current.zoom,
      propsRef.current.formulaRowVerticalInset,
      host,
    );
    let initialHeightFloor = initialRowHeight;
    field.style.fontSize = initialMetrics.fontSize + "px";
    applyFormulaRowHeight(
      field,
      host,
      initialRowHeight,
    );
    installMathLiveContourIntegralShadowStyle(field);
    installCustomSymbolShadowStyle(field);
    installKernelStructuralPlaceholderStyle(field);
    applyKernelFormulaFonts(
      field,
      propsRef.current.formulaLetterFont,
      propsRef.current.formulaChineseFont,
    );

    let resizeFrame = 0;
    const measureFrameSize = () => {
      const measured = measuredFormulaRowHeight(
        field,
        propsRef.current.zoom,
        propsRef.current.formulaRowVerticalInset,
      );
      // the predicted height holds until the field has drawn at least that tall
      if (measured.height >= initialHeightFloor - 1) initialHeightFloor = 0;
      applyFormulaRowHeight(
        field,
        host,
        Math.max(measured.height, initialHeightFloor),
      );
    };
    const syncFrameSize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(measureFrameSize);
    };
    syncFrameSizeRef.current = syncFrameSize;

    // Whether a composition is open, between the compositionstart and the
    // compositionend the field reports (its history entries follow them).
    let composing = false;
    let physicalBackslashGuard: {
      kind: PhysicalBackslashInputKind;
      beforeValue: string;
      expiresAt: number;
      acceptedInput: boolean;
    } | null = null;
    let suppressUnarmedBackslashInputUntil = 0;
    let backslashGuardTimer = 0;
    let applyingInternalEdit = false;
    let compositionDeleteObserved = false;
    let suppressPostCompositionDeleteUntil = 0;

    const armPhysicalBackslashGuard = (
      kind: PhysicalBackslashInputKind,
      timeStamp: number,
    ) => {
      physicalBackslashGuard = {
        kind,
        beforeValue: field.value,
        expiresAt: timeStamp + 240,
        acceptedInput: false,
      };
      window.clearTimeout(backslashGuardTimer);
      const expectedGuard = physicalBackslashGuard;
      backslashGuardTimer = window.setTimeout(() => {
        if (physicalBackslashGuard === expectedGuard) {
          physicalBackslashGuard = null;
        }
      }, 280);
    };

    const normalizeGuardedBackslashInput = (timeStamp: number) => {
      const guard = physicalBackslashGuard;
      if (!guard || timeStamp > guard.expiresAt) {
        physicalBackslashGuard = null;
        return;
      }

      const activeRawInput = rawLatexInput(field);
      if (
        guard.kind === "latin-backslash" &&
        activeRawInput.length > 1 &&
        /^\\+$/.test(activeRawInput)
      ) {
        // Some WebKit/IME transitions apply the same physical Backslash more
        // than once directly to MathLive's raw-LaTeX DOM. The public field
        // value is still unchanged in raw mode, so normalize that DOM through
        // MathLive commands rather than rebuilding the formula snapshot.
        applyingInternalEdit = true;
        try {
          for (let index = 1; index < activeRawInput.length; index += 1) {
            field.executeCommand("deleteBackward");
          }
        } finally {
          applyingInternalEdit = false;
        }
        // Chromium can emit more than one `char` event for the same physical
        // Backslash after the first duplicate has already been normalized.
        // Keep this guard alive until its original deadline so any trailing
        // event from the same key transaction is normalized as well.
        guard.acceptedInput = true;
        suppressUnarmedBackslashInputUntil = Math.max(
          suppressUnarmedBackslashInputUntil,
          timeStamp + 180,
        );
        return;
      }

      const rawValue = field.value;
      const normalizedValue = normalizePhysicalBackslashInput(
        guard.beforeValue,
        rawValue,
        guard.kind,
      );
      if (normalizedValue === rawValue) return;

      const previousPosition = field.position;
      const removedCharacters = rawValue.length - normalizedValue.length;
      field.setValue(normalizedValue, {
        mode: "math",
        format: "latex",
        insertionMode: "replaceAll",
        selectionMode: "after",
        silenceNotifications: true,
      });
      const correctedPosition = Math.max(
        0,
        Math.min(field.lastOffset, previousPosition - removedCharacters),
      );
      field.position = correctedPosition;
      field.selection = {
        ranges: [[correctedPosition, correctedPosition]],
        direction: "none",
      };
      physicalBackslashGuard = null;
    };

    const emitEdit = (
      before: ReturnType<typeof captureFieldSnapshot>,
      after: ReturnType<typeof captureFieldSnapshot>,
      editKind: EditKind,
      source: FormulaEditSource,
    ) => {
      lastSnapshotRef.current = after;
      if (before.latex === after.latex) return;
      propsRef.current.onEdit(
        {
          lineId,
          beforeLatex: before.latex,
          afterLatex: after.latex,
          beforeSelection: before.selection,
          afterSelection: after.selection,
          editKind,
          source,
        },
        field,
      );
      lastSnapshotRef.current = captureFieldSnapshot(field);
      field.resetUndo();
    };
    const handleCompositionStart = () => {
      compositionDeleteObserved = false;
      suppressPostCompositionDeleteUntil = 0;
      physicalBackslashGuard = null;
      suppressUnarmedBackslashInputUntil = 0;
      window.clearTimeout(backslashGuardTimer);
      propsRef.current.onCommitPending();
      composing = true;
      const liveCompositionStart = captureFieldSnapshot(field);
      compositionStartRef.current = liveCompositionStart;
    };
    const handleCompositionEnd = (event: CompositionEvent) => {
      const cancelledByCompositionDelete =
        event.data === "" && compositionDeleteObserved;
      const before =
        compositionStartRef.current ??
        lastSnapshotRef.current ??
        captureFieldSnapshot(field);
      composing = false;
      suppressPostCompositionDeleteUntil = cancelledByCompositionDelete
        ? event.timeStamp + 160
        : 0;
      suppressUnarmedBackslashInputUntil =
        event.data === "" ? event.timeStamp + 260 : 0;
      compositionDeleteObserved = false;
      normalizeGuardedBackslashInput(event.timeStamp);

      // Cancelling an uncommitted IME candidate can leave the same physical key
      // applied to the confirmed formula. The composition committed no text in
      // this case, so restore the exact pre-composition formula and selection
      // instead of recording a delete.
      if (event.data === "" && field.value !== before.latex) {
        field.setValue(before.latex, {
          mode: "math",
          format: "latex",
          insertionMode: "replaceAll",
          selectionMode: "after",
          silenceNotifications: true,
        });
        const restored = clampSelection(before.selection, field.lastOffset);
        field.selection = restored;
        const restoredRange = restored.ranges.at(-1);
        if (restoredRange) field.position = restoredRange[1];
        field.resetUndo();
        lastSnapshotRef.current = captureFieldSnapshot(field);
        compositionStartRef.current = null;
        syncFrameSize();
        return;
      }

      let after = captureFieldSnapshot(field);
      compositionStartRef.current = null;
      emitEdit(before, after, "composition", "keyboard");
      syncFrameSize();
    };
    const handleBeforeInput = (event: InputEvent) => {
      if (applyingInternalEdit) return;
      if (
        event.inputType === "deleteContentBackward" &&
        event.timeStamp <= suppressPostCompositionDeleteUntil
      ) {
        suppressPostCompositionDeleteUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.data === "\\") {
        const guard = physicalBackslashGuard;
        const guardedLatinInput = Boolean(
          guard &&
          guard.kind === "latin-backslash" &&
          event.timeStamp <= guard.expiresAt,
        );
        if (guardedLatinInput && guard) {
          if (guard.acceptedInput) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          guard.acceptedInput = true;
          suppressUnarmedBackslashInputUntil = 0;
        } else if (event.timeStamp <= suppressUnarmedBackslashInputUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
    };
    const handleInput = (event: Event) => {
      if (applyingInternalEdit) return;
      if (composing) {
        if (
          event instanceof InputEvent &&
          event.inputType === "deleteCompositionText"
        ) {
          compositionDeleteObserved = true;
        }
        return;
      }
      normalizeGuardedBackslashInput(event.timeStamp);
      // (Auto-exit after typed and composed input is the kernel's.)
      const before = lastSnapshotRef.current ?? captureFieldSnapshot(field);
      normalizeCompletedUprightDisplay(field);
      const inputType =
        event instanceof InputEvent
          ? event.inputType || "insertText"
          : "insertText";
      const after = captureFieldSnapshot(field);
      emitEdit(
        before,
        after,
        inferEditKind(inputType, before.selection),
        inferEditSource(inputType),
      );
      syncFrameSize();
      window.requestAnimationFrame(() => {
        if (!field.isConnected || composing) return;
        const deferredBefore =
          lastSnapshotRef.current ?? captureFieldSnapshot(field);
        if (normalizeCompletedUprightDisplay(field)) {
          emitEdit(
            deferredBefore,
            captureFieldSnapshot(field),
            "replace",
            "keyboard",
          );
        }
      });
    };
    const handleSelectionChange = () => {
      syncFrameSize();
      const selection = captureSelection(field);
      propsRef.current.onSelectionChange(lineId, selection);
      if (composing || !lastSnapshotRef.current) return;
      // MathLive emits selection-change after mutating the model but before
      // input. Keep the pre-edit selection paired with the pre-edit LaTeX;
      // otherwise Undo restores a post-edit offset (outside an empty cell).
      if (
        normalizeChineseLatex(field.value) !== lastSnapshotRef.current.latex
      ) {
        return;
      }
      lastSnapshotRef.current = {
        ...lastSnapshotRef.current,
        selection,
      };
      // A caret move (a click) finishes the word it leaves: the kernel's
      // input judgment decides it now (keys finish words in the kernel).
      if (field.selectionIsCollapsed && !uprightCaretFrame) {
        uprightCaretFrame = window.requestAnimationFrame(() => {
          uprightCaretFrame = 0;
          if (!field.isConnected || composing) return;
          const beforeUpright =
            lastSnapshotRef.current ?? captureFieldSnapshot(field);
          const valueBefore = field.value;
          field.executeCommand(["kernelJudgeInput", {}] as unknown as Selector);
          if (field.value !== valueBefore) {
            emitEdit(
              beforeUpright,
              captureFieldSnapshot(field),
              "replace",
              "keyboard",
            );
          }
        });
      }
    };
    let uprightCaretFrame = 0;
    const handleFocus = () => {
      if (field.classList.contains(kernelSourcePreviewClass)) {
        field.blur();
        queueMicrotask(() => {
          document
            .querySelector<HTMLElement>("[data-source-editor] .cm-content")
            ?.focus({ preventScroll: true });
        });
        return;
      }
      propsRef.current.onFocus(propsRef.current.index, field);
      lastSnapshotRef.current = captureFieldSnapshot(field);
    };
    const handleBlur = () => {
      propsRef.current.onCommitPending();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUnmodifiedPhysicalBackslash =
        event.code === "Backslash" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      // Do not intercept a physical Backslash merely because a Windows IME
      // reports event.key as the ideographic comma. The MathLive kernel binds
      // code="Backslash" directly, so it can start command mode consistently.
      if (isUnmodifiedPhysicalBackslash && event.key === "\\") {
        suppressUnarmedBackslashInputUntil = 0;
        armPhysicalBackslashGuard("latin-backslash", event.timeStamp);
      }

      // Keys of an open composition belong to the IME (the field's key entry
      // already used up the Enter WebKit replays after a confirmed candidate).
      if (event.isComposing || event.keyCode === 229) return;
      // A genuinely non-composing key ends a composition whose compositionend
      // was lost.
      composing = false;
      if (compositionStartRef.current) {
        compositionStartRef.current = null;
        lastSnapshotRef.current = captureFieldSnapshot(field);
      }

      propsRef.current.onKeyDown(propsRef.current.index, event, field);
    };
    // MathLive's own context menu stays closed.
    const suppressMathLiveContextMenu = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handlePaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const rows = pastedLatexRows(clipboard);
      if (rows) {
        event.preventDefault();
        event.stopImmediatePropagation();
        propsRef.current.onCommitPending();
        propsRef.current.onFocus(propsRef.current.index, field);
        propsRef.current.onPasteLatexLines(
          propsRef.current.lineId,
          field,
          rows,
        );
        return;
      }

      if (!propsRef.current.onPasteImage) return;
      const image = pastedImage(clipboard);
      if (!image) return;

      event.preventDefault();
      event.stopPropagation();
      propsRef.current.onCommitPending();
      propsRef.current.onFocus(propsRef.current.index, field);

      propsRef.current.onPasteImage(image, {
        lineId: propsRef.current.lineId,
        ...captureSelection(field),
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const opensContextMenu =
        event.button === 2 || (event.button === 0 && event.ctrlKey);
      if (opensContextMenu) return;
      if (event.button !== 0) return;
      propsRef.current.onCommitPending();

      const hostBounds = host.getBoundingClientRect();
      const clickedInsideHost =
        event.clientX >= hostBounds.left &&
        event.clientX <= hostBounds.right &&
        event.clientY >= hostBounds.top &&
        event.clientY <= hostBounds.bottom;
      if (!clickedInsideHost) return;
      // The field handles its own clicks (the editing core's hit test). Row
      // space beside it focuses the formula at the stop the point means: the
      // nearest mathematical edge, so centered and right-aligned formulas
      // remain easy to focus and edit.
      if (event.composedPath().includes(field)) return;

      event.preventDefault();
      event.stopPropagation();
      field.focus();
      placeCaretAtPoint(field, event.clientX, event.clientY);
      field.shadowRoot
        ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
        ?.focus({ preventScroll: true });
      propsRef.current.onFocus(propsRef.current.index, field);
    };
    host.replaceChildren(field);
    installMathLiveOptionMutationGuard(field);
    // The mounted field has a richer macro dictionary than MathLive's deferred
    // pre-mount options (for example, it includes native \\bmod). Merge the
    // compatibility aliases only after mount so those commands stay, while the
    // mutation guard still handles transient model initialization safely.
    field.macros = composeCustomSymbolMacrosForMathfield(
      field,
      field.macros,
      KERNEL_MATHLIVE_COMPATIBILITY_MACROS,
    );
    // As-you-type shortcuts are symbol sequences only (>=, ->); typed words
    // are the kernel's input judgment's (its settings stay the defaults).
    field.inlineShortcuts = { ...KERNEL_SYMBOL_SEQUENCES };
    field.menuItems = [];
    installMathLiveContourIntegralShadowStyle(field);
    installCustomSymbolShadowStyle(field);
    installKernelStructuralPlaceholderStyle(field);
    applyKernelFormulaFonts(
      field,
      propsRef.current.formulaLetterFont,
      propsRef.current.formulaChineseFont,
    );
    // MathLive mounts a pre-filled field with the whole formula selected.
    // Collapse that implicit selection so toolbar commands insert at the end
    // instead of unexpectedly replacing/wrapping the entire line.
    field.position = field.lastOffset;
    setMathLivePersistentTypingStyle(
      field,
      propsRef.current.persistentTypingStyle,
    );
    field.resetUndo();
    lastSnapshotRef.current = captureFieldSnapshot(field);
    fieldRef.current = field;
    propsRef.current.register(initialLineId, field);
    // Tab never leaves the formula (the editing core consumes it). The way out
    // for keyboard users: Escape opens an empty LaTeX box, and Tab (Shift+Tab)
    // from that still-empty box closes it and moves focus to the next
    // (previous) control after the formula lines.
    const handleLatexBoxTab = (event: KeyboardEvent) => {
      const tab =
        event.key === "Tab" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey;
      if (tab && field.mode === "latex" && rawLatexInput(field) === "") {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.executeCommand(["complete", "reject"]);
        focusControlOutsideFormulas(field, event.shiftKey ? -1 : 1);
      }
    };
    // Up/Down with nothing above (below) inside the formula moves to another row.
    // The editor's keys (rows, hotkeys, history, leaving an empty LaTeX box) are
    // key commands the field's key entry offers each keydown before the kernel.
    kernelEditingCore.setHost(field, {
      verticalExit: (direction) =>
        propsRef.current.onVerticalExit(
          propsRef.current.index,
          direction,
          field,
        ),
      keyCommands: [
        (event) => {
          handleKeyDown(event);
          return event.cancelBubble;
        },
        (event) => {
          handleLatexBoxTab(event);
          return event.cancelBubble;
        },
      ],
      selectionDrag: {
        target: (clientX: number, clientY: number) =>
          propsRef.current.selectionDrag.target?.(clientX, clientY),
        area: () => propsRef.current.selectionDrag.area?.() ?? null,
        scrollers: () => propsRef.current.selectionDrag.scrollers?.() ?? [],
        drop: (...args: Parameters<NonNullable<SelectionDragHost["drop"]>>) =>
          propsRef.current.selectionDrag.drop?.(...args),
      },
    });
    // Capture before MathLive's keyboard sink replaces a selected placeholder;
    // the bubble phase is already too late because the parent structure is gone.
    field.addEventListener("compositionstart", handleCompositionStart, true);
    field.addEventListener("compositionend", handleCompositionEnd);
    field.addEventListener("beforeinput", handleBeforeInput, true);
    field.addEventListener("input", handleInput);
    field.addEventListener("selection-change", handleSelectionChange);
    field.addEventListener("focus", handleFocus);
    field.addEventListener("blur", handleBlur);
    field.addEventListener("paste", handlePaste, true);
    field.shadowRoot?.addEventListener(
      "contextmenu",
      suppressMathLiveContextMenu,
      true,
    );
    host.addEventListener("contextmenu", suppressMathLiveContextMenu, true);
    host.addEventListener("pointerdown", handlePointerDown, true);
    const content =
      field.shadowRoot?.querySelector<HTMLElement>('[part="content"]');
    const resizeObserver = content
      ? new ResizeObserver(() => {
          syncFrameSize();
        })
      : null;
    const inputMutationObserver = field.shadowRoot
      ? new MutationObserver(() => {
          markKernelFormulaGlyphFonts(field);
          syncFrameSize();
        })
      : null;
    if (content) resizeObserver?.observe(content);
    if (field.shadowRoot) {
      inputMutationObserver?.observe(field.shadowRoot, {
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class"],
        subtree: true,
      });
    }
    // The field is now connected, but React's layout effect still runs before
    // the browser's first paint. Resolve the actual MathLive geometry here so
    // a newly inserted line never paints with the CSS fallback or predicted
    // height and then visibly shrinks on the next animation frame.
    measureFrameSize();
    queueMicrotask(() => {
      if (!field.isConnected) return;
      measureFrameSize();
    });

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.clearTimeout(backslashGuardTimer);
      resizeObserver?.disconnect();
      inputMutationObserver?.disconnect();
      syncFrameSizeRef.current = null;
      field.removeEventListener(
        "compositionstart",
        handleCompositionStart,
        true,
      );
      field.removeEventListener("compositionend", handleCompositionEnd);
      field.removeEventListener("beforeinput", handleBeforeInput, true);
      field.removeEventListener("input", handleInput);
      field.removeEventListener("selection-change", handleSelectionChange);
      window.cancelAnimationFrame(uprightCaretFrame);
      field.removeEventListener("focus", handleFocus);
      field.removeEventListener("blur", handleBlur);
      kernelEditingCore.setHost(field, null);
      field.removeEventListener("paste", handlePaste, true);
      field.shadowRoot?.removeEventListener(
        "contextmenu",
        suppressMathLiveContextMenu,
        true,
      );
      host.removeEventListener(
        "contextmenu",
        suppressMathLiveContextMenu,
        true,
      );
      host.removeEventListener("pointerdown", handlePointerDown, true);
      host
        .closest<HTMLElement>("[data-line-id]")
        ?.style.removeProperty("--formula-row-height");
      propsRef.current.register(registeredLineIdRef.current, null, field);
      fieldRef.current = null;
      lastSnapshotRef.current = null;
      compositionStartRef.current = null;
      cancelCaretRepaint(field);
      host.replaceChildren();
    };
  }, []);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const previousLineId = registeredLineIdRef.current;
    if (previousLineId === props.lineId) return;
    propsRef.current.register(previousLineId, null, field);
    propsRef.current.register(props.lineId, field);
    registeredLineIdRef.current = props.lineId;
  }, [props.lineId]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    setMathLivePersistentTypingStyle(field, props.persistentTypingStyle);
  }, [
    props.persistentTypingStyle.bold,
    props.persistentTypingStyle.italic,
    props.persistentTypingStyle.color,
    props.persistentTypingStyle.backgroundColor,
  ]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    const host = hostRef.current;
    if (!field || !host) return;
    const zoomChanged = sizingZoomRef.current !== props.zoom;
    const rowVerticalInsetChanged =
      sizingRowVerticalInsetRef.current !== props.formulaRowVerticalInset;
    sizingZoomRef.current = props.zoom;
    sizingRowVerticalInsetRef.current = props.formulaRowVerticalInset;

    normalizeCompletedUprightDisplay(field, { edited: false });
    installCustomSymbolShadowStyle(field);

    // 本地输入仅因中文规范化而与 store 等值时，不重建 MathLive 模型；
    // 只更新事务基准，保留当前光标、选区和删除键内部状态。
    if (normalizeChineseLatex(field.value) === props.latex) {
      lastSnapshotRef.current = {
        latex: props.latex,
        selection: captureSelection(field),
      };
      if (!zoomChanged && !rowVerticalInsetChanged) return;
    } else {
      const applyExternalValue = () =>
        field.setValue(props.latex, {
          mode: "math",
          format: "latex",
          insertionMode: "replaceAll",
          selectionMode: "after",
          silenceNotifications: true,
        });
      // replaceAll creates a fresh model root in the kernel: no staging field is mounted for it
      applyExternalValue();
      installCustomSymbolShadowStyle(field);
      field.resetUndo();
    }

    const metrics = formulaRowHeightMetrics(
      props.latex,
      props.zoom,
      props.formulaRowVerticalInset,
    );
    const predictedHeight = predictedFormulaRowHeight(
      props.latex,
      props.zoom,
      props.formulaRowVerticalInset,
      host,
    );
    field.style.fontSize = metrics.fontSize + "px";
    applyFormulaRowHeight(
      field,
      host,
      predictedHeight,
    );
    lastSnapshotRef.current = captureFieldSnapshot(field);
    syncFrameSizeRef.current?.();
  }, [props.formulaRowVerticalInset, props.latex, props.zoom]);

  useEffect(() => {
    if (fieldRef.current) {
      fieldRef.current.smartFence = props.autoPairDelimiters;
    }
  }, [props.autoPairDelimiters]);

  useEffect(() => {
    if (fieldRef.current) fieldRef.current.readOnly = props.readOnly;
  }, [props.readOnly]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    applyKernelFormulaFonts(
      field,
      props.formulaLetterFont,
      props.formulaChineseFont,
    );
    syncFrameSizeRef.current?.();
    const frame = window.requestAnimationFrame(() => {
      if (!field.isConnected) return;
      syncFrameSizeRef.current?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.formulaChineseFont, props.formulaLetterFont]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    MathfieldElement.locale = props.language === "en" ? "en" : "zh-cn";
    const isEn = props.language === "en";
    field.setAttribute(
      "aria-label",
      isEn
        ? "Formula line " + (props.index + 1)
        : "第 " + (props.index + 1) + " 行公式",
    );
    field.removeAttribute("placeholder");
  }, [props.index, props.language]);

  return <div ref={hostRef} className={styles.host} data-field-host data-alignment={props.alignment} data-read-only={props.readOnly || undefined} />;
}
