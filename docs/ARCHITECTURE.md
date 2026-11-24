# Architecture

The requirements are in `REQUIREMENTS.md`; the formula format and the conversion interface in `FORMULA-FORMAT.md`; decisions and open questions are in `DECISIONS.md`; where each part's
first code comes from is in `SOURCES.md`.

Guiding rule (requirement D3): simple first. A part exists because the product needs it, never because one of the
two earlier projects had it. When in doubt, the part is left out and added when a feature needs it.

## The parts

```text
product.toml          the product's name and technical identifiers
core/                 Rust. What both platforms need. No windows, no Office calls.
  formula-format        the TexType formula format (docs/FORMULA-FORMAT.md)
  convert               the one conversion interface: Word equations, MathType objects, SVG -> EMF / PNG, all through the record
  settings              the one settings store; three scopes; presets
  protocol              messages between app and add-ins; product identifiers
  mathcraft             OCR engine and model downloads (the partner's engine, unchanged)
legacy-import/        TEMPORARY, outside core: reads formulas of the two earlier products for the one-click
                      conversion. Used only by app/src/legacy.rs, behind the optional feature `legacy-import`.
ui/                   TypeScript. The interface inside the app's windows, and how a formula is drawn. Not a web version.
  kernel                formula model and editing, the layout engine, LaTeX -> MathML, the hidden render page
  editor                the formula editor (in the main window and for one formula of an add-in)
  app-ui                main window, recognition screens, settings and status screens
app/                  Rust (+ Tauri for the windows). One program: main application and service.
  src/shell             window, tray, shortcuts
  src/editor_window     opens the editor for the user or for one formula of an add-in
  src/render            headless drawing for the add-ins
  src/recognition       recognition jobs, engines, models
  src/sessions          one add-in request from start to finish
  src/automation        the door for AI agents (MCP)
  src/install           installing and repairing add-ins; the MathType font step
  src/platform          what differs between Windows and macOS
hosts/                What runs inside Office and WPS. Object-model calls only.
  windows/              C# + C++
    Word                  Word and WPS Writer
    PowerPoint            PowerPoint and WPS Presentation
    Shared                connection to the app, dispatcher, ribbon icons
    OleObject             the registered formula object (C++)
  macos/
    office-vba            Word and PowerPoint add-ins
    wps-js                WPS add-in (TypeScript compiled to JavaScript)
resources/            fonts; symbol and template catalogues (data)
installer/            windows, macos
testing/              corpus (reference results), fixtures (real documents), e2e kits
tools/                check-structure.mjs and build tooling (Node)
docs/
```

## How the parts talk

```text
Word / PowerPoint / WPS (Windows)        Word / PowerPoint (Mac)     WPS (Mac)
  C# add-in                                VBA add-in                  JS add-in
       | named pipe                             | AppleScriptTask + files  | loopback HTTP
       +----------------+-----------------------+--------------------------+
                  app (Rust): sessions -> editor_window / render / recognition / settings
                        |                               |
                  core crates (Rust)              ui packages (TypeScript, in the app's windows)
  OLE object (C++, Windows): stores the formula record and previews, draws the preview; double-click is caught by the add-in
```

There is one path: an add-in asks the app. The app answers with what the add-in puts into the document (TexType OLE
object data and previews, pictures, OMML, MathType object bytes). Every message is defined once in `core/protocol`;
the three channels (named pipe on Windows, AppleScriptTask with files for Word and PowerPoint on the Mac, loopback
HTTP for WPS on the Mac, as VisualTeX does today) carry the same messages. The app starts at login (Windows Run
entry, Mac LaunchAgent, as VisualTeX does); an add-in that finds it not running starts it.

## Typesetting: three engines, one job each

| What is being drawn | Engine | Where |
|---|---|---|
| The formula in the editor, and every picture in our own look (OLE object preview, Word and presentation picture formulas, exported images) | Our own layout engine: TeX's algorithm, checked against real LaTeX | `ui/kernel` |
| A native Word equation (OMML) | Word itself | — (we write OMML in `core/convert`) |
| The picture of a MathType equation | Our own lightweight engine that follows MathType's rules, with MathType's fonts; checked against genuine MathType pictures | `core/convert` |

- The same engine draws the editor and the inserted picture, so what the user edits is what lands in the document.
- MathJax converts LaTeX to MathML, which feeds `core/convert`. It draws nothing. A command our engine does not know
  is shown as its text, as in VisualTeX.
- For the add-ins, the app runs the engine in a hidden web view (the render page), as VisualTeX does.
- A MathType equation opened in our editor is shown in our own look while it is edited; in the document its picture
  is drawn by MathType's rules.

## Languages

| Part | Language | Why this one |
|---|---|---|
| `core/`, `app/` | Rust | One implementation for Windows and macOS; the OCR engine is already Rust |
| `ui/` | TypeScript | The editing kernel and layout engine exist in TypeScript |
| `hosts/windows` | C# (.NET Framework), C++ for the OLE object | Required by Office and WPS on Windows |
| `hosts/macos/office-vba` | VBA | Required by Word and PowerPoint add-in files on macOS |
| `hosts/macos/wps-js` | TypeScript compiled to JavaScript | Required by WPS on macOS |
| `tools/` | Node scripts | One tooling language on both machines |

