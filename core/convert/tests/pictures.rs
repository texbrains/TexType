//! The previews of every stored formula picture (testing/corpus/tex-layout/svg-*.jsonl, as ui/kernel draws them): each
//! EMF is read back record by record and each PNG is decoded.

use convert::pictures::{svg_document, Pictures, Previews};
use resvg::tiny_skia::Pixmap;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::LazyLock;

static PICTURES: LazyLock<Pictures> = LazyLock::new(Pictures::with_system_fonts);

const EMR_HEADER: u32 = 1;
const EMR_EOF: u32 = 14;
const EMR_GDICOMMENT: u32 = 70;
/// Records that carry a bitmap (MS-EMF 2.1.1): BITBLT, STRETCHBLT, MASKBLT, PLGBLT, SETDIBITSTODEVICE, STRETCHDIBITS,
/// ALPHABLEND, TRANSPARENTBLT.
const BITMAP_RECORDS: [u32; 8] = [76, 77, 78, 79, 80, 81, 114, 116];
const EMF_PLUS_HEADER: u16 = 0x4001;
const EMF_PLUS_FILL_PATH: u16 = 0x4014;

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("four bytes"))
}

fn i32_at(bytes: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("four bytes"))
}

/// What an EMF holds, read the way a player walks it.
struct EmfSummary {
    /// rclFrame's right and bottom, in hundredths of a millimetre
    frame: (i32, i32),
    /// the first EMF+ record is a header that says Dual
    dual: bool,
    fills: usize,
}

fn read_emf(emf: &[u8]) -> Result<EmfSummary, String> {
    if u32_at(emf, 0) != EMR_HEADER || u32_at(emf, 40) != 0x464D_4520 {
        return Err("no EMF header".into());
    }
    if u32_at(emf, 48) as usize != emf.len() {
        return Err(format!(
            "nBytes {} for {} bytes",
            u32_at(emf, 48),
            emf.len()
        ));
    }
    let frame = (i32_at(emf, 32), i32_at(emf, 36));
    let (mut offset, mut count, mut last, mut dual, mut fills, mut first_plus) =
        (0, 0, 0, false, 0, true);
    while offset < emf.len() {
        let (kind, size) = (u32_at(emf, offset), u32_at(emf, offset + 4) as usize);
        if size < 8 || size % 4 != 0 || offset + size > emf.len() {
            return Err(format!("record {kind} at {offset} has size {size}"));
        }
        if BITMAP_RECORDS.contains(&kind) {
            return Err(format!("bitmap record {kind}"));
        }
        if kind == EMR_GDICOMMENT && &emf[offset + 12..offset + 16] == b"EMF+" {
            let data = &emf[offset + 16..offset + 12 + u32_at(emf, offset + 8) as usize];
            let mut at = 0;
            while at < data.len() {
                let plus = u16::from_le_bytes([data[at], data[at + 1]]);
                let flags = u16::from_le_bytes([data[at + 2], data[at + 3]]);
                if first_plus {
                    dual = plus == EMF_PLUS_HEADER && flags & 1 == 1;
                    first_plus = false;
                }
                if plus == EMF_PLUS_FILL_PATH {
                    fills += 1;
                }
                at += u32_at(data, at + 4) as usize;
            }
        }
        last = kind;
        count += 1;
        offset += size;
    }
    if count != u32_at(emf, 52) {
        return Err(format!("nRecords {} for {count} records", u32_at(emf, 52)));
    }
    if last != EMR_EOF {
        return Err("the last record is not EMR_EOF".into());
    }
    Ok(EmfSummary { frame, dual, fills })
}

/// The shapes a picture draws: glyphs (`<use>`, or `<path>` outside the definitions) and rules (`<rect>`).
fn shapes(body: &str) -> usize {
    let drawn = body.split_once("</defs>").map_or(body, |(_, drawn)| drawn);
    drawn.matches("<use ").count()
        + drawn.matches("<path ").count()
        + drawn.matches("<rect ").count()
}

