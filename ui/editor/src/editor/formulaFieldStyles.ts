import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import {
  formulaChineseFallbackFamily,
  formulaChineseFontFamily,
  formulaLetterFontFamilies,
  installFormulaChineseFallbackFontFaces,
  markKernelFormulaFontGlyphs,
  KERNEL_FORMULA_CHINESE_GLYPH_CLASS,
  KERNEL_FORMULA_LETTER_GLYPH_CLASS,
  type FormulaChineseFont,
  type FormulaLetterFont,
} from "@app/kernel/render/fonts.ts";

// The shadow-root style sheets and classes of a formula field: its fonts, the
// hidden MathLive highlights, the source preview and the caret repaint.

const kernelPlaceholderStyleId = "kernel-structural-placeholder-style";
const kernelFormulaFontStyleId = "kernel-formula-font-style";
const kernelFormulaUprightFontProperty = "--kernel-formula-upright-font-family";
const kernelFormulaItalicFontProperty = "--kernel-formula-italic-font-family";
const kernelFormulaChineseFontProperty = "--kernel-formula-chinese-font-family";
const kernelFormulaChineseFallbackProperty =
  "--kernel-formula-chinese-fallback-family";
const kernelFormulaInheritedFontProperty =
  "--kernel-formula-inherited-font-family";
const kernelRawLatexClass = "has-kernel-raw-latex-command";
/** The field shows the formula only (the LaTeX source view has the focus). */
export const kernelSourcePreviewClass = "kernel-source-preview-only";
const kernelCaretRepaintClass = "kernel-caret-repaint";
const kernelCaretRepaintFrames = new WeakMap<MathfieldElement, number>();

export function repaintMathLiveCaret(field: MathfieldElement) {
  const previousFrame = kernelCaretRepaintFrames.get(field);
  if (previousFrame) window.cancelAnimationFrame(previousFrame);

  field.classList.remove(kernelCaretRepaintClass);
  // Separate the previous compositing state from the class mutation.
  // This matters when the focused keyboard sink that dispatched Backspace has
  // just been removed from the document.
  field.shadowRoot
    ?.querySelector<HTMLElement>(
      ".ML__caret, .ML__text-caret, .ML__latex-caret",
    )
    ?.getBoundingClientRect();
  field.classList.add(kernelCaretRepaintClass);

  const frame = window.requestAnimationFrame(() => {
    kernelCaretRepaintFrames.delete(field);
    if (!field.isConnected) return;
    field.classList.remove(kernelCaretRepaintClass);
  });
  kernelCaretRepaintFrames.set(field, frame);
}

export function cancelCaretRepaint(field: MathfieldElement) {
  const frame = kernelCaretRepaintFrames.get(field);
  if (frame) {
    window.cancelAnimationFrame(frame);
    kernelCaretRepaintFrames.delete(field);
  }
  field.classList.remove(kernelCaretRepaintClass);
}

export function markKernelFormulaGlyphFonts(field: MathfieldElement) {
  if (!field.shadowRoot) return;
  markKernelFormulaFontGlyphs(field.shadowRoot);
}

function installKernelFormulaFontStyle(field: MathfieldElement) {
  const shadowRoot = field.shadowRoot;
  if (!shadowRoot) return;
  if (shadowRoot.getElementById(kernelFormulaFontStyleId)) return;

  const style = document.createElement("style");
  style.id = kernelFormulaFontStyleId;
  const chineseFallback = `var(${kernelFormulaChineseFallbackProperty}, ${formulaChineseFallbackFamily("system")})`;
  style.textContent = `
    /*
     * Chinese can sit in any MathLive font class, e.g. a raw math-mode glyph
     * left by input that arrives without IME composition events. Mirror
     * MathLive's KaTeX families and append a face that covers only CJK code
     * points, so the formula Chinese font no longer depends on the JS glyph
     * marker below. KaTeX glyphs and the fallback for other missing glyphs
     * are unchanged. Marked glyphs still get the full family list below.
     */
    .ML__cmr,
    .ML__mathbf,
    .ML__accent-body {
      font-family: KaTeX_Main, ${chineseFallback} !important;
    }

    .ML__mathit,
    .lcGreek.ML__mathbf,
    .ML__mathbfit {
      font-family: KaTeX_Math, ${chineseFallback} !important;
    }

    .ML__ams,
    .ML__bb {
      font-family: KaTeX_AMS, ${chineseFallback} !important;
    }

    .ML__cal { font-family: KaTeX_Caligraphic, ${chineseFallback} !important; }
    .ML__frak { font-family: KaTeX_Fraktur, ${chineseFallback} !important; }
    .ML__tt { font-family: KaTeX_Typewriter, ${chineseFallback} !important; }
    .ML__script { font-family: KaTeX_Script, ${chineseFallback} !important; }
    .ML__sans { font-family: KaTeX_SansSerif, ${chineseFallback} !important; }

    /*
     * When the requested variant (\\mathsf, \\mathtt, \\mathbb, ...) has no face
     * for a character, MathLive emits a class-less atom span that inherits the
     * page font. Keep that font for everything else and send only CJK code
     * points through the formula Chinese font.
     */
    [data-atom-id]:not([class]) {
      font-family: ${chineseFallback}, var(${kernelFormulaInheritedFontProperty}, sans-serif) !important;
    }

    .ML__cmr.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}:not(.ML__it) {
      font-family: var(${kernelFormulaUprightFontProperty}, KaTeX_Main, serif) !important;
      font-style: normal !important;
    }

    .ML__cmr.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}:not(.ML__bold):not(.ML__it) {
      font-weight: 400 !important;
    }

    .ML__cmr.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}.ML__bold:not(.ML__it),
    .ML__mathbf.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}:not(.lcGreek) {
      font-family: var(${kernelFormulaUprightFontProperty}, KaTeX_Main, serif) !important;
      font-style: normal !important;
      font-weight: 700 !important;
    }

    .ML__cmr.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}.ML__it,
    .ML__mathit.${KERNEL_FORMULA_LETTER_GLYPH_CLASS} {
      font-family: var(${kernelFormulaItalicFontProperty}, KaTeX_Math, KaTeX_Main, serif) !important;
      font-style: italic !important;
    }

    .ML__cmr.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}.ML__it:not(.ML__bold),
    .ML__mathit.${KERNEL_FORMULA_LETTER_GLYPH_CLASS} {
      font-weight: 400 !important;
    }

    .ML__cmr.${KERNEL_FORMULA_LETTER_GLYPH_CLASS}.ML__bold.ML__it,
    .lcGreek.ML__mathbf.${KERNEL_FORMULA_LETTER_GLYPH_CLASS},
    .ML__mathbfit.${KERNEL_FORMULA_LETTER_GLYPH_CLASS} {
      font-family: var(${kernelFormulaItalicFontProperty}, KaTeX_Math, KaTeX_Main, serif) !important;
      font-style: italic !important;
      font-weight: 700 !important;
    }

    /*
     * \\text{} picks the font per character, as the exported formula does:
     * Chinese through the CJK-only face of the formula Chinese font, Latin
     * letters and digits through the upright letter font, never through the
     * Chinese font's own Latin glyphs.
     */
    .ML__text {
      font-family: ${chineseFallback}, var(${kernelFormulaUprightFontProperty}, KaTeX_Main, serif) !important;
    }

    .${KERNEL_FORMULA_CHINESE_GLYPH_CLASS} {
      font-family: var(${kernelFormulaChineseFontProperty}, var(--_text-font-family)) !important;
    }
  `;
  shadowRoot.append(style);
}

