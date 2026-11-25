//! OMML -> MathML -> LaTeX:
//! - `omml_mathml`: OmmlMathMlProjection (our own replacement for Office's
//!   OMML2MML.XSL) and WordOmmlConverter.TransformOmmlToMathMl with its
//!   recovery passes;
//! - `mathml_latex`: MathMlToLatexConverter and the contracts it uses;
//! - `source_style`: the converter's LaTeX written the way people type it.

mod mathml_latex;
mod omml_mathml;
mod source_style;

/// TransformOmmlToMathMl: one Word equation (an m:oMath or m:oMathPara element)
/// as MathML in the MathML namespace, with display="block" or "inline".
pub(super) fn omml_to_mathml(omml: &str, display: bool) -> Result<String, String> {
    omml_mathml::omml_to_mathml(omml, display)
}

/// MathMlToLatexConverter.Convert.
pub(super) fn mathml_to_latex(mathml: &str) -> Result<String, String> {
    mathml_latex::mathml_to_latex(mathml)
}

/// MathMlToLatexConverter.ConvertWordEquation.
pub(super) fn mathml_to_word_equation_latex(mathml: &str) -> Result<String, String> {
    Ok(source_style::word_equation_source_style(&mathml_to_latex(
        mathml,
    )?))
}

/// A Word equation as editable LaTeX source.
#[cfg(test)]
fn omml_to_latex(omml: &str, display: bool) -> Result<String, String> {
    mathml_to_latex(&omml_to_mathml(omml, display)?)
}

#[cfg(test)]
mod tests {
    use crate::omml::dotnet::dom::{Doc, ParseOptions};

