//! MathML as a MathType equation: the records MathType 7 itself stores for the same formula. The reference is
//! MathType's own import of each corpus formula (testing/corpus/mathtype/import.jsonl); where that import loses
//! something, the records are the ones MathType's editor makes (core/convert/tests/mathtype.rs).

mod edit;
mod elements;
mod scripts;

pub use edit::edit;

use super::characters::{drawable, identifier, operator, plain, text_glyph, Font, Glyph};
use super::mathml::{self, Element};
use super::mtef::{
    Char, ColorDef, Embellishment, EqnPrefs, Line, Matrix, Mtef, Record, StyleBinding, Template,
    Typeface, Unsigned,
};
use super::records::*;
use elements::*;

/// A new equation for MathML, displayed (on a line of its own) or inline.
pub fn from_mathml(mathml: &str, display: bool) -> Result<Mtef, String> {
    let mut records = header();
    let body = body(mathml, &records)?;
    records.extend(body);
    Ok(Mtef {
        platform: 1,
        product: 0,
        product_version: 7,
        product_subversion: 9,
        application_key: b"DSMT7".to_vec(),
        // bit 0x01: inline
        equation_options: u8::from(!display),
        records,
    })
}

/// The formula's records after a header (whose encodings, fonts and colours they refer to by number).
fn body(mathml: &str, header: &[Record]) -> Result<Vec<Record>, String> {
    let (records, undrawable) = body_without_undrawable(mathml, header, None)?;
    // a formula with a character MathType cannot draw is not written (owner, 2026-11-25)
    match undrawable.first() {
        Some(&c) => Err(no_character(c)),
        None => Ok(records),
    }
}

fn no_character(c: char) -> String {
    format!("MathType has no character for U+{:04X} {c}", c as u32)
}

/// `body` with the characters MathType cannot draw left out, and those characters. `placeholder`: the record of
/// MathType's placeholder (where MathType itself stored a character it has no glyph for), written for U+FFFD.
fn body_without_undrawable(
    mathml: &str,
    header: &[Record],
    placeholder: Option<&Char>,
) -> Result<(Vec<Record>, Vec<char>), String> {
    let root = mathml::parse(mathml)?;
    if root.name != "math" {
        return Err(format!("MathML: the root is <{}>, not <math>", root.name));
    }
    let mut writer = Writer::after(header);
    writer.placeholder = placeholder.cloned();
    let mut records = Vec::new();
    let children: Vec<&Element> = root.elements().collect();
    writer.line(&children, FULL, &mut records);
    // an empty equation is its size alone
    if let Some(Record::Line(line)) = records.last() {
        if line.content.is_empty() {
            records.pop();
        }
    }
    Ok((records, writer.undrawable))
}

/// MathType's sizes (TypeSize records): full, script, second script, big-operator sign.
const FULL: u8 = RECORD_FULL;
const SUB: u8 = RECORD_FULL + 1;
const SUB2: u8 = RECORD_FULL + 2;
const SYM: u8 = RECORD_FULL + 3;
const SUB_SYM: u8 = RECORD_SUB_SYM;

fn script_size(size: u8) -> u8 {
    match size {
        FULL | SYM => SUB,
        _ => SUB2,
    }
}

fn sign_size(size: u8) -> u8 {
    if size == FULL {
        SYM
    } else {
        SUB_SYM
    }
}

