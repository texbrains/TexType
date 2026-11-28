//! Characters: how they space themselves, the boxes MathType assumes for some of them, and the bytes their fonts
//! draw them with.

use super::*;

/// MathType's own box for a glyph whose measures it does not take from the installed font (left, right, top,
/// bottom from the origin at a size), None for the others; `sign`: the glyph is a big operator's sign.
/// - every MT Extra glyph: a point at the origin, a 64th of an em wide and half that deep (MathType measures MT
///   Extra by its own table, not the installed font: its accents, the ellipsis ⋯ and the placeholder it draws
///   for an unknown character take no room);
/// - Symbol's sum and product as a big operator's sign: their ink's width, 49/64 em up and 6/64 em down (the
///   installed glyphs' ink at 64 ppem reaches 47 and 48, and Windows measures them so too; as plain characters
///   MathType takes their ink).
pub(super) fn mathtype_box(
    face: &str,
    byte: u8,
    measure: &Measure,
    size: i32,
    sign: bool,
) -> Option<(i32, i32, i32, i32)> {
    let s = |v: i32| Measure::scaled(v, size);
    match (face, byte) {
        ("Symbol", 0xD5 | 0xE5) if sign => Some((s(measure.left), s(measure.right), s(49), s(-6))),
        _ => None,
    }
}

/// How a character spaces itself from its neighbours.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Class {
    Ordinary,
    Binary,
    /// a binary operator where nothing stands before it to operate on (a line's start, after a relation, an
    /// opening bracket or punctuation): no space, the next character at its advance
    Unary,
    Relation,
    Punctuation,
    Function,
    /// fractions, limits and big-operator signs without limits: like TeX's inner atoms
    Inner,
    Space,
    /// a big operator with its limits: its operand follows without a gap
    Operator,
    Open,
    Close,
    /// MathType's placeholder for a character its import could not read (U+FFFD, MT Extra 0x6E): no class space
    /// on either side, a sign after it unary (probe-pc/ph-*)
    Placeholder,
}

/// Whether a glyph is MathType's placeholder (`Class::Placeholder`).
pub(super) fn is_placeholder(g: &Glyph) -> bool {
    g.face.name == "MT Extra" && g.byte == 0x6E
}

impl Class {
    /// The extra space before and after the character, in 64ths of an em.
    pub(super) fn before(self) -> i32 {
        match self {
            Class::Binary => 9,
            Class::Relation => RELATION_SPACE,
            Class::Inner | Class::Function => 7,
            _ => 0,
        }
    }

    pub(super) fn after(self) -> i32 {
        match self {
            Class::Binary => 9,
            Class::Relation => RELATION_SPACE,
            Class::Punctuation | Class::Function | Class::Inner => 7,
            Class::Ordinary
            | Class::Unary
            | Class::Space
            | Class::Operator
            | Class::Open
            | Class::Close
            | Class::Placeholder => 0,
        }
    }

    /// The extra space between two neighbours (64ths of an em): the larger of what they ask for, nothing after an
    /// opening bracket, before a closing one, between two relations, nor between an inner element and the bracket
    /// opening after it or closing before it (→[I⁻] [Hg in a reaction).
    pub(super) fn between(prev: Class, next: Class) -> i32 {
        if prev == Class::Open
            || next == Class::Close
            || prev == Class::Placeholder
            || next == Class::Placeholder
            || (prev, next) == (Class::Relation, Class::Relation)
            || (prev, next) == (Class::Inner, Class::Open)
            || (prev, next) == (Class::Close, Class::Inner)
        {
            return 0;
        }
        prev.after().max(next.before())
    }

    /// Whether the space between two neighbours narrows with the text font's space (`Gaps`): any class space
    /// but a binary operator's.
    pub(super) fn narrows(prev: Class, next: Class) -> bool {
        let space = Class::between(prev, next);
        let binary = (prev == Class::Binary && prev.after() == space)
            || (next == Class::Binary && next.before() == space);
        space > 0 && !binary
    }
}

/// A character's class from its typeface and character.
pub(super) fn class(typeface: i32, c: Option<char>) -> Class {
    // the text styles space nothing
    if typeface == i32::from(TYPEFACE_TEXT) || typeface == i32::from(TYPEFACE_FAR_EAST_TEXT) {
        return Class::Ordinary;
    }
    // in the function style its letters and the factorial's ! space themselves as a function name (7/64 em both
    // sides: n!, −!9); its other characters keep their own class (brackets, punctuation, the middle dot share
    // the style)
    let class = by_character(c);
    if typeface == i32::from(TYPEFACE_FUNCTION) && c.is_some_and(|c| c.is_alphabetic() || c == '!')
    {
        return Class::Function;
    }
    class
}

