@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0NormPDF\register-chrome.ps1" %*
if errorlevel 1 pause
