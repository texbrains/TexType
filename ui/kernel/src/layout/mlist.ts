// TeX's math typesetting (tex.web part 36; part 34 is noads.ts, part 35 math-subroutines.ts), ported
// literally, including the e-TeX changes that pdfTeX (and therefore `latex`) uses for \middle.
//
// Lists are arrays instead of linked lists. Every node created while
// translating a noad gets that noad's `tag`, so the editor can find which
// formula atom produced which glyphs; tags never change any dimension.
import { div, half } from "./arith.ts";
import {
  GLUE_NODE,
  HLIST_NODE,
  KERN_NODE,
  MU_GLUE,
  COND_MATH_GLUE,
  NORMAL,
  PENALTY_NODE,
  RULE_NODE,
  VLIST_NODE,
  isCharNode,
  newCharacter,
  newGlue,
  newKern,
  newNullBox,
  newPenalty,
  type BoxNode,
  type GlueNode,
  type KernNode,
  type Node,
  type RuleNode,
} from "./nodes.ts";
import { hpack, vpack } from "./pack.ts";
import { scalePermille } from "./spacing.ts";
import { KERN_FLAG, LIG_TAG, LIST_TAG, NULL_CHARACTER, STOP_FLAG } from "./tfm.ts";
import {
  ACCENT_NOAD,
  BIN_NOAD,
  CHOICE_NODE,
  CLOSE_NOAD,
  type ChoiceItem,
  DEFAULT_CODE,
  EMPTY,
  FRACTION_NOAD,
  type Field,
  INF_PENALTY,
  INNER_NOAD,
  LEFT_NOAD,
  LIMITS,
  MATH_CHAR,
  MATH_TEXT_CHAR,
  MED_MU_SKIP_CODE,
  type MItem,
  NULL_DELIMITER,
  type Noad,
  OPEN_NOAD,
  OP_NOAD,
  ORD_NOAD,
  OVER_NOAD,
  PUNCT_NOAD,
  RADICAL_NOAD,
  REL_NOAD,
  RIGHT_NOAD,
  SCRIPT_SCRIPT_SIZE,
  SCRIPT_SIZE,
  SCRIPT_STYLE,
  STYLE_NODE,
  SUB_BOX,
  SUB_MLIST,
  type StyleItem,
  TEXT_SIZE,
  TEXT_STYLE,
  THICK_MU_SKIP_CODE,
  THIN_MU_SKIP_CODE,
  UNDER_NOAD,
  VCENTER_NOAD,
  crampedStyle,
  denomStyle,
  emptyField,
  isNoad,
  newNoad,
  numStyle,
  subStyle,
  supStyle,
} from "./noads.ts";
import { MathSubroutines, type MathEnv } from "./math-subroutines.ts";


// The noads are part of the math list interface of this module.
export * from "./noads.ts";

// The 8x8 inter-atom spacing table (tex.web 764).
const MATH_SPACING = "02340001" + "22*40001" + "33**3**3" + "44*04004" + "00*00000" + "02340001" + "11*11111" + "12341011";

export type { MathEnv };

export class MathTypesetter extends MathSubroutines {
  // --- clean_box and fetch (tex.web 720-724) --------------------------------
  cleanBox(p: Field, s: number): BoxNode {
    let q: Node[];
    let mlist: MItem[] | null = null;
    switch (p.mathType) {
      case MATH_CHAR: {
        const n = newNoad(ORD_NOAD, p.tag ?? this.curTag);
        n.nucleus = { ...p };
        mlist = [n];
        break;
      }
      case SUB_BOX:
        q = [p.box!];
        break;
      case SUB_MLIST:
        mlist = p.list!;
        break;
      default:
        q = [newNullBox(this.curTag)];
        break;
    }
    if (mlist) {
      const saveStyle = this.curStyle;
      const saveTag = this.curTag;
      q = this.mlistToHlist(mlist, s, false);
      this.curTag = saveTag;
      this.curStyle = saveStyle;
      this.setSize();
    }
    let x: BoxNode;
    const first = q![0];
    if (first === undefined || isCharNode(first)) x = hpack(q!, 0, undefined, this.curTag);
    else if (q!.length === 1 && first.type <= VLIST_NODE && (first as BoxNode).shift === 0) x = first as BoxNode;
    else x = hpack(q!, 0, undefined, this.curTag);
    // Simplify a trivial box (tex.web 721): drop an unneeded italic correction
    // kern but keep the box width.
    const l = x.list;
    if (isCharNode(l[0]) && l.length === 2 && !isCharNode(l[1]) && l[1].type === KERN_NODE) {
      x.list = [l[0]];
    }
    if (p.first !== undefined && x.firstTag === undefined) x.firstTag = p.first;
    // the scale of the field's slot, also when it is empty (a script just opened)
    if (p.first !== undefined) this.env.atomScales?.set(p.first, this.styleScale(s));
    return x;
  }

