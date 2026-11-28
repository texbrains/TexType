//! Probe equations from a multi-line equation: each line of its first pile as an equation of its own (the same
//! header and settings), written as <out dir>/<prefix>-row<n>.mtef for MathType to draw (kit render-safe.ps1).
//! For telling what a pile adds from what its lines draw (probe-pc/gi-row*: genuine/integrals).
//!   cargo run -p convert --example mtef_lines -- <file.mtef> <out dir> <prefix>

use convert::mathtype::mtef::{self, Record};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [file, out, prefix] = &args[..] else {
        panic!("usage: mtef_lines <file.mtef> <out dir> <prefix>")
    };
    let base = mtef::read(&std::fs::read(file).expect("readable file")).expect("MTEF");
    let at = base
        .records
        .iter()
        .position(|r| matches!(r, Record::Pile(_)))
        .expect("a pile");
    let Record::Pile(pile) = &base.records[at] else {
        unreachable!()
    };
    let lines = pile.content.iter().filter(|r| matches!(r, Record::Line(_)));
    for (i, line) in lines.enumerate() {
        let mut one = base.clone();
        one.records[at] = line.clone();
        let path = std::path::Path::new(out).join(format!("{prefix}-row{}.mtef", i + 1));
        std::fs::write(path, mtef::write(&one)).expect("written");
    }
}
