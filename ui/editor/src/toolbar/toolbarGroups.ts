// The toolbar's fixed groups (one tab each) and what each shows: the catalogue's commands of that category, plus the
// matrix builder in the matrix group (the common and calculus tabs list theirs here, in their order). Also the
// button metrics and the preview formulas the buttons draw where they differ from the command's own preview.
import { kernelCompletionCatalogData } from "@app/kernel/kernel/host.ts";
import type { Command, CommandCategory } from "../types/command";

export type ToolbarItem =
  | { kind: "command"; command: Command }
  | { kind: "matrix" };

export interface ToolbarGroup {
  id: CommandCategory;
  labelZh: string;
  labelEn: string;
  items: ToolbarItem[];
}

const GROUP_ORDER: CommandCategory[] = [
  "common",
  "structure",
  "calculus",
  "matrix",
  "relation",
  "greek",
  "arrow",
  "physics",
  "set",
];

const GROUP_LABELS: Record<CommandCategory, { zh: string; en: string }> = {
  common: { zh: "常用", en: "Common" },
  structure: { zh: "结构", en: "Structures" },
  calculus: { zh: "微积分", en: "Calculus" },
  matrix: { zh: "矩阵", en: "Matrices" },
  greek: { zh: "希腊字母", en: "Greek" },
  relation: { zh: "关系", en: "Relations" },
  set: { zh: "集合与逻辑", en: "Sets & Logic" },
  arrow: { zh: "箭头", en: "Arrows" },
  physics: { zh: "物理常用", en: "Physics" },
};

const COMMON_COMMAND_IDS = [
  "frac", "sqrt", "power", "subscript", "hat", "tilde", "parentheses", "absolute", "intplain", "int", "iint", "oint",
  "sum", "prod", "lim", "partialderivative-frac", "derivative", "nabla", "infty", "matrix2", "cases", "vector",
  "alpha", "beta", "gamma", "theta", "lambda", "mu", "pi", "sigma", "omega", "delta", "equal", "neq", "approx", "leq",
  "geq", "propto", "times", "div", "in", "subset", "rightarrow", "forall", "exists",
];

const CALCULUS_COMMAND_IDS = [
  "int-bare", "iint-bare", "iiint-bare", "oint-bare", "oiint-bare", "oiiint-bare", "intplain-no-d", "int-bounds-no-d",
  "iint-no-d", "iint-bounds-no-d", "iiint-no-d", "iiint-bounds-no-d", "oint-no-d", "oint-bounds-no-d", "oiint-no-d",
  "oiiint-no-d", "intplain", "int", "iint-bounds", "iiint-bounds", "oint-bounds", "lineintegral", "iint",
  "surfaceintegral", "iiint", "volumeintegral", "oint", "closed-surface-integral", "closed-volume-integral", "sum",
  "sum-finite", "series", "sum-lower", "sum-upper", "prod", "prod-finite", "productseries", "prod-lower",
  "prod-upper", "coproduct", "lim", "lim-infty", "lim-left", "lim-right", "derivative", "secondderivative",
  "partialderivative-frac", "partialsecond", "mixedpartial", "partial", "dd", "evalbar", "nabla", "infty", "ln", "log",
  "exp", "sin", "cos", "tan",
];

// Package shorthands stay available through the candidates and raw LaTeX; the toolbar shows each template once,
// in its primitive form (more compact, and every visible placeholder is a direct caret stop).
const hiddenToolbarCommandIds = new Set([
  "time-ordering",
  "shortcut-bra",
  "shortcut-ket",
  "shortcut-expval",
  "shortcut-comm",
  "shortcut-acomm",
  "shortcut-braket",
  "shortcut-ketbra",
  "shortcut-mel",
]);

function groupItems(id: CommandCategory, catalogue: readonly Command[]): ToolbarItem[] {
  const byId = new Map(catalogue.map((command) => [command.id, command]));
  const ids =
    id === "common" ? COMMON_COMMAND_IDS
    : id === "calculus" ? CALCULUS_COMMAND_IDS
    : catalogue
        .filter((command) => command.category === id && !hiddenToolbarCommandIds.has(command.id))
        .map((command) => command.id);
  const commands = [...new Set(ids)].flatMap((commandId): ToolbarItem[] => {
    const command = byId.get(commandId);
    return command ? [{ kind: "command", command }] : [];
  });
  return id === "matrix" ? [{ kind: "matrix" }, ...commands] : commands;
}

let groups: readonly ToolbarGroup[] | null = null;

/** The groups, made from the catalogue the first time they are asked for (the page hands it in when it starts). */
export function toolbarGroups(): readonly ToolbarGroup[] {
  groups ??= GROUP_ORDER.map((id) => ({
    id,
    labelZh: GROUP_LABELS[id].zh,
    labelEn: GROUP_LABELS[id].en,
    items: groupItems(id, kernelCompletionCatalogData),
  }));
  return groups;
}

