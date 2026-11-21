@echo off
chcp 65001 >nul 2>nul
setlocal
title Pruwear - 1-Click Chrome Activator
echo.
echo  ==============================================================
echo      PRUWEAR - REALTIME AI VIRTUAL TRY-ON
echo      1-Click Chrome Extension Direct Activator
echo  ==============================================================
echo.
set "ROOT_DIR=%~dp0"
set "EXT_DIR=%ROOT_DIR%build\chrome-mv3-prod"
set "PORTAL_URL=%ROOT_DIR%index.html"
set "CHROME_EXE="
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" (
    echo  [*] Launching Chrome with loaded extension...
    start chrome --load-extension="%EXT_DIR%" "%PORTAL_URL%"
) else (
    echo  [+] Chrome located at: "%CHROME_EXE%"
    echo  [+] Launching Chrome with Pruwear extension loaded...
    start "" "%CHROME_EXE%" --load-extension="%EXT_DIR%" "%PORTAL_URL%"
)
echo.
echo  [OK] Success! Pruwear is now active in Chrome.
echo  [*] Look for the floating Try-On launcher on the right.
echo.
ping -n 3 127.0.0.1 >nul
