@echo off
chcp 65001 >nul
title Orquestador
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instala la version 22 o superior desde https://nodejs.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

echo Comprobando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo La instalacion ha fallado.
  pause
  exit /b 1
)

echo Compilando y abriendo Orquestador...
call npm run start:desktop
if errorlevel 1 (
  echo Ha ocurrido un error al arrancar.
  pause
  exit /b 1
)
