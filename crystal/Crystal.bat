@echo off
setlocal
cd /d "%~dp0"

rem ================================================================
rem  Crystal desktop GUI launcher (no CLI menu / server / browser)
rem  Prefer pyw -3, fallback pythonw; error dialog if neither exists.
rem ================================================================

set "_PYW="

where pyw >nul 2>&1
if not errorlevel 1 (
    pyw -3 -c "" >nul 2>&1
    if not errorlevel 1 set "_PYW=pyw -3"
)

if not defined _PYW (
    where pythonw >nul 2>&1
    if not errorlevel 1 set "_PYW=pythonw"
)

if not defined _PYW goto :nopython

start "" %_PYW% "%~dp0app.py"
exit /b 0

:nopython
mshta "javascript:var sh=new ActiveXObject('WScript.Shell');sh.Popup('Crystal 启动失败：未找到 Python（pyw/pythonw）。请先安装 Python 3。',0,'Crystal',16);close()"
exit /b 1
