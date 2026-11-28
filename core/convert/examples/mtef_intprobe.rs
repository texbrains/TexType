//! Probe equations for MathType's integral template with both limits (which crashes MathType 6.9 with an empty
//! integrand slot): from an equation whose first template is an integral template (15), written as
//!   <out>-inside.mtef: the character after the template moved into its integrand slot;
//!   <out>-op.mtef: the template as an integral-style operator (21) with its sign characters in a line.
//!   cargo run -p convert --example mtef_intprobe -- <in.mtef> <out prefix>

use convert::mathtype::mtef::{self, Line, Record};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, out] = &args[..] else {
        panic!("usage: mtef_intprobe <in.mtef> <out prefix>");
    };
    let model = mtef::read(&std::fs::read(input).expect("readable MTEF")).expect("MTEF");
    let line_at = model
        .records
        .iter()
        .position(|r| matches!(r, Record::Line(_)))
        .expect("a line");
    // the integrand moved into the first slot
    let mut inside = model.clone();
    if let Record::Line(line) = &mut inside.records[line_at] {
        let at = line
            .content
            .iter()
            .position(|r| matches!(r, Record::Template(t) if t.selector == 15))
            .expect("an integral template");
        let next = line.content.remove(at + 1);
        if let Record::Template(t) = &mut line.content[at] {
            if let Some(Record::Line(slot)) =
                t.content.iter_mut().find(|r| matches!(r, Record::Line(_)))
            {
                slot.options &= !0x01;
                slot.content.push(next);
            }
        }
    }
    std::fs::write(format!("{out}-inside.mtef"), mtef::write(&inside)).expect("written");
    // the operator form: the sign characters in a line of their own
    let mut op = model.clone();
    if let Record::Line(line) = &mut op.records[line_at] {
        for record in &mut line.content {
            if let Record::Template(t) = record {
                if t.selector == 15 {
                    t.selector = 21;
                    t.variation &= !0x0F;
                    let signs: Vec<Record> = t
                        .content
                        .iter()
                        .filter(|r| matches!(r, Record::Char(_)))
                        .cloned()
                        .collect();
                    t.content.retain(|r| !matches!(r, Record::Char(_)));
                    t.content.push(Record::Line(Line {
                        options: 0,
                        nudge: None,
                        spacing: None,
                        ruler: None,
                        content: signs,
                    }));
                    break;
                }
            }
        }
    }
    std::fs::write(format!("{out}-op.mtef"), mtef::write(&op)).expect("written");
    // the sum-style operator (22) holding the signs, its limits under and over
    let mut sum = op.clone();
    if let Record::Line(line) = &mut sum.records[line_at] {
        for record in &mut line.content {
            if let Record::Template(t) = record {
                if t.selector == 21 {
                    t.selector = 22;
                    t.variation &= 0x30;
                    break;
                }
            }
        }
    }
    std::fs::write(format!("{out}-sum.mtef"), mtef::write(&sum)).expect("written");
}
