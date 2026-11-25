//! The formula editor window, standalone or opened by an add-in for one formula.
//!
//! Owns: creating, warming and closing editor windows; passing the formula in and the result out.
//! Limits: the editor itself is ui/editor; what happens to the result belongs to `sessions`.
//! Windows and macOS only (Tauri).
//!
//! One window serves the add-ins, one formula at a time. It is created hidden when the app starts, so the first
//! formula opens without waiting for the page; it is shown for a formula and hidden again when the user cancels or
//! the inserted formula is accepted. The caller accepts an insert by converting it while the window is still open:
//! a formula that cannot be converted stays in the window, and the page shows why. Closing the window with the
//! title bar asks the page, which inserts a changed formula and cancels otherwise, so the user's edits are not lost.

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::sync::{mpsc, oneshot};

const WINDOW: &str = "editor";
/// How long the page may take to answer a close from the title bar before the formula is cancelled.
const CLOSE_ANSWER: Duration = Duration::from_secs(5);

/// The formula the editor opens with (ui/editor reads it).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInput {
    /// The formula's LaTeX, or none for a new formula.
    pub latex: Option<String>,
    pub display: bool,
    /// The size of the text the formula goes into, in points.
    pub font_size_pt: f64,
}

/// How the editor was left.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Outcome {
    /// The user inserted the formula: its rows as LaTeX, one per line, and the size chosen for it.
    #[serde(rename_all = "camelCase")]
    Inserted {
        latex: String,
        font_size_pt: f64,
    },
    Cancelled,
}

/// Why a formula could not be edited.
#[derive(Debug)]
pub enum EditError {
    /// Another formula is open; its window has been brought to the front.
    Busy,
    Window(tauri::Error),
}

impl From<tauri::Error> for EditError {
    fn from(error: tauri::Error) -> Self {
        EditError::Window(error)
    }
}

/// What the page sent for the open formula; an insert waits for the caller's verdict.
enum Submission {
    Inserted {
        latex: String,
        font_size_pt: f64,
        verdict: oneshot::Sender<Result<(), String>>,
    },
    Cancelled,
}

struct Open {
    /// Tells this formula from the next one (a late close from the title bar must not end a newer formula).
    number: u64,
    input: EditorInput,
    submissions: mpsc::UnboundedSender<Submission>,
}

/// The formula open in the window, if any (Tauri managed state).
#[derive(Default)]
pub struct Editor {
    open: Mutex<Option<Open>>,
    opened: Mutex<u64>,
    /// Counts the page's answers: a close from the title bar that got one is not cancelled.
    answers: AtomicU64,
}

/// Creates the hidden editor window; called once when the app starts.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("editor.html".into()))
        .title(protocol::product::NAME)
        .inner_size(852.0, 500.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .visible(false)
        .focused(false)
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move { close_from_title_bar(&handle).await });
        }
    });
    Ok(())
}

/// Opens `input` in the editor until the user cancels it (`None`) or inserts a formula `accept` takes: `accept` gets
/// the inserted LaTeX and size while the window stays open; its error message goes back to the page, which keeps
/// the formula for the user to correct.
pub async fn edit<T, A, F>(
    app: &AppHandle,
    input: EditorInput,
    mut accept: A,
) -> Result<Option<T>, EditError>
where
    A: FnMut(String, f64) -> F,
    F: Future<Output = Result<T, String>>,
{
    let window = window(app);
    let mut submissions = {
        let editor = app.state::<Editor>();
        let mut open = editor.open.lock().expect("editor state lock");
        if open.is_some() {
            drop(open);
            bring_to_front(&window)?;
            return Err(EditError::Busy);
        }
        let mut opened = editor.opened.lock().expect("editor state lock");
        *opened += 1;
        let (sender, submissions) = mpsc::unbounded_channel();
        *open = Some(Open {
            number: *opened,
            input,
            submissions: sender,
        });
        submissions
    };
    // the page stays loaded between formulas and reads the new one when told
    window.emit("editor-open", ())?;
    bring_to_front(&window)?;
    let result = loop {
        // the channel closes without a submission only when the app shuts down
        match submissions.recv().await.unwrap_or(Submission::Cancelled) {
            Submission::Cancelled => break None,
            Submission::Inserted {
                latex,
                font_size_pt,
                verdict,
            } => match accept(latex, font_size_pt).await {
                Ok(accepted) => {
                    // fails only when the page went away meanwhile
                    let _ = verdict.send(Ok(()));
                    break Some(accepted);
                }
                Err(message) => {
                    let _ = verdict.send(Err(message));
                }
            },
        }
    };
    app.state::<Editor>()
        .open
        .lock()
        .expect("editor state lock")
        .take();
    window.hide()?;
    Ok(result)
}

