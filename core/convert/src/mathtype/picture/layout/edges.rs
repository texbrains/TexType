//! The ends of laid-out content that neighbours are spaced against (see the parent module's spacing rules).

use super::*;

/// An end of laid-out content, for spacing a neighbour against it: the ink edge there (left ink of the first
/// element, right ink of the last), where the advance ends (last element), and what the element is.
#[derive(Clone, Copy)]
pub(super) struct Edge {
    pub(super) ink: i32,
    pub(super) end: i32,
    pub(super) class: Class,
    /// the typeface of a character (characters of one typeface follow by advance), None for a structure
    pub(super) typeface: Option<i32>,
    /// a character's font (its number among the font definitions)
    pub(super) font: Option<usize>,
    pub(super) joins: Joins,
    pub(super) size: i32,
    /// whether the plain gap of 5/64 em between inks follows this end (not after scripts: the script gap their
    /// end holds stands in for it; operator spacing still applies)
    pub(super) gap: bool,
    /// how far `ink` lies past the real ink (a pieced fence's pixel): a class space is measured from the real ink
    pub(super) past: i32,
}

impl Edge {
    /// The end of a structure (not a character): spaced by ink and its class only.
    pub(super) fn structure(ink: i32, end: i32, class: Class, size: i32) -> Edge {
        Edge {
            ink,
            end,
            class,
            typeface: None,
            font: None,
            joins: Joins::None,
            size,
            gap: true,
            past: 0,
        }
    }

    /// The end of an enclosure (a root, a box, a bar, a strike-through): a letter after it with no plain gap, a digit
    /// or a structure keeping it (probe-pc/fl-*, st-*).
    pub(super) fn enclosure(ink: i32, size: i32) -> Edge {
        Edge {
            joins: Joins::Enclosure,
            ..Edge::structure(ink, ink, Class::Ordinary, size)
        }
    }

    /// An end one 64 ppem pixel of `size` past the ink: MathType's box of a fence built from pieces, for the plain
    /// gap (a class space starts at the ink: 4/25 em between two fences at every size); not of matrices, limits,
    /// roots, one-glyph fences or fences drawn with lines.
    pub(super) fn pixel_past(ink: i32, end: i32, class: Class, size: i32) -> Edge {
        let past = Measure::scaled(1, size);
        Edge {
            past,
            ..Edge::structure(ink + past, end, class, size)
        }
    }
}
