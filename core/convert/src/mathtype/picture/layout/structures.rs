//! The structures (templates and matrices) laid out: see the parent module's rules.

use super::*;

impl<'a> Layout<'a> {
    /// A fence template (0 angle, 1 parentheses, 2 braces, 3 brackets, 4 bars, 5 double bars; variation 1 left,
    /// 2 right) around its slot, as the line's next element. The fences are centred on the math axis and reach as
    /// far as the content's em box does from it, and the over-extension setting more.
    pub(super) fn fence(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        let (slots, _) = self.slots(template)?;
        // the fence's own characters come after its slot: their size is the one in force there
        let size = self.size;
        let content = slots.into_iter().next().flatten().unwrap_or_default();
        let axis = axis(size);
        let (cl, cr, _, _) = content.ink().unwrap_or((0, 0, 0, 0));
        let half = self.fence_half(&content);
        // the content's ink the fence gap from each fence's inner ink edge; its right side includes the gap scripts
        // leave after them
        let gap = self.spacing(FENCE_SPACE, self.spacing(ARROW_ROOM, size));
        let content_end = content.last.map_or(cr, |e| e.ink.max(cr));
        // each side's kind and whether it opens: a fence template's own kind on the sides its variation names; an
        // interval (9) a parenthesis or bracket facing either way on each side (variation: left nibble, right
        // nibble; 0 ( 1 ) 2 [ 3 ])
        let (left_side, right_side) = if template.selector == 9 {
            let side = |v: u16| match v & 0x0F {
                0 => (1, true),
                1 => (1, false),
                2 => (3, true),
                _ => (3, false),
            };
            (
                Some(side(template.variation)),
                Some(side(template.variation >> 4)),
            )
        } else {
            let s = template.selector;
            (
                (template.variation & 0x01 != 0).then_some((s, true)),
                (template.variation & 0x02 != 0).then_some((s, false)),
            )
        };
        let mut block = Block::default();
        let mut x = 0;
        if let Some((selector, opens)) = left_side {
            let left = self.fence_part(selector, opens, half, axis, size)?;
            let (ink_left, ink_right, _, _) = left.ink().unwrap_or((0, 0, 0, 0));
            block.take(left, -ink_left, 0);
            x = ink_right - ink_left + gap;
        }
        let content_right = x + content_end - cl;
        block.take(content, x - cl, 0);
        if let Some((selector, opens)) = right_side {
            let right = self.fence_part(selector, opens, half, axis, size)?;
            let (ink_left, _, _, _) = right.ink().unwrap_or((0, 0, 0, 0));
            block.take(right, content_right + gap - ink_left, 0);
        }
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        // a fence template spaces itself like an inner element (plain bracket characters are open and close)
        block.first = Some(Edge::structure(left, right, Class::Inner, size));
        // what follows starts at the right fence's ink when it is lines (angles, bars) or one stretched glyph, a
        // pixel past it when it is built from pieces (or there is no right fence)
        let stretched = right_side.is_some_and(|(s, _)| !self.fence_pieces(s, half, size));
        block.last = Some(if matches!(template.selector, 0 | 4 | 5) || stretched {
            Edge::structure(right, right, Class::Inner, size)
        } else {
            Edge::pixel_past(right, right, Class::Inner, size)
        });
        line.append(block, self.gaps());
        Ok(())
    }

    /// How far a fence around content reaches above and below the math axis: to the content's em box (its ink if
    /// that reaches further) and the over-extension setting more.
    fn fence_half(&self, content: &Block) -> i32 {
        let size = self.size;
        let axis = axis(size);
        let bottom = content.ink().map_or(0, |i| i.3);
        let descent = size - self.slot_top_of_size(content, size);
        let (top, bottom) = (self.slot_top(content), bottom.min(-descent));
        (top - axis).max(axis - bottom) + self.spacing(OVER_EXTENSION, size)
    }

