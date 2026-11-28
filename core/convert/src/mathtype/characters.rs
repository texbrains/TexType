//! Which MathType style or font draws a character, and with which codes (MTCode, 8-bit font position): the
//! choices MathType 7's own import makes, from its records for the corpus formulas, the fonts' encodings and
//! glyphs.txt.

use super::records::*;

/// One character as MathType stores it: in a style (typeface), or in a font of its own.
pub(super) struct Glyph {
    pub(super) typeface: u8,
    pub(super) font: Option<Font>,
    pub(super) mt_code: u16,
    pub(super) encoded8: Option<u8>,
}

/// A font a character is drawn in outside the styles (MathType's FONT_STYLE_DEF): the font, its encoding when it
/// is not the Windows one, bold (0x01) and italic (0x02).
#[derive(Clone, Copy)]
pub(super) struct Font {
    pub(super) name: &'static str,
    pub(super) encoding: Option<&'static str>,
    pub(super) style: u8,
}

pub(super) fn plain(typeface: u8, c: char) -> Glyph {
    Glyph {
        typeface,
        font: None,
        mt_code: c as u16,
        encoded8: None,
    }
}

pub(super) fn coded(typeface: u8, c: char, position: u8) -> Glyph {
    Glyph {
        typeface,
        font: None,
        mt_code: c as u16,
        encoded8: Some(position),
    }
}

/// A letter or digit in a font of its own (the Euclid alphabets, Arial, Courier New), with MathType's MTCode for
/// it: the letterlike characters, MathType's own codes for Fraktur, otherwise the letter.
pub(super) fn alphabet(c: char, variant: &str) -> Option<Glyph> {
    let (name, encoding, style) = match variant {
        "double-struck" => ("Euclid Math Two", Some("EuclidMath2"), 0),
        "script" => ("Euclid Math One", Some("EuclidMath1"), 0),
        "bold-script" => ("Euclid Math One", Some("EuclidMath1"), 1),
        "fraktur" => ("Euclid Fraktur", Some("EuclidFraktur"), 0),
        "bold-fraktur" => ("Euclid Fraktur", Some("EuclidFraktur"), 1),
        "sans-serif" => ("Arial", None, 0),
        "bold-sans-serif" => ("Arial", None, 1),
        "sans-serif-italic" => ("Arial", None, 2),
        "sans-serif-bold-italic" => ("Arial", None, 3),
        "monospace" => ("Courier New", None, 0),
        "bold-italic" => ("Times New Roman", None, 3),
        _ => return None,
    };
    // the Euclid fonts hold letters and digits; the text fonts what their code pages hold
    let euclid = encoding.is_some();
    let held = if euclid {
        c.is_ascii_alphanumeric()
    } else {
        c.is_ascii_graphic() || basic_code_page(c)
    };
    if !held {
        return None;
    }
    let letterlike: &[(char, u16)] = match variant {
        "double-struck" => DOUBLE_STRUCK_LETTERLIKE,
        "script" | "bold-script" => SCRIPT_LETTERLIKE,
        _ => &[],
    };
    let mt_code = match letterlike.iter().find(|(letter, _)| *letter == c) {
        Some((_, code)) => *code,
        None if variant.ends_with("fraktur") && c.is_ascii_uppercase() => {
            0xF000 + (c as u16 - 'A' as u16)
        }
        None if variant.ends_with("fraktur") && c.is_ascii_lowercase() => {
            0xF01A + (c as u16 - 'a' as u16)
        }
        None => c as u16,
    };
    let font = Font {
        name,
        encoding,
        style,
    };
    // the Euclid fonts are symbol fonts: their position goes with the MTCode
    Some(Glyph {
        typeface: 0,
        font: Some(font),
        mt_code,
        encoded8: euclid.then_some(c as u8),
    })
}

/// The double-struck and script letters Unicode has in its letterlike block, MathType's MTCodes for them.
const DOUBLE_STRUCK_LETTERLIKE: &[(char, u16)] = &[
    ('C', 0x2102),
    ('H', 0x210D),
    ('N', 0x2115),
    ('P', 0x2119),
    ('Q', 0x211A),
    ('R', 0x211D),
    ('Z', 0x2124),
];
const SCRIPT_LETTERLIKE: &[(char, u16)] = &[
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
];

