//! MathML -> Word OMML writer, ported byte-exact from the Windows add-in's
//! WordOmmlConverter.TransformMathMlToOmml (everything after the MathML
//! preparation passes s01..s12) and WordOmmlEquationNumbers.BuildWordNativeNumberedOmml:
//!
//! ```text
//! projection = MathMlOmmlProjection.Project(m)          -> project
//! o00 ExtractSingleOMath(projection)                     -> extract_single_omath
//! o01 RestoreExtendedIntegralCharacters(o, naryChars)    -> restore_extended_integral_characters
//! o02 NormalizeExplicitUprightRuns(o, m)                 -> normalize_explicit_upright_runs
//! o03 NormalizeAppliedFunctionStructures(o, m)           -> normalize_applied_function_structures
//! o04 NormalizeExplicitTableColumnAlignment(o, m)        -> normalize_explicit_table_column_alignment
//! o05 NormalizeOmmlPlaceholderVisibility(o)              -> normalize_omml_placeholder_visibility
//! o06 NormalizeOptionalPrescriptSlots(o)                 -> normalize_optional_prescript_slots
//! o07 NormalizeDisplayNaryOmml(o, display)               -> normalize_display_nary_omml
//! o08 NormalizeGeneratedOmmlArgumentOrder(o)             -> normalize_generated_omml_argument_order
//! ```
//!
//! `m` is the prepared MathML (the s12 output), `naryChars` the n-ary list of
//! ReplaceExtendedIntegralsWithOfficePlaceholders (run on the s11 output) and
//! `display` is IsBlockMathMl(m).
//!
//! Byte-exactness rests on three emulations: `xml_reader` builds the trees
//! System.Xml.Linq builds (namespace declarations as attributes, `<a></a>` as
//! empty-string content), `xml_writer` reproduces XLinq's ElementWriter on
//! .NET's XmlWellFormedWriter (prefix lookup, generated `p{N}` prefixes,
//! default-namespace declarations, escaping, "\r\n" new lines) and
//! `office::dotnet::netstr` gives .NET 8's UTF-16 string semantics and Unicode 15.0 data.
//!
//! Errors are the C# exceptions as text ("InvalidDataException: ...").
//!
//! Known representation limits (none occurs in the Windows reference corpus):
//! XML comments and processing instructions are dropped when read (XLinq keeps
//! them unless the reader ignores them), and CDATA sections become text.

mod converter;
mod projection;
mod xml_reader;
mod xml_writer;

/// MathMlOmmlProjection.Project(preparedMathMl).
pub fn project(prepared_mathml: &str) -> Result<String, String> {
    projection::project(prepared_mathml)
}

/// o00: WordOmmlConverter.ExtractSingleOMath(xml).
pub fn extract_single_omath(xml: &str) -> Result<String, String> {
    converter::extract_single_omath(xml)
}

/// o00..o08 over a projection: the rest of TransformMathMlToOmml.
pub fn finish_omml(
    projection: &str,
    prepared_mathml: &str,
    nary_characters: &[String],
    is_block: bool,
) -> Result<String, String> {
    converter::finish_omml(projection, prepared_mathml, nary_characters, is_block)
}

/// WordOmmlEquationNumbers.BuildWordNativeNumberedOmml(semanticOmml, sequenceName,
/// numberBookmarkName: null, restartHeadingLevel, headingSeparator,
/// initialSequenceResult, literalHeadingPrefix, restartSequenceValue).
pub fn build_word_native_numbered_omml(
    semantic_omml: &str,
    sequence_name: &str,
    restart_heading_level: u32,
    heading_separator: &str,
    initial_sequence_result: &str,
    literal_heading_prefix: Option<&str>,
    restart_sequence_value: Option<u32>,
) -> Result<String, String> {
    converter::build_word_native_numbered_omml(
        semantic_omml,
        sequence_name,
        restart_heading_level,
        heading_separator,
        initial_sequence_result,
        literal_heading_prefix,
        restart_sequence_value,
    )
}

/// WordOmmlDocuments.ApplyExplicitTransferMathFont(omml, mathFontName).
pub fn apply_explicit_transfer_math_font(
    omml: &str,
    math_font_name: &str,
) -> Result<String, String> {
    converter::apply_explicit_transfer_math_font(omml, math_font_name)
}

#[cfg(test)]
mod behaviour_tests;

/// WordOmmlDocuments.NormalizeMathFontName.
pub fn normalize_math_font_name(math_font_name: &str) -> String {
    converter::normalize_math_font_name(math_font_name)
}
