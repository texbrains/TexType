// Writes formula rows as LaTeX source with the universal profile (the source view, and rows copied as LaTeX).
import { normalizeCanonicalUprightCommands } from "../editor/normalizeChineseLatex";
import {
  restoreLatexAlignmentMarkers,
  stripKernelAlignmentMarkers,
} from "../editor/alignmentMarkers";
import type {
  FormulaDisplayStyle,
  FormulaLine,
  LatexFormatProfile,
} from "../types/formula";
import { resolveFormulaDisplayStyle } from "./latexFormatProfile";
import {
  isEscaped,
  readBalancedGroupEnd,
  readCompleteMathAtomEnd,
  readEnvironmentToken,
  readLatexCommandEnd,
  skipLatexWhitespace,
  splitTopLevelRows,
  updateEnvironmentStack,
  wrapEnvironment,
} from "./latexScan";

// gather/multline have a single column: a top-level '&' (for example the empty
// left cell of a row typed in align mode) is a LaTeX error there.
function stripTopLevelAlignmentTabs(latex: string): string {
  let result = "";
  let braceDepth = 0;
  const environments: string[] = [];
  for (let index = 0; index < latex.length; index += 1) {
    const token = readEnvironmentToken(latex, index);
    if (token) {
      result += latex.slice(index, token.end);
      updateEnvironmentStack(environments, token);
      index = token.end - 1;
      continue;
    }
    const character = latex[index];
    if (character === "{" && !isEscaped(latex, index)) braceDepth += 1;
    else if (character === "}" && !isEscaped(latex, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    if (
      character === "&" &&
      !isEscaped(latex, index) &&
      braceDepth === 0 &&
      environments.length === 0
    ) {
      continue;
    }
    result += character;
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function formatRows(lines: string[], preserveAlignmentMarkers: boolean): string {
  return lines
    .map((line, index) => {
      const content = preserveAlignmentMarkers
        ? restoreLatexAlignmentMarkers(line)
        : stripTopLevelAlignmentTabs(stripKernelAlignmentMarkers(line));
      return index < lines.length - 1 ? `${content} \\\\` : content;
    })
    .join("\n");
}

type InlineTextSegment = {
  kind: "math" | "text";
  value: string;
};

function appendInlineTextSegment(
  segments: InlineTextSegment[],
  kind: InlineTextSegment["kind"],
  value: string,
) {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.kind === kind) previous.value += value;
  else segments.push({ kind, value });
}

function splitTopLevelTextSegments(latex: string): InlineTextSegment[] {
  const segments: InlineTextSegment[] = [];
  const environments: string[] = [];
  let math = "";
  let braceDepth = 0;
  let fenceDepth = 0;

  const flushMath = () => {
    appendInlineTextSegment(segments, "math", math);
    math = "";
  };

  for (let index = 0; index < latex.length; index += 1) {
    if (latex[index] === "%" && !isEscaped(latex, index)) {
      const lineEnd = latex.indexOf("\n", index);
      const end = lineEnd < 0 ? latex.length : lineEnd + 1;
      math += latex.slice(index, end);
      index = end - 1;
      continue;
    }
    const token = readEnvironmentToken(latex, index);
    if (token) {
      math += latex.slice(index, token.end);
      updateEnvironmentStack(environments, token);
      index = token.end - 1;
      continue;
    }

    if (
      braceDepth === 0 &&
      fenceDepth === 0 &&
      environments.length === 0 &&
      !isEscaped(latex, index) &&
      /^\\text\s*\{/.test(latex.slice(index))
    ) {
      const openingBrace = skipLatexWhitespace(latex, index + "\\text".length);
      const end = readBalancedGroupEnd(latex, openingBrace);
      if (end !== null && !/[_^]/.test(latex[skipLatexWhitespace(latex, end)] ?? "")) {
        flushMath();
        appendInlineTextSegment(
          segments,
          "text",
          latex.slice(openingBrace + 1, end - 1),
        );
        index = end - 1;
        continue;
      }
    }

    if (latex[index] === "\\" && !isEscaped(latex, index)) {
      const commandEnd = readLatexCommandEnd(latex, index);
      const command = latex.slice(index + 1, commandEnd);
      if (braceDepth === 0 && fenceDepth === 0 && environments.length === 0 &&
          /^(?:over|atop|choose|brace|brack|above|overwithdelims|atopwithdelims|abovewithdelims)$/.test(command)) {
        // An infix fraction consumes the whole surrounding math group, including
        // text before/after the command. It cannot be split into separate spans.
        return [{ kind: "math", value: latex }];
      }
      if (command === "left" || command === "mleft") fenceDepth += 1;
      if (command === "right" || command === "mright") {
        fenceDepth = Math.max(0, fenceDepth - 1);
      }
      // An unbraced argument is still part of its command. Moving its text
      // outside math would change the formula, just as splitting a fence does.
      const end = readCompleteMathAtomEnd(latex, index) ?? commandEnd;
      math += latex.slice(index, end);
      index = end - 1;
      continue;
    }
    if ((latex[index] === "_" || latex[index] === "^") && !isEscaped(latex, index)) {
      const end = readCompleteMathAtomEnd(latex, index + 1);
      if (end !== null) {
        math += latex.slice(index, end);
        index = end - 1;
        continue;
      }
    }

    const character = latex[index];
    if (character === "{" && !isEscaped(latex, index)) braceDepth += 1;
    else if (character === "}" && !isEscaped(latex, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    math += character;
  }

  flushMath();
  return segments;
}

function wrapInlineMathWithProfile(
  latex: string,
  profile: LatexFormatProfile,
): string {
  return profile.inlineWrapper === "paren"
    ? `\\(${latex}\\)`
    : `$${latex}$`;
}

function formatInlineTextOutsideMath(
  latex: string,
  profile: LatexFormatProfile,
): string {
  const segments = splitTopLevelTextSegments(latex);
  if (!segments.length) return "";
  return segments
    .map((segment) => {
      if (segment.kind === "text") return segment.value;
      const math = segment.value.trim();
      return math ? wrapInlineMathWithProfile(math, profile) : "";
    })
    .join("");
}

function rootInternalMultiline(
  latex: string,
): { environment: "aligned" | "gathered"; rows: string[] } | null {
  const trimmed = latex.trim();
  const match = trimmed.match(
    /^\\begin\{(aligned|gathered)\}([\s\S]*)\\end\{\1\}$/,
  );
  if (!match) return null;
  const rows = splitTopLevelRows(match[2] ?? "");
  return rows.length
    ? {
        environment: match[1] as "aligned" | "gathered",
        rows,
      }
    : null;
}

function formatUniversalDisplayLine(
  latex: string,
  style: FormulaDisplayStyle | undefined,
  profile: LatexFormatProfile,
) {
  const resolved = resolveFormulaDisplayStyle(style, profile);
  if (resolved === "bracket") {
    return `\\[\n${latex}\n\\]`;
  }
  if (resolved === "equation" || resolved === "equation-star") {
    return wrapEnvironment(
      resolved === "equation" ? "equation" : "equation*",
      latex,
    );
  }
  return `$$\n${latex}\n$$`;
}

/**
 * Serialize the mixed visual document with one persistent format profile.
 * Row mode and per-row display overrides are document data; the profile only
 * supplies reusable defaults and the multiline policy.
 */
export function formatFormulaLinesUniversal(
  formulaLines: readonly FormulaLine[],
  profile: LatexFormatProfile,
): string {
  const blocks = formulaLines.flatMap((line) => {
    const normalized = normalizeCanonicalUprightCommands(
      String(line.latex ?? "").replace(/\r\n?/g, "\n"),
    ).trim();
    if (!normalized) return [];

    const multiline = rootInternalMultiline(normalized);
    if (multiline) {
      const environment =
        profile.multilineEnvironment + (profile.numbered ? "" : "*");
      return [
        wrapEnvironment(
          environment,
          formatRows(
            multiline.rows,
            profile.multilineEnvironment === "align",
          ),
        ),
      ];
    }

    const plain = stripKernelAlignmentMarkers(normalized);
    if (line.mode === "inline") {
      if (profile.inlineTextPolicy === "outside-math") {
        return [formatInlineTextOutsideMath(plain, profile)];
      }
      return [wrapInlineMathWithProfile(plain, profile)];
    }

    return [formatUniversalDisplayLine(plain, line.displayStyle, profile)];
  });

  return blocks.join("\n\n");
}

export function formatFormulaSelectionUniversal(
  line: FormulaLine,
  selectedLatex: string,
  profile: LatexFormatProfile,
  wholeLine: boolean,
): string {
  if (wholeLine) {
    return formatFormulaLinesUniversal([line], profile);
  }

  const normalizedSelection = normalizeCanonicalUprightCommands(
    String(selectedLatex ?? "").replace(/\r\n?/g, "\n"),
  ).trim();
  if (!normalizedSelection) return "";

  const originalMultiline = rootInternalMultiline(
    normalizeCanonicalUprightCommands(
      String(line.latex ?? "").replace(/\r\n?/g, "\n"),
    ).trim(),
  );
  if (originalMultiline) {
    const rows = splitTopLevelRows(normalizedSelection);
    const environment =
      profile.multilineEnvironment + (profile.numbered ? "" : "*");
    return wrapEnvironment(
      environment,
      formatRows(
        rows.length ? rows : [normalizedSelection],
        profile.multilineEnvironment === "align",
      ),
    );
  }

  return formatFormulaLinesUniversal(
    [{ ...line, latex: normalizedSelection }],
    profile,
  );
}
