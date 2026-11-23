# Windows add-ins (C# and C++)

**Owns**

- everything that runs inside Word, PowerPoint and WPS on Windows: Office object-model calls, the ribbon, the OLE object

**Limits**

- no conversion and no format knowledge: equation formats, MathType data and pictures come from the app
- no settings of its own: it asks the app
- Office is called through the typed object model, directly; there is no adapter layer in between

First version of this code: see `docs/SOURCES.md`.

Folders: `Word` (Word and WPS Writer), `PowerPoint` (PowerPoint and WPS Presentation), `Shared` (what both use), `OleObject` (C++), `tests`.
