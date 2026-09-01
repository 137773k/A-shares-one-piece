[CmdletBinding()]
param(
  [string]$ReleaseDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "release"),
  [string]$OutputDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "release-validation-output"),
  [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$releaseRoot = [IO.Path]::GetFullPath($ReleaseDir)
$outputRoot = [IO.Path]::GetFullPath($OutputDir)
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = [string]$package.version
$productName = [string]$package.build.productName

function Resolve-ArtifactName {
  param([string]$Template)

  $resolved = $Template.Replace('${productName}', $productName)
  $resolved = $resolved.Replace('${version}', $version)
  $resolved = $resolved.Replace('${arch}', 'x64')
  $resolved = $resolved.Replace('${ext}', 'exe')
  if ($resolved -match '\$\{' -or [IO.Path]::GetFileName($resolved) -ne $resolved) {
    throw "invalid installer artifact template: $Template"
  }
  return $resolved
}

$setupName = Resolve-ArtifactName ([string]$package.build.nsis.artifactName)
$setupPath = Join-Path $releaseRoot $setupName
$reportPath = Join-Path $outputRoot "windows-installer-validation.json"
$tempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("a-share-installer-$version-" + [guid]::NewGuid().ToString("N"))))
$installRoot = Join-Path $testRoot "Install"
$userDataRoot = Join-Path $testRoot "UserData"
$runtimeTemp = Join-Path $testRoot "Temp"
$processIdsBeforeValidation = @(Get-Process | Select-Object -ExpandProperty Id)
$activeLaunchProcess = $null
$activeListenerProcessId = $null
$uninstallCompleted = $false
$failure = $null

New-Item -ItemType Directory -Force -Path $outputRoot, $userDataRoot, $runtimeTemp | Out-Null

$report = [ordered]@{
  schemaVersion = 1
  status = "running"
  productName = $productName
  version = $version
  sourceCommit = $null
  setupFile = Split-Path $setupPath -Leaf
  installRoot = $installRoot
  generatedAt = $null
  checks = [ordered]@{}
  runs = @()
  error = $null
}

function Get-ProductUninstallEntries {
  param([string]$Name)

  $entries = @()
  foreach ($root in @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
      $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if (-not $properties) { continue }
      $displayNameProperty = $properties.PSObject.Properties["DisplayName"]
      if (-not $displayNameProperty) { continue }
      $displayName = [string]$displayNameProperty.Value
      if ($displayName -like "$Name*") {
        $displayVersionProperty = $properties.PSObject.Properties["DisplayVersion"]
        $uninstallStringProperty = $properties.PSObject.Properties["UninstallString"]
        $entries += [pscustomobject]@{
          key = $key.PSPath
          displayName = $displayName
          displayVersion = if ($displayVersionProperty) { [string]$displayVersionProperty.Value } else { "" }
          uninstallString = if ($uninstallStringProperty) { [string]$uninstallStringProperty.Value } else { "" }
        }
      }
    }
  }
  return @($entries)
}

function Get-ProductShortcutPaths {
  param([string]$Name)

  $paths = @()
  foreach ($root in @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
  )) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    $paths += @(
      Get-ChildItem -LiteralPath $root -Filter "$Name.lnk" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    )
  }
  return @($paths | Sort-Object -Unique)
}

function Assert-RegularFile {
  param(
    [string]$Path,
    [string]$AllowedRoot
  )

  $fullPath = [IO.Path]::GetFullPath($Path)
  $rootPrefix = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd("\") + "\"
  if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "file is outside the allowed root: $fullPath"
  }
  $item = Get-Item -LiteralPath $fullPath -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "expected a regular file: $fullPath"
  }
  return $item
}

function Test-StableVersionMatch {
  param(
    [string]$Actual,
    [string]$Expected
  )

  try {
    $actualVersion = [Version]$Actual
    $expectedVersion = [Version]$Expected
  } catch {
    return $false
  }
  return (
    $actualVersion.Major -eq $expectedVersion.Major -and
    $actualVersion.Minor -eq $expectedVersion.Minor -and
    $actualVersion.Build -eq $expectedVersion.Build -and
    $actualVersion.Revision -in @(-1, 0)
  )
}

