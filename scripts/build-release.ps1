param(
  [string]$RuntimeSource = '',
  [string]$Tag = 'v0.4.12'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ext = Join-Path $root 'extension'
$pdf = Join-Path $root 'NormPDF'
$runtime = Join-Path $pdf 'runtime\weasyprint'
if(-not (Test-Path -LiteralPath (Join-Path $runtime 'weasyprint.exe'))) {
  if(-not $RuntimeSource){throw 'Bundled runtime missing; supply -RuntimeSource with a tested WeasyPrint runtime folder'}
  if(-not (Test-Path -LiteralPath (Join-Path $RuntimeSource 'weasyprint.exe'))){throw 'RuntimeSource lacks weasyprint.exe'}
  [IO.Directory]::CreateDirectory((Split-Path -Parent $runtime))|Out-Null
  Copy-Item -LiteralPath $RuntimeSource -Destination $runtime -Recurse -Force
}
$manifest = Get-Content (Join-Path $ext 'manifest.json') -Raw|ConvertFrom-Json
if($manifest.version -ne $Tag.TrimStart('v')){throw ('Tag does not match extension version '+$manifest.version)}
$csc='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$lib='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll'
if(-not (Test-Path $csc)){throw 'Required .NET Framework C# compiler is missing'}
& $csc /nologo /target:exe /out:"$pdf\NormPDF.exe" /reference:"$lib" (Join-Path $pdf 'src\NormPDF.cs')
if($LASTEXITCODE -ne 0){throw 'NormPDF compilation failed'}
& (Join-Path $pdf 'NormPDF.exe') --ping
if($LASTEXITCODE -ne 0){throw 'Bundled runtime ping failed'}
foreach($name in @('capture.js','background.js','content.js','render.js','rich.js')){
  node --check (Join-Path $ext $name)
  if($LASTEXITCODE -ne 0){throw ('Syntax check failed '+$name)}
}
foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $ext 'tests') -File -Filter 'test_*.js')){
  node $file.FullName
  if($LASTEXITCODE -ne 0){throw ('Regression test failed '+$file.Name)}
}
$dist=Join-Path $root 'dist'
[IO.Directory]::CreateDirectory($dist)|Out-Null
$stage=Join-Path $dist ('.stage-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage)|Out-Null
try {
  Copy-Item -LiteralPath $ext -Destination (Join-Path $stage 'extension') -Recurse -Force
  Copy-Item -LiteralPath $pdf -Destination (Join-Path $stage 'NormPDF') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $root 'third_party') -Destination (Join-Path $stage 'third_party') -Recurse -Force
  foreach($f in @('README.md','THIRD_PARTY_NOTICES.md','register-chrome.cmd')){
    Copy-Item -LiteralPath (Join-Path $root $f) -Destination (Join-Path $stage $f)
  }
  $machine=Join-Path $stage 'NormPDF\native-host.json'
  if(Test-Path $machine){Remove-Item -LiteralPath $machine -Force}
  $file=Join-Path $dist ('Norm-PDF-Exporter-'+$Tag+'-portable-windows.zip')
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $file -CompressionLevel Optimal -Force
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($file)
  try {
    $names=@($zip.Entries|ForEach-Object{$_.FullName.Replace('\','/')})
    foreach($required in @('extension/manifest.json','extension/capture.js','extension/content.js',
      'NormPDF/NormPDF.exe','NormPDF/src/NormPDF.cs','NormPDF/runtime/weasyprint/weasyprint.exe',
      'NormPDF/templates/conversation.css','NormPDF/templates/compact.css',
      'NormPDF/templates/report.css','NormPDF/register-chrome.ps1',
      'third_party/WeasyPrint-LICENSE.txt','register-chrome.cmd')){
      if($names -notcontains $required){throw ('Release ZIP missing '+$required)}
    }
    if($names -contains 'NormPDF/native-host.json'){throw 'Machine-specific native host manifest accidentally bundled'}
    Write-Output ('ZIP_ENTRIES='+$names.Count)
  }finally{$zip.Dispose()}
  $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  $checksum=Join-Path $dist 'SHA256SUMS.txt'
  [IO.File]::WriteAllText($checksum,($hash.ToLower()+'  '+(Split-Path $file -Leaf)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  Write-Output ('RELEASE_FILE='+$file)
  Write-Output ('RELEASE_BYTES='+(Get-Item $file).Length)
  Write-Output ('RELEASE_SHA256='+$hash)
}finally{
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
