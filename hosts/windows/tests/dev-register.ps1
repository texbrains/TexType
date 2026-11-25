# Registers the built Word / WPS Writer add-in for the current user, for development (no administrator rights).
# The class identifier and class name come from product.toml; the assembly from the build output
# (dotnet build hosts/windows -c <Configuration> -p:Platform=<Platform>).
#
#   powershell -ExecutionPolicy Bypass -File hosts/windows/tests/dev-register.ps1 [-Platform x64|x86] [-Configuration Release|Debug]
#   powershell -ExecutionPolicy Bypass -File hosts/windows/tests/dev-register.ps1 -Unregister [-Platform x64|x86]
#
# The COM class goes into the registry view of the platform (Word or WPS of that bitness loads it). Word reads
# HKCU\Software\Microsoft\Office\Word\Addins; WPS Writer reads the same key and, where its add-in whitelist is on,
# HKCU\Software\Kingsoft\Office\WPS\AddinsWL. Close Word and WPS before running it.
param(
    [ValidateSet('x64', 'x86')] [string] $Platform = 'x64',
    [ValidateSet('Release', 'Debug')] [string] $Configuration = 'Release',
    [switch] $Unregister
)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$product = @{}
foreach ($line in [System.IO.File]::ReadAllLines((Join-Path $root 'product.toml'))) {
    if ($line -match '^(\w+)\s*=\s*"([^"]*)"') { $product[$Matches[1]] = $Matches[2] }
}
$progId = $product['word_addin_progid']
$clsid = '{' + $product['word_addin_clsid'] + '}'
if (-not $progId -or $clsid -eq '{}') { throw 'product.toml has no word_addin_progid or word_addin_clsid' }
$className = 'TexType.Word.Connect'

$view = if ($Platform -eq 'x86') { [Microsoft.Win32.RegistryView]::Registry32 } else { [Microsoft.Win32.RegistryView]::Registry64 }
$classesView = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
$user = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Default)

$clsidPath = "Software\Classes\CLSID\$clsid"
$progIdPath = "Software\Classes\$progId"
$addinPath = "Software\Microsoft\Office\Word\Addins\$progId"
$wpsListPath = 'Software\Kingsoft\Office\WPS\AddinsWL'

if ($Unregister) {
    $classesView.DeleteSubKeyTree($clsidPath, $false)
    $user.DeleteSubKeyTree($progIdPath, $false)
    $user.DeleteSubKeyTree($addinPath, $false)
    $list = $user.OpenSubKey($wpsListPath, $true)
    if ($list) { $list.DeleteValue($progId, $false); $list.Close() }
    Write-Output "Unregistered $progId ($Platform)."
    return
}

$dll = Join-Path $root "target\windows\bin\Word\$Platform\$Configuration\net472\TexType.Word.dll"
if (-not (Test-Path $dll)) { throw "Not built: $dll" }
$assembly = [System.Reflection.AssemblyName]::GetAssemblyName($dll)
# mscoree takes the path as it is after file:///; an escaped URI (%20) fails to load.
$codeBase = 'file:///' + $dll

function Set-Values($key, [hashtable] $values) {
    foreach ($name in $values.Keys) { $key.SetValue($name, $values[$name]) }
}

$server = @{
    'Class' = $className
    'Assembly' = $assembly.FullName
    'RuntimeVersion' = 'v4.0.30319'
    'CodeBase' = $codeBase
}
$class = $classesView.CreateSubKey($clsidPath)
$class.SetValue('', 'TexType')
$inproc = $class.CreateSubKey('InprocServer32')
$inproc.SetValue('', 'mscoree.dll')
$inproc.SetValue('ThreadingModel', 'Both')
Set-Values $inproc $server
$versioned = $inproc.CreateSubKey($assembly.Version.ToString())
Set-Values $versioned $server
$class.CreateSubKey('ProgId').SetValue('', $progId)
# The category of .NET classes.
[void] $class.CreateSubKey('Implemented Categories\{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}')

$progIdKey = $user.CreateSubKey($progIdPath)
$progIdKey.SetValue('', $className)
$progIdKey.CreateSubKey('CLSID').SetValue('', $clsid)

$addin = $user.CreateSubKey($addinPath)
$addin.SetValue('FriendlyName', 'TexType')
$addin.SetValue('Description', 'TexType')
$addin.SetValue('LoadBehavior', 3, [Microsoft.Win32.RegistryValueKind]::DWord)
$addin.SetValue('CommandLineSafe', 0, [Microsoft.Win32.RegistryValueKind]::DWord)

$user.CreateSubKey($wpsListPath).SetValue($progId, '')

Write-Output "Registered $progId ($Platform): $dll"
