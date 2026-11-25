/**
 * MathLive renders a bare `&` as a visible ampersand outside a tabular
 * environment. TexType keeps explicit align points as a zero-width classed
 * atom instead, then converts them back to real `&` tokens when serializing an
 * align-like LaTeX environment.
 */
export const KERNEL_ALIGNMENT_MARKER_LATEX =
  "\\class{kernel-align-marker}{\\kern0pt}";
export const KERNEL_ALIGNMENT_MARKER_CLASS = "kernel-align-marker";

export function hasKernelAlignmentMarker(latex: string) {
  return latex.includes(KERNEL_ALIGNMENT_MARKER_LATEX);
}

export function stripKernelAlignmentMarkers(latex: string) {
  return latex.split(KERNEL_ALIGNMENT_MARKER_LATEX).join("");
}

export function restoreLatexAlignmentMarkers(latex: string) {
  return latex.split(KERNEL_ALIGNMENT_MARKER_LATEX).join("&");
}
