# Tests in real Word and WPS Writer

**Owns**

- end-to-end runs of the Word / WPS Writer add-in: its Ribbon buttons, the app's editor window and the document as
  the host wrote it

**Limits**

- drives the hosts without global input: COM for the document, UI Automation and window messages for the Ribbon,
  the Chrome DevTools Protocol for the editor page
- each run writes its own documents; nothing here is a stored fixture

## Run

1. Build the add-in and the app, and register the add-in (see `hosts/windows/README.md`). Close Word and WPS.
2. Run one mode in one host. Word quits at the end; WPS is closed before the run (only a newly started WPS reads the
   add-in registration) and at the end.

```powershell
node hosts/windows/tests/Office/e2e.mjs word full
node hosts/windows/tests/Office/e2e.mjs wps inserts
```

Each run starts `target/debug/app.exe` with a debug port for its editor page (9341) and works in
`target/office-tests/<host>-<mode>-<time>/`: the document, `e2e.log`, `app.log`, and on a failure screenshots of the
host and the editor. It stops at the first failure and ends with `RESULT: PASSED` or `RESULT: FAILED`.

| Mode | Checks |
| --- | --- |
| `full` | insert inline and display, edit, Undo/Redo, save and reopen, five edits in a row, Cancel, edit the display equation |
| `inserts` | inline at a paragraph's end, display after an inline equation, inside text, at a paragraph's start, in a table cell, inside an equation (joined), in an empty paragraph (the host makes it display) |
| `edge` | inside a hyperlink (insert and edit), at the start of its text and in front of it, inside a content control, a fraction and a join in its numerator, with Track Changes on |
| `source` | the LaTeX source view's completion and command colours; an unknown command keeps the window open with the reason |
| `file-undo` | an equation written in the file, edited and undone |

Every insert and edit in `inserts` and `edge` is followed by one Undo, which must give back exactly the document
before, and one Redo, which must give back exactly the result.

## What the hosts need

- WPS: out-of-process COM sees no equations, so the document is saved and its XML read (`document.ps1 xstate`).
  Its large Ribbon buttons have no UI Automation name: they get a click at a measured place
  (`WPS_BUTTONS` in `e2e.mjs`, measured on a 1020x1360 window); measure again for another window size.
- Word: quitting can ask about Document Recovery files; `word-recovery-keep.ps1` keeps them.
