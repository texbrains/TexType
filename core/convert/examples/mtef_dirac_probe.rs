//! Probe equations for the bra-ket template (30): each angle-fence probe's fence rewritten as a bra (variation 1:
//! ⟨content|), a ket (2: |content⟩) and a bra-ket (3: ⟨content|content⟩), with the fence-style characters
//! MathType's own equations hold (⟨ U+2329, the bar U+EC07, ⟩ U+232A). Written as <out dir>/<name>-dirac-<kind>.mtef
//! for MathType to draw (kit render-all.ps1).
//!   cargo run -p convert --example mtef_dirac_probe -- <out dir> <angle-fence.mtef>...

use convert::mathtype::mtef::{self, Line, Record};

/// Rewrites the first angle fence (template 0) into a bra-ket template of the variation.
fn rewrite(records: &mut [Record], variation: u16) -> bool {
    for record in records.iter_mut() {
        match record {
            Record::Template(t) if t.selector == 0 => {
                let content = t.content.iter().find_map(|r| match r {
                    Record::Line(l) => Some(l.clone()),
                    _ => None,
                });
                let fence = t.content.iter().find_map(|r| match r {
                    Record::Char(c) if c.typeface.value == 22 => Some(c.clone()),
                    _ => None,
                });
                // the size records after the slot (MathType restores the size before the template's characters)
                let sizes: Vec<Record> = t
                    .content
                    .iter()
                    .filter(|r| matches!(r, Record::TypeSize(_) | Record::Size(_)))
                    .cloned()
                    .collect();
                let (Some(content), Some(fence)) = (content, fence) else {
                    return false;
                };
                let null = Line {
                    options: 0x01,
                    nudge: None,
                    spacing: None,
                    ruler: None,
                    content: Vec::new(),
                };
                let char_of = |code: u16| {
                    let mut c = fence.clone();
                    c.mt_code = Some(code);
                    Record::Char(c)
                };
                let (bra, ket) = (variation & 1 != 0, variation & 2 != 0);
                let mut slots = vec![
                    Record::Line(if bra { content.clone() } else { null.clone() }),
                    Record::Line(if ket { content.clone() } else { null }),
                ];
                slots.extend(sizes);
                if bra {
                    slots.push(char_of(0x2329));
                }
                slots.push(char_of(0xEC07));
                if ket {
                    slots.push(char_of(0x232A));
                }
                t.selector = 30;
                t.variation = variation;
                t.content = slots;
                return true;
            }
            Record::Line(line) => {
                if rewrite(&mut line.content, variation) {
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
            .expect("usage: mtef_dirac_probe <out dir> <angle-fence.mtef>..."),
    );
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    for path in args {
        let path = std::path::PathBuf::from(path);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let data = std::fs::read(&path).expect("readable MTEF");
        for (kind, variation) in [("bra", 1), ("ket", 2), ("braket", 3)] {
            let mut equation = mtef::read(&data).expect("MTEF");
            if !rewrite(&mut equation.records, variation) {
                eprintln!("{name}: no angle fence");
                break;
            }
            let file = out.join(format!("{name}-dirac-{kind}.mtef"));
            std::fs::write(file, mtef::write(&equation)).unwrap();
            count += 1;
        }
    }
    println!("{count} probes");
}