/// A character's class by the character alone.
fn by_character(c: Option<char>) -> Class {
    match c {
        Some('\u{FFFD}') => Class::Placeholder,
        Some(
            '+' | '\u{2212}' | '-' | '\u{B1}' | '\u{2213}' | '\u{D7}' | '\u{F7}' | '\u{2217}'
            | '\u{2218}' | '\u{22C5}' | '\u{222A}' | '\u{2229}' | '\u{2295}' | '\u{2297}'
            | '\u{2227}' | '\u{2228}' | '\u{2216}' | '/',
        ) => Class::Binary,
        Some(
            '=' | '<' | '>' | '\u{2264}' | '\u{2265}' | '\u{2260}' | '\u{2248}' | '\u{2261}'
            | '\u{226A}' | '\u{226B}' | '\u{2208}' | '\u{2209}' | '\u{2282}' | '\u{2283}'
            | '\u{2286}' | '\u{2287}' | '\u{223C}' | '\u{2245}' | '\u{221D}' | ':' | '|'
            | '\u{2223}' | '\u{2225}' | '\u{22A5}'
            // arrows (→ ⇒ ↦ ⟶ ...)
            | '\u{2190}'..='\u{21FF}'
            | '\u{27F0}'..='\u{27FF}'
            | '\u{2900}'..='\u{297F}',
        ) => Class::Relation,
        Some(',' | ';') => Class::Punctuation,
        Some('(' | '[' | '{' | '\u{2329}' | '\u{27E8}' | '\u{230A}' | '\u{2308}') => Class::Open,
        Some(')' | ']' | '}' | '\u{232A}' | '\u{27E9}' | '\u{230B}' | '\u{2309}') => Class::Close,
        // ellipses (the vertical and diagonal ones too: probe-pc/fl-vdots-*, fl-ddots-*) and big-operator signs
        // standing alone
        Some(
            '\u{2026}'
            | '\u{22EF}'
            | '\u{22EE}'
            | '\u{22F1}'
            | '\u{2211}'
            | '\u{220F}'
            | '\u{2210}'
            | '\u{222B}'..='\u{2233}'
            | '\u{22C0}'..='\u{22C3}'
            | '\u{2A00}'..='\u{2A0C}',
        ) => Class::Inner,
        _ => Class::Ordinary,
    }
}

/// Which neighbours a character follows by advance although their typefaces differ (see `by_advance`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Joins {
    None,
    /// a period: all of its font
    All,
    /// a prime character: every neighbour, of any font
    Any,
    /// a character of the far-east text style or a space character: what follows it at its advance
    Next,
    /// a function name's first letter: none where the classes ask for space before it
    Start,
    /// a letter (not of a function name): other letters of its font
    Letters,
    /// the end of scripts: what follows a script (a second scripts template) starts at their ink
    Scripts,
    /// the partial-derivative sign ∂: a letter after it at its ink's end, its advance's where that reaches further
    /// (∂x, ∂t with a slanted ∂; a digit keeps its space)
    Differential,
    /// the end of an enclosure (`Edge::enclosure`): a letter after it with no plain gap (a digit, a structure keep it)
    Enclosure,
    /// a character of the text style that is no letter nor operator sign: a letter of its font after it at its
    /// advance (#x, 1x, (x; not after + - * / \ ^ &: probe-pc/fo-text-*, fo2-*)
    Text,
    /// an upright symbol of a font named outright (Euclid's script F): a letter after it at its advance, however far
    /// its ink reaches (probe-pc/eu-calf-*)
    Named,
    /// a slanted symbol of a font named outright (Euclid's lunate epsilon, italic): a letter after it by the inks and
    /// the plain gap (probe-pc/eu-eps-*)
    Slanted,
    /// a far-east text character (CJK, full-width forms): a letter or another one after it at its advance, a digit
    /// or punctuation by the inks (probe-pc/cj-*)
    FarEast,
    /// an empty line object: no class space beside it (a function name's letter before it keeps none: MathType's own
    /// chemistry, upright H, an empty line, the subscript 3; edited/mathtype7~oleObject30~before)
    Empty,
}

