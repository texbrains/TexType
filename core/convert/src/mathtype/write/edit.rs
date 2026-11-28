//! Editing an existing MathType equation (requirement C4): the edited formula keeps the equation's own settings
//! and information, as MathType's editor does when it saves an edit.
//! - The header stays: the font table, the preferences (sizes, spacing, the styles' fonts), MathType's version
//!   stamp and records TexType does not read. MathType's copy of the TeX the equation was typed from (record 102)
//!   no longer matches and is dropped, and MathType's far-east font is added when the equation has none: what
//!   MathType 6.9 does on saving an edit.
//! - The parts the edit did not touch keep their records as they were (nudges, sizes, fonts, old templates, piles):
//!   the written records are aligned with the original ones by what they draw (the MathML they read as), and every
//!   run that draws the same is taken from the original. Definitions are numbered again where the two meet, and
//!   size and colour records are added where a part would otherwise inherit the other run's.

use std::collections::HashMap;
use std::rc::Rc;

use super::super::mtef::{
    Char, EqnPrefs, Line, Matrix, Mtef, Nudge, Pile, Record, StyleBinding, Template, Typeface,
    Unsigned,
};
use super::super::read::{records_mathml, to_mathml};
use super::super::records::{LINE_NULL, RECORD_FULL};
use super::{body_without_undrawable, no_character};

/// MathType's record for the TeX an equation was typed from.
const TEX_SOURCE_RECORD: u8 = 102;
/// SimSun, named in code page 936: MathType's far-east font.
const FAR_EAST_FONT: &[u8] = &[0xCB, 0xCE, 0xCC, 0xE5];
/// The size before any size record.
static FULL_SIZE: Record = Record::TypeSize(RECORD_FULL);
/// The option bit of an object's nudge.
const NUDGE: u8 = 0x08;

/// The equation after an edit: the formula's MathML written into the original equation. A character MathType
/// cannot draw is refused, as in a new formula, unless it stands in a part kept from the original; MathType's own
/// placeholder (U+FFFD, where MathType stored a character it has no glyph for) stays the original's record.
pub fn edit(original: &Mtef, mathml: &str, display: bool) -> Result<Mtef, String> {
    let start = body_start(&original.records);
    let mut header: Vec<Record> = original.records[..start]
        .iter()
        .filter(|record| {
            !matches!(
                record,
                Record::Future {
                    kind: TEX_SOURCE_RECORD,
                    ..
                }
            )
        })
        .cloned()
        .collect();
    add_far_east_font(&mut header);
    let placeholder = placeholder(&original.records[start..]);
    let (body, undrawable) = body_without_undrawable(mathml, &header, placeholder)?;
    let mut written = header.clone();
    written.extend(body);
    let mut merge = Merge::new(
        &original.records,
        start,
        &written,
        header.len(),
        placeholder,
    );
    let merged = merge.reuse(&written[header.len()..], &original.records[start..]);
    header.extend(merged);
    let edited = Mtef {
        // bit 0x01: inline
        equation_options: (original.equation_options & !0x01) | u8::from(!display),
        records: header,
        ..original.clone()
    };
    if !undrawable.is_empty() {
        let reads = to_mathml(&edited);
        let count = |text: &str, c: char| text.chars().filter(|&d| d == c).count();
        if let Some(&c) = undrawable
            .iter()
            .find(|&&c| count(&reads, c) < count(mathml, c))
        {
            return Err(no_character(c));
        }
    }
    Ok(edited)
}

/// MathType's placeholder record in an equation's formula, when it has one in a built-in style.
fn placeholder(records: &[Record]) -> Option<&Char> {
    records.iter().find_map(|record| match record {
        Record::Char(c) if c.mt_code == Some(0xFFFD) && c.typeface.value >= 0 => Some(c),
        other => content(other).and_then(placeholder),
    })
}

/// Where the formula starts: its first line, pile or matrix, with the size record before it.
fn body_start(records: &[Record]) -> usize {
    let first = records
        .iter()
        .position(|record| {
            matches!(
                record,
                Record::Line(_) | Record::Pile(_) | Record::Matrix(_)
            )
        })
        .unwrap_or(records.len());
    match first.checked_sub(1).map(|before| &records[before]) {
        Some(Record::TypeSize(_)) => first - 1,
        _ => first,
    }
}

