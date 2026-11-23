param([string[]]$ExtensionId = @())
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe = Join-Path $Root 'NormPDF.exe'
if(-not (Test-Path -LiteralPath $Exe)){throw 'NormPDF.exe missing beside registration script'}
$ids = New-Object 'System.Collections.Generic.HashSet[string]'
foreach($id in $ExtensionId) {
  foreach($value in ($id -split ',')) {
    $candidate = $value.Trim()
    if($candidate) { [void]$ids.Add($candidate) }
  }
}
if($ids.Count -eq 0) {
  $profileRoot = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  if(Test-Path $profileRoot){
    foreach($profile in @(Get-ChildItem -LiteralPath $profileRoot -Directory -ErrorAction SilentlyContinue|Where-Object {$_.Name -match '^(Default|Profile \d+)$'})){
      foreach($prefs in @('Preferences','Secure Preferences')){
        $file = Join-Path $profile.FullName $prefs
        if(-not (Test-Path -LiteralPath $file)){continue}
        try {
          $data = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
          foreach($entry in $data.extensions.settings.PSObject.Properties){
            $id = [string]$entry.Name
            $path = [string]$entry.Value.path
            $name = [string]$entry.Value.manifest.name
            if($path -match '(?i)Norm-Hybrid-Local-Exporter|Norm-PDF-Exporter' -or $name -match '(?i)Norm Hybrid Local Conversation Exporter'){
              [void]$ids.Add($id)
            }
          }
        }catch { Write-Verbose "Preferences could not be read: $file" }
      }
    }
  }
}
if($ids.Count -eq 0){
  $key = Get-Item 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.norm.localpdf' -ErrorAction SilentlyContinue
  if($key){
    $legacy = [string]$key.GetValue('')
    if(Test-Path -LiteralPath $legacy){
      try {
        $manifest = Get-Content -LiteralPath $legacy -Raw | ConvertFrom-Json
        if($manifest.name -eq 'com.norm.localpdf'){
          foreach($origin in @($manifest.allowed_origins)){
            if($origin -match '^chrome-extension://([a-p]{32})/$'){[void]$ids.Add($Matches[1])}
          }
        }
      }catch {}
    }
  }
}
if($ids.Count -eq 0){
  $entered = Read-Host 'No installed Norm extension found. Paste its ID from chrome://extensions'
  [void]$ids.Add($entered.Trim())
}
$all = @($ids | Sort-Object)
foreach($id in $all){if($id -cnotmatch '^[a-p]{32}$'){throw "Invalid Chrome extension ID: $id"}}
& $Exe --register @all
if($LASTEXITCODE -ne 0){throw 'Chrome native-host registration failed'}
$expected = Join-Path $Root 'native-host.json'
$reg = Get-Item 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.norm.localpdf'
if($reg.GetValue('') -ne $expected){throw 'Chrome registration points outside this portable directory'}
$manifest = Get-Content $expected -Raw|ConvertFrom-Json
if($manifest.path -ne $Exe){throw 'Native host path mismatch'}
Write-Output ('Registered portable NormPDF at '+$Root)
Write-Output ('Authorized extension IDs: '+($all -join ', '))
$old = Join-Path $env:LOCALAPPDATA 'NormPDF\native-host.json'
if($old -ne $expected -and (Test-Path -LiteralPath $old)){
  try {
    $previous = Get-Content -LiteralPath $old -Raw|ConvertFrom-Json
    if($previous.name -eq 'com.norm.localpdf'){
      Remove-Item -LiteralPath $old -Force
      $legacyDir = Split-Path -Parent $old
      if(-not (Get-ChildItem -LiteralPath $legacyDir -Force|Select-Object -First 1)){Remove-Item -LiteralPath $legacyDir -Force}
      Write-Output 'Removed obsolete AppData native-host manifest'
    }
  }catch {Write-Warning "Obsolete manifest cleanup was skipped: $($_.Exception.Message)"}
}
