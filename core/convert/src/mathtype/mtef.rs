//! MathType's equation data (MTEF v5) as typed records, read and written without loss: writing what was read gives
//! back the same bytes, including records this code does not interpret (future extensions) and encodings MathType
//! could have written more compactly. Every other part of `mathtype` works on this model, never on raw bytes.
//!
//! Layout (MTEF v5): a header (version 5, platform, product, product version and subversion, the application key,
//! the equation options), then records. Formatting and definition records may stand anywhere between objects; the
//! model keeps them in sequence. The equation is the records up to the final END.

use super::records::*;

/// The whole equation data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mtef {
    pub platform: u8,
    pub product: u8,
    pub product_version: u8,
    pub product_subversion: u8,
    /// "DSMT7", "DSMT6", ... (bytes as stored)
    pub application_key: Vec<u8>,
    pub equation_options: u8,
    /// The records before the final END: definitions, preferences, sizes, colours and the root object.
    pub records: Vec<Record>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Record {
    Line(Line),
    Char(Char),
    Template(Template),
    Pile(Pile),
    Matrix(Matrix),
    Embellishment(Embellishment),
    /// FULL, SUB, SUB2, SYM, SUBSYM: one byte, the record type itself.
    TypeSize(u8),
    Size(Size),
    Color(Unsigned),
    ColorDef(ColorDef),
    FontDef {
        encoding: Unsigned,
        name: Vec<u8>,
    },
    FontStyleDef {
        font: Unsigned,
        style: u8,
    },
    EncodingDef(Vec<u8>),
    EqnPrefs(EqnPrefs),
    /// A future-extension record (type 100 and above): its type and payload, kept as they are.
    Future {
        kind: u8,
        length: Unsigned,
        payload: Vec<u8>,
    },
}

/// An MTEF unsigned integer and whether it was written in the three-byte form although it fits in one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unsigned {
    pub value: u16,
    pub wide: bool,
}

impl Unsigned {
    pub fn new(value: u16) -> Self {
        Unsigned {
            value,
            wide: value >= 255,
        }
    }
}

