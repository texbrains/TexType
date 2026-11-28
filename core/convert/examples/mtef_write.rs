//! Writes the MathType equation data for every formula of a corpus jsonl (fields source, mathml, display) as
//! <dir>/<source>.mtef and its Equation Native stream <dir>/<source>.native, for checking the writer with MathType
//! itself.
//!   cargo run -p convert --example mtef_write -- testing/corpus/mathtype/import.jsonl <dir>

use convert::mathtype::{mtef, write};

fn main() {
    let mut args = std::env::args().skip(1);
    let corpus = args.next().expect("usage: mtef_write <corpus.jsonl> <dir>");
    let dir =
        std::path::PathBuf::from(args.next().expect("usage: mtef_write <corpus.jsonl> <dir>"));
    std::fs::create_dir_all(&dir).expect("output folder");
    let mut count = 0;
    for line in std::fs::read_to_string(&corpus)
        .expect("corpus file")
        .lines()
        .filter(|l| !l.trim().is_empty())
    {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let source = row["source"].as_str().unwrap();
        let display = row["display"].as_bool().unwrap_or(true);
        match write::from_mathml(row["mathml"].as_str().unwrap(), display) {
            Ok(model) => {
                std::fs::write(dir.join(format!("{source}.mtef")), mtef::write(&model))
                    .expect("written");
                std::fs::write(
                    dir.join(format!("{source}.native")),
                    mtef::to_equation_native(&model),
                )
                .expect("written");
                count += 1;
            }
            Err(error) => println!("{source}: {error}"),
        }
    }
    println!("{count} equations written to {}", dir.display());
}
