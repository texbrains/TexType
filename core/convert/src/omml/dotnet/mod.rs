//! The .NET behaviour the Rust ports of the Windows converters reproduce: `omml_latex` (Word equations -> MathML
//! -> LaTeX) and `omml_write` (MathML -> Word equations) share System.Xml.Linq's tree (`dom`), System.String and
//! System.Char (`netstr`) and the Unicode data .NET 8 uses (`unicode_tables`). Reading and writing XML stays with
//! each port: the Windows converters use different XmlReader settings and writers.

pub(crate) mod dom;
pub(crate) mod netstr;
mod unicode_tables;
