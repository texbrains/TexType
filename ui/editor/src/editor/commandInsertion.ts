import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import type { MathSelectionSnapshot } from "../history/historyTypes";
import type { Command } from "../types/command";
import { captureSelection, hasRawLatexInput } from "./fieldHelpers";
import { normalizeChineseLatex } from "./normalizeChineseLatex";

// How a toolbar, candidate or shortcut command goes into a formula: with a
// selection the template wraps it; with a collapsed caret, commands such as
// accents and scripts take the expression before the caret.

function replaceTextualPlaceholder(
  latex: string,
  targetIndex: number,
  replacement: string,
) {
  let index = 0;
  let replaced = false;
  const value = latex.replace(/\\placeholder\{\}/g, (placeholder) => {
    if (index !== targetIndex) {
      index += 1;
      return placeholder;
    }
    index += 1;
    replaced = true;
    return replacement;
  });
  return replaced ? value : null;
}

const previousTargetToolbarCommandIds = new Set([
  "scripts",
  "lower-script",
  "upper-script",
  "power",
  "subscript",
  "degree",
  "overline",
  "underline",
  "hat",
  "widehat",
  "tilde",
  "widetilde",
  "dotaccent",
  "ddotaccent",
  "checkaccent",
  "breveaccent",
  "acuteaccent",
  "graveaccent",
  "ringaccent",
  "overrightarrow",
  "overleftarrow",
  "overleftrightarrow",
  "overleftharpoon",
  "overrightharpoon",
  "overarc",
  "overgroup",
  "overparen",
  "overlinesegment",
  "underarc",
  "undergroup",
  "underparen",
  "underleftarrow",
  "underrightarrow",
  "underleftrightarrow",
  "underlinesegment",
  "overbrace",
  "underbrace",
  "overset",
  "underset",
  "overunderset",
  "stackrel",
  "stackbin",
  "vector",
  "unitvector",
  "timederivative",
  "timesecond",
  "boxed",
  "evalbar",
  "boldsymbol",
  "blackboard-bold",
  "math-italic",
  "math-roman",
  "math-sans",
  "math-typewriter",
  "math-calligraphic",
  "math-script",
  "math-fraktur",
  "bold-symbol",
  "math-normal",
]);

const previousTargetToolbarCommandPattern =
  /^\\(?:acute|grave|dot|ddot|dddot|ddddot|tilde|widetilde|bar|breve|check|hat|widehat|vec|overline|underline|overrightarrow|overleftarrow|overleftrightarrow|overleftharpoon|overrightharpoon|overarc|overgroup|overparen|overlinesegment|underarc|undergroup|underparen|underleftarrow|underrightarrow|underleftrightarrow|underlinesegment|mathring|boxed|mathbf|boldsymbol|mathbb|mathit|mathrm|mathsf|mathtt|mathcal|mathscr|mathfrak|mathnormal)$/;

const nonTargetablePreviousLatex =
  /^(?:[+\-*/=<>:,;.!?]+|\\(?:pm|mp|times|div|cdot|ast|star|circ|bullet|cap|cup|land|lor|leq?|geq?|neq?|approx|equiv|sim|simeq|cong|propto|in|notin|subseteq?|supseteq?|parallel|perp|mid|nmid|to|leftarrow|rightarrow|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow))$/;

function commandTargetsPreviousExpression(command: Command) {
  return (
    previousTargetToolbarCommandIds.has(command.id) ||
    previousTargetToolbarCommandPattern.test(command.command.trim())
  );
}

function previousExpressionSelection(field: MathfieldElement) {
  if (
    field.mode !== "math" ||
    !field.selectionIsCollapsed ||
    field.position <= 0 ||
    hasRawLatexInput(field)
  ) {
    return null;
  }

  const originalSelection = captureSelection(field);
  const extended = field.executeCommand("extendSelectionBackward");
  if (!extended || field.selectionIsCollapsed) {
    field.selection = originalSelection;
    return null;
  }

  const selectedLatex = field.getValue(field.selection).trim();
  if (
    !selectedLatex ||
    selectedLatex === "\\placeholder{}" ||
    nonTargetablePreviousLatex.test(selectedLatex)
  ) {
    field.selection = originalSelection;
    return null;
  }

  return {
    latex: selectedLatex,
    selection: captureSelection(field),
  };
}

