using System.Xml.Linq;
using Microsoft.Office.Interop.Word;
using TexType.Shared;

namespace TexType.Word;

/// <summary>
/// Range.InsertXML with Word's behaviour in WPS Writer too. Word drops the package's last paragraph mark when the
/// content lands inside a paragraph; WPS (measured on 12.1.0.28488) imports that mark unless the package paragraph
/// carries w:doNotImportParagraphEnd, which WPS writes into its own partial exports.
/// </summary>
internal static class XmlImport
{
    /// <summary>Imports a one-paragraph package over a range inside a paragraph (not ending with its mark).</summary>
    public static void ReplaceRange(Range range, XDocument package)
    {
        if (OfficeHost.IsWps)
        {
            var paragraph = EquationXml.MainBody(package).Element(EquationXml.W + "p")!;
            var properties = paragraph.Element(EquationXml.W + "pPr");
            if (properties is null) paragraph.AddFirst(properties = new XElement(EquationXml.W + "pPr"));
            properties.Add(new XElement(EquationXml.W + "doNotImportParagraphEnd"));
        }
        range.InsertXML(EquationXml.Write(package));
    }
}
