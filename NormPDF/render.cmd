@echo off
setlocal
if "%~1"=="" (
  echo Drag an HTML file onto this command or pass its path as the first argument.
  pause
  exit /b 1
)
set "OUTPUT=%~dpn1.pdf"
"%~dp0NormPDF.exe" --render "%~1" "%OUTPUT%" conversation
if errorlevel 1 pause
