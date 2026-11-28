//! Matrices and piles: cells in rows and columns (see the parent module's rules), and a matrix's partition
//! lines.

use super::*;

/// A matrix's partition lines: two bits per line (1 solid, 2 dashed, 3 dotted), the rows' lines from the top
/// border down, the columns' from the left border on.
struct Partitions<'p> {
    rows: &'p [u8],
    columns: &'p [u8],
}

impl Partitions<'_> {
    const NONE: Partitions<'static> = Partitions {
        rows: &[],
        columns: &[],
    };

    fn kind(bytes: &[u8], i: usize) -> u8 {
        bytes.get(i / 4).map_or(0, |b| (b >> (2 * (i % 4))) & 3)
    }

    fn any(&self) -> bool {
        self.rows.iter().chain(self.columns).any(|&b| b != 0)
    }
}

impl<'a> Layout<'a> {
    /// A matrix as the line's next element: a grid with the row spacing (setting 1), cells centred in their
    /// columns, and its partition lines.
    pub(super) fn matrix(&mut self, matrix: &'a Matrix, line: &mut Block) -> Result<(), String> {
        let (rows, columns) = (usize::from(matrix.rows), usize::from(matrix.columns));
        let size = self.size;
        let cells = self.cells(&matrix.content, rows * columns)?;
        self.size = size;
        let partitions = Partitions {
            rows: &matrix.row_partitions,
            columns: &matrix.column_partitions,
        };
        let pitch = self.spacing(1, size);
        let least = 108 * size / 384;
        let mut block = self.grid(
            cells,
            columns,
            pitch,
            Some(least),
            Align::Centre,
            &partitions,
        );
        // a matrix spaces itself as an inner element, as a fence does (probe-pc/fl-matrix-*, fl-x-matrix)
        for edge in [&mut block.first, &mut block.last].into_iter().flatten() {
            edge.class = Class::Inner;
        }
        line.append(block, self.gaps());
        Ok(())
    }

    /// A pile (lines stacked as one element): a grid of one column with the line spacing (setting 0), its lines
    /// aligned left, centred or right (MTEF halign 1, 2, 3).
    pub(super) fn pile(&mut self, pile: &'a Pile, line: &mut Block) -> Result<(), String> {
        let align = match pile.horizontal {
            1 => Align::Left,
            2 => Align::Centre,
            3 => Align::Right,
            4 => Align::Relation,
            5 => Align::Decimal,
            other => return Err(format!("not drawn yet: pile alignment {other}")),
        };
        // the size in force where the pile starts (its lines may change it)
        let size = self.size;
        let cells = self.cells(&pile.content, 0)?;
        self.size = size;
        let pitch = self.spacing(0, size);
        // the room its first line keeps above its ink (an upper limit's em top) as a line alone keeps it
        // (genuine/integrals; probe-pc/pl-*: a sum, an integral with limits, a fraction, a superscript)
        let above = cells.first().and_then(|c| {
            let top = c.reserved.max(c.place)?;
            Some(top - c.drawn()?.2)
        });
        let mut block = self.grid(cells, 1, pitch, None, align, &Partitions::NONE);
        // otherwise a pile reaches as far as its ink (a matrix keeps its rows' em boxes)
        block.reserved = above
            .filter(|&a| a > 0)
            .and_then(|a| Some(block.drawn()?.2 + a));
        block.reserved_bottom = None;
        line.append(block, self.gaps());
        Ok(())
    }

    /// The lines of a matrix or pile laid out, at least `count` of them (missing ones empty).
    fn cells(&mut self, content: &'a [Record], count: usize) -> Result<Vec<Block>, String> {
        self.depth += 1;
        let mut cells = Vec::new();
        for record in content {
            match record {
                Record::Line(l) if l.options & LINE_NULL != 0 => cells.push(Block::default()),
                Record::Line(l) => {
                    let cell = self.line(&l.content);
                    cells.push(cell?);
                }
                other => self.state(other),
            }
        }
        self.depth -= 1;
        if cells.len() < count {
            cells.resize_with(count, Block::default);
        }
        Ok(cells)
    }

