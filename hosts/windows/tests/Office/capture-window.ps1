# One window (handle in hex) to a PNG, drawn by the window itself (PrintWindow): no screen capture. ASCII only.
param([Parameter(Mandatory)][string]$Handle, [Parameter(Mandatory)][string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class CW {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
[void][CW]::SetProcessDPIAware()
$h = [IntPtr][Convert]::ToInt64($Handle, 16)
$r = New-Object CW+RECT; [void][CW]::GetWindowRect($h, [ref]$r)
$bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc(); [void][CW]::PrintWindow($h, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
'captured ' + $Out
