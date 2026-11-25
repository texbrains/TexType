//! The visible application: main window, tray icon, global shortcuts, staying in the background.
//!
//! Owns: window and tray lifetime, the single-instance rule, the app's start (its hidden pages included).
//! Limits: no feature logic; it opens windows and forwards to the other modules.
//! Windows and macOS only (Tauri). The interface shown in the window is ui/app-ui.

use anyhow::anyhow;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

fn context() -> tauri::Context {
    tauri::generate_context!()
}

fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .manage(crate::render::Renderer::default())
        .manage(crate::editor_window::Editor::default())
        .invoke_handler(tauri::generate_handler![
            crate::render::render_ready,
            crate::render::render_done,
            crate::editor_window::editor_input,
            crate::editor_window::editor_done
        ])
}

/// Opens the main window and runs until the user quits.
pub fn run() -> anyhow::Result<()> {
    builder()
        .setup(|app| {
            crate::render::open(app.handle())?;
            crate::editor_window::create(app.handle())?;
            #[cfg(windows)]
            crate::sessions::start(app.handle())?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(protocol::product::NAME)
                .inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(context())
        .map_err(|error| anyhow!("the window could not start: {error}"))
}

/// Starts the app with its hidden pages and no visible window, runs `task` on a thread of its own (so it may wait
/// for the pages), reports its error, and quits; for commands such as `app render`.
pub fn run_task(
    task: impl FnOnce(&AppHandle) -> anyhow::Result<()> + Send + 'static,
) -> anyhow::Result<()> {
    builder()
        .setup(move |app| {
            crate::render::open(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || match task(&handle) {
                Ok(()) => handle.exit(0),
                Err(error) => {
                    eprintln!("Error: {error:#}");
                    handle.exit(1);
                }
            });
            Ok(())
        })
        .run(context())
        .map_err(|error| anyhow!("the app could not start: {error}"))
}
