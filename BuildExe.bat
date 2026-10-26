@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo Не найден Node.js: https://nodejs.org & pause & exit /b 1 )
if not exist node_modules\electron (
  call npm ci
  if errorlevel 1 ( echo Ошибка установки зависимостей. & pause & exit /b 1 )
)
call npm run dist:portable
if errorlevel 1 ( echo Ошибка сборки EXE. & pause & exit /b 1 )
echo.
echo Готово. Portable EXE лежит в папке release и запускается без установки.
echo Настройки и библиотека сохраняются в PixelPlayer-data рядом с EXE.
pause
