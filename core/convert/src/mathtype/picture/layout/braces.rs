//! Horizontal braces and brackets over or under content (templates 24, 25), as MathType 6.9 draws them.

use super::*;

impl<'a> Layout<'a> {
    /// A horizontal brace (template 24) or bracket (25) with a label (slots content, label; variation 1 above, 0
    /// below) as the line's next element: MathType's MT Extra glyph at the size in force after the slots (brace
    /// 0x7D above, 0x7B below; bracket 0x7E, 0x7C) stretched sideways only so its ink spans the content's ink
    /// (named at the width 263/384 em spans unstretched), the plain gap (5/64 em) from the content (its em top
    /// below a glyph above, its ink bottom above a glyph below), the label the plain gap beyond (its ink bottom
    /// above, its em top below), centred on the content's ink.
    pub(super) fn horizontal_brace(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let (slots, _) = self.slots(template)?;
        let size = self.size;
        let mut slots = slots.into_iter().map(Option::unwrap_or_default);
        let (content, label) = (
            slots.next().unwrap_or_default(),
            slots.next().unwrap_or_default(),
        );
        let above = template.variation & 1 != 0;
        let byte = match (template.selector, above) {
            (24, true) => 0x7D,
            (24, false) => 0x7B,
            (_, true) => 0x7E,
            (_, false) => 0x7C,
        };
        let face = Face {
            name: "MT Extra".into(),
            bold: false,
            italic: false,
        };
        let mut glyph = Glyph {
            alone: true,
            ..self.glyph(&face, Code::Symbol(byte), byte, 1, size)?
        };
        let (cl, cr, _, cb) = content.ink().unwrap_or((0, 0, 0, 0));
        let ct = self.slot_top(&content);
        // stretched sideways: the ink as wide as the content's
        let ink_width = Measure::scaled(glyph.measure.right - glyph.measure.left, size).max(1);
        let natural = (263 * size + 192) / 384;
        glyph.width = (i64::from(natural) * i64::from(cr - cl) / i64::from(ink_width)) as i32;
        glyph.wide = (i64::from(size) * i64::from(cr - cl) / i64::from(ink_width)) as i32;
        let plain = plain_gap(size);
        let (_, _, gt, gb) = glyph.ink();
        glyph.x = cl - Measure::scaled(glyph.measure.left, glyph.wide);
        glyph.y = if above {
            ct + plain - gb
        } else {
            cb - plain - gt
        };
        let (_, _, top, bottom) = glyph.ink();
        let (ll, lr, lb) = label.ink().map_or((0, 0, 0), |i| (i.0, i.1, i.3));
        let label_dy = if above {
            top + plain - lb
        } else {
            bottom - plain - self.slot_top(&label)
        };
        let label_dx = (cl + cr) / 2 - (ll + lr) / 2;
        let mut block = Block::default();
        let reserved = if above {
            Some(label_dy + self.slot_top(&label))
        } else {
            None
        };
        block.take(content, 0, 0);
        block.glyphs.push(glyph);
        block.take(label, label_dx, label_dy);
        block.reserved = reserved.or(Some(ct));
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        block.first = Some(Edge::structure(left, right, Class::Ordinary, size));
        block.last = Some(Edge::structure(right, right, Class::Ordinary, size));
        line.append(block, self.gaps());
        Ok(())
    }
}
