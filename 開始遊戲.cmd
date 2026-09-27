@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 遊戲已經在執行：直接開瀏覽器。
curl -s -o nul --max-time 2 http://localhost:5188/ && (
  start "" "http://localhost:5188/"
  exit /b 0
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，請先到 https://nodejs.org 安裝 LTS 版本後再執行。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 第一次執行，正在安裝套件…
  call npm install
)
echo 遊戲啟動中，瀏覽器會自動開啟 http://localhost:5188
echo 關閉這個視窗就會停止遊戲。
call npx vite --open
echo.
echo 遊戲已停止。若上方有錯誤訊息，請截圖回報。
pause
