//! The MathML the reader builds: a small element tree, the drawing style of its tokens (written as mathvariant)
//! and its serializing.

/// How characters of one style are drawn: the font's family and the style's bold and italic.
#[derive(Clone, Copy, PartialEq, Default, Debug)]
pub(super) struct Style {
    pub(super) family: Family,
    pub(super) bold: bool,
    pub(super) italic: bool,
}

#[derive(Clone, Copy, PartialEq, Default, Debug)]
pub(super) enum Family {
    #[default]
    Plain,
    Script,
    DoubleStruck,
    Fraktur,
    SansSerif,
    Monospace,
}

/// Tokens of one run join into one token: a function name, a number, a piece of text.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(super) enum Run {
    Function,
    Number,
    Text,
}

#[derive(Clone, Debug, Default)]
pub(super) struct Node {
    pub(super) tag: &'static str,
    pub(super) attributes: Vec<(&'static str, String)>,
    pub(super) text: String,
    pub(super) children: Vec<Node>,
    /// tokens: the drawing style (written as mathvariant) and the run the token can grow in
    pub(super) style: Style,
    pub(super) run: Option<Run>,
    /// scripts that go before the node after them (mmultiscripts still without its base)
    pub(super) awaits_base: bool,
}

impl Node {
    pub(super) fn token(tag: &'static str, text: impl Into<String>) -> Node {
        Node {
            tag,
            text: text.into(),
            ..Node::default()
        }
    }

    pub(super) fn element(tag: &'static str, children: Vec<Node>) -> Node {
        Node {
            tag,
            children,
            ..Node::default()
        }
    }

    pub(super) fn with(mut self, name: &'static str, value: impl Into<String>) -> Node {
        self.attributes.push((name, value.into()));
        self
    }

    pub(super) fn is_token(&self) -> bool {
        matches!(self.tag, "mi" | "mn" | "mo" | "mtext" | "mspace")
    }

    pub(super) fn write(&self, out: &mut String) {
        out.push('<');
        out.push_str(self.tag);
        if let Some(variant) = self.mathvariant() {
            out.push_str(" mathvariant=\"");
            out.push_str(variant);
            out.push('"');
        }
        for (name, value) in &self.attributes {
            out.push(' ');
            out.push_str(name);
            out.push_str("=\"");
            escape(value, out);
            out.push('"');
        }
        if self.text.is_empty() && self.children.is_empty() {
            out.push_str("/>");
            return;
        }
        out.push('>');
        escape(&self.text, out);
        self.children.iter().for_each(|child| child.write(out));
        out.push_str("</");
        out.push_str(self.tag);
        out.push('>');
    }

    /// The mathvariant the token needs: none where MathML's default (italic for a one-letter mi, upright for the
    /// rest) is already the style.
    pub(super) fn mathvariant(&self) -> Option<&'static str> {
        if !matches!(self.tag, "mi" | "mn" | "mtext") {
            return None;
        }
        let Style {
            family,
            bold,
            italic,
        } = self.style;
        let variant = match (family, bold, italic) {
            (Family::Plain, false, false) => "normal",
            (Family::Plain, true, false) => "bold",
            (Family::Plain, false, true) => "italic",
            (Family::Plain, true, true) => "bold-italic",
            (Family::Script, false, _) => "script",
            (Family::Script, true, _) => "bold-script",
            (Family::DoubleStruck, ..) => "double-struck",
            (Family::Fraktur, false, _) => "fraktur",
            (Family::Fraktur, true, _) => "bold-fraktur",
            (Family::SansSerif, false, false) => "sans-serif",
            (Family::SansSerif, true, false) => "bold-sans-serif",
            (Family::SansSerif, false, true) => "sans-serif-italic",
            (Family::SansSerif, true, true) => "sans-serif-bold-italic",
            (Family::Monospace, ..) => "monospace",
        };
        let single_letter = self.tag == "mi" && self.text.chars().count() == 1;
        let default = if single_letter { "italic" } else { "normal" };
        (variant != default).then_some(variant)
    }
}

pub(super) fn escape(text: &str, out: &mut String) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
}

/// One node for a slot: the row itself when it holds one node.
pub(super) fn row_node(mut nodes: Vec<Node>) -> Node {
    if nodes.len() == 1 {
        nodes.pop().unwrap()
    } else {
        Node::element("mrow", nodes)
    }
}
