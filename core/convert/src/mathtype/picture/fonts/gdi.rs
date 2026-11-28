//! Glyph measures on Windows, from Windows' own rasterizer as MathType takes them: GetGlyphOutline's
//! black-and-white bitmap of the glyph at 64 ppem (a glyph stretched one way: at its own size and font width; hinted
//! by Windows, which places some points of some glyphs a
//! pixel apart from other TrueType interpreters: Times New Roman italic c and y) and its advance. Windows also draws
//! the italic of a font without one (Symbol's slanted Greek) and the missing-glyph shape of a symbol font.

use std::sync::Arc;

use windows_sys::Win32::Graphics::Gdi::{
    AddFontMemResourceEx, CreateCompatibleDC, CreateFontW, DeleteDC, DeleteObject,
    GetGlyphIndicesW, GetGlyphOutlineW, RemoveFontMemResourceEx, SelectObject, DEFAULT_CHARSET,
    FIXED, GDI_ERROR, GGI_MARK_NONEXISTING_GLYPHS, GGO_BITMAP, GGO_GLYPH_INDEX, GLYPHMETRICS, MAT2,
    NONANTIALIASED_QUALITY, SYMBOL_CHARSET,
};

use super::{Code, Face, Loaded, Measure, PPEM};

/// Adds a font file's faces to the fonts this process sees (none other does): its handle.
pub(super) fn add_private(data: &[u8]) -> Result<usize, String> {
    let mut count = 0u32;
    let size = u32::try_from(data.len()).map_err(|_| "a font file over 4 GB".to_string())?;
    // SAFETY: Windows copies the data it is given (pointer and length of one slice) before returning, and writes
    // the number of faces through a pointer to a local (windows-sys declares it const)
    let handle = unsafe {
        AddFontMemResourceEx(
            data.as_ptr().cast(),
            size,
            std::ptr::null(),
            (&raw mut count).cast_const(),
        )
    };
    if handle.is_null() || count == 0 {
        return Err("Windows did not take a bundled MathType font".into());
    }
    Ok(handle as usize)
}

/// Removes faces `add_private` added.
pub(super) fn remove_private(handle: usize) {
    // SAFETY: the handle is one AddFontMemResourceEx returned, removed once.
    unsafe {
        RemoveFontMemResourceEx(handle as _);
    }
}

/// A character's measure in an installed face; None when the face has no glyph for a Unicode character (its
/// linked fonts may have one).
pub(super) fn measure(face: &Face, _loaded: &Loaded, code: Code) -> Option<Measure> {
    at(face, code, PPEM, 0)
}

/// A character's measure at a size in pixels per em and a font width in pixels (0: the font's own).
pub(super) fn measure_at(
    face: &Face,
    _loaded: &Loaded,
    code: Code,
    ppem: i32,
    width: i32,
) -> Option<Measure> {
    at(face, code, ppem, width)
}

fn at(face: &Face, code: Code, ppem: i32, width: i32) -> Option<Measure> {
    let name: Vec<u16> = face.name.encode_utf16().chain([0]).collect();
    let charset = match code {
        Code::Symbol(_) => SYMBOL_CHARSET,
        Code::Unicode(_) => DEFAULT_CHARSET,
    };
    // SAFETY: plain GDI calls on a memory DC and a font this function creates, selects and deletes; the buffers
    // passed are as long as the sizes given with them.
    unsafe {
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let font = CreateFontW(
            -ppem,
            width,
            0,
            0,
            if face.bold { 700 } else { 400 },
            u32::from(face.italic),
            0,
            0,
            u32::from(charset),
            0,
            0,
            u32::from(NONANTIALIASED_QUALITY),
            0,
            name.as_ptr(),
        );
        let old = SelectObject(dc, font);
        let measure = bitmap(dc, code);
        SelectObject(dc, old);
        DeleteObject(font);
        DeleteDC(dc);
        measure
    }
}

/// The glyph's index in the selected font, or None when the font lacks the character.
unsafe fn index(dc: *mut core::ffi::c_void, character: u32) -> Option<u16> {
    let text = u16::try_from(character).ok()?;
    let mut glyph = 0u16;
    GetGlyphIndicesW(dc, &text, 1, &mut glyph, GGI_MARK_NONEXISTING_GLYPHS);
    (glyph != 0xFFFF).then_some(glyph)
}

/// The selected font's glyph for a character as a measure: a Unicode character as Windows draws it (from a linked
/// font where the font lacks it); a symbol font's byte at U+F000 + byte or the byte itself, else its missing-glyph
/// shape (glyph 0: Windows has no other font for a symbol font's bytes).
unsafe fn bitmap(dc: *mut core::ffi::c_void, code: Code) -> Option<Measure> {
    // a character the font lacks: as Windows draws it, from a font it links in (the measure says so)
    let mut linked = false;
    let (character, format) = match code {
        Code::Unicode(c) => {
            linked = index(dc, u32::from(c)).is_none();
            (u32::from(c), GGO_BITMAP)
        }
        Code::Symbol(byte) => {
            let byte = u32::from(byte);
            match [0xF000 + byte, byte]
                .into_iter()
                .find(|&c| index(dc, c).is_some())
            {
                Some(c) => (c, GGO_BITMAP),
                None => (0, GGO_BITMAP | GGO_GLYPH_INDEX),
            }
        }
    };
    let one = FIXED { fract: 0, value: 1 };
    let zero = FIXED { fract: 0, value: 0 };
    let matrix = MAT2 {
        eM11: one,
        eM12: zero,
        eM21: zero,
        eM22: one,
    };
    let mut metrics: GLYPHMETRICS = std::mem::zeroed();
    let size = GetGlyphOutlineW(
        dc,
        character,
        format,
        &mut metrics,
        0,
        std::ptr::null_mut(),
        &matrix,
    );
    if size == GDI_ERROR as u32 {
        return None;
    }
    let mut rows = Vec::new();
    if size > 0 {
        let mut buffer = vec![0u8; size as usize];
        GetGlyphOutlineW(
            dc,
            character,
            format,
            &mut metrics,
            size,
            buffer.as_mut_ptr().cast(),
            &matrix,
        );
        // rows of bits padded to whole 32-bit words, top row first
        let (width, height) = (metrics.gmBlackBoxX as usize, metrics.gmBlackBoxY as usize);
        let stride = width.div_ceil(32) * 4;
        let origin = metrics.gmptGlyphOrigin;
        for (r, row) in buffer.chunks(stride).take(height).enumerate() {
            let inked = |c: &usize| row[c / 8] & (0x80 >> (c % 8)) != 0;
            if let (Some(first), Some(last)) = ((0..width).find(inked), (0..width).rfind(inked)) {
                rows.push((
                    origin.y - r as i32 - 1,
                    origin.x + first as i32,
                    origin.x + last as i32 + 1,
                ));
            }
        }
    }
    Some(Measure {
        advance: i32::from(metrics.gmCellIncX),
        left: rows.iter().map(|r| r.1).min().unwrap_or(0),
        right: rows.iter().map(|r| r.2).max().unwrap_or(0),
        top: rows.iter().map(|r| r.0 + 1).max().unwrap_or(0),
        bottom: rows.iter().map(|r| r.0).min().unwrap_or(0),
        rows: Arc::new(rows),
        linked,
        outline_top: 0,
    })
}
