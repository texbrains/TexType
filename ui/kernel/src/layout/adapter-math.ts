// The LaTeX adapter (latex-adapter.ts): symbols, fractions, roots, accents, delimiters, operators and spacing,
// built as LaTeX with amsmath builds them.
import type { LatexAdapter } from "./latex-adapter.ts";
import { scanDimen } from "./arith.ts";
import {
  ACCENT_NOAD,
  BIN_NOAD,
  CHOICE_NODE,
  CLOSE_NOAD,
  DEFAULT_CODE,
  DISPLAY_STYLE,
  EMPTY,
  FRACTION_NOAD,
  INNER_NOAD,
  LEFT_NOAD,
  LIMITS,
  MATH_CHAR,
  MIDDLE_NOAD,
  NO_LIMITS,
  NULL_DELIMITER,
  OP_NOAD,
  OPEN_NOAD,
  ORD_NOAD,
  PUNCT_NOAD,
  RADICAL_NOAD,
  REL_NOAD,
  RIGHT_NOAD,
  SCRIPT_SCRIPT_STYLE,
  SCRIPT_STYLE,
  STYLE_NODE,
  SUB_MLIST,
  TEXT_STYLE,
  VCENTER_NOAD,
  boxField,
  charField,
  mlistField,
  newNoad,
  type ChoiceItem,
  type Delimiter,
  type Field,
  type MItem,
  type Noad,
} from "./mlist.ts";
import {
  GLUE_NODE,
  KERN_NODE,
  MU_GLUE,
  NORMAL,
  RULE_NODE,
  newKern,
  newNullBox,
  newRule,
  type BoxNode,
  type Node,
  type Tag,
} from "./nodes.ts";
import { EXACTLY, hpack, vpackage } from "./pack.ts";
import { examZhSignCode } from "./exam-zh-signs.ts";
import {
  AtomLike,
  BASE_CTX,
  Ctx,
  FACE_GROUP_FAMS,
  FAM,
  LEFT_FENCE,
  LOWER_GREEK,
  PMB_STEP,
  PT,
  RIGHT_FENCE,
  STMARYRD,
  STMARYRD_DEFS,
  STMARYRD_DELIMS,
  UPGREEK,
  UPPER_GREEK,
  texScale,
} from "./adapter-tables.ts";

/** \mathcode / \mathchar value to a noad (tex.web 1155 set_math_char). */
export function mathChar(ad: LatexAdapter, code: number, ctx: Ctx, tag: Tag): Noad {
  let cls = (code >> 12) & 7;
  let fam = (code >> 8) & 15;
  const ch = code & 255;
  if (cls === 7) {
    if (ctx.fam >= 0) fam = ctx.fam;
    cls = 0;
  }
  if (ctx.bold) {
    const b = ad.boldFamily(fam);
    if (b === fam && !ctx.boldmath && ad.data.profile?.boldmath?.[fam]) return ad.boldmathChar(cls, fam, ch, tag);
    if (b === fam && !ctx.boldmath) return ad.poorMansBoldChar(cls, fam, ch, tag);
    fam = b;
  }
  const n = newNoad(ORD_NOAD + cls, tag);
  n.nucleus = ad.letterField(fam, ch) ?? charField(fam, ch);
  return n;
}

/**
 * bm.sty for a character whose family has no bold family: the character in
 * the bold math version, \mathchoice{\hbox{\boldmath$\displaystyle\m@th c$}}...
 * (\bm@mchoice). A choice item, not a noad: scripts start a new ord noad.
 */
export function boldmathChar(ad: LatexAdapter, cls: number, fam: number, ch: number, tag: Tag): Noad {
  const box = (style: number): MItem[] => {
    const n = newNoad(ORD_NOAD + cls, tag);
    n.nucleus = charField(fam, ch);
    return [ad.boxNoad(ad.mathBox([{ type: STYLE_NODE, style, tag }, n], TEXT_STYLE, tag, ad.boldEnv), tag)];
  };
  const choice: ChoiceItem = {
    type: CHOICE_NODE,
    display: box(DISPLAY_STYLE),
    text: box(TEXT_STYLE),
    script: box(SCRIPT_STYLE),
    scriptScript: box(SCRIPT_SCRIPT_STYLE),
    tag,
  };
  return choice as unknown as Noad;
}

/**
 * bm.sty for a character that has no bold font at all, not even in
 * \boldmath (the large symbols, the AMS symbols): poor man's bold
 * (\bm@pmb@@): the character three times, the second raised, each .4mu right
 * of the one before, in a \mathchoice so that each style sets its own size
 * (a large operator keeps its display size). The class stays: an operator
 * keeps its limits, a relation its spacing.
 */
