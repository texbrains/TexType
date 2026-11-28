//! Probe equations for scripts with an empty base: an empty line object before a script template (MathType's own
//! chemistry, `CH` then an empty line then the subscript 3: edited/mathtype7~oleObject27~after) and a script
//! template with nothing before it (genuine/mathtype5_frac_sub, writer/omml-0153), each beside a normal base for
//! comparison. A base probe's header with its body replaced. Written as <out dir>/eb-<case>.mtef for MathType to draw.
//!   cargo run -p convert --example mtef_script_probe -- <out dir> <base.mtef>

use convert::mathtype::mtef::{self, Char, Line, Record, Template, Typeface};

fn ch(c: char) -> Record {
    let sign = c == '+';
    Record::Char(Char {
        options: if sign { 0x04 } else { 0 },
        nudge: None,
        typeface: Typeface {
            value: match c {
                '+' => 6,
                '0'..='9' => 8,
                _ => 3,
            },
            wide: false,
        },
        mt_code: Some(c as u16),
        encoded8: sign.then_some(0x2B),
        encoded16: None,
        embellishments: Vec::new(),
    })
}

fn line(content: Vec<Record>, null: bool) -> Record {
    Record::Line(Line {
        options: u8::from(null),
        nudge: None,
        spacing: None,
        ruler: None,
        content,
    })
}

/// A script template: 27 sub, 28 sup, 29 both; its slots at the script size, the full size after it.
fn script(selector: u8, sub: Option<char>, sup: Option<char>) -> Vec<Record> {
    let slot = |c: Option<char>| match c {
        Some(c) => line(vec![ch(c)], false),
        None => line(Vec::new(), true),
    };
    vec![
        Record::Template(Template {
            options: 0,
            nudge: None,
            selector,
            variation: 0,
            variation_wide: false,
            template_options: 0,
            content: vec![Record::TypeSize(11), slot(sub), slot(sup)],
        }),
        Record::TypeSize(10),
    ]
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [out, base] = &args[..] else {
        panic!("usage: mtef_script_probe <out dir> <base.mtef>");
    };
    let base = mtef::read(&std::fs::read(base).expect("readable MTEF")).expect("MTEF");
    let body = base
        .records
        .iter()
        .position(|r| matches!(r, Record::Line(_)))
        .expect("a body");
    let empty = || line(Vec::new(), false);
    let sub = || script(27, Some('2'), None);
    let sup = || script(28, None, Some('2'));
    let both = || script(29, Some('2'), Some('3'));
    let cases: Vec<(&str, Vec<Record>)> = vec![
        ("x-sub-y", [vec![ch('x')], sub(), vec![ch('y')]].concat()),
        (
            "x-e-sub-y",
            [vec![ch('x'), empty()], sub(), vec![ch('y')]].concat(),
        ),
        (
            "x-e-sup-y",
            [vec![ch('x'), empty()], sup(), vec![ch('y')]].concat(),
        ),
        (
            "x-e-both-y",
            [vec![ch('x'), empty()], both(), vec![ch('y')]].concat(),
        ),
        ("e-sub-y", [vec![empty()], sub(), vec![ch('y')]].concat()),
        ("e-sup-y", [vec![empty()], sup(), vec![ch('y')]].concat()),
        ("sub-y", [sub(), vec![ch('y')]].concat()),
        ("sup-y", [sup(), vec![ch('y')]].concat()),
        ("both-y", [both(), vec![ch('y')]].concat()),
        ("x-sup-y", [vec![ch('x')], sup(), vec![ch('y')]].concat()),
        ("x-e-y", vec![ch('x'), empty(), ch('y')]),
        ("x-y-sub", [vec![ch('x'), ch('y')], sub()].concat()),
        (
            "x-e-sub-plus-y",
            [vec![ch('x'), empty()], sub(), vec![ch('+'), ch('y')]].concat(),
        ),
        (
            "x-sub-plus-y",
            [vec![ch('x')], sub(), vec![ch('+'), ch('y')]].concat(),
        ),
    ];
    let out = std::path::PathBuf::from(out);
    std::fs::create_dir_all(&out).expect("output folder");
    for (name, content) in &cases {
        let mut equation = base.clone();
        equation.records.truncate(body);
        equation.records.push(line(content.clone(), false));
        std::fs::write(out.join(format!("eb-{name}.mtef")), mtef::write(&equation)).unwrap();
    }
    println!("{} probes", cases.len());
}
