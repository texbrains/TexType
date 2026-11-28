//! Big operators and limit templates laid out: see the parent module's rules.

use super::*;

impl<'a> Layout<'a> {
    /// A limit template (23: slots main, lower, upper) as the line's next element.
    pub(super) fn limit(&mut self, template: &'a Template, line: &mut Block) -> Result<(), String> {
        let size = self.size;
        let (slots, _) = self.slots(template)?;
        let mut slots = slots.into_iter();
        let main = slots.next().flatten().unwrap_or_default();
        let (lower, upper) = (slots.next().flatten(), slots.next().flatten());
        let top = self.slot_top(&main);
        let mut block = self.limits(main, lower, upper, top, size, true);
        // the frame keeps the main part's baseline (= under a label: probe-pc/lo-eq-*, writer/layout-wide-0427)
        block.reserved_bottom = Some(block.reserved_bottom.map_or(0, |r| r.min(0)));
        line.append(block, self.gaps());
        Ok(())
    }

    /// A big operator (templates 21 scripts beside the sign, 22 limits under and over it; slots operand, lower,
    /// upper, sign) and its operand as the line's next elements. The sign (at the big-operator size) is centred on
    /// the math axis.
    pub(super) fn big_operator(
        &mut self,
        template: &'a Template,
        line: &mut Block,
    ) -> Result<(), String> {
        let size = self.size;
        let (slots, chars) = self.slots(template)?;
        let mut slots = slots.into_iter();
        let operand = slots.next().flatten();
        let (lower, upper) = (slots.next().flatten(), slots.next().flatten());
        // the sign: its slot, or the template's characters; a composite sign (∯: a ring and two integrals) has the
        // others one advance after another and MT Extra's ring centred on them
        let sign_slot = slots.next().flatten();
        let composite = sign_slot.is_none() && chars.len() > 1;
        let mut sign = sign_slot.unwrap_or_else(|| composite_sign(chars));
        // a composite sign's operand 2/64 em further in the other templates (the old integral template's operand gap
        // is its own, below)
        let composite_room = if composite {
            Measure::scaled(2, size)
        } else {
            0
        };
        let mut centred = Block::default();
        // the old templates (15-20) take the sign by its drawn ink, the others by MathType's box for it; both centred
        // on the math axis, however tall the operand (genuine/integrals: integrals around integrals with limits)
        let old = (15..=20).contains(&template.selector);
        // MathType's placeholder as the sign: from its ink bottom up to a text font's em ascent, as it keeps a text
        // font's em box beside other characters (probe-pc/pb-sum-*, pb-int-scripts; edited/layout-wide-0345~after)
        for g in &mut sign.glyphs {
            if is_placeholder(g) {
                let (l, r, _, b) = g.ink();
                let text = Face {
                    name: "Times New Roman".into(),
                    bold: false,
                    italic: false,
                };
                if let Some(top) = self.fonts.em_ascent(&text, g.height) {
                    g.assumed = Some((l - g.x, r - g.x, top, b - g.y));
                }
            }
        }
        if !old {
            for g in &mut sign.glyphs {
                g.assumed = g.assumed.or(mathtype_box(
                    &g.face.name,
                    g.byte,
                    &g.measure,
                    g.height,
                    true,
                ));
            }
        }
        let centre = axis(size);
        // centred by ink; a sign its font lacks (drawn from a linked font: SimSun's ∬) by the em box of the font
        // the picture names (MathType finds no glyph there), its scripts still at the drawn glyph's ink
        let linked_box = sign.glyphs.iter().find(|g| g.measure.linked).and_then(|g| {
            let ascent = self.fonts.em_ascent(&g.face, g.height)?;
            let descent = self.fonts.em_descent(&g.face, g.height)?;
            Some((g.y + ascent, g.y - descent))
        });
        let dy = linked_box
            .or_else(|| sign.ink().map(|(_, _, top, bottom)| (top, bottom)))
            .map_or(0, |(top, bottom)| centre - (top + bottom + 1).div_euclid(2));
        centred.take(sign, 0, dy);
        // such a sign's frame reaches a text's nominal top, 49/64 em over its baseline (as the picture comment
        // takes a text's top), not its ink (writer/omml-0063, layout-extra5-0273/0283 ...; probe-pc/ii-size-10 ...
        // 36: 48/64 fits as well)
        if let Some(g) = centred.glyphs.iter().find(|g| g.measure.linked) {
            centred.place = Some(g.y + Measure::scaled(49, g.height));
        }
        // limits under and over the sign (variation 0x40), otherwise scripts beside it
        let mut block = if template.variation & 0x40 != 0 {
            // the upper limit over the sign's top: its drawn ink (Symbol's sum and product by MathType's box) or
            // its outline's unhinted top where that is higher (Symbol's integral: 0.91 em), not the font's em box
            let outline_top = centred
                .glyphs
                .iter()
                .map(|g| g.y + (g.measure.outline_top * g.height).div_euclid(4096))
                .max();
            let top = centred
                .drawn()
                .map_or(0, |d| d.2)
                .max(outline_top.unwrap_or(i32::MIN));
            let no_upper = upper.is_none();
            let mut block = self.limits(centred, lower, upper, top, size, false);
            // without an upper limit a sign keeps no height beyond its ink
            if no_upper {
                block.reserved = None;
            }
            block
        } else {
            self.sign_scripts(centred, lower, upper, size, template.selector == 15)
        };
        // what follows joins the operator
        for edge in [&mut block.first, &mut block.last].into_iter().flatten() {
            edge.class = Class::Operator;
        }
        let gaps = self.gaps();
        line.append(block, gaps);
        // an operand in the template's slot (MathType's own equations) the gap of 5/64 em and the operand space
        // (setting 19) after the operator; one written after the template joins it
        if let Some(operand) = operand.filter(|o| !o.glyphs.is_empty()) {
            // the old integral template's: 10/64 em at setting 17 (100 %) and 3/8 pt, in whole 3/8 pt (genuine and
            // probe-pc/op-* at 10, 12, 18 and 24 pt; setting 17 doubled adds 10/64 em, probe-pc/gi-vary-17); the
            // others' the minimum gap's setting unrounded (rounding it breaks MathType's own equations)
            let width = if template.selector == 15 {
                let step = 3 * POINT / 8;
                let room = self.spacing_exact(ARROW_ROOM, size) * 10.0 / 64.0;
                step * (1 + (room / f64::from(step)).floor() as i32)
            } else {
                plain_gap(size) + self.spacing(MINIMUM_GAP, size) + composite_room
            };
            let edge = |ink| Edge::structure(ink, width, Class::Space, size);
            line.append(
                Block {
                    first: Some(edge(0)),
                    last: Some(edge(width)),
                    ..Block::default()
                },
                gaps,
            );
            line.append(operand, gaps);
            // what follows spaces against the operand's ink as after an enclosure: a letter with no plain gap, a
            // digit or a sign with it (edited/mathtype7~oleObject7~after; probe-pc/op-*); a binary sign or a relation
            // that ends the operand asks no space after it (genuine/integrals: ∫a+ then ∬b, 9/64 em closer;
            // probe-pc/tb-*: − × =, a ringed sign)
            if let Some(edge) = &mut line.last {
                let class = match edge.class {
                    Class::Binary | Class::Relation => Class::Unary,
                    class => class,
                };
                *edge = Edge {
                    class,
                    ..Edge::enclosure(edge.ink, edge.size)
                };
            }
        }
        Ok(())
    }

