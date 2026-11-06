@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

rem 优先用项目自带的 .venv，其次是上级目录的 .venv，都没有就用系统 python
set "PY=%~dp0.venv\Scripts\python.exe"
if exist "%PY%" goto run

set "PY=%~dp0..\.venv\Scripts\python.exe"
if exist "%PY%" goto run

set "PY=python"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [x] 没有找到 Python。请先安装 Python 3.8 或更高版本，并勾选 "Add to PATH"。
  echo.
  pause
  exit /b 1
)

:run
echo 启动 AnnoStudio ... 浏览器会自动打开（关闭本窗口即停止服务）
echo.
"%PY%" -m annostudio %*
echo.
echo 服务已停止。
pause
