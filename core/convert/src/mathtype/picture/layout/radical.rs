//! The radical sign's shape as MathType 6.9 constructs it from the radical width and thickness settings (22, 28)
//! and its height (probe-pc/rad-*: the width 50-300 %, the thickness 2.5-15 % of the size, roots over x, a
//! descender, a fraction and with an index, at 12, 18 and 24 pt; every outline point within a pixel).
//!
//! In units from the tip (x) and up from the bottom point (y), the height `h` reaching the bar's top, the pen `p`
//! the radical thickness and `w` the radical width times the size in 384ths of an em:
//! - the thin rising stroke: its left edge from (126 w, 0) to (230 w, h), the pen wide; the bar on top of it;
//! - the tick: its top edge from the tip (0, h/3) to (2.8 p, 0.4 h), two thirds of the pen wide, cut square at the
//!   tip;
//! - the thick falling stroke: 13/8 of the pen wide, its right edge through the tick's end and its left edge
//!   through the thin stroke's foot;
//!
//! the outline the strokes' edges meeting; the thin line MathType draws over it through the tick's middle at the
//! tip, where the tick's and the thick stroke's middles cross, the thin stroke's middle at the bottom and at the
//! bar's middle, and the bar's end.

/// A point (x, y).
type Point = (f64, f64);

/// Points in whole units.
type Points = Vec<(i32, i32)>;

/// Where the line through `a` along `da` crosses the line through `b` along `db`.
fn cross(a: Point, da: Point, b: Point, db: Point) -> Point {
    let det = da.0 * (-db.1) - da.1 * (-db.0);
    if det.abs() < 1e-9 {
        return a;
    }
    let (rx, ry) = (b.0 - a.0, b.1 - a.1);
    let t = (rx * (-db.1) - ry * (-db.0)) / det;
    (a.0 + da.0 * t, a.1 + da.1 * t)
}

fn unit(v: Point) -> Point {
    let l = v.0.hypot(v.1).max(1e-9);
    (v.0 / l, v.1 / l)
}

fn add(a: Point, b: Point, k: f64) -> Point {
    (a.0 + b.0 * k, a.1 + b.1 * k)
}

/// A normal of a direction pointing right (down for a horizontal one).
fn right_normal(d: Point) -> Point {
    let n = (d.1, -d.0);
    if n.0 < 0.0 || (n.0 == 0.0 && n.1 > 0.0) {
        (-n.0, -n.1)
    } else {
        n
    }
}

/// The radical's thin line (5 points) and outline (11 points), in units from the tip and up from the bottom point:
/// `width` the radical width setting as a share (1 at 100 %), `size` the type size, `pen` the radical thickness,
/// `height` from the bottom point to the bar's top, `bar_end` where the bar ends.
pub(super) fn shape(
    width: f64,
    size: i32,
    pen: i32,
    height: i32,
    bar_end: i32,
) -> (Points, Points) {
    let (p, h) = (f64::from(pen), f64::from(height));
    let w = width * f64::from(size) / 384.0;
    let (tick, thick) = (p * 2.0 / 3.0, p * 13.0 / 8.0);
    let tip = (0.0, h / 3.0);
    let tick_end = (2.8 * p, 0.4 * h);
    let foot = (126.0 * w, 0.0);
    let corner = (230.0 * w, h);
    // the tick: its top edge, its bottom edge two thirds of the pen below
    let d = unit((tick_end.0 - tip.0, tick_end.1 - tip.1));
    let n = right_normal(d);
    let n = if n.1 > 0.0 { (-n.0, -n.1) } else { n };
    let tip_low = add(tip, n, tick);
    // the thin stroke: its left edge, its right edge the pen to the right
    let e = unit((corner.0 - foot.0, corner.1 - foot.1));
    let m = right_normal(e);
    let thin_right = add(foot, m, p);
    let at_height = |a: Point, y: f64| cross(a, e, (0.0, y), (1.0, 0.0));
    // the thick stroke: the line from the foot whose distance from the tick's end is its width, the end on its right
    let v = (tick_end.0 - foot.0, tick_end.1 - foot.1);
    let phi = (thick / v.0.hypot(v.1)).min(1.0).asin();
    let base = v.1.atan2(v.0);
    let u = [base + phi, base - phi]
        .into_iter()
        .map(|a| (a.cos(), a.sin()))
        .find(|u| foot.0 + u.0 * (tick_end.1 - foot.1) / u.1 < tick_end.0)
        .unwrap_or((v.0, v.1));
    let u = unit(u);
    let inner = cross(tick_end, u, foot, e);
    let tick_join = cross(tip_low, d, foot, u);
    let bar_bottom = h - p;
    let outline = [
        tip,
        tick_end,
        inner,
        corner,
        (f64::from(bar_end), h),
        (f64::from(bar_end), bar_bottom),
        at_height(thin_right, bar_bottom),
        at_height(thin_right, 0.0),
        foot,
        tick_join,
        tip_low,
    ];
    // the thin line through the strokes' middles
    let tick_middle = add(tip, n, tick / 2.0);
    let thick_middle = add(foot, right_normal(u), thick / 2.0);
    let thin_middle = add(foot, m, p / 2.0);
    let bar_middle = h - p / 2.0;
    let line = [
        tick_middle,
        cross(tick_middle, d, thick_middle, u),
        at_height(thin_middle, 0.0),
        at_height(thin_middle, bar_middle),
        (f64::from(bar_end), bar_middle),
    ];
    let round = |q: &Point| (q.0.round() as i32, q.1.round() as i32);
    (
        line.iter().map(round).collect(),
        outline.iter().map(round).collect(),
    )
}
