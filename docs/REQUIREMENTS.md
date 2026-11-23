# Requirements

What the product must be, as stated by the owner on 2026-11-22 and 2026-11-23. Each requirement has a number so
that designs, reviews and tests can point at it. A requirement is changed here first, then in the code.

"Add-in" means the part that runs inside Word, PowerPoint or WPS. "App" means the main application, which is also
the background service the add-ins talk to.

## A. The product

| No. | Requirement |
|---|---|
| A1 | A new product, written from scratch, that merges the Office/WPS add-in part of VisualTeX with LaTeXSnipper. It is built together with LaTeXSnipper's author. |
| A2 | It is called TexType. |
| A3 | Its features are roughly those of today's VisualTeX add-ins (Word, PowerPoint, WPS Writer, WPS Presentation, on Windows and macOS), joined with what LaTeXSnipper offers. |
| A4 | There is a light main application in the manner of MathType: a formula editor with some features of its own and the place where custom settings are made. |
| A5 | Settings are shared: what is set in the app applies in the add-ins. There is one set of settings, not one per program. |
| A6 | A user who inserts a formula never has to configure anything first. Nothing needs to be installed separately, repaired or switched on. |
| A7 | The installer is as small as possible. |
| A8 | The product may move from open source to closed source later. Nothing in it may prevent that. |
| A9 | Formula recognition (OCR) uses the partner's MathCraft engine, kept in this repository. Its formula models are Pix2Text's public models (see `DECISIONS.md`, open question 3). |
| A10 | TexType is a desktop product. There is no web version. |
| A11 | There is one conversion interface for all formula formats. |
| A12 | TexType's own OLE formula has a complete, mature data format. |

## B. Formulas made by the two earlier products

| No. | Requirement |
|---|---|
| B1 | The new product has its own formula formats. It does not stay compatible with VisualTeX's OLE formulas or with LaTeXSnipper's formulas. |
| B2 | At first there is one button that converts those older formulas to the new format in one step. |
| B3 | That conversion is removed again once the new product is mature. Removing it must not disturb anything else. |

## C. MathType

| No. | Requirement |
|---|---|
| C1 | A formula inserted in MathType format can be edited by any MathType user as if MathType had made it. |
| C2 | A MathType user sees the same glyphs in such a formula as in one inserted with MathType itself. |
| C3 | MathType formulas made by other people are read natively. |
| C4 | Numbering formats and other settings in such documents are MathType's own, so that everyone working on the document sees the same settings. No information is lost. |
| C5 | MathType 6.0 and MathType 7.0 are both supported. |
| C6 | MathType's typesetting engine is not used in any form: not its runtime, not a copy installed on the user's PC. Only MathType's fonts are used. The pictures of MathType equations are typeset by our own lightweight engine. Size and legal risk are to be as low as possible. |

## D. Structure of the code

| No. | Requirement |
|---|---|
| D1 | The architecture combines the two existing projects, but every part is clearly separated from the others. |
| D2 | A change is made in the part that owns the behaviour. Changes must not pile up as patches on top of other parts. |
| D3 | Simple and easy to use comes first. Nothing is added merely so that both earlier projects are represented. |

## How the structure answers each requirement

| Requirement | Answer in this repository |
|---|---|
| A1, A3 | `docs/SOURCES.md` lists, for every part, which code of the two projects it starts from. |
| A2 | The name and technical identifiers are defined in `product.toml`. The check script fails if a technical identifier, or an earlier product's name, appears anywhere else in the code. |
| A4, A5 | `app/` is one program: the main window and the service behind the add-ins. `core/settings` is the only settings store; add-ins keep none. |
| A6 | Everything a formula needs runs inside the app or the add-in. No Windows service, no separate runtime, no manual font step (`app/src/install.rs` owns the font step). |
| A7 | No Python, no Java, no MathType programs. Recognition models are downloaded on first use. |
| A8 | Third-party material is limited to permissively licensed libraries, the partner's own engine, and (pending permission) MathType's fonts behind one switch. Not yet met: some fonts of the TeX engine's Times profile are GPL, and two other font sets are marked "to confirm before distribution" (open question 3 in `DECISIONS.md`). |
| A9 | `core/mathcraft` is the partner's engine, unchanged. Its results are checked against the reference results of the original engine (`core/mathcraft/tests/parity.rs`). |
| B1–B3 | `legacy-import/` (outside `core/`) is the only place that knows the old formats. Only `app/src/legacy.rs` uses it, behind an optional feature; the app is built without it on every check, so deleting it leaves everything else compiling. |
| C1, C3, C4 | `core/convert` reads and writes MathType's equation data and keeps what it does not interpret. `hosts/windows/Word` handles MathType's own fields, bookmarks, character style and document property. |
| C2 | `core/convert` draws the picture by MathType's rules and names MathType's fonts, as MathType does. Each structure is proven against genuine MathType pictures in `testing/corpus`. Structures not covered yet do not meet C2; how to handle them is open question 5. |
| C5 | `testing/fixtures` is to hold documents made by MathType 6 and 7 (none yet); both are part of the acceptance tests (test T4). |
| C6 | `core/convert` contains our own engine for MathType pictures. No MathType program or library is called or shipped. |
| A10 | `ui/` is the interface inside the desktop app's windows; nothing is built for a browser or a server. |
| A11, A12 | `docs/FORMULA-FORMAT.md`: the record, the OLE object, picture formulas, and the single `convert` request served by `core/convert`. |
| D1, D2 | The rules in `docs/ARCHITECTURE.md`, enforced by `tools/check-structure.mjs`. |
| D3 | Rule S11 and the short part list: 5 core parts, 3 interface packages, one path between add-ins and app, the Windows add-in in the shape of the existing mature one. Features only one earlier project had are open questions in `DECISIONS.md`, not parts. |
