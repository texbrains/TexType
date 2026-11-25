// The LaTeX adapter (latex-adapter.ts): one kernel atom at a time, and the dispatch of commands to what builds
// them.
import type { LatexAdapter } from "./latex-adapter.ts";
import {
  ACCENT_NOAD,
  BIN_NOAD,
  CLOSE_NOAD,
  DISPLAY_STYLE,
  EMPTY,
  INNER_NOAD,
  LEFT_NOAD,
  LIMITS,
  MATH_CHAR,
  NO_LIMITS,
  OP_NOAD,
  OPEN_NOAD,
  ORD_NOAD,
  OVER_NOAD,
  PUNCT_NOAD,
  REL_NOAD,
  SCRIPT_SCRIPT_STYLE,
  SCRIPT_STYLE,
  STYLE_NODE,
  TEXT_STYLE,
  UNDER_NOAD,
  mlistField,
  newNoad,
  type Field,
  type MItem,
  type Noad,
} from "./mlist.ts";
import {
  GLUE_NODE,
  KERN_NODE,
  NORMAL,
  VLIST_NODE,
  newNullBox,
  type Node,
  type Tag,
} from "./nodes.ts";
import {
  AtomLike,
  Ctx,
  FAM,
  PT,
  RIGHT_DELIM_TOKENS,
  SMART_DOTS,
  isIntertextAtom,
  isTagAtom,
} from "./adapter-tables.ts";

/** Convert one atom, appending to `out` (scripts attach TeX-style). */
export function atom(ad: LatexAdapter, a: AtomLike, ctx: Ctx, out: MItem[]): void {
  if (ad.commandAtom(a, ctx, out)) {
    if (a.branch("superscript") !== undefined || a.branch("subscript") !== undefined) ad.attachScripts(out, a, ctx, false);
    return;
  }
  switch (a.type) {
    case "first":
      return;
    case "space":
      out.push(...ad.controlSpace(a));
      break;
    case "macro": {
      const items = ad.macro(a, ctx);
      // \limits / \nolimits typed after a macro that ends in an operator (a custom symbol), as after \int
      const last = items[items.length - 1] as Noad | undefined;
      if (a.explicitSubsupPlacement && last?.type === OP_NOAD) {
        last.subtype = a.subsupPlacement === "over-under" ? LIMITS : a.subsupPlacement === "adjacent" ? NO_LIMITS : NORMAL;
      }
      out.push(...items);
      break;
    }
    case "macro-argument":
      out.push(...ad.list(a.branch("body"), ctx));
      break;
    case "subsup":
      ad.attachScripts(out, a, ctx, true);
      return;
    case "group":
      if (ctx.bold && !ctx.boldmath) out.push(ad.bmBox(a, ctx, (c) => [ad.groupNoad(ad.list(a.branch("body"), c), a)]));
      else out.push(ad.groupNoad(ad.list(a.branch("body"), ctx), a));
      break;
    case "genfrac":
      // bm: \frac is a brace group ({\begingroup#1\endgroup\over#2})
      if (ctx.bold && !ctx.boldmath) out.push(ad.bmBox(a, ctx, (c) => ad.genfrac(a, c)));
      else out.push(...ad.genfrac(a, ctx));
      break;
    case "surd":
      out.push(...ad.surd(a, ctx));
      break;
    case "accent":
      out.push(ad.accent(a, ctx));
      break;
    case "leftright":
      out.push(...ad.leftRightOrFence(a, ctx));
      break;
    case "delim": // \middle inside \left...\right
      out.push(ad.middle(a));
      break;
    case "sizeddelim":
      out.push(ad.sizedDelim(a));
      break;
    case "extensible-symbol":
    case "operator":
      out.push(...ad.operator(a, ctx));
      break;
    case "error":
      // a LaTeX command the kernel does not know (\idotsint ...): as LaTeX defines it
      if (a.command && ad.knowsCommand(a.command)) out.push(...ad.operator(a, ctx));
      else out.push(...ad.fallback(a, ctx));
      break;
    case "spacing":
      out.push(...ad.spacing(a, ctx));
      break;
    case "placeholder":
      out.push(ad.placeholder(a, ctx));
      break;
    case "phantom":
      out.push(...ad.phantom(a, ctx));
      break;
    case "box":
      out.push(...ad.boxAtom(a, ctx));
      break;
    case "enclose":
      out.push(...ad.enclose(a, ctx));
      break;
    case "overunder":
      out.push(...ad.overUnder(a, ctx));
      break;
    case "overlap":
      out.push(...ad.overlap(a, ctx));
      break;
    case "array":
      out.push(...ad.arrayEnv(a, ctx));
      break;
    case "mord":
    case "mbin":
    case "mrel":
    case "mopen":
    case "mclose":
    case "mpunct":
    case "minner":
    case "mop":
      out.push(...ad.symbol(a, ctx));
      break;
    case "text":
      // \renewcommand{\arraystretch}{1.5}, \setlength{\arraycolsep}{2pt} ...: kept by the kernel as an invisible atom
      if (!a.value && typeof a.verbatimLatex === "string" && ad.arraySetting(a.verbatimLatex)) break;
      out.push(...ad.fallback(a, ctx));
      break;
    case "composition":
      // text an input method is composing (pinyin letters): all of it, as
      // typed; the atom's command still holds the first letter
      if (a.value) out.push(...ad.unknownSymbol(a, ctx));
      break;
    default:
      out.push(...ad.fallback(a, ctx));
      break;
  }
  // Scripts carried by the atom itself (operators, groups, ...)
  if (a.branch("superscript") !== undefined || a.branch("subscript") !== undefined) ad.attachScripts(out, a, ctx, false);
}

