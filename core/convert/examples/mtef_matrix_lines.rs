//! Probe equations for matrix partition lines: each given matrix probe (MTEF files) again with lines - every border
//! and inner line solid, the inner lines only, everything dashed (2), everything dotted (3), and the borders only -
//! written as <out dir>/<name>-lines-<variant>.mtef for MathType to draw (kit render-loop.ps1).
//!   cargo run -p convert --example mtef_matrix_lines -- <out dir> <matrix.mtef>...

use convert::mathtype::mtef::{self, Record};

/// Partition bytes for `lines` lines, each of the kind `kind(index)` (0 none, 1 solid, 2 dashed, 3 dotted), two
/// bits per line from the low bits up.
fn partitions(lines: usize, kind: impl Fn(usize) -> u8) -> Vec<u8> {
    let mut bytes = vec![0u8; mtef::partition_bytes(lines)];
    for i in 0..lines {
        bytes[i / 4] |= (kind(i) & 3) << (2 * (i % 4));
    }
    bytes
}

/// A line's kind from its index among `n` lines.
type Kind<'k> = &'k dyn Fn(usize, usize) -> u8;

fn set_lines(records: &mut [Record], kind: Kind) -> bool {
    for record in records.iter_mut() {
        match record {
            Record::Matrix(m) => {
                let (rows, columns) = (usize::from(m.rows) + 1, usize::from(m.columns) + 1);
                m.row_partitions = partitions(rows, |i| kind(i, rows));
                m.column_partitions = partitions(columns, |i| kind(i, columns));
                return true;
            }
            Record::Line(line) => {
                if set_lines(&mut line.content, kind) {
                    return true;
                }
            }
            Record::Template(t) => {
                if set_lines(&mut t.content, kind) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(
        args.next()
            .expect("usage: mtef_matrix_lines <out dir> <matrix.mtef>..."),
    );
    std::fs::create_dir_all(&out).expect("output folder");
    let border = |i: usize, n: usize| i == 0 || i == n - 1;
    let variants: [(&str, Kind); 5] = [
        ("all", &|_, _| 1),
        ("inner", &move |i, n| u8::from(!border(i, n))),
        ("dashed", &|_, _| 2),
        ("dotted", &|_, _| 3),
        ("border", &move |i, n| u8::from(border(i, n))),
    ];
    let mut count = 0;
    for path in args {
        let path = std::path::PathBuf::from(path);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let data = std::fs::read(&path).expect("readable MTEF");
        for (label, kind) in variants {
            let mut equation = mtef::read(&data).expect("MTEF");
            if !set_lines(&mut equation.records, kind) {
                eprintln!("{name}: no matrix");
                break;
            }
            std::fs::write(
                out.join(format!("{name}-lines-{label}.mtef")),
                mtef::write(&equation),
            )
            .unwrap();
            count += 1;
        }
    }
    println!("{count} probes");
}