    /// The bra-ket template (30: slots the bra's and the ket's content; variation 1 the bra ⟨content|, 2 the ket
    /// |content⟩, both ⟨content|content⟩): angle brackets and a bar as a fence draws them, all as high as the
    /// higher content needs, spaced like characters: the angles as opening and closing brackets, the bar as an inner
    /// element.
    pub(super) fn dirac(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        let (slots, _) = self.slots(template)?;
        // the template's own characters come after its slots: their size is the one in force there
        let size = self.size;
        let axis = axis(size);
        let mut slots = slots.into_iter();
        let (bra, ket) = (template.variation & 1 != 0, template.variation & 2 != 0);
        let bra = slots.next().flatten().filter(|_| bra);
        let ket = slots.next().flatten().filter(|_| ket);
        let half = bra
            .iter()
            .chain(&ket)
            .map(|c| self.fence_half(c))
            .max()
            .unwrap_or(size / 2);
        let part = |block: Block, class: Class| {
            let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
            Block {
                first: Some(Edge::structure(left, right, class, size)),
                last: Some(Edge::structure(right, right, class, size)),
                ..block
            }
        };
        let gaps = self.gaps();
        let mut block = Block::default();
        if let Some(content) = bra {
            block.append(
                part(self.fence_part(0, true, half, axis, size)?, Class::Open),
                gaps,
            );
            block.append(content, gaps);
        }
        block.append(
            part(self.fence_part(4, true, half, axis, size)?, Class::Inner),
            gaps,
        );
        if let Some(mut content) = ket {
            // the bar keeps its space before the slot as a whole: a space the slot starts with (MathType 7's
            // \middle| stores a thin one) comes after it (probe-pc/dk-*: 12/64 em more with any space's width)
            if let Some(first) = content.first.as_mut().filter(|f| f.class == Class::Space) {
                first.class = Class::Ordinary;
            }
            block.append(content, gaps);
            block.append(
                part(self.fence_part(0, false, half, axis, size)?, Class::Close),
                gaps,
            );
        }
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        block.first = Some(Edge::structure(left, right, Class::Inner, size));
        block.last = Some(Edge::structure(right, right, Class::Inner, size));
        line.append(block, gaps);
        Ok(())
    }

    /// One side of a fence reaching `half` above and below the axis: a Symbol bracket at the size whose ink spans
    /// that, bars as lines, an angle bracket as two strokes.
    pub(super) fn fence_part(
        &self,
        selector: u8,
        left: bool,
        half: i32,
        axis: i32,
        size: i32,
    ) -> Result<Block, String> {
        if self.fence_pieces(selector, half, size) {
            return self.fence_from_pieces(selector, left, half, axis, size);
        }
        let pen = self.spacing(BAR_THICKNESS, size);
        let mut block = Block::default();
        let vertical = |x: i32| Rule {
            from: (x, axis + half),
            to: (x, axis - half),
            width: pen,
            colour: UNSET,
        };
        match selector {
            // a single bar: its line and half a pen of room on its right
            4 => {
                block.lines.push(vertical(pen / 2));
                block
                    .boxes
                    .push((0, pen + pen / 2, axis + half, axis - half));
            }
            5 => block.lines.extend([
                vertical(pen / 2),
                vertical(pen / 2 + Measure::scaled(9, size)),
            ]),
            0 => {
                // as wide as 38/384 em and a fifth of its half height (rounded)
                let width = 38 * size / 384 + (half + 2) / 5;
                let (tip, ends) = if left {
                    (pen / 2, pen / 2 + width)
                } else {
                    (pen / 2 + width, pen / 2)
                };
                block.lines.push(Rule {
                    from: (ends, axis + half),
                    to: (tip, axis),
                    width: pen,
                    colour: UNSET,
                });
                block.lines.push(Rule {
                    from: (tip, axis),
                    to: (ends, axis - half),
                    width: pen,
                    colour: UNSET,
                });
            }
            _ => {
                let (font, byte) = match (selector, left) {
                    (1, true) => ("Symbol", b'('),
                    (1, false) => ("Symbol", b')'),
                    (2, true) => ("Symbol", b'{'),
                    (2, false) => ("Symbol", b'}'),
                    (8, true) => ("MT Extra", 0xA7),
                    (8, false) => ("MT Extra", 0xA8),
                    (_, true) => ("Symbol", b'['),
                    (_, false) => ("Symbol", b']'),
                };
                let face = Face {
                    name: font.into(),
                    bold: false,
                    italic: false,
                };
                let measure = self
                    .fonts
                    .measure(&face, Code::Symbol(byte))
                    .ok_or(format!("font {font} not installed"))?;
                let ink = (measure.top - measure.bottom).max(1);
                let height = 2 * half * PPEM / ink;
                // stretched only vertically: MathType names the font at the base size's average width, a unit
                // less (its scaled width lands just under the whole number)
                let width = self.fonts.average_width(&face, size).unwrap_or(0) - 1;
                // and measures it at the scale that makes the size 64 pixels per em: its height's pixels per em
                // rounded down, the font's own width (`measuring_width`), each inked edge back in units at the
                // height per pixel per em rounded toward zero, centred on the axis rounded down (probe-pc/fs2-*:
                // ( and { at 12 and 24 pt in steps of 1/96 em, every baseline; a brace's sides drop at 151 ppem)
                let ppem = (PPEM * height).div_euclid(size).max(1);
                // (its advance stays the size's: the picture's frame reaches as far as before)
                let measure = self
                    .fonts
                    .measuring_width(&face)
                    .and_then(|w| self.fonts.measure_stretched(&face, byte, ppem, w))
                    .map_or(measure.clone(), |m| Measure {
                        advance: measure.advance,
                        ..m
                    });
                let edge = |v: i32| (i64::from(v) * i64::from(height) / i64::from(ppem)) as i32;
                let y = axis - (edge(measure.top) + edge(measure.bottom)).div_euclid(2);
                block.glyphs.push(Glyph {
                    x: 0,
                    y,
                    face,
                    height,
                    charset: 1,
                    byte,
                    measure,
                    alone: true,
                    wide: size,
                    width,
                    ppem,
                    assumed: None,
                    run: 0,
                    colour: self.colour,
                    trail: None,
                    role: Role::Other,
                    line_start: false,
                });
            }
        }
        Ok(block)
    }