/// A character's `Joins` from its typeface, the character and its class.
pub(super) fn joins(typeface: i32, c: Option<char>, class: Class) -> Joins {
    if typeface == i32::from(TYPEFACE_FAR_EAST_TEXT) {
        // CJK and full-width forms; the few symbols MathType keeps in the style (\mid) stay `Next`
        return if c.is_some_and(|c| c >= '\u{2E80}') {
            Joins::FarEast
        } else {
            Joins::Next
        };
    }
    // an ordinary character of the symbol style or of a font named outright (∞ ∅, Euclid's ℝ ℒ) is
    // followed by a letter as ∂ is (probe-pc/fl-infty-x, fl-empty-x, fl-reals-x, fl-script-l-x)
    let symbol_like = (typeface == i32::from(TYPEFACE_SYMBOL) || typeface < 0)
        && class == Class::Ordinary
        && c.is_some_and(|c| !c.is_ascii());
    match c {
        Some(' ' | '\u{A0}') => Joins::Next,
        Some('\u{2202}') => Joins::Differential,
        Some('.') => Joins::All,
        Some('\u{2032}' | '\u{2033}' | '\u{2034}') => Joins::Any,
        _ if symbol_like => Joins::Differential,
        Some(l) if l.is_alphabetic() && class != Class::Function => Joins::Letters,
        Some(c) if typeface == i32::from(TYPEFACE_TEXT) && !"+-*/\\^&".contains(c) => Joins::Text,
        _ => Joins::None,
    }
}

/// Whether the next character follows the previous one by the previous one's advance (otherwise by ink and the
/// classes' space), both at one size:
/// - never into a function name whose classes ask for space before it (`kJ/mol`: space before `mol`);
/// - characters of one typeface, but not two operators of which one is a binary or unary sign (`−−`, `= −`, `∼ +`
///   keep their space, while `≠≠`, `min{` and `J/` in `kJ/mol` follow by advance), nor a relation of the symbol
///   style and a character of another class (`= ∞`);
/// - a prime and any neighbour the classes ask no space from, and so what follows a far-east text character or a
///   space character (`=` after Chinese text keeps its space); a unary sign and the number after it (−1; −x
///   keeps the plain gap);
/// - in one font: a period and its neighbours, a letter and the next letter whatever their styles (`dx` with an
///   upright d, `HA`).
pub(super) fn by_advance(prev: &Edge, next: &Edge) -> bool {
    if prev.typeface.is_none() || next.typeface.is_none() {
        return false;
    }
    // characters of one typeface follow by advance whatever their sizes (a, b in 7 pt, c in 15 pt one after
    // another); the other rules hold only at one size
    if prev.size != next.size {
        return prev.typeface == next.typeface && prev.class == next.class;
    }
    if next.joins == Joins::Start && Class::between(prev.class, next.class) > 0 {
        return false;
    }
    let one_font = prev.font.is_some() && prev.font == next.font;
    // a far-east text character is followed at its advance by a letter or another one; a digit or punctuation after
    // it keeps the inks' spacing (full-width 0 then a comma or 1: probe-pc/cj-*, writer/omml-0151)
    let next_joins = prev.joins == Joins::Next
        || (prev.joins == Joins::FarEast
            && matches!(next.joins, Joins::Letters | Joins::Next | Joins::FarEast));
    // in the symbol style a binary or unary sign keeps its space beside any character (∞ +, ∅ +:
    // probe-pc/fl-*-plus), elsewhere beside another operator only (kJ/mol)
    let sign = |c: Class| matches!(c, Class::Binary | Class::Unary);
    let symbol = prev.typeface == Some(i32::from(TYPEFACE_SYMBOL));
    let operators = (sign(prev.class) || sign(next.class))
        && (symbol
            || [prev.class, next.class]
                .iter()
                .all(|&c| sign(c) || c == Class::Relation));
    // ellipses keep their class space by ink even in one typeface (⋮⋱, ⋯⋯, ……: probe-pc/fo-*-dots)
    let ellipses = [prev, next].iter().any(|e| e.class == Class::Inner);
    // in the symbol style a relation keeps its space beside a character of another class (x = ∞, ∂ →, ≤ ∂:
    // probe-pc/sr-*, genuine/equation3), two relations follow by advance (≠≠)
    let relation = symbol
        && next.typeface == prev.typeface
        && (prev.class == Class::Relation) != (next.class == Class::Relation);
    (prev.typeface == next.typeface && !operators && !ellipses && !relation)
        || (prev.class == Class::Unary && next.typeface == Some(i32::from(TYPEFACE_NUMBER)))
        || ((prev.joins == Joins::Any
            || next.joins == Joins::Any
            || next_joins)
            && Class::between(prev.class, next.class) == 0)
        || (one_font && (prev.joins == Joins::All || next.joins == Joins::All))
        || (one_font && prev.joins == Joins::Letters && next.joins == Joins::Letters)
        || (one_font && prev.joins == Joins::Text && next.joins == Joins::Letters)
        || (prev.joins == Joins::Differential && next.joins == Joins::Letters)
        // symbols of one font whatever their styles (Greek-style infinity then the symbol style's partial sign:
        // probe-pc/sy-*, writer/layout-wide-0463)
        || (prev.joins == Joins::Named && next.joins == Joins::Letters)
        || (one_font && symbolic(prev) && symbolic(next))
}

