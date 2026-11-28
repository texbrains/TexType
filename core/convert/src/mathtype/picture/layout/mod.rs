//! An equation's records placed as MathType places them. Rules found in MathType 6.9's own pictures:
//! - a character's advance is its hinted advance at 64 ppem scaled to the size and rounded down (`fonts`);
//! - the picture's frame: the first ink 64 units (2 pt) from the left; the width the last ink plus 64, rounded up to
//!   a whole point (32 units); the baseline the highest ink plus 64 below the top, rounded up to a whole point; the
//!   height the baseline plus the lowest ink plus 64, rounded up to a whole point;
//! - sizes: the equation's size settings (full, script, second script, sign, script sign), in points or as a
//!   percentage of the full size (rounded down), and SIZE records (a type size and a delta);
//! - characters of one typeface follow each other by their advances, and so do letters of one font (a text-style
//!   d before an italic x), a period and its neighbours of its font, a prime and any neighbour; otherwise the next
//!   character is placed by ink: the plain gap (8 % of the em) between the inks, more around operators (binary 9/64,
//!   relations 13/64 em more), after punctuation and around a function name (7/64 em more), a function name's
//!   first letter taking those spaces even within one typeface; at the full size a gap with an operator's space is
//!   rounded up to a whole 3/8 pt: a binary operator's 14/64 em in all and a relation's 4/15 em (measured between
//!   17/64 and 17.14/64), both scaled by the operator spacing (setting 16, 0 % = 100 %), the 7/64 em class's
//!   (punctuation, function names, fractions, fences) 4/25 em (between 10/64 and 10.29/64; not scaled), measured from a pieced fence's ink, not its pixel past it; characters joined
//!   by advance (not operators) take the non-operator spacing (setting 18) between them;
//! - the minimum gap (setting 19): its share of the em rounded up to a whole 3/8 pt (12 units at every size, at
//!   least one step); MathType keeps it after scripts, before a prime, between a fraction's parts and its bar's
//!   edge, and between a limit's em box and the main part;
//! - texts: one font, size, character set and colour on a baseline; a text ends at 40 characters, after a space,
//!   in a text font after any character above 0x7F, and where a character of its font and size in another
//!   character set comes (`text_ended`, `picture`);
//! - advances: a glyph whose LTSH entry says it scales linearly at 64 ppem has the scaled advance (as Windows);
//! - scripts follow their base's own glyph ink by the script gap (spacing setting 5, of the base's size), a
//!   subscript tucked under an italic base's overhang; one rule raises and lowers them after a base, before one
//!   and beside a big operator's sign (`script_dy`): the superscript height (setting 3), the subscript depth
//!   (setting 4) and 3/32 pt of the full size (shrinking with the base's size), beside a base placed by its ink at
//!   least the limit height (setting 6) below its top, a subscript's math axis a tenth of the base's size above its
//!   bottom; the minimum gap beyond them ends their box (a prime's ink starts
//!   there, what follows a prime joins at its origin), and stands in for the plain gap after them (an operator's
//!   space still follows it); the frame keeps the base's em ascent over them (an empty superscript keeps no room);
//! - spaces (typeface 24): an invisible box their width wide reaching down the text font's descent (Windows')
//!   and up its x-height; next to a space no other spacing applies, the inks are the spaces' widths apart: in
//!   Times New Roman (whose space is a quarter em; in another text font by its space) thin (EF07, EF00) 6/64 em,
//!   EF02 12/64, medium (EF03) 14/64, thick (EF04) 18/64, em (EF05) 1 em, 2 em (EF06), EF09 and EF0A 2/64;
//!   1 pt (EF08), MathType 5's EB00-EB0A as measured; the zero space (EF01) is nothing;
//! - an empty line (an empty slot, an equation without a line): a box on the baseline the text font's em ascent
//!   high and half that wide;
//! - a line in a template's slot reaches up at least the font's em ascent (the em less Windows' descent and a
//!   pixel at 64 ppem: 294 units for Times New Roman at 12 pt; a font whose typographic ascender rounds to more
//!   pixels has that: 300 for Cambria), the text font's for its spaces;
//! - fractions: the bar (thickness setting 12) on the math axis (a quarter of the size up), as long as the wider
//!   part's ink and the overhang (setting 11, shrinking with the size) at both ends, both parts centred on it by
//!   ink; a fraction inside another template has the thinner bar (setting 13); the numerator's
//!   baseline the numerator height (setting 9) above the bar, the denominator's the denominator depth (setting 10)
//!   below it, each plus half the bar rounded up to 3/16 pt; a deeper numerator's ink and a
//!   taller denominator's top keep the minimum gap from the bar's edge;
//! - limits (template 23): the lower limit's baseline its size's limit depth (setting 7) below the main part's
//!   ink; the upper limit's em box on the main part's em ascent, its ink at least 5/64 em above it; each limit's
//!   em box at least the minimum gap (of its size) from the main part; all centred on one axis by ink;
//! - roots: the radical's bar thickness setting 28, its lower edge the enclosure padding (setting 20) over the
//!   radicand's line, a point past the radicand's ink; the radicand's ink setting 21 after the radical's top
//!   corner (230/384 em times the radical width, setting 22); the strokes constructed from that width, the
//!   thickness and the height (`radical`);
//! - fences (templates 0-9) centred on the math axis, reaching the content's em box and the over-extension
//!   (setting 15) more: ( [ { a Symbol glyph stretched only vertically (its font width the font's average
//!   width at the base size, `average_width`) to span that up to a limit per glyph (`fence_pieces`), measured at
//!   its own pixels per em (`fence_part`); bars and angles as lines (a single bar with half its pen of room on
//!   its right); the
//!   content's ink the fence gap (setting 29 of setting 17 of the size: 38/384 em) from each fence's inner ink
//!   edge; taller fences built from pieces (Symbol's; MT Extra's for white brackets);
//! - matrices: columns as wide as their widest cell, rows the row spacing apart or more; an odd number of rows
//!   with the middle row on the baseline, an even number centred on the axis; piles alike, a line's em top at
//!   least the line spacing's surplus over the size below the ink of the line before;
//! - fractions, limits and fence templates keep 7/64 em from their neighbours (more around operators);
//! - below the full size (scripts, limits) no class spacing: only the gap between inks;
//! - big operators (templates 21, 22): the sign at its size centred on the math axis (Symbol's sum and product
//!   by MathType's own box for them); limits (22) as in the limit template over the sign's ink or its outline's
//!   unhinted top, whichever is higher; scripts (21) as after any base placed by its ink, the script gap of the
//!   sign's size; the operand follows the operator's ink without a gap;
//! - overbars and underbars (templates 12, 13 and embellishments): the bar's middle the bar distance
//!   (`bar_distance`: the embellishment gap, 3/8 pt and a quarter of the bar thickness) from what it is over or
//!   under (the template's overbar from its line's top, the others from the ink).

