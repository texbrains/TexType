// The macros the parser knows before any user macro: texvc's, amsmath's and braket's, and the defaults that
// include the kernel's own (definitions-utils.ts uses them for getMacros).


import { _Mathfield } from '../editor-mathfield/mathfield-private';
import type {
  MacroDictionary,
  MacroPackageDefinition,
} from '../public/core-types';
import { kernelDefaultMacros } from '../host';

export const TEXVC_MACROS: MacroDictionary = {
  //////////////////////////////////////////////////////////////////////
  // texvc.sty

  // The texvc package
  // (https://ctan.math.illinois.edu/macros/latex/contrib/texvc/texvc.pdf)
  // contains macros available in mediawiki pages.
  // We omit the functions deprecated at
  // https://en.wikipedia.org/wiki/Help:Displaying_a_formula#Deprecated_syntax

  // We also omit texvc's \O, which conflicts with \text{\O}

  darr: '\\downarrow',
  dArr: '\\Downarrow',
  Darr: '\\Downarrow',
  lang: '\\langle',
  rang: '\\rangle',
  uarr: '\\uparrow',
  uArr: '\\Uparrow',
  Uarr: '\\Uparrow',
  C: '\\mathbb{C}',
  H: '\\mathbb{H}',
  N: '\\mathbb{N}',
  Q: '\\mathbb{Q}',
  R: '\\mathbb{R}',
  Z: '\\mathbb{Z}',
  alef: '\\aleph',
  alefsym: '\\aleph',
  Alpha: '\\mathrm{A}',
  // and: '\\land',
  //  ang: '\\angle',   // We use the def from the siunitx package
  Beta: '\\mathrm{B}',
  bull: '\\bullet',
  Chi: '\\mathrm{X}',
  clubs: '\\clubsuit',
  cnums: '\\mathbb{C}',
  Complex: '\\mathbb{C}',
  Dagger: '\\ddagger',
  diamonds: '\\diamondsuit',
  //  Doteq: '\\doteq',   // We map it to U+2251, while \doteq is U+2250
  doublecap: '\\Cap',
  doublecup: '\\Cup',
  empty: '\\emptyset',
  Epsilon: '\\mathrm{E}',
  Eta: '\\mathrm{H}',
  exist: '\\exists',
  //  ge: '\\geq', // We have it as a builtin
  //  gggtr: '\\ggg', // We have it as a builtin
  hArr: '\\Leftrightarrow',
  harr: '\\leftrightarrow',
  Harr: '\\Leftrightarrow',
  hearts: '\\heartsuit',
  image: '\\Im',
  infin: '\\infty',
  Iota: '\\mathrm{I}',
  isin: '\\in',
  Kappa: '\\mathrm{K}',
  larr: '\\leftarrow',
  Larr: '\\Leftarrow',
  lArr: '\\Leftarrow',
  //  le: '\\leq', // We have it as a builtin
  lrarr: '\\leftrightarrow',
  Lrarr: '\\Leftrightarrow',
  lrArr: '\\Leftrightarrow',
  Mu: '\\mathrm{M}',
  natnums: '\\mathbb{N}',
  // ne: '\\neq',   // We have it as a builtin
  Nu: '\\mathrm{N}',
  //  O: '\\emptyset', // Conflicts with \O text command
  //  omicron: '\\mathrm{o}', // We have it as a builtin
  Omicron: '\\mathrm{O}',
  // or: '\\lor',
  part: '\\partial',
  plusmn: '\\pm',
  rarr: '\\rightarrow',
  Rarr: '\\Rightarrow',
  rArr: '\\Rightarrow',
  real: '\\Re',
  reals: '\\mathbb{R}',
  Reals: '\\mathbb{R}',
  restriction: '\\upharpoonright',
  Rho: '\\mathrm{P}',
  sdot: '\\cdot',
  sect: '\\S',
  spades: '\\spadesuit',
  sub: '\\subset',
  sube: '\\subseteq',
  supe: '\\supseteq',
  Tau: '\\mathrm{T}',
  thetasym: '\\vartheta',
  varcoppa: '\\coppa',
  weierp: '\\wp',
  Zeta: '\\mathrm{Z}',
};

