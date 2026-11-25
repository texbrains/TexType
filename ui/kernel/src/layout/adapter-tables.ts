// The LaTeX adapter's tables and shared helpers (latex-adapter.ts): font families and roles, math codes of the
// package fonts, arrow fills, alignment pieces.
import { decimalToScaled, div, nxPlusY, remainder, xnOverD, xOverN } from "./arith.ts";
import { FontCache, familiesFrom, type FamilyTable } from "./latex.ts";
import {
  BIN_NOAD,
  MATH_CHAR,
  OVER_NOAD,
  REL_NOAD,
  SUB_BOX,
  SUB_MLIST,
  UNDER_NOAD,
} from "./mlist.ts";
import {
  HLIST_NODE,
  VLIST_NODE,
  type GlueSpec,
  type Node,
} from "./nodes.ts";
import { type AlignRow } from "./align.ts";
import type { TeXFont } from "./tfm.ts";

/** The parts of a kernel atom the adapter reads (duck-typed). */
export interface AtomLike {
  type: string;
  command?: string;
  value?: string;
  mode?: string;
  style?: Record<string, any>;
  branch(name: string): AtomLike[] | undefined;
  [key: string]: any;
}

export interface LatexData {
  meanings: {
    commands: Record<string, string>;
    robust: Record<string, string>;
    mathcode: Record<string, number>;
    delcode: Record<string, number>;
  };
  templates: Record<string, { mathlist: any[]; fontids: Record<string, string> }>;
  onearg: Record<string, { mathlist: any[]; fontids: Record<string, string> }>;
  textFonts: Record<string, string>;
  /** the font profile's LaTeX setup (generated data, docs/SOURCES.md); Computer Modern when absent */
  profile?: ProfileData;
}

/** A font profile's math setup as LaTeX has it after its preamble (generated data, docs/SOURCES.md). */
export interface ProfileData {
  /** family -> [text, script, scriptscript] font, as \fontname reports them */
  fams: Record<string, string[]>;
  /** the family of each math alphabet and symbol font (FamilyRoles) */
  roles: Record<string, number>;
  skewchar: Record<string, number>;
  /** \fontdimen values a package assigned (FontSetup.params) */
  params: Record<string, Record<string, number>>;
  /** NFSS defaults: encoding, \rmdefault, \sfdefault, \ttdefault, and the text, script, scriptscript sizes */
  text: { encoding: string; rm: string; sf: string; tt: string; sizes: string[] };
  /** the family \bm uses for each family that has a bold version */
  bold?: Record<string, number>;
  /** the families of \boldmath that differ: bm sets a character with no bold family in \boldmath, in a box */
  boldmath?: Record<string, string[]>;
}

/** What each math alphabet and symbol font sets \fam to. */
export interface FamilyRoles {
  rm: number;
  mi: number;
  sy: number;
  ex: number;
  bf: number;
  /** bm's bold math italic, symbols and (if the profile has one) large symbols */
  bm: number;
  bmsy: number;
  bmex?: number;
  sf: number;
  tt: number;
  it: number;
  cal: number;
  bb: number;
  scr: number;
  frak: number;
  esint?: number;
}

/** The closing delimiter of each opening one (the kernel's RIGHT_DELIM), and back. */
export const RIGHT_FENCE: Record<string, string> = {
  "(": ")",
  "{": "}",
  "[": "]",
  "|": "|",
  "\\lbrace": "\\rbrace",
  "\\lparen": "\\rparen",
  "\\{": "\\}",
  "\\langle": "\\rangle",
  "\\lfloor": "\\rfloor",
  "\\lceil": "\\rceil",
  "\\vert": "\\vert",
  "\\lvert": "\\rvert",
  "\\Vert": "\\Vert",
  "\\lVert": "\\rVert",
  "\\lbrack": "\\rbrack",
  "\\ulcorner": "\\urcorner",
  "\\llcorner": "\\lrcorner",
  "\\lgroup": "\\rgroup",
  "\\lmoustache": "\\rmoustache",
};

export const LEFT_FENCE: Record<string, string> = Object.fromEntries(Object.entries(RIGHT_FENCE).map(([l, r]) => [r, l]));

