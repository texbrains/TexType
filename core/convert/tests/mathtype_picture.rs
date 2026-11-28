//! TexType's MathType pictures against MathType 6.9's own (testing/corpus/mathtype/pictures.jsonl, drawn by a clean
//! MathType 6.9 install in Windows Sandbox; the probe-pc/ rows by the test PC's install, which draws the same since
//! its MT Extra registration was repaired on 2026-11-26): a picture passes when it has the same size and the same
//! texts in the same fonts and sizes (a stretched glyph's font width within one unit: owner's decision 2026-11-26),
//! every character within a pixel at 100 % (24 units) of MathType's (a text's characters at its position plus the
//! advances before them), the same lines, polygons and arcs, everything in MathType's colours. Characters grouped into texts otherwise than MathType
//! groups them pass when each has its twin (owner's decision 2026-11-27: the grouping is not seen). Pictures MathType
//! draws wrongly itself are left out
//! (misdrawn.txt beside the corpus). MathType's own fonts are the product's bundled ones (resources/fonts); the
//! others its pictures name must be installed (Times New Roman, Symbol, Courier New, SimSun ...).

use convert::mathtype::mtef;
use convert::mathtype::picture::{self, Fonts, Picture};

const PIXEL: i64 = 24;

#[test]
fn pictures_match_mathtype_s_own() {
    let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testing/corpus/mathtype/pictures.jsonl");
    let fonts = Fonts::with_mathtype_fonts(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../resources/fonts"),
    )
    .unwrap();
    // pictures MathType draws wrongly itself (testing/corpus/mathtype/misdrawn.txt)
    let misdrawn_list =
        std::fs::read_to_string(corpus.with_file_name("misdrawn.txt")).expect("misdrawn.txt");
    let misdrawn: Vec<&str> = misdrawn_list
        .lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.split(" # ").next())
        .collect();
    let (mut total, mut drawn, mut passed) = (0, 0, 0);
    let mut reasons: std::collections::BTreeMap<String, usize> = Default::default();
    let mut differences = Vec::new();
    // TAGS=<file in the repository>: per drawn picture whether it passed and what it holds, for sorting the
    // differences by cause
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut tags_file = std::env::var("TAGS")
        .ok()
        .map(|p| std::fs::File::create(root.join(p)).unwrap());
    for line in std::fs::read_to_string(corpus)
        .expect("pictures.jsonl")
        .lines()
    {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let source = row["source"].as_str().unwrap();
        // ONLY=<source prefixes, comma separated>: just those rows
        if std::env::var("ONLY").is_ok_and(|s| !s.split(',').any(|p| source.starts_with(p)))
            || misdrawn.contains(&source)
        {
            continue;
        }
        total += 1;
        let model = mtef::read(&base64(row["mtef"].as_str().unwrap())).unwrap();
        if std::env::var("TRACE").is_ok() {
            println!("trace {source}");
        }
        let ours = match picture::draw(&model, &fonts) {
            Ok(ours) => ours,
            Err(error) => {
                // NOT_DRAWN=<text>: the sources not drawn for a reason containing it
                if std::env::var("NOT_DRAWN").is_ok_and(|s| error.contains(&s)) {
                    println!("not drawn: {source}: {error}");
                }
                *reasons.entry(error).or_default() += 1;
                continue;
            }
        };
        drawn += 1;
        let mtef_bytes = base64(row["mtef"].as_str().unwrap());
        assert_eq!(
            read_wmf(&picture::wmf(&ours, Some(&mtef_bytes))),
            ours,
            "{source}: the WMF holds the picture"
        );
        // ITEMS=<source prefixes, comma separated>: our texts and lines, then MathType's texts
        if std::env::var("ITEMS").is_ok_and(|s| s.split(',').any(|p| source.starts_with(p))) {
            println!("{source} ours {}x{}", ours.width, ours.height);
            ours.texts.iter().for_each(|t| {
                println!(
                    "   text {},{} {} h{} {:02x?} dx {:?}",
                    t.x, t.y, t.face.name, t.height, t.bytes, t.advances
                )
            });
            ours.lines
                .iter()
                .for_each(|l| println!("   line {:?}-{:?} w{}", l.from, l.to, l.width));
            let picture = &row["picture"];
            println!("  theirs {}", picture["bounds"]);
            for item in picture["items"].as_array().into_iter().flatten() {
                if item["kind"] == "text" {
                    println!(
                        "   text {},{} {} h{} {} dx {}",
                        item["x"],
                        item["y"],
                        item["font"],
                        item["height"],
                        item["bytes"],
                        item["dx"]
                    );
                } else {
                    println!("   {item}");
                }
            }
        }
        let outcome = difference(&ours, &row["picture"]);
        // JUMPS: where the horizontal offset between our characters and MathType's changes along a baseline (a
        // spacing difference between two neighbours), the two characters and the change
        if std::env::var("JUMPS").is_ok() {
            for line in jumps(&ours, &row["picture"]) {
                println!("jump {source}: {line}");
            }
        }
        if let Some(file) = &mut tags_file {
            use std::io::Write;
            let mut tags = std::collections::BTreeSet::new();
            collect_tags(&model.records, &mut tags);
            let state = if outcome.is_none() { "pass" } else { "fail" };
            let tags: Vec<String> = tags.into_iter().collect();
            writeln!(file, "{source}\t{state}\t{}", tags.join(" ")).unwrap();
        }
        match outcome {
            None => passed += 1,
            Some(text) => differences.push(format!("{source}: {text}")),
        }
    }
    println!("{total} pictures, {drawn} drawn, {passed} as MathType's");
    for (reason, count) in &reasons {
        println!("  {count:>4} not drawn: {reason}");
    }
    let limit = std::env::var("SHOW")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(15);
    differences.iter().take(limit).for_each(|d| println!("{d}"));
}

