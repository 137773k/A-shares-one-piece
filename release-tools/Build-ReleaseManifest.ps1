[CmdletBinding()]
param(
  [string]$ReleaseDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "release")
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$releaseRoot = [IO.Path]::GetFullPath($ReleaseDir)
$packagePath = Join-Path $projectRoot "package.json"
$package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "package.json version is not a stable semantic version"
}

$artifactNames = @(
  "A股短线模型-Setup-$version-x64.exe",
  "A股短线模型-Portable-$version-x64.exe"
)
$artifacts = foreach ($name in $artifactNames) {
  $filePath = Join-Path $releaseRoot $name
  $item = Get-Item -LiteralPath $filePath
  if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
    $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
    [ordered]@{
      name = $item.Name
      sizeBytes = [int64]$item.Length
      sha256 = $digest
      authenticodeStatus = [string]$signature.Status
    }
  } else {
    throw "release artifact must be a regular file: $name"
  }
}

$checksumLines = $artifacts | ForEach-Object { "$($_.sha256)  $($_.name)" }
$checksumPath = Join-Path $releaseRoot "SHA256SUMS.txt"
[IO.File]::WriteAllLines($checksumPath, $checksumLines, [Text.UTF8Encoding]::new($false))

$commit = (& git -C $projectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') {
  throw "unable to resolve the release source commit"
}
$manifest = [ordered]@{
  schemaVersion = 1
  project = "A shares one piece"
  productName = [string]$package.build.productName
  version = $version
  sourceCommit = $commit
  platform = "windows-x64"
  generatedAt = [DateTime]::UtcNow.ToString("o")
  artifacts = @($artifacts)
  disclaimer = "仅供学习研究，不构成投资建议；使用者自行承担交易风险。"
}
$manifestPath = Join-Path $releaseRoot "release-manifest.json"
[IO.File]::WriteAllText(
  $manifestPath,
  (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
  [Text.UTF8Encoding]::new($false)
)

$manifest | ConvertTo-Json -Depth 6
