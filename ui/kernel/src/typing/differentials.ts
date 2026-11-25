// The differential d of the input judgment (judgment.ts): derivative fractions, quotients and integral measures
// set with an upright d (or back to an italic d when the judgment is reverted).
import {
  EXTENDED_INTEGRAL_COMMANDS,
  EXTENDED_INTEGRAL_COMMAND_PATTERN_SOURCE,
} from "../latex/extended-integrals.ts";

let differentialReplacement = "\\mathrm{d}";

/** The differential d set upright (italic when `revert`), outside text-like commands. */
export function normalizeDifferentials(source: string, revert: boolean): string {
  differentialReplacement = revert ? "\\mathit{d}" : "\\mathrm{d}";
  try {
    return transformOutsideProtectedCommands(source, normalizeContextualDifferentialOperators);
  } finally {
    differentialReplacement = "\\mathrm{d}";
  }
}

const protectedTypographyCommands = new Set([
  "text",
  "textnormal",
  "textrm",
  "mathrm",
  "operatorname",
  "mbox",
]);

function transformOutsideProtectedCommands(
  source: string,
  transform: (value: string) => string,
): string {
  let result = "";
  let chunkStart = 0;
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "\\") {
      index += 1;
      continue;
    }

    const commandMatch = /^\\([A-Za-z]+)\{/.exec(source.slice(index));
    if (!commandMatch || !protectedTypographyCommands.has(commandMatch[1])) {
      index += 1;
      continue;
    }

    const end = readBracedCommand(source, index);
    const semanticUprightSymbol =
      (commandMatch[1] === "mathrm" || commandMatch[1] === "textrm") &&
      /^\\(?:mathrm|textrm)\{[dDeij]\}$/.test(source.slice(index, end));
    if (semanticUprightSymbol) {
      // Keep canonical one-symbol upright atoms in the surrounding semantic
      // chunk. Incremental MathLive input can normalize the denominator first
      // (for example \frac{d^2y}{\mathrm{d}x^2}); splitting at that atom
      // would hide the still-italic numerator from derivative detection.
      index = end;
      continue;
    }

    result += transform(source.slice(chunkStart, index));
    result += source.slice(index, end);
    index = end;
    chunkStart = end;
  }

  return result + transform(source.slice(chunkStart));
}

const differentialFractionCommands = ["\\dfrac", "\\tfrac", "\\frac"];
// The extended list covers only rare/esint spellings; the standard integrals
// must be listed here or ordinary \int ... dx never receives an upright d.
const integralCommandPattern = new RegExp(
  `\\\\(?:${EXTENDED_INTEGRAL_COMMAND_PATTERN_SOURCE}|iiint|iint|oint|int)(?![A-Za-z])`,
  "g",
);
const nonVariableCommands = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "exp",
  "lim",
  "max",
  "min",
  "det",
  "gcd",
  ...EXTENDED_INTEGRAL_COMMANDS,
  "sum",
  "prod",
  "frac",
  "dfrac",
  "tfrac",
  "sqrt",
  "left",
  "right",
  "cdot",
  "times",
  "div",
  "partial",
]);
const styledVariableCommands = new Set([
  "mathbf",
  "boldsymbol",
  "vec",
  "hat",
  "widehat",
  "bar",
  "overline",
  "tilde",
  "widetilde",
  "mathit",
  "mathrm",
  "mathsf",
  "mathtt",
  "mathbb",
  "mathcal",
  "mathscr",
  "mathfrak",
]);
const greekVariableCommands = new Set([
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "pi",
  "varpi",
  "rho",
  "varrho",
  "sigma",
  "varsigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
]);

interface BracedSpan {
  open: number;
  close: number;
  content: string;
}

interface DifferentialPrefix {
  dIndex: number;
  end: number;
  alreadyUpright: boolean;
}

function readBracedSpan(source: string, open: number): BracedSpan | null {
  if (source[open] !== "{") return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          open,
          close: index,
          content: source.slice(open + 1, index),
        };
      }
    }
  }
  return null;
}

function readCommandEnd(source: string, start: number): number {
  if (source[start] !== "\\") return start;
  let end = start + 1;
  if (/[A-Za-z]/.test(source[end] ?? "")) {
    while (/[A-Za-z]/.test(source[end] ?? "")) end += 1;
    return end;
  }
  return Math.min(source.length, end + 1);
}

