@echo off
rem Makes this PC trust software signed by "Iqbal Labs" (Bondhu Fund), so Windows shows Iqbal Labs as the publisher.
rem Run once per PC. It asks for administrator permission. Keep IqbalLabs-CodeSigning.cer in the same folder.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
if not exist "%~dp0IqbalLabs-CodeSigning.cer" (
  echo IqbalLabs-CodeSigning.cer was not found next to this file.
  pause
  exit /b 1
)
certutil -addstore -f Root "%~dp0IqbalLabs-CodeSigning.cer"
certutil -addstore -f TrustedPublisher "%~dp0IqbalLabs-CodeSigning.cer"
echo.
echo Done. Iqbal Labs is now a trusted publisher on this PC.
pause
