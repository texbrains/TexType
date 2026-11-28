//! A MathType equation as Presentation MathML: how TexType reads an equation it did not write (the editor's LaTeX
//! comes from this MathML through `omml::word_equation_latex`).
//!
//! The MathML follows the records alone. A line is a row; characters become tokens by their MathType style
//! (variable, function, number, text, symbol ...) and the style's font; a template becomes the MathML element for
//! its slots; embellishments become accents and primes. The references are the MathML MathType's import was given
//! and MathType's own MathML export (testing/corpus/mathtype/import.jsonl, core/convert/tests/mathtype.rs).

mod node;

use super::mtef::{Char, ColorDef, EqnPrefs, Matrix, Mtef, Pile, Record, Template};
use super::records::*;
use node::{row_node, Family, Node, Run, Style};

/// The equation as one `<math>` element.
pub fn to_mathml(mtef: &Mtef) -> String {
    let mut reader = Reader::default();
    let row = reader.row(&mtef.records);
    // the options' bit 0x01 marks an inline equation
    let display = if mtef.equation_options & 0x01 == 0 {
        "block"
    } else {
        "inline"
    };
    let mut out =
        format!("<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"{display}\">");
    if !row.is_empty() {
        row_node(row).write(&mut out);
    }
    out.push_str("</math>");
    out
}

/// The MathML of a run of records inside an equation, `context` being the definitions and preferences of the whole
/// equation (MTEF numbers them by position) and the colour in effect before the run. Two runs that read the same
/// draw the same.
pub(crate) fn records_mathml<'a>(context: &[&'a Record], records: &'a [Record]) -> String {
    let mut reader = Reader::default();
    for record in context {
        reader.state(record);
    }
    let mut out = String::new();
    for node in reader.row(records) {
        node.write(&mut out);
    }
    out
}

/// The definitions met so far, numbered from 1 in stream order as MTEF numbers them, and the current colour.
#[derive(Default)]
struct Reader<'a> {
    fonts: Vec<&'a [u8]>,
    font_styles: Vec<(u16, u8)>,
    colors: Vec<&'a ColorDef>,
    color: Option<String>,
    prefs: Option<&'a EqnPrefs>,
}

/// A template's slots and its own characters (fences, braces), in stream order.
struct Slots {
    lines: Vec<Vec<Node>>,
    chars: Vec<Node>,
}

impl Slots {
    fn take(&mut self, index: usize) -> Vec<Node> {
        self.lines
            .get_mut(index)
            .map(std::mem::take)
            .unwrap_or_default()
    }
}

impl<'a> Reader<'a> {
    /// The nodes of a run of records (a line's content).
    fn row(&mut self, records: &'a [Record]) -> Vec<Node> {
        let nodes = self.nodes(records);
        apply_functions(nodes)
    }

    /// `row` before function names are applied (a line inside a line joins its parent's row).
    fn nodes(&mut self, records: &'a [Record]) -> Vec<Node> {
        let mut nodes: Vec<Node> = Vec::new();
        for record in records {
            match record {
                Record::Line(line) => {
                    let content = self.nodes(&line.content);
                    nodes.extend(content);
                }
                Record::Char(c) => self.char(c, &mut nodes),
                Record::Template(template) => self.template(template, &mut nodes),
                Record::Pile(pile) => nodes.push(self.pile(pile)),
                Record::Matrix(matrix) => nodes.push(self.matrix(matrix)),
                other => self.state(other),
            }
            if let [.., scripts, base] = &mut nodes[..] {
                if scripts.awaits_base && !base.awaits_base {
                    let base = nodes.pop().unwrap();
                    let scripts = nodes.last_mut().unwrap();
                    scripts.children.insert(0, base);
                    scripts.awaits_base = false;
                }
            }
        }
        if let Some(scripts) = nodes.last_mut().filter(|node| node.awaits_base) {
            scripts
                .children
                .insert(0, Node::element("mrow", Vec::new()));
            scripts.awaits_base = false;
        }
        nodes
    }

    /// Definitions and settings that apply to the records after them.
    fn state(&mut self, record: &'a Record) {
        match record {
            Record::FontDef { name, .. } => self.fonts.push(name),
            Record::FontStyleDef { font, style } => self.font_styles.push((font.value, *style)),
            Record::ColorDef(color) => self.colors.push(color),
            Record::Color(index) => {
                self.color = index
                    .value
                    .checked_sub(1)
                    .and_then(|i| self.colors.get(i as usize))
                    .and_then(|color| color_text(color));
            }
            Record::EqnPrefs(prefs) => self.prefs = Some(prefs),
            _ => {}
        }
    }