function skipDifferentialSpacing(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (
      source.startsWith("\\,", index) ||
      source.startsWith("\\!", index) ||
      source.startsWith("\\:", index) ||
      source.startsWith("\\;", index) ||
      source.startsWith("\\ ", index)
    ) {
      index += 2;
      continue;
    }
    const spacing = source.slice(index).match(
      /^\\(?:quad|qquad|enspace|thinspace|medspace|thickspace)(?![A-Za-z])/,
    );
    if (spacing) {
      index += spacing[0].length;
      continue;
    }
    break;
  }
  return index;
}

function readScriptEnd(source: string, start: number): number {
  let index = start;
  while (source[index] === "^" || source[index] === "_") {
    index += 1;
    index = skipDifferentialSpacing(source, index);
    if (source[index] === "{") {
      const group = readBracedSpan(source, index);
      if (!group) return source.length;
      index = group.close + 1;
    } else if (source[index] === "\\") {
      index = readCommandEnd(source, index);
    } else if (index < source.length) {
      index += 1;
    }
    index = skipDifferentialSpacing(source, index);
  }
  return index;
}

function readDifferentialVariableEnd(source: string, start: number): number {
  let index = skipDifferentialSpacing(source, start);
  const character = source[index];
  if (!character) return -1;

  if (/[A-Za-z]/.test(character)) {
    if (/[A-Za-z0-9]/.test(source[index + 1] ?? "")) return -1;
    return readScriptEnd(source, index + 1);
  }

  if (character === "{") {
    const group = readBracedSpan(source, index);
    return group ? readScriptEnd(source, group.close + 1) : -1;
  }

  if (character === "(") {
    let depth = 0;
    for (let cursor = index; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") {
        depth -= 1;
        if (depth === 0) return readScriptEnd(source, cursor + 1);
      }
    }
    return -1;
  }

  if (character !== "\\") return -1;
  const commandEnd = readCommandEnd(source, index);
  const command = source.slice(index + 1, commandEnd);
  if (!command || nonVariableCommands.has(command)) return -1;

  let end = commandEnd;
  if (styledVariableCommands.has(command)) {
    end = skipDifferentialSpacing(source, end);
    const group = readBracedSpan(source, end);
    if (!group) return -1;
    end = group.close + 1;
  }
  return readScriptEnd(source, end);
}

function readDifferentialPrefix(
  source: string,
  allowBareOperator: boolean,
): DifferentialPrefix | null {
  let index = skipDifferentialSpacing(source, 0);
  if (source.startsWith("\\mathrm{d}", index)) {
    const end = index + "\\mathrm{d}".length;
    const variableEnd = readDifferentialVariableEnd(source, end);
    if (variableEnd >= 0 || allowBareOperator) {
      return { dIndex: index, end: variableEnd >= 0 ? variableEnd : end, alreadyUpright: true };
    }
    return null;
  }
  if (source.startsWith("\\differentialD", index)) {
    const end = index + "\\differentialD".length;
    const variableEnd = readDifferentialVariableEnd(source, end);
    if (variableEnd >= 0 || allowBareOperator) {
      return { dIndex: index, end: variableEnd >= 0 ? variableEnd : end, alreadyUpright: true };
    }
    return null;
  }
  if (source[index] !== "d") return null;

  const dIndex = index;
  index += 1;
  index = skipDifferentialSpacing(source, index);
  if (source[index] === "^") {
    index = readScriptEnd(source, index);
  }
  index = skipDifferentialSpacing(source, index);
  const variableEnd = readDifferentialVariableEnd(source, index);
  if (variableEnd >= 0) {
    return { dIndex, end: variableEnd, alreadyUpright: false };
  }
  if (allowBareOperator && index >= source.length) {
    return { dIndex, end: index, alreadyUpright: false };
  }
  return null;
}

function uprightDifferentialPrefix(
  source: string,
  allowBareOperator: boolean,
): string {
  const prefix = readDifferentialPrefix(source, allowBareOperator);
  if (!prefix || prefix.alreadyUpright) return source;
  return (
    source.slice(0, prefix.dIndex) +
    differentialReplacement +
    source.slice(prefix.dIndex + 1)
  );
}

