// The LaTeX adapter (latex-adapter.ts): text, phantoms and boxes, over- and under-constructions, cancel.sty,
// braces and extensible arrows.
import type { LatexAdapter } from "./latex-adapter.ts";
import { MAX_DIMEN, decimalToScaled } from "./arith.ts";
import {
  BIN_NOAD,
  CHOICE_NODE,
  DISPLAY_STYLE,
  LIMITS,
  MathTypesetter,
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
  type ChoiceItem,
  type Field,
  type MathEnv,
  type MItem,
  type Noad,
} from "./mlist.ts";
import {
  CHAR_NODE,
  GLUE_NODE,
  HLIST_NODE,
  KERN_NODE,
  MATH_NODE,
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
import { typesetText, type TextToken } from "./text.ts";
import type { TeXFont } from "./tfm.ts";
import {
  ArrowFill,
  AtomLike,
  BASE_CTX,
  Ctx,
  EXT_ARROWS,
  EXT_HARPOONS,
  ExtArrow,
  FAM,
  OT1_ACCENTS,
  OT1_LETTERS,
  OVER_ARROWS,
  PT,
  runTag,
  texScale,
} from "./adapter-tables.ts";

/** amsmath \text: a \mathchoice of \hbox{text} at 10/10/7/5pt. */
export function textRun(ad: LatexAdapter, run: AtomLike[]): Noad {
  const tag = runTag(run);
  const mk = (b: BoxNode): MItem[] => {
    const n = newNoad(ORD_NOAD, tag);
    n.nucleus = boxField(b);
    return [n];
  };
  const choice: ChoiceItem = {
    type: CHOICE_NODE,
    display: mk(ad.textRunBox(run, 0)),
    text: mk(ad.textRunBox(run, 0)),
    script: mk(ad.textRunBox(run, 1)),
    scriptScript: mk(ad.textRunBox(run, 2)),
    tag,
  };
  return ad.groupNoad([choice], tag);
}

/** \hbox of a text run in its font at a size (0, 1, 2: the text, script and scriptscript sizes). */
export function textRunBox(ad: LatexAdapter, run: AtomLike[], sizeIndex: number): BoxNode {
  const s = run[0].style ?? {};
  const t = ad.text;
  const sans = s.fontFamily === "sans-serif" || s.fontFamily === "cmss";
  const mono = s.fontFamily === "monospace" || s.fontFamily === "cmtt";
  const family = sans ? t.sf : mono ? t.tt : t.rm;
  const series = s.fontSeries === "b" || s.fontSeries === "bx" ? t.bold : "m";
  const shape = s.fontShape === "it" ? "it" : s.fontShape === "sl" ? "sl" : s.fontShape === "sc" ? "sc" : "n";
  // Collapse consecutive spaces as TeX's input reader would.
  let tokens: TextToken[] = [];
  let lastSpace = false;
  // a tabular in the text (\text{\begin{tabular}...}) is a box between its words
  const parts: (TextToken[] | BoxNode)[] = [tokens];
  for (const a of run) {
    if (a.type === "array") {
      parts.push(ad.tabularBox(a), (tokens = []));
      lastSpace = false;
      continue;
    }
    const v = a.value ?? "";
    for (const ch of v) {
      if (ch === " " || ch === " ") {
        if (!lastSpace) tokens.push({ kind: "space", tag: a });
        lastSpace = true;
      } else {
        tokens.push({ kind: "char", code: ch.codePointAt(0)!, tag: a });
        lastSpace = false;
      }
    }
  }
  // roman text in the editor's letter font, when one is chosen
  const letters = !sans && !mono ? ad.fams.get(series !== "m" ? (shape === "it" || shape === "sl" ? FAM.letterBfIt : FAM.letterBf) : shape === "it" || shape === "sl" ? FAM.letterIt : FAM.letterUp) : undefined;
  const f = letters?.[sizeIndex] ?? ad.textFont(ad.textId(family, series, shape, t.sizes[sizeIndex]));
  const nodes = parts.flatMap((part) =>
    Array.isArray(part) ? typesetText(letters ? part : ad.encodeText(part), f, 1000, ad.native?.fallback(f.size) ?? null) : [part],
  );
  // \textit, \textsl: \check@icr adds the italic correction (\/) of the last
  // character of slanted text, unless a period or comma follows (\nocorrlist)
  const tail = nodes[nodes.length - 1];
  let next: AtomLike | undefined;
  try {
    next = (run[run.length - 1] as { rightSibling?: AtomLike }).rightSibling;
  } catch {
    next = undefined; // an atom outside a kernel tree (no parent)
  }
  if (!letters && f.param(1) > 0 && tail?.type === CHAR_NODE && next?.value !== "." && next?.value !== ",") {
    const italic = tail.font.charItalic(tail.font.charInfo(tail.char));
    if (italic !== 0) nodes.push({ type: KERN_NODE, width: italic, subtype: 1, tag: tail.tag } as Node);
  }
  return hpack(nodes, 0, undefined, runTag(run));
}

/**
 * The command being typed (\alph...): its raw characters in typewriter type,
 * at the size of the style it is typed in, as a \text is (10pt, 7pt in a
 * script, 5pt in a script's script).
 */
export function latexInput(ad: LatexAdapter, a: AtomLike): MItem {
  const atoms = a.type === "latexgroup" ? a.branch("body") ?? [] : [a];
  const tokens: TextToken[] = [];
  for (const c of atoms) {
    if (c.type === "first") continue;
    for (const ch of c.value ?? "") tokens.push(ch === " " ? { kind: "space", tag: c } : { kind: "char", code: ch.codePointAt(0)!, tag: c });
  }
  const atSize = (size: number): MItem[] => {
    const f = ad.textFont(ad.textId(ad.text.tt, "m", "n", ad.text.sizes[size]));
    const b = hpack(typesetText(tokens, f, 1000, ad.native?.fallback(f.size) ?? null), 0, undefined, a);
    if (atoms[0]?.type === "first") b.firstTag = atoms[0];
    return [ad.boxNoad(b, a)];
  };
  return ad.palette(a, (style) => atSize(style >= SCRIPT_SCRIPT_STYLE ? 2 : style >= SCRIPT_STYLE ? 1 : 0));
}

/**
 * Accented and special Latin letters in the OT1 encoding, as LaTeX's
 * ot1enc.def sets them: é is \'e (\accent19 e, on a dotless i for í), ß is
 * \ss (\char25). Letters the encoding has neither way keep the fallback font.
 */
export function encodeText(ad: LatexAdapter, tokens: TextToken[]): TextToken[] {
  if (ad.text.encoding !== "OT1") return tokens;
  return tokens.map((t) => {
    if (t.kind !== "char" || t.code < 0x80) return t;
    const ch = String.fromCodePoint(t.code);
    const letter = OT1_LETTERS[ch];
    if (letter !== undefined) return { kind: "char", code: letter, tag: t.tag };
    const parts = [...ch.normalize("NFD")];
    if (parts.length !== 2 || parts[0].codePointAt(0)! >= 0x80) return t;
    const accent = OT1_ACCENTS[parts[1].codePointAt(0)!];
    if (accent === undefined) return t;
    const base = parts[0] === "i" ? 0x10 : parts[0] === "j" ? 0x11 : parts[0].codePointAt(0)!;
    return { kind: "accent", accent, code: base, composed: t.code, below: accent === 0x18, tag: t.tag };
  });
}

/** An NFSS font identifier of the profile's encoding ("OT1/cmr/m/n/10"). */
export function textId(ad: LatexAdapter, family: string, series: string, shape: string, size: string): string {
  return `${ad.text.encoding}/${family}/${series}/${shape}/${size}`;
}

export function textFont(ad: LatexAdapter, nfssId: string): TeXFont {
  const name = ad.data.textFonts[nfssId] ?? ad.data.textFonts[ad.textId(ad.text.rm, "m", "n", ad.text.sizes[0])];
  return ad.cache.byFontname(name)!;
}

/**
 * What the editor's caret is measured from (editor-geometry.ts caretMetrics):
 * the roman "d", amsmath's \Mathstrut@ parenthesis and the math italic "x".
 */
export function caretFonts(ad: LatexAdapter): { dHeight: number; paren: { height: number; depth: number }; xWidth: number } {
  const rm = ad.textRoman();
  const of = (ch: string) => {
    const mc = ad.data.meanings.mathcode[ch];
    const f = ad.env.famFnt((mc >> 8) & 15, 0)!;
    return { f, i: f.charInfo(mc & 255) };
  };
  const p = of("("), x = of("x");
  return {
    dHeight: rm.charHeight(rm.charInfo(0x64)),
    paren: { height: p.f.charHeight(p.i), depth: p.f.charDepth(p.i) },
    xWidth: x.f.charWidth(x.i),
  };
}

/** The document's text font at 10pt (\rmfamily, upright, medium): em, ex and inter-word glue. */
export function textRoman(ad: LatexAdapter): TeXFont {
  return ad.textFont(ad.textId(ad.text.rm, "m", "n", ad.text.sizes[0]));
}

/** An \hbox of plain text in one font (used for unknown symbols, errors). */
export function textBox(ad: LatexAdapter, text: string, nfssId: string, tag: Tag): BoxNode {
  const tokens: TextToken[] = [...text].map((ch) => (ch === " " ? { kind: "space", tag } : { kind: "char", code: ch.codePointAt(0)!, tag }));
  const f = ad.textFont(nfssId);
  return hpack(typesetText(tokens, f, 1000, ad.native?.fallback(f.size) ?? null), 0, undefined, tag);
}

export function styleList(ad: LatexAdapter, style: number, a: AtomLike, items: MItem[]): MItem[] {
  return [{ type: STYLE_NODE, style, tag: a }, ...items];
}

/** \mathpalette: one variant per style, as a \mathchoice. */
export function palette(ad: LatexAdapter, a: AtomLike, make: (style: number) => MItem[]): ChoiceItem {
  // every variant is typeset ahead, but only the one for the style TeX meets
  // is kept: the atom scales the editor records come from that one alone
  const scales = ad.env.atomScales;
  ad.env.atomScales = undefined;
  try {
    return {
      type: CHOICE_NODE,
      display: make(DISPLAY_STYLE),
      text: make(TEXT_STYLE),
      script: make(SCRIPT_STYLE),
      scriptScript: make(SCRIPT_SCRIPT_STYLE),
      tag: a,
    };
  } finally {
    ad.env.atomScales = scales;
  }
}

export function boxNoad(ad: LatexAdapter, b: BoxNode, a: Tag, type = ORD_NOAD): Noad {
  const n = newNoad(type, a);
  n.nucleus = boxField(b);
  return n;
}

/** \phantom, \vphantom, \hphantom (latex.ltx \mathph@nt + \finph@nt), \smash. */
export function phantom(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "\\phantom";
  const body = a.branch("body");
  if (cmd === "\\smash") {
    // amsmath \smash[tb]: \setbox\z@\hbox{$\m@th#1{#2}$} then zero ht and/or dp
    const which = a.smashHeight === false ? "b" : a.smashDepth === false ? "t" : "tb";
    return [
      ad.palette(a, (st) => {
        const b = ad.mathBox(ad.styleList(st, a, [ad.groupNoad(ad.list(body, ctx), a)]), TEXT_STYLE, a);
        if (which !== "b") b.height = 0;
        if (which !== "t") b.depth = 0;
        return [ad.boxNoad(b, a)];
      }),
    ];
  }
  const v = cmd !== "\\hphantom";
  const h = cmd !== "\\vphantom";
  return [
    ad.palette(a, (st) => {
      const b0 = ad.mathBox(ad.styleList(st, a, [ad.groupNoad(ad.list(body, ctx), a)]), TEXT_STYLE, a);
      const b2 = newNullBox(a);
      b2.role = "phantom";
      if (v) {
        b2.height = b0.height;
        b2.depth = b0.depth;
      }
      if (h) b2.width = b0.width;
      return [ad.boxNoad(b2, a)];
    }),
  ];
}

/**
 * \boxed{#1} = \fbox{\m@th$\displaystyle#1$}; xcolor \fcolorbox{f}{b}{#1} =
 * \color@b@x{\fboxsep\z@\color{f}\fbox}{\color{b}}{#1}.
 */
export function boxAtom(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "\\boxed";
  if (cmd === "\\boxed" || cmd === "\\fbox") {
    const content = ad.mathBox(ad.styleList(DISPLAY_STYLE, a, ad.list(a.branch("body"), ctx)), TEXT_STYLE, a);
    return [ad.boxNoad(ad.frameBox(content, 3 * PT, undefined, a), a)];
  }
  if (cmd === "\\fcolorbox") {
    const color = (v: unknown) => (v && typeof v === "object" ? (v as { string?: string }).string : typeof v === "string" ? v : undefined);
    // the kernel resolves xcolor names and mixes (frameColorValue, backgroundColorValue)
    const [block, back, noad] = ad.colorBox(ad.textModeBox(a.branch("body"), ctx, a), a.backgroundColorValue ?? color(a.backgroundcolor) ?? "yellow", a);
    const inner = hpack([block as unknown as Node, back as unknown as Node, (noad as Noad).nucleus.box!], 0, undefined, a);
    return [ad.boxNoad(ad.frameBox(inner, 0, a.frameColorValue ?? color(a.framecolor), a), a)];
  }
  return ad.fallback(a, ctx);
}

/**
 * latex.ltx \llap, \rlap, \clap: \hb@xt@\z@{\hss#1}, {#1\hss}, {\hss#1\hss}; mathtools \mathllap etc.:
 * {}\llap{$\m@th<style>{#1}$} in the current style. The kernel reads the argument of \llap in math mode, as
 * MathJax does and the kernel's mhchem relies on: that math keeps the current style (MathJax's \llap); text
 * in it is LaTeX's box of text.
 */
export function overlap(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "";
  const align: Record<string, string> = {
    "\\llap": "l", "\\rlap": "r", "\\clap": "c", "\\mathllap": "l", "\\mathrlap": "r", "\\mathclap": "c",
  };
  const side = align[cmd];
  if (!side) return ad.fallback(a, ctx);
  const hss = (): Node => ({ type: GLUE_NODE, spec: { width: 0, stretch: PT, stretchOrder: 1, shrink: PT, shrinkOrder: 1 }, subtype: NORMAL, tag: a });
  const lap = (content: BoxNode): BoxNode =>
    hpack([...(side !== "r" ? [hss()] : []), content, ...(side !== "l" ? [hss()] : [])], 0, EXACTLY, a);
  const body = a.branch("body");
  const inStyle = (): MItem => ad.palette(a, (st) => [ad.boxNoad(lap(ad.mathBox(ad.styleList(st, a, [ad.groupNoad(ad.list(body, ctx), a)]), TEXT_STYLE, a)), a)]);
  if (!cmd.startsWith("\\math")) {
    const text = (body ?? []).some((x) => x.mode === "text");
    return [text ? ad.boxNoad(lap(ad.textModeBox(body, ctx, a)), a) : inStyle()];
  }
  const empty = newNoad(ORD_NOAD, a);
  empty.nucleus = mlistField([]);
  return [empty, inStyle()];
}

/** latex.ltx \@frameb@x: the box framed by \fboxrule rules \fboxsep away. */
export function frameBox(ad: LatexAdapter, content: BoxNode, fboxsep: number, color: string | undefined, a: AtomLike): BoxNode {
  const fboxrule = decimalToScaled(".4");
  const tempboxa = hpack([newKern(fboxsep, a), content, newKern(fboxsep, a)], 0, undefined, a);
  const tempdima = fboxrule + fboxsep + tempboxa.depth;
  const vglue = (w: number): Node => ({ type: GLUE_NODE, spec: { width: w, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a });
  const innerV = vpackage([vglue(fboxsep), tempboxa, vglue(fboxsep)], 0, undefined, undefined, a);
  const vrule = (): Node => ({ type: RULE_NODE, width: fboxrule, height: -(2 ** 30), depth: -(2 ** 30), tag: a, color });
  const hrule = (): Node => ({ type: RULE_NODE, width: -(2 ** 30), height: fboxrule, depth: 0, tag: a, color });
  const middle = hpack([vrule(), innerV, vrule()], 0, undefined, a);
  const frame = vpackage([hrule(), middle, hrule()], 0, undefined, undefined, a);
  const lowered = hpack([frame], 0, undefined, a);
  lowered.shift = tempdima;
  const outer = hpack([lowered], 0, undefined, a);
  outer.role = "boxed";
  return outer;
}

/** An \hbox of text-mode material: text runs at 10pt, $...$ in text style. */
export function textModeBox(ad: LatexAdapter, atoms: AtomLike[] | undefined, ctx: Ctx, tag: Tag): BoxNode {
  const parts: Node[] = [];
  const visible = (atoms ?? []).filter((x) => x.type !== "first");
  for (const styled of ad.styleRuns(visible, ctx, true)) {
    // TexType: a style run may hold text and $...$ math (\tag{if $x$})
    const runs: AtomLike[][] = [];
    for (const x of styled) {
      const last = runs[runs.length - 1];
      if (last && (last[0].mode === "text") === (x.mode === "text")) last.push(x);
      else runs.push([x]);
    }
    for (const run of runs) {
      if (run[0].mode === "text") parts.push(ad.textRunBox(run, 0));
      else {
        const items: MItem[] = [];
        ad.colouredRuns(run, ctx, items);
        parts.push(ad.mathBox(items, TEXT_STYLE, run[0]));
      }
    }
  }
  return hpack(parts, 0, undefined, tag);
}

/** amsmath \binrel@: the class (bin/rel/ord) of a math list, by measurement. */
export function binrelClass(ad: LatexAdapter, make: () => MItem[], a: AtomLike): number {
  const env: MathEnv = {
    ...ad.env,
    thinMuSkip: { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 },
    medMuSkip: { width: -PT, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 },
    thickMuSkip: { width: PT, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 },
    // a measurement: TeX's own class rules, nothing recorded for the editor
    editorBinSpacing: false,
    atomScales: undefined,
  };
  const box2 = ad.mathBox(make(), TEXT_STYLE, a, env);
  const empty = () => {
    const n = newNoad(ORD_NOAD, a);
    n.nucleus = mlistField([]);
    return n;
  };
  const box0 = ad.mathBox([empty(), ...make(), empty()], TEXT_STYLE, a, env);
  const w = box0.width - box2.width;
  return w < 0 ? BIN_NOAD : w > 0 ? REL_NOAD : ORD_NOAD;
}

export function overUnder(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const cmd = a.command ?? "";
  const body = a.branch("body");
  const above = a.branch("above");
  const below = a.branch("below");
  const nonEmpty = (x: AtomLike[] | undefined) => (x ?? []).some((y) => y.type !== "first");
  if (cmd === "\\stackrel") {
    // \stackrel#1#2 = \mathrel{\mathop{#2}\limits^{#1}}
    const op = newNoad(OP_NOAD, a);
    op.subtype = LIMITS;
    op.nucleus = ad.field(body, ctx);
    op.sup = ad.field(above, ctx);
    const rel = newNoad(REL_NOAD, a);
    rel.nucleus = ad.simplify([op]);
    return [rel];
  }
  if (cmd === "\\overset" || cmd === "\\underset" || cmd === "\\overunderset") {
    // \binrel@{#2}\binrel@@{\mathop{\kern\z@#2}\limits^{#1}}
    const cls = ad.binrelClass(() => ad.list(body, ctx), a);
    const op = newNoad(OP_NOAD, a);
    op.subtype = LIMITS;
    op.nucleus = ad.simplify([newKern(0, a) as unknown as MItem, ...ad.list(body, ctx)]);
    if (cmd !== "\\underset" && nonEmpty(above)) op.sup = ad.field(above, ctx);
    if (cmd !== "\\overset" && nonEmpty(below)) op.sub = ad.field(below, ctx);
    if (cls === ORD_NOAD) return [ad.groupNoad([op], a)];
    const w = newNoad(cls, a);
    w.nucleus = ad.simplify([op]);
    return [w];
  }
  if (cmd === "\\overbrace" || cmd === "\\underbrace") return [ad.brace(a, ctx, cmd === "\\overbrace")];
  const over = OVER_ARROWS[cmd];
  if (over) return [ad.overArrow(a, ctx, over)];
  const ext = EXT_ARROWS[cmd];
  if (ext) return [ad.extArrow(a, ctx, ext)];
  const harpoons = EXT_HARPOONS[cmd];
  if (harpoons) return [ad.extHarpoons(a, ctx, harpoons)];
  return ad.fallback(a, ctx);
}

/** \cancel, \bcancel, \xcancel (the kernel's enclose notations); others keep their content. */
export function enclose(ad: LatexAdapter, a: AtomLike, ctx: Ctx): MItem[] {
  const n = (a.notation ?? {}) as Record<string, boolean>;
  const keys = Object.keys(n).filter((k) => n[k]);
  const up = !!n.updiagonalstrike, down = !!n.downdiagonalstrike;
  if (keys.length === 0 || keys.some((k) => k !== "updiagonalstrike" && k !== "downdiagonalstrike")) return ad.fallback(a, ctx);
  // \cancel = \@can@slash{}, \bcancel = \@can@slash{-}, \xcancel = \@can@slash{+}\@can@slash{-}
  const slashes = up && down ? [1, -1] : down ? [-1] : [1];
  return [ad.palette(a, (st) => ad.cancelBox(slashes, st, a, ctx))];
}

/**
 * cancel.sty \@cancel#1#2#3: the content in an \hbox, vcentred; the slashes
 * (\line in picture mode) and the content overlap in an \ooalign, raised
 * back to the content's baseline.
 */
export function cancelBox(ad: LatexAdapter, slashes: number[], style: number, a: AtomLike, ctx: Ctx): MItem[] {
  // \@begin@tempboxa\hbox{\m@th$#2{#3}$}
  const box0 = ad.mathBox(ad.styleList(style, a, [ad.groupNoad(ad.list(a.branch("body"), ctx), a)]), TEXT_STYLE, a);
  const totalheight = box0.height + box0.depth;
  let dimen = box0.height;
  // \setbox\@tempboxa\hbox{$\m@th\vcenter{\box\@tempboxa}$}
  const vc = newNoad(VCENTER_NOAD, a);
  vc.nucleus = boxField(vpack([box0], a));
  const tempboxa = ad.mathBox([vc], TEXT_STYLE, a);
  dimen -= tempboxa.height;
  const hskip = (w: number, stretch = 0, order = NORMAL): Node => ({ type: GLUE_NODE, spec: { width: w, stretch, stretchOrder: order, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a });
  const hideskip = () => hskip(-1000 * PT, 65536, 2); // \hideskip = -1000pt plus 1fill
  const mathOn = (): Node => ({ type: MATH_NODE, width: 0, subtype: 0, tag: a } as Node);
  const rows: (AlignRow | AlignNoalign)[] = [];
  for (const sign of slashes) {
    const line = hpack(ad.canSlashLine(sign, tempboxa.width, totalheight, a), 0, undefined, a);
    const lv = newNoad(VCENTER_NOAD, a);
    lv.nucleus = boxField(vpack([line], a));
    const ts = new MathTypesetter(ad.env);
    const math = ts.mlistToHlist([lv], TEXT_STYLE, false);
    rows.push({ kind: "row", cells: [[hideskip(), mathOn(), ...math, { ...mathOn(), subtype: 1 } as Node, hideskip()]] });
  }
  rows.push({ kind: "row", cells: [[hskip(0, 65536, 1), tempboxa, hskip(0, 65536, 1)]] });
  // \ooalign = \lineskiplimit-\maxdimen\oalign: \vtop{\baselineskip\z@skip \lineskip.25ex \ialign{...}}
  const ex = ad.textRoman().param(5);
  const v = new VList({ baselineskip: glue(0), lineskip: glue(texScale(".25", ex)), lineskiplimit: -MAX_DIMEN }, a);
  halign(rows, [glue(0)], v, a);
  const vtop = vpack(v.items, a);
  const first = vtop.list[0];
  const h = first && (first.type === HLIST_NODE || first.type === VLIST_NODE || first.type === RULE_NODE) ? (first as BoxNode).height : 0;
  vtop.depth = vtop.depth - h + vtop.height;
  vtop.height = h;
  // {\/\raise\dimen@\hbox{\ooalign{...}}}: in math \/ is a zero kern
  const raised = hpack([vtop], 0, undefined, a);
  raised.shift = -dimen;
  const inner = newNoad(ORD_NOAD, a);
  inner.nucleus = boxField(raised);
  return [ad.groupNoad([newKern(0, a) as unknown as MItem, inner], a)];
}

/** cancel.sty \@can@slash: the slope and length of the slash, then \line. */
export function canSlashLine(ad: LatexAdapter, sign: number, width: number, totalheight0: number, a: AtomLike): Node[] {
  const minPt = (d: number, p: number) => (d < p * PT ? p * PT : d);
  let dimen = minPt(width, 2);
  let totalheight = minPt(totalheight0, 6);
  let x: number, y: number;
  if (totalheight < dimen) {
    // wide
    dimen = minPt(dimen, 8);
    const c = Math.trunc((totalheight * 5) / dimen);
    dimen += 2 * PT;
    [x, y] = [[6, 1], [4, 1], [2, 1], [4, 3]][c] ?? [1, 1];
  } else {
    // tall
    totalheight = minPt(totalheight, 8) + 2 * PT;
    const c = Math.trunc((dimen * 5) / totalheight);
    dimen = texScale([".16", ".25", ".5", ".75"][c] ?? "1", totalheight);
    [x, y] = [[1, 6], [1, 4], [1, 2], [3, 4]][c] ?? [1, 1];
  }
  return ad.pictureSline(x, sign * y, dimen, a);
}

/** latex.ltx \@sline: a slanted \line(x,y){len} of line10 characters (\thinlines). */
export function pictureSline(ad: LatexAdapter, xarg: number, yarg: number, linelen: number, a: AtomLike): Node[] {
  return ad.pictureSlineState(xarg, yarg, linelen, a).out;
}

/** \@sline with the state \@svector goes on with: \@clnht, \wd\@linechar, \@upordown. */
export function pictureSlineState(ad: LatexAdapter, xarg: number, yarg: number, linelen: number, a: AtomLike): { out: Node[]; clnht: number; wd: number; raise: boolean } {
  const f = ad.cache.get("line10");
  const out: Node[] = [];
  const hskip = (w: number): Node => ({ type: GLUE_NODE, spec: { width: w, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag: a });
  const negarg = xarg < 0;
  const yyarg = negarg ? -yarg : yarg;
  if (negarg) xarg = -xarg;
  // \@getlinechar(x,y)
  const c = xarg * 8 - 9 + (yyarg > 0 ? yyarg : -yyarg + 64);
  const info = f.charInfo(c);
  if (!info.exists) return { out, clnht: 0, wd: 0, raise: yarg > 0 };
  const wd = f.charWidth(info), ht = f.charHeight(info);
  if (wd === 0) return { out, clnht: 0, wd: 0, raise: yarg > 0 };
  const raise = yarg > 0; // \@upordown: \raise, else \lower
  const place = (dist: number) => {
    const b = hpack([newCharacter(f, c, a)], 0, undefined, a);
    b.shift = raise ? -dist : dist;
    out.push(b);
  };
  let clnht = raise ? 0 : ht;
  let clnwd = wd;
  if (negarg) out.push(hskip(-wd));
  while (clnwd < linelen) {
    place(clnht);
    if (negarg) out.push(hskip(-2 * wd));
    clnht += ht;
    clnwd += wd;
  }
  clnht -= ht;
  clnwd -= wd;
  let tempdima = linelen - clnwd;
  const tempdimb = tempdima - wd;
  out.push(hskip(negarg ? -tempdimb : tempdimb));
  tempdima *= 1000;
  const tempcnta = Math.trunc(tempdima / wd);
  clnht += Math.trunc((ht * tempcnta) / 1000);
  if (linelen < wd) out.push(hskip(wd));
  else place(clnht);
  return { out, clnht, wd, raise };
}

/** \ialign{##...}: rows of horizontal material in internal vertical mode. */
export function ialignBox(ad: LatexAdapter, items: (AlignRow | AlignNoalign)[], a: AtomLike, vtop = false): BoxNode {
  const v = new VList({ baselineskip: glue(12 * PT), lineskip: glue(PT), lineskiplimit: 0 }, a);
  halign(items, [glue(0)], v, a);
  const box = vpack(v.items, a);
  if (vtop) {
    // \vtop: the reference point moves to the baseline of the first box
    const first = box.list[0];
    const h = first && (first.type === HLIST_NODE || first.type === VLIST_NODE || first.type === RULE_NODE) ? (first as BoxNode).height : 0;
    box.depth = box.depth - h + box.height;
    box.height = h;
  }
  return box;
}

export function kernNoalign(ad: LatexAdapter, w: number, a: AtomLike, nointerline = false): AlignNoalign {
  return {
    kind: "noalign",
    apply: (v) => {
      v.append(newKern(w, a));
      if (nointerline) v.noInterlineSkip();
    },
  };
}

/** fontmath.ltx \downbracefill / \upbracefill as a math formula. */
export function braceFill(ad: LatexAdapter, down: boolean, a: AtomLike): Node[] {
  if (ad.meaning("\\downbracefill")?.includes("\\br@cext")) return ad.braceFillLeaders(down, a);
  const ex = (c: number) => ad.mathChar(0x0300 + c, BASE_CTX, a); // \braceld etc: \mathord fam3
  const ex3 = ad.env.famFnt(3, 0 /* text size */)!; // \textfont3: the height of \braceld
  const ht = ex3.charHeight(ex3.charInfo(0x7a));
  const leaders = (): MItem =>
    ({
      type: GLUE_NODE,
      spec: glue(0, PT, 2),
      subtype: 100,
      leader: { type: RULE_NODE, width: decimalToScaled(".4"), height: ht, depth: 0, tag: a },
      tag: a,
    }) as Node;
  const [l1, r1, l2, r2] = down ? [0x7a, 0x7d, 0x7c, 0x7b] : [0x7c, 0x7b, 0x7a, 0x7d];
  return ad.cellFormula([ex(l1), leaders(), ex(r1), ex(l2), leaders(), ex(r2)], a);
}

/**
 * newtxmath's brace fills: the extension piece \br@cext as \cleaders,
 * $\m@th\braceld\mkern-1mu\cleaders\hbox{$\mkern-.5mu\br@cext\mkern-.5mu$}\hfill\mkern-1mu
 * \braceru\bracelu\mkern-1mu\cleaders...\hfill\mkern-1mu\bracerd$ (\upbracefill: lu rd ld ru).
 */
export function braceFillLeaders(ad: LatexAdapter, down: boolean, a: AtomLike): Node[] {
  const piece = (cmd: string) => ad.mathChar(ad.mathCodeOf(cmd, BASE_CTX) ?? 0, BASE_CTX, a);
  const ext = ad.mathBox([ad.muKern(-PT / 2, a), piece("\\br@cext"), ad.muKern(-PT / 2, a)], TEXT_STYLE, a);
  const leaders = (): MItem => ({ type: GLUE_NODE, spec: glue(0, PT, 2), subtype: 101, leader: ext, tag: a }) as Node;
  const [l1, r1, l2, r2] = down ? ["\\braceld", "\\braceru", "\\bracelu", "\\bracerd"] : ["\\bracelu", "\\bracerd", "\\braceld", "\\braceru"];
  const k = () => ad.muKern(-PT, a);
  return ad.cellFormula([piece(l1), k(), leaders(), k(), piece(r1), piece(l2), k(), leaders(), k(), piece(r2)], a);
}

/** \overbrace / \underbrace: \mathop{\vbox{\ialign{...}}}\limits */
export function brace(ad: LatexAdapter, a: AtomLike, ctx: Ctx, over: boolean): Noad {
  const content = (): Node[] => [
    ad.hfil(a),
    ...ad.cellFormula([{ type: STYLE_NODE, style: DISPLAY_STYLE, tag: a }, ad.groupNoad(ad.list(a.branch("body"), ctx), a)], a),
    ad.hfil(a),
  ];
  const items: (AlignRow | AlignNoalign)[] = over
    ? [ad.kernNoalign(3 * PT, a), { kind: "row", cells: [ad.braceFill(true, a)] }, ad.kernNoalign(3 * PT, a, true), { kind: "row", cells: [content()] }]
    : [{ kind: "row", cells: [content()] }, ad.kernNoalign(3 * PT, a, true), { kind: "row", cells: [ad.braceFill(false, a)] }, ad.kernNoalign(3 * PT, a)];
  const box = ad.ialignBox(items, a, !over);
  box.role = over ? "overbrace" : "underbrace";
  const op = newNoad(OP_NOAD, a);
  op.subtype = LIMITS;
  op.nucleus = boxField(box);
  return op;
}

/** amsmath \arrowfill@ in a given style: $\m@th ... #4#1\mkern-7mu\cleaders\hbox{...}\hfill\mkern-7mu#3$ */
export function arrowFill(ad: LatexAdapter, kind: ArrowFill, style: number, a: AtomLike): Node[] {
  const env: MathEnv = {
    ...ad.env,
    thickMuSkip: glue(0),
    medMuSkip: glue(0),
    thinMuSkip: glue(0),
  };
  const piece = (name: string): MItem[] => {
    if (name === "\\relbar" || name === "\\Relbar") {
      // amsmath: \relbar = \mathrel{\smash-}, \Relbar = \mathrel=
      if (name === "\\Relbar") return [ad.mathChar(0x303d, BASE_CTX, a)];
      const minus = ad.mathChar(ad.data.meanings.mathcode["-"], BASE_CTX, a);
      const smashed = ad.palette(a, (st) => {
        const b = ad.mathBox([{ type: STYLE_NODE, style: st, tag: a }, ad.groupNoad([ad.mathChar(ad.data.meanings.mathcode["-"], BASE_CTX, a)], a)], TEXT_STYLE, a);
        b.height = 0;
        b.depth = 0;
        return [ad.boxNoad(b, a)];
      });
      void minus;
      const rel = newNoad(REL_NOAD, a);
      rel.nucleus = mlistField([smashed]);
      return [rel];
    }
    const mc = ad.mathCodeOf(name, BASE_CTX);
    if (mc !== null) return [ad.mathChar(mc, BASE_CTX, a)];
    // macros (\joinrel, \longrightarrow, ...): LaTeX's math list
    return ad.template(name, a) ?? [];
  };
  const fillPiece = (p: string | string[]): MItem[] =>
    typeof p === "string" ? piece(p) : [ad.groupNoad(p.flatMap((name) => piece(name)), a)];
  const ts = (items: MItem[]): Node[] => {
    const t = new MathTypesetter(env);
    const h = t.mlistToHlist(items, TEXT_STYLE, false);
    const on: Node = { type: MATH_NODE, width: 0, subtype: 0, tag: a };
    return [on, ...h, { ...on }];
  };
  const fillBox = hpack(ts([{ type: STYLE_NODE, style, tag: a }, ad.muKern(-2 * PT, a), ...piece(kind[1]), ad.muKern(-2 * PT, a)]), 0, undefined, a);
  const cleaders: Node = { type: GLUE_NODE, spec: glue(0, PT, 2), subtype: 101, leader: fillBox, tag: a };
  return ts([
    { type: STYLE_NODE, style, tag: a },
    ...fillPiece(kind[0]),
    ad.muKern(-7 * PT, a),
    cleaders as MItem,
    ad.muKern(-7 * PT, a),
    ...fillPiece(kind[2]),
  ]);
}

/** amsmath \overrightarrow etc.: \mathpalette{\overarrow@\rightarrowfill@} */
export function overArrow(ad: LatexAdapter, a: AtomLike, ctx: Ctx, spec: { fill: ArrowFill; under: boolean }): MItem {
  return ad.palette(a, (st) => {
    // $\m@th\hfil#2#3\hfil$ : the \hfil are inside the formula
    const contentRow = ad.cellFormula(
      [
        { type: GLUE_NODE, spec: glue(0, PT, 1), subtype: NORMAL, tag: a } as Node,
        { type: STYLE_NODE, style: st, tag: a },
        ...ad.list(a.branch("body"), ctx),
        { type: GLUE_NODE, spec: glue(0, PT, 1), subtype: NORMAL, tag: a } as Node,
      ],
      a,
    );
    const fill = ad.arrowFill(spec.fill, st, a);
    const items: (AlignRow | AlignNoalign)[] = spec.under
      ? [{ kind: "row", cells: [contentRow] }, ad.kernNoalign(texScale("1.3", PT), a, true), { kind: "row", cells: [fill] }]
      : [{ kind: "row", cells: [fill] }, { kind: "noalign", apply: (v) => v.noInterlineSkip() }, { kind: "row", cells: [contentRow] }];
    const box = ad.ialignBox(items, a, spec.under);
    box.role = "over-arrow";
    return [ad.boxNoad(box, a)];
  });
}

/**
 * amsmath \ext@arrow (\xrightarrow and friends). `phantom`: the label above or below is a \phantom of itself
 * (mathtools' harpoon pairs).
 */
export function extArrow(ad: LatexAdapter, a: AtomLike, ctx: Ctx, spec: ExtArrow, phantom?: "above" | "below"): Noad {
  const [k1, k2, k3, k4] = spec.k;
  const below = a.branch("below");
  const above = a.branch("above");
  const nonEmpty = (x: AtomLike[] | undefined) => (x ?? []).some((y) => y.type !== "first");
  // the label as the macro argument: \phantom{#}, and mathtools' control spaces around it
  const label = (x: AtomLike[] | undefined, which: "above" | "below"): MItem[] => {
    const items = phantom === which ? [ad.phantomOf(() => ad.list(x, ctx), a)] : ad.list(x, ctx);
    const space = (): MItem[] => ad.controlSpace(a);
    return [...(spec.space === "pre" || spec.space === "both" ? space() : []), ...items, ...(spec.space === "post" || spec.space === "both" ? space() : [])];
  };
  const box0 = hpack(ad.arrowFill(spec.fill, DISPLAY_STYLE, a), 0, undefined, a);
  const labelBox = (x: AtomLike[] | undefined, which: "above" | "below") =>
    ad.mathBox([{ type: STYLE_NODE, style: SCRIPT_STYLE, tag: a }, ad.muKern(k3 * PT, a), ad.groupNoad(label(x, which), a), ad.muKern(k4 * PT, a)], TEXT_STYLE, a);
  const w = Math.max(labelBox(below, "below").width, labelBox(above, "above").width, box0.width);
  const arrow = hpack(box0.list, w, EXACTLY, a);
  arrow.role = "ext-arrow";
  const op = newNoad(OP_NOAD, a);
  op.subtype = LIMITS;
  op.nucleus = boxField(arrow);
  const script = (x: AtomLike[] | undefined, which: "above" | "below"): Field => {
    const items: MItem[] = [];
    if (k1 !== 0) items.push(ad.muKern(k1 * PT, a));
    items.push(...label(x, which));
    if (k2 !== 0) items.push(ad.muKern(k2 * PT, a));
    return ad.simplify(items);
  };
  // \@ifnotempty: a label with mathtools' control space or a \phantom is never empty
  if (nonEmpty(above) || spec.space || phantom === "above") op.sup = script(above, "above");
  if (nonEmpty(below) || spec.space || phantom === "below") op.sub = script(below, "below");
  const rel = newNoad(REL_NOAD, a);
  rel.nucleus = mlistField([op]);
  return rel;
}

/** mathtools \xrightleftharpoons, \xleftrightharpoons: two \ext@arrow boxes, raised and lowered by .22ex. */
export function extHarpoons(ad: LatexAdapter, a: AtomLike, ctx: Ctx, [upper, lower]: [ExtArrow, ExtArrow]): Noad {
  const inner: Ctx = { ...ctx, display: false };
  const shift = texScale(".22", ad.textRoman().param(5));
  const top = ad.mathBox([ad.extArrow(a, inner, upper, "below")], TEXT_STYLE, a);
  top.shift = -shift;
  const box0 = ad.mathBox([ad.extArrow(a, inner, lower, "above")], TEXT_STYLE, a);
  box0.shift = shift;
  const rel = newNoad(REL_NOAD, a);
  rel.nucleus = mlistField([ad.boxNoad(top, a), { type: KERN_NODE, width: -box0.width, subtype: NORMAL, tag: a } as Node, ad.boxNoad(box0, a)]);
  return rel;
}

/** latex.ltx \phantom: a \mathpalette box of the material's size, empty. */
export function phantomOf(ad: LatexAdapter, make: () => MItem[], a: AtomLike): MItem {
  return ad.palette(a, (st) => {
    const b0 = ad.mathBox(ad.styleList(st, a, [ad.groupNoad(make(), a)]), TEXT_STYLE, a);
    const b2 = newNullBox(a);
    b2.role = "phantom";
    b2.height = b0.height;
    b2.depth = b0.depth;
    b2.width = b0.width;
    return [ad.boxNoad(b2, a)];
  });
}
