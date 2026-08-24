@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 商品视觉工作台启动器

set "PORT=3000"
set "URL=http://127.0.0.1:%PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js。
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 pnpm，请先安装 pnpm。
  pause
  exit /b 1
)

if not exist "node_modules\.bin\next.cmd" (
  echo 首次运行，正在安装依赖...
  call pnpm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

curl.exe -fsS "%URL%" >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  exit /b 0
)

echo 正在启动商品视觉工作台...
start "商品视觉工作台服务器" cmd /k "cd /d ""%~dp0"" && pnpm exec next dev -p %PORT%"

for /L %%I in (1,1,60) do (
  curl.exe -fsS "%URL%" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo [错误] 服务在 60 秒内未能通过 %URL% 访问。请查看“商品视觉工作台服务器”窗口；若端口被占用，Next.js 会在该窗口显示端口冲突信息。
pause
exit /b 1

:ready
start "" "%URL%"
exit /b 0
