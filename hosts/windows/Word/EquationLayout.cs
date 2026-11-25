using System;
using Microsoft.Office.Interop.Word;
using TexType.Shared;

namespace TexType.Word;

/// <summary>An equation's size, font and paragraph: what is read before editing and set after writing.</summary>
internal static class EquationLayout
{
    // Word's font sizes run from 1 to 1638 points; a range of mixed sizes reads as wdUndefined (9999999).
    private const float MaxSize = 1638;

    /// <summary>The size of the text at <paramref name="caret"/>.</summary>
    public static float TextSize(Range caret)
    {
        var font = caret.Font;
        try
        {
            var size = font.Size;
            return size is > 0 and <= MaxSize ? size : throw new InvalidOperationException(Texts.NoTextSize);
        }
        finally
        {
            ComObjects.Release(font);
        }
    }

    /// <summary>The size of an equation; one of mixed sizes is edited at the size of its first character.</summary>
    public static float EquationSize(Range equation)
    {
        var font = equation.Font;
        var size = font.Size;
        ComObjects.Release(font);
        if (size is > 0 and <= MaxSize) return size;
        var first = RangeQueries.At(equation, equation.Start, equation.Start + 1);
        try { return TextSize(first); }
        finally { ComObjects.Release(first); }
    }

    /// <summary>
    /// The document's math font. WPS has none (it reports the placeholder "default"); its equations are drawn in
    /// Cambria Math.
    /// </summary>
    public static string MathFont(Range range)
    {
        if (OfficeHost.IsWps) return "Cambria Math";
        var document = range.Document;
        try { return document.OMathFontName; }
        finally { ComObjects.Release(document); }
    }

    /// <summary>Gives the written equation the size the user chose, on its baseline (no raised or lowered position).</summary>
    public static void ApplySize(Range equation, double size)
    {
        if (size is <= 0 or > MaxSize)
            throw new ProtocolException($"the app asked for an equation of {size} pt");
        var font = equation.Font;
        try
        {
            font.Position = 0;
            font.Size = (float)size;
            font.SizeBi = (float)size;
        }
        finally
        {
            ComObjects.Release(font);
        }
    }

    /// <summary>
    /// Makes the collapsed <paramref name="caret"/> the start of an empty paragraph of its own, with a paragraph after it
    /// for the caret to go to: text before or after the caret is split off into its own paragraph.
    /// </summary>
    public static void IsolateDisplayParagraph(Range caret)
    {
        var paragraph = RangeQueries.ParagraphOf(caret);
        try
        {
            var position = caret.Start;
            var textBefore = position > paragraph.Start;
            // In a table cell the next paragraph may be in the next cell, so the cell gets its own.
            var paragraphAfter = position < paragraph.End - 1 || paragraph.End >= paragraph.StoryLength
                || RangeQueries.InTable(paragraph);
            var breaks = (textBefore ? "\r" : string.Empty) + (paragraphAfter ? "\r" : string.Empty);
            if (breaks.Length > 0) caret.Text = breaks;
            var start = position + (textBefore ? 1 : 0);
            caret.SetRange(start, start);
        }
        finally
        {
            ComObjects.Release(paragraph);
        }
    }

    /// <summary>A display equation's paragraph: centred, without indents (also those set in characters).</summary>
    public static void CenterDisplayParagraph(Range equation)
    {
        var paragraph = RangeQueries.ParagraphOf(equation);
        var format = paragraph.ParagraphFormat;
        try
        {
            format.Alignment = WdParagraphAlignment.wdAlignParagraphCenter;
            if (format.CharacterUnitFirstLineIndent != 0) format.CharacterUnitFirstLineIndent = 0;
            if (format.CharacterUnitLeftIndent != 0) format.CharacterUnitLeftIndent = 0;
            if (format.CharacterUnitRightIndent != 0) format.CharacterUnitRightIndent = 0;
            format.FirstLineIndent = 0;
            format.LeftIndent = 0;
            format.RightIndent = 0;
        }
        finally
        {
            ComObjects.Release(format);
            ComObjects.Release(paragraph);
        }
    }

    /// <summary>The caret after a display equation: the start of the next paragraph.</summary>
    public static void CaretAfterDisplay(Selection selection, Range equation)
    {
        var paragraph = RangeQueries.ParagraphOf(equation);
        try { selection.SetRange(paragraph.End, paragraph.End); }
        finally { ComObjects.Release(paragraph); }
    }
}