/** tex.web 1176: attach scripts to the last noad or a new empty one. */
export function attachScripts(ad: LatexAdapter, out: MItem[], a: AtomLike, ctx: Ctx, fromSubsup: boolean): void {
  const sup = a.branch("superscript");
  const sub = a.branch("subscript");
  // TeX reads them in source order; the serializer emits _ then ^.
  for (const [which, atoms] of [["sub", sub], ["sup", sup]] as const) {
    if (atoms === undefined) continue;
    let last = out[out.length - 1] as Noad | undefined;
    const allowed = last && last.type >= ORD_NOAD && last.type < LEFT_NOAD;
    if (!allowed || (last as Noad)[which].mathType !== EMPTY) {
      last = newNoad(ORD_NOAD, a);
      out.push(last);
    }
    (last as Noad)[which] = ad.field(atoms, ctx);
    if (fromSubsup) (last as Noad).scriptTag = a;
  }
  void fromSubsup;
}

/**
 * A braced field (tex.web 1186): a single plain ord noad is replaced by its
 * nucleus; otherwise the field is a sub-mlist (possibly empty).
 */
export function field(ad: LatexAdapter, atoms: AtomLike[] | undefined, ctx: Ctx): Field {
  const f = ad.simplify(ad.list(atoms, ctx));
  const first = atoms?.[0];
  if (first && first.type === "first") f.first = first;
  return f;
}

/** A branch as a sub-mlist field as it stands (a fraction's parts), knowing its branch start. */
export function listField(ad: LatexAdapter, atoms: AtomLike[] | undefined, ctx: Ctx, list: MItem[] = ad.list(atoms, ctx)): Field {
  const f = mlistField(list);
  const first = atoms?.[0];
  if (first && first.type === "first") f.first = first;
  return f;
}

export function simplify(ad: LatexAdapter, list: MItem[]): Field {
  if (list.length === 1) {
    const p = list[0] as Noad;
    if (p.type === ORD_NOAD && p.sub.mathType === EMPTY && p.sup.mathType === EMPTY)
      return p.nucleus.mathType === MATH_CHAR && p.nucleus.tag === undefined ? { ...p.nucleus, tag: p.tag } : { ...p.nucleus };
  }
  return mlistField(list);
}

/** A group `{...}` in a list: an ord noad (or the accent noad it contains). */
export function groupNoad(ad: LatexAdapter, list: MItem[], tag: Tag): Noad {
  if (list.length === 1 && (list[0] as Noad).type === ACCENT_NOAD) return list[0] as Noad;
  const n = newNoad(ORD_NOAD, tag);
  n.nucleus = ad.simplify(list);
  return n;
}

