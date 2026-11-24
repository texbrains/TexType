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
| `convert` (Word equations) | VisualTeX `apps/macos/src-tauri/src/office/omml_write` and `omml_latex` (Rust, 557 KB, byte-identical to VisualTeX's C# on a 3,176-row corpus) | LaTeXSnipper `MathMlToOmmlConverter.cs` (uses Word's own stylesheet) | Port; the corpus moves to `testing/corpus`. |
| `convert` (MathType data) | VisualTeX `VstoShared/MathTypeMtef*.cs`, `MtefStructureReader.cs`, `MathTypeOleStorage.cs`, `MathTypeCompObj.cs` (C#) | LaTeXSnipper `Rendering/MathTypeMtefCodec.*.cs`, `MathTypeCompoundFile.cs` (a second, independent codec to compare against); `MathTypeWordPackage.cs` and `MathTypePowerPointPackage.cs` (the object packed into a Word or PowerPoint package and inserted without any MathType program; VisualTeX does the same in `MathTypeWordOpenXml.cs` and `PowerPointFormulaService.MathType.cs`); the Word and PowerPoint `MathTypeRoundTrip*.cs` tests | Port to Rust; VisualTeX's C# codec is the reference (same input, same output) and its test cases become data rows. The round-trip tests become acceptance cases. |
| `convert` (MathType preview) | none | the vendor's font package (metric files) | **New.** Truth = genuine MathType pictures. |
| `formula-format` | new formats (requirement B1) | VisualTeX `docs/equation-format-v2.md` (pure-Word equation); LaTeXSnipper `docs/office_plugin_formula_workflows.md` (schema versions, refusing damaged records) | New. |
| `settings` | new | LaTeXSnipper `TypographySettingsStore.cs` (one file, presets); VisualTeX's ribbon behaviour (formulas follow the document) | New. |
| `protocol` | VisualTeX `Contracts/VisualTeXSessionClient.cs`, `src-tauri/src/office/server` | Lite `office_plugin/host/src/api.rs` | New, defined once. |
| `legacy-import` | readers for `VisualTeX.Formula.1` objects and picture formulas, and for `LaTeXSnipper.Formula` objects, `LS.E.*` variables, content-control tags and shape tags | — | New and temporary. |

## ui/

| Part | Base | Also read | Action |
|---|---|---|---|
| `kernel` | VisualTeX `apps/shared/visualtex-core` (formula model and editing, 1.4 MB), `apps/shared/tex-layout` (layout engine), `apps/shared/visualtex-app/src/export` (pictures, LaTeX to MathML) | — | Port. |
| `editor` | VisualTeX's Office editor window (`OfficeDialogApp.tsx` and the Mac counterpart), toolbar and formula tile library (`apps/shared/visualtex-app/src/toolbar`) | LaTeXSnipper `Office_plugin/shared/EditorAssets/symbol-library.mjs` (18 categories), compared for missing symbols | Port. |
| `app-ui` | Lite `frontend/` (main window, recognition screens) | VisualTeX `SettingsDialog.tsx`, Office and WPS status panels | Port Lite's window; new settings screens over `core/settings`. |

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
| `windows/Word` | VisualTeX `VisualTeX.WordVsto` and the Word files of `VstoShared` (insertion, numbering, references, MathType fields, WPS Writer) | LaTeXSnipper `hosts/WordAddIn` (parsing `$...$` in a selection, numbering options) | Port: same calls into Word, files split by area, conversions removed (the app does them). |
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