  private fetch(a: Field): void {
    this.curC = a.char!;
    this.curF = this.env.famFnt(a.fam!, this.curSize);
    if (!this.curF) {
      this.curI = NULL_CHARACTER;
      a.mathType = EMPTY;
      return;
    }
    this.curI = this.curF.charInfo(this.curC);
    if (!this.curI.exists) {
      this.env.charWarning?.(this.curF, this.curC);
      a.mathType = EMPTY;
      this.curI = NULL_CHARACTER;
    }
  }

  // --- mlist_to_hlist (tex.web 726-767) -------------------------------------
  mlistToHlist(mlist: MItem[], style: number, penalties: boolean): Node[] {
    this.curStyle = style;
    this.mlistPenalties = penalties;
    let r: Noad | null = null;
    let rType = OP_NOAD;
    let maxH = 0;
    let maxD = 0;
    this.setSize();
    let i = 0;
    while (i < mlist.length) {
      const q = mlist[i] as MItem;
      let delta = 0;
      let action: "noad" | "node" | "check" | "nucleus" = "nucleus";
      if (isNoad(q)) {
        this.curTag = q.tag;
        if (q.tag !== undefined && q.tag !== null) this.env.atomScales?.set(q.tag, this.styleScale(this.curStyle));
      }
      reswitch: for (;;) {
        delta = 0;
        switch (q.type) {
          case BIN_NOAD:
            switch (rType) {
              case BIN_NOAD:
              case OP_NOAD:
              case REL_NOAD:
              case OPEN_NOAD:
              case PUNCT_NOAD:
              case LEFT_NOAD:
                q.type = ORD_NOAD;
                continue reswitch;
              default:
                break;
            }
            break;
          case REL_NOAD:
          case CLOSE_NOAD:
          case PUNCT_NOAD:
          case RIGHT_NOAD:
            if (rType === BIN_NOAD && r && !this.env.editorBinSpacing) r.type = ORD_NOAD;
            if (q.type === RIGHT_NOAD) action = "noad";
            break;
          case LEFT_NOAD:
            action = "noad";
            break;
          case FRACTION_NOAD:
            this.makeFraction(q as Noad);
            action = "check";
            break;
          case OP_NOAD:
            delta = this.makeOp(q as Noad);
            if ((q as Noad).subtype === LIMITS) action = "check";
            break;
          case ORD_NOAD:
            this.makeOrd(mlist, i);
            break;
          case OPEN_NOAD:
          case INNER_NOAD:
            break;
          case RADICAL_NOAD:
            this.makeRadical(q as Noad);
            break;
          case OVER_NOAD:
            this.makeOver(q as Noad);
            break;
          case UNDER_NOAD:
            this.makeUnder(q as Noad);
            break;
          case ACCENT_NOAD:
            this.makeMathAccent(q as Noad);
            break;
          case VCENTER_NOAD:
            this.makeVcenter(q as Noad);
            break;
          case STYLE_NODE:
            this.curStyle = (q as StyleItem).style;
            this.setSize();
            action = "node";
            break;
          case CHOICE_NODE: {
            const c = q as ChoiceItem;
            let p: MItem[];
            switch (div(this.curStyle, 2)) {
              case 0: p = c.display; break;
              case 1: p = c.text; break;
              case 2: p = c.script; break;
              default: p = c.scriptScript; break;
            }
            const styleNode: StyleItem = { type: STYLE_NODE, style: this.curStyle, tag: c.tag };
            mlist.splice(i, 1, styleNode, ...p);
            action = "node";
            break;
          }
          case 3: // ins_node
          case 4: // mark_node
          case 5: // adjust_node
          case 8: // whatsit_node
          case PENALTY_NODE:
          case 7: // disc_node
            action = "node";
            break;
          case RULE_NODE: {
            const rule = q as RuleNode;
            if (rule.height > maxH) maxH = rule.height;
            if (rule.depth > maxD) maxD = rule.depth;
            action = "node";
            break;
          }
          case GLUE_NODE: {
            const g = q as GlueNode;
            if (g.subtype === MU_GLUE) {
              g.spec = this.mathGlue(g.spec, this.curMu);
              g.subtype = NORMAL;
            } else if (this.curSize !== TEXT_SIZE && g.subtype === COND_MATH_GLUE) {
              const p = mlist[i + 1];
              if (p && (p.type === GLUE_NODE || p.type === KERN_NODE)) mlist.splice(i + 1, 1);
            }
            action = "node";
            break;
          }
          case KERN_NODE:
            this.mathKern(q as KernNode, this.curMu);
            action = "node";
            break;
          default:
            throw new Error("confusion: mlist1 (type " + q.type + ")");
        }
        break;
      }

      if (action === "nucleus") {
        const n = q as Noad;
        // tex.web 754: convert nucleus(q) to an hlist and attach scripts
        let p: Node[];
        switch (n.nucleus.mathType) {
          case MATH_CHAR:
          case MATH_TEXT_CHAR: {
            this.fetch(n.nucleus);
            if (this.curI.exists) {
              const f = this.curF!;
              const tag = n.nucleus.tag ?? this.curTag;
              delta = f.charItalic(this.curI);
              p = [newCharacter(f, this.curC, tag)];
              if (n.nucleus.mathType === MATH_TEXT_CHAR && f.space !== 0) delta = 0;
              if (n.sub.mathType === EMPTY && delta !== 0) {
                const italic = newKern(delta, tag);
                italic.italic = true;
                p.push(italic);
                delta = 0;
              }
            } else p = [];
            break;
          }
          case EMPTY:
            p = [];
            break;
          case SUB_BOX:
            p = [n.nucleus.box!];
            break;
          case SUB_MLIST: {
            const saveStyle = this.curStyle;
            const saveTag = this.curTag;
            const hl = this.mlistToHlist(n.nucleus.list!, this.curStyle, false);
            this.curTag = saveTag;
            this.curStyle = saveStyle;
            this.setSize();
            p = [hpack(hl, 0, undefined, this.curTag)];
            if (n.nucleus.first !== undefined) (p[0] as BoxNode).firstTag = n.nucleus.first;
            break;
          }
          default:
            throw new Error("confusion: mlist2");
        }
        n.newHlist = p;
        if (n.sub.mathType !== EMPTY || n.sup.mathType !== EMPTY) this.makeScripts(n, delta);
        action = "check";
      }

      if (action === "check") {
        const n = q as Noad;
        const z = hpack(n.newHlist ?? []);
        if (z.height > maxH) maxH = z.height;
        if (z.depth > maxD) maxD = z.depth;
        action = "noad";
      }
      if (action === "noad") {
        r = q as Noad;
        rType = r.type;
        if (rType === RIGHT_NOAD) {
          // e-TeX: after \middle the list continues as after a \left
          rType = LEFT_NOAD;
          this.curStyle = style;
          this.setSize();
        }
      }
      i++;
    }
    if (rType === BIN_NOAD && r && !this.env.editorBinSpacing) r.type = ORD_NOAD;

    // Second pass (tex.web 760-767)
    const out: Node[] = [];
    rType = 0;
    this.curStyle = style;
    this.setSize();
    for (let k = 0; k < mlist.length; k++) {
      const q = mlist[k] as MItem;
      let t = ORD_NOAD;
      let pen = INF_PENALTY;
      switch (q.type) {
        case OP_NOAD:
        case OPEN_NOAD:
        case CLOSE_NOAD:
        case PUNCT_NOAD:
        case INNER_NOAD:
          t = q.type;
          break;
        case BIN_NOAD:
          t = BIN_NOAD;
          pen = this.env.binOpPenalty;
          break;
        case REL_NOAD:
          t = REL_NOAD;
          pen = this.env.relPenalty;
          break;
        case ORD_NOAD:
        case VCENTER_NOAD:
        case OVER_NOAD:
        case UNDER_NOAD:
        case RADICAL_NOAD:
        case ACCENT_NOAD:
        case FRACTION_NOAD:
          break;
        case LEFT_NOAD:
        case RIGHT_NOAD:
          t = this.makeLeftRight(q as Noad, style, maxD, maxH);
          break;
        case STYLE_NODE:
          this.curStyle = (q as StyleItem).style;
          this.setSize();
          continue;
        case 8:
        case PENALTY_NODE:
        case RULE_NODE:
        case 7:
        case 5:
        case 3:
        case 4:
        case GLUE_NODE:
        case KERN_NODE:
          out.push(q as Node);
          continue;
        default:
          throw new Error("confusion: mlist3 (type " + q.type + ")");
      }
      const n = q as Noad;
      if (rType > 0) {
        const digit = MATH_SPACING[(rType - ORD_NOAD) * 8 + (t - ORD_NOAD)];
        let x = 0;
        switch (digit) {
          case "0": x = 0; break;
          case "1": x = this.curStyle < SCRIPT_STYLE ? THIN_MU_SKIP_CODE : 0; break;
          case "2": x = THIN_MU_SKIP_CODE; break;
          case "3": x = this.curStyle < SCRIPT_STYLE ? MED_MU_SKIP_CODE : 0; break;
          case "4": x = this.curStyle < SCRIPT_STYLE ? THICK_MU_SKIP_CODE : 0; break;
          case "*":
            // a Bin before a Rel, Close or Punct, kept a Bin in editor layouts
            if (this.env.editorBinSpacing && rType === BIN_NOAD) break;
            throw new Error("confusion: mlist4");
          default: throw new Error("confusion: mlist4");
        }
        if (x !== 0) {
          const spec = x === THIN_MU_SKIP_CODE ? this.env.thinMuSkip : x === MED_MU_SKIP_CODE ? this.env.medMuSkip : this.env.thickMuSkip;
          const z = newGlue(this.mathGlue(spec, this.curMu));
          z.subtype = x + 1;
          out.push(z);
        }
      }
      if (n.newHlist) out.push(...n.newHlist);
      if (penalties && k + 1 < mlist.length && pen < INF_PENALTY) {
        const nextType = mlist[k + 1].type;
        if (nextType !== PENALTY_NODE && nextType !== REL_NOAD) out.push(newPenalty(pen, n.tag));
      }
      if (q.type === RIGHT_NOAD) t = OPEN_NOAD; // e-TeX \middle
      rType = t;
    }
    return out;
  }

