//! Probe equations for pile alignments: a base probe's header (definitions, preferences) with its body replaced by
//! piles of given lines, aligned at the relation (halign 4) and at the decimal point (5), and also left (1) for
//! comparison. Letters are variables, digits and the period numbers, = < + - Symbol characters, so only Times New
//! Roman and Symbol are drawn. Written as <out dir>/pile-<n>-<align>.mtef for MathType to draw.
//!   cargo run -p convert --example mtef_pile_probe -- <out dir> <base.mtef>

use convert::mathtype::mtef::{self, Char, Line, Pile, Record, Typeface};

const SETS: [&[&str]; 10] = [
    &["a=b", "abc=d"],
    &["x+y=z", "w=uv+t"],
    &["a=b", "c"],
    &["a<b", "cd=e"],
    &["a=b", "c=d", "efg=h"],
    &["1.5", "23.75"],
    &["123", "4.5"],
    &["0.5", "10"],
    &["2.25=x", "1.5"],
    &["a", "bc"],
];

fn char_record(c: char) -> Record {
    let (typeface, encoded8) = match c {
        'a'..='z' => (3, None),
        '0'..='9' | '.' => (8, None),
        '=' | '<' | '+' => (6, Some(c as u8)),
        '-' => (6, Some(0x2D)),
        _ => (1, None),
    };
    let mt_code = if c == '-' { 0x2212 } else { c as u16 };
    Record::Char(Char {
        options: if encoded8.is_some() { 0x04 } else { 0 },
        nudge: None,
        typeface: Typeface {
            value: typeface,
            wide: false,
        },
        mt_code: Some(mt_code),
        encoded8,
        encoded16: None,
        embellishments: Vec::new(),
    })
}

fn line(text: &str) -> Record {
    Record::Line(Line {
        options: 0,
        nudge: None,
        spacing: None,
        ruler: None,
        content: text.chars().map(char_record).collect(),
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [out, base] = &args[..] else {
        panic!("usage: mtef_pile_probe <out dir> <base.mtef>");
    };
    let base = mtef::read(&std::fs::read(base).expect("readable MTEF")).expect("MTEF");
    let body = base
        .records
        .iter()
        .position(|r| matches!(r, Record::Line(_) | Record::Pile(_) | Record::Matrix(_)))
        .expect("a body");
    let out = std::path::PathBuf::from(out);
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    for (n, lines) in SETS.iter().enumerate() {
        for (label, align) in [("left", 1u8), ("rel", 4), ("dec", 5)] {
            let mut equation = base.clone();
            equation.records.truncate(body);
            equation.records.push(Record::Pile(Pile {
                options: 0,
                nudge: None,
                horizontal: align,
                vertical: 1,
                ruler: None,
                content: lines.iter().map(|l| line(l)).collect(),
            }));
            std::fs::write(
                out.join(format!("pile-{n}-{label}.mtef")),
                mtef::write(&equation),
            )
            .unwrap();
            count += 1;
        }
    }
    println!("{count} probes");
}