// Families as LaTeX allocates them with the Computer Modern preamble (see
// data/notes); a profile's own come from its data (ProfileData.roles).
export const FAM = {
  rm: 0,
  mi: 1,
  sy: 2,
  ex: 3,
  msa: 4,
  msb: 5,
  rsfs: 6,
  bf: 7,
  bm: 8,
  bmsy: 9,
  sf: 10,
  tt: 11,
  it: 12,
  frak: 13,
  /** esint.sty's largesymbolsA (only for the integrals amsmath does not define) */
  esint: 14,
  /** outline-drawn operators (rare integrals from STIX Two Math), see PathFont; not a TeX family */
  paths: 20,
  /**
   * The editor's letter font, when one other than Computer Modern is chosen
   * (a system font, measured): italic, upright, bold and bold italic letters
   * and digits. Not TeX families: no math code names them (see letterField).
   */
  letterIt: 21,
  letterUp: 22,
  letterBf: 23,
  letterBfIt: 24,
  /** Greek letters and digits in fonts of their own, chosen apart from the letters' (the same four faces) */
  greekIt: 25,
  greekUp: 26,
  greekBf: 27,
  greekBfIt: 28,
  digitIt: 29,
  digitUp: 30,
  digitBf: 31,
  digitBfIt: 32,
  /** stmaryrd's symbol font (U/stmry: stmary10, 7, 5), when the profile's data has it; not a TeX family number */
  stmry: 33,
  /** upgreek's upright Greek (its default Euler option: U/eur, eurm10, 7, 5), when the data has it */
  eur: 34,
  /** bbm.sty's \mathbbm: a double-struck alphabet drawn from outlines (PathAlphabet), when the app gives one */
  bbm: 35,
  /** exam-zh's congruence and similarity signs and their negations, drawn from outlines (ExamZhSignFont); not a TeX family */
  examzh: 36,
} as const;

/** Fonts of packages the reference preamble loads, set up as families when the profile's data has them. */
export const PACKAGE_FAMILIES: [number, [string, string, string]][] = [
  [FAM.stmry, ["stmary10", "stmary7", "stmary5"]],
  [FAM.eur, ["eurm10", "eurm7", "eurm5"]],
];

/** The families of a group of characters set in a chosen font: italic, upright, bold, bold italic. */
export const FACE_GROUP_FAMS = {
  letter: [FAM.letterIt, FAM.letterUp, FAM.letterBf, FAM.letterBfIt],
  greek: [FAM.greekIt, FAM.greekUp, FAM.greekBf, FAM.greekBfIt],
  digit: [FAM.digitIt, FAM.digitUp, FAM.digitBf, FAM.digitBfIt],
} as const;

export const CM_ROLES: FamilyRoles = {
  rm: FAM.rm,
  mi: FAM.mi,
  sy: FAM.sy,
  ex: FAM.ex,
  bf: FAM.bf,
  bm: FAM.bm,
  bmsy: FAM.bmsy,
  sf: FAM.sf,
  tt: FAM.tt,
  it: FAM.it,
  cal: FAM.sy,
  bb: FAM.msb,
  scr: FAM.rsfs,
  frak: FAM.frak,
  esint: FAM.esint,
};

export const CM_TEXT: ProfileData["text"] = { encoding: "OT1", rm: "cmr", sf: "cmss", tt: "cmtt", sizes: ["10", "7", "5"] };

/** Greek in the Computer Modern fonts: capitals at codes 0-10, lower case at 11-39 of the math italic fonts. */
export const UPPER_GREEK = "ΓΔΘΛΞΠΣΥΦΨΩ";

export const LOWER_GREEK = "αβγδϵζηθικλμνξπρστυϕχψωεϑϖϱςφ";