use super::fonts::{Code, Face, Fonts, Measure, PPEM};
use super::{Arc, Picture, Rule, Text};
use crate::mathtype::mtef::{Char, EqnPrefs, Matrix, Mtef, Pile, Record, Size, Template};
use crate::mathtype::records::*;

mod arrows;
mod braces;
mod characters;
mod division;
mod edges;
mod embellish;
mod fractions;
mod gaps;
mod glyphs;
mod grid;
mod radical;
mod scripts;
mod settings;
mod structures;
mod texts;
mod wide;

use characters::*;
use edges::Edge;
use gaps::Gaps;
use settings::*;

/// Picture units per point.
const POINT: i32 = 32;
/// A relation's class space in 64ths of an em, as the integer spacing rules see it (`Gaps::between` takes the
/// measured 4/15 em gap instead).
const RELATION_SPACE: i32 = 13;
/// The plain gap in 64ths of an em as the class gaps count it (`plain_gap` gives it alone): between neighbouring
/// characters' inks, and between a structure's parts placed by ink (a label and its arrow, an accent or brace and
/// its content, a numerator and a slash, a limit and its main part, a big operator and its operand, prescripts and
/// their base).
const PLAIN_GAP: i32 = 5;

/// The plain gap at a size in picture units: 8 % of the em rounded down (5/64 em at 10-14 pt; a unit more at 18
/// and 24 pt, probe-pc/rel-paren-size-*). PLAIN_GAP is its 64ths for the class gaps it is part of.
fn plain_gap(size: i32) -> i32 {
    size * 8 / 100
}
/// The frame's margin around the ink.
const MARGIN: i32 = 2 * POINT;
/// The room wide accents and arrows over content leave and a slash fraction's gap, in 384ths of an em (no spacing
/// setting moves them; the fence gap's default)
const FENCE_GAP: i32 = 38;

pub(super) fn draw(mtef: &Mtef, fonts: &Fonts) -> Result<Picture, String> {
    let mut layout = Layout {
        fonts,
        font_defs: Vec::new(),
        style_defs: Vec::new(),
        prefs: None,
        size: 12 * POINT,
        depth: 0,
        in_fraction: 0,
        runs: 0,
        colour: 0,
    };
    let block = layout.line(&mtef.records)?;
    Ok(texts::picture(&block))
}

/// A FONT_DEF: the font's name and its encoding (3 Symbol, 4 MT Extra, 5 on: the ENCODING_DEFs).
struct FontDef {
    name: String,
    encoding: u16,
}

