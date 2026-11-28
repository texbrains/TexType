//! Edits every MathType equation of the corpus (read.jsonl and import.jsonl rows with an Equation Native, not the old
//! codec's) as the tests do: a letter added after the formula, one added before it, and the first one-letter
//! variable changed. Writes <dir>/<source>~<edit>.mtef and its Equation Native stream <dir>/<source>~<edit>.native
//! (`/` in a source becomes `~`) for checking edited equations with MathType itself.
//!   cargo run -p convert --example mtef_edit -- <dir>

use convert::mathtype::{mtef, read, write};

fn main() {
    let dir = std::path::PathBuf::from(std::env::args().nth(1).expect("usage: mtef_edit <dir>"));
    std::fs::create_dir_all(&dir).expect("output folder");
    let corpus =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testing/corpus/mathtype");
    let mut count = 0;
    for file in ["read.jsonl", "import.jsonl"] {
        let text = std::fs::read_to_string(corpus.join(file)).expect("corpus file");
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let row: serde_json::Value = serde_json::from_str(line).unwrap();
            let source = row["source"].as_str().unwrap();
            let Some(native) = row["native"].as_str() else {
                continue;
            };
            if source.starts_with("codec/") {
                continue;
            }
            let original = mtef::from_equation_native(&base64(native)).unwrap();
            let mathml = read::to_mathml(&original);
            let display = original.equation_options & 0x01 == 0;
            for (edit, changed) in edits(&mathml) {
                let name = format!("{}~{edit}", source.replace('/', "~"));
                match write::edit(&original, &changed, display) {
                    Ok(edited) => {
                        std::fs::write(dir.join(format!("{name}.mtef")), mtef::write(&edited))
                            .expect("written");
                        std::fs::write(
                            dir.join(format!("{name}.native")),
                            mtef::to_equation_native(&edited),
                        )
                        .expect("written");
                        count += 1;
                    }
                    Err(error) => println!("{name}: {error}"),
                }
            }
        }
    }
    println!("{count} edited equations written to {}", dir.display());
}

/// The formula's MathML after each edit.
fn edits(mathml: &str) -> Vec<(&'static str, String)> {
    let open = mathml.find('>').unwrap() + 1;
    let close = mathml.rfind("</math>").unwrap();
    let mut edits = vec![
        (
            "after",
            format!("{}<mi>x</mi>{}", &mathml[..close], &mathml[close..]),
        ),
        (
            "before",
            format!("{}<mi>x</mi>{}", &mathml[..open], &mathml[open..]),
        ),
    ];
    let letter = mathml
        .match_indices("<mi>")
        .map(|(at, _)| at + 4)
        .find(|&at| {
            mathml.as_bytes()[at].is_ascii_lowercase() && mathml[at + 1..].starts_with("</mi>")
        });
    if let Some(at) = letter {
        let new = if &mathml[at..at + 1] == "q" { "w" } else { "q" };
        edits.push((
            "letter",
            format!("{}{new}{}", &mathml[..at], &mathml[at + 1..]),
        ));
    }
    edits
}

fn base64(text: &str) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let digits: Vec<u8> = text
        .bytes()
        .filter(|&c| c != b'=' && !c.is_ascii_whitespace())
        .map(value)
        .collect();
    digits
        .chunks(4)
        .flat_map(|chunk| {
            let bits = chunk
                .iter()
                .enumerate()
                .fold(0u32, |bits, (i, &d)| bits | (u32::from(d) << (18 - 6 * i)));
            (0..chunk.len() - 1).map(move |i| (bits >> (16 - 8 * i)) as u8)
        })
        .collect()
}
