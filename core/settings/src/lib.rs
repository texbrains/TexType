//! The one settings store shared by the main app and every add-in.
//!
//! Owns:
//! - the settings file, its schema version, reading and writing it
//! - the three scopes and their precedence: user defaults < document preferences < one formula's own style
//! - preset export and import
//!
//! In and out: settings file  <->  typed settings; (user, document, formula) values  ->  the effective value
//!
//! Limits:
//! - no second copy: add-ins keep no settings of their own and ask through the protocol
//!
//! Where the first version of this code comes from: docs/SOURCES.md.
