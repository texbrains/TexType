// The LaTeX adapter (latex-adapter.ts): array-like environments (matrix, cases, array, aligned, ...) built with
// TeX's \halign as amsmath builds them.
import type { LatexAdapter } from "./latex-adapter.ts";
import { MAX_DIMEN, decimalToScaled, scanDimen } from "./arith.ts";
import {
  DISPLAY_STYLE,
  INNER_NOAD,
  LEFT_NOAD,
  MathTypesetter,
  ORD_NOAD,
  RIGHT_NOAD,
  SCRIPT_SCRIPT_STYLE,
  SCRIPT_STYLE,
  STYLE_NODE,
  TEXT_STYLE,
  VCENTER_NOAD,
  boxField,
  mlistField,
  newNoad,
  type MItem,
  type Noad,
} from "./mlist.ts";
import {
  GLUE_NODE,
  HLIST_NODE,
  KERN_NODE,
  MATH_NODE,
  NORMAL,
  RULE_NODE,
  VLIST_NODE,
  A_LEADERS,
  FIL,
  FILL as FILL_ORDER,
  X_LEADERS,
  newKern,
  newNullBox,
  type BoxNode,
  type Node,
  type RuleNode,
} from "./nodes.ts";
import { EXACTLY, hpack, vpack, vpackage } from "./pack.ts";
import { VList, glue, halign, type AlignNoalign, type AlignRow, type VParams } from "./align.ts";
import { scalePermille } from "./spacing.ts";
import {
  ArrayColumn,
  ArrayMarks,
  ArrayPiece,
  AtomLike,
  BASE_CTX,
  CellWrapperLike,
  Ctx,
  PT,
  autoAlignPoint,
  specTokens,
  texScale,
  trimSpaces,
} from "./adapter-tables.ts";

/** LaTeX's \strutbox at 10pt: .7\baselineskip and .3\baselineskip. */
export function strutDims(ad: LatexAdapter): [number, number] {
  return [texScale(".7", 12 * PT), texScale(".3", 12 * PT)];
}

/** "$\relax <atoms>$" in an alignment cell: an independent text-style formula. */
export function cellFormula(ad: LatexAdapter, items: MItem[], a: AtomLike): Node[] {
  const ts = new MathTypesetter(ad.env);
  const h = ts.mlistToHlist(items, TEXT_STYLE, false);
  const on: Node = { type: MATH_NODE, width: 0, subtype: 0, tag: a };
  return [on, ...h, { ...on }];
}

export function hfil(ad: LatexAdapter, a: AtomLike): Node {
  return { type: GLUE_NODE, spec: glue(0, PT, 1), subtype: NORMAL, tag: a };
}

export function hskip(ad: LatexAdapter, w: number, a: AtomLike): Node {
  return { type: GLUE_NODE, spec: glue(w), subtype: NORMAL, tag: a };
}

/** A row's cells (a column a \multicolumn covers has no cell: empty here). */
export function rowCells(ad: LatexAdapter, row: (AtomLike[] | undefined)[]): { cells: AtomLike[][] } {
  return { cells: row.map((cell) => cell ?? []) };
}

/** \arrayrulewidth */
export function ruleWidth(ad: LatexAdapter): number {
  return ad.arrayParams.rulewidth ?? decimalToScaled(".4");
}

/** \doublerulesep */
export function doubleRuleSep(ad: LatexAdapter): number {
  return ad.arrayParams.doublerulesep ?? 2 * PT;
}

/** A length as written ("2pt", ".5em") in sp, em and ex of the text font; null if it is none. */
export function dimen(ad: LatexAdapter, text: string | undefined): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|px)$/.exec((text ?? "").trim());
  if (!m) return null;
  const rm = ad.textRoman();
  return scanDimen(m[1], m[2], { em: rm.param(6), ex: rm.param(5), px: 65781 });
}

/**
 * \renewcommand{\arraystretch}{1.5}, \def\arraystretch{1.5},
 * \setlength{\arraycolsep}{2pt} ... (an invisible kernel atom): the arrays
 * after it in its group use the value. False if the atom is none of them.
 */
export function arraySetting(ad: LatexAdapter, latex: string): boolean {
  const stretch = /^\\(?:renewcommand|def|newcommand|providecommand)\s*\{?\s*\\arraystretch\s*\}?\s*\{\s*(\d*\.?\d+)\s*\}$/.exec(latex.trim());
  if (stretch) {
    ad.arrayParams = { ...ad.arrayParams, stretch: stretch[1] };
    return true;
  }
  const length = /^\\setlength\s*\{?\s*\\(arraycolsep|tabcolsep|arrayrulewidth|doublerulesep|extrarowheight)\s*\}?\s*\{([^{}]*)\}$/.exec(latex.trim());
  const value = length ? ad.dimen(length[2]) : null;
  if (!length || value === null) return false;
  const key = ({ arraycolsep: "colsep", tabcolsep: "tabcolsep", arrayrulewidth: "rulewidth", doublerulesep: "doublerulesep", extrarowheight: "extrarowheight" } as const)[
    length[1] as "arraycolsep"
  ];
  ad.arrayParams = { ...ad.arrayParams, [key]: value };
  return true;
}

/** Row gap of \\[len] (kernel rowGaps entry) in sp; 0 if none. */
export function rowGap(ad: LatexAdapter, a: AtomLike, r: number): number {
  const g = a.rowGaps?.[r];
  if (!g) return 0;
  const v = typeof g === "object" ? g.dimension ?? 0 : Number(g);
  if (!v) return 0;
  const unit = typeof g === "object" ? g.unit ?? "pt" : "pt";
  return ad.dimenFromAtom({ type: "spacing", width: { dimension: v, unit }, branch: () => undefined });
}

/**
 * array.sty's \@mkpream (its rules as arydshln makes them): the column
 * templates of a specification, as pieces around each column's cell.
 */