/// The definitions a new MathType 7 equation starts with (as MathType 7.9 writes them on Windows): its fonts, the
/// styles' fonts and sizes, spacing.
fn header() -> Vec<Record> {
    let font = |encoding: u16, name: &[u8]| Record::FontDef {
        encoding: Unsigned::new(encoding),
        name: name.to_vec(),
    };
    let style = |font: u16, style: u8| StyleBinding {
        font: Unsigned::new(font),
        style: Some(style),
    };
    vec![
        Record::EncodingDef(b"WinAllBasicCodePages".to_vec()),
        font(5, b"Times New Roman"),
        font(3, b"Symbol"),
        font(5, b"Courier New"),
        font(4, b"MT Extra"),
        Record::EncodingDef(b"WinAllCodePages".to_vec()),
        // SimSun, named in code page 936
        font(6, &[0xCB, 0xCE, 0xCC, 0xE5]),
        Record::EqnPrefs(EqnPrefs {
            options: 0,
            sizes: vec![
                8, 33, 47, 39, 242, 95, 33, 143, 33, 47, 71, 95, 65, 80, 242, 31,
            ],
            spaces: vec![
                30, 65, 80, 244, 21, 15, 65, 0, 244, 69, 244, 37, 244, 143, 66, 95, 65, 0, 244, 16,
                15, 67, 95, 65, 0, 242, 31, 32, 165, 242, 10, 37, 244, 143, 33, 244, 16, 15, 65, 0,
                244, 15, 72, 244, 23, 244, 143, 65, 0, 242, 26, 95, 68, 95, 69, 244, 95, 69, 244,
                95, 65, 15,
            ],
            styles: vec![
                style(1, 0),
                style(1, 0),
                style(1, 2),
                style(2, 2),
                style(2, 0),
                style(2, 0),
                style(1, 1),
                style(1, 0),
                style(3, 0),
                style(1, 0),
                style(4, 0),
                style(5, 0),
            ],
        }),
    ]
}

struct Writer {
    /// the size the records so far leave in force
    size: Option<u8>,
    /// the encodings, fonts and font styles defined so far (MTEF numbers them in this order: encodings from 5,
    /// fonts from 1, styles from 1 as typeface -1, -2 ...)
    encodings: Vec<Vec<u8>>,
    fonts: Vec<Vec<u8>>,
    styles: Vec<(u16, u8)>,
    /// the colour the MathML asks for here, the colour in force (None: MathType's default) and the colours
    /// defined so far (COLOR n names the n-th; COLOR 0 is the default)
    paint: Option<[u8; 3]>,
    color: Option<[u8; 3]>,
    colors: Vec<[u8; 3]>,
    /// the characters MathType has no glyph for, in order
    undrawable: Vec<char>,
    placeholder: Option<Char>,
}

impl Writer {
    /// A writer continuing after a header: the encodings, fonts and colours it defines keep their numbers.
    fn after(header: &[Record]) -> Writer {
        let mut writer = Writer {
            size: None,
            encodings: Vec::new(),
            fonts: Vec::new(),
            styles: Vec::new(),
            paint: None,
            color: None,
            colors: Vec::new(),
            undrawable: Vec::new(),
            placeholder: None,
        };
        for record in header {
            match record {
                Record::EncodingDef(name) => writer.encodings.push(name.clone()),
                Record::FontDef { name, .. } => writer.fonts.push(name.clone()),
                Record::ColorDef(color) => {
                    let byte = |v: &u16| ((u32::from((*v).min(1000)) * 255 + 500) / 1000) as u8;
                    let rgb: Vec<u8> = color.components.iter().map(byte).collect();
                    writer.colors.push([
                        rgb.first().copied().unwrap_or(0),
                        rgb.get(1).copied().unwrap_or(0),
                        rgb.get(2).copied().unwrap_or(0),
                    ]);
                }
                _ => {}
            }
        }
        writer
    }

    /// A COLOR record (and the colour's COLOR_DEF the first time) when the next record is in another colour.
    fn colored(&mut self, records: &mut Vec<Record>) {
        if self.color == self.paint {
            return;
        }
        let index = match self.paint {
            None => 0,
            Some(rgb) => {
                let known = self.colors.iter().position(|known| *known == rgb);
                1 + known.unwrap_or_else(|| {
                    let component = |byte: u8| ((u32::from(byte) * 1000 + 127) / 255) as u16;
                    records.push(Record::ColorDef(ColorDef {
                        options: 0,
                        components: rgb.iter().map(|&byte| component(byte)).collect(),
                        name: None,
                    }));
                    self.colors.push(rgb);
                    self.colors.len() - 1
                })
            }
        };
        records.push(Record::Color(Unsigned::new(index as u16)));
        self.color = self.paint;
    }

