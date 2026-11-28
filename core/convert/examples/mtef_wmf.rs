//! TexType's MathType pictures as WMF files, for the picture corpus' sources (testing/corpus/mathtype/pictures.jsonl):
//! writes <out dir>/<source with / as ~>.wmf for each source whose name contains a filter.
//!   cargo run -p convert --example mtef_wmf -- <out dir> <filter> [max]

use convert::mathtype::mtef;
use convert::mathtype::picture::{self, Fonts};

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(
        args.next()
            .expect("usage: mtef_wmf <out dir> <filter> [max]"),
    );
    let filter = args.next().unwrap_or_default();
    let max: usize = args
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(usize::MAX);
    std::fs::create_dir_all(&out).unwrap();
    let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testing/corpus/mathtype/pictures.jsonl");
    let fonts = Fonts::system();
    let mut written = 0;
    for line in std::fs::read_to_string(corpus).unwrap().lines() {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let source = row["source"].as_str().unwrap();
        if !source.contains(&filter) || written >= max {
            continue;
        }
        let data = base64(row["mtef"].as_str().unwrap());
        let model = mtef::read(&data).unwrap();
        match picture::draw(&model, &fonts) {
            Ok(drawn) => {
                let path = out.join(format!("{}.wmf", source.replace('/', "~")));
                std::fs::write(&path, picture::wmf(&drawn, Some(&data))).unwrap();
                println!("{}", path.display());
                written += 1;
            }
            Err(error) => println!("{source}: {error}"),
        }
    }
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