    /// Cells in rows and columns, as MathType's pictures show:
    /// - columns as wide as their widest cell's ink, a column spacing (setting 2) between them, cells aligned in
    ///   them by ink; row baselines `pitch` apart, or more: a matrix's so that `least` stays between the rows' em
    ///   boxes, a pile's so that a line's top (its em box) stays the pitch's surplus over the size below the ink of
    ///   the line before;
    /// - with partition lines each row's box (its cells' em boxes) reaches half the row spacing's surplus over the
    ///   size further up and down where a line runs above the row, each column's box (its widest cell's ink) half
    ///   the column spacing further on each side with a line; these boxes count as the grid's ink;
    /// - an odd number of rows has the middle row's baseline on the line's, an even number the rows' boxes centred
    ///   on the math axis (the equation's own lines, a pile at its top, by their ink);
    /// - a line lies inside the box edge it marks (the last row's bottom, the last column's right edge for the
    ///   closing borders), across all columns' boxes or down all rows' boxes; the pen the matrix line thickness
    ///   (setting 27); dashes 1/3 em long and 1/5 em apart, dots 7/96 em long and apart, the length left over
    ///   shared by the first and last dash.
    fn grid(
        &self,
        cells: Vec<Block>,
        columns: usize,
        pitch: i32,
        least: Option<i32>,
        align: Align,
        partitions: &Partitions,
    ) -> Block {
        let size = self.size;
        let rows = cells.len().div_ceil(columns.max(1));
        let descent = size
            - self
                .fonts
                .em_ascent(
                    &Face {
                        name: "Times New Roman".into(),
                        bold: false,
                        italic: false,
                    },
                    size,
                )
                .unwrap_or(size * 3 / 4);
        // a cell's ink; one ending in scripts reaches the room after them (the minimum gap: a column of a₁₁ a₂₁
        // is that much wider, probe-pc/mx-sub*)
        let ink = |b: &Block| {
            let i = b.ink().unwrap_or((0, 0, 0, 0));
            let right = b
                .last
                .filter(|e| e.joins == Joins::Scripts)
                .map_or(i.1, |e| e.ink.max(i.1));
            (i.0, right, i.2, i.3)
        };
        let widths: Vec<i32> = (0..columns)
            .map(|c| {
                (0..rows)
                    .map(|r| {
                        let i = ink(&cells[r * columns + c]);
                        i.1 - i.0
                    })
                    .max()
                    .unwrap_or(0)
            })
            .collect();
        let heights: Vec<i32> = (0..rows)
            .map(|r| {
                (0..columns)
                    .map(|c| {
                        // its fonts' em top no higher than the em ascent the rows' depth takes (Cambria's
                        // typographic ascender does not raise a row: probe-pc/mx-*-cambria), its ink as high as
                        // it reaches
                        let cell = &cells[r * columns + c];
                        let ink_top = cell.ink().map_or(i32::MIN, |i| i.2);
                        self.slot_top(cell).min(size - descent).max(ink_top)
                    })
                    .max()
                    .unwrap_or(0)
            })
            .collect();
        let depths: Vec<i32> = (0..rows)
            .map(|r| {
                (0..columns)
                    .map(|c| -self.row_bottom(&cells[r * columns + c], size))
                    .max()
                    .unwrap_or(0)
                    .max(descent)
            })
            .collect();
        let mut baselines = vec![0];
        for r in 1..rows {
            let previous = baselines[r - 1];
            let needed = match least {
                Some(least) => depths[r - 1] + heights[r] + least,
                None => -ink(&cells[r - 1]).3 + heights[r] + pitch - size,
            };
            baselines.push(previous - pitch.max(needed));
        }
        let gap = self.spacing(2, size);
        let mut centres = vec![widths.first().copied().unwrap_or(0) / 2];
        for c in 1..columns {
            centres.push(centres[c - 1] + widths[c - 1] / 2 + gap + widths[c] / 2);
        }
        // the rows' and columns' boxes, widened where partition lines run
        let lined = partitions.any() && rows > 0 && columns > 0;
        let row_room = (self.spacing(1, size) - size) / 2;
        let column_room = gap / 2;
        let row_boxes: Vec<(i32, i32)> = (0..rows)
            .map(|r| {
                let room = if Partitions::kind(partitions.rows, r) != 0 {
                    row_room
                } else {
                    0
                };
                (
                    baselines[r] + heights[r] + room,
                    baselines[r] - depths[r] - room,
                )
            })
            .collect();
        let column_boxes: Vec<(i32, i32)> = (0..columns)
            .map(|c| {
                let room = |i| {
                    if Partitions::kind(partitions.columns, i) != 0 {
                        column_room
                    } else {
                        0
                    }
                };
                let left = centres[c] - widths[c] / 2;
                (left - room(c), left + widths[c] + room(c + 1))
            })
            .collect();
        let top = row_boxes.first().map_or(0, |b| b.0);
        let bottom = row_boxes.last().map_or(0, |b| b.1);
        let shift = if rows % 2 == 1 {
            -baselines[rows / 2]
        } else if least.is_none() && self.depth == 0 {
            // the equation's own lines (a pile at its top) by their ink
            let ink_top = baselines[0]
                + cells
                    .first()
                    .and_then(Block::ink)
                    .map_or(heights[0], |i| i.2);
            let ink_bottom = baselines[rows - 1]
                + cells
                    .last()
                    .and_then(Block::ink)
                    .map_or(-depths[rows - 1], |i| i.3);
            axis(size) - (ink_top + ink_bottom) / 2
        } else {
            axis(size) - (top + bottom) / 2
        };
        // lines aligned at a point of theirs: that point as far right as the farthest one is from its line's ink
        let anchors: Vec<i32> = cells.iter().map(|cell| anchor(cell, align)).collect();
        let aligned = (cells.iter().zip(&anchors))
            .map(|(cell, a)| a - ink(cell).0)
            .max()
            .unwrap_or(0);
        let mut block = Block::default();
        for (index, cell) in cells.into_iter().enumerate() {
            let (r, c) = (index / columns, index % columns);
            let (l, rt, _, _) = ink(&cell);
            let x = match align {
                Align::Left => centres[c] - widths[c] / 2 - l,
                Align::Centre => centres[c] - (rt - l) / 2 - l,
                Align::Right => centres[c] + widths[c] / 2 - rt,
                Align::Relation | Align::Decimal => aligned - anchors[index],
            };
            block.take(cell, x, baselines[r] + shift);
        }
        if lined {
            let (left, right) = (column_boxes[0].0, column_boxes[columns - 1].1);
            let (top, bottom) = (top + shift, bottom + shift);
            block.boxes.push((left, right, top, bottom));
            let pen = self.spacing(MATRIX_LINE_THICKNESS, size);
            let mut rule = |kind: u8, from: (i32, i32), to: (i32, i32)| {
                let length = (to.0 - from.0).abs().max((to.1 - from.1).abs());
                let along = |d: i32| {
                    (
                        from.0 + (to.0 - from.0).signum() * d,
                        from.1 + (to.1 - from.1).signum() * d,
                    )
                };
                for (a, b) in dashes(kind, length, size) {
                    block.lines.push(Rule {
                        from: along(a),
                        to: along(b),
                        width: pen,
                    });
                }
            };
            for i in 0..=rows {
                let kind = Partitions::kind(partitions.rows, i);
                if kind != 0 {
                    let y = match row_boxes.get(i) {
                        Some(&(row_top, _)) => row_top + shift - pen / 2,
                        None => bottom + (pen - pen / 2),
                    };
                    rule(kind, (left, y), (right, y));
                }
            }
            for j in 0..=columns {
                let kind = Partitions::kind(partitions.columns, j);
                if kind != 0 {
                    let x = match column_boxes.get(j) {
                        Some(&(column_left, _)) => column_left + pen / 2,
                        None => right - (pen - pen / 2),
                    };
                    rule(kind, (x, top), (x, bottom));
                }
            }
        }
        block.reserved = Some(top + shift);
        block.reserved_bottom = Some(bottom + shift);
        block.first_row = Some(shift);
        let (left, right) = block.ink().map_or((0, 0), |i| (i.0, i.1));
        // as far as its last column reaches (the room after scripts)
        let right = column_boxes.last().map_or(right, |b| b.1.max(right));
        let edge = |ink| Edge::structure(ink, right, Class::Ordinary, size);
        block.first = Some(edge(left));
        block.last = Some(edge(right));
        block
    }
}