function leadingDifferentialVariableCommand(source: string): string | null {
  let index = skipDifferentialSpacing(source, 0);
  if (source.startsWith("\\mathrm{d}", index)) return null;
  if (source.startsWith("\\differentialD", index)) return null;
  if (source[index] !== "d") return null;

  index += 1;
  index = skipDifferentialSpacing(source, index);
  if (source[index] === "^") {
    index = readScriptEnd(source, index);
  }
  index = skipDifferentialSpacing(source, index);

  if (source[index] === "{") {
    const group = readBracedSpan(source, index);
    if (!group) return null;
    const groupIndex = skipDifferentialSpacing(group.content, 0);
    if (group.content[groupIndex] !== "\\") return null;
    const commandEnd = readCommandEnd(group.content, groupIndex);
    return group.content.slice(groupIndex + 1, commandEnd);
  }

  if (source[index] !== "\\") return null;
  const commandEnd = readCommandEnd(source, index);
  return source.slice(index + 1, commandEnd);
}

function uprightLeadingGreekDifferential(source: string): string {
  const variableCommand = leadingDifferentialVariableCommand(source);
  if (!variableCommand || !greekVariableCommands.has(variableCommand)) {
    return source;
  }
  return uprightDifferentialPrefix(source, false);
}

function uprightDifferentialSequence(source: string): string {
  const sequence = integralMeasureTail(source, 0, source.length);
  if (!sequence) return uprightDifferentialPrefix(source, false);

  let normalized = source;
  for (const dIndex of [...sequence.dIndices].sort((a, b) => b - a)) {
    normalized =
      normalized.slice(0, dIndex) +
      differentialReplacement +
      normalized.slice(dIndex + 1);
  }
  return normalized;
}

function normalizeDerivativeFractions(source: string): string {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const command = differentialFractionCommands.find((candidate) =>
      source.startsWith(candidate, index),
    );
    if (!command) {
      result += source[index];
      index += 1;
      continue;
    }

    const firstOpen = skipDifferentialSpacing(source, index + command.length);
    const numeratorGroup = readBracedSpan(source, firstOpen);
    if (!numeratorGroup) {
      result += source[index];
      index += 1;
      continue;
    }
    const secondOpen = skipDifferentialSpacing(source, numeratorGroup.close + 1);
    const denominatorGroup = readBracedSpan(source, secondOpen);
    if (!denominatorGroup) {
      result += source[index];
      index += 1;
      continue;
    }

    let numerator = uprightLeadingGreekDifferential(
      normalizeDerivativeFractions(numeratorGroup.content),
    );
    let denominator = uprightLeadingGreekDifferential(
      normalizeDerivativeFractions(denominatorGroup.content),
    );
    if (
      readDifferentialPrefix(numerator, true) &&
      readDifferentialPrefix(denominator, false)
    ) {
      numerator = uprightDifferentialPrefix(numerator, true);
      denominator = uprightDifferentialSequence(denominator);
    }

    result +=
      command +
      source.slice(index + command.length, firstOpen) +
      "{" +
      numerator +
      "}" +
      source.slice(numeratorGroup.close + 1, secondOpen) +
      "{" +
      denominator +
      "}";
    index = denominatorGroup.close + 1;
  }
  return result;
}

function topLevelBoundaryBefore(source: string, position: number): number {
  let braceDepth = 0;
  let fenceDepth = 0;
  for (let index = position - 1; index >= 0; index -= 1) {
    const character = source[index];
    if (character === "}") braceDepth += 1;
    else if (character === "{") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === ")" || character === "]") fenceDepth += 1;
    else if (character === "(" || character === "[") {
      if (fenceDepth > 0) fenceDepth -= 1;
      else if (braceDepth === 0) return index + 1;
    } else if (
      braceDepth === 0 &&
      fenceDepth === 0 &&
      /[=+\-;,]/.test(character)
    ) {
      return index + 1;
    }
  }
  return 0;
}

function topLevelBoundaryAfter(source: string, position: number): number {
  let braceDepth = 0;
  let fenceDepth = 0;
  for (let index = position; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === "(" || character === "[") fenceDepth += 1;
    else if (character === ")" || character === "]") {
      if (fenceDepth > 0) fenceDepth -= 1;
      else if (braceDepth === 0) return index;
    } else if (
      braceDepth === 0 &&
      fenceDepth === 0 &&
      /[=+\-;,]/.test(character)
    ) {
      return index;
    }
  }
  return source.length;
}

