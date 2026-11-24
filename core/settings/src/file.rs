//! The settings file: UTF-8 JSON with a schema version. A missing file means "all defaults" (first start); a
//! damaged or newer file is refused with a precise error and never overwritten silently.

use crate::user::UserSettings;
use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

/// The schema version every writer writes. A file with a higher one was written by a newer release.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Io(String),
    Bom,
    NotUtf8,
    NotJson(String),
    NewerSchema(u32),
    /// `schemaVersion` missing, not a number, or 0.
    NoSchema,
    Schema(String),
    Invalid {
        field: &'static str,
        reason: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Io(detail) => write!(f, "the settings file cannot be read or written: {detail}"),
            Error::Bom => write!(f, "the settings file starts with a byte order mark"),
            Error::NotUtf8 => write!(f, "the settings file is not valid UTF-8"),
            Error::NotJson(detail) => write!(f, "the settings file is not valid JSON: {detail}"),
            Error::NewerSchema(version) => write!(
                f,
                "the settings file was written by a newer release (schema {version})"
            ),
            Error::NoSchema => write!(f, "the settings file has no valid schemaVersion"),
            Error::Schema(detail) => write!(
                f,
                "the settings file has a setting of the wrong type: {detail}"
            ),
            Error::Invalid { field, reason } => write!(f, "the setting {field} {reason}"),
        }
    }
}

impl std::error::Error for Error {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stored<'a> {
    schema_version: u32,
    #[serde(flatten)]
    settings: &'a UserSettings,
}

pub fn read(path: &Path) -> Result<UserSettings, Error> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(UserSettings::default()),
        Err(error) => return Err(Error::Io(error.to_string())),
    };
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err(Error::Bom);
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| Error::NotUtf8)?;
    let value: Value =
        serde_json::from_str(text).map_err(|error| Error::NotJson(error.to_string()))?;
    match value.get("schemaVersion").and_then(Value::as_u64) {
        Some(version) if version > u64::from(SCHEMA_VERSION) => {
            return Err(Error::NewerSchema(
                u32::try_from(version).unwrap_or(u32::MAX),
            ))
        }
        Some(0) | None => return Err(Error::NoSchema),
        Some(_) => {}
    }
    let settings: UserSettings =
        serde_json::from_value(value).map_err(|error| Error::Schema(error.to_string()))?;
    validate(&settings)?;
    Ok(settings)
}

/// Writes the whole file at once (a temporary file beside it, then a rename), so a reader never sees half a file.
pub fn write(path: &Path, settings: &UserSettings) -> Result<(), Error> {
    validate(settings)?;
    let mut bytes = serde_json::to_vec_pretty(&Stored {
        schema_version: SCHEMA_VERSION,
        settings,
    })
    .expect("settings always serialize");
    bytes.push(b'\n');
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| Error::Io(error.to_string()))?;
    fs::rename(&temporary, path).map_err(|error| Error::Io(error.to_string()))
}

fn validate(settings: &UserSettings) -> Result<(), Error> {
    let style = &settings.style;
    for (field, size) in [
        ("style.inlineSizePt", style.inline_size_pt),
        ("style.displaySizePt", style.display_size_pt),
    ] {
        if size.is_some_and(|size| size <= 0.0) {
            return Err(Error::Invalid {
                field,
                reason: "is not a positive size".into(),
            });
        }
    }
    // The text size only fills in for sizes that follow the text; any positive value checks the rest.
    style
        .style_for(false, 1.0)
        .validate()
        .map_err(|error| match error {
            formula_format::Error::Invalid { field, reason } => Error::Invalid { field, reason },
            other => Error::Schema(other.to_string()),
        })
}
