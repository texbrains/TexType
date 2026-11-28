//! Presentation MathML reduced to what two writings of one formula must share: the structure and the drawn
//! characters. Rows, styles and fenced groups are flattened; a token is its characters with its mathvariant applied
//! (an italic x is 𝑥), so token kinds, attributes, spacing and invisible operators do not count.

use quick_xml::encoding::Decoder;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

struct Element {
    name: String,
    attributes: Vec<(String, String)>,
    children: Vec<Item>,
}

enum Item {
    Element(Element),
    Text(String),
}

/// The canonical text of a MathML document; `variants: false` also drops mathvariant (for MathType's own export,
/// which writes none).
pub fn canonical(xml: &str, variants: bool) -> Result<String, String> {
    let root = parse(xml)?;
    let mut out = String::new();
    node(
        &root,
        Mode {
            variants,
            colors: false,
        },
        None,
        &mut out,
    );
    Ok(out)
}

/// `canonical` with each character's colour.
pub fn canonical_colored(xml: &str) -> Result<String, String> {
    let root = parse(xml)?;
    let mut out = String::new();
    node(
        &root,
        Mode {
            variants: true,
            colors: true,
        },
        None,
        &mut out,
    );
    Ok(out)
}

fn parse(xml: &str) -> Result<Element, String> {
    let mut reader = Reader::from_str(xml);
    let mut stack = vec![Element {
        name: String::new(),
        attributes: Vec::new(),
        children: Vec::new(),
    }];
    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(start) => stack.push(element(&start, reader.decoder())?),
            Event::Empty(start) => {
                let element = element(&start, reader.decoder())?;
                stack
                    .last_mut()
                    .unwrap()
                    .children
                    .push(Item::Element(element));
            }
            Event::End(_) => {
                let element = stack.pop().unwrap();
                stack
                    .last_mut()
                    .ok_or("unbalanced")?
                    .children
                    .push(Item::Element(element));
            }
            Event::Text(text) => {
                let text = text
                    .decode()
                    .map_err(|error| error.to_string())?
                    .into_owned();
                stack.last_mut().unwrap().children.push(Item::Text(text));
            }
            Event::GeneralRef(reference) => {
                let text = match reference
                    .resolve_char_ref()
                    .map_err(|error| error.to_string())?
                {
                    Some(c) => c.to_string(),
                    None => match reference
                        .decode()
                        .map_err(|error| error.to_string())?
                        .as_ref()
                    {
                        "lt" => "<".into(),
                        "gt" => ">".into(),
                        "amp" => "&".into(),
                        "quot" => "\"".into(),
                        "apos" => "'".into(),
                        other => return Err(format!("unknown entity {other}")),
                    },
                };
                stack.last_mut().unwrap().children.push(Item::Text(text));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut document = stack.pop().ok_or("unbalanced")?;
    document
        .children
        .retain(|item| matches!(item, Item::Element(_)));
    match document.children.pop() {
        Some(Item::Element(root)) if document.children.is_empty() => Ok(root),
        _ => Err("not one root element".into()),
    }
}

fn element(start: &BytesStart, decoder: Decoder) -> Result<Element, String> {
    let name = String::from_utf8_lossy(start.local_name().as_ref()).into_owned();
    let mut attributes = Vec::new();
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|error| error.to_string())?;
        let key = String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned();
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::Implicit1_0, decoder)
            .map_err(|error| error.to_string())?
            .into_owned();
        attributes.push((key, value));
    }
    Ok(Element {
        name,
        attributes,
        children: Vec::new(),
    })
}

impl Element {
    fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.trim())
    }

    fn elements(&self) -> impl Iterator<Item = &Element> {
        self.children.iter().filter_map(|item| match item {
            Item::Element(element) => Some(element),
            Item::Text(_) => None,
        })
    }

    fn text(&self) -> String {
        self.children
            .iter()
            .filter_map(|item| match item {
                Item::Text(text) => Some(text.as_str()),
                Item::Element(_) => None,
            })
            .collect()
    }
}

#[derive(Clone, Copy)]
struct Mode {
    variants: bool,
    colors: bool,
}

