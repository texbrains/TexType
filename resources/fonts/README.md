# Fonts

**Owns**

- the math fonts the product draws with
- the bundled MathType fonts (the 18 Design Science fonts), installed by `app/src/install.rs`

**Limits**

- no font is referenced from code by file path except through this folder's index

**Index** (`index.txt`: set, file, family, style, SHA-256)

- `mathtype`: the 18 Design Science fonts MathType 6.9 installs (`mathtype/`, byte for byte the files its
  pictures in `testing/corpus/mathtype` were drawn with; the optional Tiger fonts are left out). The MathType picture engine measures these families from these files, whatever
  else is installed (`Fonts::with_mathtype_fonts`).

First version of this code: see `docs/SOURCES.md`.
