// The package and font commands TexType keeps in LaTeX source and draws through the kernel's compatibility
// macros, which the kernel's validator does not know: pasted or typed LaTeX using them is accepted. With the
// number of required arguments of those that take any.

export const compatibilityCommandNames: ReadonlySet<string> = new Set([
  "varparallel", "parallelslant", "sslash", "dots", "dotsc", "dotso", "dotsb", "dotsm", "dotsi", "qed", "qedsymbol",
  "diagdown", "thinspace", "negthinspace", "medspace", "negmedspace", "thickspace", "negthickspace",
  "shortparallel", "nshortparallel", "mathrel", "mathbin", "pod", "substack", "prescript", "sideset",
  "symup", "symit", "symbf", "symbfup", "symbfit", "symbb", "symcal", "symbfcal", "symscr", "symbfscr", "symfrak",
  "symbffrak", "symsfup", "symsfit", "symbfsfup", "symbfsfit", "symtt",
  "bf", "bfseries", "it", "rm", "sf", "tt", "cal", "Bbb", "frak", "bold", "boldmath", "pmb",
  "abs", "norm", "dd", "bra", "ket", "expval", "vb", "va", "vu", "comm", "acomm", "pb", "dv", "pdv", "braket", "ketbra",
  "mel",
]);

// \braket takes physics' two arguments or braket.sty's one with | separators inside: one is the minimum.
export const compatibilityRequiredArgumentCounts: ReadonlyMap<string, number> = new Map([
  ["bm", 1], ["mathbfit", 1], ["mathrel", 1], ["mathbin", 1], ["pod", 1], ["substack", 1], ["prescript", 3],
  ["symup", 1], ["symit", 1], ["symbf", 1], ["symbfup", 1], ["symbfit", 1], ["symbb", 1], ["symcal", 1],
  ["symbfcal", 1], ["symscr", 1], ["symbfscr", 1], ["symfrak", 1], ["symbffrak", 1], ["symsfup", 1], ["symsfit", 1],
  ["symbfsfup", 1], ["symbfsfit", 1], ["symtt", 1],
  ["bf", 1], ["bfseries", 1], ["it", 1], ["rm", 1], ["sf", 1], ["tt", 1], ["cal", 1], ["Bbb", 1], ["frak", 1],
  ["bold", 1], ["boldmath", 1], ["pmb", 1],
  ["abs", 1], ["norm", 1], ["dd", 1], ["bra", 1], ["ket", 1], ["expval", 1], ["vb", 1], ["va", 1], ["vu", 1],
  ["comm", 2], ["acomm", 2], ["pb", 2], ["dv", 2], ["pdv", 2], ["braket", 1], ["ketbra", 2], ["mel", 3],
]);
