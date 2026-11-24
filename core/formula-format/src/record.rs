//! The record of docs/FORMULA-FORMAT.md section 3 and the checks on its values.
//!
//! `format` and `version` are not fields here: they belong to the stored form (`stored.rs`), which checks them
//! before the rest is read and always writes the current ones.

use crate::error::Error;
use crate::stored::MAX_PREVIEW_BYTES;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub source: Source,
    pub numbering: Numbering,
    pub style: Style,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<Symbol>,
    pub layout: Layout,
    pub mathml: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    pub preview: Preview,
    pub created: Stamp,
    pub modified: Stamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub latex: String,
    /// The editor's rows, present only when there is more than one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<Line>,
    pub display: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub id: String,
    pub latex: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Numbering {
    pub mode: NumberingMode,
    /// The manual number text; present exactly when `mode` is manual.
    #[serde(default)]
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NumberingMode {
    None,
    Auto,
    Manual,
}

/// The complete style a formula was drawn with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub font_profile: String,
    pub faces: Faces,
    pub math_style: String,
    pub cjk_font: String,
    pub size_pt: f64,
    /// `#rrggbb`.
    pub color: String,
}

/// Which font draws letters, Greek letters and digits: "profile" (the font profile's own) or a font name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Faces {
    pub letters: String,
    pub greek: String,
    pub digits: String,
}

/// A custom symbol the formula uses, so that it draws on a computer without it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub command: String,
    pub class: SymbolClass,
    pub advance_em: f64,
    pub height_em: f64,
    pub depth_em: f64,
    /// SVG path data.
    pub path: String,
}

/// TeX's atom classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolClass {
    Ord,
    Op,
    Bin,
    Rel,
    Open,
    Close,
    Punct,
    Inner,
}

/// Derived: which engine drew the formula, and its natural size, baseline and ink bounds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub engine: String,
    /// Dotted numbers, e.g. "1.0.0".
    pub engine_version: String,
    pub width_pt: f64,
    pub height_pt: f64,
    pub baseline_pt: f64,
    pub ink_top_pt: f64,
    pub ink_bottom_pt: f64,
}

/// The format a converted formula came from, so converting back can restore the original.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Origin {
    pub format: String,
    /// `sha256:` and 64 hexadecimal digits.
    pub fingerprint: String,
}

/// Derived: hash and sizes of the two previews.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// 64 lowercase hexadecimal digits.
    pub sha256: String,
    pub emf_bytes: u64,
    pub png_bytes: u64,
}

/// Which release made or changed the formula, on which platform, when.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stamp {
    /// Dotted numbers, e.g. "1.0.0".
    pub app: String,
    pub platform: Platform,
    /// UTC, RFC 3339 with `Z`, e.g. "2026-11-23T08:30:00Z".
    pub at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
}

impl Record {
    /// Checks every value the types cannot express (section 3).
    pub fn validate(&self) -> Result<(), Error> {
        if !is_uuid(&self.id) {
            return Err(Error::invalid("id", "is not a lowercase UUID"));
        }
        self.source.validate()?;
        self.numbering.validate()?;
        self.style.validate()?;
        for symbol in &self.symbols {
            symbol.validate()?;
        }
        self.layout.validate()?;
        if !self.mathml.trim_start().starts_with("<math") {
            return Err(Error::invalid("mathml", "is not a MathML <math> element"));
        }
        if let Some(origin) = &self.origin {
            if origin.format.is_empty() {
                return Err(Error::invalid("origin.format", "is empty"));
            }
            if !origin
                .fingerprint
                .strip_prefix("sha256:")
                .is_some_and(is_sha256)
            {
                return Err(Error::invalid(
                    "origin.fingerprint",
                    "is not sha256: and 64 lowercase hexadecimal digits",
                ));
            }
        }
        self.preview.validate()?;
        self.created.validate("created")?;
        self.modified.validate("modified")
    }

    /// Section 4, rule 2: the derived data is stale when the preview's hash differs from the stored one or the
    /// formula was drawn by an older engine than the current one.
    pub fn is_stale(&self, engine_version: &str, preview_sha256: &str) -> bool {
        self.preview.sha256 != preview_sha256
            || version_numbers(&self.layout.engine_version) < version_numbers(engine_version)
    }
}

impl Source {
    fn validate(&self) -> Result<(), Error> {
        if self.latex.trim().is_empty() {
            return Err(Error::invalid("source.latex", "is empty"));
        }
        if self.lines.len() == 1 {
            return Err(Error::invalid(
                "source.lines",
                "has one row; it is present only for more than one",
            ));
        }
        let mut ids = HashSet::new();
        for line in &self.lines {
            if line.id.is_empty() || !ids.insert(line.id.as_str()) {
                return Err(Error::invalid(
                    "source.lines",
                    "has an empty or repeated row id",
                ));
            }
        }
        Ok(())
    }
}

impl Numbering {
    fn validate(&self) -> Result<(), Error> {
        match (self.mode, &self.tag) {
            (NumberingMode::Manual, Some(tag)) if !tag.trim().is_empty() => Ok(()),
            (NumberingMode::Manual, _) => Err(Error::invalid(
                "numbering.tag",
                "is missing for a manual number",
            )),
            (_, None) => Ok(()),
            (_, Some(_)) => Err(Error::invalid(
                "numbering.tag",
                "is set but the number is not manual",
            )),
        }
    }
}