    /// Whether a fence reaching `half` from the axis is built from pieces rather than one stretched glyph: floors
    /// and ceilings always; others when the stretched glyph would be taller than MathType's limit for it in sizes:
    /// parentheses 2.44, braces 2.65, brackets 1.4, white brackets 1.5 (probe-pc/fs-*: the over-extension swept at
    /// 12 and 36 pt, the same switch at both; each value inside its measured step, e.g. parentheses 2.42-2.45 with
    /// the finer fs2-* steps at 12 and 24 pt).
    pub(super) fn fence_pieces(&self, selector: u8, half: i32, size: i32) -> bool {
        let (font, byte, limit) = match selector {
            6 | 7 => return true,
            1 => ("Symbol", b'(', 244),
            2 => ("Symbol", b'{', 265),
            3 => ("Symbol", b'[', 140),
            8 => ("MT Extra", 0xA7, 150),
            _ => return false,
        };
        let face = Face {
            name: font.into(),
            bold: false,
            italic: false,
        };
        let Some(measure) = self.fonts.measure(&face, Code::Symbol(byte)) else {
            return false;
        };
        let stretched = 2 * half * PPEM / (measure.top - measure.bottom).max(1);
        stretched * 100 > size * limit
    }

    /// A fence from pieces at the size (Symbol's; MT Extra's for white brackets): the end pieces' ink at the
    /// fence's ends (floors and ceilings use the extension for the missing end), a brace's middle centred; between
    /// two fixed pieces whose inks overlap by less than a point an extension, its ink overlapping the ink above by
    /// half a point (a parenthesis' first one a point), and more while the last one overlaps the piece below by less
    /// than half a point; each one no lower than MathType's limit above the piece below (probe-pc/fs-*).
    pub(super) fn fence_from_pieces(
        &self,
        selector: u8,
        left: bool,
        half: i32,
        axis: i32,
        size: i32,
    ) -> Result<Block, String> {
        // (top, extension, bottom, middle) for the left side; the right side's are 0x10 higher
        let (top, extension, bottom, middle) = match selector {
            1 => (0xE6, 0xE7, 0xE8, None),
            2 => (0xEC, 0xEF, 0xEE, Some(0xED)),
            6 => (0xEA, 0xEA, 0xEB, None),
            7 => (0xE9, 0xEA, 0xEA, None),
            8 => (0xA9, 0xAA, 0xAB, None),
            _ => (0xE9, 0xEA, 0xEB, None),
        };
        // the right side's pieces: Symbol's 0x10 higher, MT Extra's 3
        let right = |byte: u8| match (left, selector) {
            _ if left || byte == 0xEF => byte,
            (_, 8) => byte + 3,
            _ => byte + 0x10,
        };
        let face = Face {
            name: if selector == 8 { "MT Extra" } else { "Symbol" }.into(),
            bold: false,
            italic: false,
        };
        let ink = |byte: u8| -> Result<(i32, i32), String> {
            let m = self
                .fonts
                .measure(&face, Code::Symbol(byte))
                .ok_or(format!("font {} not installed", face.name))?;
            Ok((
                Measure::scaled(m.top, size),
                Measure::scaled(m.bottom, size),
            ))
        };
        let (top_ink, extension_ink, bottom_ink) = (ink(top)?, ink(extension)?, ink(bottom)?);
        let overlap = POINT / 2 * size / self.type_size(RECORD_FULL);
        let top_y = axis + half - top_ink.0;
        let bottom_y = axis - half - bottom_ink.1;
        let mut pieces: Vec<(u8, i32)> = vec![(right(top), top_y), (right(bottom), bottom_y)];
        // how low an extension may go above the piece below, in 384ths of the size (MathType's own values, the
        // same at 12 and 36 pt): a parenthesis' 241, a bracket's 65, a white bracket's 23, a brace's 57 above its
        // bottom piece and 288 above its middle
        let lowest = |limit: i32| limit * size / 384;
        let bottom_lowest = lowest(match selector {
            1 => 241,
            2 => 57,
            3 => 65,
            8 => 23,
            _ => -384,
        });
        // the extensions between a fixed piece above (its ink bottom `cover`, y up) and one below (its baseline
        // `to`, ink top `to + top`)
        let stack =
            |mut cover: i32, to: i32, top: i32, lowest: i32, pieces: &mut Vec<(u8, i32)>| {
                let (mut need, mut lap) = (
                    2 * overlap,
                    if selector == 1 { 2 * overlap } else { overlap },
                );
                while to + top - cover < need {
                    let y = cover + lap - extension_ink.0;
                    pieces.push((right(extension), y.max(to + lowest)));
                    cover = y + extension_ink.1;
                    (need, lap) = (overlap, overlap);
                }
            };
        match middle {
            Some(middle) => {
                let middle_ink = ink(middle)?;
                let middle_y = axis - (top_ink.0 + bottom_ink.1) / 2;
                pieces.push((right(middle), middle_y));
                stack(
                    top_y + top_ink.1,
                    middle_y,
                    middle_ink.0,
                    lowest(288),
                    &mut pieces,
                );
                stack(
                    middle_y + middle_ink.1,
                    bottom_y,
                    bottom_ink.0,
                    bottom_lowest,
                    &mut pieces,
                );
            }
            None => stack(
                top_y + top_ink.1,
                bottom_y,
                bottom_ink.0,
                bottom_lowest,
                &mut pieces,
            ),
        }
        let mut block = Block::default();
        for (byte, y) in pieces {
            let measure = self
                .fonts
                .measure(&face, Code::Symbol(byte))
                .ok_or(format!("font {} not installed", face.name))?;
            block.glyphs.push(Glyph {
                x: 0,
                y,
                face: face.clone(),
                height: size,
                charset: 1,
                byte,
                measure,
                alone: false,
                wide: size,
                width: 0,
                ppem: PPEM,
                assumed: None,
                run: 0,
                colour: self.colour,
                trail: None,
                role: Role::Other,
                line_start: false,
            });
        }
        // the pieces share one origin
        Ok(block)
    }

