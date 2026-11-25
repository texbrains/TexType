using System;
using System.IO;
using System.Reflection;

namespace TexType.Word;

/// <summary>
/// Loads the add-in's own libraries (TexType.Shared, System.Text.Json and its dependencies) from the add-in's folder.
/// Office's process has no configuration for them, so a library asking for another version of one of them than the
/// one shipped would fail to load; the shipped one is used.
/// </summary>
internal static class DependencyResolver
{
    private static readonly string Folder = Path.GetDirectoryName(typeof(DependencyResolver).Assembly.Location)!;

    public static void Install() => AppDomain.CurrentDomain.AssemblyResolve += Resolve;

    private static Assembly? Resolve(object? sender, ResolveEventArgs args)
    {
        var path = Path.Combine(Folder, new AssemblyName(args.Name).Name + ".dll");
        return File.Exists(path) ? Assembly.LoadFrom(path) : null;
    }
}