/// A placed glyph: its origin (x right, y up from the baseline of the block holding it), what it draws and its
/// measure.
#[derive(Clone)]
struct Glyph {
    x: i32,
    y: i32,
    face: Face,
    height: i32,
    charset: u8,
    byte: u8,
    measure: Measure,
    /// drawn as a text of its own (a fence at a scaled size)
    alone: bool,
    /// the size its horizontal measures are at (the height, or the base size of a fence stretched only vertically)
    /// and the font width that stretching sets (0: none)
    wide: i32,
    width: i32,
    /// the pixels per em its measure is at: 64, or a fence stretched only vertically its own (see `fence_part`),
    /// its measures then in units at its height per pixel per em, rounded toward zero, across as well
    ppem: i32,
    /// the box MathType assumes for the glyph instead of its ink (left, right, top, bottom from the origin; see
    /// `mathtype_box`)
    assumed: Option<(i32, i32, i32, i32)>,
    /// the text run it may join (0, or a struck-through content's own: MathType draws that as texts of its own)
    run: u32,
    /// its colour (a COLOR record's index): a text holds characters of one colour
    colour: u32,
    /// a double-byte character's second byte
    trail: Option<u8>,
    /// what a pile aligns at (relations, digits, the decimal point)
    role: Role,
    /// placed at the start of the line its structure is appended to, not with the structure (a long division's
    /// ")")
    line_start: bool,
}

/// What a glyph is to a pile aligning its lines at relations or decimal points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Other,
    Relation,
    Digit,
    Point,
}

impl Glyph {
    /// The inked box in block units: left, right, top, bottom (y up).
    fn ink(&self) -> (i32, i32, i32, i32) {
        if let Some((l, r, t, b)) = self.assumed {
            return (self.x + l, self.x + r, self.y + t, self.y + b);
        }
        if self.ppem != PPEM {
            let s = |v: i32| (i64::from(v) * i64::from(self.height) / i64::from(self.ppem)) as i32;
            let m = &self.measure;
            return (
                self.x + s(m.left),
                self.x + s(m.right),
                self.y + s(m.top),
                self.y + s(m.bottom),
            );
        }
        let s = |v: i32| Measure::scaled(v, self.height);
        let w = |v: i32| Measure::scaled(v, self.wide);
        (
            self.x + w(self.measure.left),
            self.x + w(self.measure.right),
            self.y + s(self.measure.top),
            self.y + s(self.measure.bottom),
        )
    }

    /// The em box of its font at a size (ascent; None when the face is not installed); a glyph MathType gives no
    /// room (`NO_ROOM`) has the em box of no font, three quarters of the size.
    fn em_ascent(&self, fonts: &Fonts, size: i32) -> Option<i32> {
        if self.assumed == Some(NO_ROOM) {
            return Some(size * 3 / 4);
        }
        // a stretched fence glyph counts by its ink alone
        if self.alone {
            return None;
        }
        // MathType's placeholder stands for a character: it keeps a text font's em box (probe-pc/ph-*)
        if is_placeholder(self) {
            let text = Face {
                name: "Times New Roman".into(),
                bold: false,
                italic: false,
            };
            return fonts.em_ascent(&text, size);
        }
        // MathType's own fonts (the Euclid fonts, MT Extra) count by their ink too: their declared descent of half an
        // em does not deepen a line (a matrix row holding a Euclid Symbol minus keeps the row spacing)
        if self.face.name.starts_with("Euclid") || self.face.name == "MT Extra" {
            return None;
        }
        fonts.em_ascent(&self.face, size)
    }
}

/// How cells sit in their column of a matrix or pile (by ink).
#[derive(Clone, Copy)]
enum Align {
    Left,
    Centre,
    Right,
    /// at the ink centre of each line's first relation (a line without one: its ink start)
    Relation,
    /// at each line's first decimal point (a number without one: after its digits; a line without a number: its
    /// ink start)
    Decimal,
}

/// The math axis at a size: a quarter of an em above the baseline (what fractions, fences, big operators, arrows
/// and matrices centre on).
fn axis(size: i32) -> i32 {
    size / 4
}

/// A line's inked box (left, right, top, bottom, y up): its ends and its pen's half across it. A slanted line's pen
/// reaches past its ends sideways only, by the pen's half across the line in proportion (not up or down).
fn rule_ink(l: &Rule) -> (i32, i32, i32, i32) {
    let half = l.width / 2;
    let (dx, dy) = (f64::from(l.to.0 - l.from.0), f64::from(l.to.1 - l.from.1));
    let (side, up) = if dx != 0.0 && dy != 0.0 {
        let f = f64::from(l.width) / 2.0 / dx.hypot(dy);
        ((f * dy.abs()).round() as i32, 0)
    } else if dx == 0.0 && dy != 0.0 {
        (half, 0)
    } else {
        (0, half)
    };
    (
        l.from.0.min(l.to.0) - side,
        l.from.0.max(l.to.0) + side,
        l.from.1.max(l.to.1) + up,
        l.from.1.min(l.to.1) - up,
    )
}