    fn slots(&mut self, records: &'a [Record]) -> Slots {
        let mut slots = Slots {
            lines: Vec::new(),
            chars: Vec::new(),
        };
        for record in records {
            match record {
                Record::Line(line) => {
                    let content = self.row(&line.content);
                    slots.lines.push(content);
                }
                Record::Char(c) => self.char(c, &mut slots.chars),
                Record::Template(_) | Record::Pile(_) | Record::Matrix(_) => {
                    let nodes = self.row(std::slice::from_ref(record));
                    slots.lines.push(nodes);
                }
                other => self.state(other),
            }
        }
        slots
    }

    fn char(&mut self, c: &Char, nodes: &mut Vec<Node>) {
        let typeface = c.typeface.value;
        let code = c
            .mt_code
            .map(u32::from)
            .or(c.encoded16.map(u32::from))
            .or(c.encoded8.map(u32::from));
        if typeface == i32::from(TYPEFACE_MARKER)
            || code == Some(MATHTYPE_ALIGNMENT_MARKER_MT_CODE as u32)
        {
            return;
        }
        let Some(ch) = code.and_then(|code| self.unicode(code, c)) else {
            return;
        };
        if typeface == i32::from(TYPEFACE_SPACE) {
            let mut space = Node::token("mspace", "");
            if let Some(width) = space_width(ch) {
                space = space.with("width", width);
            }
            nodes.push(space);
            return;
        }
        let style = self.style(typeface);
        let latin = ch.is_ascii_alphanumeric();
        let style = Style {
            family: if latin { style.family } else { Family::Plain },
            ..style
        };
        let (tag, run) = match typeface as u8 {
            _ if typeface < 0 => token_kind(ch, None),
            TYPEFACE_TEXT => ("mtext", Some(Run::Text)),
            TYPEFACE_FAR_EAST_TEXT if !is_math_symbol(ch) => ("mtext", Some(Run::Text)),
            TYPEFACE_FUNCTION => token_kind(ch, Some(Run::Function)),
            TYPEFACE_NUMBER if ch == '.' => ("mn", Some(Run::Number)),
            TYPEFACE_NUMBER => token_kind(ch, Some(Run::Number)),
            _ => token_kind(ch, None),
        };
        let mut token = Node::token(tag, ch.to_string());
        token.style = style;
        token.run = run;
        if let Some(color) = &self.color {
            token = token.with("mathcolor", color.clone());
        }
        if c.embellishments.is_empty() {
            let starts = c.options & CHAR_FUNCTION_START != 0;
            if let Some(last) = nodes.last_mut() {
                if !starts
                    && token.run.is_some()
                    && last.run == token.run
                    && last.tag == token.tag
                    && last.style == token.style
                    && last.attributes == token.attributes
                {
                    last.text.push(ch);
                    return;
                }
            }
            nodes.push(token);
            return;
        }
        token.run = None;
        let mut node = token;
        for record in &c.embellishments {
            if let Record::Embellishment(embellishment) = record {
                node = embellish(node, embellishment.kind);
            }
        }
        nodes.push(node);
    }

    /// The character an MTCode stands for. MathType's private codes are its expanding fences and braces, loop
    /// integrals and spaces; any other private code is a font position (a letter of Euclid Fraktur, a digit of
    /// Euclid Math Two), read from the character's 8-bit code.
    fn unicode(&self, code: u32, c: &Char) -> Option<char> {
        let mapped = match code {
            0xEC07 | 0xEC08 => '|',
            0xEC09 | 0xEC0A => '\u{2016}',
            0xEC0C => '\u{23B5}',
            0xEC0D => '\u{23B4}',
            0xF8EE => '\u{2308}',
            0xF8F0 => '\u{230A}',
            0xF8F9 => '\u{2309}',
            0xF8FB => '\u{230B}',
            0xFE37 => '\u{23DE}',
            0xFE38 => '\u{23DF}',
            0x2329 => '\u{27E8}',
            0x232A => '\u{27E9}',
            0x301A => '\u{27E6}',
            0x301B => '\u{27E7}',
            0xEE00 => '\u{2232}',
            0xEE01 => '\u{2233}',
            0xEE11 => '\u{222E}',
            0xEE12 => '\u{222F}',
            0xEE13 => '\u{2230}',
            // Euclid Math One's dotless j
            0xED02 => '\u{0237}',
            // MT Extra's large cup and cap (the ordinary ones are Symbol's)
            0x222A if c.typeface.value == i32::from(TYPEFACE_MT_EXTRA) => '\u{22C3}',
            0x2229 if c.typeface.value == i32::from(TYPEFACE_MT_EXTRA) => '\u{22C2}',
            0xEB00..=0xEFFF if c.typeface.value == i32::from(TYPEFACE_SPACE) => {
                char::from_u32(code)?
            }
            0xE000..=0xF8FF => char::from(c.encoded8?),
            _ => char::from_u32(code)?,
        };
        Some(mapped)
    }

