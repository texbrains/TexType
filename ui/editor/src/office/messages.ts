// Why a formula cannot be inserted, worded for the user: the kernel's (English) messages, which the app passes on as
// text, in the user's language.
import { UNFILLED_PLACEHOLDER_MESSAGE } from "@app/kernel/latex/compatibility.ts";

const KNOWN: { pattern: RegExp; zh: (m: RegExpMatchArray) => string; en: (m: RegExpMatchArray) => string }[] = [
  {
    pattern: /^MathJax did not resolve LaTeX command (.+)\.$/,
    zh: (m) => `无法识别 LaTeX 命令 ${m[1]}。`,
    en: (m) => `The LaTeX command ${m[1]} is not known.`,
  },
  {
    pattern: /^MathJax produced an error node: (.+)$/,
    zh: (m) => `公式无法解析：${m[1]}`,
    en: (m) => `The formula cannot be parsed: ${m[1]}`,
  },
  { pattern: /^Cannot export an empty formula\.$/, zh: () => "公式为空。", en: () => "The formula is empty." },
];

export function insertFailure(message: string, isEn: boolean): string {
  if (message === UNFILLED_PLACEHOLDER_MESSAGE) {
    return isEn ? "The formula still has empty boxes. Fill or delete them first." : "公式中仍有空白占位框，请先填写或删除。";
  }
  for (const known of KNOWN) {
    const match = message.match(known.pattern);
    if (match) return isEn ? known.en(match) : known.zh(match);
  }
  return message;
}
