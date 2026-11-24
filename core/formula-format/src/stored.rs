//! The stored form of a record: UTF-8 JSON with `format` and `version` (section 3), read under the rules of
//! section 4.

use crate::error::Error;
use crate::identifiers::FORMULA_FORMAT;
use crate::record::Record;
use serde::Serialize;
use serde_json::Value;

/// The version every writer writes: `[major, minor]`.
pub const CURRENT_VERSION: [u32; 2] = [1, 0];
/// Section 4, rule 6.
pub const MAX_RECORD_BYTES: usize = 1024 * 1024;
/// Section 4, rule 6.
pub const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
struct Stored<'a> {
    format: &'static str,
    version: [u32; 2],
    #[serde(flatten)]
    record: &'a Record,
}

/// Reads a stored record. Accepts the current major version with any minor version and ignores fields it does not
/// know; refuses everything else with a precise error (section 4, rules 3, 4 and 6).
pub fn read(bytes: &[u8]) -> Result<Record, Error> {
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(Error::TooLarge { bytes: bytes.len() });
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err(Error::Bom);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Error::NotUtf8)?;
    let value: Value =
        serde_json::from_str(text).map_err(|error| Error::NotJson(error.to_string()))?;
    if value.get("format").and_then(Value::as_str) != Some(FORMULA_FORMAT) {
        return Err(Error::WrongFormat);
    }
    let [major, minor] = version(&value)?;
    if major > CURRENT_VERSION[0] {
        return Err(Error::NewerVersion { major, minor });
    }
    if major < CURRENT_VERSION[0] {
        return Err(Error::UnsupportedVersion { major, minor });
    }
    let record: Record =
        serde_json::from_value(value).map_err(|error| Error::Schema(error.to_string()))?;
    record.validate()?;
    Ok(record)
}

/// Writes a record in the current version. The record is checked first, so nothing invalid is ever stored.
pub fn write(record: &Record) -> Result<Vec<u8>, Error> {
    record.validate()?;
    let bytes = serde_json::to_vec(&Stored {
        format: FORMULA_FORMAT,
        version: CURRENT_VERSION,
        record,
    })
    .expect("a record always serializes");
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(Error::TooLarge { bytes: bytes.len() });
    }
    Ok(bytes)
}

fn version(value: &Value) -> Result<[u32; 2], Error> {
    let numbers: Option<Vec<u32>> =
        value
            .get("version")
            .and_then(Value::as_array)
            .and_then(|items| {
                items
                    .iter()
                    .map(|item| item.as_u64().and_then(|n| u32::try_from(n).ok()))
                    .collect()
            });
    match numbers.as_deref() {
        Some([major, minor]) => Ok([*major, *minor]),
        _ => Err(Error::invalid("version", "is not [major, minor]")),
    }
}