/// Where a pile's line aligns (its own units): the ink centre of its first relation, its first decimal point (after
/// its first number's digits without one), else its ink start.
fn anchor(cell: &Block, align: Align) -> i32 {
    let start = cell.ink().map_or(0, |i| i.0);
    let mut glyphs: Vec<&Glyph> = cell.glyphs.iter().collect();
    glyphs.sort_by_key(|g| g.x);
    match align {
        Align::Relation => glyphs
            .iter()
            .find(|g| g.role == Role::Relation)
            .map_or(start, |g| {
                let (l, r, _, _) = g.ink();
                (l + r) / 2
            }),
        Align::Decimal => {
            if let Some(point) = glyphs.iter().find(|g| g.role == Role::Point) {
                return point.x;
            }
            let digits: Vec<&&Glyph> = glyphs
                .iter()
                .skip_while(|g| g.role != Role::Digit)
                .take_while(|g| g.role == Role::Digit)
                .collect();
            digits
                .last()
                .map_or(start, |g| g.x + Measure::scaled(g.measure.advance, g.wide))
        }
        _ => start,
    }
}

/// The pieces (from, to along it) of a line `length` long of a partition kind at a size: one piece when solid,
/// else dashes of the kind's length and spacing from end to end, as many as fit, the first and last longer by
/// half the length left over.
fn dashes(kind: u8, length: i32, size: i32) -> Vec<(i32, i32)> {
    let (on, off) = match kind {
        2 => (size / 3, size / 5),
        3 => (7 * size / 96, 7 * size / 96),
        _ => return vec![(0, length)],
    };
    if length <= on {
        return vec![(0, length)];
    }
    let gaps = (length - on) / (on + off);
    let extra = length - ((gaps + 1) * on + gaps * off);
    let mut pieces = Vec::new();
    let mut at = 0;
    for i in 0..=gaps {
        let mut piece = on;
        if i == 0 {
            piece += extra / 2;
        }
        if i == gaps {
            piece += extra - extra / 2;
        }
        pieces.push((at, at + piece));
        at += piece + off;
    }
    pieces
}
