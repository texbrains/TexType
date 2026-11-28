//! Probe equations from other probes: the first template of one kind rewritten as another kind and variation, its
//! own fence-style characters recoded (a bracket fence as white brackets, a fraction as a small fraction ...).
//! Written as <out dir>/<name>-<label>.mtef for MathType to draw (kit render-all.ps1).
//!   cargo run -p convert --example mtef_retemplate -- <out dir> <label> <from selector> <to selector>
//!       <variation | keep> <code=code,... | -> <file.mtef>...
//! (codes in hex: 5b=301a,5d=301b recodes the template's [ and ] characters as 〚 and 〛)

use convert::mathtype::mtef::{self, Record};

struct Change {
    from: u8,
    to: u8,
    variation: Option<u16>,
    codes: Vec<(u16, u16)>,
}

fn rewrite(records: &mut [Record], change: &Change) -> bool {
    for record in records.iter_mut() {
        match record {
            Record::Template(t) if t.selector == change.from => {
                t.selector = change.to;
                if let Some(v) = change.variation {
                    t.variation = v;
                }
                for r in t.content.iter_mut() {
                    if let Record::Char(c) = r {
                        if c.typeface.value == 22 {
                            let code = c.mt_code.unwrap_or(0);
                            if let Some(&(_, to)) = change.codes.iter().find(|(f, _)| *f == code) {
                                c.mt_code = Some(to);
                            }
                        }
                    }
                }
                return true;
            }
            Record::Line(line) => {
                if rewrite(&mut line.content, change) {
                    return true;
                }
            }
            Record::Template(t) => {
                if rewrite(&mut t.content, change) {
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
    let [out, label, from, to, variation, codes, files @ ..] = &args[..] else {
        panic!("usage: mtef_retemplate <out dir> <label> <from> <to> <variation | keep> <codes | -> <file>...");
    };
    let hex = |s: &str| u16::from_str_radix(s, 16).expect("hex code");
    let change = Change {
        from: from.parse().expect("from selector"),
        to: to.parse().expect("to selector"),
        variation: (variation != "keep").then(|| variation.parse().expect("variation")),
        codes: if codes == "-" {
            Vec::new()
        } else {
            codes
                .split(',')
                .map(|pair| {
                    let (a, b) = pair.split_once('=').expect("code=code");
                    (hex(a), hex(b))
                })
                .collect()
        },
    };
    let out = std::path::PathBuf::from(out);
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    for path in files {
        let path = std::path::PathBuf::from(path);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let mut equation = mtef::read(&std::fs::read(&path).expect("readable MTEF")).expect("MTEF");
        if rewrite(&mut equation.records, &change) {
            std::fs::write(
                out.join(format!("{name}-{label}.mtef")),
                mtef::write(&equation),
            )
            .unwrap();
            count += 1;
        } else {
            eprintln!("{name}: no template {}", change.from);
        }
    }
    println!("{count} probes");
}