/** The template buttons' size and padding (px). */
export const TOOLBAR_BUTTON_SIZE = 52;
export const TOOLBAR_BUTTON_PADDING = 2;

/** Commands whose button spans two grid columns. */
export const wideToolbarCommandIds = new Set([
  "shortcut-pb",
  "commutator",
  "anticommutator",
  "outerproduct",
  "physics-pmqty",
  "physics-bmqty",
  "physics-vmqty",
  "physics-spmqty",
  "physics-sbmqty",
  "physics-vev",
  "matrixelement",
  "expectation-operator",
  "matrix-dots",
  "diagonal-matrix",
  "augmented-matrix",
  "block-matrix",
]);

const toolbarPreviewById: Record<string, string> = {
  intplain: "\\int",
  int: "\\int_a^b",
  "iint-bounds": "\\iint_D^S",
  "iiint-bounds": "\\iiint_V^W",
  "oint-bounds": "\\oint_C^D",
  lineintegral: "\\int_C",
  iint: "\\iint_D",
  surfaceintegral: "\\iint_S",
  iiint: "\\iiint_V",
  volumeintegral: "\\iiint_V",
  oint: "\\oint_C",
  "closed-surface-integral": "\\oiint_S",
  "closed-volume-integral": "\\oiiint_V",
  sum: "\\sum_{i=1}^{n}",
  "sum-finite": "\\sum_{k=1}^{n}",
  series: "\\sum_{n=0}^{\\infty}",
  prod: "\\prod_{i=1}^{n}",
  "prod-finite": "\\prod_{k=1}^{n}",
  productseries: "\\prod_{n=1}^{\\infty}",
  coproduct: "\\coprod_{i=1}^{n}",
  "bigcap-limits": "\\bigcap_{i=1}^{n}",
  "bigcup-limits": "\\bigcup_{i=1}^{n}",
  "bigsqcup-limits": "\\bigsqcup_{i=1}^{n}",
  "bigvee-limits": "\\bigvee_{i=1}^{n}",
  "bigwedge-limits": "\\bigwedge_{i=1}^{n}",
  "bigodot-limits": "\\bigodot_{i=1}^{n}",
  "bigoplus-limits": "\\bigoplus_{i=1}^{n}",
  "bigotimes-limits": "\\bigotimes_{i=1}^{n}",
  "biguplus-limits": "\\biguplus_{i=1}^{n}",
  lim: "\\lim_{x\\to0}",
  "lim-infty": "\\lim_{x\\to\\infty}",
  "lim-left": "\\lim_{x\\to a^-}",
  "lim-right": "\\lim_{x\\to a^+}",
  derivative: "\\frac{\\mathrm{d}}{\\mathrm{d}x}",
  secondderivative: "\\frac{\\mathrm{d}^{2}}{\\mathrm{d}x^{2}}",
  "partialderivative-frac": "\\frac{\\partial}{\\partial x}",
  dd: "\\mathrm{d}",
  partialsecond: "\\frac{\\partial^{2}}{\\partial x^{2}}",
  mixedpartial: "\\frac{\\partial^{2}}{\\partial x\\partial y}",
  evalbar: "\\left.\\vphantom{F}\\right|_a^b",
  nabla: "\\nabla",
  ln: "\\ln",
  log: "\\log_a",
  exp: "\\exp",
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  "skewed-fraction": "{}^{a}\\!/\\!{}_{b}",
  cases: "\\begin{cases}a\\\\b\\end{cases}",
  "cases-three": "\\left\\{\\begin{array}{l}a\\\\b\\\\c\\end{array}\\right.",
  overbrace: "\\overbrace{a+b}",
  underbrace: "\\underbrace{a+b}",
  rowvector: "\\begin{bmatrix}a&b\\end{bmatrix}",
  colvector: "\\begin{bmatrix}a\\\\b\\end{bmatrix}",
  det: "\\det",
  trace: "\\operatorname{tr}",
  rank: "\\operatorname{rank}",
  transpose: "A^{\\mathsf{T}}",
  inverse: "A^{-1}",
  dotproduct: "\\bullet",
  "matrix-dots": "\\begin{bmatrix}a&\\cdots&b\\\\\\vdots&\\ddots&\\vdots\\\\c&\\cdots&d\\end{bmatrix}",
  "diagonal-matrix": "\\begin{bmatrix}a_1&0&\\cdots\\\\0&a_2&\\ddots\\\\\\vdots&\\ddots&a_n\\end{bmatrix}",
  "augmented-matrix": "\\left[\\begin{array}{cc|c}1&0&a\\\\0&1&b\\end{array}\\right]",
  "block-matrix": "\\begin{bmatrix}A&B\\\\C&D\\end{bmatrix}",
};

export const toolbarPreviewLatex = (command: Command) =>
  toolbarPreviewById[command.id] ?? command.preview;