    /// A TypeSize record when the next record needs another size.
    fn sized(&mut self, size: u8, records: &mut Vec<Record>) {
        if self.size != Some(size) {
            records.push(Record::TypeSize(size));
            self.size = Some(size);
        }
    }

    /// A LINE (a null LINE when empty) holding `nodes` at `size`.
    fn line(&mut self, nodes: &[&Element], size: u8, records: &mut Vec<Record>) {
        self.line_of(nodes, size, true, records);
    }

    /// A LINE; matrix cells stay non-null when empty, as MathType writes them.
    fn line_of(
        &mut self,
        nodes: &[&Element],
        size: u8,
        null_when_empty: bool,
        records: &mut Vec<Record>,
    ) {
        self.sized(size, records);
        let mut content = Vec::new();
        self.row(nodes, size, &mut content);
        let options = if content.is_empty() && null_when_empty {
            LINE_NULL
        } else {
            0
        };
        records.push(Record::Line(Line {
            options,
            nudge: None,
            spacing: None,
            ruler: None,
            content,
        }));
    }

    /// A slot's line for one MathML argument (its row's children).
    fn slot(&mut self, node: Option<&Element>, size: u8, records: &mut Vec<Record>) {
        let nodes = node.map(row_children).unwrap_or_default();
        self.line(&nodes, size, records);
    }

    fn row(&mut self, nodes: &[&Element], size: u8, content: &mut Vec<Record>) {
        for node in nodes {
            self.node(node, size, content);
        }
    }

    /// An element, in the colour its mathcolor names.
    fn node(&mut self, element: &Element, size: u8, content: &mut Vec<Record>) {
        match element.attribute("mathcolor").and_then(color_value) {
            Some(paint) => {
                let outer = std::mem::replace(&mut self.paint, paint);
                self.element(element, size, content);
                self.paint = outer;
            }
            None => self.element(element, size, content),
        }
    }

    fn element(&mut self, element: &Element, size: u8, content: &mut Vec<Record>) {
        let children: Vec<&Element> = element.elements().collect();
        match element.name.as_str() {
            "mrow" if fences(element).is_some() => {
                let (open, close) = (children[0].text(), children[children.len() - 1].text());
                self.fence(open, close, &children[1..children.len() - 1], size, content)
            }
            "mfenced" => {
                let open = element.attribute("open").unwrap_or("(").to_string();
                let close = element.attribute("close").unwrap_or(")").to_string();
                let inner = match &children[..] {
                    [only] if only.name == "mrow" => only.elements().collect(),
                    _ => children.clone(),
                };
                self.fence(open, close, &inner, size, content)
            }
            "mmultiscripts" => self.multiscripts(&children, size, content),
            // a phantom of no width (mhchem's base for scripts that stand alone: H₂O): nothing drawn, no room;
            // MathType's own import draws its content light grey and red placeholders around it
            "mpadded"
                if zero_length(element.attribute("width"))
                    && !children.is_empty()
                    && children.iter().all(|c| c.name == "mphantom") => {}
            "mrow" | "mstyle" | "mpadded" | "mphantom" | "math" => {
                self.row(&children, size, content)
            }
            "semantics" => self.row(&children[..children.len().min(1)], size, content),
            "mi" | "mn" | "mo" | "mtext" | "ms" => self.token(element, size, content),
            "mspace" => self.space(element, size, content),
            "msub" | "msup" | "msubsup" => self.scripts(element, &children, size, content),
            "munder" | "mover" | "munderover" => self.limits(element, &children, size, content),
            "mfrac" => {
                self.template(TEMPLATE_FRACTION, 0, content, size, |writer, slots| {
                    writer.slot(children.first().copied(), size, slots);
                    writer.slot(children.get(1).copied(), size, slots);
                });
            }
            "msqrt" => self.template(TEMPLATE_ROOT, 0, content, size, |writer, slots| {
                writer.line(&children, size, slots);
                writer.line(&[], script_size(size), slots);
            }),
            "mroot" => self.template(TEMPLATE_ROOT, 1, content, size, |writer, slots| {
                writer.slot(children.first().copied(), size, slots);
                writer.slot(children.get(1).copied(), script_size(size), slots);
            }),
            "menclose" => self.enclose(element, &children, size, content),
            "mtable" => self.table(element, &children, size, content),
            _ => self.row(&children, size, content),
        }
    }

