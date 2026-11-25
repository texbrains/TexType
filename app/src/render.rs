//! Headless rendering for the add-ins: LaTeX to SVG, size and baseline, and LaTeX to MathML.
//!
//! Owns: the hidden render page (ui/kernel, opened as ui/app-ui/render.html), the requests to it and their answers.
//! Limits: no Office formats (EMF, PNG and Word equations come from core/convert), no MathType pictures
//! (core/convert).
//! Windows and macOS only (the page runs in Tauri's web view).

use anyhow::{anyhow, bail, Context, Result};
use convert::pictures::{svg_document, Pictures};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const WINDOW: &str = "render";
/// How long one formula may take, the page's start included on the first request.
const TIMEOUT: Duration = Duration::from_secs(30);

/// One formula to draw (ui/kernel/src/render/page.ts reads it).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub latex: String,
    pub display: bool,
    pub font_size_px: f64,
    pub color: String,
    pub letter_font: String,
    pub chinese_font: String,
}

/// What the page is asked: a picture, or MathML for a Word equation.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum PageRequest<'a> {
    Svg(&'a RenderRequest),
    Mathml { latex: &'a str, display: bool },
}

#[derive(Clone, Serialize)]
struct Envelope<'a> {
    id: u64,
    #[serde(flatten)]
    request: PageRequest<'a>,
}

/// The picture: SVG `<defs>` and drawing in px around the formula's reference point (the left end of its
/// baseline), and how far it reaches left, right, above and below that point.
#[derive(Debug, Clone, Deserialize)]
pub struct Rendered {
    pub body: String,
    pub left: f64,
    pub right: f64,
    pub ascent: f64,
    pub descent: f64,
}

/// The page's answer: the picture or the MathML, or why the formula cannot be handled.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderResult {
    Svg(Rendered),
    Mathml(String),
    Error(String),
}

/// The page's state as the app sees it (Tauri managed state).
#[derive(Default)]
pub struct Renderer {
    ready: Mutex<bool>,
    ready_changed: Condvar,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Sender<RenderResult>>>,
}

/// Opens the hidden render page; called once when the app starts.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("render.html".into()))
        .visible(false)
        .skip_taskbar(true)
        .build()?;
    Ok(())
}

/// Draws one formula. Waits for the page's answer, so it never runs on the event loop's thread.
pub fn render(app: &AppHandle, request: &RenderRequest) -> Result<Rendered> {
    match ask(app, PageRequest::Svg(request))? {
        RenderResult::Svg(rendered) => Ok(rendered),
        RenderResult::Error(message) => bail!("{message}"),
        other => unreachable!("the render page answered a picture request with {other:?}"),
    }
}

/// One formula as Presentation MathML (ui/kernel's LaTeX to MathML). Waits like `render`.
pub fn mathml(app: &AppHandle, latex: &str, display: bool) -> Result<String> {
    match ask(app, PageRequest::Mathml { latex, display })? {
        RenderResult::Mathml(mathml) => Ok(mathml),
        RenderResult::Error(message) => bail!("{message}"),
        other => unreachable!("the render page answered a MathML request with {other:?}"),
    }
}

fn ask(app: &AppHandle, request: PageRequest) -> Result<RenderResult> {
    let renderer = app.state::<Renderer>();
    let ready = renderer.ready.lock().expect("render state lock");
    let (ready, _) = renderer
        .ready_changed
        .wait_timeout_while(ready, TIMEOUT, |ready| !*ready)
        .expect("render state lock");
    if !*ready {
        bail!(
            "the render page did not start within {} s",
            TIMEOUT.as_secs()
        );
    }
    drop(ready);
    let id = renderer.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = channel();
    renderer
        .pending
        .lock()
        .expect("render state lock")
        .insert(id, sender);
    app.emit_to(WINDOW, "render-request", Envelope { id, request })
        .context("the render request could not be sent")?;
    let answer = receiver.recv_timeout(TIMEOUT);
    renderer
        .pending
        .lock()
        .expect("render state lock")
        .remove(&id);
    answer.map_err(|_| {
        anyhow!(
            "the render page did not answer within {} s",
            TIMEOUT.as_secs()
        )
    })
}

/// The page is listening.
#[tauri::command]
pub fn render_ready(renderer: State<Renderer>) {
    *renderer.ready.lock().expect("render state lock") = true;
    renderer.ready_changed.notify_all();
}

/// The page's answer to request `id`.
#[tauri::command]
pub fn render_done(renderer: State<Renderer>, id: u64, result: RenderResult) {
    if let Some(sender) = renderer
        .pending
        .lock()
        .expect("render state lock")
        .remove(&id)
    {
        // fails only when the request gave up waiting (timeout); nothing reads this answer then
        let _ = sender.send(result);
    }
}

const USAGE: &str = "usage: app render <latex> [--display] [--times] [--emf <file>] [--png <file>]";

/// `app render <latex> [--display] [--times] [--emf <file>] [--png <file>]`: draws one formula with the hidden page
/// and prints it as an SVG file; with `--emf` or `--png` it also writes the previews a TexType OLE object holds.
pub fn command(args: &[String]) -> Result<bool> {
    if args.first().map(String::as_str) != Some("render") {
        return Ok(false);
    }
    let latex = args.get(1).context(USAGE)?.clone();
    let (mut display, mut times, mut emf, mut png) = (false, false, None, None);
    let mut options = args[2..].iter();
    while let Some(option) = options.next() {
        match option.as_str() {
            "--display" => display = true,
            "--times" => times = true,
            "--emf" => emf = Some(options.next().context(USAGE)?.clone()),
            "--png" => png = Some(options.next().context(USAGE)?.clone()),
            unknown => bail!("unknown option {unknown}\n{USAGE}"),
        }
    }
    let request = RenderRequest {
        latex,
        display,
        font_size_px: 16.0,
        color: "#000000".into(),
        letter_font: if times { "times" } else { "katex" }.into(),
        chinese_font: "system".into(),
    };
    crate::shell::run_task(move |app| {
        let r = render(app, &request)?;
        let svg = svg_document(&r.body, r.left, r.right, r.ascent, r.descent);
        println!("{svg}");
        if emf.is_some() || png.is_some() {
            let previews = Pictures::with_system_fonts()
                .previews(&svg, r.ascent as f32)
                .map_err(|error| anyhow!(error))?;
            if let Some(path) = &emf {
                std::fs::write(path, &previews.emf)
                    .with_context(|| format!("cannot write {path}"))?;
            }
            if let Some(path) = &png {
                std::fs::write(path, &previews.png)
                    .with_context(|| format!("cannot write {path}"))?;
            }
        }
        Ok(())
    })?;
    Ok(true)
}
