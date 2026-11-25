# Word's prompt on quitting about unopened Document Recovery files (a bosa_sdm_msword dialog): chooses "keep / view
# these files later" and presses OK through MSAA, as Word's SDM dialogs expose no UI Automation children. Never
# chooses the delete option: OK is pressed only after the keep option reports itself checked. Prints
# "no Word dialog" when there is none. ASCII only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies Accessibility @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
using Accessibility;
public static class SdmAcc {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object obj);
  [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible acc, int start, int count, [Out] object[] children, out int obtained);
  public static List<IntPtr> Find(uint pid, string cls) {
    var res = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (p == pid && sb.ToString() == cls && IsWindowVisible(h)) res.Add(h); return true; }, IntPtr.Zero);
    return res;
  }
  public class Item { public IAccessible Acc; public object Child; public string Name; public int Role; public int State; }
  public static List<Item> Items(IntPtr hwnd) {
    var guid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    object obj; AccessibleObjectFromWindow(hwnd, 0xFFFFFFFC, ref guid, out obj);   // OBJID_CLIENT
    var res = new List<Item>(); Walk((IAccessible)obj, res, 0); return res;
  }
  static void Walk(IAccessible acc, List<Item> res, int depth) {
    if (depth > 6) return;
    int count = acc.accChildCount; if (count <= 0) return;
    var children = new object[count]; int got; AccessibleChildren(acc, 0, count, children, out got);
    for (int i = 0; i < got; i++) {
      var child = children[i];
      var asAcc = child as IAccessible;
      if (asAcc != null) { res.Add(Make(asAcc, 0)); Walk(asAcc, res, depth + 1); }
      else res.Add(Make(acc, child));
    }
  }
  public static void DoDefault(Item item) { item.Acc.accDoDefaultAction(item.Child); }
  public static int State(Item item) { return Convert.ToInt32(item.Acc.get_accState(item.Child)); }
  static Item Make(IAccessible acc, object child) {
    var item = new Item { Acc = acc, Child = child };
    try { item.Name = acc.get_accName(child); } catch { }
    try { item.Role = Convert.ToInt32(acc.get_accRole(child)); } catch { }
    try { item.State = Convert.ToInt32(acc.get_accState(child)); } catch { }
    return item;
  }
}
'@
$proc = Get-Process WINWORD -ErrorAction Stop | Select-Object -First 1
$handles = [SdmAcc]::Find([uint32]$proc.Id, 'bosa_sdm_msword')
if ($handles.Count -eq 0) { 'no Word dialog'; exit 0 }
$items = [SdmAcc]::Items($handles[0])
$yes = [string][char]0x662F   # "shi" (yes): the keep option starts with it
$ok = [string][char]0x786E + [char]0x5B9A   # "queding" (OK)
$keep = @($items | Where-Object { $_.Role -eq 0x2D -and $_.Name -and $_.Name.StartsWith($yes) }) | Select-Object -First 1
if (-not $keep) { throw 'keep option not found; leaving the dialog untouched' }
if (([SdmAcc]::State($keep) -band 0x10) -eq 0) {
  [SdmAcc]::DoDefault($keep)
  Start-Sleep -Milliseconds 400
}
$state = [SdmAcc]::State($keep)
if (($state -band 0x10) -eq 0) { throw ('keep option not checked (state 0x{0:X}); leaving the dialog untouched' -f $state) }
'checked: ' + $keep.Name
$button = @($items | Where-Object { $_.Role -eq 0x2B -and $_.Name -eq $ok }) | Select-Object -First 1
if (-not $button) { throw 'OK button not found' }
[SdmAcc]::DoDefault($button)
'pressed OK'
