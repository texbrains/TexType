//! An equation's body (from its first line or pile on) under another equation's header (product, version, options
//! and the definitions before the body), for finding which part MathType reacts to.
//!   cargo run -p convert --example mtef_transplant -- <body.mtef> <header.mtef> <out.mtef>

use convert::mathtype::mtef::{self, Record};

fn body_start(records: &[Record]) -> usize {
    records
        .iter()
        .position(|record| {
            matches!(
                record,
                Record::Line(_) | Record::Pile(_) | Record::Matrix(_)
            )
        })
        .unwrap_or(records.len())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [body, header, out] = &args[..] else {
        panic!("usage: mtef_transplant <body.mtef> <header.mtef> <out.mtef>")
    };
    let body = mtef::read(&std::fs::read(body).expect("body")).expect("body reads");
    let mut header = mtef::read(&std::fs::read(header).expect("header")).expect("header reads");
    let keep = body_start(&header.records);
    header.records.truncate(keep);
    // the size before the body belongs to the body
    if let Some(Record::TypeSize(_)) = header.records.last() {
        header.records.pop();
    }
    let mut start = body_start(&body.records);
    if start > 0 && matches!(body.records[start - 1], Record::TypeSize(_)) {
        start -= 1;
    }
    header.records.extend(body.records[start..].iter().cloned());
    std::fs::write(out, mtef::write(&header)).expect("written");
}
