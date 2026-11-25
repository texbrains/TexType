import { editingModelOf } from "@app/kernel/render/layout-runtime.ts";
import { clampSelection } from "../history/HistoryManager";
import type {
  DocumentSelection,
  DocumentSnapshot,
  MathSelectionSnapshot,
} from "../history/historyTypes";
import { getEditorDocumentSnapshot } from "../history/documentHistory";
import { useEditorStore } from "../stores/editorStore";
import type {
  MathEditorInsertionTarget,
  MathEditorSelectionTarget,
  MultiLineSelectionPoint,
  RowsEditorContext,
  RowsRange,
} from "./editorTypes";
import { captureSelection, selectionHasContent } from "./fieldHelpers";
import type { RowFocus } from "./rowFocus";
import { rowIndexAt, stopAtPoint, topLevelStop } from "./rowPointer";

/** A stop inside a selection across rows (or on its edge): a move there changes nothing. */
export function insideRowsRange(
  range: RowsRange,
  lineIndex: number,
  stop: number,
) {
  return (
    (lineIndex > range.start.lineIndex && lineIndex < range.end.lineIndex) ||
    (lineIndex === range.start.lineIndex && stop >= range.start.offset) ||
    (lineIndex === range.end.lineIndex && stop <= range.end.offset)
  );
}

export type RowsSelection = ReturnType<typeof createRowsSelection>;

/**
 * The selection across rows (AxMath): made with the mouse, Shift or Select All, each end at the top level of
 * its formula; the snapshots the session history takes of it; the targets of the style controls.
 */