export const AMSMATH_MACROS: MacroDictionary = {
  // amsmath.sty
  // http://mirrors.concertpass.com/tex-archive/macros/latex/required/amsmath/amsmath.pdf

  // Italic Greek capital letters.  AMS defines these with \DeclareMathSymbol,
  // but they are equivalent to \mathit{\Letter}.
  varGamma: '\\mathit{\\Gamma}',
  varDelta: '\\mathit{\\Delta}',
  varTheta: '\\mathit{\\Theta}',
  varLambda: '\\mathit{\\Lambda}',
  varXi: '\\mathit{\\Xi}',
  varPi: '\\mathit{\\Pi}',
  varSigma: '\\mathit{\\Sigma}',
  varUpsilon: '\\mathit{\\Upsilon}',
  varPhi: '\\mathit{\\Phi}',
  varPsi: '\\mathit{\\Psi}',
  varOmega: '\\mathit{\\Omega}',

  // From http://tug.ctan.org/macros/latex/required/amsmath/amsmath.dtx
  // > \newcommand{\pod}[1]{
  // >    \allowbreak
  // >    \if@display
  // >      \mkern18mu
  // >    \else
  // >      \mkern8mu
  // >    \fi
  // >    (#1)
  // > }
  // 18mu = \quad
  // > \renewcommand{\pmod}[1]{
  // >  \pod{{\operator@font mod}\mkern6mu#1}
  // > }

  pmod: {
    def: '\\quad(\\operatorname{mod}\\ #1)',
    args: 1,
    expand: false,
    captureSelection: false,
  },

  // > \newcommand{\mod}[1]{
  // >    \allowbreak
  // >    \if@display
  // >      \mkern18mu
  // >    \else
  // >      \mkern12mu
  // >    \fi
  //>     {\operator@font mod}\,\,#1}

  mod: {
    def: '\\quad\\operatorname{mod}\\,\\,#1',
    args: 1,
    expand: false,
  },

  // > \renewcommand{\bmod}{
  // >  \nonscript\mskip-\medmuskip\mkern5mu
  // >  \mathbin{\operator@font mod}
  // >  \penalty900 \mkern5mu
  // >  \nonscript\mskip-\medmuskip
  // > }
  // 5mu = \;

  bmod: {
    def: '\\;\\mathbin{\\operatorname{mod }}',
    expand: false,
  },

  // TexType: amsmath \sideset{#1}{#2}#3, scripts on both sides of an
  // operator that keeps its limits. The layout engine builds it as amsmath
  // does; this expansion gives the arguments their slots.
  sideset: {
    def: '{}#1#3#2',
    args: 3,
    expand: false,
    captureSelection: false,
  },
};

// From `braket.sty`, Dirac notation
export const BRAKET_MACROS: MacroDictionary = {
  bra: { def: '\\mathinner{\\langle{#1}|}', args: 1, captureSelection: false },
  ket: { def: '\\mathinner{|{#1}\\rangle}', args: 1, captureSelection: false },
  // TexType: physics.sty's \braket{a}{b} as well. Its second argument is
  // xparse `g`: taken only when a brace group follows; otherwise braket.sty's
  // one argument, | inside it as written (\braket{\phi|\psi}).
  braket: {
    def: '\\left\\langle #1\\middle\\vert #2\\right\\rangle',
    args: 2,
    defWithoutLastArgument: '\\mathinner{\\langle{#1}\\rangle}',
    expand: false,
    captureSelection: false,
  },
  set: {
    def: '\\mathinner{\\lbrace #1 \\rbrace}',
    args: 1,
    captureSelection: false,
  },
  Bra: { def: '\\left\\langle #1\\right|', args: 1, captureSelection: false },
  Ket: { def: '\\left|#1\\right\\rangle', args: 1, captureSelection: false },
  Braket: {
    def: '\\left\\langle{#1}\\right\\rangle',
    args: 1,
    captureSelection: false,
  },
  Set: {
    def: '\\left\\lbrace #1 \\right\\rbrace',
    args: 1,
    captureSelection: false,
  },
};

