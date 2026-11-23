# TexType formula format

Version 1.0 (draft). Defined in `core/formula-format`; every other part reads and writes it through that crate.

Based on the two existing formats, read in the code:

- VisualTeX: `FormulaMetadata` (`VisualTeX.WindowsOffice.Contracts/FormulaMetadata.cs`), stored in the OLE object
  as `VisualTeX.Formula.json` with `VisualTeX.Preview.emf` and `.png` (`FormulaOleContract.cs`); in PowerPoint as
  one tag `VisualTeXMetadata` (on pictures and OLE shapes); in Word picture formulas in the picture's title and
  alternative text.
- LaTeXSnipper: `FormulaMetadata` + `FormulaTypography` (schema 3), stored in the OLE object as streams `Payload`
  and `PresentationEmf` (`OleFormulaObjectNative/src/StorageUtil.cpp`); in PowerPoint as hex chunks of 200
  characters (`PowerPointFormulaMetadataStore.cs`); for Word OMML in document variables `LS.E.*`.

## 1. Where the format is used

| Container | Platforms | What it holds |
|---|---|---|
| TexType OLE object in Word and WPS Writer | Windows | the record and two previews, as streams of the object's storage |
| TexType OLE object in PowerPoint and WPS Presentation | Windows | the same, plus a copy of the record in the shape's tag |
| Picture formula in PowerPoint and WPS Presentation | Windows, Mac | the record in the shape's tag; the picture is the preview |
| Picture formula in Word | Windows, Mac (Word for Mac cannot host our OLE object) | the record in the picture's title and alternative text, as VisualTeX's picture mode does |

Word native equations and MathType objects are not TexType formulas. They keep their own formats and are converted
through the conversion interface (section 7).

## 2. OLE object

Class: `TexType.Formula.1` (version-independent `TexType.Formula`). The class identifier is generated once, stored in
`product.toml` and never changed.

Streams, as in VisualTeX's object:

| Stream | Content |
|---|---|
| `\1CompObj`, `\1Ole` | standard OLE streams |
| `TexType.Formula` | the record (section 3), UTF-8 JSON without BOM |
| `TexType.Preview.emf` | vector preview, drawn by our TeX engine |
| `TexType.Preview.png` | raster preview |

