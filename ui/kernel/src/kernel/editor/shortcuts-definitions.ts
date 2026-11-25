import type { InlineShortcutDefinitions } from '../public/options';
import { KERNEL_SYMBOL_SEQUENCES } from '../host';

// TexType kernel: the as-you-type shortcuts are the symbol sequences of
// the input judgment (ui/kernel/src/typing/judgment.ts, provided by the host
// module). MathLive's letter shortcuts (alpha, sin, int, in, or, nn, km,
// ...) fired inside words (spin -> sp\in, point -> p\oint) and on products
// of variables; typed words are now judged once finished, from the same
// dictionary.
export const INLINE_SHORTCUTS: InlineShortcutDefinitions = KERNEL_SYMBOL_SEQUENCES;