    /// An underbar or overbar (templates 12, 13: slot the content) as the line's next element: a line of the bar
    /// thickness (setting 12) along the content's ink, its middle the bar distance (`bar_distance`) above the
    /// content's line top (overbar) or below its ink bottom (underbar); the content keeps its line's height.
    pub(super) fn bar(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        let size = self.size;
        let (slots, _) = self.slots(template)?;
        let mut block = slots.into_iter().next().flatten().unwrap_or_default();
        let (left, right, _, bottom) = block.ink().unwrap_or((0, 0, 0, 0));
        let y = if template.selector == 13 {
            self.slot_top(&block) + self.bar_distance(size)
        } else {
            bottom - self.bar_distance(size)
        };
        let width = self.spacing(BAR_THICKNESS, size);
        block.lines.push(Rule {
            from: (left, y),
            to: (right, y),
            width,
            colour: UNSET,
        });
        // the content keeps its line's height
        let top = self.slot_top(&block);
        block.reserved = Some(block.reserved.map_or(top, |r| r.max(top)));
        block.first = Some(Edge::structure(left, right, Class::Ordinary, size));
        block.last = Some(Edge::enclosure(right, size));
        line.append(block, self.gaps());
        Ok(())
    }

    /// A strike-through (template 36: slot the content; variation 2 rising, 4 falling, both crossed) as the
    /// line's next element: diagonals with a pen of the strike-through thickness (setting 26) from the content's
    /// ink less the enclosure padding (setting 20) and half the pen to the same after it, from the padding below its
    /// ink to the padding above its line top.
    pub(super) fn strike(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        if template.variation & 0x01 != 0 {
            return Err("not drawn yet: horizontal strike-through".into());
        }
        let size = self.size;
        let (slots, _) = self.slots(template)?;
        let mut block = slots.into_iter().next().flatten().unwrap_or_default();
        // MathType draws the struck content as texts of its own
        self.runs += 1;
        block.glyphs.iter_mut().for_each(|g| g.run = self.runs);
        let (left, right, _, bottom) = block.ink().unwrap_or((0, 0, 0, 0));
        let pad = self.spacing(ENCLOSURE_PADDING, size);
        let width = self.spacing(STRIKE_THICKNESS, size);
        let side = pad - width / 2;
        let (left, right) = (left - side, right + side);
        let (top, bottom) = (self.slot_top(&block) + pad, bottom - pad);
        if template.variation & 0x02 != 0 {
            block.lines.push(Rule {
                from: (left, bottom),
                to: (right, top),
                width,
                colour: UNSET,
            });
        }
        if template.variation & 0x04 != 0 {
            block.lines.push(Rule {
                from: (left, top),
                to: (right, bottom),
                width,
                colour: UNSET,
            });
        }
        // spaced by its box, the content's ink and the padding on each side; a letter after it starts at the box
        // with no plain gap, a digit or a structure keeps it (probe-pc/st-*: a struck n then p, 2, another one)
        let (box_left, box_right) = (left + side - pad, right - side + pad);
        block.first = Some(Edge::structure(box_left, box_right, Class::Ordinary, size));
        block.last = Some(Edge::enclosure(box_right, size));
        line.append(block, self.gaps());
        Ok(())
    }