    /// The style a typeface draws with: its binding in the equation preferences (or MathType's defaults), or the
    /// FONT_STYLE_DEF a negative typeface names.
    fn style(&self, typeface: i32) -> Style {
        let binding = if typeface < 0 {
            self.font_styles.get((-typeface - 1) as usize).copied()
        } else {
            self.prefs
                .and_then(|prefs| prefs.styles.get(typeface as usize - 1))
                .and_then(|binding| binding.style.map(|style| (binding.font.value, style)))
        };
        let Some((font, style)) = binding else {
            return default_style(typeface);
        };
        let name = font
            .checked_sub(1)
            .and_then(|i| self.fonts.get(i as usize))
            .copied()
            .unwrap_or_default();
        Style {
            family: family(name),
            bold: style & 0x01 != 0,
            italic: style & 0x02 != 0,
        }
    }

    fn template(&mut self, template: &'a Template, nodes: &mut Vec<Node>) {
        let mut slots = self.slots(&template.content);
        let variation = template.variation;
        let selector = template.selector;
        let node = match selector {
            TEMPLATE_ANGLE..=TEMPLATE_INTERVAL => fence(selector, variation, &mut slots),
            TEMPLATE_ROOT => {
                let radicand = row_node(slots.take(0));
                let index = slots.take(1);
                if variation & 0x01 != 0 || !index.is_empty() {
                    Node::element("mroot", vec![radicand, row_node(index)])
                } else {
                    Node::element("msqrt", vec![radicand])
                }
            }
            TEMPLATE_FRACTION => {
                let fraction = Node::element(
                    "mfrac",
                    vec![row_node(slots.take(0)), row_node(slots.take(1))],
                );
                if variation & 0x02 != 0 {
                    fraction.with("bevelled", "true")
                } else {
                    fraction
                }
            }
            TEMPLATE_UNDERBAR => Node::element(
                "munder",
                vec![
                    row_node(slots.take(0)),
                    Node::token("mo", "_").with("stretchy", "true"),
                ],
            )
            .with("accentunder", "true"),
            TEMPLATE_OVERBAR => over_accent(row_node(slots.take(0)), "\u{00AF}"),
            TEMPLATE_INTEGRAL..=TEMPLATE_SUM_OPERATOR => {
                let operand = slots.take(0);
                let lower = slots.take(1);
                let upper = slots.take(2);
                // MathType 7 keeps the sign in a fourth slot, older templates as characters
                let sign = match slots.lines.get_mut(3) {
                    Some(line) if !line.is_empty() => row_node(std::mem::take(line)),
                    _ => Node::token("mo", big_operator_sign(selector, variation, &slots.chars)),
                };
                let lower = (variation & 0x10 != 0 || !lower.is_empty()).then(|| row_node(lower));
                let upper = (variation & 0x20 != 0 || !upper.is_empty()).then(|| row_node(upper));
                nodes.push(scripted(sign, lower, upper, variation & 0x40 != 0));
                nodes.extend(operand);
                return;
            }
            TEMPLATE_LIMIT => {
                let main = row_node(slots.take(0));
                let lower = slots.take(1);
                let upper = slots.take(2);
                let lower = (variation & 0x10 != 0 || !lower.is_empty()).then(|| row_node(lower));
                let upper = (variation & 0x20 != 0 || !upper.is_empty()).then(|| row_node(upper));
                scripted(main, lower, upper, true)
            }
            TEMPLATE_HORIZONTAL_BRACE | TEMPLATE_HORIZONTAL_BRACKET => {
                let top = variation & 0x01 != 0;
                let main = row_node(slots.take(0));
                let label = slots.take(1);
                let brace = match (selector, top) {
                    (TEMPLATE_HORIZONTAL_BRACE, true) => "\u{23DE}",
                    (TEMPLATE_HORIZONTAL_BRACE, false) => "\u{23DF}",
                    (_, true) => "\u{23B4}",
                    (_, false) => "\u{23B5}",
                };
                let tag = if top { "mover" } else { "munder" };
                let braced = Node::element(
                    tag,
                    vec![main, Node::token("mo", brace).with("stretchy", "true")],
                );
                if label.is_empty() {
                    braced
                } else {
                    Node::element(tag, vec![braced, row_node(label)])
                }
            }
            TEMPLATE_SUB | TEMPLATE_SUP | TEMPLATE_SUB_SUP if variation & 0x01 != 0 => {
                // scripts before the node that follows them
                let script = |nodes: Vec<Node>| {
                    if nodes.is_empty() {
                        Node::element("none", Vec::new())
                    } else {
                        row_node(nodes)
                    }
                };
                let sub = script(if selector == TEMPLATE_SUP {
                    Vec::new()
                } else {
                    slots.take(0)
                });
                let sup = script(if selector == TEMPLATE_SUB {
                    Vec::new()
                } else {
                    slots.take(1)
                });
                let prescripts = Node::element("mprescripts", Vec::new());
                Node {
                    awaits_base: true,
                    ..Node::element("mmultiscripts", vec![prescripts, sub, sup])
                }
            }
            TEMPLATE_ARROW => {
                // an arrow with text over (0x04) and under (0x08) it
                let over = slots.take(0);
                let under = slots.take(1);
                let text: String = slots.chars.iter().map(|c| c.text.as_str()).collect();
                let arrow = match text.as_str() {
                    "\u{2192}\u{2190}" => "\u{21C4}".to_string(),
                    "\u{2190}\u{2192}" => "\u{21C6}".to_string(),
                    "\u{21C0}\u{21BD}" => "\u{21CC}".to_string(),
                    "\u{21BC}\u{21C1}" => "\u{21CB}".to_string(),
                    // the template's arrow stretches: a long arrow
                    "\u{2192}" => "\u{27F6}".to_string(),
                    "\u{2190}" => "\u{27F5}".to_string(),
                    "\u{2194}" => "\u{27F7}".to_string(),
                    _ => text,
                };
                let arrow = Node::token("mo", arrow).with("stretchy", "true");
                let over = (variation & 0x04 != 0 || !over.is_empty()).then(|| row_node(over));
                let under = (variation & 0x08 != 0 || !under.is_empty()).then(|| row_node(under));
                scripted(arrow, under, over, true)
            }
            TEMPLATE_SUB | TEMPLATE_SUP | TEMPLATE_SUB_SUP => {
                // scripts follow what is before them; after other scripts they stand alone, as MathType draws them
                let follows_scripts = nodes
                    .last()
                    .is_some_and(|last| matches!(last.tag, "msub" | "msup" | "msubsup"));
                let base = if follows_scripts { None } else { nodes.pop() };
                let base = base.unwrap_or_else(|| Node::element("mrow", Vec::new()));
                let sub = row_node(slots.take(0));
                let sup = row_node(slots.take(1));
                match selector {
                    TEMPLATE_SUB => Node::element("msub", vec![base, sub]),
                    TEMPLATE_SUP => Node::element("msup", vec![base, sup]),
                    _ => Node::element("msubsup", vec![base, sub, sup]),
                }
            }
            TEMPLATE_VECTOR => {
                let arrow = match variation & 0x03 {
                    0x01 => "\u{2190}",
                    0x03 => "\u{2194}",
                    _ if variation & 0x08 != 0 => "\u{21C0}",
                    _ => "\u{2192}",
                };
                let main = row_node(slots.take(0));
                let mark = Node::token("mo", arrow).with("stretchy", "true");
                if variation & 0x04 != 0 {
                    Node::element("munder", vec![main, mark]).with("accentunder", "true")
                } else {
                    Node::element("mover", vec![main, mark]).with("accent", "true")
                }
            }
            TEMPLATE_DIRAC => {
                // bra (0x01), ket (0x02) or both: ⟨a|, |b⟩, ⟨a|b⟩ with the template's own characters
                let mut children = Vec::new();
                let mut chars = slots.chars.drain(..);
                let mut mark = |default: &str| {
                    chars
                        .next()
                        .map(|c| c.text)
                        .unwrap_or_else(|| default.to_string())
                };
                let (bra, ket) = (variation & 0x01 != 0, variation & 0x02 != 0);
                let open = if bra { mark("\u{27E8}") } else { String::new() };
                if bra {
                    children.extend(
                        slots
                            .lines
                            .get_mut(0)
                            .map(std::mem::take)
                            .unwrap_or_default(),
                    );
                }
                let bar = mark("|");
                let close = if ket { mark("\u{27E9}") } else { String::new() };
                match (bra, ket) {
                    (true, true) => {
                        children.push(
                            Node::token("mo", bar)
                                .with("fence", "true")
                                .with("stretchy", "true"),
                        );
                        children.extend(
                            slots
                                .lines
                                .get_mut(1)
                                .map(std::mem::take)
                                .unwrap_or_default(),
                        );
                        fenced(&open, &close, children)
                    }
                    (true, false) => fenced(&open, &bar, children),
                    _ => fenced(
                        &bar,
                        &close,
                        slots
                            .lines
                            .get_mut(1)
                            .map(std::mem::take)
                            .unwrap_or_default(),
                    ),
                }
            }
            TEMPLATE_TILDE => over_accent(row_node(slots.take(0)), "\u{02DC}"),
            TEMPLATE_HAT => over_accent(row_node(slots.take(0)), "\u{02C6}"),
            TEMPLATE_ARC => over_accent(row_node(slots.take(0)), "\u{2322}"),
            TEMPLATE_STRIKE => {
                let mut notation = Vec::new();
                if variation & 0x01 != 0 {
                    notation.push("horizontalstrike");
                }
                if variation & 0x02 != 0 {
                    notation.push("updiagonalstrike");
                }
                if variation & 0x04 != 0 {
                    notation.push("downdiagonalstrike");
                }
                Node::element("menclose", vec![row_node(slots.take(0))])
                    .with("notation", notation.join(" "))
            }
            TEMPLATE_BOX => {
                let sides = [
                    (0x02, "left"),
                    (0x04, "right"),
                    (0x08, "top"),
                    (0x10, "bottom"),
                ];
                let notation = if variation & 0x1E == 0x1E {
                    if variation & 0x01 != 0 {
                        "roundedbox".to_string()
                    } else {
                        "box".to_string()
                    }
                } else {
                    sides
                        .iter()
                        .filter(|(bit, _)| variation & bit != 0)
                        .map(|(_, side)| *side)
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                Node::element("menclose", vec![row_node(slots.take(0))]).with("notation", notation)
            }
            _ => {
                let mut content: Vec<Node> = slots.lines.drain(..).flatten().collect();
                content.append(&mut slots.chars);
                row_node(content)
            }
        };
        nodes.push(node);
    }

    /// A pile: its lines one above the other.
    fn pile(&mut self, pile: &'a Pile) -> Node {
        let rows = self.slots(&pile.content).lines;
        let table = Node::element(
            "mtable",
            rows.into_iter()
                .map(|row| Node::element("mtr", vec![Node::element("mtd", row)]))
                .collect(),
        );
        match pile.horizontal {
            1 => table.with("columnalign", "left"),
            3 => table.with("columnalign", "right"),
            _ => table,
        }
    }

    /// A matrix: its cells row by row.
    fn matrix(&mut self, matrix: &'a Matrix) -> Node {
        let cells = self.slots(&matrix.content).lines;
        let columns = usize::from(matrix.columns.max(1));
        let rows = cells
            .chunks(columns)
            .map(|row| {
                Node::element(
                    "mtr",
                    row.iter()
                        .map(|cell| Node::element("mtd", cell.clone()))
                        .collect(),
                )
            })
            .collect();
        let mut table = Node::element("mtable", rows);
        let row_lines = partition_lines(&matrix.row_partitions, usize::from(matrix.rows));
        let column_lines = partition_lines(&matrix.column_partitions, columns);
        let inner = |lines: &[&str]| -> Option<String> {
            let inner = lines
                .get(1..lines.len().saturating_sub(1))
                .unwrap_or_default();
            inner
                .iter()
                .any(|line| *line != "none")
                .then(|| inner.join(" "))
        };
        if let Some(lines) = inner(&row_lines) {
            table = table.with("rowlines", lines);
        }
        if let Some(lines) = inner(&column_lines) {
            table = table.with("columnlines", lines);
        }
        let outer = [
            row_lines[0],
            row_lines[row_lines.len() - 1],
            column_lines[0],
            column_lines[column_lines.len() - 1],
        ];
        if outer.iter().all(|line| *line != "none") {
            table = table.with("frame", outer[0]);
        }
        table
    }
}

/// A matrix's lines between and around `count` rows or columns: two bits a line from the first (0 none,
/// 1 solid, 2 dashed; 3, dotted, as dashed), four lines a byte from its low bits.
fn partition_lines(bytes: &[u8], count: usize) -> Vec<&'static str> {
    (0..=count)
        .map(|line| {
            match bytes
                .get(line / 4)
                .map(|byte| byte >> ((line % 4) * 2) & 0x03)
            {
                Some(1) => "solid",
                Some(2 | 3) => "dashed",
                _ => "none",
            }
        })
        .collect()
}

