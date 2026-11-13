@echo off
rem Double-click to open Colour Palette in your browser. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b)
rem First run only: the small add-on that opens pages in Edge or Chrome to measure their colours.
if not exist "node_modules\playwright-core" (
  echo Setting up for the first time...
  call npm install --no-fund --no-audit >nul 2>nul || echo Couldn't install the add-on, so it can't measure pages yet.
)
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:4326"
node server.mjs
pause