export function createRowsSelection(ctx: RowsEditorContext, focus: RowFocus) {
  const {
    fieldRefs,
    linesRef,
    activeLineIdRef,
    lastSelectionTargetRef,
    multiLineSelectionRef,
    multiLineSelectionLatexRef,
    multiLineSelectedIdsRef,
    documentSelectionRef,
    documentSelectionNavigationRef,
    bumpSelectionRevision,
  } = ctx;
  const { focusLine, getSelectionMap, resolveTargetField } = focus;

  const clearMultiLineSelection = () => {
    for (const lineId of multiLineSelectedIdsRef.current) {
      const field = fieldRefs.current.get(lineId);
      if (!field?.isConnected) continue;
      field.classList.remove("has-kernel-multi-line-selection");
      field
        .closest<HTMLElement>("[data-line-id]")
        ?.classList.remove("is-multi-line-selected");
      if (!field.selectionIsCollapsed) {
        const position = Math.max(
          0,
          Math.min(field.position, field.lastOffset),
        );
        field.selection = {
          ranges: [[position, position]],
          direction: "none",
        };
      }
    }
    const hadSelection = multiLineSelectedIdsRef.current.size > 0;
    multiLineSelectedIdsRef.current.clear();
    multiLineSelectionRef.current = null;
    documentSelectionRef.current = null;
    documentSelectionNavigationRef.current = null;
    if (hadSelection) {
      bumpSelectionRevision();
    }
  };

  // AxMath's rows (rowPointer.ts): the row a point means is the first one
  // whose bottom is at or below it (none below the last row); the formula's
  // own hit test gives the stop in it.
  const resolveMultiLineSelectionPoint = (
    clientX: number,
    clientY: number,
    preferredLineId?: string,
  ): MultiLineSelectionPoint | null => {
    const lines = linesRef.current;
    const bottomOf = (index: number) =>
      fieldRefs.current
        .get(lines[index]?.id ?? "")
        ?.closest<HTMLElement>("[data-line-id]")
        ?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY;
    const preferred = preferredLineId
      ? lines.findIndex((line) => line.id === preferredLineId)
      : -1;
    const lineIndex =
      preferred >= 0 ? preferred : rowIndexAt(lines.length, bottomOf, clientY);
    if (lineIndex === null) return null;
    const line = lines[lineIndex];
    const field = line ? fieldRefs.current.get(line.id) : null;
    if (!line || !field?.isConnected) return null;
    const offset = stopAtPoint(field, clientX, clientY);
    return offset === null ? null : { lineId: line.id, lineIndex, offset };
  };

  const rememberSelectionTarget = (
    lineId: string,
    selection: MathSelectionSnapshot,
  ) => {
    if (
      documentSelectionNavigationRef.current === lineId &&
      documentSelectionRef.current &&
      multiLineSelectionRef.current
    ) {
      documentSelectionNavigationRef.current = null;
      const field = fieldRefs.current.get(lineId);
      if (field) {
        multiLineSelectionRef.current.focus = {
          lineId,
          lineIndex: linesRef.current.findIndex((line) => line.id === lineId),
          offset: field.position,
        };
        documentSelectionRef.current = {
          ...documentSelectionRef.current,
          [lineId]: selection,
        };
      }
    }
    if (!selectionHasContent(selection)) return;
    lastSelectionTargetRef.current = {
      selections: [
        {
          lineId,
          ranges: selection.ranges,
          direction: selection.direction,
        },
      ],
    };
  };

  const applyMultiLineSelection = (
    anchor: MultiLineSelectionPoint,
    focus: MultiLineSelectionPoint,
  ) => {
    const isForward =
      anchor.lineIndex < focus.lineIndex ||
      (anchor.lineIndex === focus.lineIndex && anchor.offset <= focus.offset);
    const start = isForward ? anchor : focus;
    const end = isForward ? focus : anchor;
    const nextSelectedIds = new Set<string>();

    for (const lineId of multiLineSelectedIdsRef.current) {
      if (
        linesRef.current.findIndex((line) => line.id === lineId) >=
          start.lineIndex &&
        linesRef.current.findIndex((line) => line.id === lineId) <=
          end.lineIndex
      ) {
        continue;
      }
      const field = fieldRefs.current.get(lineId);
      if (!field?.isConnected) continue;
      field.classList.remove("has-kernel-multi-line-selection");
      field
        .closest<HTMLElement>("[data-line-id]")
        ?.classList.remove("is-multi-line-selected");
      const position = Math.max(0, Math.min(field.position, field.lastOffset));
      field.selection = {
        ranges: [[position, position]],
        direction: "none",
      };
    }

    // AxMath: across rows each end stands at the top level of its formula
    // (an end inside a structure takes the whole structure)
    const across = start.lineIndex !== end.lineIndex;
    const fieldAt = (lineIndex: number) => {
      const line = linesRef.current[lineIndex];
      const field = line ? fieldRefs.current.get(line.id) : null;
      return field?.isConnected ? field : null;
    };
    const startField = fieldAt(start.lineIndex);
    const endField = fieldAt(end.lineIndex);
    const startOffset =
      across && startField
        ? topLevelStop(startField, start.offset, "start")
        : start.offset;
    const endOffset =
      across && endField
        ? topLevelStop(endField, end.offset, "end")
        : end.offset;
    for (
      let lineIndex = start.lineIndex;
      lineIndex <= end.lineIndex;
      lineIndex += 1
    ) {
      const line = linesRef.current[lineIndex];
      const field = line ? fieldRefs.current.get(line.id) : null;
      if (!line || !field?.isConnected) continue;
      const rangeStart = lineIndex === start.lineIndex ? startOffset : 0;
      const rangeEnd =
        lineIndex === end.lineIndex ? endOffset : field.lastOffset;
      field.selection = {
        ranges: [
          [Math.min(rangeStart, rangeEnd), Math.max(rangeStart, rangeEnd)],
        ],
        direction: isForward ? "forward" : "backward",
      };
      field.classList.add("has-kernel-multi-line-selection");
      field
        .closest<HTMLElement>("[data-line-id]")
        ?.classList.add("is-multi-line-selected");
      nextSelectedIds.add(line.id);
    }

    multiLineSelectedIdsRef.current = nextSelectedIds;
    multiLineSelectionRef.current = { anchor, focus };
    multiLineSelectionLatexRef.current = new Map(
      linesRef.current
        .filter((line) => nextSelectedIds.has(line.id))
        .map((line) => [line.id, line.latex]),
    );
    const selections = linesRef.current.flatMap((line) => {
      if (!nextSelectedIds.has(line.id)) return [];
      const field = fieldRefs.current.get(line.id);
      if (!field?.isConnected) return [];
      const selection = captureSelection(field);
      return selectionHasContent(selection)
        ? [
            {
              lineId: line.id,
              ranges: selection.ranges,
              direction: selection.direction,
            } satisfies MathEditorInsertionTarget,
          ]
        : [];
    });
    if (selections.length) lastSelectionTargetRef.current = { selections };
    bumpSelectionRevision();
  };

  /** Where the caret (or the selection's anchor) of the active row is. */
  const caretAnchor = (): MultiLineSelectionPoint | null => {
    const lineId = activeLineIdRef.current;
    const lineIndex = lineId
      ? linesRef.current.findIndex((line) => line.id === lineId)
      : -1;
    const field = lineId ? fieldRefs.current.get(lineId) : null;
    const model = field?.isConnected ? editingModelOf(field) : null;
    return lineId && model && lineIndex >= 0
      ? { lineId, lineIndex, offset: model.anchor }
      : null;
  };

  /** From `anchor` to `focus`: across rows the editor's selection, in one row the formula's own. */
  const selectRowsBetween = (
    anchor: MultiLineSelectionPoint,
    focus: MultiLineSelectionPoint,
  ) => {
    if (anchor.lineId !== focus.lineId) {
      applyMultiLineSelection(anchor, focus);
      return;
    }
    clearMultiLineSelection();
    fieldRefs.current
      .get(anchor.lineId)
      ?.kernelSelectStops(anchor.offset, focus.offset);
  };

  /** The selection across rows as its rows show it. */
  const multiLineRange = (): RowsRange | null => {
    const selected = linesRef.current.flatMap((line, lineIndex) => {
      const field = fieldRefs.current.get(line.id);
      return multiLineSelectedIdsRef.current.has(line.id) && field?.isConnected
        ? [
            {
              lineId: line.id,
              lineIndex,
              ranges: field.selection.ranges.flat(),
            },
          ]
        : [];
    });
    const first = selected[0];
    const last = selected.at(-1);
    if (!first || !last || first === last) return null;
    return {
      start: {
        lineId: first.lineId,
        lineIndex: first.lineIndex,
        offset: Math.min(...first.ranges),
      },
      end: {
        lineId: last.lineId,
        lineIndex: last.lineIndex,
        offset: Math.max(...last.ranges),
      },
    };
  };

  const lineOfField = (field: Element) => {
    for (const [lineId, candidate] of fieldRefs.current) {
      if (candidate !== field) continue;
      const lineIndex = linesRef.current.findIndex(
        (line) => line.id === lineId,
      );
      return lineIndex >= 0 ? { lineId, lineIndex } : null;
    }
    return null;
  };

  /** A selection across rows (made with the mouse or Shift): an edit in one of its rows replaces all of it. */
  const crossRowsSelected = () => {
    const selection = multiLineSelectionRef.current;
    return Boolean(
      selection && selection.anchor.lineId !== selection.focus.lineId,
    );
  };

  /** The rows' document with each mounted row's selection and the selection across rows (the session history's view). */
  const captureDocumentSnapshot = (
    selections = getSelectionMap(),
  ): DocumentSnapshot => {
    const snapshot = getEditorDocumentSnapshot(selections);
    const selection = multiLineSelectionRef.current;
    snapshot.documentSelection = selection
      ? {
          anchor: {
            lineId: selection.anchor.lineId,
            offset: selection.anchor.offset,
          },
          focus: {
            lineId: selection.focus.lineId,
            offset: selection.focus.offset,
          },
        }
      : null;
    return snapshot;
  };

  /** A selection across rows given by row ids: selected again (false: one of its rows is gone). */
  const applyDocumentSelection = (selection: DocumentSelection) => {
    const indexOf = (lineId: string) =>
      linesRef.current.findIndex((line) => line.id === lineId);
    const anchorIndex = indexOf(selection.anchor.lineId);
    const focusIndex = indexOf(selection.focus.lineId);
    if (anchorIndex < 0 || focusIndex < 0) return false;
    if (anchorIndex === focusIndex) {
      clearMultiLineSelection();
      return true;
    }
    applyMultiLineSelection(
      { ...selection.anchor, lineIndex: anchorIndex },
      { ...selection.focus, lineIndex: focusIndex },
    );
    return true;
  };

  /**
   * After undo/redo (and for a selection given by the session): every row's selection from the snapshot, the
   * active row focused, then the selection across rows the snapshot had.
   */
  const restoreDocumentSelection = (snapshot: DocumentSnapshot) => {
    const line = snapshot.lines.find(
      (item) => item.id === snapshot.activeLineId,
    );
    if (!line) return false;
    clearMultiLineSelection();
    for (const [lineId, saved] of Object.entries(snapshot.selectionByLineId)) {
      const mounted = fieldRefs.current.get(lineId);
      if (mounted?.isConnected)
        mounted.selection = clampSelection(saved, mounted.lastOffset);
    }
    const selection = snapshot.documentSelection;
    const focused = focusLine(line.id, {
      latex: line.latex,
      selection: selection
        ? null
        : (snapshot.selectionByLineId[line.id] ?? null),
      deferredRepair: !selection,
    });
    if (selection) {
      // the rows hold the snapshot's LaTeX already
      applyDocumentSelection(selection);
    }
    return Boolean(focused);
  };

  const captureInsertionTarget = (): MathEditorInsertionTarget | null => {
    const target = resolveTargetField();
    if (!target) return null;
    const selection = captureSelection(target.field);
    return {
      lineId: target.lineId,
      ranges: selection.ranges,
      direction: selection.direction,
      documentSelection: captureDocumentSnapshot().documentSelection,
    };
  };

  const captureSelectionTarget = (): MathEditorSelectionTarget | null => {
    // MathLive fields can retain a visual/model selection after focus moves to
    // another formula. A formatting button must never sweep those stale
    // selections from unrelated rows. Only an explicit TexType multi-line
    // drag is allowed to target more than the active formula row.
    const explicitMultiLineSelection = Boolean(multiLineSelectionRef.current);
    const activeLineId =
      activeLineIdRef.current ?? useEditorStore.getState().activeLineId;
    const candidateLines = explicitMultiLineSelection
      ? linesRef.current.filter((line) =>
          multiLineSelectedIdsRef.current.has(line.id),
        )
      : linesRef.current.filter((line) => line.id === activeLineId);
    const selections = candidateLines.flatMap((line) => {
      const field = fieldRefs.current.get(line.id);
      if (!field?.isConnected) return [];
      const selection = captureSelection(field);
      if (!selectionHasContent(selection)) return [];
      return [
        {
          lineId: line.id,
          ranges: selection.ranges,
          direction: selection.direction,
        } satisfies MathEditorInsertionTarget,
      ];
    });
    if (selections.length) {
      const target = { selections };
      lastSelectionTargetRef.current = target;
      return target;
    }
    lastSelectionTargetRef.current = null;
    return null;
  };

  /** The selection across rows (made with the mouse, Shift or Select All): its first and last row's ends. */
  const rowsSelectionBounds = () => {
    const range = multiLineRange();
    if (range) return range;
    if (!documentSelectionRef.current) return null;
    const lines = linesRef.current;
    const first = lines[0];
    const last = lines.at(-1);
    const lastField = last ? fieldRefs.current.get(last.id) : null;
    if (!first || !last || first === last || !lastField?.isConnected)
      return null;
    return {
      start: { lineId: first.id, lineIndex: 0, offset: 0 },
      end: {
        lineId: last.id,
        lineIndex: lines.length - 1,
        offset: lastField.lastOffset,
      },
    };
  };

  return {
    clearMultiLineSelection,
    resolveMultiLineSelectionPoint,
    rememberSelectionTarget,
    applyMultiLineSelection,
    caretAnchor,
    selectRowsBetween,
    multiLineRange,
    lineOfField,
    crossRowsSelected,
    captureDocumentSnapshot,
    applyDocumentSelection,
    restoreDocumentSelection,
    captureInsertionTarget,
    captureSelectionTarget,
    rowsSelectionBounds,
  };
}
