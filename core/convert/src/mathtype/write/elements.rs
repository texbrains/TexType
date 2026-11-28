//! What MathML elements stand for in MathType's terms: spaces, colours, table lines, fences, big operators and
//! the old integral signs, accents and embellishments.

use super::super::characters::{identifier, operator, plain, text_glyph, Glyph};
use super::super::mathml::Element;
use super::super::records::*;

/// MathType's space character nearest to a MathML width (em, or pt and mu at 12 pt; ties go to the narrower), as
/// its import chooses them: zero EF01, EF07 (1/6 em), EF03 (1/4), EF04 (1/3), em EF05, two em EF06; a negative
/// width is EF01.
pub(super) fn space_code(width: &str) -> Option<u16> {
    let split = width
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(width.len());
    let number: f64 = width[..split].trim().parse().ok()?;
    let em = match &width[split..] {
        "em" | "" => number,
        "pt" => number / 12.0,
        "mu" => number / 18.0,
        "ex" => number * 0.43,
        _ => return None,
    };
    if em == 0.0 {
        return None;
    }
    if em < 0.0 {
        return Some(0xEF01);
    }
    let spaces = [
        (0.0, 0xEF01),
        (1.0 / 6.0, 0xEF07),
        (0.25, 0xEF03),
        (1.0 / 3.0, 0xEF04),
        (1.0, 0xEF05),
        (2.0, 0xEF06),
    ];
    let mut best = spaces[0];
    for space in spaces {
        if (space.0 - em).abs() < (best.0 - em).abs() - 1e-9 {
            best = space;
        }
    }
    Some(best.1)
}

/// A matrix's lines between `count` rows or columns and around them: two bits a line from the first (0 none,
/// 1 solid, 2 dashed), four lines a byte from its low bits. The inner lines are MathML's rowlines/columnlines list
/// (its last value goes on), the outer ones the frame.
pub(super) fn partitions(lines: Option<&str>, count: usize, frame: bool) -> Vec<u8> {
    let values: Vec<u8> = lines
        .unwrap_or("none")
        .split_whitespace()
        .map(|line| match line {
            "solid" => 1,
            "dashed" => 2,
            _ => 0,
        })
        .collect();
    let mut bytes = vec![0u8; ((count + 1) * 2).div_ceil(8)];
    for line in 0..=count {
        let value = if line == 0 || line == count {
            u8::from(frame)
        } else {
            values.get(line - 1).or(values.last()).copied().unwrap_or(0)
        };
        bytes[line / 4] |= value << ((line % 4) * 2);
    }
    bytes
}

/// A MathML colour (#rgb, #rrggbb or a CSS colour name); black is MathType's default colour (Some(None)).
pub(super) fn color_value(text: &str) -> Option<Option<[u8; 3]>> {
    let named = match text.to_ascii_lowercase().as_str() {
        "black" => "#000000",
        "white" => "#ffffff",
        "red" => "#ff0000",
        "lime" => "#00ff00",
        "green" => "#008000",
        "blue" => "#0000ff",
        "yellow" => "#ffff00",
        "cyan" | "aqua" => "#00ffff",
        "magenta" | "fuchsia" => "#ff00ff",
        "gray" | "grey" => "#808080",
        "silver" => "#c0c0c0",
        "maroon" => "#800000",
        "olive" => "#808000",
        "purple" => "#800080",
        "teal" => "#008080",
        "navy" => "#000080",
        "orange" => "#ffa500",
        _ => text,
    };
    let hex = named.strip_prefix('#')?;
    let digits: Vec<u8> = hex
        .chars()
        .map(|c| c.to_digit(16).map(|d| d as u8))
        .collect::<Option<_>>()?;
    let rgb = match digits[..] {
        [r, g, b] => [r * 17, g * 17, b * 17],
        [r1, r2, g1, g2, b1, b2] => [r1 * 16 + r2, g1 * 16 + g2, b1 * 16 + b2],
        _ => return None,
    };
    Some((rgb != [0, 0, 0]).then_some(rgb))
}

