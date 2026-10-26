@echo off
rem 启动合并订阅服务（窗口最小化跑着即可，关掉窗口就停）
cd /d "%~dp0"
if not exist "%~dp0node_modules" (
  echo 首次运行，先安装依赖...
  call npm install --registry=https://registry.npmmirror.com
)
node server.js
pause