/**
 * Constructs identified by their command rather than their atom type
 * (the kernel leaves some of them untyped). Returns true if handled.
 */
export function commandAtom(ad: LatexAdapter, a: AtomLike, ctx: Ctx, out: MItem[]): boolean {
  const cmd = a.command ?? "";
  const styles: Record<string, number> = {
    "\\displaystyle": DISPLAY_STYLE,
    "\\textstyle": TEXT_STYLE,
    "\\scriptstyle": SCRIPT_STYLE,
    "\\scriptscriptstyle": SCRIPT_SCRIPT_STYLE,
  };
  if (styles[cmd] !== undefined && a.branch("body") !== undefined) {
    // A style declaration: affects the rest of the current list (no group).
    out.push({ type: STYLE_NODE, style: styles[cmd], tag: a });
    out.push(...ad.list(a.branch("body"), ctx));
    return true;
  }
  if ((cmd === "\\overline" || cmd === "\\underline") && a.branch("body") !== undefined) {
    const n = newNoad(cmd === "\\overline" ? OVER_NOAD : UNDER_NOAD, a);
    n.nucleus = ad.field(a.branch("body"), ctx);
    out.push(n);
    return true;
  }
  const classes: Record<string, number> = {
    "\\mathord": ORD_NOAD,
    "\\mathop": OP_NOAD,
    "\\mathbin": BIN_NOAD,
    "\\mathrel": REL_NOAD,
    "\\mathopen": OPEN_NOAD,
    "\\mathclose": CLOSE_NOAD,
    "\\mathpunct": PUNCT_NOAD,
    "\\mathinner": INNER_NOAD,
  };
  if (classes[cmd] !== undefined && a.branch("body") !== undefined) {
    // \mathbin{...} etc.: a noad of that class with a braced nucleus
    const n = newNoad(classes[cmd], a);
    n.nucleus = ad.field(a.branch("body"), ctx);
    if (cmd === "\\mathop" && a.explicitSubsupPlacement) {
      n.subtype = a.subsupPlacement === "over-under" ? LIMITS : a.subsupPlacement === "adjacent" ? NO_LIMITS : NORMAL;
    }
    if (cmd === "\\mathop" && ad.classOperatorItalic) {
      const body = (a.branch("body") ?? []).filter((x) => x.type !== "first");
      const className = body.length === 1 && /^\\(?:class|htmlClass)$/.test(body[0].command ?? "") ? ad.classOf(body[0]) : null;
      const italic = className ? ad.classOperatorItalic(className) : null;
      if (italic && italic > 0) n.italicEm = italic;
    }
    out.push(n);
    return true;
  }
  if (cmd === "\\not" && a.branch("body") !== undefined) {
    const body = (a.branch("body") ?? []).filter((x) => x.type !== "overlap" && x.type !== "first");
    const sign = body.length === 1 ? ad.examZhSign(body[0], true) : null;
    if (sign) {
      out.push(sign);
      return true;
    }
  }
  if (cmd === "\\not" && a.branch("body") !== undefined && ad.meaning("\\n@tch@r")) {
    // newtxmath: \not\foo is \notfoo or \nfoo when defined (\not= \ne, \not< \nless,
    // \not> \ngtr), else \n@tch@r\foo
    const body = (a.branch("body") ?? []).filter((x) => x.type !== "overlap" && x.type !== "first");
    const name = body.length === 1 ? body[0].command ?? body[0].value : undefined;
    const special: Record<string, string> = { "=": "\\ne", "<": "\\nless", ">": "\\ngtr" };
    const bare = name?.startsWith("\\") ? name.slice(1) : name;
    const target = name === undefined ? undefined : special[name] ?? ["\\not" + bare, "\\n" + bare].find((c) => ad.meaning(c));
    if (target) {
      const mc = ad.mathCodeOf(target, ctx);
      if (mc !== null) {
        out.push(ad.mathChar(mc, ctx, a));
        return true;
      }
      const tpl = ad.template(target, a);
      if (tpl) {
        out.push(...tpl);
        return true;
      }
    }
    out.push(ad.mathChar(ad.mathCodeOf("\\n@tch@r", ctx) ?? 0x3236, ctx, a));
    for (const b of body) ad.atom(b, ctx, out);
    return true;
  }
  if (cmd === "\\not" && a.branch("body") !== undefined) {
    // \not = \mathchar"3236 followed by the negated symbol
    out.push(ad.mathChar(ad.mathCodeOf("\\not", ctx) ?? 0x3236, ctx, a));
    for (const b of (a.branch("body") ?? []).filter((x) => x.type !== "overlap")) ad.atom(b, ctx, out);
    return true;
  }
  if (cmd === "\\operatorname" || cmd === "\\operatorname*") {
    out.push(ad.operatorName(a, ctx, cmd === "\\operatorname*" || a.subsupPlacement === "over-under" && !!a.explicitSubsupPlacement));
    return true;
  }
  if (/^\\(?:class|htmlClass|cssId|htmlId|htmlData|style|htmlStyle|href)$/.test(cmd) && a.branch("body") !== undefined) {
    // HTML annotations (MathJax/MathLive): the content takes part in the
    // list as if it were not wrapped; the editor marks its box.
    out.push(...ad.list(a.branch("body"), ctx));
    return true;
  }
  if (cmd === "\\rule") {
    out.push(ad.boxNoad(ad.ruleBox(a), a));
    return true;
  }
  if (cmd === "\\label" || cmd === "\\notag" || cmd === "\\nonumber") {
    // TexType: they draw nothing (an empty glue keeps the atom's place for the caret)
    out.push(ad.hskip(0, a) as MItem);
    return true;
  }
  if (isTagAtom(a)) {
    // a tag where no display line takes it (LaTeX: "\tag not allowed here"): after a \quad
    out.push(ad.hskip(ad.textRoman().param(6), a) as MItem, ad.boxNoad(ad.tagBox(a, ctx), a));
    return true;
  }
  if (isIntertextAtom(a)) {
    // an \intertext outside an alignment: its text in line
    out.push(ad.boxNoad(ad.textModeBox(a.branch("body"), ctx, a), a));
    return true;
  }
  if (cmd in SMART_DOTS) {
    out.push(...ad.smartDots(a, cmd));
    return true;
  }
  if (cmd === "\\mbox" && a.branch("body") !== undefined) {
    // latex.ltx \mbox#1 = \leavevmode\hbox{#1}: text at the document size in every style
    out.push(ad.boxNoad(ad.textModeBox(a.branch("body"), ctx, a), a));
    return true;
  }
  if (ad.packageCommand(a, ctx, out)) return true;
  if (cmd === "\\doubleprime" || cmd === "\\tripleprime" || cmd === "\\qprime") {
    const n = cmd === "\\doubleprime" ? 2 : cmd === "\\tripleprime" ? 3 : 4;
    for (let i = 0; i < n; i++) out.push(ad.mathChar(0x0230, ctx, a));
    return true;
  }
  return false;
}