export function mkpream(ad: LatexAdapter, spec: string): ArrayColumn[] {
  const out: (ArrayPiece | "&" | ArrayColumn)[] = [];
  let firstamp = true;
  let last = 4; // \@lastchclass
  let before: string[] = [];
  let lastColumn: ArrayColumn | null = null;
  let contentIndex = 0;
  const addamp = () => {
    if (firstamp) firstamp = false;
    else out.push("&");
  };
  const acol = () => out.push({ k: "acol" });
  // \@classx: before a column (or > and p/m/b)
  const classx = () => {
    if (last === 0 || last === 2) {
      acol();
      addamp();
      acol();
    } else if (last === 1) {
      addamp();
      acol();
    } else if (last === 4) {
      acol();
      firstamp = false;
    } else if (last === 5) addamp();
  };
  // \@classvi: before a rule or !{...}
  const classvi = () => {
    if (last === 0 || last === 2) acol();
    else if (last === 1) out.push({ k: "dbl" });
  };
  for (const t of specTokens(spec)) {
    switch (t.ch) {
      case "|":
      case ":": // arydshln
      case ";":
        classvi();
        out.push({ k: "rule", pattern: t.ch === "|" ? "solid" : t.ch === ";" ? t.arg ?? "" : "" });
        last = 1;
        break;
      case "!":
        classvi();
        out.push({ k: "content", src: t.arg ?? "", index: contentIndex++ });
        last = 1;
        break;
      case "@":
        out.push({ k: "content", src: t.arg ?? "", index: contentIndex++ });
        last = 5;
        break;
      case ">":
        classx();
        before.unshift(t.arg ?? ""); // \save@decl puts a later declaration first
        last = 3;
        break;
      case "<":
        lastColumn?.after.push(t.arg ?? "");
        last = 2;
        break;
      default: {
        // c, l, r, p{..}, m{..}, b{..}; anything else is `c' (\@preamerr 0)
        classx();
        const align = "lrpmb".includes(t.ch) ? (t.ch as ArrayColumn["align"]) : "c";
        lastColumn = { pre: [], align, width: t.arg, before, after: [], post: [] };
        before = [];
        out.push(lastColumn);
        last = 0;
      }
    }
  }
  if (last === 0 || last === 2) acol();
  const cols: ArrayColumn[] = [];
  let pieces: ArrayPiece[] = [];
  let column: ArrayColumn | null = null;
  const flush = () => {
    if (column) {
      column.post = pieces;
      cols.push(column);
    }
    column = null;
    pieces = [];
  };
  for (const x of out) {
    if (x === "&") flush();
    else if ("align" in x) {
      column = x;
      column.pre = pieces;
      pieces = [];
    } else pieces.push(x);
  }
  flush();
  return cols;
}

/**
 * The pieces of a template (\hskip\col@sep, \vline ...). `gaps`: the
 * kernel's atoms of the specification's @{...} and !{...}, in order.
 */
export function piece(ad: LatexAdapter, p: ArrayPiece, a: AtomLike, ctx: Ctx, colsep: number, gaps: AtomLike[][]): Node[] {
  const rw = ad.ruleWidth();
  switch (p.k) {
    case "acol":
      return [ad.hskip(colsep, a)]; // \hskip\col@sep
    case "rule":
      // arydshln: \vrule width\arrayrulewidth height0pt depth0pt; the rule is drawn over the rows (dashColumns)
      return [{ type: RULE_NODE, width: rw, height: 0, depth: 0, tag: a }];
    case "dbl":
      return [ad.hskip(ad.doubleRuleSep(), a)];
  }
  // @{...}, !{...}: \d@llarbegin ... \d@llarend
  const atoms = gaps[p.index];
  if (atoms && atoms.every((x) => typeof x?.branch === "function")) return ad.cellFormula(ad.list(atoms, ctx), a);
  // LaTeX's own specifications (cases: @{}l@{\quad}l@{})
  return ad.cellFormula(p.src.trim() === "\\quad" ? [ad.hskip(ad.textRoman().param(6), a) as MItem] : [], a);
}

/** A declaration in a >{...} or <{...}: a math style switch (others have no effect here). */
export function declStyle(ad: LatexAdapter, decl: string, a: AtomLike): MItem[] {
  const styles: Record<string, number> = {
    "\\displaystyle": DISPLAY_STYLE,
    "\\textstyle": TEXT_STYLE,
    "\\scriptstyle": SCRIPT_STYLE,
    "\\scriptscriptstyle": SCRIPT_SCRIPT_STYLE,
  };
  const out: MItem[] = [];
  for (const m of decl.matchAll(/\\[a-zA-Z]+/g)) if (styles[m[0]] !== undefined) out.push({ type: STYLE_NODE, style: styles[m[0]], tag: a });
  return out;
}

/**
 * A trailing \\ (an empty last row) adds no row in LaTeX; the editor keeps
 * it, since the caret of a line just started with Shift+Enter stands there.
 * Followed by rules (`\\ \hline` after it), it is a row in LaTeX too.
 */
export function dropsRow(ad: LatexAdapter, a: AtomLike, cells: AtomLike[][], r: number, count: number): boolean {
  return (
    !ad.editor &&
    !(a.bottomRules > 0) &&
    r === count - 1 &&
    r > 0 &&
    !cells.some((c, j) => c.some((x) => x.type !== "first") || a.getCellWrappers?.(r, j))
  );
}

/** arydshln's dash pattern ("4pt/2pt"; \dashlinedash/\dashlinegap, 4pt each, if empty; "solid": none). */
export function dashPattern(ad: LatexAdapter, pattern: string): [number, number] {
  if (pattern === "solid") return [0, 0];
  const [d, g] = pattern.split("/");
  return [ad.dimen(d) ?? 4 * PT, ad.dimen(g) ?? 4 * PT];
}

/**
 * arydshln's \adl@drawi: `half` dash, half gap, \xleaders of (half gap,
 * dash, half gap) over the rest, half gap, half dash; along a vertical
 * (`vertical`: a vlist `length` long) or horizontal line, rules `rw` thick.
 * A dash or gap of 0 makes a solid line.
 */
