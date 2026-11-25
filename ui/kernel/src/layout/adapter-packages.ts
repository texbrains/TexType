// The LaTeX adapter (latex-adapter.ts): commands of further LaTeX packages (mathtools, cancel, stmaryrd, ...)
// built as their TeX code builds them.
import type { LatexAdapter } from "./latex-adapter.ts";
import { MAX_DIMEN, decimalToScaled } from "./arith.ts";
import {
  DISPLAY_STYLE,
  EMPTY,
  LEFT_NOAD,
  LIMITS,
  OP_NOAD,
  ORD_NOAD,
  REL_NOAD,
  SCRIPT_SCRIPT_STYLE,
  SCRIPT_STYLE,
  STYLE_NODE,
  TEXT_STYLE,
  VCENTER_NOAD,
  boxField,
  mlistField,
  newNoad,
  type Field,
  type MItem,
  type Noad,
} from "./mlist.ts";
import {
  GLUE_NODE,
  HLIST_NODE,
  NORMAL,
  RULE_NODE,
  VLIST_NODE,
  newCharacter,
  newKern,
  newNullBox,
  type BoxNode,
  type Node,
  type Tag,
} from "./nodes.ts";
import { EXACTLY, hpack, vpack, vpackage } from "./pack.ts";
import { VList, glue, halign, type AlignNoalign, type AlignRow } from "./align.ts";
import {
  ArrowFill,
  AtomLike,
  BASE_CTX,
  Ctx,
  PT,
  texScale,
} from "./adapter-tables.ts";

/**
 * Commands the kernel keeps as plain atoms named by their command (its
 * latex-commands/kernel-commands.ts): mathtools' brackets, cancel's
 * \cancelto, LaTeX's \fbox, \framebox and \hbox, \nobreak, tensor's indices.
 */
export function packageCommand(ad: LatexAdapter, a: AtomLike, ctx: Ctx, out: MItem[]): boolean {
  const cmd = a.command ?? "";
  switch (cmd) {
    case "\\leftroot":
    case "\\uproot":
      // only meaningful in a root's index (surd), where it is read
      return true;
    case "\\nobreak":
      out.push({ type: 12, penalty: 10000, tag: a } as Node);
      return true;
    case "\\overbracket":
    case "\\underbracket":
      if (a.branch("body") === undefined) return false;
      out.push(ad.bracket(a, ctx, cmd === "\\overbracket"));
      return true;
    case "\\cancelto":
      if (a.branch("body") === undefined) return false;
      out.push(ad.palette(a, (st) => ad.cancelTo(a, ctx, st)));
      return true;
    case "\\fbox":
      if (a.branch("body") === undefined) return false;
      out.push(ad.boxNoad(ad.frameBox(ad.textModeBox(a.branch("body"), ctx, a), 3 * PT, undefined, a), a));
      return true;
    case "\\framebox":
      if (a.branch("body") === undefined) return false;
      out.push(ad.boxNoad(ad.frameBoxTo(a, ctx), a));
      return true;
    case "\\hbox":
      if (a.branch("body") === undefined) return false;
      out.push(ad.boxNoad(ad.textModeBox(a.branch("body"), ctx, a), a));
      return true;
    case "\\indices":
    case "\\indices*":
      if (a.branch("body") === undefined) return false;
      ad.indices(a, ctx, out, cmd === "\\indices*");
      return true;
    case "\\vtxcearrow":
      out.push(ad.chemArrow(a, ctx));
      return true;
    case "\\vtxcellap":
      if (a.branch("body") === undefined) return false;
      out.push(ad.chemLlap(a, ctx));
      return true;
    case "\\vtxceminispace":
      out.push(ad.chemMinispace(a));
      return true;
    case "\\tensor":
    case "\\tensor*":
      if (a.branch("body") === undefined) return false;
      out.push(ad.palette(a, (st) => ad.tensor(a, ctx, st, cmd === "\\tensor*")));
      return true;
  }
  return false;
}

/** A kernel LatexValue argument (args[i]) in sp, or null when absent or not a dimension. */
export function argDimen(ad: LatexAdapter, a: AtomLike, i: number): number | null {
  const v = (a.args ?? [])[i] as { dimension?: number; unit?: string } | null | undefined;
  if (!v || typeof v !== "object" || v.dimension === undefined) return null;
  return ad.dimenFromAtom({ type: "spacing", width: v, branch: () => undefined });
}

