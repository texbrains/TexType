import type { FormulaDisplayStyle, LatexFormatProfile } from "../types/formula";

/** How the source view writes rows: inline as $...$ with text outside, display as $$...$$, several rows in gather*. */
export const DEFAULT_LATEX_FORMAT_PROFILE: LatexFormatProfile = {
  inlineWrapper: "dollar",
  inlineTextPolicy: "outside-math",
  displayWrapper: "double-dollar",
  numbered: false,
  multilineEnvironment: "gather",
};

export function resolveFormulaDisplayStyle(
  style: FormulaDisplayStyle | undefined,
  profile: LatexFormatProfile,
): Exclude<FormulaDisplayStyle, "default"> {
  if (style && style !== "default") return style;
  if (profile.displayWrapper === "bracket") return "bracket";
  if (profile.displayWrapper === "equation") {
    return profile.numbered ? "equation" : "equation-star";
  }
  return "double-dollar";
}