fn node(element: &Element, mode: Mode, color: Option<&str>, out: &mut String) {
    let color = element.attribute("mathcolor").or(color);
    let children = |out: &mut String| {
        element
            .elements()
            .for_each(|child| node(child, mode, color, out))
    };
    match element.name.as_str() {
        // a phantom of no width draws nothing (the writer drops it: mhchem's base for scripts that stand alone)
        "mpadded"
            if zero_length(element.attribute("width"))
                && element.elements().next().is_some()
                && element.elements().all(|c| c.name == "mphantom") => {}
        "math" | "mrow" | "mstyle" | "mpadded" | "mphantom" => children(out),
        "semantics" => {
            if let Some(first) = element.elements().next() {
                node(first, mode, color, out);
            }
        }
        "mspace" | "annotation" | "annotation-xml" | "none" => {}
        // a table without rows draws nothing
        "mtable" if element.elements().next().is_none() => {}
        "mi" | "mn" | "mo" | "mtext" | "ms" => token(element, mode, color, out),
        "mfenced" => {
            let fence = |text: &str, out: &mut String| {
                painted(&characters(text, "normal", mode.variants), mode, color, out)
            };
            fence(element.attribute("open").unwrap_or("("), out);
            let separators: Vec<char> = element
                .attribute("separators")
                .unwrap_or(",")
                .chars()
                .collect();
            for (index, child) in element.elements().enumerate() {
                if index > 0 && !separators.is_empty() {
                    let separator = separators[(index - 1).min(separators.len() - 1)];
                    fence(&separator.to_string(), out);
                }
                node(child, mode, color, out);
            }
            fence(element.attribute("close").unwrap_or(")"), out);
        }
        "mover" | "munder" if element.elements().count() == 2 => {
            let parts: Vec<String> = element
                .elements()
                .map(|child| {
                    let mut text = String::new();
                    node(child, mode, color, &mut text);
                    text
                })
                .collect();
            let mark = strip_colors(&parts[1]);
            if element.name == "mover" && glyphs(&parts[0]) == 1 && is_accent(&mark) {
                // MathType draws an accent in its character's colour: the mark's own colour does not count
                out.push_str(&parts[0]);
                out.push_str(&mark);
            } else {
                out.push_str(&format!("{}{{{}}}{{{}}}", element.name, parts[0], parts[1]));
            }
        }
        name => {
            out.push_str(name);
            if name == "menclose" {
                out.push_str(&format!(
                    "[{}]",
                    element.attribute("notation").unwrap_or("longdiv")
                ));
            }
            if name == "mtable" {
                out.push_str(&table_lines(element));
            }
            // elements whose children are one inferred row
            if matches!(name, "msqrt" | "menclose" | "mtd" | "merror") {
                out.push('{');
                children(out);
                out.push('}');
                return;
            }
            for child in element.elements() {
                out.push('{');
                node(child, mode, color, out);
                out.push('}');
            }
        }
    }
}

/// A table's lines: the inner row and column lines (MathML's lists, the last value going on) and the frame.
fn table_lines(table: &Element) -> String {
    let rows: Vec<&Element> = table.elements().filter(|row| row.name == "mtr").collect();
    let columns = rows
        .iter()
        .map(|row| row.elements().filter(|cell| cell.name == "mtd").count())
        .max()
        .unwrap_or(0);
    let lines = |attribute: &str, count: usize| -> Option<String> {
        let values: Vec<&str> = table
            .attribute(attribute)
            .unwrap_or("none")
            .split_whitespace()
            .collect();
        let inner: Vec<&str> = (0..count.saturating_sub(1))
            .map(|i| *values.get(i).or(values.last()).unwrap_or(&"none"))
            .collect();
        inner
            .iter()
            .any(|line| *line != "none")
            .then(|| inner.join(" "))
    };
    let mut text = String::new();
    if let Some(lines) = lines("rowlines", rows.len()) {
        text.push_str(&format!("[rows {lines}]"));
    }
    if let Some(lines) = lines("columnlines", columns) {
        text.push_str(&format!("[columns {lines}]"));
    }
    if table
        .attribute("frame")
        .is_some_and(|frame| frame != "none")
    {
        text.push_str("[frame]");
    }
    text
}

fn token(element: &Element, mode: Mode, color: Option<&str>, out: &mut String) {
    let text = element.text();
    let single_letter = element.name == "mi" && text.trim().chars().count() == 1;
    let default = if single_letter { "italic" } else { "normal" };
    let variant = element.attribute("mathvariant").unwrap_or(default);
    painted(&characters(&text, variant, mode.variants), mode, color, out);
}

