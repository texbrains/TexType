# Word and WPS Writer add-in

**Owns**

- inserting, editing, converting and formatting formulas in a document
- equation numbers, references, chapter and section breaks, as Word fields
- MathType objects and MathType's numbering fields and document properties
- the ribbon
- WPS Writer through the same code; a difference is handled at the one call where it occurs
- every change to a document goes through one `DocumentWrite`: one undo entry, everything it needs read before it,
  the selection on the range it writes; equations are written by importing a package of the equation alone
  (`EquationWriter`)

**Limits**

- one area per file (insertion, numbering, references, MathType, ...)
- nothing PowerPoint needs too: that is `Shared`

First version of this code: see `docs/SOURCES.md`.
