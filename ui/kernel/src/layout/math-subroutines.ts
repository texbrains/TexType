// TeX's subroutines for math mode (tex.web part 35, 699-718): font parameters, the small box
// constructors, delimiters built to a size, and glue and kerns in math units. The math typesetter
// (mlist.ts, part 36) extends this class.
import { div, half, nxPlusY, remainder, xnOverD, xOverN } from "./arith.ts";
import {
  EXPLICIT,
  MU_GLUE,
  NORMAL,
  VLIST_NODE,
  SS_GLUE,
  isCharNode,
  newCharacter,
  newGlue,
  newKern,
  newNullBox,
  newRule,
  type BoxNode,
  type GlueSpec,
  type KernNode,
  type RuleNode,
  type Tag,
} from "./nodes.ts";
import { EXACTLY, hpack, vpack } from "./pack.ts";
import { scalePermille } from "./spacing.ts";
import { EXT_TAG, LIST_TAG, NULL_CHARACTER, type CharInfo, type TeXFont } from "./tfm.ts";
import {
  type Delimiter,
  SCRIPT_STYLE,
  TEXT_SIZE,
  TEXT_STYLE,
} from "./noads.ts";

/** Everything the math typesetter needs from its surroundings. */
export interface MathEnv {
  /** fam_fnt(fam + size): the font for a family at size code 0/16/32. */
  famFnt(fam: number, size: number): TeXFont | null;
  nullDelimiterSpace: number;
  scriptSpace: number;
  delimiterFactor: number;
  delimiterShortfall: number;
  thinMuSkip: GlueSpec;
  medMuSkip: GlueSpec;
  thickMuSkip: GlueSpec;
  binOpPenalty: number;
  relPenalty: number;
  /** Called for a character that does not exist in its font (char_warning). */
  charWarning?(font: TeXFont, char: number): void;
  /**
   * Editor layouts: a Bin atom becomes Ord only through what precedes it
   * (tex.web 729, a leading minus). TeX also makes it Ord at the end of a list
   * and before a Rel, Close, Punct or \right (tex.web 728-729), so an operator
   * just typed would move once the next atom is typed after it.
   */
  editorBinSpacing?: boolean;
  /**
   * Editor layouts: filled with the font scale each atom is set at (1 text,
   * 0.7 script, 0.5 script's script), so the editor sizes the caret by the
   * style the atom is in, also for a structure or a delimiter whose glyphs
   * come from a font of another size. The last noad of a tag counts: the
   * formula's own pass comes after the boxes the adapter typesets ahead.
   */
  atomScales?: Map<Tag, number>;
  /**
   * The user's spacing adjustments (spacing.ts): per-mille factors of the
   * symbol font's (family 2) and extension font's (family 3) \fontdimen
   * values by number, and of the radical clearance. Absent: as LaTeX.
   */
  syScale?: Record<number, number>;
  exScale?: Record<number, number>;
  radicalGap?: number;
}

export class MathSubroutines {
  curStyle = TEXT_STYLE;
  curSize = TEXT_SIZE;
  curMu = 0;
  mlistPenalties = false;
  protected curF: TeXFont | null = null;
  protected curC = 0;
  protected curI: CharInfo = NULL_CHARACTER;
  /** tag given to nodes created while translating the current noad */
  protected curTag: Tag = undefined;

  readonly env: MathEnv;

  constructor(env: MathEnv) {
    this.env = env;
  }

