using System.Xml.Linq;
using TexType.Shared;

namespace TexType.Word;

/// <summary>
/// The TexType tab: inline equation, display equation, edit equation. WPS Writer gets its own variant: WPS shows a
/// large button's label on one line unless the button says enableLineBreak (Word's schema does not allow it), and
/// it has its own icon for editing an equation.
/// </summary>
internal static class Ribbon
{
    public const string InlineButton = "InlineEquation";
    public const string DisplayButton = "DisplayEquation";
    public const string EditButton = "EditEquation";

    private static readonly XNamespace Ui = "http://schemas.microsoft.com/office/2009/07/customui";

    public static string Xml(bool wps) =>
        new XElement(Ui + "customUI",
            new XElement(Ui + "ribbon",
                new XElement(Ui + "tabs",
                    new XElement(Ui + "tab",
                        new XAttribute("id", "TexTypeTab"),
                        new XAttribute("label", Texts.Caption),
                        new XAttribute("insertAfterMso", "TabHome"),
                        new XElement(Ui + "group",
                            new XAttribute("id", "TexTypeEquations"),
                            new XAttribute("label", Texts.Caption),
                            Button(InlineButton, Texts.InlineEquation, Texts.InlineEquationWps, "EquationScriptGallery", wps),
                            Button(DisplayButton, Texts.DisplayEquation, Texts.DisplayEquationWps, "EquationInsertGallery", wps),
                            Button(EditButton, Texts.EditEquation, Texts.EditEquationWps,
                                wps ? "KSEquationEditor" : "EquationProfessional", wps))))))
            .ToString(SaveOptions.DisableFormatting);

    private static XElement Button(string id, string label, string wpsLabel, string image, bool wps) =>
        new(Ui + "button",
            new XAttribute("id", id),
            new XAttribute("label", wps ? wpsLabel : label),
            new XAttribute("screentip", label),
            new XAttribute("size", "large"),
            new XAttribute("imageMso", image),
            wps ? new XAttribute("enableLineBreak", "true") : null,
            new XAttribute("onAction", nameof(IRibbonCallbacks.OnAction)));
}
