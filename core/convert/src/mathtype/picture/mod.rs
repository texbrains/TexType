//! The picture Word shows for a MathType equation, drawn as MathType draws it (requirement C2: the same glyphs). Word
//! does not read the equation data: it shows the picture stored with the object, which MathType redraws when a user
//! edits the equation. TexType draws it itself, never with MathType (C6), and MathType 6.9's own pictures are the
//! reference (testing/corpus/mathtype/pictures.jsonl, core/convert/tests/mathtype_picture.rs): the same texts in
//! the same fonts and sizes, positions within a pixel at 100 % (24 units), the same picture size.
//! - `fonts`: the fonts measured as MathType measures them (hinted at 64 pixels per em);
//! - `layout`: the equation's records placed as MathType places them;
//! - `wmf`: the picture as a placeable Windows metafile, recorded as MathType records it.

mod fonts;
mod layout;
mod wmf;

pub use fonts::{Face, Fonts};
pub use wmf::wmf;

use super::mtef::Mtef;

/// Picture units per inch (as MathType's pictures): 32 per point.
pub const UNITS_PER_INCH: i32 = 2304;

/// A drawn equation: its size and what it draws, in picture units (y down from the top).
#[derive(Clone, Debug, PartialEq)]
pub struct Picture {
    pub width: i32,
    pub height: i32,
    /// the equation's baseline, down from the top
    pub baseline: i32,
    pub texts: Vec<Text>,
    pub lines: Vec<Rule>,
    /// filled shapes (a root's thick stroke)
    pub polygons: Vec<Vec<(i32, i32)>>,
    /// curves (a long division's)
    pub arcs: Vec<Arc>,
}

/// A curve as GDI's Arc draws it: part of the ellipse inside a box (left, top, right, bottom), counter-clockwise
/// from where the ray from its centre to `start` meets it to where the ray to `end` does, with a pen of a width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Arc {
    pub rect: (i32, i32, i32, i32),
    pub start: (i32, i32),
    pub end: (i32, i32),
    pub width: i32,
}

/// A straight line drawn with a pen of a width (fraction bars ...).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rule {
    pub from: (i32, i32),
    pub to: (i32, i32),
    pub width: i32,
}

/// A run of characters in one font on one baseline: its origin, the font, the bytes drawn and each one's advance.
#[derive(Clone, Debug, PartialEq)]
pub struct Text {
    pub x: i32,
    pub y: i32,
    pub face: Face,
    /// the font's character height (its em) in picture units
    pub height: i32,
    /// the font's average character width when set (a fence stretched only vertically), 0 for the font's own
    pub width: i32,
    /// the Windows character set the bytes are in
    pub charset: u8,
    pub bytes: Vec<u8>,
    pub advances: Vec<i32>,
}

/// The equation's picture; an error names what it holds that the engine does not draw yet, or a font that is not
/// installed.
pub fn draw(mtef: &Mtef, fonts: &Fonts) -> Result<Picture, String> {
    layout::draw(mtef, fonts)
}
