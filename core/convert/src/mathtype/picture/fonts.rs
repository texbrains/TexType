//! The fonts a MathType picture names, measured as MathType measures them: each glyph at 64 pixels per em, hinted
//! for black-and-white text, its advance and the box of the pixels it covers. On Windows Windows' own rasterizer
//! measures it (`gdi`: MathType measures there, and Windows hints some glyphs a pixel apart from other
//! interpreters, owner's decision 2026-11-26); elsewhere the font's own TrueType programs run here and the outline
//! is rasterized without smoothing (`raster`). A size in picture units scales those (`Measure::scaled`). Found by
//! comparing with MathType 6.9's own pictures (testing/corpus/mathtype/pictures.jsonl).
//!
//! A character a font lacks is measured as Windows draws it: from the first font of the font's link list
//! (Windows' SystemLink, mathtype/font_links.txt) that has it, scaled by the two fonts' text heights (SimSun's ∬
//! from Yu Gothic UI at 384/510 of its size).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use resvg::usvg::fontdb;
use skrifa::instance::{LocationRef, Size};
use skrifa::{FontRef, MetadataProvider};

#[cfg(windows)]
mod gdi;
#[cfg(not(windows))]
mod raster;
#[cfg(windows)]
use gdi as glyphs;
#[cfg(not(windows))]
use raster as glyphs;

/// The pixels per em MathType measures every font at.
pub(super) const PPEM: i32 = 64;

/// A font as a picture names it: its name and the bold and italic it is asked for.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Face {
    pub name: String,
    pub bold: bool,
    pub italic: bool,
}

/// A character in a face: a Unicode character, or a byte of a symbol font (its glyphs mapped at U+F000 + byte).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Code {
    Unicode(char),
    Symbol(u8),
}

/// One glyph's hinted measures at 64 ppem, in pixels: the advance, the inked box (y up from the baseline) and per
/// inked pixel row (from its bottom edge y) the inked span (left, right edges).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Measure {
    pub advance: i32,
    pub left: i32,
    pub right: i32,
    pub top: i32,
    pub bottom: i32,
    pub rows: Arc<Vec<(i32, i32, i32)>>,
    /// drawn from a linked font: the font the picture names lacks the glyph
    pub linked: bool,
    /// the top of the glyph's outline as the font defines it, unhinted, in 4096ths of an em (0: unknown)
    pub outline_top: i32,
}

impl Measure {
    /// A 64 ppem measure in picture units at a font height: scaled and rounded toward zero, as MathType does (a
    /// pixel below the baseline at 7 pt is 3 units, not 4: probe-pc/fixed-sup-*, sb-*-size-10).
    pub(super) fn scaled(value: i32, height: i32) -> i32 {
        (i64::from(value) * i64::from(height) / i64::from(PPEM)) as i32
    }

    /// The measure of the glyph drawn at a share of the size (a linked font's), in pixels rounded.
    fn shrunk(&self, share: f64) -> Measure {
        let s = |v: i32| (f64::from(v) * share).round() as i32;
        Measure {
            advance: s(self.advance),
            left: s(self.left),
            right: s(self.right),
            top: s(self.top),
            bottom: s(self.bottom),
            rows: Arc::new(
                self.rows
                    .iter()
                    .map(|&(y, l, r)| (s(y), s(l), s(r)))
                    .collect(),
            ),
            linked: true,
            outline_top: 0,
        }
    }
}

/// The fonts Windows links to a font for the characters it lacks, in order, each with the scale its entry adds.
fn links(name: &str) -> Vec<(String, f64)> {
    include_str!("../font_links.txt")
        .lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.split_once(": "))
        .filter(|(font, _)| *font == name)
        .flat_map(|(_, list)| list.split(", "))
        .map(|entry| match entry.rsplit_once(' ') {
            Some((font, ratio)) if ratio.contains('/') => {
                let (a, b) = ratio.split_once('/').unwrap_or(("1", "1"));
                let value = |v: &str| v.parse::<f64>().unwrap_or(1.0);
                (font.to_string(), value(a) / value(b))
            }
            _ => (entry.to_string(), 1.0),
        })
        .collect()
}

/// The installed fonts and the measures taken so far.
pub struct Fonts {
    db: fontdb::Database,
    faces: Mutex<HashMap<Face, Option<Arc<Loaded>>>>,
    measures: Mutex<HashMap<(Face, Code), Option<Measure>>>,
    /// measures of glyphs stretched one way, by their pixels per em and font width
    stretched: Mutex<HashMap<Stretched, Option<Measure>>>,
}

/// A glyph stretched one way: its face, character, pixels per em and font width.
type Stretched = (Face, Code, i32, i32);

