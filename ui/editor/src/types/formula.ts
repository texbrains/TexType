export type FormulaAlignment = "left" | "center" | "right";
export type Theme = "light" | "dark";

export type FormulaLineMode = "inline" | "display";

export type InlineLatexWrapper = "dollar" | "paren";
export type InlineTextPolicy = "text-command" | "outside-math";
export type DisplayLatexWrapper = "double-dollar" | "bracket" | "equation";
export type MultilineLatexEnvironment = "gather" | "align";
export type FormulaDisplayStyle =
  | "default"
  | "double-dollar"
  | "bracket"
  | "equation"
  | "equation-star";

export interface LatexFormatProfile {
  inlineWrapper: InlineLatexWrapper;
  inlineTextPolicy: InlineTextPolicy;
  displayWrapper: DisplayLatexWrapper;
  numbered: boolean;
  multilineEnvironment: MultilineLatexEnvironment;
}

export interface FormulaLine {
  id: string;
  latex: string;
  mode?: FormulaLineMode;
  displayStyle?: FormulaDisplayStyle;
}

export interface InputBehaviorSettings {
  autoEscapeShortcuts: boolean;
  /** Automatic upright typography: units, function names, d, e, i, labels. */
  autoUprightTypography: boolean;
  autoExitSuperscript: boolean;
  autoExitSubscript: boolean;
  autoExitAccent: boolean;
  autoExitWrapperCommand: boolean;
}
