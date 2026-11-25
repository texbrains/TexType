using System;
using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using System.Collections.Generic;
using TexType.Shared;

namespace TexType.Word;

/// <summary>
/// The XML side of writing an equation: the app's equation read, an equation's content spliced into another at a
/// marker, and the package Word imports an equation from.
/// </summary>
internal static class EquationXml
{
    public static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    public static readonly XNamespace M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    private static readonly XNamespace Package = "http://schemas.microsoft.com/office/2006/xmlPackage";

    /// <summary>The app's equation: one m:oMath.</summary>
    public static XElement Parse(string omml)
    {
        XElement equation;
        try
        {
            equation = XElement.Parse(omml, LoadOptions.PreserveWhitespace);
        }
        catch (XmlException error)
        {
            throw new ProtocolException($"the app's equation is not XML: {error.Message}");
        }
        if (equation.Name != M + "oMath")
            throw new ProtocolException($"the app's equation is {equation.Name.LocalName}, not one m:oMath");
        return equation;
    }

    public static XDocument ParsePackage(string wordOpenXml) => XDocument.Parse(wordOpenXml, LoadOptions.PreserveWhitespace);

    public static string Write(XDocument package) => package.ToString(SaveOptions.DisableFormatting);

    /// <summary>
    /// The equation of <paramref name="package"/> (an equation's export) with the content of <paramref name="equation"/>
    /// where the marker text is. The marker is in a math run, at the top of the equation or inside a structure's
    /// argument; text before and after it stays in runs of that run's formatting.
    /// </summary>
    public static XElement Splice(XDocument package, string marker, XElement equation)
    {
        var texts = MainBody(package).Descendants(M + "t").Where(text => text.Value.Contains(marker)).ToList();
        if (texts.Count != 1)
            throw new InvalidDataException($"The equation was exported with the insertion point {texts.Count} times.");
        var text = texts[0];
        var run = text.Parent is { } parent && parent.Name == M + "r"
            ? parent
            : throw new InvalidDataException("The insertion point was exported outside a math run.");
        var root = run.Ancestors(M + "oMath").Last();

        var at = text.Value.IndexOf(marker, StringComparison.Ordinal);
        var prefix = text.Value.Substring(0, at);
        var suffix = text.Value.Substring(at + marker.Length);
        XElement MathRun(string value) =>
            new(M + "r",
                run.Elements().Where(element => element.Name != M + "t").Select(element => new XElement(element)),
                new XElement(M + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value));
        var replacements = new List<XNode>();
        if (prefix.Length > 0) replacements.Add(MathRun(prefix));
        replacements.AddRange(equation.Nodes().Select(node => node is XElement element ? new XElement(element) : node));
        if (suffix.Length > 0) replacements.Add(MathRun(suffix));
        run.ReplaceWith(replacements);
        return new XElement(root);
    }

    /// <summary>The equation at <paramref name="index"/> (document order, from 0) in the package's body.</summary>
    public static XElement EquationAt(XDocument package, int index) =>
        MainBody(package).Descendants(M + "oMath").ElementAtOrDefault(index)
        ?? throw new InvalidDataException($"The export holds no equation number {index + 1}.");

    /// <summary>The body of the package's main document part.</summary>
    public static XElement MainBody(XDocument package) =>
        package.Root?.Elements(Package + "part")
            .FirstOrDefault(part => (string?)part.Attribute(Package + "name") == "/word/document.xml")?
            .Descendants(W + "body").FirstOrDefault()
        ?? throw new InvalidDataException("The package has no document part.");

    /// <summary>
    /// A package holding one paragraph with <paramref name="equation"/>, followed by <paramref name="trailingText"/>
    /// when there is one. The smallest package Word imports an equation from: the document part with an empty
    /// relationship part (a settings part would need the whole set of styles, theme and fonts in Word 2019/2021).
    /// </summary>
    public static XDocument SingleEquationPackage(XElement equation, string? trailingText)
    {
        XNamespace relationships = "http://schemas.openxmlformats.org/package/2006/relationships";
        XElement Part(string name, string contentType, XElement content) =>
            new(Package + "part",
                new XAttribute(Package + "name", name),
                new XAttribute(Package + "contentType", contentType),
                new XElement(Package + "xmlData", content));
        var document = new XElement(W + "document",
            new XAttribute(XNamespace.Xmlns + "w", W),
            new XAttribute(XNamespace.Xmlns + "m", M),
            new XElement(W + "body",
                new XElement(W + "p",
                    new XElement(equation),
                    trailingText is null ? null : new XElement(W + "r", new XElement(W + "t", trailingText))),
                new XElement(W + "sectPr")));
        return new XDocument(new XElement(Package + "package",
            new XAttribute(XNamespace.Xmlns + "pkg", Package),
            Part("/_rels/.rels", "application/vnd.openxmlformats-package.relationships+xml",
                new XElement(relationships + "Relationships",
                    new XElement(relationships + "Relationship",
                        new XAttribute("Id", "rId1"),
                        new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
                        new XAttribute("Target", "word/document.xml")))),
            Part("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", document),
            Part("/word/_rels/document.xml.rels", "application/vnd.openxmlformats-package.relationships+xml",
                new XElement(relationships + "Relationships"))));
    }
}
