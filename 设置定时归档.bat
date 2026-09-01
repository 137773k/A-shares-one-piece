@echo off
chcp 65001 >nul
echo ========================================
echo 设置盘后自动归档任务
echo ========================================
echo.
echo 即将创建Windows定时任务：
echo   任务名：A股盘后数据归档
echo   运行时间：每个工作日 15:10
echo   运行目录：%~dp0
echo.
pause

schtasks /create /tn "A股盘后数据归档" /tr "%~dp0盘后归档.bat" /sc weekly /d MON,TUE,WED,THU,FRI /st 15:10 /f

echo.
echo ========================================
echo 定时任务已创建！
echo.
echo 查看任务：
echo   打开"任务计划程序"，找到"A股盘后数据归档"
echo.
echo 测试任务：
echo   右键任务 → 运行
echo.
echo 删除任务：
echo   schtasks /delete /tn "A股盘后数据归档" /f
echo ========================================
pause