Not in the product: Python, Java, Go, any MathType program or library.

## Separation rules

These rules keep a change in one place. `node tools/check-structure.mjs` checks the ones marked ✔.

| No. | Rule | Checked |
|---|---|---|
| S1 | One owner. Every part states what it owns and what it must not do (`//!` header or `README.md`). A behaviour is changed in the part that owns it. | ✔ the statement exists |
| S2 | The core depends only on the core. It has no window library and no host library. | ✔ |
| S3 | Interface packages form one chain: `kernel` <- `editor` <- `app-ui`. No relative import leaves a package. | ✔ |
| S4 | Add-ins make object-model calls. Formats, conversions and settings come from the app. | review |
| S5 | One definition. Settings, messages and the formula record are defined once in the core. | review |
| S6 | One name. The product's technical identifiers are in `product.toml` only. The earlier products' names appear only in `docs/` and `legacy-import/`. | ✔ |
| S7 | The old-format reader is removable. It is outside `core/`, depends only on core crates, and only `app/src/legacy.rs` uses it, behind the optional feature `legacy-import`. The app builds without it (`cargo build -p app --no-default-features`, part of `npm run check`). Removing it = deleting `legacy-import/`, `app/src/legacy.rs`, and its dependency and feature lines in `app/Cargo.toml`. | ✔ |
| S8 | No compatibility layers. A stored record with an unsupported schema version is refused with a clear message; formats are not migrated silently. The one-click conversion of old formulas (B2) is started by the user and is not a migration in this sense. | review |
| S9 | No file grows without limit: 1,000 lines per source file. A file that reaches the limit is split by responsibility. | ✔ |
| S10 | No Python in the product. | ✔ |
| S11 | Nothing is added for symmetry. A new part needs a feature that requires it. | review |

### Where does a change go?

| The change is about | It goes to |
|---|---|
| What is stored with a formula | `core/formula-format` |
| How a formula looks | `ui/kernel` |
| A control or panel in the editor | `ui/editor` |
| A setting | defined in `core/settings`, shown in `ui/app-ui` |
| How Word or WPS Writer is told to do something, numbering and references included | `hosts/windows/Word` (and `hosts/macos`) |
| The same for PowerPoint or WPS Presentation | `hosts/windows/PowerPoint` (and `hosts/macos`) |
| A conversion between formula formats | `core/convert` |
| MathType's fields and numbers in a document | `hosts/windows/Word` |
| Old formulas of the earlier products | `legacy-import/` only |

If a change seems to need edits in two parts that do not own it, the boundary is wrong: move the boundary first,
in its own change, then make the change.

## Settings

One file, defined in `core/settings`, edited in the app, read by the add-ins through the app.

1. User defaults: the settings file. Exportable as presets. Includes the inline and display formula sizes (VisualTeX
   keeps these per user today).
2. Document preferences: stored in the document: the equation number format (VisualTeX keeps it in a document
   variable today).
3. One formula's own style: stored with the formula (OLE payload, picture tags). Word's native equations follow
   the document.

A narrower scope wins over a wider one.

## MathType

- Equation data: written and read by `core/convert`, exactly in MathType's format, for MathType 6 and 7. The code is
  ported from VisualTeX's C# codec.
- Picture: always drawn by our own lightweight engine in `core/convert`, by MathType's rules; the picture names
  MathType's fonts as MathType does. MathType itself is never used to draw, also not when it is installed.
- Structures the engine does not cover yet: drawn by our TeX engine in its Times setting for now, or not insertable as
  MathType until covered. Open question 5 in `DECISIONS.md`; the first option does not meet requirement C2.
- Fonts: MathType's fonts are bundled in the installer and installed by `app/src/install.rs`, on Windows and macOS.
- Numbering and document settings in MathType documents are MathType's own: fields (MTPlaceRef, MTEqn, MTChap,
  MTSec), bookmarks, the character style MTEquationSection and the document property MTEqnNumsOnRight.
- Insertion (Windows): the object is packed into a Word or PowerPoint package and inserted from there, so no
  MathType program is needed. Both products do this today: VisualTeX `MathTypeWordOpenXml.cs` (Word) and a staged
  presentation in `PowerPointFormulaService.MathType.cs` (PowerPoint); LaTeXSnipper `MathTypeWordPackage.cs` and
  `MathTypePowerPointPackage.cs`.
- Double-click: a MathType equation opens in TexType's editor, as in VisualTeX. A setting in `core/settings` lets
  MathType open it instead while MathType is installed; without MathType, TexType's editor always opens.
- MathType objects are inserted on Windows only. They cannot be inserted on the Mac. On the Mac, MathType equations
  in a document are only displayed, with the bundled fonts; they are not read, edited or converted there.

## Commands

```bash
node tools/check-structure.mjs      # the separation rules
cargo test --workspace              # Rust tests
MATHCRAFT_MODELS=<dir> cargo test -p mathcraft --test parity   # OCR against the reference results
cargo run -p app -- ocr <image> --models <dir>                 # recognise one image
```
