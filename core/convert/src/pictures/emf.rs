//! The EMF of a formula, as GDI+ records an EMF+ Dual picture: EMF+ records, which Office and WPS draw anti-aliased,
//! and the same shapes as plain GDI records for players without EMF+. Only filled outlines, no bitmap record.
//!
//! The reference device is a fixed 96 dpi screen: one CSS pixel is one device pixel, and the frame (the size Office
//! shows) is the picture's CSS size. GDI coordinates are in sixteenths of a pixel (MM_ANISOTROPIC), EMF+ ones are
//! floating-point pixels.
//!
//! EMF+ paths have no documented fill rule; players fill them even-odd, as GDI+ fills a path by default. The glyphs of
//! the TeX fonts fill the same under both rules (every stored corpus picture was compared at 8x); the GDI records keep
//! the SVG's rule.

/// Point kinds of a contour (EmfPlusPathPointType).
const START: u8 = 0x00;
const LINE: u8 = 0x01;
const BEZIER: u8 = 0x03;
const CLOSE_SUBPATH: u8 = 0x80;

/// One contour: its first point, then line ends and cubic control points (three per curve).
pub(super) struct Contour {
    pub points: Vec<(f32, f32)>,
    kinds: Vec<u8>,
    pub closed: bool,
}

impl Contour {
    pub fn start(point: (f32, f32)) -> Self {
        Self {
            points: vec![point],
            kinds: vec![START],
            closed: false,
        }
    }

    pub fn line(&mut self, point: (f32, f32)) {
        self.points.push(point);
        self.kinds.push(LINE);
    }

    pub fn cubic(&mut self, c1: (f32, f32), c2: (f32, f32), end: (f32, f32)) {
        self.points.extend([c1, c2, end]);
        self.kinds.extend([BEZIER; 3]);
    }
}

/// One filled shape: its contours, its colour (ARGB) and its fill rule.
pub(super) struct Fill {
    pub contours: Vec<Contour>,
    argb: u32,
    even_odd: bool,
}

impl Fill {
    pub fn new(contours: Vec<Contour>, argb: u32, even_odd: bool) -> Self {
        Self {
            contours,
            argb,
            even_odd,
        }
    }
}

/// Stem darkening: every contour moves outward by half of `strength` (holes shrink), point by point along the bisector
/// of its edges, as FreeType's FT_Outline_EmboldenXY does, so the curves and the number of points stay as they are.
fn embolden(contours: &[Contour], strength: f32) -> Vec<Vec<(f32, f32)>> {
    // A glyph's contours wind one way and its holes the other, so the sign of the total area says which side of the
    // direction of travel is outside (FT_Outline_Get_Orientation).
    let area: f64 = contours
        .iter()
        .map(|contour| {
            let points = &contour.points;
            (0..points.len())
                .map(|index| {
                    let (a, b) = (points[index], points[(index + 1) % points.len()]);
                    f64::from(a.0) * f64::from(b.1) - f64::from(b.0) * f64::from(a.1)
                })
                .sum::<f64>()
        })
        .sum();
    if area == 0.0 {
        return contours
            .iter()
            .map(|contour| contour.points.clone())
            .collect();
    }
    let half = if area > 0.0 {
        strength / 2.0
    } else {
        -strength / 2.0
    };
    contours
        .iter()
        .map(|contour| embolden_contour(&contour.points, half))
        .collect()
}

