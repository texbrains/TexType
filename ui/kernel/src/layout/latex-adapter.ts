// Kernel atoms -> TeX noads with LaTeX semantics.
//
// Every construct is translated the way LaTeX (with amsmath, amssymb,
// mathtools, mathrsfs, bm, xcolor) would build it: math codes and
// \mathchardefs, TeX's group simplification (tex.web 1186), script attachment
// (tex.web 1176), and the macro definitions of \frac, \genfrac, \sqrt, \root,
// \text, \operatorname, \big, ... Constructs that LaTeX builds as boxes are
// built as boxes by running the TeX engine on the inner formulas.
//
// The atom objects themselves are used as node tags, so the editor can map
// every glyph and region back to the atom that produced it.
//
// The class keeps the entry points, the lists and the helpers; each group of constructs is built in its own module
// (adapter-atoms, -math, -text, -arrays, -displays, -packages; tables in adapter-tables), which the class's one-line
// methods call, so every construct can call any other through the adapter.
import { FontCache, LATEX_PARAMS, familiesFrom, makeEnv, type FamilyTable } from "./latex.ts";
import { MlistJson } from "./mlist-json.ts";
import {
  DISPLAY_STYLE,
  MathTypesetter,
  ORD_NOAD,
  STYLE_NODE,
  TEXT_STYLE,
  charField,
  type ChoiceItem,
  type Delimiter,
  type Field,
  type MathEnv,
  type MItem,
  type Noad,
} from "./mlist.ts";
import {
  GLUE_NODE,
  MATH_NODE,
  NORMAL,
  newKern,
  newNullBox,
  newRule,
  type BoxNode,
  type Node,
  type Tag,
} from "./nodes.ts";
import { hpack } from "./pack.ts";
import { VList, type AlignNoalign, type AlignRow, type VParams } from "./align.ts";
import { type TextToken } from "./text.ts";
import type { TeXFont } from "./tfm.ts";
import { scalePermille, spacingKey, spacingParamScales, spacingPercent, type Spacing } from "./spacing.ts";
import {
  ALPHABET_ROLE,
  ArrayColumn,
  ArrayMarks,
  ArrayParams,
  ArrayPiece,
  ArrowFill,
  AtomLike,
  BASE_CTX,
  CM_ROLES,
  CM_TEXT,
  CellWrapperLike,
  Ctx,
  DisplayLine,
  ExtArrow,
  FAM,
  FamilyRoles,
  LatexData,
  NativeFonts,
  PT,
  ProfileData,
  isTagAtom,
  latexFamilies,
  runTag,
} from "./adapter-tables.ts";
import * as byAtom from "./adapter-atoms.ts";
import * as math from "./adapter-math.ts";
import * as texts from "./adapter-text.ts";
import * as arrays from "./adapter-arrays.ts";
import * as displays from "./adapter-displays.ts";
import * as packages from "./adapter-packages.ts";

export { FAM, PACKAGE_FAMILIES, FACE_GROUP_FAMS, latexFamilies, texScale, autoAlignPoint } from "./adapter-tables.ts";
export type { AtomLike, LatexData, ProfileData, FamilyRoles, RunTag, NativeFonts } from "./adapter-tables.ts";

export class LatexAdapter {
  readonly data: LatexData;
  readonly cache: FontCache;
  readonly fams: FamilyTable;
  readonly env: MathEnv;
  /** the families of the math alphabets and symbol fonts */
  readonly role: FamilyRoles;
  /** families of the bold math version (ProfileData.boldmath) for bm's boxes */
  readonly boldEnv: MathEnv;
  /** NFSS defaults of the profile (\text) */
  readonly text: ProfileData["text"] & { bold: string };
  native: NativeFonts | null = null;
  /**
   * The italic correction (em) of the character a \class{...} box stands for,
   * when it is the nucleus of \mathop (custom symbols drawn on a large
   * operator; LayoutOptions.classOperatorItalic).
   */
  classOperatorItalic: ((className: string) => number | null | undefined) | null = null;
  /** operators drawn from outlines: command -> character code in FAM.paths */
  pathOps = new Map<string, number>();
  /** atoms drawn with a contour oval over their integral signs (\oiiint), filled by each layout */
  readonly ovals = new Set<Tag>();
  /**
   * The formula is being edited (set by each layout): an empty slot gets an
   * empty box where its caret stands, and an empty last row (a line just
   * started with Shift+Enter) is kept, where LaTeX drops a trailing \\.
   */
  editor = false;
  /** the user's spacing adjustments (setSpacing), per mille: \arraycolsep, \arraystretch, \jot */
  arrayColSep = 1000;
  arrayRowSep = 1000;
  alignRowSep = 1000;
  /** the array parameters set before arrays in the current group (\arraystretch, \arraycolsep ...) */
  arrayParams: ArrayParams = {};
  spacingApplied = "";
  readonly json: MlistJson;

