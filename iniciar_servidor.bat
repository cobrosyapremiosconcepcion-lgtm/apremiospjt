@echo off
title Judicial Pro - Servidor Local
echo ===================================================
echo         Iniciando Judicial Pro en Localhost
echo ===================================================
echo.

:: Asegurar que Node.js este en el PATH
set "PATH=C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

echo Servidor web corriendo en http://localhost:3000
echo Abriendo en tu navegador predeterminado...
echo.
start http://localhost:3000
node server.js
pause
