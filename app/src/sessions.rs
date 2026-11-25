//! One add-in request from start to finish: insert, edit, convert, recognise.
//!
//! Owns: the connection to each add-in (named pipe on Windows; AppleScriptTask with files for Word and
//! PowerPoint on macOS; loopback HTTP for WPS on macOS),
//! request routing, cancellation, the list of connected hosts.
//! Limits: messages are defined in core/protocol; this module only carries and routes them.
//!
//! Today: the Windows named pipe and the Word equation request. A connection starts with `hello`; an `editEquation`
//! opens the editor and is answered when the user cancels or inserts a formula that converts (one that does not
//! stays in the editor, which says why). If the add-in goes away meanwhile (Word closes, the pipe drops), the
//! formula is cancelled and the editor closes.

#[cfg(windows)]
mod pipe;

#[cfg(windows)]
pub use pipe::start;

use crate::editor_window::{self, EditError, EditorInput};
use anyhow::{anyhow, Result};
use protocol::{EditEquation, ErrorCode, ResponseBody};
use tauri::AppHandle;

/// The answer to an `editEquation`: the equation the user inserted, `cancelled`, or why the editor could not run.
pub async fn edit_equation(app: &AppHandle, request: EditEquation) -> ResponseBody {
    let latex = match &request.word_open_xml {
        Some(xml) => match equation_latex(xml, request.display) {
            Ok(latex) => Some(latex),
            Err(message) => return error(ErrorCode::UnreadableEquation, message),
        },
        None => None,
    };
    let input = EditorInput {
        latex,
        display: request.display,
        font_size_pt: request.font_size_pt,
    };
    // the inserted formula is converted while the editor is open: a formula that does not convert stays there
    let convert = |latex: String, font_size_pt: f64| {
        let (app, math_font) = (app.clone(), request.math_font.clone());
        async move {
            tauri::async_runtime::spawn_blocking(move || {
                equation_omml(&app, &latex, request.display, &math_font)
            })
            .await
            .map_err(|error| format!("the conversion stopped: {error}"))?
            .map(|omml| (omml, font_size_pt))
            .map_err(|error| format!("{error:#}"))
        }
    };
    match editor_window::edit(app, input, convert).await {
        Ok(None) => ResponseBody::Cancelled,
        Ok(Some((omml, font_size_pt))) => ResponseBody::EquationEdited { omml, font_size_pt },
        Err(EditError::Busy) => error(
            ErrorCode::Busy,
            "another formula is open in the editor".into(),
        ),
        Err(EditError::Window(error)) => self::error(
            ErrorCode::EditorFailed,
            format!("the editor could not open: {error}"),
        ),
    }
}

/// A Word equation (its range's WordOpenXML) as the LaTeX the editor opens.
fn equation_latex(word_open_xml: &str, display: bool) -> Result<String, String> {
    let mathml = convert::omml::omml_to_mathml(word_open_xml, display)?;
    convert::omml::word_equation_latex(&mathml)
}

/// The edited LaTeX as the m:oMath to import, naming the document's math font. Waits for the render page.
fn equation_omml(app: &AppHandle, latex: &str, display: bool, math_font: &str) -> Result<String> {
    let mathml = crate::render::mathml(app, latex, display)?;
    let omml = convert::omml::mathml_to_omml(&mathml).map_err(|error| anyhow!(error))?;
    convert::omml::insertion_omml(&omml, math_font).map_err(|error| anyhow!(error))
}

fn error(code: ErrorCode, message: String) -> ResponseBody {
    ResponseBody::Error { code, message }
}

const USAGE: &str = "usage: app equation <latex> [--display] [--math-font <name>]";

/// `app equation <latex> [--display] [--math-font <name>]`: prints the Word equation (m:oMath) an add-in would
/// insert for the LaTeX, made the same way.
pub fn command(args: &[String]) -> Result<bool> {
    if args.first().map(String::as_str) != Some("equation") {
        return Ok(false);
    }
    let latex = args.get(1).ok_or_else(|| anyhow!(USAGE))?.clone();
    let (mut display, mut math_font) = (false, "Cambria Math".to_owned());
    let mut options = args[2..].iter();
    while let Some(option) = options.next() {
        match option.as_str() {
            "--display" => display = true,
            "--math-font" => math_font = options.next().ok_or_else(|| anyhow!(USAGE))?.clone(),
            unknown => return Err(anyhow!("unknown option {unknown}\n{USAGE}")),
        }
    }
    crate::shell::run_task(move |app| {
        println!("{}", equation_omml(app, &latex, display, &math_font)?);
        Ok(())
    })?;
    Ok(true)
}
