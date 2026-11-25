import { cloneSelection, cloneDocumentSnapshot, documentSnapshotsEquivalent } from "./documentSnapshot";
import type {
  FormulaEditInput,
  HistoryAdapter,
  HistoryEntry,
  HistoryStateSnapshot,
  MathSelectionSnapshot,
  PendingEditTransaction,
  PendingFormulaEditTransaction,
  ReplaceDocumentEntry,
  ReplaceFormulaEntry,
} from "./historyTypes";

const EDIT_GROUP_TIMEOUT_MS = 500;
const SOURCE_EDIT_GROUP_TIMEOUT_MS = 900;
const MAX_HISTORY_ENTRIES = 300;
const HISTORY_TRIM_COUNT = 50;

type Listener = () => void;

export function clampSelection(
  selection: MathSelectionSnapshot,
  lastOffset: number,
): MathSelectionSnapshot {
  return {
    ranges: selection.ranges.map(([start, end]) => [
      Math.max(0, Math.min(start, lastOffset)),
      Math.max(0, Math.min(end, lastOffset)),
    ]),
    direction: selection.direction,
  };
}

function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  switch (entry.type) {
    case "replace-formula":
      return {
        ...entry,
        beforeSelection: cloneSelection(entry.beforeSelection),
        afterSelection: cloneSelection(entry.afterSelection),
      };
    case "add-line":
    case "remove-line":
      return {
        ...entry,
        line: { ...entry.line },
        beforeSelection: entry.beforeSelection
          ? cloneSelection(entry.beforeSelection)
          : null,
        afterSelection: entry.afterSelection
          ? cloneSelection(entry.afterSelection)
          : null,
      };
    case "replace-document":
      return {
        ...entry,
        before: cloneDocumentSnapshot(entry.before),
        after: cloneDocumentSnapshot(entry.after),
      };
  }
}

interface TextDifference {
  start: number;
  beforeEnd: number;
  afterEnd: number;
}

