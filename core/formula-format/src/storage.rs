//! Reading the OLE object's storage (section 2): the record and the two previews, from the object's bytes as they
//! are stored in a document. The registered object itself writes the storage; this is the reader for everything
//! that opens a document without Office.

use crate::error::Error;
use crate::identifiers::{OLE_STREAM_EMF, OLE_STREAM_PNG, OLE_STREAM_RECORD};
use crate::record::Record;
use crate::stored::{read, MAX_PREVIEW_BYTES, MAX_RECORD_BYTES};
use std::io::{Cursor, Read, Seek};

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectContents {
    pub record: Record,
    pub emf: Vec<u8>,
    pub png: Vec<u8>,
}

pub fn read_object(bytes: &[u8]) -> Result<ObjectContents, Error> {
    let mut storage = cfb::CompoundFile::open(Cursor::new(bytes))
        .map_err(|error| Error::NotStorage(error.to_string()))?;
    let record_bytes = stream(
        &mut storage,
        OLE_STREAM_RECORD,
        MAX_RECORD_BYTES as u64,
        |bytes| Error::TooLarge {
            bytes: bytes as usize,
        },
    )?;
    let record = read(&record_bytes)?;
    let emf = stream(&mut storage, OLE_STREAM_EMF, MAX_PREVIEW_BYTES, |bytes| {
        Error::PreviewTooLarge {
            stream: OLE_STREAM_EMF,
            bytes,
        }
    })?;
    let png = stream(&mut storage, OLE_STREAM_PNG, MAX_PREVIEW_BYTES, |bytes| {
        Error::PreviewTooLarge {
            stream: OLE_STREAM_PNG,
            bytes,
        }
    })?;
    Ok(ObjectContents { record, emf, png })
}

/// One stream's bytes; its length is checked against `limit` before it is read.
fn stream<F: Read + Seek>(
    storage: &mut cfb::CompoundFile<F>,
    name: &'static str,
    limit: u64,
    too_large: impl FnOnce(u64) -> Error,
) -> Result<Vec<u8>, Error> {
    let path = format!("/{name}");
    if !storage.is_stream(&path) {
        return Err(Error::MissingStream(name));
    }
    let mut stream = storage
        .open_stream(&path)
        .map_err(|error| Error::NotStorage(error.to_string()))?;
    if stream.len() > limit {
        return Err(too_large(stream.len()));
    }
    let mut bytes = Vec::new();
    stream
        .read_to_end(&mut bytes)
        .map_err(|error| Error::NotStorage(error.to_string()))?;
    Ok(bytes)
}
