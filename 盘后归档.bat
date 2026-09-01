@echo off
chcp 65001 >nul
echo ========================================
echo 盘后数据归档工具
echo ========================================
echo.
echo 正在保存今日数据快照...
echo.

node archiver.js

echo.
echo ========================================
echo 归档完成！
echo 数据已保存到 data/history/ 目录
echo ========================================
echo.
pause