fn embolden_contour(points: &[(f32, f32)], half: f32) -> Vec<(f32, f32)> {
    let mut moved = points.to_vec();
    let count = points.len();
    if count < 3 {
        return moved;
    }
    let length = |x: f32, y: f32| (x * x + y * y).sqrt();
    let same =
        |a: usize, b: usize| length(points[a].0 - points[b].0, points[a].1 - points[b].1) < 1e-4;
    for index in 0..count {
        let mut previous = (index + count - 1) % count;
        while previous != index && same(previous, index) {
            previous = (previous + count - 1) % count;
        }
        let mut next = (index + 1) % count;
        while next != index && same(next, index) {
            next = (next + 1) % count;
        }
        if previous == index || next == index {
            continue;
        }
        let point = points[index];
        let (mut in_x, mut in_y) = (point.0 - points[previous].0, point.1 - points[previous].1);
        let in_length = length(in_x, in_y);
        (in_x, in_y) = (in_x / in_length, in_y / in_length);
        let (mut out_x, mut out_y) = (points[next].0 - point.0, points[next].1 - point.1);
        let out_length = length(out_x, out_y);
        (out_x, out_y) = (out_x / out_length, out_y / out_length);
        // 1 + the cosine of the turn; a spike (a turn of more than about 160 degrees) stays where it is
        let turn = 1.0 + in_x * out_x + in_y * out_y;
        if turn < 0.06 {
            continue;
        }
        // the outward normals of both edges, summed, give the bisector; moving by half/turn along it moves both edges
        // by half
        let (mut shift_x, mut shift_y) =
            ((in_y + out_y) * half / turn, -(in_x + out_x) * half / turn);
        // never further than the shorter edge, so no contour collapses
        let shift = length(shift_x, shift_y);
        let limit = in_length.min(out_length);
        if shift > limit && shift > 0.0 {
            (shift_x, shift_y) = (shift_x * limit / shift, shift_y * limit / shift);
        }
        moved[index] = (point.0 + shift_x, point.1 + shift_y);
    }
    moved
}

// EMF record types (MS-EMF 2.1.1)
const EMR_HEADER: u32 = 1;
const EMR_POLYBEZIERTO: u32 = 5;
const EMR_POLYLINETO: u32 = 6;
const EMR_SETWINDOWEXTEX: u32 = 9;
const EMR_SETVIEWPORTEXTEX: u32 = 11;
const EMR_EOF: u32 = 14;
const EMR_SETMAPMODE: u32 = 17;
const EMR_SETPOLYFILLMODE: u32 = 19;
const EMR_MOVETOEX: u32 = 27;
const EMR_SELECTOBJECT: u32 = 37;
const EMR_CREATEBRUSHINDIRECT: u32 = 39;
const EMR_DELETEOBJECT: u32 = 40;
const EMR_BEGINPATH: u32 = 59;
const EMR_ENDPATH: u32 = 60;
const EMR_CLOSEFIGURE: u32 = 61;
const EMR_FILLPATH: u32 = 62;
const EMR_GDICOMMENT: u32 = 70;

// EMF+ record types (MS-EMFPLUS 2.1.1.1)
const EMF_PLUS_HEADER: u16 = 0x4001;
const EMF_PLUS_END_OF_FILE: u16 = 0x4002;
const EMF_PLUS_OBJECT: u16 = 0x4008;
const EMF_PLUS_FILL_PATH: u16 = 0x4014;
const EMF_PLUS_SET_ANTI_ALIAS_MODE: u16 = 0x401E;
const EMF_PLUS_SET_PIXEL_OFFSET_MODE: u16 = 0x4022;
const EMF_PLUS_SET_COMPOSITING_MODE: u16 = 0x4023;
const EMF_PLUS_SET_PAGE_TRANSFORM: u16 = 0x4030;
const EMF_PLUS_VERSION: u32 = 0xDBC0_1002;

/// GDI logical units per pixel.
const UNITS: f32 = 16.0;
/// 96 dpi: hundredths of a millimetre per pixel.
const FRAME_UNITS_PER_PIXEL: f32 = 2540.0 / 96.0;
/// The reference screen: 1920 x 960 pixels at 96 dpi is 508 x 254 mm.
const DEVICE: (u32, u32) = (1920, 960);
const DEVICE_MM: (u32, u32) = (508, 254);
const BRUSH: u32 = 1;
const WHITE_BRUSH: u32 = 0x8000_0000;

#[derive(Default)]
struct Records {
    bytes: Vec<u8>,
    count: u32,
}

impl Records {
    fn add(&mut self, kind: u32, payload: &[u8]) {
        let size = 8 + payload.len().next_multiple_of(4);
        self.bytes.extend(kind.to_le_bytes());
        self.bytes.extend((size as u32).to_le_bytes());
        self.bytes.extend(payload);
        self.bytes.resize(self.bytes.len().next_multiple_of(4), 0);
        self.count += 1;
    }

