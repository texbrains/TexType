//! Glyph measures away from Windows: the font's own TrueType programs hint each glyph at 64 ppem for a
//! black-and-white raster, and its outline is rasterized without smoothing (a pixel inked when its centre is inside
//! the outline, with the dropout control the glyph asks for).

use std::sync::Arc;

use resvg::tiny_skia;
use skrifa::instance::{LocationRef, Size};
use skrifa::{
    DrawMemory, DropoutControl, FontRef, HintOptions, MetadataProvider, PathSink, RasterTarget,
    ScalerFont,
};

use super::{Code, Face, Loaded, Measure, PPEM};

/// Windows draws an italic asked of a font without one (Symbol: MathType's lower-case Greek) by moving each pixel
/// row of the upright glyph right by this much of its height, rounded (fitted to GetGlyphOutline's boxes: 120 of
/// Symbol's 187 glyphs exactly, the others within a pixel).
const SYNTHETIC_SLANT: f32 = 0.35;

/// A font's data and its outlines hinted at 64 ppem by its own TrueType programs for a black-and-white raster.
pub(super) struct Outlines {
    data: Arc<Vec<u8>>,
    index: u32,
    scaler: ScalerFont,
}

impl Outlines {
    /// None for a font without TrueType hinting.
    pub(super) fn new(data: Arc<Vec<u8>>, index: u32) -> Option<Outlines> {
        let scaler = ScalerFont::hinted(
            skrifa::Font::new(data.to_vec(), index)?,
            PPEM as f32,
            HintOptions::interpreter().with_target(RasterTarget::Mono),
        );
        scaler.is_hinted().then_some(Outlines {
            data,
            index,
            scaler,
        })
    }
}

/// A character's measure in a loaded face.
pub(super) fn measure(_face: &Face, loaded: &Loaded, code: Code) -> Option<Measure> {
    measure_with(loaded, &loaded.outlines.scaler, code, PPEM, 1.0)
}

/// A character's measure at a size in pixels per em and a font width in pixels: hinted at that size and narrowed
/// to the width afterwards (Windows hints a narrowed font as such; this is the nearest the font's own programs give).
pub(super) fn measure_at(
    _face: &Face,
    loaded: &Loaded,
    code: Code,
    ppem: i32,
    width: i32,
) -> Option<Measure> {
    let outlines = &loaded.outlines;
    let scaler = ScalerFont::hinted(
        skrifa::Font::new(outlines.data.to_vec(), outlines.index)?,
        ppem as f32,
        HintOptions::interpreter().with_target(RasterTarget::Mono),
    );
    let narrow = if width > 0 {
        width as f32 / (loaded.average as f32 * ppem as f32)
    } else {
        1.0
    };
    measure_with(loaded, &scaler, code, ppem, narrow)
}

fn measure_with(
    loaded: &Loaded,
    scaler: &ScalerFont,
    code: Code,
    ppem: i32,
    narrow: f32,
) -> Option<Measure> {
    let outlines = &loaded.outlines;
    let font = FontRef::from_index(&outlines.data, outlines.index).ok()?;
    let charmap = font.charmap();
    let glyph = match code {
        Code::Unicode(c) => charmap.map(c)?,
        // a symbol font's byte through its symbol map (as Windows draws the default character set), which a font
        // with a Unicode map too keeps apart from it; a byte the font lacks draws its missing-glyph shape (glyph 0:
        // Windows has no other font for a symbol font's bytes)
        Code::Symbol(byte) => symbol_map(&font, byte)
            .or_else(|| charmap.map(0xF000 + u32::from(byte)))
            .or_else(|| charmap.map(u32::from(byte)))
            .unwrap_or(skrifa::GlyphId::NOTDEF),
    };
    let mut path = PathPen {
        builder: tiny_skia::PathBuilder::default(),
        slant: if loaded.synthetic_italic {
            SYNTHETIC_SLANT
        } else {
            0.0
        },
        narrow,
    };
    let drawn = scaler
        .outline(glyph)?
        .draw(DrawMemory::Scratch, &mut path)
        .ok()?;
    let linear = || {
        let upem = f32::from(
            font.metrics(Size::unscaled(), LocationRef::default())
                .units_per_em,
        );
        let unscaled = font
            .glyph_metrics(Size::unscaled(), LocationRef::default())
            .advance_width(glyph)?;
        Some((unscaled * ppem as f32 * narrow / upem).round() as i32)
    };
    // where the font's LTSH table says the glyph scales linearly at this size, Windows takes the scaled advance,
    // not the hinted one (Times New Roman italic c y: 28 pixels, hinted 29)
    let advance = if linear_threshold(&font, glyph).is_some_and(|from| i32::from(from) <= ppem) {
        linear()?
    } else {
        drawn
            .h_advance
            .map(|a| (a * narrow).round() as i32)
            .or_else(linear)?
    };
    // the pixels inked, with the dropout control the glyph's programs ask for: compared with MathType, the
    // outline's exact extent fits worse
    let rows = path.covered(drawn.dropout_control);
    let left = rows.iter().map(|r| r.1).min().unwrap_or(0);
    let right = rows.iter().map(|r| r.2).max().unwrap_or(0);
    let top = rows.iter().map(|r| r.0 + 1).max().unwrap_or(0);
    let bottom = rows.iter().map(|r| r.0).min().unwrap_or(0);
    Some(Measure {
        advance,
        left,
        right,
        top,
        bottom,
        rows: Arc::new(rows),
        linked: false,
        outline_top: 0,
    })
}

