//! A picture as a placeable Windows metafile, recorded the way MathType 6.9 records its own (read from its pictures
//! with the kit's wmf-records.mjs):
//! - the placeable header (bounds 0,0 to the picture's size, 2304 units per inch) and the WMF header;
//! - transparent background, white background colour, text aligned on its baseline at the current position;
//! - two comments: "MathType" with half the depth below the baseline, and the frame as seen from the first ink
//!   and the highest line's top (a text's 49/64 em above its baseline, a line's or shape's top point);
//! - lines with a solid black pen of their width (moves and line-tos, a polyline as one chain), arcs with such pens,
//!   filled shapes with
//!   a solid black brush and no pen, texts each a move to its origin, its font (created when it changes, the old
//!   one deleted) and one EXTTEXTOUT with each character's advance;
//! - the equation's MTEF in Design Science's "AppsMFCC" comment (MathType makes a pasted picture editable from
//!   it), the closing comment, and the end record.

use super::{Picture, UNITS_PER_INCH};

const META_SETBKMODE: u16 = 0x0102;
const META_SETBKCOLOR: u16 = 0x0201;
const META_SETTEXTALIGN: u16 = 0x012E;
const META_SETTEXTCOLOR: u16 = 0x0209;
const META_ESCAPE: u16 = 0x0626;
const META_CREATEPENINDIRECT: u16 = 0x02FA;
const META_CREATEBRUSHINDIRECT: u16 = 0x02FC;
const META_CREATEFONTINDIRECT: u16 = 0x02FB;
const META_SELECTOBJECT: u16 = 0x012D;
const META_DELETEOBJECT: u16 = 0x01F0;
const META_MOVETO: u16 = 0x0214;
const META_LINETO: u16 = 0x0213;
const META_POLYGON: u16 = 0x0324;
const META_ARC: u16 = 0x0817;
const META_EXTTEXTOUT: u16 = 0x0A32;
const MFCOMMENT: u16 = 15;
/// TA_BASELINE | TA_UPDATECP
const TEXT_ALIGN: u16 = 0x19;
/// black, as MathType names it (palette-relative)
const BLACK: u32 = 0x0200_0000;
const PS_NULL: u16 = 5;
/// Design Science's comments carry at most this much data each
const CHUNK: usize = 8000;

/// The picture as a placeable WMF; `mtef` (the equation's data) goes into Design Science's comment.
pub fn wmf(picture: &Picture, mtef: Option<&[u8]>) -> Vec<u8> {
    let mut w = Records::default();
    w.record(META_SETBKMODE, &[1, 0]);
    w.record(META_SETBKCOLOR, &dword(0x00FF_FFFF));
    w.record(META_SETTEXTALIGN, &[TEXT_ALIGN, 0]);
    let depth = u16::try_from((picture.height - picture.baseline) / 2).unwrap_or(0);
    let mut signature = b"MathType\0\0".to_vec();
    signature.extend(depth.to_le_bytes());
    w.comment(&signature);
    // the frame from the first ink (64 units in) and the highest line's top
    let tops = picture.texts.iter().map(|t| t.y - t.height * 49 / 64);
    let tops = tops.chain(picture.lines.iter().map(|l| l.from.1.min(l.to.1)));
    let top = tops
        .chain(picture.polygons.iter().flatten().map(|p| p.1))
        .min()
        .unwrap_or(0);
    let mut frame = vec![0xFF, 0xFF, 0xFF, 0xFF, 0, 0];
    for value in [16, -64, -top, picture.width - 64, picture.height - top] {
        frame.extend(value.to_le_bytes());
    }
    w.comment(&frame);
    // lines: one pen per width, chains of touching lines drawn on
    let mut at = None;
    for rule in &picture.lines {
        if w.pen != Some(rule.width) {
            let pen = w.create(
                META_CREATEPENINDIRECT,
                &[&[0, word(rule.width), 0][..], &dword(BLACK)].concat(),
            );
            w.select(pen);
            w.pen = Some(rule.width);
            at = None;
        }
        if at != Some(rule.from) {
            w.record(META_MOVETO, &[word(rule.from.1), word(rule.from.0)]);
        }
        w.record(META_LINETO, &[word(rule.to.1), word(rule.to.0)]);
        at = Some(rule.to);
    }
    // arcs with the same pens (parameters in GDI's reverse order)
    for arc in &picture.arcs {
        if w.pen != Some(arc.width) {
            let pen = w.create(
                META_CREATEPENINDIRECT,
                &[&[0, word(arc.width), 0][..], &dword(BLACK)].concat(),
            );
            w.select(pen);
            w.pen = Some(arc.width);
        }
        let (l, t, r, b) = arc.rect;
        let values = [arc.end.1, arc.end.0, arc.start.1, arc.start.0, b, r, t, l];
        w.record(META_ARC, &values.map(word));
    }
    if !picture.polygons.is_empty() {
        let brush = w.create(
            META_CREATEBRUSHINDIRECT,
            &[&[0][..], &dword(BLACK), &[0]].concat(),
        );
        w.select(brush);
        let pen = w.create(META_CREATEPENINDIRECT, &[PS_NULL, 1, 0, 0, 0]);
        w.select(pen);
        w.pen = None;
        for points in &picture.polygons {
            let mut words = vec![word(points.len() as i32)];
            words.extend(points.iter().flat_map(|p| [word(p.0), word(p.1)]));
            w.record(META_POLYGON, &words);
        }
    }
    if !picture.texts.is_empty() {
        w.record(META_SETTEXTCOLOR, &dword(BLACK));
    }
    let mut font: Option<(Vec<u16>, u16)> = None;
    for text in &picture.texts {
        w.record(META_MOVETO, &[word(text.y), word(text.x)]);
        let record = font_record(text);
        if font.as_ref().map(|f| &f.0) != Some(&record) {
            let created = w.create(META_CREATEFONTINDIRECT, &record);
            w.select(created);
            if let Some((_, old)) = font.take() {
                w.delete(old);
            }
            font = Some((record, created));
        }
        let mut words = vec![0, 0, text.bytes.len() as u16, 0];
        words.extend(bytes_words(&text.bytes));
        words.extend(text.advances.iter().map(|&a| word(a)));
        w.record(META_EXTTEXTOUT, &words);
    }
    if let Some(mtef) = mtef {
        for chunk in mtef.chunks(CHUNK) {
            let mut data = b"AppsMFCC\x01\0".to_vec();
            data.extend((mtef.len() as u32).to_le_bytes());
            data.extend((chunk.len() as u32).to_le_bytes());
            data.extend(b"Design Science, Inc.\0");
            data.extend(chunk);
            w.comment(&data);
        }
    }
    w.comment(&[0xFF, 0xFF, 0xFF, 0xFF, 1, 0, 0, 0, 0, 0]);
    w.finish(picture.width, picture.height)
}

