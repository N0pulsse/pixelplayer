@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите LTS-версию с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo Первый запуск: устанавливаю зависимости, это займёт пару минут...
  call npm install
  if errorlevel 1 ( echo Не удалось установить зависимости. & pause & exit /b 1 )
)
call npm start