export function poorMansBoldChar(ad: LatexAdapter, cls: number, fam: number, ch: number, tag: Tag): Noad {
  const box = (style: number): MItem[] => {
    const k = ad.mathBox([{ type: STYLE_NODE, style, tag }, ad.muKern(PMB_STEP, tag)], TEXT_STYLE, tag).width;
    const copy = () => {
      const n = newNoad(ORD_NOAD + cls, tag);
      n.nucleus = charField(fam, ch);
      return ad.mathBox([{ type: STYLE_NODE, style, tag }, n], TEXT_STYLE, tag);
    };
    const first = copy();
    const raised = copy();
    raised.shift = -Math.round(1.5 * k);
    const w = first.width;
    return [ad.boxNoad(hpack([first, newKern(k - w, tag), raised, newKern(k - w, tag), copy()], 0, undefined, tag), tag)];
  };
  const choice: ChoiceItem = {
    type: CHOICE_NODE,
    display: box(DISPLAY_STYLE),
    text: box(TEXT_STYLE),
    script: box(SCRIPT_STYLE),
    scriptScript: box(SCRIPT_SCRIPT_STYLE),
    tag,
  };
  const n = newNoad(ORD_NOAD + (cls === 7 ? 0 : cls), tag);
  n.nucleus = mlistField([choice as unknown as MItem]);
  return n;
}

/**
 * A letter or digit in the editor's letter font, when one is chosen (each
 * layout fills the letter families): that family and the Unicode
 * character. Everything else keeps the TeX fonts.
 */
export function letterField(ad: LatexAdapter, fam: number, ch: number): Field | null {
  const r = ad.role;
  // italic, upright, bold, bold italic (FACE_GROUP_FAMS order)
  const face = fam === r.mi || fam === r.it ? 0 : fam === r.rm ? 1 : fam === r.bf ? 2 : fam === r.bm ? 3 : -1;
  if (face < 0) return null;
  const mathItalic = fam === r.mi || fam === r.bm;
  let c: string | undefined;
  let group: keyof typeof FACE_GROUP_FAMS = "letter";
  if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a)) c = String.fromCharCode(ch);
  // the math italic fonts' digits are old-style figures
  else if (ch >= 0x30 && ch <= 0x39) {
    c = mathItalic ? undefined : String.fromCharCode(ch);
    group = "digit";
  } else if (ch <= 0x0a) {
    c = UPPER_GREEK[ch];
    group = "greek";
  } else if (mathItalic && ch <= 0x27) {
    c = LOWER_GREEK[ch - 0x0b];
    group = "greek";
  }
  const to = (FACE_GROUP_FAMS[group] as readonly number[])[face];
  if (c === undefined || !ad.fams.has(to)) return null;
  return charField(to, c.codePointAt(0)!);
}

/**
 * bm.sty's group in \bm{...} (\bm@mchoice): \mathord{\mathchoice{\hbox{\boldmath$\m@th\displaystyle ...$}}...}, the
 * group set in the bold math version in each style (its fractions take their parameters from the bold symbol font).
 */
export function bmBox(ad: LatexAdapter, a: AtomLike, ctx: Ctx, make: (ctx: Ctx) => MItem[]): Noad {
  const inner: Ctx = { ...ctx, boldmath: true };
  const choice = ad.palette(a, (st) => [ad.boxNoad(ad.mathBox([{ type: STYLE_NODE, style: st, tag: a }, ...make(inner)], TEXT_STYLE, a, ad.boldEnv), a)]);
  const n = newNoad(ORD_NOAD, a);
  n.nucleus = mlistField([choice]);
  return n;
}

/** bm: families with a bold version. */
export function boldFamily(ad: LatexAdapter, fam: number): number {
  const bold = ad.data.profile?.bold;
  if (bold) return bold[fam] ?? fam;
  const r = ad.role;
  if (fam === r.mi) return r.bm;
  if (fam === r.sy) return r.bmsy;
  if (fam === r.rm) return r.bf;
  if (fam === r.ex && r.bmex !== undefined) return r.bmex;
  return fam;
}

export function meaning(ad: LatexAdapter, cmd: string): string | undefined {
  if (cmd === "\\|") cmd = "\\Vert"; // \| is LaTeX's \Vert
  const m = ad.data.meanings.commands[cmd];
  if (m === undefined || m === "undefined") return undefined;
  return m;
}