    #[test]
    fn reproduces_the_reference_converter() {
        let rows: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../testing/corpus/omml/omml-to-latex.json"
        ))
        .unwrap();
        let mut failures = Vec::new();
        let rows = rows.as_array().unwrap();
        for row in rows {
            let source = row["source"].as_str().unwrap();
            let omml = row["omml"].as_str().unwrap();
            let display = row["display"].as_bool().unwrap();
            let mathml = match super::omml_to_mathml(omml, display) {
                Ok(mathml) => mathml,
                Err(error) => {
                    failures.push(format!("{source}: {error}"));
                    continue;
                }
            };
            let parsed = Doc::parse(&mathml, ParseOptions::default()).unwrap();
            if parsed.canonical(parsed.root.unwrap()) != row["mathml"].as_str().unwrap() {
                failures.push(format!("{source}: MathML differs"));
                continue;
            }
            let latex =
                super::mathml_to_latex(&mathml).unwrap_or_else(|error| format!("ERR {error}"));
            if latex != row["latex"].as_str().unwrap() {
                failures.push(format!(
                    "{source}: {latex:?} != {:?}",
                    row["latex"].as_str().unwrap()
                ));
            }
        }
        assert!(rows.len() > 100);
        assert!(
            failures.is_empty(),
            "{} of {} differ:\n{}",
            failures.len(),
            rows.len(),
            failures.join("\n")
        );
    }

    /// The whole reference corpus of the C# converter (2,116 equations, kept outside the repository):
    /// `OMML_READ_CORPUS=<corpus.json> cargo test -p convert -- --ignored full_reference_corpus`.
    #[test]
    #[ignore]
    fn reproduces_the_full_reference_corpus() {
        let path = std::env::var("OMML_READ_CORPUS").expect("set OMML_READ_CORPUS");
        let text = std::fs::read_to_string(path).unwrap();
        let rows: serde_json::Value =
            serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap();
        let rows = rows.as_array().unwrap();
        let mut failures = Vec::new();
        for row in rows {
            let source = row["source"].as_str().unwrap();
            let omml = row["omml"].as_str().unwrap();
            let display = row["display"].as_bool().unwrap();
            let converted = super::omml_to_mathml(omml, display).and_then(|mathml| {
                let latex = super::mathml_to_latex(&mathml)?;
                Ok((mathml, latex))
            });
            match (converted, row.get("error")) {
                (Err(_), Some(_)) => {}
                (Ok(_), Some(error)) => {
                    failures.push(format!("{source}: the reference failed with {error}"))
                }
                (Err(error), None) => failures.push(format!("{source}: {error}")),
                (Ok((mathml, latex)), None) => {
                    let parsed = Doc::parse(&mathml, ParseOptions::default()).unwrap();
                    if parsed.canonical(parsed.root.unwrap())
                        != row["mathmlCanonical"].as_str().unwrap()
                    {
                        failures.push(format!("{source}: MathML differs"));
                    } else if latex != row["latex"].as_str().unwrap() {
                        failures.push(format!(
                            "{source}: {latex:?} != {:?}",
                            row["latex"].as_str().unwrap()
                        ));
                    } else if let Some(expected) = row
                        .get("wordEquationLatex")
                        .and_then(|value| value.as_str())
                    {
                        let styled = super::source_style::word_equation_source_style(&latex);
                        if styled != expected {
                            failures.push(format!("{source}: styled {styled:?} != {expected:?}"));
                        }
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} of {} differ:\n{}",
            failures.len(),
            rows.len(),
            failures.join("\n")
        );
    }

    /// The same table as OmmlLatexRoundTripTests.WordEquationLatexIsWrittenTheWayPeopleTypeIt.
    #[test]
    fn word_equation_latex_is_written_the_way_people_type_it() {
        for (converted, expected) in [
            (r#"x^{2}+y^{2}=z^{2}"#, r#"x^2+y^2=z^2"#),
            (
                r#"\int_{0}^{1}x^{2}\mathrm{d}x=\frac{1}{3}"#,
                r#"\int_0^1 x^2\mathrm{d}x=\frac{1}{3}"#,
            ),
            (
                r#"\sin^{2} \theta +\cos^{2} \theta =1"#,
                r#"\sin^2\theta+\cos^2\theta=1"#,
            ),
            (
                r#"x=\frac{-b\pm \sqrt{b^{2}-4ac}}{2a}"#,
                r#"x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}"#,
            ),
            (r#"f^{\prime}(x)"#, r#"f'(x)"#),
            (r#"f^{\prime \prime}"#, r#"f''"#),
            (
                r#"\left( \begin{matrix}1 & 2 \\ 3 & 4\end{matrix}\right)"#,
                r#"\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}"#,
            ),
            (
                r#"\left[ \begin{matrix}a\end{matrix}\right]"#,
                r#"\begin{bmatrix}a\end{bmatrix}"#,
            ),
            (
                r#"f(x)=\left\{ \begin{matrix}x, & x\ge 0 \\ -x, & x<0\end{matrix}\right."#,
                r#"f(x)=\begin{cases}x, & x\ge 0 \\ -x, & x<0\end{cases}"#,
            ),
            (
                r#"\left( \begin{matrix}1\end{matrix}\right\}"#,
                r#"\left(\begin{matrix}1\end{matrix}\right\}"#,
            ),
            (
                r#"\left( \frac{a}{b}\right)^{2}+\binom{n}{k}"#,
                r#"\left(\frac{a}{b}\right)^2+\binom{n}{k}"#,
            ),
            (
                r#"\lim\limits_{x\to 0} \frac{\sin x}{x}=1"#,
                r#"\lim\limits_{x\to 0}\frac{\sin x}{x}=1"#,
            ),
            (r#"\alpha +\beta =\gamma"#, r#"\alpha+\beta=\gamma"#),
            (r#"a_{ij}+x^{10}+e^{i\pi}"#, r#"a_{ij}+x^{10}+e^{i\pi}"#),
            (r#"\mathrm{H}_{2}\mathrm{O}"#, r#"\mathrm{H}_2\mathrm{O}"#),
            (r#"\text{a b} +1"#, r#"\text{a b}+1"#),
            (
                r#"\begin{aligned}a&=b+c \\ &=d\end{aligned}"#,
                r#"\begin{aligned}a&=b+c \\ &=d\end{aligned}"#,
            ),
            (r#"\frac{𝑎}{𝑏}"#, r#"\frac{a}{b}"#),
            (r#"\sqrt{{𝑏}^2-4𝑎𝑐}"#, r#"\sqrt{b^2-4ac}"#),
            (r#"\int_{0}^{1}{𝑥}^{2}𝑑𝑥=1"#, r#"\int_0^1 x^2 dx=1"#),
            (r#"\sin𝑥+\cos^{2}𝜃"#, r#"\sin x+\cos^2\theta"#),
            (r#"{𝑎}_{𝑖𝑗}"#, r#"a_{ij}"#),
            (r#"𝐀+𝔸+ℎ+𝟏"#, r#"\mathbf{A}+\mathbb{A}+h+\mathbf{1}"#),
            (r#"𝜋𝑟^2"#, r#"\pi r^2"#),
            (r#"\mathrm{x}^{2}"#, r#"\mathrm{x}^2"#),
        ] {
            assert_eq!(
                super::source_style::word_equation_source_style(converted),
                expected,
                "{converted}"
            );
        }
    }

    #[test]
    fn everyday_word_equations_read_back_as_written() {
        let ns = r#"xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math""#;
        let latex = |body: &str| {
            super::omml_to_latex(&format!("<m:oMath {ns}>{body}</m:oMath>"), false).unwrap()
        };
        let run = |text: &str| format!("<m:r><m:t>{text}</m:t></m:r>");
        let upright =
            |text: &str| format!("<m:r><m:rPr><m:sty m:val=\"p\"/></m:rPr><m:t>{text}</m:t></m:r>");
        assert_eq!(
            latex(&format!(
                "<m:func><m:fName>{}</m:fName><m:e>{}</m:e></m:func>",
                upright("sin"),
                run("x")
            )),
            r"\sin x"
        );
        assert_eq!(
            latex(&format!(
                "<m:limLow><m:e>{}</m:e><m:lim>{}{}</m:lim></m:limLow>",
                upright("lim"),
                run("x"),
                upright("→0")
            )),
            r"\lim\limits_{x\to 0}"
        );
        assert_eq!(
            latex(&format!(
                "<m:acc><m:accPr><m:chr m:val=\"\u{20D7}\"/></m:accPr><m:e>{}</m:e></m:acc>",
                run("F")
            )),
            r"\vec{F}"
        );
        assert_eq!(
            latex(&format!("<m:d><m:e><m:f><m:fPr><m:type m:val=\"noBar\"/></m:fPr><m:num>{}</m:num><m:den>{}</m:den></m:f></m:e></m:d>", run("n"), run("k"))),
            r"\binom{n}{k}"
        );
        assert_eq!(
            latex("<m:r><m:rPr><m:scr m:val=\"double-struck\"/><m:sty m:val=\"p\"/></m:rPr><m:t>R</m:t></m:r>"),
            r"\mathbb{R}"
        );
        // An upright apostrophe superscript, as the Mac editor wrote f'.
        for (primes, expected) in [
            ("'", r"f^{\prime}"),
            ("''", r"f^{\prime \prime}"),
            ("\u{2032}", r"f^{\prime}"),
        ] {
            assert_eq!(
                latex(&format!(
                    "<m:sSup><m:e>{}</m:e><m:sup>{}</m:sup></m:sSup>",
                    run("f"),
                    upright(primes)
                )),
                expected
            );
        }
    }
}