export function latexFamilies(cache: FontCache, profile?: ProfileData): FamilyTable {
  if (profile) return familiesFrom(cache, profile.fams);
  const t: FamilyTable = new Map();
  const set = (fam: number, a: string, b: string, c: string) =>
    t.set(fam, [cache.byFontname(a), cache.byFontname(b), cache.byFontname(c)]);
  set(FAM.rm, "cmr10", "cmr7", "cmr5");
  set(FAM.mi, "cmmi10", "cmmi7", "cmmi5");
  set(FAM.sy, "cmsy10", "cmsy7", "cmsy5");
  set(FAM.ex, "cmex10", "cmex7", "cmex7 at 5.0pt");
  set(FAM.msa, "msam10", "msam7", "msam5");
  set(FAM.msb, "msbm10", "msbm7", "msbm5");
  set(FAM.rsfs, "rsfs10", "rsfs7", "rsfs5");
  set(FAM.bf, "cmbx10", "cmbx7", "cmbx5");
  set(FAM.bm, "cmmib10", "cmmib7", "cmmib5");
  set(FAM.bmsy, "cmbsy10", "cmbsy7", "cmbsy5");
  set(FAM.sf, "cmss10", "cmss8 at 7.0pt", "cmss8 at 5.0pt");
  set(FAM.tt, "cmtt10", "cmtt8 at 7.0pt", "cmtt8 at 5.0pt");
  set(FAM.it, "cmti10", "cmti7", "cmti7 at 5.0pt");
  set(FAM.frak, "eufm10", "eufm7", "eufm5");
  set(FAM.esint, "esint10", "esint10 at 7.0pt", "esint10 at 5.0pt");
  return t;
}

/** Math alphabet command -> its role (FamilyRoles), the family set by \mathgroup. */
export const ALPHABET_ROLE: Record<string, keyof FamilyRoles> = {
  "\\mathrm": "rm",
  "\\mathnormal": "mi",
  "\\mathcal": "cal",
  "\\mathbb": "bb",
  "\\mathscr": "scr",
  "\\mathbf": "bf",
  "\\mathsf": "sf",
  "\\mathtt": "tt",
  "\\mathit": "it",
  "\\mathfrak": "frak",
};

/** Context while converting a list. */
export interface Ctx {
  /** \fam inside a math alphabet, -1 outside */
  fam: number;
  /** inside \bm{...}: map families to their bold versions */
  bold: boolean;
  /** inside \operatorname: \newmcodes@ math codes */
  operator: boolean;
  /** inside real display math (LaTeX's \if@display) */
  display: boolean;
  /** inside bm's \boldmath box: characters with no bold family stay as they are (no poor man's bold) */
  boldmath?: boolean;
  /** inside bbm.sty's \mathbbm: its \mathbb is the outline alphabet (FAM.bbm) */
  bbm?: boolean;
}

export const BASE_CTX: Ctx = { fam: -1, bold: false, operator: false, display: false };

/** bm.sty's poor man's bold step: \mkern.4mu (mu glue widths are in sp of mu). */
export const PMB_STEP = Math.round(0.4 * 65536);

/** amsmath arrow fills: [left piece, repeated piece, right piece]; a list of commands is a braced group */
export type ArrowFill = [string | string[], string, string | string[]];

export const FILL = {
  right: ["\\relbar", "\\relbar", "\\rightarrow"] as ArrowFill,
  left: ["\\leftarrow", "\\relbar", "\\relbar"] as ArrowFill,
  leftright: ["\\leftarrow", "\\relbar", "\\rightarrow"] as ArrowFill,
  Right: ["\\Relbar", "\\Relbar", "\\Rightarrow"] as ArrowFill,
  Left: ["\\Leftarrow", "\\Relbar", "\\Relbar"] as ArrowFill,
  LeftRight: ["\\Leftarrow", "\\Relbar", "\\Rightarrow"] as ArrowFill,
  // mathtools (\MT_..._fill:)
  rightharpoonup: ["\\relbar", "\\relbar", "\\rightharpoonup"] as ArrowFill,
  rightharpoondown: ["\\relbar", "\\relbar", "\\rightharpoondown"] as ArrowFill,
  leftharpoonup: ["\\leftharpoonup", "\\relbar", "\\relbar"] as ArrowFill,
  leftharpoondown: ["\\leftharpoondown", "\\relbar", "\\relbar"] as ArrowFill,
  longright: ["\\relbar", "\\relbar", "\\longrightarrow"] as ArrowFill,
  longleft: ["\\longleftarrow", "\\relbar", "\\relbar"] as ArrowFill,
  hookleft: ["\\leftarrow", "\\relbar", ["\\relbar", "\\joinrel", "\\rhook"]] as ArrowFill,
  hookright: [["\\lhook", "\\joinrel", "\\relbar"], "\\relbar", "\\rightarrow"] as ArrowFill,
  mapsto: [["\\mapstochar", "\\relbar"], "\\relbar", "\\rightarrow"] as ArrowFill,
  // extarrows (\x@arrow is \DOTSB\Relbar)
  equal: ["\\Relbar", "\\Relbar", "\\Relbar"] as ArrowFill,
  Longleftright: ["\\Longleftarrow", "\\Relbar", "\\Longrightarrow"] as ArrowFill,
  longleftright: ["\\longleftarrow", "\\relbar", "\\longrightarrow"] as ArrowFill,
  Longleft: ["\\Longleftarrow", "\\Relbar", "\\Relbar"] as ArrowFill,
  Longright: ["\\Relbar", "\\Relbar", "\\Longrightarrow"] as ArrowFill,
  // extpfeil
  twoheadright: ["\\relbar", "\\relbar", "\\twoheadrightarrow"] as ArrowFill,
  twoheadleft: ["\\twoheadleftarrow", "\\relbar", "\\relbar"] as ArrowFill,
};