function templateForSelection(
  command: Command,
  selectedLatex: string,
): string {
  if (!selectedLatex) return command.latex;

  switch (command.id) {
    case "scripts":
      return selectedLatex + "_{\\placeholder{}}^{\\placeholder{}}";
    case "lower-script":
    case "subscript":
      return selectedLatex + "_{\\placeholder{}}";
    case "upper-script":
    case "power":
      return selectedLatex + "^{\\placeholder{}}";
    case "degree":
      return selectedLatex + "^{\\circ}";
    case "overset":
    case "underset":
    case "stackrel":
    case "stackbin":
      return (
        replaceTextualPlaceholder(command.latex, 1, selectedLatex) ??
        command.latex
      );
    case "overunderset":
      return (
        replaceTextualPlaceholder(command.latex, 2, selectedLatex) ??
        command.latex
      );
    case "sum":
    case "series":
      return "\\sum_{\\placeholder{}}^{\\placeholder{}} " + selectedLatex;
    case "prod":
    case "productseries":
      return "\\prod_{\\placeholder{}}^{\\placeholder{}} " + selectedLatex;
    case "int":
      return (
        "\\int_{\\placeholder{}}^{\\placeholder{}} " +
        selectedLatex +
        "\\,\\mathrm{d}\\placeholder{}"
      );
    case "intplain":
      return "\\int " + selectedLatex + "\\,\\mathrm{d}\\placeholder{}";
    case "lineintegral":
      return "\\int_{C} " + selectedLatex + "\\,\\mathrm{d}s";
    case "surfaceintegral":
      return "\\iint_{S} " + selectedLatex + "\\,\\mathrm{d}S";
    case "volumeintegral":
      return "\\iiint_{V} " + selectedLatex + "\\,\\mathrm{d}V";
    case "closed-surface-integral":
      return "\\oiint_{S} " + selectedLatex + "\\,\\mathrm{d}S";
    case "closed-volume-integral":
      return "\\oiiint_{V} " + selectedLatex + "\\,\\mathrm{d}V";
    case "frac":
    case "smallfrac":
    case "displayfrac":
      return command.command + "{" + selectedLatex + "}{\\placeholder{}}";
    case "sqrt":
      return "\\sqrt{" + selectedLatex + "}";
    case "parentheses":
      return "\\left(" + selectedLatex + "\\right)";
    case "brackets":
      return "\\left[" + selectedLatex + "\\right]";
    case "braces":
      return "\\left\\{" + selectedLatex + "\\right\\}";
    case "absolute":
      return "\\left|" + selectedLatex + "\\right|";
    default:
      return command.latex.replace("\\placeholder{}", selectedLatex);
  }
}

/** What a command inserts at the field's selection (computed once per insertion, before any attempt). */
export interface PreparedLatexCommandInsertion {
  originalSelection: MathSelectionSnapshot;
  insertionSelection: MathSelectionSnapshot;
  insertionTemplate: string;
}

/** The selection and template a toolbar/candidate/shortcut command inserts. */
export function prepareLatexCommandInsertion(
  field: MathfieldElement,
  command: Command,
): PreparedLatexCommandInsertion {
  const originalSelection = captureSelection(field);
  let insertionSelection = originalSelection;
  let implicitPreviousLatex = "";
  if (field.selectionIsCollapsed && commandTargetsPreviousExpression(command)) {
    const previousTarget = previousExpressionSelection(field);
    if (previousTarget) {
      insertionSelection = previousTarget.selection;
      implicitPreviousLatex = previousTarget.latex;
    }
  }
  const selectedLatex =
    implicitPreviousLatex ||
    (insertionSelection.ranges[0]?.[0] === insertionSelection.ranges[0]?.[1]
      ? ""
      : field.getValue(insertionSelection));
  const insertionTemplate = templateForSelection(command, selectedLatex);
  return { originalSelection, insertionSelection, insertionTemplate };
}

/**
 * Insert a prepared command into the field as one edit: `mutate` records it (the editor's history) and
 * returns whether it changed the formula. False: nothing was inserted and the
 * selection is back where it was. One attempt: the kernel inserts the template (and leaves a script or accent
 * the template went into, as direct input does); a failed insertion is not retried elsewhere.
 */
export function attemptLatexCommandInsertion(
  field: MathfieldElement,
  prepared: PreparedLatexCommandInsertion,
  mutate: (change: () => boolean) => boolean,
): boolean {
  const { originalSelection, insertionSelection, insertionTemplate } = prepared;
  field.selection = insertionSelection;
  const inserted = mutate(() => {
    const hasPlaceholder = insertionTemplate.includes("\\placeholder{}");
    const valueBefore = normalizeChineseLatex(field.value);
    const done = field.kernelInsertToolbarTemplate(insertionTemplate, {
      mode: "math",
      format: "latex",
      insertionMode: "replaceSelection",
      selectionMode: hasPlaceholder ? "placeholder" : "after",
      style: {
        variant: "normal",
        variantStyle: undefined,
      },
      focus: true,
      scrollIntoView: false,
    });
    return done && normalizeChineseLatex(field.value) !== valueBefore;
  });
  if (!inserted) field.selection = originalSelection;
  return inserted;
}