/// A token for one character: letters are identifiers, digits numbers, everything else an operator.
fn token_kind(ch: char, run: Option<Run>) -> (&'static str, Option<Run>) {
    if ch.is_alphabetic() {
        ("mi", (run == Some(Run::Function)).then_some(Run::Function))
    } else if ch.is_numeric() {
        ("mn", Some(Run::Number))
    } else {
        ("mo", None)
    }
}

/// Characters the far-east text style holds that are symbols (MathType stores \ni and \bigcirc there).
fn is_math_symbol(ch: char) -> bool {
    matches!(ch as u32, 0x2190..=0x2BFF)
}

/// MathType's defaults for the styles when an equation has no preferences record.
fn default_style(typeface: i32) -> Style {
    match u8::try_from(typeface) {
        Ok(TYPEFACE_VARIABLE | TYPEFACE_LOWER_GREEK) => Style {
            italic: true,
            ..Style::default()
        },
        Ok(TYPEFACE_VECTOR) => Style {
            bold: true,
            ..Style::default()
        },
        _ => Style::default(),
    }
}

/// The MathML family of a font, by the fonts MathType's styles and its import use.
fn family(name: &[u8]) -> Family {
    let name = String::from_utf8_lossy(name).to_ascii_lowercase();
    if name.starts_with("euclid math one") {
        Family::Script
    } else if name.starts_with("euclid math two") {
        Family::DoubleStruck
    } else if name.starts_with("euclid fraktur") {
        Family::Fraktur
    } else if name.starts_with("courier") || name.starts_with("consolas") {
        Family::Monospace
    } else if name.starts_with("arial")
        || name.starts_with("helvetica")
        || name.starts_with("verdana")
    {
        Family::SansSerif
    } else {
        Family::Plain
    }
}