export function applyKernelFormulaFonts(
  field: MathfieldElement,
  letterFont: FormulaLetterFont,
  chineseFont: FormulaChineseFont,
) {
  installFormulaChineseFallbackFontFaces();
  installKernelFormulaFontStyle(field);
  markKernelFormulaGlyphFonts(field);
  const letterFamilies = formulaLetterFontFamilies(letterFont);
  field.style.setProperty(
    kernelFormulaUprightFontProperty,
    letterFamilies.upright,
  );
  field.style.setProperty(
    kernelFormulaItalicFontProperty,
    letterFamilies.italic,
  );
  field.style.setProperty(
    kernelFormulaChineseFontProperty,
    formulaChineseFontFamily(chineseFont),
  );
  field.style.setProperty(
    kernelFormulaChineseFallbackProperty,
    formulaChineseFallbackFamily(chineseFont),
  );
  // The field's own font is what class-less atom spans would inherit.
  const inheritedFont = field.isConnected
    ? getComputedStyle(field).fontFamily
    : "";
  if (inheritedFont) {
    field.style.setProperty(kernelFormulaInheritedFontProperty, inheritedFont);
  }
}

export function installKernelStructuralPlaceholderStyle(
  field: MathfieldElement,
) {
  const shadowRoot = field.shadowRoot;
  if (!shadowRoot) return;
  if (!shadowRoot.getElementById(kernelPlaceholderStyleId)) {
    const style = document.createElement("style");
    style.id = kernelPlaceholderStyleId;
    style.textContent = `
      /*
       * Empty-slot markers, the caret and its height are drawn by the layout
       * engine from the editing core's geometry (ui/kernel/EDITING.md);
       * this sheet only hides MathLive's own highlights and handles the
       * editor's display modes.
       */
      .ML__contains-highlight,
      .ML__highlight {
        border-color: transparent !important;
        outline: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        box-shadow: none !important;
      }

      :host(.${kernelCaretRepaintClass})
        .ML__focused .ML__caret::after,
      :host(.${kernelCaretRepaintClass})
        .ML__focused .ML__text-caret::after,
      :host(.${kernelCaretRepaintClass})
        .ML__focused .ML__latex-caret::after {
        visibility: visible !important;
        opacity: 1 !important;
        animation: none !important;
        transform: translateZ(0);
      }

      .ML__container.${kernelRawLatexClass} .ML__latex,
      .ML__container.${kernelRawLatexClass} .ML__raw-latex,
      .ML__container.${kernelRawLatexClass} .ML__selected,
      .ML__container.${kernelRawLatexClass} .ML__contains-highlight,
      .ML__container.${kernelRawLatexClass} .ML__selection {
        background: transparent !important;
        background-color: transparent !important;
        box-shadow: none !important;
        outline: 0 !important;
      }

      .ML__container.${kernelRawLatexClass} .ML__selection {
        display: none !important;
      }

      :host(.has-kernel-multi-line-selection)
        .ML__container .ML__selection {
        display: block !important;
        background: var(--_selection-background-color) !important;
      }

      :host(.${kernelSourcePreviewClass}) .ML__selection {
        display: none !important;
      }

      :host(.${kernelSourcePreviewClass}) .ML__selected,
      :host(.${kernelSourcePreviewClass}) .ML__contains-highlight,
      :host(.${kernelSourcePreviewClass}) .ML__highlight {
        border-color: transparent !important;
        outline: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        box-shadow: none !important;
      }

      :host(.${kernelSourcePreviewClass}) .ML__vtx-marker--selected {
        background: var(--formula-placeholder) !important;
      }

      :host(.${kernelSourcePreviewClass}) .ML__caret,
      :host(.${kernelSourcePreviewClass}) .ML__text-caret,
      :host(.${kernelSourcePreviewClass}) .ML__latex-caret {
        display: none !important;
        opacity: 0 !important;
        animation: none !important;
      }
    `;
    shadowRoot.append(style);
  }
}
