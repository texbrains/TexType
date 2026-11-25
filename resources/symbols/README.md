# Symbol and template catalogues

**Owns**

- the symbol library and formula templates as data, one catalogue for the main app and the add-in editor
- `command-catalogue.json`: every command the editor's toolbar shows and inserts, the candidates offer and the LaTeX
  source view completes and colours, with its toolbar tab (`category`), template (`latex`), preview and names
- `command-frequency.json` (how often a command is used, for ranking) and `completion-previews.json` (the sample
  formula of a bare command in the candidate list)

**Limits**

- data only, no code; how the toolbar arranges its tabs is `ui/editor`'s, how completion ranks is `ui/kernel`'s

First version of this code: see `docs/SOURCES.md`.