/// A letterlike character (ℝ, ℒ ...) written as itself: the letter in its Euclid alphabet.
fn letterlike(c: char) -> Option<Glyph> {
    let code = c as u16;
    for (variant, table) in [
        ("double-struck", DOUBLE_STRUCK_LETTERLIKE),
        ("script", SCRIPT_LETTERLIKE),
    ] {
        if let Some((letter, _)) = table.iter().find(|(_, letterlike)| *letterlike == code) {
            return alphabet(*letter, variant);
        }
    }
    None
}

pub(super) fn identifier(c: char, variant: &str) -> Glyph {
    if let Some(glyph) = alphabet(c, variant).or_else(|| letterlike(c)) {
        return glyph;
    }
    // dotless j: Euclid Math One's, italic (MathType's own MTCode)
    if c == '\u{0237}' {
        let font = Font {
            name: "Euclid Math One",
            encoding: Some("EuclidMath1"),
            style: 2,
        };
        return Glyph {
            typeface: 0,
            font: Some(font),
            mt_code: 0xED02,
            encoded8: Some(0xF8),
        };
    }
    // Euclid Math One's Greek variants, italic
    let euclid_greek = match c {
        '\u{03F1}' => Some(0xF1),
        '\u{03F5}' => Some(0xF2),
        '\u{03F0}' => Some(0xF9),
        _ => None,
    };
    if let Some(position) = euclid_greek {
        let font = Font {
            name: "Euclid Math One",
            encoding: Some("EuclidMath1"),
            style: 2,
        };
        return Glyph {
            typeface: 0,
            font: Some(font),
            mt_code: c as u16,
            encoded8: Some(position),
        };
    }
    let greek_lower = matches!(
        c,
        '\u{03B1}'..='\u{03C9}' | '\u{03D1}' | '\u{03D5}' | '\u{03D6}'
    );
    let greek_upper = matches!(c, '\u{0391}'..='\u{03A9}');
    let italic = variant.contains("italic");
    let bold = variant.contains("bold");
    if is_far_east(c) {
        return plain(TYPEFACE_FAR_EAST_TEXT, c);
    }
    if bold && (c.is_ascii_alphanumeric() || greek_lower || greek_upper) {
        return Glyph {
            typeface: TYPEFACE_VECTOR,
            font: None,
            mt_code: c as u16,
            encoded8: None,
        };
    }
    // Greek: the lower-case style is Symbol italic, the capitals' style Symbol upright; upright capitals are
    // Times New Roman text, as MathType's import stores \Gamma
    if greek_lower || greek_upper {
        let typeface = match (italic, greek_upper) {
            (false, true) => return plain(TYPEFACE_TEXT, c),
            (true, _) => TYPEFACE_LOWER_GREEK,
            (false, false) => TYPEFACE_UPPER_GREEK,
        };
        return Glyph {
            typeface,
            font: None,
            mt_code: c as u16,
            encoded8: symbol_position(c),
        };
    }
    if c.is_alphabetic() {
        return plain(
            if italic {
                TYPEFACE_VARIABLE
            } else {
                TYPEFACE_TEXT
            },
            c,
        );
    }
    if c.is_ascii_digit() {
        return plain(TYPEFACE_NUMBER, c);
    }
    if c.is_ascii() || basic_code_page(c) {
        return plain(
            if italic {
                TYPEFACE_FUNCTION
            } else {
                TYPEFACE_TEXT
            },
            c,
        );
    }
    if let Some(position) = symbol_position(c) {
        let typeface = if greek_style(c) && !italic {
            TYPEFACE_LOWER_GREEK
        } else {
            TYPEFACE_SYMBOL
        };
        return coded(typeface, c, position);
    }
    operator(c)
}

/// Non-ASCII characters of the Windows code pages 1250-1258 (MathType's WinAllBasicCodePages encoding, the
/// Times New Roman styles); others go to the far-east font (SimSun, WinAllCodePages).
pub(super) fn basic_code_page(c: char) -> bool {
    let c = c as u32;
    BASIC_CODE_PAGES
        .iter()
        .any(|&(first, last)| (first..=last).contains(&c))
}

