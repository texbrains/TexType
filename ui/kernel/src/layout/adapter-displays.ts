// The LaTeX adapter (latex-adapter.ts): display environments (equation, align, gather, multline, ...) and
// their tags.
import type { LatexAdapter } from "./latex-adapter.ts";
import { div } from "./arith.ts";
import {
  DISPLAY_STYLE,
  ORD_NOAD,
  STYLE_NODE,
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
  NORMAL,
  RULE_NODE,
  VLIST_NODE,
  newKern,
  type BoxNode,
  type Node,
  type Tag,
} from "./nodes.ts";
import { EXACTLY, hpack, vpack } from "./pack.ts";
import { VList, glue, halign, type AlignNoalign, type AlignRow } from "./align.ts";
import { scalePermille } from "./spacing.ts";
import {
  AtomLike,
  Ctx,
  DisplayLine,
  PT,
  isIntertextAtom,
  isTagAtom,
  texScale,
  trimText,
} from "./adapter-tables.ts";

/**
 * TexType: the editor has no line width. Where amsmath spreads a display
 * over \displaywidth (the space between align's column pairs, flalign,
 * multline, the place of an equation tag) the display is set as in an
 * article's \textwidth at 10pt (345pt); without tags the outer margins of
 * align and alignat are dropped, so the formula starts at its first column.
 */
export function displayWidth(ad: LatexAdapter): number {
  return 345 * PT;
}

/** amsmath \mintagsep: .5\fontdimen6\textfont2 */
export function minTagSep(ad: LatexAdapter): number {
  return texScale(".5", ad.fams.get(2)![0]!.param(6));
}

/** \jot, times the user's row spacing */
export function jot(ad: LatexAdapter): number {
  return scalePermille(3 * PT, ad.alignRowSep);
}

/** amsmath \tagform@ / \maketag@@@ in \setboxz@h{\@lign\strut@{...}}: \hbox{\normalfont (#1)}, or #1 for \tag*. */
export function tagBox(ad: LatexAdapter, a: AtomLike, ctx: Ctx): BoxNode {
  // \ignorespaces #1\unskip
  const body = ad.textModeBox(trimText(a.branch("body") ?? [], true), ctx, a);
  if (a.command === "\\tag*") return hpack([ad.amsStrut(a), body], 0, undefined, a);
  const paren = (ch: string): BoxNode => {
    const b = ad.textRunBox([{ type: "mord", mode: "text", value: ch, style: (a.branch("body") ?? []).find((x) => x.mode === "text")?.style, branch: () => undefined }], 0);
    for (const n of b.list) (n as { tag?: Tag }).tag = a;
    b.tag = a;
    return b;
  };
  return hpack([ad.amsStrut(a), paren("("), body, paren(")")], 0, undefined, a);
}

/** A display's single line with its \tag (amsmath \calc@shift@gather, tags on the right). */
export function taggedDisplay(ad: LatexAdapter, atoms: AtomLike[], tag: AtomLike, ctx: Ctx): Noad {
  const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: undefined }, ...ad.list(atoms, ctx)], tag);
  const line = ad.gatherLines([{ list: f, tag: ad.tagBox(tag, ctx) }]);
  return ad.boxNoad(line[0], undefined);
}

/**
 * gather / equation lines: each centred in the display width, its tag at the
 * right end (amsmath \calc@shift@gather, \place@tag@gather). Without tags
 * the lines are centred on the widest.
 */
export function gatherLines(ad: LatexAdapter, lines: { list: Node[]; tag: BoxNode | null }[]): BoxNode[] {
  const hfil = (): Node => ({ type: GLUE_NODE, spec: glue(0, PT, 1), subtype: NORMAL });
  const widths = lines.map((l) => hpack(l.list).width);
  const tagged = lines.some((l) => l.tag);
  const sep = ad.minTagSep();
  let d = Math.max(0, ...widths);
  if (tagged) d = Math.max(ad.displayWidth(), ...lines.map((l, i) => widths[i] + (l.tag ? 2 * sep + l.tag.width : 0)));
  return lines.map((l, i) => {
    if (!tagged) return hpack([hfil(), ...l.list, hfil()], d, EXACTLY);
    let shift = d - widths[i];
    if (l.tag && shift < 4 * l.tag.width) shift -= l.tag.width;
    shift = Math.max(0, div(shift, 2));
    return hpack([newKern(shift), ...l.list, hfil(), ...(l.tag ? [l.tag] : [])], d, EXACTLY);
  });
}

