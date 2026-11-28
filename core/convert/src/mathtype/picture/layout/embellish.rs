//! Embellishments: accents over and under a character, primes after it, bars through it (see the parent
//! module's rules).

use super::*;

/// What an embellishment draws.
#[derive(Clone, Copy)]
enum Kind {
    /// primes (Symbol's prime) after the character, so many
    Primes(usize),
    /// the reversed prime (the text font's grave accent) before the character
    BackPrime,
    /// an accent glyph so many times over (true) or under (false) the character
    Mark(Accent, usize, bool),
    /// a line through, over or under the character
    Bar(Bar),
    /// the negation slash (Symbol's /) across the character
    Not,
}

/// An accent's glyph: an MT Extra byte, or the text font's circumflex.
#[derive(Clone, Copy)]
enum Accent {
    Extra(u8),
    Hat,
}

#[derive(Clone, Copy, PartialEq)]
enum Bar {
    Over,
    Under,
    Middle,
    Cross,
    Up,
    Down,
}

/// An MTEF embellishment's kind (the glyphs MathType's pictures show).
fn kind(code: u8) -> Option<Kind> {
    use Accent::*;
    use Kind::*;
    let over = |a, n| Some(Mark(a, n, true));
    let under = |a, n| Some(Mark(a, n, false));
    match code {
        EMBELL_PRIME => Some(Primes(1)),
        EMBELL_DOUBLE_PRIME => Some(Primes(2)),
        EMBELL_TRIPLE_PRIME => Some(Primes(3)),
        EMBELL_BACK_PRIME => Some(BackPrime),
        EMBELL_DOT => over(Extra(0x26), 1),
        EMBELL_DOUBLE_DOT => over(Extra(0x26), 2),
        EMBELL_TRIPLE_DOT => over(Extra(0x26), 3),
        EMBELL_QUADRUPLE_DOT => over(Extra(0x26), 4),
        EMBELL_TILDE => over(Extra(0x25), 1),
        EMBELL_HAT => over(Hat, 1),
        EMBELL_RIGHT_ARROW => over(Extra(0x72), 1),
        EMBELL_LEFT_ARROW => over(Extra(0x73), 1),
        EMBELL_BOTH_ARROW => over(Extra(0x74), 1),
        EMBELL_RIGHT_HARPOON => over(Extra(0x76), 1),
        EMBELL_LEFT_HARPOON => over(Extra(0x77), 1),
        EMBELL_FROWN => over(Extra(0x29), 1),
        EMBELL_BREVE => over(Extra(0x28), 1),
        EMBELL_UNDER_DOT => under(Extra(0x26), 1),
        EMBELL_UNDER_DOUBLE_DOT => under(Extra(0x26), 2),
        EMBELL_UNDER_TRIPLE_DOT => under(Extra(0x26), 3),
        EMBELL_UNDER_QUADRUPLE_DOT => under(Extra(0x26), 4),
        EMBELL_UNDER_TILDE => under(Extra(0x25), 1),
        EMBELL_UNDER_FROWN => under(Extra(0x29), 1),
        EMBELL_UNDER_SMILE => under(Extra(0x28), 1),
        EMBELL_UNDER_RIGHT_ARROW => under(Extra(0x72), 1),
        EMBELL_UNDER_LEFT_ARROW => under(Extra(0x73), 1),
        EMBELL_UNDER_BOTH_ARROW => under(Extra(0x74), 1),
        EMBELL_UNDER_RIGHT_HARPOON => under(Extra(0x78), 1),
        EMBELL_UNDER_LEFT_HARPOON => under(Extra(0x71), 1),
        EMBELL_OVERBAR => Some(Bar(self::Bar::Over)),
        EMBELL_UNDERBAR => Some(Bar(self::Bar::Under)),
        EMBELL_MIDBAR => Some(Bar(self::Bar::Middle)),
        EMBELL_CROSS_BARS => Some(Bar(self::Bar::Cross)),
        EMBELL_UP_BAR => Some(Bar(self::Bar::Up)),
        EMBELL_DOWN_BAR => Some(Bar(self::Bar::Down)),
        EMBELL_NOT => Some(Not),
        _ => None,
    }
}