export const OVER_ARROWS: Record<string, { fill: ArrowFill; under: boolean }> = {
  "\\overrightarrow": { fill: FILL.right, under: false },
  "\\overleftarrow": { fill: FILL.left, under: false },
  "\\overleftrightarrow": { fill: FILL.leftright, under: false },
  "\\underrightarrow": { fill: FILL.right, under: true },
  "\\underleftarrow": { fill: FILL.left, under: true },
  "\\underleftrightarrow": { fill: FILL.leftright, under: true },
};

/**
 * \ext@arrow #1#2#3#4 (script kerns, measuring kerns) and the fill; `space`: mathtools passes the labels with a
 * control space before ("pre"), after ("post") or on both sides of them (\xRightarrow: {#1\ }{#2\ }).
 */
export type ExtArrow = { k: [number, number, number, number]; fill: ArrowFill; space?: "pre" | "post" | "both" };

export const EXT_ARROWS: Record<string, ExtArrow> = {
  "\\xrightarrow": { k: [0, 3, 5, 9], fill: FILL.right },
  "\\xleftarrow": { k: [3, 0, 9, 5], fill: FILL.left },
  // mathtools (loaded before extarrows, whose \providecommand then keeps these)
  "\\xleftrightarrow": { k: [3, 0, 9, 5], fill: FILL.leftright },
  "\\xRightarrow": { k: [0, 0, 5, 5], fill: FILL.Right, space: "post" },
  "\\xLeftarrow": { k: [0, 0, 5, 5], fill: FILL.Left, space: "pre" },
  "\\xLeftrightarrow": { k: [0, 0, 5, 5], fill: FILL.LeftRight, space: "both" },
  "\\xrightharpoondown": { k: [0, 3, 5, 9], fill: FILL.rightharpoondown },
  "\\xrightharpoonup": { k: [0, 3, 5, 9], fill: FILL.rightharpoonup },
  "\\xleftharpoondown": { k: [3, 0, 9, 5], fill: FILL.leftharpoondown },
  "\\xleftharpoonup": { k: [3, 0, 9, 5], fill: FILL.leftharpoonup },
  "\\xlongrightarrow": { k: [0, 3, 5, 9], fill: FILL.longright },
  "\\xlongleftarrow": { k: [3, 0, 9, 5], fill: FILL.longleft },
  "\\xhookleftarrow": { k: [3, 0, 9, 5], fill: FILL.hookleft },
  "\\xhookrightarrow": { k: [3, 0, 9, 5], fill: FILL.hookright },
  "\\xmapsto": { k: [0, 3, 9, 5], fill: FILL.mapsto },
  // extarrows
  "\\xlongequal": { k: [0, 0, 9, 9], fill: FILL.equal },
  "\\xLongleftrightarrow": { k: [0, 0, 9, 9], fill: FILL.Longleftright },
  "\\xlongleftrightarrow": { k: [0, 0, 9, 9], fill: FILL.longleftright },
  "\\xLongleftarrow": { k: [0, 0, 9, 9], fill: FILL.Longleft },
  "\\xLongrightarrow": { k: [0, 0, 9, 9], fill: FILL.Longright },
  // extpfeil
  "\\xtwoheadrightarrow": { k: [0, 5, 40, 0], fill: FILL.twoheadright },
  "\\xtwoheadleftarrow": { k: [5, 0, 0, 40], fill: FILL.twoheadleft },
};