    fn template(
        &mut self,
        selector: u8,
        variation: u16,
        content: &mut Vec<Record>,
        size: u8,
        slots: impl FnOnce(&mut Writer, &mut Vec<Record>),
    ) {
        self.sized(size, content);
        self.colored(content);
        let mut records = Vec::new();
        slots(self, &mut records);
        content.push(Record::Template(Template {
            options: 0,
            nudge: None,
            selector,
            variation,
            variation_wide: variation > 0x7F,
            template_options: 0,
            content: records,
        }));
    }

    fn token(&mut self, element: &Element, size: u8, content: &mut Vec<Record>) {
        let text = element.text();
        let letters: Vec<char> = text
            .chars()
            .filter(|c| !matches!(c, '\u{2061}'..='\u{2064}'))
            .collect();
        let variant = element.attribute("mathvariant");
        // an integral sign MathType 7 has no character for, without limits: the old integral template
        if let Some(integral) = letters
            .first()
            .filter(|_| letters.len() == 1)
            .and_then(|&c| old_big_operator(c))
        {
            return self.old_big_operator(integral, None, None, false, size, content);
        }
        // accents written as combining marks of their own: embellishments of the character before them
        let marks: Option<Vec<u8>> = letters
            .iter()
            .map(|&c| combining_embellishment(c))
            .collect();
        if let (Some(marks), Some(Record::Char(previous))) =
            (marks.filter(|m| !m.is_empty()), content.last_mut())
        {
            for kind in marks {
                previous
                    .embellishments
                    .push(Record::Embellishment(Embellishment {
                        options: 0,
                        nudge: None,
                        kind,
                    }));
            }
            previous.options |= CHAR_HAS_EMBELLISHMENT;
            return;
        }
        let function = matches!(element.name.as_str(), "mi" | "mo")
            && letters.len() > 1
            && matches!(variant, None | Some("normal"))
            && letters
                .iter()
                .all(|&c| c.is_alphabetic() || unicode_space(c).is_some());
        let mut index = 0;
        while index < letters.len() {
            let c = letters[index];
            // accents written as combining marks after their character are its embellishments
            let mut embellishments = Vec::new();
            while let Some(kind) = letters
                .get(index + 1)
                .and_then(|&mark| combining_embellishment(mark))
            {
                embellishments.push(Record::Embellishment(Embellishment {
                    options: 0,
                    nudge: None,
                    kind,
                }));
                index += 1;
            }
            // a Unicode space inside the token (\limsup's six-per-em space, an em space in text): MathType's own
            if let Some(code) = unicode_space(c) {
                let glyph = Glyph {
                    typeface: TYPEFACE_SPACE,
                    font: None,
                    mt_code: code,
                    encoded8: None,
                };
                self.char(glyph, false, Vec::new(), size, content);
                index += 1;
                continue;
            }
            let styled = variant.filter(|variant| *variant != "normal");
            let glyph = match element.name.as_str() {
                _ if function => plain(TYPEFACE_FUNCTION, c),
                "mn" if styled.is_some() => identifier(c, styled.unwrap()),
                "mo" if styled.is_some() && c.is_alphanumeric() => identifier(c, styled.unwrap()),
                "mi" => identifier(
                    c,
                    variant.unwrap_or(if letters.len() == 1 {
                        "italic"
                    } else {
                        "normal"
                    }),
                ),
                "mn" if c.is_ascii_digit() => plain(TYPEFACE_NUMBER, c),
                "mtext" | "ms" => text_glyph(c),
                _ => operator(c),
            };
            let start = function && index == 0;
            self.char(glyph, start, embellishments, size, content);
            index += 1;
        }
    }

