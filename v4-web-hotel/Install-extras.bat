@echo off
rem Double-click once to turn on "Read the page as visitors see it". It uses Edge or Chrome, already on this computer.
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b)
echo Installing the extra part (playwright-core)...
call npm install --no-fund --no-audit
if errorlevel 1 (echo Something went wrong. Check your internet connection and try again.) else (echo Done. Start Colour Palette again with Start.bat.)
pause
