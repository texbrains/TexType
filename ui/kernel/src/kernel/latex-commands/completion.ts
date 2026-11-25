// The editor's completion candidates: the command catalogue, the fuzzy score and personal boost that rank it, and
// the numbered candidate pages.


import { _Mathfield } from '../editor-mathfield/mathfield-private';
import {
  kernelCompletionCatalogData,
  kernelCommandFrequencyData,
  kernelNativePreviewsData,
} from '../host';
import { kernelLateFunctions } from '../editor-mathfield/kernel-hooks';
import { LATEX_COMMANDS, MATH_SYMBOLS } from './definitions-utils';

type KernelCompletionPreferences = {
  personalize?: boolean;
  count?: number;
  usage?: Record<string, { recentUses?: number[]; pinned?: boolean }>;
};

/** A candidate as the suggestion list shows and inserts it */
type KernelCandidateInfo = { id: string; command: string; preview: string };

// What completing a command inserts where it differs from the catalogue's template (the toolbar's): cases start
// with one row, Enter adds the next.
const KERNEL_COMPLETION_TEMPLATES: Record<string, string> = {
  "\\begin{cases}": "\\begin{cases}\\placeholder{} & \\placeholder{}\\end{cases}",
};

export const kernelCompletionCatalog = kernelCompletionCatalogData;
export const KERNEL_COMMAND_FREQUENCY = kernelCommandFrequencyData;
export function kernelCompletionInfo(mf: _Mathfield, latex: string): KernelCandidateInfo {
  return mf.kernelCompletionRecords?.get(latex) || {
    id: "mathlive-native:" + latex,
    command: latex,
    preview: latex,
  };
}
// Ranking follows Overleaf's LaTeX autocomplete: CodeMirror's fuzzy match
// score decides the tier (exact > prefix > case-folded prefix > word starts >
// substring > scattered), and within a tier the command's corpus frequency
// (boost, scripts/build_command_frequency.mts) decides the order.
//
// kernelFuzzyScore is a port of FuzzyMatcher.match from
// @codemirror/autocomplete (MIT, (C) Marijn Haverbeke and others), scores
// only. Higher is better; null means no match.
export let KERNEL_PENALTY = { Gap: -1100, NotStart: -700, CaseFold: -200, ByWord: -100, NotFull: -100 };
export function kernelFuzzyScore(word: string, pattern: string): number | null {
  const P = KERNEL_PENALTY;
  if (!pattern.length) return P.NotFull;
  if (word.length < pattern.length) return null;
  const chars = [...pattern].map((c) => c.charCodeAt(0));
  const folded = [...pattern].map((c) => {
    const upper = c.toUpperCase();
    return (upper === c ? c.toLowerCase() : upper).charCodeAt(0);
  });
  const len = chars.length;
  if (len === 1) {
    const first = word.charCodeAt(0);
    let score = word.length === 1 ? 0 : P.NotFull;
    if (first === chars[0]) {} else if (first === folded[0]) score += P.CaseFold; else return null;
    return score;
  }
  const direct = word.indexOf(pattern);
  if (direct === 0) return word.length === pattern.length ? 0 : P.NotFull;
  const any: number[] = [];
  let anyTo = 0;
  if (direct < 0) {
    for (let i = 0, e = Math.min(word.length, 200); i < e && anyTo < len; i++) {
      const next = word.charCodeAt(i);
      if (next === chars[anyTo] || next === folded[anyTo]) any[anyTo++] = i;
    }
    if (anyTo < len) return null;
  }
  const byWord: number[] = [];
  let byWordTo = 0, byWordFolded = false;
  let adjacentTo = 0, adjacentStart = -1, adjacentEnd = -1;
  const hasLower = /[a-z]/.test(word);
  let wordAdjacent = true;
  // 0 non-word, 1 upper, 2 lower/digit
  for (let i = 0, e = Math.min(word.length, 200), prevType = 0; i < e && byWordTo < len; i++) {
    const next = word.charCodeAt(i);
    if (direct < 0 && adjacentTo < len) {
      if (next === chars[adjacentTo] || next === folded[adjacentTo]) {
        if (adjacentTo === 0) adjacentStart = i;
        adjacentEnd = i + 1;
        adjacentTo++;
      } else {
        adjacentTo = 0;
      }
    }
    const type = (next >= 48 && next <= 57) || (next >= 97 && next <= 122) ? 2 : next >= 65 && next <= 90 ? 1 : 0;
    if (!i || (type === 1 && hasLower) || (prevType === 0 && type !== 0)) {
      if (chars[byWordTo] === next || (folded[byWordTo] === next && (byWordFolded = true))) byWord[byWordTo++] = i;
      else if (byWord.length) wordAdjacent = false;
    }
    prevType = type;
  }
  if (byWordTo === len && byWord[0] === 0 && wordAdjacent)
    return P.ByWord + (byWordFolded ? P.CaseFold : 0) - word.length;
  if (adjacentTo === len && adjacentStart === 0)
    return P.CaseFold - word.length + (adjacentEnd === word.length ? 0 : P.NotFull);
  if (direct > -1) return P.NotStart - word.length;
  if (adjacentTo === len) return P.CaseFold + P.NotStart - word.length;
  if (byWordTo === len)
    return P.ByWord + (byWordFolded ? P.CaseFold : 0) + P.NotStart + (wordAdjacent ? 0 : P.Gap) - word.length;
  return len === 2 ? null : (any[0] ? P.NotStart : 0) + P.CaseFold + P.Gap - word.length;
}
// Personal habit as an extra boost in the same units as the corpus frequency
// (\frac ~12.6, \sum ~1.9): uses decay with a 30-day half-life and the boost
// is capped, so habits reorder commands inside a match tier but never lift a
// weaker match above a better one, and one use does not reshuffle the list.
export function kernelPersonalBoost(
  preferences: KernelCompletionPreferences | undefined,
  usageId: string
): number {
  if (!preferences?.personalize || !usageId) return 0;
  const usage = preferences.usage?.[usageId];
  if (!usage) return 0;
  const now = Date.now();
  const recentUses = Array.isArray(usage.recentUses) ? usage.recentUses : [];
  const decayed = recentUses.reduce(
    (sum, timestamp) => sum + Math.pow(0.5, Math.max(0, now - timestamp) / 2_592_000_000),
    0,
  );
  return Math.min(2, Math.log2(1 + decayed)) + (usage.pinned ? 50 : 0);
}

