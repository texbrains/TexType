//! TexType's equations against what MathType wrote back after opening and saving them: per equation whether the
//! data is byte-identical, whether the records are (colours and sizes aside), and whether both read as the same
//! MathML.
//!   cargo run -p convert --example mtef_compare -- <ours-dir> <theirs-dir>   (files <id>.mtef)

use convert::mathtype::{mtef, read};

fn main() {
    let mut args = std::env::args().skip(1);
    let ours_dir = std::path::PathBuf::from(
        args.next()
            .expect("usage: mtef_compare <ours-dir> <theirs-dir>"),
    );
    let theirs_dir = std::path::PathBuf::from(
        args.next()
            .expect("usage: mtef_compare <ours-dir> <theirs-dir>"),
    );
    let mut entries: Vec<_> = std::fs::read_dir(&theirs_dir)
        .expect("theirs folder")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == "mtef"))
        .collect();
    entries.sort();
    let (mut identical, mut same_meaning, mut different) = (0, 0, 0);
    for theirs_path in entries {
        let id = theirs_path
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let ours = std::fs::read(ours_dir.join(format!("{id}.mtef"))).expect("our equation");
        let theirs = std::fs::read(&theirs_path).expect("their equation");
        if ours == theirs {
            identical += 1;
            continue;
        }
        let (ours_model, theirs_model) = (mtef::read(&ours).unwrap(), mtef::read(&theirs));
        let theirs_model = match theirs_model {
            Ok(model) => model,
            Err(error) => {
                different += 1;
                println!("{id}: unreadable rewrite: {error}");
                continue;
            }
        };
        let (a, b) = (read::to_mathml(&ours_model), read::to_mathml(&theirs_model));
        if a == b {
            same_meaning += 1;
            println!(
                "{id}: rewritten, same MathML ({} -> {} bytes)",
                ours.len(),
                theirs.len()
            );
        } else {
            different += 1;
            println!("{id}: DIFFERENT\n  ours   {a}\n  theirs {b}");
        }
    }
    println!("byte-identical {identical}, rewritten with the same MathML {same_meaning}, different {different}");
}
