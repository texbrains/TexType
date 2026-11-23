# Shared by both add-ins

**Owns**

- the connection to the app
- the UI-thread dispatcher, progress and cancellation
- ribbon icons and texts

**Limits**

- a real library both add-ins reference, not files linked into each
- no Word or PowerPoint object-model code

First version of this code: see `docs/SOURCES.md`.
