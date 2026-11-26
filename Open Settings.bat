@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --settings
) else (
    start "" npm run settings
)
