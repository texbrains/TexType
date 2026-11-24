//! Why a stored formula was refused. Each error says exactly what is wrong; none is repaired.

use crate::identifiers::NAME;
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    /// The record is larger than the format allows (section 4, rule 6).
    TooLarge {
        bytes: usize,
    },
    /// The record starts with a byte order mark; the format is UTF-8 without one.
    Bom,
    NotUtf8,
    NotJson(String),
    /// The JSON is not a record of this format (missing or other `format`).
    WrongFormat,
    /// A newer major version: made by a newer release of the product (section 4, rule 3).
    NewerVersion {
        major: u32,
        minor: u32,
    },
    /// A major version this format never had.
    UnsupportedVersion {
        major: u32,
        minor: u32,
    },
    /// A required field is missing or has the wrong type.
    Schema(String),
    /// A field has a value the format does not allow.
    Invalid {
        field: &'static str,
        reason: String,
    },
    /// The bytes are not an OLE compound file.
    NotStorage(String),
    MissingStream(&'static str),
    PreviewTooLarge {
        stream: &'static str,
        bytes: u64,
    },
}

impl Error {
    pub(crate) fn invalid(field: &'static str, reason: impl Into<String>) -> Self {
        Error::Invalid {
            field,
            reason: reason.into(),
        }
    }

    /// A short stable name of the error kind, for tests and logs.
    pub fn code(&self) -> String {
        match self {
            Error::TooLarge { .. } => "too-large".into(),
            Error::Bom => "bom".into(),
            Error::NotUtf8 => "not-utf8".into(),
            Error::NotJson(_) => "not-json".into(),
            Error::WrongFormat => "wrong-format".into(),
            Error::NewerVersion { .. } => "newer-version".into(),
            Error::UnsupportedVersion { .. } => "unsupported-version".into(),
            Error::Schema(_) => "schema".into(),
            Error::Invalid { field, .. } => format!("invalid:{field}"),
            Error::NotStorage(_) => "not-storage".into(),
            Error::MissingStream(_) => "missing-stream".into(),
            Error::PreviewTooLarge { .. } => "preview-too-large".into(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::TooLarge { bytes } => {
                write!(f, "the formula record is {bytes} bytes; the limit is 1 MB")
            }
            Error::Bom => write!(f, "the formula record starts with a byte order mark"),
            Error::NotUtf8 => write!(f, "the formula record is not valid UTF-8"),
            Error::NotJson(detail) => write!(f, "the formula record is not valid JSON: {detail}"),
            Error::WrongFormat => write!(f, "the data is not a {NAME} formula record"),
            Error::NewerVersion { major, minor } => {
                write!(
                    f,
                    "this formula was made by a newer {NAME} (format {major}.{minor})"
                )
            }
            Error::UnsupportedVersion { major, minor } => {
                write!(
                    f,
                    "the formula record has an unknown format version {major}.{minor}"
                )
            }
            Error::Schema(detail) => write!(f, "the formula record is incomplete: {detail}"),
            Error::Invalid { field, reason } => write!(f, "the formula record's {field} {reason}"),
            Error::NotStorage(detail) => {
                write!(f, "the formula object is not an OLE storage: {detail}")
            }
            Error::MissingStream(name) => write!(f, "the formula object has no stream {name}"),
            Error::PreviewTooLarge { stream, bytes } => {
                write!(
                    f,
                    "the formula object's {stream} is {bytes} bytes; the limit is 8 MB"
                )
            }
        }
    }
}

impl std::error::Error for Error {}
