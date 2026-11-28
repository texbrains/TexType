//! Probe equations for scripts before their base (template 27, 28, 29 with variation 0x0001): each script probe's
//! first base-then-scripts pair rewritten as the scripts (variation | 1) followed by the base, the order MathType's
//! own equations hold. Written as <out dir>/<name>-pre.mtef for MathType to draw (kit render-all.ps1).
//!   cargo run -p convert --example mtef_prescript_probe -- <out dir> <script.mtef>...

use convert::mathtype::mtef::{self, Record};

fn rewrite(records: &mut Vec<Record>) -> bool {
    let at = records.windows(2).position(|pair| {
        matches!(pair[0], Record::Char(_))
            && matches!(&pair[1], Record::Template(t) if (27..=29).contains(&t.selector))
    });
    if let Some(at) = at {
        if let Record::Template(t) = &mut records[at + 1] {
            t.variation |= 1;
        }
        records.swap(at, at + 1);
        // the full size again for the base (MathType's own records restore it after the scripts)
        records.insert(at + 1, Record::TypeSize(10));
        return true;
    }
    for record in records.iter_mut() {
        if let Record::Line(line) = record {
            if rewrite(&mut line.content) {
                return true;
            }
        }
    }
    false
}

/// For a base, scripts, `+` and a last character: the scripts moved before that last character (`x + ²1`), for
/// what precedes scripts before their base.
fn rewrite_after(records: &mut Vec<Record>) -> bool {
    let script = records
        .iter()
        .position(|r| matches!(r, Record::Template(t) if (27..=29).contains(&t.selector)));
    let last = records.iter().rposition(|r| matches!(r, Record::Char(_)));
    if let (Some(script), Some(last)) = (script, last) {
        if last > script {
            let mut template = records.remove(script);
            if let Record::Template(t) = &mut template {
                t.variation |= 1;
            }
            // the last character is now one record earlier
            records.insert(last - 1, template);
            records.insert(last, Record::TypeSize(10));
            return true;
        }
    }
    for record in records.iter_mut() {
        if let Record::Line(line) = record {
            if rewrite_after(&mut line.content) {
                return true;
            }
        }
    }
    false
}

fn main() {
    let mut args = std::env::args().skip(1);
    let out = std::path::PathBuf::from(
        args.next()
            .expect("usage: mtef_prescript_probe <out dir> <script.mtef>..."),
    );
    std::fs::create_dir_all(&out).expect("output folder");
    let mut count = 0;
    for path in args {
        let path = std::path::PathBuf::from(path);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let data = std::fs::read(&path).expect("readable MTEF");
        if name.ends_with("-then") {
            let mut equation = mtef::read(&data).expect("MTEF");
            if rewrite_after(&mut equation.records) {
                let file = out.join(format!("{name}-pre-after.mtef"));
                std::fs::write(file, mtef::write(&equation)).unwrap();
                count += 1;
            }
            continue;
        }
        let mut equation = mtef::read(&data).expect("MTEF");
        if rewrite(&mut equation.records) {
            std::fs::write(out.join(format!("{name}-pre.mtef")), mtef::write(&equation)).unwrap();
            count += 1;
        } else {
            eprintln!("{name}: no base with scripts");
        }
    }
    println!("{count} probes");
}
