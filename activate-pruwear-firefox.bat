@echo off
chcp 65001 >nul 2>nul
setlocal
title Pruwear - Firefox Extension Activator
echo.
echo  ==============================================================
echo      PRUWEAR - REALTIME AI VIRTUAL TRY-ON
echo      Firefox Extension Quick Loader
echo  ==============================================================
echo.
set "ROOT_DIR=%~dp0"
set "EXT_DIR=%ROOT_DIR%pruwear-firefox-extension"
if not exist "%EXT_DIR%\manifest.json" set "EXT_DIR=%ROOT_DIR%build\firefox-mv3-prod"
set "PORTAL_URL=%ROOT_DIR%index.html"
set "FIREFOX_EXE="
if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" set "FIREFOX_EXE=%ProgramFiles%\Mozilla Firefox\firefox.exe"
if "%FIREFOX_EXE%"=="" if exist "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" set "FIREFOX_EXE=%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe"
if "%FIREFOX_EXE%"=="" if exist "%LocalAppData%\Mozilla Firefox\firefox.exe" set "FIREFOX_EXE=%LocalAppData%\Mozilla Firefox\firefox.exe"

echo  [*] Extension path: "%EXT_DIR%"
echo.
echo  Instructions:
echo   1. In the opened Firefox tab, click "Load Temporary Add-on..."
echo   2. Select "%EXT_DIR%\manifest.json"
echo      (Or choose pruwear-firefox.xpi / Pruwear-Firefox-Virtual-Try-On.zip)
echo.
if "%FIREFOX_EXE%"=="" (
    start firefox "about:debugging#/runtime/this-firefox"
) else (
    start "" "%FIREFOX_EXE%" "about:debugging#/runtime/this-firefox"
)
pause