/**
 * amsmath's dots, which look at the token after them: \dots chooses \dotsc before a comma, \dotsb (\@cdots)
 * before a binary operator or relation (\keybin@, a \mathchar of class 2 or 3, a macro starting with \DOTSB,
 * \mathbin, \mathrel or \not), \dotsi before \DOTSI, else \dotso@; \cdots, \dotsc and \dotso add \, before
 * punctuation or a closing delimiter (\extrap@, \extra@).
 */
export function smartDots(ad: LatexAdapter, a: AtomLike, cmd: string): MItem[] {
  const next = ad.nextToken(a);
  const meaning = next.startsWith("\\") ? (ad.meaning(next) ?? "").replace(/^\\long /, "") : "";
  const body = meaning.startsWith("macro:->") ? meaning.slice(8) : null;
  // \extra@: a closing delimiter, the end of the formula, or a macro starting with \DOTSX
  const extra = RIGHT_DELIM_TOKENS.has(next) || next === "$" || !!body?.startsWith("\\DOTSX");
  let kind: "l" | "c" | "i" = "l";
  let thin = false;
  let which = SMART_DOTS[cmd];
  if (which === "dots") {
    const mathchar = /^\\mathchar"([0-9A-F]+)$/.exec(meaning);
    const cls = mathchar ? Math.floor(parseInt(mathchar[1], 16) / 4096) : -1;
    if (next === ",") which = "dotsc";
    else if (next === "\\not" || "+=<>-*:".includes(next) && next.length === 1 || cls === 2 || cls === 3) which = "dotsb@";
    else if (body?.startsWith("\\not") || body?.startsWith("\\DOTSB") || /^\\math(?:bin|rel)\b/.test(body ?? "")) which = "dotsb@";
    else if (body?.startsWith("\\DOTSI")) which = "dotsi";
    else which = "dotso@";
  }
  if (which === "dotsb@") kind = "c";
  else if (which === "dotsi") kind = "i";
  else if (which === "dotso@") thin = extra;
  else if (which === "dotsc") thin = next === ";" || next === "." || extra;
  else {
    // \extrap@: \cdots (\dotsb, \dotsm) and \dotso
    kind = which === "cdots" ? "c" : "l";
    thin = next === "," || next === ";" || next === "." || extra;
  }
  const items = ad.template(kind === "l" ? "\\ldots" : kind === "c" ? "\\cdots" : "\\dotsi", a) ?? [];
  if (thin) items.push(...(ad.template("\\,", a) ?? []));
  return items;
}