export const DEFAULT_MACROS: MacroDictionary = {
  ...kernelDefaultMacros,
  'strut': {
    primitive: true,
    def: '\\phantom{\\rule[0.3\\baselineskip]{0}{0.7\\baselineskip}}',
    args: 0,
    captureSelection: true,
  },

  'iff': {
    primitive: true,
    captureSelection: true,
    def: '\\;\\Longleftrightarrow\\;', // >2,000 Note: additional spaces around the arrows, as per AMSMATH package definition
  },

  'nicefrac': '^{#1}\\!\\!/\\!_{#2}',

  'phase': {
    def: '\\enclose{phasorangle}{#1}',
    args: 1,
    captureSelection: false,
  },

  // Proof Wiki
  'rd': '\\mathrm{d}',
  'rD': '\\mathrm{D}',

  // Derivative package
  'odif': '\\mathrm{d}',

  // From Wolfram Alpha
  'doubleStruckCapitalN': '\\mathbb{N}',
  'doubleStruckCapitalR': '\\mathbb{R}',
  'doubleStruckCapitalQ': '\\mathbb{Q}',
  'doubleStruckCapitalZ': '\\mathbb{Z}',
  'doubleStruckCapitalP': '\\mathbb{P}',

  'scriptCapitalE': '\\mathscr{E}',
  'scriptCapitalH': '\\mathscr{H}',
  'scriptCapitalL': '\\mathscr{L}',
  'gothicCapitalC': '\\mathfrak{C}',
  'gothicCapitalH': '\\mathfrak{H}',
  'gothicCapitalI': '\\mathfrak{I}',
  'gothicCapitalR': '\\mathfrak{R}',

  'imaginaryI': '\\mathrm{i}', // NOTE: set in main (upright) as per ISO 80000-2:2009.
  'imaginaryJ': '\\mathrm{j}', // NOTE: set in main (upright) as per ISO 80000-2:2009.

  'exponentialE': '\\mathrm{e}', // NOTE: set in main (upright) as per ISO 80000-2:2009.
  'differentialD': '\\mathrm{d}', // NOTE: set in main (upright) as per ISO 80000-2:2009.
  'capitalDifferentialD': '\\mathrm{D}', // NOTE: set in main (upright) as per ISO 80000-2:2009.

  'mathstrut': { def: '\\vphantom{(}', primitive: true },

  // https://ctan.math.washington.edu/tex-archive/macros/latex/contrib/actuarialangle/actuarialangle.pdf
  'angl': '\\enclose{actuarial}{#1}',
  'angln': '\\enclose{actuarial}{n}',
  'anglr': '\\enclose{actuarial}{r}',
  'anglk': '\\enclose{actuarial}{k}',

  //////////////////////////////////////////////////////////////////////
  // mathtools.sty
  // In the summer of 2022, mathtools did some renaming of macros.
  // This is the latest version, with some legacy commands.
  // See https://mirrors.ircam.fr/pub/CTAN/macros/latex/contrib/mathtools/mathtools.pdf

  'mathtools': {
    primitive: true,
    package: {
      //\providecommand\ordinarycolon{:}
      ordinarycolon: ':',
      //\def\vcentcolon{\mathrel{\mathop\ordinarycolon}}
      // TexType: centred by the layout engine (an \mathop of one character)
      vcentcolon: '\\mathrel{\\mathop\\ordinarycolon}',
      // TexType: the symbols as mathtools builds them (current, non-legacy
      // names: \coloneq is \coloneqq, \eqcolon is \eqqcolon), not single
      // Unicode characters the TeX fonts do not have
      // \newcommand*\MATHT@dblcolon{\vcentcolon\mathrel{\mkern-.9mu}\vcentcolon}
      dblcolon: '\\vcentcolon\\mathrel{\\mkern-.9mu}\\vcentcolon',
      // \newcommand*\MATHT@coloneq{\vcentcolon\mathrel{\mkern-1.2mu}=}
      coloneqq: '\\vcentcolon\\mathrel{\\mkern-1.2mu}=',
      // \newcommand*\MATHT@dblcoloneq{\dblcolon\mathrel{\mkern-1.2mu}=}
      Coloneqq: '\\dblcolon\\mathrel{\\mkern-1.2mu}=',
      coloneq: '\\vcentcolon\\mathrel{\\mkern-1.2mu}=',
      Coloneq: '\\dblcolon\\mathrel{\\mkern-1.2mu}=',
      // \newcommand*\MATHT@eqcolon{=\mathrel{\mkern-1.2mu}\vcentcolon}
      eqqcolon: '=\\mathrel{\\mkern-1.2mu}\\vcentcolon',
      // \newcommand*\MATHT@eqdblcolon{=\mathrel{\mkern-1.2mu}\dblcolon}
      Eqqcolon: '=\\mathrel{\\mkern-1.2mu}\\dblcolon',
      eqcolon: '=\\mathrel{\\mkern-1.2mu}\\vcentcolon',
      Eqcolon: '=\\mathrel{\\mkern-1.2mu}\\dblcolon',
      // \newcommand*\MATHT@colonapprox{\vcentcolon\mathrel{\mkern-1.2mu}\approx}
      colonapprox: '\\vcentcolon\\mathrel{\\mkern-1.2mu}\\approx',
      Colonapprox: '\\dblcolon\\mathrel{\\mkern-1.2mu}\\approx',
      // \newcommand*\MATHT@colonsim{\vcentcolon\mathrel{\mkern-1.2mu}\sim}
      colonsim: '\\vcentcolon\\mathrel{\\mkern-1.2mu}\\sim',
      Colonsim: '\\dblcolon\\mathrel{\\mkern-1.2mu}\\sim',

      colondash: '\\mathrel{\\vcentcolon\\mathrel{\\mkern-1.2mu}\\mathrel{-}}', // :-
      Colondash: '\\mathrel{\\dblcolon\\mathrel{\\mkern-1.2mu}\\mathrel{-}}',

      dashcolon: '\\mathrel{\\mathrel{-}\\mathrel{\\mkern-1.2mu}\\vcentcolon}',
      Dashcolon: '\\mathrel{\\mathrel{-}\\mathrel{\\mkern-1.2mu}\\dblcolon}',
    },
  },
  //////////////////////////////////////////////////////////////////////
  // colonequals.sty

  // Alternate names for mathtools's macros:
  'ratio': '\\vcentcolon',
  'coloncolon': '\\dblcolon',
  'colonequals': '\\coloneq',
  'coloncolonequals': '\\Coloneq',
  'equalscolon': '\\eqcolon',
  'equalscoloncolon': '\\Eqcolon',
  'colonminus': '\\colondash',
  'coloncolonminus': '\\Colondash',
  'minuscolon': '\\dashcolon',
  'minuscoloncolon': '\\Dashcolon',
  // \colonapprox name is same in mathtools and colonequals.
  'coloncolonapprox': '\\Colonapprox',
  // \colonsim name is same in mathtools and colonequals.
  'coloncolonsim': '\\Colonsim',

  // Additional macros, implemented by analogy with mathtools definitions:
  'simcolon': '\\mathrel{\\sim\\mathrel{\\mkern-1.2mu}\\vcentcolon}',
  'Simcolon': '\\mathrel{\\sim\\mathrel{\\mkern-1.2mu}\\dblcolon}',
  'simcoloncolon': '\\mathrel{\\sim\\mathrel{\\mkern-1.2mu}\\dblcolon}',
  'approxcolon': '\\mathrel{\\approx\\mathrel{\\mkern-1.2mu}\\vcentcolon}',
  'Approxcolon': '\\mathrel{\\approx\\mathrel{\\mkern-1.2mu}\\dblcolon}',
  'approxcoloncolon': '\\mathrel{\\approx\\mathrel{\\mkern-1.2mu}\\dblcolon}',

  // Present in newtxmath, pxfonts and txfonts
  'notni': '\\mathrel{\\char`\u220C}',
  'limsup': '\\operatorname*{lim\\,sup}',
  'liminf': '\\operatorname*{lim\\,inf}',

  //////////////////////////////////////////////////////////////////////
  // From amsopn.sty
  'injlim': '\\operatorname*{inj\\,lim}',
  'projlim': '\\operatorname*{proj\\,lim}',
  'varlimsup': '\\operatorname*{\\overline{lim}}',
  'varliminf': '\\operatorname*{\\underline{lim}}',
  'varinjlim': '\\operatorname*{\\underrightarrow{lim}}',
  'varprojlim': '\\operatorname*{\\underleftarrow{lim}}',

  //////////////////////////////////////////////////////////////////////
  // statmath.sty
  // https://ctan.math.illinois.edu/macros/latex/contrib/statmath/statmath.pdf

  'argmin': '\\operatorname*{arg\\,min}',
  'argmax': '\\operatorname*{arg\\,max}',
  'plim': '\\mathop{\\operatorname{plim}}\\limits',

  // mhchem

  'tripledash': {
    def: '\\vphantom{-}\\raise{4mu}{\\mkern1.5mu\\rule{2mu}{1.5mu}\\mkern{2.25mu}\\rule{2mu}{1.5mu}\\mkern{2.25mu}\\rule{2mu}{1.5mu}\\mkern{2mu}}',
    expand: true,
  },
  'braket.sty': { package: BRAKET_MACROS } as MacroPackageDefinition,
  'amsmath.sty': {
    package: AMSMATH_MACROS,
    primitive: true,
  } as MacroPackageDefinition,
  'texvc.sty': {
    package: TEXVC_MACROS,
    primitive: false,
  } as MacroPackageDefinition,
};

// Body-text symbols
// See http://ctan.mirrors.hoobly.com/info/symbols/comprehensive/symbols-a4.pdf, p14