/// The size (pixels per em) from which a glyph's advance scales linearly, from the font's LTSH table (version,
/// glyph count, then one byte per glyph).
fn linear_threshold(font: &FontRef, glyph: skrifa::GlyphId) -> Option<u8> {
    let data = font.table_data(skrifa::Tag::new(b"LTSH"))?;
    let bytes = data.as_bytes();
    bytes.get(4 + glyph.to_u32() as usize).copied()
}

/// A byte's glyph in a font's Windows symbol character map (platform 3, encoding 0), at U+F000 + byte.
fn symbol_map(font: &FontRef, byte: u8) -> Option<skrifa::GlyphId> {
    use skrifa::raw::types::GlyphId;
    use skrifa::raw::TableProvider;
    let cmap = font.cmap().ok()?;
    let record = cmap.encoding_records().iter().find(|r| {
        r.platform_id() == skrifa::raw::tables::cmap::PlatformId::Windows && r.encoding_id() == 0
    })?;
    let subtable = record.subtable(cmap.offset_data()).ok()?;
    let found: Option<GlyphId> = subtable
        .map_codepoint(0xF000 + u32::from(byte))
        .or_else(|| subtable.map_codepoint(u32::from(byte)));
    found.filter(|g| g.to_u32() != 0)
}

/// The rasterized glyph's room: pixels around the origin (x from -ORIGIN_X, y up to ORIGIN_Y).
const RASTER: u32 = 512;
const ORIGIN_X: f32 = 192.0;
const ORIGIN_Y: f32 = 320.0;

/// A hinted outline as a path in raster pixels (y down), narrowed sideways by `narrow`; its pixel rows slanted to
/// the right by `slant`.
struct PathPen {
    builder: tiny_skia::PathBuilder,
    slant: f32,
    narrow: f32,
}

impl PathPen {
    /// The rows of pixels the outline covers (with a dropout control), each as its bottom edge (y up from the
    /// origin) and the inked span's left and right pixel edges.
    fn covered(self, dropout: DropoutControl) -> Vec<(i32, i32, i32)> {
        let Some(path) = self.builder.finish() else {
            return Vec::new();
        };
        let Some(mut pixmap) = tiny_skia::Pixmap::new(RASTER, RASTER) else {
            return Vec::new();
        };
        let mut paint = tiny_skia::Paint {
            anti_alias: false,
            ..tiny_skia::Paint::default()
        };
        paint.set_color_rgba8(0, 0, 0, 255);
        pixmap.fill_path(
            &path,
            &paint,
            tiny_skia::FillRule::Winding,
            tiny_skia::Transform::identity(),
            None,
        );
        if dropout.is_enabled() {
            dropouts(&path, &mut pixmap, dropout);
        }
        let (ox, oy) = (ORIGIN_X as i32, ORIGIN_Y as i32);
        let mut rows = Vec::new();
        for (y, row) in pixmap.pixels().chunks(RASTER as usize).enumerate() {
            let inked = |p: &&tiny_skia::PremultipliedColorU8| p.alpha() > 0;
            if let (Some(first), Some(last)) = (
                row.iter().position(|p| inked(&p)),
                row.iter().rposition(|p| inked(&p)),
            ) {
                let bottom = oy - (y as i32 + 1);
                // a synthesized italic: each pixel row moved right by the slant times its height, rounded
                let shift = (self.slant * bottom as f32).round() as i32;
                rows.push((
                    bottom,
                    first as i32 - ox + shift,
                    last as i32 + 1 - ox + shift,
                ));
            }
        }
        rows
    }

    fn at(&self, x: f32, y: f32) -> (f32, f32) {
        (x * self.narrow + ORIGIN_X, ORIGIN_Y - y)
    }
}