/// MathType's far-east font (SimSun, WinAllCodePages) for the far-east style when the equation has none: its
/// encoding and font after the header's last font, and the style bound to it.
fn add_far_east_font(header: &mut Vec<Record>) {
    let Some(prefs_at) = header
        .iter()
        .position(|record| matches!(record, Record::EqnPrefs(_)))
    else {
        return;
    };
    let Record::EqnPrefs(prefs) = &header[prefs_at] else {
        return;
    };
    if prefs
        .styles
        .get(11)
        .is_some_and(|binding| binding.font.value != 0)
    {
        return;
    }
    let encodings: Vec<&Vec<u8>> = header
        .iter()
        .filter_map(|record| match record {
            Record::EncodingDef(name) => Some(name),
            _ => None,
        })
        .collect();
    let fonts = header
        .iter()
        .filter(|record| matches!(record, Record::FontDef { .. }))
        .count();
    let insert_at = header
        .iter()
        .rposition(|record| matches!(record, Record::FontDef { .. } | Record::EncodingDef(_)))
        .map_or(prefs_at, |last| last + 1);
    let mut added = Vec::new();
    let encoding = match encodings
        .iter()
        .position(|name| name.as_slice() == b"WinAllCodePages")
    {
        Some(index) => 5 + index,
        None => {
            added.push(Record::EncodingDef(b"WinAllCodePages".to_vec()));
            5 + encodings.len()
        }
    };
    added.push(Record::FontDef {
        encoding: Unsigned::new(encoding as u16),
        name: FAR_EAST_FONT.to_vec(),
    });
    let font = fonts as u16 + 1;
    let prefs_at = if insert_at <= prefs_at {
        prefs_at + added.len()
    } else {
        prefs_at
    };
    header.splice(insert_at..insert_at, added);
    if let Record::EqnPrefs(EqnPrefs { styles, .. }) = &mut header[prefs_at] {
        while styles.len() < 12 {
            styles.push(StyleBinding {
                font: Unsigned::new(0),
                style: None,
            });
        }
        styles[11] = StyleBinding {
            font: Unsigned::new(font),
            style: Some(0),
        };
    }
}

/// The definitions MTEF numbers, each kind from its own first number in stream order.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Encoding,
    Font,
    Style,
    Color,
}

impl Kind {
    fn of(record: &Record) -> Option<Kind> {
        match record {
            Record::EncodingDef(_) => Some(Kind::Encoding),
            Record::FontDef { .. } => Some(Kind::Font),
            Record::FontStyleDef { .. } => Some(Kind::Style),
            Record::ColorDef(_) => Some(Kind::Color),
            _ => None,
        }
    }

    /// The number before the first definition: encodings 1 to 4 are MathType's own.
    fn base(self) -> u16 {
        if self == Kind::Encoding {
            4
        } else {
            0
        }
    }

    /// Numbers that name no definition: MathType's own encodings, the default colour.
    fn built_in(self, number: u16) -> bool {
        number <= self.base() || (self == Kind::Color && number == 0)
    }
}

/// The last number of each kind in a run of records.
fn last_numbers(records: &[Record]) -> HashMap<Kind, u16> {
    let mut last = HashMap::new();
    for record in records {
        if let Some(kind) = Kind::of(record) {
            *last.entry(kind).or_insert(kind.base()) += 1;
        }
    }
    last
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Source {
    Original,
    Written,
}

/// One equation's records as the reader sees them: the numbered definitions and the size and colour before each
/// part (both are stream state: a record holds until the next one, across lines).
struct Stream<'a> {
    /// definitions and preferences in stream order: what reading any run starts from
    definitions: Vec<&'a Record>,
    numbers: HashMap<*const Record, u16>,
    named: HashMap<(Kind, u16), &'a Record>,
    /// before each part: the size record, the colour number and the colour record
    before: HashMap<*const Record, (&'a Record, u16, Option<&'a Record>)>,
    read: HashMap<(*const Record, usize), Rc<str>>,
    /// the original's runs are compared as the writer writes what they read as (the edited header), so that
    /// what the writer stores differently from MathType (old templates, other styles, spaces) still matches
    rewrite: Option<(&'a [Record], Option<&'a Char>)>,
}

