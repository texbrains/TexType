//! The one conversion interface: every formula format to and from a TexType formula record.
//!
//! Owns:
//! - `convert(input, target)`: the only entry point for format conversion in the product
//! - Word native equations: MathML -> OMML (numbered display forms included), OMML -> MathML -> LaTeX (`omml`)
//! - MathType objects: reading and writing the equation data exactly as MathType 6 and 7 store it, the object
//!   storage, and our own lightweight typesetting of the preview with MathType's rules and fonts (`mathtype`)
//! - picture formats: SVG -> EMF and SVG -> PNG for TexType OLE objects and picture formulas (`pictures`)
//!
//! In and out: any supported format -> a formula record -> any supported format. Every conversion passes through
//! the record, so adding a format means one reader and one writer, not one converter per pair.
//!
//! Limits:
//! - no document access: inserting the result is the add-ins' job
//! - LaTeX -> MathML and LaTeX -> pictures in our own look are done by ui/kernel; the main program combines the two
//!   behind the same request, so callers still see one interface
//! - editing an existing MathType object keeps every record of the original that the edit does not change
//! - no MathType program or library is called or shipped, and an installed MathType is not used either
//!
//! Where the first version of this code comes from: docs/SOURCES.md.

pub mod omml;
pub mod pictures;