/// An object's nudge (option 0x08): a small offset in two bytes, or 128 128 and the offset in two 16-bit values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Nudge {
    Small { dx: u8, dy: u8 },
    Large { dx: u16, dy: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ruler {
    /// Whether the RULER tag byte (7) stands before the count.
    pub tagged: bool,
    /// (tab type, offset)
    pub stops: Vec<(u8, u16)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub options: u8,
    pub nudge: Option<Nudge>,
    /// Line spacing (option 0x04).
    pub spacing: Option<u16>,
    pub ruler: Option<Ruler>,
    /// The objects and formatting records of the line, without its END; empty for a null line (option 0x01).
    pub content: Vec<Record>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Char {
    pub options: u8,
    pub nudge: Option<Nudge>,
    pub typeface: Typeface,
    /// MTCode (absent with option 0x20).
    pub mt_code: Option<u16>,
    /// The font position in one byte (option 0x04) or two (option 0x10).
    pub encoded8: Option<u8>,
    pub encoded16: Option<u16>,
    /// The embellishment list (option 0x01), its records up to the list's END.
    pub embellishments: Vec<Record>,
}

/// A CHAR's typeface: positive for MathType's built-in styles (Text, Function, Variable, ...), negative for the
/// n-th FONT_STYLE_DEF. Stored as value + 128 in one byte, or 255 and value + 32768 in two.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Typeface {
    pub value: i32,
    pub wide: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Template {
    pub options: u8,
    pub nudge: Option<Nudge>,
    pub selector: u8,
    pub variation: u16,
    /// The variation written in two bytes although it fits in one.
    pub variation_wide: bool,
    pub template_options: u8,
    /// The template's slots and other subobjects, without its END.
    pub content: Vec<Record>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pile {
    pub options: u8,
    pub nudge: Option<Nudge>,
    pub horizontal: u8,
    pub vertical: u8,
    pub ruler: Option<Ruler>,
    /// The pile's lines and formatting records, without its END.
    pub content: Vec<Record>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Matrix {
    pub options: u8,
    pub nudge: Option<Nudge>,
    pub vertical: u8,
    pub horizontal_justification: u8,
    pub vertical_justification: u8,
    pub rows: u8,
    pub columns: u8,
    /// The row and column partition lines, two bits each for rows + 1 and columns + 1 lines, padded to bytes.
    pub row_partitions: Vec<u8>,
    pub column_partitions: Vec<u8>,
    /// The cells (row by row) and formatting records, without the matrix's END.
    pub content: Vec<Record>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Embellishment {
    pub options: u8,
    pub nudge: Option<Nudge>,
    pub kind: u8,
}

/// SIZE: a relative size (form 100: a type size and a 16-bit point size; 101: a 16-bit point size; otherwise a
/// logical size and a delta).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    Points { lsize: u8, points: u16 },
    Explicit { points: u16 },
    Relative { lsize: u8, dsize: u8 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColorDef {
    pub options: u8,
    /// RGB, or CMYK with option 0x01; 0..1000 each.
    pub components: Vec<u16>,
    /// With option 0x04.
    pub name: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EqnPrefs {
    pub options: u8,
    /// The size and spacing dimension arrays, as nibbles (each array: a count, then per dimension a unit nibble and
    /// digit nibbles ending with 0xF), kept as their bytes.
    pub sizes: Vec<u8>,
    pub spaces: Vec<u8>,
    /// Per built-in style (Text, Function, Variable, ...): its FONT_DEF (0: none) and, for a FONT_DEF, the character
    /// style (bold 1, italic 2).
    pub styles: Vec<StyleBinding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StyleBinding {
    pub font: Unsigned,
    /// Present exactly when `font` is not 0.
    pub style: Option<u8>,
}

/// The equation data of a MathType Equation Native stream: its 28-byte header carries the length.
pub fn from_equation_native(native: &[u8]) -> Result<Mtef, String> {
    if native.len() < 28 {
        return Err("The Equation Native stream is shorter than its header.".into());
    }
    let header = u16::from_le_bytes([native[0], native[1]]) as usize;
    let length = u32::from_le_bytes([native[8], native[9], native[10], native[11]]) as usize;
    if header != 28 || header + length > native.len() || length == 0 {
        return Err(format!(
            "Unsupported Equation Native header: length {header}, data {length} bytes."
        ));
    }
    read(&native[header..header + length])
}

/// The Equation Native stream for an equation: the 28-byte header (version 2.0, the data's length; the clipboard
/// format and the reserved words zero, as in genuine streams written outside MathType) and the data.
pub fn to_equation_native(mtef: &Mtef) -> Vec<u8> {
    let data = write(mtef);
    let mut native = Vec::with_capacity(28 + data.len());
    native.extend_from_slice(&28u16.to_le_bytes());
    native.extend_from_slice(&0x0002_0000u32.to_le_bytes());
    native.extend_from_slice(&0u16.to_le_bytes());
    native.extend_from_slice(&(data.len() as u32).to_le_bytes());
    native.extend_from_slice(&[0; 16]);
    native.extend_from_slice(&data);
    native
}

pub fn read(data: &[u8]) -> Result<Mtef, String> {
    let mut reader = Reader {
        data,
        position: 0,
        depth: 0,
    };
    reader.header()
}

pub fn write(mtef: &Mtef) -> Vec<u8> {
    let mut out = vec![
        MTEF_VERSION5,
        mtef.platform,
        mtef.product,
        mtef.product_version,
        mtef.product_subversion,
    ];
    out.extend_from_slice(&mtef.application_key);
    out.push(0);
    out.push(mtef.equation_options);
    write_records(&mtef.records, &mut out);
    out.push(RECORD_END);
    out
}

/// Nesting deeper than this is refused (FormulaXml's limit for the MathML the equation becomes).
const MAXIMUM_DEPTH: usize = 256;

struct Reader<'a> {
    data: &'a [u8],
    position: usize,
    depth: usize,
}

impl Reader<'_> {
    fn header(&mut self) -> Result<Mtef, String> {
        let version = self.byte()?;
        if version != MTEF_VERSION5 {
            return Err(format!(
                "MTEF version {version} is not supported (only version 5)."
            ));
        }
        let platform = self.byte()?;
        let product = self.byte()?;
        let product_version = self.byte()?;
        let product_subversion = self.byte()?;
        let application_key = self.string()?;
        let equation_options = self.byte()?;
        let records = self.records_until_end()?;
        if self.position != self.data.len() {
            return Err(format!(
                "MTEF has {} bytes after the equation's END.",
                self.data.len() - self.position
            ));
        }
        Ok(Mtef {
            platform,
            product,
            product_version,
            product_subversion,
            application_key,
            equation_options,
            records,
        })
    }

    /// Records up to and including the next END (not returned).
    fn records_until_end(&mut self) -> Result<Vec<Record>, String> {
        self.depth += 1;
        if self.depth > MAXIMUM_DEPTH {
            return Err(format!(
                "MTEF nests deeper than {MAXIMUM_DEPTH} levels at offset {}.",
                self.position
            ));
        }
        let mut records = Vec::new();
        loop {
            if self.peek()? == RECORD_END {
                self.position += 1;
                self.depth -= 1;
                return Ok(records);
            }
            records.push(self.record()?);
        }
    }

    fn record(&mut self) -> Result<Record, String> {
        let start = self.position;
        let kind = self.byte()?;
        Ok(match kind {
            RECORD_LINE => Record::Line(self.line()?),
            RECORD_CHAR => Record::Char(self.character()?),
            RECORD_TEMPLATE => Record::Template(self.template()?),
            RECORD_PILE => Record::Pile(self.pile()?),
            RECORD_MATRIX => Record::Matrix(self.matrix()?),
            RECORD_EMBELLISHMENT => {
                let options = self.byte()?;
                let nudge = self.nudge(options)?;
                Record::Embellishment(Embellishment {
                    options,
                    nudge,
                    kind: self.byte()?,
                })
            }
            RECORD_FULL..=RECORD_SUB_SYM => Record::TypeSize(kind),
            RECORD_SIZE => Record::Size(self.size()?),
            RECORD_COLOR => Record::Color(self.unsigned()?),
            RECORD_COLOR_DEF => Record::ColorDef(self.color_def()?),
            RECORD_FONT_DEF => Record::FontDef {
                encoding: self.unsigned()?,
                name: self.string()?,
            },
            RECORD_FONT_STYLE_DEF => Record::FontStyleDef {
                font: self.unsigned()?,
                style: self.byte()?,
            },
            RECORD_ENCODING_DEF => Record::EncodingDef(self.string()?),
            RECORD_EQN_PREFS => Record::EqnPrefs(self.eqn_prefs()?),
            100.. => {
                let length = self.unsigned()?;
                let payload = self.bytes(length.value as usize)?.to_vec();
                Record::Future {
                    kind,
                    length,
                    payload,
                }
            }
            _ => return Err(format!("Unknown MTEF record {kind} at offset {start}.")),
        })
    }

    fn line(&mut self) -> Result<Line, String> {
        let options = self.byte()?;
        let nudge = self.nudge(options)?;
        let spacing = if options & 0x04 != 0 {
            Some(self.u16()?)
        } else {
            None
        };
        let ruler = if options & 0x02 != 0 {
            Some(self.ruler()?)
        } else {
            None
        };
        let content = if options & LINE_NULL != 0 {
            Vec::new()
        } else {
            self.records_until_end()?
        };
        Ok(Line {
            options,
            nudge,
            spacing,
            ruler,
            content,
        })
    }

    fn character(&mut self) -> Result<Char, String> {
        let options = self.byte()?;
        let nudge = self.nudge(options)?;
        let typeface = self.typeface()?;
        let mt_code = if options & CHAR_NO_MT_CODE == 0 {
            Some(self.u16()?)
        } else {
            None
        };
        let encoded8 = if options & CHAR_ENCODED8 != 0 {
            Some(self.byte()?)
        } else {
            None
        };
        let encoded16 = if options & CHAR_ENCODED16 != 0 {
            Some(self.u16()?)
        } else {
            None
        };
        let embellishments = if options & CHAR_HAS_EMBELLISHMENT != 0 {
            self.records_until_end()?
        } else {
            Vec::new()
        };
        Ok(Char {
            options,
            nudge,
            typeface,
            mt_code,
            encoded8,
            encoded16,
            embellishments,
        })
    }

    fn template(&mut self) -> Result<Template, String> {
        let options = self.byte()?;
        let nudge = self.nudge(options)?;
        let selector = self.byte()?;
        let first = self.byte()?;
        let (variation, variation_wide) = if first & 0x80 == 0 {
            (first as u16, false)
        } else {
            let value = (first & 0x7F) as u16 | (self.byte()? as u16) << 8;
            (value, value < 0x80)
        };
        let template_options = self.byte()?;
        let content = self.records_until_end()?;
        Ok(Template {
            options,
            nudge,
            selector,
            variation,
            variation_wide,
            template_options,
            content,
        })
    }

    fn pile(&mut self) -> Result<Pile, String> {
        let options = self.byte()?;
        let nudge = self.nudge(options)?;
        let horizontal = self.byte()?;
        let vertical = self.byte()?;
        let ruler = if options & 0x02 != 0 {
            Some(self.ruler()?)
        } else {
            None
        };
        let content = self.records_until_end()?;
        Ok(Pile {
            options,
            nudge,
            horizontal,
            vertical,
            ruler,
            content,
        })
    }

    fn matrix(&mut self) -> Result<Matrix, String> {
        let options = self.byte()?;
        let nudge = self.nudge(options)?;
        let vertical = self.byte()?;
        let horizontal_justification = self.byte()?;
        let vertical_justification = self.byte()?;
        let rows = self.byte()?;
        let columns = self.byte()?;
        let row_partitions = self.bytes(partition_bytes(rows as usize + 1))?.to_vec();
        let column_partitions = self.bytes(partition_bytes(columns as usize + 1))?.to_vec();
        let content = self.records_until_end()?;
        Ok(Matrix {
            options,
            nudge,
            vertical,
            horizontal_justification,
            vertical_justification,
            rows,
            columns,
            row_partitions,
            column_partitions,
            content,
        })
    }

    fn ruler(&mut self) -> Result<Ruler, String> {
        let tagged = self.peek()? == RECORD_RULER;
        if tagged {
            self.position += 1;
        }
        let count = self.byte()?;
        let mut stops = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let kind = self.byte()?;
            stops.push((kind, self.u16()?));
        }
        Ok(Ruler { tagged, stops })
    }

    fn size(&mut self) -> Result<Size, String> {
        let form = self.byte()?;
        Ok(match form {
            100 => Size::Points {
                lsize: self.byte()?,
                points: self.u16()?,
            },
            101 => Size::Explicit {
                points: self.u16()?,
            },
            lsize => Size::Relative {
                lsize,
                dsize: self.byte()?,
            },
        })
    }

    fn color_def(&mut self) -> Result<ColorDef, String> {
        let options = self.byte()?;
        let count = if options & 0x01 != 0 { 4 } else { 3 };
        let mut components = Vec::with_capacity(count);
        for _ in 0..count {
            components.push(self.u16()?);
        }
        let name = if options & 0x04 != 0 {
            Some(self.string()?)
        } else {
            None
        };
        Ok(ColorDef {
            options,
            components,
            name,
        })
    }

    fn eqn_prefs(&mut self) -> Result<EqnPrefs, String> {
        let options = self.byte()?;
        let sizes = self.dimension_array()?;
        let spaces = self.dimension_array()?;
        let count = self.byte()?;
        let mut styles = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let font = self.unsigned()?;
            let style = if font.value == 0 {
                None
            } else {
                Some(self.byte()?)
            };
            styles.push(StyleBinding { font, style });
        }
        Ok(EqnPrefs {
            options,
            sizes,
            spaces,
            styles,
        })
    }

    /// A dimension array's bytes: the count, then nibbles up to the last terminator, padded to a byte.
    fn dimension_array(&mut self) -> Result<Vec<u8>, String> {
        let start = self.position;
        let count = self.byte()?;
        let mut high = true;
        for _ in 0..count {
            self.nibble(&mut high)?; // unit
            while self.nibble(&mut high)? != 0x0F {}
        }
        if !high {
            self.position += 1;
        }
        Ok(self.data[start..self.position].to_vec())
    }

    fn nibble(&mut self, high: &mut bool) -> Result<u8, String> {
        let byte = self.peek()?;
        let value = if *high { byte >> 4 } else { byte & 0x0F };
        if !*high {
            self.position += 1;
        }
        *high = !*high;
        Ok(value)
    }

    fn nudge(&mut self, options: u8) -> Result<Option<Nudge>, String> {
        if options & 0x08 == 0 {
            return Ok(None);
        }
        let dx = self.byte()?;
        let dy = self.byte()?;
        Ok(Some(if dx == 128 && dy == 128 {
            Nudge::Large {
                dx: self.u16()?,
                dy: self.u16()?,
            }
        } else {
            Nudge::Small { dx, dy }
        }))
    }

    fn typeface(&mut self) -> Result<Typeface, String> {
        let first = self.byte()?;
        if first != 0xFF {
            return Ok(Typeface {
                value: first as i32 - 128,
                wide: false,
            });
        }
        Ok(Typeface {
            value: self.u16()? as i32 - 32768,
            wide: true,
        })
    }

    fn unsigned(&mut self) -> Result<Unsigned, String> {
        let first = self.byte()?;
        if first != 0xFF {
            return Ok(Unsigned {
                value: first as u16,
                wide: false,
            });
        }
        let value = self.u16()?;
        Ok(Unsigned {
            value,
            wide: value < 255,
        })
    }

    fn string(&mut self) -> Result<Vec<u8>, String> {
        let start = self.position;
        let end = self.data[start..]
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| format!("MTEF text at offset {start} has no terminating zero."))?;
        self.position = start + end + 1;
        Ok(self.data[start..start + end].to_vec())
    }

    fn u16(&mut self) -> Result<u16, String> {
        let bytes = self.bytes(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn bytes(&mut self, count: usize) -> Result<&[u8], String> {
        let start = self.position;
        if start + count > self.data.len() {
            return Err(format!(
                "MTEF ends inside a record at offset {start} (needs {count} bytes)."
            ));
        }
        self.position += count;
        Ok(&self.data[start..start + count])
    }

    fn byte(&mut self) -> Result<u8, String> {
        let value = self.peek()?;
        self.position += 1;
        Ok(value)
    }

    fn peek(&self) -> Result<u8, String> {
        self.data
            .get(self.position)
            .copied()
            .ok_or_else(|| format!("MTEF ends at offset {} before its END.", self.position))
    }
}

/// Partition lines: two bits each, padded to whole bytes.
pub fn partition_bytes(lines: usize) -> usize {
    (lines * 2).div_ceil(8)
}

fn write_records(records: &[Record], out: &mut Vec<u8>) {
    for record in records {
        write_record(record, out);
    }
}

fn write_record(record: &Record, out: &mut Vec<u8>) {
    match record {
        Record::Line(line) => {
            out.push(RECORD_LINE);
            out.push(line.options);
            write_nudge(line.nudge, out);
            if let Some(spacing) = line.spacing {
                out.extend_from_slice(&spacing.to_le_bytes());
            }
            if let Some(ruler) = &line.ruler {
                write_ruler(ruler, out);
            }
            if line.options & LINE_NULL == 0 {
                write_records(&line.content, out);
                out.push(RECORD_END);
            }
        }
        Record::Char(c) => {
            out.push(RECORD_CHAR);
            out.push(c.options);
            write_nudge(c.nudge, out);
            if c.typeface.wide {
                out.push(0xFF);
                out.extend_from_slice(&((c.typeface.value + 32768) as u16).to_le_bytes());
            } else {
                out.push((c.typeface.value + 128) as u8);
            }
            if let Some(code) = c.mt_code {
                out.extend_from_slice(&code.to_le_bytes());
            }
            if let Some(position) = c.encoded8 {
                out.push(position);
            }
            if let Some(position) = c.encoded16 {
                out.extend_from_slice(&position.to_le_bytes());
            }
            if c.options & CHAR_HAS_EMBELLISHMENT != 0 {
                write_records(&c.embellishments, out);
                out.push(RECORD_END);
            }
        }
        Record::Template(t) => {
            out.push(RECORD_TEMPLATE);
            out.push(t.options);
            write_nudge(t.nudge, out);
            out.push(t.selector);
            if t.variation >= 0x80 || t.variation_wide {
                out.push((t.variation & 0x7F) as u8 | 0x80);
                out.push((t.variation >> 8) as u8);
            } else {
                out.push(t.variation as u8);
            }
            out.push(t.template_options);
            write_records(&t.content, out);
            out.push(RECORD_END);
        }
        Record::Pile(p) => {
            out.push(RECORD_PILE);
            out.push(p.options);
            write_nudge(p.nudge, out);
            out.push(p.horizontal);
            out.push(p.vertical);
            if let Some(ruler) = &p.ruler {
                write_ruler(ruler, out);
            }
            write_records(&p.content, out);
            out.push(RECORD_END);
        }
        Record::Matrix(m) => {
            out.push(RECORD_MATRIX);
            out.push(m.options);
            write_nudge(m.nudge, out);
            out.extend_from_slice(&[
                m.vertical,
                m.horizontal_justification,
                m.vertical_justification,
                m.rows,
                m.columns,
            ]);
            out.extend_from_slice(&m.row_partitions);
            out.extend_from_slice(&m.column_partitions);
            write_records(&m.content, out);
            out.push(RECORD_END);
        }
        Record::Embellishment(e) => {
            out.push(RECORD_EMBELLISHMENT);
            out.push(e.options);
            write_nudge(e.nudge, out);
            out.push(e.kind);
        }
        Record::TypeSize(kind) => out.push(*kind),
        Record::Size(size) => {
            out.push(RECORD_SIZE);
            match *size {
                Size::Points { lsize, points } => {
                    out.push(100);
                    out.push(lsize);
                    out.extend_from_slice(&points.to_le_bytes());
                }
                Size::Explicit { points } => {
                    out.push(101);
                    out.extend_from_slice(&points.to_le_bytes());
                }
                Size::Relative { lsize, dsize } => out.extend_from_slice(&[lsize, dsize]),
            }
        }
        Record::Color(index) => {
            out.push(RECORD_COLOR);
            write_unsigned_exact(*index, out);
        }
        Record::ColorDef(def) => {
            out.push(RECORD_COLOR_DEF);
            out.push(def.options);
            for component in &def.components {
                out.extend_from_slice(&component.to_le_bytes());
            }
            if let Some(name) = &def.name {
                out.extend_from_slice(name);
                out.push(0);
            }
        }
        Record::FontDef { encoding, name } => {
            out.push(RECORD_FONT_DEF);
            write_unsigned_exact(*encoding, out);
            out.extend_from_slice(name);
            out.push(0);
        }
        Record::FontStyleDef { font, style } => {
            out.push(RECORD_FONT_STYLE_DEF);
            write_unsigned_exact(*font, out);
            out.push(*style);
        }
        Record::EncodingDef(name) => {
            out.push(RECORD_ENCODING_DEF);
            out.extend_from_slice(name);
            out.push(0);
        }
        Record::EqnPrefs(prefs) => {
            out.push(RECORD_EQN_PREFS);
            out.push(prefs.options);
            out.extend_from_slice(&prefs.sizes);
            out.extend_from_slice(&prefs.spaces);
            out.push(prefs.styles.len() as u8);
            for binding in &prefs.styles {
                write_unsigned_exact(binding.font, out);
                if let Some(style) = binding.style {
                    out.push(style);
                }
            }
        }
        Record::Future {
            kind,
            length,
            payload,
        } => {
            out.push(*kind);
            write_unsigned_exact(*length, out);
            out.extend_from_slice(payload);
        }
    }
}

fn write_unsigned_exact(value: Unsigned, out: &mut Vec<u8>) {
    if value.wide || value.value >= 255 {
        out.push(0xFF);
        out.extend_from_slice(&value.value.to_le_bytes());
    } else {
        out.push(value.value as u8);
    }
}

fn write_nudge(nudge: Option<Nudge>, out: &mut Vec<u8>) {
    match nudge {
        None => {}
        Some(Nudge::Small { dx, dy }) => out.extend_from_slice(&[dx, dy]),
        Some(Nudge::Large { dx, dy }) => {
            out.extend_from_slice(&[128, 128]);
            out.extend_from_slice(&dx.to_le_bytes());
            out.extend_from_slice(&dy.to_le_bytes());
        }
    }
}

fn write_ruler(ruler: &Ruler, out: &mut Vec<u8>) {
    if ruler.tagged {
        out.push(RECORD_RULER);
    }
    out.push(ruler.stops.len() as u8);
    for (kind, offset) in &ruler.stops {
        out.push(*kind);
        out.extend_from_slice(&offset.to_le_bytes());
    }
}