/// A COLOR_DEF as #rrggbb (components 0-1000); black is the default colour.
fn color_text(color: &ColorDef) -> Option<String> {
    let [r, g, b] = color.components[..] else {
        return None;
    };
    if r == 0 && g == 0 && b == 0 {
        return None;
    }
    let byte = |v: u16| (u32::from(v.min(1000)) * 255 + 500) / 1000;
    Some(format!("#{:02X}{:02X}{:02X}", byte(r), byte(g), byte(b)))
}

/// MathType's space characters: the width its MathML export gives them (EF01 zero, EF03 U+205F, EF05 em, EF06
/// two em) and, for the ones that export drops, what its TeX import stores them for (EF04 \;, EF07 \,).
fn space_width(ch: char) -> Option<&'static str> {
    Some(match ch as u32 {
        0xEF01 => "0em",
        0xEF02 => "1pt",
        0xEF03 => "0.222em",
        0xEF04 => "0.278em",
        0xEF05 => "1em",
        0xEF06 => "2em",
        0xEF07 => "0.167em",
        _ => return None,
    })
}

fn over_accent(base: Node, mark: &str) -> Node {
    Node::element(
        "mover",
        vec![base, Node::token("mo", mark).with("stretchy", "true")],
    )
    .with("accent", "true")
}

