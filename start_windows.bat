@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 run.py
) else (
  python run.py
)
if errorlevel 1 (
  echo.
  echo FaceScope did not start. Install Python 3.10 or later and enable Add Python to PATH.
  echo You can also try: python run.py --port 8766
)
pause
