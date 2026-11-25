using System;
using System.Xml.Linq;
using Microsoft.Office.Interop.Word;
using TexType.Shared;

namespace TexType.Word;

/// <summary>
/// Writes an equation into the document by importing a package that holds only the equation, so nothing around it
/// is touched: over an old equation's exact range, or at a caret in text.
/// </summary>
internal static class EquationWriter
{
    // WPS keeps an equation that is alone in its package paragraph a display equation; a word joiner after it keeps
    // an inline one inline during the import and is deleted right after.
    private const string WpsInlineSeparator = "\u2060";

    /// <summary>
    /// Writes <paramref name="equation"/> over <paramref name="at"/> (an equation's range, or a collapsed caret outside
    /// equations) as an equation of <paramref name="type"/>; returns its range. With no type the host decides, as for
    /// an equation typed there: inline among text, display alone in its paragraph.
    /// </summary>
    public static Range Write(Range at, XElement equation, WdOMathType? type)
    {
        var start = at.Start;
        var afterParagraph = CharactersAfterParagraph(at);
        // Alone in its package paragraph, WPS makes every imported equation display: the separator undoes that
        // where the equation is not alone in the document's paragraph either.
        var wpsInline = OfficeHost.IsWps
            && (type == WdOMathType.wdOMathInline || type is null && !AloneInParagraph(at));

        XmlImport.ReplaceRange(at, EquationXml.SingleEquationPackage(equation, wpsInline ? WpsInlineSeparator : null));

        OMath? math = EquationLocator.Imported(at, start);
        try
        {
            if (wpsInline)
            {
                RemoveAfter(math, WpsInlineSeparator);
                ComObjects.Release(math);
                math = null;
                math = EquationLocator.Imported(at, start);
            }
            // First the paragraph is whole again: alone in a paragraph broken by the import, the equation is display,
            // and forcing it inline there makes Word add a space after it.
            if (RemoveImportedMark(math, afterParagraph))
            {
                ComObjects.Release(math);
                math = null;
                math = EquationLocator.Imported(at, start);
            }
            // WPS makes an inline equation alone in its paragraph display and adds a space when it is forced back;
            // that is left to WPS, as Word's own choice is.
            if (type is { } wanted && math.Type != wanted && (wanted == WdOMathType.wdOMathDisplay || !OfficeHost.IsWps))
                math.Type = wanted;
            return math.Range;
        }
        finally
        {
            ComObjects.Release(math);
        }
    }

    // Whether the paragraph of `range` holds nothing besides it (its mark aside).
    private static bool AloneInParagraph(Range range)
    {
        var paragraph = RangeQueries.ParagraphOf(range);
        try
        {
            var around = RangeQueries.TextAt(range, paragraph.Start, range.Start)
                + RangeQueries.TextAt(range, range.End, paragraph.End);
            return around.Trim('\r', '\a').Length == 0;
        }
        finally
        {
            ComObjects.Release(paragraph);
        }
    }

    private static void RemoveAfter(OMath math, string text)
    {
        var range = math.Range;
        var after = RangeQueries.At(range, range.End, range.End + 1);
        try
        {
            if (after.Text != text)
                throw new InvalidOperationException("WPS did not keep the separator after the imported inline equation.");
            after.Delete();
        }
        finally
        {
            ComObjects.Release(after);
            ComObjects.Release(range);
        }
    }

    // Word imports the package's paragraph mark too in some places and breaks the paragraph after the equation:
    // before text, at the end of a table cell, before a field (there after the field's hidden start); not at a
    // paragraph's end (Word 16, measured). As that depends on more than what follows, the writer reads what Word did.
    // The import changes only the written range's paragraph, so the characters after that paragraph stay the same: if
    // the equation's paragraph now ends before them, its paragraph mark came with the package and is deleted. (WPS
    // does not import it: XmlImport marks the package paragraph for it.)
    private static int CharactersAfterParagraph(Range range)
    {
        var paragraph = RangeQueries.ParagraphOf(range);
        try { return range.StoryLength - paragraph.End; }
        finally { ComObjects.Release(paragraph); }
    }

    private static bool RemoveImportedMark(OMath math, int afterParagraph)
    {
        var range = math.Range;
        var paragraph = RangeQueries.ParagraphOf(range);
        try
        {
            if (range.StoryLength - paragraph.End == afterParagraph) return false;
            var end = paragraph.End;
            if (RangeQueries.TextAt(range, end - 1, end) != "\r")
                throw new InvalidOperationException("The import broke the equation's paragraph somewhere else than at a paragraph mark.");
            var mark = RangeQueries.At(range, end - 1, end);
            try { mark.Delete(); }
            finally { ComObjects.Release(mark); }
            return true;
        }
        finally
        {
            ComObjects.Release(paragraph);
            ComObjects.Release(range);
        }
    }
}
