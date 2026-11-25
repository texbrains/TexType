using System;
using Microsoft.Office.Interop.Word;
using TexType.Shared;

namespace TexType.Word;

/// <summary>Finds equations: the one a selection is in, the one a caret is inside, and the one an import has just made.</summary>
internal static class EquationLocator
{
    /// <summary>
    /// The equation that holds all of <paramref name="selected"/>, or null when the selection touches none. Word also
    /// lists the rows of a matrix as equations; the outermost one is the equation.
    /// </summary>
    public static OMath? Containing(Range selected)
    {
        var maths = selected.OMaths;
        try
        {
            if (maths.Count == 0) return null;
            return Best(maths, range => range.Start <= selected.Start && selected.End <= range.End ? 0 : -1)
                ?? throw new InvalidOperationException(Texts.SelectOneEquation);
        }
        finally
        {
            ComObjects.Release(maths);
        }
    }

    /// <summary>
    /// The equation the collapsed <paramref name="caret"/> is inside (not at its start or end), or null. Word counts a
    /// caret right after an equation as touching it; typing there writes text, not math.
    /// </summary>
    public static OMath? Around(Range caret)
    {
        var maths = caret.OMaths;
        try
        {
            var position = caret.Start;
            return maths.Count == 0 ? null : Best(maths, range => range.Start < position && position < range.End ? 0 : -1);
        }
        finally
        {
            ComObjects.Release(maths);
        }
    }

    /// <summary>
    /// The equation an import at <paramref name="position"/> made: the nearest one starting at most a few characters
    /// after it (Word may place it behind hidden characters), or the one it joined; the outermost when nested.
    /// </summary>
    public static OMath Imported(Range story, int position)
    {
        var caret = RangeQueries.At(story, position, position);
        var paragraph = RangeQueries.ParagraphOf(caret);
        var probe = RangeQueries.At(story, Math.Max(0, position - 1), Math.Min(paragraph.End + 2, paragraph.StoryLength));
        var maths = probe.OMaths;
        try
        {
            return Best(maths, range =>
                    range.End > position && range.Start - position <= 16 ? Math.Max(0, range.Start - position) : -1)
                ?? throw new InvalidOperationException(Texts.NoEquationCreated);
        }
        finally
        {
            ComObjects.Release(maths);
            ComObjects.Release(probe);
            ComObjects.Release(paragraph);
            ComObjects.Release(caret);
        }
    }

    // The equation with the smallest distance (negative: not a candidate), the widest of equally distant ones.
    private static OMath? Best(OMaths maths, Func<Range, int> distance)
    {
        OMath? best = null;
        var (bestDistance, bestSpan) = (int.MaxValue, -1);
        for (var index = 1; index <= maths.Count; index++)
        {
            var math = maths[index];
            var range = math.Range;
            try
            {
                var (d, span) = (distance(range), range.End - range.Start);
                if (d < 0 || d > bestDistance || d == bestDistance && span <= bestSpan) continue;
                (best, math) = (math, best);
                (bestDistance, bestSpan) = (d, span);
            }
            finally
            {
                ComObjects.Release(range);
                ComObjects.Release(math);
            }
        }
        return best;
    }
}
