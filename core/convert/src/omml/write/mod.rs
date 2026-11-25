//! MathML -> OMML:
//! - `prep`: the MathML passes before the projection (ValidateMathMlForOmml ...
//!   ReplaceExtendedIntegralsWithOfficePlaceholders);
//! - `proj`: MathMlOmmlProjection.Project, the OMML passes after it
//!   (ExtractSingleOMath ... NormalizeGeneratedOmmlArgumentOrder) and
//!   BuildWordNativeNumberedOmml, Word's native #(SEQ) equation number.

pub(super) mod prep;
pub(super) mod proj;
