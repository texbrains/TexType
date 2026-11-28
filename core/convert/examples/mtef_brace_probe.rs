//! Variants of a brace equation for finding how MathType wants a wide brace: the horizontal brace template (24)
//! rewritten as the limit template (23) with the brace character in its upper or lower slot.
//!   cargo run -p convert --example mtef_brace_probe -- <brace.mtef> <out.mtef>

use convert::mathtype::mtef::{self, Line, Record, Template};

fn rewrite(records: &mut [Record]) {
    for record in records.iter_mut() {
        match record {
            Record::Line(line) => rewrite(&mut line.content),
            Record::Template(template) if template.selector == 24 => {
                let top = template.variation & 0x01 != 0;
                let mut lines = Vec::new();
                let mut brace = None;
                for item in template.content.drain(..) {
                    match item {
                        Record::Line(_) => lines.push(item),
                        Record::Char(_) => brace = Some(item),
                        _ => {}
                    }
                }
                let empty = || {
                    Record::Line(Line {
                        options: 1,
                        nudge: None,
                        spacing: None,
                        ruler: None,
                        content: Vec::new(),
                    })
                };
                let main = lines.first().cloned().unwrap_or_else(empty);
                let brace_line = Record::Line(Line {
                    options: 0,
                    nudge: None,
                    spacing: None,
                    ruler: None,
                    content: brace.into_iter().collect(),
                });
                let (lower, upper) = if top {
                    (empty(), brace_line)
                } else {
                    (brace_line, empty())
                };
                *template = Template {
                    selector: 23,
                    variation: if top { 0x20 } else { 0x10 },
                    variation_wide: false,
                    content: vec![
                        main,
                        Record::TypeSize(11),
                        lower,
                        upper,
                        Record::TypeSize(10),
                    ],
                    ..template.clone()
                };
            }
            Record::Template(template) => rewrite(&mut template.content),
            _ => {}
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [source, out] = &args[..] else {
        panic!("usage: mtef_brace_probe <brace.mtef> <out.mtef>")
    };
    let mut model = mtef::read(&std::fs::read(source).expect("source")).expect("reads");
    rewrite(&mut model.records);
    std::fs::write(out, mtef::write(&model)).expect("written");
}
