import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { convertKernelLatexToMarkup } from "@app/kernel/latex/expand.ts";
import { inspectMathLiveSourceSafety } from "../editor/mathLiveSourceSafety";
import { markKernelFormulaFontGlyphs } from "@app/kernel/render/fonts.ts";
import styles from "./MathPreview.module.css";
import {
  getFormulaFontRevision,
  subscribeFormulaFontRevision,
} from "@app/kernel/render/layout-runtime.ts";

interface MathPreviewProps {
  latex: string;
  showPlaceholders?: boolean;
  fit?: boolean;
  maximumFitScale?: number;
  fitInsetRatio?: number;
  /** Measured once (and after fonts load), not observed: for long lists of previews. */
  staticLayout?: boolean;
}

const defaultFitInsetRatio = 0.9;
const defaultMaximumFitScale = 8;
const visiblePlaceholderLatex =
  "\\htmlClass{kernel-tile-placeholder}{\\phantom{\\rule{0.40em}{0.66em}}}";
const mathPreviewMarkupCache = new Map<string, string>();
const mathPreviewMarkupCacheLimit = 1024;

function cachedPreviewMarkup(latex: string, fontRevision: number) {
  const cacheKey = `${fontRevision}\u0000${latex}`;
  const cached = mathPreviewMarkupCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let markup = "";
  const safetyIssue = inspectMathLiveSourceSafety(latex);
  if (safetyIssue) {
    console.warn("TexType skipped an unsafe MathPreview source.", {
      sourceLength: latex.length,
      safetyIssue,
    });
  } else {
    try {
      markup = convertKernelLatexToMarkup(latex, { defaultMode: "math" });
    } catch (error) {
      // An auxiliary preview must not be able to crash the editor.
      console.warn("TexType skipped a MathPreview render after an exception.", {
        sourceLength: latex.length,
        error,
      });
    }
  }
  if (mathPreviewMarkupCache.size >= mathPreviewMarkupCacheLimit) {
    const oldestKey = mathPreviewMarkupCache.keys().next().value;
    if (typeof oldestKey === "string") mathPreviewMarkupCache.delete(oldestKey);
  }
  mathPreviewMarkupCache.set(cacheKey, markup);
  return markup;
}

function latexWithVisiblePlaceholders(latex: string) {
  if (!latex.includes("\\placeholder")) return latex;

  let cursor = 0;
  let rendered = "";
  while (cursor < latex.length) {
    const commandStart = latex.indexOf("\\placeholder", cursor);
    if (commandStart < 0) {
      rendered += latex.slice(cursor);
      break;
    }

    rendered += latex.slice(cursor, commandStart);
    let commandEnd = commandStart + "\\placeholder".length;
    while (/\s/.test(latex[commandEnd] ?? "")) commandEnd += 1;

    if (latex[commandEnd] === "[") {
      let bracketDepth = 1;
      commandEnd += 1;
      while (commandEnd < latex.length && bracketDepth > 0) {
        if (latex[commandEnd] === "[") bracketDepth += 1;
        if (latex[commandEnd] === "]") bracketDepth -= 1;
        commandEnd += 1;
      }
      while (/\s/.test(latex[commandEnd] ?? "")) commandEnd += 1;
    }

    if (latex[commandEnd] !== "{") {
      rendered += "\\placeholder";
      cursor = commandStart + "\\placeholder".length;
      continue;
    }

    let braceDepth = 1;
    commandEnd += 1;
    while (commandEnd < latex.length && braceDepth > 0) {
      if (latex[commandEnd] === "{") braceDepth += 1;
      if (latex[commandEnd] === "}") braceDepth -= 1;
      commandEnd += 1;
    }
    if (braceDepth > 0) {
      rendered += latex.slice(commandStart);
      break;
    }

    rendered += visiblePlaceholderLatex;
    cursor = commandEnd;
  }
  return rendered;
}