  // --- the make_* procedures (tex.web 734-762) -----------------------------
  private makeOver(q: Noad): void {
    q.nucleus = { mathType: SUB_BOX, box: this.overbar(this.cleanBox(q.nucleus, crampedStyle(this.curStyle)), 3 * this.defaultRuleThickness(), this.defaultRuleThickness()) };
  }

  private makeUnder(q: Noad): void {
    const x = this.cleanBox(q.nucleus, this.curStyle);
    const p = newKern(3 * this.defaultRuleThickness(), this.curTag);
    const y = vpack([x, p, this.fractionRule(this.defaultRuleThickness())], this.curTag);
    const delta = y.height + y.depth + this.defaultRuleThickness();
    y.height = x.height;
    y.depth = delta - y.height;
    q.nucleus = { mathType: SUB_BOX, box: y };
  }

  private makeVcenter(q: Noad): void {
    const v = q.nucleus.box!;
    if (v.type !== VLIST_NODE) throw new Error("confusion: vcenter");
    const delta = v.height + v.depth;
    v.height = this.axisHeight(this.curSize) + half(delta);
    v.depth = delta - v.height;
  }

  private makeRadical(q: Noad): void {
    const x = this.cleanBox(q.nucleus, crampedStyle(this.curStyle));
    x.role = x.role ?? "radicand";
    let clr: number;
    if (this.curStyle < TEXT_STYLE) clr = this.defaultRuleThickness() + div(Math.abs(this.mathXHeight(this.curSize)), 4);
    else {
      clr = this.defaultRuleThickness();
      clr = clr + div(Math.abs(clr), 4);
    }
    if (this.env.radicalGap !== undefined) {
      clr = scalePermille(clr, this.env.radicalGap);
    }
    const y = this.varDelimiter(q.leftDelim ?? NULL_DELIMITER, this.curSize, x.height + x.depth + clr + this.defaultRuleThickness());
    y.role = "radical-sign";
    const delta = y.depth - (x.height + x.depth + clr);
    if (delta > 0) clr += half(delta);
    y.shift = -(x.height + clr);
    q.nucleus = { mathType: SUB_BOX, box: hpack([y, this.overbar(x, clr, y.height)], 0, undefined, this.curTag) };
  }

