@echo off
setlocal
cd /d "%~dp0"

rem ================================================================
rem  Crystal desktop packaging (developer build entry)
rem  PyInstaller --windowed --onedir --name Crystal
rem  templates/ stays an external sibling folder next to Crystal.exe.
rem ================================================================

set "_PY="
where py >nul 2>&1
if not errorlevel 1 (
    py -3 -c "" >nul 2>&1
    if not errorlevel 1 set "_PY=py -3"
)
if not defined _PY (
    where python >nul 2>&1
    if not errorlevel 1 set "_PY=python"
)
if not defined _PY (
    echo [ERROR] Python not found.
    exit /b 1
)

rem PyInstaller is a developer build dependency only (not in requirements.txt)
%_PY% -c "import PyInstaller" >nul 2>&1
if errorlevel 1 (
    echo Installing PyInstaller ...
    %_PY% -m pip install pyinstaller
    if errorlevel 1 (
        echo [ERROR] Failed to install PyInstaller.
        exit /b 1
    )
)

%_PY% -m PyInstaller --noconfirm --clean --windowed --onedir --name Crystal ^
    --collect-submodules PIL ^
    --hidden-import requests ^
    app.py
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    exit /b 1
)

rem External, user-editable background library next to Crystal.exe
if not exist "dist\Crystal\templates" mkdir "dist\Crystal\templates"
xcopy /E /Y /I "templates" "dist\Crystal\templates" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy templates.
    exit /b 1
)

echo.
echo [OK] Built dist\Crystal\Crystal.exe with external templates\ folder.
exit /b 0
