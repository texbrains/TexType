//! MTEF cut out of a larger file (MathType's toolbar): each file trimmed to the shortest length that reads as one
//! whole equation, written back; files with no such length are reported.
//!   cargo run -p convert --example mtef_trim -- <file.mtef>...

use convert::mathtype::mtef;

fn main() {
    let (mut kept, mut failed) = (0, 0);
    for path in std::env::args().skip(1) {
        let data = std::fs::read(&path).expect("readable file");
        match (16..=data.len()).find(|&n| mtef::read(&data[..n]).is_ok()) {
            Some(n) => {
                std::fs::write(&path, &data[..n]).unwrap();
                kept += 1;
            }
            None => {
                eprintln!("{path}: no whole equation");
                failed += 1;
            }
        }
    }
    println!("{kept} trimmed, {failed} without an equation");
}