  private makeMathAccent(q: Noad): void {
    this.fetch(q.accentChr!);
    if (!this.curI.exists) return;
    let i = this.curI;
    let c = this.curC;
    const f = this.curF!;
    // Compute the amount of skew (tex.web 741)
    let s = 0;
    if (q.nucleus.mathType === MATH_CHAR) {
      this.fetch(q.nucleus);
      if (this.curI.tag === LIG_TAG) {
        const cf = this.curF!;
        let a = cf.ligKernStart(this.curI);
        let k = cf.ligKern[a];
        if (k.skip > STOP_FLAG) {
          a = cf.ligKernRestart(k);
          k = cf.ligKern[a];
        }
        for (;;) {
          if (k.next === cf.skewChar) {
            if (k.op >= KERN_FLAG && k.skip <= STOP_FLAG) s = cf.charKern(k);
            break;
          }
          if (k.skip >= STOP_FLAG) break;
          a = a + k.skip + 1;
          k = cf.ligKern[a];
        }
      }
    }
    let x = this.cleanBox(q.nucleus, crampedStyle(this.curStyle));
    const w = x.width;
    let h = x.height;
    // Switch to a larger accent if available and appropriate (tex.web 740)
    for (;;) {
      if (i.tag !== LIST_TAG) break;
      const yc = i.rem;
      i = f.charInfo(yc);
      if (!i.exists) break;
      if (f.charWidth(i) > w) break;
      c = yc;
    }
    let delta = h < f.xHeight ? h : f.xHeight;
    if ((q.sup.mathType !== EMPTY || q.sub.mathType !== EMPTY) && q.nucleus.mathType === MATH_CHAR) {
      // Swap the subscript and superscript into box x (tex.web 742)
      const xn = newNoad(ORD_NOAD, this.curTag);
      xn.nucleus = q.nucleus;
      xn.sup = q.sup;
      xn.sub = q.sub;
      q.sup = emptyField();
      q.sub = emptyField();
      q.nucleus = { mathType: SUB_MLIST, list: [xn] };
      x = this.cleanBox(q.nucleus, this.curStyle);
      delta = delta + x.height - h;
      h = x.height;
    }
    let y = this.charBox(f, c);
    y.role = "accent";
    y.shift = s + half(w - y.width);
    y.width = 0;
    const p = newKern(-delta, this.curTag);
    y = vpack([y, p, x], this.curTag);
    y.width = x.width;
    if (y.height < h) {
      y.list.unshift(newKern(h - y.height, this.curTag));
      y.height = h;
    }
    q.nucleus = { mathType: SUB_BOX, box: y };
  }

