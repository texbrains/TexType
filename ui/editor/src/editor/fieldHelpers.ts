import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import {
  editingModelOf,
  kernelEditingCore,
} from "@app/kernel/render/layout-runtime.ts";
import type {
  EditKind,
  FormulaEditSource,
  MathSelectionSnapshot,
} from "../history/historyTypes";
import { restoreMathLiveCaret } from "./mathLiveKernelCommands";
import {
  normalizeChineseLatex,
  normalizeCanonicalUprightCommands,
  normalizeContextualUprightSymbols,
} from "./normalizeChineseLatex";

/** Clipboard type of a selection across rows: its rows' LaTeX (pasted back as rows). */
export const KERNEL_MULTILINE_LATEX_CLIPBOARD_TYPE =
  "application/x-kernel-multiline-latex";

/** The rows of a selection across rows on the clipboard (null: none, or a single row). */
export function pastedLatexRows(clipboard: DataTransfer): string[] | null {
  const payload = clipboard.getData(KERNEL_MULTILINE_LATEX_CLIPBOARD_TYPE);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { lines?: unknown };
    const rows = Array.isArray(parsed.lines)
      ? parsed.lines.filter((line): line is string => typeof line === "string")
      : [];
    return rows.length > 1 ? rows : null;
  } catch {
    // malformed custom data: MathLive pastes the text
    return null;
  }
}

/** An image on the clipboard. */
export function pastedImage(clipboard: DataTransfer): File | null {
  const item = Array.from(clipboard.items).find(
    (candidate) =>
      candidate.kind === "file" && candidate.type.startsWith("image/"),
  );
  return (
    item?.getAsFile() ??
    Array.from(clipboard.files).find((file) =>
      file.type.startsWith("image/"),
    ) ??
    null
  );
}

/** Two pieces of a row's LaTeX side by side (a command's name must not run into a following letter). */
export function joinLatex(left: string, right: string) {
  return /\\[A-Za-z]+$/.test(left) && /^[A-Za-z]/.test(right)
    ? `${left} ${right}`
    : left + right;
}

export function hasRawLatexInput(field: MathfieldElement) {
  return Boolean(field.shadowRoot?.querySelector(".ML__raw-latex"));
}

export function rawLatexInput(field: MathfieldElement) {
  return Array.from(
    field.shadowRoot?.querySelectorAll<HTMLElement>(".ML__raw-latex") ?? [],
  )
    .filter((node) => !node.classList.contains("ML__suggestion"))
    .map((node) => node.textContent ?? "")
    .join("");
}

const FOCUSABLE_CONTROL_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Moves keyboard focus to the next (previous) control after the formula
// lines, skipping the other formula fields, wrapping like the browser does.
export function focusControlOutsideFormulas(
  field: HTMLElement,
  direction: 1 | -1,
) {
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR),
  ).filter(
    (element) =>
      !element.closest("math-field") && element.getClientRects().length > 0,
  );
  const side =
    direction > 0
      ? Node.DOCUMENT_POSITION_FOLLOWING
      : Node.DOCUMENT_POSITION_PRECEDING;
  const onSide = controls.filter(
    (element) => field.compareDocumentPosition(element) & side,
  );
  const target =
    direction > 0
      ? (onSide[0] ?? controls[0])
      : (onSide.at(-1) ?? controls.at(-1));
  target?.focus();
  return Boolean(target);
}

export function captureSelection(
  field: MathfieldElement,
): MathSelectionSnapshot {
  return {
    ranges: field.selection.ranges.map(
      ([start, end]) => [start, end] as [number, number],
    ),
    direction: field.selection.direction ?? "none",
  };
}

export function selectionHasContent(selection: MathSelectionSnapshot) {
  return selection.ranges.some(([start, end]) => start !== end);
}

export function captureFieldSnapshot(field: MathfieldElement) {
  return {
    latex: normalizeChineseLatex(field.value),
    selection: captureSelection(field),
  };
}

