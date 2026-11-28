//! The gap between two neighbours' inks (see the parent module's rules on spacing).

use super::*;

/// What spaces a line's elements: the full size (no class space below it) and how much a class space (any but a
/// binary operator's) narrows, in 64ths of an em: by as many 64 ppem pixels as the text font's space is narrower
/// than Times New Roman's 16 (Cambria's 14: 2; MathType's pictures of Cambria equations).
#[derive(Clone, Copy)]
pub(super) struct Gaps {
    pub(super) full: i32,
    pub(super) narrow: i32,
    /// the operator spacing (setting 16) in percent: what the space around operators is scaled by
    pub(super) operators: f64,
    /// the non-operator spacing (setting 18) in percent of the size: added between characters joined by advance
    pub(super) letters: f64,
}

impl Gaps {
    /// A gap between two inks of `space` 64ths of an em at a size: the plain gap scaled; with a class space (at
    /// the full size) scaled by the operator spacing and rounded up to a whole 3/8 point (12 units at every size, as
    /// the minimum gap: 14/64 em at 18 pt is 132 units, not 126).
    pub(super) fn between(&self, space: i32, size: i32, class: i32) -> i32 {
        if class == 0 {
            return if space == 0 {
                0
            } else {
                plain_gap(size) + Measure::scaled(space - PLAIN_GAP, size)
            };
        }
        // measured gaps with the plain gap, in 64ths of an em (probe-pc/rel-*: the ranges MathType's pictures
        // allow; the k/64 values at their low ends land a step short where they fall on a step): a relation's 4/15 em
        // (between 17/64 and 17.14/64), the 7/64 class's 4/25 em (between 10/64 and 10.29/64; probe-pc/rel-func-*,
        // two fences side by side in fw-*; not scaled by the operator spacing: function names, punctuation, fences,
        // probe-pc/s16-pairs-*, fixed-fence-16); a binary operator's 14/64 em
        let (gap, scale) = match class {
            RELATION_SPACE => (64.0 * 4.0 / 15.0, self.operators / 100.0),
            7 => (64.0 * 4.0 / 25.0, 1.0),
            _ => (f64::from(PLAIN_GAP + class), self.operators / 100.0),
        };
        // a narrowed space (Cambria's) keeps its narrowing
        let space = f64::from(space - PLAIN_GAP - class) + gap;
        let raw = space * f64::from(size) / 64.0 * scale;
        let step = f64::from(3 * POINT / 8);
        ((raw / step).ceil() * step) as i32
    }
}
