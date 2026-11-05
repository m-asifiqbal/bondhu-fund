@echo off
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
echo ========================================================
echo   Launching Bondhu Fund Desktop Application...
echo   (100%% Offline Local SQLite Desktop App)
echo ========================================================
start "" "node_modules\electron\dist\electron.exe" .
