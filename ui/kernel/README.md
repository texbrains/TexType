# Editing kernel and layout engine

**Owns**

- the formula model and editing: structure, caret, selection, typing rules
- the command candidates under the caret: ranking, numbered pages, the list itself (`src/kernel/css/suggestion-popover.css`
  draws it in the page's colour tokens); the catalogue it ranks comes from `resources/symbols`
- the layout engine: TeX's own algorithm, its fonts and metrics; it draws the editor and every picture
- LaTeX to MathML for Word's native equations and for MathType data (`src/mathml`, with MathJax, which draws nothing)
- the hidden render page the app uses to draw for the add-ins (`src/render/page.ts`, opened as `ui/app-ui/render.html`)
- the editing core's rules (`EDITING.md`) and the engine's data (`data/`: font metrics and outlines, the LaTeX meanings
  of commands, the kernel's own tables)
- the tests that hold the engine to LaTeX and to the stored pictures and MathML (`test/`, corpora in
  `testing/corpus/tex-layout` and `testing/corpus/omml`); `npm run test:ui` runs them

**Limits**

- no interface (toolbars, panels, dialogs)
- no Office knowledge
- imports no other package of this repository

First version of this code: see `docs/SOURCES.md`.
