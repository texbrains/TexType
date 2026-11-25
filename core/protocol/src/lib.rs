//! Messages between the app and the add-ins, and the product's identifiers.
//!
//! Owns:
//! - the product's name and technical identifiers (`product`), generated from product.toml
//! - every request and response exchanged between the app and an add-in, defined
//!   once here
//! - the protocol version and the rule for refusing a mismatched peer
//! - how a message travels on the Windows named pipe `\\.\pipe\<pipe_name>-<Windows session id>` (one pipe per
//!   logged-on user): a 4-byte little-endian length, then the UTF-8 JSON (`frame`, `MAX_MESSAGE_BYTES`)
//!
//! In and out: JSON messages
//!
//! Limits:
//! - no behaviour: definitions only
//!
//! Where the first version of this code comes from: docs/SOURCES.md.

/// The product's name and technical identifiers. The technical identifiers may not be written
/// anywhere else in the repository (tools/check-structure.mjs enforces this).
pub mod product {
    include!(concat!(env!("OUT_DIR"), "/product.rs"));
}

mod messages;

/// The largest message either side accepts.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

/// One message as it travels on the pipe: its length (4 bytes, little-endian), then its bytes.
pub fn frame(message: &[u8]) -> Vec<u8> {
    assert!(
        message.len() <= MAX_MESSAGE_BYTES,
        "a message is at most {MAX_MESSAGE_BYTES} bytes"
    );
    let mut framed = Vec::with_capacity(4 + message.len());
    framed.extend((message.len() as u32).to_le_bytes());
    framed.extend(message);
    framed
}

pub use messages::{
    decode_request, encode_response, welcome, EditEquation, ErrorCode, Hello, Host, Request,
    RequestBody, Response, ResponseBody, PROTOCOL_VERSION,
};

#[cfg(test)]
mod tests {
    use super::product;

    #[test]
    fn product_identifiers_are_present() {
        for value in [
            product::NAME,
            product::VENDOR,
            product::IDENTIFIER,
            product::OLE_PROGID,
            product::PIPE_NAME,
        ] {
            assert!(!value.trim().is_empty());
        }
    }
}
