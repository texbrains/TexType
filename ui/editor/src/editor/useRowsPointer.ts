import { useEffect, useRef, type RefObject } from "react";
import { KernelEdgeScroller } from "@app/kernel/kernel/mathlive.ts";
import { storedLatexToUser } from "@app/kernel/latex/exam-zh-symbols.ts";
import { placeCaretAtPoint } from "@app/kernel/render/layout-runtime.ts";
import { formatFormulaLinesUniversal } from "../clipboard/LatexCopyService";
import { toPortableBoldLatex } from "../clipboard/portableBoldLatex";
import { formatLatexSourceForEditor } from "../source-editor/latexSourceEditorSupport";
import type { PointerSelectionSession, RowsEditorContext } from "./editorTypes";
import {
  captureSelection,
  KERNEL_MULTILINE_LATEX_CLIPBOARD_TYPE,
} from "./fieldHelpers";
import { kernelSourcePreviewClass } from "./formulaFieldStyles";
import { normalizeChineseLatex } from "./normalizeChineseLatex";
import type { RowEdits } from "./rowEdits";
import type { RowFocus } from "./rowFocus";
import type { RowsDrag } from "./rowsDrag";
import type { RowsSelection } from "./rowsSelection";

/**
 * The mouse on the rows (AxMath) and the clipboard of a selection across rows:
 * presses, drags that select across rows (scrolling the pane near its edges),
 * Shift+press, the first press on the source preview, copy and cut.
 */
