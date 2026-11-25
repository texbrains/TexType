# The test document in Word or WPS Writer, through COM. Every action finds the document by its path in the Running
# Object Table, so a program that merely owns .docx files on this PC is never driven by mistake. No global input.
# ASCII only (PowerShell 5.1 reads a BOM-less script as the system code page). Names may be passed as b64:<utf-8>.
#   newdoc [-Where equation]        write a two-paragraph .docx (with -Where equation: the first paragraph ends with
#                                   the inline equation a+b, written in the file)
#   start | quit | save | reopen    start the host with the document; close it (Word: quit Word); save; close + open
#   connect                         connect the add-in (WPS does not connect a newly registered add-in by itself)
#   state                           JSON: equations, paragraphs, hyperlinks, content controls, revisions (Word, COM)
#   xstate                          the same read from the saved file (out-of-process COM sees no equations in WPS)
#   caret -Where end|after-omath [-Index n] | caret-at -Index p -Offset n | caret-after-text -Index p -Name text
#   caret-cell | caret-last | caret-link-start -Index n | select-omath -Index n
#   setup-edge | add-table | track -Where on|off
#   undo | redo [-Times n]
#   chars -Index p                  paragraph p's characters as code points (Word: hidden field markers read as nothing)
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Name = '', [string]$Where = 'end', [int]$Index = 1, [int]$Offset = 0, [int]$Times = 1, [switch]$Wps
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Dec($s) { if ($s -like 'b64:*') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s.Substring(4))) } else { $s } }
$Name = Dec $Name; $Where = Dec $Where

Add-Type @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class Rot {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
  public static object Find(string path) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot);
    IEnumMoniker e; rot.EnumRunning(out e);
    var m = new IMoniker[1];
    while (e.Next(1, m, IntPtr.Zero) == 0) {
      IBindCtx c; CreateBindCtx(0, out c);
      string name; m[0].GetDisplayName(c, null, out name);
      if (string.Equals(name, path, StringComparison.OrdinalIgnoreCase)) { object o; rot.GetObject(m[0], out o); return o; }
    }
    return null;
  }
}
'@
function Get-Doc {
  $d = [Rot]::Find($Path)
  if (-not $d) { throw ('not open: ' + $Path) }
  $want = if ($Wps) { '12*' } else { '16*' }
  if ($d.Application.Version -notlike $want) { throw ('not the expected host: ' + $d.Application.Name + ' ' + $d.Application.Version) }
  $d
}
function Get-Exe {
  $key = if ($Wps) { 'wps.exe' } else { 'Winword.exe' }
  foreach ($hive in 'HKCU:', 'HKLM:') {
    $p = Get-ItemProperty "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$key" -ErrorAction SilentlyContinue
    if ($p) { return $p.'(default)' }
  }
  throw "$key is not installed"
}
function Out-Json($o) { $o | ConvertTo-Json -Depth 6 -Compress }

