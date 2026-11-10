@echo off
rem Double-click to open Colour Palette in your browser. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b)
rem First run only: the small add-on that measures how much of the page each colour covers (uses Edge or Chrome).
if not exist "node_modules\playwright-core" (
  echo Setting up for the first time...
  call npm install --no-fund --no-audit >nul 2>nul || echo Couldn't install the add-on, so colours will be ranked by how often the code uses them.
)
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:4325"
node server.mjs
pause
