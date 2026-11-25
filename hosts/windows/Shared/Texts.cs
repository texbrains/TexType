using System;
using System.Globalization;

namespace TexType.Shared;

/// <summary>The add-ins' texts: Chinese when Windows shows Chinese, English otherwise.</summary>
public static class Texts
{
    private static readonly bool Chinese =
        CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase);

    private static string Pick(string chinese, string english) => Chinese ? chinese : english;

    public static string Caption => "TexType";

    // Ribbon. A "\n" is where WPS breaks a large button's label (Word wraps by itself).
    public static string InlineEquation => Pick("行内公式", "Inline Equation");
    public static string DisplayEquation => Pick("行间公式", "Display Equation");
    public static string EditEquation => Pick("编辑公式", "Edit Equation");
    public static string InlineEquationWps => Pick("行内\n公式", "Inline \nEquation");
    public static string DisplayEquationWps => Pick("行间\n公式", "Display \nEquation");
    public static string EditEquationWps => Pick("编辑\n公式", "Edit \nEquation");

    // Undo list entries.
    public static string UndoInsertEquation => Pick("插入公式", "Insert Equation");
    public static string UndoEditEquation => Pick("编辑公式", "Edit Equation");

    // Messages.
    public static string AppNotRunning => Pick("TexType 没有运行，请先启动 TexType。", "TexType is not running. Start TexType first.");
    public static string AppClosedConnection => Pick("TexType 关闭了连接。", "TexType closed the connection.");
    public static string MessageTooLarge => Pick("公式太大，无法交给 TexType 编辑。", "The equation is too large for TexType to edit.");
    public static string NoEquationSelected => Pick("请先选中一个公式。", "Select an equation first.");
    public static string SelectOneEquation => Pick("所选内容不是一个公式，请只选中一个公式。", "The selection is not one equation. Select one equation.");
    public static string EquationChanged => Pick("公式在编辑期间被删除或修改，未写入。", "The equation was removed or changed while it was being edited; nothing was written.");
    public static string NoTextSize => Pick("无法读取插入位置的字号。", "The text size at the insertion point cannot be read.");
    public static string NoEquationCreated => Pick("Word 没有生成公式。", "Word did not create the equation.");
    public static string Failed(string reason) => Pick($"TexType：{reason}", $"TexType: {reason}");
}
