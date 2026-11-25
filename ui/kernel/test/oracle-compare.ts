// Compare the engine with exact LaTeX output.
//
// For each LaTeX comparison case (testing/corpus/tex-layout) this feeds TeX's own math
// list to the engine and checks the resulting box dimensions and every glyph
// and rule position, to the scaled point.
//
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decimalToScaled } from "../src/layout/arith.ts";
import { FontCache, makeEnv, type FamilyTable } from "../src/layout/latex.ts";
import {
  ACCENT_NOAD,
  BIN_NOAD,
  CHOICE_NODE,
  CLOSE_NOAD,
  DEFAULT_CODE,
  FRACTION_NOAD,
  INNER_NOAD,
  LEFT_NOAD,
  LIMITS,
  MathTypesetter,
  MIDDLE_NOAD,
  NO_LIMITS,
  OP_NOAD,
  OPEN_NOAD,
  ORD_NOAD,
  OVER_NOAD,
  PUNCT_NOAD,
  RADICAL_NOAD,
  REL_NOAD,
  RIGHT_NOAD,
  STYLE_NODE,
  TEXT_STYLE,
  UNDER_NOAD,
  VCENTER_NOAD,
  boxField,
  charField,
  emptyField,
  mlistField,
  newNoad,
  type Delimiter,
  type Field,
  type MItem,
} from "../src/layout/mlist.ts";
import { decimalToScaled as sp, MAX_DIMEN, NULL_FLAG } from "../src/layout/arith.ts";
import {
  CHAR_NODE,
  COND_MATH_GLUE,
  FIL,
  FILL,
  FILLL,
  GLUE_NODE,
  KERN_NODE,
  MATH_NODE,
  MU_GLUE,
  NORMAL,
  PENALTY_NODE,
  RULE_NODE,
  ZERO_GLUE,
  type BoxNode,
  type Node,
} from "../src/layout/nodes.ts";
import { EXACTLY, hpack, vpackage } from "../src/layout/pack.ts";
import { printScaled, shipOut } from "../src/layout/shipout.ts";
import type { TfmData } from "../src/layout/tfm.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tfmAll = JSON.parse(readFileSync(join(here, "..", "data", "tfm.json"), "utf8"));
const cache = new FontCache((name) => tfmAll[name] as TfmData);

const NOAD_TYPES: Record<string, number> = {
  mathord: ORD_NOAD,
  mathop: OP_NOAD,
  mathbin: BIN_NOAD,
  mathrel: REL_NOAD,
  mathopen: OPEN_NOAD,
  mathclose: CLOSE_NOAD,
  mathpunct: PUNCT_NOAD,
  mathinner: INNER_NOAD,
  overline: OVER_NOAD,
  underline: UNDER_NOAD,
  vcenter: VCENTER_NOAD,
};

const STYLES: Record<string, number> = { display: 0, text: 2, script: 4, scriptscript: 6 };

function delim(d: any): Delimiter {
  return { smallFam: d.smallFam, smallChar: d.smallCode, largeFam: d.largeFam, largeChar: d.largeCode };
}

let fontIds: Record<string, string> = {};

function field(f: any): Field {
  if (!f) return emptyField();
  if (f.kind === "char") return charField(f.fam, f.code);
  if (f.kind === "list") return mlistField(f.list.map(item));
  if (f.kind === "box") return boxField(box(f.box));
  throw new Error("unsupported field kind " + f.kind);
}

function dim(text: string): number {
  return text === "*" ? NULL_FLAG : sp(text);
}

