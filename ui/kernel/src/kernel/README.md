# Editing kernel

The formula editor's model, parser, serializer, mode editors, keyboard and IME input, undo and the `<math-field>`
element: MathLive 0.109.2 (MIT, see `LICENSE-MathLive.txt`) with the changes of the earlier product written into it.
The caret, movement, empty slots, selection, pointer and geometry rules it follows are the editing core's
(`../structures.ts`, `../navigation.ts`, ...; rules in `../../EDITING.md`); formulas are laid out and drawn by the
layout engine (`../layout`).

- Entry: `mathlive.ts`. The editor registers the layout engine and the editing core at start (`setTexLayoutEngine`,
  `setKernelEditingCore`, in `editor-mathfield/kernel-hooks.ts`); `../render/layout-runtime.ts` does it for every
  page that lays out formulas.
- Tables and typing rules: `host.ts`. The kernel's own tables come from `ui/kernel/data/kernel`; the command
  catalogue (`resources/symbols`) is handed in by the editor with `provideCatalogue`.
- DOM-free entry: `public/mathlive-ssr.ts` (parsing, validation, markup and SVG by the registered layout engine). The
  pictures for documents and the Node tests use it (`ui/kernel/test/kernel-node.mjs`).
- Stylesheets are plain CSS in `css/`, imported as text.
- `ui/kernel/tsconfig.json` keeps MathLive's class-field semantics (`useDefineForClassFields: false`); Vite compiles
  these files with it.