impl<'a> Stream<'a> {
    fn new(records: &'a [Record], rewrite: Option<(&'a [Record], Option<&'a Char>)>) -> Self {
        let mut stream = Stream {
            definitions: Vec::new(),
            numbers: HashMap::new(),
            named: HashMap::new(),
            before: HashMap::new(),
            read: HashMap::new(),
            rewrite,
        };
        let mut state = (&FULL_SIZE, None);
        stream.walk(records, &mut state, &mut HashMap::new());
        stream
    }

    fn walk(
        &mut self,
        records: &'a [Record],
        state: &mut (&'a Record, Option<&'a Record>),
        last: &mut HashMap<Kind, u16>,
    ) {
        for record in records {
            if let Some(kind) = Kind::of(record) {
                let number = last.entry(kind).or_insert(kind.base());
                *number += 1;
                self.numbers.insert(record as *const Record, *number);
                self.named.insert((kind, *number), record);
                self.definitions.push(record);
            }
            match record {
                Record::EqnPrefs(_) => self.definitions.push(record),
                Record::TypeSize(_) | Record::Size(_) => state.0 = record,
                Record::Color(_) => state.1 = Some(record),
                _ => {}
            }
            if is_part(record) {
                let color = match state.1 {
                    Some(Record::Color(index)) => index.value,
                    _ => 0,
                };
                self.before
                    .insert(record as *const Record, (state.0, color, state.1));
            }
            if let Some(content) = content(record) {
                self.walk(content, state, last);
            }
        }
    }

    /// What a run of records (starting with a part) draws where it stands. A space without a width reads like a
    /// zero space: the writer writes both as MathType's zero space.
    fn mathml(&mut self, records: &'a [Record]) -> Rc<str> {
        let key = (records.as_ptr(), records.len());
        if let Some(text) = self.read.get(&key) {
            return text.clone();
        }
        let mut context = self.definitions.clone();
        context.extend(
            self.before
                .get(&records.as_ptr())
                .and_then(|before| before.2),
        );
        let mut text = records_mathml(&context, records);
        if let Some((header, placeholder)) = self.rewrite {
            let math = format!("<math xmlns=\"http://www.w3.org/1998/Math/MathML\">{text}</math>");
            if let Ok((rewritten, _)) = body_without_undrawable(&math, header, placeholder) {
                let context: Vec<&Record> = header
                    .iter()
                    .filter(|record| {
                        Kind::of(record).is_some() || matches!(record, Record::EqnPrefs(_))
                    })
                    .collect();
                text = records_mathml(&context, &rewritten);
            }
        }
        let text: Rc<str> = text.replace("<mspace width=\"0em\"/>", "<mspace/>").into();
        self.read.insert(key, text.clone());
        text
    }
}

/// What becomes of a written part.
#[derive(Clone, Copy)]
enum Take {
    Written,
    /// the original's records from one part to another (both included) instead
    Original(usize, usize),
    /// the written part with the original part's settings and unchanged inner parts
    Inside(usize),
    /// the written big-operator template and the written parts up to the second index as the original's old
    /// template holding its operand
    Operand(usize, usize),
    /// replaced with the original's records at an earlier written part
    Dropped,
}

/// The records of the edited equation, built in stream order from the written and the original records.
struct Merge<'a> {
    original: Stream<'a>,
    written: Stream<'a>,
    /// each source's definition numbers to the edited equation's
    numbers: [HashMap<(Kind, u16), u16>; 2],
    /// the last number given in the edited equation, per kind
    last: HashMap<Kind, u16>,
    /// the definitions among the built records as they stand there, with their numbers
    defined: Vec<(Record, u16)>,
    /// the size record and colour number in effect at the end of what was built, and how that colour draws
    size: Record,
    color: u16,
    drawn: Option<(u8, Vec<u16>)>,
}

impl<'a> Merge<'a> {
    /// `original_header` and `header` records are the two equations' headers; the edited equation's header is the
    /// written one, whose definitions keep the original's numbers (MathType's far-east font comes after them).
    /// `placeholder`: the original's placeholder record, which the writer writes for U+FFFD.
    fn new(
        original: &'a [Record],
        original_header: usize,
        written: &'a [Record],
        header: usize,
        placeholder: Option<&'a Char>,
    ) -> Self {
        let identity = |last: HashMap<Kind, u16>| -> HashMap<(Kind, u16), u16> {
            let mut numbers = HashMap::new();
            for (kind, last) in last {
                for number in kind.base() + 1..=last {
                    numbers.insert((kind, number), number);
                }
            }
            numbers
        };
        let mut defined = Vec::new();
        let mut last = HashMap::new();
        for record in &written[..header] {
            if let Some(kind) = Kind::of(record) {
                let number = last.entry(kind).or_insert(kind.base());
                *number += 1;
                defined.push((record.clone(), *number));
            }
        }
        Merge {
            original: Stream::new(original, Some((&written[..header], placeholder))),
            written: Stream::new(written, None),
            numbers: [
                identity(last_numbers(&original[..original_header])),
                identity(last.clone()),
            ],
            last,
            defined,
            size: FULL_SIZE.clone(),
            color: 0,
            drawn: None,
        }
    }