/// The ink box of a glyph MathType gives no room: a point at its origin (a fence-style brace over or under a
/// limit's content).
const NO_ROOM: (i32, i32, i32, i32) = (0, 0, 0, 0);

/// A circular or elliptic curve in block units (y up): its centre and radii, drawn counter-clockwise from the ray
/// to `start` to the ray to `end`, with a pen of a width.
#[derive(Clone, Copy)]
struct Bow {
    centre: (i32, i32),
    radius: (i32, i32),
    start: (i32, i32),
    end: (i32, i32),
    width: i32,
}

impl Bow {
    /// The box MathType's frame counts: the drawn part's extreme points, half the pen above and below them, none
    /// sideways (a long division's curve spans the bar's top edge and its mirror; the frame begins at the bar's
    /// start, which the pen passes).
    fn ink(&self) -> (i32, i32, i32, i32) {
        let angle =
            |p: (i32, i32)| f64::from(p.1 - self.centre.1).atan2(f64::from(p.0 - self.centre.0));
        let (from, mut to) = (angle(self.start), angle(self.end));
        if to < from {
            to += std::f64::consts::TAU;
        }
        let (mut l, mut r, mut t, mut b) = (i32::MAX, i32::MIN, i32::MIN, i32::MAX);
        for i in 0..=256 {
            let a = from + (to - from) * f64::from(i) / 256.0;
            let x = self.centre.0 + (f64::from(self.radius.0) * a.cos()).round() as i32;
            let y = self.centre.1 + (f64::from(self.radius.1) * a.sin()).round() as i32;
            (l, r, t, b) = (l.min(x), r.max(x), t.max(y), b.min(y));
        }
        let half = self.width / 2;
        (l, r, t + half, b - half)
    }
}

/// Laid-out content: its glyphs (x right, y up from its baseline) and its ends.
#[derive(Default)]
struct Block {
    glyphs: Vec<Glyph>,
    first: Option<Edge>,
    last: Option<Edge>,
    /// where the last element's glyphs and lines start
    last_from: usize,
    last_lines_from: usize,
    /// a height the block keeps above its baseline beyond its ink (a superscript's em top)
    reserved: Option<i32>,
    /// a depth the block keeps below its baseline beyond its ink (a matrix's last row)
    reserved_bottom: Option<i32>,
    /// a matrix's or pile's first row's baseline above the block's
    first_row: Option<i32>,
    /// the top scripts keep for their base's em ascent: it counts in the picture's frame, not in the top a
    /// structure over the line (an accent, a long division's bar) sees
    place: Option<i32>,
    /// lines (fraction bars ...), y up from the baseline
    lines: Vec<Rule>,
    /// boxes that count as ink without drawing anything (spaces): left, right, top, bottom
    boxes: Vec<(i32, i32, i32, i32)>,
    /// filled shapes, y up
    polygons: Vec<Vec<(i32, i32)>>,
    /// curves, y up
    bows: Vec<Bow>,
    /// a move left over for the next element (the zero space's)
    shift: i32,
    /// the height its spaces keep above its baseline in a template's slot (the text font's em ascent)
    space_top: Option<i32>,
}

impl Block {
    /// Its ink, reaching at least the heights it keeps above and below its baseline (`reserved`).
    fn ink(&self) -> Option<(i32, i32, i32, i32)> {
        let ink = self.drawn()?;
        Some((
            ink.0,
            ink.1,
            self.reserved.map_or(ink.2, |r| r.max(ink.2)),
            self.reserved_bottom.map_or(ink.3, |r| r.min(ink.3)),
        ))
    }

    /// What it draws: its glyphs' ink (or MathType's boxes for them), lines, boxes, curves and shapes.
    fn drawn(&self) -> Option<(i32, i32, i32, i32)> {
        let boxes = self.boxes.iter().copied();
        self.inked()
            .into_iter()
            .chain(boxes)
            .reduce(|a, b| (a.0.min(b.0), a.1.max(b.1), a.2.max(b.2), a.3.min(b.3)))
    }

    /// What it inks: its glyphs' ink, lines, curves and shapes (not the boxes of spaces).
    fn inked(&self) -> Option<(i32, i32, i32, i32)> {
        self.glyphs
            .iter()
            .map(Glyph::ink)
            .chain(self.lines.iter().map(rule_ink))
            .chain(self.bows.iter().map(Bow::ink))
            .chain(self.polygons.iter().filter_map(|points| {
                let xs = points.iter().map(|p| p.0);
                let ys = points.iter().map(|p| p.1);
                Some((xs.clone().min()?, xs.max()?, ys.clone().max()?, ys.min()?))
            }))
            .reduce(|a, b| (a.0.min(b.0), a.1.max(b.1), a.2.max(b.2), a.3.min(b.3)))
    }

