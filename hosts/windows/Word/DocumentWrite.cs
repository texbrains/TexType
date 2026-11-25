using System;
using Microsoft.Office.Interop.Word;
using TexType.Shared;
using WordApplication = Microsoft.Office.Interop.Word.Application;

namespace TexType.Word;

/// <summary>
/// One change to the document: everything written until Dispose is one entry of the undo list. Every write of the
/// add-in goes through one, which keeps three rules of Word and WPS in one place:
/// <list type="bullet">
/// <item>Whatever the change needs from the document is read before it starts. Word silently ends a custom undo
/// record when WordOpenXML is read inside it, and every later write becomes an undo entry of its own.</item>
/// <item>The selection is moved onto the range being written first. WPS's Undo restores an equation that was
/// rewritten with the caret inside it with its first characters emptied (WPS 12.1.0.29681).</item>
/// <item>In WPS a failed call inside the record makes WPS roll back the whole record when it ends, so WPS paths
/// must not call members that fail there.</item>
/// </list>
/// </summary>
internal sealed class DocumentWrite : IDisposable
{
    private readonly UndoRecord record;

    public DocumentWrite(WordApplication word, string name, Range target)
    {
        target.Select();
        record = word.UndoRecord;
        record.StartCustomRecord(name);
    }

    public void Dispose()
    {
        record.EndCustomRecord();
        ComObjects.Release(record);
    }
}
