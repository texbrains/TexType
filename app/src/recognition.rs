//! Recognition: images, screenshots, PDF pages and handwriting to LaTeX or text.
//!
//! Owns: choosing the engine (built-in or an external provider), model
//! download and status, recognition jobs and their progress.
//! Limits: no capture (that is `platform`) and no window code. The engine itself
//! lives in the `mathcraft` crate.

use anyhow::{anyhow, bail, Result};
use mathcraft::modelhub;
use mathcraft::ocr::{imageops, Engine, FormulaBuilds, Mode};
use std::path::{Path, PathBuf};

const MODEL_IDS: [&str; 6] = [
    "mathcraft-formula-rec",
    "mathcraft-formula-rec-int8",
    "mathcraft-formula-det",
    "mathcraft-formula-det-int8",
    "mathcraft-text-det",
    "mathcraft-text-rec",
];

fn parse_mode(mode: &str) -> Result<Mode> {
    match mode {
        "formula" => Ok(Mode::Formula),
        "mixed" => Ok(Mode::Mixed),
        "text" => Ok(Mode::Text),
        other => bail!("unknown mode: {other}"),
    }
}

pub fn list_models(root: &Path) -> Vec<String> {
    MODEL_IDS
        .iter()
        .map(|id| {
            let state = if modelhub::is_installed(root, id) { "installed" } else { "missing" };
            format!("{id}: {state}")
        })
        .collect()
}

pub fn download_model(root: &Path, id: &str) -> Result<()> {
    let mut last = u64::MAX;
    modelhub::download(root, id, &mut |progress| {
        let done = progress.downloaded / (8 * 1024 * 1024);
        if done != last {
            last = done;
            eprintln!("{id}: {} MB", progress.downloaded / (1024 * 1024));
        }
    })
}

pub fn recognize_file(root: &Path, image: &Path, mode: &str) -> Result<String> {
    let mode = parse_mode(mode)?;
    let missing: Vec<&str> = mode
        .required_models(FormulaBuilds::default())
        .into_iter()
        .filter(|id| !modelhub::is_installed(root, id))
        .collect();
    if !missing.is_empty() {
        bail!("models not installed: {}", missing.join(", "));
    }
    let bytes = std::fs::read(image).map_err(|e| anyhow!("{}: {e}", image.display()))?;
    let rgb = imageops::decode_rgb(&bytes)?;
    Ok(Engine::new(root).recognize(&rgb, mode)?.text)
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn models_dir(args: &[String]) -> Result<PathBuf> {
    flag(args, "--models")
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("--models <dir> is required"))
}

/// The recognition commands of the command line. Returns false for any other command.
pub fn command(args: &[String]) -> Result<bool> {
    match (args.first().map(String::as_str), args.get(1).map(String::as_str)) {
        (Some("models"), Some("list")) => {
            for line in list_models(&models_dir(args)?) {
                println!("{line}");
            }
        }
        (Some("models"), Some("download")) => {
            let id = args.get(2).ok_or_else(|| anyhow!("models download <model-id>"))?;
            download_model(&models_dir(args)?, id)?;
        }
        (Some("ocr"), Some(image)) => {
            let mode = flag(args, "--mode").unwrap_or_else(|| "formula".into());
            println!("{}", recognize_file(&models_dir(args)?, image.as_ref(), &mode)?);
        }
        _ => return Ok(false),
    }
    Ok(true)
}
