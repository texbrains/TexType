// Draft checks of the LaTeX source view: whether a formula is complete, and a completed copy for the preview.
import { validateLatex } from "@app/kernel/kernel/public/mathlive-ssr.ts";
import { kernelCompletionCatalogData } from "@app/kernel/kernel/host.ts";
import { findCustomSymbolByCommand } from "@app/kernel/render/custom-symbols.ts";
import { KERNEL_PHYSICS_KERNEL_MACROS } from "@app/kernel/latex/physics-macros.ts";
import { compatibilityCommandNames } from "./compatibility";
import {
  isEscaped,
  readBalancedGroupEnd,
  readEnvironmentToken,
  readLatexArgumentEnd,
  readLatexCommandEnd,
  skipLatexWhitespace,
  requiredCommandArgumentCount,
} from "./latexScan";



function hasBalancedLatexGroups(source: string): boolean {
  let braceDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    if (isEscaped(source, index)) continue;
    if (character === "{") braceDepth += 1;
    else if (character === "}") {
      if (braceDepth === 0) return false;
      braceDepth -= 1;
    }
  }
  return braceDepth === 0;
}

function hasBalancedEnvironmentPairs(source: string): boolean {
  const stack: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    const token = readEnvironmentToken(source, index);
    if (!token) continue;
    if (token.kind === "begin") stack.push(token.name);
    else {
      if (stack.at(-1) !== token.name) return false;
      stack.pop();
    }
    index = token.end - 1;
  }
  return stack.length === 0;
}

function hasCompleteLeftRightPairs(source: string): boolean {
  let depth = 0;
  const pattern = /\\(left|right)\b/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (isEscaped(source, match.index)) continue;
    if (match[1] === "left") depth += 1;
    else {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return depth === 0;
}

function hasCompleteRequiredCommandArguments(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    if (source[index] !== "\\" || isEscaped(source, index)) continue;
    const commandEnd = readLatexCommandEnd(source, index);
    const command = source.slice(index + 1, commandEnd);
    const requiredArguments = requiredCommandArgumentCount.get(command);
    if (!requiredArguments) {
      index = commandEnd - 1;
      continue;
    }

    let cursor = skipLatexWhitespace(source, commandEnd);
    if (source[cursor] === "*") cursor = skipLatexWhitespace(source, cursor + 1);
    if (command === "sqrt" && source[cursor] === "[") {
      const optionalEnd = readBalancedGroupEnd(source, cursor, "[", "]");
      if (optionalEnd === null) return false;
      cursor = optionalEnd;
    }
    for (let argument = 0; argument < requiredArguments; argument += 1) {
      const argumentEnd = readLatexArgumentEnd(source, cursor);
      if (argumentEnd === null) return false;
      cursor = argumentEnd;
    }
    index = commandEnd - 1;
  }
  return true;
}

// Made the first time a draft is checked: the catalogue is handed in when the page starts.
let knownCommandNames: Set<string> | null = null;
const draftKnownCommandNames = () => (knownCommandNames ??= collectKnownCommandNames());

function collectKnownCommandNames() {
  const names = new Set<string>([
    "begin", "end", "left", "right", "middle", "text", "operatorname", "mathop",
    "color", "textcolor", "boxed", "placeholder", "limits", "nolimits", "substack",
  ]);
  const collect = (value: string) => {
    for (const match of value.matchAll(/\\([A-Za-z@]+)/g)) names.add(match[1]);
  };
  for (const command of kernelCompletionCatalogData) {
    collect(command.command);
    collect(command.latex);
    collect(command.preview);
  }
  for (const name of requiredCommandArgumentCount.keys()) names.add(name);
  for (const name of compatibilityCommandNames) names.add(name.replace(/^\\/, ""));
  for (const macro of KERNEL_PHYSICS_KERNEL_MACROS) names.add(macro.name);
  return names;
}

