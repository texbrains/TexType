//! A glyph's hinted outline at a pixel size as TexType's picture engine hints it (black-and-white target), in
//! pixels (y up), for comparing with Windows' GGO_NATIVE outline (TexType target/gdi-outline.ps1).
//!   cargo run -p convert --example glyph_outline -- <font file> <hex code> [ppem]

use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::*;
use skrifa::{HintOptions, RasterTarget, ScalerFont};

struct Print;

impl OutlinePen for Print {
    fn move_to(&mut self, x: f32, y: f32) {
        println!("contour start {x} {y}");
    }
    fn line_to(&mut self, x: f32, y: f32) {
        println!("  line ({x},{y})");
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        println!("  quad ({cx},{cy}) ({x},{y})");
    }
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, x: f32, y: f32) {
        println!("  cubic .. ({x},{y})");
    }
    fn close(&mut self) {}
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = std::fs::read(&args[0]).expect("font file");
    let code = u32::from_str_radix(&args[1], 16).unwrap();
    let ppem: f32 = args.get(2).map_or(64.0, |p| p.parse().unwrap());
    let font = FontRef::new(&data).expect("font");
    let glyph = font.charmap().map(code).expect("mapped");
    let scaler = ScalerFont::hinted(
        skrifa::Font::new(data.clone(), 0).expect("font"),
        ppem,
        HintOptions::interpreter().with_target(RasterTarget::Mono),
    );
    let _ = DrawSettings::unhinted(Size::new(ppem), LocationRef::default());
    let drawn = scaler
        .outline(glyph)
        .expect("outline")
        .draw(skrifa::DrawMemory::Scratch, &mut Print)
        .expect("drawn");
    println!("advance {:?}", drawn.h_advance);
}