impl Style {
    /// Also used for the user's default style in core/settings.
    pub fn validate(&self) -> Result<(), Error> {
        for (field, value) in [
            ("style.fontProfile", &self.font_profile),
            ("style.faces.letters", &self.faces.letters),
            ("style.faces.greek", &self.faces.greek),
            ("style.faces.digits", &self.faces.digits),
            ("style.mathStyle", &self.math_style),
            ("style.cjkFont", &self.cjk_font),
        ] {
            if value.trim().is_empty() {
                return Err(Error::invalid(field, "is empty"));
            }
        }
        if self.size_pt <= 0.0 {
            return Err(Error::invalid("style.sizePt", "is not a positive size"));
        }
        if !is_color(&self.color) {
            return Err(Error::invalid("style.color", "is not #rrggbb"));
        }
        Ok(())
    }
}

impl Symbol {
    fn validate(&self) -> Result<(), Error> {
        if !self.command.starts_with('\\') || self.command.len() < 2 {
            return Err(Error::invalid(
                "symbols.command",
                "is not a command such as \\name",
            ));
        }
        if self.advance_em < 0.0 {
            return Err(Error::invalid("symbols.advanceEm", "is negative"));
        }
        if self.path.trim().is_empty() {
            return Err(Error::invalid("symbols.path", "is empty"));
        }
        Ok(())
    }
}

impl Layout {
    fn validate(&self) -> Result<(), Error> {
        if self.engine.is_empty() {
            return Err(Error::invalid("layout.engine", "is empty"));
        }
        if version_numbers(&self.engine_version).is_empty() {
            return Err(Error::invalid(
                "layout.engineVersion",
                "is not a dotted version",
            ));
        }
        if self.width_pt < 0.0 || self.height_pt < 0.0 {
            return Err(Error::invalid("layout", "has a negative width or height"));
        }
        Ok(())
    }
}

impl Preview {
    fn validate(&self) -> Result<(), Error> {
        if !is_sha256(&self.sha256) {
            return Err(Error::invalid(
                "preview.sha256",
                "is not 64 lowercase hexadecimal digits",
            ));
        }
        if self.emf_bytes > MAX_PREVIEW_BYTES {
            return Err(Error::invalid("preview.emfBytes", "is over the 8 MB limit"));
        }
        if self.png_bytes > MAX_PREVIEW_BYTES {
            return Err(Error::invalid("preview.pngBytes", "is over the 8 MB limit"));
        }
        Ok(())
    }
}

impl Stamp {
    fn validate(&self, which: &'static str) -> Result<(), Error> {
        let (app, at) = match which {
            "created" => ("created.app", "created.at"),
            _ => ("modified.app", "modified.at"),
        };
        if version_numbers(&self.app).is_empty() {
            return Err(Error::invalid(app, "is not a dotted version"));
        }
        if !is_utc_timestamp(&self.at) {
            return Err(Error::invalid(
                at,
                "is not a UTC time such as 2026-11-23T08:30:00Z",
            ));
        }
        Ok(())
    }
}

/// "1.10.2" -> [1, 10, 2]; empty for anything that is not dotted decimal numbers.
fn version_numbers(text: &str) -> Vec<u32> {
    let parts: Option<Vec<u32>> = text
        .split('.')
        .map(|part| {
            if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                None
            } else {
                part.parse().ok()
            }
        })
        .collect();
    parts.unwrap_or_default()
}

fn is_lower_hex(text: &str) -> bool {
    text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64 && is_lower_hex(text)
}

fn is_uuid(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(group, len)| group.len() == len && is_lower_hex(group))
}

fn is_color(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// `YYYY-MM-DDThh:mm:ssZ`, optionally with fractional seconds before the `Z`.
fn is_utc_timestamp(text: &str) -> bool {
    let Some(body) = text.strip_suffix('Z') else {
        return false;
    };
    let (main, fraction) = match body.split_once('.') {
        Some((main, fraction)) => (main, Some(fraction)),
        None => (body, None),
    };
    let shape_ok = main.len() == 19
        && main.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            10 => b == b'T',
            13 | 16 => b == b':',
            _ => b.is_ascii_digit(),
        });
    let fraction_ok =
        fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));
    if !(shape_ok && fraction_ok) {
        return false;
    }
    let number =
        |range: std::ops::Range<usize>| main[range].parse::<u32>().expect("checked digits");
    (1..=12).contains(&number(5..7))
        && (1..=31).contains(&number(8..10))
        && number(11..13) < 24
        && number(14..16) < 60
        && number(17..19) < 61
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(version_numbers("1.9.0") < version_numbers("1.10.0"));
        assert!(version_numbers("1.0") < version_numbers("1.0.1"));
        assert!(version_numbers("1.x").is_empty());
        assert!(version_numbers("").is_empty());
    }

    #[test]
    fn timestamps_need_utc_and_real_fields() {
        assert!(is_utc_timestamp("2026-11-23T08:30:00Z"));
        assert!(is_utc_timestamp("2026-11-23T08:30:00.125Z"));
        assert!(!is_utc_timestamp("2026-11-23T08:30:00+08:00"));
        assert!(!is_utc_timestamp("2026-13-23T08:30:00Z"));
        assert!(!is_utc_timestamp("2026-11-23 08:30:00Z"));
    }
}