/**
 * mathtools' harpoon pairs: \mathrel{\raise.22ex\hbox{$<upper>$}\setbox0=\hbox{$<lower>$}\kern-\wd0
 * \lower.22ex\box0}, each an \ext@arrow; the upper one has a \phantom of the label below, the lower one of the
 * label above.
 */
export const EXT_HARPOONS: Record<string, [ExtArrow, ExtArrow]> = {
  "\\xrightleftharpoons": [EXT_ARROWS["\\xrightharpoonup"], EXT_ARROWS["\\xleftharpoondown"]],
  "\\xleftrightharpoons": [EXT_ARROWS["\\xleftharpoonup"], EXT_ARROWS["\\xrightharpoondown"]],
};

/**
 * stmaryrd.sty's symbols: \DeclareMathSymbol class and position in its font
 * (FAM.stmry), as \mathchar codes without the family. LaTeX's own definitions
 * (amssymb's \boxdot, the kernel's \bigtriangleup) stay as the app's export
 * loads stmaryrd only for the commands it alone defines.
 */
export const STMARYRD: Record<string, number> = {
  "\\shortleftarrow": 0x300,
  "\\shortrightarrow": 0x301,
  "\\shortuparrow": 0x302,
  "\\shortdownarrow": 0x303,
  "\\Yup": 0x204,
  "\\Ydown": 0x205,
  "\\Yleft": 0x206,
  "\\Yright": 0x207,
  "\\varcurlyvee": 0x208,
  "\\varcurlywedge": 0x209,
  "\\minuso": 0x20a,
  "\\baro": 0x20b,
  "\\sslash": 0x20c,
  "\\bbslash": 0x20d,
  "\\moo": 0x20e,
  "\\varotimes": 0x20f,
  "\\varoast": 0x210,
  "\\varobar": 0x211,
  "\\varodot": 0x212,
  "\\varoslash": 0x213,
  "\\varobslash": 0x214,
  "\\varocircle": 0x215,
  "\\varoplus": 0x216,
  "\\varominus": 0x217,
  "\\boxast": 0x218,
  "\\boxbar": 0x219,
  "\\boxdot": 0x21a,
  "\\boxslash": 0x21b,
  "\\boxbslash": 0x21c,
  "\\boxcircle": 0x21d,
  "\\boxbox": 0x21e,
  "\\boxempty": 0x21f,
  "\\lightning": 0x020,
  "\\merge": 0x221,
  "\\vartimes": 0x222,
  "\\fatsemi": 0x223,
  "\\sswarrow": 0x324,
  "\\ssearrow": 0x325,
  "\\curlywedgeuparrow": 0x326,
  "\\curlywedgedownarrow": 0x327,
  "\\fatslash": 0x228,
  "\\fatbslash": 0x229,
  "\\lbag": 0x22a,
  "\\rbag": 0x22b,
  "\\varbigcirc": 0x22c,
  "\\leftrightarroweq": 0x32d,
  "\\curlyveedownarrow": 0x32e,
  "\\curlyveeuparrow": 0x32f,
  "\\nnwarrow": 0x330,
  "\\nnearrow": 0x331,
  "\\leftslice": 0x232,
  "\\rightslice": 0x233,
  "\\varolessthan": 0x234,
  "\\varogreaterthan": 0x235,
  "\\varovee": 0x236,
  "\\varowedge": 0x237,
  "\\talloblong": 0x238,
  "\\interleave": 0x239,
  "\\obar": 0x23a,
  "\\obslash": 0x23b,
  "\\olessthan": 0x23c,
  "\\ogreaterthan": 0x23d,
  "\\ovee": 0x23e,
  "\\owedge": 0x23f,
  "\\oblong": 0x240,
  "\\inplus": 0x341,
  "\\niplus": 0x342,
  "\\nplus": 0x243,
  "\\subsetplus": 0x344,
  "\\supsetplus": 0x345,
  "\\subsetpluseq": 0x346,
  "\\supsetpluseq": 0x347,
  "\\Lbag": 0x448,
  "\\Rbag": 0x549,
  "\\llparenthesis": 0x44c,
  "\\rrparenthesis": 0x54d,
  "\\binampersand": 0x44e,
  "\\bindnasrepma": 0x54f,
  "\\trianglelefteqslant": 0x350,
  "\\trianglerighteqslant": 0x351,
  "\\ntrianglelefteqslant": 0x352,
  "\\ntrianglerighteqslant": 0x353,
  "\\llfloor": 0x454,
  "\\rrfloor": 0x555,
  "\\llceil": 0x456,
  "\\rrceil": 0x557,
  "\\arrownot": 0x358,
  "\\Arrownot": 0x359,
  "\\Mapstochar": 0x35a,
  "\\mapsfromchar": 0x35b,
  "\\Mapsfromchar": 0x35c,
  "\\leftrightarrowtriangle": 0x35d,
  "\\leftarrowtriangle": 0x35e,
  "\\rightarrowtriangle": 0x35f,
  "\\bigtriangledown": 0x160,
  "\\bigtriangleup": 0x161,
  "\\bigcurlyvee": 0x162,
  "\\bigcurlywedge": 0x163,
  "\\bigsqcap": 0x164,
  "\\bigbox": 0x165,
  "\\bigparallel": 0x166,
  "\\biginterleave": 0x167,
  "\\bignplus": 0x170,
};

