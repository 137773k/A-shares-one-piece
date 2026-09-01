[CmdletBinding()]
param(
  [string]$TaskName = "A-Share-Local-Service-5173"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$KeeperPath = Join-Path $ProjectRoot "local-service-keeper.ps1"
if (-not (Test-Path -LiteralPath $KeeperPath)) {
  throw "Keeper script is missing: $KeeperPath"
}

$NodeExecutable = (Get-Command node -ErrorAction Stop).Source
$PowerShellExecutable = (Get-Command powershell.exe -ErrorAction Stop).Source
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$ActionArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NodePath "{1}"' -f $KeeperPath, $NodeExecutable
$action = New-ScheduledTaskAction `
  -Execute $PowerShellExecutable `
  -Argument $ActionArguments `
  -WorkingDirectory $ProjectRoot

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$logonTrigger.Delay = "PT10S"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -StartWhenAvailable `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

$principal = New-ScheduledTaskPrincipal `
  -UserId $CurrentUser `
  -LogonType Interactive `
  -RunLevel Limited

$task = New-ScheduledTask `
  -Action $action `
  -Trigger $logonTrigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Keeps the local A-share model service available on port 5173 after Windows logon."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$registered = Get-ScheduledTask -TaskName $TaskName
[pscustomobject]@{
  TaskName = $registered.TaskName
  State = $registered.State
  KeeperPath = $KeeperPath
  NodePath = $NodeExecutable
  Trigger = "AtLogOn+10s"
}
