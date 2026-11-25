import type { RefObject } from "react";
import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import type { HistoryManager } from "../history/HistoryManager";
import type {
  DocumentSelection,
  DocumentSnapshot,
  EditKind,
  FormulaEditSource,
  MathSelectionSnapshot,
} from "../history/historyTypes";
import type { Command, CommandSource } from "../types/command";
import type { FormulaLine, LatexFormatProfile } from "../types/formula";

export interface MathEditorInsertionTarget {
  lineId: string;
  ranges: Array<[number, number]>;
  direction: "forward" | "backward" | "none";
  /** A selection across rows when the target was captured (an insertion replaces it). */
  documentSelection?: DocumentSelection | null;
}

export interface MathEditorSelectionTarget {
  selections: MathEditorInsertionTarget[];
}

export type MathEditorSelectionStyle =
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "color"; value: string }
  | { kind: "backgroundColor"; value: string };

export interface MathEditorFocusOptions {
  target?: "active" | "first" | "last";
  moveToEnd?: boolean;
}

export interface MathEditorHandle {
  insertCommand: (
    command: Command,
    source?: "toolbar" | "history" | "shortcut",
  ) => void;
  /** LaTeX inserted at a captured target (the result of a pasted image, see onPasteImage). */
  insertLatexAt: (
    target: MathEditorInsertionTarget,
    latex: string,
    source?: FormulaEditSource,
  ) => boolean;
  focus: (options?: MathEditorFocusOptions) => void;
  getSelectionMap: () => Record<string, MathSelectionSnapshot>;
  restoreSelection: (
    lineId: string,
    latex: string,
    selection: MathSelectionSnapshot | null,
  ) => Promise<boolean>;
  captureSelectionTarget: () => MathEditorSelectionTarget | null;
  captureInsertionTarget: () => MathEditorInsertionTarget | null;
  applySelectionStyle: (
    style: MathEditorSelectionStyle,
    target?: MathEditorSelectionTarget | null,
  ) => boolean;
  captureDocumentSnapshot: () => DocumentSnapshot;
  restoreDocumentSelection: (snapshot: DocumentSnapshot) => boolean;
}

export interface FormulaFieldEdit {
  lineId: string;
  beforeLatex: string;
  afterLatex: string;
  beforeSelection: MathSelectionSnapshot;
  afterSelection: MathSelectionSnapshot;
  editKind: EditKind;
  source: FormulaEditSource;
}

export interface MultiLineSelectionPoint {
  lineId: string;
  lineIndex: number;
  offset: number;
}

export interface MultiLineSelectionState {
  anchor: MultiLineSelectionPoint;
  focus: MultiLineSelectionPoint;
}

export interface PointerSelectionSession {
  pointerId: number;
  anchor: MultiLineSelectionPoint;
  /** The formula pressed: it selects within itself until the pointer reaches another row. */
  field: MathfieldElement;
  /**
   * Pressed in the row beside the formula (a formula does not fill its row):
   * the formula never sees the press, so the editor selects within the row too.
   */
  beside: boolean;
  /** The pointer reached another row: the editor selects from then on. */
  active: boolean;
  /** The focus last selected to (AxMath selects again only when an end changes). */
  last: MultiLineSelectionPoint | null;
  clientX: number;
  clientY: number;
}

/** A selection across rows as the rows hold it: from the first row's start to the last row's end. */
export interface RowsRange {
  start: MultiLineSelectionPoint;
  end: MultiLineSelectionPoint;
}

export interface PendingFocus {
  lineId: string;
  latex: string | null;
  selection: MathSelectionSnapshot | null;
  moveToEnd: boolean;
  deferredRepair: boolean;
}

/** The rows editor's shared state: the refs and settings its parts (focus, selection, edits, keys) work on. */
export interface RowsEditorContext {
  history: HistoryManager;
  surfaceRef: RefObject<HTMLDivElement | null>;
  fieldRefs: RefObject<Map<string, MathfieldElement>>;
  linesRef: RefObject<FormulaLine[]>;
  activeIndexRef: RefObject<number>;
  activeLineIdRef: RefObject<string | null>;
  focusRequestRef: RefObject<number>;
  pendingFocusRef: RefObject<PendingFocus | null>;
  setActiveIndex: (update: (current: number) => number) => void;
  /** The row whose field edits are recorded by the caller (a discrete mutation), not by its input event. */
  suppressedHistoryLineIdRef: RefObject<string | null>;
  lastSelectionTargetRef: RefObject<MathEditorSelectionTarget | null>;
  greekPrefixLineIdRef: RefObject<string | null>;
  multiLineSelectionRef: RefObject<MultiLineSelectionState | null>;
  /** The selected rows' LaTeX when they were selected: rows changed from outside end the selection. */
  multiLineSelectionLatexRef: RefObject<Map<string, string>>;
  multiLineSelectedIdsRef: RefObject<Set<string>>;
  /** Select All: every row's selection. */
  documentSelectionRef: RefObject<Record<string, MathSelectionSnapshot> | null>;
  documentSelectionNavigationRef: RefObject<string | null>;
  pointerSelectionSessionRef: RefObject<PointerSelectionSession | null>;
  bumpSelectionRevision: () => void;
  readOnly: boolean;
  latexFormatProfile: LatexFormatProfile;
  recordCommand: (
    commandId: string,
    prefix: string,
    source: CommandSource,
  ) => void;
}