export function dashLine(ad: LatexAdapter, pattern: string, vertical: boolean, rw: number, a: AtomLike, length = 0): Node[] {
  const [d, g] = ad.dashPattern(pattern);
  const rule = (x: number): Node =>
    vertical ? { type: RULE_NODE, width: rw, height: x, depth: 0, tag: a } : { type: RULE_NODE, width: x, height: rw, depth: 0, tag: a };
  if (d <= 0 || g <= 0) {
    if (vertical) return [rule(length)];
    return [{ type: GLUE_NODE, spec: glue(0, PT, FILL_ORDER), subtype: A_LEADERS, leader: { type: RULE_NODE, width: 0, height: rw, depth: 0, tag: a }, tag: a }];
  }
  const hd = texScale(".5", d);
  const hg = texScale(".5", g);
  const unitList = [ad.hskip(hg, a), rule(d), ad.hskip(hg, a)];
  const unit = vertical ? vpack(unitList, a) : hpack(unitList, 0, undefined, a);
  const leaders: Node = { type: GLUE_NODE, spec: glue(0, PT, FIL, PT, FIL), subtype: X_LEADERS, leader: unit, tag: a };
  return [rule(hd), ad.hskip(hg, a), leaders, ad.hskip(hg, a), rule(hd)];
}

/** booktabs' and LaTeX's rule commands: the name and arguments of `\cmidrule[w](lr){2-3}`. */
export function parseRule(ad: LatexAdapter, src: string | undefined): { name: string; args: { kind: string; value: string }[] } {
  const m = /^\\[a-zA-Z]+/.exec(src ?? "");
  if (!m || src === undefined) return { name: "", args: [] };
  const args: { kind: string; value: string }[] = [];
  let i = m[0].length;
  while (i < src.length) {
    const open = src[i];
    const close = open === "[" ? "]" : open === "(" ? ")" : open === "{" ? "}" : "";
    if (!close) {
      i++;
      continue;
    }
    let depth = 0;
    let j = i + 1;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && depth > 0) depth--;
      else if (src[j] === close && depth === 0) break;
    }
    args.push({ kind: open, value: src.slice(i + 1, j) });
    i = j + 1;
  }
  return { name: m[0], args };
}

/** "2-3" of \cline, \cdashline, \cmidrule: the first column and the number of columns, within `ncols`. */
export function ruleColumns(ad: LatexAdapter, range: string | undefined, ncols: number): [number, number] {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(range ?? "");
  const from = Math.max(1, Math.min(m ? parseInt(m[1], 10) : 1, ncols));
  const to = Math.max(from, Math.min(m ? parseInt(m[2], 10) : ncols, ncols));
  return [from, to - from + 1];
}

/**
 * The rules between two rows, in order: \hline, \cline (latex.ltx with
 * array.sty's \doublerulesep), arydshln's \hdashline and \cdashline,
 * booktabs' rules and \addlinespace. Rows they add go to `marks.rows`, the
 * material arydshln's vertical lines cross to `marks.connect`, the gaps
 * they stop at to `marks.cut`.
 */