    /// A box (template 37: slot the content; variation sides 2 left, 4 right, 8 top, 16 bottom) as the line's next
    /// element: lines of the box thickness (setting 25) whose middles are the enclosure padding (setting 20) and
    /// half the pen outside the content (its ink start, its spacing end, its line top, its ink bottom); each side
    /// reaches the others' outer edges, or the content's edge where a side is left out (left and top, right and
    /// bottom: probe-pc/bs-*).
    pub(super) fn boxed(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        if template.variation & 0x01 != 0 {
            return Err("not drawn yet: rounded box".into());
        }
        let size = self.size;
        let (slots, _) = self.slots(template)?;
        let mut block = slots.into_iter().next().flatten().unwrap_or_default();
        let (ink_left, ink_right, _, ink_bottom) = block.ink().unwrap_or((0, 0, 0, 0));
        let end = block.last.map_or(ink_right, |l| l.ink.max(ink_right));
        let pad = self.spacing(ENCLOSURE_PADDING, size);
        let width = self.spacing(BOX_THICKNESS, size);
        let (low, high) = (width / 2, (width + 1) / 2);
        let left = ink_left - pad - high;
        let right = end + pad + low;
        let top = self.slot_top(&block) + pad + high;
        let bottom = ink_bottom - pad - low;
        let v = template.variation;
        let side = |bit: u16| v & bit != 0;
        let (top_end, bottom_end) = (
            if side(0x08) {
                top + low
            } else {
                self.slot_top(&block)
            },
            if side(0x10) {
                bottom - high
            } else {
                ink_bottom
            },
        );
        let (left_end, right_end) = (
            if side(0x02) { left - low } else { ink_left },
            if side(0x04) { right + high } else { end },
        );
        let vertical = |x| Rule {
            from: (x, top_end),
            to: (x, bottom_end),
            width,
            colour: UNSET,
        };
        let horizontal = |y| Rule {
            from: (left_end, y),
            to: (right_end, y),
            width,
            colour: UNSET,
        };
        if v & 0x02 != 0 {
            block.lines.push(vertical(left));
        }
        if v & 0x04 != 0 {
            block.lines.push(vertical(right));
        }
        if v & 0x08 != 0 {
            block.lines.push(horizontal(top));
        }
        if v & 0x10 != 0 {
            block.lines.push(horizontal(bottom));
        }
        let (l, r) = block.ink().map_or((left, right), |i| (i.0, i.1));
        block.first = Some(Edge::structure(l, r, Class::Ordinary, size));
        block.last = Some(Edge::enclosure(r, size));
        line.append(block, self.gaps());
        Ok(())
    }

