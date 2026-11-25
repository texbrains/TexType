import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import { kernelRunSelectionDrag } from "@app/kernel/kernel/mathlive.ts";
import type { SelectionDragHost } from "@app/kernel";
import {
  editingModelOf,
  placeCaretAtPoint,
} from "@app/kernel/render/layout-runtime.ts";
import type {
  MathSelectionSnapshot,
  ReplaceDocumentEntry,
} from "../history/historyTypes";
import { createFormulaLine } from "../stores/editorStore";
import type { FormulaLine } from "../types/formula";
import type { RowsEditorContext, RowsRange } from "./editorTypes";
import { joinLatex } from "./fieldHelpers";
import { normalizeChineseLatex } from "./normalizeChineseLatex";
import type { RowFocus } from "./rowFocus";
import {
  captureEditorScrollSnapshot,
  stabilizeEditorScroll,
} from "./rowScroll";
import { insideRowsRange, type RowsSelection } from "./rowsSelection";
import { scrollContainer } from "./fieldHelpers";

export type RowsDrag = ReturnType<typeof createRowsDrag>;

/** Dragging a selection (a formula's own or one across rows) to a stop in another row: moved, or copied. */
export function createRowsDrag(
  ctx: RowsEditorContext,
  focus: RowFocus,
  selection: RowsSelection,
) {
  const {
    history: historyManager,
    surfaceRef,
    fieldRefs,
    linesRef,
    lastSelectionTargetRef,
    multiLineSelectedIdsRef,
    readOnly: interactionReadOnly,
  } = ctx;
  const { setActiveLine, focusLine, applyRowsDocument } = focus;
  const {
    captureDocumentSnapshot,
    clearMultiLineSelection,
    applyMultiLineSelection,
    resolveMultiLineSelectionPoint,
    multiLineRange,
    lineOfField,
  } = selection;

  /** The containers a drag scrolls when the pointer nears their edges. */
  const paneScrollers = () => {
    const pane = scrollContainer(surfaceRef.current);
    return pane ? [pane] : [];
  };

  /** The editor's visible area: a drag let go outside it drops nothing (AxMath). */
  const dropArea = () =>
    (
      scrollContainer(surfaceRef.current) ?? surfaceRef.current
    )?.getBoundingClientRect() ?? null;

  /** Where a dragged selection would land: a row's formula and a stop in it. */
  const dropTargetAt = (clientX: number, clientY: number) => {
    const point = resolveMultiLineSelectionPoint(clientX, clientY);
    const field = point ? fieldRefs.current.get(point.lineId) : null;
    return point && field?.isConnected ? { field, stop: point.offset } : null;
  };

  /**
   * Puts a drop into the document as one step of the history and selects
   * what was dropped (AxMath): in one row, or from a row's stop to another's.
   */
  const commitDrop = (
    nextLinesOf: (lines: FormulaLine[]) => FormulaLine[] | null,
    dropped:
      | { lineId: string; range: [number, number] }
      | {
          anchor: { lineId: string; offset: number };
          focus: { lineId: string; offset: number };
        },
  ) => {
    historyManager.commitPendingTransaction();
    const before = captureDocumentSnapshot();
    before.lines = before.lines.map((line) => {
      const currentField = fieldRefs.current.get(line.id);
      return currentField?.isConnected
        ? { ...line, latex: normalizeChineseLatex(currentField.value) }
        : line;
    });
    const nextLines = nextLinesOf(before.lines);
    if (!nextLines) return;
    const focusLineId =
      "lineId" in dropped ? dropped.lineId : dropped.focus.lineId;
    const focusRange: [number, number] =
      "lineId" in dropped ? dropped.range : [0, dropped.focus.offset];
    const caretAtStart: MathSelectionSnapshot = {
      ranges: [[0, 0]],
      direction: "none",
    };
    const previous = new Map(before.lines.map((line) => [line.id, line.latex]));
    const after: ReplaceDocumentEntry["after"] = {
      title: before.title,
      lines: nextLines,
      activeLineId: focusLineId,
      formulaAlignment: before.formulaAlignment,
      selectionByLineId: Object.fromEntries(
        nextLines.map((line) => [
          line.id,
          line.id === focusLineId
            ? { ranges: [focusRange], direction: "forward" as const }
            : previous.get(line.id) === line.latex
              ? (before.selectionByLineId[line.id] ?? caretAtStart)
              : caretAtStart,
        ]),
      ),
    };
    const scrollSnapshot = captureEditorScrollSnapshot(
      surfaceRef.current,
      focusLineId,
    );
    clearMultiLineSelection();
    lastSelectionTargetRef.current = null;
    applyRowsDocument(after);
    setActiveLine(focusLineId);
    historyManager.push({
      type: "replace-document",
      before,
      after,
      source: "drag-drop",
      timestamp: Date.now(),
    });
    focusLine(focusLineId, {
      latex: nextLines.find((line) => line.id === focusLineId)?.latex ?? null,
      selection: { ranges: [focusRange], direction: "forward" },
      deferredRepair: false,
    });
    if (!("lineId" in dropped)) {
      const indexOf = (lineId: string) =>
        linesRef.current.findIndex((line) => line.id === lineId);
      applyMultiLineSelection(
        { ...dropped.anchor, lineIndex: indexOf(dropped.anchor.lineId) },
        { ...dropped.focus, lineIndex: indexOf(dropped.focus.lineId) },
      );
    }
    stabilizeEditorScroll(surfaceRef.current, scrollSnapshot);
  };

  /** A formula's selection dropped into another row: moved (or copied) there. */
  const dropFormulaSelection = (
    source: MathfieldElement,
    start: number,
    end: number,
    latex: string,
    target: MathfieldElement,
    stop: number,
    copy: boolean,
  ) => {
    if (interactionReadOnly) return;
    const from = lineOfField(source);
    const to = lineOfField(target);
    if (!from || !to || from.lineId === to.lineId) return;
    const inserted = target.kernelDropResult({ insert: { at: stop, latex } });
    const removed = copy
      ? null
      : source.kernelDropResult({ remove: [start, end] });
    const range = inserted?.inserted;
    if (!inserted || !range || (!copy && !removed)) return;
    commitDrop(
      (lines) =>
        lines.map((line) =>
          line.id === to.lineId
            ? { ...line, latex: normalizeChineseLatex(inserted.latex) }
            : removed && line.id === from.lineId
              ? { ...line, latex: normalizeChineseLatex(removed.latex) }
              : { ...line },
        ),
      { lineId: to.lineId, range },
    );
  };

  /**
   * A selection across rows dropped at a stop (AxMath): at the top level of
   * a row its rows stay rows (the first joins the row before the stop, the
   * last the row after it); inside a structure they go in as one. Moved, the
   * rows it leaves are joined as Delete joins them.
   */
  const dropRows = (
    range: RowsRange,
    targetField: MathfieldElement,
    stop: number,
    copy: boolean,
  ) => {
    if (interactionReadOnly) return;
    const target = lineOfField(targetField);
    const lines = linesRef.current;
    const startLine = lines[range.start.lineIndex];
    const endLine = lines[range.end.lineIndex];
    const startField = startLine ? fieldRefs.current.get(startLine.id) : null;
    const endField = endLine ? fieldRefs.current.get(endLine.id) : null;
    if (
      !target ||
      !startLine ||
      !endLine ||
      !startField?.isConnected ||
      !endField?.isConnected
    )
      return;
    const part = (field: MathfieldElement, from: number, to: number) =>
      normalizeChineseLatex(field.getValue(from, to, "latex"));
    const whole = (lineIndex: number) => {
      const field = fieldRefs.current.get(lines[lineIndex]?.id ?? "");
      return field?.isConnected
        ? normalizeChineseLatex(field.value)
        : (lines[lineIndex]?.latex ?? "");
    };
    // what moves: the first row's end, the rows between, the last row's start
    const parts = [part(startField, range.start.offset, startField.lastOffset)];
    for (
      let index = range.start.lineIndex + 1;
      index < range.end.lineIndex;
      index += 1
    ) {
      parts.push(whole(index));
    }
    parts.push(part(endField, 0, range.end.offset));
    // what stays of the rows it leaves, joined into the first of them
    const head = part(startField, 0, range.start.offset);
    const tail = part(endField, range.end.offset, endField.lastOffset);
    const joined = joinLatex(head, tail);
    // a move into the rows it leaves lands in the joined row
    const intoJoined =
      !copy &&
      (target.lineIndex === range.start.lineIndex ||
        target.lineIndex === range.end.lineIndex);
    const joinedStop =
      intoJoined && target.lineIndex === range.end.lineIndex
        ? range.start.offset + (stop - range.end.offset)
        : stop;
    const dropLine =
      lines[intoJoined ? range.start.lineIndex : target.lineIndex];
    if (!dropLine) return;
    const model = editingModelOf(targetField);
    const atom = model?.at(stop);
    const topLevel = !model || !atom || atom.parent === model.root;
    const rebuild =
      (dropRows: FormulaLine[] | ((line: FormulaLine) => FormulaLine[])) =>
      (current: FormulaLine[]) =>
        current.flatMap((line, index) => {
          if (
            !copy &&
            index > range.start.lineIndex &&
            index <= range.end.lineIndex
          )
            return [];
          if (line.id === dropLine.id)
            return typeof dropRows === "function" ? dropRows(line) : dropRows;
          if (!copy && index === range.start.lineIndex)
            return [{ ...line, latex: joined }];
          return [{ ...line }];
        });

    if (!topLevel) {
      const flat = parts.reduce(joinLatex);
      const result = intoJoined
        ? startField.kernelDropResult({
            base: joined,
            insert: { at: joinedStop, latex: flat },
          })
        : targetField.kernelDropResult({ insert: { at: stop, latex: flat } });
      const inserted = result?.inserted;
      if (!result || !inserted) return;
      commitDrop(
        rebuild((line) => [
          { ...line, latex: normalizeChineseLatex(result.latex) },
        ]),
        { lineId: dropLine.id, range: inserted },
      );
      return;
    }

    // the drop row's LaTeX before and after the stop
    let before: string;
    let after: string;
    if (intoJoined && target.lineIndex === range.start.lineIndex) {
      before = part(startField, 0, stop);
      after = joinLatex(part(startField, stop, range.start.offset), tail);
    } else if (intoJoined) {
      before = joinLatex(head, part(endField, range.end.offset, stop));
      after = part(endField, stop, endField.lastOffset);
    } else {
      before = part(targetField, 0, stop);
      after = part(targetField, stop, targetField.lastOffset);
    }
    const lastPart = parts[parts.length - 1] ?? "";
    const lastPartEnd =
      targetField.kernelDropResult({ base: lastPart })?.lastOffset ?? 0;
    const lastRow = createFormulaLine(
      joinLatex(lastPart, after),
      undefined,
      dropLine.mode,
      dropLine.displayStyle ?? "default",
    );
    const between = lines.slice(range.start.lineIndex + 1, range.end.lineIndex);
    commitDrop(
      rebuild((line) => [
        { ...line, latex: joinLatex(before, parts[0] ?? "") },
        // the rows between come along (copied: new rows like them)
        ...between.map((row, index) =>
          copy
            ? createFormulaLine(
                parts[index + 1] ?? "",
                undefined,
                row.mode,
                row.displayStyle ?? "default",
              )
            : { ...row, latex: parts[index + 1] ?? row.latex },
        ),
        lastRow,
      ]),
      {
        anchor: { lineId: dropLine.id, offset: joinedStop },
        focus: { lineId: lastRow.id, offset: lastPartEnd },
      },
    );
  };

  /** The formula rows' side of a formula's selection drag (DESIGN §6.12). */
  const rowSelectionDrag: SelectionDragHost = {
    target: dropTargetAt,
    area: dropArea,
    scrollers: paneScrollers,
    drop: (source, start, end, latex, target, copy) =>
      dropFormulaSelection(
        source as MathfieldElement,
        start,
        end,
        latex,
        target.field as MathfieldElement,
        target.stop,
        copy,
      ),
  };

  /** A press on a selection across rows: drag it (AxMath's drag, as a formula drags its own). */
  const startRowsDrag = (press: PointerEvent) => {
    const range = multiLineRange();
    if (!range) return;
    kernelRunSelectionDrag(
      {
        resolve: dropTargetAt,
        area: dropArea,
        inside: (target) => {
          const row = lineOfField(target.field);
          return !row || insideRowsRange(range, row.lineIndex, target.stop);
        },
        scrollers: paneScrollers,
        commit: (target, copy) =>
          dropRows(range, target.field as MathfieldElement, target.stop, copy),
        // let go where it was pressed, or back on the selection: a click there
        click: (clientX, clientY) => {
          const point = resolveMultiLineSelectionPoint(clientX, clientY);
          clearMultiLineSelection();
          const field = point ? fieldRefs.current.get(point.lineId) : null;
          if (!point || !field?.isConnected) return;
          (field as HTMLElement).focus({ preventScroll: true });
          placeCaretAtPoint(field, clientX, clientY);
          field.shadowRoot
            ?.querySelector<HTMLElement>('[part="keyboard-sink"]')
            ?.focus({ preventScroll: true });
          setActiveLine(point.lineId);
        },
      },
      press,
    );
  };

  /** A press on any selected row's highlight. */
  const pressOnRowsSelection = (clientX: number, clientY: number) =>
    [...multiLineSelectedIdsRef.current].some((lineId) =>
      fieldRefs.current.get(lineId)?.kernelPointOnSelection(clientX, clientY),
    );

  return {
    rowSelectionDrag,
    startRowsDrag,
    pressOnRowsSelection,
    paneScrollers,
  };
}
