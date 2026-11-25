using System;
using System.Diagnostics;

namespace TexType.Shared;

/// <summary>
/// Whether the add-in runs in WPS Office. WPS loads the same COM add-ins and implements the Word and PowerPoint object
/// models, but some members behave differently or fail there; the code checks this at the one call where it matters.
/// Inside a custom undo record any failed call makes WPS roll back the whole record, so WPS paths avoid those members.
/// </summary>
public static class OfficeHost
{
    /// <summary>True in WPS Writer (wps), WPS Presentation (wpp) or WPS Spreadsheets (et).</summary>
    public static bool IsWps { get; } = DetectWps();

    private static bool DetectWps()
    {
        using var process = Process.GetCurrentProcess();
        return process.ProcessName.Equals("wps", StringComparison.OrdinalIgnoreCase)
            || process.ProcessName.Equals("wpp", StringComparison.OrdinalIgnoreCase)
            || process.ProcessName.Equals("et", StringComparison.OrdinalIgnoreCase);
    }
}
