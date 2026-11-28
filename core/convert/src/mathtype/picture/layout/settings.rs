//! The equation's own settings (EQN_PREFS): its spacing and type sizes, MathType's defaults where it has none.

use super::*;

/// The spacing settings (EQN_PREFS spaces) by index.
pub(super) const SUPERSCRIPT_HEIGHT: usize = 3;
pub(super) const SUBSCRIPT_DEPTH: usize = 4;
pub(super) const SCRIPT_GAP: usize = 5;
pub(super) const NUMERATOR_HEIGHT: usize = 9;
pub(super) const DENOMINATOR_DEPTH: usize = 10;
pub(super) const BAR_OVERHANG: usize = 11;
pub(super) const BAR_THICKNESS: usize = 12;
pub(super) const INNER_BAR_THICKNESS: usize = 13;

pub(super) const LIMIT_HEIGHT: usize = 6;
pub(super) const EMBELLISHMENT_GAP: usize = 23;
pub(super) const OVER_EXTENSION: usize = 15;
pub(super) const PRIME_HEIGHT: usize = 24;
pub(super) const ENCLOSURE_PADDING: usize = 20;
pub(super) const OPERATOR_SPACING: usize = 16;
pub(super) const NON_OPERATOR_SPACING: usize = 18;
pub(super) const MINIMUM_GAP: usize = 19;
/// MathType's default spacing settings (unit 2 points, 4 percent of the size), for equations without their own.
pub(super) const DEFAULT_SPACING: [(u8, f64); 30] = [
    (4, 150.0),
    (4, 150.0),
    (4, 100.0),
    (4, 45.0),
    (4, 25.0),
    (4, 8.0),
    (4, 25.0),
    (4, 100.0),
    (4, 100.0),
    (4, 35.0),
    (4, 100.0),
    (2, 1.0),
    (2, 0.5),
    (2, 0.25),
    (4, 8.0),
    (2, 1.0),
    (4, 100.0),
    (4, 100.0),
    (4, 0.0),
    (4, 8.0),
    (4, 17.0),
    (4, 8.0),
    (4, 100.0),
    (2, 1.5),
    (4, 45.0),
    (4, 5.0),
    (4, 5.0),
    (4, 5.0),
    (4, 5.0),
    (4, 10.0),
];
pub(super) const BOX_THICKNESS: usize = 25;
pub(super) const STRIKE_THICKNESS: usize = 26;
pub(super) const LIMIT_DEPTH: usize = 7;
pub(super) const MATRIX_LINE_THICKNESS: usize = 27;
/// The gap between a radical's top corner and the radicand's ink, and the radical's thickness.
pub(super) const RADICAL_GAP: usize = 21;
pub(super) const RADICAL_THICKNESS: usize = 28;
pub(super) const RADICAL_WIDTH: usize = 22;
/// How far an arrow reaches past its label on each side; it also scales the fence gap and the old
/// integral template's operand gap.
pub(super) const ARROW_ROOM: usize = 17;
/// The gap between a fence's inner ink edge and its content's ink, as a share of the arrow room (every bracket
/// kind, stretched glyph or pieces, and the double bar).
pub(super) const FENCE_SPACE: usize = 29;

/// An EQN_PREFS dimension array: per dimension its unit (0 in, 1 cm, 2 pt, 3 pc, 4 %) and value.
pub(super) fn dims(bytes: &[u8]) -> Vec<(u8, f64)> {
    let Some((&count, rest)) = bytes.split_first() else {
        return Vec::new();
    };
    let nibbles: Vec<u8> = rest.iter().flat_map(|b| [b >> 4, b & 0x0F]).collect();
    let (mut out, mut at) = (Vec::new(), 0);
    while out.len() < usize::from(count) && at < nibbles.len() {
        let unit = nibbles[at];
        at += 1;
        let mut text = String::new();
        while at < nibbles.len() && nibbles[at] != 0x0F {
            text.push(match nibbles[at] {
                0x0A => '.',
                0x0B => '-',
                d => char::from(b'0' + d),
            });
            at += 1;
        }
        at += 1;
        out.push((unit, text.parse().unwrap_or(0.0)));
    }
    out
}

impl Layout<'_> {
    /// A spacing setting in picture units at a size: a percentage of the size, or points; rounded down.
    pub(super) fn spacing(&self, index: usize, size: i32) -> i32 {
        self.spacing_exact(index, size) as i32
    }

    /// A spacing setting in picture units at a size, unrounded (MathType's defaults where the equation has none).
    pub(super) fn spacing_exact(&self, index: usize, size: i32) -> f64 {
        let dims = self.prefs.map(|p| dims(&p.spaces)).unwrap_or_default();
        let value = dims
            .get(index)
            .copied()
            .or_else(|| DEFAULT_SPACING.get(index).copied());
        match value {
            Some((2, points)) => points * f64::from(POINT),
            Some((4, percent)) => f64::from(size) * percent / 100.0,
            _ => 0.0,
        }
    }

    /// The minimum gap (setting 19) at a size: its share of the em rounded up to a whole 3/8 point, at least that
    /// much (MathType's room after scripts and before a prime: steps of 12 units at every size).
    pub(super) fn minimum_gap(&self, size: i32) -> i32 {
        let step = 3 * POINT / 8;
        let steps = (self.spacing_exact(MINIMUM_GAP, size) / f64::from(step)).ceil();
        step * (steps as i32).max(1)
    }

    /// The size a TypeSize record names: from the equation's size settings (in points, or a percentage of the full
    /// size), MathType's defaults without them.
    pub(super) fn type_size(&self, kind: u8) -> i32 {
        let index = usize::from(kind - RECORD_FULL);
        let defaults = [12.0, 7.0, 5.0, 18.0, 12.0];
        let dims = self.prefs.map(|p| dims(&p.sizes)).unwrap_or_default();
        let full = match dims.first() {
            Some((2, points)) => points * f64::from(POINT),
            _ => defaults[0] * f64::from(POINT),
        };
        let value = match dims.get(index) {
            Some((2, points)) => points * f64::from(POINT),
            // a percentage rounded down (58 % of 12 pt: 222 units)
            Some((4, percent)) => (full * percent / 100.0).floor(),
            _ => defaults[index] * f64::from(POINT),
        };
        value.round() as i32
    }

    /// A SIZE record: a size in 32nds of a point (form 101), or a type size and a delta in picture units (form 100
    /// a signed 16-bit delta, otherwise a byte offset by 128), as MathType's pictures show.
    pub(super) fn explicit_size(&self, size: Size) -> i32 {
        match size {
            Size::Explicit { points } => i32::from(points),
            Size::Points { lsize, points } => {
                self.type_size(RECORD_FULL + lsize) + i32::from(points as i16)
            }
            Size::Relative { lsize, dsize } => {
                self.type_size(RECORD_FULL + lsize) + i32::from(dsize) - 128
            }
        }
    }
}
