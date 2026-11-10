@echo off
rem Double-click to open Colour Palette in your browser. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b)
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:4322"
node server.mjs
pause
