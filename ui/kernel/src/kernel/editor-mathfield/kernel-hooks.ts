// The engine and the editing core the app registers at startup. This module
// imports nothing, so every kernel module can reach them without changing the
// order in which the kernel's modules are evaluated.

// TexType layout engine: LaTeX-exact layout and drawing of formulas.
// The app registers it at startup; the kernel keeps its model, editing,
// caret and selection, and asks the engine for the formula markup.
export let kernelLayoutEngine: any = null;
export function setTexLayoutEngine(engine: any): void {
  kernelLayoutEngine = engine;
}

// TexType editing core (the editing core (ui/kernel/src)): owns where the caret is
// shown and where atoms are on the page. The kernel asks it instead of
// measuring the drawn formula.
export let kernelEditingCore: any = null;
export function setKernelEditingCore(core: any): void {
  kernelEditingCore = core;
}

/**
 * Kernel functions that modules evaluated early call, but that live in
 * modules evaluated later (the keyboard input). An import from an early module
 * would move those modules ahead of the command registry they register with,
 * so they put their functions here when they are evaluated.
 */
export const kernelLateFunctions: {
  kernelMaybeAutoCommitSourceWrapper?: (mathfield: any) => void;
  kernelCancelSourceWrapper?: (mathfield: any) => boolean;
  kernelSourceWrapperKind?: (command: string) => string | null;
  kernelCanonicalVariantInputCommand?: (command: string) => string;
  kernelStartSourceWrapper?: (model: any, latex: string, structuralSlot: any) => boolean;
  kernelSyncSourceWrapper?: (mathfield: any) => void;
  /** LaTeX the user typed or pasted as the formulas store it (the app's exam-zh spelling setting); identity if unset */
  kernelUserLatexIn?: (latex: string) => string;
} = {};

/** The app's reading of LaTeX the user writes (typed commands, pasted text, previews of what typing inserts). */
export function setKernelUserLatexIn(read: ((latex: string) => string) | null): void {
  kernelLateFunctions.kernelUserLatexIn = read ?? undefined;
}

/** LaTeX the user typed or pasted, as the formulas store it. */
export function kernelUserLatex(latex: string): string {
  return kernelLateFunctions.kernelUserLatexIn ? kernelLateFunctions.kernelUserLatexIn(latex) : latex;
}