  constructor(data: LatexData, cache: FontCache, fams?: FamilyTable) {
    this.data = data;
    this.cache = cache;
    this.fams = fams ?? latexFamilies(cache, data.profile);
    this.role = data.profile ? (data.profile.roles as unknown as FamilyRoles) : CM_ROLES;
    const text = data.profile?.text ?? CM_TEXT;
    // \bfdefault: the bold series the profile's text fonts have (Computer Modern's bx)
    this.text = { ...text, bold: data.textFonts[`${text.encoding}/${text.rm}/bx/n/${text.sizes[0]}`] ? "bx" : "b" };
    this.env = makeEnv(this.fams, LATEX_PARAMS);
    const boldmath = data.profile?.boldmath;
    // Computer Modern's \boldmath: operators cmbx, letters cmmib, symbols cmbsy (fontmath.ltx), the rest unchanged
    const cmBold = (): FamilyTable => new Map([...this.fams, [FAM.rm, this.fams.get(FAM.bf)!], [FAM.mi, this.fams.get(FAM.bm)!], [FAM.sy, this.fams.get(FAM.bmsy)!]]);
    this.boldEnv = makeEnv(boldmath ? new Map([...this.fams, ...familiesFrom(cache, boldmath)]) : cmBold(), LATEX_PARAMS);
    this.json = new MlistJson(cache);
    this.json.charField = (fam, code) => this.letterField(fam, code) ?? charField(fam, code);
  }

  /**
   * The user's spacing adjustments (spacing.ts), null for LaTeX's: they scale
   * the math font parameters and LaTeX's spacing values of every formula laid
   * out after this.
   */
  setSpacing(spacing: Spacing | null): void {
    const key = spacingKey(spacing);
    if (key === this.spacingApplied) return;
    this.spacingApplied = key;
    const { sy, ex } = spacingParamScales(spacing);
    const pm = (k: Parameters<typeof spacingPercent>[1]) => spacingPercent(spacing, k) * 10;
    const muskip = (g: typeof LATEX_PARAMS.thinMuSkip, m: number) => ({ ...g, width: scalePermille(g.width, m), stretch: scalePermille(g.stretch, m), shrink: scalePermille(g.shrink, m) });
    for (const env of [this.env, this.boldEnv]) {
      if (!env) continue;
      env.syScale = Object.keys(sy).length ? sy : undefined;
      env.exScale = Object.keys(ex).length ? ex : undefined;
      env.radicalGap = pm("radicalGap") === 1000 ? undefined : pm("radicalGap");
      env.scriptSpace = scalePermille(LATEX_PARAMS.scriptSpace, pm("scriptSpace"));
      env.delimiterFactor = Math.round((LATEX_PARAMS.delimiterFactor * pm("delimiterSize")) / 1000);
      env.thinMuSkip = muskip(LATEX_PARAMS.thinMuSkip, pm("thinSpace"));
      env.medMuSkip = muskip(LATEX_PARAMS.medMuSkip, pm("medSpace"));
      env.thickMuSkip = muskip(LATEX_PARAMS.thickMuSkip, pm("thickSpace"));
    }
    this.arrayColSep = pm("arrayColSep");
    this.arrayRowSep = pm("arrayRowSep");
    this.alignRowSep = pm("alignRowSep");
  }

  // ---------------------------------------------------------------- entry --
  /** A whole formula: `$\displaystyle ...$` or `$...$`. */
  formula(atoms: AtomLike[], display: boolean): MItem[] {
    this.ovals.clear();
    const out: MItem[] = [{ type: STYLE_NODE, style: display ? DISPLAY_STYLE : TEXT_STYLE }];
    // TexType: a display's own \tag goes to the right end of its line
    const tag = display ? atoms.find((x) => isTagAtom(x)) : undefined;
    if (tag) {
      out.push(this.taggedDisplay(atoms.filter((x) => !isTagAtom(x)), tag, { ...BASE_CTX, display }));
      return out;
    }
    out.push(...this.list(atoms, { ...BASE_CTX, display }));
    return out;
  }

  // ---------------------------------------------------------------- lists --
  /** A math list (the contents of a branch). */
  list(atoms: AtomLike[] | undefined, ctx: Ctx): MItem[] {
    // a group: array parameters set in it (\renewcommand{\arraystretch}...) end with it
    const arrayParams = this.arrayParams;
    const out: MItem[] = [];
    const visible = (atoms ?? []).filter((a) => a.type !== "first");
    // Background runs first (\colorbox), then style runs, as the kernel's
    // LaTeX serializer forms them.
    for (const run of this.styleRuns(visible, ctx, true)) {
      const bg = this.backgroundOf(run[0]);
      if (!bg) {
        this.colouredRuns(run, ctx, out);
        continue;
      }
      // xcolor \colorbox{c}{...}: its argument is set in text mode
      let content: BoxNode;
      if (run[0].mode === "text") content = this.textRunBox(run, 0);
      else {
        const items: MItem[] = [];
        this.colouredRuns(run, ctx, items);
        content = this.mathBox(items, TEXT_STYLE, runTag(run));
      }
      out.push(...this.colorBox(content, bg, runTag(run)));
    }
    const first = atoms?.[0];
    if (this.editor && out.length === 0 && first?.type === "first") {
      // an empty box, as TeX makes of {}, where the empty slot's caret stands
      const empty = newNullBox();
      empty.firstTag = first;
      out.push(this.boxNoad(empty, undefined));
    }
    this.arrayParams = arrayParams;
    return out;
  }