struct Loaded {
    /// the font file's data and the face's index in it
    data: Arc<Vec<u8>>,
    index: u32,
    /// the outlines hinted here
    #[cfg(not(windows))]
    outlines: raster::Outlines,
    /// Windows' descent as a share of the em
    descent: f64,
    /// Windows' text height (ascent and descent) as a share of the em
    text_height: f64,
    /// the typographic ascender as a share of the em
    typo_ascender: f64,
    /// the average character width (OS/2) as a share of the em
    average: f64,
    /// an italic asked of a font without an italic face: Windows slants the upright glyphs
    synthetic_italic: bool,
    /// the font's slant (the tangent of its italic angle, positive leaning right)
    slant: f64,
}

impl Fonts {
    /// The fonts installed on this computer.
    pub fn system() -> Fonts {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        Fonts {
            db,
            faces: Mutex::default(),
            measures: Mutex::default(),
            stretched: Mutex::default(),
        }
    }

    /// A symbol font's glyph as MathType measures it stretched only vertically: at `ppem` pixels per em with the font
    /// width `width` in pixels (the font it names at the scale that makes the size 64 pixels per em), by the pixels
    /// actually inked (a box row or column the bitmap leaves empty does not count: Symbol's ( and ) at 132-146 ppem).
    pub(super) fn measure_stretched(
        &self,
        face: &Face,
        byte: u8,
        ppem: i32,
        width: i32,
    ) -> Option<Measure> {
        let key = (face.clone(), Code::Symbol(byte), ppem, width);
        if let Some(known) = self.stretched.lock().unwrap().get(&key) {
            return known.clone();
        }
        let measure = self
            .loaded(face)
            .and_then(|l| glyphs::measure_at(face, &l, Code::Symbol(byte), ppem, width));
        self.stretched.lock().unwrap().insert(key, measure.clone());
        measure
    }

    /// A character's measure in a face, or None when the face is not installed or has no glyph for it.
    pub(super) fn measure(&self, face: &Face, code: Code) -> Option<Measure> {
        let key = (face.clone(), code);
        if let Some(known) = self.measures.lock().unwrap().get(&key) {
            return known.clone();
        }
        let loaded = self.loaded(face);
        let measure = loaded
            .as_ref()
            .and_then(|l| {
                let mut m = glyphs::measure(face, l, code)?;
                if !m.linked {
                    m.outline_top = outline_top(l, code).unwrap_or(0);
                }
                Some(m)
            })
            .or_else(|| {
                // a character the font lacks (away from Windows, whose own linking `gdi` measures): from its first
                // linked font that has it, scaled to the font's height
                let base = loaded.as_ref()?;
                let Code::Unicode(_) = code else { return None };
                links(&face.name).into_iter().find_map(|(name, ratio)| {
                    let other = Face {
                        name,
                        ..face.clone()
                    };
                    let linked = self.loaded(&other)?;
                    let found = glyphs::measure(&other, &linked, code)?;
                    Some(found.shrunk(base.text_height / linked.text_height * ratio))
                })
            });
        self.measures.lock().unwrap().insert(key, measure.clone());
        measure
    }

    /// A character's inked pixel box at 64 ppem (left, right, top, bottom, y up) and advance, for comparing with
    /// Windows' own measures: a byte of a symbol font when `symbol`, else a Unicode character.
    pub fn ink_box(
        &self,
        face: &Face,
        symbol: bool,
        code: u32,
    ) -> Option<(i32, i32, i32, i32, i32)> {
        let code = if symbol {
            Code::Symbol(u8::try_from(code).ok()?)
        } else {
            Code::Unicode(char::from_u32(code)?)
        };
        self.measure(face, code)
            .map(|m| (m.left, m.right, m.top, m.bottom, m.advance))
    }

    /// A character's inked pixel rows at 64 ppem (bottom edge y up, left, right), for comparing with MathType's
    /// placements.
    pub fn ink_rows(&self, face: &Face, symbol: bool, code: u32) -> Vec<(i32, i32, i32)> {
        let code = if symbol {
            u8::try_from(code).ok().map(Code::Symbol)
        } else {
            char::from_u32(code).map(Code::Unicode)
        };
        code.and_then(|code| self.measure(face, code))
            .map(|m| m.rows.to_vec())
            .unwrap_or_default()
    }

    /// Whether a face is drawn from another face's glyphs: an italic asked of a font without one (Windows slants
    /// the upright glyphs).
    pub(super) fn synthetic_italic(&self, face: &Face) -> bool {
        self.loaded(face)
            .is_some_and(|loaded| loaded.synthetic_italic)
    }

    /// A face's slant: the tangent of its italic angle (0 for an upright face or a synthesized italic).
    pub(super) fn slant(&self, face: &Face) -> f64 {
        self.loaded(face).map_or(0.0, |loaded| loaded.slant)
    }

    /// A face's em ascent at a size in picture units, the height MathType gives a line (a template's slot, a
    /// matrix row, the top its picture comment names): at 64 ppem the em less Windows' descent rounded and one
    /// pixel (Times New Roman 64 - 14 - 1 = 49 pixels, 294 units at 12 pt), scaled to the size and rounded down.
    pub(super) fn em_ascent(&self, face: &Face, size: i32) -> Option<i32> {
        self.loaded(face).map(|loaded| {
            let pixels = PPEM - (loaded.descent * f64::from(PPEM)).round() as i32 - 1;
            // a font whose typographic ascender reaches higher (Cambria's 0.778 em) has that height
            let typo = (loaded.typo_ascender * f64::from(PPEM)).round() as i32;
            Measure::scaled(pixels.max(typo), size)
        })
    }

