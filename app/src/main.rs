//! The main application and the background service the add-ins talk to.
//!
//! One program with two faces: the light main window (formula editor,
//! recognition, settings) and the service behind the add-ins (editor windows,
//! rendering, recognition, settings, automation). On Windows and macOS it opens
//! its window with Tauri when started without arguments; with arguments, and on
//! other systems, it is a command line over the same modules.
//!
//! Each module below owns one job. A module talks to the core crates and to
//! `platform`; modules do not reach into each other's internals.

mod automation;
mod editor_window;
mod install;
#[cfg(feature = "legacy-import")]
mod legacy;
mod platform;
mod recognition;
mod render;
mod sessions;
#[cfg(any(windows, target_os = "macos"))]
mod shell;

use anyhow::{bail, Result};

const USAGE: &str = "usage:
  app version
  app models list --models <dir>
  app models download <model-id> --models <dir>
  app ocr <image> --models <dir> [--mode formula|mixed|text]";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(any(windows, target_os = "macos"))]
    if args.is_empty() {
        return shell::run();
    }
    if args.first().map(String::as_str) == Some("version") {
        println!(
            "{} {} (protocol {})",
            protocol::product::NAME,
            env!("CARGO_PKG_VERSION"),
            protocol::PROTOCOL_VERSION
        );
        return Ok(());
    }
    if recognition::command(&args)? {
        return Ok(());
    }
    bail!("{USAGE}")
}
