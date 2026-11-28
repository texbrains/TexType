//! Probe equations for the picture corpus' spacing-setting runs: one test equation as MTEF, and one copy per
//! spacing setting (EQN_PREFS spaces) with that setting doubled (20 where it is zero). MathType 6.9 draws them
//! (kit render-loop.ps1) and the pictures show what each setting moves. The test equation may also be an MTEF file;
//! then copies at other full sizes (18, 24 pt) are written too.
//!   cargo run -p convert --example mtef_vary -- <out dir> [structures | spacing | <file.mtef>]

use convert::mathtype::mtef::{self, Record};

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args
        .next()
        .expect("usage: mtef_vary <out dir> [structures | spacing | <file.mtef>]");
    let set = args.next().unwrap_or_else(|| "structures".into());
    // operators, relations, a function, text, tall fences, a box, a strike, arrows, a sign without limits
    let spacing = concat!(
        "<math><mi>a</mi><mo>+</mo><mi>b</mi><mo>=</mo><mi>c</mi><mo>&#x2212;</mo><mi>d</mi><mo>&#xD7;</mo><mi>e</mi>",
        "<mo>&lt;</mo><mi>f</mi><mo>,</mo><mi>g</mi><mi>sin</mi><mo>&#x2061;</mo><mi>x</mi><mtext>if</mtext><mi>y</mi>",
        "<mrow><mo>{</mo><mfrac><mfrac><mi>h</mi><mi>j</mi></mfrac><mi>k</mi></mfrac><mo>}</mo></mrow>",
        "<menclose notation=\"box\"><mi>m</mi></menclose><menclose notation=\"updiagonalstrike\"><mi>n</mi></menclose>",
        "<mover><mi>p</mi><mo>&#x2192;</mo></mover><mo>&#x2211;</mo><mi>q</mi><mo>&#x222B;</mo><mi>r</mi><mo>&#x2202;</mo><mi>s</mi>",
        "<mo>|</mo><mi>t</mi><mo>|</mo><msup><mi>u</mi><mrow><mo>&#x2032;</mo><mo>&#x2032;</mo></mrow></msup></math>"
    );
    let structures = concat!(
        "<math><mtable><mtr><mtd>",
        "<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup><mo>+</mo><mfrac><mi>a</mi><mi>b</mi></mfrac>",
        "<mo>+</mo><msqrt><mi>y</mi></msqrt><mo>+</mo><mroot><mi>z</mi><mn>3</mn></mroot>",
        "<mo>+</mo><munderover><mo>&#x2211;</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>k</mi>",
        "<mo>+</mo><msubsup><mo>&#x222B;</mo><mn>0</mn><mn>1</mn></msubsup><mi>t</mi>",
        "</mtd></mtr><mtr><mtd>",
        "<mrow><mo>(</mo><mtable><mtr><mtd><mi>p</mi></mtd><mtd><mi>q</mi></mtd></mtr><mtr><mtd><mi>r</mi></mtd><mtd><mi>s</mi></mtd></mtr></mtable><mo>)</mo></mrow>",
        "<mo>+</mo><mover><mi>u</mi><mo>^</mo></mover><mo>+</mo><msup><mi>v</mi><mo>&#x2032;</mo></msup>",
        "<mo>+</mo><mover><mi>w</mi><mo>&#xAF;</mo></mover><mo>+</mo><munder><mo>lim</mo><mrow><mi>h</mi><mo>&#x2192;</mo><mn>0</mn></mrow></munder><mi>h</mi>",
        "<mo>+</mo><mrow><mo>[</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>]</mo></mrow><mo>+</mo><msub><mi>e</mi><msub><mi>f</mi><mi>g</mi></msub></msub>",
        "</mtd></mtr></mtable></math>"
    );
    let mathml = if set == "spacing" {
        spacing
    } else {
        structures
    };
    let from_file = set.ends_with(".mtef");
    let base = if from_file {
        mtef::read(&std::fs::read(&set).expect("readable MTEF")).expect("MTEF")
    } else {
        convert::mathtype::write::from_mathml(mathml, true).expect("test equation")
    };
    std::fs::create_dir_all(&dir).expect("output folder");
    std::fs::write(format!("{dir}/vary-base.mtef"), mtef::write(&base)).expect("written");
    let at = base
        .records
        .iter()
        .position(|r| matches!(r, Record::EqnPrefs(_)))
        .expect("prefs");
    let Record::EqnPrefs(prefs) = &base.records[at] else {
        unreachable!()
    };
    let spaces = dims(&prefs.spaces);
    if std::env::var("PRINT").is_ok() {
        for (index, (unit, value)) in spaces.iter().enumerate() {
            println!("space {index:02}: unit {unit} value {value}");
        }
    }
    // SET="<index>:<value>,<value>;...": instead of doubling each setting, copies with those settings at those
    // values (set-<index>-<value>.mtef), the unit kept
    if let Ok(set) = std::env::var("SET") {
        for part in set.split(';').filter(|p| !p.is_empty()) {
            let (index, values) = part.split_once(':').expect("<index>:<values>");
            let index: usize = index.parse().expect("setting index");
            for value in values.split(',') {
                let mut changed = spaces.clone();
                changed[index].1 = value.to_string();
                let mut model = base.clone();
                if let Record::EqnPrefs(prefs) = &mut model.records[at] {
                    prefs.spaces = encode_dims(&changed);
                }
                std::fs::write(
                    format!("{dir}/set-{index:02}-{value}.mtef"),
                    mtef::write(&model),
                )
                .expect("written");
            }
        }
        return;
    }
    for index in 0..spaces.len() {
        let mut values = spaces.clone();
        let (unit, value) = &values[index];
        let number: f64 = value.parse().unwrap_or(0.0);
        let changed = if number == 0.0 { 20.0 } else { number * 2.0 };
        values[index] = (*unit, format!("{changed}"));
        let mut model = base.clone();
        if let Record::EqnPrefs(prefs) = &mut model.records[at] {
            prefs.spaces = encode_dims(&values);
        }
        std::fs::write(format!("{dir}/vary-{index:02}.mtef"), mtef::write(&model))
            .expect("written");
    }
    if from_file {
        // the full size (the first size setting) at 18 and 24 pt (SIZES="10,14,...": those; SIZE_INDEX=<n>: the
        // n-th size setting instead, 1 the subscript size, written as size<n>-<points>.mtef)
        let sizes: Vec<String> = std::env::var("SIZES")
            .ok()
            .map(|s| s.split(',').map(str::to_string).collect())
            .unwrap_or_else(|| vec!["18".into(), "24".into()]);
        let which: usize = std::env::var("SIZE_INDEX")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        for points in sizes {
            let mut sizes = dims(&prefs.sizes);
            sizes[which] = (2, points.clone());
            let mut model = base.clone();
            if let Record::EqnPrefs(prefs) = &mut model.records[at] {
                prefs.sizes = encode_dims(&sizes);
            }
            let name = if which == 0 {
                format!("{dir}/size-{points}.mtef")
            } else {
                format!("{dir}/size{which}-{points}.mtef")
            };
            std::fs::write(name, mtef::write(&model)).expect("written");
        }
    }
    println!("base and {} variants written to {dir}", spaces.len());
}

