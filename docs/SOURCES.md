# Where each part starts from

The new project is written from scratch, but not from nothing: each part has existing code to port, to use as the
specification, or to bring in unchanged. Versions read: VisualTeX `6d05daee` (GitHub main), LaTeXSnipper `8289fd4`,
LaTeXSnipper Lite `c188ec7`.

"Port" means the code moves and is reshaped to the new boundaries. "Specification" means the old code is read for
what it does and its tests are reused, but the code is written anew.

The rule for choosing: where both projects have a part, the more mature one is the base and the other is read for
ideas. Nothing is taken only so that both are represented.

## core/

| Part | Base | Also read | Action |
|---|---|---|---|
| `mathcraft` | Lite `crates/mathcraft` (Rust, about 4,000 lines) and its reference results | — | **Brought in unchanged.** 56 unit tests pass; 5 reference images give identical text. |
| `convert` (Word equations) | VisualTeX `apps/macos/src-tauri/src/office/omml_write` and `omml_latex` (Rust, 557 KB, byte-identical to VisualTeX's C# on a 3,176-row corpus) | LaTeXSnipper `MathMlToOmmlConverter.cs` (uses Word's own stylesheet) | **Ported** from VisualTeX `83ce1a73` with its .NET emulation (`office/dotnet`). Left out until their steps: the WPS helpers for numbered equations, the PowerPoint table-cell form, the Word package for the Mac, and the number bookmark (VisualTeX's `VTEqNum_` name; references get a TexType name). VisualTeX's reference rows are in `testing/corpus/omml`: `mathml-to-omml.json` (236 rows of its C# writer at that commit) and `omml-to-latex.json` (its C# reader). The full corpora stay outside the repository: the reader's 2,116 rows (October 16 dump) match exactly; the writer's 3,176 rows (October 16 dump) match except Word's `m:grow` on n-ary operators, which the C# writer stopped writing in November. |
| `convert` (pictures) | VisualTeX `VstoShared/OfficeOlePreview.cs` (C#, GDI+: SVG to EMF+ Dual and PNG, stem darkening, room for the ink of installed-font outlines) | — | Rewritten in Rust over resvg/usvg, so both platforms make the same files; same stem darkening (0.12 px) and ink margin. The EMF has a fixed 96 dpi reference device instead of VisualTeX's frame per host and screen scaling. |
| `convert` (MathType data) | VisualTeX `VstoShared/MathTypeMtef*.cs`, `MtefStructureReader.cs`, `MathTypeOleStorage.cs`, `MathTypeCompObj.cs` (C#) | LaTeXSnipper `Rendering/MathTypeMtefCodec.*.cs`, `MathTypeCompoundFile.cs` (a second, independent codec to compare against); `MathTypeWordPackage.cs` and `MathTypePowerPointPackage.cs` (the object packed into a Word or PowerPoint package and inserted without any MathType program; VisualTeX does the same in `MathTypeWordOpenXml.cs` and `PowerPointFormulaService.MathType.cs`); the Word and PowerPoint `MathTypeRoundTrip*.cs` tests | **Own design** (owner, 2026-11-25), not a port. The reference is MathType itself: its records for each corpus formula (MathType 7.9's MathML import), its MathML export of them, and MathType 6.9/7 drawing and opening what TexType writes (`testing/corpus/mathtype`). Taken from VisualTeX's codec as facts: the glyph table (`core/convert/src/mathtype/glyphs.txt`), the Windows code-page ranges, MathType's space codes. The round-trip tests become acceptance cases. |
| `convert` (MathType preview) | none | the vendor's font package (metric files) | **New.** Truth = genuine MathType pictures. |
| `formula-format` | new formats (requirement B1) | VisualTeX `docs/equation-format-v2.md` (pure-Word equation); LaTeXSnipper `docs/office_plugin_formula_workflows.md` (schema versions, refusing damaged records) | New. |
| `settings` | new | LaTeXSnipper `TypographySettingsStore.cs` (one file, presets); VisualTeX's ribbon behaviour (formulas follow the document) | New. |
| `protocol` | VisualTeX `Contracts/VisualTeXSessionClient.cs`, `src-tauri/src/office/server` | Lite `office_plugin/host/src/api.rs` | New, defined once. |
| `legacy-import` | readers for `VisualTeX.Formula.1` objects and picture formulas, and for `LaTeXSnipper.Formula` objects, `LS.E.*` variables, content-control tags and shape tags | — | New and temporary. |

## ui/

| Part | Base | Also read | Action |
|---|---|---|---|
| `kernel` | VisualTeX `apps/shared/visualtex-core` (formula model and editing, 1.4 MB), `apps/shared/tex-layout` (layout engine), `apps/shared/visualtex-app/src/export` (pictures, LaTeX to MathML) | — | **Ported** from VisualTeX `83ce1a73`: names made neutral; split along real seams only (P11); the module VisualTeX's build generated for the kernel became data files (kernel tables in `ui/kernel/data/kernel`, the command catalogue in `resources/symbols`); fonts, spacing and custom symbols are handed in from the settings instead of read from browser storage; the custom-symbol designer, its storage and its legacy migration are not carried over; the editing core's rules came as `ui/kernel/EDITING.md`. The pictures, MathML and chemistry formulas VisualTeX made at that commit (`testing/corpus/tex-layout`) are reproduced exactly. LaTeX to MathML for Word equations (`src/mathml`, VisualTeX's `latexToMathMl` with MathJax 3.2.2) gives exactly VisualTeX's MathML for the 1,760 LaTeX rows of its OMML corpus; the rows of `testing/corpus/omml/latex-to-mathml.jsonl` are those of the stored OMML rows. |
| `editor` | VisualTeX's Office editor window (`OfficeDialogApp.tsx` and the Mac counterpart), toolbar and formula tile library (`apps/shared/visualtex-app/src/toolbar`) | LaTeXSnipper `Office_plugin/shared/EditorAssets/symbol-library.mjs` (18 categories), compared for missing symbols | **Ported** from VisualTeX `83ce1a73`: the Office editor window only (formula rows, category tabs and templates, matrix builder, LaTeX source, formatting bar, colour popover). Left out: OCR (one entry point, `onPasteImage`, remains), onboarding, the symbol designer, the tiles view, save-as, numbering, zoom and logic controls, the status bar, the custom colour list, the editor's mirror of the kernel's candidate list (the kernel's own list is shown), the candidate previews measured at run time (they are data in `resources/symbols/completion-previews.json`), a second copy of the command frequencies, and the editor's own command registry (`autocomplete/`, about 1,060 lines, the source of the catalogue): the toolbar, the source view's completion and colours and the draft checks read `resources/symbols/command-catalogue.json`, which got each command's toolbar tab and the toolbar's templates (the kernel keeps its own one-row completion form of `\begin{cases}`). Styles rebuilt in three layers (rule S12) with the same look. |
| `app-ui` | Lite `frontend/` (main window, recognition screens) | VisualTeX `SettingsDialog.tsx`, Office and WPS status panels | Port Lite's window; new settings screens over `core/settings`. |

Generated data in `ui/kernel` (font metrics, glyph outlines, the converted newtx fonts, the LaTeX meanings and templates
of commands, the LaTeX comparison cases) was made with VisualTeX's engine tools: `texoracle.py` (cases from LaTeX's
`\showlists` and box output), `texprofile.py` (font profiles), `tfm2json.py`, `cmfonts.py` and `vffonts.py` (fonts),
`inkbounds.py` (ink bounds), and the generators in `apps/shared/tex-layout/scripts` (exam-zh signs, double-struck and
zero-width glyphs). Those tools are not part of this repository.

## app/

| Part | Base | Also read | Action |
|---|---|---|---|
| `shell`, `recognition` | Lite `backend/src` (already Rust + Tauri) | VisualTeX `visualtex-backend/src/ocr_provider_common.rs` | Port. |
| `editor_window`, `render`, `sessions` | VisualTeX `apps/windows/src-tauri/src/office/server`, `sessions.rs`, `render_batches.rs` | Lite `office_plugin/host` | Specification; the HTTPS server and certificate are not carried over. |
| `automation` | VisualTeX `src-tauri/src/office/automation/mcp.rs` | — | Port. |
| `install` | VisualTeX `office/lifecycle.rs`, `wps_status.rs`, `mathtype_fonts.rs` | Lite `office_plugin/host/src/install.rs` | Specification. |
| `platform` | the capture and shortcut code of VisualTeX's two backends | Lite `backend/src/shell.rs` | Specification. |

## hosts/

| Part | Base | Also read | Action |
|---|---|---|---|
| `windows/Word` | VisualTeX `VisualTeX.WordVsto` and the Word files of `VstoShared` (insertion, numbering, references, MathType fields, WPS Writer) | LaTeXSnipper `hosts/WordAddIn` (parsing `$...$` in a selection, numbering options) | Port: same calls into Word, files split by area, conversions removed (the app does them). Changed while porting (step 5): a new equation is written the way an edited one is (a package of the equation alone, imported over the target) instead of exporting and re-importing its paragraph with a marker and a guard paragraph: reading the paragraph's XML inside the undo record split one insert into four Undo steps in Word. Every write goes through one `DocumentWrite`: reads first, the selection on the written range (WPS's Undo damages an equation rewritten with the caret inside it), one undo entry. An insert with the caret inside an equation joins it at the caret (also inside a structure such as a numerator). Host behaviour the writer follows (Word 16 and WPS 12.1, measured with probes kept outside the repository): Word imports the package's paragraph mark in some places (before text, at a table cell's end, before a field, there possibly after the field's hidden start) and not at a paragraph's end, by no rule that can be read beforehand; so the writer reads the result: the characters after the target's paragraph do not change, and an equation paragraph that now ends earlier ends with the imported mark, which is deleted before the equation's type is set (forced inline in the broken paragraph, Word adds a space). An equation inside a hyperlink exports as plain text unless its whole paragraph is exported, so it is taken out of the paragraph's export by its place among the paragraph's equations. Workarounds for host features that are missing: in WPS an inline equation is imported with a word joiner after it, deleted right after (WPS makes an equation alone in its package display); for a join, the caret's place in the equation's XML is found by typing a marker, exporting and undoing the marker. Tested in both hosts with one Undo and one Redo each: inserts in text, at a paragraph's start and end, in an empty paragraph, in a table cell, in and in front of a hyperlink, in a content control, with Track Changes on; edits in a hyperlink, of the second equation of a paragraph, and in front of a field. |
| `windows/PowerPoint` | VisualTeX `VisualTeX.PowerPointVsto` | LaTeXSnipper `hosts/PowerPointAddIn` (equations at a text-box caret) | Port, as above. |
| `windows/Shared` | VisualTeX `VstoShared` (dispatcher, ribbon icons) and `Contracts` | — | Port, as a real library. SVG to EMF / PNG (`OfficeOlePreview.cs`) moves to `core/convert`. |
| `windows/OleObject` | VisualTeX `VisualTeX.FormulaOleServer` (C++, separate server program, proven in WPS) | LaTeXSnipper `hosts/OleFormulaObjectNative` (C++, in-process) | Decide by test T2; new class identifier. |
| `macos/office-vba` | VisualTeX `apps/macos/office/macos-offline` (1.6 MB of VBA) | — | Port, files split by area. |
| `macos/wps-js` | VisualTeX `apps/macos/office/wps` | — | Port to TypeScript. |

## Not carried over

| What | Where it was | Why |
|---|---|---|
| Python recognition runtime | VisualTeX (222–230 MB), LaTeXSnipper desktop and Mac host | Requirement A7; replaced by `core/mathcraft` |
| Local HTTPS server and certificate on Windows | VisualTeX (port 43127), LaTeXSnipper's Mac host | Decision P10 (the Mac keeps loopback HTTP for WPS) |
| MathJax as a drawing engine; stock MathLive as the editor | LaTeXSnipper | Decision P2 |
| Adapter interfaces and late-bound Office calls | LaTeXSnipper's Windows add-in | Decision P3 |
| Office.js add-in for Mac | LaTeXSnipper, Lite | Decision P5 |
| Converters written in C# | VisualTeX (`WordOmml*.cs`, `MathMlToLatexConverter.cs`, MTEF codec) | The core does this once for both platforms |
| The earlier formula formats | both projects | Requirement B1; readable only through `legacy-import/` |
