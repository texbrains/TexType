# OLE formula object (C++)

**Owns**

- the registered formula object: stores the formula record and its previews, draws the preview
- nothing on double-click: the add-in catches the double-click and opens the editor

**Limits**

- no layout and no rendering
- the class identifier comes from product.toml

First version of this code: see `docs/SOURCES.md`.
