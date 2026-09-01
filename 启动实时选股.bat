@echo off
chcp 65001 >nul
cd /d "%~dp0"
title A股短线模型 - 实时选股本地服务

echo ==========================================
echo    A股短线模型  实时选股本地服务
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js
  echo 请先到 https://nodejs.org 下载安装 LTS 版本，然后重新双击本文件。
  echo.
  pause
  exit /b 1
)

rem 结束占用 5173 端口的旧服务，避免端口冲突
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>nul

echo 正在启动服务，请稍候...
echo 就绪后浏览器会自动打开  http://localhost:5173
echo 想停止服务，直接关闭本窗口即可。
echo.

rem 延迟几秒后自动打开浏览器，避免打开时服务还没起好
start "" /min powershell -NoProfile -Command "Start-Sleep 4; Start-Process 'http://localhost:5173'"

:restart_server
node server.js
echo [WARN] Server exited. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto restart_server

echo.
echo 服务已停止。若上方出现红色报错，请把本窗口截图发给助手。
pause
