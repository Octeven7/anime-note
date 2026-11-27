@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "PAPER_SCREEN_NODE_FOUND="
set "PAPER_SCREEN_NODE_REJECTED="

rem Explicit override, current PATH, then the last validated local location.
if defined PAPER_SCREEN_NODE call :try_node "%PAPER_SCREEN_NODE%"
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do call :try_node "%%N"
if exist ".local\node-path.txt" (
  for /f "usebackq delims=" %%N in (".local\node-path.txt") do call :try_node "%%N"
)

rem Explorer may still have an old PATH. Read current registry PATH without changing it.
if not defined PAPER_SCREEN_NODE_FOUND (
  for /f "delims=" %%N in ('powershell.exe -NoLogo -NoProfile -Command "$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); (Get-Command node.exe -ErrorAction SilentlyContinue).Source" 2^>nul') do call :try_node "%%N"
)

rem Standard installers, portable managers, and common per-user locations.
if defined NODE_HOME call :try_node "%NODE_HOME%\node.exe"
if defined NVM_SYMLINK call :try_node "%NVM_SYMLINK%\node.exe"
if defined VOLTA_HOME call :try_node "%VOLTA_HOME%\bin\node.exe"
if defined FNM_MULTISHELL_PATH call :try_node "%FNM_MULTISHELL_PATH%\node.exe"
call :try_node "%ProgramFiles%\nodejs\node.exe"
call :try_node "%ProgramFiles(x86)%\nodejs\node.exe"
call :try_node "%LOCALAPPDATA%\Programs\nodejs\node.exe"
call :try_node "%LOCALAPPDATA%\Microsoft\WinGet\Links\node.exe"
call :try_node "%USERPROFILE%\.volta\bin\node.exe"
call :try_node "%USERPROFILE%\scoop\apps\nodejs\current\node.exe"
call :try_node "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe"
call :try_node "%USERPROFILE%\.nvs\default\node.exe"
if defined NVM_HOME for /d %%V in ("%NVM_HOME%\v*") do call :try_node "%%~fV\node.exe"
for /d %%V in ("%APPDATA%\nvm\v*") do call :try_node "%%~fV\node.exe"
if defined FNM_DIR for /d %%V in ("%FNM_DIR%\node-versions\v*") do call :try_node "%%~fV\installation\node.exe"
for /d %%V in ("%APPDATA%\fnm\node-versions\v*") do call :try_node "%%~fV\installation\node.exe"
for /d %%V in ("%LOCALAPPDATA%\fnm\node-versions\v*") do call :try_node "%%~fV\installation\node.exe"

rem Query the package registry: enumerating protected WindowsApps folders is unreliable.
if not defined PAPER_SCREEN_NODE_FOUND (
  for /f "delims=" %%N in ('powershell.exe -NoLogo -NoProfile -Command "Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | ForEach-Object { Join-Path $_.InstallLocation 'dependencies\node\bin\node.exe' }" 2^>nul') do call :try_node "%%N"
)

if not defined PAPER_SCREEN_NODE_FOUND (
  echo Could not find a working Node.js 24+ with built-in SQLite.
  if defined PAPER_SCREEN_NODE_REJECTED echo Found but incompatible or not executable: "%PAPER_SCREEN_NODE_REJECTED%"
  echo Set PAPER_SCREEN_NODE to the full path of your node.exe, then try again.
  echo Diagnostic command: start.cmd --check
  if /i not "%~1"=="--check" pause
  exit /b 1
)

if not exist ".local" mkdir ".local"
>".local\node-path.txt" echo %PAPER_SCREEN_NODE_FOUND%
echo Using Node.js: "%PAPER_SCREEN_NODE_FOUND%"
"%PAPER_SCREEN_NODE_FOUND%" --version
if /i "%~1"=="--check" exit /b 0

if not exist "node_modules\vite" (
  echo Dependencies are missing. Run pnpm install first.
  pause
  exit /b 1
)
"%PAPER_SCREEN_NODE_FOUND%" scripts/windows-launcher.mjs start
set "PAPER_SCREEN_EXIT=%ERRORLEVEL%"
if not "%PAPER_SCREEN_EXIT%"=="0" pause
exit /b %PAPER_SCREEN_EXIT%

:try_node
if defined PAPER_SCREEN_NODE_FOUND exit /b 0
if not exist "%~1" exit /b 0
"%~1" -e "try { if (Number(process.versions.node.split('.')[0]) < 24) process.exit(2); require('node:sqlite'); } catch (e) { process.exit(2); }" >nul 2>nul
if errorlevel 1 (
  set "PAPER_SCREEN_NODE_REJECTED=%~1"
  exit /b 0
)
set "PAPER_SCREEN_NODE_FOUND=%~f1"
exit /b 0