const BASIC_CODE_PAGES: &[(u32, u32)] = &[
    (0x0081, 0x0081),
    (0x0083, 0x0083),
    (0x0088, 0x0088),
    (0x008A, 0x008A),
    (0x008C, 0x0090),
    (0x0098, 0x0098),
    (0x009A, 0x009A),
    (0x009C, 0x0107),
    (0x010C, 0x0113),
    (0x0116, 0x011B),
    (0x011E, 0x011F),
    (0x0122, 0x0123),
    (0x012A, 0x012B),
    (0x012E, 0x0131),
    (0x0136, 0x0137),
    (0x0139, 0x013E),
    (0x0141, 0x0148),
    (0x014C, 0x014D),
    (0x0150, 0x015B),
    (0x015E, 0x0165),
    (0x016A, 0x016B),
    (0x016E, 0x0173),
    (0x0178, 0x017E),
    (0x0192, 0x0192),
    (0x01A0, 0x01A1),
    (0x01AF, 0x01B0),
    (0x02C6, 0x02C7),
    (0x02D8, 0x02D9),
    (0x02DB, 0x02DD),
    (0x0300, 0x0301),
    (0x0303, 0x0303),
    (0x0309, 0x0309),
    (0x0323, 0x0323),
    (0x0384, 0x0386),
    (0x0388, 0x038A),
    (0x038C, 0x038C),
    (0x038E, 0x03A1),
    (0x03A3, 0x03CE),
    (0x0401, 0x040C),
    (0x040E, 0x044F),
    (0x0451, 0x045C),
    (0x045E, 0x045F),
    (0x0490, 0x0491),
    (0x05B0, 0x05C3),
    (0x05D0, 0x05EA),
    (0x05F0, 0x05F4),
    (0x060C, 0x060C),
    (0x061B, 0x061B),
    (0x061F, 0x061F),
    (0x0621, 0x063A),
    (0x0640, 0x0652),
    (0x0679, 0x0679),
    (0x067E, 0x067E),
    (0x0686, 0x0686),
    (0x0688, 0x0688),
    (0x0691, 0x0691),
    (0x0698, 0x0698),
    (0x06A9, 0x06A9),
    (0x06AF, 0x06AF),
    (0x06BA, 0x06BA),
    (0x06BE, 0x06BE),
    (0x06C1, 0x06C1),
    (0x06D2, 0x06D2),
    (0x200C, 0x200F),
    (0x2013, 0x2015),
    (0x2018, 0x201A),
    (0x201C, 0x201E),
    (0x2020, 0x2022),
    (0x2026, 0x2026),
    (0x2030, 0x2030),
    (0x2039, 0x203A),
    (0x20AA, 0x20AC),
    (0x2116, 0x2116),
    (0x2122, 0x2122),
    (0xF88D, 0xF896),
    (0xF8F9, 0xF8FD),
];

pub(super) fn text_glyph(c: char) -> Glyph {
    if let Some(glyph) = letterlike(c) {
        return glyph;
    }
    if matches!(c, '\u{0300}'..='\u{0308}') {
        return operator(c);
    }
    if is_far_east(c) {
        plain(TYPEFACE_FAR_EAST_TEXT, c)
    } else {
        plain(TYPEFACE_TEXT, c)
    }
}