function Stop-ValidatedApplication {
  param(
    [Nullable[int]]$ListenerProcessId,
    [System.Diagnostics.Process]$LaunchProcess,
    [string]$AllowedInstallRoot
  )

  if ($null -ne $ListenerProcessId) {
    $listenerId = [int]$ListenerProcessId
    if (Get-Process -Id $listenerId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $listenerId -Force -ErrorAction SilentlyContinue
    }
  }
  if ($LaunchProcess -and (Get-Process -Id $LaunchProcess.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $LaunchProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2

  $rootPrefix = [IO.Path]::GetFullPath($AllowedInstallRoot).TrimEnd("\") + "\"
  $residual = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -notin $processIdsBeforeValidation -and
        $_.ExecutablePath -and
        [IO.Path]::GetFullPath([string]$_.ExecutablePath).StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
      }
  )
  foreach ($process in $residual) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-AndProbeApplication {
  param(
    [string]$Executable,
    [string]$AllowedInstallRoot,
    [string]$UserData,
    [string]$TemporaryDirectory,
    [int]$RunNumber
  )

  $before = @(Get-Process | Select-Object -ExpandProperty Id)
  $launch = Start-Process -FilePath $Executable -ArgumentList @(
    "--user-data-dir=$UserData",
    "--disable-gpu"
  ) -PassThru -WindowStyle Hidden -Environment @{
    TEMP = $TemporaryDirectory
    TMP = $TemporaryDirectory
    HOT_STOCKS_AUTO_REFRESH_START_DELAY_MS = "3600000"
    HOT_STOCKS_AUTO_REFRESH_CHECK_MS = "3600000"
  }

  $script:activeLaunchProcess = $launch
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $listener = $null
  $owner = $null
  $rootPrefix = [IO.Path]::GetFullPath($AllowedInstallRoot).TrimEnd("\") + "\"
  do {
    Start-Sleep -Milliseconds 500
    foreach ($candidate in @(
      Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object {
          $_.LocalPort -ge 5173 -and
          $_.LocalPort -le 5202 -and
          $before -notcontains $_.OwningProcess
        } |
        Sort-Object LocalPort
    )) {
      $candidateOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.OwningProcess)" -ErrorAction SilentlyContinue
      if (-not $candidateOwner -or -not $candidateOwner.ExecutablePath) { continue }
      $candidateExecutable = [IO.Path]::GetFullPath([string]$candidateOwner.ExecutablePath)
      if ($candidateExecutable.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        $listener = $candidate
        $owner = $candidateOwner
        break
      }
    }
    if ($listener) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not $listener -or -not $owner) {
    throw "installed application did not open a verified local listener within $StartupTimeoutSeconds seconds"
  }

  $script:activeListenerProcessId = [int]$listener.OwningProcess
  $baseUrl = "http://127.0.0.1:$($listener.LocalPort)"
  $homeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/" -TimeoutSec 15
  $cloud = Invoke-RestMethod -Uri "$baseUrl/api/cloud-current-sync/status" -TimeoutSec 15
  $hotStocks = Invoke-RestMethod -Uri "$baseUrl/api/hot-stocks/status" -TimeoutSec 15
  if ($homeResponse.StatusCode -ne 200 -or $homeResponse.Content -notmatch "<title>") {
    throw "installed application home page validation failed"
  }
  if ($cloud.ok -ne $true -or $cloud.sync.configured -ne $false -or $cloud.sync.status -ne "disabled") {
    throw "cloud current sync must be disabled by default"
  }
  if ($hotStocks.ok -ne $true) {
    throw "hot-stocks status endpoint failed"
  }

  $runtimeRoot = Join-Path $UserData "runtime"
  $historyRoot = Join-Path $runtimeRoot "data\history"
  $historyCount = if (Test-Path -LiteralPath $historyRoot) {
    @(Get-ChildItem -LiteralPath $historyRoot -Filter "*.json" -File -ErrorAction Stop).Count
  } else {
    0
  }
  if ($historyCount -ne 0) {
    throw "installer seeded $historyCount private history files"
  }

  $runResult = [ordered]@{
    runNumber = $RunNumber
    httpStatus = $homeResponse.StatusCode
    port = [int]$listener.LocalPort
    listenerProcessId = [int]$listener.OwningProcess
    listenerExecutable = [string]$owner.ExecutablePath
    cloudStatus = [string]$cloud.sync.status
    cloudConfigured = [bool]$cloud.sync.configured
    historyJsonCount = $historyCount
    runtimeCreated = Test-Path -LiteralPath $runtimeRoot
  }

  Stop-ValidatedApplication -ListenerProcessId $script:activeListenerProcessId -LaunchProcess $script:activeLaunchProcess -AllowedInstallRoot $AllowedInstallRoot
  $script:activeListenerProcessId = $null
  $script:activeLaunchProcess = $null

  $startupLog = Join-Path $TemporaryDirectory "a-share-desktop-startup.log"
  if (Test-Path -LiteralPath $startupLog -PathType Leaf) {
    Copy-Item -LiteralPath $startupLog -Destination (Join-Path $outputRoot "desktop-startup-run-$RunNumber.log") -Force
  }
  return $runResult
}

try {
  if ($env:OS -ne "Windows_NT") {
    throw "Windows installer validation must run on Windows"
  }
  if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "package version is not a stable semantic version"
  }
  $setupItem = Assert-RegularFile -Path $setupPath -AllowedRoot $releaseRoot
  if (
    -not (Test-StableVersionMatch -Actual $setupItem.VersionInfo.ProductVersion -Expected $version) -or
    -not (Test-StableVersionMatch -Actual $setupItem.VersionInfo.FileVersion -Expected $version)
  ) {
    throw "setup executable version metadata does not match package.json"
  }
  $report.sourceCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $report.sourceCommit -notmatch '^[a-f0-9]{40}$') {
    throw "unable to resolve source commit"
  }
  $manifestPath = Join-Path $releaseRoot "release-manifest.json"
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $manifestSetupRows = @($manifest.artifacts | Where-Object { $_.name -eq (Split-Path $setupPath -Leaf) })
  $setupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupPath).Hash.ToLowerInvariant()
  if (
    [string]$manifest.version -ne $version -or
    [string]$manifest.sourceCommit -ne $report.sourceCommit -or
    $manifestSetupRows.Count -ne 1 -or
    [string]$manifestSetupRows[0].sha256 -ne $setupHash
  ) {
    throw "release manifest does not match the installer and source commit"
  }
  $report.checks.releaseManifestMatches = $true
  $report.checks.setupSha256 = $setupHash
  $report.checks.authenticodeStatus = [string]$manifestSetupRows[0].authenticodeStatus

  $beforeEntries = @(Get-ProductUninstallEntries -Name $productName)
  $beforeShortcuts = @(Get-ProductShortcutPaths -Name $productName)
  if ($beforeEntries.Count -ne 0 -or $beforeShortcuts.Count -ne 0) {
    throw "clean Windows runner required: an existing installation or shortcut was found"
  }
  $report.checks.cleanMachinePrecondition = $true

  $install = Start-Process -FilePath $setupPath -ArgumentList @(
    "/S",
    "/D=$installRoot"
  ) -PassThru -Wait -WindowStyle Hidden
  if ($install.ExitCode -ne 0) {
    throw "silent installer exited with code $($install.ExitCode)"
  }

  $installedExecutable = Join-Path $installRoot "$productName.exe"
  $installedItem = Assert-RegularFile -Path $installedExecutable -AllowedRoot $installRoot
  if (-not (Test-StableVersionMatch -Actual $installedItem.VersionInfo.ProductVersion -Expected $version)) {
    throw "installed executable version does not match package.json"
  }
  $report.checks.silentInstall = $true
  $report.checks.installedVersion = $installedItem.VersionInfo.ProductVersion

  $installedEntries = @(Get-ProductUninstallEntries -Name $productName)
  if ($installedEntries.Count -ne 1 -or $installedEntries[0].displayVersion -ne $version) {
    throw "installer did not create exactly one matching uninstall entry"
  }
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$productName.lnk"
  $startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$productName.lnk"
  if (-not (Test-Path -LiteralPath $desktopShortcut -PathType Leaf)) {
    throw "desktop shortcut was not created"
  }
  if (-not (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf)) {
    throw "start menu shortcut was not created"
  }
  $report.checks.uninstallEntryCreated = $true
  $report.checks.desktopShortcutCreated = $true
  $report.checks.startMenuShortcutCreated = $true

  $firstRun = Start-AndProbeApplication -Executable $installedExecutable -AllowedInstallRoot $installRoot -UserData $userDataRoot -TemporaryDirectory $runtimeTemp -RunNumber 1
  $report.runs += $firstRun
  $markerPath = Join-Path $userDataRoot "runtime\ci-persistence-marker.txt"
  [IO.File]::WriteAllText($markerPath, "installer-validation", [Text.UTF8Encoding]::new($false))

  $secondRun = Start-AndProbeApplication -Executable $installedExecutable -AllowedInstallRoot $installRoot -UserData $userDataRoot -TemporaryDirectory $runtimeTemp -RunNumber 2
  $report.runs += $secondRun
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "runtime data did not persist across application restart"
  }
  $report.checks.firstLaunch = $true
  $report.checks.secondLaunch = $true
  $report.checks.runtimePersistsAcrossRestart = $true

  $uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "Uninstall*.exe" -File | Select-Object -First 1
  if (-not $uninstaller) {
    throw "uninstaller executable was not created"
  }
  $uninstallerItem = Assert-RegularFile -Path $uninstaller.FullName -AllowedRoot $installRoot
  $uninstall = Start-Process -FilePath $uninstallerItem.FullName -ArgumentList @(
    "/S",
    "/currentuser"
  ) -PassThru -Wait -WindowStyle Hidden
  if ($uninstall.ExitCode -ne 0) {
    throw "silent uninstaller exited with code $($uninstall.ExitCode)"
  }

  $uninstallDeadline = (Get-Date).AddSeconds(45)
  while ((Test-Path -LiteralPath $installRoot) -and (Get-Date) -lt $uninstallDeadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "installation directory remained after silent uninstall"
  }
  if (@(Get-ProductUninstallEntries -Name $productName).Count -ne 0) {
    throw "uninstall registry entry remained after silent uninstall"
  }
  if (@(Get-ProductShortcutPaths -Name $productName).Count -ne 0) {
    throw "product shortcut remained after silent uninstall"
  }
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "uninstall unexpectedly deleted retained user runtime data"
  }
  $uninstallCompleted = $true
  $report.checks.silentUninstall = $true
  $report.checks.installDirectoryRemoved = $true
  $report.checks.uninstallEntryRemoved = $true
  $report.checks.shortcutsRemoved = $true
  $report.checks.userRuntimeRetained = $true
  $report.status = "passed"
} catch {
  $failure = $_
  $report.status = "failed"
  $report.error = $_.Exception.Message
} finally {
  try {
    Stop-ValidatedApplication -ListenerProcessId $activeListenerProcessId -LaunchProcess $activeLaunchProcess -AllowedInstallRoot $installRoot
  } catch {
    if (-not $failure) {
      $failure = $_
      $report.status = "failed"
      $report.error = "cleanup failed: $($_.Exception.Message)"
    } else {
      $report.error = "$($report.error); cleanup also failed: $($_.Exception.Message)"
    }
  }

  if (-not $uninstallCompleted -and (Test-Path -LiteralPath $installRoot -PathType Container)) {
    $cleanupUninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "Uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cleanupUninstaller) {
      try {
        $cleanupItem = Assert-RegularFile -Path $cleanupUninstaller.FullName -AllowedRoot $installRoot
        Start-Process -FilePath $cleanupItem.FullName -ArgumentList @("/S", "/currentuser") -Wait -WindowStyle Hidden | Out-Null
      } catch {}
    }
  }

  $report.generatedAt = [DateTime]::UtcNow.ToString("o")
  [IO.File]::WriteAllText(
    $reportPath,
    (($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false)
  )
}

if ($failure) {
  throw $failure.Exception
}

$report | ConvertTo-Json -Depth 8
