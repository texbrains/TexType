//! Probe equations with characters the MathML writer does not write: every CHAR of one MTCode recoded as another
//! character (its typeface, MTCode and font byte), e.g. a stand-in letter as MathType's placeholder (MT Extra 0x6E,
//! U+FFFD) for drawing how MathType spaces it.
//!   cargo run -p convert --example mtef_recode -- <in.mtef> <out.mtef> <from hex> <typeface> <to hex> <byte hex>
//! A byte of - writes the character without a font position (as MathType writes its spaces); a typeface of del
//! removes the character (its line stays, empty).

use convert::mathtype::mtef::{self, Record};

fn recode(records: &mut Vec<Record>, from: u16, to: Option<&mtef::Char>) {
    let Some(to) = to else {
        records.retain(|r| !matches!(r, Record::Char(c) if c.mt_code == Some(from)));
        for record in records.iter_mut() {
            descend(record, from, None);
        }
        return;
    };
    for record in records.iter_mut() {
        match record {
            Record::Char(c) if c.mt_code == Some(from) => {
                c.typeface = to.typeface;
                c.mt_code = to.mt_code;
                c.encoded8 = to.encoded8;
                c.encoded16 = None;
                let position = if to.encoded8.is_some() { 0x04 } else { 0 };
                c.options = (c.options & !0x34) | position;
            }
            other => descend(other, from, Some(to)),
        }
    }
}

fn descend(record: &mut Record, from: u16, to: Option<&mtef::Char>) {
    match record {
        Record::Line(line) => recode(&mut line.content, from, to),
        Record::Template(t) => recode(&mut t.content, from, to),
        Record::Pile(p) => recode(&mut p.content, from, to),
        Record::Matrix(m) => recode(&mut m.content, from, to),
        _ => {}
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output, from, typeface, to, byte] = &args[..] else {
        panic!("usage: mtef_recode <in.mtef> <out.mtef> <from hex> <typeface> <to hex> <byte hex>");
    };
    let hex = |s: &str| u16::from_str_radix(s, 16).expect("hex");
    let mut model = mtef::read(&std::fs::read(input).expect("readable MTEF")).expect("MTEF");
    let to = (typeface != "del").then(|| mtef::Char {
        options: 0x04,
        nudge: None,
        typeface: mtef::Typeface {
            value: typeface.parse().expect("typeface"),
            wide: false,
        },
        mt_code: Some(hex(to)),
        encoded8: (byte != "-").then(|| hex(byte) as u8),
        encoded16: None,
        embellishments: Vec::new(),
    });
    recode(&mut model.records, hex(from), to.as_ref());
    std::fs::write(output, mtef::write(&model)).expect("written");
}