  private makeFraction(q: Noad): void {
    if (q.thickness === undefined || q.thickness === DEFAULT_CODE) q.thickness = this.defaultRuleThickness();
    const thickness = q.thickness;
    let x = this.cleanBox(q.num ?? emptyField(), numStyle(this.curStyle));
    let z = this.cleanBox(q.den ?? emptyField(), denomStyle(this.curStyle));
    x.role = x.role ?? "numerator";
    z.role = z.role ?? "denominator";
    if (x.width < z.width) x = this.rebox(x, z.width);
    else z = this.rebox(z, x.width);
    let shiftUp: number;
    let shiftDown: number;
    if (this.curStyle < TEXT_STYLE) {
      shiftUp = this.num1(this.curSize);
      shiftDown = this.denom1(this.curSize);
    } else {
      shiftDown = this.denom2(this.curSize);
      shiftUp = thickness !== 0 ? this.num2(this.curSize) : this.num3(this.curSize);
    }
    let delta: number;
    const axis = this.axisHeight(this.curSize);
    if (thickness === 0) {
      const clr = this.curStyle < TEXT_STYLE ? 7 * this.defaultRuleThickness() : 3 * this.defaultRuleThickness();
      delta = half(clr - ((shiftUp - x.depth) - (z.height - shiftDown)));
      if (delta > 0) {
        shiftUp += delta;
        shiftDown += delta;
      }
    } else {
      const clr = this.curStyle < TEXT_STYLE ? 3 * thickness : thickness;
      delta = half(thickness);
      const delta1 = clr - ((shiftUp - x.depth) - (axis + delta));
      const delta2 = clr - ((axis - delta) - (z.height - shiftDown));
      if (delta1 > 0) shiftUp += delta1;
      if (delta2 > 0) shiftDown += delta2;
    }
    const v = newNullBox(this.curTag);
    v.type = VLIST_NODE;
    v.height = shiftUp + x.height;
    v.depth = z.depth + shiftDown;
    v.width = x.width;
    if (thickness === 0) {
      v.list = [x, newKern((shiftUp - x.depth) - (z.height - shiftDown), this.curTag), z];
    } else {
      const y = this.fractionRule(thickness);
      v.list = [
        x,
        newKern((shiftUp - x.depth) - (axis + delta), this.curTag),
        y,
        newKern((axis - delta) - (z.height - shiftDown), this.curTag),
        z,
      ];
    }
    delta = this.curStyle < TEXT_STYLE ? this.delim1(this.curSize) : this.delim2(this.curSize);
    const xd = this.varDelimiter(q.leftDelim ?? NULL_DELIMITER, this.curSize, delta);
    const zd = this.varDelimiter(q.rightDelim ?? NULL_DELIMITER, this.curSize, delta);
    q.newHlist = [hpack([xd, v, zd], 0, undefined, this.curTag)];
  }

