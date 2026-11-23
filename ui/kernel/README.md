# Editing kernel and layout engine

**Owns**

- the formula model and editing: structure, caret, selection, typing rules
- the layout engine: TeX's own algorithm, its fonts and metrics; it draws the editor and every picture
- LaTeX to MathML for Word's native equations and for MathType data
- the hidden render page the app uses to draw for the add-ins

**Limits**

- no interface (toolbars, panels, dialogs)
- no Office knowledge
- imports no other package of this repository

First version of this code: see `docs/SOURCES.md`.
