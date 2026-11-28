//! TexType's inked pixel boxes of glyphs at 64 ppem, one line per glyph, for comparing with Windows' black boxes
//! (kit glyph-boxes-gdi.ps1 prints the same lines from GetGlyphOutline); with --rows each glyph's pixel rows too.
//!   cargo run -p convert --example glyph_boxes -- <face> <bold 0|1> <italic 0|1> <symbol 0|1> <first hex> <last hex> [--rows]

use convert::mathtype::picture::{Face, Fonts};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [name, bold, italic, symbol, first, last, rest @ ..] = &args[..] else {
        panic!(
            "usage: glyph_boxes <face> <bold> <italic> <symbol> <first hex> <last hex> [--rows]"
        );
    };
    let rows = rest.iter().any(|a| a == "--rows");
    let face = Face {
        name: name.clone(),
        bold: bold == "1",
        italic: italic == "1",
    };
    let fonts = Fonts::with_mathtype_fonts(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../resources/fonts"),
    )
    .expect("bundled fonts");
    let (first, last) = (
        u32::from_str_radix(first, 16).unwrap(),
        u32::from_str_radix(last, 16).unwrap(),
    );
    for code in first..=last {
        if let Some((left, right, top, bottom, advance)) = fonts.ink_box(&face, symbol == "1", code)
        {
            println!("{code:x} {left} {right} {top} {bottom} {advance}");
            if rows {
                for (y, l, r) in fonts.ink_rows(&face, symbol == "1", code) {
                    println!("  y {y:3} {l:3}..{r:3}");
                }
            }
        }
    }
}
