# Decisions

Three lists: what the owner decided, what is proposed and still needs the owner's yes, and what must be tested
before it is relied on. A proposal becomes a decision only when it moves to the first list with a date.

## Decided by the owner

| Date | Decision |
|---|---|
| 2026-11-22 | The project is a merger with LaTeXSnipper's author. |
| 2026-11-22 | The new product has a new name, not VisualTeX. |
| 2026-11-22 | Formulas of the two earlier products get a one-click conversion only, removed once the product is mature. No format compatibility. |
| 2026-11-22 | The product may go from open source to closed source. |
| 2026-11-22 | OCR is the partner's own MathCraft engine; it may be brought into this repository. |
| 2026-11-22 | There is a light main application like MathType whose settings the add-ins share. |
| 2026-11-23 | Users must not have to configure anything to insert formulas. |
| 2026-11-23 | MathType requirements C1–C5 (see `REQUIREMENTS.md`): native editing by MathType users, same glyphs, native reading, shared numbering and settings without loss, MathType 6.0 and 7.0. |
| 2026-11-23 | The full MathType runtime is not used; at most its fonts. |
| 2026-11-23 | The project is built from scratch with every part clearly separated. |
| 2026-11-23 | Simple and easy to use comes first. Nothing is added just to fit both earlier projects. |
| 2026-11-23 | The product is called TexType. |
| 2026-11-23 | MathType's typesetting engine is not used at all, also not a copy installed on the user's PC. Only its fonts are used; the typesetting of MathType pictures is our own, lightweight. |
| 2026-11-23 | No web version. |
| 2026-11-23 | MathType objects cannot be inserted on the Mac. TexType inserts MathType objects on Windows only. |
| 2026-11-23 | One conversion interface for all formula formats. TexType's own OLE formula gets a complete, mature data format (`FORMULA-FORMAT.md`). |

## Proposed, waiting for the owner's yes

| No. | Proposal | Alternative | Why proposed |
|---|---|---|---|
| P1 | Rust for the core and the app. | Go. | Existing Rust code (OCR engine, OMML converters), Tauri. |
| P2 | Editing and typesetting are VisualTeX's kernel and its own layout engine. MathJax converts LaTeX to MathML and draws only as a fallback for commands our engine refuses. | LaTeXSnipper's way: stock MathLive for editing, MathJax for drawing. | One engine draws both the editor and the inserted picture; it is checked against real LaTeX; it already handles font choices and spacing settings. |
| P3 | The Windows add-in is built on VisualTeX's add-in: the same shape (Word, PowerPoint, Shared), Office called through the typed object model. | LaTeXSnipper's shape: adapter interfaces and late-bound calls. | It is the mature one, it already runs in WPS, and its speed work is in how it calls Word. What changes is its size: conversions leave C#, and files are split by area. |
| P4 | Numbering and references stay in the add-ins, as today. | Shared numbering rules in the core. | The hard part is how Word lays the number out, which is add-in work anyway. |
| P5 | Word and PowerPoint for Mac stay add-in files in VBA. | Office.js add-in with a local host, as LaTeXSnipper has. | Full object model, proven numbering speed; VisualTeX retired Office.js once. |
| P6 | Word's native equations stay pure Word (no hidden variables or controls); the LaTeX is re-derived when read. | Store exact LaTeX in document variables and content controls, as LaTeXSnipper does. | Survives copying between documents and editing by others; nothing of ours is left in the document. |
| P7 | Our own OLE object and picture formulas carry the full formula record (`FORMULA-FORMAT.md`). | — | Exact source and style where the format allows it. |
| P8 | MathType pictures: genuine records that name MathType's fonts, always. | Draw our own outlines for symbols from MathType-only fonts. | Requirement C2. |
| P9 | MathType's fonts are bundled, behind one switch that can change to "download from the vendor". | Download only. | Requirement A6. Needs written permission or a lawyer's sign-off before a closed or commercial release. |
| P10 | One path between add-ins and app: a named pipe on Windows. | Local HTTPS server with a certificate, as both projects have today; or an extra in-process library for speed. | No certificate and no fixed port on Windows, nothing to repair; a second path is added only if a measurement asks for it. The Mac keeps VisualTeX's channels (AppleScriptTask, loopback HTTP for WPS). |
| P11 | Source files are limited to 1,000 lines. | Another number, or no limit. | Requirement D2: large files are where patches pile up. |
| P12 | The first release targets Windows (Word, PowerPoint, WPS Writer, WPS Presentation); macOS follows. | Both at once. | Largest code and test effort is on Windows. |

