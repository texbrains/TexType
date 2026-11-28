//! Arrows over or under content (template 31) and wide accents over it (tilde 32, hat 33, arc 34), as MathType 6.9
//! draws them: MT Extra glyphs at the template's size.
//!
//! A glyph above the content has its ink bottom the plain gap (5/64 em) above the content's top (its line's em
//! ascent or ink, whichever reaches higher); one below, its ink top the plain gap below the content's ink.

use super::*;

/// MT Extra's arrow pieces: the shaft and, for a template character, the first piece, the last piece and the glyph
/// drawn alone over short content.
const SHAFT: u8 = 0x75;
fn arrow_pieces(code: u16) -> Option<(u8, u8, u8)> {
    Some(match code {
        0x20D7 => (SHAFT, 0x72, 0x72),
        0x20D6 => (0x73, SHAFT, 0x73),
        0x20E1 => (0x73, 0x72, 0x74),
        0x20D1 => (SHAFT, 0x76, 0x76),
        0x20D0 => (0x77, SHAFT, 0x77),
        _ => return None,
    })
}

/// A wide accent's MT Extra glyphs, narrowest first.
fn accent_glyphs(selector: u8) -> [u8; 4] {
    match selector {
        32 => [0x25, 0xB0, 0xB1, 0xB2],
        33 => [0x24, 0xB5, 0xB6, 0xB7],
        _ => [0x29, 0xBA, 0xBB, 0xBC],
    }
}

impl<'a> Layout<'a> {
    /// An arrow over or under content (template 31: the slot's content; variation 4 below; its template character
    /// U+20D7 right, U+20D6 left, U+20E1 both ways, U+20D1/U+20D0 harpoons) as the line's next element, as
    /// MathType's pictures show: pieces spanning the content's ink by their advances, the first at its start, the
    /// last (a head) ending at its end, shafts after the first every advance less half a point up to FENCE_GAP
    /// (38/384 em) before the last, and one more shaft that far before it when the last is still more than a step
    /// past them; content too short for a shaft has the one-piece arrow centred over it.
    pub(super) fn over_arrow(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let code = template_char(template);
        let (first, last, alone) = code
            .and_then(arrow_pieces)
            .ok_or_else(|| format!("not drawn yet: template 31 character {code:?}"))?;
        let size = self.size;
        let (slots, _) = self.slots(template)?;
        let content = slots.into_iter().next().flatten().unwrap_or_default();
        let piece = |byte: u8| self.glyph(&mt_extra(), Code::Symbol(byte), byte, 1, size);
        let advance = |g: &Glyph| Measure::scaled(g.measure.advance, size);
        let (cl, cr, _, cb) = content.extent().unwrap_or((0, 0, 0, 0));
        let gap = FENCE_GAP * size / 384;
        let head = piece(last)?;
        let place = |mut g: Glyph, x: i32| {
            g.x = x;
            g
        };
        let mut pieces = Vec::new();
        let head_at = cr - advance(&head) - cl;
        if head_at < gap {
            let g = piece(alone)?;
            let x = (cl + cr) / 2 - advance(&g) / 2;
            pieces.push(place(g, x));
        } else {
            let shaft = piece(SHAFT)?;
            let step = advance(&shaft) - POINT / 2;
            let mut at = 0;
            while at <= head_at - gap {
                let g = if at == 0 {
                    piece(first)?
                } else {
                    shaft.clone()
                };
                pieces.push(place(g, cl + at));
                at += step;
            }
            if head_at - (at - step) > step {
                pieces.push(place(shaft.clone(), cl + head_at - gap));
            }
            pieces.push(place(head, cl + head_at));
        }
        let below = template.variation & 4 != 0;
        let dy = if below {
            let top = pieces.iter().map(|g| g.ink().2).max().unwrap_or(0);
            cb - plain_gap(size) - top
        } else {
            let bottom = pieces.iter().map(|g| g.ink().3).min().unwrap_or(0);
            self.slot_top(&content) + plain_gap(size) - bottom
        };
        let mut block = Block::default();
        // the content's line keeps its height above an arrow below it
        if below {
            block.reserved = Some(self.slot_top(&content));
        }
        block.take(content, 0, 0);
        block.glyphs.extend(pieces.into_iter().map(|mut g| {
            g.y += dy;
            g
        }));
        self.finish_wide(block, line, size);
        Ok(())
    }

    /// A wide accent over content (template 32 tilde, 33 hat, 34 arc: the slot's content) as the line's next
    /// element, as MathType's pictures show: the content's width (its ink, to the space scripts leave after them)
    /// less FENCE_GAP (38/384 em) is the accent's; of its MT Extra glyphs the one whose ink ends nearest that width
    /// from its origin, stretched or narrowed sideways to it by its advance (the narrowest glyph never narrowed),
    /// centred on the content; the content's width counts in the frame.
    pub(super) fn wide_accent(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let size = self.size;
        let (slots, _) = self.slots(template)?;
        let content = slots.into_iter().next().flatten().unwrap_or_default();
        let (cl, cr, _, _) = content.extent().unwrap_or((0, 0, 0, 0));
        let target = cr - cl - FENCE_GAP * size / 384;
        let glyphs = accent_glyphs(template.selector)
            .into_iter()
            .map(|byte| self.glyph(&mt_extra(), Code::Symbol(byte), byte, 1, size))
            .collect::<Result<Vec<_>, _>>()?;
        let ink_end = |g: &Glyph| Measure::scaled(g.measure.right, size);
        let mut glyph = glyphs
            .iter()
            .min_by_key(|g| (ink_end(g) - target).abs())
            .expect("four glyphs")
            .clone();
        let advance = Measure::scaled(glyph.measure.advance, size);
        let narrowest = glyph.byte == glyphs[0].byte && target <= advance;
        let drawn = if narrowest {
            advance
        } else {
            // the font width MathType asks for: MT Extra's average width (`average_width`, 22 units a point) in
            // that proportion, rounded down
            let scale = |v: i64| (v * i64::from(target) / i64::from(advance.max(1))) as i32;
            let average = self.fonts.average_width(&mt_extra(), size).unwrap_or(0);
            glyph.width = scale(i64::from(average));
            glyph.wide = scale(i64::from(size));
            glyph.alone = true;
            target
        };
        glyph.x = (cl + cr) / 2 - drawn / 2;
        glyph.y = self.slot_top(&content) + plain_gap(size) - glyph.ink().3;
        let mut block = Block::default();
        block.boxes.push((cl, cr, 0, 0));
        block.take(content, 0, 0);
        block.glyphs.push(glyph);
        self.finish_wide(block, line, size);
        Ok(())
    }

    /// The structure's ends at its ink, spaced like an ordinary element.
    fn finish_wide(&self, mut block: Block, line: &mut Block, size: i32) {
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        block.first = Some(Edge::structure(left, right, Class::Ordinary, size));
        block.last = Some(Edge::structure(right, right, Class::Ordinary, size));
        line.append(block, self.gaps());
    }
}

fn mt_extra() -> Face {
    Face {
        name: "MT Extra".into(),
        bold: false,
        italic: false,
    }
}

/// A template's own fence-style character (typeface 22), as its MTCode.
fn template_char(template: &Template) -> Option<u16> {
    template.content.iter().find_map(|r| match r {
        Record::Char(c) if c.typeface.value == i32::from(TYPEFACE_FENCE) => c.mt_code,
        _ => None,
    })
}