export function tableRules(ad: LatexAdapter, rules: readonly string[], a: AtomLike, ncols: number, items: (AlignRow | AlignNoalign)[], marks: ArrayMarks): void {
  const rw = ad.ruleWidth();
  const rm = ad.textRoman();
  const em = (f: string) => texScale(f, rm.param(6));
  const ex = (f: string) => texScale(f, rm.param(5));
  const vskip = (h: number, kind: "cut" | "connect" | null): AlignNoalign => ({
    kind: "noalign",
    apply: (v) => {
      const n = ad.hskip(h, a);
      if (kind) marks[kind].add(n);
      v.append(n);
    },
  });
  const hrule = (h: number, kind: "cut" | "connect"): AlignNoalign => ({
    kind: "noalign",
    apply: (v) => {
      const n: RuleNode = { type: RULE_NODE, width: -(2 ** 30), height: h, depth: 0, tag: a };
      marks[kind].add(n);
      v.appendRule(n);
    },
  });
  // a row of \omit'ed cells: the columns before `from` empty, then `list` over `span` columns
  const spanRow = (from: number, span: number, list: Node[], connect: boolean) => {
    const cells: Node[][] = from > 1 ? [[], list] : [list];
    const spans = from > 1 ? [from - 1, span] : [span];
    const row: AlignRow = { kind: "row", cells, spans, tag: a };
    if (connect) marks.rowsConnect.add(row);
    items.push(row);
  };
  const hfillRule = (h: number): Node => ({
    type: GLUE_NODE,
    spec: glue(0, PT, FILL_ORDER),
    subtype: A_LEADERS,
    leader: { type: RULE_NODE, width: 0, height: h, depth: 0, tag: a },
    tag: a,
  });
  const BOOKTABS = ["\\toprule", "\\midrule", "\\bottomrule", "\\cmidrule", "\\specialrule", "\\addlinespace"];
  let lastClass = 0; // booktabs' \@lastruleclass
  rules.forEach((src, i) => {
    const { name, args } = ad.parseRule(src);
    const next = ad.parseRule(rules[i + 1]).name;
    const opt = (kind: string, k = 0) => args.filter((x) => x.kind === kind)[k]?.value;
    switch (name) {
      case "\\hline":
      case "\\hdashline": {
        if (name === "\\hline") items.push(hrule(rw, "connect"));
        else spanRow(1, ncols, ad.dashLine(opt("[") ?? "", false, rw, a), true);
        // array.sty's \@xhline (arydshln's \adl@ixhline): \vskip\doublerulesep
        // before a \hline or \hdashline right after it (a space after
        // \hdashline[...] is a token \futurelet sees)
        if ((next === "\\hline" || next === "\\hdashline") && !(name === "\\hdashline" && /\]\s$/.test(src)))
          items.push(vskip(ad.doubleRuleSep(), "cut"));
        break;
      }
      case "\\cline":
      case "\\cdashline": {
        // \omit ... \leaders\hrule\@height\arrayrulewidth\hfill \cr \noalign{\vskip-\arrayrulewidth}
        const [from, span] = ad.ruleColumns(opt("{"), ncols);
        spanRow(from, span, name === "\\cline" ? [hfillRule(rw)] : ad.dashLine(opt("[") ?? "", false, rw, a), false);
        items.push(vskip(-rw, null));
        break;
      }
      case "\\toprule":
      case "\\midrule":
      case "\\bottomrule":
      case "\\specialrule":
      case "\\addlinespace": {
        const special = name === "\\specialrule";
        const width = special
          ? ad.dimen(opt("{", 0)) ?? 0
          : ad.dimen(opt("[")) ?? (name === "\\midrule" ? em(".05") : name === "\\addlinespace" ? 0 : em(".08"));
        const above = special ? ad.dimen(opt("{", 1)) ?? 0 : name === "\\toprule" ? 0 : ex(".4");
        const below = special
          ? ad.dimen(opt("{", 2)) ?? 0
          : name === "\\bottomrule"
            ? 0
            : name === "\\addlinespace"
              ? ad.dimen(opt("[")) ?? em(".5")
              : ex(".65");
        const thisClass = special || name === "\\addlinespace" ? 2 : 1;
        if (name !== "\\addlinespace") {
          // \@BTrule
          if (thisClass === 2 || lastClass === 0) items.push(vskip(above, "cut"));
          else if (lastClass === 1) items.push(vskip(ad.doubleRuleSep(), "cut"));
          items.push(hrule(width, "cut"));
        }
        // \@BTendrule
        lastClass = BOOKTABS.includes(next) ? thisClass : 0;
        if (lastClass !== 1) items.push(vskip(below, "cut"));
        break;
      }
      case "\\cmidrule": {
        const width = ad.dimen(opt("[")) ?? em(".03");
        const [from, span] = ad.ruleColumns(opt("{"), ncols);
        // \@setrulekerning: l and r trim by \cmidrulekern (.5em) or the length after them
        let kl = 0;
        let kr = 0;
        for (const m of (opt("(") ?? "").matchAll(/([lr])(?:\{([^}]*)\})?/g)) {
          const k = m[2] !== undefined ? ad.dimen(m[2]) ?? 0 : em(".5");
          if (m[1] === "l") kl = k;
          else kr = k;
        }
        if (lastClass === 0) items.push(vskip(ex(".4"), "cut"));
        spanRow(from, span, [ad.hskip(kl, a), hfillRule(width), newKern(0, a), ad.hskip(kr, a)], false);
        // \@xcmidrule
        if (next === "\\cmidrule") {
          items.push(vskip(-width, "cut"));
          lastClass = 1;
        } else if (next === "\\morecmidrules") {
          items.push(vskip(ad.doubleRuleSep(), "cut"));
          lastClass = 1;
        } else {
          items.push(vskip(ex(".65"), "cut"));
          lastClass = 0;
        }
        break;
      }
    }
  });
}

/**
 * multirow.sty's \multirow[vpos]{n}[bigstruts]{width}[vmove]{text}: an
 * \hbox{\strut text\strut} (or a paragraph `width` wide) in a box of no
 * height and depth, moved to the middle (top, bottom) of the n rows from
 * this one (n < 0: up to this one); `arH`, `arD`: \@arstrutbox.
 */
export function multirowBox(ad: LatexAdapter, w: Extract<CellWrapperLike, { command: "\\multirow" }>, content: Node[], arH: number, arD: number, a: AtomLike): BoxNode {
  const [sh, sd] = ad.strutDims();
  const strut = (): Node => ({ type: RULE_NODE, width: 0, height: sh, depth: sd, tag: a });
  const width = w.width.trim() === "*" || w.width.trim() === "=" ? null : ad.dimen(w.width);
  const line = width === null ? hpack([strut(), ...content, strut()], 0, undefined, a) : hpack([strut(), ...content, strut(), ad.hfil(a)], width, EXACTLY, a);
  const vpos = (w.vpos ?? "c").trim();
  const n = (w.rows ?? "1").trim();
  const negative = n.startsWith("-");
  // \bigstrutjot (\jot) for each big strut, t and b ones at the ends
  const bs = /^(t?)(b?)(\d*)$/.exec((w.bigstruts ?? "0").trim());
  const jot = 3 * PT;
  const struts = bs ? parseInt(bs[3] || "0", 10) : 0;
  const total = Math.abs(texScale(negative ? n.slice(1) : n, arH)) + Math.abs(texScale(negative ? n.slice(1) : n, arD)) + struts * jot;
  const h = line.height;
  const d = line.depth;
  let dima: number;
  if (!negative) {
    if (vpos === "t") dima = h;
    else {
      dima = arH + (bs?.[1] ? jot : 0);
      if (vpos === "b") dima += arD + (bs?.[2] ? jot : 0);
    }
  } else {
    dima = total;
    if (vpos !== "b") {
      dima -= arD + (bs?.[2] ? jot : 0);
      if (vpos === "t") dima += -arH - (bs?.[1] ? jot : 0) + h;
    }
  }
  dima += ad.dimen(w.vmove) ?? 0;
  // \vtop to n rows {\vfill line \vfill}: t, the line first; b, the line last (its depth below)
  const margin = vpos === "t" ? 0 : vpos === "b" ? total - h : Math.round((total - h - d) / 2);
  line.shift = -dima + margin + h;
  const box = hpack([line], 0, undefined, a);
  box.height = 0;
  box.depth = 0;
  return box;
}

