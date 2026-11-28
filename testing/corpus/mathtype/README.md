# MathType equation data

Reference rows for `core/convert/src/mathtype`. MathType itself is the judge: what MathType writes is the writer's
reference, and equations MathType saved are the reader's. The C# MathType codec TexType started from
(docs/SOURCES.md) is only a comparison.

- `import.jsonl`: `{source, latex, display, mathml, native}`, **the writer's reference**. For every formula of the
  other corpora (Word equations, layout cases, chemistry), the kernel's LaTeX -> MathML given to MathType 7.9.1's own
  MathML import (`MTSetEqnFromLangStr` on a blank MathType equation in Word), and `native` the Equation Native
  stream (base64) MathType stored. Where MathType's import refused or hung, `error` says so instead of `native`.
- `read.jsonl`: `{source, native, mathml}`, equations and what the C# codec reads from them:
  - `genuine/...`: equations saved by MathType, from https://github.com/jure/mathtype
    (`spec/fixtures/input/mathtype5`, MIT, Copyright (c) 2015 Jure Triglav), the Equation Native stream of each;
  - `mathtype69/...`, `mathtype7/...`: equations opened in Word by MathType 6.9b and 7.9.1, changed and changed back,
    and saved by MathType with its own data;
  - `codec/...`: the C# codec's own output (comparison only).
- `pictures.jsonl`: `{source, mtef, picture}`, **the picture engine's reference**
  (`core/convert/tests/mathtype_picture.rs`): MathType 6.9b's own picture of each equation, read from its WMF as the
  frame, the units per inch and the drawn items. `writer/...` and `edited/...` are formulas of the corpora above,
  `genuine/...` MathType's saved equations, `probe/...` and `probe-pc/...` equations that vary one thing at a time.
  Drawn from 2026-11-25 to 2026-11-27 by a clean MathType 6.9b install in Windows Sandbox (`probe-pc/...` by the test
  PC's install, which draws the same). `misdrawn.txt` lists the pictures MathType draws wrongly itself; the test
  leaves them out.

Made with a test kit outside the repository on 2026-11-25 (MathType 6.9b and 7.9.1 on Windows, Word 16).
