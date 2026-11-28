//! MathType equation data against testing/corpus/mathtype (where the rows come from: its README).

#[path = "mathtype/canonical.rs"]
mod canonical;

use convert::mathtype::mtef::{self, Mtef, Record};
use convert::mathtype::read;
use serde_json::Value;

fn rows(file: &str) -> Vec<Value> {
    let path = format!(
        "{}/../../testing/corpus/mathtype/{file}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{path}: {error}"))
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn base64(text: &str) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => panic!("not base64: {c}"),
    };
    let digits: Vec<u8> = text.bytes().filter(|&c| c != b'=').map(value).collect();
    digits
        .chunks(4)
        .flat_map(|chunk| {
            let bits = chunk
                .iter()
                .enumerate()
                .fold(0u32, |acc, (i, &d)| acc | (d as u32) << (18 - 6 * i));
            let bytes = [(bits >> 16) as u8, (bits >> 8) as u8, bits as u8];
            bytes.into_iter().take(chunk.len() - 1)
        })
        .collect()
}

/// The MTEF of an Equation Native stream: after the 28-byte header, as long as the header says.
fn mtef_of(native: &[u8]) -> &[u8] {
    let length = u32::from_le_bytes([native[8], native[9], native[10], native[11]]) as usize;
    &native[28..28 + length]
}