/** amsmath's \hdotsfor dots: \mkern-s\dotsspace@ \xleaders\hbox{$\mkern s\dotsspace@.\mkern s\dotsspace@$}\hfill \mkern-s\dotsspace@ */
export function hdots(ad: LatexAdapter, spacing: string | undefined, a: AtomLike): MItem[] {
  const s = texScale((spacing ?? "1").trim() || "1", texScale("1.5", PT)); // \dotsspace@ = 1.5mu
  const dot = ad.mathBox([ad.muKern(s, a), ad.mathChar(ad.data.meanings.mathcode["."], BASE_CTX, a), ad.muKern(s, a)], TEXT_STYLE, a);
  const leaders: Node = { type: GLUE_NODE, spec: glue(0, PT, FILL_ORDER), subtype: X_LEADERS, leader: dot, tag: a };
  return [ad.muKern(-s, a), leaders as MItem, ad.muKern(-s, a)];
}

/**
 * LaTeX's \array (array.sty's \@array; arydshln's dashed rules): returns the
 * \vcenter noad. `tabular`: its cells are text and \tabcolsep apart.
 */
export function latexArray(ad: LatexAdapter, a: AtomLike, spec: string, arraystretch: string, ctx: Ctx, cellStyle: number | null = null, tabular = false): Noad {
  const cols = ad.mkpream(spec);
  const params = ad.arrayParams;
  const [sh, sd] = ad.strutDims();
  // \arraystretch, times the user's row spacing
  const arH = scalePermille(texScale(arraystretch, sh + (params.extrarowheight ?? 0)), ad.arrayRowSep);
  const arD = scalePermille(texScale(arraystretch, sd), ad.arrayRowSep);
  const colsep = tabular ? params.tabcolsep ?? 6 * PT : scalePermille(params.colsep ?? 5 * PT, ad.arrayColSep);
  const gaps: AtomLike[][] = (a.colFormat ?? []).filter((c: any) => Array.isArray(c.gap)).map((c: any) => c.gap);
  const rw = ad.ruleWidth();
  const items: (AlignRow | AlignNoalign)[] = [];
  const marks: ArrayMarks = { connect: new WeakSet(), cut: new WeakSet(), rowsConnect: new WeakSet() };
  const dataRows = new WeakSet<AlignRow>();
  // arydshln's column rules: a box in each row that has one, filled once the rows are set
  const dashes: { holder: BoxNode; key: string; pattern: string; offset: number; row: AlignRow }[] = [];
  const rows: (AtomLike[] | undefined)[][] = a.rows ?? [];
  const rules: string[][] = a.rowRules ?? [];
  const strut = (): Node => ({ type: RULE_NODE, width: 0, height: arH, depth: arD, tag: a }); // \@arstrut
  rows.forEach((row, r) => {
    ad.tableRules(rules[r] ?? [], a, cols.length, items, marks);
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    const lists: Node[][] = [];
    const spans: number[] = [];
    const pending: { key: string; pattern: string; offset: number; holder: BoxNode }[] = [];
    let lastCell = -1;
    for (let j = 0; j < Math.min(row.length, cols.length); j++) if (row[j]) lastCell = j;
    for (let j = 0; j < Math.min(row.length, cols.length); j++) {
      const cell = row[j];
      if (!cell) continue;
      // a \multicolumn spans the columns after it it covers
      let span = 1;
      while (j + span < Math.min(row.length, cols.length) && !row[j + span]) span++;
      const wrappers: CellWrapperLike[] = a.getCellWrappers?.(r, j) ?? [];
      const multicolumn = wrappers.find((w) => w.command === "\\multicolumn" || w.command === "\\hdotsfor");
      const col = multicolumn ? ad.mkpream(multicolumn.command === "\\multicolumn" ? multicolumn.spec : "c")[0] ?? cols[j] : cols[j];
      const list: Node[] = [];
      if (j === 0 || multicolumn) list.push(strut());
      // arydshln draws a column's rules from its edge, \doublerulesep apart:
      // the k-th rule from the edge k\arrayrulewidth closer to it than its place
      const pieces = (side: "L" | "R", ps: ArrayPiece[]) => {
        const count = ps.filter((p) => p.k === "rule").length;
        let index = 0;
        for (const p of ps) {
          if (p.k !== "rule") {
            list.push(...ad.piece(p, a, ctx, colsep, gaps));
            continue;
          }
          const k = side === "L" ? index : count - 1 - index;
          index++;
          const holder: BoxNode = { type: HLIST_NODE, width: rw, height: 0, depth: 0, shift: 0, list: [], glueSet: 0, glueSign: 0, glueOrder: 0, tag: a };
          const key = `${side}${side === "L" ? j : j + span - 1}:${k}:${p.pattern}`;
          pending.push({ key, pattern: p.pattern, offset: side === "L" ? -k * rw : k * rw, holder });
          list.push(holder);
        }
      };
      pieces("L", col.pre);
      // the cell's formula ($...$; text in a tabular), with the >{...} and <{...} style switches
      let content: MItem[];
      const multirow = wrappers.find((w) => w.command === "\\multirow") as Extract<CellWrapperLike, { command: "\\multirow" }> | undefined;
      const visible = tabular ? trimSpaces(cell) : cell;
      if (multicolumn?.command === "\\hdotsfor") content = [...ad.hdots(multicolumn.spacing, a), ...ad.list(visible, ctx)];
      else if (multirow) content = [ad.boxNoad(ad.multirowBox(multirow, ad.cellFormula(ad.list(visible, ctx), a), arH, arD, a), a)];
      else content = ad.list(visible, ctx);
      const styles = [...(cellStyle === null ? [] : [{ type: STYLE_NODE, style: cellStyle, tag: a } as MItem]), ...col.before.flatMap((x) => ad.declStyle(x, a))];
      const formula = ad.cellFormula([...styles, ...content, ...col.after.flatMap((x) => ad.declStyle(x, a))], a);
      // \\[len]: \do@row@strut in the last cell
      const gap = ad.rowGap(a, r);
      const rowStrut: Node[] =
        j === lastCell && (r < rows.length - 1 || a.bottomRules > 0) && gap > 0 ? [{ type: RULE_NODE, width: 0, height: 0, depth: arD + gap, tag: a }] : [];
      if (col.align === "p" || col.align === "m" || col.align === "b") {
        // \@startpbox{w} (\everypar strut, \parindent 0) ... \@finalstrut\@arstrutbox \par \@endpbox\hfil:
        // one line of the paragraph (no line breaking)
        const w = ad.dimen(col.width) ?? 0;
        const lineBox = hpack(
          [{ type: RULE_NODE, width: 0, height: arH, depth: 0, tag: a }, ...formula, { type: RULE_NODE, width: 0, height: 0, depth: arD, tag: a }, ad.hfil(a)],
          w,
          EXACTLY,
          a,
        );
        // m: arydshln's \adl@startmbox, $\vcenter{...}$
        let pbox: BoxNode = lineBox;
        if (col.align === "m") {
          const vc = newNoad(VCENTER_NOAD, a);
          vc.nucleus = boxField(vpack([lineBox], a));
          pbox = ad.mathBox([vc], TEXT_STYLE, a);
        }
        list.push(pbox, ...rowStrut, ad.hfil(a));
      } else {
        if (col.align !== "l") list.push(ad.hfil(a));
        list.push(...formula, ...rowStrut);
        if (col.align !== "r") list.push(ad.hfil(a));
      }
      pieces("R", col.post);
      lists.push(list);
      spans.push(span);
    }
    const item: AlignRow = { kind: "row", cells: lists, spans, tag: a };
    dataRows.add(item);
    items.push(item);
    for (const p of pending) dashes.push({ ...p, row: item });
    const gap = ad.rowGap(a, r);
    if (gap < 0 && (r < rows.length - 1 || a.bottomRules > 0))
      items.push({
        kind: "noalign",
        apply: (v) => {
          const n = ad.hskip(gap, a);
          marks.connect.add(n);
          v.append(n);
        },
      });
  });
  // the rules under the last row's \\ (kernel rowRules' last entry)
  ad.tableRules(rules[rows.length] ?? [], a, cols.length, items, marks);
  const v = new VList({ baselineskip: glue(0), lineskip: glue(0), lineskiplimit: 0 }, a);
  const rowBoxes = halign(items, [glue(0)], v, a);
  if (dashes.length > 0) ad.dashColumns(v.items, items, rowBoxes, dataRows, marks, dashes, rw, a);
  const box = vpack(v.items, a);
  box.role = "array";
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(box);
  return vc;
}