The formula's content is inside the object. Nothing about its content is kept in document variables or content
controls (LaTeXSnipper keeps its OMML formulas' data in document variables; TexType does not). Equation numbers are
Word fields beside the object; the record only says whether the formula is numbered (section 3).

In PowerPoint the OLE shape also carries the record in its tag, and TexType reads the tag. Both products write the
tag on PowerPoint OLE shapes; LaTeXSnipper reads from it because reading the object's own data from a copied
PowerPoint OLE shape can fail (its notes record `REGDB_E_CLASSNOTREG`). In Word the object's own data is the
authority.

The object does nothing on double-click; the add-in catches the double-click and opens the editor, as in both
products (VisualTeX's `DoVerb` returns without action; LaTeXSnipper detects the gesture in the add-in).

Whether the object should be a separate server program (VisualTeX) or an in-process library (LaTeXSnipper) is test
T2 in `DECISIONS.md`; the streams are the same either way.

## 3. Record

```json
{
  "format": "textype.formula",
  "version": [1, 0],
  "id": "6f1c2a9e-3b0d-4c55-9a4e-2f7d8b1e0c33",
  "source": {
    "latex": "a=b+c\\\\d=e-f",
    "lines": [ { "id": "l1", "latex": "a=b+c" }, { "id": "l2", "latex": "d=e-f" } ],
    "display": true
  },
  "numbering": { "mode": "auto", "tag": null },
  "style": {
    "fontProfile": "ntx",
    "faces": { "letters": "profile", "greek": "profile", "digits": "Times New Roman" },
    "mathStyle": "default",
    "cjkFont": "SimSun",
    "sizePt": 12,
    "color": "#000000"
  },
  "symbols": [
    { "command": "\\congsign", "class": "rel", "advanceEm": 0.778, "heightEm": 0.6, "depthEm": 0.1, "path": "M0 0L..." }
  ],
  "layout": {
    "engine": "textype-tex",
    "engineVersion": "1.0.0",
    "widthPt": 48.21, "heightPt": 13.46, "baselinePt": 9.84,
    "inkTopPt": 0.4, "inkBottomPt": 13.1
  },
  "mathml": "<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\">...</math>",
  "origin": { "format": "omml", "fingerprint": "sha256:..." },
  "preview": { "sha256": "9b1f...", "emfBytes": 18234, "pngBytes": 40211 },
  "created": { "app": "1.0.0", "platform": "windows", "at": "2026-11-23T08:30:00Z" },
  "modified": { "app": "1.0.0", "platform": "windows", "at": "2026-11-23T08:31:12Z" }
}
```

| Field | Required | Meaning | VisualTeX | LaTeXSnipper |
|---|---|---|---|---|
| `format`, `version` | yes | format name, `[major, minor]` | `schema`, `schemaVersion` | `SchemaVersion` |
| `id` | yes | identifies the formula in its document | `formulaId` | `Identity.EquationId` (+ `DocumentId`) |
| `source.latex` | yes | the formula; the only field that cannot be recomputed | `latex` | `Latex` |
| `source.lines` | if more than one row | the editor's rows, so a multi-row formula reopens row by row | `lines` | — |
| `source.display` | yes | display or inline | `displayMode` | `DisplayMode` |
| `numbering` | yes | `none`, `auto` or `manual`; `tag` = the manual number text | `numbered`, `equationTag` | `NumberingMode`, `NumberText` |
| `style` | yes | the complete style the formula was drawn with | `formulaLetterFont`, `formulaFaces`, `formulaChineseFont`, `fontSizePt` | `Typography`: symbol, number and CJK font, default math style, size, colour |
| `symbols` | if used | custom symbols the formula uses, so it draws on a PC without them | — | — |
| `layout` | yes | engine and version; natural size, baseline, ink bounds | `renderWidthPx`, `renderHeightPx`, `baseline`, `renderFontSizePt`, `word*` placement values | `widthPoints`, `heightPoints`, `baselinePoints`, `rendererVersion` |
| `mathml` | yes | the formula's structure, so conversions need no editor and no MathJax | — | — |
| `origin` | if converted | the format it was converted from and a fingerprint, so converting back returns the original | `nativeOmmlFingerprint` | — |
| `preview` | yes | hash and sizes of the previews | — | — |
| `created`, `modified` | yes | TexType version, platform, time | `createdWithVersion`, `updatedWithVersion`, `createdAt`, `updatedAt` | — |

Units: points for sizes, em for symbol metrics, `#rrggbb` for colour. Text: UTF-8, LF line ends.

Not taken over: VisualTeX's `title` and `codeFormat` (no use found in the new design); VisualTeX's Word placement
values (`wordInlineOlePositionPt`, `wordInlinePreviewShiftPx`, `wordDisplayPreview*Ratio`). Those are computed by
the Word add-in from `baselinePt` and the ink bounds. Whether that reproduces VisualTeX's placement exactly has to
be checked against VisualTeX's Word tests before they are dropped for good.

## 4. Rules

1. **Source is the truth.** `source`, `style` and `symbols` determine the formula. `layout`, `mathml` and the previews
   are derived and can be regenerated.
2. **Stale derived data is regenerated, not trusted.** If `preview.sha256` does not match, or `engineVersion` is older
   than the engine's, the add-in redraws on the next edit or "update formulas".
3. **Versions.** A reader accepts its own major version and ignores unknown fields. A higher major version is refused
   with "this formula was made by a newer TexType" and the object is left as it is. A minor version only adds
   optional fields. A writer always writes the current version. (LaTeXSnipper refuses any version but its own;
   TexType allows additions within a major version.)
4. **No silent migration.** An unknown or damaged record is never repaired or rewritten automatically.
5. **Copies.** Two formulas with the same `id` in one document: the add-in gives the newer copy a new id. VisualTeX
   (PowerPoint `VisualTeXIdentityOwner` tag) and LaTeXSnipper (rebinding identity after copy) both handle copies.
6. **Size.** The record is at most 1 MB, each preview at most 8 MB.
7. **Natural size.** Office stores the displayed size. The record keeps the natural size, so the user's scaling survives
   an edit (both products do this) and "reset size" works.

## 5. Picture formulas

**PowerPoint and WPS Presentation** (OLE shapes and pictures). The record is stored in one shape tag,
`TEXTYPE.FORMULA`, as VisualTeX does with `VisualTeXMetadata`. VisualTeX's PowerPoint add-in also runs in WPS Presentation with a single tag. LaTeXSnipper
splits its data into 200-character chunks of uppercase hexadecimal; its code does not say why. Test T7 checks the
longest tag value PowerPoint and WPS keep, and whether they keep upper and lower case in it. If there is a length
limit, the record is split there; if case is lost, the record is written in an encoding that does not depend on case.
VisualTeX's tags working today does not settle the case question: VisualTeX also writes the record into the shape's
alternative text and reads that when the tag cannot be decoded.

**Word pictures** (Windows and Mac). The record is stored in the picture's title and alternative text, as VisualTeX does.
Screen readers then read encoded data instead of the formula (open question 6).

## 6. What is not in the format

- **Equation numbers and references.** The number text is a Word field and the reference target a bookmark beside the
  formula. The record only keeps whether it is numbered and a manual tag.
- **User settings.** The record holds the style the formula was drawn with, not the user's current defaults.

## 7. The conversion interface

One conversion request in `core/protocol`, answered by the main program:

```text
convert(input, target) -> output
```

| Formats | As input | As target |
|---|---|---|
| LaTeX | ✔ | ✔ |
| TexType formula (record) | ✔ | ✔ |
| TexType OLE object | ✔ | ✔ |
| TexType picture formula | ✔ | ✔ |
| Word native equation (OMML) | ✔ | ✔ |
| MathType object | ✔ | ✔ |
| MathML | ✔ | ✔ |
| SVG / EMF / PNG | | ✔ |

Every conversion goes through the record. A new format needs one reader and one writer. The add-ins only call this
request.

Served by `core/convert` (Word equations, MathType) and `ui/kernel` (LaTeX to MathML, pictures in our own look).

Exceptions:

- **Editing a MathType object** keeps the original equation data and changes only what the edit changed. If the
  edit touches something that cannot be written back without loss, the original object is left as it is and the user
  is told.
- **Converting back.** If the record's `origin` matches the target format and its fingerprint still matches, the
  original is restored instead of being regenerated (as VisualTeX does with `nativeOmmlFingerprint`).
- **Word native equations carry no LaTeX.** Their LaTeX is derived from the equation's structure each time it is
  read. Macro names, comments and the way the formula was typed are not recovered.
- **Old formulas** of the two earlier products are read by `legacy-import/`, which is removed later. The user starts
  this conversion with one button; it is not the silent migration that rule 4 in section 4 forbids.