/** The 27-bit \delimiter code in a meaning such as `\delimiter "426830A ` or `\delimiter 69645069 `. */
export function delimiterCodeIn(ad: LatexAdapter, m: string): number | null {
  const r = /\\delimiter ?(?:"([0-9A-F]+)|(\d+))/.exec(m);
  if (!r) return null;
  return r[1] ? parseInt(r[1], 16) : parseInt(r[2], 10);
}

/** The \mathchar code of a command or character, if it is a simple one. */
export function mathCodeOf(ad: LatexAdapter, key: string, ctx: Ctx): number | null {
  if (key.length === 1 && key.charCodeAt(0) < 128) {
    let mc = ad.data.meanings.mathcode[key];
    if (ctx.operator) {
      // \newmcodes@ (amsopn): ' * . - / : behave as in text
      const nm: Record<string, number> = { "'": 39, "*": 42, ".": 0x613a, "-": 45, "/": 47, ":": 0x603a };
      if (nm[key] !== undefined) mc = nm[key];
    }
    if (mc === undefined || mc === 0x8000) return null;
    return mc;
  }
  const m = ad.meaning(key);
  if (!m) return null;
  let r = /^\\mathchar"([0-9A-F]+)$/.exec(m);
  if (r) return parseInt(r[1], 16);
  if (/^(?:\\protected )?macro:->\\delimiter ?[0-9"]/.test(m) || /^\\delimiter"/.test(m)) {
    const code = ad.delimiterCodeIn(m);
    if (code !== null) return code >> 12;
  }
  return null;
}

/** Whether LaTeX defines this command, so the engine renders it even if the kernel does not know it. */
export function knowsCommand(ad: LatexAdapter, cmd: string): boolean {
  return !!ad.data.templates[cmd] || ad.mathCodeOf(cmd, BASE_CTX) !== null;
}

/**
 * A symbol LaTeX defines as a macro (\sum is \DOTSB\sum@\slimits@) set inside
 * \bm: bm.sty reaches the math characters it expands to, each in its bold
 * family, or in poor man's bold when it has none; the class and the limits stay.
 */
export function emboldened(ad: LatexAdapter, items: MItem[] | null, ctx: Ctx): MItem[] | null {
  if (!items || !ctx.bold) return items;
  return items.map((item) => {
    const n = item as Noad;
    if (!(n.type >= ORD_NOAD && n.type < LEFT_NOAD) || n.nucleus?.mathType !== MATH_CHAR) return item;
    const { fam, char } = n.nucleus as { fam: number; char: number };
    const bold = ad.boldFamily(fam);
    if (bold !== fam) {
      n.nucleus = ad.letterField(bold, char) ?? charField(bold, char);
      return item;
    }
    if (ctx.boldmath) return item;
    const pmb = ad.poorMansBoldChar(n.type - ORD_NOAD, fam, char, n.tag);
    pmb.subtype = n.subtype;
    return pmb as MItem;
  });
}

export function template(ad: LatexAdapter, key: string, tag: Tag): MItem[] | null {
  const t = ad.data.templates[key];
  if (!t) return null;
  try {
    return ad.json.convert(t.mathlist, t.fontids, tag);
  } catch (e) {
    // a recorded list the converter cannot rebuild: the caller's fallback draws the command, the formula stays
    console.warn("tex-layout: template " + key + " unusable:", e);
    return null;
  }
}

/** The recorded list of a one-argument command applied to x (latex-onearg.json). */
export function template1(ad: LatexAdapter, key: string, tag: Tag): MItem[] | null {
  const t = ad.data.onearg[key];
  if (!t) return null;
  try {
    return ad.json.convert(t.mathlist, t.fontids, tag);
  } catch (e) {
    console.warn("tex-layout: template " + key + "{x} unusable:", e);
    return null;
  }
}

/**
 * A one-argument template with its argument in place: the one plain x (math italic, no scripts) in the list is
 * replaced by the argument's noads, as TeX substitutes #1. Null when the list has no such x or more than one.
 */
export function withArgument(ad: LatexAdapter, items: MItem[] | null, arg: () => MItem[]): MItem[] | null {
  if (!items) return null;
  const spots: { list: MItem[]; i: number }[] = [];
  const isX = (n: Noad) =>
    n.type === ORD_NOAD && n.nucleus?.mathType === MATH_CHAR && n.nucleus.char === 0x78 && n.sub.mathType === EMPTY && n.sup.mathType === EMPTY;
  const walk = (list: MItem[]) => {
    list.forEach((item, i) => {
      const n = item as Noad;
      if (!(n.type >= ORD_NOAD && n.type < LEFT_NOAD)) return;
      if (isX(n)) spots.push({ list, i });
      for (const f of [n.nucleus, n.sup, n.sub, n.num, n.den]) if (f?.mathType === SUB_MLIST && f.list) walk(f.list);
    });
  };
  walk(items);
  if (spots.length !== 1) return null;
  const { list, i } = spots[0];
  list.splice(i, 1, ...arg());
  return items;
}

export function symbol(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const sign = ad.examZhSign(a);
  if (sign) return [sign];
  const keys: string[] = [];
  if (a.command) keys.push(a.command);
  if (a.value && a.value !== a.command) keys.push(a.value);
  for (const key of keys) {
    const mc = ad.mathCodeOf(key, ctx);
    if (mc !== null) return [ad.mathChar(mc, ctx, a)];
    const tpl = ad.emboldened(ad.template(key, a), ctx);
    if (tpl) return tpl;
  }
  const pkg = a.command ? ad.packageSymbol(a.command, ctx, a) : null;
  if (pkg) return pkg;
  return ad.unknownSymbol(a, ctx);
}

/**
 * The congruence sign of Chinese geometry (≌, \backcong) and the similarity sign (∽, \backsim), negated after \not:
 * exam-zh's drawings (exam-zh-signs.ts), as relations; null for any other atom.
 */
export function examZhSign(ad: LatexAdapter, a: AtomLike, negated = false): Noad | null {
  if (!ad.fams.has(FAM.examzh)) return null;
  const code = examZhSignCode(a.command ?? "", negated) ?? examZhSignCode(a.value ?? "", negated);
  if (code === null) return null;
  const n = newNoad(REL_NOAD, a);
  n.nucleus = charField(FAM.examzh, code);
  return n;
}

/**
 * A symbol of a package the reference preamble loads and LaTeX's own data
 * does not define (stmaryrd, upgreek), set from the package's font when the
 * profile has it (PACKAGE_FAMILIES).
 */
export function packageSymbol(ad: LatexAdapter, cmd: string, ctx: Ctx, tag: Tag): MItem[] | null {
  const noad = (cls: number, fam: number, code: number): Noad => {
    const n = newNoad(ORD_NOAD + cls, tag);
    n.nucleus = charField(fam, code);
    return n;
  };
  if (UPGREEK[cmd] !== undefined && ad.fams.has(FAM.eur)) return [noad(0, FAM.eur, UPGREEK[cmd])];
  if (!ad.fams.has(FAM.stmry)) return null;
  const mc = STMARYRD[cmd] ?? (STMARYRD_DELIMS[cmd] ? (cmd === "\\llbracket" ? 0x400 : 0x500) + STMARYRD_DELIMS[cmd][0] : undefined);
  if (mc !== undefined) return [noad(mc >> 8, FAM.stmry, mc & 0xff)];
  const parts = STMARYRD_DEFS[cmd];
  if (!parts) return null;
  const out: MItem[] = [];
  for (const part of parts) {
    const code = ad.mathCodeOf(part, ctx);
    if (code !== null) out.push(ad.mathChar(code, ctx, tag));
    else if (STMARYRD[part] !== undefined) out.push(noad(STMARYRD[part] >> 8, FAM.stmry, STMARYRD[part] & 0xff));
    else out.push(...(ad.template(part, tag) ?? []));
  }
  return out;
}

/** A symbol LaTeX does not define (e.g. a Chinese character): its character, sized like \text, of the class `cls`. */
export function unknownSymbol(ad: LatexAdapter, a: AtomLike, _ctx: Ctx, cls = ORD_NOAD): MItem[] {
  const text = a.value ?? a.command ?? "?";
  const mk = (size: string): MItem[] => {
    const n = newNoad(ORD_NOAD, a);
    n.nucleus = boxField(ad.textBox(text, ad.textId(ad.text.rm, "m", "n", size), a));
    return [n];
  };
  const [s0, s1, s2] = ad.text.sizes;
  const choice: ChoiceItem = { type: CHOICE_NODE, display: mk(s0), text: mk(s0), script: mk(s1), scriptScript: mk(s2), tag: a };
  if (cls === ORD_NOAD) return [ad.groupNoad([choice], a)];
  const n = newNoad(cls, a);
  n.nucleus = mlistField([choice]);
  return [n];
}

export function genfrac(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "\\frac";
  const num = ad.listField(a.branch("above"), ctx);
  const den = ad.listField(a.branch("below"), ctx);
  const frac = newNoad(FRACTION_NOAD, a);
  frac.num = num;
  frac.den = den;
  frac.thickness = a.hasBarLine === false ? 0 : DEFAULT_CODE;
  // \above <dimen>, \genfrac's thickness argument
  if (a.barThickness) frac.thickness = ad.dimenFromAtom({ type: "spacing", width: a.barThickness, branch: () => undefined });
  const ld = a.leftDelim, rd = a.rightDelim;
  if (ld || rd) {
    frac.leftDelim = ad.delimiter(ld ?? ".");
    frac.rightDelim = ad.delimiter(rd ?? ".");
  }
  if (cmd === "\\frac" || cmd === "\\over" || cmd === "\\atop" || cmd === "\\choose" || /^\\(?:above|abovewithdelims|overwithdelims|atopwithdelims)$/.test(cmd)) {
    // amsmath \frac: {\begingroup#1\endgroup\@@over#2}
    return [ad.groupNoad([frac], a)];
  }
  if (cmd === "\\cfrac") return ad.cfrac(a, ctx);
  // \dfrac, \tfrac, \binom, \dbinom, \tbinom, \genfrac:
  // \@genfrac: {#1{\begingroup#4\endgroup#2#3\relax#5}} with #1 = style
  const style =
    a.mathstyleName === "displaystyle" || cmd === "\\dfrac" || cmd === "\\dbinom"
      ? DISPLAY_STYLE
      : a.mathstyleName === "textstyle" || cmd === "\\tfrac" || cmd === "\\tbinom"
        ? TEXT_STYLE
        : a.mathstyleName === "scriptstyle"
          ? SCRIPT_STYLE
          : a.mathstyleName === "scriptscriptstyle"
            ? SCRIPT_SCRIPT_STYLE
            : null;
  const inner = ad.groupNoad([frac], a);
  const outer: MItem[] = style === null ? [inner] : [{ type: STYLE_NODE, style, tag: a }, inner];
  return [ad.groupNoad(outer, a)];
}

/** amsmath \cfrac: {\displaystyle\frac{\strut#2}{#3}}\kern-\nulldelimiterspace */
export function cfrac(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const strut = newNullBox(a);
  // \strut: \vrule height .7\baselineskip depth .3\baselineskip (12pt)
  const sh = texScale(".7", 12 * PT), sd = texScale(".3", 12 * PT);
  strut.list = [{ type: RULE_NODE, width: 0, height: sh, depth: sd, tag: a }];
  strut.height = sh;
  strut.depth = sd;
  const strutNoad = newNoad(ORD_NOAD, a);
  strutNoad.nucleus = boxField(strut);
  const numList: MItem[] = [strutNoad];
  // \cfrac[l], [r]: the kernel's align is "left" or "right"
  const align = a.align === "left" ? "l" : a.align === "right" ? "r" : a.align;
  if (align === "r") numList.push({ type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 2, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a } as Node);
  numList.push(...ad.list(a.branch("above"), ctx));
  if (align === "l") numList.push({ type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 2, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a } as Node);
  const frac = newNoad(FRACTION_NOAD, a);
  frac.num = ad.listField(a.branch("above"), ctx, numList);
  frac.den = ad.listField(a.branch("below"), ctx);
  frac.thickness = DEFAULT_CODE;
  const fracGroup = ad.groupNoad([frac], a);
  const g = ad.groupNoad([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, fracGroup], a);
  return [g, { type: KERN_NODE, width: -ad.env.nullDelimiterSpace, subtype: NORMAL, tag: a } as Node];
}

export function surd(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const index = a.branch("above");
  const sqrtDelim = ad.radicalDelimiter();
  const radical = (bodyCtx: Ctx): Noad => {
    const r = newNoad(RADICAL_NOAD, a);
    r.leftDelim = sqrtDelim;
    r.nucleus = ad.field(a.branch("body"), bodyCtx);
    return r;
  };
  // amsmath \leftroot and \uproot in the index set the counts \leftroot@ and \uproot@
  let leftroot = 0, uproot = 0;
  const indexList = (index ?? []).filter((x) => {
    if (x.command !== "\\leftroot" && x.command !== "\\uproot") return true;
    const v = (x.args ?? [])[0] as { number?: number; dimension?: number } | undefined;
    const n = Math.trunc(Number(v?.number ?? v?.dimension ?? 0)) || 0;
    if (x.command === "\\leftroot") leftroot = n;
    else uproot = n;
    return false;
  });
  const visibleIndex = indexList.filter((x) => x.type !== "first");
  if (visibleIndex.length === 0) return [radical(ctx)];
  // amsmath \root#1\of: \setbox\rootbox\hbox{$\m@th\scriptscriptstyle{#1}$}
  // then \mathpalette\r@@t{#2}
  const rootList: MItem[] = [{ type: STYLE_NODE, style: SCRIPT_SCRIPT_STYLE, tag: a }, ad.groupNoad(ad.list(indexList, ctx), a)];
  const rootbox = ad.mathBox(rootList, TEXT_STYLE, a);
  const variant = (style: number): MItem[] => {
    // \setboxz@h{$\m@th#1\sqrtsign{#2}$}
    const box0 = ad.mathBox([{ type: STYLE_NODE, style, tag: a }, radical(ctx)], TEXT_STYLE, a);
    let dimen = box0.height - box0.depth;
    // \setbox\@ne\hbox{$\m@th#1\mskip\uproot@ mu$}; \advance\dimen@ by1.667\wd\@ne
    const box1 = ad.mathBox([{ type: STYLE_NODE, style, tag: a }, ad.muGlue(uproot * PT, a)], TEXT_STYLE, a);
    dimen += texScale("1.667", box1.width);
    const raised: BoxNode = { ...rootbox, list: rootbox.list, shift: -texScale(".6", dimen) };
    const rn = newNoad(ORD_NOAD, a);
    rn.nucleus = boxField(raised);
    const sq = newNoad(ORD_NOAD, a);
    sq.nucleus = boxField(box0);
    // \mkern-\leftroot@ mu\mkern5mu\raise.6\dimen@\copy\rootbox\mkern-10mu\mkern\leftroot@ mu\box\z@
    return [ad.muKern(-leftroot * PT, a), ad.muKern(5 * PT, a), rn, ad.muKern(-10 * PT, a), ad.muKern(leftroot * PT, a), sq];
  };
  const choice: ChoiceItem = {
    type: CHOICE_NODE,
    display: variant(DISPLAY_STYLE),
    text: variant(TEXT_STYLE),
    script: variant(SCRIPT_STYLE),
    scriptScript: variant(SCRIPT_SCRIPT_STYLE),
    tag: a,
  };
  return [ad.groupNoad([choice], a)];
}

export function radicalDelimiter(ad: LatexAdapter): Delimiter {
  // \sqrtsign = \radical"270370
  return { smallFam: 2, smallChar: 0x70, largeFam: 3, largeChar: 0x70 };
}

export function accent(ad: LatexAdapter, a: AtomLike, ctx: Ctx): Noad {
  const cmd = a.command ?? "\\hat";
  const tpl = ad.data.onearg[cmd];
  const acc = tpl?.mathlist?.length === 1 && tpl.mathlist[0].type === "accent" ? tpl.mathlist[0] : null;
  if (!acc) {
    // amsmath \dddot, \ddddot: LaTeX's list for \cmd{x}, with the argument in place of the x
    const items = tpl ? ad.withArgument(ad.template1(cmd, a), () => ad.list(a.branch("body"), ctx)) : null;
    if (items) return ad.groupNoad(items, a);
    // Not a TeX math accent (e.g. an over-arrow or brace): defer to fallback.
    return ad.groupNoad(ad.fallback(a, ctx), a);
  }
  const n = newNoad(ACCENT_NOAD, a);
  n.accentChr = charField(acc.fam, acc.code);
  // amsfonts \widehat, \widetilde: \@mathmeasure\z@\textstyle{#1}, then the AMS accent when \wd\z@ > 2em
  const wide = /^macro:#1->\\@mathmeasure \\z@ \\textstyle \{#1\}\\ifdim \\wd \\z@ >\\tw@ em\\mathaccent "([0-9A-F]+)\{#1\}\\else /.exec(ad.meaning(cmd) ?? "");
  if (wide) {
    const box0 = ad.mathBox([{ type: STYLE_NODE, style: TEXT_STYLE, tag: a }, ad.groupNoad(ad.list(a.branch("body"), ctx), a)], TEXT_STYLE, a);
    if (box0.width > 2 * ad.textRoman().param(6)) {
      const code = parseInt(wide[1], 16);
      n.accentChr = charField((code >> 8) & 15, code & 255);
    }
  }
  n.nucleus = ad.field(a.branch("body"), ctx);
  return n;
}

/** Delimiter code for "(", "\\langle", "." etc. (\delcode / \delimiter). */
export function delimiter(ad: LatexAdapter, name: string): Delimiter {
  if (!name || name === "." || name === "\\.") return NULL_DELIMITER;
  // stmaryrd's \DeclareMathDelimiter (\llbracket, \rrbracket), unless LaTeX's data defines them
  const stmry = STMARYRD_DELIMS[name];
  if (stmry && ad.fams.has(FAM.stmry) && !ad.meaning(name))
    return { smallFam: FAM.stmry, smallChar: stmry[0], largeFam: FAM.stmry, largeChar: stmry[1] };
  let code: number | undefined;
  // mathtools' \lparen and \rparen (the editor's fences use them too)
  if (name === "\\lparen" || name === "\\rparen") name = name === "\\lparen" ? "(" : ")";
  if (name.length === 1) {
    const dc = ad.data.meanings.delcode[name];
    if (dc !== undefined && dc > 0) code = dc;
  } else {
    const alias: Record<string, string> = {
      "\\{": "\\lbrace",
      "\\}": "\\rbrace",
      "\\lbrace": "\\lbrace",
      "\\|": "\\|",
      "\\lVert": "\\lVert",
      "\\rVert": "\\rVert",
      "\\vert": "\\vert",
      "\\Vert": "\\Vert",
    };
    const key = alias[name] ?? name;
    const m = ad.meaning(key) ?? "";
    const dc = ad.delimiterCodeIn(m);
    const sy = ad.role.sy, ex = ad.role.ex;
    // fontmath.ltx delimiters the recorded meanings lack: symbols and largesymbols characters
    const fontmath: Record<string, number> = {
      "\\arrowvert": (sy << 20) | (0x6a << 12) | (ex << 8) | 0x3c,
      "\\Arrowvert": (sy << 20) | (0x6b << 12) | (ex << 8) | 0x3d,
      "\\bracevert": (ex << 20) | (0x3e << 12) | (ex << 8) | 0x3e,
    };
    if (dc !== null) code = dc & 0xffffff;
    else if (!m && fontmath[key] !== undefined) code = fontmath[key];
    else {
      // a macro for one character (\lbrack -> [) has that character's \delcode
      const one = /^macro:->(.)$/.exec(m)?.[1] ?? (key.length === 2 ? key[1] : undefined);
      const dc = one === undefined ? undefined : ad.data.meanings.delcode[one];
      if (dc !== undefined && dc > 0) code = dc;
    }
  }
  if (code === undefined) return NULL_DELIMITER;
  const small = (code >> 12) & 0xfff;
  const large = code & 0xfff;
  return { smallFam: (small >> 8) & 15, smallChar: small & 255, largeFam: (large >> 8) & 15, largeChar: large & 255 };
}

/**
 * \left...\right. A side the editor still waits for ("?": the closing
 * bracket of a bracket just typed) is the matching delimiter, which the
 * editor draws faded.
 */
/**
 * The kernel reads `\exp(x)` as a smart fence (a leftright without \left/\right) and writes it back as `\exp(x)`:
 * in LaTeX those are the plain characters, an open and a close noad at their natural size.
 */
export function leftRightOrFence(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const plain = a.variant === "" && a.leftDelim && a.leftDelim !== "?" && a.rightDelim && a.rightDelim !== "?";
  const open = plain ? ad.mathCodeOf(a.leftDelim, ctx) : null;
  const close = plain ? ad.mathCodeOf(a.rightDelim, ctx) : null;
  if (open === null || close === null) return [ad.leftRight(a, ctx)];
  return [ad.mathChar(open, ctx, a), ...ad.list(a.branch("body"), ctx), ad.mathChar(close, ctx, a)];
}

export function leftRight(ad: LatexAdapter, a: AtomLike, ctx: Ctx): Noad {
  const left = newNoad(LEFT_NOAD, a);
  left.delim = ad.delimiter(a.leftDelim === "?" ? LEFT_FENCE[a.rightDelim] ?? "." : a.leftDelim ?? ".");
  const right = newNoad(RIGHT_NOAD, a);
  right.delim = ad.delimiter(a.rightDelim === "?" ? RIGHT_FENCE[a.leftDelim] ?? a.leftDelim ?? "." : a.rightDelim ?? ".");
  const inner = newNoad(INNER_NOAD, a);
  inner.nucleus = mlistField([left, ...ad.list(a.branch("body"), ctx), right]);
  return inner;
}

export function middle(ad: LatexAdapter, a: AtomLike): Noad {
  const m = newNoad(RIGHT_NOAD, a);
  m.subtype = MIDDLE_NOAD;
  m.delim = ad.delimiter(a.value ?? a.command ?? ".");
  return m;
}

/** amsmath \big etc.: an \hbox of \left<d>\vcenter to <f>\big@size{}\right. */
export function sizedDelim(ad: LatexAdapter, a: AtomLike): Noad {
  const factors = ["1", "1.5", "2", "2.5"];
  const f = factors[Math.max(0, Math.min(3, (a.size ?? 1) - 1))];
  // \big@size = 1.2\ht\Mathstrutbox@ + 1.2\dp\Mathstrutbox@ (amsmath \resetMathstrut@:
  // the character of the \mathcode of "(" in its family's \textfont)
  const mc = ad.data.meanings.mathcode["("];
  const pf = ad.env.famFnt((mc >> 8) & 15, 0 /* text size */)!;
  const paren = pf.charInfo(mc & 255);
  const bigSize = texScale("1.2", pf.charHeight(paren)) + texScale("1.2", pf.charDepth(paren));
  const vc = newNoad(VCENTER_NOAD, a);
  const vbox = vpackage([], texScale(f, bigSize), EXACTLY, undefined, a);
  vc.nucleus = boxField(vbox);
  const left = newNoad(LEFT_NOAD, a);
  left.delim = ad.delimiter(a.value ?? ".");
  const right = newNoad(RIGHT_NOAD, a);
  right.delim = NULL_DELIMITER;
  const env = { ...ad.env, nullDelimiterSpace: 0 };
  const box = ad.mathBox([left, vc, right], TEXT_STYLE, a, env);
  const cls: Record<string, number> = { mopen: OPEN_NOAD, mclose: CLOSE_NOAD, mrel: REL_NOAD, mbin: BIN_NOAD, mpunct: PUNCT_NOAD };
  const n = newNoad(cls[a.delimType] ?? ORD_NOAD, a);
  n.nucleus = boxField(box);
  return n;
}

export function operator(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "";
  let items: MItem[] | null = null;
  if (cmd === "\\operatorname" || cmd === "\\operatorname*" || cmd === "\\mathop") {
    items = [ad.operatorName(a, ctx, cmd === "\\operatorname*")];
  } else if (ad.pathOps.has(cmd)) {
    // like amsmath's integrals: \mathop with \nolimits (\ilimits@)
    const op = newNoad(OP_NOAD, a);
    op.nucleus = charField(FAM.paths, ad.pathOps.get(cmd)!);
    op.subtype = NO_LIMITS;
    items = [op];
  } else if (cmd === "\\oiiint" && !ad.data.templates[cmd]) {
    // no LaTeX package in the reference set defines it: amsmath's \iiint
    // with a contour oval drawn over the three signs (as the app's export does)
    items = ad.template("\\iiint", a);
    if (items) ad.ovals.add(a);
  } else if (a.explicitSubsupPlacement && a.subsupPlacement === "over-under" && ad.data.templates[cmd + "\\limits"]) {
    // amsmath's multiple integrals: \limits makes the signs one \mathop (\ints@b)
    items = ad.template(cmd + "\\limits", a);
  } else {
    const mc = ad.mathCodeOf(cmd, ctx);
    if (mc !== null) items = [ad.mathChar(mc, ctx, a)];
    else items = ad.emboldened(ad.template(cmd, a), ctx);
  }
  if (!items || items.length === 0) items = ad.unknownSymbol(a, ctx);
  // \limits / \nolimits typed explicitly by the user
  if (a.explicitSubsupPlacement) {
    const last = items[items.length - 1] as Noad;
    if (last.type === OP_NOAD) {
      if (a.subsupPlacement === "over-under") last.subtype = LIMITS;
      else if (a.subsupPlacement === "adjacent") last.subtype = NO_LIMITS;
      else last.subtype = NORMAL;
    }
  }
  return items;
}

/** \qopname: \mathop{#1\kern\z@\operator@font#3}\n<limits>limits@ */
export function operatorName(ad: LatexAdapter, a: AtomLike, ctx: Ctx, star: boolean): Noad {
  const body = a.branch("body") ?? [];
  const inner: MItem[] = [newKern(0, a) as unknown as MItem];
  const opCtx: Ctx = { ...ctx, fam: ad.role.rm, operator: true };
  if (body.length > 0) {
    for (const b of body) {
      if (b.type === "first") continue;
      if (b.command === "\\," || b.command === "\\:" || b.command === "\\;" || b.command === "\\!") {
        inner.push(...(ad.template(b.command, b) ?? []));
        continue;
      }
      ad.atom(b, opCtx, inner);
    }
  }
  else if (a.value) for (const ch of a.value) inner.push(...ad.symbol({ type: "mord", value: ch, command: ch, branch: () => undefined }, opCtx));
  const op = newNoad(OP_NOAD, a);
  op.nucleus = mlistField(inner);
  op.subtype = star ? NORMAL : NO_LIMITS;
  return op;
}

export function spacing(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "";
  const tpl = ad.template(cmd, a);
  if (tpl) return tpl;
  if (cmd === "\\hspace" || cmd === "\\hspace*" || cmd === "\\kern" || cmd === "\\hskip") {
    const w = ad.dimenFromAtom(a);
    return [{ type: GLUE_NODE, spec: { width: w, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a } as Node];
  }
  if (cmd === "\\mkern" || cmd === "\\mskip" || cmd === "\\mspace") {
    const w = ad.dimenFromAtom(a, "mu");
    return [{ type: KERN_NODE, width: w, subtype: MU_GLUE, tag: a } as Node];
  }
  void ctx;
  return [];
}

export function dimenFromAtom(ad: LatexAdapter, a: AtomLike, unit = "pt"): number {
  const w = a.width;
  if (!w) return 0;
  const value = typeof w === "object" ? w.dimension ?? w.value ?? 0 : Number(w);
  const u = typeof w === "object" ? w.unit ?? unit : unit;
  // em and ex of the current text font; mu lengths come as points
  const rm = ad.textRoman();
  return scanDimen(String(value), u === "mu" ? "pt" : u, { em: rm.param(6), ex: rm.param(5), px: 65781 });
}

/**
 * latex.ltx \@rule[#1]#2#3: \hbox{\vrule width #2 height #3+#1 depth -#1}.
 * The kernel gives the optional raise and the two sizes as args.
 */
export function ruleBox(ad: LatexAdapter, a: AtomLike): BoxNode {
  const args = (a.args ?? []) as unknown[];
  const dimen = (d: unknown) => (d && typeof d === "object" ? ad.dimenFromAtom({ type: "spacing", width: d, branch: () => undefined }) : 0);
  const raise = dimen(args[0]);
  const rule = newRule(a);
  rule.width = dimen(args[1]);
  rule.height = dimen(args[2]) + raise;
  rule.depth = -raise;
  return hpack([rule], 0, undefined, a);
}

export function muKern(ad: LatexAdapter, width: number, tag: Tag): MItem {
  return { type: KERN_NODE, width, subtype: MU_GLUE, tag } as Node;
}

export function muGlue(ad: LatexAdapter, width: number, tag: Tag): MItem {
  return { type: GLUE_NODE, spec: { width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, subtype: MU_GLUE, tag } as Node;
}