/**
 * arydshln's \adl@makevlr: each column rule runs down the rows that have
 * it, through the rules (\hline, \hdashline) between them, and stops at a
 * double rule's gap or a row without it; a dashed one's dashes are spread
 * over that length. Each line goes into the box of its first row.
 */
export function dashColumns(ad: LatexAdapter, vitems: Node[], items: (AlignRow | AlignNoalign)[], rowBoxes: BoxNode[], dataRows: WeakSet<AlignRow>, marks: ArrayMarks, dashes: { holder: BoxNode; key: string; pattern: string; offset: number; row: AlignRow }[], rw: number, a: AtomLike): void {
  const rowOf = new Map<Node, AlignRow>();
  items.filter((x): x is AlignRow => x.kind === "row").forEach((row, i) => rowOf.set(rowBoxes[i], row));
  type Seg = { kind: "row" | "connect" | "cut" | "none"; top: number; h: number; row?: AlignRow; box?: BoxNode };
  const segs: Seg[] = [];
  let y = 0;
  for (const n of vitems) {
    let h = 0;
    if (n.type === HLIST_NODE || n.type === VLIST_NODE || n.type === RULE_NODE) h = n.height + n.depth;
    else if (n.type === GLUE_NODE) h = n.spec.width;
    else if (n.type === KERN_NODE) h = n.width;
    const row = rowOf.get(n);
    const kind = row && dataRows.has(row) ? "row" : (row && marks.rowsConnect.has(row)) || marks.connect.has(n) ? "connect" : marks.cut.has(n) ? "cut" : "none";
    segs.push({ kind, top: y, h, row, box: row ? (n as BoxNode) : undefined });
    y += h;
  }
  const keys = new Map<string, Map<AlignRow, { holder: BoxNode; pattern: string; offset: number }>>();
  for (const d of dashes) {
    if (!keys.has(d.key)) keys.set(d.key, new Map());
    keys.get(d.key)!.set(d.row, d);
  }
  type Start = { top: number; holder: BoxNode; pattern: string; offset: number; baseline: number };
  for (const byRow of keys.values()) {
    const open: Start[] = [];
    let lastconn = 0;
    const emit = (end: number) => {
      const start = open.pop();
      if (!start) return;
      const length = end - start.top;
      const line = vpackage(ad.dashLine(start.pattern, true, rw, a, length), length, EXACTLY, MAX_DIMEN, a);
      line.shift = start.top - start.baseline + line.height;
      start.holder.list.push(newKern(start.offset, a), line, newKern(-start.offset - rw, a));
    };
    for (const s of segs) {
      if (s.kind === "row") {
        const d = byRow.get(s.row!);
        if (d && open.length === 0) open.push({ top: s.top - lastconn, holder: d.holder, pattern: d.pattern, offset: d.offset, baseline: s.top + s.box!.height });
        else if (!d) emit(s.top);
        lastconn = 0;
      } else if (s.kind === "cut") {
        emit(s.top);
        lastconn = 0;
      } else if (s.kind === "connect") lastconn = s.h;
    }
    emit(y);
  }
}

/** A tabular in text (\text{\begin{tabular}...}): \hbox{$\vcenter{...}$} at a text size. */
export function tabularBox(ad: LatexAdapter, a: AtomLike): BoxNode {
  const spec = a.colSpec ?? "c";
  return ad.mathBox([ad.latexArray(a, spec, ad.arrayParams.stretch ?? "1", BASE_CTX, null, true)], TEXT_STYLE, a);
}

