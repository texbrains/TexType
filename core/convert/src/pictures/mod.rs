//! Pictures for documents: a formula's SVG, as ui/kernel draws it, made into the EMF and PNG previews of a TexType
//! OLE object and the picture of a picture formula.
//!
//! The SVG is read once (usvg); text in it (a native font, such as Chinese in `\text`) becomes outlines from the
//! installed fonts. Every shape is then a filled outline: the PNG is drawn from it by resvg, the EMF is written from it
//! by `emf`. The EMF is vector only, at a fixed 96 dpi, so its size does not depend on the machine that made it.

mod emf;

use emf::{Contour, Fill};
use resvg::tiny_skia::{self, PathSegment, Pixmap, Transform};
use resvg::usvg::{self, Node, Paint};

/// How much every glyph of the EMF is emboldened, in CSS pixels at the formula's size. Office and WPS draw EMF+
/// outlines anti-aliased and unhinted, so the thin stems of the TeX fonts turned grey at text sizes, lighter than
/// Word equations or MathType beside them (stem darkening).
const STEM_DARKENING: f32 = 0.12;
/// The margin kept around the ink of outlines from installed fonts, in CSS pixels.
const SAFETY_PADDING: f32 = 1.0;
/// The PNG is drawn at twice the CSS size, up to this many pixels on its longer side.
const MAX_PNG_PIXELS: f32 = 8192.0;

/// A formula's SVG document from the drawing ui/kernel makes (`<defs>` and shapes around the left end of the baseline)
/// and how far the formula reaches left, right, above and below that point, in CSS pixels.
pub fn svg_document(body: &str, left: f64, right: f64, ascent: f64, descent: f64) -> String {
    let (width, height) = (left + right, ascent + descent);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{width}\" \
         height=\"{height}\" viewBox=\"{} {} {width} {height}\">{body}</svg>",
        -left, -ascent
    )
}

/// Reads formula SVGs with the installed fonts.
pub struct Pictures {
    options: usvg::Options<'static>,
}

/// The previews of one formula and the geometry they share, in CSS pixels.
pub struct Previews {
    pub emf: Vec<u8>,
    pub png: Vec<u8>,
    pub width: f32,
    pub height: f32,
    /// from the top edge to the baseline
    pub baseline: f32,
}

impl Pictures {
    /// Loads the installed fonts once (for text in a formula).
    pub fn with_system_fonts() -> Self {
        let mut options = usvg::Options::default();
        options.fontdb_mut().load_system_fonts();
        Self { options }
    }

    /// The previews of a formula SVG (a document with width, height and viewBox in CSS pixels) whose baseline is
    /// `baseline` pixels below its top edge. Text drawn from installed fonts can reach beyond the SVG's box, whose
    /// size the web view measured; the previews then grow to hold its ink and say where the baseline went.
    pub fn previews(&self, svg: &str, baseline: f32) -> Result<Previews, String> {
        let tree = usvg::Tree::from_str(svg, &self.options)
            .map_err(|error| format!("The formula SVG cannot be read: {error}"))?;
        let mut drawing = Drawing::default();
        drawing.add_group(tree.root())?;
        if drawing.fills.is_empty() {
            return Err("The formula SVG draws nothing.".to_string());
        }
        let size = tree.size();
        let (mut left, mut top, mut right, mut bottom) =
            (0.0f32, 0.0f32, size.width(), size.height());
        if drawing.has_text {
            // the EMF's glyphs are emboldened beyond their outlines
            let margin = SAFETY_PADDING + STEM_DARKENING;
            let ink = drawing.ink();
            left = left.min(ink.left() - margin);
            top = top.min(ink.top() - margin);
            right = right.max(ink.right() + margin);
            bottom = bottom.max(ink.bottom() + margin);
        }
        let (width, height) = (right - left, bottom - top);
        Ok(Previews {
            emf: emf::write(&drawing.fills, -left, -top, width, height, STEM_DARKENING),
            png: png(&tree, -left, -top, width, height)?,
            width,
            height,
            baseline: baseline - top,
        })
    }
}

fn png(tree: &usvg::Tree, dx: f32, dy: f32, width: f32, height: f32) -> Result<Vec<u8>, String> {
    let scale = (MAX_PNG_PIXELS / width.max(height)).min(2.0);
    let mut pixmap = Pixmap::new(
        (width * scale).ceil() as u32,
        (height * scale).ceil() as u32,
    )
    .ok_or_else(|| format!("A {width} x {height} picture cannot be drawn."))?;
    resvg::render(
        tree,
        Transform::from_scale(scale, scale).pre_translate(dx, dy),
        &mut pixmap.as_mut(),
    );
    pixmap.encode_png().map_err(|error| error.to_string())
}