    fn char(
        &mut self,
        glyph: Glyph,
        function_start: bool,
        embellishments: Vec<Record>,
        size: u8,
        content: &mut Vec<Record>,
    ) {
        self.sized(size, content);
        let glyph = match drawable(glyph) {
            Ok(glyph) => glyph,
            Err('\u{FFFD}') if self.placeholder.is_some() => {
                self.colored(content);
                content.extend(self.placeholder.clone().map(Record::Char));
                return;
            }
            Err(c) => {
                self.undrawable.push(c);
                return;
            }
        };
        let typeface = match glyph.font {
            Some(font) => self.font_style(font, content),
            None => i32::from(glyph.typeface),
        };
        self.colored(content);
        let mut options = 0;
        if function_start {
            options |= CHAR_FUNCTION_START;
        }
        if glyph.encoded8.is_some() {
            options |= CHAR_ENCODED8;
        }
        if !embellishments.is_empty() {
            options |= CHAR_HAS_EMBELLISHMENT;
        }
        content.push(Record::Char(Char {
            options,
            nudge: None,
            typeface: Typeface {
                value: typeface,
                wide: false,
            },
            mt_code: Some(glyph.mt_code),
            encoded8: glyph.encoded8,
            encoded16: None,
            embellishments,
        }));
    }

    /// The typeface (-n) of a font style, defining its encoding, font and style where they are first used.
    fn font_style(&mut self, font: Font, content: &mut Vec<Record>) -> i32 {
        let encoding = match font.encoding {
            None => 5,
            Some(name) => {
                let index = self
                    .encodings
                    .iter()
                    .position(|known| known == name.as_bytes())
                    .unwrap_or_else(|| {
                        content.push(Record::EncodingDef(name.as_bytes().to_vec()));
                        self.encodings.push(name.as_bytes().to_vec());
                        self.encodings.len() - 1
                    });
                5 + index as u16
            }
        };
        let font_index = self
            .fonts
            .iter()
            .position(|known| known == font.name.as_bytes())
            .unwrap_or_else(|| {
                content.push(Record::FontDef {
                    encoding: Unsigned::new(encoding),
                    name: font.name.as_bytes().to_vec(),
                });
                self.fonts.push(font.name.as_bytes().to_vec());
                self.fonts.len() - 1
            });
        let key = (font_index as u16 + 1, font.style);
        let style = self
            .styles
            .iter()
            .position(|known| *known == key)
            .unwrap_or_else(|| {
                content.push(Record::FontStyleDef {
                    font: Unsigned::new(key.0),
                    style: key.1,
                });
                self.styles.push(key);
                self.styles.len() - 1
            });
        -(style as i32 + 1)
    }

    fn space(&mut self, element: &Element, size: u8, content: &mut Vec<Record>) {
        let Some(code) = space_code(element.attribute("width").unwrap_or("0em")) else {
            return;
        };
        let glyph = Glyph {
            typeface: TYPEFACE_SPACE,
            font: None,
            mt_code: code,
            encoded8: None,
        };
        self.char(glyph, false, Vec::new(), size, content);
    }