/// The nodes a MathML argument stands for: an mrow's children, or the element itself.
pub(super) fn row_children(element: &Element) -> Vec<&Element> {
    if element.name == "mrow" {
        element.elements().collect()
    } else {
        vec![element]
    }
}

/// An mrow MathJax writes for \left ... \right: an opening and a closing fence operator around the content.
pub(super) fn fences(element: &Element) -> Option<()> {
    let children: Vec<&Element> = element.elements().collect();
    let fence = |child: Option<&&Element>, class: &str| {
        child.is_some_and(|child| {
            child.name == "mo" && child.attribute("data-mjx-texclass") == Some(class)
        })
    };
    (children.len() >= 2 && fence(children.first(), "OPEN") && fence(children.last(), "CLOSE"))
        .then_some(())
}

/// MathType's code for an expanding fence character (its own codes for bars, floors and ceilings).
pub(super) fn fence_code(c: char, left: bool) -> u16 {
    match c {
        '|' if left => 0xEC07,
        '|' => 0xEC08,
        '\u{2016}' | '\u{2225}' if left => 0xEC09,
        '\u{2016}' | '\u{2225}' => 0xEC0A,
        '\u{230A}' => 0xF8F0,
        '\u{230B}' => 0xF8FB,
        '\u{2308}' => 0xF8EE,
        '\u{2309}' => 0xF8F9,
        '\u{27E8}' => 0x2329,
        '\u{27E9}' => 0x232A,
        '\u{27E6}' => 0x301A,
        '\u{27E7}' => 0x301B,
        _ => c as u16,
    }
}

/// A big operator MathType's editor writes with its own template (MathType 6's, also read by 7) because MathType 7
/// has no sign character for it: the template, its variation (integrals: the number of signs, 0x04 loop, 0x08
/// clockwise) and the sign's characters (typeface, MTCode, font position).
pub(super) struct OldBigOperator {
    pub(super) selector: u8,
    pub(super) variation: u16,
    pub(super) signs: Vec<(u8, u16, u8)>,
}

pub(super) fn old_big_operator(sign: char) -> Option<OldBigOperator> {
    let integral = (TYPEFACE_SYMBOL, 0x222B, 0xF2);
    let mt_extra = |code, position| (TYPEFACE_MT_EXTRA, code, position);
    let (selector, variation, signs) = match sign {
        '\u{222D}' => (TEMPLATE_INTEGRAL, 0x03, vec![integral; 3]),
        '\u{222F}' => (
            TEMPLATE_INTEGRAL,
            0x06,
            vec![mt_extra(0xEE12, 0xD2), integral, integral],
        ),
        '\u{2230}' => (
            TEMPLATE_INTEGRAL,
            0x07,
            vec![mt_extra(0xEE13, 0xD3), integral, integral, integral],
        ),
        '\u{2232}' => (
            TEMPLATE_INTEGRAL,
            0x0D,
            vec![mt_extra(0xEE00, 0x69), integral],
        ),
        '\u{2233}' => (
            TEMPLATE_INTEGRAL,
            0x09,
            vec![mt_extra(0xEE01, 0x6A), integral],
        ),
        // the big union and intersection: MT Extra's large cup and cap, as MathType's editor stores them
        '\u{22C3}' => (TEMPLATE_UNION, 0, vec![mt_extra(0x222A, 0x55)]),
        '\u{22C2}' => (TEMPLATE_INTERSECTION, 0, vec![mt_extra(0x2229, 0x49)]),
        _ => return None,
    };
    Some(OldBigOperator {
        selector,
        variation,
        signs,
    })
}

