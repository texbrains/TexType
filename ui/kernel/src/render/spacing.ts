import {
  SPACING_DEFINITIONS,
  spacingPercent,
  type Spacing,
} from "../layout/spacing.ts";
import type { FormulaLetterFont } from "./fonts.ts";

// Formula spacing (Settings > Interface customization): for each formula font
// a list of named configurations of the layout engine's spacing adjustments
// (percentages of LaTeX's spacing, layout/spacing.ts) and the one in use.
// The editor, previews, caret and Office window all lay out with the active
// configuration of the chosen font.

export interface FormulaSpacingConfig {
  id: string;
  /** "" for the built-in first configuration (shown as "Default") */
  name: string;
  values: Spacing;
}

export interface FormulaSpacingFontState {
  activeId: string;
  configs: FormulaSpacingConfig[];
}

export type FormulaSpacingPreferences = Record<FormulaLetterFont, FormulaSpacingFontState>;

export const DEFAULT_FORMULA_SPACING_CONFIG_ID = "default";
const MAX_CONFIGS = 30;
const MAX_NAME_LENGTH = 60;
export const FORMULA_SPACING_CHANGED_EVENT = "kernel-formula-spacing-changed";

function defaultFontState(): FormulaSpacingFontState {
  return {
    activeId: DEFAULT_FORMULA_SPACING_CONFIG_ID,
    configs: [{ id: DEFAULT_FORMULA_SPACING_CONFIG_ID, name: "", values: {} }],
  };
}

export function defaultFormulaSpacingPreferences(): FormulaSpacingPreferences {
  return { katex: defaultFontState(), times: defaultFontState() };
}

/** Only known adjustments, within their ranges; 100 (LaTeX's) is left out. */
export function normalizeSpacingValues(value: unknown): Spacing {
  const out: Spacing = {};
  if (!value || typeof value !== "object") return out;
  for (const d of SPACING_DEFINITIONS) {
    const raw = (value as Record<string, unknown>)[d.key];
    if (typeof raw !== "number") continue;
    const p = spacingPercent({ [d.key]: raw }, d.key);
    if (p !== 100) out[d.key] = p;
  }
  return out;
}

function normalizeFontState(value: unknown): FormulaSpacingFontState {
  if (!value || typeof value !== "object") return defaultFontState();
  const raw = value as { activeId?: unknown; configs?: unknown };
  const configs: FormulaSpacingConfig[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.configs) ? raw.configs : []) {
    if (!item || typeof item !== "object") continue;
    const c = item as { id?: unknown; name?: unknown; values?: unknown };
    if (typeof c.id !== "string" || !c.id || c.id.length > 64 || seen.has(c.id)) continue;
    seen.add(c.id);
    configs.push({
      id: c.id,
      name: typeof c.name === "string" ? c.name.slice(0, MAX_NAME_LENGTH) : "",
      values: normalizeSpacingValues(c.values),
    });
    if (configs.length >= MAX_CONFIGS) break;
  }
  if (configs.length === 0) return defaultFontState();
  const activeId = typeof raw.activeId === "string" && seen.has(raw.activeId) ? raw.activeId : configs[0].id;
  return { activeId, configs };
}

export function normalizeFormulaSpacingPreferences(value: unknown): FormulaSpacingPreferences {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { katex: normalizeFontState(raw.katex), times: normalizeFontState(raw.times) };
}

/**
 * Configurations of `incoming` (a document's or an imported configuration's)
 * take the place of those with the same id in `current` and are added
 * otherwise; their active configurations become the active ones. The user's
 * other configurations stay.
 */
export function activeFormulaSpacingConfig(
  preferences: FormulaSpacingPreferences,
  font: FormulaLetterFont,
): FormulaSpacingConfig {
  const state = preferences[font];
  return state.configs.find((c) => c.id === state.activeId) ?? state.configs[0];
}

/** The adjustments the layout engine uses for a font (null: LaTeX's spacing). */
export function activeFormulaSpacing(preferences: FormulaSpacingPreferences, font: FormulaLetterFont): Spacing | null {
  const values = activeFormulaSpacingConfig(preferences, font).values;
  return Object.keys(values).length ? values : null;
}

let spacingSettings: FormulaSpacingPreferences | null = null;

/** The spacing the page lays formulas out with, from the user's settings; formulas are laid out again only when
 * it changed. */
export function setFormulaSpacing(preferences: unknown): void {
  const next = normalizeFormulaSpacingPreferences(preferences);
  if (spacingSettings && JSON.stringify(next) === JSON.stringify(spacingSettings)) return;
  spacingSettings = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FORMULA_SPACING_CHANGED_EVENT));
}

export function formulaSpacing(): FormulaSpacingPreferences {
  return spacingSettings ?? defaultFormulaSpacingPreferences();
}