pub(super) fn operator(c: char) -> Glyph {
    // horizontal braces and brackets: MathType's stretching ones (its fence style and own codes); over or under
    // a row in the limit template, as MathType stores \overbrace and \underbrace
    let stretching = |code: u16| Glyph {
        typeface: 22,
        font: None,
        mt_code: code,
        encoded8: None,
    };
    match c {
        '\u{23DE}' | '\u{FE37}' => stretching(0xFE37),
        '\u{23DF}' | '\u{FE38}' => stretching(0xFE38),
        '\u{23B4}' => stretching(0xEC0D),
        '\u{23B5}' => stretching(0xEC0C),
        // a combining accent without a character before it: its spacing accent
        '\u{0300}' => plain(TYPEFACE_FUNCTION, '`'),
        '\u{0301}' => plain(TYPEFACE_FUNCTION, '\u{00B4}'),
        '\u{0302}' => plain(TYPEFACE_FUNCTION, '\u{02C6}'),
        '\u{0303}' => plain(TYPEFACE_FUNCTION, '\u{02DC}'),
        '\u{0304}' | '\u{0305}' => plain(TYPEFACE_FUNCTION, '\u{00AF}'),
        '\u{0307}' => plain(TYPEFACE_FUNCTION, '\u{02D9}'),
        '\u{0308}' => plain(TYPEFACE_FUNCTION, '\u{00A8}'),
        // angle brackets that do not stretch: Symbol's (MathType's MTCode is the older U+2329/U+232A)
        '\u{27E8}' => Glyph {
            typeface: TYPEFACE_SYMBOL,
            font: None,
            mt_code: 0x2329,
            encoded8: Some(0xE1),
        },
        '\u{27E9}' => Glyph {
            typeface: TYPEFACE_SYMBOL,
            font: None,
            mt_code: 0x232A,
            encoded8: Some(0xF1),
        },
        // long arrows: MathType has none (its arrow template hangs MathType 7); its ordinary arrows
        '\u{27F6}' => Glyph {
            typeface: TYPEFACE_SYMBOL,
            font: None,
            mt_code: 0x2192,
            encoded8: Some(0xAE),
        },
        '\u{27F5}' => Glyph {
            typeface: TYPEFACE_SYMBOL,
            font: None,
            mt_code: 0x2190,
            encoded8: Some(0xAC),
        },
        '\u{27F7}' => Glyph {
            typeface: TYPEFACE_SYMBOL,
            font: None,
            mt_code: 0x2194,
            encoded8: Some(0xAB),
        },
        '+' | '<' | '=' | '>' => coded(TYPEFACE_SYMBOL, c, c as u8),
        _ if c.is_ascii() => plain(TYPEFACE_FUNCTION, c),
        _ => {
            if let Some(glyph) = font_glyph(c) {
                glyph
            } else if let Some(position) = symbol_position(c) {
                let typeface = if greek_style(c) {
                    TYPEFACE_LOWER_GREEK
                } else {
                    TYPEFACE_SYMBOL
                };
                coded(typeface, c, position)
            } else if basic_code_page(c) {
                plain(TYPEFACE_FUNCTION, c)
            } else {
                plain(TYPEFACE_FAR_EAST_TEXT, c)
            }
        }
    }
}

/// Symbol-font characters MathType's import puts in the lower-case Greek style.
pub(super) fn greek_style(c: char) -> bool {
    matches!(
        c,
        '\u{2207}' | '\u{2200}' | '\u{2203}' | '\u{221E}' | '\u{2205}'
    )
}

pub(super) fn is_far_east(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x11FF | 0x2E80..=0x9FFF | 0xA000..=0xA4CF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFE10..=0xFE1F | 0xFE30..=0xFE6F | 0xFF00..=0xFFEF)
}

/// The Symbol font's position for a character (Adobe Symbol encoding, except that MathType draws \phi from
/// 'f' and \varphi from 'j').
pub(super) fn symbol_position(c: char) -> Option<u8> {
    let greek = "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ";
    if let Some(index) = greek.chars().position(|g| g == c) {
        return Some(0x41 + index as u8);
    }
    let greek = "αβχδεϕγηιφκλμνοπθρστυϖωξψζ";
    if let Some(index) = greek.chars().position(|g| g == c) {
        return Some(0x61 + index as u8);
    }
    SYMBOL
        .iter()
        .find(|(symbol, _)| *symbol == c)
        .map(|(_, position)| *position)
}