/// Every shape of the SVG as a filled outline in CSS pixels, in drawing order.
#[derive(Default)]
struct Drawing {
    fills: Vec<Fill>,
    has_text: bool,
}

impl Drawing {
    fn add_group(&mut self, group: &usvg::Group) -> Result<(), String> {
        if group.clip_path().is_some()
            || group.mask().is_some()
            || !group.filters().is_empty()
            || group.opacity().get() < 1.0
        {
            return Err(
                "The formula SVG uses clipping, masks, filters or group opacity.".to_string(),
            );
        }
        for node in group.children() {
            match node {
                Node::Group(group) => self.add_group(group)?,
                Node::Path(path) => self.add_path(path)?,
                Node::Text(text) => {
                    self.has_text = true;
                    self.add_group(text.flattened())?;
                }
                Node::Image(_) => return Err("The formula SVG contains an image.".to_string()),
            }
        }
        Ok(())
    }

    fn add_path(&mut self, path: &usvg::Path) -> Result<(), String> {
        if !path.is_visible() {
            return Ok(());
        }
        let transform = path.abs_transform();
        if let Some(fill) = path.fill() {
            let outline = path
                .data()
                .clone()
                .transform(transform)
                .ok_or("A formula outline cannot be placed.")?;
            let even_odd = fill.rule() == usvg::FillRule::EvenOdd;
            self.fills.push(Fill::new(
                contours(&outline),
                argb(fill.paint(), fill.opacity())?,
                even_odd,
            ));
        }
        if let Some(stroke) = path.stroke() {
            // a stroke (the oval of a contour integral) as the outline it covers
            let outline = path
                .data()
                .stroke(&stroke.to_tiny_skia(), 1.0)
                .and_then(|outline| outline.transform(transform))
                .ok_or("A formula stroke cannot be outlined.")?;
            self.fills.push(Fill::new(
                contours(&outline),
                argb(stroke.paint(), stroke.opacity())?,
                false,
            ));
        }
        Ok(())
    }

    fn ink(&self) -> tiny_skia::Rect {
        let points = self
            .fills
            .iter()
            .flat_map(|fill| fill.contours.iter())
            .flat_map(|contour| contour.points.iter());
        let (mut left, mut top, mut right, mut bottom) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for &(x, y) in points {
            (left, top, right, bottom) = (left.min(x), top.min(y), right.max(x), bottom.max(y));
        }
        tiny_skia::Rect::from_ltrb(left, top, right, bottom).expect("a drawing with fills has ink")
    }
}

fn argb(paint: &Paint, opacity: usvg::Opacity) -> Result<u32, String> {
    let Paint::Color(color) = paint else {
        return Err("The formula SVG paints with a gradient or pattern.".to_string());
    };
    let alpha = (opacity.get() * 255.0).round() as u32;
    Ok(alpha << 24
        | u32::from(color.red) << 16
        | u32::from(color.green) << 8
        | u32::from(color.blue))
}

/// An outline as contours of points (line ends and cubic control points, as GDI+ keeps a path).
fn contours(outline: &tiny_skia::Path) -> Vec<Contour> {
    let mut contours: Vec<Contour> = Vec::new();
    let mut last = (0.0, 0.0);
    for segment in outline.segments() {
        match segment {
            PathSegment::MoveTo(p) => {
                contours.push(Contour::start((p.x, p.y)));
                last = (p.x, p.y);
            }
            PathSegment::LineTo(p) => {
                current(&mut contours, last).line((p.x, p.y));
                last = (p.x, p.y);
            }
            PathSegment::QuadTo(q, p) => {
                // the same curve as a cubic: control points two thirds of the way to the quadratic one
                let c1 = (
                    last.0 + 2.0 / 3.0 * (q.x - last.0),
                    last.1 + 2.0 / 3.0 * (q.y - last.1),
                );
                let c2 = (p.x + 2.0 / 3.0 * (q.x - p.x), p.y + 2.0 / 3.0 * (q.y - p.y));
                current(&mut contours, last).cubic(c1, c2, (p.x, p.y));
                last = (p.x, p.y);
            }
            PathSegment::CubicTo(c1, c2, p) => {
                current(&mut contours, last).cubic((c1.x, c1.y), (c2.x, c2.y), (p.x, p.y));
                last = (p.x, p.y);
            }
            PathSegment::Close => {
                if let Some(contour) = contours.last_mut() {
                    contour.closed = true;
                    last = contour.points[0];
                }
            }
        }
    }
    contours.retain(|contour| contour.points.len() > 1);
    contours
}

/// The contour being drawn; a segment after a closed contour starts a new one where the pen is.
fn current(contours: &mut Vec<Contour>, pen: (f32, f32)) -> &mut Contour {
    if contours.last().is_none_or(|contour| contour.closed) {
        contours.push(Contour::start(pen));
    }
    contours.last_mut().expect("a contour was just ensured")
}