/**
 * mathtools \overbracket[#1][#2]{#3}: \mathop{\vbox{\m@th\ialign{##\crcr
 * \downbracketfill{#1}{#2}\crcr\noalign{\kern.2\fontdimen5\textfont2\nointerlineskip}
 * $\hfil\displaystyle{#3}\hfil$\crcr}}}\limits; \underbracket the same
 * upside down in a \vtop. #1 defaults to the height of \braceld, #2 to
 * .7\fontdimen5\textfont2.
 */
export function bracket(ad: LatexAdapter, a: AtomLike, ctx: Ctx, over: boolean): Noad {
  const xheight = ad.env.famFnt(2, 0)!.param(5);
  const ld = ad.mathCodeOf("\\braceld", BASE_CTX) ?? 0x37a;
  const ldFont = ad.env.famFnt((ld >> 8) & 15, 0)!;
  const t = ad.argDimen(a, 0) ?? ldFont.charHeight(ldFont.charInfo(ld & 0xff));
  const h = ad.argDimen(a, 1) ?? texScale(".7", xheight);
  const RUNNING = -(2 ** 30);
  const rule = (width: number, height: number, depth: number): Node => ({ type: RULE_NODE, width, height, depth, tag: a });
  // \downbracketend: \vrule width #1 depth #2; \leaders\vrule height #1 depth 0pt\hfill
  // \upbracketend: \vrule height #2 width #1; \leaders\vrule height 0pt depth #1\hfill
  const end = () => (over ? rule(t, RUNNING, h) : rule(t, h, RUNNING));
  const leaders: Node = {
    type: GLUE_NODE,
    spec: glue(0, PT, 2),
    subtype: 100,
    leader: over ? rule(decimalToScaled(".4"), t, 0) : rule(decimalToScaled(".4"), 0, t),
    tag: a,
  } as Node;
  const fill: Node[] = [end(), leaders, end()];
  const content = (): Node[] =>
    ad.cellFormula([ad.hfil(a), { type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad(ad.list(a.branch("body"), ctx), a), ad.hfil(a)], a);
  const kern = ad.kernNoalign(texScale(".2", xheight), a, true);
  const items: (AlignRow | AlignNoalign)[] = over
    ? [{ kind: "row", cells: [fill] }, kern, { kind: "row", cells: [content()] }]
    : [{ kind: "row", cells: [content()] }, kern, { kind: "row", cells: [fill] }];
  const box = ad.ialignBox(items, a, !over);
  box.role = over ? "overbrace" : "underbrace";
  const op = newNoad(OP_NOAD, a);
  op.subtype = LIMITS;
  op.nucleus = boxField(box);
  return op;
}

/**
 * cancel.sty \cancelto{#1}{#2} (default "smaller" option): \mathchoice of
 * \@cancelto{value style}{#1}{style}{#2}, the expression with an arrow
 * (\vector) from its lower left to the value, set past its upper right.
 */
export function cancelTo(ad: LatexAdapter, a: AtomLike, ctx: Ctx, style: number): MItem[] {
  const valueStyle = style === DISPLAY_STYLE ? TEXT_STYLE : style === TEXT_STYLE ? SCRIPT_STYLE : SCRIPT_SCRIPT_STYLE;
  // \@begin@tempboxa\hbox{\m@th$#3{#4}$}
  const box0 = ad.mathBox(ad.styleList(style, a, [ad.groupNoad(ad.list(a.branch("body"), ctx), a)]), TEXT_STYLE, a);
  let dimen = Math.max(box0.width, 2 * PT);
  let totalheight = Math.max(box0.height + box0.depth, 4 * PT);
  let spec: string, dimb: number;
  if (totalheight < dimen) {
    // wide
    const cnta = Math.trunc((totalheight * 5) / dimen);
    dimb = 3 * PT;
    dimen += ([5, 5, 4, 3][cnta] ?? 2) * PT;
    dimen = Math.max(dimen, 9 * PT) + PT;
    spec = ["5441", "5441", "5421", "4443"][cnta] ?? "3611";
  } else {
    // tall
    totalheight += 3 * PT;
    const cnta = Math.trunc((dimen * 5) / totalheight);
    totalheight += 3 * PT;
    dimen = texScale([".25", ".25", ".5", ".75"][cnta] ?? "1", totalheight);
    dimb = texScale([".8", ".8", "1.2", "1.5"][cnta] ?? "2", PT);
    spec = ["0814", "0814", "1812", "2734"][cnta] ?? "3611";
  }
  // \dimen@\height \setbox\@tempboxa\hbox{$\m@th\vcenter{\box\@tempboxa}$} \advance\dimen@-\height
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(vpack([box0], a));
  const tempboxa = ad.mathBox([vc], TEXT_STYLE, a);
  const raise = box0.height - tempboxa.height;
  const [n1, n2, n3, n4] = [...spec].map(Number);
  // \canto@vector: \dimen@.5\p@ \setbox\z@\vbox{\boxmaxdepth.5\p@\hbox{\kern-1.2\p@\kern#1\dimen@$#7{#8}\m@th$}}
  const half = PT / 2;
  const valueBox = ad.mathBox(ad.styleList(valueStyle, a, [ad.groupNoad(ad.list(a.branch("above"), ctx), a)]), TEXT_STYLE, a);
  const zbox = vpackage([hpack([newKern(-texScale("1.2", PT), a), newKern(n1 * half, a), valueBox], 0, undefined, a)], 0, 1, half, a);
  zbox.width = 0; // \wd\z@\z@ (\canto@fil = \hidewidth)
  // \vcenter{\hbox{\dimen@#6\unitlength \kern\dimen@ \multiply\dimen@#4\divide\dimen@#3 \vrule\@depth\dimen@\@width\z@ \vector(#3,#4){#5}}}
  const arrowParts: Node[] = [newKern(dimb, a), { type: RULE_NODE, width: 0, height: -(2 ** 30), depth: Math.trunc((dimb * n4) / n3), tag: a } as Node];
  arrowParts.push(...ad.pictureSvector(n3, n4, dimen, a));
  const arrowVc = newNoad(VCENTER_NOAD, a);
  arrowVc.nucleus = boxField(vpack([hpack(arrowParts, 0, undefined, a)], a));
  // ^{\raise#2\dimen@\copy\z@\kern-\scriptspace}
  const raised: BoxNode = { ...zbox, shift: -n2 * half };
  arrowVc.sup = mlistField([ad.boxNoad(raised, a), newKern(-ad.env.scriptSpace, a) as unknown as MItem]);
  const hskip = (w: number, stretch = 0, order = NORMAL): Node => ({ type: GLUE_NODE, spec: { width: w, stretch, stretchOrder: order, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a });
  const hideskip = () => hskip(-1000 * PT, 65536, 2);
  const rows: (AlignRow | AlignNoalign)[] = [
    { kind: "row", cells: [[hideskip(), ...ad.cellFormula([arrowVc], a), hideskip()]] },
    { kind: "row", cells: [[hskip(0, 65536, 1), tempboxa, newKern(zbox.width, a), hskip(0, 65536, 1)]] },
  ];
  // \ooalign
  const ex = ad.textRoman().param(5);
  const v = new VList({ baselineskip: glue(0), lineskip: glue(texScale(".25", ex)), lineskiplimit: -MAX_DIMEN }, a);
  halign(rows, [glue(0)], v, a);
  const vtop = vpack(v.items, a);
  const first = vtop.list[0];
  const h = first && (first.type === HLIST_NODE || first.type === VLIST_NODE || first.type === RULE_NODE) ? (first as BoxNode).height : 0;
  vtop.depth = vtop.depth - h + vtop.height;
  vtop.height = h;
  const outer = hpack([vtop], 0, undefined, a);
  outer.shift = -raise;
  const inner = newNoad(ORD_NOAD, a);
  inner.nucleus = boxField(outer);
  return [ad.groupNoad([newKern(0, a) as unknown as MItem, inner], a)];
}

/** latex.ltx \vector(x,y){len} for x, y > 0 (\@svector): the \@sline and its arrowhead from line10. */
export function pictureSvector(ad: LatexAdapter, xarg: number, yarg: number, linelen: number, a: AtomLike): Node[] {
  // \vector: |x| must be below 5, else \@badlinearg (nothing drawn); \@svector: |y| below 5
  if (Math.abs(xarg) >= 5 || Math.abs(yarg) >= 5) return [];
  const { out, clnht, wd, raise } = ad.pictureSlineState(xarg, yarg, linelen, a);
  const f = ad.cache.get("line10");
  // \@getrarrow(#1,#2)
  const y = Math.abs(yarg);
  let c = y === 0 ? 45 : y === 1 ? (xarg < 3 ? xarg * 24 - 6 : xarg === 3 ? 49 : 58) : y === 2 ? (xarg < 3 ? xarg * 24 - 3 : 51) : y === 3 ? xarg * 16 - 2 : xarg * 16 + 7;
  if (yarg < 0) c += 64;
  out.push({ type: GLUE_NODE, spec: glue(-wd), subtype: NORMAL, tag: a } as Node);
  const head = hpack([newCharacter(f, c, a)], 0, undefined, a);
  head.shift = raise ? -clnht : clnht;
  out.push(head);
  return out;
}

/** latex.ltx \@iframebox[#1][#2]{#3}: the text in an \hbox to #1 between \fboxsep kerns, framed. */
export function frameBoxTo(ad: LatexAdapter, a: AtomLike, ctx: Ctx): BoxNode {
  const content = ad.textModeBox(a.branch("body"), ctx, a);
  const width = ad.argDimen(a, 0);
  if (width === null) return ad.frameBox(content, 3 * PT, undefined, a);
  const pos = String((a.args ?? [])[1] ?? "c").trim() || "c";
  const fboxsep = 3 * PT, fboxrule = decimalToScaled(".4");
  const hss = (): Node => ({ type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 1, shrink: PT, shrinkOrder: 1 }, subtype: NORMAL, tag: a });
  // \bm@c, \bm@l (t), \bm@r (b), \bm@s: \unhbox\@tempboxa with \hss around
  const inner: Node[] = [...content.list];
  const middle = pos === "l" || pos === "t" ? [...inner, hss()] : pos === "r" || pos === "b" ? [hss(), ...inner] : pos === "s" ? inner : [hss(), ...inner, hss()];
  const tempboxa = hpack([newKern(fboxsep, a), ...middle, newKern(fboxsep, a)], width, EXACTLY, a);
  // \@frameb@x{\kern-\fboxrule}
  const tempdima = fboxrule + fboxsep + tempboxa.depth;
  const vglue = (w: number): Node => ({ type: GLUE_NODE, spec: { width: w, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a });
  const innerV = vpackage([vglue(fboxsep), tempboxa, vglue(fboxsep)], 0, undefined, undefined, a);
  const vrule = (): Node => ({ type: RULE_NODE, width: fboxrule, height: -(2 ** 30), depth: -(2 ** 30), tag: a });
  const hrule = (): Node => ({ type: RULE_NODE, width: -(2 ** 30), height: fboxrule, depth: 0, tag: a });
  const mid = hpack([vrule(), newKern(-fboxrule, a), innerV, newKern(-fboxrule, a), vrule()], 0, undefined, a);
  const frame = vpackage([hrule(), mid, hrule()], 0, undefined, undefined, a);
  const lowered = hpack([frame], 0, undefined, a);
  lowered.shift = tempdima;
  const outer = hpack([lowered], 0, undefined, a);
  outer.role = "boxed";
  return outer;
}

/**
 * tensor.sty's index lists: each index joins its own list ({#4}) and, unless
 * starred, a phantom of its width joins the other (\tnsr@Hph); built afresh
 * at every call (the typesetter consumes noads).
 */
export function indexLists(ad: LatexAdapter, items: AtomLike[] | undefined, ctx: Ctx, star: boolean): { sps: MItem[]; sbs: MItem[] } {
  const sps: MItem[] = [];
  const sbs: MItem[] = [];
  for (const it of items ?? []) {
    if (it.type === "first") continue;
    const sup = it.branch("superscript");
    const sub = it.branch("subscript");
    const atoms = sup ?? sub;
    if (atoms === undefined) continue;
    const [mine, other] = sup !== undefined ? [sps, sbs] : [sbs, sps];
    mine.push(ad.groupNoad(ad.list(atoms, ctx), it));
    if (!star) {
      // \mathpalette\tnsr@Mph{#4}: \makebox[width of $#1{#4}$][c]{$#1\indexmarker$}
      other.push(
        ad.palette(it, (st) => {
          const w = ad.mathBox(ad.styleList(st, it, [ad.groupNoad(ad.list(atoms, ctx), it)]), TEXT_STYLE, it).width;
          const b = newNullBox(it);
          b.width = w;
          b.role = "phantom";
          return [ad.boxNoad(b, it)];
        }) as unknown as MItem,
      );
    }
  }
  return { sps, sbs };
}

/** \tnsr@Fin: ^{sps}_{sbs} on the last noad of `out` (tex.web 1176), both always present. */
export function attachIndexScripts(ad: LatexAdapter, out: MItem[], sps: MItem[], sbs: MItem[], tag: Tag): void {
  for (const [which, list] of [["sup", sps], ["sub", sbs]] as const) {
    let last = out[out.length - 1] as Noad | undefined;
    if (!last || !(last.type >= ORD_NOAD && last.type < LEFT_NOAD) || last[which].mathType !== EMPTY) {
      last = newNoad(ORD_NOAD, tag);
      out.push(last);
    }
    last[which] = mlistField(list);
  }
}

/** tensor.sty \indices{^a_b...}: the staggered indices as scripts of what comes before. */
export function indices(ad: LatexAdapter, a: AtomLike, ctx: Ctx, out: MItem[], star: boolean): void {
  const { sps, sbs } = ad.indexLists(a.branch("body"), ctx, star);
  ad.attachIndexScripts(out, sps, sbs, a);
}

/**
 * tensor.sty \tensor[pre]{T}{post} in one style (\mathpalette\tnsr@Plt):
 * the prescripts' phantom {}^{..}_{..}, then T with the scripts, the
 * prescripts first, kerned back over T (\tnsr@Krn).
 */
export function tensor(ad: LatexAdapter, a: AtomLike, ctx: Ctx, style: number, star: boolean): MItem[] {
  const out: MItem[] = [];
  const nucleus = () => ad.list(a.branch("body"), ctx);
  const pre = (a.branch("above") ?? []).some((x) => x.type !== "first");
  let sps: MItem[] = [];
  let sbs: MItem[] = [];
  if (pre) {
    // \hphantom{{}\tnsr@Fin}
    const phantomList = (): MItem[] => {
      const l = ad.indexLists(a.branch("above"), ctx, star);
      const empty = newNoad(ORD_NOAD, a);
      empty.nucleus = mlistField([]);
      const items: MItem[] = [empty];
      ad.attachIndexScripts(items, l.sps, l.sbs, a);
      return items;
    };
    const pb = newNullBox(a);
    pb.width = ad.mathBox(ad.styleList(style, a, phantomList()), TEXT_STYLE, a).width;
    pb.role = "phantom";
    out.push(ad.boxNoad(pb, a));
    // \tnsr@Krn: \kern-(width of $\tnsr@Obj^{#1}\mkern-1mu$) #1 \kern(width of $\tnsr@Obj$)
    const objWidth = ad.mathBox(ad.styleList(style, a, nucleus()), TEXT_STYLE, a).width;
    const krn = (which: "sps" | "sbs"): MItem[] => {
      const measure = nucleus();
      ad.attachIndexScripts(measure, ad.indexLists(a.branch("above"), ctx, star)[which], [], a);
      // only the superscript is measured (\tnsr@Obj^{#1}): drop the empty subscript again
      const last = measure[measure.length - 1] as Noad;
      last.sub = { mathType: EMPTY } as Field;
      const w = ad.mathBox(ad.styleList(style, a, [...measure, ad.muKern(-PT, a)]), TEXT_STYLE, a).width;
      return [newKern(-w, a) as unknown as MItem, ...ad.indexLists(a.branch("above"), ctx, star)[which], newKern(objWidth, a) as unknown as MItem];
    };
    sps = krn("sps");
    sbs = krn("sbs");
  }
  const post = ad.indexLists(a.branch("below"), ctx, star);
  sps.push(...post.sps);
  sbs.push(...post.sbs);
  out.push(...nucleus());
  ad.attachIndexScripts(out, sps, sbs, a);
  return out;
}

/** \llap{\ensuremath{<style>#1}} in each style (mhchem.sty's \__mhchem_output_coreFive_llap:n). */
export function chemLlap(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem {
  return ad.palette(a, (st) => {
    const content = ad.mathBox(ad.styleList(st, a, ad.list(a.branch("body"), ctx)), TEXT_STYLE, a);
    const hss: Node = { type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 1, shrink: PT, shrinkOrder: 1 }, subtype: NORMAL, tag: a };
    return [ad.boxNoad(hpack([hss, content], 0, EXACTLY, a), a)];
  });
}

/**
 * \mhchem@minispace: \kern(0pt - width of ${}^8_8$ + width of $\text{C}^8_8$
 * - width of $\text{C}^{}_{}$), measured in text style.
 */
export function chemMinispace(ad: LatexAdapter, a: AtomLike): MItem {
  const eight = () => mlistField([ad.mathChar(ad.data.meanings.mathcode["8"], BASE_CTX, a)]);
  const measure = (base: () => Noad, scripts: boolean): number => {
    const n = base();
    n.sup = scripts ? eight() : mlistField([]);
    n.sub = scripts ? eight() : mlistField([]);
    return ad.mathBox([n], TEXT_STYLE, a).width;
  };
  const empty = () => {
    const n = newNoad(ORD_NOAD, a);
    n.nucleus = mlistField([]);
    return n;
  };
  const c = () => ad.boxNoad(ad.textBox("C", ad.textId(ad.text.rm, "m", "n", ad.text.sizes[0]), a), a);
  return newKern(-measure(empty, true) + measure(c, true) - measure(c, false), a) as unknown as MItem;
}

/**
 * mhchem.sty v4's arrows (\__mhchem_arrow_output:nnn, the font arrows):
 * \__mhchem_arrow_ext:nnnnnnnn, amsmath's \ext@arrow with an arrow at least
 * 2em long, and the equilibrium arrows as two of them raised and lowered.
 */
export function chemArrow(ad: LatexAdapter, a: AtomLike, ctx: Ctx): Noad {
  const name = String((a.args ?? [])[0] ?? "yields");
  const rm = ad.textRoman();
  const em = rm.param(6), ex = rm.param(5);
  const minLength = 2 * em;
  type Label = (() => MItem[]) | null;
  const visible = (x: AtomLike[] | undefined) => (x ?? []).some((y) => y.type !== "first");
  const above: Label = visible(a.branch("above")) ? () => ad.list(a.branch("above"), ctx) : null;
  const below: Label = visible(a.branch("below")) ? () => ad.list(a.branch("below"), ctx) : null;
  // \hphantom{#} (\mathpalette\mathph@nt), followed by \kern<k>
  const phantom = (label: Label, k = 0): Label =>
    label &&
    (() => {
      const items: MItem[] = [
        ad.palette(a, (st) => {
          const b = newNullBox(a);
          b.width = ad.mathBox(ad.styleList(st, a, label()), TEXT_STYLE, a).width;
          b.role = "phantom";
          return [ad.boxNoad(b, a)];
        }),
      ];
      if (k !== 0) items.push(newKern(k, a) as unknown as MItem);
      return items;
    });
  const right: ArrowFill = ["\\relbar", "\\relbar", "\\rightarrow"];
  const left: ArrowFill = ["\\leftarrow", "\\relbar", "\\relbar"];
  const leftright: ArrowFill = ["\\leftarrow", "\\relbar", "\\rightarrow"];
  const harpoonUp: ArrowFill = ["\\relbar", "\\relbar", "\\rightharpoonup"];
  const harpoonDown: ArrowFill = ["\\leftharpoondown", "\\relbar", "\\relbar"];
  // \mathrel{\mathop{\makebox[#7]{#8\displaystyle}}\limits^{\mkern#1mu#3\mkern#2mu}
  //   _{\makebox{\raisebox{1.25ex-\heightof{$\scriptstyle\mkern#4mu#6\mkern#5mu$}}[0pt]{$\scriptstyle\mkern#4mu#6\mkern#5mu$}}}}
  const ext = (k1: number, k2: number, sup: Label, k4: number, k5: number, sub: Label, width: number, fill: ArrowFill): Noad => {
    const hss = (): Node => ({ type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 1, shrink: PT, shrinkOrder: 1 }, subtype: NORMAL, tag: a });
    const box = hpack([hss(), ...ad.arrowFill(fill, DISPLAY_STYLE, a), hss()], width, EXACTLY, a);
    box.role = "ext-arrow";
    const op = newNoad(OP_NOAD, a);
    op.subtype = LIMITS;
    op.nucleus = boxField(box);
    if (sup) op.sup = mlistField([ad.muKern(k1 * PT, a), ...sup(), ad.muKern(k2 * PT, a)]);
    if (sub) {
      const x = ad.mathBox([{ type: STYLE_NODE, style: SCRIPT_STYLE, tag: a }, ad.muKern(k4 * PT, a), ...sub(), ad.muKern(k5 * PT, a)], TEXT_STYLE, a);
      const raised = hpack([{ ...x, shift: -(texScale("1.25", ex) - x.height) }], 0, undefined, a);
      raised.height = 0;
      op.sub = boxField(hpack([raised], 0, undefined, a));
    }
    const rel = newNoad(REL_NOAD, a);
    rel.nucleus = mlistField([op]);
    return rel;
  };
  // \raisebox{<d>}{$...$} and \rlap{...}
  const raise = (factor: string, items: MItem[]): BoxNode => {
    const b = ad.mathBox(items, TEXT_STYLE, a);
    return hpack([{ ...b, shift: -texScale(factor, ex) }], 0, undefined, a);
  };
  const lower = (factor: string, items: MItem[]): BoxNode => {
    const b = ad.mathBox(items, TEXT_STYLE, a);
    return hpack([{ ...b, shift: texScale(factor, ex) }], 0, undefined, a);
  };
  const rlap = (b: BoxNode): BoxNode =>
    hpack([b, { type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 1, shrink: PT, shrinkOrder: 1 }, subtype: NORMAL, tag: a } as Node], 0, EXACTLY, a);
  const pair = (top: BoxNode, bottom: BoxNode): Noad => {
    const rel = newNoad(REL_NOAD, a);
    rel.nucleus = mlistField([ad.boxNoad(rlap(top), a), ad.boxNoad(bottom, a)]);
    return rel;
  };
  const kern = (w: number) => newKern(w, a) as unknown as MItem;
  switch (name) {
    case "yieldsLeft":
      return ext(9, 5, above, 9, 5, below, minLength, left);
    case "mesomerism":
      return ext(9, 9, above, 9, 9, below, minLength, leftright);
    case "yieldsLeftRight":
      return pair(
        raise(".44", [ext(9, 9, above, 9, 9, below ? phantom(below) : null, minLength, right)]),
        lower(".44", [ext(9, 9, above ? phantom(above) : null, 9, 9, below, minLength, left)]),
      );
    case "equilibrium":
      return pair(
        raise(".22", [below ? ext(9, 9, above, 9, 5, phantom(below), minLength, harpoonUp) : ext(5, 9, above, 9, 9, null, minLength, harpoonUp)]),
        lower(".22", [above ? ext(5, 9, phantom(above), 9, 9, below, minLength, harpoonDown) : ext(9, 9, null, 9, 5, below, minLength, harpoonDown)]),
      );
    case "equilibriumRight":
      if (!above)
        return pair(
          lower(".22", [kern(texScale(".5", em)), ext(0, 0, null, 9, 5, below, minLength - em, harpoonDown)]),
          raise(".22", [below ? ext(0, 0, null, 9, 5, phantom(below, em), minLength, harpoonUp) : ext(0, 0, null, 0, 0, null, minLength, harpoonUp)]),
        );
      return pair(
        lower(".22", [kern(texScale(".5", em)), ext(5, 9, phantom(above, -em), 9, 9, below, minLength - em, harpoonDown)]),
        raise(".22", [below ? ext(9, 9, above, 9, 9, phantom(below, em), minLength, harpoonUp) : ext(5, 9, above, 0, 0, null, minLength, harpoonUp)]),
      );
    case "equilibriumLeft":
      if (!below)
        return pair(
          raise(".22", [kern(texScale(".5", em)), ext(5, 9, above, 0, 0, null, minLength - em, harpoonUp)]),
          lower(".22", [above ? ext(5, 9, phantom(above, em), 0, 0, null, minLength, harpoonDown) : ext(0, 0, null, 0, 0, null, minLength, harpoonDown)]),
        );
      return pair(
        raise(".22", [kern(texScale(".5", em)), ext(9, 9, above, 5, 9, phantom(below, -em), minLength - em, harpoonUp)]),
        lower(".22", [above ? ext(9, 9, phantom(above, em), 9, 9, below, minLength, harpoonDown) : ext(0, 0, null, 9, 5, below, minLength, harpoonDown)]),
      );
    default:
      return ext(5, 9, above, 5, 9, below, minLength, right);
  }
}
