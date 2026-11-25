@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
call start.cmd --check
if errorlevel 1 (
  pause
  exit /b 1
)
set "POSTER_ADDRESS_NODE="
for /f "usebackq delims=" %%N in (".local\node-path.txt") do set "POSTER_ADDRESS_NODE=%%N"
set "POSTER_ADDRESS_ACTION=--start"
if /i "%~1"=="status" set "POSTER_ADDRESS_ACTION=--status"
if /i "%~1"=="stop" set "POSTER_ADDRESS_ACTION=--stop"
"%POSTER_ADDRESS_NODE%" scripts/poster-addresses.mjs %POSTER_ADDRESS_ACTION%
if /i "%POSTER_ADDRESS_ACTION%"=="--start" start "" /b powershell.exe -NoLogo -NoProfile -STA -WindowStyle Hidden -File "%~dp0scripts\poster-address-progress.ps1"
echo.
echo Start: double-click poster-addresses.cmd
echo Status: poster-addresses.cmd status
echo Stop: poster-addresses.cmd stop
echo The worker runs independently. This window can be closed.
pause
