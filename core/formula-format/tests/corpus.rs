//! The stored records in testing/corpus/formula-format: each valid one is read, written and read again unchanged;
//! each invalid one is refused with the error named in cases.json.

use formula_format::{read, write, Error, CURRENT_VERSION, MAX_RECORD_BYTES};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testing/corpus/formula-format")
}

fn cases() -> Vec<(String, String)> {
    let text = fs::read_to_string(corpus().join("cases.json")).expect("cases.json is readable");
    let cases: Vec<Value> = serde_json::from_str(&text).expect("cases.json is JSON");
    cases
        .iter()
        .map(|case| {
            (
                case["file"].as_str().expect("file").to_owned(),
                case["expect"].as_str().expect("expect").to_owned(),
            )
        })
        .collect()
}

#[test]
fn every_case_gives_its_expected_result() {
    let cases = cases();
    assert!(cases.iter().any(|(_, expect)| expect == "ok"));
    for (file, expect) in cases {
        let bytes = fs::read(corpus().join(&file)).expect("case file is readable");
        let got = match read(&bytes) {
            Ok(_) => "ok".to_owned(),
            Err(error) => error.code(),
        };
        assert_eq!(got, expect, "{file}");
    }
}

#[test]
fn valid_records_survive_writing_and_reading() {
    for (file, expect) in cases() {
        if expect != "ok" {
            continue;
        }
        let record = read(&fs::read(corpus().join(&file)).expect("readable")).expect("valid");
        let written = write(&record).expect("a valid record writes");
        assert_eq!(read(&written).expect("reads back"), record, "{file}");
    }
}

#[test]
fn the_writer_writes_the_current_version_and_drops_unknown_fields() {
    let bytes = fs::read(corpus().join("valid/newer-minor-unknown-fields.json")).expect("readable");
    let written = write(&read(&bytes).expect("a newer minor version is read")).expect("writes");
    let value: Value = serde_json::from_slice(&written).expect("JSON");
    assert_eq!(value["version"], serde_json::json!(CURRENT_VERSION));
    assert!(value.get("addedLater").is_none());
    assert!(value["style"].get("addedLater").is_none());
}

#[test]
fn a_record_over_the_size_limit_is_refused_before_it_is_parsed() {
    let mut bytes = fs::read(corpus().join("valid/full.json")).expect("readable");
    bytes.resize(MAX_RECORD_BYTES + 1, b' ');
    assert_eq!(
        read(&bytes),
        Err(Error::TooLarge {
            bytes: MAX_RECORD_BYTES + 1
        })
    );
}

#[test]
fn an_invalid_record_is_not_written() {
    let mut record =
        read(&fs::read(corpus().join("valid/full.json")).expect("readable")).expect("valid");
    record.style.color = "red".into();
    assert_eq!(
        write(&record).map_err(|e| e.code()),
        Err("invalid:style.color".to_owned())
    );
}

#[test]
fn derived_data_is_stale_after_an_engine_update_or_a_changed_preview() {
    let record =
        read(&fs::read(corpus().join("valid/full.json")).expect("readable")).expect("valid");
    let hash = record.preview.sha256.clone();
    assert!(!record.is_stale("1.0.0", &hash));
    assert!(record.is_stale("1.0.1", &hash));
    assert!(
        !record.is_stale("0.9.0", &hash),
        "a newer engine's drawing is kept"
    );
    assert!(record.is_stale("1.0.0", &"0".repeat(64)));
}
