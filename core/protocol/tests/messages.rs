//! The stored messages in testing/corpus/protocol are the contract between the app and the add-ins: each one is
//! read and written back to the same JSON. The add-ins' own tests read the same files.

use protocol::{
    decode_request, encode_response, welcome, ErrorCode, Hello, Host, RequestBody, Response,
    ResponseBody, PROTOCOL_VERSION,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn messages(kind: &str) -> Vec<(String, Vec<u8>)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testing/corpus/protocol")
        .join(kind);
    let mut files: Vec<_> = fs::read_dir(&dir)
        .expect("corpus folder")
        .map(|entry| entry.expect("entry").path())
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no messages in {}", dir.display());
    files
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .expect("name")
                .to_string_lossy()
                .into_owned();
            (name, fs::read(&path).expect("readable"))
        })
        .collect()
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).expect("JSON")
}

#[test]
fn stored_requests_read_and_write_back_unchanged() {
    for (name, bytes) in messages("requests") {
        let request = decode_request(&bytes).unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(
            json(&serde_json::to_vec(&request).expect("serializes")),
            json(&bytes),
            "{name}"
        );
    }
}

#[test]
fn stored_responses_read_and_write_back_unchanged() {
    for (name, bytes) in messages("responses") {
        let response: Response =
            serde_json::from_slice(&bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(json(&encode_response(&response)), json(&bytes), "{name}");
    }
}

fn hello(protocol: u32) -> Hello {
    Hello {
        protocol,
        host: Host::Word,
        host_version: "16.0".into(),
        addin_version: "0.0.0".into(),
    }
}

#[test]
fn a_peer_with_the_same_version_is_welcomed_and_another_is_refused() {
    assert!(matches!(
        welcome(&hello(PROTOCOL_VERSION), "0.0.0"),
        ResponseBody::Welcome {
            protocol: PROTOCOL_VERSION,
            ..
        }
    ));
    let refused = welcome(&hello(PROTOCOL_VERSION + 1), "0.0.0");
    assert!(matches!(
        refused,
        ResponseBody::Error {
            code: ErrorCode::ProtocolMismatch,
            ..
        }
    ));
    let stored: Response = serde_json::from_slice(
        &messages("responses")
            .into_iter()
            .find(|(n, _)| n == "protocol-mismatch.json")
            .expect("stored")
            .1,
    )
    .expect("reads");
    assert_eq!(
        refused, stored.body,
        "the stored refusal is what the app sends"
    );
}

#[test]
fn unknown_or_broken_requests_are_refused() {
    for bytes in [
        &b"{\"id\":1,\"body\":{\"type\":\"formatDisk\"}}"[..],
        b"{\"id\":1",
        b"{\"id\":1,\"body\":{\"type\":\"getSettings\",\"x\":\"\xFF\"}}",
    ] {
        assert!(decode_request(bytes).is_err());
    }
    assert!(matches!(
        decode_request(b"{\"id\":7,\"body\":{\"type\":\"getSettings\"}}").map(|r| r.body),
        Ok(RequestBody::GetSettings)
    ));
}