    /// An expanding fence pair (\left ... \right, mfenced): a fence template with the inner row and its two
    /// characters (an empty side is a missing fence).
    fn fence(
        &mut self,
        open: String,
        close: String,
        inner: &[&Element],
        size: u8,
        content: &mut Vec<Record>,
    ) {
        let kind = |c: &str| match c {
            "(" | ")" => Some(TEMPLATE_PAREN),
            "[" | "]" => Some(TEMPLATE_BRACKET),
            "{" | "}" => Some(TEMPLATE_BRACE),
            "\u{27E8}" | "\u{27E9}" | "\u{2329}" | "\u{232A}" => Some(TEMPLATE_ANGLE),
            "|" => Some(TEMPLATE_BAR),
            "\u{2016}" | "\u{2225}" => Some(TEMPLATE_DOUBLE_BAR),
            "\u{230A}" | "\u{230B}" => Some(TEMPLATE_FLOOR),
            "\u{2308}" | "\u{2309}" => Some(TEMPLATE_CEILING),
            "\u{27E6}" | "\u{27E7}" => Some(TEMPLATE_DOUBLE_BRACKET),
            _ => None,
        };
        let (left, right) = (kind(&open), kind(&close));
        // an interval: two of ( ) [ ] that are not a pair, their codes 0-3 in the low and high nibble
        let interval = |c: &str| ["(", ")", "[", "]"].iter().position(|fence| *fence == c);
        let (selector, variation) = match (interval(&open), interval(&close)) {
            (Some(l), Some(r)) if left != right || l == r || l > r => {
                (TEMPLATE_INTERVAL, (l | r << 4) as u16)
            }
            _ => (
                left.or(right).unwrap_or(TEMPLATE_PAREN),
                u16::from(left.is_some()) | u16::from(right.is_some()) << 1,
            ),
        };
        self.template(selector, variation, content, size, |writer, slots| {
            writer.line(inner, size, slots);
            for (text, first) in [(&open, true), (&close, false)] {
                if kind(text).is_some() {
                    let c = text.chars().next().unwrap();
                    let code = fence_code(c, first);
                    let glyph = Glyph {
                        typeface: 22,
                        font: None,
                        mt_code: code,
                        encoded8: None,
                    };
                    writer.char(glyph, false, Vec::new(), size, slots);
                }
            }
        });
    }

