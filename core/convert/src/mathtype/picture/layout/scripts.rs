//! Scripts: subscripts and superscripts after their base and before it (see the parent module's rules).

use super::*;

impl<'a> Layout<'a> {
    /// Subscript and superscript templates (27 sub, 28 sup, 29 both: slots subscript, superscript) after their base,
    /// the line's last element.
    pub(super) fn scripts(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let base = line.last;
        let base_size = base.map_or(self.size, |b| b.size);
        let base_from = line.last_from;
        // the scripts follow the base's own glyph ink: a character's glyph (not its accents and primes), a
        // structure's glyphs (not the room its edge keeps after them: the pixel past a fence's pieces, the gap after
        // scripts); a structure whose lines reach as far (a bar fence, a box) by its edge
        let base_right = base.map_or(0, |b| {
            let glyphs = &line.glyphs[base_from..];
            let glyphs = if b.typeface.is_some() {
                &glyphs[..glyphs.len().min(1)]
            } else {
                glyphs
            };
            let lines = line.lines[line.last_lines_from..]
                .iter()
                .map(|l| l.from.0.max(l.to.0))
                .max();
            match glyphs.iter().map(|g| g.ink().1).max() {
                Some(g) if b.typeface.is_some() || lines.is_none_or(|l| g > l) => g.min(b.ink),
                _ => b.ink,
            }
        });
        // MathType's placeholder as the base: its subscript as after a box 25/32 em wide from a unit before its
        // origin, its superscript after its ink (probe-pc/ph-q-sub, ph-q-sup, ph-int-q at 10, 12 and 24 pt)
        let placeholder = match &line.glyphs[base_from..] {
            [g] if base.is_some() && is_placeholder(g) => Some(g.x - 1 + 25 * g.height / 32),
            _ => None,
        };
        // the top and bottom of a structure base: its glyphs' ink and its lines (a strike-through's, a bar's)
        // (a base ending in scripts counts by its ink only as a floor: its subscript keeps the subscript depth)
        let scripted = base.is_some_and(|b| b.joins == Joins::Scripts);
        let structure = match base {
            Some(b) if b.typeface.is_none() => {
                let glyphs = line.glyphs[base_from..].iter().map(|g| g.ink());
                let lines = line.lines[line.last_lines_from..]
                    .iter()
                    .map(|l| (0, 0, l.from.1.max(l.to.1), l.from.1.min(l.to.1)));
                glyphs
                    .chain(lines)
                    .map(|i| (i.2, i.3))
                    .reduce(|a, b| (a.0.max(b.0), a.1.min(b.1)))
                    // an empty line object (MathType's own chemistry: CH, an empty line, the subscript 3) by its box:
                    // the text font's em ascent over the baseline (edited/mathtype7~oleObject27~after, probe-pc/eb-*)
                    .or(Some((self.text_em_ascent(base_size), 0)))
            }
            _ => None,
        };
        let empty_base = base.is_some()
            && line.glyphs.len() == base_from
            && line.lines.len() == line.last_lines_from;
        let (slots, _) = self.slots(template)?;
        let gap = self.spacing(SCRIPT_GAP, base_size);
        let mut right = None::<i32>;
        let mut end = 0;
        let mut size = base_size;
        let mut superscript_top = None;
        for (slot, superscript) in slots.into_iter().zip([false, true]) {
            let Some(script) = slot else { continue };
            let Some(first) = script.first else { continue };
            let dy = self.script_dy(&script, superscript, base_size, structure, scripted);
            if superscript {
                // its slot reaches its em ascent
                superscript_top = Some(dy + self.slot_top(&script));
            }
            // after the base's ink; a subscript tucks under an italic character (not under a structure: a root,
            // a box, a fence, scripts), the more the taller it is
            let tuck = if !superscript && base.is_some_and(|b| b.typeface.is_some()) {
                tuck(&line.glyphs[base_from..], self.fonts)
            } else {
                0
            };
            let after = match placeholder {
                Some(box_right) if !superscript => box_right,
                _ => base_right,
            };
            let dx = after + gap - tuck - first.ink;
            // a script ending in scripts keeps the gap they leave (x^(2^3) is that much wider)
            let mut script = script;
            if let (Some(last), Some((_, ink_right, _, _))) = (script.last, script.ink()) {
                if last.ink > ink_right && last.typeface.is_none() {
                    script.boxes.push((last.ink, last.ink, 0, 0));
                }
            }
            if let Some(last) = script.last {
                right = Some(right.map_or(last.ink + dx, |r| r.max(last.ink + dx)));
                end = end.max(last.end + dx);
                size = last.size;
            }
            line.take(script, dx, dy);
        }
        if let Some(right) = right {
            if line.first.is_none() {
                line.first = Some(Edge::structure(
                    base_right + gap,
                    end,
                    Class::Ordinary,
                    size,
                ));
            }
            // a function name keeps its space after its scripts, and so does an inner element (a fence:
            // probe-pc/fl-fence-sup-*, fl-frac-sup-*)
            let class = base.map_or(Class::Ordinary, |b| {
                if empty_base {
                    Class::Placeholder
                } else if matches!(b.class, Class::Function | Class::Inner) {
                    b.class
                } else {
                    Class::Ordinary
                }
            });
            // the script gap after them stands in for the plain gap (with no base, the plain gap stays)
            line.last = Some(Edge {
                gap: base.is_none() || placeholder.is_some() || empty_base,
                joins: Joins::Scripts,
                ..Edge::structure(right + self.script_room(base_size), end, class, base_size)
            });
        }
        if let Some(top) = superscript_top {
            line.reserved = Some(line.reserved.map_or(top, |r| r.max(top)));
        }
        // the frame keeps the base's em ascent above them (an empty superscript keeps no room of its own:
        // probe-pc/es-*, x with subscript i after and before at full sizes 10-30 pt and script sizes 5-12 pt;
        // sb-*-size-10, sb2-*-size1-9/11)
        let em = line.glyphs[base_from..]
            .first()
            .and_then(|g| g.em_ascent(self.fonts, base_size));
        if let Some(em) = em {
            line.place = Some(line.place.map_or(em, |p| p.max(em)));
        }
        Ok(())
    }