    fn stream(&self, source: Source) -> &Stream<'a> {
        match source {
            Source::Original => &self.original,
            Source::Written => &self.written,
        }
    }

    /// The written run of records with every run of parts that draws as in the original run taken from the
    /// original. The written run's settings records are not copied: its parts get their size and colour where they
    /// stand (`settle`), and the definitions they name when they name them. The original's settings records come
    /// along with its parts.
    fn reuse(&mut self, written: &'a [Record], original: &'a [Record]) -> Vec<Record> {
        let (take, kept) = self.align(written, original);
        let mut out = Vec::new();
        // the original's records before this one are among the built records or replaced
        let mut carried = 0;
        for (index, record) in written.iter().enumerate() {
            if !is_part(record) {
                continue;
            }
            match take[index] {
                Take::Dropped => {}
                Take::Written => {
                    if let Some((size, color)) = self.before(Source::Written, record) {
                        self.settle(&mut out, size, (Source::Written, color));
                    }
                    self.emit(&mut out, record, Source::Written);
                }
                Take::Original(first, last) => {
                    self.carry(&mut out, original, &kept, &mut carried, first);
                    if let Some((size, color)) = self.before(Source::Original, &original[first]) {
                        self.settle(&mut out, size, (Source::Original, color));
                    }
                    for record in &original[first..=last] {
                        self.emit(&mut out, record, Source::Original);
                    }
                    carried = last + 1;
                }
                Take::Inside(old) => {
                    self.carry(&mut out, original, &kept, &mut carried, old);
                    // a line holding just a one-column table against a pile: the table stands for the line
                    let record = match (record, &original[old]) {
                        (Record::Line(line), Record::Pile(_)) => match only_part(&line.content) {
                            Some(table @ Record::Matrix(m)) if m.columns == 1 => table,
                            _ => record,
                        },
                        _ => record,
                    };
                    self.settle_in_place(&mut out, record, &original[old]);
                    self.inside(&mut out, record, &original[old]);
                    carried = old + 1;
                }
                Take::Operand(old, through) => {
                    self.carry(&mut out, original, &kept, &mut carried, old);
                    self.settle_in_place(&mut out, record, &original[old]);
                    self.operand(&mut out, &written[index..=through], &original[old]);
                    carried = old + 1;
                }
            }
        }
        self.carry(&mut out, original, &kept, &mut carried, original.len());
        out
    }

    /// The original's settings records (sizes, colours, definitions, records TexType does not read) and kept parts
    /// before a position that are not among the built records yet.
    fn carry(
        &mut self,
        out: &mut Vec<Record>,
        original: &'a [Record],
        kept: &[bool],
        carried: &mut usize,
        until: usize,
    ) {
        for index in *carried..until.min(original.len()) {
            if !is_part(&original[index]) || kept[index] {
                self.emit(out, &original[index], Source::Original);
            }
        }
        *carried = (*carried).max(until);
    }

    /// Which written parts are taken from the original: the alignment that matches the most parts, a run of one
    /// side matching one part of the other when they read the same (an old big-operator template holds its operand,
    /// the written template is followed by it). Changed parts between matches are matched inside when they are of
    /// the same kind in the same order. Unmatched original parts that draw nothing as the writer writes them (a
    /// zero space MathType placed) are kept where they stand: the second vector marks them.
    fn align(&mut self, written: &'a [Record], original: &'a [Record]) -> (Vec<Take>, Vec<bool>) {
        let new_parts = parts(written);
        let old_parts = parts(original);
        let (n, m) = (old_parts.len(), new_parts.len());
        let old_run = |a: usize, b: usize| &original[old_parts[a]..=old_parts[b]];
        let new_run = |a: usize, b: usize| &written[new_parts[a]..=new_parts[b]];
        // best[i][j]: the most parts matched from old part i and new part j on; step[i][j]: the parts it takes
        let mut best = vec![vec![0usize; m + 1]; n + 1];
        let mut step = vec![vec![(0usize, 0usize); m + 1]; n + 1];
        for i in (0..=n).rev() {
            for j in (0..=m).rev() {
                if i == n && j == m {
                    continue;
                }
                let mut choice = (0, if i < n { (1, 0) } else { (0, 1) });
                if i < n && j < m {
                    let old_one = self.original.mathml(old_run(i, i));
                    for b in 1..=m - j {
                        let new_text = self.written.mathml(new_run(j, j + b - 1));
                        if b > 1 && new_text.len() > old_one.len() {
                            break;
                        }
                        if 1 + b + best[i + 1][j + b] > choice.0 && new_text == old_one {
                            choice = (1 + b + best[i + 1][j + b], (1, b));
                        }
                    }
                    let new_one = self.written.mathml(new_run(j, j));
                    for a in 2..=n - i {
                        let old_text = self.original.mathml(old_run(i, i + a - 1));
                        if old_text.len() > new_one.len() {
                            break;
                        }
                        if a + 1 + best[i + a][j + 1] > choice.0 && old_text == new_one {
                            choice = (a + 1 + best[i + a][j + 1], (a, 1));
                        }
                    }
                }
                if i < n && best[i + 1][j] > choice.0 {
                    choice = (best[i + 1][j], (1, 0));
                }
                if j < m && best[i][j + 1] > choice.0 {
                    choice = (best[i][j + 1], (0, 1));
                }
                best[i][j] = choice.0;
                step[i][j] = choice.1;
            }
        }

        let mut take = vec![Take::Written; written.len()];
        let mut kept = vec![false; original.len()];
        let (mut i, mut j) = (0, 0);
        let (mut old_gap, mut new_gap) = (Vec::new(), Vec::new());
        // changed parts between two matches, in order: an old big-operator template takes the written parts after
        // the written template as its operand (all but those left for the original's parts after it)
        let close_gap = |old_gap: &mut Vec<usize>, new_gap: &mut Vec<usize>, take: &mut [Take]| {
            let mut at = 0;
            for (k, &o) in old_gap.iter().enumerate() {
                let Some(&n) = new_gap.get(at) else { break };
                let operand = (new_gap.len() - at - 1).saturating_sub(old_gap.len() - k - 1);
                if operand > 0 && holds_operand(&original[o], &written[n]) {
                    take[n] = Take::Operand(o, new_gap[at + operand]);
                    for &d in &new_gap[at + 1..=at + operand] {
                        take[d] = Take::Dropped;
                    }
                    at += operand + 1;
                    continue;
                }
                if same_kind(&written[n], &original[o]) {
                    take[n] = Take::Inside(o);
                }
                at += 1;
            }
            old_gap.clear();
            new_gap.clear();
        };
        while i < n || j < m {
            let (a, b) = step[i][j];
            if a > 0 && b > 0 {
                close_gap(&mut old_gap, &mut new_gap, &mut take);
                take[new_parts[j]] = Take::Original(old_parts[i], old_parts[i + a - 1]);
                for &k in &new_parts[j + 1..j + b] {
                    take[k] = Take::Dropped;
                }
            } else if a > 0 {
                if self.original.mathml(old_run(i, i)).is_empty() {
                    kept[old_parts[i]] = true;
                } else {
                    old_gap.push(old_parts[i]);
                }
            } else {
                new_gap.push(new_parts[j]);
            }
            i += a;
            j += b;
        }
        close_gap(&mut old_gap, &mut new_gap, &mut take);
        (take, kept)
    }

    /// The size record and colour number a source has before one of its parts.
    fn before(&self, source: Source, part: &Record) -> Option<(&'a Record, u16)> {
        self.stream(source)
            .before
            .get(&(part as *const Record))
            .map(|&(size, color, _)| (size, color))
    }

    /// How a source's colour draws: None for MathType's default colour and black.
    fn drawn_color(&self, source: Source, number: u16) -> Option<(u8, Vec<u16>)> {
        match self.stream(source).named.get(&(Kind::Color, number)) {
            Some(Record::ColorDef(color))
                if number != 0
                    && !(color.options & 0x01 == 0 && color.components.iter().all(|&c| c == 0)) =>
            {
                Some((color.options, color.components.clone()))
            }
            _ => None,
        }
    }

    /// Before a part: a size record and a colour record when the built records end in another size or in a colour
    /// that draws differently.
    fn settle(&mut self, out: &mut Vec<Record>, size: &'a Record, (source, color): (Source, u16)) {
        if self.size != *size {
            out.push(size.clone());
            self.size = size.clone();
        }
        let drawn = self.drawn_color(source, color);
        if self.drawn != drawn {
            let number = self.reference(out, source, Kind::Color, color);
            out.push(Record::Color(Unsigned::new(number)));
            self.color = number;
            self.drawn = drawn;
        }
    }

    /// Before a written part standing for an original one: the original's size (sizes are not part of the MathML)
    /// and its colour when the written colour draws the same.
    fn settle_in_place(&mut self, out: &mut Vec<Record>, written: &Record, original: &Record) {
        let (Some((size, old_color)), Some((_, new_color))) = (
            self.before(Source::Original, original),
            self.before(Source::Written, written),
        ) else {
            return;
        };
        let same = self.drawn_color(Source::Original, old_color)
            == self.drawn_color(Source::Written, new_color);
        let color = if same {
            (Source::Original, old_color)
        } else {
            (Source::Written, new_color)
        };
        self.settle(out, size, color);
    }

    /// A record from a source added to the built records: its definitions numbered in the edited equation, the
    /// numbers it names translated, and the size and colour it sets followed.
    fn emit(&mut self, out: &mut Vec<Record>, record: &'a Record, source: Source) {
        let translated = match record {
            Record::TypeSize(_) | Record::Size(_) => {
                self.size = record.clone();
                record.clone()
            }
            Record::Color(index) => {
                let number = self.reference(out, source, Kind::Color, index.value);
                self.color = number;
                self.drawn = self.drawn_color(source, index.value);
                Record::Color(renumbered(*index, number))
            }
            Record::EncodingDef(_)
            | Record::ColorDef(_)
            | Record::FontDef { .. }
            | Record::FontStyleDef { .. } => {
                let translated = self.definition(out, record, source);
                self.define(source, record, &translated);
                translated
            }
            Record::Char(c) if c.typeface.value < 0 => {
                let style = (-c.typeface.value) as u16;
                let number = i32::from(self.reference(out, source, Kind::Style, style));
                let mut c = c.clone();
                if number != -c.typeface.value {
                    c.typeface = Typeface {
                        value: -number,
                        wide: c.typeface.wide || number > 128,
                    };
                }
                Record::Char(c)
            }
            Record::Line(_) | Record::Template(_) | Record::Pile(_) | Record::Matrix(_) => {
                let mut content = Vec::new();
                for inner in self::content(record).unwrap_or_default() {
                    self.emit(&mut content, inner, source);
                }
                with_content(record, content)
            }
            _ => record.clone(),
        };
        out.push(translated);
    }

    /// A definition as it stands among the built records: the encoding or font it names translated.
    fn definition(&mut self, out: &mut Vec<Record>, record: &'a Record, source: Source) -> Record {
        match record {
            Record::FontDef { encoding, name } => {
                let number = self.reference(out, source, Kind::Encoding, encoding.value);
                Record::FontDef {
                    encoding: renumbered(*encoding, number),
                    name: name.clone(),
                }
            }
            Record::FontStyleDef { font, style } => {
                let number = self.reference(out, source, Kind::Font, font.value);
                Record::FontStyleDef {
                    font: renumbered(*font, number),
                    style: *style,
                }
            }
            other => other.clone(),
        }
    }

    fn define(&mut self, source: Source, record: &'a Record, translated: &Record) {
        let Some(kind) = Kind::of(record) else { return };
        let Some(&number) = self.stream(source).numbers.get(&(record as *const Record)) else {
            return;
        };
        let last = self.last.entry(kind).or_insert(kind.base());
        *last += 1;
        let last = *last;
        self.numbers[source as usize].insert((kind, number), last);
        self.defined.push((translated.clone(), last));
    }

    /// The edited equation's number for a definition a source names. A definition not yet among the built records
    /// is taken from an equal one there, or else added before the record naming it.
    fn reference(&mut self, out: &mut Vec<Record>, source: Source, kind: Kind, number: u16) -> u16 {
        if kind.built_in(number) {
            return number;
        }
        if let Some(&translated) = self.numbers[source as usize].get(&(kind, number)) {
            return translated;
        }
        let Some(&definition) = self.stream(source).named.get(&(kind, number)) else {
            return number;
        };
        let translated = self.definition(out, definition, source);
        if let Some(&(_, equal)) = self
            .defined
            .iter()
            .find(|(defined, _)| *defined == translated)
        {
            self.numbers[source as usize].insert((kind, number), equal);
            return equal;
        }
        self.define(source, definition, &translated);
        out.push(translated);
        self.numbers[source as usize]
            .get(&(kind, number))
            .copied()
            .unwrap_or(number)
    }

    /// A written part with the original part's settings TexType does not read (nudge, line spacing and tab stops,
    /// table alignment, a pile kept a pile) and its unchanged inner parts from the original.
    fn inside(&mut self, out: &mut Vec<Record>, written: &'a Record, original: &'a Record) {
        let rebuilt = match (written, original) {
            (Record::Line(new), Record::Line(old)) => Record::Line(Line {
                options: (old.options & !LINE_NULL) | (new.options & LINE_NULL),
                nudge: old.nudge,
                spacing: old.spacing,
                ruler: old.ruler.clone(),
                content: self.reuse(&new.content, &old.content),
            }),
            (Record::Template(new), Record::Template(old)) => {
                let content = self.reuse(&new.content, &old.content);
                let mut template = new.clone();
                (template.options, template.nudge) = nudged(new.options, old.nudge);
                template.content = content;
                Record::Template(template)
            }
            (Record::Matrix(new), Record::Matrix(old)) => {
                let content = self.reuse(&new.content, &old.content);
                let mut matrix = new.clone();
                (matrix.options, matrix.nudge) = nudged(new.options, old.nudge);
                matrix.vertical = old.vertical;
                matrix.horizontal_justification = old.horizontal_justification;
                matrix.vertical_justification = old.vertical_justification;
                matrix.content = content;
                Record::Matrix(matrix)
            }
            (Record::Matrix(new), Record::Pile(old)) => {
                let content = self.reuse(&new.content, &old.content);
                let mut pile = old.clone();
                pile.content = content;
                Record::Pile(pile)
            }
            // a line where the original has a pile or table alone (a formula's top): the pile or table goes in it
            (Record::Line(new), Record::Pile(_) | Record::Matrix(_)) => {
                let content = self.reuse(&new.content, std::slice::from_ref(original));
                with_content(written, content)
            }
            (Record::Char(_), Record::Char(old)) => {
                self.emit(out, written, Source::Written);
                if let Some(Record::Char(c)) = out.last_mut() {
                    (c.options, c.nudge) = nudged(c.options, old.nudge);
                }
                return;
            }
            _ => return self.emit(out, written, Source::Written),
        };
        out.push(rebuilt);
    }

    /// An old big-operator template (MathType 6's sums, products, integrals holding their operand) for the written
    /// template and the written parts after it: the original template with its operand line matched with those
    /// parts and its limits with the written limits.
    fn operand(&mut self, out: &mut Vec<Record>, written: &'a [Record], original: &'a Record) {
        let Record::Template(old) = original else {
            return self.emit(out, &written[0], Source::Written);
        };
        // a sign without limits is written as a character
        let new_lines: Vec<&'a Record> = match &written[0] {
            Record::Template(new) => new
                .content
                .iter()
                .filter(|record| matches!(record, Record::Line(_)))
                .collect(),
            _ => Vec::new(),
        };
        let mut content = Vec::new();
        let mut line = 0;
        for record in &old.content {
            let Record::Line(old_line) = record else {
                self.emit(&mut content, record, Source::Original);
                continue;
            };
            line += 1;
            if line == 1 {
                let operand = self.reuse(&written[1..], &old_line.content);
                content.push(Record::Line(Line {
                    content: operand,
                    ..line_settings(old_line)
                }));
                continue;
            }
            match new_lines.get(line - 1) {
                Some(new_line @ Record::Line(new))
                    if new.options & LINE_NULL == 0 && old_line.options & LINE_NULL == 0 =>
                {
                    self.inside(&mut content, new_line, record);
                }
                _ => self.emit(&mut content, record, Source::Original),
            }
        }
        let mut template = old.clone();
        template.content = content;
        out.push(Record::Template(template));
    }
}