const SYMBOL: &[(char, u8)] = &[
    ('\u{2200}', 0x22),
    ('\u{2203}', 0x24),
    ('\u{220B}', 0x27),
    ('\u{2217}', 0x2A),
    ('\u{2212}', 0x2D),
    ('\u{2245}', 0x40),
    ('\u{2234}', 0x5C),
    ('\u{22A5}', 0x5E),
    ('\u{223C}', 0x7E),
    ('\u{03D2}', 0xA1),
    ('\u{2032}', 0xA2),
    ('\u{2264}', 0xA3),
    ('\u{2044}', 0xA4),
    ('\u{221E}', 0xA5),
    ('\u{0192}', 0xA6),
    ('\u{2663}', 0xA7),
    ('\u{2666}', 0xA8),
    ('\u{2665}', 0xA9),
    ('\u{2660}', 0xAA),
    ('\u{2194}', 0xAB),
    ('\u{2190}', 0xAC),
    ('\u{2191}', 0xAD),
    ('\u{2192}', 0xAE),
    ('\u{2193}', 0xAF),
    ('\u{00B0}', 0xB0),
    ('\u{00B1}', 0xB1),
    ('\u{2033}', 0xB2),
    ('\u{2265}', 0xB3),
    ('\u{00D7}', 0xB4),
    ('\u{221D}', 0xB5),
    ('\u{2202}', 0xB6),
    ('\u{2022}', 0xB7),
    ('\u{00F7}', 0xB8),
    ('\u{2260}', 0xB9),
    ('\u{2261}', 0xBA),
    ('\u{2248}', 0xBB),
    ('\u{2026}', 0xBC),
    ('\u{21B5}', 0xBF),
    ('\u{2135}', 0xC0),
    ('\u{2111}', 0xC1),
    ('\u{211C}', 0xC2),
    ('\u{2118}', 0xC3),
    ('\u{2297}', 0xC4),
    ('\u{2295}', 0xC5),
    ('\u{2205}', 0xC6),
    ('\u{2229}', 0xC7),
    ('\u{222A}', 0xC8),
    ('\u{2283}', 0xC9),
    ('\u{2287}', 0xCA),
    ('\u{2284}', 0xCB),
    ('\u{2282}', 0xCC),
    ('\u{2286}', 0xCD),
    ('\u{2208}', 0xCE),
    ('\u{2209}', 0xCF),
    ('\u{2220}', 0xD0),
    ('\u{2207}', 0xD1),
    ('\u{220F}', 0xD5),
    ('\u{221A}', 0xD6),
    ('\u{22C5}', 0xD7),
    ('\u{00AC}', 0xD8),
    ('\u{2227}', 0xD9),
    ('\u{2228}', 0xDA),
    ('\u{21D4}', 0xDB),
    ('\u{21D0}', 0xDC),
    ('\u{21D1}', 0xDD),
    ('\u{21D2}', 0xDE),
    ('\u{21D3}', 0xDF),
    ('\u{25CA}', 0xE0),
    ('\u{2329}', 0xE1),
    ('\u{2211}', 0xE5),
    ('\u{232A}', 0xF1),
    ('\u{222B}', 0xF2),
];

