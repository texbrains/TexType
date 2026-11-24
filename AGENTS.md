# Project instructions

Read first: `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and the `README.md` of the part you change.

These rules are defaults. If one does not fit a case, deviate and say why in one line (a code comment or the pull
request).

## Scope

- Change the part that owns the behaviour (`docs/ARCHITECTURE.md`, "Where does a change go?"). If a change needs
  edits in two parts and the user's request does not already cover both, stop and ask.
- Ask before deciding: requirements; anything in `docs/DECISIONS.md`; product names and identifiers (`product.toml`);
  new parts; new dependencies; expected test results.
- Fixed limits: no Python in the product; MathType's programs and typesetting engine are never used; technical
  identifiers only in `product.toml`. `tools/check-structure.mjs` checks several of these; do not weaken it.

## Code

- Keep code concise, modular, and free of dead logic.
- Do not add backward-compatibility or migration logic. Exception: the user-started one-click conversion of old
  formulas (requirement B2), inside `legacy-import/` and `app/src/legacy.rs`.
- Do not hard-code machine-specific paths.
- Use explicit UTF-8 for project text and protocols, with strict decoding. Text files are UTF-8 without BOM, with LF
  line ends; `.gitattributes` sets any exceptions. Preserve format-defined binary and system encodings.

## No defensive clutter

- Validate input where it enters: add-in messages, formula records and OLE streams, files, downloads, Office return
  values, user input. After that, trust the types and the caller.
- Do not check for states that cannot happen, and do not hide a missing value behind a default.
- Do not swallow errors. Catch the failures you expect (for example a known Office or WPS quirk) and say which one.
  Entry points called by Office (ribbon handlers, events) may catch everything, to report the error instead of
  crashing the host.
- Add a fallback only when the documents describe it.
- Retry only operations that are known to fail briefly, such as downloads and busy Office calls, a fixed number of
  times.
- No code "just in case": no unused parameters, options or extension points, no old paths kept for safety.

## Languages

- Rust: return errors with `Result` and `?`. In product code prefer `expect("reason")` to `unwrap()`. `unsafe` only
  for FFI and system calls, with a comment. Keep `cargo fmt` and `cargo clippy` clean; a Clippy warning may be
  allowed with a short reason.
- TypeScript: `strict` mode. Use `unknown` rather than `any` for values of unknown shape, and check them where they
  enter. Do not use `!` or `as` only to silence the compiler.
- C#: nullable reference types on. Use the typed Office interfaces; `dynamic` only for members they do not have (for
  example WPS-only members). Release the COM objects you obtain yourself (from calls and loops); never release
  objects Office passes into an event or callback. In loops and often-called code, keep intermediate objects in
  variables so they can be released.
- C++: RAII and smart pointers (such as `ComPtr`) instead of manual `new`/`delete` and `Release`. Check every
  `HRESULT`.
- VBA: `Option Explicit` in every module. `On Error Resume Next` only around the lines that need it; switch it off
  right after.
- Node (`tools/`): prefer built-in modules.

## Tests

- Keep tests focused on current behavior. Remove tests of replaced functionality. No tombstone tests (the structure
  rules in `tools/check-structure.mjs` are not tombstone tests).
- A bug fix comes with a test that fails before the fix, where it can be tested automatically; otherwise say how it
  was verified.
- Do not skip or weaken a test to make a change pass. Change an expected result only when asked, and show the
  difference.
- Before a pull request run `npm ci`, `npm run build:ui` and `npm run check`. On Linux the Tauri part of `app/` is
  not compiled; the GitHub checks on Windows and macOS show whether it builds. Say what you ran and what you did not.

## Git

- Before starting a new task, ask the user whether to open a new branch. Further changes within the same task stay
  on its branch without asking again.
- Do not commit or push unless the user explicitly requests it. Do not push to `main`, force-push, or rewrite pushed
  history.
- Write Git commit messages and pull request titles and descriptions in English.
- Only the owners merge pull requests.

## Documentation

- Write task-focused instructions, requirements, or troubleshooting. Include UI navigation only when necessary; omit
  incidental UI details and implementation narration from user docs.
- Maintainer docs should describe stable architecture, ownership, interfaces, and reproducible procedures. Omit agent
  reminders, conversation recaps, status reports, and temporary plans unless requested.
- Update authoritative docs in place; avoid duplicate explanations and change-only documents.
- Check docs against current code and configuration, remove obsolete guidance, and distinguish verified behavior from
  proposals or unperformed validation.
- When `ARCHITECTURE.md`, `REQUIREMENTS.md`, `FORMULA-FORMAT.md` or `DECISIONS.md` changes, update
  `docs/zh/架构说明.md` in the same pull request.
