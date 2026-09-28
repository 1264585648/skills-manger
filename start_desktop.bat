@echo off
title Skills Control Center
cd /d "%~dp0"
echo ==========================================
echo Starting Skills Control Center Desktop...
echo ==========================================
node scripts/desktop.mjs dev
pause