  private makeOp(q: Noad): number {
    let delta: number;
    if (q.subtype === NORMAL && this.curStyle < TEXT_STYLE) q.subtype = LIMITS;
    if (q.nucleus.mathType === MATH_CHAR) {
      this.fetch(q.nucleus);
      if (this.curStyle < TEXT_STYLE && this.curI.tag === LIST_TAG) {
        const c = this.curI.rem;
        const i = this.curF!.charInfo(c);
        if (i.exists) {
          this.curC = c;
          this.curI = i;
          q.nucleus.char = c;
        }
      }
      delta = this.curF ? this.curF.charItalic(this.curI) : 0;
      const x = this.cleanBox(q.nucleus, this.curStyle);
      if (q.sub.mathType !== EMPTY && q.subtype !== LIMITS) x.width -= delta;
      x.shift = half(x.height - x.depth) - this.axisHeight(this.curSize);
      q.nucleus = { mathType: SUB_BOX, box: x };
    } else if (q.italicEm) {
      // a box standing for a character: placed as drawn (no centring on the axis)
      delta = Math.round(q.italicEm * this.mathQuad(this.curSize));
      const x = this.cleanBox(q.nucleus, this.curStyle);
      // as width(x) := width(x) - delta for a character, but the box keeps its
      // size (its artwork is painted into it): a kern takes the delta back
      q.nucleus = {
        mathType: SUB_BOX,
        box: q.sub.mathType !== EMPTY && q.subtype !== LIMITS ? hpack([x, newKern(-delta, this.curTag)], 0, undefined, this.curTag) : x,
      };
    } else delta = 0;
    if (q.subtype === LIMITS) {
      let x = this.cleanBox(q.sup, supStyle(this.curStyle));
      let y = this.cleanBox(q.nucleus, this.curStyle);
      let z = this.cleanBox(q.sub, subStyle(this.curStyle));
      x.role = x.role ?? "upper-limit";
      z.role = z.role ?? "lower-limit";
      const v = newNullBox(this.curTag);
      v.type = VLIST_NODE;
      v.width = y.width;
      if (x.width > v.width) v.width = x.width;
      if (z.width > v.width) v.width = z.width;
      x = this.rebox(x, v.width);
      y = this.rebox(y, v.width);
      z = this.rebox(z, v.width);
      x.shift = half(delta);
      z.shift = -x.shift;
      v.height = y.height;
      v.depth = y.depth;
      if (q.sup.mathType === EMPTY) v.list = [y];
      else {
        let shiftUp = this.bigOpSpacing3() - x.depth;
        if (shiftUp < this.bigOpSpacing1()) shiftUp = this.bigOpSpacing1();
        v.list = [newKern(this.bigOpSpacing5(), this.curTag), x, newKern(shiftUp, this.curTag), y];
        v.height = v.height + this.bigOpSpacing5() + x.height + x.depth + shiftUp;
      }
      if (q.sub.mathType !== EMPTY) {
        let shiftDown = this.bigOpSpacing4() - z.height;
        if (shiftDown < this.bigOpSpacing2()) shiftDown = this.bigOpSpacing2();
        v.list.push(newKern(shiftDown, this.curTag), z, newKern(this.bigOpSpacing5(), this.curTag));
        v.depth = v.depth + this.bigOpSpacing5() + z.height + z.depth + shiftDown;
      }
      q.newHlist = [v];
    }
    return delta;
  }

