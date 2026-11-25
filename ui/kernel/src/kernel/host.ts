// The kernel's tables and typing rules. The tables the kernel always needs come from ui/kernel/data; the
// command catalogue (resources/symbols) is handed in by the editor when it starts, because the kernel imports
// nothing outside its package. Pictures need no catalogue.
import defaultMacros from '../../data/kernel/default-macros.json' with { type: 'json' };
import rareIntegralSymbols from '../../data/kernel/rare-integral-symbols.json' with { type: 'json' };
import sourceWrapperKinds from '../../data/kernel/source-wrapper-kinds.json' with { type: 'json' };
import sourceWrapperTargets from '../../data/kernel/source-wrapper-targets.json' with { type: 'json' };
import type { CommandCategory } from '../latex/command-types.ts';

export {
  KERNEL_SYMBOL_SEQUENCES,
  applyInputJudgment,
  escapeWordAtEnd,
} from '../typing/judgment.ts';

/**
 * One entry of the command catalogue (resources/symbols/command-catalogue.json): a completion candidate, and a
 * template of the editor's toolbar.
 */
export type KernelCompletionRecord = {
  /** false for a shared variant: found by its command, never claims an exactly typed one */
  exact: boolean;
  id: string;
  command: string;
  /** the toolbar tab it belongs to */
  category: CommandCategory;
  /** what is inserted: a template with \placeholder{} slots */
  latex: string;
  preview: string;
  /** the command's name (Chinese, English) */
  name: string;
  nameEn: string;
  /** English name, aliases and keywords */
  words: string[];
  priority: number;
};

export const kernelDefaultMacros: Record<
  string,
  { def: string; args: number; expand: boolean; captureSelection: boolean }
> = defaultMacros;
export const kernelRareIntegralSymbols: Record<string, string> = rareIntegralSymbols;
export const kernelSourceWrapperKindsData: Record<string, string> = sourceWrapperKinds;
export const kernelSourceWrapperCanonicalTargetsData: Record<string, string> =
  sourceWrapperTargets;

// Filled in place by provideCatalogue: the kernel keeps references to these from the moment it loads.
export const kernelCompletionCatalogData: KernelCompletionRecord[] = [];
export const kernelCommandFrequencyData: Record<string, number> = {};
/** Sample formulas the completion list draws for bare kernel commands (\left -> \left( x \right)) */
export const kernelNativePreviewsData: Record<string, string> = {};

/** The editor hands in the command catalogue (resources/symbols) when it starts. */
export function provideCatalogue(catalogue: {
  records: KernelCompletionRecord[];
  frequency: Record<string, number>;
  previews: Record<string, string>;
}): void {
  kernelCompletionCatalogData.splice(0, kernelCompletionCatalogData.length, ...catalogue.records);
  Object.assign(kernelCommandFrequencyData, catalogue.frequency);
  Object.assign(kernelNativePreviewsData, catalogue.previews);
}
