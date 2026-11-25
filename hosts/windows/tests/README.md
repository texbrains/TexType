# Windows tests

**Owns**

- end-to-end tests in real Word, PowerPoint and WPS, driven through the add-ins' own commands
- tests of add-in code that needs no Office (parsing, geometry, the pointer-size import guard)

**Limits**

- no tests against a fake Office object model: the bugs that matter are in how the real hosts behave
- test documents live in testing/fixtures

First version of this code: see `docs/SOURCES.md`.

`Office`: the end-to-end runs in Word and WPS Writer. `ProtocolCorpus`: the stored protocol messages read and
written back. `dev-register.ps1`: registers the built add-in for a development run.
