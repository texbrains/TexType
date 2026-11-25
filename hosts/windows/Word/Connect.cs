using System;
using System.Runtime.InteropServices;
using Microsoft.Office.Interop.Word;
using TexType.Shared;
using WordApplication = Microsoft.Office.Interop.Word.Application;

namespace TexType.Word;

/// <summary>
/// The COM add-in Word and WPS Writer load (through mscoree; dev registration: tests/dev-register.ps1): the ribbon,
/// its commands and the double-click on an equation.
/// </summary>
[ComVisible(true)]
[Guid(Product.WordAddinClsid)]
[ProgId(Product.WordAddinProgid)]
[ClassInterface(ClassInterfaceType.None)]
[ComDefaultInterface(typeof(IRibbonCallbacks))]
public sealed class Connect : IDTExtensibility2, IRibbonExtensibility, IRibbonCallbacks
{
    // Before any type of TexType.Shared or System.Text.Json is loaded.
    static Connect() => DependencyResolver.Install();

    private WordApplication? word;
    private OfficeDispatcher? dispatcher;
    private EquationCommands? commands;

    public void OnConnection(object application, int connectMode, object addInInstance, ref Array custom)
    {
        // Passed in by Office: kept, never released.
        word = (WordApplication)application;
        dispatcher = new OfficeDispatcher();
        commands = new EquationCommands(word, dispatcher);
        word.WindowBeforeDoubleClick += OnWindowBeforeDoubleClick;
    }

    public void OnDisconnection(int removeMode, ref Array custom)
    {
        if (word is not null) word.WindowBeforeDoubleClick -= OnWindowBeforeDoubleClick;
        dispatcher?.Dispose();
        word = null;
        dispatcher = null;
        commands = null;
    }

    public void OnAddInsUpdate(ref Array custom) { }

    public void OnStartupComplete(ref Array custom) { }

    public void OnBeginShutdown(ref Array custom) { }

    public string GetCustomUI(string ribbonId) => Ribbon.Xml(OfficeHost.IsWps);

    public void OnAction(IRibbonControl control)
    {
        var (app, edits) = (word!, commands!);
        // Called by Office: every failure is reported to the user instead of reaching Word.
        try
        {
            switch (control.Id)
            {
                case Ribbon.InlineButton: edits.Insert(display: false); break;
                case Ribbon.DisplayButton: edits.Insert(display: true); break;
                case Ribbon.EditButton: edits.EditSelected(); break;
            }
        }
        catch (Exception error)
        {
            Feedback.Report(app, error);
        }
    }

    // The first click has put the caret where the user clicked: on an equation, the editor opens instead of Word's
    // own double-click.
    private void OnWindowBeforeDoubleClick(Selection selection, ref bool cancel)
    {
        var (app, edits) = (word!, commands!);
        try
        {
            cancel = edits.EditAt(selection);
        }
        catch (Exception error)
        {
            Feedback.Report(app, error);
        }
    }
}
