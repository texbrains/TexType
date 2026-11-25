# Presses a button of the TexType Ribbon tab without global input. ASCII only; names may be passed as b64:<utf-8>.
#   ribbon.ps1 -Name <button>              Word: the tab is selected and the button invoked through UI Automation
#   ribbon.ps1 -Wps -X <x> -Y <y>          WPS Writer: its large Ribbon buttons have no UI Automation name, so the
#                                          tab is selected through UI Automation and a click is posted to the
#                                          window under the point (physical pixels relative to the WPS window)
param([string]$Name = '', [switch]$Wps, [int]$X = 0, [int]$Y = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Name -like 'b64:*') { $Name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Name.Substring(4))) }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [Windows.Automation.AutomationElement]
$TS = [Windows.Automation.TreeScope]
$tabName = 'TexType'

if (-not $Wps) {
  $p = Get-Process -Name WINWORD | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { throw 'no Word window' }
  $main = $AE::FromHandle($p.MainWindowHandle)
  $tabCond = New-Object Windows.Automation.AndCondition(
    (New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)),
    (New-Object Windows.Automation.PropertyCondition($AE::NameProperty, $tabName)))
  $tab = $main.FindFirst($TS::Descendants, $tabCond)
  if (-not $tab) { throw 'TexType tab not found (add-in not loaded?)' }
  $tab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
  Start-Sleep -Milliseconds 600
  $cond = New-Object Windows.Automation.AndCondition(
    (New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::Button)),
    (New-Object Windows.Automation.PropertyCondition($AE::NameProperty, $Name)))
  $b = $main.FindFirst($TS::Descendants, $cond)
  if (-not $b) { throw ('button not found: ' + $Name) }
  $b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  return 'invoked'
}

Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr ChildWindowFromPointEx(IntPtr h, POINT p, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static string Cls(IntPtr h) { var c = new StringBuilder(256); GetClassName(h, c, 256); return c.ToString(); }
  public static List<IntPtr> Children(IntPtr p) { var r = new List<IntPtr>(); EnumChildWindows(p, (h, l) => { if (IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero); return r; }
}
'@
# physical pixels, as a window capture measures them
[void][Win]::SetProcessDPIAware()
$pids = [uint32[]]@(Get-Process -Name wps -ErrorAction Stop | ForEach-Object { [uint32]$_.Id })
$top = [IntPtr]::Zero
[void][Win]::EnumWindows({ param($h, $l)
  $p = [uint32]0; [void][Win]::GetWindowThreadProcessId($h, [ref]$p)
  if ($pids -contains $p -and [Win]::IsWindowVisible($h) -and [Win]::Cls($h) -eq 'OpusApp') { $script:top = $h; return $false }
  return $true }, [IntPtr]::Zero)
if ($top -eq [IntPtr]::Zero) { throw 'no visible WPS Writer window' }

# The Ribbon is a Qt widget tree inside its host child window (bosa_sdm_...); its tabs are KRbTabButton buttons.
$ribbonHost = [Win]::Children($top) | Where-Object { [Win]::Cls($_) -like 'bosa_sdm*' } | Select-Object -First 1
if (-not $ribbonHost) { throw 'no WPS Ribbon window' }
$tabCond = New-Object Windows.Automation.AndCondition(
  (New-Object Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'KRbTabButton')),
  (New-Object Windows.Automation.PropertyCondition($AE::NameProperty, $tabName)))
$tab = $AE::FromHandle($ribbonHost).FindFirst($TS::Descendants, $tabCond)
if (-not $tab) { throw 'TexType tab not found (add-in not connected?)' }
$selection = $null
if ($tab.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) { $selection.Select() }
else { $tab.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
# the tab's Ribbon is drawn a moment after the tab is selected
Start-Sleep -Milliseconds 1000

$r = New-Object Win+RECT; [void][Win]::GetWindowRect($top, [ref]$r)
$screen = New-Object Win+POINT; $screen.X = $r.L + $X; $screen.Y = $r.T + $Y
$h = $top
for ($depth = 0; $depth -lt 12; $depth++) {
  $pt = New-Object Win+POINT; $pt.X = $screen.X; $pt.Y = $screen.Y
  [void][Win]::ScreenToClient($h, [ref]$pt)
  $child = [Win]::ChildWindowFromPointEx($h, $pt, 0x0001 -bor 0x0004)   # skip invisible and transparent windows
  if ($child -eq [IntPtr]::Zero -or $child -eq $h) { break }
  $h = $child
}
$pt = New-Object Win+POINT; $pt.X = $screen.X; $pt.Y = $screen.Y
[void][Win]::ScreenToClient($h, [ref]$pt)
$lparam = [IntPtr](($pt.Y -shl 16) -bor ($pt.X -band 0xFFFF))
[void][Win]::PostMessage($h, 0x0200, [IntPtr]0, $lparam)   # WM_MOUSEMOVE
Start-Sleep -Milliseconds 40
[void][Win]::PostMessage($h, 0x0201, [IntPtr]1, $lparam)   # WM_LBUTTONDOWN
Start-Sleep -Milliseconds 80
[void][Win]::PostMessage($h, 0x0202, [IntPtr]0, $lparam)   # WM_LBUTTONUP
'clicked ' + [Win]::Cls($h) + ' at ' + $pt.X + ',' + $pt.Y
