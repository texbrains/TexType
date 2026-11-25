// The user's custom symbols: the library the page hands in (from the user's settings), and the macros that
// draw each symbol in the editor and in pictures. What a valid symbol is: custom-symbol-validation.ts.
import type { MacroDictionary, MathfieldElement } from "../kernel/mathlive.ts";
import type { CustomSymbolDefinition, CustomSymbolLibrary, CustomSymbolMathRole } from "./custom-symbol-types.ts";

import { normalizeCustomSymbolLibrary } from "./custom-symbol-validation.ts";

let library: CustomSymbolLibrary = normalizeCustomSymbolLibrary(null);
let revision = 0;
const appliedMathfieldCommands = new WeakMap<MathfieldElement, Set<string>>();

/** The user's custom symbols, from the settings; throws for an invalid library (nothing changes then). */
export function setCustomSymbolLibrary(value: unknown): void {
  library = normalizeCustomSymbolLibrary(value);
  revision += 1;
}

export function getActiveCustomSymbols() {
  return library.symbols;
}

export function getCustomSymbolRevision() {
  return revision;
}

export function findCustomSymbolByCommand(command: string) {
  const normalized = command.trim().replace(/^\\/, "");
  return getActiveCustomSymbols().find((symbol) => symbol.command === normalized) ?? null;
}

function formatEm(value: number) {
  const normalized = Math.abs(value) < 0.000001 ? 0 : value;
  return Number(normalized.toFixed(4)).toString();
}

function roleWrapper(role: CustomSymbolMathRole) {
  switch (role) {
    case "binary":
      return "mathbin";
    case "relation":
      return "mathrel";
    case "operator":
      return "mathop";
    case "open":
      return "mathopen";
    case "close":
      return "mathclose";
    case "punctuation":
      return "mathpunct";
    default:
      return "mathord";
  }
}

export function customSymbolCssClass(symbol: CustomSymbolDefinition) {
  return `kernel-custom-symbol-${symbol.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function customSymbolSvgMarkerClass(symbol: CustomSymbolDefinition) {
  return `kernel-custom-symbol-export-${symbol.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function metricProbeLatex(symbol: CustomSymbolDefinition, className: string) {
  const { widthEm, ascentEm, descentEm } = symbol.metrics;
  const thickness = ascentEm + descentEm;
  return (
    `\\class{${className}}{` +
    `\\phantom{\\rule[-${formatEm(descentEm)}em]{${formatEm(widthEm)}em}{${formatEm(thickness)}em}}` +
    "}"
  );
}

export function customSymbolMathLiveMacroDefinition(symbol: CustomSymbolDefinition) {
  const wrapper = roleWrapper(symbol.role);
  const body = `\\${wrapper}{${metricProbeLatex(symbol, customSymbolCssClass(symbol))}}`;
  const limits =
    symbol.role === "operator" && symbol.limitsBehavior !== "auto"
      ? `\\${symbol.limitsBehavior}`
      : "";
  return {
    def: body + limits,
    args: 0,
    expand: false,
    captureSelection: true,
  } as const;
}

export function customSymbolSvgMacro(symbol: CustomSymbolDefinition) {
  const wrapper = roleWrapper(symbol.role);
  const body = `\\${wrapper}{${metricProbeLatex(symbol, customSymbolSvgMarkerClass(symbol))}}`;
  const limits =
    symbol.role === "operator" && symbol.limitsBehavior !== "auto"
      ? `\\${symbol.limitsBehavior}`
      : "";
  return body + limits;
}

export function customSymbolMathLiveMacros() {
  return Object.fromEntries(
    getActiveCustomSymbols().map((symbol) => [
      symbol.command,
      customSymbolMathLiveMacroDefinition(symbol),
    ]),
  );
}

export function addCustomSymbolMacros<T extends Record<string, unknown>>(macros: T) {
  return {
    ...macros,
    ...customSymbolMathLiveMacros(),
  };
}

export function getAppliedCustomSymbolCommandsForMathfield(
  field: MathfieldElement,
) {
  return new Set(appliedMathfieldCommands.get(field) ?? []);
}

export function composeCustomSymbolMacrosForMathfield(
  field: MathfieldElement,
  baseMacros: MacroDictionary,
  additionalMacros: MacroDictionary = {},
) {
  const macros: MacroDictionary = { ...baseMacros };
  const previous = appliedMathfieldCommands.get(field);
  previous?.forEach((command) => delete macros[command]);
  Object.assign(macros, additionalMacros);
  const customMacros = customSymbolMathLiveMacros();
  Object.assign(macros, customMacros);
  appliedMathfieldCommands.set(field, new Set(Object.keys(customMacros)));
  return macros;
}

export function applyCustomSymbolMacrosToMathfield(field: MathfieldElement) {
  field.macros = composeCustomSymbolMacrosForMathfield(field, field.macros);
}

export function customSymbolSvgMacros() {
  return Object.fromEntries(
    getActiveCustomSymbols().map((symbol) => [symbol.command, customSymbolSvgMacro(symbol)]),
  ) as Record<string, string>;
}
