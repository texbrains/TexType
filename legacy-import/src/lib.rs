//! TEMPORARY: one-way conversion of formulas made by the two earlier products.
//!
//! Owns:
//! - recognising an old formula object or equation and returning its source and style
//! - nothing else: the result is written with the normal new formats by the normal code
//!
//! In and out: old object bytes, tags or variables  ->  a formula-format record
//!
//! Limits:
//! - lives outside core/; only the app uses it, as an optional feature (`legacy-import`). Deleting this folder and
//!   the feature leaves everything else compiling
//! - the two earlier product names appear only in this crate and in docs/
//!
//! Where the first version of this code comes from: docs/SOURCES.md.
