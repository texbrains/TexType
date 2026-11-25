# The message boxes and dialogs of a process (#32770, WinForms), found with plain Win32 window enumeration (UI
# Automation can stall on WPS's Qt window tree). -Press presses the first button whose caption contains the text
# (a click message to that button only). JSON output. ASCII only; -Press may be passed as b64:<utf-8>.
param([string]$Process = 'WINWORD', [string]$Press = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Press -like 'b64:*') { $Press = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Press.Substring(4))) }
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class PopW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Text(IntPtr h) { var t = new StringBuilder(1024); GetWindowText(h, t, 1024); return t.ToString(); }
  public static string Class(IntPtr h) { var c = new StringBuilder(256); GetClassName(h, c, 256); return c.ToString(); }
  public static List<IntPtr> Top(uint[] pids) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (Array.IndexOf(pids, p) >= 0 && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static List<IntPtr> Children(IntPtr p) { var r = new List<IntPtr>(); EnumChildWindows(p, (h, l) => { r.Add(h); return true; }, IntPtr.Zero); return r; }
}
'@
$pids = [uint32[]]@(Get-Process -Name $Process -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
$out = @()
foreach ($h in [PopW]::Top($pids)) {
  $cls = [PopW]::Class($h)
  if ($cls -ne '#32770' -and $cls -notlike 'WindowsForms10.Window*') { continue }
  $r = New-Object PopW+RECT; [void][PopW]::GetWindowRect($h, [ref]$r)
  if (($r.R - $r.L) -lt 160 -and ($r.B - $r.T) -lt 60) { continue }   # tiny helper windows
  $texts = @(); $buttons = @()
  foreach ($c in [PopW]::Children($h)) {
    $cc = [PopW]::Class($c); $t = [PopW]::Text($c)
    if (-not $t) { continue }
    if ($cc -match 'BUTTON') { $buttons += @{ text = $t; hwnd = [int64]$c } } else { $texts += $t }
  }
  $rec = @{ title = [PopW]::Text($h); cls = $cls; text = ($texts -join ' | '); buttons = @($buttons | ForEach-Object { $_.text }) }
  if ($Press) {
    $b = $buttons | Where-Object { $_.text -like "*$Press*" } | Select-Object -First 1
    if ($b) {
      if ($cls -like 'WindowsForms10.Window*') {
        # WinForms buttons click on their own mouse-up and ignore a reflected BN_CLICKED: BM_CLICK to the button.
        [void][PopW]::PostMessage([IntPtr]$b.hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
        $rec.pressed = $b.text + ' (BM_CLICK)'
      } else {
        # WM_COMMAND(BN_CLICKED, control id) to the dialog: what a click on the button sends.
        $id = [PopW]::GetDlgCtrlID([IntPtr]$b.hwnd)
        [void][PopW]::PostMessage($h, 0x0111, [IntPtr]$id, [IntPtr]$b.hwnd)
        $rec.pressed = $b.text + ' (id ' + $id + ')'
      }
    }
  }
  $out += $rec
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
