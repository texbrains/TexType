//! Probe equations for the arrow-with-text template (14): each given probe's first template with a content line
//! rewritten as arrows of several kinds (variation: 1 double, 2 harpoon, 4 label above, 8 label below, 16 left,
//! 32 right) with that content as the label(s), the arrow as a fence-style character the way MathType's own
//! equations hold it. Written as <out dir>/<name>-arrow-<kind>.mtef for MathType to draw (kit render-all.ps1).
//!   cargo run -p convert --example mtef_arrow_probe -- <out dir> <probe.mtef>...

use convert::mathtype::mtef::{self, Char, Line, Record, Typeface};

/// (label, variation, arrow character)
const KINDS: [(&str, u16, u16); 10] = [
    ("right-top", 0x24, 0x2192),
    ("left-top", 0x14, 0x2190),
    ("both-top", 0x34, 0x2194),
    ("right-bottom", 0x28, 0x2192),
    ("right-both", 0x2C, 0x2192),
    ("double-right-top", 0x25, 0x21D2),
    ("double-left-top", 0x15, 0x21D0),
    ("double-both-top", 0x35, 0x21D4),
    ("harpoons-top", 0x36, 0x21CC),
    ("left-bottom", 0x18, 0x2190),
];

fn content_line(records: &[Record]) -> Option<Line> {
    for record in records {
        match record {
            Record::Template(t) => {
                if let Some(Record::Line(l)) = t
                    .content
                    .iter()
                    .find(|r| matches!(r, Record::Line(l) if l.options & 1 == 0))
                {
                    return Some(l.clone());
                }
            }
            Record::Line(l) => {
                if let Some(found) = content_line(&l.content) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

fn rewrite(records: &mut [Record], variation: u16, arrow: u16, label: &Line) -> bool {
    for record in records.iter_mut() {
        match record {
            Record::Template(t) => {
                let null = Line {
                    options: 0x01,
                    nudge: None,
                    spacing: None,
                    ruler: None,
                    content: Vec::new(),
                };
                let slot = |present: bool| {
                    Record::Line(if present { label.clone() } else { null.clone() })
                };
                t.selector = 14;
                t.variation = variation;
                t.content = vec![
                    Record::TypeSize(11),
                    slot(variation & 4 != 0),
                    slot(variation & 8 != 0),
                    Record::TypeSize(10),
                    Record::Char(Char {
                        options: 0,
                        nudge: None,
                        typeface: Typeface {
                            value: 22,
                            wide: false,
                        },
                        mt_code: Some(arrow),
                        encoded8: None,
                        encoded16: None,
                        embellishments: Vec::new(),
                    }),
                ];
                return true;
            }
            Record::Line(line) => {
                if rewrite(&mut line.content, variation, arrow, label) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(
        args.next()
            .expect("usage: mtef_arrow_probe <out dir> <probe.mtef>..."),
    );
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    for path in args {
        let path = std::path::PathBuf::from(path);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let data = std::fs::read(&path).expect("readable MTEF");
        let Some(label) = content_line(&mtef::read(&data).expect("MTEF").records) else {
            eprintln!("{name}: no template with content");
            continue;
        };
        for (kind, variation, arrow) in KINDS {
            let mut equation = mtef::read(&data).expect("MTEF");
            if rewrite(&mut equation.records, variation, arrow, &label) {
                let file = out.join(format!("{name}-arrow-{kind}.mtef"));
                std::fs::write(file, mtef::write(&equation)).unwrap();
                count += 1;
            }
        }
    }
    println!("{count} probes");
}