/** stmaryrd's \DeclareMathDelimiter: small and large positions in its font. */
export const STMARYRD_DELIMS: Record<string, [number, number]> = { "\\llbracket": [0x4a, 0x71], "\\rrbracket": [0x4b, 0x79] };

/** stmaryrd's arrows made of two characters, as its \def\Mapsto{\Mapstochar\Rightarrow} etc. */
export const STMARYRD_DEFS: Record<string, string[]> = {
  "\\Mapsto": ["\\Mapstochar", "\\Rightarrow"],
  "\\mapsfrom": ["\\leftarrow", "\\mapsfromchar"],
  "\\Mapsfrom": ["\\Leftarrow", "\\Mapsfromchar"],
  "\\Longmapsto": ["\\Mapstochar", "\\Longrightarrow"],
  "\\longmapsfrom": ["\\longleftarrow", "\\mapsfromchar"],
  "\\Longmapsfrom": ["\\Longleftarrow", "\\Mapsfromchar"],
};

/** upgreek.sty (its default Euler option): \mathord characters of Euler Roman (FAM.eur). */
export const UPGREEK: Record<string, number> = {
  "\\upalpha": 0x0b,
  "\\upbeta": 0x0c,
  "\\upgamma": 0x0d,
  "\\updelta": 0x0e,
  "\\upepsilon": 0x0f,
  "\\upzeta": 0x10,
  "\\upeta": 0x11,
  "\\uptheta": 0x12,
  "\\upiota": 0x13,
  "\\upkappa": 0x14,
  "\\uplambda": 0x15,
  "\\upmu": 0x16,
  "\\upnu": 0x17,
  "\\upxi": 0x18,
  "\\uppi": 0x19,
  "\\uprho": 0x1a,
  "\\upsigma": 0x1b,
  "\\uptau": 0x1c,
  "\\upupsilon": 0x1d,
  "\\upphi": 0x1e,
  "\\upchi": 0x1f,
  "\\uppsi": 0x20,
  "\\upomega": 0x21,
  "\\upvarepsilon": 0x22,
  "\\upvartheta": 0x23,
  "\\upvarpi": 0x24,
  "\\upvarphi": 0x27,
  "\\Upgamma": 0x00,
  "\\Updelta": 0x01,
  "\\Uptheta": 0x02,
  "\\Uplambda": 0x03,
  "\\Upxi": 0x04,
  "\\Uppi": 0x05,
  "\\Upsigma": 0x06,
  "\\Upupsilon": 0x07,
  "\\Upphi": 0x08,
  "\\Uppsi": 0x09,
  "\\Upomega": 0x0a,
  "\\upvarrho": 0x1a,
  "\\upvarsigma": 0x1b,
};

/** ot1enc.def's accents: Unicode combining mark -> accent character (\`, \', \^, \~, \", \H, \r, \v, \u, \=, \., \c). */
export const OT1_ACCENTS: Record<number, number> = {
  0x300: 0x12,
  0x301: 0x13,
  0x302: 0x5e,
  0x303: 0x7e,
  0x308: 0x7f,
  0x30b: 0x7d,
  0x30a: 0x17,
  0x30c: 0x14,
  0x306: 0x15,
  0x304: 0x16,
  0x307: 0x5f,
  0x327: 0x18,
};

