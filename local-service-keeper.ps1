[CmdletBinding()]
param(
  [string]$NodePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Port = 5173
$ProjectRoot = $PSScriptRoot
$ServerScript = Join-Path $ProjectRoot "server.js"
$OutputRoot = Join-Path $ProjectRoot "output"
$KeeperLog = Join-Path $OutputRoot "local-service-keeper.log"
$ServerOutLog = Join-Path $OutputRoot "local-service-server.out.log"
$ServerErrLog = Join-Path $OutputRoot "local-service-server.err.log"
$HealthUrl = "http://127.0.0.1:$Port/"

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

function Rotate-LogIfNeeded {
  param([string]$Path)

  if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt 5MB) {
    $archive = "$Path.1"
    Move-Item -LiteralPath $Path -Destination $archive -Force
  }
}

function Write-KeeperLog {
  param([string]$Message)

  Rotate-LogIfNeeded -Path $KeeperLog
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $KeeperLog -Value $line -Encoding UTF8
}

function Test-ServerHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-LocalPortListening {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(750)) {
      return $false
    }
    $client.EndConnect($pending)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-Path -LiteralPath $ServerScript)) {
  Write-KeeperLog "server.js is missing; keeper exits."
  exit 2
}

$NodeExecutable = $NodePath
if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  try {
    $NodeExecutable = (Get-Command node -ErrorAction Stop).Source
  } catch {
    Write-KeeperLog "Node.js is not available; keeper exits."
    exit 3
  }
}

if (-not (Test-Path -LiteralPath $NodeExecutable)) {
  Write-KeeperLog "Node.js path is invalid: $NodeExecutable"
  exit 4
}

$createdNew = $false
$mutexName = "Local\A-Share-Local-Service-$Port-Keeper"
$keeperMutex = [System.Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  Write-KeeperLog "another keeper instance already owns $mutexName; duplicate exits."
  $keeperMutex.Dispose()
  exit 0
}

Write-KeeperLog "keeper started; project=$ProjectRoot; node=$NodeExecutable; port=$Port"

try {
  while ($true) {
    if (Test-ServerHealthy) {
      Start-Sleep -Seconds 10
      continue
    }

    if (Test-LocalPortListening) {
      Write-KeeperLog "port $Port is occupied but the project health check failed; no process was killed."
      Start-Sleep -Seconds 15
      continue
    }

    Rotate-LogIfNeeded -Path $ServerOutLog
    Rotate-LogIfNeeded -Path $ServerErrLog
    Write-KeeperLog "starting server.js"

    $exitCode = $null
    try {
      $serverArgument = '"{0}"' -f $ServerScript.Replace('"', '\"')
      $serverProcess = Start-Process `
        -FilePath $NodeExecutable `
        -ArgumentList $serverArgument `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $ServerOutLog `
        -RedirectStandardError $ServerErrLog `
        -Wait `
        -PassThru
      $exitCode = $serverProcess.ExitCode
    } catch {
      Write-KeeperLog "server launch error: $($_.Exception.Message)"
    }

    Write-KeeperLog "server exited with code=$exitCode; restarting in 3 seconds."
    Start-Sleep -Seconds 3
  }
} finally {
  try {
    $keeperMutex.ReleaseMutex()
  } catch {
    # The OS also releases the mutex if this process is forcefully terminated.
  }
  $keeperMutex.Dispose()
}