impl Layout<'_> {
    /// How far an overbar's or underbar's middle lies from what it is over or under (templates and embellishments
    /// alike): the embellishment gap (setting 23), 3/8 point and a quarter of the bar thickness (setting 12; the
    /// point and the thickness at every size).
    pub(super) fn bar_distance(&self, size: i32) -> i32 {
        self.spacing(EMBELLISHMENT_GAP, size)
            + 3 * POINT / 8
            + self.spacing(BAR_THICKNESS, size) / 4
    }

    /// A character's embellishments: accents stacked above its ink (under ones below it) by the embellishment gap
    /// (setting 23), centred on its accent point, several dots two dot widths apart; primes (Symbol, full size)
    /// after its ink by the script room (`script_room`), their ink from the prime height (setting 24) up, the
    /// reversed prime as far before it; the overbar and underbar lines half an em long.
    pub(super) fn embellish(
        &mut self,
        block: &mut Block,
        embellishments: &[Record],
        size: i32,
    ) -> Result<(), String> {
        let base = block.glyphs[0].clone();
        let (base_left, base_right, base_top, base_bottom) = base.ink();
        let centre = accent_centre(&base, self.fonts);
        let ink_centre = (base_left + base_right) / 2;
        let gap = self.spacing(EMBELLISHMENT_GAP, size);
        let (mut top, mut bottom) = (base_top, base_bottom);
        let text_face = self
            .font_of(i32::from(TYPEFACE_TEXT))
            .map(|(font, _)| Face {
                name: font.name.clone(),
                bold: false,
                italic: false,
            });
        let face = |name: &str| Face {
            name: name.into(),
            bold: false,
            italic: false,
        };
        let (symbol, extra) = (face("Symbol"), face("MT Extra"));
        for record in embellishments {
            // a colour among them holds for the embellishments after it and what follows the character
            let Record::Embellishment(e) = record else {
                if let Record::Color(index) = record {
                    self.colour = u32::from(index.value);
                }
                continue;
            };
            let glyph = |face: &Face, code: Code, byte: u8, charset: u8| {
                self.glyph(face, code, byte, charset, size)
            };
            let kind = kind(e.kind).ok_or(format!("not drawn yet: embellishment {}", e.kind))?;
            match kind {
                Kind::Primes(count) => {
                    let mut prime = glyph(&symbol, Code::Symbol(0xA2), 0xA2, 1)?;
                    prime.y = self.spacing(PRIME_HEIGHT, size)
                        - Measure::scaled(prime.measure.bottom, size);
                    // its ink the script room past the base's
                    prime.x = base_right + self.script_room(size)
                        - Measure::scaled(prime.measure.left, size);
                    // primes follow each other by their ink's width
                    let advance = Measure::scaled(prime.measure.right - prime.measure.left, size);
                    for _ in 0..count {
                        block.glyphs.push(prime.clone());
                        prime.x += advance;
                    }
                    let right = block.glyphs.last().map_or(base_right, |g| g.ink().1);
                    if let Some(last) = &mut block.last {
                        // what joins by advance follows at the base's advance and 8/64 em (in 64 ppem pixels),
                        // the script room and a prime's step for each further prime (x′x, a′b, A′x, f′x, 1′2
                        // at 10, 12 and 24 pt, Cambria, double primes: probe-pc/emb-*-05-*, -06-*)
                        let end = base.x
                            + Measure::scaled(base.measure.advance + 8, size)
                            + self.script_room(size)
                            + advance * (count as i32 - 1);
                        *last = Edge {
                            end,
                            ink: last.ink.max(right),
                            ..*last
                        };
                    }
                }
                Kind::BackPrime => {
                    let text = text_face.as_ref().ok_or("no text font")?;
                    let mut prime = glyph(text, Code::Unicode('`'), 0x60, 0)?;
                    prime.y = self.spacing(PRIME_HEIGHT, size)
                        - Measure::scaled(prime.measure.bottom, size);
                    // its ink the script room before the base's, less the base's slant
                    prime.x = base_left - self.script_room(size)
                        + scripts::slant(&block.glyphs[..1], self.fonts)
                        - Measure::scaled(prime.measure.right, size);
                    let left = prime.ink().0;
                    if let Some(first) = &mut block.first {
                        first.ink = first.ink.min(left);
                    }
                    block.glyphs.push(prime);
                }
                Kind::Bar(bar) => {
                    let pen = self.spacing(BAR_THICKNESS, size);
                    // bars through the character reach an eighth of an em past its ink on every side
                    let reach = size / 8;
                    let (left, right) = (base_left - reach, base_right + reach);
                    let (high, low) = (base_top + reach, base_bottom - reach);
                    let (from, to) = match bar {
                        Bar::Over => {
                            let y = top + self.bar_distance(size);
                            top = y + pen / 2;
                            ((centre - size / 4, y), (centre + size / 4, y))
                        }
                        Bar::Under => {
                            let y = bottom - self.bar_distance(size);
                            bottom = y - pen / 2;
                            ((ink_centre - size / 4, y), (ink_centre + size / 4, y))
                        }
                        Bar::Middle => {
                            let y = (base_top + base_bottom) / 2 + pen / 4;
                            ((left, y), (right, y))
                        }
                        // corner to corner, half the pen inside sideways
                        Bar::Up => ((right - pen / 2, high), (left + pen / 2, low)),
                        Bar::Down | Bar::Cross => ((left + pen / 2, high), (right - pen / 2, low)),
                    };
                    // bars through the character count for the spacing around it, the overbar and underbar
                    // where they are drawn (what follows x̄ Ā f̄ ȳ 1̄ the same way from the line's end:
                    // probe/emb-*-17; writer/layout-wide-0411)
                    let (left, right) = match bar {
                        Bar::Over | Bar::Under => (from.0, to.0),
                        _ => (left, right),
                    };
                    if let Some(first) = &mut block.first {
                        first.ink = first.ink.min(left);
                    }
                    if let Some(last) = &mut block.last {
                        last.ink = last.ink.max(right);
                    }
                    block.lines.push(Rule {
                        from,
                        to,
                        width: pen,
                    });
                    if bar == Bar::Cross {
                        block.lines.push(Rule {
                            from: (to.0, from.1),
                            to: (from.0, to.1),
                            width: pen,
                        });
                    }
                }
                Kind::Not => {
                    // centred on the character's ink both ways
                    let mut slash = glyph(&symbol, Code::Symbol(0x2F), 0x2F, 1)?;
                    let (l, r, t, b) = slash.ink();
                    slash.x = (base_left + base_right) / 2 - (l + r) / 2;
                    slash.y = (base_top + base_bottom) / 2 - (t + b) / 2;
                    block.glyphs.push(slash);
                }
                // accents: centred on the accent point by ink, their ink the embellishment gap above (below) the
                // character, several of one kind two ink widths apart
                Kind::Mark(accent, count, over) => {
                    let mut glyph = match accent {
                        Accent::Hat => glyph(
                            text_face.as_ref().ok_or("no text font")?,
                            Code::Unicode('\u{2C6}'),
                            0x88,
                            0,
                        )?,
                        Accent::Extra(byte) => glyph(&extra, Code::Symbol(byte), byte, 1)?,
                    };
                    let (l, r, t, b) = glyph.ink();
                    let step = 2 * (r - l);
                    let count = count as i32;
                    // over the accent point; under the character's ink centre
                    let at = if over { centre } else { ink_centre };
                    glyph.x = at - (l + r) / 2 - (count - 1) * step / 2;
                    if over {
                        glyph.y = top + gap - b;
                        top = glyph.y + t;
                    } else {
                        glyph.y = bottom - gap - t;
                        bottom = glyph.y + b;
                    }
                    for _ in 0..count {
                        // a wider accent counts for the spacing around the character where it is drawn (scripts
                        // still follow the character's own ink)
                        let (left, right, _, _) = glyph.ink();
                        if let Some(first) = &mut block.first {
                            first.ink = first.ink.min(left);
                        }
                        if let Some(last) = &mut block.last {
                            last.ink = last.ink.max(right);
                        }
                        block.glyphs.push(glyph.clone());
                        glyph.x += step;
                    }
                }
            }
        }
        Ok(())
    }
}