/** ot1enc.def's letters: \ss, \ae, \oe, \o, \AE, \OE, \O, \i, \j. */
export const OT1_LETTERS: Record<string, number> = { "ß": 0x19, "æ": 0x1a, "œ": 0x1b, "ø": 0x1c, "Æ": 0x1d, "Œ": 0x1e, "Ø": 0x1f, "ı": 0x10, "ȷ": 0x11 };

export const PT = 65536;

/** amsmath's dots commands: what each one is before it looks at the next token */
export const SMART_DOTS: Record<string, string> = {
  "\\dots": "dots",
  "\\dotsc": "dotsc",
  "\\dotso": "dotso",
  "\\cdots": "cdots",
  "\\dotsb": "cdots",
  "\\dotsm": "cdots",
  "\\dotsi": "dotsi",
};

/** amsmath \rightdelim@ */
export const RIGHT_DELIM_TOKENS = new Set([")", "]", "\\rbrack", "\\}", "\\rbrace", "\\rangle", "\\rceil", "\\rfloor", "\\rgroup", "\\rmoustache", "\\right", "\\bigr", "\\biggr", "\\Bigr", "\\Biggr"]);

/**
 * The tag of a wrapper shared by a run of atoms (a \text run, a colour or font
 * group, a \colorbox): an object of its own, so the region of no single atom
 * spans the run (the editor puts the caret after an atom at its region's edge).
 */
export interface RunTag {
  run: AtomLike[];
}

export const runTag = (run: AtomLike[]): RunTag => ({ run });

/** TeX's scanning of "<factor><dimen>" such as .6\dimen@ (tex.web 455). */
/** TexType: amsmath's \tag / \tag* atom (kernel environments.ts). */
export function isTagAtom(a: AtomLike): boolean {
  return a.command === "\\tag" || a.command === "\\tag*";
}

/** TexType: amsmath's \intertext, mathtools' \shortintertext. */
export function isIntertextAtom(a: AtomLike): boolean {
  return a.command === "\\intertext" || a.command === "\\shortintertext";
}

/**
 * Text without its leading spaces (TeX skips them at the start of a cell; \ignorespaces) and, with `end`, its
 * trailing ones (\unskip). A space before & or \\ stays in a cell, as in TeX.
 */
export function trimText(atoms: AtomLike[], end = false): AtomLike[] {
  const space = (x: AtomLike) => x.type === "first" || (x.mode === "text" && (x.value ?? "").trim() === "");
  let i = 0;
  let j = atoms.length;
  while (i < j && space(atoms[i])) i++;
  while (end && j > i && space(atoms[j - 1])) j--;
  return [...atoms.slice(0, i).filter((x) => x.type === "first"), ...atoms.slice(i, j)];
}

/** A line of a display environment: a row (its cells, its tag, its source row) or an \intertext. */
export type DisplayLine = { kind: "row"; cells: AtomLike[][]; tag: AtomLike | null; r: number } | { kind: "text"; atom: AtomLike };

export function texScale(factor: string, v: number): number {
  const [ip, fp = ""] = factor.split(".");
  const intPart = ip === "" ? 0 : parseInt(ip, 10);
  const f = decimalToScaled("0." + fp);
  let negative = false;
  if (v < 0) {
    negative = true;
    v = -v;
  }
  const r = nxPlusY(intPart, v, xnOverD(v, f, 0o200000));
  return negative ? -r : r;
}

export interface NativeFonts {
  /** a font for characters missing from the TeX fonts (e.g. CJK), at a size in sp */
  fallback(size: number): TeXFont | null;
}

/** array.sty's template pieces between the cells (\@mkpream) */
export type ArrayPiece =
  | { k: "acol" } // \hskip\col@sep
  | { k: "rule"; pattern: string } // | (pattern "solid"), arydshln's : ("") and ;{dash/gap}
  | { k: "dbl" } // \hskip\doublerulesep between two rules
  | { k: "content"; src: string; index: number };

 // @{...}, !{...}: the index-th of the specification's

/** One column's template: pieces, the cell's alignment (p, m, b: a paragraph `width` wide), >{...} and <{...} */
export interface ArrayColumn {
  pre: ArrayPiece[];
  align: "l" | "c" | "r" | "p" | "m" | "b";
  width?: string;
  before: string[];
  after: string[];
  post: ArrayPiece[];
}