switch ($Action) {
  'newdoc' {
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    if (Test-Path $Path) { Remove-Item $Path }
    $math = ''
    if ($Where -eq 'equation') {
      $run = { param($t, $plain) '<m:r>' + $(if ($plain) { '<m:rPr><m:sty m:val="p"/></m:rPr>' } else { '' }) + '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>' + $t + '</m:t></m:r>' }
      $math = '<m:oMath>' + (& $run 'a' $false) + (& $run '+' $true) + (& $run 'b' $false) + '</m:oMath>'
    }
    $parts = @{
      '[Content_Types].xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      '_rels/.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      'word/document.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t xml:space="preserve">TexType test: </w:t></w:r>' + $math + '</w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>'
    }
    $zip = [IO.Compression.ZipFile]::Open($Path, 'Create')
    foreach ($k in $parts.Keys) {
      $s = New-Object IO.StreamWriter($zip.CreateEntry($k).Open(), (New-Object Text.UTF8Encoding $false))
      $s.Write($parts[$k]); $s.Close()
    }
    $zip.Dispose()
    'created ' + $Path
  }
  'start' {
    $p = Start-Process -FilePath (Get-Exe) -ArgumentList ('"' + $Path + '"') -PassThru
    'pid ' + $p.Id
  }
  'connect' {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
    $progId = ''
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root 'product.toml'))) {
      if ($line -match '^word_addin_progid\s*=\s*"([^"]*)"') { $progId = $Matches[1] }
    }
    $c = (Get-Doc).Application.COMAddIns.Item($progId)
    if (-not $c.Connect) { $c.Connect = $true }
    'connected ' + $c.Connect
  }
  'state' {
    $d = Get-Doc
    $eqs = @()
    for ($i = 1; $i -le $d.OMaths.Count; $i++) {
      $m = $d.OMaths.Item($i)
      # the equation's structure in short: math elements and texts, no properties
      $omml = [regex]::Match($m.Range.WordOpenXML, '<m:oMath>.*</m:oMath>', 'Singleline').Value
      $short = $omml -replace '<w:rPr>.*?</w:rPr>', '' -replace '<m:rPr>.*?</m:rPr>', '' -replace '<m:(\w+)Pr>.*?</m:\1Pr>', '' -replace '<m:ctrlPr>.*?</m:ctrlPr>', ''
      $eqs += @{ text = $m.Range.Text; display = ($m.Type -eq 0); size = $m.Range.Font.Size; xml = $short }
    }
    $paras = @(); foreach ($p in $d.Paragraphs) { $paras += $p.Range.Text }
    $links = $d.Hyperlinks.Count
    $ccs = $d.ContentControls.Count
    Out-Json @{ equations = $eqs; paragraphs = $paras; links = $links; ccs = $ccs; revs = $d.Revisions.Count
      linkMath = $(if ($links) { $d.Hyperlinks.Item(1).Range.OMaths.Count } else { 0 })
      ccMath = $(if ($ccs) { $d.ContentControls.Item(1).Range.OMaths.Count } else { 0 }) }
  }
  'xstate' {
    $d = Get-Doc
    $d.Save()
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    $zip = New-Object IO.Compression.ZipArchive($fs, 'Read')
    $reader = New-Object IO.StreamReader($zip.GetEntry('word/document.xml').Open())
    [xml]$x = $reader.ReadToEnd(); $reader.Close(); $zip.Dispose(); $fs.Close()
    $ns = New-Object Xml.XmlNamespaceManager($x.NameTable)
    $w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $ns.AddNamespace('w', $w)
    $ns.AddNamespace('m', 'http://schemas.openxmlformats.org/officeDocument/2006/math')
    $eqs = @()
    foreach ($m in $x.SelectNodes('//m:oMath', $ns)) {
      $text = -join @($m.SelectNodes('.//m:t', $ns) | ForEach-Object { $_.InnerText })
      $xml = $m.OuterXml -replace ' xmlns:\w+="[^"]*"', ''
      $eqs += @{ text = $text; display = ($m.ParentNode.LocalName -eq 'oMathPara'); size = $null; xml = $xml.Substring(0, [Math]::Min(1500, $xml.Length)) }
    }
    $paras = @()
    foreach ($p in $x.SelectNodes('//w:body//w:p', $ns)) { $paras += (-join @($p.SelectNodes('.//w:t|.//m:t', $ns) | ForEach-Object { $_.InnerText })) }
    # hyperlinks as elements or as HYPERLINK fields; an equation is in a field link when it lies between its separator and end
    $links = $x.SelectNodes('//w:hyperlink', $ns).Count + @($x.SelectNodes('//w:instrText', $ns) | Where-Object { $_.InnerText -match 'HYPERLINK' }).Count
    $linkMath = $x.SelectNodes('//w:hyperlink//m:oMath', $ns).Count
    $field = $null
    foreach ($n in $x.SelectNodes('//w:fldChar|//m:oMath|//w:instrText', $ns)) {
      $type = if ($n.LocalName -eq 'fldChar') { $n.GetAttribute('fldCharType', $w) } else { '' }
      if ($n.LocalName -eq 'instrText' -and $n.InnerText -match 'HYPERLINK') { $field = 'code' }
      elseif ($type -eq 'separate' -and $field -eq 'code') { $field = 'result' }
      elseif ($type -eq 'end') { $field = $null }
      elseif ($n.LocalName -eq 'oMath' -and $field -eq 'result') { $linkMath++ }
    }
    Out-Json @{ equations = $eqs; paragraphs = $paras; links = $links; ccs = $x.SelectNodes('//w:sdt', $ns).Count
      revs = $x.SelectNodes('//w:ins|//w:del', $ns).Count; linkMath = $linkMath; ccMath = $x.SelectNodes('//w:sdt//m:oMath', $ns).Count }
  }
  'caret' {
    $d = Get-Doc
    $d.Activate()
    $d.Application.Activate()
    switch ($Where) {
      'end' { $r = $d.Paragraphs.Item(1).Range; $r.MoveEnd(1, -1) | Out-Null; $r.Collapse(0); $r.Select() }
      'after-omath' { $r = $d.OMaths.Item($Index).Range; $r.Collapse(0); $r.Select() }
      default { throw "unknown caret place $Where" }
    }
    'caret ' + $Where
  }
  'caret-at' {
    $d = Get-Doc
    $d.Activate()
    $pos = $d.Paragraphs.Item($Index).Range.Start + $Offset
    $d.Range($pos, $pos).Select()
    'caret at ' + $pos
  }
  'caret-after-text' {
    # right after the first place in paragraph -Index whose text reads -Name (field codes read as nothing)
    $d = Get-Doc
    $d.Activate()
    $p = $d.Paragraphs.Item($Index).Range
    for ($pos = $p.Start; $pos -lt $p.End; $pos++) {
      if ($d.Range($pos, $pos + $Name.Length).Text -ceq $Name) { $d.Range($pos + $Name.Length, $pos + $Name.Length).Select(); return "caret at $($pos + $Name.Length)" }
    }
    throw "text not found in paragraph ${Index}: $Name"
  }
  'caret-cell' {
    $d = Get-Doc
    $d.Activate()
    $r = $d.Tables.Item(1).Cell(1, 1).Range
    $r.MoveEnd(1, -1) | Out-Null
    $r.Collapse(0)
    $r.Select()
    'caret at the end of cell 1'
  }
  'caret-last' {
    $d = Get-Doc
    $d.Activate()
    $r = $d.Paragraphs.Item($d.Paragraphs.Count).Range
    $r.Collapse(1)
    $r.Select()
    'caret in the last paragraph: ' + $r.Start
  }
  'caret-link-start' {
    # the start of hyperlink n's text
    $d = Get-Doc
    $d.Activate()
    $pos = $d.Hyperlinks.Item($Index).Range.Start
    $d.Range($pos, $pos).Select()
    'caret at the start of hyperlink ' + $Index + ': ' + $pos
  }
  'select-omath' {
    $d = Get-Doc
    $d.Activate()
    $d.Application.Activate()
    $d.OMaths.Item($Index).Range.Select()
    'selected equation ' + $Index
  }
  'setup-edge' {
    # paragraph 3: a hyperlink "link text"; paragraph 4: a rich text content control "cc text"; paragraph 5: text
    $d = Get-Doc
    function AddParagraph($text) {
      $d.Content.InsertParagraphAfter()
      $d.Paragraphs.Item($d.Paragraphs.Count).Range.InsertBefore($text)
      $d.Paragraphs.Item($d.Paragraphs.Count).Range
    }
    $p = AddParagraph 'link text'
    [void]$d.Hyperlinks.Add($d.Range($p.Start, $p.Start + 9), 'https://example.com/')
    $p = AddParagraph 'cc text'
    $cc = 'content control: '
    try { [void]$d.ContentControls.Add(0, $d.Range($p.Start, $p.Start + 7)); $cc += 'added' } catch { $cc += 'not supported: ' + $_.Exception.Message }
    [void](AddParagraph 'tracked text')
    $d.Save()
    'set up; ' + $cc
  }
  'add-table' {
    # a one-row, two-cell table after the last paragraph ("cell" | ""), and a paragraph after it
    $d = Get-Doc
    $d.Content.InsertParagraphAfter()
    $t = $d.Tables.Add($d.Paragraphs.Item($d.Paragraphs.Count).Range, 1, 2)
    $t.Cell(1, 1).Range.Text = 'cell'
    'table added'
  }
  'track' {
    $d = Get-Doc
    $d.TrackRevisions = ($Where -eq 'on')
    'track changes ' + $d.TrackRevisions
  }
  'chars' {
    $d = Get-Doc
    $p = $d.Paragraphs.Item($Index).Range
    $out = @()
    for ($pos = $p.Start; $pos -lt $p.End; $pos++) {
      $out += ($pos.ToString() + ':' + ((([char[]]($d.Range($pos, $pos + 1).Text + '')) | ForEach-Object { '{0:X}' -f [int]$_ }) -join '+'))
    }
    'paragraph ' + $Index + ': ' + ($out -join ' ')
  }
  'undo' { 'undo ' + (Get-Doc).Undo($Times) }
  'redo' { 'redo ' + (Get-Doc).Redo($Times) }
  'save' { (Get-Doc).Save(); 'saved' }
  'reopen' {
    $d = Get-Doc
    $app = $d.Application
    $d.Close(0)
    Start-Sleep -Milliseconds 500
    if ($Wps) {
      # WPS's Word-compatible object goes with its last document: WPS opens the file again itself
      Start-Process -FilePath (Get-Exe) -ArgumentList ('"' + $Path + '"')
      for ($i = 0; $i -lt 40 -and -not [Rot]::Find($Path); $i++) { Start-Sleep -Milliseconds 500 }
      Start-Sleep -Seconds 2
      return 'reopened ' + (Get-Doc).Name
    }
    $d = $app.Documents.Open($Path)
    $d.Activate()
    'reopened ' + $d.Name
  }
  'quit' {
    $d = Get-Doc
    $app = $d.Application
    $d.Close(0)
    if ($Wps) { 'closed the test document'; return }
    $left = @($app.Documents | ForEach-Object { $_.FullName })
    if ($left.Count) { 'documents still open, Word left running: ' + ($left -join ', '); return }
    # Quit on another thread; this one answers Word's Document Recovery prompt with "keep".
    $ps = [powershell]::Create().AddScript({ param($a) $a.Quit(0) }).AddArgument($app)
    $null = $ps.BeginInvoke()
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 1000
      if (-not (Get-Process WINWORD -ErrorAction SilentlyContinue)) { 'Word quit'; return }
      $report = try { & (Join-Path $PSScriptRoot 'word-recovery-keep.ps1') } catch { 'no Word dialog' }
      if ($report -notmatch 'no Word dialog') { $report }
    }
    'Word still running after 40 s'
  }
  default { throw "unknown action $Action" }
}