/// A canonical text without its colour marks.
fn strip_colors(text: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for c in text.chars() {
        match c {
            '<' => inside = true,
            '>' if inside => inside = false,
            _ if !inside => out.push(c),
            _ => {}
        }
    }
    out
}

/// How many characters a canonical text draws (no structure, colour marks aside).
fn glyphs(text: &str) -> usize {
    let plain = strip_colors(text);
    if plain.contains('{') {
        usize::MAX
    } else {
        plain.chars().count()
    }
}

/// Accent marks: an accent over one character counts as that character followed by the mark, as a combining mark
/// draws it.
fn is_accent(text: &str) -> bool {
    matches!(
        text,
        "\u{02C6}" | "\u{02DC}" | "\u{02D9}" | "\u{00A8}" | "\u{00AF}" | "\u{2192}"
    )
}

/// Characters, each marked with its colour when colours count (black is no colour).
fn painted(characters: &str, mode: Mode, color: Option<&str>, out: &mut String) {
    let color = color
        .filter(|_| mode.colors)
        .map(color_text)
        .filter(|color| color != "#000000");
    match color {
        // accent marks take their character's colour in MathType: theirs does not count
        Some(color) => characters.chars().for_each(|c| {
            if matches!(
                c,
                '\u{02C6}' | '\u{02DC}' | '\u{02D9}' | '\u{00A8}' | '\u{00AF}'
            ) {
                out.push(c);
            } else {
                out.push_str(&format!("{c}<{color}>"));
            }
        }),
        None => out.push_str(characters),
    }
}

/// A colour as #RRGGBB.
fn color_text(color: &str) -> String {
    let color = match color.to_ascii_lowercase().as_str() {
        "black" => "#000000".to_string(),
        "red" => "#ff0000".to_string(),
        "blue" => "#0000ff".to_string(),
        "green" => "#008000".to_string(),
        other => other.to_string(),
    };
    match color.len() {
        4 => color
            .chars()
            .flat_map(|c| if c == '#' { vec![c] } else { vec![c, c] })
            .collect::<String>()
            .to_uppercase(),
        _ => color.to_uppercase(),
    }
}

/// The drawn characters: invisible ones and spaces dropped, accent and prime variants unified, letters and digits
/// in the mathvariant's mathematical alphanumerics.
fn characters(text: &str, variant: &str, variants: bool) -> String {
    text.chars()
        .filter(|&c| {
            !c.is_whitespace() && !matches!(c, '\u{2061}'..='\u{2064}' | '\u{200B}' | '\u{FEFF}')
        })
        .map(|c| match c {
            '\u{203E}' | '\u{2015}' | '\u{0305}' | '\u{0332}' | '_' => '\u{00AF}',
            '~' | '\u{0303}' => '\u{02DC}',
            '^' | '\u{0302}' => '\u{02C6}',
            '\u{0307}' => '\u{02D9}',
            '\u{0308}' => '\u{00A8}',
            '\u{20D7}' => '\u{2192}',
            '\'' => '\u{2032}',
            '\u{2329}' => '\u{27E8}',
            '\u{232A}' => '\u{27E9}',
            '-' => '\u{2212}',
            _ => c,
        })
        .map(|c| {
            if variants {
                styled(c, variant)
            } else {
                plain(c)
            }
        })
        .collect()
}

