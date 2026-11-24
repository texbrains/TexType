//! The TexType formula format: what a formula is when it is stored in a document (docs/FORMULA-FORMAT.md).
//!
//! Owns:
//! - the record (source, style, custom symbols, layout, MathML, preview hash, version) and its validation
//! - the OLE object's streams and the picture tags of presentation formulas
//! - the version rule: same major version accepted, unknown fields ignored, higher major refused
//!
//! In and out: stream bytes or tags  ->  a validated record, and back
//!
//! Limits:
//! - no Office calls, no rendering, no settings lookup
//! - an unsupported or damaged record is refused with a precise error, never repaired or migrated
//!
//! Where the first version of this code comes from: docs/SOURCES.md.

mod error;
mod record;
mod storage;
mod stored;

/// The format's identifiers, generated from product.toml.
pub mod identifiers {
    include!(concat!(env!("OUT_DIR"), "/identifiers.rs"));
}

pub use error::Error;
pub use record::{
    Faces, Layout, Line, Numbering, NumberingMode, Origin, Platform, Preview, Record, Source,
    Stamp, Style, Symbol, SymbolClass,
};
pub use storage::{read_object, ObjectContents};
pub use stored::{read, write, CURRENT_VERSION, MAX_PREVIEW_BYTES, MAX_RECORD_BYTES};
