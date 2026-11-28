//! Scripts, limits and big operators written as MathType's templates.

use super::*;

impl Writer {
    /// Scripts follow their base: the base's records, then a script template.
    pub(super) fn scripts(
        &mut self,
        element: &Element,
        children: &[&Element],
        size: u8,
        content: &mut Vec<Record>,
    ) {
        if let ("msup", Some(base), Some(sup)) =
            (element.name.as_str(), children.first(), children.get(1))
        {
            let primes = match single_token(sup)
                .map(Element::text)
                .unwrap_or_default()
                .as_str()
            {
                "\u{2032}" | "'" => Some(EMBELL_PRIME),
                "\u{2033}" | "\u{2032}\u{2032}" | "''" => Some(EMBELL_DOUBLE_PRIME),
                "\u{2034}" | "\u{2032}\u{2032}\u{2032}" | "'''" => Some(EMBELL_TRIPLE_PRIME),
                "\u{2035}" => Some(EMBELL_BACK_PRIME),
                _ => None,
            };
            if let (Some(kind), Some(glyph)) = (primes, single_glyph(base)) {
                let embellishment = Record::Embellishment(Embellishment {
                    options: 0,
                    nudge: None,
                    kind,
                });
                return self.char(glyph, false, vec![embellishment], size, content);
            }
        }
        if let Some(base) = children.first() {
            if let Some(operator) = big_operator(base) {
                let (lower, upper) = match element.name.as_str() {
                    "msub" => (children.get(1).copied(), None),
                    "msup" => (None, children.get(1).copied()),
                    _ => (children.get(1).copied(), children.get(2).copied()),
                };
                return self.big_operator(operator, lower, upper, false, size, content);
            }
            self.node(base, size, content);
        }
        let script = script_size(size);
        let (selector, sub, sup) = match element.name.as_str() {
            "msub" => (TEMPLATE_SUB, children.get(1).copied(), None),
            "msup" => (TEMPLATE_SUP, None, children.get(1).copied()),
            _ => (
                TEMPLATE_SUB_SUP,
                children.get(1).copied(),
                children.get(2).copied(),
            ),
        };
        self.template(selector, 0, content, size, |writer, slots| {
            writer.slot(sub, script, slots);
            writer.slot(sup, script, slots);
        });
    }

    /// munder/mover/munderover: a big operator with limits, an accent, or the limit template.
    pub(super) fn limits(
        &mut self,
        element: &Element,
        children: &[&Element],
        size: u8,
        content: &mut Vec<Record>,
    ) {
        let (lower, upper) = match element.name.as_str() {
            "munder" => (children.get(1).copied(), None),
            "mover" => (None, children.get(1).copied()),
            _ => (children.get(1).copied(), children.get(2).copied()),
        };
        let Some(base) = children.first() else { return };
        if let Some(operator) = big_operator(base) {
            return self.big_operator(operator, lower, upper, true, size, content);
        }
        if let (None, Some(mark)) = (lower, upper) {
            if let Some(kind) = embellishment(mark) {
                if let Some(glyph) = single_glyph(base) {
                    let embellishment = Record::Embellishment(Embellishment {
                        options: 0,
                        nudge: None,
                        kind,
                    });
                    return self.char(glyph, false, vec![embellishment], size, content);
                }
            }
        }
        let bar = |mark: Option<&Element>| {
            mark.is_some_and(|mark| {
                matches!(
                    mark.text().as_str(),
                    "\u{00AF}" | "\u{2015}" | "\u{203E}" | "_"
                )
            })
        };
        match (lower, upper) {
            (None, Some(_)) if bar(upper) => {
                return self.template(TEMPLATE_OVERBAR, 0, content, size, |writer, slots| {
                    writer.slot(Some(base), size, slots);
                });
            }
            (Some(_), None) if bar(lower) => {
                return self.template(TEMPLATE_UNDERBAR, 0, content, size, |writer, slots| {
                    writer.slot(Some(base), size, slots);
                });
            }
            _ => {}
        }
        let variation = u16::from(lower.is_some()) * 0x10 + u16::from(upper.is_some()) * 0x20;
        let script = script_size(size);
        self.template(TEMPLATE_LIMIT, variation, content, size, |writer, slots| {
            writer.slot(Some(base), size, slots);
            writer.slot(lower, script, slots);
            writer.slot(upper, script, slots);
        });
    }