fn document(row: &Value) -> (String, f32, f32, f32) {
    let number = |key: &str| row[key].as_f64().expect("a number");
    let (left, right, ascent, descent) = (
        number("left"),
        number("right"),
        number("ascent"),
        number("descent"),
    );
    let svg = svg_document(
        row["body"].as_str().expect("a body"),
        left,
        right,
        ascent,
        descent,
    );
    (
        svg,
        (left + right) as f32,
        (ascent + descent) as f32,
        ascent as f32,
    )
}

fn check(
    name: &str,
    previews: &Previews,
    width: f32,
    height: f32,
    baseline: f32,
    shapes: usize,
) -> Result<(), String> {
    if (previews.width, previews.height, previews.baseline) != (width, height, baseline) {
        return Err(format!(
            "{name}: geometry {} x {} baseline {}",
            previews.width, previews.height, previews.baseline
        ));
    }
    let emf = read_emf(&previews.emf).map_err(|error| format!("{name}: {error}"))?;
    let frame = (
        (width * 2540.0 / 96.0).round() as i32 - 1,
        (height * 2540.0 / 96.0).round() as i32 - 1,
    );
    if emf.frame != frame || !emf.dual || emf.fills != shapes {
        return Err(format!(
            "{name}: frame {:?} (want {frame:?}), dual {}, {} fills for {shapes} shapes",
            emf.frame, emf.dual, emf.fills
        ));
    }
    let png = Pixmap::decode_png(&previews.png).map_err(|error| format!("{name}: PNG {error}"))?;
    let size = ((width * 2.0).ceil() as u32, (height * 2.0).ceil() as u32);
    if (png.width(), png.height()) != size || png.pixels().iter().all(|pixel| pixel.alpha() == 0) {
        return Err(format!(
            "{name}: PNG {} x {} (want {size:?}) or empty",
            png.width(),
            png.height()
        ));
    }
    Ok(())
}

fn check_corpus(file: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testing/corpus/tex-layout")
        .join(file);
    let text = std::fs::read_to_string(path).expect("the corpus is readable");
    let mut failures = Vec::new();
    let mut checked = 0;
    for line in text.lines() {
        let row: Value = serde_json::from_str(line).expect("a corpus row is JSON");
        if row.get("error").is_some() {
            continue; // a formula the engine refuses has no picture
        }
        let name = row["file"]
            .as_str()
            .or(row["source"].as_str())
            .expect("a row names its formula");
        let (svg, width, height, baseline) = document(&row);
        checked += 1;
        let result = PICTURES.previews(&svg, baseline).and_then(|previews| {
            check(
                name,
                &previews,
                width,
                height,
                baseline,
                shapes(row["body"].as_str().expect("a body")),
            )
        });
        if let Err(error) = result {
            failures.push(error);
        }
    }
    assert!(checked > 50, "only {checked} rows");
    assert!(
        failures.is_empty(),
        "{} of {checked} fail:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn every_computer_modern_picture_makes_valid_previews() {
    check_corpus("svg-cm.jsonl");
}

#[test]
fn every_times_picture_makes_valid_previews() {
    check_corpus("svg-ntx.jsonl");
}

#[test]
fn every_chemistry_picture_makes_valid_previews() {
    check_corpus("svg-mhchem.jsonl");
}

#[test]
fn text_reaching_beyond_the_box_grows_the_previews() {
    // a 10 x 10 box whose text, drawn from an installed font (Times New Roman: Windows and macOS have it), is far wider
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\" viewBox=\"0 -8 10 10\">\
               <text x=\"0\" y=\"0\" font-family=\"Times New Roman\" font-size=\"16\">Formula</text></svg>";
    let previews = PICTURES.previews(svg, 8.0).expect("previews");
    assert!(previews.width > 30.0, "width {}", previews.width);
    assert!(previews.baseline >= 8.0 && previews.baseline < previews.height);
    let emf = read_emf(&previews.emf).expect("a valid EMF");
    assert!(emf.dual && emf.fills == 1);
}

#[test]
fn an_svg_with_an_image_is_refused() {
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\">\
               <rect width=\"5\" height=\"5\"/><image width=\"10\" height=\"10\" href=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==\"/></svg>";
    assert_eq!(
        PICTURES.previews(svg, 8.0).err().as_deref(),
        Some("The formula SVG contains an image.")
    );
}