/** The lines of a display environment: its rows split at \intertext, each row's \tag taken out. */
export function displayLines(ad: LatexAdapter, a: AtomLike): DisplayLine[] {
  const out: DisplayLine[] = [];
  const rows: AtomLike[][][] = a.rows ?? [];
  const blank = (cells: AtomLike[][]) => cells.every((c) => c.every((x) => x.type === "first"));
  rows.forEach((row, r) => {
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    let cur: AtomLike[][] = [];
    let tag: AtomLike | null = null;
    for (const cell of cells) {
      let part: AtomLike[] = [];
      for (const x of cell) {
        if (isIntertextAtom(x)) {
          // amsmath: \ifvmode\else\\\@empty\fi \noalign{...}: it ends the row it stands in
          if (!blank([...cur, part]) || tag) {
            out.push({ kind: "row", cells: [...cur, part], tag, r });
            cur = [];
            part = [];
            tag = null;
          }
          out.push({ kind: "text", atom: x });
        } else if (isTagAtom(x)) tag ??= x;
        else part.push(x);
      }
      cur.push(part);
    }
    out.push({ kind: "row", cells: cur, tag, r });
  });
  return out;
}

/** \intertext / \shortintertext (mathtools \MT_intertext:): the text between \abovedisplayskip-sized gaps. */
export function intertextNoalign(ad: LatexAdapter, x: AtomLike, ctx: Ctx, lineskiplimit: number): AlignNoalign {
  const short = x.command === "\\shortintertext";
  // \abovedisplayskip = \belowdisplayskip = 10pt plus 2pt minus 5pt, \abovedisplayshortskip 0pt plus 3pt
  // (\belowdisplayshortskip in \MT_shortintertext: is not used); the short form adds 3pt on each side
  const skip = short ? 3 * PT : 10 * PT;
  return {
    kind: "noalign",
    apply: (v) => {
      v.append(ad.hskip(skip - lineskiplimit, x));
      v.appendBox(hpack([ad.textModeBox(x.branch("body"), ctx, x)], 0, undefined, x));
      v.append(ad.hskip(skip - lineskiplimit, x));
    },
  };
}

/**
 * amsmath's top-level displays (align, flalign, alignat, gather, multline,
 * equation) and LaTeX's eqnarray, laid out as a \vcenter: the editor's
 * display is the formula itself.
 */
