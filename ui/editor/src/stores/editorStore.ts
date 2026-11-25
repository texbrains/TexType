import { create } from "zustand";
import type { CommandSource, CommandUsage } from "../types/command";
import type {
  FormulaAlignment,
  FormulaDisplayStyle,
  FormulaLine,
  FormulaLineMode,
  InputBehaviorSettings,
  LatexFormatProfile,
  Theme,
} from "../types/formula";
import type { DocumentSnapshot } from "../history/historyTypes";
import { DEFAULT_LATEX_FORMAT_PROFILE } from "../clipboard/latexFormatProfile";
import { normalizeChineseLatex } from "../editor/normalizeChineseLatex";
import { normalizeFormulaLinePhysicalWhitespace } from "../math/formulaLineLatex";
import { setUprightJudgmentEnabled } from "@app/kernel/typing/judgment.ts";
import { setExamZhSymbolsEnabled } from "@app/kernel/latex/exam-zh-symbols.ts";
import { isSingleCompleteLatexEnvironment } from "@app/kernel/latex/environment.ts";
import {
  DEFAULT_FORMULA_CHINESE_FONT,
  DEFAULT_FORMULA_FACES,
  DEFAULT_FORMULA_LETTER_FONT,
  setFormulaFonts,
  type FormulaChineseFont,
  type FormulaFaces,
  type FormulaLetterFont,
} from "@app/kernel/render/fonts.ts";
import {
  defaultFormulaSpacingPreferences,
  setFormulaSpacing,
  type FormulaSpacingPreferences,
} from "@app/kernel/render/spacing.ts";

export type Language = "cn" | "en";
export const MIN_EDITOR_ZOOM = 0.2;
export const MAX_EDITOR_ZOOM = 1.6;

const DEFAULT_INPUT_BEHAVIOR_SETTINGS: InputBehaviorSettings = {
  autoEscapeShortcuts: true,
  autoUprightTypography: true,
  autoExitSuperscript: true,
  autoExitSubscript: true,
  autoExitAccent: true,
  autoExitWrapperCommand: true,
};

function normalizeFormulaDisplayStyle(value: unknown): FormulaDisplayStyle {
  return value === "double-dollar" ||
    value === "bracket" ||
    value === "equation" ||
    value === "equation-star"
    ? value
    : "default";
}

function normalizeFormulaLineLatex(latex: string) {
  const normalized = latex.replace(/\r\n?/g, "\n");
  const trimmed = normalized.trim();
  return normalizeChineseLatex(
    isSingleCompleteLatexEnvironment(trimmed)
      ? trimmed
      : normalizeFormulaLinePhysicalWhitespace(normalized),
  );
}

export function createFormulaLine(
  latex = "",
  id: string = crypto.randomUUID(),
  mode: FormulaLineMode = "display",
  displayStyle: FormulaDisplayStyle = "default",
): FormulaLine {
  return {
    id,
    latex: normalizeFormulaLineLatex(latex),
    mode: mode === "inline" ? "inline" : "display",
    displayStyle: normalizeFormulaDisplayStyle(displayStyle),
  };
}

function uniqueLineId(candidate: string, usedIds: Set<string>) {
  let id = candidate.trim();
  while (!id || usedIds.has(id)) id = crypto.randomUUID();
  usedIds.add(id);
  return id;
}

/** Rows as the store keeps them: unique ids, normalized LaTeX, and at least one row. */
function normalizeFormulaLines(lines: readonly FormulaLine[]): FormulaLine[] {
  const usedIds = new Set<string>();
  const normalized = lines.map((line) =>
    createFormulaLine(line.latex, uniqueLineId(line.id, usedIds), line.mode, line.displayStyle),
  );
  return normalized.length ? normalized : [createFormulaLine()];
}

export function cloneFormulaLines(lines: readonly FormulaLine[]): FormulaLine[] {
  return lines.map((line) => ({ ...line }));
}

function validActiveLineId(lines: readonly FormulaLine[], candidate: string | null): string | null {
  return candidate !== null && lines.some((line) => line.id === candidate)
    ? candidate
    : lines[0]?.id ?? null;
}

interface EditorState {
  title: string;
  lines: FormulaLine[];
  activeLineId: string | null;
  formulaAlignment: FormulaAlignment;
  /** How the source view writes the rows (fixed: the default profile). */
  latexFormatProfile: LatexFormatProfile;
  usage: Record<string, CommandUsage>;

  // Settings the Office window sets from the app's settings.
  theme: Theme;
  language: Language;
  zoom: number;
  formulaLetterFont: FormulaLetterFont;
  formulaChineseFont: FormulaChineseFont;
  /** Letters, Greek letters and digits in fonts of their own ("": the math font). */
  formulaFaces: FormulaFaces;
  /** Spacing configurations per formula font. */
  formulaSpacing: FormulaSpacingPreferences;
  inputBehavior: InputBehaviorSettings;
  autoPairDelimiters: boolean;
  /** The user writes exam-zh's spelling of the congruence and similarity signs. */
  examZhSymbols: boolean;
  /** Command candidates learn from what the user picks. */
  personalize: boolean;
  suggestionCount: number;
  showLineNumbers: boolean;
  formulaInsetLeft: number;
  formulaInsetRight: number;
  formulaRowVerticalInset: number;