  /** A background colour the atom does not inherit from its parent (\colorbox). */
  backgroundOf(a: AtomLike): string | null {
    const bg = a.style?.backgroundColor;
    if (!bg || bg === "none") return null;
    return a.parent?.style?.backgroundColor === bg ? null : bg;
  }

  /**
   * xcolor \color@b@x: \setbox0\hbox{\kern\fboxsep #1\kern\fboxsep}, its
   * height and depth grown by \fboxsep, then a rule of that size in the colour,
   * \hskip-\wd0, and the box.
   */
  colorBox(content: BoxNode, color: string, tag: Tag): MItem[] {
    const fboxsep = 3 * PT;
    const box0 = hpack([newKern(fboxsep, tag), content, newKern(fboxsep, tag)], 0, undefined, tag);
    box0.height += fboxsep;
    box0.depth += fboxsep;
    const block = newRule(tag);
    block.width = box0.width;
    block.height = box0.height;
    block.depth = box0.depth;
    block.color = color;
    const back: Node = { type: GLUE_NODE, spec: { width: -box0.width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, subtype: NORMAL, tag };
    return [block as unknown as MItem, back as unknown as MItem, this.boxNoad(box0, tag)];
  }

  /** Split atoms into runs that serialize to one style command (or one background). */
  styleRuns(atoms: AtomLike[], ctx: Ctx | undefined, background: boolean): AtomLike[][] {
    const runs: AtomLike[][] = [];
    let cur: AtomLike[] = [];
    let key = "";
    for (const a of atoms) {
      const bg = background ? this.backgroundOf(a) : null;
      const k = background ? (bg ? bg + "|" + (a.mode === "text" ? "text" : "math") : "") : this.styleKey(a, ctx);
      if (cur.length > 0 && k !== key) {
        runs.push(cur);
        cur = [];
      }
      key = k;
      cur.push(a);
    }
    if (cur.length > 0) runs.push(cur);
    return runs;
  }

  styleKey(a: AtomLike, ctx?: Ctx): string {
    // A script carrier (the ^3 of c^3) styled like its base stays in the base's run, so the script attaches to the
    // base inside the style group, as the kernel serializes it (\textcolor{red}{\int_a^bc^3}); styled otherwise it
    // starts a run and attaches to the group before it (\textcolor{red}{c}^3).
    if (ctx?.operator) return "op";
    const s = a.style ?? {};
    if (a.mode === "text") return "text|" + (s.color ?? "") + "|" + (s.fontSeries ?? "") + "|" + (s.fontShape ?? "") + "|" + (s.fontFamily ?? "");
    if (a.type === "latex" || a.mode === "latex") return "latex";
    return [a.mode ?? "math", s.color ?? "", this.alphabetCommand(a) ?? "", this.boldCommand(a) ?? ""].join("|");
  }

  /** The math alphabet command the serializer emits for an atom's style. */
  alphabetCommand(a: AtomLike): string | null {
    const s = a.style ?? {};
    let v: string | undefined = s.variant;
    if (v === undefined) return null;
    if (!["calligraphic", "fraktur", "double-struck", "script", "monospace", "sans-serif"].includes(v) && s.variantStyle)
      v += "-" + s.variantStyle;
    const map: Record<string, string> = {
      calligraphic: "\\mathcal",
      fraktur: "\\mathfrak",
      "double-struck": "\\mathbb",
      script: "\\mathscr",
      monospace: "\\mathtt",
      "sans-serif": "\\mathsf",
      "normal-up": "\\mathrm",
      "normal-italic": "\\mathnormal",
      "main-up": "\\mathrm",
      "main-italic": "\\mathit",
      "ams-up": "\\mathrm",
      "ams-italic": "\\mathit",
      "normal-bolditalic": "\\mathbfit",
      "main-bolditalic": "\\mathbfit",
      "ams-bolditalic": "\\mathbfit",
    };
    return map[v] ?? null;
  }

  boldCommand(a: AtomLike): string | null {
    const s = a.style ?? {};
    if (a.mode !== "math" && a.mode !== undefined) return null;
    if (s.variantStyle !== "bold") return null;
    if (s.variant === "normal") return "\\mathbf";
    return "\\bm";
  }

  /**
   * Atoms of one background as the kernel serializes their styles: \textcolor groups (text and math together) around
   * the alphabet and weight groups, so a colour does not split a + b, and each script stays with its base.
   */
  colouredRuns(atoms: AtomLike[], ctx: Ctx, out: MItem[]): void {
    for (const run of this.colourRuns(atoms, ctx)) {
      const first = run[0];
      const color = first.style?.color;
      // a colour its parent already has makes no group (the serializer writes no \textcolor for it)
      const inherited = !!color && color === first.parent?.style?.color;
      if (!color || inherited || ctx.operator || first.type === "latex" || first.mode === "latex") {
        for (const r of this.styleRuns(run, ctx, false)) this.styledRun(r, ctx, out, inherited);
        continue;
      }
      let rest = run;
      if (rest[0].type === "subsup") {
        // a script coloured apart from its base attaches to what is before it
        this.atom(rest[0], ctx, out);
        rest = rest.slice(1);
        if (rest.length === 0) continue;
      }
      const items: MItem[] = [];
      for (const r of this.styleRuns(rest, ctx, false)) this.styledRun(r, ctx, items, true);
      out.push(this.groupNoad(items, runTag(rest)));
    }
  }

  colourRuns(atoms: AtomLike[], ctx: Ctx): AtomLike[][] {
    const runs: AtomLike[][] = [];
    let cur: AtomLike[] = [];
    let key = "";
    for (const a of atoms) {
      const k = ctx.operator ? "op" : a.style?.color ?? "";
      if (cur.length > 0 && k !== key) {
        runs.push(cur);
        cur = [];
      }
      key = k;
      cur.push(a);
    }
    if (cur.length > 0) runs.push(cur);
    return runs;
  }

  /** Convert a style run; wrap it in the group its style command makes (`colourDone`: inside its colour group). */
  styledRun(run: AtomLike[], ctx: Ctx, out: MItem[], colourDone = false): void {
    const first = run[0];
    if (ctx.operator) {
      for (const a of run) this.atom(a, ctx, out);
      return;
    }
    if (first.type === "subsup") {
      // a script styled apart from its base attaches to what is before it; the rest of the run is styled as usual
      this.atom(first, ctx, out);
      if (run.length > 1) this.styledRun(run.slice(1), ctx, out, colourDone);
      return;
    }
    if (first.mode === "text") {
      out.push(this.textRun(run));
      return;
    }
    if (first.type === "latex" || first.mode === "latex") {
      for (const a of run) out.push(this.latexInput(a));
      return;
    }
    const alphabet = this.alphabetCommand(first);
    const bold = this.boldCommand(first);
    const color = colourDone ? undefined : first.style?.color;
    if (!alphabet && !bold && !color) {
      for (const a of run) this.atom(a, ctx, out);
      return;
    }
    // The command wraps the run in braces (a math group); colour adds its
    // specials inside that group (they occupy no space).
    let inner: Ctx = ctx;
    if (alphabet === "\\mathbfit") inner = { ...inner, fam: this.role.bm };
    else if (alphabet === "\\mathbb" && ctx.bbm) inner = { ...inner, fam: FAM.bbm };
    else if (alphabet) inner = { ...inner, fam: ALPHABET_ROLE[alphabet] ? this.role[ALPHABET_ROLE[alphabet]] ?? -1 : -1 };
    if (bold === "\\mathbf") inner = { ...inner, fam: this.role.bf };
    else if (bold === "\\bm") inner = { ...inner, bold: true };
    const items: MItem[] = [];
    for (const a of run) this.atom(a, inner, items);
    // bm.sty sets each symbol of \bm{...} in its bold font with its own math
    // class, without a group: a bold run keeps the spacing of the same run in
    // normal weight (a + b stays a binary operation); the alphabet and colour
    // commands make a math group
    if (bold === "\\bm" && !alphabet && !color) {
      out.push(...items);
      return;
    }
    out.push(this.groupNoad(items, runTag(run)));
  }

  // ---------------------------------------------------------------- atoms --
  atom(a: AtomLike, ctx: Ctx, out: MItem[]): void { return byAtom.atom(this, a, ctx, out); }

  attachScripts(out: MItem[], a: AtomLike, ctx: Ctx, fromSubsup: boolean): void {
    return byAtom.attachScripts(this, out, a, ctx, fromSubsup);
  }

  field(atoms: AtomLike[] | undefined, ctx: Ctx): Field { return byAtom.field(this, atoms, ctx); }

  listField(atoms: AtomLike[] | undefined, ctx: Ctx, list: MItem[] = this.list(atoms, ctx)): Field {
    return byAtom.listField(this, atoms, ctx, list);
  }

  simplify(list: MItem[]): Field { return byAtom.simplify(this, list); }

  groupNoad(list: MItem[], tag: Tag): Noad { return byAtom.groupNoad(this, list, tag); }

  // ---------------------------------------------------- command dispatch --
  commandAtom(a: AtomLike, ctx: Ctx, out: MItem[]): boolean { return byAtom.commandAtom(this, a, ctx, out); }

  smartDots(a: AtomLike, cmd: string): MItem[] { return byAtom.smartDots(this, a, cmd); }

  nextToken(a: AtomLike): string { return byAtom.nextToken(this, a); }

  classOf(a: AtomLike): string | null { return byAtom.classOf(this, a); }

  controlSpace(a: AtomLike): MItem[] { return byAtom.controlSpace(this, a); }

  macro(a: AtomLike, ctx: Ctx): MItem[] { return byAtom.macro(this, a, ctx); }

  pmod(a: AtomLike, ctx: Ctx, withMod: boolean): MItem[] { return byAtom.pmod(this, a, ctx, withMod); }

  sideset(a: AtomLike, ctx: Ctx): MItem[] | null { return byAtom.sideset(this, a, ctx); }

  mod(a: AtomLike, ctx: Ctx): MItem[] { return byAtom.mod(this, a, ctx); }

  // ------------------------------------------------------------- symbols --
  mathChar(code: number, ctx: Ctx, tag: Tag): Noad { return math.mathChar(this, code, ctx, tag); }

  boldmathChar(cls: number, fam: number, ch: number, tag: Tag): Noad {
    return math.boldmathChar(this, cls, fam, ch, tag);
  }

  poorMansBoldChar(cls: number, fam: number, ch: number, tag: Tag): Noad {
    return math.poorMansBoldChar(this, cls, fam, ch, tag);
  }

  letterField(fam: number, ch: number): Field | null { return math.letterField(this, fam, ch); }

  bmBox(a: AtomLike, ctx: Ctx, make: (ctx: Ctx) => MItem[]): Noad { return math.bmBox(this, a, ctx, make); }

  boldFamily(fam: number): number { return math.boldFamily(this, fam); }

  meaning(cmd: string): string | undefined { return math.meaning(this, cmd); }

  delimiterCodeIn(m: string): number | null { return math.delimiterCodeIn(this, m); }

  mathCodeOf(key: string, ctx: Ctx): number | null { return math.mathCodeOf(this, key, ctx); }

  knowsCommand(cmd: string): boolean { return math.knowsCommand(this, cmd); }

  emboldened(items: MItem[] | null, ctx: Ctx): MItem[] | null { return math.emboldened(this, items, ctx); }

  template(key: string, tag: Tag): MItem[] | null { return math.template(this, key, tag); }

  template1(key: string, tag: Tag): MItem[] | null { return math.template1(this, key, tag); }

  withArgument(items: MItem[] | null, arg: () => MItem[]): MItem[] | null {
    return math.withArgument(this, items, arg);
  }

  symbol(a: AtomLike, ctx: Ctx): MItem[] { return math.symbol(this, a, ctx); }

  examZhSign(a: AtomLike, negated = false): Noad | null { return math.examZhSign(this, a, negated); }

  packageSymbol(cmd: string, ctx: Ctx, tag: Tag): MItem[] | null { return math.packageSymbol(this, cmd, ctx, tag); }

  unknownSymbol(a: AtomLike, _ctx: Ctx, cls = ORD_NOAD): MItem[] { return math.unknownSymbol(this, a, _ctx, cls); }

  // ------------------------------------------------------------- fractions --
  genfrac(a: AtomLike, ctx: Ctx): MItem[] { return math.genfrac(this, a, ctx); }

  cfrac(a: AtomLike, ctx: Ctx): MItem[] { return math.cfrac(this, a, ctx); }

  // ---------------------------------------------------------------- roots --
  surd(a: AtomLike, ctx: Ctx): MItem[] { return math.surd(this, a, ctx); }

  radicalDelimiter(): Delimiter { return math.radicalDelimiter(this); }

  // -------------------------------------------------------------- accents --
  accent(a: AtomLike, ctx: Ctx): Noad { return math.accent(this, a, ctx); }

  // ----------------------------------------------------------- delimiters --
  delimiter(name: string): Delimiter { return math.delimiter(this, name); }

  leftRightOrFence(a: AtomLike, ctx: Ctx): MItem[] { return math.leftRightOrFence(this, a, ctx); }

  leftRight(a: AtomLike, ctx: Ctx): Noad { return math.leftRight(this, a, ctx); }

  middle(a: AtomLike): Noad { return math.middle(this, a); }

  sizedDelim(a: AtomLike): Noad { return math.sizedDelim(this, a); }

  // ------------------------------------------------------------ operators --
  operator(a: AtomLike, ctx: Ctx): MItem[] { return math.operator(this, a, ctx); }

  operatorName(a: AtomLike, ctx: Ctx, star: boolean): Noad { return math.operatorName(this, a, ctx, star); }

  // -------------------------------------------------------------- spacing --
  spacing(a: AtomLike, ctx: Ctx): MItem[] { return math.spacing(this, a, ctx); }

  dimenFromAtom(a: AtomLike, unit = "pt"): number { return math.dimenFromAtom(this, a, unit); }

  ruleBox(a: AtomLike): BoxNode { return math.ruleBox(this, a); }

  muKern(width: number, tag: Tag): MItem { return math.muKern(this, width, tag); }

  muGlue(width: number, tag: Tag): MItem { return math.muGlue(this, width, tag); }

  // ----------------------------------------------------------------- text --
  textRun(run: AtomLike[]): Noad { return texts.textRun(this, run); }

  textRunBox(run: AtomLike[], sizeIndex: number): BoxNode { return texts.textRunBox(this, run, sizeIndex); }

  latexInput(a: AtomLike): MItem { return texts.latexInput(this, a); }

  encodeText(tokens: TextToken[]): TextToken[] { return texts.encodeText(this, tokens); }

  textId(family: string, series: string, shape: string, size: string): string {
    return texts.textId(this, family, series, shape, size);
  }

  textFont(nfssId: string): TeXFont { return texts.textFont(this, nfssId); }

  caretFonts(): { dHeight: number; paren: { height: number; depth: number }; xWidth: number } {
    return texts.caretFonts(this);
  }

  textRoman(): TeXFont { return texts.textRoman(this); }

  textBox(text: string, nfssId: string, tag: Tag): BoxNode { return texts.textBox(this, text, nfssId, tag); }

  // -------------------------------------------------- phantoms and boxes --
  styleList(style: number, a: AtomLike, items: MItem[]): MItem[] { return texts.styleList(this, style, a, items); }

  palette(a: AtomLike, make: (style: number) => MItem[]): ChoiceItem { return texts.palette(this, a, make); }

  boxNoad(b: BoxNode, a: Tag, type = ORD_NOAD): Noad { return texts.boxNoad(this, b, a, type); }

  phantom(a: AtomLike, ctx: Ctx): MItem[] { return texts.phantom(this, a, ctx); }

  boxAtom(a: AtomLike, ctx: Ctx): MItem[] { return texts.boxAtom(this, a, ctx); }

  overlap(a: AtomLike, ctx: Ctx): MItem[] { return texts.overlap(this, a, ctx); }

  frameBox(content: BoxNode, fboxsep: number, color: string | undefined, a: AtomLike): BoxNode {
    return texts.frameBox(this, content, fboxsep, color, a);
  }

  textModeBox(atoms: AtomLike[] | undefined, ctx: Ctx, tag: Tag): BoxNode {
    return texts.textModeBox(this, atoms, ctx, tag);
  }

  // ------------------------------------------------------ over and under --
  binrelClass(make: () => MItem[], a: AtomLike): number { return texts.binrelClass(this, make, a); }

  overUnder(a: AtomLike, ctx: Ctx): MItem[] { return texts.overUnder(this, a, ctx); }

  // ---------------------------------------------------------- cancel.sty --
  enclose(a: AtomLike, ctx: Ctx): MItem[] { return texts.enclose(this, a, ctx); }

  cancelBox(slashes: number[], style: number, a: AtomLike, ctx: Ctx): MItem[] {
    return texts.cancelBox(this, slashes, style, a, ctx);
  }

  canSlashLine(sign: number, width: number, totalheight0: number, a: AtomLike): Node[] {
    return texts.canSlashLine(this, sign, width, totalheight0, a);
  }

  pictureSline(xarg: number, yarg: number, linelen: number, a: AtomLike): Node[] {
    return texts.pictureSline(this, xarg, yarg, linelen, a);
  }

  pictureSlineState(xarg: number, yarg: number, linelen: number, a: AtomLike): { out: Node[]; clnht: number; wd: number; raise: boolean } {
    return texts.pictureSlineState(this, xarg, yarg, linelen, a);
  }

  // ---------------------------------------------------- braces and arrows --
  ialignBox(items: (AlignRow | AlignNoalign)[], a: AtomLike, vtop = false): BoxNode {
    return texts.ialignBox(this, items, a, vtop);
  }

  kernNoalign(w: number, a: AtomLike, nointerline = false): AlignNoalign {
    return texts.kernNoalign(this, w, a, nointerline);
  }

  braceFill(down: boolean, a: AtomLike): Node[] { return texts.braceFill(this, down, a); }

  braceFillLeaders(down: boolean, a: AtomLike): Node[] { return texts.braceFillLeaders(this, down, a); }

  brace(a: AtomLike, ctx: Ctx, over: boolean): Noad { return texts.brace(this, a, ctx, over); }

  arrowFill(kind: ArrowFill, style: number, a: AtomLike): Node[] { return texts.arrowFill(this, kind, style, a); }

  overArrow(a: AtomLike, ctx: Ctx, spec: { fill: ArrowFill; under: boolean }): MItem {
    return texts.overArrow(this, a, ctx, spec);
  }

  extArrow(a: AtomLike, ctx: Ctx, spec: ExtArrow, phantom?: "above" | "below"): Noad {
    return texts.extArrow(this, a, ctx, spec, phantom);
  }

  extHarpoons(a: AtomLike, ctx: Ctx, arg0: [ExtArrow, ExtArrow]): Noad { return texts.extHarpoons(this, a, ctx, arg0); }

  phantomOf(make: () => MItem[], a: AtomLike): MItem { return texts.phantomOf(this, make, a); }

  // --------------------------------------------------------- environments --
  strutDims(): [number, number] { return arrays.strutDims(this); }

  cellFormula(items: MItem[], a: AtomLike): Node[] { return arrays.cellFormula(this, items, a); }

  hfil(a: AtomLike): Node { return arrays.hfil(this, a); }

  hskip(w: number, a: AtomLike): Node { return arrays.hskip(this, w, a); }

  rowCells(row: (AtomLike[] | undefined)[]): { cells: AtomLike[][] } { return arrays.rowCells(this, row); }

  ruleWidth(): number { return arrays.ruleWidth(this); }

  doubleRuleSep(): number { return arrays.doubleRuleSep(this); }

  dimen(text: string | undefined): number | null { return arrays.dimen(this, text); }

  arraySetting(latex: string): boolean { return arrays.arraySetting(this, latex); }

  rowGap(a: AtomLike, r: number): number { return arrays.rowGap(this, a, r); }

  mkpream(spec: string): ArrayColumn[] { return arrays.mkpream(this, spec); }

  piece(p: ArrayPiece, a: AtomLike, ctx: Ctx, colsep: number, gaps: AtomLike[][]): Node[] {
    return arrays.piece(this, p, a, ctx, colsep, gaps);
  }

  declStyle(decl: string, a: AtomLike): MItem[] { return arrays.declStyle(this, decl, a); }

  dropsRow(a: AtomLike, cells: AtomLike[][], r: number, count: number): boolean {
    return arrays.dropsRow(this, a, cells, r, count);
  }

  dashPattern(pattern: string): [number, number] { return arrays.dashPattern(this, pattern); }

  dashLine(pattern: string, vertical: boolean, rw: number, a: AtomLike, length = 0): Node[] {
    return arrays.dashLine(this, pattern, vertical, rw, a, length);
  }

  parseRule(src: string | undefined): { name: string; args: { kind: string; value: string }[] } {
    return arrays.parseRule(this, src);
  }

  ruleColumns(range: string | undefined, ncols: number): [number, number] {
    return arrays.ruleColumns(this, range, ncols);
  }

  tableRules(rules: readonly string[], a: AtomLike, ncols: number, items: (AlignRow | AlignNoalign)[], marks: ArrayMarks): void {
    return arrays.tableRules(this, rules, a, ncols, items, marks);
  }

  multirowBox(w: Extract<CellWrapperLike, { command: "\\multirow" }>, content: Node[], arH: number, arD: number, a: AtomLike): BoxNode {
    return arrays.multirowBox(this, w, content, arH, arD, a);
  }

  hdots(spacing: string | undefined, a: AtomLike): MItem[] { return arrays.hdots(this, spacing, a); }

  latexArray(a: AtomLike, spec: string, arraystretch: string, ctx: Ctx, cellStyle: number | null = null, tabular = false): Noad {
    return arrays.latexArray(this, a, spec, arraystretch, ctx, cellStyle, tabular);
  }

  dashColumns(vitems: Node[], items: (AlignRow | AlignNoalign)[], rowBoxes: BoxNode[], dataRows: WeakSet<AlignRow>, marks: ArrayMarks, dashes: { holder: BoxNode; key: string; pattern: string; offset: number; row: AlignRow }[], rw: number, a: AtomLike): void {
    return arrays.dashColumns(this, vitems, items, rowBoxes, dataRows, marks, dashes, rw, a);
  }

  tabularBox(a: AtomLike): BoxNode { return arrays.tabularBox(this, a); }

  leftRightWrap(a: AtomLike, left: string, right: string, body: MItem[]): Noad {
    return arrays.leftRightWrap(this, a, left, right, body);
  }

  nullBox(a: AtomLike): Noad { return arrays.nullBox(this, a); }

  arrayEnv(a: AtomLike, ctx: Ctx): MItem[] { return arrays.arrayEnv(this, a, ctx); }

  amsStrut(a: AtomLike): BoxNode { return arrays.amsStrut(this, a); }

  spreadParams(): VParams { return arrays.spreadParams(this); }

  alignedEnv(a: AtomLike, ctx: Ctx, alignedat: boolean): MItem[] { return arrays.alignedEnv(this, a, ctx, alignedat); }

  gatheredEnv(a: AtomLike, ctx: Ctx): MItem[] { return arrays.gatheredEnv(this, a, ctx); }

  findAtom(atoms: AtomLike[] | undefined, pred: (x: AtomLike) => boolean): AtomLike | null {
    return arrays.findAtom(this, atoms, pred);
  }

  subarray(a: AtomLike, ctx: Ctx, align: "c" | "l"): Noad { return arrays.subarray(this, a, ctx, align); }

  smallMatrixEnv(a: AtomLike, ctx: Ctx): MItem[] { return arrays.smallMatrixEnv(this, a, ctx); }

  // ------------------------------------------------- display environments --
  displayWidth(): number { return displays.displayWidth(this); }

  minTagSep(): number { return displays.minTagSep(this); }

  jot(): number { return displays.jot(this); }

  tagBox(a: AtomLike, ctx: Ctx): BoxNode { return displays.tagBox(this, a, ctx); }

  taggedDisplay(atoms: AtomLike[], tag: AtomLike, ctx: Ctx): Noad {
    return displays.taggedDisplay(this, atoms, tag, ctx);
  }

  gatherLines(lines: { list: Node[]; tag: BoxNode | null }[]): BoxNode[] { return displays.gatherLines(this, lines); }

  displayLines(a: AtomLike): DisplayLine[] { return displays.displayLines(this, a); }

  intertextNoalign(x: AtomLike, ctx: Ctx, lineskiplimit: number): AlignNoalign {
    return displays.intertextNoalign(this, x, ctx, lineskiplimit);
  }

  displayEnv(a: AtomLike, env: string, ctx: Ctx): MItem[] { return displays.displayEnv(this, a, env, ctx); }

  displayBox(v: VList): BoxNode { return displays.displayBox(this, v); }

  positioned(box: BoxNode, a: AtomLike): Noad { return displays.positioned(this, box, a); }

  mathtoolsCases(a: AtomLike, env: string, ctx: Ctx): MItem[] { return displays.mathtoolsCases(this, a, env, ctx); }

  // ------------------------------------------- package commands (TexType) --
  packageCommand(a: AtomLike, ctx: Ctx, out: MItem[]): boolean { return packages.packageCommand(this, a, ctx, out); }

  argDimen(a: AtomLike, i: number): number | null { return packages.argDimen(this, a, i); }

  bracket(a: AtomLike, ctx: Ctx, over: boolean): Noad { return packages.bracket(this, a, ctx, over); }

  cancelTo(a: AtomLike, ctx: Ctx, style: number): MItem[] { return packages.cancelTo(this, a, ctx, style); }

  pictureSvector(xarg: number, yarg: number, linelen: number, a: AtomLike): Node[] {
    return packages.pictureSvector(this, xarg, yarg, linelen, a);
  }

  frameBoxTo(a: AtomLike, ctx: Ctx): BoxNode { return packages.frameBoxTo(this, a, ctx); }

  indexLists(items: AtomLike[] | undefined, ctx: Ctx, star: boolean): { sps: MItem[]; sbs: MItem[] } {
    return packages.indexLists(this, items, ctx, star);
  }

  attachIndexScripts(out: MItem[], sps: MItem[], sbs: MItem[], tag: Tag): void {
    return packages.attachIndexScripts(this, out, sps, sbs, tag);
  }

  indices(a: AtomLike, ctx: Ctx, out: MItem[], star: boolean): void {
    return packages.indices(this, a, ctx, out, star);
  }

  tensor(a: AtomLike, ctx: Ctx, style: number, star: boolean): MItem[] {
    return packages.tensor(this, a, ctx, style, star);
  }

  chemLlap(a: AtomLike, ctx: Ctx): MItem { return packages.chemLlap(this, a, ctx); }

  chemMinispace(a: AtomLike): MItem { return packages.chemMinispace(this, a); }

  chemArrow(a: AtomLike, ctx: Ctx): Noad { return packages.chemArrow(this, a, ctx); }

  // --------------------------------------------------------- editor atoms --
  /** An empty slot: a box the size of a capital letter, drawn by the painter. */
  /**
   * A placeholder takes the place of an x, as in the TexType kernel: the
   * formula is laid out as if an x were there, and the editor paints its
   * marker over that box instead of the glyph.
   */
  placeholder(a: AtomLike, ctx: Ctx): Noad {
    return this.mathChar(this.mathCodeOf("x", ctx) ?? 0x7178, ctx, a);
  }

  fallback(a: AtomLike, ctx: Ctx): MItem[] {
    // Unknown construct: render its body (if any) as a group, else its value.
    const body = a.branch("body");
    if (body) return [this.groupNoad(this.list(body, ctx), a)];
    if (a.value || a.command) return this.symbol(a, ctx);
    return [];
  }

  // -------------------------------------------------------------- helpers --
  /** \hbox{$\m@th ...$}: typeset a math list from a starting style. */
  mathBox(list: MItem[], style: number, tag: Tag, env?: MathEnv): BoxNode {
    const ts = new MathTypesetter(env ?? this.env);
    const h = ts.mlistToHlist(list, style, false);
    const on: Node = { type: MATH_NODE, width: 0, subtype: 0, tag };
    return hpack([on, ...h, { ...on }], 0, undefined, tag);
  }
}