export function useRowsPointer(
  ctx: RowsEditorContext,
  focus: RowFocus,
  selection: RowsSelection,
  drag: RowsDrag,
  edits: RowEdits,
  previewOnlyRef: RefObject<boolean>,
  onPreviewActivate: (() => void) | undefined,
) {
  const {
    surfaceRef,
    fieldRefs,
    linesRef,
    lastSelectionTargetRef,
    multiLineSelectionRef,
    multiLineSelectedIdsRef,
    pointerSelectionSessionRef,
    readOnly: interactionReadOnly,
    latexFormatProfile,
  } = ctx;
  const { setActiveLine } = focus;
  const {
    clearMultiLineSelection,
    resolveMultiLineSelectionPoint,
    caretAnchor,
    selectRowsBetween,
  } = selection;
  const { startRowsDrag, pressOnRowsSelection, paneScrollers } = drag;
  const { deleteMultiLineSelection } = edits;

  // a selection dragged across rows scrolls the pane near its edges (as a drag does)
  const sessionScrollerRef = useRef(new KernelEdgeScroller());
  const sessionScrollTimerRef = useRef(0);
  const sessionScrollTickRef = useRef<(() => boolean) | null>(null);
  const startSessionScrolling = () => {
    if (sessionScrollTimerRef.current) return;
    sessionScrollerRef.current = new KernelEdgeScroller();
    sessionScrollTimerRef.current = window.setInterval(() => {
      if (!sessionScrollTickRef.current?.()) stopSessionScrolling();
    }, 50);
  };
  const stopSessionScrolling = () => {
    window.clearInterval(sessionScrollTimerRef.current);
    sessionScrollTimerRef.current = 0;
  };
  useEffect(() => stopSessionScrolling, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    // AxMath's mouse (DESIGN §6.9, §6.12): a press in a formula places its
    // caret (the formula's own hit test) and a drag selects within it; once
    // the pointer reaches another row the editor selects across rows from
    // the press (each end at the top level of its formula) and the formula
    // stops tracking. A press on a selection's highlight drags it, Shift or
    // not; Shift+press selects from the caret to the point, across rows too.
    const handleSurfacePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const path = event.composedPath();
      const entry = Array.from(fieldRefs.current.entries()).find(
        ([, field]) =>
          path.includes(field) ||
          Boolean(field.parentElement && path.includes(field.parentElement)),
      );
      if (!entry) return;
      const [lineId, field] = entry;

      if (previewOnlyRef.current) {
        if (event.shiftKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!onPreviewActivate) {
          document
            .querySelector<HTMLElement>("[data-source-editor] .cm-content")
            ?.focus({ preventScroll: true });
          return;
        }
        previewOnlyRef.current = false;
        for (const field of fieldRefs.current.values()) {
          if (!field.isConnected) continue;
          field.classList.remove(kernelSourcePreviewClass);
          field.readOnly = false;
        }
        onPreviewActivate();

        const [lineId, field] = entry;
        field.focus();
        placeCaretAtPoint(field, event.clientX, event.clientY);
        field.shadowRoot
          ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
          ?.focus({ preventScroll: true });
        setActiveLine(lineId);
        return;
      }

      if (
        multiLineSelectionRef.current &&
        !interactionReadOnly &&
        pressOnRowsSelection(event.clientX, event.clientY)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        startRowsDrag(event);
        return;
      }
      if (event.shiftKey) {
        const focus = resolveMultiLineSelectionPoint(
          event.clientX,
          event.clientY,
          lineId,
        );
        const anchor = multiLineSelectionRef.current?.anchor ?? caretAnchor();
        // in the row of the caret the formula extends its own selection
        if (
          !focus ||
          !anchor ||
          (!multiLineSelectionRef.current && anchor.lineId === focus.lineId)
        )
          return;
        const anchorField = fieldRefs.current.get(anchor.lineId);
        if (!anchorField?.isConnected) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        selectRowsBetween(anchor, focus);
        pointerSelectionSessionRef.current = {
          pointerId: event.pointerId,
          anchor,
          field: anchorField,
          beside: false,
          active: true,
          last: focus,
          clientX: event.clientX,
          clientY: event.clientY,
        };
        startSessionScrolling();
        return;
      }
      lastSelectionTargetRef.current = null;
      // a press on the formula's own selection: the formula drags it
      if (
        !multiLineSelectionRef.current &&
        !interactionReadOnly &&
        field.kernelPointOnSelection(event.clientX, event.clientY)
      ) {
        return;
      }
      clearMultiLineSelection();
      const anchor = resolveMultiLineSelectionPoint(
        event.clientX,
        event.clientY,
        lineId,
      );
      if (!anchor) return;
      const box = field.getBoundingClientRect();
      pointerSelectionSessionRef.current = {
        pointerId: event.pointerId,
        anchor,
        field,
        beside:
          event.clientX < box.left ||
          event.clientX >= box.right ||
          event.clientY < box.top ||
          event.clientY >= box.bottom,
        active: false,
        last: null,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    };

    /** The selection from the session's anchor to the row stop under the pointer (AxMath: only when an end changes). */
    const extendSession = (session: PointerSelectionSession) => {
      const focus = resolveMultiLineSelectionPoint(
        session.clientX,
        session.clientY,
      );
      // below every row nothing changes
      if (!focus) return;
      if (
        session.last?.lineId === focus.lineId &&
        session.last.offset === focus.offset
      )
        return;
      session.last = focus;
      selectRowsBetween(session.anchor, focus);
    };
    sessionScrollTickRef.current = () => {
      const session = pointerSelectionSessionRef.current;
      if (!session?.active) return false;
      if (
        sessionScrollerRef.current.tick(
          paneScrollers(),
          session.clientX,
          session.clientY,
        )
      ) {
        extendSession(session);
      }
      return true;
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      const session = pointerSelectionSessionRef.current;
      if (!session) {
        if (multiLineSelectionRef.current && event.buttons === 0) {
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.pointerId !== session.pointerId) return;
      // the formula drags its own selection
      if (session.field.classList.contains("kernel-selection-drag")) {
        pointerSelectionSessionRef.current = null;
        return;
      }
      // AxMath selects on a move only while the left button is held: a
      // release that never reached us (outside the window) ends it here
      if (!(event.buttons & 1)) {
        pointerSelectionSessionRef.current = null;
        stopSessionScrolling();
        if (session.active) {
          const selection = multiLineSelectionRef.current;
          setActiveLine(
            selection ? selection.focus.lineId : session.anchor.lineId,
          );
        }
        return;
      }
      session.clientX = event.clientX;
      session.clientY = event.clientY;
      if (!session.active) {
        // within the pressed row the formula selects (pressed beside the
        // formula, the editor does)
        const focus = resolveMultiLineSelectionPoint(
          event.clientX,
          event.clientY,
        );
        if (!focus) return;
        if (
          focus.lineId === session.anchor.lineId &&
          (!session.beside || focus.offset === session.anchor.offset)
        )
          return;
        session.active = true;
        // one owner of the gesture from now on: the editor
        session.field.kernelStopPointerTracking();
        startSessionScrolling();
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      extendSession(session);
    };

    const handleWindowPointerEnd = (event: PointerEvent) => {
      const session = pointerSelectionSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      pointerSelectionSessionRef.current = null;
      stopSessionScrolling();
      if (!session.active) return;
      // the selection stays (AxMath); the row of its focus is the active one
      const selection = multiLineSelectionRef.current;
      setActiveLine(selection ? selection.focus.lineId : session.anchor.lineId);
    };

    const handleWindowMouseMove = (event: MouseEvent) => {
      if (
        !pointerSelectionSessionRef.current &&
        multiLineSelectionRef.current &&
        event.buttons === 0
      ) {
        event.stopImmediatePropagation();
      }
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      const session = pointerSelectionSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      pointerSelectionSessionRef.current = null;
      stopSessionScrolling();
      clearMultiLineSelection();
    };

    const handleMultiLineCopy = (event: ClipboardEvent) => {
      const selection = multiLineSelectionRef.current;
      if (!selection || !event.clipboardData) return;
      const selectedLines = linesRef.current.flatMap((line) => {
        if (!multiLineSelectedIdsRef.current.has(line.id)) return [];
        const field = fieldRefs.current.get(line.id);
        if (!field?.isConnected) return [];
        const fieldSelection = captureSelection(field);
        const latex = fieldSelection.ranges
          .map(([start, end]) =>
            field.getValue(
              Math.min(start, end),
              Math.max(start, end),
              "latex-expanded",
            ),
          )
          .join("");
        return [normalizeChineseLatex(latex)];
      });
      if (selectedLines.length <= 1) return;

      const latex = selectedLines.join("\n");
      event.clipboardData.setData(
        KERNEL_MULTILINE_LATEX_CLIPBOARD_TYPE,
        JSON.stringify({ version: 1, lines: selectedLines }),
      );
      event.clipboardData.setData("application/x-latex", latex);
      event.clipboardData.setData(
        "text/plain",
        storedLatexToUser(
          toPortableBoldLatex(
            formatLatexSourceForEditor(
              formatFormulaLinesUniversal(
                linesRef.current
                  .filter((line) =>
                    multiLineSelectedIdsRef.current.has(line.id),
                  )
                  .map((line, index) => ({
                    ...line,
                    latex: selectedLines[index] ?? line.latex,
                  })),
                latexFormatProfile,
              ),
            ),
          ),
        ),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "cut") deleteMultiLineSelection();
    };

    surface.addEventListener("pointerdown", handleSurfacePointerDown, true);
    surface.addEventListener("copy", handleMultiLineCopy, true);
    surface.addEventListener("cut", handleMultiLineCopy, true);
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("mousemove", handleWindowMouseMove, true);
    window.addEventListener("pointerup", handleWindowPointerEnd, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);
    return () => {
      surface.removeEventListener(
        "pointerdown",
        handleSurfacePointerDown,
        true,
      );
      surface.removeEventListener("copy", handleMultiLineCopy, true);
      surface.removeEventListener("cut", handleMultiLineCopy, true);
      window.removeEventListener("pointermove", handleWindowPointerMove, true);
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("pointerup", handleWindowPointerEnd, true);
      window.removeEventListener(
        "pointercancel",
        handleWindowPointerCancel,
        true,
      );
    };
  });
}