/** The material between an array's rows arydshln's dashed column rules cross or stop at */
export interface ArrayMarks {
  connect: WeakSet<Node>;
  cut: WeakSet<Node>;
  rowsConnect: WeakSet<AlignRow>;
}

/** The array parameters a formula may set before an array */
export interface ArrayParams {
  stretch?: string;
  colsep?: number;
  tabcolsep?: number;
  rulewidth?: number;
  doublerulesep?: number;
  extrarowheight?: number;
}

/** The kernel's cell wrappers (atoms/array.ts CellWrapper) */
export type CellWrapperLike =
  | { command: "\\multicolumn"; columns: number; spec: string }
  | { command: "\\multirow"; rows: string; width: string; vpos?: string; bigstruts?: string; vmove?: string }
  | { command: "\\hdotsfor"; columns: number; spacing?: string };

/** A column specification's tokens with their arguments; *{n}{spec} expanded (array.sty's \NC@rewrite@*). */
export function specTokens(spec: string): { ch: string; arg?: string }[] {
  const out: { ch: string; arg?: string }[] = [];
  const group = (i: number): [string, number] => {
    while (spec[i] === " ") i++;
    if (spec[i] !== "{") return [spec[i] ?? "", i];
    let depth = 0;
    for (let k = i; k < spec.length; k++) {
      if (spec[k] === "{") depth++;
      else if (spec[k] === "}" && --depth === 0) return [spec.slice(i + 1, k), k];
    }
    return [spec.slice(i + 1), spec.length];
  };
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === " ") continue;
    if (ch === "*") {
      const [n, i1] = group(i + 1);
      const [cols, i2] = group(i1 + 1);
      spec = spec.slice(0, i) + cols.repeat(Math.max(0, parseInt(n, 10) || 0)) + spec.slice(i2 + 1);
      i -= 1;
      continue;
    }
    if ("pmb@!<>;".includes(ch)) {
      const [arg, end] = group(i + 1);
      out.push({ ch, arg });
      i = end;
      continue;
    }
    out.push({ ch });
  }
  return out;
}

/** A tabular cell without its leading and trailing spaces (the template's \ignorespaces, \unskip). */
export function trimSpaces(cell: AtomLike[]): AtomLike[] {
  const isSpace = (x: AtomLike) => x.type === "text" && /^\s*$/.test(x.value ?? "");
  let i = 0;
  let j = cell.length;
  while (i < j && (cell[i].type === "first" || isSpace(cell[i]))) i++;
  while (j > i && isSpace(cell[j - 1])) j--;
  return [...cell.slice(0, i).filter((x) => x.type === "first"), ...cell.slice(i, j)];
}

export { HLIST_NODE, VLIST_NODE, SUB_BOX, SUB_MLIST, MATH_CHAR, UNDER_NOAD, OVER_NOAD, BIN_NOAD, REL_NOAD, xOverN, remainder, div };

export type { GlueSpec };

/**
 * TexType: a row typed in an `aligned` environment without an alignment point lines up at its first relation
 * (=, \le, \to, ...), as if `&` stood before it; the kernel's ArrayAtom writes the row that way
 * (kernelAutoAlignPoint, the same rule). Such a row is one a line break made in the editor and nothing split yet
 * (the kernel's provisional rows): its material is in its second cell. A row whose `&` was typed or read keeps it, and
 * LaTeX read from elsewhere keeps its own alignment. Returns the index of the relation among the second cell's atoms
 * (without the cell's start atom), or null.
 */
export function autoAlignPoint(a: AtomLike, r: number, cells: AtomLike[][]): { at: number } | null {
  if (a.environmentName !== "aligned" || !a.kernelProvisionalAlignRows?.has?.(r)) return null;
  const visible = (cell: AtomLike[] | undefined) => (cell ?? []).filter((x) => x.type !== "first");
  if (visible(cells[0]).length > 0 || cells.slice(2).some((cell) => visible(cell).length > 0)) return null;
  if (a.getCellWrappers?.(r, 1)?.length) return null;
  const at = visible(cells[1]).findIndex((x) => x.type === "mrel" && x.mode !== "text");
  return at > 0 ? { at } : null;
}
