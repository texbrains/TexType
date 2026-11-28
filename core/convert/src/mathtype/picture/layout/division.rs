//! Long division (template 26), as MathType 6.9 draws it.

use super::*;

impl<'a> Layout<'a> {
    /// A long division (template 26: slots dividend, quotient; variation 1 the quotient above the bar) as the line's
    /// next element, as MathType's pictures show (lengths in 384ths of an em of the size): its template character
    /// ")" in Symbol at the size in force after the slots (as fences take theirs), drawn alone at the start of the
    /// line holding the structure (not of the structure: after "a =" it stands at the line's start), its baseline
    /// 9 points above the dividend's at a full size (12, 18 or 24 pt alike), on it below the full size; the
    /// dividend's ink 48 after the ink of a ")" at the template's size (wherever the drawn one ends); the quotient
    /// and the dividend ending together, the narrower moved right, a part's end its ink or the space scripts leave
    /// after them; a bar from the structure's start past that end by the fraction overhang (setting 11, scaled to
    /// the size as a fraction's), the bar thickness setting scaled to the size below the full size; the bar's
    /// middle 1/6 em, half its pen and a unit above the dividend's top, the quotient's ink bottom that far above
    /// the bar's middle, its line keeping its height. Beside the
    /// ")" a curve with the bar's pen: the circle arc through the bar's top at its start and that point mirrored
    /// about the math axis, bulging 1/4 em to the right (its centre on the axis). Without the quotient place
    /// (variation 0) a quotient still given sits at the start, its baseline on the bar's top, given no room.
    pub(super) fn long_division(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let size = self.size;
        let s = |v: i32| v * size / 384;
        // the bar thickness setting is for the full size and shrinks with the size (9 units at 7 pt)
        let full = self.type_size(RECORD_FULL);
        let thickness = self.spacing(BAR_THICKNESS, full) * size / full;
        let (slots, _) = self.slots(template)?;
        let mut slots = slots.into_iter().map(Option::unwrap_or_default);
        let (dividend, quotient) = (
            slots.next().unwrap_or_default(),
            slots.next().unwrap_or_default(),
        );
        let face = Face {
            name: "Symbol".into(),
            bold: false,
            italic: false,
        };
        // drawn without room: its ink reaches above the bar, outside MathType's frame
        let mut bracket = Glyph {
            alone: true,
            assumed: Some(NO_ROOM),
            line_start: true,
            ..self.glyph(&face, Code::Symbol(0x29), 0x29, 1, self.size)?
        };
        bracket.y = if size >= full { 9 * POINT } else { 0 };
        let start = self
            .glyph(&face, Code::Symbol(0x29), 0x29, 1, size)?
            .ink()
            .1
            + s(48);
        let extent = |b: &Block| b.extent().map(|(l, r, _, bottom)| (l, r, bottom));
        let (dl, dr, _) = extent(&dividend).unwrap_or((0, 0, 0));
        let above = template.variation & 1 != 0;
        let placed = extent(&quotient).filter(|_| above);
        let width = placed.map_or(0, |(l, r, _)| r - l).max(dr - dl);
        let end = start + width;
        let gap = size / 6 + thickness / 2 + 1;
        let bar = self.slot_top(&dividend) + gap;
        let overhang = self.spacing(BAR_OVERHANG, size) * size / full;
        let mut block = Block::default();
        block.glyphs.push(bracket);
        block.lines.push(Rule {
            from: (0, bar),
            to: (end + overhang, bar),
            width: thickness,
            colour: UNSET,
        });
        block.take(dividend, end - dr, 0);
        match placed {
            Some((_, qr, qb)) => {
                // the quotient's line keeps its height
                let dy = bar + gap - qb;
                block.reserved = Some(dy + self.slot_top(&quotient));
                block.take(quotient, end - qr, dy)
            }
            None => {
                let mut quotient = quotient;
                for g in &mut quotient.glyphs {
                    g.assumed = Some(NO_ROOM);
                }
                block.take(quotient, 0, bar + thickness / 2)
            }
        }
        // the curve: through (0, bar top) and its mirror about the axis, reaching a quarter em right of them
        let axis = axis(size);
        let (bulge, half) = (size / 4, i64::from(bar + thickness / 2 - axis));
        let radius =
            ((half * half + i64::from(bulge) * i64::from(bulge)) / (2 * i64::from(bulge))) as i32;
        let end = (thickness / 2, bar - 1);
        block.bows.push(Bow {
            centre: (bulge - radius, axis),
            radius: (radius, radius),
            start: (end.0 + 1, 2 * axis - end.1),
            end,
            width: thickness,
            colour: UNSET,
        });
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        block.first = Some(Edge::structure(left, right, Class::Ordinary, size));
        block.last = Some(Edge::structure(right, right, Class::Ordinary, size));
        line.append(block, self.gaps());
        Ok(())
    }
}
