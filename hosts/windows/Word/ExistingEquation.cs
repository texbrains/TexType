using System;
using Microsoft.Office.Interop.Word;
using TexType.Shared;
using WordApplication = Microsoft.Office.Interop.Word.Application;

namespace TexType.Word;

/// <summary>
/// An equation in the document being edited: its export goes to the app, and the answer replaces it in place, keeps
/// its type and stays selected.
/// </summary>
internal sealed class ExistingEquation : IEquationEdit
{
    private readonly WordApplication word;
    // The equation's range; Word moves it along with edits elsewhere while the editor is open.
    private readonly Range range;
    private readonly bool display;

    private ExistingEquation(WordApplication word, Range range, bool display, EditEquation request)
    {
        this.word = word;
        this.range = range;
        this.display = display;
        Request = request;
    }

    public EditEquation Request { get; }

    /// <summary>The equation <paramref name="selection"/> is in, or null when it is in none.</summary>
    public static ExistingEquation? At(WordApplication word, Selection selection)
    {
        var selected = selection.Range;
        OMath? math = null;
        Range? range = null;
        try
        {
            math = EquationLocator.Containing(selected);
            if (math is null) return null;
            range = math.Range;
            var display = math.Type == WdOMathType.wdOMathDisplay;
            var request = new EditEquation(
                Export(range), display, EquationLayout.MathFont(range), EquationLayout.EquationSize(range));
            var equation = new ExistingEquation(word, range, display, request);
            range = null;
            return equation;
        }
        finally
        {
            ComObjects.Release(range);
            ComObjects.Release(math);
            ComObjects.Release(selected);
        }
    }

    public void Apply(EquationEdited edited)
    {
        var equation = EquationXml.Parse(edited.Omml);
        EnsureStillThere();
        using var write = new DocumentWrite(word, Texts.UndoEditEquation, range);
        var replaced = EquationWriter.Write(
            range, equation, display ? WdOMathType.wdOMathDisplay : WdOMathType.wdOMathInline);
        try
        {
            EquationLayout.ApplySize(replaced, edited.FontSizePt);
            if (display) EquationLayout.CenterDisplayParagraph(replaced);
            replaced.Select();
        }
        finally
        {
            ComObjects.Release(replaced);
        }
    }

    public void Dispose() => ComObjects.Release(range);

    // A package holding the equation alone. Word exports an equation inside a hyperlink as plain text unless its whole
    // paragraph is exported (Word 16, measured: a range one character wider does not always do), so there the
    // equation is taken out of its paragraph's export.
    private static string Export(Range equation)
    {
        var links = equation.Hyperlinks;
        try
        {
            if (links.Count == 0) return equation.WordOpenXML;
        }
        finally
        {
            ComObjects.Release(links);
        }
        var paragraph = RangeQueries.ParagraphOf(equation);
        try
        {
            var package = EquationXml.ParsePackage(paragraph.WordOpenXML);
            var alone = EquationXml.EquationAt(package, EquationsBefore(paragraph, equation));
            return EquationXml.Write(EquationXml.SingleEquationPackage(alone, null));
        }
        finally
        {
            ComObjects.Release(paragraph);
        }
    }

    // How many equations of the paragraph come before the equation.
    private static int EquationsBefore(Range paragraph, Range equation)
    {
        var maths = paragraph.OMaths;
        try
        {
            var before = 0;
            for (var i = 1; i <= maths.Count; i++)
            {
                var math = maths[i];
                var range = math.Range;
                if (range.Start < equation.Start) before++;
                ComObjects.Release(range);
                ComObjects.Release(math);
            }
            return before;
        }
        finally
        {
            ComObjects.Release(maths);
        }
    }

    // The range must still be exactly one equation: the user may have deleted or retyped it meanwhile.
    private void EnsureStillThere()
    {
        if (range.Start == range.End) throw new InvalidOperationException(Texts.EquationChanged);
        var math = EquationLocator.Containing(range) ?? throw new InvalidOperationException(Texts.EquationChanged);
        var current = math.Range;
        try
        {
            if (current.Start != range.Start || current.End != range.End)
                throw new InvalidOperationException(Texts.EquationChanged);
        }
        finally
        {
            ComObjects.Release(current);
            ComObjects.Release(math);
        }
    }
}
