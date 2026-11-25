# Editing core

Where the caret can be, how it moves, what an empty slot is, and how the caret, empty slots and selection are
drawn: the rules the editing core (`ui/kernel/src`) implements. Code cites them by section (`EDITING.md §5`).

## 1. Goal

One module of our own owns everything about where the caret can be, how it moves, what an empty slot is and how
the caret and empty slots are drawn. Every key, click and command goes through it. Nothing else decides these
things: no build-time text patches, no app key interception, no DOM measurement.

The kernel taken over from MathLive keeps the model, parsing, serialising and input; it asks the core for every decision
listed below.

## 2. Ownership

| Concern | Owner |
|---|---|
| Caret stops (where the caret may be) | core `stops` |
| Order of a structure's parts | core `structures` (one table) |
| Arrows, word moves, Home/End, Tab, Shift+Tab, Up/Down, Space-exit | core `navigation` |
| Empty slots (placeholders): show, enter, type, delete, restore, first slot after insert | core `slots` |
| Backspace/Delete at structure edges | core `editing` |
| Selection (keyboard and mouse, one rule) | core `selection` |
| Click → caret, drag, double/triple click | core `pointer` |
| Caret, empty-slot marker, selection and "inside" cue geometry | engine snapshot + core `geometry` |
| Text vs math mode at a text run's edge | core `mode` (one rule) |
| Key dispatch | core `input` (one listener) |
| Focus + caret restore after an app rewrite | core `restore` (one function) |
| Scrolling the caret into view | core (one scroller) |
| Colours of caret, marker, selection | CSS variables only |

The app keeps document-level work (formula rows, toolbar, Office) and talks to the core through commands and events.

## 3. Concepts

**Slot** — an editable list inside a structure (numerator, superscript, radicand, matrix cell, macro argument) or the
formula's top level. Items in a slot are atoms.

**Stop** — a caret position: `(slot, i)`, between item `i-1` and item `i`, `0 ≤ i ≤ length`. A stop
is stored as the kernel offset it maps to (offset of the slot's `first` atom for `i = 0`, otherwise the offset of item
`i-1`); every stop maps to exactly one offset. A stop is **allowed** unless its slot lies inside an atomic structure's
internals (see `atomic`). Arrows, Tab, clicks, insertions and restores only ever produce allowed stops.

**Structure spec** — one entry per structure kind, the only place its behaviour is described:
- `slots`: slot names in navigation order (used identically by arrows, Tab, Shift+Tab, Backspace order and hit-testing);
- `vertical`: which slot is above/below which, for Up/Down;
- `atomic`: the structure's own internals have no stops; only its declared argument slots do (macros such as
  `\ket`, `\bra`, `\braket`);
- `empty`: what an empty slot is — `marker` (keeps the slot, shows a marker) or `drop` (an empty optional script or
  index disappears when the caret leaves it);
- `backspaceAtStart` / `deleteAtEnd` per slot: `exit`, `dissolve` (replace the structure by its other content),
  `remove-if-empty`, `select-structure`;
- `exit`: where the caret goes after the last slot (after the structure, or the next empty slot of the enclosing
  structure for Tab).

**Empty slot** — a slot with no items, or whose only item is a `\placeholder{}` atom. While the kernel model is still
used, the placeholder atom is the persistence form of an empty slot; the core treats "caret in an empty slot" as one
state, whether the kernel holds it as a collapsed caret or as the placeholder atom selected. Saved LaTeX keeps
`\placeholder{}`.

**Caret state** — `{stop, anchor, mode}`; mode is math, text or latex (command being typed).

## 4. Structure table

Order is reading order, the same for every key. Entries marked ★ differ from MathLive's own behaviour.

