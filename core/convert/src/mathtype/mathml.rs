//! A MathML document as a small element tree, for writing MathType equations from it.

use quick_xml::encoding::Decoder;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

pub struct Element {
    /// the local name (no namespace prefix)
    pub name: String,
    pub attributes: Vec<(String, String)>,
    pub children: Vec<Node>,
}

pub enum Node {
    Element(Element),
    Text(String),
}

impl Element {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.trim())
    }

    pub fn elements(&self) -> impl Iterator<Item = &Element> {
        self.children.iter().filter_map(|node| match node {
            Node::Element(element) => Some(element),
            Node::Text(_) => None,
        })
    }

    /// A token's characters, without the white space around them.
    pub fn text(&self) -> String {
        let text: String = self
            .children
            .iter()
            .filter_map(|node| match node {
                Node::Text(text) => Some(text.as_str()),
                Node::Element(_) => None,
            })
            .collect();
        text.trim_matches(|c: char| c.is_ascii_whitespace())
            .to_string()
    }
}

/// The document's root element.
pub fn parse(xml: &str) -> Result<Element, String> {
    let mut reader = Reader::from_str(xml);
    let mut stack = vec![Element {
        name: String::new(),
        attributes: Vec::new(),
        children: Vec::new(),
    }];
    loop {
        match reader
            .read_event()
            .map_err(|error| format!("MathML: {error}"))?
        {
            Event::Start(start) => stack.push(element(&start, reader.decoder())?),
            Event::Empty(start) => {
                let element = element(&start, reader.decoder())?;
                stack
                    .last_mut()
                    .unwrap()
                    .children
                    .push(Node::Element(element));
            }
            Event::End(_) => {
                let element = stack.pop().unwrap();
                stack
                    .last_mut()
                    .ok_or("MathML: unbalanced end tag")?
                    .children
                    .push(Node::Element(element));
            }
            Event::Text(text) => {
                let text = text
                    .decode()
                    .map_err(|error| format!("MathML: {error}"))?
                    .into_owned();
                stack.last_mut().unwrap().children.push(Node::Text(text));
            }
            Event::GeneralRef(reference) => {
                let text = match reference
                    .resolve_char_ref()
                    .map_err(|error| format!("MathML: {error}"))?
                {
                    Some(c) => c.to_string(),
                    None => match reference
                        .decode()
                        .map_err(|error| format!("MathML: {error}"))?
                        .as_ref()
                    {
                        "lt" => "<".into(),
                        "gt" => ">".into(),
                        "amp" => "&".into(),
                        "quot" => "\"".into(),
                        "apos" => "'".into(),
                        other => return Err(format!("MathML: unknown entity &{other};")),
                    },
                };
                stack.last_mut().unwrap().children.push(Node::Text(text));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut document = stack
        .pop()
        .filter(|_| stack.is_empty())
        .ok_or("MathML: unclosed element")?;
    document
        .children
        .retain(|node| matches!(node, Node::Element(_)));
    match (document.children.pop(), document.children.is_empty()) {
        (Some(Node::Element(root)), true) => Ok(root),
        _ => Err("MathML: not one root element".into()),
    }
}

fn element(start: &BytesStart, decoder: Decoder) -> Result<Element, String> {
    let name = String::from_utf8_lossy(start.local_name().as_ref()).into_owned();
    let mut attributes = Vec::new();
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|error| format!("MathML: {error}"))?;
        let key = String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned();
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::Implicit1_0, decoder)
            .map_err(|error| format!("MathML: {error}"))?
            .into_owned();
        attributes.push((key, value));
    }
    Ok(Element {
        name,
        attributes,
        children: Vec::new(),
    })
}
