//! Probe equations for finding a template's own fence-style character: a base probe's first template of one kind
//! rewritten as another kind and variation, its fence-style characters replaced by one candidate character, once for
//! each candidate. MathType draws them; the candidate it draws the template with is the one its records hold.
//! Written as <out dir>/<name>-<label>-<code>.mtef.
//!   cargo run -p convert --example mtef_template_chars -- <out dir> <label> <from> <to> <variation> <codes> <base.mtef>
//! (codes in hex, comma separated; a range as from-to: ec00-ec1f,27cc)

use convert::mathtype::mtef::{self, Char, Record, Typeface};

fn rewrite(records: &mut [Record], from: u8, to: u8, variation: u16, code: u16) -> bool {
    for record in records.iter_mut() {
        match record {
            Record::Template(t) if t.selector == from => {
                t.selector = to;
                t.variation = variation;
                t.content
                    .retain(|r| !matches!(r, Record::Char(c) if c.typeface.value == 22));
                t.content.push(Record::Char(Char {
                    options: 0,
                    nudge: None,
                    typeface: Typeface {
                        value: 22,
                        wide: false,
                    },
                    mt_code: Some(code),
                    encoded8: None,
                    encoded16: None,
                    embellishments: Vec::new(),
                }));
                return true;
            }
            Record::Line(line) => {
                if rewrite(&mut line.content, from, to, variation, code) {
                    return true;
                }
            }
            Record::Template(t) => {
                if rewrite(&mut t.content, from, to, variation, code) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [out, label, from, to, variation, codes, base] = &args[..] else {
        panic!("usage: mtef_template_chars <out dir> <label> <from> <to> <variation> <codes> <base.mtef>");
    };
    let hex = |s: &str| u16::from_str_radix(s, 16).expect("hex code");
    let mut list = Vec::new();
    for part in codes.split(',') {
        match part.split_once('-') {
            Some((a, b)) => list.extend(hex(a)..=hex(b)),
            None => list.push(hex(part)),
        }
    }
    let (from, to, variation): (u8, u8, u16) = (
        from.parse().expect("from"),
        to.parse().expect("to"),
        variation.parse().expect("variation"),
    );
    let path = std::path::PathBuf::from(base);
    let name = path.file_stem().unwrap().to_string_lossy().into_owned();
    let data = std::fs::read(&path).expect("readable MTEF");
    let out = std::path::PathBuf::from(out);
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    for code in list {
        let mut equation = mtef::read(&data).expect("MTEF");
        if rewrite(&mut equation.records, from, to, variation, code) {
            let file = out.join(format!("{name}-{label}-{code:04x}.mtef"));
            std::fs::write(file, mtef::write(&equation)).unwrap();
            count += 1;
        }
    }
    println!("{count} probes");
}