    /// Scripts before their base (mmultiscripts with mprescripts): a script template marked as preceding (variation
    /// 0x01), then the base; scripts after the base follow it as usual.
    fn multiscripts(&mut self, children: &[&Element], size: u8, content: &mut Vec<Record>) {
        let Some(base) = children.first() else { return };
        let split = children
            .iter()
            .position(|child| child.name == "mprescripts");
        fn script<'e>(element: Option<&&'e Element>) -> Option<&'e Element> {
            element.copied().filter(|element| element.name != "none")
        }
        let (post, pre) = match split {
            Some(at) => (&children[1..at], &children[at + 1..]),
            None => (&children[1..], &children[children.len()..]),
        };
        let scripts = script_size(size);
        let (sub, sup) = (script(pre.first()), script(pre.get(1)));
        if sub.is_some() || sup.is_some() {
            let selector = match (sub, sup) {
                (Some(_), None) => TEMPLATE_SUB,
                (None, Some(_)) => TEMPLATE_SUP,
                _ => TEMPLATE_SUB_SUP,
            };
            self.template(selector, 0x01, content, size, |writer, slots| {
                writer.slot(sub, scripts, slots);
                writer.slot(sup, scripts, slots);
            });
        }
        self.node(base, size, content);
        let (sub, sup) = (script(post.first()), script(post.get(1)));
        if sub.is_some() || sup.is_some() {
            let selector = match (sub, sup) {
                (Some(_), None) => TEMPLATE_SUB,
                (None, Some(_)) => TEMPLATE_SUP,
                _ => TEMPLATE_SUB_SUP,
            };
            self.template(selector, 0, content, size, |writer, slots| {
                writer.slot(sub, scripts, slots);
                writer.slot(sup, scripts, slots);
            });
        }
    }

    fn enclose(
        &mut self,
        element: &Element,
        children: &[&Element],
        size: u8,
        content: &mut Vec<Record>,
    ) {
        let notation = element.attribute("notation").unwrap_or("");
        let words: Vec<&str> = notation.split_whitespace().collect();
        let has = |word: &str| words.contains(&word);
        // sides as MathType 6.9 draws them: its box template only whole or as left and top or right and bottom
        // (other side variations crash MTXFormEqn: probe-bs-*), a lone top or bottom as the bar templates, left
        // and right sides as a bar fence; any other set of sides the whole box
        let sides = (has("left"), has("right"), has("top"), has("bottom"));
        let bar = |writer: &mut Self, selector: u8, content: &mut Vec<Record>| {
            writer.template(selector, 0, content, size, |writer, slots| {
                writer.line(children, size, slots)
            });
        };
        match sides {
            _ if has("box") || has("roundedbox") => {}
            (true, false, true, false) | (false, true, false, true) => {
                let variation = if sides.0 { 0x0A } else { 0x14 };
                return self.template(TEMPLATE_BOX, variation, content, size, |writer, slots| {
                    writer.line(children, size, slots)
                });
            }
            (false, false, true, false) => return bar(self, TEMPLATE_OVERBAR, content),
            (false, false, false, true) => return bar(self, TEMPLATE_UNDERBAR, content),
            (left, right, false, false) if left || right => {
                let side = |on: bool| if on { "|".to_string() } else { String::new() };
                return self.fence(side(left), side(right), children, size, content);
            }
            _ => {}
        }
        let any_side = sides.0 || sides.1 || sides.2 || sides.3;
        let (selector, variation) = if has("box") || has("roundedbox") || any_side {
            (TEMPLATE_BOX, 0x1E)
        } else {
            let mut variation = 0;
            if notation.contains("horizontalstrike") {
                variation |= 0x01;
            }
            if notation.contains("updiagonalstrike") {
                variation |= 0x02;
            }
            if notation.contains("downdiagonalstrike") {
                variation |= 0x04;
            }
            (TEMPLATE_STRIKE, variation)
        };
        self.template(selector, variation, content, size, |writer, slots| {
            writer.line(children, size, slots)
        });
    }

    fn table(&mut self, table: &Element, rows: &[&Element], size: u8, content: &mut Vec<Record>) {
        let rows: Vec<Vec<&Element>> = rows
            .iter()
            .filter(|row| row.name == "mtr")
            .map(|row| row.elements().filter(|c| c.name == "mtd").collect())
            .collect();
        let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
        // an empty table draws nothing (MathType crashes on a 0x0 matrix)
        if columns == 0 {
            return;
        }
        self.sized(size, content);
        self.colored(content);
        let mut cells = Vec::new();
        for row in &rows {
            for column in 0..columns {
                let cell: Vec<&Element> = row
                    .get(column)
                    .map(|cell| cell.elements().collect())
                    .unwrap_or_default();
                self.line_of(&cell, size, false, &mut cells);
            }
        }
        let frame = table
            .attribute("frame")
            .is_some_and(|frame| frame != "none");
        let row_partitions = partitions(table.attribute("rowlines"), rows.len(), frame);
        let column_partitions = partitions(table.attribute("columnlines"), columns, frame);
        content.push(Record::Matrix(Matrix {
            options: 0,
            nudge: None,
            vertical: 1,
            horizontal_justification: 1,
            vertical_justification: 1,
            rows: rows.len() as u8,
            columns: columns as u8,
            row_partitions,
            column_partitions,
            content: cells,
        }));
    }
}

/// Whether a MathML length is zero ("0", "0em", "0pt" ...).
fn zero_length(value: Option<&str>) -> bool {
    value.is_some_and(|v| {
        let number = v
            .trim()
            .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == '%');
        number.parse::<f64>().is_ok_and(|n| n == 0.0)
    })
}
