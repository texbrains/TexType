# TexType

A formula editor for Word, PowerPoint and WPS on Windows and macOS, with a light main application, formula
recognition and MathType-compatible output. A desktop product; there is no web version. Written from scratch
from two earlier products.

Start here:

- `docs/REQUIREMENTS.md`: what the product must be
- `docs/ARCHITECTURE.md`: the parts, how they talk, and the separation rules
- `docs/FORMULA-FORMAT.md`: the TexType formula format and the conversion interface
- `docs/DECISIONS.md`: what is decided, what is proposed, what must be tested
- `docs/SOURCES.md`: which existing code each part starts from
- `docs/zh/架构说明.md`: the architecture in Chinese, for readers new to the project

```text
core/        Rust: formula format, the conversion interface, settings, messages, OCR; no windows, no Office calls
ui/          TypeScript: the interface shown inside the app's windows
app/         Rust: the main application and the service behind the add-ins
hosts/       what runs inside Office and WPS (C#, C++, VBA, JavaScript)
resources/   fonts, symbol and template catalogues
installer/   Windows and macOS installers
testing/     corpora, test documents, end-to-end kits
tools/       structure check and build tooling
```

```bash
node tools/check-structure.mjs   # separation rules
cargo test --workspace           # Rust tests
```