  setActiveLineId: (lineId: string | null) => void;
  replaceFormulaLine: (lineId: string, latex: string, activeLineId?: string | null) => void;
  setFormulaAlignment: (alignment: FormulaAlignment) => void;
  replaceDocumentState: (snapshot: DocumentSnapshot) => void;
  recordCommand: (commandId: string, prefix: string, source: CommandSource) => void;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
  setZoom: (zoom: number) => void;
  setFormulaFonts: (fonts: { letter: FormulaLetterFont; chinese: FormulaChineseFont; faces: FormulaFaces }) => void;
  setFormulaSpacing: (spacing: FormulaSpacingPreferences) => void;
  setInputBehavior: (settings: InputBehaviorSettings) => void;
  setExamZhSymbols: (enabled: boolean) => void;
}

const initialLines = [createFormulaLine()];

export const useEditorStore = create<EditorState>()((set) => ({
  title: "",
  lines: initialLines,
  activeLineId: initialLines[0].id,
  formulaAlignment: "left",
  latexFormatProfile: DEFAULT_LATEX_FORMAT_PROFILE,
  usage: {},
  theme: "light",
  language: "cn",
  zoom: 0.6,
  formulaLetterFont: DEFAULT_FORMULA_LETTER_FONT,
  formulaChineseFont: DEFAULT_FORMULA_CHINESE_FONT,
  formulaFaces: { ...DEFAULT_FORMULA_FACES },
  formulaSpacing: defaultFormulaSpacingPreferences(),
  inputBehavior: { ...DEFAULT_INPUT_BEHAVIOR_SETTINGS },
  autoPairDelimiters: true,
  examZhSymbols: true,
  personalize: true,
  suggestionCount: 6,
  showLineNumbers: false,
  formulaInsetLeft: 34,
  formulaInsetRight: 34,
  formulaRowVerticalInset: 5,

  setActiveLineId: (activeLineId) =>
    set((state) => ({ activeLineId: validActiveLineId(state.lines, activeLineId) })),
  replaceFormulaLine: (lineId, latex, activeLineId) =>
    set((state) => {
      const normalized = normalizeFormulaLineLatex(latex);
      const nextActive = validActiveLineId(
        state.lines,
        activeLineId === undefined ? state.activeLineId : activeLineId,
      );
      const line = state.lines.find((item) => item.id === lineId);
      if (!line || (line.latex === normalized && state.activeLineId === nextActive)) return state;
      return {
        activeLineId: nextActive,
        lines:
          line.latex === normalized
            ? state.lines
            : state.lines.map((item) => (item.id === lineId ? { ...item, latex: normalized } : item)),
      };
    }),
  setFormulaAlignment: (formulaAlignment) => set({ formulaAlignment }),
  replaceDocumentState: (snapshot) => {
    const lines = normalizeFormulaLines(snapshot.lines);
    set({
      title: snapshot.title,
      lines,
      activeLineId: validActiveLineId(lines, snapshot.activeLineId),
      formulaAlignment: snapshot.formulaAlignment,
    });
  },
  recordCommand: (commandId, prefix, source) =>
    set((state) => {
      const now = Date.now();
      const normalizedPrefix = prefix.replace(/^\\/, "").toLocaleLowerCase();
      const previous = state.usage[commandId] ?? {
        commandId,
        useCount: 0,
        lastUsedAt: 0,
        recentUses: [],
        acceptedPrefixes: {},
        contextCounts: {},
        pinned: false,
      };
      return {
        usage: {
          ...state.usage,
          [commandId]: {
            ...previous,
            useCount: previous.useCount + 1,
            lastUsedAt: now,
            recentUses: [...previous.recentUses, now].slice(-12),
            acceptedPrefixes: {
              ...previous.acceptedPrefixes,
              [normalizedPrefix]: (previous.acceptedPrefixes[normalizedPrefix] ?? 0) + 1,
            },
            contextCounts: {
              ...(previous.contextCounts ?? {}),
              [source]: (previous.contextCounts?.[source] ?? 0) + 1,
            },
          },
        },
      };
    }),
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, zoom)) }),
  setFormulaFonts: (fonts) => {
    setFormulaFonts(fonts);
    set({ formulaLetterFont: fonts.letter, formulaChineseFont: fonts.chinese, formulaFaces: fonts.faces });
  },
  setFormulaSpacing: (formulaSpacing) => {
    setFormulaSpacing(formulaSpacing);
    set({ formulaSpacing });
  },
  setInputBehavior: (inputBehavior) => set({ inputBehavior }),
  setExamZhSymbols: (examZhSymbols) => set({ examZhSymbols }),
}));

// The upright switch also governs normalization outside the formula fields (pasted and source LaTeX).
setUprightJudgmentEnabled(useEditorStore.getState().inputBehavior.autoUprightTypography);
useEditorStore.subscribe((state) => setUprightJudgmentEnabled(state.inputBehavior.autoUprightTypography));

// The exam-zh spelling of the congruence and similarity signs, read and written at the editor's edges.
setExamZhSymbolsEnabled(useEditorStore.getState().examZhSymbols);
useEditorStore.subscribe((state) => setExamZhSymbolsEnabled(state.examZhSymbols));