  private makeOrd(mlist: MItem[], i: number): void {
    restart: for (;;) {
      const q = mlist[i] as Noad;
      if (q.sub.mathType !== EMPTY || q.sup.mathType !== EMPTY || q.nucleus.mathType !== MATH_CHAR) return;
      const p = mlist[i + 1] as Noad | undefined;
      if (!p || p.type < ORD_NOAD || p.type > PUNCT_NOAD) return;
      if (p.nucleus.mathType !== MATH_CHAR || p.nucleus.fam !== q.nucleus.fam) return;
      q.nucleus.mathType = MATH_TEXT_CHAR;
      this.fetch(q.nucleus);
      if (this.curI.tag !== LIG_TAG) return;
      const f = this.curF!;
      let a = f.ligKernStart(this.curI);
      this.curC = p.nucleus.char!;
      let k = f.ligKern[a];
      if (k.skip > STOP_FLAG) {
        a = f.ligKernRestart(k);
        k = f.ligKern[a];
      }
      for (;;) {
        if (k.next === this.curC && k.skip <= STOP_FLAG) {
          if (k.op >= KERN_FLAG) {
            mlist.splice(i + 1, 0, newKern(f.charKern(k), q.tag));
            return;
          }
          switch (k.op) {
            case 1:
            case 5:
              q.nucleus.char = k.rem;
              break;
            case 2:
            case 6:
              p.nucleus.char = k.rem;
              break;
            case 3:
            case 7:
            case 11: {
              const r = newNoad(ORD_NOAD, q.tag);
              r.nucleus = { mathType: k.op < 11 ? MATH_CHAR : MATH_TEXT_CHAR, fam: q.nucleus.fam, char: k.rem };
              mlist.splice(i + 1, 0, r);
              break;
            }
            default:
              mlist.splice(i + 1, 1);
              q.nucleus.char = k.rem;
              q.sub = p.sub;
              q.sup = p.sup;
              break;
          }
          if (k.op > 3) return;
          q.nucleus.mathType = MATH_CHAR;
          continue restart;
        }
        if (k.skip >= STOP_FLAG) return;
        a = a + k.skip + 1;
        k = f.ligKern[a];
      }
    }
  }