/// A mathematical alphanumeric as its plain letter or digit.
fn plain(c: char) -> char {
    let code = c as u32;
    let letterlike: &[(u32, char)] = &[
        (0x210E, 'h'),
        (0x212C, 'B'),
        (0x2130, 'E'),
        (0x2131, 'F'),
        (0x210B, 'H'),
        (0x2110, 'I'),
        (0x2112, 'L'),
        (0x2133, 'M'),
        (0x211B, 'R'),
        (0x212F, 'e'),
        (0x210A, 'g'),
        (0x2134, 'o'),
        (0x212D, 'C'),
        (0x210C, 'H'),
        (0x2111, 'I'),
        (0x211C, 'R'),
        (0x2128, 'Z'),
        (0x2102, 'C'),
        (0x210D, 'H'),
        (0x2115, 'N'),
        (0x2119, 'P'),
        (0x211A, 'Q'),
        (0x211D, 'R'),
        (0x2124, 'Z'),
    ];
    if let Some((_, letter)) = letterlike.iter().find(|(point, _)| *point == code) {
        return *letter;
    }
    let found = match code {
        0x1D400..=0x1D6A3 => {
            let index = (code - 0x1D400) % 52;
            if index < 26 {
                'A' as u32 + index
            } else {
                'a' as u32 + index - 26
            }
        }
        0x1D6A8..=0x1D7C9 => {
            let index = (code - 0x1D6A8) % 58;
            match index {
                0..=24 => 0x391 + index,
                26..=50 => 0x3B1 + index - 26,
                _ => code,
            }
        }
        0x1D7CE..=0x1D7FF => '0' as u32 + (code - 0x1D7CE) % 10,
        _ => code,
    };
    char::from_u32(found).unwrap_or(c)
}

/// A letter or digit in a mathvariant (MathML's mapping onto U+1D400-U+1D7FF and the letterlike holes).
fn styled(c: char, variant: &str) -> char {
    let latin: Option<u32> = match variant {
        "bold" => Some(0x1D400),
        "italic" => Some(0x1D434),
        "bold-italic" => Some(0x1D468),
        "script" => Some(0x1D49C),
        "bold-script" => Some(0x1D4D0),
        "fraktur" => Some(0x1D504),
        "double-struck" => Some(0x1D538),
        "bold-fraktur" => Some(0x1D56C),
        "sans-serif" => Some(0x1D5A0),
        "bold-sans-serif" => Some(0x1D5D4),
        "sans-serif-italic" => Some(0x1D608),
        "sans-serif-bold-italic" => Some(0x1D63C),
        "monospace" => Some(0x1D670),
        _ => None,
    };
    let Some(base) = latin else { return c };
    let hole = |c: char| -> Option<char> {
        let holes: &[(char, u32)] = match variant {
            "italic" => &[('h', 0x210E)],
            "script" => &[
                ('B', 0x212C),
                ('E', 0x2130),
                ('F', 0x2131),
                ('H', 0x210B),
                ('I', 0x2110),
                ('L', 0x2112),
                ('M', 0x2133),
                ('R', 0x211B),
                ('e', 0x212F),
                ('g', 0x210A),
                ('o', 0x2134),
            ],
            "fraktur" => &[
                ('C', 0x212D),
                ('H', 0x210C),
                ('I', 0x2111),
                ('R', 0x211C),
                ('Z', 0x2128),
            ],
            "double-struck" => &[
                ('C', 0x2102),
                ('H', 0x210D),
                ('N', 0x2115),
                ('P', 0x2119),
                ('Q', 0x211A),
                ('R', 0x211D),
                ('Z', 0x2124),
            ],
            _ => &[],
        };
        holes
            .iter()
            .find(|(letter, _)| *letter == c)
            .and_then(|(_, code)| char::from_u32(*code))
    };
    if let Some(letterlike) = hole(c) {
        return letterlike;
    }
    let code = match c {
        'A'..='Z' => base + (c as u32 - 'A' as u32),
        'a'..='z' => base + 26 + (c as u32 - 'a' as u32),
        '0'..='9' => {
            let digits = match variant {
                "bold" => 0x1D7CE,
                "double-struck" => 0x1D7D8,
                "sans-serif" => 0x1D7E2,
                "bold-sans-serif" => 0x1D7EC,
                "monospace" => 0x1D7F6,
                _ => return c,
            };
            digits + (c as u32 - '0' as u32)
        }
        '\u{0391}'..='\u{03A9}' | '\u{03B1}'..='\u{03C9}' => {
            let greek = match variant {
                "bold" => 0x1D6A8,
                "italic" => 0x1D6E2,
                "bold-italic" => 0x1D71C,
                "bold-sans-serif" => 0x1D756,
                "sans-serif-bold-italic" => 0x1D790,
                _ => return c,
            };
            if c <= '\u{03A9}' {
                greek + (c as u32 - 0x391)
            } else {
                greek + 26 + (c as u32 - 0x3B1)
            }
        }
        _ => return c,
    };
    char::from_u32(code).unwrap_or(c)
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
