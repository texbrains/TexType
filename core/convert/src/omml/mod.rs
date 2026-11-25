//! Word equations (OMML), in both directions:
//! - `write`: MathML -> OMML, the numbered equation host (Word's own # and SEQ field) and the document's math font
//!   on every run;
//! - `read`: OMML -> MathML -> LaTeX, written the way people type it.
//!
//! Both are byte-exact ports of a C# converter running on .NET 8, so they reproduce .NET's XML tree, strings and
//! Unicode data (`dotnet`). testing/corpus/omml holds that converter's output; the ports must reproduce it exactly
//! (core/convert/tests/omml.rs). Errors are the C# exceptions as text ("InvalidDataException: ...").

mod dotnet;
mod read;
mod write;

/// How a numbered equation counts: the SEQ field and the chapter number in front of it.
#[derive(Clone, Copy, Debug)]
pub struct NumberStyle<'a> {
    /// the SEQ field's name ("Equation")
    pub sequence_name: &'a str,
    /// 0: one count through the document; 1-9: the heading level whose number comes first
    pub restart_heading_level: u32,
    /// between the chapter number and the equation number ("." or "-")
    pub heading_separator: &'a str,
    /// the number Word shows until it updates the fields
    pub initial_sequence_result: &'a str,
    /// a chapter number written as text instead of a STYLEREF field
    pub literal_heading_prefix: Option<&'a str>,
    /// restart the count at this value (\r) when it starts a chapter
    pub restart_sequence_value: Option<u32>,
}

/// One m:oMath for Presentation MathML (as MathJax writes it for our LaTeX).
pub fn mathml_to_omml(mathml: &str) -> Result<String, String> {
    let prepared = write::prep::prepare_mathml_for_omml(mathml)?;
    let projection = write::proj::project(&prepared.mathml)?;
    write::proj::finish_omml(
        &projection,
        &prepared.mathml,
        &prepared.nary_characters,
        prepared.is_block,
    )
}

/// The equation with Word's own number: the formula, "#" and the number in brackets as a SEQ field.
pub fn numbered_omml(omml: &str, style: &NumberStyle) -> Result<String, String> {
    write::proj::build_word_native_numbered_omml(
        omml,
        style.sequence_name,
        style.restart_heading_level,
        style.heading_separator,
        style.initial_sequence_result,
        style.literal_heading_prefix,
        style.restart_sequence_value,
    )
}

/// What goes into the document: the equation's single m:oMath, with the document's math font named on every
/// mathematical run and control property (normal text keeps the text font).
pub fn insertion_omml(omml: &str, math_font_name: &str) -> Result<String, String> {
    write::proj::apply_explicit_transfer_math_font(
        &write::proj::extract_single_omath(omml)?,
        math_font_name,
    )
}

/// The one m:oMath of Word's export of an equation, with the namespaces it uses.
pub fn extract_single_omath(xml: &str) -> Result<String, String> {
    write::proj::extract_single_omath(xml)
}

/// The math font an equation names (Cambria Math when none is given).
pub fn normalize_math_font_name(math_font_name: &str) -> String {
    write::proj::normalize_math_font_name(math_font_name)
}

/// One Word equation (an m:oMath or m:oMathPara element) as MathML, display="block" or "inline".
pub fn omml_to_mathml(omml: &str, display: bool) -> Result<String, String> {
    read::omml_to_mathml(omml, display)
}

/// MathML as LaTeX, the converter's literal form (`x^{2}`).
pub fn mathml_to_latex(mathml: &str) -> Result<String, String> {
    read::mathml_to_latex(mathml)
}

/// MathML read back from a Word equation as LaTeX written the way people type it (`x^2`). Word equations store no
/// TexType source, so this is all the user gets back.
pub fn word_equation_latex(mathml: &str) -> Result<String, String> {
    read::mathml_to_word_equation_latex(mathml)
}

#[cfg(test)]
mod tests {
    use super::NumberStyle;
    use std::fmt::Write as _;

    const STYLES: [(&str, NumberStyle); 5] = [
        ("continuous", style("Equation", 0, "", "1", None, None)),
        (
            "h1dot-literal",
            style("\u{516c}\u{5f0f}", 1, ".", "3", Some("2"), None),
        ),
        (
            "h1dash-auto-restart",
            style("Equation", 1, "-", "1", None, Some(1)),
        ),
        (
            "h2dot-literal-spaced",
            style("My Eq", 2, ".", "12", Some("2.3"), None),
        ),
        (
            "h2dash-auto-restart",
            style("\u{516c}\u{5f0f}", 2, "-", "1", None, Some(1)),
        ),
    ];