    /// Its ink with the space scripts leave after them (the last element's end ink where it reaches further): how
    /// wide structures over or around it take it.
    fn extent(&self) -> Option<(i32, i32, i32, i32)> {
        self.ink()
            .map(|(l, r, t, b)| (l, self.last.map_or(r, |e| e.ink.max(r)), t, b))
    }

    /// Another block's glyphs moved by (dx, dy) into this one.
    fn take(&mut self, other: Block, dx: i32, dy: i32) {
        if let Some(reserved) = other.reserved {
            self.reserved = Some(
                self.reserved
                    .map_or(reserved + dy, |r| r.max(reserved + dy)),
            );
        }
        if let Some(row) = other.first_row {
            self.first_row = Some(self.first_row.map_or(row + dy, |r| r.max(row + dy)));
        }
        if let Some(place) = other.place {
            self.place = Some(self.place.map_or(place + dy, |p| p.max(place + dy)));
        }
        if let Some(top) = other.space_top {
            self.space_top = Some(self.space_top.map_or(top + dy, |t| t.max(top + dy)));
        }
        if let Some(reserved) = other.reserved_bottom {
            self.reserved_bottom = Some(
                self.reserved_bottom
                    .map_or(reserved + dy, |r| r.min(reserved + dy)),
            );
        }
        self.boxes.extend(
            other
                .boxes
                .iter()
                .map(|b| (b.0 + dx, b.1 + dx, b.2 + dy, b.3 + dy)),
        );
        self.polygons.extend(
            other
                .polygons
                .iter()
                .map(|points| points.iter().map(|p| (p.0 + dx, p.1 + dy)).collect()),
        );
        self.bows.extend(other.bows.iter().map(|b| Bow {
            centre: (b.centre.0 + dx, b.centre.1 + dy),
            start: (b.start.0 + dx, b.start.1 + dy),
            end: (b.end.0 + dx, b.end.1 + dy),
            ..*b
        }));
        self.lines.extend(other.lines.iter().map(|l| Rule {
            from: (l.from.0 + dx, l.from.1 + dy),
            to: (l.to.0 + dx, l.to.1 + dy),
            width: l.width,
        }));
        self.glyphs.extend(other.glyphs.into_iter().map(|mut g| {
            g.x += dx;
            g.y += dy;
            g
        }));
    }

