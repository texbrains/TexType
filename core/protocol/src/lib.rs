//! Messages between the app and the add-ins, and the product's identifiers.
//!
//! Owns:
//! - the product's name and technical identifiers (`product`), generated from product.toml
//! - every request and response exchanged between the app and an add-in, defined
//!   once here
//! - the protocol version and the rule for refusing a mismatched peer
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

pub use messages::{
    decode_request, encode_response, welcome, ErrorCode, Hello, Host, Request, RequestBody,
    Response, ResponseBody, PROTOCOL_VERSION,
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
