//! MathType equations: MathType's equation data (MTEF v5 in the Equation Native stream) as MathType 6 and 7 store
//! it. TexType's own codec, designed from the format; MathType itself is the judge (testing/corpus/mathtype,
//! core/convert/tests/mathtype.rs):
//! - `mtef`: the records, kept whole (every stored equation reads and writes back byte for byte);
//! - `read`: an equation as MathML, compared with MathType's own MathML export and with the MathML its import was
//!   given;
//! - `write`: MathML as an equation, compared with MathType's own records for the same formulas (`characters`:
//!   which style or font draws each character);
//! - `picture`: the picture Word shows for an equation, drawn as MathType draws it, compared with MathType's own
//!   pictures.

mod characters;
mod mathml;
pub mod mtef;
pub mod picture;
pub mod read;
pub(crate) mod records;
pub mod write;