    /// EMF+ records travel in a GDI comment.
    fn plus(&mut self, records: &[u8]) {
        let mut payload = Vec::with_capacity(8 + records.len());
        payload.extend((4 + records.len() as u32).to_le_bytes());
        payload.extend(b"EMF+");
        payload.extend(records);
        self.add(EMR_GDICOMMENT, &payload);
    }
}

fn plus_record(out: &mut Vec<u8>, kind: u16, flags: u16, data: &[u8]) {
    debug_assert!(data.len() % 4 == 0);
    out.extend(kind.to_le_bytes());
    out.extend(flags.to_le_bytes());
    out.extend((12 + data.len() as u32).to_le_bytes());
    out.extend((data.len() as u32).to_le_bytes());
    out.extend(data);
}

fn words(values: &[u32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn gdi(value: f32) -> i32 {
    (value * UNITS).round() as i32
}

/// The bounds of points in device pixels (inclusive).
fn bounds(points: &[(f32, f32)]) -> [i32; 4] {
    let (mut left, mut top, mut right, mut bottom) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for &(x, y) in points {
        (left, top, right, bottom) = (left.min(x), top.min(y), right.max(x), bottom.max(y));
    }
    [
        left.floor() as i32,
        top.floor() as i32,
        right.ceil() as i32,
        bottom.ceil() as i32,
    ]
}

fn rect(bounds: [i32; 4]) -> Vec<u8> {
    bounds
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// The EMF of `fills` moved by (`dx`, `dy`) onto a `width` x `height` pixel picture; opaque fills are emboldened by
/// `stem_darkening` pixels.
pub(super) fn write(
    fills: &[Fill],
    dx: f32,
    dy: f32,
    width: f32,
    height: f32,
    stem_darkening: f32,
) -> Vec<u8> {
    let mut records = Records::default();

    let mut header = Vec::new();
    plus_record(
        &mut header,
        EMF_PLUS_HEADER,
        0x0001,
        &words(&[EMF_PLUS_VERSION, 0x0000_0001, 96, 96]),
    );
    records.plus(&header);
    let mut state = Vec::new();
    // anti-aliased (SmoothingModeAntiAlias8x4), no pixel offset, blended edges, page units of one pixel
    plus_record(&mut state, EMF_PLUS_SET_ANTI_ALIAS_MODE, (4 << 1) | 1, &[]);
    plus_record(&mut state, EMF_PLUS_SET_PIXEL_OFFSET_MODE, 3, &[]);
    plus_record(&mut state, EMF_PLUS_SET_COMPOSITING_MODE, 0, &[]);
    plus_record(
        &mut state,
        EMF_PLUS_SET_PAGE_TRANSFORM,
        2,
        &1.0f32.to_le_bytes(),
    );
    records.plus(&state);
    records.add(EMR_SETMAPMODE, &words(&[8])); // MM_ANISOTROPIC
    records.add(EMR_SETWINDOWEXTEX, &words(&[UNITS as u32, UNITS as u32]));
    records.add(EMR_SETVIEWPORTEXTEX, &words(&[1, 1]));

    for fill in fills {
        let contours = if fill.argb >> 24 == 0xFF {
            embolden(&fill.contours, stem_darkening)
        } else {
            fill.contours
                .iter()
                .map(|contour| contour.points.clone())
                .collect()
        };
        let placed: Vec<Vec<(f32, f32)>> = contours
            .iter()
            .map(|points| points.iter().map(|&(x, y)| (x + dx, y + dy)).collect())
            .collect();

        // EMF+: the path as object 0, filled with the colour
        let count: usize = placed.iter().map(Vec::len).sum();
        let mut path = words(&[EMF_PLUS_VERSION, count as u32, 0]);
        for &(x, y) in placed.iter().flatten() {
            path.extend(x.to_le_bytes());
            path.extend(y.to_le_bytes());
        }
        for (contour, points) in fill.contours.iter().zip(&placed) {
            let mut kinds = contour.kinds.clone();
            if contour.closed {
                *kinds.last_mut().expect("a contour has points") |= CLOSE_SUBPATH;
            }
            debug_assert_eq!(kinds.len(), points.len());
            path.extend(kinds);
        }
        path.resize(path.len().next_multiple_of(4), 0);
        let mut drawing = Vec::new();
        plus_record(&mut drawing, EMF_PLUS_OBJECT, 0x0300, &path);
        plus_record(
            &mut drawing,
            EMF_PLUS_FILL_PATH,
            0x8000,
            &fill.argb.to_le_bytes(),
        );
        records.plus(&drawing);

        // GDI: the same path with a solid brush of the colour (COLORREF is 0x00BBGGRR)
        let colorref = (fill.argb & 0xFF) << 16 | (fill.argb & 0xFF00) | (fill.argb >> 16 & 0xFF);
        records.add(EMR_CREATEBRUSHINDIRECT, &words(&[BRUSH, 0, colorref, 0]));
        records.add(EMR_SELECTOBJECT, &words(&[BRUSH]));
        records.add(
            EMR_SETPOLYFILLMODE,
            &words(&[if fill.even_odd { 1 } else { 2 }]),
        );
        records.add(EMR_BEGINPATH, &[]);
        for (contour, points) in fill.contours.iter().zip(&placed) {
            let (x, y) = points[0];
            records.add(EMR_MOVETOEX, &rect([gdi(x), gdi(y), 0, 0])[..8]);
            let mut index = 1;
            while index < points.len() {
                let kind = contour.kinds[index];
                let end = (index..points.len())
                    .find(|&i| contour.kinds[i] != kind)
                    .unwrap_or(points.len());
                let run = &points[index..end];
                let mut payload = rect(bounds(run));
                payload.extend((run.len() as u32).to_le_bytes());
                for &(x, y) in run {
                    payload.extend(gdi(x).to_le_bytes());
                    payload.extend(gdi(y).to_le_bytes());
                }
                records.add(
                    if kind == BEZIER {
                        EMR_POLYBEZIERTO
                    } else {
                        EMR_POLYLINETO
                    },
                    &payload,
                );
                index = end;
            }
            if contour.closed {
                records.add(EMR_CLOSEFIGURE, &[]);
            }
        }
        records.add(EMR_ENDPATH, &[]);
        records.add(EMR_FILLPATH, &rect(bounds(&placed.concat())));
        records.add(EMR_SELECTOBJECT, &words(&[WHITE_BRUSH]));
        records.add(EMR_DELETEOBJECT, &words(&[BRUSH]));
    }

    let mut end = Vec::new();
    plus_record(&mut end, EMF_PLUS_END_OF_FILE, 0, &[]);
    records.plus(&end);
    records.add(EMR_EOF, &words(&[0, 16, 20]));

    header_and(records, width, height)
}

/// EMR_HEADER (with both extensions and a description) in front of the records.
fn header_and(records: Records, width: f32, height: f32) -> Vec<u8> {
    let description: Vec<u8> = "TexType\0Formula\0\0"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let header_size = 108 + description.len().next_multiple_of(4);
    let total = header_size + records.bytes.len();
    let pixels = [0, 0, width.ceil() as i32 - 1, height.ceil() as i32 - 1];
    let frame = [
        0,
        0,
        (width * FRAME_UNITS_PER_PIXEL).round() as i32 - 1,
        (height * FRAME_UNITS_PER_PIXEL).round() as i32 - 1,
    ];
    let mut out = Vec::with_capacity(total);
    out.extend(EMR_HEADER.to_le_bytes());
    out.extend((header_size as u32).to_le_bytes());
    out.extend(rect(pixels));
    out.extend(rect(frame));
    out.extend(words(&[
        0x464D_4520, // " EMF"
        0x0001_0000,
        total as u32,
        records.count + 1,
    ]));
    out.extend(2u16.to_le_bytes()); // handles: the table's own slot 0 and the brush
    out.extend(0u16.to_le_bytes());
    out.extend(words(&[
        (description.len() / 2) as u32,
        108,
        0,
        DEVICE.0,
        DEVICE.1,
        DEVICE_MM.0,
        DEVICE_MM.1,
    ]));
    out.extend(words(&[0, 0, 0])); // no pixel format, no OpenGL
    out.extend(words(&[DEVICE_MM.0 * 1000, DEVICE_MM.1 * 1000]));
    out.extend(&description);
    out.resize(header_size, 0);
    out.extend(records.bytes);
    out
}