  // --- font parameters (tex.web 700-701) ---------------------------------
  protected mathsy(k: number, size: number): number {
    const f = this.env.famFnt(2, size);
    if (!f) throw new Error("math family 2 is undefined");
    const m = this.env.syScale?.[k];
    return m === undefined ? f.param(k) : scalePermille(f.param(k), m);
  }
  protected mathXHeight(s: number) { return this.mathsy(5, s); }
  protected mathQuad(s: number) { return this.mathsy(6, s); }
  protected num1(s: number) { return this.mathsy(8, s); }
  protected num2(s: number) { return this.mathsy(9, s); }
  protected num3(s: number) { return this.mathsy(10, s); }
  protected denom1(s: number) { return this.mathsy(11, s); }
  protected denom2(s: number) { return this.mathsy(12, s); }
  protected sup1(s: number) { return this.mathsy(13, s); }
  protected sup2(s: number) { return this.mathsy(14, s); }
  protected sup3(s: number) { return this.mathsy(15, s); }
  protected sub1(s: number) { return this.mathsy(16, s); }
  protected sub2(s: number) { return this.mathsy(17, s); }
  protected supDrop(s: number) { return this.mathsy(18, s); }
  protected subDrop(s: number) { return this.mathsy(19, s); }
  protected delim1(s: number) { return this.mathsy(20, s); }
  protected delim2(s: number) { return this.mathsy(21, s); }
  protected axisHeight(s: number) { return this.mathsy(22, s); }

  protected mathex(k: number): number {
    const f = this.env.famFnt(3, this.curSize);
    if (!f) throw new Error("math family 3 is undefined");
    const m = this.env.exScale?.[k];
    return m === undefined ? f.param(k) : scalePermille(f.param(k), m);
  }
  protected defaultRuleThickness() { return this.mathex(8); }
  protected bigOpSpacing1() { return this.mathex(9); }
  protected bigOpSpacing2() { return this.mathex(10); }
  protected bigOpSpacing3() { return this.mathex(11); }
  protected bigOpSpacing4() { return this.mathex(12); }
  protected bigOpSpacing5() { return this.mathex(13); }

  /** The font scale of a style's size against the text size (in the roman family). */
  protected styleScale(style: number): number {
    const size = style < SCRIPT_STYLE ? TEXT_SIZE : 16 * div(style - TEXT_STYLE, 2);
    const f = this.env.famFnt(0, size);
    const t = this.env.famFnt(0, TEXT_SIZE);
    return f && t ? f.size / t.size : 1;
  }

  /** tex.web 703: set cur_size and cur_mu from cur_style. */
  protected setSize(): void {
    if (this.curStyle < SCRIPT_STYLE) this.curSize = TEXT_SIZE;
    else this.curSize = 16 * div(this.curStyle - TEXT_STYLE, 2);
    this.curMu = xOverN(this.mathQuad(this.curSize), 18);
  }

  // --- small constructors (tex.web 704-705) --------------------------------
  protected fractionRule(t: number): RuleNode {
    const p = newRule(this.curTag);
    p.height = t;
    p.depth = 0;
    return p;
  }

  protected overbar(b: BoxNode, k: number, t: number): BoxNode {
    return vpack([newKern(t, this.curTag), this.fractionRule(t), newKern(k, this.curTag), b], this.curTag);
  }

  // --- delimiters (tex.web 706-714) ----------------------------------------
  protected charBox(f: TeXFont, c: number): BoxNode {
    const q = f.charInfo(c);
    const b = newNullBox(this.curTag);
    b.width = f.charWidth(q) + f.charItalic(q);
    b.height = f.charHeight(q);
    b.depth = f.charDepth(q);
    b.list = [newCharacter(f, c, this.curTag)];
    return b;
  }

  protected stackIntoBox(b: BoxNode, f: TeXFont, c: number): void {
    const p = this.charBox(f, c);
    b.list.unshift(p);
    b.height = p.height;
  }

  protected heightPlusDepth(f: TeXFont, c: number): number {
    const q = f.charInfo(c);
    return f.charHeight(q) + f.charDepth(q);
  }

