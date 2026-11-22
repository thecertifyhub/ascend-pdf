@echo off
title Ascend - roadmap video export
echo Exporting roadmap videos with PowerPoint. Keep this window open until it says Done.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_export\Export_Roadmaps.ps1"
echo.
pause
