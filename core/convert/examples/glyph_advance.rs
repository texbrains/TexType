//! A glyph's advances at 64 ppem from a font file: linear (unhinted, rounded), hinted (TrueType programs) and its
//! LTSH entry (the size from which Windows scales it linearly) and hdmx width, for comparing with MathType's.
//!   cargo run -p convert --example glyph_advance -- <font file> <hex code>...

use skrifa::instance::{LocationRef, Size};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, HintOptions, MetadataProvider, RasterTarget, ScalerFont};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = std::fs::read(&args[0]).expect("font file");
    let font = FontRef::new(&data).expect("font");
    let upem = f32::from(font.head().expect("head").units_per_em());
    let scaler = ScalerFont::hinted(
        skrifa::Font::new(data.clone(), 0).expect("font"),
        64.0,
        HintOptions::interpreter().with_target(RasterTarget::Mono),
    );
    let ltsh = font.table_data(skrifa::Tag::new(b"LTSH"));
    let hdmx = font.table_data(skrifa::Tag::new(b"hdmx"));
    println!("LTSH {} hdmx {}", ltsh.is_some(), hdmx.is_some());
    for hex in &args[1..] {
        let code = u32::from_str_radix(hex, 16).unwrap();
        let glyph = font.charmap().map(code).expect("mapped");
        let unscaled = font
            .glyph_metrics(Size::unscaled(), LocationRef::default())
            .advance_width(glyph)
            .unwrap_or(0.0);
        let hinted = scaler
            .outline(glyph)
            .and_then(|o| o.draw(skrifa::DrawMemory::Scratch, &mut NoPen).ok())
            .and_then(|d| d.h_advance);
        let lt = ltsh
            .as_ref()
            .and_then(|d| d.as_bytes().get(4 + glyph.to_u32() as usize).copied());
        println!(
            "{hex}: linear {:.2} px hinted {:?} ltsh {:?}",
            unscaled * 64.0 / upem,
            hinted,
            lt
        );
    }
}

struct NoPen;
impl skrifa::PathSink for NoPen {
    fn move_to(&mut self, _: f32, _: f32) {}
    fn line_to(&mut self, _: f32, _: f32) {}
    fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) {}
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {}
    fn close(&mut self) {}
}
