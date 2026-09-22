@echo off
title TediaPros Dev (Worktree)
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
npm.cmd run dev
pause
