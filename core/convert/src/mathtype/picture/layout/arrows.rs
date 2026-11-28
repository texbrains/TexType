//! Arrows with text (template 14), as MathType 6.9 draws them.

use super::*;

impl<'a> Layout<'a> {
    /// An arrow with labels (template 14: slots the label above, the label below; variation 4 a label above, 8
    /// below, 16 pointing left, 32 right; 1 double and 2 harpoons not drawn yet) as the line's next element, as
    /// MathType's pictures show: an arrow on the baseline built from Symbol's pieces at the size in force after
    /// the slots (a left head 0xAC, extensions 0xBE, a right head 0xAE), its ink as long as the wider label's ink
    /// and the arrow room (setting 17) on each side; the first piece's ink at its start, the last's at its end,
    /// extensions between while they have not reached the last piece, the second piece overlapping the first by
    /// a point and later ones their neighbour by half a point; the labels centred on it by ink, placed like a
    /// fraction's parts around a bar on the math axis (the numerator height, setting 9, and the denominator depth,
    /// setting 10, of the label's size) and at least the plain gap (5/64 em of the label's size) beyond the
    /// extension's ink, a label's edge there its ink or its em box at its baseline, whichever reaches further;
    /// spaced like an inner element.
    pub(super) fn arrow(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        if template.variation & 0x03 != 0 {
            return Err(format!(
                "not drawn yet: arrow variation {:#x}",
                template.variation
            ));
        }
        let (slots, _) = self.slots(template)?;
        let size = self.size;
        let mut slots = slots.into_iter();
        let upper = slots
            .next()
            .flatten()
            .filter(|_| template.variation & 4 != 0);
        let lower = slots
            .next()
            .flatten()
            .filter(|_| template.variation & 8 != 0);
        let (left, right) = (template.variation & 16 != 0, template.variation & 32 != 0);
        let face = Face {
            name: "Symbol".into(),
            bold: false,
            italic: false,
        };
        let piece = |byte: u8| self.glyph(&face, Code::Symbol(byte), byte, 1, size);
        let width = |b: &Option<Block>| b.as_ref().and_then(Block::ink).map_or(0, |i| i.1 - i.0);
        // the room in proportion to the text font's space (16 pixels at 64 ppem in Times New Roman, Cambria 14)
        let room = self.spacing(ARROW_ROOM, size) * (16 - self.gaps().narrow) / 16;
        let length = width(&upper).max(width(&lower)) + 2 * room;
        let extension = piece(0xBE)?;
        let first = if left {
            piece(0xAC)?
        } else {
            extension.clone()
        };
        let last = if right {
            piece(0xAE)?
        } else {
            extension.clone()
        };
        let mut pieces = Vec::new();
        let mut place = |mut glyph: Glyph, ink_left: i32| {
            let (l, r, _, _) = glyph.ink();
            glyph.x = ink_left - l;
            let reach = ink_left + (r - l);
            pieces.push(glyph);
            reach
        };
        let (ll, lr, _, _) = last.ink();
        let last_left = length - (lr - ll);
        let mut reach = place(first, 0);
        let mut overlap = POINT;
        while reach < last_left {
            reach = place(extension.clone(), reach - overlap);
            overlap = POINT / 2;
        }
        place(last, last_left);
        let (_, _, shaft_top, shaft_bottom) = extension.ink();
        let mut block = Block::default();
        block.glyphs.extend(pieces);
        let centre = length / 2;
        let axis = axis(size);
        if let Some(label) = upper {
            let (l, r, _, b) = label.ink().unwrap_or((0, 0, 0, 0));
            let label_size = label.first.map_or(size, |e| e.size);
            let descent = label_size - self.slot_top_of_size(&label, label_size);
            let bottom = b.min(-descent);
            let dy = (axis + self.spacing(NUMERATOR_HEIGHT, label_size))
                .max(shaft_top + plain_gap(label_size) - bottom);
            block.reserved = Some(dy + self.slot_top(&label));
            block.take(label, centre - (l + r) / 2, dy);
        }
        if let Some(label) = lower {
            let (l, r, _, _) = label.ink().unwrap_or((0, 0, 0, 0));
            let label_size = label.first.map_or(size, |e| e.size);
            let top = self.slot_top(&label);
            let dy = (axis - self.spacing(DENOMINATOR_DEPTH, label_size))
                .min(shaft_bottom - plain_gap(label_size) - top);
            block.take(label, centre - (l + r) / 2, dy);
        }
        let (ink_left, ink_right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        block.first = Some(Edge::structure(ink_left, ink_right, Class::Inner, size));
        block.last = Some(Edge::structure(ink_right, ink_right, Class::Inner, size));
        line.append(block, self.gaps());
        Ok(())
    }
}