/// TrueType dropout control as Windows' black-and-white rasterizer applies it: along every pixel row and column
/// through pixel centres, a stretch of the outline's inside that holds no pixel centre (a thin stroke between
/// centres) still inks the pixel nearest its middle (Windows' choice for the simple and the smart rules alike); a
/// stub (a tip: no inside within a pixel of it on one neighbouring line) only when the glyph's programs ask for
/// stubs (SCANTYPE 0 or 4: MT Extra; Times New Roman and Symbol exclude them). Against MathType's pictures this
/// fits best, though Windows' own glyph boxes ink some tips the rule leaves out (Times New Roman italic).
fn dropouts(path: &tiny_skia::Path, pixmap: &mut tiny_skia::Pixmap, mode: DropoutControl) {
    let pieces = 16;
    // the outline as line segments (curves in 16 pieces)
    let mut segments: Vec<((f32, f32), (f32, f32))> = Vec::new();
    let (mut start, mut at) = ((0.0, 0.0), (0.0, 0.0));
    let push = |segments: &mut Vec<_>, from: (f32, f32), to: (f32, f32)| segments.push((from, to));
    for segment in path.segments() {
        use tiny_skia::PathSegment::*;
        match segment {
            MoveTo(p) => {
                start = (p.x, p.y);
                at = start;
            }
            LineTo(p) => {
                push(&mut segments, at, (p.x, p.y));
                at = (p.x, p.y);
            }
            QuadTo(c, p) => {
                let mut last = at;
                for i in 1..=pieces {
                    let t = i as f32 / pieces as f32;
                    let u = 1.0 - t;
                    let q = (
                        u * u * at.0 + 2.0 * u * t * c.x + t * t * p.x,
                        u * u * at.1 + 2.0 * u * t * c.y + t * t * p.y,
                    );
                    push(&mut segments, last, q);
                    last = q;
                }
                at = (p.x, p.y);
            }
            CubicTo(c0, c1, p) => {
                let mut last = at;
                for i in 1..=pieces {
                    let t = i as f32 / pieces as f32;
                    let u = 1.0 - t;
                    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                    let q = (
                        a * at.0 + b * c0.x + c * c1.x + d * p.x,
                        a * at.1 + b * c0.y + c * c1.y + d * p.y,
                    );
                    push(&mut segments, last, q);
                    last = q;
                }
                at = (p.x, p.y);
            }
            Close => {
                push(&mut segments, at, start);
                at = start;
            }
        }
    }
    let size = RASTER as usize;
    let black = tiny_skia::PremultipliedColorU8::from_rgba(0, 0, 0, 255).unwrap();
    // the inside's stretches along the line `across` = c + 0.5 (rows: y, columns: x), by nonzero winding
    let stretches = |c: usize, rows: bool| {
        let line = c as f32 + 0.5;
        let mut crossings: Vec<(f32, i32)> = segments
            .iter()
            .filter_map(|&(a, b)| {
                let (a_across, a_along, b_across, b_along) = if rows {
                    (a.1, a.0, b.1, b.0)
                } else {
                    (a.0, a.1, b.0, b.1)
                };
                if (a_across <= line) == (b_across <= line) {
                    return None;
                }
                let t = (line - a_across) / (b_across - a_across);
                Some((
                    a_along + t * (b_along - a_along),
                    if b_across > a_across { 1 } else { -1 },
                ))
            })
            .collect();
        crossings.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut out = Vec::new();
        let mut winding = 0;
        let mut from = 0.0;
        for (x, d) in crossings {
            let was = winding != 0;
            winding += d;
            if !was && winding != 0 {
                from = x;
            } else if was && winding == 0 {
                out.push((from, x));
            }
        }
        out
    };
    let mut set = Vec::new();
    for rows in [true, false] {
        let all: Vec<Vec<(f32, f32)>> = (0..size).map(|c| stretches(c, rows)).collect();
        let overlaps = |c: usize, a: f32, b: f32| all[c].iter().any(|&(x, y)| x < b && y > a);
        for (c, line) in all.iter().enumerate() {
            for &(a, b) in line {
                // a pixel centre (k + 0.5) inside: no dropout
                if (a - 0.5).ceil() <= (b - 0.5).floor() {
                    continue;
                }
                let stub = c == 0
                    || c + 1 == size
                    || !overlaps(c - 1, a - 1.0, b + 1.0)
                    || !overlaps(c + 1, a - 1.0, b + 1.0);
                if stub && !mode.includes_stubs() {
                    continue;
                }
                let pick = ((a + b) / 2.0).floor() as usize;
                if pick < size {
                    set.push(if rows {
                        c * size + pick
                    } else {
                        pick * size + c
                    });
                }
            }
        }
    }
    let pixels = pixmap.pixels_mut();
    for i in set {
        pixels[i] = black;
    }
}

impl PathSink for PathPen {
    fn move_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.at(x, y);
        self.builder.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.at(x, y);
        self.builder.line_to(x, y);
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let ((cx0, cy0), (x, y)) = (self.at(cx0, cy0), self.at(x, y));
        self.builder.quad_to(cx0, cy0, x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let ((cx0, cy0), (cx1, cy1), (x, y)) =
            (self.at(cx0, cy0), self.at(cx1, cy1), self.at(x, y));
        self.builder.cubic_to(cx0, cy0, cx1, cy1, x, y);
    }
    fn close(&mut self) {
        self.builder.close();
    }
}