/// munder/mover/munderover (limits) or msub/msup/msubsup.
fn scripted(base: Node, lower: Option<Node>, upper: Option<Node>, limits: bool) -> Node {
    let (under, over, both) = if limits {
        ("munder", "mover", "munderover")
    } else {
        ("msub", "msup", "msubsup")
    };
    match (lower, upper) {
        (Some(lower), Some(upper)) => Node::element(both, vec![base, lower, upper]),
        (Some(lower), None) => Node::element(under, vec![base, lower]),
        (None, Some(upper)) => Node::element(over, vec![base, upper]),
        (None, None) => base,
    }
}

/// A big operator's sign: its characters (integral signs, a loop over them) or the template's own.
fn big_operator_sign(selector: u8, variation: u16, chars: &[Node]) -> String {
    let text: String = chars.iter().map(|c| c.text.as_str()).collect();
    if let Some(looped) = text.chars().find(|c| {
        matches!(
            c,
            '\u{222E}' | '\u{222F}' | '\u{2230}' | '\u{2232}' | '\u{2233}'
        )
    }) {
        return looped.to_string();
    }
    match text.chars().filter(|&c| c == '\u{222B}').count() {
        0 if text.is_empty() => default_big_operator_sign(selector, variation).to_string(),
        2 if text.chars().all(|c| c == '\u{222B}') => "\u{222C}".to_string(),
        3 if text.chars().all(|c| c == '\u{222B}') => "\u{222D}".to_string(),
        _ => text,
    }
}

