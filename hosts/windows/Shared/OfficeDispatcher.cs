using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace TexType.Shared;

/// <summary>
/// Runs work on Office's UI thread. Office objects may be called only there; the waits for the app happen elsewhere,
/// so every Office call after a wait goes through <see cref="InvokeAsync{T}"/>.
/// </summary>
public sealed class OfficeDispatcher : IDisposable
{
    private readonly Control control;

    /// <summary>Create it on Office's UI thread (in OnConnection).</summary>
    public OfficeDispatcher()
    {
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
            throw new InvalidOperationException("The add-in must start on Office's UI thread.");
        control = new Control();
        control.CreateControl();
    }

    public Task<T> InvokeAsync<T>(Func<T> operation)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Execute()
        {
            try { completion.SetResult(operation()); }
            catch (Exception error) { completion.SetException(error); }
        }
        if (control.InvokeRequired) control.BeginInvoke(new Action(Execute));
        else Execute();
        return completion.Task;
    }

    public Task InvokeAsync(Action operation) => InvokeAsync(() =>
    {
        operation();
        return true;
    });

    public void Dispose() => control.Dispose();
}