export function displayEnv(ad: LatexAdapter, a: AtomLike, env: string, ctx: Ctx): MItem[] {
  const lines = ad.displayLines(a);
  const items: (AlignRow | AlignNoalign)[] = [];
  const tags = new Map<AlignRow, BoxNode>();
  const jot = ad.jot();
  const gapAfter = (r: number) => (r < (a.rows ?? []).length - 1 ? ad.rowGap(a, r) : 0);
  const display = (list: MItem[]) => ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad(list, a)], a);
  const lastRow = [...lines].reverse().find((l) => l.kind === "row") as DisplayLine | undefined;
  const noalign = (apply: (v: VList) => void): AlignNoalign => ({ kind: "noalign", apply });
  if (env === "gather" || env === "equation" || env === "displaymath" || env === "multline") {
    // one column: each line set to the display's width
    const multline = env === "multline";
    const gap = 10 * PT; // \multlinegap, \multlinetaggap
    const rows = lines.filter((l) => l.kind === "row") as Extract<DisplayLine, { kind: "row" }>[];
    // multline: the tag goes on the last line, wherever it was given
    const multlineTag = multline ? rows.find((l) => l.tag)?.tag ?? null : null;
    const sets: { list: Node[]; tag: BoxNode | null }[] = rows.map((l, i) => {
      const cell = l.cells.flat();
      if (!multline) {
        const tag = l.tag ? ad.tagBox(l.tag, ctx) : null;
        return { list: [ad.amsStrut(a), ...display(ad.list(cell, ctx))], tag };
      }
      // \hbox to\totwidth@{\hfil\strut@$\m@th\displaystyle{}##$\hfil}, the first line \hfilneg\hskip\multlinegap,
      // the last \hskip\multlinegap\hfilneg (\hskip\multlinetaggap and the tag when there is one)
      const empty = newNoad(ORD_NOAD, a);
      empty.nucleus = mlistField([]);
      const f = ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, empty, ...ad.list(cell, ctx)], a);
      const first = i === 0;
      const last = i === rows.length - 1;
      const tag = last && multlineTag ? ad.tagBox(multlineTag, ctx) : null;
      const list: Node[] = [first ? newKern(gap) : ad.hfil(a), ad.amsStrut(a), ...f];
      if (last) list.push(newKern(gap), ...(tag ? [tag] : []));
      else list.push(ad.hfil(a));
      if (first && last) list.splice(list.length - (tag ? 2 : 1), 0, ad.hfil(a));
      return { list, tag: null };
    });
    let boxes: BoxNode[];
    if (multline) {
      const d = Math.max(ad.displayWidth(), ...sets.map((s) => hpack(s.list).width));
      boxes = sets.map((s) => hpack(s.list, d, EXACTLY, a));
    } else boxes = ad.gatherLines(sets);
    const v = new VList(ad.spreadParams(), a);
    let k = 0;
    for (const l of lines) {
      if (l.kind === "text") {
        ad.intertextNoalign(l.atom, ctx, jot).apply(v);
        continue;
      }
      const b = boxes[k++];
      b.tag = undefined;
      v.appendBox(b);
      const g = l === lastRow ? 0 : gapAfter(l.r);
      if (g !== 0) v.append(ad.hskip(g, a));
    }
    return [ad.positioned(ad.displayBox(v), a)];
  }
  // column pairs (align, flalign, alignat) or eqnarray's three columns
  const eqnarray = env === "eqnarray";
  const minalignsep = 10 * PT;
  const acs = scalePermille(5 * PT, ad.arrayColSep); // \arraycolsep
  const rows: { line: Extract<DisplayLine, { kind: "row" }>; cells: Node[][] }[] = [];
  for (const l of lines) {
    if (l.kind !== "row") continue;
    const cells = l.cells.map((cell, j): Node[] => {
      if (eqnarray) {
        // \hskip\@centering$\displaystyle{##}$ & \hskip2\arraycolsep\hfil${##}$\hfil & \hskip2\arraycolsep$\displaystyle{##}$\hfil
        if (j === 0) return [ad.hfil(a), ...display(ad.list(cell, ctx))];
        const f = j === 1 ? ad.cellFormula([ad.groupNoad(ad.list(cell, ctx), a)], a) : display(ad.list(cell, ctx));
        return [ad.hskip(2 * acs, a), ...(j === 1 ? [ad.hfil(a)] : []), ...f, ad.hfil(a)];
      }
      // \align@preamble: \hfil\strut@$\m@th\displaystyle{##}$ & $\m@th\displaystyle{{}##}$\hfil
      if (j % 2 === 0) return [ad.hfil(a), ad.amsStrut(a), ...display(ad.list(cell, ctx))];
      const empty = newNoad(ORD_NOAD, a);
      empty.nucleus = mlistField([]);
      return [...display([empty, ...ad.list(cell, ctx)]), ad.hfil(a)];
    });
    rows.push({ line: l, cells });
  }
  let fields = Math.max(eqnarray ? 3 : 2, ...rows.map((r) => r.cells.length));
  if (!eqnarray && fields % 2 === 1) fields++;
  for (const r of rows) while (r.cells.length < fields) r.cells.push([]);
  const colW = new Array(fields).fill(0);
  for (const r of rows) r.cells.forEach((c, j) => (colW[j] = Math.max(colW[j], hpack(c).width)));
  const tot = colW.reduce((x, y) => x + y, 0);
  const tagBoxes = rows.map((r) => (r.line.tag ? ad.tagBox(r.line.tag, ctx) : null));
  const tagged = tagBoxes.some((t) => t);
  const maxTag = Math.max(0, ...tagBoxes.map((t) => t?.width ?? 0));
  const sep = ad.minTagSep();
  const w = ad.displayWidth();
  // amsmath \measure@: \eqnshift@ and \alignsep@ from \displaywidth - \totwidth@
  const pairs = fields / 2;
  let xat = env === "alignat" ? 0 : env === "align" ? 1 : pairs < 2 ? 0 : 2;
  if (eqnarray) xat = 0;
  let eqnshift = 0;
  let alignsep = 0;
  const room = w - tot - (tagged && xat === 2 ? maxTag + sep : 0);
  if (xat === 0) eqnshift = div(room, 2);
  else if (xat === 1) eqnshift = alignsep = div(room, pairs + 1);
  else alignsep = div(room, pairs - 1);
  if (xat !== 0 && alignsep < minalignsep) {
    alignsep = minalignsep;
    if (eqnshift > 0) eqnshift = div(w - tot - (pairs - 1) * alignsep, 2);
  }
  if (eqnshift < 0 || !tagged) eqnshift = 0;
  const tabskips = [glue(eqnshift)];
  for (let j = 0; j < fields; j++) tabskips.push(glue(!eqnarray && j % 2 === 1 && j < fields - 1 ? alignsep : 0));
  if (tagged) {
    const body = eqnshift + tot + (eqnarray ? 0 : (pairs - 1) * alignsep);
    const d = Math.max(w, body + sep + maxTag + (eqnarray ? eqnshift : 0));
    tabskips[fields] = glue(d - body - maxTag);
    tabskips.push(glue(0));
  }
  let k = 0;
  for (const l of lines) {
    if (l.kind === "text") {
      items.push(ad.intertextNoalign(l.atom, ctx, eqnarray ? 0 : jot));
      continue;
    }
    const r = rows[k];
    const tag = tagBoxes[k++];
    const row: AlignRow = { kind: "row", cells: tagged ? [...r.cells, tag ? [ad.hfil(a), tag] : []] : r.cells, tag: a };
    if (tag) tags.set(row, tag);
    items.push(row);
    const g = l === lastRow ? 0 : gapAfter(l.r);
    // eqnarray: \cr\noalign{\penalty\@eqpen\vskip\jot ...}
    if (eqnarray && l !== lastRow) items.push(noalign((v) => v.append(ad.hskip(jot + g, a))));
    else if (g !== 0) items.push(noalign((v) => v.append(ad.hskip(g, a))));
  }
  const v = new VList(eqnarray ? { baselineskip: glue(12 * PT), lineskip: glue(PT), lineskiplimit: 0 } : ad.spreadParams(), a);
  halign(items, tabskips, v, a);
  return [ad.positioned(ad.displayBox(v), a)];
}