fn default_big_operator_sign(selector: u8, variation: u16) -> char {
    match selector {
        TEMPLATE_INTEGRAL | TEMPLATE_INTEGRAL_OPERATOR => {
            match (variation & 0x03, variation & 0x04 != 0) {
                (2, false) => '\u{222C}',
                (3, false) => '\u{222D}',
                (1, true) => '\u{222E}',
                (2, true) => '\u{222F}',
                (3, true) => '\u{2230}',
                _ => '\u{222B}',
            }
        }
        TEMPLATE_PRODUCT => '\u{220F}',
        TEMPLATE_COPRODUCT => '\u{2210}',
        TEMPLATE_UNION => '\u{22C3}',
        TEMPLATE_INTERSECTION => '\u{22C2}',
        TEMPLATE_SUM => '\u{2211}',
        _ => '\u{2211}',
    }
}

/// A fence template: its inner line between its own fence characters (bits 0x01 left, 0x02 right; an interval
/// has both, its variation names their kinds).
fn fence(selector: u8, variation: u16, slots: &mut Slots) -> Node {
    let inner = slots.take(0);
    let (default_left, default_right) = match selector {
        TEMPLATE_ANGLE => ("\u{27E8}", "\u{27E9}"),
        TEMPLATE_PAREN => ("(", ")"),
        TEMPLATE_BRACE => ("{", "}"),
        TEMPLATE_BRACKET => ("[", "]"),
        TEMPLATE_BAR => ("|", "|"),
        TEMPLATE_DOUBLE_BAR => ("\u{2016}", "\u{2016}"),
        TEMPLATE_FLOOR => ("\u{230A}", "\u{230B}"),
        TEMPLATE_CEILING => ("\u{2308}", "\u{2309}"),
        TEMPLATE_DOUBLE_BRACKET => ("\u{27E6}", "\u{27E7}"),
        _ => ("(", ")"),
    };
    let (has_left, has_right) = if variation & 0x03 == 0 || selector == TEMPLATE_INTERVAL {
        (true, true)
    } else {
        (variation & 0x01 != 0, variation & 0x02 != 0)
    };
    let mut chars = slots.chars.drain(..);
    let mut side = |present: bool, default: &str| -> String {
        if present {
            chars
                .next()
                .map(|c| c.text)
                .unwrap_or_else(|| default.to_string())
        } else {
            String::new()
        }
    };
    let left = side(has_left, default_left);
    let right = side(has_right, default_right);
    fenced(&left, &right, inner)
}

/// Expanding fences around a row (an empty side is a missing fence). mfenced, as MathType's own MathML and the
/// LaTeX converter's \left ... \right have it; one inner row, so no separators come between.
fn fenced(open: &str, close: &str, inner: Vec<Node>) -> Node {
    Node::element("mfenced", vec![Node::element("mrow", inner)])
        .with("open", open)
        .with("close", close)
        .with("separators", "")
}

