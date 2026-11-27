@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
call start.cmd --check
if errorlevel 1 (
  pause
  exit /b 1
)
for /f "usebackq delims=" %%N in (".local\node-path.txt") do set "PAPER_SCREEN_STOP_NODE=%%N"
"%PAPER_SCREEN_STOP_NODE%" scripts/windows-launcher.mjs stop
set "PAPER_SCREEN_EXIT=%ERRORLEVEL%"
if not "%PAPER_SCREEN_EXIT%"=="0" pause
exit /b %PAPER_SCREEN_EXIT%