## Left out until the owner asks for them

Features of the earlier products that have no part in the tree yet.

| Feature | Had it |
|---|---|
| PDF recognition, handwriting recognition, mixed text-and-formula recognition | LaTeXSnipper |
| Recognition history and favourites | LaTeXSnipper |
| External recognition services (OpenAI-compatible) | both |
| Document parsing (MinerU) | LaTeXSnipper |
| HTTP job API for scripts and other devices | LaTeXSnipper |
| Export through Pandoc | LaTeXSnipper |
| Linux build of the main app | LaTeXSnipper Lite |
| Document mode, input method | VisualTeX (stay in the full VisualTeX application) |

## Open questions for the owner

1. Does the full VisualTeX application (documents, input method) continue beside this product, and does it share the settings file?
2. The vendor name and the identifiers in `product.toml` (the name TexType is decided; the other values are placeholders derived from it).
3. Who must agree before the repository is closed (every past contributor of code brought in). The repository's licence file is AGPL-3.0 (chosen when the GitHub repository texbrains/TexType was created). `core/mathcraft` still carries the partner's licence line (GPL-3.0-only) and licence file as it came. The TeX engine's fonts (from VisualTeX `apps/shared/tex-layout/data`) include GPL fonts (txfonts and newtx math, in the Times profile) and two sets marked "to confirm before distribution" (RSFS, stmaryrd); these matter for a closed release. The MathCraft model files are byte-identical to Pix2Text's public models on Hugging Face (formula recognition = `breezedeus/pix2text-mfr`, MIT; formula detection = `breezedeus/pix2text-mfd-1.5`, MIT on Hugging Face, but the file's own metadata says it is an Ultralytics YOLO11m model under AGPL-3.0); text detection and recognition are PP-OCRv5 (Apache-2.0). Formula-only recognition needs only the recognition model.
4. Which of the left-out features above belong in the first release, if any?
5. Structures the MathType engine does not cover yet: draw them with the TeX engine for now (preview differs from MathType's), or do not allow inserting them as MathType until covered?
6. Word picture formulas keep the record in the picture's title and alternative text, as VisualTeX does, so screen readers read encoded data. Keep that, or put readable text (the LaTeX) in the alternative text and the record in the title only (its length limit is part of test T7)?

## To test before relying on it

| No. | Test | Affects |
|---|---|---|
| T1 | OCR accuracy of MathCraft against the model VisualTeX ships today, on VisualTeX's formula-OCR metrics. | A9 |
| T2 | The OLE object as an in-process library versus a separate server program, in Word and WPS at both bitnesses. | `hosts/windows/OleObject` |
| T3 | The MathType engine trial: simplest structures first, count how many genuine MathType pictures come out identical. | C2, P8 |
| T4 | Real MathType 6.9 and 7.x installs: each reads and edits our equations; we read theirs. | C5 |
| T5 | A per-user install of MathType's fonts against Office's own older font of the same name, inside Word. | A6, P9 |
| T6 | Editing a MathType equation that carries MathType-only details (nudged positions, per-character fonts) without losing them. | C4 |
| T7 | The longest shape-tag value PowerPoint and WPS Presentation keep, and whether they keep upper and lower case in it; the longest title and alternative text Word keeps on a picture. (VisualTeX uses one tag and also writes the alternative text; LaTeXSnipper writes uppercase hexadecimal in 200-character chunks.) | `FORMULA-FORMAT.md` §5 |
| T8 | Word placement of OLE formulas computed from baseline and ink bounds, against VisualTeX's stored placement values and its Word tests. | `FORMULA-FORMAT.md` §3 |
