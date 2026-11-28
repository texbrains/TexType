//! How a set of MathType equations is encoded: template selectors and variations, character typefaces by kind of
//! character, embellishments, and the records before the root. For designing `convert::mathtype` against MathType's
//! own output.
//!   cargo run -p convert --example mtef_survey -- testing/corpus/mathtype/import.jsonl [source-prefix]

use convert::mathtype::mtef::{self, Record};
use std::collections::BTreeMap;

#[derive(Default)]
struct Survey {
    templates: BTreeMap<(u8, u16), (usize, Vec<String>)>,
    typefaces: BTreeMap<(String, i32), (usize, Vec<String>)>,
    embellishments: BTreeMap<u8, (usize, Vec<String>)>,
    prefixes: BTreeMap<String, usize>,
    records: BTreeMap<String, usize>,
}

fn note<K: Ord>(map: &mut BTreeMap<K, (usize, Vec<String>)>, key: K, example: &str) {
    let entry = map.entry(key).or_default();
    entry.0 += 1;
    if entry.1.len() < 3 && !entry.1.iter().any(|e| e == example) {
        entry.1.push(example.to_string());
    }
}

fn kind_of(code: u16) -> String {
    match char::from_u32(code as u32) {
        Some(c) if c.is_ascii_digit() => "digit".into(),
        Some(c) if c.is_ascii_alphabetic() => "latin letter".into(),
        Some('\u{391}'..='\u{3A9}') => "upper greek".into(),
        Some('\u{3B1}'..='\u{3F5}') => "lower greek".into(),
        Some(c) if c.is_ascii() => format!("ascii {c:?}"),
        Some(c) => format!("U+{:04X} {c}", c as u32),
        None => format!("{code:#06x}"),
    }
}

fn walk(records: &[Record], survey: &mut Survey, example: &str) {
    for record in records {
        let name = format!("{record:?}")
            .split(['(', ' ', '{'])
            .next()
            .unwrap_or("")
            .to_string();
        *survey.records.entry(name).or_default() += 1;
        match record {
            Record::Line(l) => walk(&l.content, survey, example),
            Record::Char(c) => {
                let mut kind = c.mt_code.map(kind_of).unwrap_or_else(|| "no mtcode".into());
                // characters stored by font position only: which position
                if let Some(position) = c.encoded8 {
                    kind = format!("{kind} @{position:#04x}");
                }
                if c.mt_code == Some(0xFFFD) {
                    kind = format!(
                        "FFFD at {}",
                        c.encoded8
                            .map(|p| format!("{p:#04x}"))
                            .unwrap_or("-".into())
                    );
                }
                note(&mut survey.typefaces, (kind, c.typeface.value), example);
                for e in &c.embellishments {
                    if let Record::Embellishment(e) = e {
                        note(&mut survey.embellishments, e.kind, example);
                    }
                }
            }
            Record::Template(t) => {
                note(&mut survey.templates, (t.selector, t.variation), example);
                walk(&t.content, survey, example);
            }
            Record::Pile(p) => walk(&p.content, survey, example),
            Record::Matrix(m) => walk(&m.content, survey, example),
            _ => {}
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: mtef_survey <corpus.jsonl> [source-prefix]");
    let prefix = args.next().unwrap_or_default();
    let mut survey = Survey::default();
    let mut count = 0;
    for line in std::fs::read_to_string(&path)
        .expect("corpus file")
        .lines()
        .filter(|l| !l.trim().is_empty())
    {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let source = row["source"].as_str().unwrap_or("");
        let Some(native) = row["native"].as_str() else {
            continue;
        };
        if !source.starts_with(&prefix) {
            continue;
        }
        let Ok(model) = mtef::from_equation_native(&base64(native)) else {
            println!("unreadable: {source}");
            continue;
        };
        count += 1;
        let example = row["latex"]
            .as_str()
            .unwrap_or(source)
            .chars()
            .take(40)
            .collect::<String>();
        // the records before the root object, as a fingerprint of the prefix
        let root = model
            .records
            .iter()
            .position(|r| matches!(r, Record::Line(_) | Record::Pile(_) | Record::Matrix(_)));
        let head = &model.records[..root.unwrap_or(model.records.len())];
        let fingerprint = format!(
            "key {} options {:#04x} {:?}",
            String::from_utf8_lossy(&model.application_key),
            model.equation_options,
            head
        );
        *survey.prefixes.entry(fingerprint).or_default() += 1;
        walk(&model.records[root.unwrap_or(0)..], &mut survey, &example);
    }
    println!(
        "{count} equations\n\nprefix variants: {}",
        survey.prefixes.len()
    );
    for (fingerprint, n) in &survey.prefixes {
        println!(
            "  {n:4}  {}",
            fingerprint.chars().take(160).collect::<String>()
        );
    }
    println!("\nrecords:");
    for (name, n) in &survey.records {
        println!("  {n:6}  {name}");
    }
    println!("\ntemplates (selector, variation):");
    for ((selector, variation), (n, examples)) in &survey.templates {
        println!(
            "  {selector:3} {variation:#06x}  {n:4}  {}",
            examples.join("  |  ")
        );
    }
    println!("\nembellishments:");
    for (kind, (n, examples)) in &survey.embellishments {
        println!("  {kind:3}  {n:4}  {}", examples.join("  |  "));
    }
    println!("\ncharacters (kind, typeface):");
    for ((kind, typeface), (n, examples)) in &survey.typefaces {
        println!(
            "  {kind:<20} {typeface:4}  {n:5}  {}",
            examples.join("  |  ")
        );
    }
}

fn base64(text: &str) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => panic!("not base64"),
    };
    let digits: Vec<u8> = text.bytes().filter(|&c| c != b'=').map(value).collect();
    digits
        .chunks(4)
        .flat_map(|chunk| {
            let bits = chunk
                .iter()
                .enumerate()
                .fold(0u32, |acc, (i, &d)| acc | (d as u32) << (18 - 6 * i));
            [(bits >> 16) as u8, (bits >> 8) as u8, bits as u8]
                .into_iter()
                .take(chunk.len() - 1)
        })
        .collect()
}