export function leftRightWrap(ad: LatexAdapter, a: AtomLike, left: string, right: string, body: MItem[]): Noad {
  const l = newNoad(LEFT_NOAD, a);
  l.delim = ad.delimiter(left);
  const rr = newNoad(RIGHT_NOAD, a);
  rr.delim = ad.delimiter(right);
  const inner = newNoad(INNER_NOAD, a);
  inner.nucleus = mlistField([l, ...body, rr]);
  return inner;
}

/** \null: an empty \hbox (an ord noad in math). */
export function nullBox(ad: LatexAdapter, a: AtomLike): Noad {
  return ad.boxNoad(newNullBox(a), a);
}

export function arrayEnv(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const env: string = a.environmentName ?? "matrix";
  const acs = scalePermille(ad.arrayParams.colsep ?? 5 * PT, ad.arrayColSep); // \arraycolsep
  const delims: Record<string, [string, string]> = {
    pmatrix: ["(", ")"],
    bmatrix: ["[", "]"],
    Bmatrix: ["\\lbrace", "\\rbrace"],
    vmatrix: ["\\lvert", "\\rvert"],
    Vmatrix: ["\\lVert", "\\rVert"],
  };
  switch (env) {
    case "matrix":
    case "pmatrix":
    case "bmatrix":
    case "Bmatrix":
    case "vmatrix":
    case "Vmatrix": {
      // \env@matrix: \hskip-\arraycolsep \array{*\c@MaxMatrixCols c} ... \endarray\hskip-\arraycolsep
      const body: MItem[] = [ad.hskip(-acs, a) as MItem, ad.latexArray(a, "*{10}{c}", ad.arrayParams.stretch ?? "1", ctx), ad.hskip(-acs, a) as MItem];
      const d = delims[env];
      return d ? [ad.leftRightWrap(a, d[0], d[1], body)] : body;
    }
    case "cases": {
      // \left\lbrace \def\arraystretch{1.2} \array{@{}l@{\quad}l@{}} ... \right.
      const arr = ad.latexArray(a, "@{}l@{\\quad}l@{}", "1.2", ctx);
      return [ad.leftRightWrap(a, "\\lbrace", ".", [arr])];
    }
    case "dcases":
    case "rcases":
    case "drcases":
    case "cases*":
    case "dcases*":
    case "rcases*":
    case "drcases*":
      return ad.mathtoolsCases(a, env, ctx);
    case "matrix*":
    case "pmatrix*":
    case "bmatrix*":
    case "Bmatrix*":
    case "vmatrix*":
    case "Vmatrix*": {
      // mathtools \MT_matrix_begin:N: \hskip-\arraycolsep \array{*\c@MaxMatrixCols #1} with one alignment
      const align = /^\[\s*([lcr])\s*\]/.exec(a.environmentArguments ?? "")?.[1] ?? "c";
      const body: MItem[] = [ad.hskip(-acs, a) as MItem, ad.latexArray(a, `*{10}{${align}}`, "1", ctx), ad.hskip(-acs, a) as MItem];
      const d = delims[env.slice(0, -1)];
      return d ? [ad.leftRightWrap(a, d[0], d[1], body)] : body;
    }
    case "subarray":
      return [ad.subarray(a, ctx, (a.colFormat ?? []).find((c: any) => c.align)?.align === "l" ? "l" : "c")];
    case "align":
    case "align*":
    case "flalign":
    case "flalign*":
    case "alignat":
    case "alignat*":
    case "eqnarray":
    case "eqnarray*":
    case "gather":
    case "gather*":
    case "multline":
    case "multline*":
    case "equation":
    case "equation*":
    case "displaymath":
      return ad.displayEnv(a, env.replace(/\*$/, ""), ctx);
    case "array": {
      // the column specification as written (kernel colSpec)
      const spec =
        a.colSpec ??
        (a.colFormat ?? []).map((c: any) => (c.align ? c.align : c.separator === "solid" ? "|" : c.separator === "dashed" ? ":" : "")).join("");
      return [ad.latexArray(a, spec || "c", ad.arrayParams.stretch ?? "1", ctx)];
    }
    case "tabular":
      return [ad.boxNoad(ad.tabularBox(a), a)];
    case "aligned":
    case "alignedat":
    case "split":
      return ad.alignedEnv(a, ctx, env === "alignedat");
    case "gathered":
      return ad.gatheredEnv(a, ctx);
    case "smallmatrix":
      return ad.smallMatrixEnv(a, ctx);
    default: {
      const body: MItem[] = [ad.hskip(-acs, a) as MItem, ad.latexArray(a, "*{10}{c}", ad.arrayParams.stretch ?? "1", ctx), ad.hskip(-acs, a) as MItem];
      return body;
    }
  }
}

/** amsmath \strut@ box (\strutbox@ with \normallineskiplimit = 0). */
export function amsStrut(ad: LatexAdapter, a: AtomLike): BoxNode {
  const [sh, sd] = ad.strutDims();
  const strut = hpack([{ type: RULE_NODE, width: 0, height: sh, depth: sd, tag: a }], 0, undefined, a);
  const vb = vpack([newKern(0, a), strut], a);
  return hpack([vb], 0, undefined, a);
}

/** \spread@equation (\openup\jot) applied to LaTeX's 12/1/0pt (\jot = 3pt, times the user's row spacing). */
export function spreadParams(ad: LatexAdapter): VParams {
  const jot = scalePermille(3 * PT, ad.alignRowSep);
  return { baselineskip: glue(12 * PT + jot), lineskip: glue(PT + jot), lineskiplimit: jot };
}