/// MathType's space character for a Unicode space inside a token (em space, six-per-em space ...), by its width.
pub(super) fn unicode_space(c: char) -> Option<u16> {
    let em = match c {
        '\u{2002}' | '\u{2007}' => 0.5,
        '\u{2003}' => 1.0,
        '\u{2004}' => 1.0 / 3.0,
        '\u{2005}' | '\u{2008}' => 0.25,
        '\u{2006}' => 1.0 / 6.0,
        '\u{2009}' => 0.2,
        '\u{200A}' => 0.1,
        '\u{205F}' => 2.0 / 9.0,
        _ => return None,
    };
    space_code(&format!("{em}em"))
}

/// The embellishment a combining mark after a character stands for.
pub(super) fn combining_embellishment(mark: char) -> Option<u8> {
    Some(match mark {
        '\u{0302}' => EMBELL_HAT,
        '\u{0303}' => EMBELL_TILDE,
        '\u{0307}' => EMBELL_DOT,
        '\u{0308}' => EMBELL_DOUBLE_DOT,
        '\u{0304}' | '\u{0305}' => EMBELL_OVERBAR,
        '\u{20D7}' => EMBELL_RIGHT_ARROW,
        '\u{0338}' => EMBELL_NOT,
        '\u{0332}' => EMBELL_UNDERBAR,
        _ => return None,
    })
}

/// A big operator's sign, through the rows and styles around it.
pub(super) fn big_operator(element: &Element) -> Option<&Element> {
    let mut element = element;
    while matches!(element.name.as_str(), "mrow" | "mstyle") {
        let mut children = element.elements();
        let (Some(only), None) = (children.next(), children.next()) else {
            return None;
        };
        element = only;
    }
    let text = element.text();
    let mut chars = text.chars();
    let (Some(c), None) = (chars.next(), chars.next()) else {
        return None;
    };
    let large = matches!(c, '\u{2211}' | '\u{220F}' | '\u{2210}' | '\u{22C0}'..='\u{22C3}' | '\u{222B}'..='\u{2233}' | '\u{2A00}'..='\u{2A1C}');
    (element.name == "mo" && large).then_some(element)
}

/// The one token an element is, through the rows and styles around it.
pub(super) fn single_token(element: &Element) -> Option<&Element> {
    let mut element = element;
    while matches!(element.name.as_str(), "mrow" | "mstyle") {
        let mut children = element.elements();
        let (Some(only), None) = (children.next(), children.next()) else {
            return None;
        };
        element = only;
    }
    matches!(element.name.as_str(), "mi" | "mn" | "mo" | "mtext").then_some(element)
}

/// The base of an accent or prime when it is one character.
pub(super) fn single_glyph(element: &Element) -> Option<Glyph> {
    let element = single_token(element)?;
    let text = element.text();
    let mut chars = text.chars();
    let (Some(c), None) = (chars.next(), chars.next()) else {
        return None;
    };
    let variant = element.attribute("mathvariant");
    Some(match element.name.as_str() {
        "mi" => identifier(c, variant.unwrap_or("italic")),
        "mn" if c.is_ascii_digit() => plain(TYPEFACE_NUMBER, c),
        "mtext" => text_glyph(c),
        _ => operator(c),
    })
}

/// The embellishment an accent mark stands for.
pub(super) fn embellishment(mark: &Element) -> Option<u8> {
    let text = mark.text();
    Some(match text.as_str() {
        // the accents MathType stores as embellishments; others (\ddot, \breve, \check ...) as a limit
        "\u{02D9}" | "." | "\u{0307}" => EMBELL_DOT,
        "~" | "\u{02DC}" | "\u{0303}" => EMBELL_TILDE,
        "^" | "\u{02C6}" | "\u{0302}" => EMBELL_HAT,
        "\u{2192}" | "\u{20D7}" => EMBELL_RIGHT_ARROW,
        "\u{00AF}" | "\u{2015}" | "\u{203E}" | "\u{0305}" => EMBELL_OVERBAR,
        _ => return None,
    })
}