/// A line's own settings, without its content.
fn line_settings(line: &Line) -> Line {
    Line {
        options: line.options,
        nudge: line.nudge,
        spacing: line.spacing,
        ruler: line.ruler.clone(),
        content: Vec::new(),
    }
}

/// Whether an original old big-operator template (holding its operand) stands for a written big-operator template
/// without an operand and with the same limits, or for its sign alone when it has no limits.
fn holds_operand(original: &Record, written: &Record) -> bool {
    let Record::Template(old) = original else {
        return false;
    };
    let operand = |template: &Template| {
        template.content.iter().find_map(|record| match record {
            Record::Line(line) => Some(line.options & LINE_NULL == 0),
            _ => None,
        })
    };
    if !(15..=20).contains(&old.selector) || operand(old) != Some(true) {
        return false;
    }
    match written {
        Record::Template(new) => {
            (15..=22).contains(&new.selector)
                && operand(new) == Some(false)
                && old.variation & 0x30 == new.variation & 0x30
        }
        Record::Char(sign) => {
            old.variation & 0x30 == 0
                && old
                    .content
                    .iter()
                    .any(|record| matches!(record, Record::Char(c) if c.mt_code == sign.mt_code))
        }
        _ => false,
    }
}

fn nudged(options: u8, nudge: Option<Nudge>) -> (u8, Option<Nudge>) {
    (
        (options & !NUDGE) | if nudge.is_some() { NUDGE } else { 0 },
        nudge,
    )
}

