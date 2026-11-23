$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest=Join-Path $root 'native-host.json'
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.norm.localpdf'
$existing=Get-Item -Path $key -ErrorAction SilentlyContinue
if(-not $existing){Write-Output 'NormPDF native host is not registered';exit 0}
if([string]$existing.GetValue('') -ne $manifest){throw 'A different NormPDF installation is registered; nothing was changed'}
Remove-Item -LiteralPath $key -Force
if(Test-Path -LiteralPath $manifest){
  $info=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
  if($info.name -eq 'com.norm.localpdf'){Remove-Item -LiteralPath $manifest -Force}
}
Write-Output 'Removed the portable Chrome native-host registration. No application files were deleted.'