    /// A root (template 10: slots radicand, index) as the line's next element. MathType draws the radical as a
    /// thin polyline and a filled outline of its strokes (`radical::shape`, from the radical width and thickness,
    /// settings 22 and 28, a zero one the default): the bottom point the over-extension (setting 15) below the
    /// radicand's ink, the bar as described in the body; an index centred over the tick by its ink, as the body
    /// describes.
    pub(super) fn root(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        let size = self.size;
        let s = |v: i32| v * size / 384;
        let (slots, _) = self.slots(template)?;
        let mut slots = slots.into_iter();
        let radicand = slots.next().flatten().unwrap_or_default();
        let index = slots.next().flatten().filter(|b| !b.glyphs.is_empty());
        let (rl, rr, _, rb) = radicand.ink().unwrap_or((0, 0, 0, 0));
        let right_end = radicand.last.map_or(rr, |e| e.ink.max(rr));
        // the bar: its lower edge the enclosure padding over the radicand's line, the radical thickness thick, a
        // point past the radicand's ink; the radicand's ink the radical gap after the radical's top corner
        let pen = match self.spacing(RADICAL_THICKNESS, size) {
            0 => (f64::from(size) * DEFAULT_SPACING[RADICAL_THICKNESS].1 / 100.0) as i32,
            pen => pen,
        };
        let width = match self.spacing_exact(RADICAL_WIDTH, 100) / 100.0 {
            w if w > 0.0 => w,
            _ => 1.0,
        };
        let half = pen / 2;
        let top = self.slot_top(&radicand) + self.spacing(ENCLOSURE_PADDING, size) + (pen + 1) / 2;
        let bottom = rb - self.spacing(OVER_EXTENSION, size);
        let height = top - bottom;
        let at = |fraction: i32| bottom + height * fraction / 1000;
        let content_dx =
            (230.0 * width * f64::from(size) / 384.0) as i32 + self.spacing(RADICAL_GAP, size) - rl;
        let bar_end = content_dx + right_end + POINT;
        let mut block = Block::default();
        let (polyline, outline) = radical::shape(width, size, pen, top + half - bottom, bar_end);
        let lift = |points: Vec<(i32, i32)>| points.into_iter().map(|(x, y)| (x, y + bottom));
        let polyline: Vec<(i32, i32)> = lift(polyline).collect();
        for pair in polyline.windows(2) {
            block.lines.push(Rule {
                from: pair[0],
                to: pair[1],
                width: 0,
                colour: UNSET,
            });
        }
        block.polygons.push(Shape {
            points: lift(outline).collect(),
            colour: UNSET,
        });
        block.take(radicand, content_dx, 0);
        if let Some(index) = index {
            let (il, ir, _, ib) = index.ink().unwrap_or((0, 0, 0, 0));
            // its ink centred (91.5 w - 12.5)/384 em from the tip, its right edge no further than twice that (a
            // wider one reaches left of the tip: the radical moves right), its ink bottom 34/384 em over the
            // tick's middle height (probe-pc/ri-*: indexes 3 n 10 abc wxyz, the radical width 50-300 % at 12 and
            // 24 pt)
            let limit = ((183.0 * width - 25.0) * f64::from(size) / 384.0) as i32;
            let right = ((limit + ir - il) / 2).min(limit);
            let ink_bottom = at(378) + s(34) + (height - s(407)) * 143 / 10000;
            block.take(index, right - ir, ink_bottom - ib);
        }
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        let edge = |ink| Edge::structure(ink, right, Class::Ordinary, size);
        block.first = Some(edge(left));
        block.last = Some(Edge::enclosure(right, size));
        line.append(block, self.gaps());
        Ok(())
    }
}