/// An EQN_PREFS dimension array: a count, then per dimension a unit nibble (0 in, 1 cm, 2 pt, 3 pc, 4 %) and digit
/// nibbles (A '.', B '-') ending with F; as (unit, value text).
fn dims(bytes: &[u8]) -> Vec<(u8, String)> {
    let Some((&count, rest)) = bytes.split_first() else {
        return Vec::new();
    };
    let nibbles: Vec<u8> = rest.iter().flat_map(|b| [b >> 4, b & 0x0F]).collect();
    let (mut out, mut at) = (Vec::new(), 0);
    while out.len() < count as usize && at < nibbles.len() {
        let unit = nibbles[at];
        at += 1;
        let mut value = String::new();
        while at < nibbles.len() && nibbles[at] != 0x0F {
            value.push(match nibbles[at] {
                0x0A => '.',
                0x0B => '-',
                d => char::from(b'0' + d),
            });
            at += 1;
        }
        at += 1;
        out.push((unit, value));
    }
    out
}

fn encode_dims(values: &[(u8, String)]) -> Vec<u8> {
    let mut nibbles = Vec::new();
    for (unit, value) in values {
        nibbles.push(*unit);
        nibbles.extend(value.chars().map(|c| match c {
            '.' => 0x0A,
            '-' => 0x0B,
            d => d as u8 - b'0',
        }));
        nibbles.push(0x0F);
    }
    if nibbles.len() % 2 == 1 {
        nibbles.push(0);
    }
    let mut bytes = vec![values.len() as u8];
    bytes.extend(nibbles.chunks(2).map(|pair| pair[0] << 4 | pair[1]));
    bytes
}
