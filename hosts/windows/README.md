# Windows add-ins (C# and C++)

**Owns**

- everything that runs inside Word, PowerPoint and WPS on Windows: Office object-model calls, the ribbon, the OLE object

**Limits**

- no conversion and no format knowledge: equation formats, MathType data and pictures come from the app
- no settings of its own: it asks the app
- Office is called through the typed object model, directly; there is no adapter layer in between

First version of this code: see `docs/SOURCES.md`.

Folders: `Word` (Word and WPS Writer), `PowerPoint` (PowerPoint and WPS Presentation), `Shared` (what both use), `OleObject` (C++), `tests`.

## Build and test

The .NET SDK (`dotnet`) and Node are needed; output goes to `target/windows/`. The add-ins target .NET Framework
4.7.2 and are built once per Office bitness.

```powershell
dotnet build hosts/windows -c Release -p:Platform=x64
dotnet build hosts/windows -c Release -p:Platform=x86
target/windows/bin/ProtocolCorpus/x64/Release/net472/ProtocolCorpus.exe testing/corpus/protocol
```

`ProtocolCorpus` reads every stored message of `testing/corpus/protocol` through the add-ins' message types and
writes it back to the same JSON. The product identifiers the add-ins need are generated from `product.toml` at build
time (`tools/product-csharp.mjs`).

For a development run, register the built Word add-in for the current user with `tests/dev-register.ps1`
(`-Platform x86` for 32-bit Office or WPS, `-Unregister` to remove it), with Word and WPS closed, and start the app
(`target/debug/app.exe` without arguments): the add-in opens its editor through the app. WPS lists a newly
registered add-in without connecting it: tick it once in WPS's COM add-ins dialog.

The tests in real Word and WPS Writer are in `tests/Office` (`node hosts/windows/tests/Office/e2e.mjs word full`).
