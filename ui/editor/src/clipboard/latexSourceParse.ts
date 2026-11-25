// Reads the LaTeX source view's text back into formula rows (the universal profile's wrappers).
import { isSingleCompleteLatexEnvironment } from "@app/kernel/latex/environment.ts";
import { stripKernelAlignmentMarkers } from "../editor/alignmentMarkers";
import type {
  FormulaDisplayStyle,
  FormulaLineMode,
  LatexFormatProfile,
} from "../types/formula";
import { resolveFormulaDisplayStyle } from "./latexFormatProfile";
import {
  encodeTopLevelAlignmentMarkers,
  extractEnvironmentBodies,
  isEscaped,
  splitTopLevelRows,
  wrapEnvironment,
} from "./latexScan";
import {
  buildFormulaDraftPreview,
  validateFormulaDraft,
} from "./latexDraftCheck";

function escapeOutsideTextForMath(value: string): string {
  return value.replace(/(?<!\\)([{}])/g, "\\$1");
}

function findUnescapedDollar(value: string, from: number): number {
  for (let index = Math.max(0, from); index < value.length; index += 1) {
    if (value[index] !== "$" || isEscaped(value, index)) continue;
    return index;
  }
  return -1;
}

function parseInlineTextDollarLine(line: string): string | null {
  let result = "";
  let cursor = 0;
  while (cursor < line.length) {
    const opening = findUnescapedDollar(line, cursor);
    if (opening < 0) {
      const text = line.slice(cursor);
      if (text) result += `\\text{${escapeOutsideTextForMath(text)}}`;
      break;
    }
    // $$ on an inline line is not an empty $...$ fragment
    if (line[opening + 1] === "$" && !isEscaped(line, opening + 1)) return null;
    const text = line.slice(cursor, opening);
    if (text) result += `\\text{${escapeOutsideTextForMath(text)}}`;
    const closing = findUnescapedDollar(line, opening + 1);
    if (closing < 0) return null;
    const math = line.slice(opening + 1, closing).trim();
    result += math;
    cursor = closing + 1;
  }
  return result || "";
}

