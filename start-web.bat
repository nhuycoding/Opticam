@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto :error

if /i "%~1"=="--backend" goto :backend
if /i "%~1"=="--frontend" goto :frontend

title OptiCam - Start Web
echo Checking Node.js and Python...
where node.exe >nul 2>&1
if errorlevel 1 (
    echo Please install Node.js 22.12 or newer, then run this file again.
    goto :error
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if errorlevel 1 (
    echo Please update Node.js to version 22.12 or newer.
    goto :error
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Please reinstall Node.js with npm enabled.
    goto :error
)

if exist "backend\.venv\Scripts\python.exe" goto :check_python
set "PYTHON_COMMAND=py -3"
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto :create_venv
set "PYTHON_COMMAND=python"
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto :create_venv
echo Please install Python 3.10 or newer, then run this file again.
goto :error

:create_venv
echo Creating the Python environment...
%PYTHON_COMMAND% -m venv "backend\.venv"
if errorlevel 1 goto :error

:check_python
"backend\.venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 (
    echo The environment in backend\.venv requires Python 3.10 or newer.
    echo Remove that environment folder and run this file again.
    goto :error
)
echo Preparing backend dependencies...
"backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 goto :error

if exist "frontend\node_modules\.bin\vite.cmd" goto :launch
echo Installing frontend dependencies. This may take a few minutes...
cd /d "%~dp0frontend"
call npm.cmd ci
if errorlevel 1 goto :error
cd /d "%~dp0"

:launch
echo Starting OptiCam at http://localhost:3000 ...
echo Two server windows will open. Close both windows to stop the web app.
start "OptiCam - Backend" "%ComSpec%" /k ""%~f0" --backend"
start "OptiCam - Frontend" "%ComSpec%" /k ""%~f0" --frontend"
exit /b 0

:backend
title OptiCam - Backend
cd /d "%~dp0backend"
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m uvicorn main:app --reload --port 8000
if errorlevel 1 goto :error
exit /b 0

:frontend
title OptiCam - Frontend
cd /d "%~dp0frontend"
if errorlevel 1 goto :error
call npm.cmd run dev -- --port 3000 --strictPort --open
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo Could not start OptiCam. Check the error message above.
pause
exit /b 1