fn renumbered(old: Unsigned, number: u16) -> Unsigned {
    if old.value == number {
        old
    } else {
        Unsigned::new(number)
    }
}

fn content(record: &Record) -> Option<&[Record]> {
    match record {
        Record::Line(line) => Some(&line.content),
        Record::Template(template) => Some(&template.content),
        Record::Pile(pile) => Some(&pile.content),
        Record::Matrix(matrix) => Some(&matrix.content),
        _ => None,
    }
}

fn with_content(record: &Record, content: Vec<Record>) -> Record {
    match record {
        Record::Line(l) => Record::Line(Line {
            options: l.options,
            nudge: l.nudge,
            spacing: l.spacing,
            ruler: l.ruler.clone(),
            content,
        }),
        Record::Template(t) => Record::Template(Template {
            options: t.options,
            nudge: t.nudge,
            selector: t.selector,
            variation: t.variation,
            variation_wide: t.variation_wide,
            template_options: t.template_options,
            content,
        }),
        Record::Pile(p) => Record::Pile(Pile {
            options: p.options,
            nudge: p.nudge,
            horizontal: p.horizontal,
            vertical: p.vertical,
            ruler: p.ruler.clone(),
            content,
        }),
        Record::Matrix(m) => Record::Matrix(Matrix {
            options: m.options,
            nudge: m.nudge,
            vertical: m.vertical,
            horizontal_justification: m.horizontal_justification,
            vertical_justification: m.vertical_justification,
            rows: m.rows,
            columns: m.columns,
            row_partitions: m.row_partitions.clone(),
            column_partitions: m.column_partitions.clone(),
            content,
        }),
        other => other.clone(),
    }
}

