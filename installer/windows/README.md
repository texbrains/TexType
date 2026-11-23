# Windows installer

**Owns**

- one installer: app, add-ins for Office and WPS (32-bit and 64-bit), OLE object registration
- clean upgrade and clean removal

**Limits**

- no behaviour hidden in install scripts: repair steps are in app/src/install.rs and the installer calls them

First version of this code: see `docs/SOURCES.md`.