/// A symbol (no letter, no operator) of the symbol style, of a font named outright or of a Greek style.
fn symbolic(e: &Edge) -> bool {
    let greek = matches!(e.typeface, Some(t) if t == i32::from(TYPEFACE_LOWER_GREEK)
        || t == i32::from(TYPEFACE_UPPER_GREEK));
    matches!(e.joins, Joins::Differential | Joins::Named | Joins::Slanted)
        || (greek && e.joins == Joins::None && e.class == Class::Ordinary)
}

/// A FONT_DEF's name: ASCII as it is, SimSun's GBK name as "SimSun".
pub(super) fn font_name(bytes: &[u8]) -> String {
    match bytes {
        [0xCB, 0xCE, 0xCC, 0xE5] => "SimSun".into(),
        _ => bytes.iter().map(|&b| char::from(b)).collect(),
    }
}

/// What a character draws in its font: the Windows character set, the byte (and a double-byte character's trail
/// byte), and the code to measure it by. Symbol fonts (MathType's Symbol and MT Extra encodings, the Euclid fonts'
/// own) draw their byte in the default character set; text fonts draw the character in the first Windows code page
/// that has it: the single-byte pages, then Chinese (936), Japanese (932) and Korean (949), as MathType's pictures
/// show (∮ in 936, ∬ in 932, ℓ in 949).
pub(super) fn encode(font: &FontDef, c: &Char) -> Option<(u8, u8, Option<u8>, Code)> {
    let text_font = font.encoding >= 5 && !font.name.starts_with("Euclid");
    if !text_font {
        let byte = c
            .encoded8
            .or_else(|| c.mt_code.filter(|&m| m < 0x100).map(|m| m as u8))?;
        return Some((1, byte, None, Code::Symbol(byte)));
    }
    let ch = char::from_u32(u32::from(c.mt_code?))?;
    if (ch as u32) < 0x80 {
        return Some((0, ch as u8, None, Code::Unicode(ch)));
    }
    if let Some((charset, byte)) = code_page_byte(ch) {
        return Some((charset, byte, None, Code::Unicode(ch)));
    }
    let (charset, [lead, trail]) = double_byte(ch)?;
    Some((charset, lead, Some(trail), Code::Unicode(ch)))
}

/// A character in the first of the Windows double-byte code pages 936, 932 and 949 that has it: the character set
/// and its two bytes.
fn double_byte(ch: char) -> Option<(u8, [u8; 2])> {
    let pages = [
        (encoding_rs::GBK, 134),
        (encoding_rs::SHIFT_JIS, 128),
        (encoding_rs::EUC_KR, 129),
    ];
    let text = ch.to_string();
    pages.into_iter().find_map(|(encoding, charset)| {
        let (bytes, _, unmappable) = encoding.encode(&text);
        match (unmappable, bytes.as_ref()) {
            (false, &[lead, trail]) => Some((charset, [lead, trail])),
            _ => None,
        }
    })
}

/// The first of the Windows code pages 1252, 1250, 1251, 1253 ... 1258 that has a character, as its character set
/// and byte.
pub(super) fn code_page_byte(ch: char) -> Option<(u8, u8)> {
    static PAGES: std::sync::OnceLock<Vec<(u16, Vec<u32>)>> = std::sync::OnceLock::new();
    let pages = PAGES.get_or_init(|| {
        include_str!("../../code_pages.txt")
            .lines()
            .filter_map(|line| {
                let mut parts = line.split(' ');
                let page: u16 = parts.next()?.parse().ok()?;
                Some((
                    page,
                    parts
                        .map(|hex| u32::from_str_radix(hex, 16).unwrap_or(0))
                        .collect(),
                ))
            })
            .collect()
    });
    let charset = |page: u16| match page {
        1250 => 238,
        1251 => 204,
        1253 => 161,
        1254 => 162,
        1255 => 177,
        1256 => 178,
        1257 => 186,
        1258 => 163,
        _ => 0,
    };
    for page in [1252u16, 1250, 1251, 1253, 1254, 1255, 1256, 1257, 1258] {
        let codes = &pages.iter().find(|(p, _)| *p == page)?.1;
        if let Some(index) = codes
            .iter()
            .position(|&code| code == ch as u32 && !(0x80..0xA0).contains(&code))
        {
            return Some((charset(page), 0x80 + index as u8));
        }
    }
    None
}
