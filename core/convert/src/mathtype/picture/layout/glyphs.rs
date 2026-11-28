//! Characters as glyph blocks: a character of a typeface, a fence-style character, a space (see the parent
//! module's rules).

use super::*;

impl Layout<'_> {
    /// A character as a one-glyph block, or None for what draws nothing (MathType's markers).
    pub(super) fn char(&mut self, c: &Char) -> Result<Option<Block>, String> {
        let typeface = c.typeface.value;
        if typeface == i32::from(TYPEFACE_MARKER) {
            return Ok(None);
        }
        if typeface == i32::from(TYPEFACE_SPACE) {
            return Ok(self.space(c));
        }
        if typeface == i32::from(TYPEFACE_FENCE) {
            return self.fence_style(c).map(Some);
        }
        let (font, style) = self
            .font_of(typeface)
            .ok_or_else(|| format!("no font for typeface {typeface}"))?;
        let face = Face {
            name: font.name.clone(),
            bold: style & 0x01 != 0,
            italic: style & 0x02 != 0,
        };
        let (charset, byte, trail, code) =
            encode(font, c).ok_or_else(|| format!("cannot draw character {:?}", c.mt_code))?;
        let size = self.size;
        // a character its font lacks (SimSun's ∬ and ℓ) is measured from the font Windows links in for it
        let glyph = self.glyph(&face, code, byte, charset, size)?;
        let ch = c.mt_code.and_then(|m| char::from_u32(u32::from(m)));
        let class = class(typeface, ch);
        let role = match ch {
            _ if class == Class::Relation => Role::Relation,
            Some('0'..='9') => Role::Digit,
            Some('.') => Role::Point,
            _ => Role::Other,
        };
        let glyph = Glyph {
            trail,
            role,
            ..glyph
        };
        let advance = Measure::scaled(glyph.measure.advance, size);
        let (left, right, _, _) = glyph.ink();
        let font_number = self.font_defs.iter().position(|f| std::ptr::eq(f, font));
        let joins = match joins(
            typeface,
            c.mt_code.and_then(|m| char::from_u32(u32::from(m))),
            class,
        ) {
            Joins::Differential if typeface < 0 && face.italic => Joins::Slanted,
            Joins::Differential if typeface < 0 => Joins::Named,
            other => other,
        };
        let edge = |ink| Edge {
            ink,
            end: advance,
            class,
            typeface: Some(typeface),
            font: font_number,
            joins,
            size,
            gap: true,
            past: 0,
        };
        let first = if c.options & CHAR_FUNCTION_START != 0 {
            Edge {
                joins: Joins::Start,
                ..edge(left)
            }
        } else {
            edge(left)
        };
        let mut block = Block {
            glyphs: vec![glyph],
            first: Some(first),
            last: Some(edge(right)),
            ..Block::default()
        };
        if !c.embellishments.is_empty() {
            self.embellish(&mut block, &c.embellishments, size)?;
        }
        Ok(Some(block))
    }

    /// A fence-style character outside a fence template (a brace over or under a limit's content): MathType draws
    /// its MT Extra glyph unstretched at the size, as a text of its own (︷ 0x7D, ︸ 0x7B), giving it no room:
    /// its ink a point at its origin, its em box that of no font.
    pub(super) fn fence_style(&self, c: &Char) -> Result<Block, String> {
        let byte = match c.mt_code.and_then(|m| char::from_u32(u32::from(m))) {
            Some('\u{FE37}' | '\u{23DE}') => 0x7D,
            Some('\u{FE38}' | '\u{23DF}') => 0x7B,
            other => return Err(format!("not drawn yet: fence-style character {other:?}")),
        };
        let face = Face {
            name: "MT Extra".into(),
            bold: false,
            italic: false,
        };
        let size = self.size;
        let glyph = Glyph {
            alone: true,
            assumed: Some(NO_ROOM),
            ..self.glyph(&face, Code::Symbol(byte), byte, 1, size)?
        };
        let (left, right, _, _) = glyph.ink();
        let advance = Measure::scaled(glyph.measure.advance, size);
        Ok(Block {
            glyphs: vec![glyph],
            first: Some(Edge::structure(left, advance, Class::Ordinary, size)),
            last: Some(Edge::structure(right, advance, Class::Ordinary, size)),
            ..Block::default()
        })
    }

    /// A glyph of a face at a size, measured from the font file, or by MathType's own box where MathType has one
    /// for it.
    pub(super) fn glyph(
        &self,
        face: &Face,
        code: Code,
        byte: u8,
        charset: u8,
        size: i32,
    ) -> Result<Glyph, String> {
        let measure = self.fonts.measure(face, code).ok_or_else(|| {
            format!(
                "font {} {}{}not installed or without the character",
                face.name,
                if face.bold { "bold " } else { "" },
                if face.italic { "italic " } else { "" }
            )
        })?;
        let assumed = mathtype_box(&face.name, byte, &measure, size, false);
        Ok(Glyph {
            x: 0,
            y: 0,
            face: face.clone(),
            height: size,
            charset,
            byte,
            measure,
            alone: false,
            wide: size,
            width: 0,
            ppem: PPEM,
            assumed,
            run: 0,
            colour: self.colour,
            trail: None,
            role: Role::Other,
            line_start: false,
        })
    }

    /// A space as an invisible box (see the module comment); the zero space a box without ends, which its
    /// neighbours space through, moving what follows 4/64 em back (MathType's pictures: a EF01 b, b 24 units
    /// before a's advance at 12 pt).
    pub(super) fn space(&self, c: &Char) -> Option<Block> {
        let size = self.size;
        let face = self.text_face();
        // the widths in 64ths of the em for Times New Roman, whose space is a quarter em: in another text font a
        // quarter of that many of its spaces (an em space four of them: Arial's 18/64 em space, Courier New's
        // 38/64; probe-pc/sp2-alone-arial*, -couriernew*, sp3-*)
        let space = face
            .as_ref()
            .and_then(|f| self.fonts.measure(f, Code::Unicode(' ')))
            .map_or(16, |m| m.advance);
        let of_spaces = |n: i32| Measure::scaled(n * space, size) / 16;
        let width = match c.mt_code {
            Some(0xEF01) => 0,
            Some(0xEF08) => POINT * size / self.type_size(RECORD_FULL),
            Some(0xEF09 | 0xEF0A) => of_spaces(2),
            Some(0xEF00 | 0xEF07) => of_spaces(6),
            Some(0xEF02) => of_spaces(12),
            Some(0xEF04) => of_spaces(18),
            Some(0xEF05) => of_spaces(64),
            Some(0xEF06) => of_spaces(128),
            // MathType 5's spaces (U+EB00 ...), their widths at 12 pt as MathType 6.9 draws them
            Some(code @ 0xEB00..=0xEB0A) => {
                let at_12pt = [228, 228, 288, 648, 228, 228, 1332, 72, 1616, 372, 2976];
                at_12pt[usize::from(code - 0xEB00)] * size / 384
            }
            _ => of_spaces(14),
        };
        let ascent = self.text_em_ascent(size);
        let ends = width > 0;
        // a space reaches down the text font's descent and up its x-height (x's ink top at 64 ppem: 29/64 em in
        // Times New Roman, 33/64 in Arial, 27/64 in Courier New; probe-pc/sp2-alone-size-8 ... 30, sp-*-alone,
        // sp2-dot-q, sp2-alone-arial*, -couriernew*); the zero space not up
        let top = face
            .as_ref()
            .filter(|_| ends)
            .and_then(|f| self.fonts.measure(f, Code::Unicode('x')))
            .map_or(0, |m| Measure::scaled(m.top, size));
        let bottom = ascent - size;
        let edge = |ink| Edge::structure(ink, width, Class::Space, size);
        Some(Block {
            first: ends.then(|| edge(0)),
            last: ends.then(|| edge(width)),
            boxes: vec![(0, width, top, bottom)],
            // in a template's slot the line reaches the text font's em ascent, as a character's does
            space_top: Some(ascent),
            shift: if ends { 0 } else { -Measure::scaled(4, size) },
            ..Block::default()
        })
    }

    /// The text style's face.
    pub(super) fn text_face(&self) -> Option<Face> {
        self.font_of(i32::from(TYPEFACE_TEXT))
            .map(|(font, style)| Face {
                name: font.name.clone(),
                bold: style & 1 != 0,
                italic: style & 2 != 0,
            })
    }

    /// The text style's em ascent at a size (three quarters of it without the font).
    pub(super) fn text_em_ascent(&self, size: i32) -> i32 {
        self.text_face()
            .and_then(|f| self.fonts.em_ascent(&f, size))
            .unwrap_or(size * 3 / 4)
    }

    /// An empty line (a template's empty slot, an equation without a line): an invisible box on the baseline as
    /// high as the text font's em ascent and half as wide (Times New Roman and Arial 147 units at 12 pt, Courier
    /// New 132; probe-pc/sp-empty-*, sp-none*, sp3-empty-*, sp3-none-*).
    pub(super) fn empty_line(&self) -> Block {
        let size = self.size;
        let ascent = self.text_em_ascent(size);
        let width = ascent / 2;
        let edge = |ink| Edge {
            joins: Joins::Empty,
            ..Edge::structure(ink, width, Class::Ordinary, size)
        };
        Block {
            first: Some(edge(0)),
            last: Some(edge(width)),
            boxes: vec![(0, width, ascent, 0)],
            space_top: Some(ascent),
            ..Block::default()
        }
    }
}