// Unwrapped source: one complete environment, or one formula per line.
function rawSourceValues(source: string): string[] {
  const normalized = source.trim();
  if (isSingleCompleteLatexEnvironment(normalized)) return [normalized];
  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildFallbackDraftPreviewValues(source: string): string[] | undefined {
  const rawValues = rawSourceValues(source);
  if (!rawValues.length) return undefined;
  const candidates = rawValues.map((value) =>
    validateFormulaDraft(value) === null ? value : buildFormulaDraftPreview(value),
  );
  return candidates.every((value): value is string => value !== null)
    ? candidates
    : undefined;
}

export interface LatexSourceDraftResult {
  valid: boolean;
  values: string[];
  previewValues?: string[];
  modes?: FormulaLineMode[];
  displayStyles?: FormulaDisplayStyle[];
  error?: string;
}

interface UniversalParsedRow {
  value: string;
  mode: FormulaLineMode;
  displayStyle: FormulaDisplayStyle;
}

function parseInlineTextParenLine(line: string): string | null {
  let result = "";
  let cursor = 0;
  while (cursor < line.length) {
    const opening = line.indexOf("\\(", cursor);
    if (opening < 0) {
      const text = line.slice(cursor);
      if (text) result += `\\text{${escapeOutsideTextForMath(text)}}`;
      break;
    }
    const text = line.slice(cursor, opening);
    if (text) result += `\\text{${escapeOutsideTextForMath(text)}}`;
    const closing = line.indexOf("\\)", opening + 2);
    if (closing < 0) return null;
    result += line.slice(opening + 2, closing).trim();
    cursor = closing + 2;
  }
  return result || "";
}

function parseUniversalInlineLine(
  line: string,
  profile: LatexFormatProfile,
): string | null {
  if (profile.inlineTextPolicy === "outside-math") {
    return profile.inlineWrapper === "paren"
      ? parseInlineTextParenLine(line)
      : parseInlineTextDollarLine(line);
  }

  const trimmed = line.trim();
  if (profile.inlineWrapper === "paren") {
    return trimmed.startsWith("\\(") && trimmed.endsWith("\\)")
      ? trimmed.slice(2, -2).trim()
      : null;
  }
  return (
    trimmed.length >= 2 &&
    trimmed.startsWith("$") &&
    !trimmed.startsWith("$$") &&
    trimmed.endsWith("$") &&
    !trimmed.endsWith("$$")
  )
    ? trimmed.slice(1, -1).trim()
    : null;
}

function universalMultilineInternalLatex(
  body: string,
  environment: "align" | "align*" | "gather" | "gather*",
) {
  const isAlign = environment.startsWith("align");
  const rows = splitTopLevelRows(body);
  const encoded = rows.map((row) =>
    isAlign ? encodeTopLevelAlignmentMarkers(row) : stripKernelAlignmentMarkers(row),
  );
  const internalEnvironment = isAlign ? "aligned" : "gathered";
  const content = encoded
    .map((row, index) => (index < encoded.length - 1 ? `${row} \\\\` : row))
    .join("\n");
  return wrapEnvironment(internalEnvironment, content);
}

function parseUniversalSourceRows(
  source: string,
  profile: LatexFormatProfile,
): UniversalParsedRow[] | null {
  const physical = source.replace(/\r\n?/g, "\n").split("\n");
  const rows: UniversalParsedRow[] = [];

  const collectUntil = (
    start: number,
    closing: (trimmed: string) => boolean,
  ) => {
    for (let index = start; index < physical.length; index += 1) {
      if (closing(physical[index].trim())) return index;
    }
    return -1;
  };

  for (let index = 0; index < physical.length; index += 1) {
    const raw = physical[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (
      trimmed.startsWith("$$") &&
      trimmed.endsWith("$$") &&
      trimmed.length > 4
    ) {
      rows.push({
        value: trimmed.slice(2, -2).trim(),
        mode: "display",
        displayStyle: "double-dollar",
      });
      continue;
    }

    if (trimmed === "$$") {
      const end = collectUntil(index + 1, (value) => value === "$$");
      if (end < 0) return null;
      rows.push({
        value: physical.slice(index + 1, end).join("\n").trim(),
        mode: "display",
        displayStyle: "double-dollar",
      });
      index = end;
      continue;
    }

    if (
      trimmed.startsWith("\\[") &&
      trimmed.endsWith("\\]") &&
      trimmed.length > 4
    ) {
      rows.push({
        value: trimmed.slice(2, -2).trim(),
        mode: "display",
        displayStyle: "bracket",
      });
      continue;
    }

    if (trimmed === "\\[") {
      const end = collectUntil(index + 1, (value) => value === "\\]");
      if (end < 0) return null;
      rows.push({
        value: physical.slice(index + 1, end).join("\n").trim(),
        mode: "display",
        displayStyle: "bracket",
      });
      index = end;
      continue;
    }

    const environmentMatch = trimmed.match(
      /^\\begin\{(equation\*?|align\*?|gather\*?)\}/,
    );
    if (environmentMatch) {
      const environment = environmentMatch[1] as
        | "equation"
        | "equation*"
        | "align"
        | "align*"
        | "gather"
        | "gather*";
      const endToken = `\\end{${environment}}`;
      const end = collectUntil(index, (value) => value.endsWith(endToken));
      if (end < 0) return null;
      const block = physical.slice(index, end + 1).join("\n");
      const bodies = extractEnvironmentBodies(block, environment);
      if (bodies.length !== 1) return null;
      if (environment === "equation" || environment === "equation*") {
        rows.push({
          value: bodies[0],
          mode: "display",
          displayStyle:
            environment === "equation" ? "equation" : "equation-star",
        });
      } else {
        rows.push({
          value: universalMultilineInternalLatex(
            bodies[0],
            environment as "align" | "align*" | "gather" | "gather*",
          ),
          mode: "display",
          displayStyle: "default",
        });
      }
      index = end;
      continue;
    }

    const inline = parseUniversalInlineLine(raw, profile);
    if (inline === null) return null;
    rows.push({
      value: inline,
      mode: "inline",
      displayStyle: "default",
    });
  }

  // The panel writes every display row that follows the profile with the profile's own wrapper, so a block written
  // that way follows the profile again ("default"); only a different wrapper is the row's own choice. Otherwise an
  // edit anywhere in the source would pin every display row to the wrapper it happened to be shown with.
  const profileDisplayStyle = resolveFormulaDisplayStyle(undefined, profile);
  for (const row of rows) {
    if (row.mode === "display" && row.displayStyle === profileDisplayStyle) row.displayStyle = "default";
  }

  return rows.length ? rows : null;
}

export function parseUniversalLatexSourceDraft(
  source: string,
  profile: LatexFormatProfile,
): LatexSourceDraftResult {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return {
      valid: true,
      values: [""],
      modes: ["display"],
      displayStyles: ["default"],
    };
  }

  const rows = parseUniversalSourceRows(normalized, profile);
  if (!rows?.length) {
    return {
      valid: false,
      values: [],
      previewValues: buildFallbackDraftPreviewValues(normalized.trim()),
      error: "incomplete-format-wrapper",
    };
  }

  const values = rows.map((row) => row.value);
  const modes = rows.map((row) => row.mode);
  const displayStyles = rows.map((row) => row.displayStyle);
  let firstError: string | null = null;
  for (const value of values) firstError ??= validateFormulaDraft(value);
  if (!firstError) return { valid: true, values, modes, displayStyles };

  const previewCandidates = values.map((value) =>
    validateFormulaDraft(value) === null ? value : buildFormulaDraftPreview(value),
  );
  const previewValues = previewCandidates.every(
    (value): value is string => value !== null,
  )
    ? previewCandidates
    : undefined;
  return {
    valid: false,
    values,
    previewValues,
    modes,
    displayStyles,
    error: firstError,
  };
}