    /// Where a script's baseline goes beside a base of a size (y up), the same after a base, before one and beside a
    /// big operator's sign: a superscript the superscript height (setting 7) up, a subscript the subscript depth
    /// (setting 8) and 3/32 pt down (that at any full size, probe-pc/rel-script-size-*, fw-script-size-*; shrinking
    /// with a script-size base, rounded); then
    /// - a superscript reaching down (a fraction) rises until its ink is 0.31 em of the base above the baseline, a
    ///   subscript whose ink reaches above its line's em ascent (an accent over it) drops by that much;
    /// - beside a base placed by its ink (`structure`: its ink top and bottom; a fence, a root, a box, a sign) a
    ///   superscript's baseline at least the limit height (setting 6) below the ink top; a subscript's math axis
    ///   (a quarter of its size above its baseline) exactly a tenth of the base's size (rounded down) above the
    ///   ink bottom, higher than the subscript depth too (probe-pc/sb-*, sb2-*: roots, fences, boxes over shallow
    ///   and tall contents at full sizes 10-48 pt and subscript sizes 5-11 pt; no spacing setting moves it,
    ///   fixed-str-*); beside a base ending in scripts (`scripted`: (P²)ᵢ, probe-pc/w5-sup-P) at least that
    ///   far down.
    pub(super) fn script_dy(
        &self,
        script: &Block,
        superscript: bool,
        base_size: i32,
        structure: Option<(i32, i32)>,
        scripted: bool,
    ) -> i32 {
        let raise = self.spacing(SUPERSCRIPT_HEIGHT, base_size);
        let full = self.type_size(RECORD_FULL);
        let depth =
            self.spacing(SUBSCRIPT_DEPTH, base_size) + (3 * 2 * base_size + full) / (2 * full);
        let Some((_, _, top, bottom)) = script.ink() else {
            return if superscript { raise } else { -depth };
        };
        if superscript {
            let at_structure =
                structure.map_or(i32::MIN, |(t, _)| t - self.spacing(LIMIT_HEIGHT, base_size));
            // (what reaches down is drawn: a space's depth does not raise it, probe-pc/sp-*-x-sup-size-10)
            let bottom = script.inked().map_or(0, |i| i.3.max(bottom));
            raise.max(-bottom + base_size * 31 / 100).max(at_structure)
        } else {
            let size = script.first.map_or(base_size, |e| e.size);
            let normal = (-depth).min(-depth + self.slot_top_of_size(script, size) - top);
            match structure.map(|(_, b)| b + base_size / 10 - axis(size)) {
                Some(at) if scripted => normal.min(at),
                Some(at) => at,
                None => normal,
            }
        }
    }