export function displayBox(ad: LatexAdapter, v: VList): BoxNode {
  const box = vpack(v.items, v.tag);
  box.role = "array";
  return box;
}

/** amsmath \ams@start@box: \vtop for [t], \vbox for [b], else \vcenter. */
export function positioned(ad: LatexAdapter, box: BoxNode, a: AtomLike): Noad {
  const pos = /^\[\s*([tb])\s*\]/.exec(a.environmentArguments ?? "")?.[1];
  if (pos === "t") {
    // \vtop: the reference point moves to the baseline of the first box
    const first = box.list[0];
    const h = first && (first.type === HLIST_NODE || first.type === VLIST_NODE || first.type === RULE_NODE) ? (first as BoxNode).height : 0;
    box.depth = box.depth - h + box.height;
    box.height = h;
  }
  if (pos) return ad.boxNoad(box, a);
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(box);
  return vc;
}

/**
 * mathtools \MT_start_cases:nnnn (dcases, rcases, cases*, ...):
 * \left#4 \vcenter{\spread@equation \ialign{\strut@#2 & #1\strut@ #3}} \right#5
 */
export function mathtoolsCases(ad: LatexAdapter, a: AtomLike, env: string, ctx: Ctx): MItem[] {
  const displayStyle = env.startsWith("d");
  const right = env.includes("rcases");
  const text = env.endsWith("*");
  const rows: AtomLike[][][] = a.rows ?? [];
  const items: (AlignRow | AlignNoalign)[] = [];
  const quad = ad.textRoman().param(6);
  const formula = (cell: AtomLike[]) => ad.cellFormula(displayStyle ? [{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ...ad.list(cell, ctx)] : ad.list(cell, ctx), a);
  rows.forEach((row, r) => {
    const { cells } = ad.rowCells(row);
    if (ad.dropsRow(a, cells, r, rows.length)) return;
    const lists = cells.slice(0, 2).map((cell, j): Node[] => {
      if (j === 0) return [ad.amsStrut(a), ...formula(cell), ad.hfil(a)];
      return [ad.hskip(quad, a), ad.amsStrut(a), ...(text ? [ad.textModeBox(trimText(cell), ctx, a)] : formula(cell)), ad.hfil(a)];
    });
    items.push({ kind: "row", cells: lists, tag: a });
    const gap = ad.rowGap(a, r);
    if (gap !== 0 && r < rows.length - 1) items.push({ kind: "noalign", apply: (v) => v.append(ad.hskip(gap, a)) });
  });
  const v = new VList(ad.spreadParams(), a);
  halign(items, [glue(0)], v, a);
  const box = vpack(v.items, a);
  box.role = "array";
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(box);
  return [right ? ad.leftRightWrap(a, ".", "\\rbrace", [vc]) : ad.leftRightWrap(a, "\\lbrace", ".", [vc])];
}
