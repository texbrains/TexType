// The editor store as history sees it: snapshots of the rows, and history entries applied back to the store.
import type { FormulaLine } from "../types/formula";
import { cloneFormulaLines, useEditorStore } from "../stores/editorStore";
import { cloneSelectionMap } from "./documentSnapshot";
import type {
  DocumentSnapshot,
  HistoryEntry,
  MathSelectionSnapshot,
  ReplayDirection,
} from "./historyTypes";

/** Where focus goes after an entry is applied: a row and its selection, or a whole snapshot's selection. */
export interface FocusRestoreTarget {
  lineId: string;
  latex: string;
  selection: MathSelectionSnapshot | null;
  document?: DocumentSnapshot;
}

export function getEditorDocumentSnapshot(
  selectionByLineId: Record<string, MathSelectionSnapshot> = {},
): DocumentSnapshot {
  const state = useEditorStore.getState();
  return {
    title: state.title,
    lines: cloneFormulaLines(state.lines),
    activeLineId: state.activeLineId,
    formulaAlignment: state.formulaAlignment,
    selectionByLineId: cloneSelectionMap(selectionByLineId),
  };
}

/** New row values on the current rows: rows keep their ids, modes and display styles by position. */
export function reconcileFormulaLines(
  values: readonly string[],
  currentLines: readonly FormulaLine[],
  modes?: readonly FormulaLine["mode"][],
  displayStyles?: readonly FormulaLine["displayStyle"][],
): FormulaLine[] {
  const normalizedValues = values.length ? values : [""];
  return normalizedValues.map((latex, index) => ({
    id: currentLines[index]?.id ?? crypto.randomUUID(),
    latex,
    mode: modes?.[index] ?? currentLines[index]?.mode ?? "display",
    displayStyle: displayStyles?.[index] ?? currentLines[index]?.displayStyle ?? "default",
  }));
}

function targetFromSnapshot(snapshot: DocumentSnapshot): FocusRestoreTarget | null {
  const lineId = snapshot.activeLineId;
  const line = lineId ? snapshot.lines.find((item) => item.id === lineId) : undefined;
  if (!lineId || !line) return null;
  return {
    lineId,
    latex: line.latex,
    selection: snapshot.selectionByLineId[lineId] ?? null,
    document: snapshot,
  };
}

export function applyHistoryEntryToEditor(
  entry: HistoryEntry,
  direction: ReplayDirection,
): FocusRestoreTarget | null {
  const undoing = direction === "undo";
  const store = useEditorStore.getState();

  switch (entry.type) {
    case "replace-formula": {
      const latex = undoing ? entry.beforeLatex : entry.afterLatex;
      const lineId = (undoing ? entry.beforeActiveLineId : entry.afterActiveLineId) ?? entry.lineId;
      store.replaceFormulaLine(entry.lineId, latex, lineId);
      return {
        lineId,
        latex: useEditorStore.getState().lines.find((line) => line.id === lineId)?.latex ?? latex,
        selection: undoing ? entry.beforeSelection : entry.afterSelection,
      };
    }

    case "add-line":
    case "remove-line": {
      const inserting = (entry.type === "add-line") !== undoing;
      const lines = store.lines.filter((line) => line.id !== entry.line.id);
      if (inserting) lines.splice(Math.max(0, Math.min(entry.index, lines.length)), 0, entry.line);
      const activeLineId =
        (undoing ? entry.beforeActiveLineId : entry.afterActiveLineId) ?? (inserting ? entry.line.id : null);
      store.replaceDocumentState({ ...getEditorDocumentSnapshot(), lines, activeLineId });
      const next = useEditorStore.getState();
      const line = next.lines.find((item) => item.id === next.activeLineId);
      return line
        ? {
            lineId: line.id,
            latex: line.latex,
            selection: undoing ? entry.beforeSelection : entry.afterSelection,
          }
        : null;
    }

    case "replace-document": {
      const snapshot = undoing ? entry.before : entry.after;
      store.replaceDocumentState(snapshot);
      return targetFromSnapshot(snapshot);
    }
  }
}
