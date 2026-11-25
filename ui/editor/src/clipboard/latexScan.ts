// Low-level LaTeX scanning shared by the source view's formatter, parser and draft checks.
import { KERNEL_PHYSICS_KERNEL_MACROS } from "@app/kernel/latex/physics-macros.ts";
import { compatibilityRequiredArgumentCounts } from "./compatibility";
import { KERNEL_ALIGNMENT_MARKER_LATEX } from "../editor/alignmentMarkers";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wrapEnvironment(name: string, body: string): string {
  return `\\begin{${name}}\n${body}\n\\end{${name}}`;
}

export function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

interface EnvironmentToken {
  kind: "begin" | "end";
  name: string;
  end: number;
}

export function readEnvironmentToken(source: string, index: number): EnvironmentToken | null {
  if (source[index] !== "\\" || isEscaped(source, index)) return null;
  const match = source.slice(index).match(/^\\(begin|end)\s*\{\s*([A-Za-z]+\*?)\s*\}/);
  if (!match) return null;
  return {
    kind: match[1] as EnvironmentToken["kind"],
    name: match[2],
    end: index + match[0].length,
  };
}

export function updateEnvironmentStack(stack: string[], token: EnvironmentToken) {
  if (token.kind === "begin") {
    stack.push(token.name);
    return;
  }
  const matchingIndex = stack.lastIndexOf(token.name);
  if (matchingIndex >= 0) stack.splice(matchingIndex, 1);
}

export function encodeTopLevelAlignmentMarkers(latex: string): string {
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
      result += KERNEL_ALIGNMENT_MARKER_LATEX;
      continue;
    }
    result += character;
  }

  return result.trim();
}

export function readBalancedGroupEnd(
  source: string,
  openingIndex: number,
  opening = "{",
  closing = "}",
): number | null {
  if (source[openingIndex] !== opening) return null;
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) return null;
      index = lineEnd;
      continue;
    }
    if (source[index] === opening && !isEscaped(source, index)) depth += 1;
    else if (source[index] === closing && !isEscaped(source, index)) {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return null;
    }
  }
  return null;
}

export function extractEnvironmentBodies(source: string, name: string): string[] {
  const escapedName = escapeRegExp(name);
  const pattern = new RegExp(
    `\\\\begin\\{${escapedName}\\}([\\s\\S]*?)\\\\end\\{${escapedName}\\}`,
    "g",
  );
  return [...source.matchAll(pattern)].map((match) => match[1].trim());
}

export function splitTopLevelRows(body: string): string[] {
  const rows: string[] = [];
  let current = "";
  let braceDepth = 0;
  const environments: string[] = [];

  for (let index = 0; index < body.length; index += 1) {
    const token = readEnvironmentToken(body, index);
    if (token) {
      current += body.slice(index, token.end);
      updateEnvironmentStack(environments, token);
      index = token.end - 1;
      continue;
    }

    const character = body[index];
    if (character === "%" && !isEscaped(body, index)) {
      const lineEnd = body.indexOf("\n", index);
      if (lineEnd < 0) {
        current += body.slice(index);
        break;
      }
      current += body.slice(index, lineEnd + 1);
      index = lineEnd;
      continue;
    }

    if (character === "{" && !isEscaped(body, index)) braceDepth += 1;
    else if (character === "}" && !isEscaped(body, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (
      character === "\\" &&
      body[index + 1] === "\\" &&
      braceDepth === 0 &&
      environments.length === 0
    ) {
      rows.push(current.trim());
      current = "";
      index += 1;

      let cursor = index + 1;
      while (/\s/.test(body[cursor] ?? "")) cursor += 1;
      if (body[cursor] === "[") {
        const closingBracket = body.indexOf("]", cursor + 1);
        if (closingBracket >= 0) cursor = closingBracket + 1;
      }
      while (/\s/.test(body[cursor] ?? "")) cursor += 1;
      index = cursor - 1;
      continue;
    }

    current += character;
  }

  if (current.trim() || rows.length === 0) rows.push(current.trim());
  return rows.filter((row) => row.length > 0);
}

// commands and how many required arguments they take
export const requiredCommandArgumentCount = new Map<string, number>([
  ...compatibilityRequiredArgumentCounts,
  ...KERNEL_PHYSICS_KERNEL_MACROS.filter((macro) => macro.args > 0).map(
    (macro) => [macro.name, macro.args] as const,
  ),
  ["frac", 2],
  ["dfrac", 2],
  ["tfrac", 2],
  ["cfrac", 2],
  ["binom", 2],
  ["overset", 2],
  ["underset", 2],
  ["stackrel", 2],
  ["stackbin", 2],
  ["sqrt", 1],
  ["text", 1],
  ["textrm", 1],
  ["mathrm", 1],
  ["mathbf", 1],
  ["mathit", 1],
  ["mathsf", 1],
  ["mathtt", 1],
  ["mathbb", 1],
  ["mathcal", 1],
  ["mathfrak", 1],
  ["operatorname", 1],
  ["overline", 1],
  ["underline", 1],
  ["hat", 1],
  ["widehat", 1],
  ["tilde", 1],
  ["widetilde", 1],
  ["vec", 1],
  ["dot", 1],
  ["ddot", 1],
  ["dddot", 1],
  ["ddddot", 1],
  ["check", 1],
  ["breve", 1],
  ["acute", 1],
  ["grave", 1],
  ["mathring", 1],
  ["overbrace", 1],
  ["underbrace", 1],
  ["overarc", 1],
  ["underarc", 1],
  ["overparen", 1],
  ["underparen", 1],
  ["overgroup", 1],
  ["undergroup", 1],
  ["overrightarrow", 1],
  ["overleftarrow", 1],
  ["overleftrightarrow", 1],
  ["underleftarrow", 1],
  ["underrightarrow", 1],
  ["underleftrightarrow", 1],
]);

export function skipLatexWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

export function readLatexCommandEnd(source: string, start: number): number {
  if (source[start] !== "\\") return start;
  let index = start + 1;
  if (/[A-Za-z]/.test(source[index] ?? "")) {
    while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
    return index;
  }
  return Math.min(source.length, index + 1);
}

export function readLatexArgumentEnd(source: string, start: number): number | null {
  const index = skipLatexWhitespace(source, start);
  if (index >= source.length || source[index] === "}") return null;
  if (source[index] === "{") return readBalancedGroupEnd(source, index);
  if (source[index] === "\\") return readLatexCommandEnd(source, index);
  return index + 1;
}

export function readCompleteMathAtomEnd(source: string, start: number, depth = 0): number | null {
  const index = skipLatexWhitespace(source, start);
  if (depth > 100 || index >= source.length || source[index] === "}") return null;
  if (source[index] === "{") return readBalancedGroupEnd(source, index);
  if (source[index] !== "\\") return index + 1;
  let cursor = readLatexCommandEnd(source, index);
  const command = source.slice(index + 1, cursor);
  const count = requiredCommandArgumentCount.get(command) ?? 0;
  if (!count) return cursor;
  cursor = skipLatexWhitespace(source, cursor);
  if (command === "operatorname" && source[cursor] === "*") cursor += 1;
  cursor = skipLatexWhitespace(source, cursor);
  if (command === "sqrt" && source[cursor] === "[") {
    const end = readBalancedGroupEnd(source, cursor, "[", "]");
    if (end === null) return null;
    cursor = end;
  }
  for (let argument = 0; argument < count; argument += 1) {
    const end = readCompleteMathAtomEnd(source, cursor, depth + 1);
    if (end === null) return null;
    cursor = end;
  }
  return cursor;
}