  private makeScripts(q: Noad, delta: number): void {
    const saveTag = this.curTag;
    if (q.scriptTag !== undefined) this.curTag = q.scriptTag;
    try {
      this.makeScriptsInner(q, delta);
    } finally {
      this.curTag = saveTag;
    }
  }

  private makeScriptsInner(q: Noad, delta: number): void {
    const p = q.newHlist ?? [];
    let shiftUp: number;
    let shiftDown: number;
    if (p.length > 0 && isCharNode(p[0])) {
      shiftUp = 0;
      shiftDown = 0;
    } else {
      const z = hpack(p);
      const t = this.curStyle < SCRIPT_STYLE ? SCRIPT_SIZE : SCRIPT_SCRIPT_SIZE;
      shiftUp = z.height - this.supDrop(t);
      shiftDown = z.depth + this.subDrop(t);
    }
    let x: BoxNode;
    let clr: number;
    if (q.sup.mathType === EMPTY) {
      x = this.cleanBox(q.sub, subStyle(this.curStyle));
      x.role = x.role ?? "subscript";
      if (q.scriptTag !== undefined) x.tag = q.scriptTag;
      x.width += this.env.scriptSpace;
      if (shiftDown < this.sub1(this.curSize)) shiftDown = this.sub1(this.curSize);
      clr = x.height - div(Math.abs(this.mathXHeight(this.curSize) * 4), 5);
      if (shiftDown < clr) shiftDown = clr;
      x.shift = shiftDown;
    } else {
      x = this.cleanBox(q.sup, supStyle(this.curStyle));
      x.role = x.role ?? "superscript";
      if (q.scriptTag !== undefined) x.tag = q.scriptTag;
      x.width += this.env.scriptSpace;
      if (this.curStyle % 2 === 1) clr = this.sup3(this.curSize);
      else if (this.curStyle < TEXT_STYLE) clr = this.sup1(this.curSize);
      else clr = this.sup2(this.curSize);
      if (shiftUp < clr) shiftUp = clr;
      clr = x.depth + div(Math.abs(this.mathXHeight(this.curSize)), 4);
      if (shiftUp < clr) shiftUp = clr;
      if (q.sub.mathType === EMPTY) x.shift = -shiftUp;
      else {
        const y = this.cleanBox(q.sub, subStyle(this.curStyle));
        y.role = y.role ?? "subscript";
        if (q.scriptTag !== undefined) y.tag = q.scriptTag;
        y.width += this.env.scriptSpace;
        if (shiftDown < this.sub2(this.curSize)) shiftDown = this.sub2(this.curSize);
        clr = 4 * this.defaultRuleThickness() - ((shiftUp - x.depth) - (y.height - shiftDown));
        if (clr > 0) {
          shiftDown += clr;
          clr = div(Math.abs(this.mathXHeight(this.curSize) * 4), 5) - (shiftUp - x.depth);
          if (clr > 0) {
            shiftUp += clr;
            shiftDown -= clr;
          }
        }
        x.shift = delta;
        const k = newKern((shiftUp - x.depth) - (y.height - shiftDown), this.curTag);
        x = vpack([x, k, y], this.curTag);
        x.shift = shiftDown;
      }
    }
    if (!q.newHlist) q.newHlist = [x];
    else q.newHlist.push(x);
  }

  private makeLeftRight(q: Noad, style: number, maxD: number, maxH: number): number {
    this.curStyle = style; // e-TeX
    this.setSize();
    let delta2 = maxD + this.axisHeight(this.curSize);
    let delta1 = maxH + maxD - delta2;
    if (delta2 > delta1) delta1 = delta2;
    let delta = div(delta1, 500) * this.env.delimiterFactor;
    delta2 = delta1 + delta1 - this.env.delimiterShortfall;
    if (delta < delta2) delta = delta2;
    q.newHlist = [this.varDelimiter(q.delim ?? NULL_DELIMITER, this.curSize, delta)];
    return q.type - (LEFT_NOAD - OPEN_NOAD);
  }
}

export { HLIST_NODE };
