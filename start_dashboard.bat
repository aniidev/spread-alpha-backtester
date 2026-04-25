@echo off
echo ============================================
echo  Spread Alpha Dashboard
echo ============================================
echo.

REM Start the FastAPI backend in a new window
start "Spread Alpha API" cmd /k "cd /d %~dp0 && uvicorn api.main:app --reload --port 8000"

REM Give the backend a moment to start
timeout /t 2 /nobreak >nul

REM Start the Vite frontend dev server in a new window
start "Spread Alpha UI" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo Backend  →  http://localhost:8000
echo Frontend →  http://localhost:5173
echo.
echo Press any key to close this window (servers keep running).
pause >nul