    const fn style<'a>(
        sequence_name: &'a str,
        restart_heading_level: u32,
        heading_separator: &'a str,
        initial_sequence_result: &'a str,
        literal_heading_prefix: Option<&'a str>,
        restart_sequence_value: Option<u32>,
    ) -> NumberStyle<'a> {
        NumberStyle {
            sequence_name,
            restart_heading_level,
            heading_separator,
            initial_sequence_result,
            literal_heading_prefix,
            restart_sequence_value,
        }
    }

    /// Where two texts part, with 40 characters before and 80 after, counted in characters.
    fn first_difference(expected: &str, actual: &str) -> String {
        let (expected, actual): (Vec<char>, Vec<char>) =
            (expected.chars().collect(), actual.chars().collect());
        let position = expected
            .iter()
            .zip(&actual)
            .position(|(e, a)| e != a)
            .unwrap_or(expected.len().min(actual.len()));
        let from = position.saturating_sub(40);
        let window = |text: &[char]| -> String {
            text[from.min(text.len())..text.len().min(position + 80)]
                .iter()
                .collect()
        };
        format!(
            "at character {position}: expected …{}… got …{}…",
            window(&expected),
            window(&actual)
        )
    }

    fn compare(
        failures: &mut Vec<String>,
        what: String,
        expected: &str,
        actual: Result<String, String>,
    ) {
        match actual {
            Ok(actual) if actual == expected => {}
            Ok(actual) => failures.push(format!("{what}: {}", first_difference(expected, &actual))),
            Err(error) => failures.push(format!("{what}: {error}")),
        }
    }

    /// MathML -> OMML for every row and, where the row has them, the numbered equation in the five number styles,
    /// and what goes into the document for both.
    fn check_rows(rows: &[serde_json::Value]) -> (usize, Vec<String>) {
        let mut failures = Vec::new();
        let mut checked = 0;
        for row in rows {
            let source = row["source"].as_str().unwrap_or("?");
            let (Some(mathml), Some(omml)) = (row["mathml"].as_str(), row["omml"].as_str()) else {
                continue;
            };
            checked += 1;
            compare(
                &mut failures,
                format!("{source}: OMML"),
                omml,
                super::mathml_to_omml(mathml),
            );
            if let Some(numbered) = row.get("numbered") {
                for (name, style) in &STYLES {
                    let Some(expected) = numbered[name].as_str() else {
                        continue;
                    };
                    compare(
                        &mut failures,
                        format!("{source} {name}"),
                        expected,
                        super::numbered_omml(omml, style),
                    );
                }
            }
            if let Some(insertions) = row.get("numberedInsertion") {
                for (name, style) in &STYLES {
                    let Some(expected) = insertions[name].as_str() else {
                        continue;
                    };
                    let actual = super::numbered_omml(omml, style)
                        .and_then(|numbered| super::insertion_omml(&numbered, "Cambria Math"));
                    compare(
                        &mut failures,
                        format!("{source} {name} insertion"),
                        expected,
                        actual,
                    );
                }
            }
            if let Some(expected) = row["insertion"].as_str() {
                let actual = super::insertion_omml(omml, "Cambria Math");
                compare(
                    &mut failures,
                    format!("{source} insertion"),
                    expected,
                    actual,
                );
            }
        }
        (checked, failures)
    }

    #[test]
    fn reproduces_the_reference_converter() {
        let rows: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../../testing/corpus/omml/mathml-to-omml.json"
        ))
        .expect("the corpus is JSON");
        let (checked, failures) = check_rows(&rows);
        assert!(checked > 100, "only {checked} reference rows");
        assert!(
            failures.is_empty(),
            "{} of {checked} differ:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// The whole reference corpus of the C# converter (3,176 formulas, kept outside the repository):
    /// `OMML_WRITE_CORPUS=<forward.json> cargo test -p convert -- --ignored full_reference_corpus`.
    #[test]
    #[ignore]
    fn reproduces_the_full_reference_corpus() {
        let path = std::env::var("OMML_WRITE_CORPUS").expect("set OMML_WRITE_CORPUS");
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(path).expect("the corpus is readable"))
                .expect("the corpus is JSON");
        let (checked, failures) = check_rows(&rows);
        let mut report = String::new();
        for failure in failures.iter().take(20) {
            let _ = writeln!(report, "{failure}");
        }
        assert!(
            failures.is_empty(),
            "{} of {checked} differ:\n{report}",
            failures.len()
        );
    }

    #[test]
    fn a_numbered_equation_holds_the_chapter_and_sequence_fields() {
        let omml = super::mathml_to_omml(
            "<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>",
        )
        .expect("converts");
        let numbered = super::numbered_omml(&omml, &STYLES[2].1).expect("numbers");
        let insertion = super::insertion_omml(&numbered, "Cambria Math").expect("inserts");
        assert!(insertion.contains(" STYLEREF 1 \\w \\* MERGEFORMAT "));
        assert!(insertion.contains(" SEQ Equation \\r 1 \\s 1 \\* ARABIC \\* MERGEFORMAT "));
        assert!(insertion.contains("Cambria Math"));
    }
}