/**
 * Return an array of suggestion for completing string 's'.
 * For example, for '\si', it could return ['\sin', '\sinh', '\sim', 'simeq', '\sigma']
 * Infix operators are excluded, since they are deprecated commands.
 */
/**
 * TexType: the candidates for a typed command, best first: the editor's
 * command catalog (with its templates) and the parser's commands, symbols and
 * macros, ranked by fuzzy match tier, corpus frequency and the user's history.
 */
export function suggest(mf: _Mathfield, s: string): string[] {
  kernelLateFunctions.kernelSyncSourceWrapper!(mf);
  if (!s.startsWith("\\") || s.length < 2) return [];
  const query = s.slice(1).toLowerCase();
  const preferences: KernelCompletionPreferences | undefined = (mf.host as any)
    ?.kernelCompletionPreferences;
  const literalDelimiterCommands = new Set([
    "\\langle", "\\rangle",
    "\\lfloor", "\\rfloor",
    "\\lceil", "\\rceil",
    "\\lvert", "\\rvert",
    "\\lVert", "\\rVert",
    "\\vert", "\\Vert",
  ]);
  const exactLiteralDelimiter = literalDelimiterCommands.has(s);
  // \partial is an atomic MathLive symbol even though TexType also exposes
  // a richer partial-derivative fraction template under the same discovery
  // name. An exact raw command must preserve the literal symbol; prefix/search
  // queries still keep the semantic derivative template available.
  const exactAtomicNativeCommands = new Set(["\\partial"]);
  const exactAtomicNative = exactAtomicNativeCommands.has(s);
  const results = new Map<string, any>();
  const rawQuery = s.slice(1);
  const frequency = (command: string): number => KERNEL_COMMAND_FREQUENCY[command] || 0;
  // Same score: primary catalog entry, then the bare MathLive command, then
  // shared variants; variants of one command keep their catalog priority.
  const tieBreak = (kind: string, priority?: number): number => (kind === "primary" ? 0.002 : kind === "variant" ? -0.002 : 0) + (priority || 0) * 1e-6;
  const parameterizedCatalogCommands = new Set(
    kernelCompletionCatalog
      .filter((record) => record.exact && record.latex.includes("\\placeholder{}"))
      .map((record) => record.command),
  );
  const bareOperatorCommands = new Set([
    "\\int", "\\iint", "\\iiint", "\\oint", "\\oiint", "\\oiiint",
    "\\sum", "\\prod", "\\lim",
  ]);
  const add = (record: any, score: number): void => {
    const latex = KERNEL_COMPLETION_TEMPLATES[record.command] ?? record.latex;
    const old = results.get(latex);
    if (!old || score > old.score) results.set(latex, { ...record, latex, score });
  };
  if (exactLiteralDelimiter) {
    add({
      id: "mathlive-literal:" + s,
      command: s,
      latex: s,
      preview: s,
    }, 6000);
  }
  for (const record of kernelCompletionCatalog) {
    // Raw LaTeX command completion must only consider actual control
    // sequences. Plain-symbol catalog entries such as the physics constant
    // "c" must never outrank the real command "\\c" just because stripping
    // a leading backslash makes their names look identical.
    if (!record.command.startsWith("\\")) continue;
    const name = record.command.slice(1);
    // When the user has typed a literal delimiter or an atomic native
    // symbol exactly, semantic templates must not replace that literal source.
    // Prefix discovery remains unchanged for non-exact queries.
    if (
      exactLiteralDelimiter ||
      (exactAtomicNative && record.command === s && record.latex !== s)
    ) continue;
    let match = kernelFuzzyScore(name, rawQuery);
    // An exactly typed command belongs to its primary entry and the bare
    // command; a shared variant ranks as a prefix match.
    if (match === 0 && !record.exact) match = KERNEL_PENALTY.NotFull;
    // English aliases and keywords (\integral -> \int) are a last tier
    // below every match on the command itself, and need three letters.
    if (match === null && query.length >= 3 && record.words.some((word) =>
      word.toLowerCase().split(/[^a-z0-9]+/).some((term) => term.startsWith(query))))
      match = -3000;
    if (match === null) continue;
    add(
      record,
      match + frequency(record.command) + kernelPersonalBoost(preferences, record.id) +
        tieBreak(record.exact ? "primary" : "variant", record.priority),
    );
  }
  // Native symbols and user macros remain available, with case-insensitive
  // discovery (del -> delta AND Delta) and case-sensitive exact preference.
  for (const command of [...Object.keys(LATEX_COMMANDS), ...Object.keys(MATH_SYMBOLS), ...Object.keys(mf.options.macros).map(x => "\\" + x)]) {
    if (LATEX_COMMANDS[command]?.infix) continue;
    const match = kernelFuzzyScore(command.slice(1), rawQuery);
    if (match === null) continue;
    // Text-mode or diagnostic commands that draw nothing inside a formula, and the kernel's own helpers.
    if (command === "\\emph" || command === "\\error" || command === "\\the") continue;
    if (command.startsWith("\\vtx") || command.startsWith("\\kernel")) continue;
    // Parameterized commands such as \\ket, \\sqrt, \\vec, \\abs and
    // \\norm must never compete with their editable TexType template as a
    // bare command. Large operators are the intentional exception: \\int,
    // \\sum, ... are meaningful by themselves and therefore keep both forms.
    if (
      parameterizedCatalogCommands.has(command) &&
      !bareOperatorCommands.has(command) &&
      !(exactAtomicNative && command === s)
    ) continue;
    const usageId = "mathlive-native:" + command;
    add(
      { id: usageId, command, latex: command, preview: kernelNativePreviewsData[command] ?? command },
      match + frequency(command) + kernelPersonalBoost(preferences, usageId) + tieBreak("native", 0),
    );
  }
  let ranked = [...results.values()].sort((a, b) => b.score - a.score || a.command.length - b.command.length || a.command.localeCompare(b.command));
  // Keep case-insensitive discovery for the first two letters (\be), but once
  // the query is refined (\bet) follow the literal typed prefix so a stale
  // sibling such as \Beta drops out. The panel shows exactly this list, so
  // the controller index, the arrow keys and the number keys all agree.
  if (s.length >= 4) {
    const literal = ranked.filter((r) => r.command.startsWith(s));
    if (literal.length) ranked = literal;
  }
  mf.kernelCompletionRecords = new Map(ranked.map(r => [r.latex, r]));
  return ranked.slice(0, Math.max(6, Math.min(24, preferences?.count || 12))).map(r => r.latex);
}

