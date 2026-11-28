//! MathType equation data as a readable record tree, for working on `convert::mathtype`.
//!   cargo run -p convert --example mtef_dump -- <hex | base64 Equation Native | file.mtef>

use convert::mathtype::mtef::{self, Record};

fn main() {
    let argument = std::env::args()
        .nth(1)
        .expect("usage: mtef_dump <hex | base64 Equation Native | file>");
    let data = if std::path::Path::new(&argument).exists() {
        std::fs::read(&argument).expect("readable file")
    } else if argument.len() % 2 == 0 && argument.bytes().all(|b| b.is_ascii_hexdigit()) {
        (0..argument.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&argument[i..i + 2], 16).unwrap())
            .collect()
    } else {
        base64(&argument)
    };
    let model = if data.first() == Some(&5) {
        mtef::read(&data)
    } else {
        mtef::from_equation_native(&data)
    };
    match model {
        Ok(m) => {
            println!(
                "MTEF 5 platform {} product {} {}.{} key {} options {:#04x}",
                m.platform,
                m.product,
                m.product_version,
                m.product_subversion,
                String::from_utf8_lossy(&m.application_key),
                m.equation_options
            );
            for record in &m.records {
                print(record, 1);
            }
        }
        Err(error) => println!("unreadable: {error}"),
    }
}

fn print(record: &Record, depth: usize) {
    let pad = "  ".repeat(depth);
    match record {
        Record::Line(line) => {
            println!(
                "{pad}LINE options {:#04x}{}",
                line.options,
                if line.content.is_empty() {
                    " (empty)"
                } else {
                    ""
                }
            );
            line.content.iter().for_each(|r| print(r, depth + 1));
        }
        Record::Char(c) => {
            let text = c
                .mt_code
                .and_then(|code| char::from_u32(code as u32))
                .map(String::from)
                .unwrap_or_default();
            println!(
                "{pad}CHAR typeface {} mtcode {} {:?} encoded8 {} options {:#04x}",
                c.typeface.value,
                c.mt_code.map(|v| format!("{v:#06x}")).unwrap_or("-".into()),
                text,
                c.encoded8
                    .map(|v| format!("{v:#04x}"))
                    .unwrap_or("-".into()),
                c.options
            );
            c.embellishments.iter().for_each(|r| print(r, depth + 1));
        }
        Record::Template(t) => {
            println!(
                "{pad}TMPL selector {} variation {:#06x} options {:#04x}",
                t.selector, t.variation, t.template_options
            );
            t.content.iter().for_each(|r| print(r, depth + 1));
        }
        Record::Pile(p) => {
            println!(
                "{pad}PILE halign {} valign {} ruler {:?}",
                p.horizontal, p.vertical, p.ruler
            );
            p.content.iter().for_each(|r| print(r, depth + 1));
        }
        Record::Matrix(m) => {
            println!(
                "{pad}MATRIX {}x{} hjust {} vjust {} row partitions {:02x?} column partitions {:02x?}",
                m.rows, m.columns, m.horizontal_justification, m.vertical_justification, m.row_partitions, m.column_partitions
            );
            m.content.iter().for_each(|r| print(r, depth + 1));
        }
        Record::Embellishment(e) => println!("{pad}EMBELL {}", e.kind),
        Record::FontDef { encoding, name } => {
            println!(
                "{pad}FONT_DEF encoding {} {:?}",
                encoding.value,
                String::from_utf8_lossy(name)
            )
        }
        Record::EncodingDef(name) => {
            println!("{pad}ENCODING_DEF {:?}", String::from_utf8_lossy(name))
        }
        other => println!("{pad}{other:?}"),
    }
}

fn base64(text: &str) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => panic!("not base64"),
    };
    let digits: Vec<u8> = text.bytes().filter(|&c| c != b'=').map(value).collect();
    digits
        .chunks(4)
        .flat_map(|chunk| {
            let bits = chunk
                .iter()
                .enumerate()
                .fold(0u32, |acc, (i, &d)| acc | (d as u32) << (18 - 6 * i));
            [(bits >> 16) as u8, (bits >> 8) as u8, bits as u8]
                .into_iter()
                .take(chunk.len() - 1)
        })
        .collect()
}