    /// A big operator's scripts beside its sign (template 21): raised and lowered as beside any base placed by its
    /// ink (`script_dy`), both at the sign's ink and the script gap of the sign's size, the superscript's slot
    /// reaching its em ascent.
    pub(super) fn sign_scripts(
        &self,
        sign: Block,
        lower: Option<Block>,
        upper: Option<Block>,
        size: i32,
        old_integral: bool,
    ) -> Block {
        let (_, right, top, bottom) = sign.ink().unwrap_or((0, 0, 0, 0));
        // the scripts follow a composite sign's core, not MT Extra's ring around it
        let core = sign
            .glyphs
            .iter()
            .filter(|g| g.face.name != "MT Extra")
            .map(|g| g.ink().1)
            .max();
        let right = if sign.glyphs.iter().any(|g| g.face.name == "MT Extra") {
            core.unwrap_or(right)
        } else {
            right
        };
        // a sign of several integrals (∬ ∭ in the old template): its scripts' ink at its last integral's
        // advance, no script gap (probe-pc/in-3-sub at 12 and 24 pt)
        let advance_end = sign
            .glyphs
            .iter()
            .filter(|g| g.face.name != "MT Extra")
            .map(|g| g.x + Measure::scaled(g.measure.advance, g.wide))
            .max();
        // (a ringed one, ∯, keeps its core's ink and the gap: writer/layout-esint-*)
        let several =
            sign.glyphs.len() > 1 && sign.glyphs.iter().all(|g| g.face.name != "MT Extra");
        let right = match advance_end {
            Some(end) if several => end,
            _ => right,
        };
        // the script gap of the sign's size
        let sign_size = sign.glyphs.first().map_or(size, |g| g.height);
        let gap = if several {
            0
        } else {
            self.spacing(SCRIPT_GAP, sign_size)
        };
        // the old integral template's lower script: its ink at its last integral's advance, no script gap; with MT
        // Extra's ring, at the ring's ink less a 64 ppem pixel (genuine/integrals: ∫ ∬ ∭ and five rings; the
        // other old templates keep the gap, probe/bigop-cup-*)
        let ring_right = sign
            .glyphs
            .iter()
            .filter(|g| g.face.name == "MT Extra")
            .map(|g| g.ink().1)
            .max();
        let lower_at = old_integral.then(|| {
            ring_right.map_or(advance_end.unwrap_or(right), |r| {
                r - Measure::scaled(1, sign_size)
            })
        });
        let mut block = Block::default();
        block.take(sign, 0, 0);
        for (script, superscript) in [(lower, false), (upper, true)] {
            let Some(script) = script else { continue };
            let dy = self.script_dy(&script, superscript, size, Some((top, bottom)), false);
            if superscript {
                block.reserved = Some(dy + self.slot_top(&script));
            }
            let (right, gap) = match lower_at {
                Some(at) if !superscript => (at, 0),
                _ => (right, gap),
            };
            let dx = right + gap - script.ink().map_or(0, |i| i.0);
            block.take(script, dx, dy);
        }
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        let edge = |ink| Edge::structure(ink, right, Class::Operator, size);
        block.first = Some(edge(left));
        block.last = Some(edge(right));
        block
    }