    /// A face's em descent at a size in picture units: Windows' descent at 64 ppem rounded, scaled.
    pub(super) fn em_descent(&self, face: &Face, size: i32) -> Option<i32> {
        self.loaded(face)
            .map(|loaded| Measure::scaled((loaded.descent * f64::from(PPEM)).round() as i32, size))
    }

    /// A face's average character width as Windows gives it for a font of one point in picture units (32 ppem:
    /// Symbol 19, MT Extra 22), times the size in points: the width MathType names a glyph stretched only one way
    /// at (probe-pc/fs-*, fw-*: 227 for Symbol at 12 pt, 683 at 36 pt, 1367 at 72 pt, one less after its rounding).
    pub(super) fn average_width(&self, face: &Face, size: i32) -> Option<i32> {
        const ONE_POINT: i32 = 32;
        self.loaded(face)
            .map(|loaded| (loaded.average * f64::from(ONE_POINT)).round() as i32 * size / ONE_POINT)
    }

    /// The font width MathType measures a glyph stretched only vertically at: the face's average character width
    /// (OS/2) at 64 ppem rounded down, in pixels (Symbol 38, MT Extra 43: probe-pc/fs-white-*, fs2-*).
    pub(super) fn measuring_width(&self, face: &Face) -> Option<i32> {
        self.loaded(face)
            .map(|loaded| (loaded.average * f64::from(PPEM)).floor() as i32)
    }

    fn loaded(&self, face: &Face) -> Option<Arc<Loaded>> {
        if let Some(known) = self.faces.lock().unwrap().get(face) {
            return known.clone();
        }
        let loaded = self.load(face).map(Arc::new);
        self.faces
            .lock()
            .unwrap()
            .insert(face.clone(), loaded.clone());
        loaded
    }

    fn load(&self, face: &Face) -> Option<Loaded> {
        let id = self.db.query(&fontdb::Query {
            families: &[fontdb::Family::Name(&face.name)],
            weight: if face.bold {
                fontdb::Weight::BOLD
            } else {
                fontdb::Weight::NORMAL
            },
            style: if face.italic {
                fontdb::Style::Italic
            } else {
                fontdb::Style::Normal
            },
            stretch: fontdb::Stretch::Normal,
        })?;
        let (data, index) = self
            .db
            .with_face_data(id, |data, index| (Arc::new(data.to_vec()), index))?;
        let font = FontRef::from_index(&data, index).ok()?;
        use skrifa::raw::TableProvider;
        let upem = f64::from(
            font.metrics(Size::unscaled(), LocationRef::default())
                .units_per_em,
        );
        let descent = font
            .os2()
            .map(|os2| f64::from(os2.us_win_descent()) / upem)
            .unwrap_or(0.0);
        let text_height = font
            .os2()
            .map(|os2| f64::from(os2.us_win_ascent() + os2.us_win_descent()) / upem)
            .unwrap_or(1.0);
        let typo_ascender = font
            .os2()
            .map(|os2| f64::from(os2.s_typo_ascender()) / upem)
            .unwrap_or(0.0);
        let average = font
            .os2()
            .map(|os2| f64::from(os2.x_avg_char_width()) / upem)
            .unwrap_or(0.5);
        let upright = self
            .db
            .face(id)
            .is_some_and(|f| f.style == fontdb::Style::Normal);
        let slant = font
            .post()
            .map(|post| -post.italic_angle().to_f64().to_radians().tan())
            .unwrap_or(0.0);
        Some(Loaded {
            #[cfg(not(windows))]
            outlines: raster::Outlines::new(data.clone(), index)?,
            data,
            index,
            descent,
            text_height,
            typo_ascender,
            average,
            synthetic_italic: face.italic && upright,
            slant,
        })
    }
}

/// The top of a character's outline in a face, unhinted, in 4096ths of an em.
fn outline_top(loaded: &Loaded, code: Code) -> Option<i32> {
    let font = FontRef::from_index(&loaded.data, loaded.index).ok()?;
    let charmap = font.charmap();
    let glyph = match code {
        Code::Unicode(c) => charmap.map(c)?,
        Code::Symbol(byte) => charmap
            .map(0xF000 + u32::from(byte))
            .or_else(|| charmap.map(u32::from(byte)))?,
    };
    let upem = f64::from(
        font.metrics(Size::unscaled(), LocationRef::default())
            .units_per_em,
    );
    let bounds = font
        .glyph_metrics(Size::unscaled(), LocationRef::default())
        .bounds(glyph)?;
    Some((f64::from(bounds.y_max) * 4096.0 / upem).round() as i32)
}
