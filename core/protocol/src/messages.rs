//! The messages: UTF-8 JSON, one request and one response with the same `id`. Every channel (named pipe,
//! AppleScriptTask with files, loopback HTTP) carries exactly these.

use serde::{Deserialize, Serialize};
use settings::UserSettings;

/// Version of the app <-> add-in protocol. A peer with another version is refused with a clear message instead of
/// being half understood.
pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    pub body: RequestBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RequestBody {
    /// The first message of every connection.
    Hello(Hello),
    /// The user's settings (requirement A5: add-ins keep none of their own).
    GetSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: u32,
    pub host: Host,
    pub host_version: String,
    pub addin_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Host {
    #[serde(rename = "word")]
    Word,
    #[serde(rename = "powerpoint")]
    PowerPoint,
    #[serde(rename = "wps-writer")]
    WpsWriter,
    #[serde(rename = "wps-presentation")]
    WpsPresentation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    pub body: ResponseBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ResponseBody {
    #[serde(rename_all = "camelCase")]
    Welcome {
        protocol: u32,
        app_version: String,
    },
    Settings {
        settings: UserSettings,
    },
    Error {
        code: ErrorCode,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    /// The add-in speaks another protocol version than the app.
    ProtocolMismatch,
    /// The request is not a message of this protocol.
    BadRequest,
}

/// The answer to a `hello`: welcome, or a refusal when the versions differ.
pub fn welcome(hello: &Hello, app_version: &str) -> ResponseBody {
    if hello.protocol == PROTOCOL_VERSION {
        ResponseBody::Welcome {
            protocol: PROTOCOL_VERSION,
            app_version: app_version.to_owned(),
        }
    } else {
        ResponseBody::Error {
            code: ErrorCode::ProtocolMismatch,
            message: format!(
                "the add-in speaks protocol {} and the app speaks {PROTOCOL_VERSION}; install the same release of both",
                hello.protocol
            ),
        }
    }
}

/// Reads a request strictly: valid UTF-8 and a known message. The error text is sent back with `bad-request`.
pub fn decode_request(bytes: &[u8]) -> Result<Request, String> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| "the request is not valid UTF-8".to_owned())?;
    serde_json::from_str(text)
        .map_err(|error| format!("the request is not a known message: {error}"))
}

pub fn encode_response(response: &Response) -> Vec<u8> {
    serde_json::to_vec(response).expect("a response always serializes")
}