/// A text's LOGFONT: the height as the character height, the width when set, weight, italic, character set, the
/// precisions and family MathType asks for, the name in 32 bytes.
fn font_record(text: &super::Text) -> Vec<u16> {
    let mut words = vec![
        word(-text.height),
        word(text.width),
        0,
        0,
        if text.face.bold { 700 } else { 400 },
    ];
    words.push(u16::from(text.face.italic));
    words.push(u16::from(text.charset) << 8);
    // out precision 0, clip precision 2; quality 0, pitch and family 0x10
    words.push(0x0200);
    words.push(0x1000);
    let mut name = encode_name(&text.face.name);
    name.resize(32, 0);
    words.extend(bytes_words(&name));
    words
}

/// A font name in the code page its record uses: Latin names as they are, SimSun by its Chinese name.
fn encode_name(name: &str) -> Vec<u8> {
    if name == "SimSun" {
        // 宋体 in GBK, as MathType names it
        return vec![0xCB, 0xCE, 0xCC, 0xE5];
    }
    name.bytes().filter(u8::is_ascii).collect()
}

fn bytes_words(bytes: &[u8]) -> Vec<u16> {
    bytes
        .chunks(2)
        .map(|c| u16::from_le_bytes([c[0], c.get(1).copied().unwrap_or(0)]))
        .collect()
}

fn word(value: i32) -> u16 {
    value as i16 as u16
}

fn dword(value: u32) -> [u16; 2] {
    [value as u16, (value >> 16) as u16]
}

/// Records being written, with the object table's slots (the lowest free slot taken first, as Windows does).
#[derive(Default)]
struct Records {
    words: Vec<u16>,
    largest: u32,
    slots: Vec<bool>,
    pen: Option<i32>,
}

impl Records {
    fn record(&mut self, function: u16, params: &[u16]) {
        let size = 3 + params.len() as u32;
        self.largest = self.largest.max(size);
        self.words.extend(dword(size));
        self.words.push(function);
        self.words.extend_from_slice(params);
    }

    fn comment(&mut self, data: &[u8]) {
        let mut params = vec![MFCOMMENT, data.len() as u16];
        params.extend(bytes_words(data));
        self.record(META_ESCAPE, &params);
    }

    /// Creates an object in the lowest free slot.
    fn create(&mut self, function: u16, params: &[u16]) -> u16 {
        let slot = self
            .slots
            .iter()
            .position(|used| !used)
            .unwrap_or(self.slots.len());
        if slot == self.slots.len() {
            self.slots.push(true);
        } else {
            self.slots[slot] = true;
        }
        self.record(function, params);
        slot as u16
    }

    fn select(&mut self, slot: u16) {
        self.record(META_SELECTOBJECT, &[slot]);
    }

    fn delete(&mut self, slot: u16) {
        self.record(META_DELETEOBJECT, &[slot]);
        self.slots[usize::from(slot)] = false;
    }

    /// The placeable header, the WMF header, the records and the end record.
    fn finish(mut self, width: i32, height: i32) -> Vec<u8> {
        self.record(0, &[]);
        let mut out = Vec::new();
        let mut placeable = vec![
            0xCDD7,
            0x9AC6,
            0,
            0,
            0,
            word(width),
            word(height),
            UNITS_PER_INCH as u16,
            0,
            0,
        ];
        let checksum = placeable.iter().fold(0u16, |sum, w| sum ^ w);
        placeable.push(checksum);
        let size = 9 + self.words.len() as u32;
        let header = [
            1,
            9,
            0x0300,
            size as u16,
            (size >> 16) as u16,
            self.slots.len() as u16,
            self.largest as u16,
            (self.largest >> 16) as u16,
            0,
        ];
        for w in placeable.iter().chain(&header).chain(&self.words) {
            out.extend(w.to_le_bytes());
        }
        out
    }
}
