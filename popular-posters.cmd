@echo off
setlocal
cd /d "%~dp0"
call start.cmd --check
if errorlevel 1 exit /b 1
for /f "usebackq delims=" %%N in (".local\node-path.txt") do set "POPULAR_POSTER_NODE=%%N"
call popular-posters-status.cmd
"%POPULAR_POSTER_NODE%" --env-file-if-exists=.env scripts/warm-popular-posters.mjs
if errorlevel 1 pause
