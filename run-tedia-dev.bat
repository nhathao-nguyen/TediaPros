@echo off
title TediaPros Dev (Main)
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
npm.cmd run dev
pause
