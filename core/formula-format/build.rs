//! Turns the formula format's identifiers in product.toml (repository root) into Rust constants, so that they are
//! written in exactly one file.
use std::{env, fs, path::Path};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let source = root.join("product.toml");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(&source).expect("product.toml is missing");
    let table: toml::Table = text.parse().expect("product.toml is not valid TOML");
    let mut out = String::new();
    for key in [
        "name",
        "formula_format",
        "ole_stream_record",
        "ole_stream_emf",
        "ole_stream_png",
    ] {
        let value = table
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("product.toml: missing string `{key}`"));
        out.push_str(&format!(
            "pub const {}: &str = {:?};\n",
            key.to_uppercase(),
            value
        ));
    }
    let target =
        Path::new(&env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("identifiers.rs");
    fs::write(target, out).expect("OUT_DIR is writable");
}
