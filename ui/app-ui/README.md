# Main window

**Owns**

- the main window around the editor
- recognition screens and the result check
- settings, presets and add-in status screens
- the pages the app opens for the add-ins: `editor.html` (ui/editor's window, with the command catalogue handed to
  the kernel) and `render.html` (the kernel's hidden render page)

**Limits**

- shows and edits what core/settings defines; defines no setting itself
- no engine: recognition and rendering run in the app
- uses `editor` and `kernel` only

First version of this code: see `docs/SOURCES.md`.