fn is_part(record: &Record) -> bool {
    matches!(
        record,
        Record::Char(_)
            | Record::Template(_)
            | Record::Line(_)
            | Record::Pile(_)
            | Record::Matrix(_)
    )
}

/// The positions of a run's parts (characters, templates, lines, piles, matrices), not its settings records.
fn parts(records: &[Record]) -> Vec<usize> {
    records
        .iter()
        .enumerate()
        .filter(|(_, record)| is_part(record))
        .map(|(index, _)| index)
        .collect()
}

/// A run's part when it has just one.
fn only_part(records: &[Record]) -> Option<&Record> {
    let mut parts = records.iter().filter(|record| is_part(record));
    let first = parts.next()?;
    parts.next().is_none().then_some(first)
}

fn same_kind(a: &Record, b: &Record) -> bool {
    match (a, b) {
        (Record::Template(a), Record::Template(b)) => a.selector == b.selector,
        (Record::Line(_), Record::Line(_)) | (Record::Matrix(_), Record::Matrix(_)) => true,
        (Record::Matrix(m), Record::Pile(_)) => m.columns == 1,
        (Record::Line(_), Record::Pile(_) | Record::Matrix(_)) => true,
        (Record::Char(_), Record::Char(_)) => true,
        _ => false,
    }
}