// The caret right after a letter: that letter run may still grow (cm -> cmax).
function caretFollowsLetter(field: MathfieldElement) {
  if (field.position <= 0) return false;
  return /^[A-Za-z]$/.test(
    field.getValue(field.position - 1, field.position, "latex"),
  );
}

/**
 * Applies the upright rule to the displayed formula. Letter runs (units,
 * function names, labels) are decided once finished: not while the caret
 * follows a letter, unless `finished` (the field is being left). `edited`:
 * the user changed the formula (not a value set from outside).
 */
export function normalizeCompletedUprightDisplay(
  field: MathfieldElement,
  {
    finished = false,
    edited = true,
  }: { finished?: boolean; edited?: boolean } = {},
) {
  if (field.mode === "latex" || !field.selectionIsCollapsed) return false;

  const originalValue = field.value;
  const portableValue = normalizeCanonicalUprightCommands(originalValue);
  // Contextual upright typography is a semantic normalization pass, not an
  // inline-shortcut preference. It must remain active even when the user turns
  // off "common math input auto-convert".
  const contextualValue = normalizeContextualUprightSymbols(portableValue, {
    deferLetterRuns: !finished && caretFollowsLetter(field),
  });
  if (contextualValue === originalValue) return false;

  const model = editingModelOf(field);
  const caret = model ? kernelEditingCore.captureCaret(model) : null;
  field.setValue(contextualValue, {
    mode: "math",
    format: "latex",
    insertionMode: "replaceAll",
    selectionMode: "after",
    silenceNotifications: true,
  });
  // An edited formula stays one: setValue took the judged value for one set from outside, whose letters stay as
  // they are, and leaving the field then finished no word (\int sinxdx: the dx typed last left sinx italic).
  if (edited) {
    const internal = (
      field as unknown as { _mathfield?: { kernelUnjudged?: string } }
    )._mathfield;
    if (internal) internal.kernelUnjudged = undefined;
  }
  if (caret) restoreMathLiveCaret(field, caret);
  return true;
}

export type PhysicalBackslashInputKind = "latin-backslash";

export function normalizePhysicalBackslashInput(
  beforeValue: string,
  afterValue: string,
  kind: PhysicalBackslashInputKind,
) {
  let prefixLength = 0;
  while (
    prefixLength < beforeValue.length &&
    prefixLength < afterValue.length &&
    beforeValue[prefixLength] === afterValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeValue.length - prefixLength &&
    suffixLength < afterValue.length - prefixLength &&
    beforeValue[beforeValue.length - 1 - suffixLength] ===
      afterValue[afterValue.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const insertedEnd = afterValue.length - suffixLength;
  const inserted = afterValue.slice(prefixLength, insertedEnd);
  let normalizedInserted = inserted;
  if (
    kind === "latin-backslash" &&
    inserted.length > 1 &&
    /^\\+$/.test(inserted)
  ) {
    normalizedInserted = "\\";
  }

  if (normalizedInserted === inserted) return afterValue;
  return (
    afterValue.slice(0, prefixLength) +
    normalizedInserted +
    afterValue.slice(insertedEnd)
  );
}

function selectionIsCollapsed(selection: MathSelectionSnapshot) {
  return selection.ranges.every(([start, end]) => start === end);
}

export function inferEditKind(
  inputType: string,
  beforeSelection: MathSelectionSnapshot,
): EditKind {
  if (inputType.includes("deleteContentBackward")) return "delete-backward";
  if (inputType.includes("deleteContentForward")) return "delete-forward";
  if (inputType.includes("Composition")) return "composition";
  if (inputType.includes("insert") && selectionIsCollapsed(beforeSelection)) {
    return "insert";
  }
  return "replace";
}

export function inferEditSource(inputType: string): FormulaEditSource {
  return inputType.toLocaleLowerCase().includes("paste") ? "paste" : "keyboard";
}

/** The nearest ancestor that scrolls the rows (the pane around the editor). */
export function scrollContainer(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}
