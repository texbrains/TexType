//! The visible application: main window, tray icon, global shortcuts, staying in the background.
//!
//! Owns: window and tray lifetime, the single-instance rule.
//! Limits: no feature logic; it opens windows and forwards to the other modules.
//! Windows and macOS only (Tauri). The interface shown in the window is ui/app-ui.

/// Opens the main window and runs until the user quits.
pub fn run() -> anyhow::Result<()> {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .map_err(|error| anyhow::anyhow!("the window could not start: {error}"))
}
