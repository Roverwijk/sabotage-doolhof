@echo off
set PORT=3001
start "SabotageDoolhofServer" /b "%~dp0tools\node\node-v22.22.2-win-x64\node.exe" "%~dp0server.js" > "%~dp0server3001.out.log" 2> "%~dp0server3001.err.log"