/** The token TeX meets after an atom: "$" at the end of the formula, "}" at the end of another group. */
export function nextToken(ad: LatexAdapter, a: AtomLike): string {
  if ((a.branch("superscript") ?? []).length > 0 || (a.branch("subscript") ?? []).length > 0) return "^";
  let next: AtomLike | undefined;
  try {
    next = (a as { rightSibling?: AtomLike }).rightSibling;
  } catch {
    next = undefined; // an atom outside a kernel tree
  }
  if (!next) {
    const parent = a.parent as AtomLike | undefined;
    if (parent?.type === "root") return "$";
    if (parent?.type === "leftright" && a.parentBranch === "body") return "\\right";
    return "}";
  }
  if (next.type === "subsup") return (next.branch("superscript") ?? []).length > 0 ? "^" : "_";
  return next.command ?? next.value ?? "";
}

/** The class name of a \class / \htmlClass atom. */
export function classOf(ad: LatexAdapter, a: AtomLike): string | null {
  const c = (a as { args?: unknown[] }).args?.[0];
  return typeof c === "string" && c ? c : null;
}

/** Control space "\ ": inter-word glue of the current text font. */
export function controlSpace(ad: LatexAdapter, a: AtomLike): MItem[] {
  const f = ad.textRoman();
  return [
    {
      type: GLUE_NODE,
      spec: { width: f.param(2), stretch: f.param(3), stretchOrder: NORMAL, shrink: f.param(4), shrinkOrder: NORMAL },
      subtype: NORMAL,
      tag: a,
    } as Node,
  ];
}

/** Kernel macro atoms: LaTeX's own definition when it has one, else the expansion. */
export function macro(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "";
  if (cmd === "\\pmod" || cmd === "\\pod") return ad.pmod(a, ctx, cmd === "\\pmod");
  if (cmd === "\\mod") return ad.mod(a, ctx);
  if (cmd === "\\sideset") {
    const items = ad.sideset(a, ctx);
    if (items) return items;
  }
  if (cmd === "\\vcentcolon") {
    // mathtools \mathrel{\mathop\ordinarycolon}: the character itself is the operator's nucleus (centred on the axis)
    const op = newNoad(OP_NOAD, a);
    op.nucleus = ad.mathChar(ad.mathCodeOf(":", ctx) ?? 0x303a, ctx, a).nucleus;
    const rel = newNoad(REL_NOAD, a);
    rel.nucleus = mlistField([op]);
    return [rel];
  }
  if (cmd === "\\substack") {
    const arr = ad.findAtom(a.branch("body"), (x) => x.type === "array");
    if (arr) return [ad.subarray(arr, ctx, "c")];
  }
  // bbm.sty's \mathbbm (its expansion is \mathbb{#1}): letters and digits in the outline alphabet, when there is one
  if (cmd === "\\mathbbm" && ad.fams.has(FAM.bbm)) return ad.list(a.branch("body"), { ...ctx, bbm: true });
  // a package command read with its arguments (physics' \cos[2](x), ...) is its expansion
  const tpl = a.argumentTemplate === undefined ? ad.template(cmd, a) : null;
  if (tpl) return tpl;
  return ad.list(a.branch("body"), ctx);
}

