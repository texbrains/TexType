// Tauri's build step (window manifest, icons, embedded interface) on Windows and macOS only.
fn main() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if os == "windows" || os == "macos" {
        tauri_build::build();
    }
}
