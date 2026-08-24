@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 商品视觉工作台

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

echo 正在启动商品视觉工作台...
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000"
call pnpm exec next dev -p 3000

if errorlevel 1 (
  echo.
  echo [错误] 工作台启动失败，请查看上方信息。
  pause
)