function hitem(it: any): Node {
  switch (it.type) {
    case "char": {
      const name = fontIds[it.fontid];
      if (!name) throw new Error("unknown font id " + it.fontid);
      return { type: CHAR_NODE, font: cache.byFontname(name)!, char: it.code };
    }
    case "math":
      return { type: MATH_NODE, width: sp(it.width), subtype: 0 };
    case "kern":
      return { type: KERN_NODE, width: sp(it.width), subtype: it.explicit ? 1 : NORMAL };
    case "rule":
      return { type: RULE_NODE, height: dim(it.height), depth: dim(it.depth), width: dim(it.width) };
    case "glue": {
      const s = it.spec;
      return {
        type: GLUE_NODE,
        subtype: it.leaders ? (it.leaders === "c" ? 101 : it.leaders === "x" ? 102 : 100) : NORMAL,
        leader: it.leader ? (hitem(it.leader) as any) : undefined,
        spec: {
          width: sp(s.width),
          stretch: sp(s.stretch),
          stretchOrder: order(s.stretchUnit),
          shrink: sp(s.shrink),
          shrinkOrder: order(s.shrinkUnit),
        },
      };
    }
    case "penalty":
      return { type: PENALTY_NODE, penalty: it.value };
    case "hbox":
    case "vbox":
      return box(it);
    default:
      throw new Error("unsupported box item " + JSON.stringify(it).slice(0, 100));
  }
}

/** Rebuild a finished box; glue is re-set from the exact size, as TeX packed it. */
function box(b: any): BoxNode {
  const items = (b.content ?? []).map(hitem);
  const [h, d, w] = b.raw.map(sp);
  const r = b.type === "hbox" ? hpack(items, w, EXACTLY) : vpackage(items, h, EXACTLY, MAX_DIMEN);
  r.width = w;
  r.height = h;
  r.depth = d;
  r.shift = b.shift ? sp(b.shift) : 0;
  return r;
}

function order(unit: string): number {
  return unit === "fil" ? FIL : unit === "fill" ? FILL : unit === "filll" ? FILLL : NORMAL;
}

function item(it: any): MItem {
  const t = NOAD_TYPES[it.type];
  if (t !== undefined) {
    const n = newNoad(t);
    if (it.limits === "limits") n.subtype = LIMITS;
    if (it.limits === "nolimits") n.subtype = NO_LIMITS;
    n.nucleus = field(it.nucleus);
    n.sup = field(it.sup);
    n.sub = field(it.sub);
    return n;
  }
  switch (it.type) {
    case "radical": {
      const n = newNoad(RADICAL_NOAD);
      n.leftDelim = delim(it.delim);
      n.nucleus = field(it.nucleus);
      n.sup = field(it.sup);
      n.sub = field(it.sub);
      return n;
    }
    case "accent": {
      const n = newNoad(ACCENT_NOAD);
      n.accentChr = charField(it.fam, it.code);
      n.nucleus = field(it.nucleus);
      n.sup = field(it.sup);
      n.sub = field(it.sub);
      return n;
    }
    case "left":
    case "right":
    case "middle": {
      const n = newNoad(it.type === "left" ? LEFT_NOAD : RIGHT_NOAD);
      if (it.type === "middle") n.subtype = MIDDLE_NOAD;
      n.delim = delim(it.delim);
      return n;
    }
    case "fraction": {
      const n = newNoad(FRACTION_NOAD);
      n.thickness = it.thickness === "default" ? DEFAULT_CODE : decimalToScaled(it.thickness);
      n.num = field(it.num);
      n.den = field(it.den);
      if (it.left) n.leftDelim = delim(it.left);
      if (it.right) n.rightDelim = delim(it.right);
      return n;
    }
    case "style":
      return { type: STYLE_NODE, style: STYLES[it.style] };
    case "choice":
      return {
        type: CHOICE_NODE,
        display: it.display.map(item),
        text: it.text.map(item),
        script: it.script.map(item),
        scriptScript: it.scriptscript.map(item),
      };
    case "glue": {
      if (it.kind === "nonscript") return { type: GLUE_NODE, spec: ZERO_GLUE, subtype: COND_MATH_GLUE } as Node;
      const s = it.spec;
      const spec = {
        width: decimalToScaled(s.width),
        stretch: decimalToScaled(s.stretch),
        stretchOrder: order(s.stretchUnit),
        shrink: decimalToScaled(s.shrink),
        shrinkOrder: order(s.shrinkUnit),
      };
      return { type: GLUE_NODE, spec, subtype: it.kind === "mu" ? MU_GLUE : NORMAL } as Node;
    }
    case "kern":
      return { type: KERN_NODE, width: decimalToScaled(it.width), subtype: it.mu ? MU_GLUE : NORMAL } as Node;
    case "penalty":
      return { type: PENALTY_NODE, penalty: it.value } as Node;
    default:
      throw new Error("unsupported mlist item " + it.type + " " + JSON.stringify(it).slice(0, 120));
  }
}

