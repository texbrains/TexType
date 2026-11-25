// LaTeX -> Presentation MathML with MathJax: what the Word equation writer (core/convert omml) and MathML output start
// from. MathJax only converts here; it draws nothing. An unknown command or a parse error is an error that says so,
// never a formula with error nodes or red text.
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { STATE } from "mathjax-full/js/core/MathItem.js";
import { SerializedMmlVisitor } from "mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js";
import { TEXCLASS, type MmlNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import { EXPLICIT_MATH_FONT_PACKAGE } from "./explicit-math-font.ts";
import { materializeEffectiveOperatorVariants } from "./operator-variants.ts";
import { groupBigOperatorOperands } from "./operands.ts";
import {
  KERNEL_MATHML_MACROS,
  assertNoUnfilledStructuralPlaceholders,
  assertResolvedPresentationMathMl,
  normalizePackageLatexCommands,
} from "../latex/compatibility.ts";
import { normalizeExtendedIntegralLatexCommands } from "../latex/extended-integrals.ts";
import { normalizeTensorIndexCommands } from "../latex/tensor-index.ts";
import { isSingleCompleteLatexEnvironment, unwrapSingleLatexDisplayMath } from "../latex/environment.ts";
import { expandCustomSymbolsForMathMl } from "../render/custom-symbol-rendering.ts";

RegisterHTMLHandler(liteAdaptor());

/** The text of a MathJax error (TexError is not an Error subclass). */
function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message.trim();
  }
  return String(error);
}

const input = new TeX({
  // every package except the two that turn an unknown command or a syntax error into a rendered result
  packages: [...AllPackages.filter((name) => name !== "noundefined" && name !== "noerrors"), EXPLICIT_MATH_FONT_PACKAGE],
  macros: KERNEL_MATHML_MACROS,
  formatError: (_jax: unknown, error: unknown) => {
    const message = messageOf(error);
    const unknownCommand = message.match(/^Undefined control sequence (\\[A-Za-z@]+|\\.)/);
    if (unknownCommand) throw new Error(`MathJax did not resolve LaTeX command ${unknownCommand[1]}.`, { cause: error });
    throw new Error(message, { cause: error });
  },
});
// The SVG output is never run: its font says which glyph a math alphabet really falls back to (operator-variants.ts).
const output = new SVG({ fontCache: "local", internalSpeechTitles: false });
const document = mathjax.document("", { InputJax: input, OutputJax: output });

// Keeps the parser's named-operator role where the stock serializer would drop it because of the spelling: an
// autoOP=false font scope does not make an identifier ordinary.
class RolePreservingMmlVisitor extends SerializedMmlVisitor {
  protected getDataAttributes(node: MmlNode): { [name: string]: string } {
    const data = super.getDataAttributes(node);
    if (node.isKind("mi") && node.getProperty("texClass") === TEXCLASS.OP) data["data-mjx-texclass"] = "OP";
    return data;
  }
}
const serializer = new RolePreservingMmlVisitor(document.mmlFactory);

/** The editor's differential and constant commands as the standard LaTeX MathJax knows. */
const CANONICAL_UPRIGHT_COMMANDS: ReadonlyArray<readonly [command: string, standardLatex: string]> = [
  ["capitalDifferentialD", "\\mathrm{D}"],
  ["differentialD", "\\mathrm{d}"],
  ["exponentialE", "\\mathrm{e}"],
  ["imaginaryI", "\\mathrm{i}"],
  ["imaginaryJ", "\\mathrm{j}"],
];

function normalizeCanonicalUprightCommands(source: string): string {
  let normalized = source;
  for (const [command, standardLatex] of CANONICAL_UPRIGHT_COMMANDS) {
    normalized = normalized.replace(new RegExp(`\\\\${command}(?![A-Za-z])[ \\t]*`, "g"), standardLatex);
  }
  return normalized.replace(/\\(?:mathrm|textrm)\{d([A-Za-z])\}/g, "\\mathrm{d}$1");
}

/** Formula rows (one per line) as one formula: rows anchored on their left edge, as the editor stacks them. */
function joinFormulaRows(normalized: string) {
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return normalized;
  // a source that is one complete environment keeps its rows; an inner matrix on one row of several does not
  if (isSingleCompleteLatexEnvironment(normalized)) return normalized;
  return `\\begin{aligned}${lines.map((line) => `&${line}`).join("\\\\")}\\end{aligned}`;
}

function prepareLatex(latex: string) {
  const normalized = normalizeCanonicalUprightCommands(
    normalizeExtendedIntegralLatexCommands(
      normalizePackageLatexCommands(normalizeTensorIndexCommands(latex.replace(/\r\n?/g, "\n"))),
    ),
  ).trim();
  if (!normalized) throw new Error("Cannot export an empty formula.");
  assertNoUnfilledStructuralPlaceholders(normalized);
  // a display formula saved as \[ ... \]: MathJax is already in display mode, so the delimiters must not become glyphs
  return joinFormulaRows(unwrapSingleLatexDisplayMath(normalized) ?? normalized);
}

/** One formula as Presentation MathML (synchronous: MathJax converts synchronously). */
export function latexToMathMl(latex: string, displayMode: boolean): string {
  const root = document.convert(expandCustomSymbolsForMathMl(prepareLatex(latex)), {
    display: displayMode,
    end: STATE.COMPILED,
  }) as MmlNode;
  materializeEffectiveOperatorVariants(root, output.font);
  // a big operator's operand as one row: the writer makes it the body of Word's n-ary object
  groupBigOperatorOperands(root, document.mmlFactory);
  const mathMl = serializer.visitTree(root).trim();
  if (!mathMl.startsWith("<math") || !mathMl.includes("MathML")) {
    throw new Error("MathJax did not produce valid Presentation MathML.");
  }
  assertResolvedPresentationMathMl(mathMl);
  return mathMl;
}