function firstUnknownDraftCommand(latex: string): string | null {
  for (let index = 0; index < latex.length; index += 1) {
    if (latex[index] === "%" && !isEscaped(latex, index)) {
      const lineEnd = latex.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    if (latex[index] !== "\\" || isEscaped(latex, index)) continue;
    const commandEnd = readLatexCommandEnd(latex, index);
    if (commandEnd <= index + 1) continue;
    const command = latex.slice(index + 1, commandEnd);
    if (!/^[A-Za-z@]+$/u.test(command)) continue;
    if (
      draftKnownCommandNames().has(command) ||
      findCustomSymbolByCommand(command)
    ) {
      index = commandEnd - 1;
      continue;
    }
    // The catalogue is a subset of MathLive's vocabulary (even \pm
    // and delimiter aliases can be absent). Ask the renderer about the command
    // token, leaving incomplete groups/arguments to the draft checks above.
    if (!validateLatex(`\\${command}`).some((error) => error.code === "unknown-command")) {
      draftKnownCommandNames().add(command);
      index = commandEnd - 1;
      continue;
    }
    return command;
  }
  return null;
}

const physicsMatrixDraftCommands = new Set(
  KERNEL_PHYSICS_KERNEL_MACROS
    .filter((macro) => macro.args === 1 && macro.def.includes("\\begin{"))
    .map((macro) => macro.name),
);

function normalizePhysicsMatrixDraftForValidation(latex: string): string {
  let normalized = "";
  for (let index = 0; index < latex.length;) {
    if (latex[index] !== "\\" || isEscaped(latex, index)) {
      normalized += latex[index];
      index += 1;
      continue;
    }
    const commandEnd = readLatexCommandEnd(latex, index);
    const command = latex.slice(index + 1, commandEnd);
    const argumentStart = skipLatexWhitespace(latex, commandEnd);
    const argumentEnd = physicsMatrixDraftCommands.has(command)
      ? readBalancedGroupEnd(latex, argumentStart)
      : null;
    if (argumentEnd !== null) {
      // The installed MathLive kernel parses these as real arrays. The stock
      // SSR validator does not know the new command names, so it incorrectly
      // treats their row separator (\\) as an unknown command. Validate the
      // same matrix contents inside an equivalent standard environment.
      const environment = KERNEL_PHYSICS_KERNEL_MACROS.find(
        (macro) => macro.name === command,
      )?.def.includes("\\begin{smallmatrix}") ? "smallmatrix" : "matrix";
      const contents = normalizePhysicsMatrixDraftForValidation(
        latex.slice(argumentStart + 1, argumentEnd - 1),
      );
      normalized += `\\begin{${environment}}${contents}\\end{${environment}}`;
      index = argumentEnd;
    } else {
      normalized += latex.slice(index, commandEnd);
      index = commandEnd;
    }
  }
  return normalized;
}

export function validateFormulaDraft(latex: string, requireExport = true): string | null {
  if (!latex.trim()) return null;
  const trimmed = latex.trimEnd();
  if (
    (trimmed.endsWith("\\") && !isEscaped(trimmed, trimmed.length - 1)) ||
    /\\begin\s*$/.test(trimmed) ||
    /\\begin\s*\{\s*\}\s*$/.test(trimmed)
  ) {
    return "incomplete-environment-command";
  }
  if (!hasBalancedLatexGroups(latex)) return "unbalanced-group";
  if (!hasBalancedEnvironmentPairs(latex)) return "incomplete-environment";
  if (!hasCompleteLeftRightPairs(latex)) return "incomplete-delimiter";
  if (/(^|[^\\])[_^]\s*$/.test(latex)) return "incomplete-script";
  if (!hasCompleteRequiredCommandArguments(latex)) {
    return "incomplete-command-arguments";
  }
  if (firstUnknownDraftCommand(latex)) return "unknown-command";
  const errors = validateLatex(normalizePhysicsMatrixDraftForValidation(latex)).filter(
    (error) =>
      !(
        error.code === "unknown-command" &&
        typeof error.arg === "string" &&
        (
          findCustomSymbolByCommand(error.arg) ||
          compatibilityCommandNames.has(error.arg.replace(/^\\/, "")) ||
          KERNEL_PHYSICS_KERNEL_MACROS.some(
            (macro) => macro.name === error.arg?.replace(/^\\/, ""),
          )
        )
      ),
  );
  if (errors.length) return errors[0]?.code ?? "invalid-latex";
  if (!requireExport) return null;

  // The source editor is an authoring surface, not an export gate. At this
  // point the draft is structurally complete, uses known commands, and passes
  // MathLive's own validator. Do not reject otherwise editable source merely
  // because the separate MathJax/Word export pipeline has a narrower grammar
  // (for example nested text-style commands that MathLive edits correctly).
  //
  // Export paths perform their own conversion validation when the user
  // actually exports/inserts the formula. Keeping that validation out of the
  // live source loop also means adding/removing formula rows cannot leave the
  // editor stuck in a false "source validation failed" state.
  return null;
}

interface DraftPreviewEnvironment {
  name: string;
  end: number;
}

function completeArrayEnvironmentArgumentsForPreview(source: string) {
  const beginToken = "\\begin{array}";
  let preview = source;
  let cursor = 0;

  while (cursor < preview.length) {
    const beginIndex = preview.indexOf(beginToken, cursor);
    if (beginIndex < 0) break;
    const tokenEnd = beginIndex + beginToken.length;
    const argumentStart = skipLatexWhitespace(preview, tokenEnd);
    if (preview[argumentStart] !== "{") {
      preview = preview.slice(0, tokenEnd) + "{c}" + preview.slice(tokenEnd);
      cursor = tokenEnd + 3;
      continue;
    }

    const argumentEnd = readBalancedGroupEnd(preview, argumentStart);
    if (argumentEnd !== null) {
      cursor = argumentEnd;
      continue;
    }

    const partial = preview.slice(argumentStart + 1);
    const safePrefix = partial.match(/^[lcr]+/)?.[0] ?? "c";
    const partialLength = partial.match(/^[lcr]+/)?.[0].length ?? 0;
    const partialEnd = argumentStart + 1 + partialLength;
    preview =
      preview.slice(0, argumentStart) +
      `{${safePrefix}}` +
      preview.slice(partialEnd);
    cursor = argumentStart + safePrefix.length + 2;
  }

  return preview.replace(
    /(\\begin\{array\}\s*\{[^{}]*\})(\s*)(\\end\{array\})/g,
    "$1$2\\placeholder{}$3",
  );
}

function completeUnclosedCurlyGroupsForPreview(source: string) {
  const stack: Array<{ hasContent: boolean }> = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    if (isEscaped(source, index)) continue;
    if (character === "{") {
      if (stack.length) stack[stack.length - 1].hasContent = true;
      stack.push({ hasContent: false });
      continue;
    }
    if (character === "}") {
      if (!stack.length) return source;
      stack.pop();
      continue;
    }
    if (stack.length && !/\s/.test(character)) {
      stack[stack.length - 1].hasContent = true;
    }
  }
  if (!stack.length) return source;

  let suffix = "";
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (!stack[index].hasContent) suffix += "\\placeholder{}";
    suffix += "}";
  }
  return source + suffix;
}

