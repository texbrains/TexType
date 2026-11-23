//! The engine must reproduce the reference results of the original Python
//! implementation (`fixtures/python_reference.json`) exactly.
//!
//! Models are read from `$MATHCRAFT_MODELS`; the test is skipped with a
//! notice when the variable is not set or a model is missing.

use mathcraft::modelhub;
use mathcraft::ocr::{imageops, Engine, FormulaBuilds, Mode};
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

#[test]
fn matches_python_reference_for_every_mode() {
    let Some(root) = std::env::var_os("MATHCRAFT_MODELS").map(PathBuf::from) else {
        eprintln!("SKIP: MATHCRAFT_MODELS is not set");
        return;
    };
    let reference: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures().join("python_reference.json")).unwrap(),
    )
    .unwrap();
    let engine = Engine::new(&root);
    let mut checked = 0;
    for (name, case) in reference.as_object().unwrap() {
        let mode: Mode = serde_json::from_value(case["mode"].clone()).unwrap();
        let missing: Vec<&str> = mode
            .required_models(FormulaBuilds::default())
            .into_iter()
            .filter(|id| !modelhub::is_installed(&root, id))
            .collect();
        if !missing.is_empty() {
            eprintln!("SKIP {name}: models not installed: {}", missing.join(", "));
            continue;
        }
        let bytes = std::fs::read(fixtures().join(format!("{name}.png"))).unwrap();
        let image = imageops::decode_rgb(&bytes).unwrap();
        let got = engine.recognize(&image, mode).unwrap();
        assert_eq!(got.text, case["text"].as_str().unwrap(), "fixture {name}");
        checked += 1;
    }
    eprintln!("parity: {checked} fixture(s) identical to the Python reference");
}
