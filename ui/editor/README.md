# The formula editor

**Owns**

- the editor as the user sees it: toolbar, symbol and template panels, source view, style controls
- languages, themes and common controls
- its styles, in three layers (rule S12): `src/styles/tokens.css` (every colour, size and font, both themes),
  `src/styles/base.css` (elements), and one `*.module.css` beside each component
- one editor for both uses: inside the main window and opened for one formula of an add-in

**Limits**

- no document logic: it returns a formula, the add-in decides what to do with it
- uses `kernel` only

First version of this code: see `docs/SOURCES.md`.
