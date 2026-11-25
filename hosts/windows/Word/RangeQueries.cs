using System;
using Microsoft.Office.Interop.Word;
using TexType.Shared;

namespace TexType.Word;

/// <summary>Small reads of a range's surroundings that the writers share.</summary>
internal static class RangeQueries
{
    /// <summary>The range of the one paragraph <paramref name="range"/> lies in.</summary>
    public static Range ParagraphOf(Range range)
    {
        var paragraphs = range.Paragraphs;
        try
        {
            if (paragraphs.Count != 1)
                throw new InvalidOperationException($"The range {range.Start}-{range.End} spans {paragraphs.Count} paragraphs.");
            var paragraph = paragraphs[1];
            try { return paragraph.Range; }
            finally { ComObjects.Release(paragraph); }
        }
        finally
        {
            ComObjects.Release(paragraphs);
        }
    }

    /// <summary>Whether the range is in a table (from the document's structure, not from its layout).</summary>
    public static bool InTable(Range range)
    {
        var tables = range.Tables;
        try { return tables.Count > 0; }
        finally { ComObjects.Release(tables); }
    }

    /// <summary>A new range from <paramref name="start"/> to <paramref name="end"/> in the story of <paramref name="story"/>.</summary>
    public static Range At(Range story, int start, int end)
    {
        var range = story.Duplicate;
        range.SetRange(start, end);
        return range;
    }

    public static string TextAt(Range story, int start, int end)
    {
        var range = At(story, start, end);
        try { return range.Text ?? string.Empty; }
        finally { ComObjects.Release(range); }
    }
}