function textDifference(before: string, after: string): TextDifference {
  let start = 0;
  const sharedLength = Math.min(before.length, after.length);
  while (start < sharedLength && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return { start, beforeEnd, afterEnd };
}

function normalizeFormulaEditKind(
  input: FormulaEditInput,
): FormulaEditInput["editKind"] {
  if (input.editKind === "composition") return "composition";
  const difference = textDifference(input.beforeLatex, input.afterLatex);
  const removedLength = difference.beforeEnd - difference.start;
  const insertedLength = difference.afterEnd - difference.start;
  if (removedLength === 0 && insertedLength > 0) return "insert";
  if (insertedLength === 0 && removedLength > 0) {
    return input.editKind === "delete-forward"
      ? "delete-forward"
      : "delete-backward";
  }
  return "replace";
}

function formulaEditsAreAdjacent(
  pending: PendingFormulaEditTransaction,
  next: FormulaEditInput,
): boolean {
  const pendingDifference = textDifference(
    pending.beforeLatex,
    pending.afterLatex,
  );
  const nextDifference = textDifference(next.beforeLatex, next.afterLatex);
  switch (pending.editKind) {
    case "insert":
      return nextDifference.start === pendingDifference.afterEnd;
    case "delete-backward":
      return nextDifference.beforeEnd === pendingDifference.start;
    case "delete-forward":
      return nextDifference.start === pendingDifference.start;
    default:
      return false;
  }
}

function isMergeableFormulaKind(
  transaction: PendingFormulaEditTransaction,
): boolean {
  return (
    transaction.editKind === "insert" ||
    transaction.editKind === "delete-backward" ||
    transaction.editKind === "delete-forward"
  );
}

function canMergeFormulaEdit(
  pending: PendingFormulaEditTransaction,
  next: FormulaEditInput,
  timestamp: number,
): boolean {
  return (
    isMergeableFormulaKind(pending) &&
    pending.lineId === next.lineId &&
    pending.editKind === next.editKind &&
    pending.source === next.source &&
    timestamp - pending.updatedAt <= EDIT_GROUP_TIMEOUT_MS &&
    pending.afterLatex === next.beforeLatex &&
    pending.afterActiveLineId === next.beforeActiveLineId &&
    formulaEditsAreAdjacent(pending, next)
  );
}

export class HistoryManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pendingTransaction: PendingEditTransaction | null = null;
  private isReplaying = false;
  private generation = 0;
  private adapter: HistoryAdapter | null = null;
  private listeners = new Set<Listener>();
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: HistoryStateSnapshot = this.createStateSnapshot();

  configure(adapter: HistoryAdapter | null) {
    this.adapter = adapter;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  getState(): HistoryStateSnapshot {
    return this.snapshot;
  }

  recordFormulaEdit(input: FormulaEditInput) {
    if (this.isReplaying || input.beforeLatex === input.afterLatex) return;

    this.redoStack = [];
    const timestamp = input.timestamp ?? Date.now();
    const normalizedInput: FormulaEditInput = {
      ...input,
      editKind: normalizeFormulaEditKind(input),
    };
    const pending = this.pendingTransaction;
    if (
      pending?.kind === "formula" &&
      canMergeFormulaEdit(pending, normalizedInput, timestamp)
    ) {
      this.pendingTransaction = {
        ...pending,
        afterLatex: normalizedInput.afterLatex,
        afterSelection: cloneSelection(normalizedInput.afterSelection),
        afterActiveLineId: normalizedInput.afterActiveLineId,
        updatedAt: timestamp,
      };
    } else {
      this.commitPendingTransaction();
      this.pendingTransaction = {
        kind: "formula",
        lineId: normalizedInput.lineId,
        beforeLatex: normalizedInput.beforeLatex,
        afterLatex: normalizedInput.afterLatex,
        beforeSelection: cloneSelection(normalizedInput.beforeSelection),
        afterSelection: cloneSelection(normalizedInput.afterSelection),
        beforeActiveLineId: normalizedInput.beforeActiveLineId,
        afterActiveLineId: normalizedInput.afterActiveLineId,
        editKind: normalizedInput.editKind,
        source: normalizedInput.source,
        startedAt: timestamp,
        updatedAt: timestamp,
      };
    }

    if (
      normalizedInput.editKind === "composition" ||
      normalizedInput.editKind === "replace" ||
      normalizedInput.source === "paste"
    ) {
      this.commitPendingTransaction();
      return;
    }

    this.schedulePendingCommit();
    this.emit();
  }

  commitPendingTransaction() {
    this.clearCommitTimer();
    const pending = this.pendingTransaction;
    if (!pending) return;
    this.pendingTransaction = null;

    if (pending.kind === "formula") {
      if (pending.beforeLatex !== pending.afterLatex) {
        const entry: ReplaceFormulaEntry = {
          type: "replace-formula",
          lineId: pending.lineId,
          beforeLatex: pending.beforeLatex,
          afterLatex: pending.afterLatex,
          beforeSelection: cloneSelection(pending.beforeSelection),
          afterSelection: cloneSelection(pending.afterSelection),
          beforeActiveLineId: pending.beforeActiveLineId,
          afterActiveLineId: pending.afterActiveLineId,
          timestamp: pending.updatedAt,
          source: pending.source,
        };
        this.pushInternal(entry);
        return;
      }
    } else if (!documentSnapshotsEquivalent(pending.before, pending.after)) {
      const entry: ReplaceDocumentEntry = {
        type: "replace-document",
        before: pending.before,
        after: pending.after,
        source: "source-apply",
        timestamp: pending.updatedAt,
      };
      this.pushInternal(entry);
      return;
    }

    this.emit();
  }

  push(entry: HistoryEntry) {
    if (this.isReplaying) return;
    this.commitPendingTransaction();
    this.pushInternal(entry);
  }

  recordSourceDocumentEdit(entry: ReplaceDocumentEntry) {
    if (this.isReplaying || entry.source !== "source-apply") return;
    const timestamp = entry.timestamp ?? Date.now();
    const normalized = cloneHistoryEntry(entry) as ReplaceDocumentEntry;
    const pending = this.pendingTransaction;

    this.redoStack = [];
    if (
      pending?.kind === "source-document" &&
      timestamp - pending.updatedAt <= SOURCE_EDIT_GROUP_TIMEOUT_MS &&
      documentSnapshotsEquivalent(pending.after, normalized.before)
    ) {
      if (documentSnapshotsEquivalent(pending.before, normalized.after)) {
        this.pendingTransaction = null;
        this.clearCommitTimer();
      } else {
        this.pendingTransaction = {
          ...pending,
          after: normalized.after,
          updatedAt: timestamp,
        };
        this.schedulePendingCommit(SOURCE_EDIT_GROUP_TIMEOUT_MS);
      }
      this.emit();
      return;
    }

    this.commitPendingTransaction();
    this.pendingTransaction = {
      kind: "source-document",
      before: normalized.before,
      after: normalized.after,
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    this.schedulePendingCommit(SOURCE_EDIT_GROUP_TIMEOUT_MS);
    this.emit();
  }

  async undo(): Promise<boolean> {
    this.commitPendingTransaction();
    if (this.isReplaying || !this.adapter) return false;

    const entry = this.undoStack.pop();
    if (!entry) {
      this.emit();
      return false;
    }

    const generation = this.generation;
    this.isReplaying = true;
    this.emit();
    try {
      await this.adapter.applyEntry(entry, "undo");
      if (generation !== this.generation) return false;
      this.redoStack.push(entry);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.undoStack.push(entry);
      throw error;
    } finally {
      if (generation === this.generation) {
        this.isReplaying = false;
        this.emit();
      }
    }
  }

  async redo(): Promise<boolean> {
    this.commitPendingTransaction();
    if (this.isReplaying || !this.adapter) return false;

    const entry = this.redoStack.pop();
    if (!entry) {
      this.emit();
      return false;
    }

    const generation = this.generation;
    this.isReplaying = true;
    this.emit();
    try {
      await this.adapter.applyEntry(entry, "redo");
      if (generation !== this.generation) return false;
      this.undoStack.push(entry);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.redoStack.push(entry);
      throw error;
    } finally {
      if (generation === this.generation) {
        this.isReplaying = false;
        this.emit();
      }
    }
  }

  requestUndo() {
    void this.undo().catch((error) => {
      console.error("TexType history undo failed", error);
    });
  }

  requestRedo() {
    void this.redo().catch((error) => {
      console.error("TexType history redo failed", error);
    });
  }

  clear() {
    this.generation += 1;
    this.clearCommitTimer();
    this.undoStack = [];
    this.redoStack = [];
    this.pendingTransaction = null;
    this.isReplaying = false;
    this.emit();
  }

  private pushInternal(entry: HistoryEntry) {
    this.undoStack.push(cloneHistoryEntry(entry));
    this.redoStack = [];
    if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
      this.undoStack.splice(0, HISTORY_TRIM_COUNT);
    }
    this.emit();
  }

  private schedulePendingCommit(timeoutMs = EDIT_GROUP_TIMEOUT_MS) {
    this.clearCommitTimer();
    this.commitTimer = setTimeout(
      () => this.commitPendingTransaction(),
      timeoutMs,
    );
  }

  private clearCommitTimer() {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private createStateSnapshot(): HistoryStateSnapshot {
    return {
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      pendingTransaction: this.pendingTransaction,
      isReplaying: this.isReplaying,
      canUndo: Boolean(this.pendingTransaction || this.undoStack.length),
      canRedo: this.redoStack.length > 0,
    };
  }

  private emit() {
    this.snapshot = this.createStateSnapshot();
    this.listeners.forEach((listener) => listener());
  }
}