    /// A main part with limits under and over it, centred on one axis by ink.
    pub(super) fn limits(
        &self,
        main: Block,
        lower: Option<Block>,
        upper: Option<Block>,
        main_top: i32,
        size: i32,
        limit_template: bool,
    ) -> Block {
        let (ml, mr, _, mb) = main.ink().unwrap_or((0, 0, 0, 0));
        // a limit template's main part reaches its baseline at least (= under a limit: probe-pc/lo-eq-under-*), and
        // a part ending in scripts is as wide as their room after them (H with subscript 2 over =: lo-eq-over-hsub)
        let mb = if limit_template { mb.min(0) } else { mb };
        let width = |b: &Block| {
            b.ink().map_or(0, |i| {
                let right = b
                    .last
                    .filter(|_| limit_template)
                    .map_or(i.1, |l| l.ink.max(i.1));
                right - i.0
            })
        };
        let widest = [Some(&main), lower.as_ref(), upper.as_ref()]
            .into_iter()
            .flatten()
            .map(width)
            .max()
            .unwrap_or(0);
        let mut block = Block::default();
        let centred = |b: &Block| (widest - width(b)) / 2 - b.ink().map_or(0, |i| i.0);
        // (and the frame keeps that room: lo-eq-over-hsub)
        let keep_room = |mut b: Block| {
            if let (true, Some(last), Some(ink)) = (limit_template, b.last, b.ink()) {
                if last.ink > ink.1 {
                    b.boxes.push((last.ink, last.ink, 0, 0));
                }
            }
            b
        };
        let (lower, upper) = (lower.map(keep_room), upper.map(keep_room));
        block.reserved = Some(main_top);
        block.take(main, centred_main(widest, ml, mr), 0);
        if let Some(lower) = lower {
            let lower_size = lower.first.map_or(size, |e| e.size);
            // a limit of rows (a matrix, a pile): its first row's em top a sixteenth of an em below the main part
            // its em top at least the minimum gap below the main part's ink (a limit of rows: its first row's),
            // a line's baseline at least the limit depth below
            let gap = self.minimum_gap(lower_size);
            let dy = match lower.first_row {
                Some(row) => mb - gap - self.slot_top_of_size(&lower, lower_size) - row,
                None => (mb - self.spacing(LIMIT_DEPTH, lower_size))
                    .min(mb - gap - self.slot_top_of_size(&lower, lower_size)),
            };
            let dx = centred(&lower);
            block.take(lower, dx, dy);
        }
        if let Some(upper) = upper {
            let upper_size = upper.first.map_or(size, |e| e.size);
            let (_, _, _, ub) = upper.ink().unwrap_or((0, 0, 0, 0));
            let descent = upper_size - self.slot_top_of_size(&upper, upper_size);
            // its em box at least the minimum gap over the main part's top, its ink the plain gap
            let gap = self.minimum_gap(upper_size);
            let ink_gap = plain_gap(upper_size);
            // (a limit template's: a quarter of the limit's size at least (the limit height), its ink the minimum gap
            // over the main part's em top: probe-pc/lo-*, writer/mhchem-0625, layout-wide-0431)
            let dy = if limit_template {
                main_top + self.spacing(LIMIT_HEIGHT, upper_size).max(-ub + gap)
            } else {
                main_top + descent.max(gap).max(-ub + ink_gap)
            };
            let dx = centred(&upper);
            let top = dy + self.slot_top(&upper);
            block.reserved = Some(top);
            block.take(upper, dx, dy);
        }
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        let edge = |ink| Edge::structure(ink, right, Class::Inner, size);
        block.first = Some(edge(left));
        block.last = Some(edge(right));
        block
    }
}