  varDelimiter(d: Delimiter, s: number, v: number): BoxNode {
    let f: TeXFont | null = null;
    let c = 0;
    let w = 0;
    let largeAttempt = false;
    let z = d.smallFam;
    let x = d.smallChar;
    let q: CharInfo = NULL_CHARACTER;
    found: for (;;) {
      if (z !== 0 || x !== 0) {
        let zz = z + s + 16;
        do {
          zz = zz - 16;
          const g = this.env.famFnt(z, zz - z);
          if (g) {
            let y = x;
            if (y >= g.bc && y <= g.ec) {
              for (;;) {
                q = g.charInfo(y);
                if (!q.exists) break;
                if (q.tag === EXT_TAG) {
                  f = g;
                  c = y;
                  break found;
                }
                const u = g.charHeight(q) + g.charDepth(q);
                if (u > w) {
                  f = g;
                  c = y;
                  w = u;
                  if (u >= v) break found;
                }
                if (q.tag !== LIST_TAG) break;
                y = q.rem;
              }
            }
          }
        } while (zz - z >= 16);
      }
      if (largeAttempt) break found;
      largeAttempt = true;
      z = d.largeFam;
      x = d.largeChar;
    }
    let b: BoxNode;
    if (f) {
      if (q.tag === EXT_TAG) b = this.extensible(f, q.rem, v);
      else b = this.charBox(f, c);
    } else {
      b = newNullBox(this.curTag);
      b.width = this.env.nullDelimiterSpace;
    }
    b.shift = half(b.height - b.depth) - this.axisHeight(s);
    return b;
  }

  protected extensible(f: TeXFont, rem: number, v: number): BoxNode {
    const b = newNullBox(this.curTag);
    b.type = VLIST_NODE;
    const [top, mid, bot, rep] = f.exten[rem];
    let c = rep;
    const u = this.heightPlusDepth(f, c);
    let w = 0;
    const q = f.charInfo(c);
    b.width = f.charWidth(q) + f.charItalic(q);
    if (bot !== 0) w += this.heightPlusDepth(f, bot);
    if (mid !== 0) w += this.heightPlusDepth(f, mid);
    if (top !== 0) w += this.heightPlusDepth(f, top);
    let n = 0;
    if (u > 0) {
      while (w < v) {
        w += u;
        n++;
        if (mid !== 0) w += u;
      }
    }
    c = bot;
    if (c !== 0) this.stackIntoBox(b, f, c);
    c = rep;
    for (let m = 1; m <= n; m++) this.stackIntoBox(b, f, c);
    c = mid;
    if (c !== 0) {
      this.stackIntoBox(b, f, c);
      c = rep;
      for (let m = 1; m <= n; m++) this.stackIntoBox(b, f, c);
    }
    c = top;
    if (c !== 0) this.stackIntoBox(b, f, c);
    b.depth = w - b.height;
    return b;
  }

  /** tex.web 715 */
  rebox(b: BoxNode, w: number): BoxNode {
    if (b.width !== w && b.list.length > 0) {
      if (b.type === VLIST_NODE) b = hpack([b], 0, undefined, this.curTag);
      let list = b.list;
      const p = list[0];
      if (isCharNode(p) && list.length === 1) {
        const v = p.font.charWidth(p.font.charInfo(p.char));
        if (v !== b.width) list = [p, newKern(b.width - v, this.curTag)];
      }
      const r = hpack([newGlue(SS_GLUE, this.curTag), ...list, newGlue(SS_GLUE, this.curTag)], w, EXACTLY, b.tag ?? this.curTag);
      if (b.role) r.role = b.role;
      return r;
    }
    b.width = w;
    return b;
  }

  /** tex.web 716 */
  protected mathGlue(g: GlueSpec, m: number): GlueSpec {
    let n = xOverN(m, 0o200000);
    let f = remainder();
    if (f < 0) {
      n--;
      f += 0o200000;
    }
    const muMult = (x: number) => nxPlusY(n, x, xnOverD(x, f, 0o200000));
    return {
      width: muMult(g.width),
      stretchOrder: g.stretchOrder,
      stretch: g.stretchOrder === NORMAL ? muMult(g.stretch) : g.stretch,
      shrinkOrder: g.shrinkOrder,
      shrink: g.shrinkOrder === NORMAL ? muMult(g.shrink) : g.shrink,
    };
  }

  /** tex.web 717 */
  protected mathKern(p: KernNode, m: number): void {
    if (p.subtype === MU_GLUE) {
      let n = xOverN(m, 0o200000);
      let f = remainder();
      if (f < 0) {
        n--;
        f += 0o200000;
      }
      p.width = nxPlusY(n, p.width, xnOverD(p.width, f, 0o200000));
      p.subtype = EXPLICIT;
    }
  }
}
