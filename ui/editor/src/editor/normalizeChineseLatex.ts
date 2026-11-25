import { normalizeMathModeSource } from "../math/mathModeSource";
import { normalizeExtendedIntegralLatexCommands } from "@app/kernel/latex/extended-integrals.ts";
import {
  applyInputJudgment,
  type InputJudgmentOptions,
} from "@app/kernel/typing/judgment.ts";

const chineseChar = /[\u3400-\u9fff\uf900-\ufaff，。；：！？、（）【】《》“”‘’]/;

const CANONICAL_UPRIGHT_COMMANDS: ReadonlyArray<
  readonly [command: string, standardLatex: string]
> = [
  ["capitalDifferentialD", "\\mathrm{D}"],
  ["differentialD", "\\mathrm{d}"],
  ["exponentialE", "\\mathrm{e}"],
  ["imaginaryI", "\\mathrm{i}"],
  ["imaginaryJ", "\\mathrm{j}"],
];

export function normalizeCanonicalUprightCommands(
  source: string,
): string {
  let normalized = source;
  for (const [command, standardLatex] of CANONICAL_UPRIGHT_COMMANDS) {
    normalized = normalized.replace(
      new RegExp(`\\\\${command}(?![A-Za-z])[ \\t]*`, "g"),
      standardLatex,
    );
  }
  return normalized.replace(
    /\\(?:mathrm|textrm)\{d([A-Za-z])\}/g,
    "\\mathrm{d}$1",
  );
}

/**
 * Upright/italic for stored, pasted and imported LaTeX: the input judgment
 * without quick escapes (those apply only to words typed in the editor).
 */
export function normalizeContextualUprightSymbols(
  source: string,
  options: Pick<InputJudgmentOptions, "deferLetterRuns" | "upright"> = {},
): string {
  return applyInputJudgment(source, options);
}

function readBracedCommand(source: string, start: number): number {
  const openingBrace = source.indexOf("{", start);
  if (openingBrace < 0) return start;
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

// A text-mode group the formula already has (TeX allows spaces before its brace: recognized and pasted LaTeX can have
// "\text { 且 }"): kept as it is, its CJK text not wrapped a second time.
const TEXT_GROUP_COMMAND =
  /^\\(?:text|textrm|textnormal|textup|textmd|textbf|textit|textsl|textsf|texttt|mbox|hbox)\s*(?=\{)/;

/**
 * A row's stored LaTeX: canonical upright commands, the input judgment's
 * upright letters, CJK text wrapped in \text{}, no math-mode switches.
 */
export function normalizeChineseLatex(source: string): string {
  const canonical = normalizeCanonicalUprightCommands(
    normalizeExtendedIntegralLatexCommands(source),
  );
  const normalizedTextCommands = normalizeContextualUprightSymbols(
    canonical,
  ).replace(
    /\\(mathrm|textrm)\s*\{([\u3400-\u9fff\uf900-\ufaff，。；：！？、（）【】《》“”‘’\s]+)\}/g,
    // spaces inside \mathrm are math mode's (not drawn); inside \textrm they are text
    (_whole, command: string, body: string) =>
      `\\text{${command === "mathrm" ? body.replace(/\s+/g, "") : body}}`,
  );

  let result = "";
  let index = 0;

  while (index < normalizedTextCommands.length) {
    const textGroup =
      normalizedTextCommands[index] === "\\"
        ? TEXT_GROUP_COMMAND.exec(normalizedTextCommands.slice(index))
        : null;
    if (textGroup) {
      const end = readBracedCommand(normalizedTextCommands, index + textGroup[0].length);
      result += normalizedTextCommands.slice(index, end);
      index = end;
      continue;
    }

    if (chineseChar.test(normalizedTextCommands[index])) {
      let end = index + 1;
      while (
        end < normalizedTextCommands.length &&
        (chineseChar.test(normalizedTextCommands[end]) ||
          (normalizedTextCommands[end] === " " &&
            end + 1 < normalizedTextCommands.length &&
            chineseChar.test(normalizedTextCommands[end + 1])))
      ) {
        end += 1;
      }
      result += "\\text{" + normalizedTextCommands.slice(index, end) + "}";
      index = end;
      continue;
    }

    result += normalizedTextCommands[index];
    index += 1;
  }

  return normalizeMathModeSource(result);
}
