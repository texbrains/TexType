import type { MathfieldElement, Selection, Selector } from "@app/kernel/kernel/mathlive.ts";
import type { CommandUsage } from "../types/command";

export interface MathLivePersistentTypingStyle {
  bold: boolean;
  // null follows MathLive's normal math alphabet; false forces upright.
  italic: boolean | null;
  color: string | null;
  backgroundColor: string | null;
}

export function dismissMathLiveSuggestions(field: MathfieldElement) {
  field.executeCommand("kernelDismissSuggestions" as Selector);
}

export function configureMathLiveCompletion(field: MathfieldElement, preferences: {
  usage: Record<string, CommandUsage>;
  personalize: boolean;
  count: number;
}) {
  (field as MathfieldElement & { kernelCompletionPreferences?: typeof preferences })
    .kernelCompletionPreferences = preferences;
}

// These commands are registered inside TexType's editing kernel (ui/kernel/src/kernel).
// Keep the extension cast here; callers cannot pass arbitrary command names.
export function toggleMathLiveSelectionStyle(
  field: MathfieldElement,
  kind: "bold" | "italic",
  selection: Selection,
) {
  return field.executeCommand("kernelToggleSelectionStyle" as Selector, kind, selection);
}

// A selection that covers only the ^/_ attachment of c^2 paints a glyph-less
// container; move that paint onto the script content (c^{\textcolor{..}{2}}).
export function paintMathLiveDetachedScripts(
  field: MathfieldElement,
  selection: Selection,
) {
  return field.executeCommand("kernelPaintDetachedScripts" as Selector, selection);
}

export function insertMathLiveAlignmentPoint(field: MathfieldElement) {
  return field.executeCommand("kernelInsertAlignmentPoint" as Selector);
}

/**
 * After the formula was replaced: the caret where its atom went, or after the
 * rewrite that replaced it (the editing core's restore; take the snapshot with
 * kernelEditingCore.captureCaret before replacing).
 */
export function restoreMathLiveCaret(field: MathfieldElement, snapshot: unknown) {
  return field.executeCommand(["kernelRestoreCaret", snapshot] as unknown as Selector);
}

/** Escape with a selection: collapse it to its end (the editing core). */
export function collapseMathLiveSelectionToEnd(field: MathfieldElement) {
  return field.executeCommand("kernelCollapseToEnd" as Selector);
}

/** & in a matrix cell: the cell on the right, or a new column at row end. */
export function moveMathLiveToNextColumn(field: MathfieldElement) {
  return field.executeCommand("kernelNextColumn" as Selector);
}

export function insertMathLiveRowBreak(
  field: MathfieldElement,
  environment: "aligned" | "gathered",
) {
  return field.executeCommand("kernelInsertRowBreak" as Selector, environment);
}

export function setMathLivePersistentTypingStyle(
  field: MathfieldElement,
  style: MathLivePersistentTypingStyle,
) {
  const next = {
    bold: style.bold,
    italic: style.italic,
    ...(style.color ? { color: style.color } : {}),
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
  };
  const target = field as unknown as {
    kernelPersistentTypingStyle?: typeof next;
    _mathfield?: {
      kernelPersistentTypingStyle?: typeof next;
    };
  };
  // model.mathfield is MathLive's private controller, not the custom element.
  // Mirror the state on both so the insertion kernel sees it while keeping the
  // public element inspectable in browser regressions.
  target.kernelPersistentTypingStyle = next;
  if (target._mathfield) {
    target._mathfield.kernelPersistentTypingStyle = next;
  }
}