    /// The room scripts keep on their far side from the base: the minimum gap (`minimum_gap`, of the base's size;
    /// the box of scripts after a base ends there, prescripts' box starts there, primes' ink starts there after the
    /// base's ink, a reversed prime's ends there before it).
    pub(super) fn script_room(&self, base_size: i32) -> i32 {
        self.minimum_gap(base_size)
    }

    /// Scripts before their base (templates 27-29 with variation 1: their slots, subscript and superscript; the
    /// base the element after them) and the base as the line's next element: raised and lowered as after a base;
    /// the subscript's ink ending the script gap and the plain gap (5/64 em) before the base's ink, the
    /// superscript's that much less the base's slant (the slant part of the tuck); their box starting the script
    /// room before their ink.
    pub(super) fn prescripts(&self, slots: Vec<Option<Block>>, base: Block, line: &mut Block) {
        let base_size = base.first.map_or(self.size, |b| b.size);
        let base_left = base.first.map_or(0, |b| b.ink);
        let gap = self.spacing(SCRIPT_GAP, base_size) + plain_gap(base_size);
        let slant = slant(&base.glyphs, self.fonts);
        let mut block = Block::default();
        let mut top = None;
        for (slot, superscript) in slots.into_iter().zip([false, true]) {
            let Some(script) = slot else { continue };
            let Some((_, ink_right, _, _)) = script.ink() else {
                continue;
            };
            let dy = self.script_dy(&script, superscript, base_size, None, false);
            let shift = if superscript {
                top = Some(dy + self.slot_top(&script));
                slant
            } else {
                0
            };
            block.take(script, base_left - gap + shift - ink_right, dy);
        }
        let left = block.ink().map(|i| i.0);
        let last = base.last;
        let em = base
            .glyphs
            .first()
            .and_then(|g| g.em_ascent(self.fonts, base_size));
        block.take(base, 0, 0);
        // their box starts the script room before their ink (as scripts after a base end)
        block.first = left
            .map(|l| {
                Edge::structure(
                    l - self.script_room(base_size),
                    l,
                    Class::Ordinary,
                    base_size,
                )
            })
            .or(last);
        block.last = last;
        match top {
            Some(top) => block.reserved = Some(block.reserved.map_or(top, |r| r.max(top))),
            // the frame keeps the base's em ascent above them, as after a base
            None => block.place = em,
        }
        line.append(block, self.gaps());
    }
}

/// An italic glyph's slant at half its height, in units: an eighth of its height at Times New Roman italic's angle,
/// in proportion to the font's italic angle otherwise (Cambria italic's is smaller), a synthesized italic half its
/// slant (none for upright glyphs).
fn slant_pixels(g: &Glyph, fonts: &Fonts) -> f64 {
    if !g.face.italic || g.assumed.is_some() {
        return 0.0;
    }
    let slant = if fonts.synthetic_italic(&g.face) {
        0.175
    } else {
        // in proportion to the font's italic angle: an eighth at Times New Roman italic's 16.33 degrees
        0.125 * fonts.slant(&g.face) / 16.333f64.to_radians().tan()
    };
    f64::from(g.measure.top) * slant
}

/// The largest slant of a base's glyphs (`slant_pixels`) at their size.
pub(super) fn slant(base: &[Glyph], fonts: &Fonts) -> i32 {
    base.iter()
        .map(|g| (slant_pixels(g, fonts) * f64::from(g.height) / f64::from(PPEM)).ceil() as i32)
        .max()
        .unwrap_or(0)
}

/// How far a subscript tucks under its base's ink: nothing under upright glyphs; under an italic one its slant
/// (`slant_pixels`), and an eighth of an em more where the glyph is open at the lower right (its ink below 14/64 em
/// ends 14/64 em or more before its full ink: F P T V W Y f r). Measured from MathType's pictures of every italic
/// letter with a subscript (probe/tuck-*).
pub(super) fn tuck(base: &[Glyph], fonts: &Fonts) -> i32 {
    base.iter()
        .filter(|g| g.face.italic && g.assumed.is_none())
        .map(|g| {
            let m = &g.measure;
            let mut pixels = slant_pixels(g, fonts);
            let low = m.rows.iter().filter(|r| r.0 < 14).map(|r| r.2).max();
            if low.is_some_and(|low| m.right - low >= 14) {
                pixels += 8.0;
            }
            (pixels * f64::from(g.height) / f64::from(PPEM)).ceil() as i32
        })
        .max()
        .unwrap_or(0)
}
