//! The laid-out block as a picture: framed, its glyphs joined into texts as MathType joins them.

use super::*;

/// Whether nothing more joins a text: MathType ends a text at 40 characters, after a space, and in a text font
/// (the ANSI character set) after any character above 0x7F.
fn text_ended(text: &Text) -> bool {
    let last = text.bytes.last().copied().unwrap_or(0);
    text.bytes.len() >= 40 || last == 0x20 || (text.charset == 0 && last >= 0x80)
}

/// The picture: the block framed (see the module comment), its glyphs joined into texts. MathType draws all
/// characters of one font, size, character set and colour on one baseline as one text (characters between of other
/// colours or fonts do not end it), left to right, each advance the step
/// to the next of them (the last one twice the height), a space ending a text; characters of the national
/// character sets (Greek, Central European ...) one by one.
pub(super) fn picture(block: &Block) -> Picture {
    let (left, right, top, bottom) = block.ink().unwrap_or((0, 0, 0, 0));
    let top = block.place.map_or(top, |p| p.max(top));
    let shift = MARGIN - left;
    let width = round_up(right + shift + MARGIN);
    let baseline = round_up(top + MARGIN);
    let height = round_up(baseline - bottom + MARGIN);
    let mut order: Vec<&Glyph> = block.glyphs.iter().collect();
    order.sort_by_key(|g| g.x);
    let mut texts: Vec<Text> = Vec::new();
    // each text's run and colour, its last glyph's place in the order and whether it is still open: a glyph of
    // another run in between (a struck-through content) ends a text; a struck-through content's glyphs join the
    // open text before them (across other fonts: a + n̸ is one text a n) and that text ends with them
    // (probe-pc/st-*)
    let mut runs: Vec<((u32, u32), usize, bool)> = Vec::new();
    let mut barrier = 0;
    for (index, g) in order.iter().enumerate() {
        if index > 0 && order[index - 1].run != g.run {
            barrier = index;
        }
        let (x, y) = (g.x + shift, baseline - g.y);
        // a character of the same font and size in another character set ends its texts on its baseline (one on
        // another baseline, an arrow label's Δ, does not: writer/mhchem-0639)
        for (t, run) in texts.iter().zip(runs.iter_mut()) {
            if t.face == g.face && t.height == g.height && t.charset != g.charset && t.y == y {
                run.2 = false;
            }
        }
        let joins = |t: &Text| {
            t.face == g.face
                && t.height == g.height
                && t.width == g.width
                && t.charset == g.charset
                && t.y == y
                && matches!(g.charset, 0 | 1)
                && !text_ended(t)
        };
        let found = texts.iter().zip(&runs).position(|(t, &(run, last, open))| {
            open && run == (g.run, g.colour) && last + 1 >= barrier && !g.alone && joins(t)
        });
        let found = found.or_else(|| {
            (g.run != 0 && !g.alone)
                .then(|| {
                    texts
                        .iter()
                        .zip(&runs)
                        .rposition(|(t, &(run, _, open))| open && run == (0, g.colour) && joins(t))
                })
                .flatten()
        });
        if let Some(at) = found {
            // the text belongs to the struck content from now on: what follows it starts another
            runs[at].0 = (g.run, g.colour);
            let text = &mut texts[at];
            let last = text.x + text.advances[..text.advances.len() - 1].iter().sum::<i32>();
            *text.advances.last_mut().unwrap() = x - last;
            text.bytes.push(g.byte);
            text.advances.push(2 * g.height);
            runs[at].1 = index;
            continue;
        }
        // a glyph drawn alone (a stretched fence) is a text nothing joins
        runs.push(((g.run, g.colour), index, !g.alone));
        // a double-byte character: its trail byte with no step of its own
        let (bytes, advances) = match g.trail {
            Some(trail) => (vec![g.byte, trail], vec![2 * g.height, 0]),
            None => (vec![g.byte], vec![2 * g.height]),
        };
        texts.push(Text {
            x,
            y,
            face: g.face.clone(),
            height: g.height,
            width: g.width,
            charset: g.charset,
            bytes,
            advances,
        });
    }
    // a character of a national character set is a text of its own whose step reaches the next text of its font,
    // size and character set on its baseline (twice the height when none follows)
    let ends: Vec<i32> = texts
        .iter()
        .map(|t| {
            let next = texts
                .iter()
                .filter(|o| {
                    o.x > t.x
                        && o.y == t.y
                        && o.face == t.face
                        && o.height == t.height
                        && o.charset == t.charset
                })
                .map(|o| o.x)
                .min();
            next.map_or(2 * t.height, |x| x - t.x)
        })
        .collect();
    for (text, end) in texts.iter_mut().zip(ends) {
        if !matches!(text.charset, 0 | 1) {
            text.advances[0] = end;
        }
    }
    let lines = block
        .lines
        .iter()
        .map(|l| Rule {
            from: (l.from.0 + shift, baseline - l.from.1),
            to: (l.to.0 + shift, baseline - l.to.1),
            width: l.width,
        })
        .collect();
    let polygons = block
        .polygons
        .iter()
        .map(|points| {
            points
                .iter()
                .map(|p| (p.0 + shift, baseline - p.1))
                .collect()
        })
        .collect();
    let arcs = block
        .bows
        .iter()
        .map(|b| Arc {
            rect: (
                b.centre.0 - b.radius.0 + shift,
                baseline - b.centre.1 - b.radius.1,
                b.centre.0 + b.radius.0 + shift,
                baseline - b.centre.1 + b.radius.1,
            ),
            start: (b.start.0 + shift, baseline - b.start.1),
            end: (b.end.0 + shift, baseline - b.end.1),
            width: b.width,
        })
        .collect();
    Picture {
        width,
        height,
        baseline,
        texts,
        lines,
        polygons,
        arcs,
    }
}
