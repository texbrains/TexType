//! Probe equations for embellishments: a base probe's header with its body replaced by one embellished character
//! followed by `+x` (for the spacing after it) and `x` before it (for the spacing before it), for every embellishment
//! kind 2-37 on several bases (italic x, f, y, A, upright 1). Written as <out dir>/emb-<base>-<kind>.mtef for
//! MathType to draw (in the clean Windows Sandbox: most embellishments are MT Extra glyphs).
//!   cargo run -p convert --example mtef_emb_probe -- <out dir> <base.mtef>
//! With FOLLOW=<characters> (and KINDS=<kinds>, default 5) each base with each kind is followed by each of those
//! characters alone instead: emb-<base>-<kind>-<follower>.mtef (what follows a prime).

use convert::mathtype::mtef::{self, Char, Embellishment, Line, Record, Typeface};

fn char_record(c: char, embellishment: Option<u8>) -> Record {
    let (typeface, encoded8) = match c {
        '0'..='9' => (8, None),
        '+' => (6, Some(0x2B)),
        _ => (3, None),
    };
    let embellishments = embellishment
        .map(|kind| {
            vec![Record::Embellishment(Embellishment {
                options: 0,
                nudge: None,
                kind,
            })]
        })
        .unwrap_or_default();
    Record::Char(Char {
        options: if encoded8.is_some() { 0x04 } else { 0 }
            | if embellishments.is_empty() { 0 } else { 0x01 },
        nudge: None,
        typeface: Typeface {
            value: typeface,
            wide: false,
        },
        mt_code: Some(c as u16),
        encoded8,
        encoded16: None,
        embellishments,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [out, base] = &args[..] else {
        panic!("usage: mtef_emb_probe <out dir> <base.mtef>");
    };
    let base = mtef::read(&std::fs::read(base).expect("readable MTEF")).expect("MTEF");
    let body = base
        .records
        .iter()
        .position(|r| matches!(r, Record::Line(_) | Record::Pile(_) | Record::Matrix(_)))
        .expect("a body");
    let out = std::path::PathBuf::from(out);
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    let line = |content| {
        Record::Line(Line {
            options: 0,
            nudge: None,
            spacing: None,
            ruler: None,
            content,
        })
    };
    if let Ok(follow) = std::env::var("FOLLOW") {
        let kinds = std::env::var("KINDS").unwrap_or_else(|_| "5".into());
        for (name, letter) in [
            ("x", 'x'),
            ("f", 'f'),
            ("a", 'a'),
            ("capA", 'A'),
            ("one", '1'),
        ] {
            for kind in kinds.split(',').map(|k| k.parse::<u8>().expect("kind")) {
                for next in follow.chars() {
                    let mut equation = base.clone();
                    equation.records.truncate(body);
                    equation.records.push(line(vec![
                        char_record(letter, Some(kind)),
                        char_record(next, None),
                    ]));
                    let file = format!("emb-{name}-{kind:02}-{next}.mtef");
                    std::fs::write(out.join(file), mtef::write(&equation)).unwrap();
                    count += 1;
                }
            }
        }
        println!("{count} probes");
        return;
    }
    for (name, letter) in [("x", 'x'), ("f", 'f'), ("y", 'y'), ("A", 'A'), ("one", '1')] {
        for kind in 2u8..=37 {
            let mut equation = base.clone();
            equation.records.truncate(body);
            equation.records.push(line(vec![
                char_record('x', None),
                char_record(letter, Some(kind)),
                char_record('+', None),
                char_record('x', None),
            ]));
            std::fs::write(
                out.join(format!("emb-{name}-{kind:02}.mtef")),
                mtef::write(&equation),
            )
            .unwrap();
            count += 1;
        }
    }
    println!("{count} probes");
}