    /// The next element of a line after this block's content: by advance where `by_advance` says so, otherwise by
    /// ink with the space the two ends' classes ask for (none below the full size, `full`: only the gap between
    /// inks).
    fn append(&mut self, element: Block, gaps: Gaps) {
        let full = gaps.full;
        let (Some(mut first), Some(mut last)) = (element.first, element.last) else {
            // without ends (the zero space): its boxes where the line has got to, the next element spaced
            // against what came before and moved by the space's shift
            let at = self.last.map_or(0, |l| l.end);
            // zero spaces in a row move back once
            self.shift = element.shift;
            self.take(element, at, 0);
            return;
        };
        // a binary operator with nothing before it to operate on is unary
        let unary_place = self.last.is_none_or(|prev| {
            matches!(
                prev.class,
                Class::Relation | Class::Open | Class::Punctuation | Class::Placeholder
            )
        });
        if first.class == Class::Binary && first.typeface.is_some() && unary_place {
            first.class = Class::Unary;
            last.class = Class::Unary;
        }
        // what a zero space after a character left: a move back (after a structure it does nothing)
        let shift = std::mem::take(&mut self.shift);
        let after_zero_space = shift != 0;
        let shift = if self.last.is_some_and(|l| l.typeface.is_some()) {
            shift
        } else {
            0
        };
        let dx = match self.last {
            None => 0,
            // by advance; a relation of the function style after a function name's letter also takes the
            // relation's space (ln|x|: the bar 13/64 em past the n's advance; other pairs of one typeface do not:
            // n→∞ under lim)
            Some(prev) if by_advance(&prev, &first) => {
                let classes = if prev.typeface == first.typeface
                    && prev.class == Class::Function
                    && first.class == Class::Relation
                {
                    Class::between(prev.class, first.class)
                } else {
                    0
                };
                let end = if prev.joins == Joins::Differential {
                    prev.end.max(prev.ink)
                } else {
                    prev.end
                };
                // an embellishment reaching further left than its character's ink (dots, a back prime, an
                // underbar: probe/emb-x-29; not a bar through it: emb-*-16, -21 ... -23) moves the character right
                // by that much
                let overhang = match element.glyphs.split_first() {
                    Some((base, marks)) if !marks.is_empty() || !element.lines.is_empty() => {
                        let (_, _, top, bottom) = base.ink();
                        let marks = marks.iter().map(|g| g.ink().0);
                        let outside = |r: &(i32, i32, i32, i32)| r.3 >= top || r.2 <= bottom;
                        let bars = element
                            .lines
                            .iter()
                            .map(rule_ink)
                            .filter(outside)
                            .map(|r| r.0);
                        marks
                            .chain(bars)
                            .min()
                            .map_or(0, |left| (base.ink().0 - left).max(0))
                    }
                    _ => 0,
                };
                let end = end + overhang;
                // the non-operator spacing between neighbours that are not operators
                let letters = if classes == 0
                    && !matches!(prev.class, Class::Binary | Class::Relation)
                    && !matches!(first.class, Class::Binary | Class::Relation)
                {
                    (gaps.letters * f64::from(first.size) / 100.0) as i32
                } else {
                    0
                };
                end + shift + Measure::scaled(classes, first.size) + letters
            }
            // next to a space: the inks the space's width apart, nothing more; a big operator's operand joins it
            Some(prev) if prev.class == Class::Space || first.class == Class::Space => {
                prev.ink - first.ink
            }
            Some(prev) if prev.class == Class::Operator && first.class != Class::Inner => {
                prev.ink - first.ink
            }
            Some(prev) => {
                // after a zero space no class space, and its move back; below the full size any class space is
                // 2/64 em
                let between = if prev.joins == Joins::Empty || first.joins == Joins::Empty {
                    0
                } else {
                    Class::between(prev.class, first.class)
                };
                let classes = if shift != 0 {
                    0
                } else if prev.size < full || first.size < full {
                    between.min(2)
                } else {
                    between
                };
                // after scripts their gap stands in for the plain gap, but not before a bracket or a space
                // character (10³ kJ: the no-break space the plain gap past the 3; Eᵠ(I): the bracket too)
                // (a Greek style's character that is no letter too: ∀ ∃, probe-pc/fo-forall-x, fo-x-exists)
                let symbolic = |e: &Edge| {
                    let greek = matches!(e.typeface, Some(t) if t == i32::from(TYPEFACE_LOWER_GREEK)
                        || t == i32::from(TYPEFACE_UPPER_GREEK));
                    matches!(e.joins, Joins::Differential | Joins::Named | Joins::Slanted)
                        // (a far-east text character after a letter: probe-pc/cj-x-*)
                        || e.joins == Joins::FarEast
                        || (greek && e.joins == Joins::Letters)
                        || (greek && e.joins == Joins::None && e.class == Class::Ordinary)
                };
                let space = match (classes, prev.gap) {
                    (0, _) if prev.joins == Joins::Enclosure && first.joins == Joins::Letters => 0,
                    // a letter beside a Greek letter or a symbol (∞ ∅ ℝ ℒ ∂): 3/64 em between the inks
                    // (probe-pc/fl-alpha-x, fl-x-*; s16-spacing's r ∂), letters of two text fonts keep the
                    // plain gap
                    (0, true)
                        if (symbolic(&prev) && first.joins == Joins::Letters)
                            || (symbolic(&first) && prev.joins == Joins::Letters) =>
                    {
                        3
                    }
                    // (nor before MathType's placeholder unless a zero space comes between: probe-pc/ph3-sub-4-q,
                    // edited/mhchem-0620~after)
                    (0, false)
                        if !matches!(first.class, Class::Close | Class::Open)
                            && (first.class != Class::Placeholder || after_zero_space)
                            && !matches!(first.joins, Joins::Next | Joins::FarEast) =>
                    {
                        0
                    }
                    // a relation's, punctuation's or function name's space at the full size narrows with the
                    // text font's space
                    _ if classes > 2 && Class::narrows(prev.class, first.class) => {
                        PLAIN_GAP + classes - gaps.narrow
                    }
                    _ => PLAIN_GAP + classes,
                };
                // the gap beside a text-style character or a bracket of the function style keeps the full size's
                // (M(I), ν(I) in scripts: 30 units at 7 pt as at 12 pt; a comma there scales: C_{i,j})
                // (and beside MathType's placeholder: probe-pc/ph3-sub-q4, ph3-sub-qx)
                let text = |e: &Edge| {
                    e.typeface == Some(i32::from(TYPEFACE_TEXT))
                        || (e.typeface == Some(i32::from(TYPEFACE_FUNCTION))
                            && matches!(e.class, Class::Open | Class::Close))
                        || e.class == Class::Placeholder
                };
                // (and between a letter and a digit: a_{m1}, a_{1n}, x_{n2} at 7 pt, probe-pc/sd-*)
                let digit = |e: &Edge| e.typeface == Some(i32::from(TYPEFACE_NUMBER));
                let letter_digit = (digit(&prev) && first.joins == Joins::Letters)
                    || (prev.joins == Joins::Letters && digit(&first));
                let gap_size = if text(&prev) || text(&first) || letter_digit {
                    full
                } else {
                    first.size
                };
                let class = if space != PLAIN_GAP && classes > 2 {
                    classes
                } else {
                    0
                };
                let ink = if class == 0 {
                    prev.ink
                } else {
                    prev.ink - prev.past
                };
                ink + gaps.between(space, gap_size, class) - first.ink + shift
            }
        };
        if self.first.is_none() {
            self.first = Some(Edge {
                ink: first.ink + dx,
                ..first
            });
        }
        self.last = Some(Edge {
            ink: last.ink + dx,
            end: last.end + dx,
            ..last
        });
        self.last_from = self.glyphs.len();
        self.last_lines_from = self.lines.len();
        // glyphs that stand at the line's start stay there (and move with the line from now on)
        let mut element = element;
        for g in element.glyphs.iter_mut().filter(|g| g.line_start) {
            g.x -= dx;
            g.line_start = false;
        }
        self.take(element, dx, 0);
    }
}

