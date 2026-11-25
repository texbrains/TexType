using System;
using System.Windows.Forms;
using TexType.Shared;
using WordApplication = Microsoft.Office.Interop.Word.Application;

namespace TexType.Word;

/// <summary>Tells the user that a command failed: in Word's status bar and in a message box over Word's window.</summary>
internal static class Feedback
{
    public static void Report(WordApplication word, Exception error)
    {
        word.StatusBar = Texts.Failed(error.Message);
        // The app has brought its open editor to the front; that says enough.
        if (error is AppErrorException { Code: ErrorCode.Busy }) return;
        MessageBox.Show(Owner(word), error.Message, Texts.Caption, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // Word's active window; none when no document is open.
    private static IWin32Window? Owner(WordApplication word)
    {
        var windows = word.Windows;
        try
        {
            if (windows.Count == 0) return null;
            var window = word.ActiveWindow;
            try { return new WindowHandle(new IntPtr(window.Hwnd)); }
            finally { ComObjects.Release(window); }
        }
        finally
        {
            ComObjects.Release(windows);
        }
    }

    private sealed class WindowHandle(IntPtr handle) : IWin32Window
    {
        public IntPtr Handle { get; } = handle;
    }
}
