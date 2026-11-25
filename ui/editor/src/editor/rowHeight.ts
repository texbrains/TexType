import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import { safeConvertKernelLatexToMarkup } from "./mathLiveSourceSafety";

const BASE_FORMULA_FONT_SIZE = 54;

const tallFormulaPattern =
  /\\(?:d?frac|tfrac|sqrt|sum|prod|int|iint|iiint|oint|oiint|oiiint|lim|begin|overset|underset|overline|underline)\b|[_^]/;

// No floor of its own: the zoom's owner bounds it (MIN_EDITOR_ZOOM).
const formulaFontSize = (zoom: number) => BASE_FORMULA_FONT_SIZE * zoom;

export function formulaRowHeightMetrics(
  latex: string,
  zoom: number,
  formulaRowVerticalInset: number,
) {
  const fontSize = formulaFontSize(zoom);
  const hasTallStructure = tallFormulaPattern.test(latex);
  const safeVerticalInset = Math.max(
    0,
    Math.min(24, Math.round(formulaRowVerticalInset)),
  );
  const verticalPadding = safeVerticalInset * 2;
  const baseContentHeight = hasTallStructure
    ? Math.max(20, fontSize * 1.34)
    : Math.max(22, fontSize * 1.12);
  const baseHeight = Math.max(
    hasTallStructure ? 36 : 30,
    baseContentHeight + verticalPadding,
  );
  return {
    fontSize,
    hasTallStructure,
    baseHeight,
    verticalPadding,
  };
}

/** The row's height before the field has laid out (measured from a probe of the formula's markup). */
export function predictedFormulaRowHeight(
  latex: string,
  zoom: number,
  formulaRowVerticalInset: number,
  measurementHost?: HTMLElement | null,
) {
  const metrics = formulaRowHeightMetrics(latex, zoom, formulaRowVerticalInset);
  let renderedHeight = latex.trim() ? 0 : metrics.fontSize * 1.2;

  if (measurementHost && latex.trim()) {
    const markup = safeConvertKernelLatexToMarkup(latex, {
      defaultMode: "math",
    });
    if (markup) {
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.position = "absolute";
      probe.style.left = "-100000px";
      probe.style.top = "0";
      probe.style.display = "inline-block";
      probe.style.width = "max-content";
      probe.style.maxWidth = "none";
      probe.style.whiteSpace = "nowrap";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.fontSize = metrics.fontSize + "px";
      probe.style.lineHeight = "normal";
      probe.innerHTML = markup;
      measurementHost.append(probe);
      // the drawn formula box, as measureFrameSize measures it in the field: the probe's own line box adds the
      // strut of a line of text at this font size (simple rows were predicted ~18 px taller than they draw, so a
      // row shrank a few frames after a split or an undo)
      const drawn = probe.querySelector<HTMLElement>(".ML__vtx");
      renderedHeight = (drawn ?? probe).getBoundingClientRect().height;
      probe.remove();
    }
  }

  return Math.ceil(
    Math.max(metrics.baseHeight, renderedHeight + metrics.verticalPadding),
  );
}

/** The drawn formula's height in the field plus the row's padding (at least the row's base height). */
export function measuredFormulaRowHeight(
  field: MathfieldElement,
  zoom: number,
  formulaRowVerticalInset: number,
) {
  const { fontSize, baseHeight, verticalPadding } = formulaRowHeightMetrics(
    field.value,
    zoom,
    formulaRowVerticalInset,
  );
  const content =
    field.shadowRoot?.querySelector<HTMLElement>('[part="content"]');
  // .ML__vtx is the drawn formula box, which also covers the empty-slot
  // markers and every caret position (ui/kernel/EDITING.md §5).
  const formulaRects = content
    ? Array.from(
        content.querySelectorAll<HTMLElement>(
          ".ML__vtx, [data-atom-id], .ML__base, .ML__mfrac, .ML__sqrt, " +
            ".ML__op-group, .ML__vlist",
        ),
      )
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.height > 0 && rect.width >= 0)
    : [];
  const formulaHeight = formulaRects.length
    ? Math.max(...formulaRects.map((rect) => rect.bottom)) -
      Math.min(...formulaRects.map((rect) => rect.top))
    : fontSize;
  return {
    height: Math.ceil(Math.max(baseHeight, formulaHeight + verticalPadding)),
  };
}

/** The field and its row set to `height`; only what changed is written (the field's style is observed). */
export function applyFormulaRowHeight(
  field: MathfieldElement,
  host: HTMLElement,
  height: number,
) {
  const heightPx = height + "px";
  if (field.style.height !== heightPx) field.style.height = heightPx;
  if (field.style.minHeight !== heightPx) field.style.minHeight = heightPx;
  const row = host.closest<HTMLElement>("[data-line-id]");
  if (row && row.style.getPropertyValue("--local-row-height") !== heightPx) {
    row.style.setProperty("--local-row-height", heightPx);
  }
}