/** amsmath \pmod / \pod: \allowbreak\mkern18mu or 8mu ( [mod\mkern6mu] #1 ) */
export function pmod(ad: LatexAdapter, a: AtomLike, ctx: Ctx, withMod: boolean): MItem[] {
  const arg = (a.branch("body") ?? []).find((x) => x.type === "macro-argument");
  const out: MItem[] = [{ type: 12, penalty: 0, tag: a } as Node]; // \allowbreak
  out.push(ad.muKern((ctx.display ? 18 : 8) * PT, a));
  out.push(ad.mathChar(ad.mathCodeOf("(", ctx)!, ctx, a));
  if (withMod) {
    // \operator@font mod: a group with the letters in the operator font
    const letters = [..."mod"].map((ch) => ad.mathChar(ad.data.meanings.mathcode[ch], { ...ctx, fam: ad.role.rm }, a));
    out.push(ad.groupNoad(letters, a));
    out.push(ad.muKern(6 * PT, a));
  }
  out.push(...ad.list(arg?.branch("body"), ctx));
  out.push(ad.mathChar(ad.mathCodeOf(")", ctx)!, ctx, a));
  return out;
}

/**
 * amsmath \sideset#1#2#3: box0 = #3 measured in display style; box2 an empty \vbox of box0's height and depth;
 * box4 = {\copy2 #1} (the scripts before the operator), box6 = {#3\nolimits#2} (the operator with the scripts
 * after it); then \hbox to\dimen@{}\mathop{\kern-\dimen@\box4\box6} with \dimen@ = \wd4 + \wd0 - \wd6.
 * The operator keeps its limits: scripts after \sideset{..}{..}\sum attach to that \mathop.
 */
export function sideset(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] | null {
  const args = new Map<number, AtomLike>();
  for (const x of a.branch("body") ?? []) if (x.type === "macro-argument" && !args.has(x.argumentIndex)) args.set(x.argumentIndex, x);
  if (!args.has(1) || !args.has(2) || !args.has(3)) return null;
  const display = (items: MItem[]) => ad.mathBox([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad(items, a)], TEXT_STYLE, a);
  const operator = () => ad.list(args.get(3)!.branch("body"), ctx);
  const withScripts = (base: MItem[], scripts: AtomLike) => {
    for (const x of (scripts.branch("body") ?? []).filter((y) => y.type !== "first")) ad.atom(x, ctx, base);
    return base;
  };
  const box0 = display(operator());
  const box2 = newNullBox(a);
  box2.type = VLIST_NODE;
  box2.height = box0.height;
  box2.depth = box0.depth;
  const box4 = display(withScripts([ad.boxNoad(box2, a)], args.get(1)!));
  const op = operator();
  const last = op[op.length - 1] as Noad | undefined;
  if (last?.type === OP_NOAD) last.subtype = NO_LIMITS; // \nolimits
  const box6 = display(withScripts(op, args.get(2)!));
  const dimen = box4.width + box0.width - box6.width;
  const spacer = newNullBox(a);
  spacer.width = dimen;
  const result = newNoad(OP_NOAD, a);
  result.nucleus = mlistField([{ type: KERN_NODE, width: -dimen, subtype: 1, tag: a } as Node, ad.boxNoad(box4, a), ad.boxNoad(box6, a)]);
  return [ad.boxNoad(spacer, a), result];
}

/** amsmath \mod: \allowbreak\mkern18mu or 12mu {\operator@font mod}\,\,#1 */
export function mod(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const arg = (a.branch("body") ?? []).find((x) => x.type === "macro-argument");
  const out: MItem[] = [{ type: 12, penalty: 0, tag: a } as Node]; // \allowbreak
  out.push(ad.muKern((ctx.display ? 18 : 12) * PT, a));
  const letters = [..."mod"].map((ch) => ad.mathChar(ad.data.meanings.mathcode[ch], { ...ctx, fam: ad.role.rm }, a));
  out.push(ad.groupNoad(letters, a));
  for (let i = 0; i < 2; i++) out.push(...(ad.template("\\,", a) ?? []));
  out.push(...ad.list(arg?.branch("body"), ctx));
  return out;
}
