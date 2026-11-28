//! Fractions: stacked over a bar, small, and with a slash (see the parent module's rules).

use super::*;

impl<'a> Layout<'a> {
    /// A slash fraction (template 11 with variation 2; 4 on the baseline) as the line's next element, as
    /// MathType's pictures show:
    /// - on the baseline: both parts on it, the slash (the bar's pen) through the parts' height (their em tops and
    ///   the em descent of the size, and their ink where it reaches beyond), 0.32 across per unit up, its ink the
    ///   plain gap (5/64 em) after the numerator's ink at the numerator's ink bottom, the denominator's ink the plain
    ///   gap after the slash's at the denominator's em top (the slanted slash keeps the same gaps where its parts
    ///   meet);
    /// - slanted: the numerator's ink bottom on the math axis, the denominator's em top there; the slash from the
    ///   numerator's top to the denominator's ink bottom, 0.7135 across per unit up, passing 38/384 em after the
    ///   numerator's ink at the axis, the denominator's ink 38/384 em after it there.
    pub(super) fn slash_fraction(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let size = self.size;
        let thin = self.in_fraction > 0 || size < self.type_size(RECORD_FULL);
        let pen = self.spacing(
            if thin {
                INNER_BAR_THICKNESS
            } else {
                BAR_THICKNESS
            },
            size,
        );
        self.in_fraction += 1;
        let slots = self.slots(template);
        self.in_fraction -= 1;
        let (slots, _) = slots?;
        let mut slots = slots.into_iter().map(Option::unwrap_or_default);
        let (num, den) = (
            slots.next().unwrap_or_default(),
            slots.next().unwrap_or_default(),
        );
        let right_of = |b: &Block| {
            let r = b.ink().map_or(0, |i| i.1);
            b.last.map_or(r, |e| e.ink.max(r))
        };
        let (nl, _, _, nb) = num.ink().unwrap_or((0, 0, 0, 0));
        let nr = right_of(&num);
        let (dl, _, _, db) = den.ink().unwrap_or((0, 0, 0, 0));
        let mut block = Block::default();
        let slash = |from: (i32, i32), to: (i32, i32)| Rule {
            from,
            to,
            width: pen,
        };
        if template.variation & 4 != 0 {
            let top = self.slot_top(&num).max(self.slot_top(&den));
            // down to the parts' ink, at least the size's em descent
            let descent = size - self.slot_top_of_size(&num, size);
            let bottom = nb.min(db).min(-descent);
            let run = (f64::from(top - bottom) * 0.32).round() as i32;
            // the line's ink reaches half the pen past its middle, perpendicular to it
            let side = (f64::from(pen) / 2.0 * f64::from(top - bottom)
                / f64::from(top - bottom).hypot(f64::from(run)))
            .round() as i32;
            // the slash's ink the plain gap from the numerator's ink at its bottom, the denominator's ink the
            // plain gap from the slash's at the denominator's em top
            let plain = plain_gap(size);
            let along = |y: i32| (f64::from(y - bottom) * 0.32).round() as i32;
            let foot = nr + plain + side - along(nb);
            let den_left = foot + along(self.slot_top(&den)) + side + plain;
            block.take(num, 0, 0);
            block.lines.push(slash((foot + run, top), (foot, bottom)));
            block.take(den, den_left - dl, 0);
            block.reserved = Some(top);
            block.reserved_bottom = Some(bottom);
        } else {
            let axis = axis(size);
            let num_raise = axis - nb;
            let den_drop = self.slot_top(&den) - axis;
            let top = num_raise + self.slot_top(&num);
            let bottom = db - den_drop;
            let gap = FENCE_GAP * size / 384;
            let cross = nr + gap;
            let at = |y: i32| cross + (f64::from(y - axis) * 0.7135).round() as i32;
            block.take(num, 0, num_raise);
            block
                .lines
                .push(slash((at(top), top), (at(bottom), bottom)));
            block.take(den, cross + gap - dl, -den_drop);
            block.reserved = Some(top);
            block.reserved_bottom = Some(bottom);
        }
        let _ = nl;
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        block.first = Some(Edge::structure(left, right, Class::Ordinary, size));
        block.last = Some(Edge::structure(right, right, Class::Ordinary, size));
        line.append(block, self.gaps());
        Ok(())
    }

    /// A fraction (template 11: slots numerator, denominator; variation 1 small) as the line's next element.
    pub(super) fn fraction(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let size = self.size;
        // a fraction inside another fraction or at a script size has the thinner bar
        let thin = self.in_fraction > 0 || size < self.type_size(RECORD_FULL);
        let thickness = self.spacing(
            if thin {
                INNER_BAR_THICKNESS
            } else {
                BAR_THICKNESS
            },
            size,
        );
        self.in_fraction += 1;
        let slots = self.slots(template);
        self.in_fraction -= 1;
        let (slots, _) = slots?;
        let mut slots = slots.into_iter().map(Option::unwrap_or_default);
        let (num, den) = (
            slots.next().unwrap_or_default(),
            slots.next().unwrap_or_default(),
        );
        // the overhang (in points) is for the full size and shrinks with the size; the bar's thickness does not
        let overhang = self.spacing(BAR_OVERHANG, size) * size / self.type_size(RECORD_FULL);
        // a part's width: its ink, to the space scripts leave after them
        let extent = |b: &Block| b.extent().unwrap_or((0, 0, 0, 0));
        let (nl, nr, _, nb) = extent(&num);
        let (dl, dr, dt, _) = extent(&den);
        let num_top = self.slot_top(&num);
        let den_top = self.slot_top(&den).max(dt);
        let length = (nr - nl).max(dr - dl) + 2 * overhang;
        let axis = axis(size);
        // half the bar rounded up to 3/16 pt at every size (half the 3/8 pt step of the gaps)
        let step = 3 * POINT / 16;
        let half = (thickness / 2 + step - 1) / step * step;
        // the numerator's ink and the denominator's top the minimum gap (setting 19) from the bar's edge at least (a
        // small fraction, variation 1: exactly)
        let keep = self.minimum_gap(size) + half;
        let (num_least, den_least) = (-nb + keep, den_top + keep);
        let (num_raise, den_drop) = if template.variation & 1 != 0 {
            (num_least, den_least)
        } else {
            (
                (self.spacing(NUMERATOR_HEIGHT, size) + half).max(num_least),
                (self.spacing(DENOMINATOR_DEPTH, size) + half).max(den_least),
            )
        };
        let mut block = Block::default();
        block.lines.push(Rule {
            from: (0, axis),
            to: (length, axis),
            width: thickness,
        });
        block.reserved = Some(axis + num_raise + num_top);
        block.take(num, (length - (nr - nl)) / 2 - nl, axis + num_raise);
        block.take(den, (length - (dr - dl)) / 2 - dl, axis - den_drop);
        let edge = |ink| Edge::structure(ink, length, Class::Inner, size);
        block.first = Some(edge(0));
        block.last = Some(edge(length));
        line.append(block, self.gaps());
        Ok(())
    }
}
