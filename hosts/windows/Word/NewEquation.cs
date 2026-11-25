using System;
using System.Xml.Linq;
using Microsoft.Office.Interop.Word;
using TexType.Shared;
using WordApplication = Microsoft.Office.Interop.Word.Application;

namespace TexType.Word;

/// <summary>
/// A new equation: it goes where the selection ends when the command starts (a selection is not replaced). An inline
/// equation goes into the text there and takes the type Word gives it (alone in its paragraph Word makes it display);
/// a display equation gets its own centred paragraph, and the caret moves to the paragraph after it. With the caret inside an equation, the new content joins that equation at the caret, and the
/// joined equation is selected.
/// </summary>
internal sealed class NewEquation : IEquationEdit
{
    private readonly WordApplication word;
    private readonly Range caret;
    private readonly bool display;
    // The equation the caret is inside, if any; Word moves the range along with edits elsewhere meanwhile.
    private readonly Range? joined;
    private readonly bool joinedDisplay;

    private NewEquation(WordApplication word, Range caret, bool display, Range? joined, bool joinedDisplay, EditEquation request)
    {
        this.word = word;
        this.caret = caret;
        this.display = display;
        this.joined = joined;
        this.joinedDisplay = joinedDisplay;
        Request = request;
    }

    public EditEquation Request { get; }

    public static NewEquation AtSelection(WordApplication word, bool display)
    {
        var selection = word.Selection;
        Range? caret = null;
        OMath? around = null;
        try
        {
            caret = selection.Range;
            caret.Collapse(WdCollapseDirection.wdCollapseEnd);
            around = EquationLocator.Around(caret);
            var request = new EditEquation(null, display, EquationLayout.MathFont(caret), EquationLayout.TextSize(caret));
            var equation = new NewEquation(word, caret, display, around?.Range,
                around?.Type == WdOMathType.wdOMathDisplay, request);
            caret = null;
            return equation;
        }
        finally
        {
            ComObjects.Release(around);
            ComObjects.Release(caret);
            ComObjects.Release(selection);
        }
    }

    public void Apply(EquationEdited edited)
    {
        var equation = EquationXml.Parse(edited.Omml);
        if (joined is not null)
        {
            Join(joined, edited, equation);
            return;
        }
        using var write = new DocumentWrite(word, Texts.UndoInsertEquation, caret);
        if (display) EquationLayout.IsolateDisplayParagraph(caret);
        var range = EquationWriter.Write(caret, equation, display ? WdOMathType.wdOMathDisplay : null);
        var selection = word.Selection;
        try
        {
            EquationLayout.ApplySize(range, edited.FontSizePt);
            if (display)
            {
                EquationLayout.CenterDisplayParagraph(range);
                EquationLayout.CaretAfterDisplay(selection, range);
            }
            else
            {
                selection.SetRange(range.End, range.End);
            }
        }
        finally
        {
            ComObjects.Release(selection);
            ComObjects.Release(range);
        }
    }

    // The equation is written again with the new content where the caret is, as an edit writes it.
    private void Join(Range equationRange, EquationEdited edited, XElement equation)
    {
        var marker = "TTM" + Guid.NewGuid().ToString("N");
        var merged = EquationXml.Splice(ExportWithMarker(equationRange, marker), marker, equation);
        using var write = new DocumentWrite(word, Texts.UndoInsertEquation, equationRange);
        var range = EquationWriter.Write(
            equationRange, merged, joinedDisplay ? WdOMathType.wdOMathDisplay : WdOMathType.wdOMathInline);
        try
        {
            EquationLayout.ApplySize(range, edited.FontSizePt);
            if (joinedDisplay) EquationLayout.CenterDisplayParagraph(range);
            range.Select();
        }
        finally
        {
            ComObjects.Release(range);
        }
    }

    // The equation's export with a marker where the caret is: the marker is typed, the equation exported and the
    // marker taken back with one Undo. This is done before the write, as no XML may be read inside it.
    private XDocument ExportWithMarker(Range equationRange, string marker)
    {
        var document = caret.Document;
        try
        {
            caret.Text = marker;
            try
            {
                return EquationXml.ParsePackage(equationRange.WordOpenXML);
            }
            finally
            {
                document.Undo(1);
                if ((equationRange.Text ?? string.Empty).Contains(marker))
                    throw new InvalidOperationException("The insertion point could not be taken out of the equation again.");
            }
        }
        finally
        {
            ComObjects.Release(document);
        }
    }

    public void Dispose()
    {
        ComObjects.Release(joined);
        ComObjects.Release(caret);
    }
}