function normalizeDirectDifferentialQuotients(source: string): string {
  const replacements = new Set<number>();
  let braceDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    else if (source[index] === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (source[index] === "/" && source[index - 1] !== "\\") {
      const leftStart = topLevelBoundaryBefore(source, index);
      const rightEnd = topLevelBoundaryAfter(source, index + 1);
      const left = source.slice(leftStart, index);
      const right = source.slice(index + 1, rightEnd);
      const leftPrefix = readDifferentialPrefix(left, true);
      const rightPrefix = readDifferentialPrefix(right, false);
      if (leftPrefix && rightPrefix) {
        if (!leftPrefix.alreadyUpright) replacements.add(leftStart + leftPrefix.dIndex);
        if (!rightPrefix.alreadyUpright) replacements.add(index + 1 + rightPrefix.dIndex);
      }
    }
  }
  if (replacements.size === 0) return source;

  let result = source;
  for (const position of [...replacements].sort((a, b) => b - a)) {
    result = result.slice(0, position) + differentialReplacement + result.slice(position + 1);
  }
  return result;
}

function integralMeasureTail(
  source: string,
  start: number,
  boundary: number,
): { dIndices: number[]; end: number } | null {
  const dIndices: number[] = [];
  let index = skipDifferentialSpacing(source, start);
  while (index < boundary) {
    while (/[,.;]/.test(source[index] ?? "")) index += 1;
    if (source.startsWith("\\right", index)) {
      index = readCommandEnd(source, index);
      if (source[index] === "\\") index = readCommandEnd(source, index);
      else if (index < boundary) index += 1;
      index = skipDifferentialSpacing(source, index);
      continue;
    }
    const prefix = readDifferentialPrefix(source.slice(index, boundary), false);
    if (!prefix) break;
    if (!prefix.alreadyUpright) dIndices.push(index + prefix.dIndex);
    index += prefix.end;
    index = skipDifferentialSpacing(source, index);
  }
  index = skipDifferentialSpacing(source, index);
  while (/[,.;)]/.test(source[index] ?? "")) index += 1;
  return index >= boundary && dIndices.length > 0
    ? { dIndices, end: index }
    : null;
}

function normalizeIntegralDifferentials(source: string): string {
  const replacements = new Set<number>();
  const integralMatches = [...source.matchAll(integralCommandPattern)];
  for (const match of integralMatches) {
    const integralEnd = (match.index ?? 0) + match[0].length;
    const segmentEnd = topLevelBoundaryAfter(source, integralEnd);
    let braceDepth = 0;
    let fenceDepth = 0;
    for (let index = integralEnd; index < segmentEnd; index += 1) {
      const character = source[index];
      if (character === "{") {
        braceDepth += 1;
        continue;
      }
      if (character === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (character === "(" || character === "[") {
        fenceDepth += 1;
        continue;
      }
      if (character === ")" || character === "]") {
        fenceDepth = Math.max(0, fenceDepth - 1);
        continue;
      }
      if (character !== "d" || braceDepth > 0 || fenceDepth > 0) continue;
      if (insideCommandName(source, index)) continue;
      const tail = integralMeasureTail(source, index, segmentEnd);
      if (!tail) continue;
      for (const dIndex of tail.dIndices) replacements.add(dIndex);
      break;
    }
  }
  if (replacements.size === 0) return source;

  let result = source;
  for (const position of [...replacements].sort((a, b) => b - a)) {
    result = result.slice(0, position) + differentialReplacement + result.slice(position + 1);
  }
  return result;
}

function normalizeContextualDifferentialOperators(source: string): string {
  return normalizeIntegralDifferentials(
    normalizeDirectDifferentialQuotients(normalizeDerivativeFractions(source)),
  );
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

// The letter at `index` belongs to a control word such as \pmod.
function insideCommandName(source: string, index: number) {
  let cursor = index - 1;
  while (cursor >= 0 && /[A-Za-z]/.test(source[cursor])) cursor -= 1;
  return cursor >= 0 && source[cursor] === "\\";
}
