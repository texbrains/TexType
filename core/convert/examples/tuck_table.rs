//! MathType's subscript tuck per base letter (the corpus' probe/tuck-* pictures: an italic letter with the
//! subscript k at 12 pt) beside the letter's ink at 64 ppem, for working out the tuck rule. Per letter: the
//! subscript's ink start after the base's origin in MathType's picture less the script gap, the base's full ink
//! right, and its ink right in the rows below a height (pixels, 6 units each).
//!   cargo run -p convert --example tuck_table

use convert::mathtype::picture::{Face, Fonts};

fn main() {
    let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testing/corpus/mathtype/pictures.jsonl");
    let fonts = Fonts::with_mathtype_fonts(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../resources/fonts"),
    )
    .expect("bundled fonts");
    let italic = |name: &str| Face {
        name: name.into(),
        bold: false,
        italic: true,
    };
    let k_left = fonts
        .ink_box(&italic("Times New Roman"), false, 'k' as u32)
        .unwrap()
        .0;
    println!("letter  mathtype  full  rows<10 rows<14 rows<18 rows<23 rows<28  (pixels)");
    for line in std::fs::read_to_string(corpus).unwrap().lines() {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let source = row["source"].as_str().unwrap();
        if !source.starts_with("probe/tuck-") {
            continue;
        }
        let texts: Vec<&serde_json::Value> = row["picture"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|i| i["kind"] == "text")
            .collect();
        let Some(sub) = texts.iter().find(|t| t["height"] == 224) else {
            continue;
        };
        let Some(base) = texts.iter().find(|t| t["height"] == 384) else {
            continue;
        };
        let (font, byte) = (
            base["font"].as_str().unwrap(),
            u8::from_str_radix(base["bytes"].as_str().unwrap(), 16).unwrap(),
        );
        let symbol = font == "Symbol";
        let face = italic(font);
        let Some((_, full, ..)) = fonts.ink_box(&face, symbol, u32::from(byte)) else {
            continue;
        };
        let rows = fonts.ink_rows(&face, symbol, u32::from(byte));
        let below = |h: i32| {
            rows.iter()
                .filter(|r| r.0 < h)
                .map(|r| r.2)
                .max()
                .unwrap_or(0)
        };
        // the subscript's ink start: its origin plus k's left side at 224 units (k's pixels scaled), less the gap
        let start = sub["x"].as_i64().unwrap() as i32 + (k_left * 224).div_euclid(64)
            - 30
            - base["x"].as_i64().unwrap() as i32;
        println!(
            "{:<7} {:>8.1} {:>5} {:>7} {:>7} {:>7} {:>7} {:>7}",
            source.trim_start_matches("probe/tuck-"),
            f64::from(start) / 6.0,
            full,
            below(10),
            below(14),
            below(18),
            below(23),
            below(28)
        );
    }
}
