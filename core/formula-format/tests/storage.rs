//! Reading the OLE object's storage: the three streams, missing streams, oversized previews, bytes that are no
//! storage at all.

use formula_format::identifiers::{OLE_STREAM_EMF, OLE_STREAM_PNG, OLE_STREAM_RECORD};
use formula_format::{read_object, Error, MAX_PREVIEW_BYTES};
use std::io::{Cursor, Write};
use std::path::PathBuf;

fn record_bytes() -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testing/corpus/formula-format/valid/full.json");
    std::fs::read(path).expect("readable")
}

/// An object storage as the registered object writes it, with the given streams.
fn storage(streams: &[(&str, &[u8])]) -> Vec<u8> {
    let mut file = cfb::CompoundFile::create(Cursor::new(Vec::new())).expect("creates");
    for (name, bytes) in streams {
        let mut stream = file.create_stream(format!("/{name}")).expect("stream");
        stream.write_all(bytes).expect("writes");
    }
    file.flush().expect("flushes");
    file.into_inner().into_inner()
}

#[test]
fn the_record_and_both_previews_are_read() {
    let record = record_bytes();
    let bytes = storage(&[
        (OLE_STREAM_RECORD, &record),
        (OLE_STREAM_EMF, b"emf bytes"),
        (OLE_STREAM_PNG, b"png bytes"),
    ]);
    let contents = read_object(&bytes).expect("reads");
    assert_eq!(
        contents.record,
        formula_format::read(&record).expect("valid")
    );
    assert_eq!(contents.emf, b"emf bytes");
    assert_eq!(contents.png, b"png bytes");
}

#[test]
fn a_missing_stream_is_named() {
    let record = record_bytes();
    let bytes = storage(&[(OLE_STREAM_RECORD, &record), (OLE_STREAM_EMF, b"emf")]);
    assert_eq!(
        read_object(&bytes),
        Err(Error::MissingStream(OLE_STREAM_PNG))
    );
}

#[test]
fn an_oversized_preview_is_refused() {
    let record = record_bytes();
    let big = vec![0u8; MAX_PREVIEW_BYTES as usize + 1];
    let bytes = storage(&[
        (OLE_STREAM_RECORD, &record),
        (OLE_STREAM_EMF, &big),
        (OLE_STREAM_PNG, b"png"),
    ]);
    assert_eq!(
        read_object(&bytes),
        Err(Error::PreviewTooLarge {
            stream: OLE_STREAM_EMF,
            bytes: MAX_PREVIEW_BYTES + 1
        })
    );
}

#[test]
fn a_damaged_record_inside_the_object_is_refused() {
    let bytes = storage(&[
        (OLE_STREAM_RECORD, b"{"),
        (OLE_STREAM_EMF, b"emf"),
        (OLE_STREAM_PNG, b"png"),
    ]);
    assert_eq!(
        read_object(&bytes).map_err(|e| e.code()),
        Err("not-json".to_owned())
    );
}

#[test]
fn bytes_that_are_no_storage_are_refused() {
    assert_eq!(
        read_object(b"not a compound file").map_err(|e| e.code()),
        Err("not-storage".to_owned())
    );
}
