//! One add-in request from start to finish: insert, edit, convert, recognise.
//!
//! Owns: the connection to each add-in (named pipe on Windows; AppleScriptTask with files for Word and
//! PowerPoint on macOS; loopback HTTP for WPS on macOS),
//! request routing, cancellation, the list of connected hosts.
//! Limits: messages are defined in core/protocol; this module only carries and routes them.
