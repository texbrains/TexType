//! The one-click conversion of formulas made by the two earlier products. TEMPORARY.
//!
//! Owns: finding old formulas in a document (through the add-ins) and converting each to a TexType formula
//! with the reader in `legacy-import/`.
//! Limits: the only module that uses `legacy-import`; compiled only with the `legacy-import` feature. To remove the
//! conversion: delete this file, `legacy-import/`, and the dependency and feature in app/Cargo.toml.