function families(fonts: Record<string, any>): FamilyTable {
  const t: FamilyTable = new Map();
  for (const [fam, f] of Object.entries(fonts)) {
    t.set(Number(fam), [cache.byFontname(f.text), cache.byFontname(f.script), cache.byFontname(f.scriptscript)]);
  }
  return t;
}

export interface CaseResult {
  file: string;
  source: string;
  ok: boolean;
  problems: string[];
}

/** Lay out an oracle case from TeX's own math list. */
export function layoutOracleCase(file: string) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  fontIds = c.fontids ?? {};
  const env = makeEnv(families(c.fonts));
  const ts = new MathTypesetter(env);
  const mlist = c.mathlist.map(item);
  const hlist = ts.mlistToHlist(mlist, TEXT_STYLE, false);
  const math: Node = { type: MATH_NODE, width: 0, subtype: 0 };
  const box = hpack([math, ...hlist, { ...math }]);
  return { c, box, ship: shipOut(box) };
}

export function compareCase(file: string): CaseResult {
  const problems: string[] = [];
  let source = file;
  try {
    const { c, box, ship: res } = layoutOracleCase(file);
    source = c.source;
    const got = `${printScaled(box.height)}+${printScaled(box.depth)}x${printScaled(box.width)}`;
    const want = `${c.box.raw[0]}+${c.box.raw[1]}x${c.box.raw[2]}`;
    if (want !== got) problems.push(`box ${got} != TeX ${want}`);
    const sp = (pt: number) => Math.round(pt * 65536);
    if (res.glyphs.length !== c.glyphs.length) problems.push(`glyph count ${res.glyphs.length} != ${c.glyphs.length}`);
    const n = Math.min(res.glyphs.length, c.glyphs.length);
    for (let i = 0; i < n; i++) {
      const g = res.glyphs[i];
      const e = c.glyphs[i];
      const sizeOk = g.font.size === sp(e.size);
      if (g.font.name !== e.font || !sizeOk || g.char !== e.code || g.x !== sp(e.x) || g.y !== sp(e.y)) {
        problems.push(
          `glyph ${i}: ${g.font.name}@${g.font.size / 65536} ${g.char} (${g.x},${g.y}) != TeX ${e.font}@${e.size} ${e.code} (${sp(e.x)},${sp(e.y)})`,
        );
      }
    }
    if (res.rules.length !== c.rules.length) problems.push(`rule count ${res.rules.length} != ${c.rules.length}`);
    const m = Math.min(res.rules.length, c.rules.length);
    for (let i = 0; i < m; i++) {
      const r = res.rules[i];
      const e = c.rules[i];
      if (r.x !== sp(e.x) || r.y !== sp(e.y) || r.width !== sp(e.w) || r.height !== sp(e.h)) {
        problems.push(`rule ${i}: (${r.x},${r.y},${r.width},${r.height}) != TeX (${sp(e.x)},${sp(e.y)},${sp(e.w)},${sp(e.h)})`);
      }
    }
  } catch (err) {
    problems.push("error: " + (err as Error).message);
  }
  return { file, source, ok: problems.length === 0, problems };
}