/// How our picture differs from MathType's, or None when it passes.
fn difference(ours: &Picture, theirs: &serde_json::Value) -> Option<String> {
    let bounds = theirs["bounds"].as_array().unwrap();
    let (width, height) = (bounds[2].as_i64().unwrap(), bounds[3].as_i64().unwrap());
    let mut problems = Vec::new();
    if (i64::from(ours.width), i64::from(ours.height)) != (width, height) {
        problems.push(format!(
            "size {}x{} vs {width}x{height}",
            ours.width, ours.height
        ));
    }
    let items = theirs["items"].as_array().unwrap();
    let others = items
        .iter()
        .filter(|i| {
            !matches!(
                i["kind"].as_str(),
                Some("text" | "line" | "polygon" | "arc")
            )
        })
        .count();
    if others > 0 {
        problems.push(format!("{others} shapes not drawn"));
    }
    // polygons: the same points, each within a pixel
    let mut polygons: Vec<&serde_json::Value> =
        items.iter().filter(|i| i["kind"] == "polygon").collect();
    for shape in &ours.polygons {
        let ours_points = &shape.points;
        let same = |p: &&serde_json::Value| {
            let theirs = p["points"].as_array().unwrap();
            colour(p) == shape.colour
                && theirs.len() == ours_points.len()
                && theirs.iter().zip(ours_points).all(|(t, o)| {
                    (t[0].as_i64().unwrap() - i64::from(o.0)).abs() <= PIXEL
                        && (t[1].as_i64().unwrap() - i64::from(o.1)).abs() <= PIXEL
                })
        };
        match polygons.iter().position(same) {
            Some(at) => {
                polygons.remove(at);
            }
            None => problems.push(format!(
                "our polygon {ours_points:?}{} not in theirs",
                shown(shape.colour)
            )),
        }
    }
    for p in polygons {
        problems.push(format!(
            "their polygon {}{} not in ours",
            p["points"],
            shown(colour(p))
        ));
    }
    // lines: the same pen width, both ends within a pixel
    let mut lines: Vec<&serde_json::Value> = items.iter().filter(|i| i["kind"] == "line").collect();
    let point = |v: &serde_json::Value| (v[0].as_i64().unwrap(), v[1].as_i64().unwrap());
    let near =
        |a: (i64, i64), b: (i64, i64)| (a.0 - b.0).abs() <= PIXEL && (a.1 - b.1).abs() <= PIXEL;
    // arcs: the same pen width, the drawn curve's two ends and middle each within a pixel
    let mut arcs: Vec<&serde_json::Value> = items.iter().filter(|i| i["kind"] == "arc").collect();
    for arc in &ours.arcs {
        let mine = arc_points(arc.rect, arc.start, arc.end);
        let same = |a: &&serde_json::Value| {
            let v = |k: &str, i: usize| a[k][i].as_i64().unwrap() as i32;
            let theirs = arc_points(
                (v("box", 0), v("box", 1), v("box", 2), v("box", 3)),
                (v("start", 0), v("start", 1)),
                (v("end", 0), v("end", 1)),
            );
            a["width"].as_i64() == Some(i64::from(arc.width))
                && colour(a) == arc.colour
                && mine.iter().zip(&theirs).all(|(m, t)| near(*m, *t))
        };
        match arcs.iter().position(same) {
            Some(at) => {
                arcs.remove(at);
            }
            None => problems.push(format!("our arc {arc:?} not in theirs")),
        }
    }
    for a in arcs {
        problems.push(format!(
            "their arc box {} start {} end {} w{} not in ours",
            a["box"], a["start"], a["end"], a["width"]
        ));
    }
    for rule in &ours.lines {
        let (from, to) = (
            (i64::from(rule.from.0), i64::from(rule.from.1)),
            (i64::from(rule.to.0), i64::from(rule.to.1)),
        );
        let same = |l: &&serde_json::Value| {
            l["width"].as_i64() == Some(i64::from(rule.width))
                && colour(l) == rule.colour
                && ((near(point(&l["from"]), from) && near(point(&l["to"]), to))
                    || (near(point(&l["from"]), to) && near(point(&l["to"]), from)))
        };
        match lines.iter().position(same) {
            Some(at) => {
                lines.remove(at);
            }
            None => problems.push(format!(
                "our line {from:?}-{to:?} w{}{} not in theirs",
                rule.width,
                shown(rule.colour)
            )),
        }
    }
    for l in lines {
        problems.push(format!(
            "their line {}-{} w{}{} not in ours",
            l["from"],
            l["to"],
            l["width"],
            shown(colour(l))
        ));
    }
    let mut texts: Vec<&serde_json::Value> = items.iter().filter(|i| i["kind"] == "text").collect();
    let mut unmatched = Vec::new();
    for text in &ours.texts {
        let name = if text.face.name == "SimSun" {
            "\u{cb}\u{ce}\u{cc}\u{e5}".to_string()
        } else {
            text.face.name.clone()
        };
        let bytes = text
            .bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ");
        let same = |t: &&serde_json::Value| {
            t["font"].as_str() == Some(&name)
                && (t["weight"].as_i64().unwrap() >= 700) == text.face.bold
                && (t["italic"].as_i64().unwrap() != 0) == text.face.italic
                && t["height"].as_i64() == Some(i64::from(text.height))
                && same_width(t["width"].as_i64().unwrap_or(0), i64::from(text.width))
                && t["charset"].as_i64() == Some(i64::from(text.charset))
                && t["bytes"].as_str() == Some(&bytes)
                && colour(t) == text.colour
        };
        // among equal texts the nearest
        let distance = |t: &&serde_json::Value| {
            (i64::from(text.x) - t["x"].as_i64().unwrap()).abs()
                + (i64::from(text.y) - t["y"].as_i64().unwrap()).abs()
        };
        let Some(at) = texts
            .iter()
            .enumerate()
            .filter(|(_, t)| same(t))
            .min_by_key(|(_, t)| distance(t))
            .map(|(i, _)| i)
        else {
            unmatched.push((text, name.clone(), bytes.clone()));
            continue;
        };
        let t = texts.remove(at);
        let dy = i64::from(text.y) - t["y"].as_i64().unwrap();
        let advances: Vec<i64> = t["dx"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect();
        // each character's x: the text's x plus the advances before it
        let positions = |x: i64, steps: &mut dyn Iterator<Item = i64>| -> Vec<i64> {
            let mut at = x;
            (0..text.bytes.len())
                .map(|_| {
                    let here = at;
                    at += steps.next().unwrap_or(0);
                    here
                })
                .collect()
        };
        let ours = positions(
            i64::from(text.x),
            &mut text.advances.iter().map(|&a| i64::from(a)),
        );
        let theirs = positions(t["x"].as_i64().unwrap(), &mut advances.iter().copied());
        let off = ours
            .iter()
            .zip(&theirs)
            .map(|(a, b)| (a - b).abs())
            .max()
            .unwrap_or(0);
        if off > PIXEL || dy.abs() > PIXEL {
            problems.push(format!(
                "[{bytes}] at x {ours:?} y {} vs x {theirs:?} y {}",
                text.y, t["y"]
            ));
        }
    }
    // the texts left over: the same characters grouped otherwise pass (each its twin within a pixel)
    if !regrouped(&unmatched, &texts) {
        for (text, name, bytes) in &unmatched {
            problems.push(format!(
                "ours {name} h{} w{} cs{} [{bytes}]{} at {},{} not in theirs",
                text.height,
                text.width,
                text.charset,
                shown(text.colour),
                text.x,
                text.y
            ));
        }
    } else {
        texts.clear();
    }
    for t in texts {
        problems.push(format!(
            "theirs {} h{} cs{} [{}]{} at {},{} not in ours",
            t["font"],
            t["height"],
            t["charset"],
            t["bytes"].as_str().unwrap(),
            shown(colour(t)),
            t["x"],
            t["y"]
        ));
    }
    (!problems.is_empty()).then(|| problems.join("; "))
}

/// What an equation holds: templates (t<selector>), matrices, piles, embellishments (e<kind>), nudges, SIZE
/// records, character typefaces (f<typeface>) and characters outside ASCII (u<code>).
fn collect_tags(records: &[mtef::Record], tags: &mut std::collections::BTreeSet<String>) {
    use mtef::Record;
    for record in records {
        match record {
            Record::Line(l) => collect_tags(&l.content, tags),
            Record::Template(t) => {
                tags.insert(format!("t{}", t.selector));
                if t.nudge.is_some() {
                    tags.insert("nudge".into());
                }
                collect_tags(&t.content, tags);
            }
            Record::Matrix(m) => {
                tags.insert("matrix".into());
                collect_tags(&m.content, tags);
            }
            Record::Pile(p) => {
                tags.insert("pile".into());
                collect_tags(&p.content, tags);
            }
            Record::Char(c) => {
                tags.insert(format!("f{}", c.typeface.value));
                if c.nudge.is_some() {
                    tags.insert("nudge".into());
                }
                if let Some(code) = c.mt_code.filter(|&m| m > 0x7F) {
                    tags.insert(format!("u{code:04X}"));
                }
                collect_tags(&c.embellishments, tags);
            }
            Record::Embellishment(e) => {
                tags.insert(format!("e{}", e.kind));
            }
            Record::Size(_) => {
                tags.insert("size".into());
            }
            _ => {}
        }
    }
}

/// Our characters and MathType's on each baseline in order (matched by font, size and byte), and where the
/// difference of their x positions changes by more than 2 units (JUMPS=<n>: n): "prev -> next: change".
fn jumps(ours: &Picture, theirs: &serde_json::Value) -> Vec<String> {
    let key = |font: &str, italic: bool, height: i64, byte: u8| {
        format!(
            "{font}{} h{height} {byte:02x}",
            if italic { " i" } else { "" }
        )
    };
    let mut mine: Vec<(i64, i64, String)> = Vec::new();
    for t in &ours.texts {
        let name = if t.face.name == "SimSun" {
            "\u{cb}\u{ce}\u{cc}\u{e5}".to_string()
        } else {
            t.face.name.clone()
        };
        let mut x = i64::from(t.x);
        for (&b, &a) in t.bytes.iter().zip(&t.advances) {
            mine.push((
                i64::from(t.y),
                x,
                key(&name, t.face.italic, i64::from(t.height), b),
            ));
            x += i64::from(a);
        }
    }
    let mut other: Vec<(i64, i64, String)> = Vec::new();
    for t in theirs["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["kind"] == "text")
    {
        let mut x = t["x"].as_i64().unwrap();
        let bytes: Vec<u8> = t["bytes"]
            .as_str()
            .unwrap()
            .split(' ')
            .filter_map(|b| u8::from_str_radix(b, 16).ok())
            .collect();
        let dx: Vec<i64> = t["dx"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect();
        for (b, a) in bytes.into_iter().zip(dx) {
            let font = t["font"].as_str().unwrap();
            other.push((
                t["y"].as_i64().unwrap(),
                x,
                key(
                    font,
                    t["italic"].as_i64().unwrap() != 0,
                    t["height"].as_i64().unwrap(),
                    b,
                ),
            ));
            x += a;
        }
    }
    // the same characters in the same order on the same baselines, else nothing to compare
    mine.sort();
    other.sort();
    if mine.len() != other.len()
        || mine
            .iter()
            .zip(&other)
            .any(|(a, b)| a.0 != b.0 || a.2 != b.2)
    {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 1..mine.len() {
        if mine[i].0 != mine[i - 1].0 {
            continue;
        }
        let change = (mine[i].1 - other[i].1) - (mine[i - 1].1 - other[i - 1].1);
        // JUMPS=<n>: changes of more than n units (default 2)
        let least = std::env::var("JUMPS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2);
        if change.abs() > least {
            out.push(format!("{} -> {}: {change:+}", mine[i - 1].2, mine[i].2));
        }
    }
    out
}

/// A WMF as written by `picture::wmf`, read back: its size, texts (font from the last created font), lines and
/// polygons; the baseline from the "MathType" comment.
fn read_wmf(data: &[u8]) -> Picture {
    let u16_at = |p: usize| u16::from_le_bytes([data[p], data[p + 1]]);
    let i16_at = |p: usize| u16_at(p) as i16 as i32;
    assert_eq!(u16_at(0), 0xCDD7);
    let (width, height) = (i16_at(10), i16_at(12));
    let mut picture = Picture {
        width,
        height,
        baseline: 0,
        texts: vec![],
        lines: vec![],
        polygons: vec![],
        arcs: vec![],
    };
    let mut objects: Vec<Option<(u16, Vec<u8>)>> = vec![];
    let (mut pen, mut font, mut at) = ((0, 0), Vec::new(), (0, 0));
    let (mut brush, mut text_colour) = (0, 0);
    let colour_at = |b: &[u8], i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], 0]);
    let mut p = 22 + 18;
    loop {
        let size = u32::from_le_bytes(data[p..p + 4].try_into().unwrap()) as usize;
        let function = u16_at(p + 4);
        let params = &data[p + 6..p + size * 2];
        let w = |i: usize| i16::from_le_bytes([params[2 * i], params[2 * i + 1]]) as i32;
        match function {
            0 => break,
            0x0626 if params[4..14] == *b"MathType\0\0" => picture.baseline = height - 2 * w(7),
            0x02FA..=0x02FC => {
                let slot = objects
                    .iter()
                    .position(Option::is_none)
                    .unwrap_or(objects.len());
                if slot == objects.len() {
                    objects.push(None);
                }
                objects[slot] = Some((function, params.to_vec()));
            }
            0x012D => match &objects[w(0) as usize] {
                Some((0x02FA, logpen)) => {
                    pen = (
                        i16::from_le_bytes([logpen[2], logpen[3]]) as i32,
                        colour_at(logpen, 6),
                    )
                }
                Some((0x02FC, logbrush)) => brush = colour_at(logbrush, 2),
                Some((0x02FB, logfont)) => font = logfont.clone(),
                _ => {}
            },
            0x01F0 => objects[w(0) as usize] = None,
            0x0209 => text_colour = colour_at(params, 0),
            0x0214 => at = (w(1), w(0)),
            0x0213 => {
                picture.lines.push(picture::Rule {
                    from: at,
                    to: (w(1), w(0)),
                    width: pen.0,
                    colour: pen.1,
                });
                at = (w(1), w(0));
            }
            0x0817 => picture.arcs.push(picture::Arc {
                rect: (w(7), w(6), w(5), w(4)),
                start: (w(3), w(2)),
                end: (w(1), w(0)),
                width: pen.0,
                colour: pen.1,
            }),
            0x0324 => picture.polygons.push(picture::Shape {
                points: (0..w(0) as usize)
                    .map(|i| (w(1 + 2 * i), w(2 + 2 * i)))
                    .collect(),
                colour: brush,
            }),
            0x0A32 => {
                let count = w(2) as usize;
                let bytes = params[8..8 + count].to_vec();
                let dx = 4 + count.div_ceil(2);
                let name_end = font[18..].iter().position(|&b| b == 0).unwrap_or(32);
                let name = match &font[18..18 + name_end] {
                    [0xCB, 0xCE, 0xCC, 0xE5] => "SimSun".to_string(),
                    other => String::from_utf8(other.to_vec()).unwrap(),
                };
                let face = picture::Face {
                    name,
                    bold: i16::from_le_bytes([font[8], font[9]]) >= 700,
                    italic: font[10] != 0,
                };
                let (height, width) = (
                    -(i16::from_le_bytes([font[0], font[1]]) as i32),
                    i16::from_le_bytes([font[2], font[3]]) as i32,
                );
                let advances = (0..count).map(|i| w(dx + i)).collect();
                picture.texts.push(picture::Text {
                    x: at.0,
                    y: at.1,
                    face,
                    height,
                    width,
                    charset: font[13],
                    bytes,
                    advances,
                    colour: text_colour,
                });
            }
            _ => {}
        }
        p += size * 2;
    }
    picture
}

/// Whether two font widths pass: equal, or both a stretched glyph's (not 0) within one unit (owner's decision
/// 2026-11-26: the difference is invisible).
/// One drawn character: font, bold, italic, height, width, character set, byte, x, y, colour.
struct Glyph(String, bool, bool, i64, i64, i64, u8, i64, i64, u32);

/// Whether our texts and theirs hold the same characters, each within a pixel of its twin, however grouped.
fn regrouped(ours: &[(&picture::Text, String, String)], theirs: &[&serde_json::Value]) -> bool {
    let mut mine = Vec::new();
    for (text, name, _) in ours {
        let mut x = i64::from(text.x);
        for (&byte, &advance) in text.bytes.iter().zip(&text.advances) {
            let (f, h, w, cs) = (text.face.bold, text.height, text.width, text.charset);
            let i = text.face.italic;
            mine.push(Glyph(
                name.clone(),
                f,
                i,
                h.into(),
                w.into(),
                cs.into(),
                byte,
                x,
                text.y.into(),
                text.colour,
            ));
            x += i64::from(advance);
        }
    }
    let mut others = Vec::new();
    for t in theirs {
        let mut x = t["x"].as_i64().unwrap();
        let bytes = t["bytes"].as_str().unwrap().split_whitespace();
        for (byte, advance) in bytes.zip(t["dx"].as_array().unwrap()) {
            others.push(Glyph(
                t["font"].as_str().unwrap().to_string(),
                t["weight"].as_i64().unwrap() >= 700,
                t["italic"].as_i64().unwrap() != 0,
                t["height"].as_i64().unwrap(),
                t["width"].as_i64().unwrap_or(0),
                t["charset"].as_i64().unwrap(),
                u8::from_str_radix(byte, 16).unwrap(),
                x,
                t["y"].as_i64().unwrap(),
                colour(t),
            ));
            x += advance.as_i64().unwrap();
        }
    }
    mine.len() == others.len()
        && mine.iter().all(|m| {
            let twin = others.iter().position(|o| {
                (&o.0, o.1, o.2, o.3, o.5, o.6, o.9) == (&m.0, m.1, m.2, m.3, m.5, m.6, m.9)
                    && same_width(o.4, m.4)
                    && (o.7 - m.7).abs() <= PIXEL
                    && (o.8 - m.8).abs() <= PIXEL
            });
            twin.map(|at| others.remove(at)).is_some()
        })
}

/// A corpus item's colour as GDI's COLORREF (`picture::Text::colour`): its "#rrggbb", black without one.
fn colour(item: &serde_json::Value) -> u32 {
    item["color"].as_str().map_or(0, |c| {
        let v = u32::from_str_radix(c.trim_start_matches('#'), 16).unwrap_or(0);
        ((v >> 16) & 0xFF) | (v & 0xFF00) | ((v & 0xFF) << 16)
    })
}

/// A colour for a message: " #rrggbb", nothing for black.
fn shown(colour: u32) -> String {
    if colour == 0 {
        String::new()
    } else {
        let (r, g, b) = (colour & 0xFF, (colour >> 8) & 0xFF, colour >> 16);
        format!(" #{r:02x}{g:02x}{b:02x}")
    }
}

fn same_width(theirs: i64, ours: i64) -> bool {
    theirs == ours || (theirs != 0 && ours != 0 && (theirs - ours).abs() <= 1)
}

/// Where GDI's Arc draws (y down, counter-clockwise on screen from the start ray to the end ray): its first point,
/// its middle and its last point.
fn arc_points(rect: (i32, i32, i32, i32), start: (i32, i32), end: (i32, i32)) -> [(i64, i64); 3] {
    let (cx, cy) = (
        f64::from(rect.0 + rect.2) / 2.0,
        f64::from(rect.1 + rect.3) / 2.0,
    );
    let (rx, ry) = (
        f64::from(rect.2 - rect.0) / 2.0,
        f64::from(rect.3 - rect.1) / 2.0,
    );
    // angles counted counter-clockwise as seen (y down: up is negative y)
    let angle = |p: (i32, i32)| (cy - f64::from(p.1)).atan2(f64::from(p.0) - cx);
    let (from, mut to) = (angle(start), angle(end));
    if to < from {
        to += std::f64::consts::TAU;
    }
    let at = |a: f64| {
        (
            (cx + rx * a.cos()).round() as i64,
            (cy - ry * a.sin()).round() as i64,
        )
    };
    [at(from), at((from + to) / 2.0), at(to)]
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
