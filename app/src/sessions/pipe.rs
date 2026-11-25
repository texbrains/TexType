//! The Windows named pipe the add-ins connect to: `\\.\pipe\<pipe_name>-<Windows session id>`, one pipe instance
//! per connection, messages framed as core/protocol says. The pipe's default security lets only this user (and
//! administrators) write to it; remote clients are refused.

use super::edit_equation;
use protocol::{
    decode_request, encode_response, frame, welcome, ErrorCode, Request, RequestBody, Response,
    ResponseBody, MAX_MESSAGE_BYTES,
};
use std::io;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

/// Starts listening. Fails when the pipe exists already: another copy of the app is running for this user.
pub fn start(app: &AppHandle) -> io::Result<()> {
    let name = pipe_name();
    // A pipe belongs to the async runtime's reactor, so it is created inside the runtime.
    let first = tauri::async_runtime::block_on(async {
        ServerOptions::new().first_pipe_instance(true).create(&name)
    })?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move { serve(app, name, first).await });
    Ok(())
}

fn pipe_name() -> String {
    let mut session = 0u32;
    // SAFETY: plain Win32 calls; `session` is a valid out pointer for the call's duration.
    let found = unsafe {
        windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId(
            windows_sys::Win32::System::Threading::GetCurrentProcessId(),
            &mut session,
        )
    };
    assert!(found != 0, "a process always has a session id");
    format!(r"\\.\pipe\{}-{session}", protocol::product::PIPE_NAME)
}

async fn serve(app: AppHandle, name: String, mut listening: NamedPipeServer) {
    loop {
        if let Err(error) = listening.connect().await {
            eprintln!("an add-in could not connect: {error}");
            continue;
        }
        let connected = listening;
        listening = match ServerOptions::new().create(&name) {
            Ok(next) => next,
            Err(error) => {
                eprintln!("the add-ins' pipe could not be reopened: {error}");
                return;
            }
        };
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = connection(&app, connected).await {
                eprintln!("an add-in connection ended with an error: {error}");
            }
        });
    }
}

/// One add-in's connection: `hello`, then requests one at a time, until the add-in closes it.
async fn connection(app: &AppHandle, mut pipe: NamedPipeServer) -> io::Result<()> {
    let Some(bytes) = read_message(&mut pipe).await? else {
        return Ok(());
    };
    let accepted = match decode_request(&bytes) {
        Ok(Request {
            id,
            body: RequestBody::Hello(hello),
        }) => {
            let body = welcome(&hello, env!("CARGO_PKG_VERSION"));
            let accepted = matches!(body, ResponseBody::Welcome { .. });
            write_message(&mut pipe, &Response { id, body }).await?;
            accepted
        }
        Ok(request) => {
            let body = refusal(ErrorCode::BadRequest, "the first message must be hello");
            write_message(
                &mut pipe,
                &Response {
                    id: request.id,
                    body,
                },
            )
            .await?;
            false
        }
        Err(message) => {
            write_message(
                &mut pipe,
                &Response {
                    id: 0,
                    body: refusal(ErrorCode::BadRequest, &message),
                },
            )
            .await?;
            false
        }
    };
    if !accepted {
        return Ok(());
    }
    while let Some(bytes) = read_message(&mut pipe).await? {
        let request = match decode_request(&bytes) {
            Ok(request) => request,
            Err(message) => {
                write_message(
                    &mut pipe,
                    &Response {
                        id: 0,
                        body: refusal(ErrorCode::BadRequest, &message),
                    },
                )
                .await?;
                continue;
            }
        };
        let body = match request.body {
            RequestBody::Hello(_) => {
                refusal(ErrorCode::BadRequest, "hello is sent once per connection")
            }
            RequestBody::GetSettings => settings(app),
            RequestBody::EditEquation(edit) => {
                let mut probe = [0u8; 1];
                tokio::select! {
                    body = edit_equation(app, edit) => body,
                    // the add-in sends nothing while it waits: end of file, an error or stray bytes mean it is gone
                    _ = pipe.read(&mut probe) => {
                        if let Err(error) = crate::editor_window::abort(app) {
                            eprintln!("the editor could not be closed: {error}");
                        }
                        return Ok(());
                    }
                }
            }
        };
        write_message(
            &mut pipe,
            &Response {
                id: request.id,
                body,
            },
        )
        .await?;
    }
    Ok(())
}

fn settings(app: &AppHandle) -> ResponseBody {
    let path = match app.path().app_config_dir() {
        Ok(dir) => dir.join("settings.json"),
        Err(error) => {
            return refusal(
                ErrorCode::SettingsUnreadable,
                &format!("the settings folder is unknown: {error}"),
            )
        }
    };
    match settings::read(&path) {
        Ok(settings) => ResponseBody::Settings { settings },
        Err(error) => refusal(
            ErrorCode::SettingsUnreadable,
            &format!("the settings file cannot be read: {error}"),
        ),
    }
}

fn refusal(code: ErrorCode, message: &str) -> ResponseBody {
    ResponseBody::Error {
        code,
        message: message.to_owned(),
    }
}

/// The next message, or none when the add-in closed the pipe.
async fn read_message(pipe: &mut NamedPipeServer) -> io::Result<Option<Vec<u8>>> {
    let mut length = [0u8; 4];
    match pipe.read_exact(&mut length).await {
        Ok(_) => {}
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::UnexpectedEof | io::ErrorKind::BrokenPipe
            ) =>
        {
            return Ok(None)
        }
        Err(error) => return Err(error),
    }
    let length = u32::from_le_bytes(length) as usize;
    if length > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("a message of {length} bytes is too large"),
        ));
    }
    let mut message = vec![0; length];
    pipe.read_exact(&mut message).await?;
    Ok(Some(message))
}

async fn write_message(pipe: &mut NamedPipeServer, response: &Response) -> io::Result<()> {
    pipe.write_all(&frame(&encode_response(response))).await
}
