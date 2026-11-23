//! Everything that differs between Windows and macOS, behind one interface per job.
//!
//! Owns: screen capture, global shortcuts, font installation, add-in registration, the transport
//! under each add-in channel.
//! Limits: no feature decisions; the other modules decide, this module does.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;