#[test]
fn every_equation_reads_and_writes_back_unchanged() {
    let mut failures = Vec::new();
    let mut count = 0;
    for row in rows("read.jsonl").into_iter().chain(rows("import.jsonl")) {
        let source = row["source"].as_str().unwrap();
        // formulas MathType's own import refused have no data
        let Some(native) = row["native"].as_str() else {
            continue;
        };
        let native = base64(native);
        count += 1;
        match mtef::from_equation_native(&native) {
            Ok(model) => {
                if mtef::write(&model) != mtef_of(&native) {
                    failures.push(format!("{source}: written back differently"));
                }
            }
            Err(error) => failures.push(format!("{source}: {error}")),
        }
    }
    assert!(count > 1300, "only {count} rows");
    assert!(
        failures.is_empty(),
        "{} of {count} failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// MathType's placeholder (MT Extra 0x6E): where its MathML import put a character or structure it has no record
/// for.
fn has_placeholder(records: &[Record]) -> bool {
    records.iter().any(|record| match record {
        Record::Char(c) => c.mt_code == Some(0xFFFD),
        Record::Line(line) => has_placeholder(&line.content),
        Record::Template(template) => has_placeholder(&template.content),
        Record::Pile(pile) => has_placeholder(&pile.content),
        Record::Matrix(matrix) => has_placeholder(&matrix.content),
        _ => false,
    })
}

#[test]
fn every_equation_reads_to_latex() {
    let mut failures = Vec::new();
    let mut count = 0;
    for row in rows("read.jsonl").into_iter().chain(rows("import.jsonl")) {
        let Some(native) = row["native"].as_str() else {
            continue;
        };
        let source = row["source"].as_str().unwrap();
        let mathml = read::to_mathml(&mtef::from_equation_native(&base64(native)).unwrap());
        count += 1;
        if let Err(error) = convert::omml::word_equation_latex(&mathml) {
            failures.push(format!("{source}: {error}\n  {mathml}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {count} failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Equations MathType's MathML export gets wrong, so the reader differs from it there.
const EXPORT_FAULTS: [(&str, &str); 12] = [
    ("omml-0123", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0124", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0145", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0146", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0155", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0156", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0163", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0164", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0177", "the export writes ℓ (MT Extra 0x6C) as l"),
    ("omml-0178", "the export writes ℓ (MT Extra 0x6C) as l"),
    (
        "omml-0165",
        "the export makes an unclosed { ... ] run the superscript's base",
    ),
    (
        "omml-0166",
        "the export makes an unclosed { ... ] run the superscript's base",
    ),
];

/// The reader against MathType's own MathML export of the same equations (mathvariant aside: the export writes
/// none). Also printed: how often it equals the MathML MathType's import was given, which measures that import
/// (where it differs, MathType stored something else), not the reader.
#[test]
fn reader_matches_mathtype_s_own_export() {
    let mut failures = Vec::new();
    let mut clean = 0;
    let mut input_agrees = 0;
    for row in rows("import.jsonl") {
        let Some(native) = row["native"].as_str() else {
            continue;
        };
        let source = row["source"].as_str().unwrap();
        let model: Mtef = mtef::from_equation_native(&base64(native)).unwrap();
        let mathml = read::to_mathml(&model);
        let ours = canonical::canonical(&mathml, false)
            .unwrap_or_else(|error| panic!("{source}: {error}\n{mathml}"));
        let export = canonical::canonical(row["mathtypeMathml"].as_str().unwrap(), false).unwrap();
        let fault = EXPORT_FAULTS.iter().find(|(id, _)| *id == source);
        match (ours == export, fault) {
            (true, Some((_, reason))) => {
                failures.push(format!("{source} now equals the export ({reason})"))
            }
            (false, None) => failures.push(format!("{source}\n  ours   {ours}\n  export {export}")),
            _ => {}
        }
        if !has_placeholder(&model.records) {
            clean += 1;
            let ours = canonical::canonical(&mathml, true).unwrap();
            let input = canonical::canonical(row["mathml"].as_str().unwrap(), true).unwrap();
            input_agrees += usize::from(ours == input);
        }
    }
    println!("{input_agrees} of {clean} equations without placeholders equal the MathML MathType imported");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Colour records left out: MathType's MathML import marks every character black, its editor does not.
fn without_colors(records: &[Record]) -> Vec<Record> {
    records
        .iter()
        .filter(|record| !matches!(record, Record::Color(_) | Record::ColorDef(_)))
        .map(|record| match record {
            Record::Line(line) => Record::Line(mtef::Line {
                content: without_colors(&line.content),
                ..line.clone()
            }),
            Record::Char(c) => Record::Char(mtef::Char {
                embellishments: without_colors(&c.embellishments),
                ..c.clone()
            }),
            Record::Template(template) => Record::Template(mtef::Template {
                content: without_colors(&template.content),
                ..template.clone()
            }),
            Record::Pile(pile) => Record::Pile(mtef::Pile {
                content: without_colors(&pile.content),
                ..pile.clone()
            }),
            Record::Matrix(matrix) => Record::Matrix(mtef::Matrix {
                content: without_colors(&matrix.content),
                ..matrix.clone()
            }),
            other => other.clone(),
        })
        .collect()
}

/// A record tree, one record a line.
fn outline(records: &[Record], depth: usize, out: &mut String) {
    for record in records {
        let pad = "  ".repeat(depth);
        match record {
            Record::Line(line) => {
                out.push_str(&format!("{pad}LINE {:#04x}\n", line.options));
                outline(&line.content, depth + 1, out);
            }
            Record::Char(c) => {
                let text = c
                    .mt_code
                    .and_then(|code| char::from_u32(code.into()))
                    .unwrap_or('?');
                out.push_str(&format!(
                    "{pad}CHAR tf {} {:?} {:04x?} e8 {:02x?} opt {:#04x}\n",
                    c.typeface.value, text, c.mt_code, c.encoded8, c.options
                ));
                outline(&c.embellishments, depth + 1, out);
            }
            Record::Template(t) => {
                out.push_str(&format!(
                    "{pad}TMPL {} var {:#06x} opt {:#04x}\n",
                    t.selector, t.variation, t.template_options
                ));
                outline(&t.content, depth + 1, out);
            }
            Record::Pile(p) => {
                out.push_str(&format!("{pad}PILE {} {}\n", p.horizontal, p.vertical));
                outline(&p.content, depth + 1, out);
            }
            Record::Matrix(m) => {
                out.push_str(&format!(
                    "{pad}MATRIX {}x{} v {} h {} vj {} {:02x?} {:02x?}\n",
                    m.rows,
                    m.columns,
                    m.vertical,
                    m.horizontal_justification,
                    m.vertical_justification,
                    m.row_partitions,
                    m.column_partitions
                ));
                outline(&m.content, depth + 1, out);
            }
            Record::EqnPrefs(_) => out.push_str(&format!("{pad}EQN_PREFS\n")),
            other => out.push_str(&format!("{pad}{other:?}\n")),
        }
    }
}

/// Where the writer stores a formula otherwise than MathType's import does: the import loses what the formula
/// draws, the writer uses the template MathType's editor makes.
const WRITER_CHOICES: [(&str, &str); 14] = [
    ("omml-0151", MONOSPACE),
    ("omml-0152", MONOSPACE),
    ("layout-wide-0477", MONOSPACE),
    ("layout-wide-0478", MONOSPACE),
    ("omml-0171", "\\left[ \\right): the interval template; the import writes two plain characters"),
    ("omml-0172", "\\left[ \\right): the interval template; the import writes two plain characters"),
    ("layout-wide-0389", DOUBLE_BAR),
    ("layout-wide-0390", DOUBLE_BAR),
    ("layout-wide-0519", DOUBLE_BAR),
    ("layout-wide-0520", DOUBLE_BAR),
    ("layout-wide-0401", "\\middle|: the parenthesis template around a plain bar; the import writes plain characters"),
    ("layout-wide-0402", "\\middle|: the parenthesis template around a plain bar; the import writes plain characters"),
    ("layout-extra-0239", RULE_SPACE),
    ("layout-extra-0240", RULE_SPACE),
];
const MONOSPACE: &str = "\\mathtt: plain Courier New; the import makes it bold italic";
const DOUBLE_BAR: &str =
    "\\| fences: the double-bar template; the import writes plain characters that do not grow";
const RULE_SPACE: &str =
    "a 0.5em space in a superscript: one 1/3-em space; the import writes two (EF03, EF02)";

/// The writer against MathType's own records for the formulas its import kept whole (the reader gives back the
/// given MathML), colour records aside.
#[test]
fn writer_matches_mathtype_s_own_records() {
    let mut failures = Vec::new();
    for row in rows("import.jsonl") {
        let Some(native) = row["native"].as_str() else {
            continue;
        };
        let source = row["source"].as_str().unwrap();
        let given = row["mathml"].as_str().unwrap();
        let theirs: Mtef = mtef::from_equation_native(&base64(native)).unwrap();
        let read_back = canonical::canonical(&read::to_mathml(&theirs), true).unwrap();
        if has_placeholder(&theirs.records)
            || read_back != canonical::canonical(given, true).unwrap()
        {
            continue;
        }
        let display = row["display"].as_bool().unwrap();
        let ours = convert::mathtype::write::from_mathml(given, display)
            .unwrap_or_else(|error| panic!("{source}: {error}"));
        let theirs = Mtef {
            records: without_colors(&theirs.records),
            ..theirs
        };
        // colours are compared by reading back (every_formula_written_reads_back_as_itself)
        let ours = Mtef {
            records: without_colors(&ours.records),
            ..ours
        };
        let same = mtef::write(&ours) == mtef::write(&theirs);
        match (same, WRITER_CHOICES.iter().find(|(id, _)| *id == source)) {
            (true, Some((_, choice))) => {
                failures.push(format!("{source} is now written as the import ({choice})"))
            }
            (false, None) => {
                let (mut a, mut b) = (String::new(), String::new());
                outline(&ours.records, 1, &mut a);
                outline(&theirs.records, 1, &mut b);
                let mut text = format!("=== {source} {}\n", row["latex"].as_str().unwrap());
                let (a, b): (Vec<&str>, Vec<&str>) = (a.lines().collect(), b.lines().collect());
                for index in 0..a.len().max(b.len()) {
                    let (x, y) = (
                        a.get(index).copied().unwrap_or(""),
                        b.get(index).copied().unwrap_or(""),
                    );
                    text.push_str(&format!(
                        "{} {x:<60} | {y}\n",
                        if x == y { ' ' } else { '*' }
                    ));
                }
                failures.push(text);
            }
            _ => {}
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Formulas MathType's records cannot hold as given: its scripts follow the one item before them (a script on a
/// group is drawn the same but read back on the group's last item), it has no strike with an arrow, and no long
/// arrow (its arrow template hangs MathType 7; the ordinary arrow is written).
const MATHTYPE_LIMITS: [(&str, &str); 29] = [
    ("omml-0123", ACCENT_SCRIPT),
    ("omml-0124", ACCENT_SCRIPT),
    ("mhchem-0621", LONG_ARROW),
    ("mhchem-0622", LONG_ARROW),
    ("mhchem-0627", LONG_ARROW),
    ("mhchem-0628", LONG_ARROW),
    ("mhchem-0631", LONG_ARROW),
    ("mhchem-0632", LONG_ARROW),
    ("mhchem-0633", LONG_ARROW),
    ("mhchem-0634", LONG_ARROW),
    ("omml-0117", GROUP_SCRIPT),
    ("omml-0118", GROUP_SCRIPT),
    ("omml-0127", GROUP_SCRIPT),
    ("omml-0128", GROUP_SCRIPT),
    ("omml-0145", GROUP_SCRIPT),
    ("omml-0146", GROUP_SCRIPT),
    ("omml-0147", GROUP_SCRIPT),
    ("omml-0148", GROUP_SCRIPT),
    ("omml-0159", GROUP_SCRIPT),
    ("omml-0160", GROUP_SCRIPT),
    ("omml-0173", GROUP_SCRIPT),
    ("omml-0174", GROUP_SCRIPT),
    ("omml-0177", GROUP_SCRIPT),
    ("omml-0178", GROUP_SCRIPT),
    ("layout-wide-0295", GROUP_SCRIPT),
    ("layout-wide-0296", GROUP_SCRIPT),
    ("layout-wide-0380", GROUP_SCRIPT),
    (
        "layout-extra2-0251",
        "\\cancelto: the strike without its arrow",
    ),
    (
        "layout-extra2-0252",
        "\\cancelto: the strike without its arrow",
    ),
];
const GROUP_SCRIPT: &str = "a script on a group of items";
const LONG_ARROW: &str = "a long arrow, written as MathType's ordinary arrow";
const ACCENT_SCRIPT: &str =
    "a script on a lone accent mark: the accent goes on the character before it";

/// Formulas the writer refuses: MathType has no glyph for one of their characters (it would draw its placeholder;
/// the owner decided on 2026-11-25 that such formulas are not written in MathType's format).
const REFUSED: [(&str, &str); 14] = [
    (
        "layout-esint-0225",
        "MathType has no character for U+2A0F \u{2A0F}",
    ),
    (
        "layout-esint-0226",
        "MathType has no character for U+2A0F \u{2A0F}",
    ),
    (
        "layout-esint-0227",
        "MathType has no character for U+2231 \u{2231}",
    ),
    (
        "layout-esint-0228",
        "MathType has no character for U+2231 \u{2231}",
    ),
    (
        "layout-esint-0229",
        "MathType has no character for U+2A16 \u{2A16}",
    ),
    (
        "layout-esint-0230",
        "MathType has no character for U+2A16 \u{2A16}",
    ),
    (
        "layout-esint-0231",
        "MathType has no character for U+2A1B \u{2A1B}",
    ),
    (
        "layout-esint-0232",
        "MathType has no character for U+2A1B \u{2A1B}",
    ),
    (
        "layout-extra5-0277",
        "MathType has no character for U+2A0C \u{2A0C}",
    ),
    (
        "layout-extra5-0278",
        "MathType has no character for U+2A0C \u{2A0C}",
    ),
    (
        "layout-wide-0347",
        "MathType has no character for U+2A01 \u{2A01}",
    ),
    (
        "layout-wide-0348",
        "MathType has no character for U+2A01 \u{2A01}",
    ),
    (
        "layout-wide-0349",
        "MathType has no character for U+2A02 \u{2A02}",
    ),
    (
        "layout-wide-0350",
        "MathType has no character for U+2A02 \u{2A02}",
    ),
];

/// Every corpus formula, including those MathType's import changed or refused: what the writer stores reads back
/// as the formula (structure and drawn characters).
#[test]
fn every_formula_written_reads_back_as_itself() {
    let mut failures = Vec::new();
    for row in rows("import.jsonl") {
        let source = row["source"].as_str().unwrap();
        let given = row["mathml"].as_str().unwrap();
        let display = row["display"].as_bool().unwrap();
        let refused = REFUSED.iter().find(|(id, _)| *id == source);
        let written = match (
            convert::mathtype::write::from_mathml(given, display),
            refused,
        ) {
            (Ok(_), Some((_, error))) => {
                failures.push(format!("{source} is now written ({error})"));
                continue;
            }
            (Err(error), Some((_, expected))) if error == *expected => continue,
            (Err(error), _) => {
                failures.push(format!("{source} refused: {error}"));
                continue;
            }
            (Ok(written), None) => written,
        };
        let native = mtef::to_equation_native(&written);
        let read_back = read::to_mathml(&mtef::from_equation_native(&native).unwrap());
        let ours = canonical::canonical_colored(&read_back).unwrap();
        let expected = canonical::canonical_colored(given).unwrap();
        // scripts on an empty base (mhchem's zero-width phantom, which the writer drops) attach to what comes
        // before them, as MathType's subscripts do: the same characters with the scripts in the same places
        let empty_base = given.contains("<mphantom")
            && ["msub{}", "msup{}", "msubsup{}"]
                .iter()
                .any(|s| expected.contains(s));
        let same =
            ours == expected || (empty_base && inline_scripts(&ours) == inline_scripts(&expected));
        match (same, MATHTYPE_LIMITS.iter().find(|(id, _)| *id == source)) {
            (true, Some((_, limit))) => {
                failures.push(format!("{source} now reads back as itself ({limit})"))
            }
            (false, None) => {
                let latex = row["latex"].as_str().unwrap();
                failures.push(format!(
                    "{source} {latex}\n  read back {ours}\n  given     {expected}"
                ));
            }
            _ => {}
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// A canonical form with every script written after its base inline: msub{B}{S} as B_{S}, msup{B}{S} as
/// B^{S}, msubsup{B}{S}{T} as B_{S}^{T}.
fn inline_scripts(text: &str) -> String {
    // a braced group at the start: its inside and what follows it
    fn group(text: &str) -> Option<(&str, &str)> {
        if !text.starts_with('{') {
            return None;
        }
        let mut depth = 0;
        let end = text.char_indices().find_map(|(i, c)| {
            depth += i32::from(c == '{') - i32::from(c == '}');
            (depth == 0).then_some(i)
        })?;
        Some((&text[1..end], &text[end + 1..]))
    }
    let mut out = String::new();
    let mut rest = text;
    'scan: while let Some(c) = rest.chars().next() {
        for (name, marks) in [("msubsup", "_^"), ("msub", "_"), ("msup", "^")] {
            let Some(after) = rest.strip_prefix(name) else {
                continue;
            };
            let mut arguments = Vec::new();
            let mut tail = after;
            for _ in 0..=marks.len() {
                let Some((inside, next)) = group(tail) else {
                    break;
                };
                arguments.push(inline_scripts(inside));
                tail = next;
            }
            if arguments.len() == marks.len() + 1 {
                out.push_str(&arguments[0]);
                for (mark, argument) in marks.chars().zip(&arguments[1..]) {
                    out.push(mark);
                    out.push('{');
                    out.push_str(argument);
                    out.push('}');
                }
                rest = tail;
                continue 'scan;
            }
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// The formula part of an equation (from its first line, pile or matrix with the size before it).
fn body_of(records: &[Record]) -> &[Record] {
    let first = records
        .iter()
        .position(|record| {
            matches!(
                record,
                Record::Line(_) | Record::Pile(_) | Record::Matrix(_)
            )
        })
        .unwrap_or(records.len());
    let start = if first > 0 && matches!(records[first - 1], Record::TypeSize(_)) {
        first - 1
    } else {
        first
    };
    &records[start..]
}

/// MathType's own equations (real ones and those MathType wrote for the corpus, with its placeholders, not the
/// old codec's), as (source, equation).
fn mathtype_equations() -> Vec<(String, Mtef)> {
    let mathtype_made = rows("read.jsonl")
        .into_iter()
        .filter(|row| !row["source"].as_str().unwrap().starts_with("codec/"));
    mathtype_made
        .chain(rows("import.jsonl"))
        .filter_map(|row| {
            let original = mtef::from_equation_native(&base64(row["native"].as_str()?)).unwrap();
            Some((row["source"].as_str().unwrap().to_string(), original))
        })
        .collect()
}

/// The two record runs side by side where they differ.
fn side_by_side(source: &str, ours: &[Record], theirs: &[Record]) -> String {
    let (mut a, mut b) = (String::new(), String::new());
    outline(ours, 1, &mut a);
    outline(theirs, 1, &mut b);
    let mut text = format!("=== {source}\n");
    let (a, b): (Vec<&str>, Vec<&str>) = (a.lines().collect(), b.lines().collect());
    for index in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(index).copied().unwrap_or(""),
            b.get(index).copied().unwrap_or(""),
        );
        if x != y {
            text.push_str(&format!("* {x:<60} | {y}\n"));
        }
    }
    text
}

/// Editing a MathType equation without changing it (its own MathML written back into it) keeps its formula's
/// records byte for byte, and its header but for MathType's TeX copy (record 102, which MathType drops on an edit).
#[test]
fn editing_without_change_keeps_mathtype_s_records() {
    let mut failures = Vec::new();
    let equations = mathtype_equations();
    for (source, original) in &equations {
        let mathml = read::to_mathml(original);
        let display = original.equation_options & 0x01 == 0;
        let edited = match convert::mathtype::write::edit(original, &mathml, display) {
            Ok(edited) => edited,
            Err(error) => {
                failures.push(format!("{source}: {error}"));
                continue;
            }
        };
        let (ours, theirs) = (body_of(&edited.records), body_of(&original.records));
        if ours != theirs {
            failures.push(side_by_side(source, ours, theirs));
            continue;
        }
        // the original header's records in order, without the TeX copy (MathType's far-east font may be added)
        let mut header = edited.records[..edited.records.len() - ours.len()].iter();
        let kept = original.records[..original.records.len() - theirs.len()]
            .iter()
            .filter(|record| {
                !matches!(
                    record,
                    Record::Future { kind: 102, .. } | Record::EqnPrefs(_)
                )
            })
            .all(|record| header.any(|ours| ours == record));
        if !kept
            || edited
                .records
                .iter()
                .any(|record| matches!(record, Record::Future { kind: 102, .. }))
        {
            failures.push(format!("{source}: header not kept"));
        }
    }
    println!(
        "{} of {} edited without change keep their records",
        equations.len() - failures.len(),
        equations.len()
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// The parts (not settings records) of an equation's formula at its top: a line's parts, or the pile or matrix.
fn top_parts(records: &[Record]) -> Vec<&Record> {
    let is_part = |record: &&Record| {
        matches!(
            record,
            Record::Char(_)
                | Record::Template(_)
                | Record::Line(_)
                | Record::Pile(_)
                | Record::Matrix(_)
        )
    };
    match body_of(records).iter().find(is_part) {
        Some(Record::Line(line)) => line.content.iter().filter(is_part).collect(),
        Some(other) => vec![other],
        None => Vec::new(),
    }
}

/// Big operators whose sign MathType's import replaced with its placeholder (no glyph), stored as a big-operator
/// template: a letter changed in their limits writes the placeholder with its limits as a limit template, which
/// draws the same (the reader's MathML does not tell such a sign from a placeholder under a limit).
const PLACEHOLDER_SIGNS: [&str; 4] = [
    "layout-wide-0343",
    "layout-wide-0344",
    "layout-wide-0345",
    "layout-wide-0346",
];

/// An edit keeps everything it did not touch: a letter added before or after the formula leaves every other part's
/// records as they were, and a letter changed inside it changes only that letter's character record.
#[test]
fn an_edit_keeps_what_it_did_not_touch() {
    let mut failures = Vec::new();
    let equations = mathtype_equations();
    let x = |record: &&Record| matches!(record, Record::Char(c) if c.mt_code == Some(0x78) && c.typeface.value == 3);
    for (source, original) in &equations {
        let mathml = read::to_mathml(original);
        let display = original.equation_options & 0x01 == 0;
        let open = mathml.find('>').unwrap() + 1;
        let close = mathml.rfind("</math>").unwrap();
        let added = [
            (
                "after",
                format!("{}<mi>x</mi>{}", &mathml[..close], &mathml[close..]),
            ),
            (
                "before",
                format!("{}<mi>x</mi>{}", &mathml[..open], &mathml[open..]),
            ),
        ];
        let theirs = top_parts(&original.records);
        for (place, changed) in added {
            let edited = match convert::mathtype::write::edit(original, &changed, display) {
                Ok(edited) => edited,
                Err(error) => {
                    failures.push(format!("{source} x {place}: {error}"));
                    continue;
                }
            };
            let mut ours = top_parts(&edited.records);
            let at = if place == "after" {
                ours.len().checked_sub(1)
            } else {
                Some(0)
            };
            match at.filter(|&at| at < ours.len() && x(&ours[at])) {
                Some(at) => {
                    ours.remove(at);
                }
                None => {
                    failures.push(format!("{source} x {place}: no x"));
                    continue;
                }
            }
            if ours != theirs {
                let ours: Vec<Record> = ours.into_iter().cloned().collect();
                let theirs: Vec<Record> = theirs.iter().map(|&record| record.clone()).collect();
                failures.push(side_by_side(&format!("{source} x {place}"), &ours, &theirs));
            }
        }
        // a one-letter variable changed to another letter
        let Some(at) = mathml
            .match_indices("<mi>")
            .map(|(at, _)| at + 4)
            .find(|&at| {
                mathml.as_bytes()[at].is_ascii_lowercase() && mathml[at + 1..].starts_with("</mi>")
            })
        else {
            continue;
        };
        let letter = if &mathml[at..at + 1] == "q" { "w" } else { "q" };
        let changed = format!("{}{letter}{}", &mathml[..at], &mathml[at + 1..]);
        let edited = match convert::mathtype::write::edit(original, &changed, display) {
            Ok(edited) => edited,
            Err(error) => {
                failures.push(format!("{source} letter: {error}"));
                continue;
            }
        };
        let mut changes = Vec::new();
        record_changes(
            body_of(&edited.records),
            body_of(&original.records),
            &mut changes,
        );
        let one_letter = matches!(&changes[..], [(Some(Record::Char(a)), Some(Record::Char(b)))]
            if a.mt_code == Some(u16::from(letter.as_bytes()[0])) && a.typeface == b.typeface && a.nudge == b.nudge);
        if !one_letter && !PLACEHOLDER_SIGNS.contains(&source.as_str()) {
            failures.push(side_by_side(
                &format!("{source} letter"),
                body_of(&edited.records),
                body_of(&original.records),
            ));
        }
    }
    println!(
        "{} failures in {} equations",
        failures.len(),
        equations.len()
    );
    let limit = std::env::var("SHOW")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(10);
    failures
        .iter()
        .take(limit)
        .for_each(|failure| println!("{failure}"));
    assert!(failures.is_empty(), "{} failures", failures.len());
}

/// The records two runs differ in, walking both trees: (ours, theirs), None where one run has no record there.
fn record_changes<'a>(
    ours: &'a [Record],
    theirs: &'a [Record],
    changes: &mut Vec<(Option<&'a Record>, Option<&'a Record>)>,
) {
    let content = |record: &'a Record| -> Option<&'a [Record]> {
        match record {
            Record::Line(line) => Some(&line.content),
            Record::Template(template) => Some(&template.content),
            Record::Pile(pile) => Some(&pile.content),
            Record::Matrix(matrix) => Some(&matrix.content),
            _ => None,
        }
    };
    for index in 0..ours.len().max(theirs.len()) {
        match (ours.get(index), theirs.get(index)) {
            (Some(a), Some(b)) if a == b => {}
            (Some(a), Some(b)) => match (content(a), content(b)) {
                (Some(x), Some(y)) if std::mem::discriminant(a) == std::mem::discriminant(b) => {
                    let before = changes.len();
                    record_changes(x, y, changes);
                    // the containers' own fields differ too when the contents are the same
                    if changes.len() == before {
                        changes.push((Some(a), Some(b)));
                    }
                }
                _ => changes.push((Some(a), Some(b))),
            },
            (a, b) => changes.push((a, b)),
        }
    }
}

/// The first template's selector and variation in records.
fn first_template(records: &[Record]) -> Option<(u8, u16)> {
    records.iter().find_map(|record| match record {
        Record::Template(t) => Some((t.selector, t.variation)),
        Record::Line(line) => first_template(&line.content),
        _ => None,
    })
}

#[test]
fn enclosure_sides_are_written_as_mathtype_draws_them() {
    // MathType 6.9 crashes on its box template with other sides than all, left and top, right and bottom
    // (probe-pc/bs-*): a lone top or bottom is a bar template, left and right sides a bar fence
    for (notation, expected) in [
        ("box", (37, 0x1E)),
        ("left top", (37, 0x0A)),
        ("right bottom", (37, 0x14)),
        ("top", (13, 0)),
        ("bottom", (12, 0)),
        ("left", (4, 0x01)),
        ("right", (4, 0x02)),
        ("left right", (4, 0x03)),
        ("top bottom", (37, 0x1E)),
        ("updiagonalstrike", (36, 0x02)),
    ] {
        let mathml =
            format!("<math><menclose notation=\"{notation}\"><mi>y</mi></menclose></math>");
        let written = convert::mathtype::write::from_mathml(&mathml, true).unwrap();
        assert_eq!(
            first_template(&written.records),
            Some(expected),
            "{notation}"
        );
    }
}

#[test]
fn old_integrals_never_get_an_upper_limit() {
    // MathType 6.9 crashes on its integral template with several signs or a loop and an upper limit, in every
    // template (probe-pc/ib-*): the template without limits, the limits as scripts after it
    for (mathml, expected) in [
        (
            "<msubsup><mo>&#x222D;</mo><mi>a</mi><mi>b</mi></msubsup>",
            [(15, 0x03), (29, 0)],
        ),
        (
            "<munderover><mo>&#x222D;</mo><mi>a</mi><mi>b</mi></munderover>",
            [(15, 0x03), (29, 0)],
        ),
        (
            "<msubsup><mo>&#x222F;</mo><mi>a</mi><mi>b</mi></msubsup>",
            [(15, 0x06), (29, 0)],
        ),
    ] {
        let written = convert::mathtype::write::from_mathml(
            &format!("<math>{mathml}<mi>f</mi></math>"),
            true,
        )
        .unwrap();
        let line = written.records.iter().find_map(|r| match r {
            Record::Line(line) => Some(line),
            _ => None,
        });
        let templates: Vec<(u8, u16)> = line
            .unwrap()
            .content
            .iter()
            .filter_map(|r| match r {
                Record::Template(t) => Some((t.selector, t.variation)),
                _ => None,
            })
            .collect();
        assert_eq!(templates, expected, "{mathml}");
    }
}