/// A big operator's sign from its characters: one alone as it is; several (a composite sign) one advance after
/// another, MT Extra's (a ring) by its advance centred on the others' ink (genuine/integrals: the rings of ∮ ∯
/// ∰ and the arrowed ones, whose ink lies off their advance's middle).
fn composite_sign(chars: Vec<Block>) -> Block {
    let (rings, others): (Vec<Block>, Vec<Block>) = chars
        .into_iter()
        .partition(|c| c.glyphs.iter().all(|g| g.face.name == "MT Extra"));
    if others.is_empty() || rings.is_empty() {
        let mut row = Block::default();
        let mut x = 0;
        for c in rings.into_iter().chain(others) {
            let advance = c.last.map_or(0, |l| l.end);
            row.take(c, x, 0);
            x += advance;
        }
        return finish_row(row);
    }
    let mut row = Block::default();
    let mut x = 0;
    for c in others {
        let advance = c.last.map_or(0, |l| l.end);
        row.take(c, x, 0);
        x += advance;
    }
    let (left, right) = row.ink().map_or((0, 0), |i| (i.0, i.1));
    for ring in rings {
        let advance = ring.last.map_or(0, |l| l.end);
        row.take(ring, (left + right - advance) / 2, 0);
    }
    finish_row(row)
}

/// A row of glyphs' ends from its ink (spaced as a structure).
fn finish_row(mut row: Block) -> Block {
    let (left, right) = row.ink().map_or((0, 0), |i| (i.0, i.1));
    let size = row.glyphs.first().map_or(0, |g| g.height);
    row.first = Some(Edge::structure(left, right, Class::Ordinary, size));
    row.last = Some(Edge::structure(right, right, Class::Ordinary, size));
    row
}

/// Where the main part of a limit template goes: centred on the widest part by ink.
pub(super) fn centred_main(widest: i32, left: i32, right: i32) -> i32 {
    (widest - (right - left)) / 2 - left
}
