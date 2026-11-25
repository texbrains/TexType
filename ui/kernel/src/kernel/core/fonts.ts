export let gFontsState: 'error' | 'not-loaded' | 'loading' | 'ready' =
  'not-loaded';

export async function loadFonts(): Promise<void> {
  // TexType: formulas are drawn by the layout engine in its own fonts
  // (CSS @font-face); MathLive's KaTeX fonts are not loaded.
  gFontsState = 'ready';
}
