//! The user's defaults: the style a new formula gets, and how a MathType equation's double-click is handled.

use formula_format::{Faces, Style};
use serde::{Deserialize, Serialize};

/// A setting missing from the file has its default value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserSettings {
    pub style: StyleDefaults,
    /// Double-clicking a MathType equation opens our editor; when false, MathType opens it while MathType is
    /// installed (without MathType our editor always opens).
    pub mathtype_double_click_opens_editor: bool,
}

/// The style of a new formula. The sizes follow the surrounding text unless set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleDefaults {
    pub font_profile: String,
    pub faces: Faces,
    pub math_style: String,
    pub cjk_font: String,
    pub color: String,
    pub inline_size_pt: Option<f64>,
    pub display_size_pt: Option<f64>,
}

impl Default for UserSettings {
    fn default() -> Self {
        UserSettings {
            style: StyleDefaults::default(),
            mathtype_double_click_opens_editor: true,
        }
    }
}

impl Default for StyleDefaults {
    fn default() -> Self {
        let profile = || "profile".to_owned();
        StyleDefaults {
            font_profile: "cm".into(),
            faces: Faces {
                letters: profile(),
                greek: profile(),
                digits: profile(),
            },
            math_style: "default".into(),
            cjk_font: "system".into(),
            color: "#000000".into(),
            inline_size_pt: None,
            display_size_pt: None,
        }
    }
}

impl StyleDefaults {
    /// The complete style of a new formula; `text_size_pt` is the size of the text where it is inserted.
    pub fn style_for(&self, display: bool, text_size_pt: f64) -> Style {
        let configured = if display {
            self.display_size_pt
        } else {
            self.inline_size_pt
        };
        Style {
            font_profile: self.font_profile.clone(),
            faces: self.faces.clone(),
            math_style: self.math_style.clone(),
            cjk_font: self.cjk_font.clone(),
            size_pt: configured.unwrap_or(text_size_pt),
            color: self.color.clone(),
        }
    }
}
