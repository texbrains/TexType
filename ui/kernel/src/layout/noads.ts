// Noads, the items of a math list (tex.web 680-698), and the subsidiary styles (tex.web 702): the data
// the math typesetter (mlist.ts) and the LaTeX adapter build and read.
import { div } from "./arith.ts";
import { NORMAL, type BoxNode, type GlueNode, type KernNode, type Node, type RuleNode, type Tag } from "./nodes.ts";

// ---------------------------------------------------------------------------
// noad types (tex.web 682-688) and related codes

export const STYLE_NODE = 14;
export const CHOICE_NODE = 15;
export const ORD_NOAD = 16;
export const OP_NOAD = 17;
export const BIN_NOAD = 18;
export const REL_NOAD = 19;
export const OPEN_NOAD = 20;
export const CLOSE_NOAD = 21;
export const PUNCT_NOAD = 22;
export const INNER_NOAD = 23;
export const RADICAL_NOAD = 24;
export const FRACTION_NOAD = 25;
export const UNDER_NOAD = 26;
export const OVER_NOAD = 27;
export const ACCENT_NOAD = 28;
export const VCENTER_NOAD = 29;
export const LEFT_NOAD = 30;
export const RIGHT_NOAD = 31;

export const LIMITS = 1;
export const NO_LIMITS = 2;
export const MIDDLE_NOAD = 1; // subtype of a right noad representing \middle

export const EMPTY = 0;
export const MATH_CHAR = 1;
export const SUB_BOX = 2;
export const SUB_MLIST = 3;
export const MATH_TEXT_CHAR = 4;

export const DEFAULT_CODE = 0o10000000000; // thickness of a normal fraction bar

export const DISPLAY_STYLE = 0;
export const TEXT_STYLE = 2;
export const SCRIPT_STYLE = 4;
export const SCRIPT_SCRIPT_STYLE = 6;
export const CRAMPED = 1;

export const TEXT_SIZE = 0;
export const SCRIPT_SIZE = 16;
export const SCRIPT_SCRIPT_SIZE = 32;

export const INF_PENALTY = 10000;

// glue parameter codes used for math spacing (tex.web 224)
export const THIN_MU_SKIP_CODE = 15;
export const MED_MU_SKIP_CODE = 16;
export const THICK_MU_SKIP_CODE = 17;

export interface Field {
  mathType: number; // EMPTY | MATH_CHAR | SUB_BOX | SUB_MLIST | MATH_TEXT_CHAR
  fam?: number;
  char?: number;
  box?: BoxNode;
  list?: MItem[];
  /** editor metadata (no effect on layout): branch-start atom of this field */
  first?: Tag;
  /** editor metadata: the atom of a math character that replaced a one-noad list (tex.web 1186) */
  tag?: Tag;
}

export interface Delimiter {
  smallFam: number;
  smallChar: number;
  largeFam: number;
  largeChar: number;
}

export const NULL_DELIMITER: Delimiter = { smallFam: 0, smallChar: 0, largeFam: 0, largeChar: 0 };

export interface Noad {
  type: number; // ORD_NOAD .. RIGHT_NOAD
  subtype: number;
  nucleus: Field;
  sup: Field;
  sub: Field;
  /** fraction */
  thickness?: number;
  num?: Field;
  den?: Field;
  /** radical (leftDelim), fraction (left/rightDelim) */
  leftDelim?: Delimiter;
  rightDelim?: Delimiter;
  /** left/right noads */
  delim?: Delimiter;
  /** accent noads */
  accentChr?: Field;
  newHlist?: Node[] | null;
  tag?: Tag;
  /** tag for the script boxes (the editor atom that owns the scripts) */
  scriptTag?: Tag;
  /**
   * An operator whose nucleus is a box that stands for one character (a
   * custom symbol drawn on a large operator): that character's italic
   * correction, in em of the current size. makeOp then sets scripts and
   * limits as for the character (tex.web 749-750); the box's width already
   * includes it, as a character's clean box does.
   */
  italicEm?: number;
}

export interface StyleItem {
  type: typeof STYLE_NODE;
  style: number;
  tag?: Tag;
}

export interface ChoiceItem {
  type: typeof CHOICE_NODE;
  display: MItem[];
  text: MItem[];
  script: MItem[];
  scriptScript: MItem[];
  tag?: Tag;
}

/** Glue node in an mlist: subtype MU_GLUE means its spec is in mu. */
export type MItem = Noad | StyleItem | ChoiceItem | GlueNode | KernNode | RuleNode | Node;

export function emptyField(): Field {
  return { mathType: EMPTY };
}

export function charField(fam: number, char: number): Field {
  return { mathType: MATH_CHAR, fam, char };
}

export function mlistField(list: MItem[]): Field {
  return { mathType: SUB_MLIST, list };
}

export function boxField(box: BoxNode): Field {
  return { mathType: SUB_BOX, box };
}

export function newNoad(type = ORD_NOAD, tag?: Tag): Noad {
  return { type, subtype: NORMAL, nucleus: emptyField(), sup: emptyField(), sub: emptyField(), tag };
}

export function isNoad(q: MItem): q is Noad {
  return q.type >= ORD_NOAD && q.type <= RIGHT_NOAD;
}

// subsidiary styles (tex.web 702)
export const crampedStyle = (c: number) => 2 * div(c, 2) + CRAMPED;
export const subStyle = (c: number) => 2 * div(c, 4) + SCRIPT_STYLE + CRAMPED;
export const supStyle = (c: number) => 2 * div(c, 4) + SCRIPT_STYLE + (c % 2);
export const numStyle = (c: number) => c + 2 - 2 * div(c, 6);
export const denomStyle = (c: number) => 2 * div(c, 2) + CRAMPED + 2 - 2 * div(c, 6);