/// Ends the open formula without a result and hides the window: its add-in went away, and the `edit` waiting for it
/// was dropped with the request.
pub fn abort(app: &AppHandle) -> tauri::Result<()> {
    app.state::<Editor>()
        .open
        .lock()
        .expect("editor state lock")
        .take();
    window(app).hide()
}

/// Cancels the open formula, if it is formula `number` (or any formula when none is given); says whether it did.
fn end(app: &AppHandle, number: Option<u64>) -> bool {
    let editor = app.state::<Editor>();
    let open = editor.open.lock().expect("editor state lock");
    match (open.as_ref(), number) {
        (Some(open), Some(number)) if open.number != number => false,
        // fails only when `edit` has stopped listening (the formula is ending anyway)
        (Some(open), _) => open.submissions.send(Submission::Cancelled).is_ok(),
        (None, _) => false,
    }
}

/// The formula the page shows: asked when the page loads and on every `editor-open`.
#[tauri::command]
pub fn editor_input(editor: State<Editor>) -> Option<EditorInput> {
    editor
        .open
        .lock()
        .expect("editor state lock")
        .as_ref()
        .map(|open| open.input.clone())
}

/// The user inserted or cancelled the formula. An insert is answered when it is accepted, or with the reason it
/// cannot be (the formula stays open then).
#[tauri::command]
pub async fn editor_done(editor: State<'_, Editor>, outcome: Outcome) -> Result<(), String> {
    editor.answers.fetch_add(1, Ordering::Relaxed);
    let Some(submissions) = editor
        .open
        .lock()
        .expect("editor state lock")
        .as_ref()
        .map(|open| open.submissions.clone())
    else {
        return Ok(());
    };
    match outcome {
        Outcome::Cancelled => {
            // fails only when the formula ended meanwhile
            let _ = submissions.send(Submission::Cancelled);
            Ok(())
        }
        Outcome::Inserted {
            latex,
            font_size_pt,
        } => {
            let (verdict, answer) = oneshot::channel();
            let submission = Submission::Inserted {
                latex,
                font_size_pt,
                verdict,
            };
            if submissions.send(submission).is_err() {
                return Ok(());
            }
            // no verdict: the formula ended meanwhile (its add-in went away)
            answer.await.unwrap_or(Ok(()))
        }
    }
}

async fn close_from_title_bar(app: &AppHandle) {
    let editor = app.state::<Editor>();
    let number = editor
        .open
        .lock()
        .expect("editor state lock")
        .as_ref()
        .map(|open| open.number);
    let window = window(app);
    let Some(number) = number else {
        // no formula is open (the window is shown only for one): just hide it
        let _ = window.hide();
        return;
    };
    let answers = editor.answers.load(Ordering::Relaxed);
    if window.emit("editor-close-requested", ()).is_ok() {
        tokio::time::sleep(CLOSE_ANSWER).await;
        // the page answered: the formula ended, or it stays open with the reason it cannot be inserted
        if editor.answers.load(Ordering::Relaxed) != answers {
            return;
        }
    }
    // the page did not answer in time, or could not be told: cancel this formula
    end(app, Some(number));
}

fn window(app: &AppHandle) -> WebviewWindow {
    app.get_webview_window(WINDOW)
        .expect("the editor window is created at start")
}

/// Shows the window in front of the host. The add-in allows this (AllowSetForegroundWindow) before it asks.
fn bring_to_front(window: &WebviewWindow) -> tauri::Result<()> {
    window.show()?;
    window.unminimize()?;
    // briefly topmost: Windows otherwise flashes the taskbar button instead of raising the window of another process
    window.set_always_on_top(true)?;
    window.set_focus()?;
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        // the window may be gone when the app quits meanwhile
        let _ = window.set_always_on_top(false);
    });
    Ok(())
}
