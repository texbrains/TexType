//! Probe equations for piles: the bodies of several one-line equations as the lines of one pile (the first file's
//! header and settings), written as <out>.mtef for MathType to draw (kit render-safe.ps1).
//!   cargo run -p convert --example mtef_pile -- <out.mtef> <file.mtef>...

use convert::mathtype::mtef::{self, Pile, Record};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [out, files @ ..] = &args[..] else {
        panic!("usage: mtef_pile <out.mtef> <file.mtef>...")
    };
    let read =
        |path: &String| mtef::read(&std::fs::read(path).expect("readable file")).expect("MTEF");
    let mut base = read(&files[0]);
    let at = base
        .records
        .iter()
        .position(|r| matches!(r, Record::Line(_)))
        .expect("a line");
    let lines = files
        .iter()
        .map(|path| {
            read(path)
                .records
                .into_iter()
                .find(|r| matches!(r, Record::Line(_)))
                .expect("a line")
        })
        .collect();
    base.records[at] = Record::Pile(Pile {
        options: 0,
        nudge: None,
        horizontal: 1,
        vertical: 1,
        ruler: None,
        content: lines,
    });
    std::fs::write(out, mtef::write(&base)).expect("written");
}