struct Layout<'a> {
    fonts: &'a Fonts,
    font_defs: Vec<FontDef>,
    style_defs: Vec<(u16, u8)>,
    prefs: Option<&'a EqnPrefs>,
    /// the size in force (the font's character height in picture units)
    size: i32,
    /// how many template slots the records being laid out are inside
    depth: usize,
    /// how many fractions the records being laid out are inside
    in_fraction: usize,
    /// text runs handed out (struck-through contents)
    runs: u32,
    /// the colour the characters being laid out have (a COLOR record's index; 0 the default)
    colour: u32,
}

impl<'a> Layout<'a> {
    /// A line's records laid out from its origin; definitions and sizes among them take effect in order.
    fn line(&mut self, records: &'a [Record]) -> Result<Block, String> {
        let mut block = Block::default();
        // scripts before their base: laid out where they stand (the sizes after them hold for the base), placed
        // when the base (the next element) comes
        let mut prescripts: Option<Vec<Option<Block>>> = None;
        let mut empty = true;
        for record in records {
            if let Record::Template(t) = record {
                if (27..=29).contains(&t.selector) && t.variation & 0x01 != 0 {
                    prescripts = Some(self.slots(t)?.0);
                    continue;
                }
            }
            let element = matches!(
                record,
                Record::Char(_)
                    | Record::Line(_)
                    | Record::Template(_)
                    | Record::Pile(_)
                    | Record::Matrix(_)
            );
            if element {
                empty = false;
                if let Some(scripts) = prescripts.take() {
                    let base = self.line(std::slice::from_ref(record))?;
                    self.prescripts(scripts, base, &mut block);
                    continue;
                }
            }
            match record {
                Record::Char(c) => {
                    if let Some(glyph) = self.char(c)? {
                        block.append(glyph, self.gaps());
                    }
                }
                Record::Line(line) => {
                    let inner = self.line(&line.content)?;
                    block.append(inner, self.gaps());
                }
                Record::Template(t) => match t.selector {
                    27..=29 if t.variation & 0x01 == 0 => self.scripts(t, &mut block)?,
                    11 if t.variation <= 1 => self.fraction(t, &mut block)?,
                    11 if t.variation & 2 != 0 => self.slash_fraction(t, &mut block)?,
                    23 => self.limit(t, &mut block)?,
                    15..=20 | TEMPLATE_INTEGRAL_OPERATOR | TEMPLATE_SUM_OPERATOR => {
                        self.big_operator(t, &mut block)?
                    }
                    0..=9 => self.fence(t, &mut block)?,
                    30 => self.dirac(t, &mut block)?,
                    24 | 25 => self.horizontal_brace(t, &mut block)?,
                    14 => self.arrow(t, &mut block)?,
                    26 => self.long_division(t, &mut block)?,
                    31 => self.over_arrow(t, &mut block)?,
                    32..=34 => self.wide_accent(t, &mut block)?,
                    10 => self.root(t, &mut block)?,
                    12 | 13 => self.bar(t, &mut block)?,
                    36 => self.strike(t, &mut block)?,
                    37 => self.boxed(t, &mut block)?,
                    _ => return Err(format!("not drawn yet: template {}", t.selector)),
                },
                Record::Pile(pile) => self.pile(pile, &mut block)?,
                Record::Matrix(matrix) => self.matrix(matrix, &mut block)?,
                other => self.state(other),
            }
        }
        if let Some(scripts) = prescripts {
            self.prescripts(scripts, Block::default(), &mut block);
        } else if empty {
            block.append(self.empty_line(), self.gaps());
        }
        Ok(block)
    }

    /// How the line's elements space (`Gaps`).
    fn gaps(&self) -> Gaps {
        let space = self
            .font_of(i32::from(TYPEFACE_TEXT))
            .map(|(font, _)| Face {
                name: font.name.clone(),
                bold: false,
                italic: false,
            })
            .and_then(|f| self.fonts.measure(&f, Code::Unicode(' ')))
            .map_or(16, |m| m.advance);
        Gaps {
            full: self.type_size(RECORD_FULL),
            narrow: 16 - space,
            // 0 % stands for the default (MathType draws it as 100 %)
            operators: Some(self.spacing_exact(OPERATOR_SPACING, 100))
                .filter(|&p| p > 0.0)
                .unwrap_or(100.0),
            letters: self.spacing_exact(NON_OPERATOR_SPACING, 100),
        }
    }

