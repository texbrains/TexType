using System;
using Microsoft.Office.Interop.Word;
using TexType.Shared;
using Task = System.Threading.Tasks.Task;
using WordApplication = Microsoft.Office.Interop.Word.Application;

namespace TexType.Word;

/// <summary>
/// The commands: insert an inline or display equation, edit the selected or double-clicked one. The document is read
/// when the command starts; the app's editor is awaited off Word's UI thread; the answer is written back on it.
/// </summary>
internal sealed class EquationCommands(WordApplication word, OfficeDispatcher ui)
{
    private readonly Hello hello = new(
        Protocol.Version, OfficeHost.IsWps ? Host.WpsWriter : Host.Word, word.Version, Product.Version);

    public void Insert(bool display) => Start(NewEquation.AtSelection(word, display));

    public void EditSelected()
    {
        var selection = word.Selection;
        try
        {
            Start(ExistingEquation.At(word, selection) ?? throw new InvalidOperationException(Texts.NoEquationSelected));
        }
        finally
        {
            ComObjects.Release(selection);
        }
    }

    /// <summary>Opens the editor for the equation <paramref name="selection"/> is in; false when it is in none.</summary>
    public bool EditAt(Selection selection)
    {
        var edit = ExistingEquation.At(word, selection);
        if (edit is null) return false;
        Start(edit);
        return true;
    }

    private void Start(IEquationEdit edit) => _ = RunAsync(edit);

    private async Task RunAsync(IEquationEdit edit)
    {
        try
        {
            switch (await AppClient.SendAsync(hello, edit.Request).ConfigureAwait(false))
            {
                case EquationEdited edited:
                    await ui.InvokeAsync(() => edit.Apply(edited)).ConfigureAwait(false);
                    break;
                case Cancelled:
                    break;
                case var other:
                    throw new ProtocolException($"the app answered editEquation with {other.GetType().Name}");
            }
        }
        catch (Exception error)
        {
            await ui.InvokeAsync(() => Feedback.Report(word, error)).ConfigureAwait(false);
        }
        finally
        {
            await ui.InvokeAsync(edit.Dispose).ConfigureAwait(false);
        }
    }
}

/// <summary>One equation being edited: the request for the app, and how its answer is written into the document.</summary>
internal interface IEquationEdit : IDisposable
{
    EditEquation Request { get; }

    /// <summary>Writes the edited equation into the document; on Word's UI thread.</summary>
    void Apply(EquationEdited edited);
}