    /// A big operator with limits (template 21 for integrals, 22 for the others): an empty operand, the limits and
    /// the sign in its own line.
    pub(super) fn big_operator(
        &mut self,
        operator: &Element,
        lower: Option<&Element>,
        upper: Option<&Element>,
        limits: bool,
        size: u8,
        content: &mut Vec<Record>,
    ) {
        let sign = operator.text().chars().next().unwrap_or('\u{222B}');
        let old = old_big_operator(sign);
        // MathType's old integrals (several signs, a loop) take no upper limit (MathType 6.9 crashes on one in every
        // template, under and over too; in the newer template it sets the signs a whole advance apart:
        // probe-pc/ib-*, in-*): the old template without limits, the limits as scripts after it
        let old_integral = old
            .as_ref()
            .is_some_and(|o| o.selector == TEMPLATE_INTEGRAL);
        if let (Some(old), true) = (&old, old_integral && upper.is_some()) {
            let sign = OldBigOperator {
                selector: old.selector,
                variation: old.variation,
                signs: old.signs.clone(),
            };
            self.old_big_operator(sign, None, None, false, size, content);
            let selector = if lower.is_some() {
                TEMPLATE_SUB_SUP
            } else {
                TEMPLATE_SUP
            };
            let script = script_size(size);
            return self.template(selector, 0, content, size, |writer, slots| {
                writer.slot(lower, script, slots);
                writer.slot(upper, script, slots);
            });
        }
        // MathType's old templates have no upper limit alone (MathType crashes on one): then the newer template,
        // with the old sign's characters in its sign line
        let unsupported = upper.is_some() && lower.is_none();
        if let (Some(old), false) = (&old, unsupported) {
            let old = OldBigOperator {
                selector: old.selector,
                variation: old.variation,
                signs: old.signs.clone(),
            };
            return self.old_big_operator(old, lower, upper, limits, size, content);
        }
        // MathType chooses the template by the limits' place, whatever the sign: scripts (21) or under and over (22)
        let selector = if limits {
            TEMPLATE_SUM_OPERATOR
        } else {
            TEMPLATE_INTEGRAL_OPERATOR
        };
        let variation = u16::from(lower.is_some()) * 0x10
            + u16::from(upper.is_some()) * 0x20
            + u16::from(limits) * 0x40;
        let script = script_size(size);
        self.template(selector, variation, content, size, |writer, slots| {
            writer.line(&[], size, slots);
            writer.slot(lower, script, slots);
            writer.slot(upper, script, slots);
            match &old {
                None => writer.line(&[operator], sign_size(size), slots),
                Some(old) => {
                    writer.sized(sign_size(size), slots);
                    let mut sign = Vec::new();
                    for &(typeface, mt_code, position) in &old.signs {
                        let glyph = Glyph {
                            typeface,
                            font: None,
                            mt_code,
                            encoded8: Some(position),
                        };
                        writer.char(glyph, false, Vec::new(), sign_size(size), &mut sign);
                    }
                    let line = Line {
                        options: 0,
                        nudge: None,
                        spacing: None,
                        ruler: None,
                        content: sign,
                    };
                    slots.push(Record::Line(line));
                }
            }
        });
    }

    /// A big operator MathType 7 has no sign character for, in the template MathType's editor uses (MathType 6's):
    /// an empty operand, the limits, then the sign's characters (variation: the operator's own bits, 0x10 lower,
    /// 0x20 upper, 0x40 limits under and over).
    pub(super) fn old_big_operator(
        &mut self,
        operator: OldBigOperator,
        lower: Option<&Element>,
        upper: Option<&Element>,
        limits: bool,
        size: u8,
        content: &mut Vec<Record>,
    ) {
        let OldBigOperator {
            selector,
            variation,
            signs,
        } = operator;
        let variation = variation
            + u16::from(lower.is_some()) * 0x10
            + u16::from(upper.is_some()) * 0x20
            + u16::from(limits) * 0x40;
        let script = script_size(size);
        self.template(selector, variation, content, size, |writer, slots| {
            writer.line(&[], size, slots);
            writer.slot(lower, script, slots);
            writer.slot(upper, script, slots);
            for (typeface, mt_code, position) in signs {
                let glyph = Glyph {
                    typeface,
                    font: None,
                    mt_code,
                    encoded8: Some(position),
                };
                writer.char(glyph, false, Vec::new(), sign_size(size), slots);
            }
        });
    }
}