    /// Definitions and sizes: they hold for the records after them.
    fn state(&mut self, record: &'a Record) {
        match record {
            Record::FontDef { encoding, name } => self.font_defs.push(FontDef {
                name: font_name(name),
                encoding: encoding.value,
            }),
            Record::FontStyleDef { font, style } => self.style_defs.push((font.value, *style)),
            Record::EqnPrefs(prefs) => self.prefs = Some(prefs),
            Record::TypeSize(kind) => self.size = self.type_size(*kind),
            Record::Size(size) => self.size = self.explicit_size(*size),
            Record::Color(index) => self.colour = u32::from(index.value),
            _ => {}
        }
    }

    /// A template's slots (its lines, each at the size in force when it starts) and its own characters.
    fn slots(
        &mut self,
        template: &'a Template,
    ) -> Result<(Vec<Option<Block>>, Vec<Block>), String> {
        self.depth += 1;
        let slots = self.slots_inside(template);
        self.depth -= 1;
        slots
    }

    fn slots_inside(
        &mut self,
        template: &'a Template,
    ) -> Result<(Vec<Option<Block>>, Vec<Block>), String> {
        let (mut lines, mut chars) = (Vec::new(), Vec::new());
        for record in &template.content {
            match record {
                Record::Line(line) if line.options & LINE_NULL != 0 => lines.push(None),
                Record::Line(line) => {
                    let block = self.line(&line.content)?;
                    lines.push(Some(block));
                }
                // a template's own fence-style characters (fences, intervals, bra-kets): the template says which
                // they are
                Record::Char(c) if c.typeface.value == i32::from(TYPEFACE_FENCE) => {}
                Record::Char(c) => chars.extend(self.char(c)?),
                Record::Template(_) | Record::Pile(_) | Record::Matrix(_) => {
                    let block = self.line(std::slice::from_ref(record))?;
                    lines.push(Some(block));
                }
                other => self.state(other),
            }
        }
        Ok((lines, chars))
    }

    /// A slot's em ascent at a size from its fonts (the size's three quarters without fonts).
    fn slot_top_of_size(&self, block: &Block, size: i32) -> i32 {
        let spaces = block.space_top.map(|_| self.text_em_ascent(size));
        block
            .glyphs
            .iter()
            .filter_map(|g| g.em_ascent(self.fonts, size))
            .chain(spaces)
            .max()
            .unwrap_or(size * 3 / 4)
    }

    /// How far a matrix's or pile's line reaches down: its ink, at least the em descent of its glyphs at the grid's
    /// size below their baselines (a subscript's em box does not deepen a row: probe-pc/mx-sub*).
    fn row_bottom(&self, block: &Block, size: i32) -> i32 {
        let em = block
            .glyphs
            .iter()
            .filter(|g| g.height == size)
            .filter_map(|g| {
                g.em_ascent(self.fonts, g.height)
                    .map(|e| g.y - (g.height - e))
            })
            .min();
        let ink = block.ink().map(|i| i.3);
        match (em, ink) {
            (Some(e), Some(i)) => e.min(i),
            (e, i) => e.or(i).unwrap_or(0),
        }
    }

    /// How far a slot's line reaches up: its ink, at least its fonts' em ascent.
    fn slot_top(&self, block: &Block) -> i32 {
        let em = block
            .glyphs
            .iter()
            .filter_map(|g| g.em_ascent(self.fonts, g.height).map(|e| g.y + e))
            .chain(block.space_top)
            .max();
        // glyphs none of whose fonts gives an em box (MathType's own: an equilibrium arrow's ↽ alone) reach three
        // quarters of their size, as `slot_top_of_size` takes it (writer/mhchem-0643: its label over that top)
        let em = em.or_else(|| block.glyphs.iter().map(|g| g.y + g.height * 3 / 4).max());
        let ink = block.ink().map(|i| i.2);
        em.max(ink).unwrap_or(0)
    }

    /// The font and character style (bold 1, italic 2) a typeface draws with: a built-in style's binding in the
    /// equation's preferences, or the FONT_STYLE_DEF a negative typeface names.
    fn font_of(&self, typeface: i32) -> Option<(&FontDef, u8)> {
        let (font, style) = if typeface < 0 {
            *self.style_defs.get((-typeface - 1) as usize)?
        } else {
            let binding = self.prefs?.styles.get(typeface as usize - 1)?;
            (binding.font.value, binding.style.unwrap_or(0))
        };
        Some((
            self.font_defs.get(usize::from(font).checked_sub(1)?)?,
            style,
        ))
    }
}

fn round_up(value: i32) -> i32 {
    (value + POINT - 1).div_euclid(POINT) * POINT
}
