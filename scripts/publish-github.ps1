param(
  [string]$Repository = 'hermit-node/Norm-PDF-Exportee',
  [ValidateSet('private','public')][string]$Visibility = 'private',
  [string]$Tag = 'v0.4.12'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$zip = Join-Path $root ('dist\Norm-PDF-Exporter-'+$Tag+'-portable-windows.zip')
$hash = Join-Path $root 'dist\SHA256SUMS.txt'
$notes = Join-Path $root 'RELEASE_NOTES.md'
foreach($p in @($zip,$hash,$notes)){if(-not (Test-Path -LiteralPath $p)){throw ('Required release artifact missing: '+$p)}}
if(-not (Get-Command gh -ErrorAction SilentlyContinue)){
  throw 'GitHub CLI (gh) is not installed. Install it and run gh auth login, then rerun this script.'
}
& gh auth status
if($LASTEXITCODE -ne 0){throw 'GitHub CLI is not authorized. Run: gh auth login'}
$localTag = git rev-list -n 1 $Tag
if($LASTEXITCODE -ne 0){throw ('Local tag missing: '+$Tag)}
$head = git rev-parse HEAD
if($localTag -ne $head){throw 'Release tag does not match the current HEAD'}
$remote = 'https://github.com/'+$Repository+'.git'
$origin = git remote get-url origin 2>$null
if(-not $origin){git remote add origin $remote}
elseif($origin -ne $remote){throw ('origin remote differs from intended GitHub repo: '+$origin)}
& gh repo view $Repository --json name --jq .name 2>$null
if($LASTEXITCODE -ne 0){
  if($Visibility -eq 'private'){& gh repo create $Repository --private --description 'Portable Chrome ChatGPT exporter and local NormPDF/WeasyPrint renderer'}
  else {& gh repo create $Repository --public --description 'Portable Chrome ChatGPT exporter and local NormPDF/WeasyPrint renderer'}
  if($LASTEXITCODE -ne 0){throw 'GitHub repository creation failed'}
}
& gh auth setup-git
if($LASTEXITCODE -ne 0){throw 'GitHub CLI could not configure Git authentication'}
git push -u origin main
if($LASTEXITCODE -ne 0){throw 'GitHub main push failed'}
git push origin $Tag
if($LASTEXITCODE -ne 0){throw 'GitHub tag push failed'}
& gh release view $Tag --repo $Repository *> $null
if($LASTEXITCODE -eq 0){
  & gh release upload $Tag $zip $hash --repo $Repository --clobber
  if($LASTEXITCODE -ne 0){throw 'GitHub release asset upload failed'}
} else {
  & gh release create $Tag $zip $hash --repo $Repository --verify-tag --title ('Norm PDF Exporter '+$Tag) --notes-file $notes
  if($LASTEXITCODE -ne 0){throw 'GitHub release creation failed'}
}
Write-Output ('GITHUB_RELEASE=https://github.com/'+$Repository+'/releases/tag/'+$Tag)