function completeRequiredCommandArgumentsForPreview(source: string) {
  let preview = source;
  for (let index = 0; index < preview.length; index += 1) {
    if (preview[index] === "%" && !isEscaped(preview, index)) {
      const lineEnd = preview.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    if (preview[index] !== "\\" || isEscaped(preview, index)) continue;
    const commandEnd = readLatexCommandEnd(preview, index);
    const command = preview.slice(index + 1, commandEnd);
    const requiredArguments = requiredCommandArgumentCount.get(command);
    if (!requiredArguments) {
      index = commandEnd - 1;
      continue;
    }

    let cursor = skipLatexWhitespace(preview, commandEnd);
    if (preview[cursor] === "*") cursor = skipLatexWhitespace(preview, cursor + 1);
    if (command === "sqrt" && preview[cursor] === "[") {
      const optionalEnd = readBalancedGroupEnd(preview, cursor, "[", "]");
      if (optionalEnd === null) {
        preview += "]";
        cursor = preview.length;
      } else {
        cursor = optionalEnd;
      }
    }

    for (let argument = 0; argument < requiredArguments; argument += 1) {
      const argumentEnd = readLatexArgumentEnd(preview, cursor);
      if (argumentEnd !== null) {
        cursor = argumentEnd;
        continue;
      }
      const insertionPoint = skipLatexWhitespace(preview, cursor);
      const missing = requiredArguments - argument;
      const placeholders = "{\\placeholder{}}".repeat(missing);
      preview =
        preview.slice(0, insertionPoint) +
        placeholders +
        preview.slice(insertionPoint);
      cursor = insertionPoint + placeholders.length;
      break;
    }
    index = commandEnd - 1;
  }
  return preview;
}

function completeTrailingScriptForPreview(source: string) {
  const match = source.match(/(^|[^\\])([_^])\s*$/);
  if (!match || match.index === undefined) return source;
  const scriptIndex = match.index + match[1].length;
  return (
    source.slice(0, scriptIndex + 1) +
    "{\\placeholder{}}" +
    source.slice(scriptIndex + 1)
  );
}

function completeLeftRightPairsForPreview(source: string) {
  let preview = source;
  if (/\\(?:left|right)\s*$/.test(preview)) preview += ".";

  let unmatchedLeft = 0;
  const pattern = /\\(left|right)\b/g;
  for (let match = pattern.exec(preview); match; match = pattern.exec(preview)) {
    if (isEscaped(preview, match.index)) continue;
    if (match[1] === "left") unmatchedLeft += 1;
    else if (unmatchedLeft > 0) unmatchedLeft -= 1;
  }
  if (unmatchedLeft > 0) preview += "\\right.".repeat(unmatchedLeft);
  return preview;
}

function collectUnclosedEnvironmentsForPreview(source: string) {
  const stack: DraftPreviewEnvironment[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
    const token = readEnvironmentToken(source, index);
    if (!token) continue;
    if (token.kind === "begin") {
      stack.push({ name: token.name, end: token.end });
    } else if (stack.at(-1)?.name === token.name) {
      stack.pop();
    } else {
      return [];
    }
    index = token.end - 1;
  }
  return stack;
}

function completeUnclosedEnvironmentsForPreview(source: string) {
  const stack = collectUnclosedEnvironmentsForPreview(source);
  if (!stack.length) return source;
  let preview = source + "\\placeholder{}";
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    preview += `\\end{${stack[index].name}}`;
  }
  return preview;
}

export function buildFormulaDraftPreview(latex: string): string | null {
  let preview = completeArrayEnvironmentArgumentsForPreview(latex);
  preview = completeUnclosedCurlyGroupsForPreview(preview);
  preview = completeRequiredCommandArgumentsForPreview(preview);
  preview = completeTrailingScriptForPreview(preview);
  preview = completeLeftRightPairsForPreview(preview);
  preview = completeUnclosedEnvironmentsForPreview(preview);
  return validateFormulaDraft(preview, false) === null ? preview : null;
}