function MathPreviewComponent({
  latex,
  showPlaceholders = false,
  fit = false,
  maximumFitScale = defaultMaximumFitScale,
  fitInsetRatio = defaultFitInsetRatio,
  staticLayout = false,
}: MathPreviewProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  // previews are drawn in the formula fonts: a font change draws them again
  const fontRevision = useSyncExternalStore(
    subscribeFormulaFontRevision,
    getFormulaFontRevision,
    () => 0,
  );
  const previewLatex = useMemo(
    () => (showPlaceholders ? latexWithVisiblePlaceholders(latex) : latex),
    [latex, showPlaceholders],
  );
  const markup = useMemo(
    () => cachedPreviewMarkup(previewLatex, fontRevision),
    [fontRevision, previewLatex],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    markKernelFormulaFontGlyphs(content);

    // The unscaled formula's size. Always measure the MathLive formula
    // itself: WebView2 can report a zero/near-zero outer inline-flex box
    // during the first toolbar layout pass, and it can give the MathLive
    // subtree narrower metrics than the surrounding max-content box (notably
    // for multi-integral glyphs).
    const naturalSize = () => {
      content.style.setProperty("--local-fit-scale", "1");
      const visualRoot =
        content.querySelector<HTMLElement>(".ML__latex") ?? content;
      const visualRect = visualRoot.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        width: Math.max(
          1,
          content.scrollWidth,
          contentRect.width,
          visualRect.width,
        ),
        height: Math.max(
          1,
          content.offsetHeight,
          contentRect.height,
          visualRect.height,
        ),
      };
    };
    // A strict contain box: oversized content always shrinks as far as
    // required; the caller may cap upscaling.
    const containedScale = (size: { width: number; height: number }) =>
      Math.max(
        Number.EPSILON,
        Math.min(
          maximumFitScale,
          Math.max(1, host.clientWidth * fitInsetRatio) / size.width,
          Math.max(1, host.clientHeight * fitInsetRatio) / size.height,
        ),
      );

    let animationFrame = 0;
    let disposed = false;
    const scheduleMeasure = (measure: () => void) => {
      if (disposed) return;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        measure();
      });
    };

    if (staticLayout) {
      // measured after layout and font loading only, without observing
      const measureStatic = () => {
        const scale = fit ? containedScale(naturalSize()) : 1;
        content.style.setProperty("--local-fit-scale", scale.toFixed(4));
        host.dataset.fitReady = "static";
        host.dataset.fitScale = scale.toFixed(4);
      };
      measureStatic();
      scheduleMeasure(measureStatic);
      void document.fonts?.ready.then(() => scheduleMeasure(measureStatic));
      return () => {
        disposed = true;
        if (animationFrame) cancelAnimationFrame(animationFrame);
      };
    }

    let lastInputs = "";
    let lastScale = "";
    const measure = () => {
      const size = naturalSize();
      // with unchanged inputs only the scale removed for measuring is put back
      const inputs = `${host.clientWidth}|${host.clientHeight}|${size.width}|${size.height}`;
      if (inputs === lastInputs && lastScale) {
        content.style.setProperty("--local-fit-scale", lastScale);
        return;
      }
      lastInputs = inputs;
      const scale = fit ? containedScale(size) : 1;
      lastScale = scale.toFixed(4);
      content.style.setProperty("--local-fit-scale", lastScale);
      host.dataset.fitReady = String(fit);
      host.dataset.fitScale = lastScale;
    };

    // Establish a usable fit state in the same layout phase so a toolbar never
    // exposes an unmeasured preview for a full animation frame; the scheduled
    // pass refines it after paint and font loading.
    measure();
    scheduleMeasure(measure);
    void document.fonts?.ready.then(() => scheduleMeasure(measure));
    const resizeObserver = new ResizeObserver(() => scheduleMeasure(measure));
    resizeObserver.observe(host);
    resizeObserver.observe(content);
    const observedVisualRoot = content.querySelector<HTMLElement>(".ML__latex");
    if (observedVisualRoot) resizeObserver.observe(observedVisualRoot);

    return () => {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [fit, markup, maximumFitScale, fitInsetRatio, staticLayout]);

  return (
    <span
      ref={hostRef}
      className={styles.preview}
      aria-hidden="true"
      data-fit={fit ? "contain" : "none"}
      data-show-placeholders={showPlaceholders ? "true" : "false"}
      data-static-layout={staticLayout ? "true" : "false"}
    >
      <span
        ref={contentRef}
        className={styles.content}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </span>
  );
}

export const MathPreview = memo(MathPreviewComponent);
