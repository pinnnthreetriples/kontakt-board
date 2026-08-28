@echo off
rem Кодовая страница переключается до первой русской строки: без этого cmd
rem читает файл как ANSI и в окне вместо текста получается каша.
chcp 65001 >nul
setlocal
title Kontakt Board - подготовка к работе
cd /d "%~dp0"

echo Готовлю программу к работе. Это делается один раз и занимает пару минут.
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo ОШИБКА: не найден Node.js, без него программу не собрать.
    echo Установите его командой: winget install -e --id OpenJS.NodeJS.LTS
    echo Затем закройте это окно, откройте новое и запустите файл заново.
    pause
    exit /b 1
)

echo [1 из 2] Ставлю зависимости, нужен интернет.
call npm ci
if errorlevel 1 (
    echo.
    echo ОШИБКА: не удалось поставить зависимости. Проверьте интернет и повторите.
    pause
    exit /b 1
)

echo.
echo [2 из 2] Собираю приложение.
call npm run build
if errorlevel 1 (
    echo.
    echo ОШИБКА: сборка не удалась, текст ошибки выше.
    pause
    exit /b 1
)

echo.
echo Готово. Дальше программа запускается файлом START_WINDOWS.cmd.
echo Открываю её в первый раз. Мост к MAX при первом запуске ещё пару минут
echo ставит своё окружение, дождитесь строки "Мост слушает" в его окне.
echo.
call "%~dp0START_WINDOWS.cmd"