/** amsmath aligned / alignedat (\start@aligned). */
export function alignedEnv(ad: LatexAdapter, a: AtomLike, ctx: Ctx, alignedat: boolean): MItem[] {
  const alignsep = alignedat ? 0 : 10 * PT; // \minalignsep
  const rows: AtomLike[][][] = a.rows ?? [];
  const items: (AlignRow | AlignNoalign)[] = [];
  rows.forEach((row, r) => {
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    // TexType: a row typed without an alignment point lines up at its first relation (autoAlignPoint)
    const auto = alignedat ? null : autoAlignPoint(a, r, cells);
    const lists: Node[][] = cells.map((cell, j) => {
      if (auto && j < 2) {
        const visible = cells[1].filter((x) => x.type !== "first");
        if (j === 0) {
          // the material before the relation; the empty first cell's start (where its caret stands) a box outside
          // the formula, so it changes no spacing
          const start = newNullBox();
          start.firstTag = cells[0][0];
          const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad(ad.list(visible.slice(0, auto.at), ctx), a)], a);
          return [ad.hfil(a), ad.amsStrut(a), ...(cells[0][0]?.type === "first" ? [start] : []), ...f];
        }
        const empty = newNoad(ORD_NOAD, a);
        empty.nucleus = mlistField([]);
        const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad([empty, ...ad.list(visible.slice(auto.at), ctx)], a)], a);
        return [...f, ad.hfil(a)];
      }
      if (j % 2 === 0) {
        // &\column@plus \hfil \strut@ $\m@th\displaystyle{##}$ \tabskip\z@skip
        const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad(ad.list(cell, ctx), a)], a);
        return [ad.hfil(a), ad.amsStrut(a), ...f];
      }
      // &\column@plus $\m@th\displaystyle{{}##}$ \hfil \tabskip\alignsep@
      const empty = newNoad(ORD_NOAD, a);
      empty.nucleus = mlistField([]);
      const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad([empty, ...ad.list(cell, ctx)], a)], a);
      return [...f, ad.hfil(a)];
    });
    // \math@cr@@@aligned: an even number of fields gets "&\kern-\alignsep@"
    if (!alignedat && r < rows.length - 1 && lists.length % 2 === 0) lists.push([newKern(-alignsep, a)]);
    items.push({ kind: "row", cells: lists, tag: a });
    const gap = ad.rowGap(a, r);
    if (gap !== 0 && r < rows.length - 1) items.push({ kind: "noalign", apply: (v) => v.append(ad.hskip(gap, a)) });
  });
  const tabskips: ReturnType<typeof glue>[] = [glue(0)];
  const maxCols = Math.max(1, ...items.map((it) => (it.kind === "row" ? it.cells.length : 0)));
  for (let j = 0; j < maxCols; j++) tabskips.push(j % 2 === 0 ? glue(0) : glue(alignsep));
  const v = new VList(ad.spreadParams(), a);
  halign(items, tabskips, v, a);
  const box = vpack(v.items, a);
  box.role = "array";
  return [ad.nullBox(a), ad.positioned(box, a)];
}

/** amsmath gathered */
export function gatheredEnv(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const rows: AtomLike[][][] = a.rows ?? [];
  const items: (AlignRow | AlignNoalign)[] = [];
  rows.forEach((row, r) => {
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ...ad.list(cells[0], ctx)], a);
    items.push({ kind: "row", cells: [[ad.hfil(a), ad.amsStrut(a), ...f, ad.hfil(a)]], tag: a });
  });
  const v = new VList(ad.spreadParams(), a);
  halign(items, [glue(0)], v, a);
  const box = vpack(v.items, a);
  return [ad.nullBox(a), ad.positioned(box, a)];
}

export function findAtom(ad: LatexAdapter, atoms: AtomLike[] | undefined, pred: (x: AtomLike) => boolean): AtomLike | null {
  for (const x of atoms ?? []) {
    if (pred(x)) return x;
    for (const b of ["body", "above", "below"]) {
      const r = ad.findAtom(x.branch?.(b), pred);
      if (r) return r;
    }
  }
  return null;
}

/** amsmath subarray (used by \\substack): script-style rows in a \\vcenter. */
export function subarray(ad: LatexAdapter, a: AtomLike, ctx: Ctx, align: "c" | "l"): Noad {
  const sy = ad.fams.get(2)![1]!; // \\scriptfont2
  const ex = ad.fams.get(3)![1]!; // \\scriptfont3
  const bls = sy.param(10) + sy.param(12);
  const ls = 3 * ex.param(8);
  const rows: AtomLike[][][] = a.rows ?? [];
  const items: (AlignRow | AlignNoalign)[] = [];
  rows.forEach((row, r) => {
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    const f = ad.cellFormula([{ type: STYLE_NODE, style: SCRIPT_STYLE, tag: a }, ...ad.list(cells[0], ctx)], a);
    items.push({ kind: "row", cells: [[...(align === "c" ? [ad.hfil(a)] : []), ...f, ad.hfil(a)]], tag: a });
  });
  const v = new VList({ baselineskip: glue(bls), lineskip: glue(ls), lineskiplimit: ls }, a);
  halign(items, [glue(0)], v, a);
  const box = vpack(v.items, a);
  box.role = "array";
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(box);
  return vc;
}

/** amsmath smallmatrix */
export function smallMatrixEnv(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const ex = PT; // \ex@ at 10pt
  const rows: AtomLike[][][] = a.rows ?? [];
  const items: (AlignRow | AlignNoalign)[] = [];
  const thick = texScale(".2777", ad.textRoman().param(6));
  rows.forEach((row, r) => {
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    const lists = cells.map((cell, j) => {
      const f = ad.cellFormula([{ type: STYLE_NODE, style: SCRIPT_STYLE, tag: a }, ...ad.list(cell, ctx)], a);
      return j === 0 ? [ad.hfil(a), ...f, ad.hfil(a)] : [newKern(thick, a), ad.hfil(a), ...f, ad.hfil(a)];
    });
    items.push({ kind: "row", cells: lists, tag: a });
  });
  const ls = texScale("1.5", ex);
  const v = new VList({ baselineskip: glue(6 * ex), lineskip: glue(ls), lineskiplimit: ls }, a);
  halign(items, [glue(0)], v, a);
  const box = vpack(v.items, a);
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(box);
  return [ad.nullBox(a), ad.muGlue(3 * PT, a), vc, ad.muGlue(3 * PT, a)];
}
