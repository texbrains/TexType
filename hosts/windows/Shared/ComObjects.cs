using System.Runtime.InteropServices;

namespace TexType.Shared;

public static class ComObjects
{
    /// <summary>Releases an Office object the add-in obtained itself (never one Office passed into a callback).</summary>
    public static void Release(object? value)
    {
        if (value is not null) Marshal.ReleaseComObject(value);
    }
}
