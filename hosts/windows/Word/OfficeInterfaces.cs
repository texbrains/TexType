using System;
using System.Runtime.InteropServices;

namespace TexType.Word;

// The Office add-in interfaces, declared here because the type libraries that define them (Extensibility, the
// Office core library) cannot be referenced with `dotnet build` (COMReference, MSB4803). Identifiers and member
// order are those of the type libraries.

/// <summary>How Office starts and stops a COM add-in (Extensibility type library).</summary>
[ComImport, Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
public interface IDTExtensibility2
{
    [DispId(1)]
    void OnConnection(
        [MarshalAs(UnmanagedType.IDispatch)] object application,
        int connectMode,
        [MarshalAs(UnmanagedType.IDispatch)] object addInInstance,
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

    [DispId(2)]
    void OnDisconnection(int removeMode, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

    [DispId(3)]
    void OnAddInsUpdate([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

    [DispId(4)]
    void OnStartupComplete([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);

    [DispId(5)]
    void OnBeginShutdown([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
}

/// <summary>Where Office asks an add-in for its ribbon XML (Office core type library).</summary>
[ComImport, Guid("000C0396-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
public interface IRibbonExtensibility
{
    [DispId(1)]
    string GetCustomUI(string ribbonId);
}

/// <summary>The ribbon control a callback is for (Office core type library; only its first member is used).</summary>
[ComImport, Guid("000C0395-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
public interface IRibbonControl
{
    [DispId(1)]
    string Id { get; }
}

/// <summary>The ribbon callbacks, which Office calls by name through IDispatch.</summary>
[ComVisible(true), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
public interface IRibbonCallbacks
{
    [DispId(1)]
    void OnAction(IRibbonControl control);
}