| Kind | Slots in order | Vertical | Empty slot | Notes |
|---|---|---|---|---|
| fraction, binom, genfrac, cfrac | numerator, denominator (or the user's fraction-order setting) | num above den | marker | setting applies to arrows, Tab and Backspace alike ★ |
| scripts on a nucleus / subsup | subscript, superscript | sup above sub | drop | ArrowDown in a lone superscript returns to the baseline; it never creates a subscript ★ |
| big operator with limits (∑ ∫ lim) | lower, upper, then its operand (below) | upper above lower | marker for inserted templates, else drop | the operand is a region of its own, derived from the row (the formula's LaTeX has no slot for it) |
| root `\sqrt[n]{x}` | index, radicand | — | index: drop; radicand: marker | one order for arrows and Tab ★ |
| `\left…\right` | body | — | marker | |
| accents, over/under (`\hat`, `\overline`, `\overset`, `\underbrace`, `\underarc`), `\mathop` | body, then above/below | above/below body | marker | the body is a slot with all its stops, filled or empty (2026-11-15: `\hat{a}` could be typed but never edited again) ★ |
| array, matrix, cases, aligned | cells row by row | rows | marker | last-cell Tab adds a row and keeps the column for align/split ★ |
| macro (`\ket`, `\bra`, `\braket`, …) | its arguments | — | marker | atomic: one Tab from an argument leaves the macro; no stops inside its expansion, but every argument is reachable whatever the expansion wraps it in (`\mel`'s `\smash`, `\va`'s `\vec`) ★ |
| text run (`\text{…}`) | — (items are characters) | — | — | caret inside the run is text mode; at either edge math (§6.6) |
| top level | — | — | — | |

**A big operator's operand** (∫ ∮ ∑ ∏ ∐ ⋃ ⋂ ⨀ ⨁ ⨂ ⨄ ⨆ and the other extensible symbols; as AxMath's caret shows it: the
underline inside the integral's operand covers only the operand, outside it the whole row; the same for ∑ and ∏): the items
after the operator that it applies to. LaTeX writes them loose in the operator's row, so the extent is a rule
(`src/layout/operand-scope.ts`), the one the conversion to Word equations uses for the body of the native n-ary object
and the MathML export for the operand's mrow: the operand
runs up to a relation or a separator, to a fence that closes something opened before the operator, and to the row's end; a
sum also ends at a top-level sign (`∑ aᵢ + b` is (∑ aᵢ) + b), an integral only at one that comes after its differential
(`∫ x + 1 dx` holds the plus, `∫ f dx + c` does not). An operator inside another's operand cannot reach past its end.
Stops: the stop right after the operator and its limits is the operand's start (AxMath: the bar alone, as tall as the
operand; no stop of the row stands between the sign and its operand); the stops after the items are inside it. The end of
an operand is one kernel offset that is also the end of every operand that ends there and a place of the row: the caret has
one **level** for each of them (`CaretGeometry.levels`, the core's `caretLevel`): the first inside the innermost operand
(the underline under it only), then inside the next one, the last outside them all (under the whole row, or under the
operand that goes on). The levels are set a little apart (the stops' separation at a structure's end) and Right steps
through them before it moves on, Left (and End) comes in from the outside; typing, clicks and every other move put the
caret at the first. AxMath's operand is a slot the user typed into; here the text stays flat and the rule decides.

New kinds are added to this table, not to handlers.

## 5. Geometry and drawing

The engine already places every glyph in TeX's layout. It additionally returns a **layout snapshot** for the editor:

- `atomBox(atom)` — the atom's own box (its glyphs and the italic correction TeX added after it), never a wrapper
  shared with other atoms (fixes text, colour and font runs whose first character was given the whole run);
- `slotBox(slot)` — union of the slot's item boxes, or the empty-slot marker box;
- `caret(stop)` — `{x, top, bottom}` in formula units (sp, y down from the formula top):
  - `x`: start of slot → left edge of the first item's box; after item → right edge of its box (includes italic
    correction, so the bar never cuts a slanted letter); after a binary operator or relation → left edge of the next
    item (past the operator's space); empty slot → left edge of the marker; neighbouring stops that would share one
    place at a structure boundary (the end of a radicand and after the radical) are set 0.1em apart, the outer one
    outside the structure, so every key press shows the caret moving;
  - `top/bottom`: the stop's own band: 0.76em tall, foot 0.05em below the baseline, scaled with the size TeX sets the
    atom beside the caret in (1 text, 0.7 script, 0.5 script's script; the typesetter records it); the empty-slot
    marker spans the same band, so the caret keeps its size and place when the first character is typed. Popovers and
    the IME anchor to it (`caretReach` for the whole drawn caret). The drawn caret is the L of `region` below;
  - `region` — the box of the content of the slot the stop is in: x from the first item's left edge to the last item's
    right edge, y from the top of the tallest item (a nested structure, an accent, scripts included) to the foot of the
    deepest, a line's strut (0.75em up, 0.25em down, at the slot's size) as the least. None for an empty slot (its
    marker is its box) and for a formula set on several lines. `underline` — the stop is after an item of its slot,
    not at its start;
  - the baseline used is the item's own line (a script's caret on the script, the caret after `\int_0^1` on the
    main baseline);
- `marker(slot)` — empty-slot marker rectangle (0.40em of the slot's size wide, the caret bar's band high, centred on
  the slot's x-box), drawn by the engine itself; the caret in that slot touches its left edge and spans its height;
- `selectionRects(range)`, `insideCue(stop)` — rectangles for the selection highlight; the delimiters/sign of the
  structure holding the caret are tinted with the caret colour;
- `hitTest(point)` — page point → allowed stop, by AxMath's rule (`rectHit.ts`): no nearest-point search and no glyph outlines, but one rectangle per atom in
  device pixels (truncated as Windows does; left and top edges in, right and bottom out). Across, an atom's rectangle
  runs from the caret before it to the caret after it (its advance: the space around an operator is the operator's),
  1 px wider each side, 3 px on the left of a slot's start (the caret before the first item is easy to reach; an
  empty slot's start is its marker); up and down, its own box 0.2em higher and lower (`HIT_VERTICAL_MARGIN_EM`, a
  choice: AxMath reads this margin from its style profile), at the top level of the formula the whole row (the
  field's box). The point is tested along a slot's atoms in order (where two rectangles meet, the first one's: a base
  takes the pixel or two where its scripts start); in an atom its slots come first, in their order; when no slot
  holds the point the middle of the atom's rectangle decides: the stop after it (right half) or before it (left
  half). A stop the caret may not take (a macro's expansion, a phantom) becomes the nearest enclosing
  atom's stop before or after it. Nothing in the row: the formula's first stop if the point is left of it, else its
  last.

**The L-shaped caret** (as AxMath's: when the caret is inside an accent the underline covers only the characters
inside the accent, and the same for every other structure; measured in AxMath: 1 px bar, 1 px line, the
bar's last pixel row is the line's row, the line's right end is where the bar stands at the region's end, both blink
together): the bar is as tall as the region; once the caret is after an item of its region, a line runs along the foot of
the whole region, just below its box (0.05em thick, the bar 0.08em; the bar reaches down to the line's lower edge, the
line's ends stand a half bar width out so the bar is flush on it). So inside `\hat{BC}` only BC is underlined, in a
numerator only the numerator, at the top level the whole row, whatever the structures inside it. At the start of a region
the bar stands alone (as in AxMath), in an empty slot only the marker bar. The bar and the line are one element (they
blink together, and the caret's colour is the theme's). This replaces the 2026-10-21 rule that the bar never stretches to
its slot (too tall in scripts and nested structures when it stood alone; with the line, its height says which region it
is). Regions are the slots of the structure table (§4): the row, numerator, denominator, radicand and index, scripts,
limits, operands, bracket content, matrix cells, an accent's content. Test: `caret_underline_regression.mjs`; the operand's
region and levels (§4): `caret_operand_regression.mjs`.

The painter draws the caret, markers, selection and tint from these numbers. The kernel and the app never measure the
page: anything that needs a position (popovers, IME candidate window, scrolling, the app's row layout) asks the core,
which converts formula units to page pixels with the field's origin, zoom and scroll.

CSS keeps only colours (`--formula-caret`, `--formula-placeholder`, `--formula-placeholder-selected`, selection) and
the blink animation.

## 6. Behaviour rules

### 6.1 Left/Right
Move to the next/previous allowed stop in document order (slot order from §4, depth-first). A range selection
collapses to its edge first. Word moves (Ctrl+Left/Right) skip runs of letters/digits within a slot. At the end of a big
operator's operand (§4) Right first steps through the caret's levels there (inside the operand, outside it), Left comes
in from the outside; End goes outside every operand that ends at the row's end. Test: `caret_operand_regression.mjs`.

### 6.2 Home/End
Start/end of the current slot; pressed again, of the top level.

### 6.3 Tab / Shift+Tab
Within the structure holding the caret: next empty slot ahead in the current slot's subtree, else the next slot of the
structure, else out of the structure (after it). Atomic structures are left in one press. In the last cell of an
array, Tab adds a row. While a command is being typed, Tab accepts the suggestion (handled by the completion, which
reports back to the core). Tab never moves focus out of the field; Esc-then-Tab leaves the formula.

### 6.4 Up/Down
Inside a structure with a vertical relation (§4): move to the slot above/below, keeping x as close as possible
(geometry from the snapshot). Lone superscript/subscript: back to the baseline. Otherwise the request goes to the app
(previous/next formula row). Never creates branches.

### 6.5 Space
Input-conversion hook first (upright/escapes). Then, inside a structure whose spec says so, exit after it; at the top
level insert a visible space `\ `. One place, one judgment.

### 6.6 Text/math mode at text runs
Text mode iff the items on both sides of the caret are text (between two characters of one run); at either edge of a
run the caret is in math. The mode after a caret move, `setValue`, paste, IME composition and mode display all use
this rule (core `text.ts`). Space beside a run (at its start or end) adds one word space to that run. An explicit mode
switch (typing `\text`, the menu) holds until the caret moves.

### 6.7 Empty slots
- Entering an empty slot (any way: keys, click, insertion, restore) gives the single "caret in empty slot" state.
- Typing, IME commit, paste or a command in that state fills the slot; the slot's style (bold, colour) carries over.
- Backspace in an empty slot follows the slot's `backspaceAtStart`; deleting the last item of a `marker` slot leaves
  the empty slot; of a `drop` slot removes it when the caret leaves.
- After inserting a template, the caret goes to its first empty slot in slot order (one function for typed commands,
  toolbar tiles, suggestion acceptance and input conversion).

### 6.8 Backspace/Delete
At a slot's start/end, per the structure spec (enter the script first, dissolve an emptied fraction, remove an empty
script, select a filled big operator before deleting it). Inside a slot, delete one item. Multi-row deletion and row
merging stay app commands invoked by the core when the caret is at the top level's edge.

### 6.9 Selection and pointer
A selection is a run of siblings in one slot: between an anchor stop and a focus stop it is the run of the innermost
slot holding both, each end widened to the item that holds it; two slots of one structure (numerator and denominator)
select the structure; matrix cells select a run of cells; a macro's expansion selects the macro; a base takes its
scripts along, while the scripts alone can be selected (to format an exponent). The selection remembers the stop it started from, so a selection widened to a whole structure shrinks back
into the slot it started in. Shift+Left/Right move the focus to the next stop that changes the selection (no dead
presses); Shift+Up/Down, Shift+Home/End, Ctrl+Shift+Left/Right, Alt+Shift+Left/Right, Shift+click and mouse drags
extend from the anchor with the same rule. Click = `hitTest`; double-click selects the item under the pointer (a run
of text letters, a number, a math letter, or a structure when its own ink is hit); triple-click selects the slot.
One pointer handler (the kernel's, deciding nothing itself); the app only forwards clicks in a row's space beside the
field. The mouse follows AxMath: a press places the caret at `hitTest` and anchors there;
a move selects from the anchor to the stop under the pointer, again only when that stop changes, and only while the
left button is held (a move without it ends any tracking or drag whose release never arrived, so a free mouse never
drags a selection along); letting go keeps the selection. A touch keeps a 20 px / 500 ms tap zone; a mouse has none.
A caret the app places (a click in a row's space beside its formula) is drawn at once, also in a field that already
has the focus.

Formula rows (the formula editor, `rowPointer.ts`): the row a point means is the first one whose bottom is at or below
it (there is no top check: the space above a row is that row's; below the last row there is none and a drag there
changes nothing). While the pointer stays in the pressed row the formula selects (pressed in the row beside the
formula, which the formula never sees, the editor selects within the row too); once it reaches another row the
editor takes the gesture over (the formula stops tracking) and selects across rows: each end at the top level of its
formula — an end inside a structure takes the whole structure, the first row from before it, the last row up to after
it — the first row's end, the rows between, the last row's start. Back in the pressed row it is the formula's own
selection again. Shift+click selects from the caret (or the anchor of a selection across rows) to the point, across
rows too; in the caret's own row the formula extends its selection. Delete, cut and copy take what the rows show.

Bold (the toolbar, Ctrl+B in documents, the bold typing style) is symbol-wide bold, bm.sty's `\bm` (user,
2026-11-01: "bold is not applied to math symbols at all"): every glyph keeps its slant and class and takes its bold
font (letters and Greek bold italic, digits and operators bold upright, symbols from the bold symbol font, large
operators in poor man's bold); spacing and widths match LaTeX with bm.sty. Only a letter set against its own slant
uses the alphabets (`\mathbf` upright, `\mathbfit` italic). `\bm`, `\boldsymbol` and `\bold` parse to it (no
letters-only alias), and the MathML the Office conversions read carries it (`mathvariant` bold / bold-italic).

Deliberate differences from AxMath: Shift+drag keeps the anchor (AxMath anchors again at the press); matrix cells keep
the cell runs above (AxMath selects the whole matrix); a click on a selection places the caret (§6.12).

### 6.10 Restore after an app rewrite
When the formula is replaced (an input conversion, its Backspace revert, contextual upright normalisation), the
caret is carried through an alignment of the old and new atoms (core `restore.ts`: longest common subsequence of
atom descriptions — type, value, command, branch, depth): if the atom before the caret survived, the caret follows
it; if it was rewritten, the caret goes after its replacement; the result snaps to an allowed stop. Not by distance
from the end, which put the caret in the wrong place as soon as something after it changed too (typing before an
unconverted `cos` converted it and the caret jumped back two atoms). A reparse of the same LaTeX
with new macro definitions (custom symbols) keeps anchoring by the LaTeX text before each end, which is exact there.
Moving to another row (Up/Down past the formula's edge) focuses it through the editor's one guarded focus routine
(`focusLine`): its delayed repairs never replay over input that arrived meanwhile (unguarded re-applications at
0 ms, next frame and 80 ms reverse fast typing: ArrowUp, x, y would give "yx").

### 6.11 Enter and Escape
Enter: Shift+Enter (no other modifier, not composing, no LaTeX typed in the box) breaks the line inside the formula
(it becomes aligned or gathered); in the LaTeX box Enter completes the command; inside `cases` it adds a case row;
elsewhere, with or without modifiers (after the editor's row hotkeys), it splits the formula row at the caret — a new
row after it when the caret is at its end or inside a structure. Escape with a selection collapses it to its end
(the kernel would turn it into a raw LaTeX group whose text the saved value drops); otherwise it opens the LaTeX box,
or completes it when open. Row-level states take Escape first (a multi-row selection, a pending Greek-letter prefix,
the context menu). The core (`keys.ts`) decides; the editor performs row commands and the kernel the LaTeX box.

### 6.12 Dragging a selection
AxMath's drag (`drag-drop.md`; kernel `selection-drag.ts`, rows in `MathEditor`): a press on the selection's highlight
(its boxes, merged where they share a top and bottom, across gaps too) drags it — this comes before Shift is looked
at; a double or triple click selects as anywhere else. The drag starts when the pointer leaves the pixel it was
pressed in, or after 200 ms (MFC's drag delay). While it lasts the selection stays highlighted and a drop caret (a
caret bar; no line under the slot) shows where `hitTest` puts it; in the formula editor any row is a
target (the row rule of §6.9; below the last row the last place stays). Near the editor's edges it scrolls: a 50
device-pixel band, a counter per axis in [-20, 20] stepping each 50 ms tick, scrolling 20 px from 5 on. Letting go:
outside the editor nothing is dropped; on the selection itself or its edges (a move there changes nothing) it is a
click there (AxMath does nothing; TexType places the caret, as Word does); otherwise the selection is moved there,
or copied when Ctrl is held at the release, and the dropped part is selected. Esc or the right button cancel (the
right button opens no menu then). Within one formula the move is one edit of the formula (one undo step, one input
event); between rows, and for a selection across rows, the editor makes it one replace-document step. A selection
across rows dropped at the top level of a row stays rows (the first part joins the row before the stop, the last part
the row after it, the rows between come along); dropped inside a structure its parts go in as one. Moved, the rows it
leaves are joined as Delete joins them.

## 7. Input and app boundary

One keydown/beforeinput/composition listener on the field, owned by the core. A keymap maps keys to core commands.
The app registers its own commands (rows, hotkeys, Office) with the core instead of listening to keys; the core calls
them for keys it does not consume (Up/Down at the top level, Enter outside arrays, Ctrl+Z/Y → app history).
The app may: send commands (`insert`, `select`, `focus`, `setValue(latex, {restore})`), read state and geometry, set
colours. The app may not: intercept movement or editing keys, set positions by offset arithmetic, measure the field's
DOM, style geometry.

## 8. Invariants checked on every formula of the corpus

1. Right-walk and left-walk visit the same allowed stops, in exactly opposite order; every stop is visited once.
2. Within one slot, caret x never decreases on Right and never increases on Left.
3. Each press moves the caret visibly (no two consecutive stops with the same caret rectangle), except where the
   spec allows it.
4. Tab visits slots in the structure table's order.
5. Typing a character at every allowed stop changes the saved LaTeX (no input lost).
6. Clicking the centre of each stop's caret bar returns that stop; where two carets coincide (the end of a radicand and
   the end of the radical), a click just beside the bar, on the item next to it, does.
7. The caret bar never overlaps a glyph's ink box of the item before it.
8. The empty-slot caret touches the marker's left edge and spans its height.
