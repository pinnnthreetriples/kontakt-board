@echo off
title Kontakt Board
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve-dist.ps1"
if errorlevel 1 pause