/// MathType's glyphs in its own fonts (glyphs.txt): Symbol and MT Extra through their styles, the Euclid fonts
/// through a font style.
pub(super) fn font_glyph(c: char) -> Option<Glyph> {
    static GLYPHS: std::sync::OnceLock<Vec<(u32, &'static str, u16, u8)>> =
        std::sync::OnceLock::new();
    let glyphs = GLYPHS.get_or_init(|| {
        include_str!("glyphs.txt")
            .lines()
            .filter(|line| !line.starts_with('#') && !line.trim().is_empty())
            .filter_map(|line| {
                let mut fields = line.split('\t');
                let scalar = u32::from_str_radix(fields.next()?, 16).ok()?;
                let font = fields.next()?;
                let mt_code = u16::from_str_radix(fields.next()?, 16).ok()?;
                let position = u8::from_str_radix(fields.next()?, 16).ok()?;
                Some((scalar, font, mt_code, position))
            })
            .collect()
    });
    let &(_, font, mt_code, position) = glyphs.iter().find(|(scalar, ..)| *scalar == c as u32)?;
    let euclid = |name, encoding| Font {
        name,
        encoding: Some(encoding),
        style: 0,
    };
    let font = match font {
        "Symbol" => {
            return Some(Glyph {
                typeface: TYPEFACE_SYMBOL,
                font: None,
                mt_code,
                encoded8: Some(position),
            })
        }
        "MT_Extra" => {
            return Some(Glyph {
                typeface: TYPEFACE_MT_EXTRA,
                font: None,
                mt_code,
                encoded8: Some(position),
            })
        }
        "Euclid_Math_One" => euclid("Euclid Math One", "EuclidMath1"),
        "Euclid_Math_Two" => euclid("Euclid Math Two", "EuclidMath2"),
        _ => return None,
    };
    Some(Glyph {
        typeface: 0,
        font: Some(font),
        mt_code,
        encoded8: Some(position),
    })
}

/// The glyph MathType can draw for a character, or the character when it has none (it would show its placeholder).
/// MathType's own fonts (Symbol, MT Extra, the Euclid fonts, its fence and space styles) hold their characters;
/// Times New Roman's styles hold the basic code pages, the far-east slot also the far-east code pages: a character
/// only that slot holds moves there.
pub(super) fn drawable(glyph: Glyph) -> Result<Glyph, char> {
    let own_font = glyph.font.is_some()
        || glyph.encoded8.is_some()
        || matches!(
            glyph.typeface,
            TYPEFACE_SYMBOL | TYPEFACE_MT_EXTRA | 22 | TYPEFACE_SPACE
        );
    if own_font {
        return Ok(glyph);
    }
    let c = char::from_u32(glyph.mt_code.into()).unwrap_or('\u{FFFD}');
    let basic = c.is_ascii() || basic_code_page(c);
    if basic && glyph.typeface != TYPEFACE_FAR_EAST_TEXT {
        return Ok(glyph);
    }
    if basic || in_ranges(FAR_EAST_CODE_PAGES, c) {
        return Ok(Glyph {
            typeface: TYPEFACE_FAR_EAST_TEXT,
            ..glyph
        });
    }
    Err(c)
}

fn in_ranges(ranges: &[(u32, u32)], c: char) -> bool {
    let c = c as u32;
    ranges
        .iter()
        .any(|&(first, last)| (first..=last).contains(&c))
}

/// Characters (from U+0080) of the Windows far-east code pages 874, 932, 936, 949 and 950, round-tripping without
/// best fit: what MathType's far-east font slot (SimSun, WinAllCodePages) holds beyond the basic code pages; other
/// characters MathType draws as its placeholder. Generated with Windows' own encodings (kit far-east-code-pages.ps1).
const FAR_EAST_CODE_PAGES: &[(u32, u32)] = &[
    (0x0080, 0x0084),
    (0x0086, 0x0090),
    (0x0098, 0x00A1),
    (0x00A4, 0x00A4),
    (0x00A7, 0x00A8),
    (0x00AA, 0x00AA),
    (0x00AD, 0x00B4),
    (0x00B6, 0x00BA),
    (0x00BC, 0x00BF),
    (0x00C6, 0x00C6),
    (0x00D0, 0x00D0),
    (0x00D7, 0x00D8),
    (0x00DE, 0x00E1),
    (0x00E6, 0x00E6),
    (0x00E8, 0x00EA),
    (0x00EC, 0x00ED),
    (0x00F0, 0x00F0),
    (0x00F2, 0x00F3),
    (0x00F7, 0x00FA),
    (0x00FC, 0x00FC),
    (0x00FE, 0x00FE),
    (0x0101, 0x0101),
    (0x0111, 0x0111),
    (0x0113, 0x0113),
    (0x011B, 0x011B),
    (0x0126, 0x0127),
    (0x012B, 0x012B),
    (0x0131, 0x0133),
    (0x0138, 0x0138),
    (0x013F, 0x0142),
    (0x0144, 0x0144),
    (0x0148, 0x014B),
    (0x014D, 0x014D),
    (0x0152, 0x0153),
    (0x0166, 0x0167),
    (0x016B, 0x016B),
    (0x01CE, 0x01CE),
    (0x01D0, 0x01D0),
    (0x01D2, 0x01D2),
    (0x01D4, 0x01D4),
    (0x01D6, 0x01D6),
    (0x01D8, 0x01D8),
    (0x01DA, 0x01DA),
    (0x01DC, 0x01DC),
    (0x0251, 0x0251),
    (0x0261, 0x0261),
    (0x02C7, 0x02C7),
    (0x02C9, 0x02CB),
    (0x02CD, 0x02CD),
    (0x02D0, 0x02D0),
    (0x02D8, 0x02DB),
    (0x02DD, 0x02DD),
    (0x0391, 0x03A1),
    (0x03A3, 0x03A9),
    (0x03B1, 0x03C1),
    (0x03C3, 0x03C9),
    (0x0401, 0x0401),
    (0x0410, 0x044F),
    (0x0451, 0x0451),
    (0x0E01, 0x0E3A),
    (0x0E3F, 0x0E5B),
    (0x2010, 0x2010),
    (0x2013, 0x2016),
    (0x2018, 0x2019),
    (0x201C, 0x201D),
    (0x2020, 0x2022),
    (0x2025, 0x2027),
    (0x2030, 0x2030),
    (0x2032, 0x2033),
    (0x2035, 0x2035),
    (0x203B, 0x203B),
    (0x2074, 0x2074),
    (0x207F, 0x207F),
    (0x2081, 0x2084),
    (0x20AC, 0x20AC),
    (0x2103, 0x2103),
    (0x2105, 0x2105),
    (0x2109, 0x2109),
    (0x2113, 0x2113),
    (0x2116, 0x2116),
    (0x2121, 0x2122),
    (0x2126, 0x2126),
    (0x212B, 0x212B),
    (0x2153, 0x2154),
    (0x215B, 0x215E),
    (0x2160, 0x216B),
    (0x2170, 0x2179),
    (0x2190, 0x2199),
    (0x21D2, 0x21D2),
    (0x21D4, 0x21D4),
    (0x2200, 0x2200),
    (0x2202, 0x2203),
    (0x2207, 0x2208),
    (0x220B, 0x220B),
    (0x220F, 0x220F),
    (0x2211, 0x2211),
    (0x2215, 0x2215),
    (0x221A, 0x221A),
    (0x221D, 0x2220),
    (0x2223, 0x2223),
    (0x2225, 0x2225),
    (0x2227, 0x222C),
    (0x222E, 0x222E),
    (0x2234, 0x2237),
    (0x223C, 0x223D),
    (0x2248, 0x2248),
    (0x224C, 0x224C),
    (0x2252, 0x2252),
    (0x2260, 0x2261),
    (0x2264, 0x2267),
    (0x226A, 0x226B),
    (0x226E, 0x226F),
    (0x2282, 0x2283),
    (0x2286, 0x2287),
    (0x2295, 0x2295),
    (0x2299, 0x2299),
    (0x22A5, 0x22A5),
    (0x22BF, 0x22BF),
    (0x2312, 0x2312),
    (0x2460, 0x24B5),
    (0x24D0, 0x24E9),
    (0x2500, 0x254B),
    (0x2550, 0x2574),
    (0x2581, 0x258F),
    (0x2592, 0x2595),
    (0x25A0, 0x25A1),
    (0x25A3, 0x25A9),
    (0x25B2, 0x25B3),
    (0x25B6, 0x25B7),
    (0x25BC, 0x25BD),
    (0x25C0, 0x25C1),
    (0x25C6, 0x25C8),
    (0x25CB, 0x25CB),
    (0x25CE, 0x25D1),
    (0x25E2, 0x25E5),
    (0x25EF, 0x25EF),
    (0x2605, 0x2606),
    (0x2609, 0x2609),
    (0x260E, 0x260F),
    (0x261C, 0x261C),
    (0x261E, 0x261E),
    (0x2640, 0x2640),
    (0x2642, 0x2642),
    (0x2660, 0x2661),
    (0x2663, 0x2665),
    (0x2667, 0x266A),
    (0x266C, 0x266D),
    (0x266F, 0x266F),
    (0x3000, 0x3003),
    (0x3005, 0x3017),
    (0x301D, 0x301F),
    (0x3021, 0x3029),
    (0x3041, 0x3093),
    (0x309B, 0x309E),
    (0x30A1, 0x30F6),
    (0x30FB, 0x30FE),
    (0x3105, 0x3129),
    (0x3131, 0x318E),
    (0x3200, 0x321C),
    (0x3220, 0x3229),
    (0x3231, 0x3232),
    (0x3239, 0x3239),
    (0x3260, 0x327B),
    (0x327F, 0x327F),
    (0x32A3, 0x32A8),
    (0x3303, 0x3303),
    (0x330D, 0x330D),
    (0x3314, 0x3314),
    (0x3318, 0x3318),
    (0x3322, 0x3323),
    (0x3326, 0x3327),
    (0x332B, 0x332B),
    (0x3336, 0x3336),
    (0x333B, 0x333B),
    (0x3349, 0x334A),
    (0x334D, 0x334D),
    (0x3351, 0x3351),
    (0x3357, 0x3357),
    (0x337B, 0x337E),
    (0x3380, 0x3384),
    (0x3388, 0x33CA),
    (0x33CD, 0x33D3),
    (0x33D5, 0x33D6),
    (0x33D8, 0x33D8),
    (0x33DB, 0x33DD),
    (0x4E00, 0x9FA5),
    (0xAC00, 0xD7A3),
    (0xE000, 0xF848),
    (0xF8C1, 0xF8C8),
    (0xF8F0, 0xF8F3),
    (0xF8F5, 0xF8F5),
    (0xF8F7, 0xF8F8),
    (0xF900, 0xFA2D),
    (0xFE30, 0xFE31),
    (0xFE33, 0xFE44),
    (0xFE49, 0xFE52),
    (0xFE54, 0xFE57),
    (0xFE59, 0xFE66),
    (0xFE68, 0xFE6B),
    (0xFF01, 0xFF5E),
    (0xFF61, 0xFF9F),
    (0xFFE0, 0xFFE6),
];
