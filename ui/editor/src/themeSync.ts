import type { Theme } from "./types/formula";

/** The app's theme setting as the editor's theme: "dark", or "light" for anything else. */
export function normalizeTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

/** Applies the theme the app chose to the page (the stylesheets read data-theme). */
export function applyDocumentTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