/// Where accents centre over a glyph: the middle of its advance; over an italic glyph the middle of its ink moved
/// right by an eighth of its ink's height at Times New Roman italic's angle, in proportion to the font's italic
/// angle otherwise (fitted to MathType's dots over x, y and A; holds for j f g y p ı: probe-pc/ac-*); over a
/// synthetic italic the middle of its ink moved right by its height at 20°.
fn accent_centre(glyph: &Glyph, fonts: &Fonts) -> i32 {
    if !glyph.face.italic {
        return advance_middle(glyph);
    }
    let (left, right, top, _) = glyph.ink();
    // Windows' slanted upright face (Euclid Math One's ȷ ϱ ϵ ϰ): the ink's height over the baseline at 20°
    // further (probe-pc/ac-* at 12, 18 and 24 pt; writer/layout-wide-0417)
    if fonts.synthetic_italic(&glyph.face) {
        let rise = f64::from(top - glyph.y) * 20f64.to_radians().tan();
        return (left + right) / 2 + rise.round() as i32;
    }
    let slant = fonts.slant(&glyph.face) / 16.333f64.to_radians().tan();
    (left + right) / 2 + (f64::from(top - glyph.y) * slant / 8.0).round() as i32
}

/// The middle of a glyph's advance.
fn advance_middle(glyph: &Glyph) -> i32 {
    glyph.x + Measure::scaled(glyph.measure.advance, glyph.wide) / 2
}
