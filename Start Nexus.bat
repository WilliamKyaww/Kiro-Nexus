@echo off
rem One-click start for the Nexus web app on Windows.
rem   - checks for a supported Node.js (24.14 or newer in the 24 line, or 26 and later);
rem   - installs the pinned dependencies the first time, and again when package-lock.json changes;
rem   - builds, starts the local service and opens your browser (npm start).
rem Your notes stay in the workspace folder you choose. Extra arguments go to the launcher,
rem for example:  "Start Nexus.bat" --workspace "C:\path\to\folder"
rem Stop Nexus by pressing Ctrl+C in this window, or by closing it.
setlocal
title Nexus
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Nexus needs Node.js 24.14 or newer. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===24&&b>=14)||a>=26?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -p "process.versions.node"') do echo Node.js %%v is installed, but Nexus needs 24.14 or newer in the 24 line, or 26 and later.
  pause
  exit /b 1
)

rem Install when there is no installation yet, or when the lockfile is newer than the last install.
node -e "const fs=require('fs');try{process.exit(fs.statSync('node_modules/.package-lock.json').mtimeMs>=fs.statSync('package-lock.json').mtimeMs?0:1)}catch{process.exit(1)}"
if errorlevel 1 (
  echo Installing the dependencies. The first time this takes a few minutes.
  call npm ci
  if errorlevel 1 (
    echo The installation failed. See the messages above.
    pause
    exit /b 1
  )
)

call npm start -- %*
if errorlevel 1 (
  echo.
  echo Nexus stopped with an error. See the messages above.
  pause
)
endlocal