// Input-method style selection: the candidates are paged by nine and the
// page holding the current candidate is numbered 1-9.
export let KERNEL_CANDIDATE_PAGE_SIZE = 9;
export function kernelCandidatePageStart(mf: _Mathfield): number {
  const index = Math.max(0, mf.suggestionIndex || 0);
  return index - (index % KERNEL_CANDIDATE_PAGE_SIZE);
}
export function kernelCandidateNumberMarkup(mf: _Mathfield, index: number): string {
  const start = kernelCandidatePageStart(mf);
  const number = index >= start && index < start + KERNEL_CANDIDATE_PAGE_SIZE ? String(index - start + 1) : "";
  return '<span class="ML__popover__index" aria-hidden="true">' + number + "</span>";
}
// -1: the key is not a candidate pick. Otherwise the index of the picked
// candidate, or -2 when the digit has no candidate on the current page (the
// key is swallowed, as an input method does).
export function kernelCandidatePanelOpen(mf: _Mathfield): boolean {
  const panel = document.getElementById("mathlive-suggestion-popover");
  if (!panel || (panel as any).kernelMathfield !== mf || panel.getAttribute("aria-hidden") === "true") return false;
  return (mf.kernelCompletion?.suggestions || []).length > 0;
}
export function kernelCandidateIndexForDigit(mf: _Mathfield, evt: KeyboardEvent): number {
  if (mf.model.mode !== "latex" || evt.ctrlKey || evt.metaKey || evt.altKey || evt.isComposing) return -1;
  if (!/^[1-9]$/.test(evt.key || "")) return -1;
  if (!kernelCandidatePanelOpen(mf)) return -1;
  const suggestions = mf.kernelCompletion!.suggestions;
  const index = kernelCandidatePageStart(mf) + Number(evt.key) - 1;
  return index < suggestions.length ? index : -2;
}

/**
 * An argument template has the following syntax:
 *
 * <placeholder>:<type>
 *
 * where
 * - <placeholder> is a string whose value is displayed when the argument
 *   is missing
 * - <type> is one of 'string', 'color', 'dimen', 'auto', 'text', 'math'
 *
 */
