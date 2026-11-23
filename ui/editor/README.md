# The formula editor

**Owns**

- the editor as the user sees it: toolbar, symbol and template panels, source view, style controls
- languages, themes and common controls
- one editor for both uses: inside the main window and opened for one formula of an add-in

**Limits**

- no document logic: it returns a formula, the add-in decides what to do with it
- uses `kernel` only

First version of this code: see `docs/SOURCES.md`.