/// Function names (MathType's function style) apply to what follows them: U+2061 after the name, or after its
/// scripts, as MathML writes it.
fn apply_functions(nodes: Vec<Node>) -> Vec<Node> {
    fn is_function(node: &Node) -> bool {
        match node.tag {
            "mi" => node.run == Some(Run::Function) && node.text.chars().count() > 1,
            "msub" | "msup" | "msubsup" => node.children.first().is_some_and(is_function),
            _ => false,
        }
    }
    let mut out: Vec<Node> = Vec::with_capacity(nodes.len());
    let mut nodes = nodes.into_iter().peekable();
    while let Some(node) = nodes.next() {
        let applies = is_function(&node) && nodes.peek().is_some();
        out.push(node);
        if applies {
            out.push(Node::token("mo", "\u{2061}"));
        }
    }
    out
}

/// A character's embellishment: an accent over or under it, a prime after it, or a stroke through it.
fn embellish(node: Node, kind: u8) -> Node {
    // the mark is in its character's colour
    let color = node
        .attributes
        .iter()
        .find(|(name, _)| *name == "mathcolor")
        .map(|(_, value)| value.clone());
    let mark = |text: &str| match &color {
        Some(color) => Node::token("mo", text).with("mathcolor", color.clone()),
        None => Node::token("mo", text),
    };
    let over =
        |text: &str| Node::element("mover", vec![node.clone(), mark(text)]).with("accent", "true");
    let under = |text: &str| {
        Node::element("munder", vec![node.clone(), mark(text)]).with("accentunder", "true")
    };
    let prime = |text: &str| Node::element("msup", vec![node.clone(), mark(text)]);
    let strike =
        |notation: &str| Node::element("menclose", vec![node.clone()]).with("notation", notation);
    match kind {
        EMBELL_DOT => over("\u{02D9}"),
        EMBELL_DOUBLE_DOT => over("\u{00A8}"),
        EMBELL_TRIPLE_DOT => over("\u{20DB}"),
        EMBELL_QUADRUPLE_DOT => over("\u{20DC}"),
        EMBELL_PRIME => prime("\u{2032}"),
        EMBELL_DOUBLE_PRIME => prime("\u{2033}"),
        EMBELL_TRIPLE_PRIME => prime("\u{2034}"),
        EMBELL_BACK_PRIME => prime("\u{2035}"),
        EMBELL_TILDE => over("\u{02DC}"),
        EMBELL_HAT => over("\u{02C6}"),
        EMBELL_RIGHT_ARROW => over("\u{2192}"),
        EMBELL_LEFT_ARROW => over("\u{2190}"),
        EMBELL_BOTH_ARROW => over("\u{2194}"),
        EMBELL_RIGHT_HARPOON => over("\u{21C0}"),
        EMBELL_LEFT_HARPOON => over("\u{21BC}"),
        EMBELL_OVERBAR => over("\u{00AF}"),
        EMBELL_FROWN => over("\u{2322}"),
        EMBELL_BREVE => over("\u{02D8}"),
        EMBELL_UNDER_DOT => under("."),
        EMBELL_UNDER_QUADRUPLE_DOT => under("\u{20DC}"),
        EMBELL_UNDERBAR => under("_"),
        EMBELL_UNDER_TILDE => under("\u{02DC}"),
        EMBELL_UNDER_FROWN => under("\u{2322}"),
        EMBELL_UNDER_SMILE => under("\u{2323}"),
        EMBELL_UNDER_RIGHT_ARROW => under("\u{2192}"),
        EMBELL_UNDER_LEFT_ARROW => under("\u{2190}"),
        EMBELL_UNDER_BOTH_ARROW => under("\u{2194}"),
        EMBELL_UNDER_RIGHT_HARPOON => under("\u{21C0}"),
        EMBELL_UNDER_LEFT_HARPOON => under("\u{21BC}"),
        EMBELL_MIDBAR => strike("horizontalstrike"),
        EMBELL_CROSS_BARS => strike("updiagonalstrike downdiagonalstrike"),
        EMBELL_UP_BAR => strike("updiagonalstrike"),
        EMBELL_DOWN_BAR => strike("downdiagonalstrike"),
        EMBELL_NOT if node.is_token() => {
            let mut node = node;
            node.text.push('\u{0338}');
            node
        }
        _ => node,
    }
}
